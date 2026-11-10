// The sandbox engine (PRD §8a, Phase 6b; §8a.1, Phase 11): relayer stages by time, the user-run market crash with the
// protective reduce (the protocol's own math) beside Morpho Blue's liquidation of the same loan without the agent, and
// the close. A fake clock drives it; no storage, no network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { isHealthy, liquidationIncentiveFactor, LIST_LAG_MS, LLTV, ltvOf, REGISTER_MS, repayToLtv, SandboxEngine, STAGE_MS, START_PRICE, valueOf, WAD, withoutAgent } from './engine.ts'

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
  // like the live setup: a corridor on each market, each in its own transaction (two rows in recent actions)
  const set = s.e.state().events.filter(e => e.name === 'CorridorSet')
  assert.deepEqual(set.map(e => e.args.market), ['live', 'backup'])
  assert.notEqual(set[0].hash, set[1].hash)
  assert.equal(s.e.registeredAt(), null)
  s.tick(REGISTER_MS)
  assert.ok(s.e.registeredAt())
})

test('Morpho Blue liquidation math (morpho-org/morpho-blue src/Morpho.sol liquidate l.365-379, _isHealthy l.527-539)', () => {
  // min(1.15, 1 / (1 − 0.3 × (1 − 0.86))) = 1 / 0.958
  assert.equal(liquidationIncentiveFactor(LLTV), 1_043_841_336_116_910_229n)
  assert.equal(liquidationIncentiveFactor(pct(50)), 115n * 10n ** 16n) // capped at MAX_LIQUIDATION_INCENTIVE_FACTOR
  // healthy while collateral value × LLTV covers the debt
  assert.equal(isHealthy(5n * 10n ** 17n, 802_500_000n, 2247n * 10n ** 24n, LLTV), true)
  assert.equal(isHealthy(5n * 10n ** 17n, 802_500_000n, 17655n * 10n ** 23n, LLTV), false)
  // seized is capped at the collateral; the borrower then keeps nothing
  const capped = withoutAgent(10n ** 16n, 802_500_000n, 17655n * 10n ** 23n, LLTV)
  assert.equal(capped.liquidation.seized, 10n ** 16n)
  assert.equal(capped.collateral, 0n)
  assert.equal(capped.debt, 0n)
})

test('sandbox: nothing moves on a timer: ten minutes after open the price is the start price and the agent has not acted', () => {
  const s = engineAt()
  openPosition(s)
  s.tick(600_000)
  const st = s.e.state()
  assert.equal(st.price, START_PRICE)
  assert.equal(st.events.some(e => e.name === 'Reduced'), false)
  assert.equal(st.vault.crash, null)
})

test('sandbox market crash: the three stages give the PRD §8a.1 figures exactly, with and without the agent', () => {
  const s = engineAt()
  openPosition(s) // 0.5 WETH at $3,210, borrowed at 50%; the clock does not move during the run, so no interest accrues
  s.e.crashRun()
  let c = s.e.state().vault.crash
  assert.equal(c.status, 'running')
  assert.deepEqual(c.start, { price: START_PRICE, collateral: 5n * 10n ** 17n, debt: 802_500_000n, value: 1_605_000_000n, ltv: pct(50), borrowed: 802_500_000n })

  // 1 · −30%: $2,247. Without: LTV 71.4%, nothing happens. With: the protective reduce repays 481.5 USDC, sells 0.214286 WETH, back to 50%.
  const [one] = c.stages
  assert.equal(one.price, 2247n * 10n ** 24n)
  assert.deepEqual(one.without, { collateral: 5n * 10n ** 17n, debt: 802_500_000n, value: 1_123_500_000n, ltv: 714_285_714_285_714_285n, liquidation: null, liquidatedEarlier: false })
  assert.deepEqual(one.with.reduce, { repaid: 481_500_000n, sold: 214_285_714_285_714_285n, ltvBefore: 714_285_714_285_714_285n })
  assert.equal(one.with.collateral, 285_714_285_714_285_715n)
  assert.equal(one.with.debt, 321_000_000n)
  assert.equal(one.with.ltv, pct(50))
  const reduced = s.e.state().events.filter(e => e.name === 'Reduced')
  assert.equal(reduced.length, 1)
  assert.equal(reduced[0].args.repaid, 481_500_000n)
  assert.equal(reduced[0].args.collateralSold, 214_285_714_285_714_285n)
  // not budget-limited: more than the 20% discretionary budget was sold (Executor.sol l.261-266)
  assert.ok(one.with.reduce.sold * 100n / (5n * 10n ** 17n) > 40n)

  // 2 · −45%: $1,765.50. Without: LTV 90.9% > 86%, liquidated, 0.474473 WETH seized, 0.025527 WETH ($45.07) kept. With: 63.6%, no action.
  s.e.crashNext()
  c = s.e.state().vault.crash
  const two = c.stages[1]
  assert.equal(two.price, 17655n * 10n ** 23n)
  assert.deepEqual(two.without.liquidation, { repaid: 802_500_000n, seized: 474_473_334_466_156_896n, ltvBefore: 909_090_909_090_909_090n })
  assert.equal(two.without.collateral, 25_526_665_533_843_104n)
  assert.equal(two.without.value, 45_067_328n)
  assert.equal(two.without.debt, 0n)
  assert.equal(ltvOf(802_500_000n, valueOf(5n * 10n ** 17n, two.price)), 909_090_909_090_909_090n)
  assert.equal(two.with.reduce, null)
  assert.equal(two.with.ltv, 636_363_636_904_302_155n)
  assert.equal(two.with.collateral, 285_714_285_714_285_715n)
  assert.equal(s.e.state().events.filter(e => e.name === 'Reduced').length, 1)

  // 3 · back to $3,210. Without: $81.94 of collateral. With: $917.14 against 321 USDC, $596.14 net.
  s.e.crashNext()
  c = s.e.state().vault.crash
  const three = c.stages[2]
  assert.equal(three.price, START_PRICE)
  assert.equal(three.without.value, 81_940_596n)
  assert.equal(three.without.liquidation, null)
  assert.equal(three.without.liquidatedEarlier, true)
  assert.equal(three.with.value, 917_142_857n)
  assert.equal(three.with.debt, 321_000_000n)
  assert.equal(three.with.value - three.with.debt, 596_142_857n)
  assert.equal(c.status, 'running')

  // Done finishes it; the run is once per position
  s.e.crashNext()
  assert.equal(s.e.state().vault.crash.status, 'done')
  assert.throws(() => s.e.crashNext(), /No market crash is running/)
  assert.throws(() => s.e.crashRun(), /already run/)
})

test('sandbox market crash: interest keeps accruing on the position during the run', () => {
  const s = engineAt()
  openPosition(s)
  s.tick(3_600_000)
  s.e.crashRun()
  const c = s.e.state().vault.crash
  assert.ok(c.start.debt > 802_500_000n)
  assert.ok(c.stages[0].with.debt > 0n)
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

test('sandbox market crash: Close position works mid-run; Start over (a new open) offers the crash again', () => {
  const s = engineAt()
  openPosition(s)
  s.e.crashRun(); s.e.crashNext() // stage 2
  const debt = s.e.debt()
  s.e.walletTx({ kind: 'transfer', token: 'usdc', amount: debt + debt / 100n + 10n ** 6n })
  s.e.ownerCall('close', { market: 'live' }, 3); s.tick(STAGE_MS)
  const closed = s.e.state().vault
  assert.equal(closed.collateral, 0n)
  assert.equal(closed.idle.weth, 285_714_285_714_285_715n) // the agent-protected collateral comes back
  assert.throws(() => s.e.crashRun(), /No open simulated position/)
  // Start over reuses the vault: wrap, transfer, open again
  const deposit = 10n ** 17n
  s.e.ownerCall('withdraw', { token: 'weth', amount: closed.idle.weth.toString() }, 4); s.tick(STAGE_MS)
  s.e.walletTx({ kind: 'wrap', amount: deposit }); s.e.walletTx({ kind: 'transfer', token: 'weth', amount: deposit })
  s.e.ownerCall('open', { collateral_in: deposit.toString(), target_ltv: pct(50).toString() }, 5); s.tick(STAGE_MS)
  assert.equal(s.e.state().vault.crash, null)
  s.e.crashRun()
  assert.equal(s.e.state().vault.crash.stages.length, 1)
})

test('sandbox Start over: the price returns to $3,210 before the new position opens; refused while a position is open', () => {
  const s = engineAt()
  openPosition(s)
  s.e.crashRun(); s.e.crashNext() // closed at stage 2, the price at $1,765.50
  assert.throws(() => s.e.resetPrice(), /still open/)
  const debt = s.e.debt()
  s.e.walletTx({ kind: 'transfer', token: 'usdc', amount: debt + debt / 100n + 10n ** 6n })
  s.e.ownerCall('close', { market: 'live' }, 3); s.tick(STAGE_MS)
  assert.equal(s.e.price(), 17655n * 10n ** 23n)
  s.e.resetPrice()
  assert.equal(s.e.price(), START_PRICE)
  // the next run reproduces the §8a.1 stages
  const deposit = 5n * 10n ** 17n
  s.e.walletTx({ kind: 'wrap', amount: deposit }); s.e.walletTx({ kind: 'transfer', token: 'weth', amount: deposit })
  s.e.ownerCall('open', { collateral_in: (s.e.state().vault.idle.weth).toString(), target_ltv: pct(50).toString() }, 4); s.tick(STAGE_MS)
  s.e.crashRun()
  assert.equal(s.e.state().vault.crash.start.price, START_PRICE)
  assert.equal(s.e.state().vault.crash.stages[0].price, 2247n * 10n ** 24n)
})

test('sandbox revoke_agent (Phase 12): clears the approval and the key, keeps the position and the Base corridors; setup again re-registers', () => {
  const s = engineAt()
  const v0 = openPosition(s)
  s.tick(REGISTER_MS)
  assert.ok(s.e.registeredAt())
  assert.equal(v0.corridorSet, true)
  const before = { collateral: v0.collateral, principal: v0.principal, nonce: v0.ownerNonce }
  // vault/src/lib.rs l.419-424: one NEAR transaction, no Base receipt
  const id = s.e.ownerCall('revoke_agent', {}, before.nonce + 1)
  s.tick(STAGE_MS)
  const v = s.e.state().vault
  assert.equal(s.e.job(id).applied, true)
  assert.deepEqual(s.e.job(id).receipts, [])
  assert.equal(v.approved, false)
  assert.equal(s.e.registeredAt(), null)
  assert.equal(v.corridorSet, true, 'the Base corridors stay set')
  assert.equal(v.collateral, before.collateral); assert.equal(v.principal, before.principal)
  assert.ok(v.revokedAt !== null && v.revokedAt + LIST_LAG_MS > s.now(), 'the simulated agent list lags the chain for a while')
  s.tick(LIST_LAG_MS)
  assert.ok(v.revokedAt + LIST_LAG_MS <= s.now())
  // Approve agent: a setup again; the key registers REGISTER_MS later
  s.e.ownerCall('setup', {}, before.nonce + 2); s.tick(STAGE_MS)
  assert.equal(s.e.state().vault.approved, true)
  assert.equal(s.e.state().vault.revokedAt, null)
  assert.equal(s.e.registeredAt(), null)
  s.tick(REGISTER_MS)
  assert.ok(s.e.registeredAt())
})
