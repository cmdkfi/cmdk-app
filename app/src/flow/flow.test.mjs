import test from 'node:test'
import assert from 'node:assert/strict'
import { accountKind } from './account.ts'
import { classifyVault, discoverActiveVault, positionShape } from './active-vault.ts'
import { checkDeposit, parseDecimal } from './amount.ts'
import { connectionError, formatUnits, formatWadPercent, shortAddress } from './format.ts'
import { fundingNeed } from './funding.ts'

const MIN = 10n ** 15n

test('V8: decimals reject scientific, negative, over-precise or zero inputs', () => {
  // main:app/src/live-actions.test.mjs › token decimals reject scientific, negative, rounded or zero inputs
  assert.equal(parseDecimal('0.000001', 6), 1n)
  for (const text of ['0', '-1', '1e3', '0.0000001', 'NaN', '.5', '1.', '']) assert.equal(parseDecimal(text, 6), null, text)
})

test('deposit amount: empty, invalid, below minimum, valid, no maximum (D7)', () => {
  assert.deepEqual(checkDeposit(' ', MIN), { kind: 'empty' })
  assert.equal(checkDeposit('abc', MIN).kind, 'invalid')
  assert.deepEqual(checkDeposit('0.0009', MIN), { kind: 'below-min' })
  assert.deepEqual(checkDeposit('0.001', MIN), { kind: 'ok', wei: MIN })
  assert.deepEqual(checkDeposit(' 1.5 ', MIN), { kind: 'ok', wei: 15n * 10n ** 17n })
  assert.deepEqual(checkDeposit('1000000', MIN), { kind: 'ok', wei: 10n ** 24n })
})

test('V33: plain and EIP-7702 delegated accounts are allowed; contracts are not', () => {
  // main:app/src/wallet-utils.test.mjs › allows plain and EIP-7702 delegated accounts, but rejects contracts
  assert.equal(accountKind(undefined), 'plain')
  assert.equal(accountKind('0x'), 'plain')
  assert.equal(accountKind('0xef0100aabb'), 'delegated')
  assert.equal(accountKind('0xEF0100aabb'), 'delegated')
  assert.equal(accountKind('0x60806040'), 'contract')
})

test('V34/V35: short address and plain wallet errors', () => {
  // main:app/src/wallet-utils.test.mjs › formats an address… / gives actionable connection errors
  assert.equal(shortAddress('0x1234567890123456789012345678901234567890'), '0x1234…7890')
  assert.match(connectionError(new Error('User rejected request')), /cancelled/)
  assert.match(connectionError(new Error('provider not found')), /not found/)
})

test('format: truncates, groups and never rounds up', () => {
  assert.equal(formatUnits(123_456_789n, 6, 2), '123.45')
  assert.equal(formatUnits(1_234_567_000_000n, 6, 2), '1,234,567')
  assert.equal(formatUnits(999_999n, 6, 2), '0.99')
  assert.equal(formatWadPercent(86n * 10n ** 16n), '86%')
})

test('funding: wrap only the missing WETH; with enough WETH only one transfer is paid for', () => {
  const costs = { wrapCost: 1_000n, transferCost: 2_000n }, amount = 10n ** 17n
  assert.deepEqual(fundingNeed(amount, { eth: 10n ** 18n, weth: 0n, ...costs }), { wrap: amount, transactions: 2, gas: 3_000n, required: amount + 3_000n, missing: 0n, enough: true })
  assert.deepEqual(fundingNeed(amount, { eth: 2_000n, weth: amount, ...costs }), { wrap: 0n, transactions: 1, gas: 2_000n, required: 2_000n, missing: 0n, enough: true })
  assert.equal(fundingNeed(amount, { eth: 1_999n, weth: amount * 2n, ...costs }).missing, 1n)
})

const summary = (markets, idle = {}, setupComplete = true) => ({ vault: { accountId: 'v10.f.testnet', number: 10, baseAddress: '0x' + '11'.repeat(20) }, markets, idle: { eth: 0n, weth: 0n, usdc: 0n, ...idle }, setupComplete })
const guided = { minDepositWei: MIN, usdcDust: 10_000n }

test('classification: liquidated, active, idle USDC, setup, deposited, ready (no derived "closed")', () => {
  assert.equal(positionShape(summary([{ collateral: 0n, debt: 5n }])), 'liquidated')
  assert.equal(classifyVault(summary([{ collateral: 0n, debt: 5n }], { usdc: 10n ** 9n }), guided), 'liquidated')
  assert.equal(classifyVault(summary([{ collateral: 1n, debt: 0n }, { collateral: 0n, debt: 0n }]), guided), 'active')
  assert.equal(classifyVault(summary([{ collateral: 0n, debt: 0n }, { collateral: 3n, debt: 2n }]), guided), 'active')
  assert.equal(classifyVault(summary([{ collateral: 1n, debt: 1n }], { usdc: 10_001n }), guided), 'active-idle-usdc')
  assert.equal(classifyVault(summary([{ collateral: 1n, debt: 1n }], { usdc: 10_000n }), guided), 'active')
  assert.equal(classifyVault(summary([{ collateral: 0n, debt: 0n }], {}, false), guided), 'setup')
  assert.equal(classifyVault(summary([{ collateral: 0n, debt: 0n }], { weth: 10n ** 18n }, false), guided), 'setup')
  assert.equal(classifyVault(summary([{ collateral: 0n, debt: 0n }], { weth: MIN }), guided), 'deposited')
  assert.equal(classifyVault(summary([{ collateral: 0n, debt: 0n }], { weth: MIN - 1n }), guided), 'ready')
})

test('discovery: no vault is "found: null"; a failed read propagates (never "none")', async () => {
  const app = { guided, config: { near: { factory: 'f.testnet' } } }
  assert.deepEqual(await discoverActiveVault({ discoverPosition: async () => null }, app, '0xowner'), { status: null })
  assert.equal((await discoverActiveVault({ discoverPosition: async () => summary([{ collateral: 1n, debt: 1n }]) }, app, '0xowner')).status, 'active')
  await assert.rejects(discoverActiveVault({ discoverPosition: async () => { throw new Error('NEAR RPC did not answer.') } }, app, '0xowner'))
})

test('§9 5: the vault found for an owner is remembered (live only) and passed as the hint next time; none clears it', async () => {
  const m = new Map()
  globalThis.window = { localStorage: { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) } }
  const app = { guided, config: { near: { factory: 'f.testnet' } } }
  const hints = []
  const found = { ...summary([{ collateral: 1n, debt: 1n }]), vault: { accountId: 'v12.f.testnet', number: 12, baseAddress: '0x' + '15'.repeat(20) } }
  const protocol = answer => ({ discoverPosition: async (_app, _owner, hint) => { hints.push(hint); return answer } })
  await discoverActiveVault(protocol(found), app, '0xOWNER', 'live')
  await discoverActiveVault(protocol(found), app, '0xowner', 'live')
  await discoverActiveVault(protocol(null), app, '0xowner', 'live')
  await discoverActiveVault(protocol(null), app, '0xowner', 'live')
  assert.deepEqual(hints, [null, 'v12.f.testnet', 'v12.f.testnet', null])
  await discoverActiveVault(protocol(found), app, '0xother', 'sandbox')
  assert.deepEqual([...m.keys()], []) // sandbox never stores; the cleared live hint is gone
  delete globalThis.window
})

