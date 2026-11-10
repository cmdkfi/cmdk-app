// The sandbox engine (PRD §8a, Phase 6b): stages by time, the scripted drop and the protective reduce with the
// protocol's own math, and the close. A fake clock drives it; no storage, no network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DROP_AFTER_OPEN_MS, ltvOf, REDUCE_AFTER_DROP_MS, REGISTER_MS, repayToLtv, SandboxEngine, STAGE_MS, START_PRICE, valueOf, WAD } from './engine.ts'

const pct = n => BigInt(n) * 10n ** 16n
const CORRIDOR = { target: pct(50), act: pct(70), floor: pct(30), budget: pct(20) }

function engineAt(t0 = 1_000_000) {
  let now = t0
  const e = new SandboxEngine(CORRIDOR, () => now, false)
  return { e, tick: ms => { now += ms }, now: () => now }
}

function openPosition({ e, tick }, deposit = 5n * 10n ** 17n) {
  e.createVault(); tick(STAGE_MS)
  e.ownerCall('setup', {}, 1); tick(STAGE_MS)
  e.walletTx({ kind: 'wrap', amount: deposit }); e.walletTx({ kind: 'transfer', token: 'weth', amount: deposit })
  e.ownerCall('open', { collateral_in: deposit.toString(), target_ltv: pct(50).toString() }, 2); tick(STAGE_MS)
  return e.state().vault
}

test('CorridorMath.repayToLtv vectors (executor/src/CorridorMath.sol l.39-46)', () => {
  assert.equal(repayToLtv(100n, 200n, pct(50)), 0n) // already at target
  assert.equal(repayToLtv(80n, 100n, pct(50)), 60n) // (80 − 50) / 0.5
  assert.equal(repayToLtv(80n, 100n, WAD), 0n)
  assert.equal(repayToLtv(10n, 0n, pct(50)), 10n) // never more than the debt
})

test('sandbox: stages complete by time; the nonce rule and one owner call at a time hold', () => {
  const s = engineAt()
  s.e.createVault()
  assert.equal(s.e.state().vault, null)
  s.tick(STAGE_MS)
  assert.ok(s.e.state().vault)
  assert.throws(() => s.e.ownerCall('setup', {}, 2), /owner_nonce \+ 1/)
  s.e.ownerCall('setup', {}, 1)
  assert.throws(() => s.e.ownerCall('open', {}, 1), /still running/)
  s.tick(STAGE_MS)
  assert.equal(s.e.state().vault.approved, true)
  assert.equal(s.e.registeredAt(), null)
  s.tick(REGISTER_MS)
  assert.ok(s.e.registeredAt())
})

test('sandbox: open at 50 %, then the scripted −30 % drop pushes LTV past 70 % and the protective reduce returns it to 50 % with the protocol math', () => {
  const s = engineAt()
  const v = openPosition(s)
  const value = valueOf(v.collateral, START_PRICE)
  assert.equal(ltvOf(s.e.debt(), value), pct(50))
  s.tick(DROP_AFTER_OPEN_MS)
  const dropped = s.e.state()
  const peak = ltvOf(s.e.debt(), valueOf(dropped.vault.collateral, dropped.price))
  assert.ok(peak > pct(71) && peak < pct(72), `peak ${peak}`)
  assert.equal(dropped.vault.reducedAt, null)
  const debtBefore = s.e.debt(s.now() + REDUCE_AFTER_DROP_MS), collBefore = dropped.vault.collateral
  s.tick(REDUCE_AFTER_DROP_MS)
  const after = s.e.state()
  const reduced = after.events.find(e => e.name === 'Reduced')
  assert.ok(reduced, 'a Reduced event')
  assert.equal(reduced.actor, 'agent')
  assert.equal(reduced.args.protective, true)
  assert.equal(reduced.args.repaid, repayToLtv(debtBefore, valueOf(collBefore, after.price), pct(50)))
  // more than the 20 % discretionary budget is sold: a protective reduce is not budget-limited (Executor.sol l.261-266)
  assert.ok(reduced.args.collateralSold * 100n / collBefore > 40n)
  const ltvAfter = ltvOf(s.e.debt(), valueOf(after.vault.collateral, after.price))
  assert.ok(ltvAfter >= pct(49) && ltvAfter <= pct(50), `after ${ltvAfter}`)
})

test('sandbox: close repays the accrued debt from idle USDC and releases the collateral', () => {
  const s = engineAt()
  openPosition(s)
  s.e.ownerCall('withdraw', { token: 'usdc', amount: s.e.state().vault.idle.usdc.toString() }, 3); s.tick(STAGE_MS)
  s.tick(60_000)
  const debt = s.e.debt()
  assert.ok(debt > 0n)
  s.e.walletTx({ kind: 'transfer', token: 'usdc', amount: debt + debt / 100n + 10n ** 6n })
  s.e.ownerCall('close', { market: 'live' }, 4); s.tick(STAGE_MS)
  const v = s.e.state().vault
  assert.equal(v.collateral, 0n)
  assert.equal(s.e.debt(), 0n)
  assert.ok(v.idle.weth > 0n)
  assert.ok(s.e.state().events.some(e => e.name === 'Closed'))
})
