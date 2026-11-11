// The sandbox engine (PRD §8a, Phase 6b; §8a.1, Phase 11): relayer stages by time, the user-run market crash with the
// protective reduce (the protocol's own math) beside Morpho Blue's liquidation of the same loan without the agent, and
// the close. A fake clock drives it; no storage, no network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { aprHundredths, interestForYear, isHealthy, liquidationIncentiveFactor, LIST_LAG_MS, LLTV, ltvOf, MAX_MOVES, REGISTER_MS, repayToLtv, SandboxEngine, STAGE_MS, START_PRICE, STORAGE_KEY, valueOf, VENUE_SCENE, WAD, withoutAgent } from './engine.ts'

const pct = n => BigInt(n) * 10n ** 16n
const CORRIDOR = { target: pct(50), act: pct(70), floor: pct(30), budget: pct(20), migrate: true }

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

// ---- Venue stress (docs/prd-sandbox-venue-stress.md): three user-advanced stages; stage 3 is Executor.migrate ----------

/** Close the open position from wherever it sits (the close repays on the vault's market), then Start over's reset. */
function closeAndReset(s, nonce) {
  const debt = s.e.debt()
  s.e.walletTx({ kind: 'transfer', token: 'usdc', amount: debt + debt / 100n + 10n ** 6n })
  s.e.ownerCall('close', { market: s.e.state().vault.market }, nonce); s.tick(STAGE_MS)
  s.e.resetPrice()
}

/** Start over on the same vault: send the released WETH home, wrap and transfer again, open (as S4 runs it after Start over). */
function reopen(s, nonce, deposit = 5n * 10n ** 17n) {
  s.e.ownerCall('withdraw', { token: 'weth', amount: s.e.state().vault.idle.weth.toString() }, nonce); s.tick(STAGE_MS)
  s.e.walletTx({ kind: 'wrap', amount: deposit }); s.e.walletTx({ kind: 'transfer', token: 'weth', amount: deposit })
  s.e.ownerCall('open', { collateral_in: deposit.toString(), target_ltv: pct(50).toString() }, nonce + 1); s.tick(STAGE_MS)
}

test('sandbox venue stress: stages 1 and 2 move nothing; stage 3 moves the position to backup, collateral identical and debt equal, no sale and no price move', () => {
  const s = engineAt()
  openPosition(s)
  const v0 = s.e.state().vault
  assert.equal(v0.market, 'live'); assert.equal(v0.venue, null); assert.equal(s.e.movesInWindow(), 0)
  const debt0 = s.e.debt()
  s.e.venueRun()
  let v = s.e.state().vault
  assert.deepEqual({ status: v.venue.status, stage: v.venue.stage }, { status: 'running', stage: 1 })
  assert.deepEqual(v.venue.start, { collateral: 5n * 10n ** 17n, debt: debt0, ltv: ltvOf(debt0, valueOf(5n * 10n ** 17n, START_PRICE)) })
  s.e.venueNext()
  v = s.e.state().vault
  assert.equal(v.venue.stage, 2)
  // the judge's stage changes nothing: same market, collateral, debt; no event; no price move
  assert.equal(v.market, 'live'); assert.equal(v.collateral, 5n * 10n ** 17n); assert.equal(s.e.debt(), debt0)
  assert.equal(s.e.state().events.filter(e => e.actor === 'agent').length, 0)
  const idle = { ...v.idle }, before = s.e.state().events.length
  s.e.venueNext()
  v = s.e.state().vault
  assert.equal(v.venue.stage, 3); assert.equal(v.market, 'backup')
  // Executor.migrate: collateral conserved exactly, debt conserved (to the unit; the sandbox has one accrual, so exactly)
  assert.equal(v.collateral, 5n * 10n ** 17n)
  assert.equal(v.venue.move.collateralBefore, v.venue.move.collateralAfter)
  assert.equal(v.venue.move.debtBefore, v.venue.move.debtAfter)
  assert.equal(s.e.debt(), debt0)
  assert.equal(s.e.price(), START_PRICE)
  assert.deepEqual(v.idle, idle) // no sale: nothing reaches the position address
  const added = s.e.state().events.slice(before)
  assert.deepEqual(added.map(e => [e.name, e.actor]), [['Migrated', 'agent']])
  assert.deepEqual(added[0].args, { from: 'live', to: 'backup', fraction: WAD, debtMoved: debt0, collateralMoved: 5n * 10n ** 17n })
  assert.equal(s.e.movesInWindow(), 1)
  s.e.venueNext()
  assert.equal(s.e.state().vault.venue.status, 'done')
  assert.throws(() => s.e.venueNext(), /No venue stress is running/)
  assert.throws(() => s.e.venueRun(), /already run/)
})

test('sandbox venue stress: the summary\'s interest for a year is debt × the recorded APR as shown (2.78 %, 0.92 %), simple', () => {
  const p = VENUE_SCENE.phases
  assert.equal(aprHundredths(p.after_borrow.markets.live.borrow_apr), 278n)
  assert.equal(aprHundredths(p.after.markets.backup.borrow_apr), 92n)
  // the §8a.1 position's debt, 802.5 USDC: 22.3095 and 7.383 USDC (the card truncates to cents in the hero's format: $22.3, $7.38)
  assert.equal(interestForYear(802_500_000n, 278n), 22_309_500n)
  assert.equal(interestForYear(802_500_000n, 92n), 7_383_000n)
  const s = engineAt()
  openPosition(s)
  s.e.venueRun(); s.e.venueNext(); s.e.venueNext()
  const m = s.e.state().vault.venue.move
  assert.equal(m.debtAfter, 802_500_000n)
  assert.deepEqual([m.interestLive, m.interestBackup], [22_309_500n, 7_383_000n])
})

test('sandbox venue stress: Close position from the backup market repays there and releases all collateral; Start over returns to live with both scenes offered', () => {
  const s = engineAt()
  openPosition(s)
  s.e.venueRun(); s.e.venueNext(); s.e.venueNext()
  assert.throws(() => s.e.resetPrice(), /still open/)
  s.tick(60_000)
  const debt = s.e.debt()
  closeAndReset(s, 3)
  const closed = s.e.state().events.filter(e => e.name === 'Closed')
  assert.equal(closed.length, 1)
  assert.equal(closed[0].args.market, 'backup')
  assert.ok(closed[0].args.repaid >= debt)
  let v = s.e.state().vault
  assert.equal(v.collateral, 0n); assert.equal(s.e.debt(), 0n); assert.equal(v.idle.weth, 5n * 10n ** 17n)
  // Start over's reset: back on live, no scene state; a new open offers both again
  assert.equal(v.market, 'live'); assert.equal(v.venue, null); assert.equal(v.crash, null)
  reopen(s, 4)
  v = s.e.state().vault
  assert.equal(v.market, 'live')
  assert.equal(s.e.state().events.filter(e => e.name === 'Opened').at(-1).args.market, 'live')
  s.e.venueRun(); s.e.crashRun()
})

test('sandbox: both scenes run on one position in either order, each once; after the move the agent reduces on the backup market', () => {
  // crash first (finished at $3,210, LTV about 35%), then the venue stress moves the reduced position
  const a = engineAt()
  openPosition(a)
  a.e.crashRun(); a.e.crashNext(); a.e.crashNext(); a.e.crashNext()
  const coll = a.e.state().vault.collateral, debt = a.e.debt()
  a.e.venueRun(); a.e.venueNext(); a.e.venueNext(); a.e.venueNext()
  assert.equal(a.e.state().vault.market, 'backup')
  assert.equal(a.e.state().vault.collateral, coll); assert.equal(a.e.debt(), debt)
  assert.throws(() => a.e.crashRun(), /already run/); assert.throws(() => a.e.venueRun(), /already run/)
  // venue first, then the crash: the protective reduce acts on the market that holds the loan
  const b = engineAt()
  openPosition(b)
  b.e.venueRun(); b.e.venueNext(); b.e.venueNext(); b.e.venueNext()
  b.e.crashRun()
  const reduced = b.e.state().events.filter(e => e.name === 'Reduced')
  assert.equal(reduced.length, 1)
  assert.equal(reduced[0].args.market, 'backup')
  assert.equal(b.e.state().vault.market, 'backup')
})

test('sandbox venue stress: Executor.migrate preconditions — migration allowed on both corridors, at most two moves per 24 hours', () => {
  const off = (t0 = 1_000_000) => { let now = t0; const e = new SandboxEngine({ ...CORRIDOR, migrate: false }, () => now, false); return { e, tick: ms => { now += ms } } }
  const d = off()
  openPosition(d)
  assert.throws(() => d.e.venueRun(), /MigrateDisabled/)
  assert.equal(d.e.state().vault.venue, null)
  // MAX_MOVES (Executor.sol l.51) in a rolling 24 hours (_recordMove l.593-599): the third run within the window is refused
  assert.equal(MAX_MOVES, 2)
  const s = engineAt()
  openPosition(s)
  s.e.venueRun(); s.e.venueNext(); s.e.venueNext(); s.e.venueNext()
  closeAndReset(s, 3); reopen(s, 4)
  s.e.venueRun(); s.e.venueNext(); s.e.venueNext()
  assert.equal(s.e.movesInWindow(), 2)
  closeAndReset(s, 6); reopen(s, 7)
  assert.throws(() => s.e.venueRun(), /MoveLimit/)
  s.tick(24 * 60 * 60 * 1000)
  assert.equal(s.e.movesInWindow(), 0)
  s.e.venueRun()
})

test('sandbox storage: STORAGE_KEY is v3; a v2 state from an earlier tab is discarded', () => {
  assert.equal(STORAGE_KEY, 'cmdk.sandbox.engine.v3')
  const store = new Map()
  const previous = globalThis.window
  globalThis.window = { sessionStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) } }
  try {
    store.set(STORAGE_KEY, JSON.stringify({ v: 2, startedAt: 1, counter: 9, price: '1', wallet: {}, vault: { market: undefined }, jobs: {}, txs: {}, events: [] }))
    const e = new SandboxEngine(CORRIDOR, () => 5_000)
    assert.equal(e.state().vault, null)
    assert.equal(e.state().v, 3)
  } finally {
    globalThis.window = previous
  }
})

