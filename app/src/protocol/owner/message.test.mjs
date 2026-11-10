import test from 'node:test'
import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'
import { V } from '../vectors.mjs'
import { closeArgs, corridorArgs, expiryFor, messageExpired, nonceAccepted, openArgs, ownerMessage, recoverOwner, revokeAgentArgs, setupArgs, setupComplete, wad, withdrawArgs } from './message.ts'

test('V1: setup message bytes equal the p2_owner.py formula, field order and WAD fractions', () => {
  const v = V.V1_setupMessage
  const args = setupArgs(v.facts, v.rules, v.measurement, false)
  assert.equal(ownerMessage({ vault: v.vault, method: 'setup', args, nonce: v.nonce, expiry: v.expiry }), v.text)
})

test('V1/Q4: a fresh setup approves on every market and authorizes once per executor', () => {
  const args = setupArgs(V.V1_setupMessage.facts, V.V1_setupMessage.rules, V.V1_setupMessage.measurement, false)
  assert.deepEqual(args.markets.map(m => [m.approve, m.authorize]), [[true, true], [true, false]])
})

test('V5/Q4: a resumed setup keeps set corridors, never re-authorizes, approves again, and omits an approved measurement', () => {
  const args = setupArgs(V.V5_resumedSetup.facts, V.V1_setupMessage.rules, V.V1_setupMessage.measurement, true)
  assert.deepEqual(args.markets.map(m => [m.approve, m.authorize, m.corridor]), V.V5_resumedSetup.expect.markets)
  assert.equal(args.measurement, null)
})

test('V6: a new corridor must be valid for the market LLTV (CorridorMath.corridorValid)', () => {
  const facts = [{ ...V.V1_setupMessage.facts[0], lltv: V.V6_lltv.lltv }]
  assert.throws(() => setupArgs(facts, V.V1_setupMessage.rules, V.V1_setupMessage.measurement, false), /not valid/)
  assert.throws(() => setupArgs([], V.V1_setupMessage.rules, V.V1_setupMessage.measurement, false))
})

test('setup complete: authorization, both allowances above zero, corridor set, measurement approved (Q4)', () => {
  const done = V.V5_resumedSetup.facts.map(f => ({ ...f, authorized: true, loanAllowance: 1n, collateralAllowance: 1n, corridorSet: true }))
  assert.equal(setupComplete(done, true), true)
  assert.equal(setupComplete(done, false), false)
  assert.equal(setupComplete([done[0], { ...done[1], loanAllowance: 0n }], true), false)
  assert.equal(setupComplete([done[0], { ...done[1], authorized: false }], true), false)
  assert.equal(setupComplete([done[0], { ...done[1], corridorSet: false }], true), false)
  // a used USDC allowance below max is still present (relayer.py l.478-483)
  assert.equal(setupComplete(done.map(f => ({ ...f, loanAllowance: (1n << 256n) - 1n - 160_000_000n })), true), true)
  assert.equal(setupComplete([], true), false)
})

test('V13: open, withdraw and close message bytes', () => {
  const live = '0x' + 'aa'.repeat(32)
  assert.equal(ownerMessage({ vault: 'v10.factory.testnet', method: 'open', args: openArgs(live, 10n ** 17n, 5n * 10n ** 17n), nonce: 2, expiry: 1793722800 }), V.V13_open.text)
  assert.equal(ownerMessage({ vault: 'v10.factory.testnet', method: 'withdraw', args: withdrawArgs('0x036CbD53842c5426634e7929541eC2318f3dCF7e', 160_000_000n, '0x' + '19'.repeat(20)), nonce: 3, expiry: 1793723400 }), V.V13_open.withdraw)
  assert.equal(ownerMessage({ vault: 'v10.factory.testnet', method: 'close', args: closeArgs(live), nonce: 4, expiry: 1793724000 }), V.V13_open.close)
  // Phase 12: revoke_agent carries no fields (vault/src/lib.rs l.419-424 NoArgs; relayer.py OWNER_ARGS ()), so args is {}
  assert.equal(ownerMessage({ vault: 'v10.factory.testnet', method: 'revoke_agent', args: revokeAgentArgs(), nonce: 5, expiry: 1793724600 }), V.V18_revoke.text)
  assert.throws(() => withdrawArgs('0x036CbD53842c5426634e7929541eC2318f3dCF7e', 0n, '0x' + '19'.repeat(20)))
})

test('V7/V11: testnet payload, factory vault ids only, positive integer nonces', () => {
  const v = V.V7_payload
  assert.equal(JSON.parse(ownerMessage({ vault: v.vault, method: 'close', args: {}, nonce: v.nonce, expiry: 1000 })).network, 'testnet')
  assert.equal(JSON.parse(ownerMessage({ vault: v.vault, method: 'close', args: {}, nonce: v.nonce, expiry: 1000 })).nonce, 2)
  assert.throws(() => ownerMessage({ vault: v.refusedVault, method: 'close', args: {}, nonce: 2, expiry: 1000 }))
  assert.throws(() => ownerMessage({ vault: v.vault, method: 'close', args: {}, nonce: NaN, expiry: 1000 }))
  assert.throws(() => ownerMessage({ vault: v.vault, method: 'close', args: {}, nonce: V.V11_nonceZero.nonce, expiry: 1000 }))
})

test('V9: the signed nonce must be above the vault owner_nonce', () => {
  assert.equal(nonceAccepted(V.V9_freshNonce.messageNonce, V.V9_freshNonce.accepted), true)
  assert.equal(nonceAccepted(V.V9_freshNonce.messageNonce, V.V9_freshNonce.refused), false)
})

test('V10/V12: expiry is inclusive, at most 3600 s ahead, 600 s by default', () => {
  assert.equal(messageExpired(V.V10_expiry.expiry, V.V10_expiry.expiredAt), true)
  assert.equal(messageExpired(V.V10_expiry.expiry, V.V10_expiry.validAt), false)
  assert.equal(expiryFor(V.V12_expiryBound.now), V.V12_expiryBound.now + 600)
  assert.equal(expiryFor(V.V12_expiryBound.now, V.V12_expiryBound.maxAhead), V.V12_expiryBound.now + 3600)
  assert.throws(() => expiryFor(V.V12_expiryBound.now, V.V12_expiryBound.maxAhead + 1))
})

test('wad and corridor args: percentages with one decimal, field order of lib.rs Corridor', () => {
  assert.equal(wad(50), '500000000000000000')
  assert.equal(wad(70.5), '705000000000000000')
  assert.throws(() => wad(50.05))
  assert.deepEqual(Object.keys(corridorArgs(V.V1_setupMessage.rules)), ['target', 'act', 'floor', 'sell_budget', 'migrate_allowed', 'exit_allowed'])
})

test('recoverOwner: ERC-191 signer; v 0/1 and 27/28; high-s refused', async () => {
  const account = privateKeyToAccount('0x' + '11'.repeat(32))
  const message = V.V13_open.text
  const signature = await account.signMessage({ message })
  assert.equal(await recoverOwner(message, signature), account.address)
  const v = parseInt(signature.slice(130), 16)
  assert.equal(await recoverOwner(message, signature.slice(0, 130) + (v - 27).toString(16).padStart(2, '0')), account.address)
  const n = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141')
  const highS = (n - BigInt('0x' + signature.slice(66, 130))).toString(16).padStart(64, '0')
  await assert.rejects(recoverOwner(message, signature.slice(0, 66) + highS + (v === 27 ? '1c' : '1b')), /high-s/)
  await assert.rejects(recoverOwner(message, '0x1234'), /65 bytes/)
})
