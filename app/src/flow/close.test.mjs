import test from 'node:test'
import assert from 'node:assert/strict'
import { activeCloseStep, closeShortfall, needsSecondTransfer, newCloseRecord, startOverAllowed, visibleCloseSteps, walletMissing } from './close.ts'
import { patchStep } from './onboarding.ts'
import { clearCloseRecord, closeKey, loadCloseRecord, saveCloseRecord } from './onboarding-record.ts'
import { debtAt, repayNeed } from '../protocol/base/math.ts'

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), keys: () => [...m.keys()] } }
const VAULT = { accountId: 'v10.f.testnet', number: 10, baseAddress: '0x' + '15'.repeat(20) }

// A plan as the live adapter builds it: debt accrued to now and to now + 600 s, each with the relayer's 1% headroom.
const TOTALS = { totalBorrowAssets: 2_000_000_000n, totalBorrowShares: 2_000_000_000n, lastUpdate: 1_000n }
const RATE = 1_585_489_600n
function plan(shares, idleUsdc, now = 1_000n) {
  const debtNow = debtAt(shares, TOTALS, RATE, now), debtAhead = debtAt(shares, TOTALS, RATE, now + 600n)
  return { debtNow, debtAhead, needNow: repayNeed(debtNow), needAhead: repayNeed(debtAhead), idle: { usdc: idleUsdc } }
}

test('shortfall = need(debt accrued to now + 600 s) − idle USDC, floored at 0', () => {
  // 160.000001 USDC now; 160.000153 USDC after 600 s at 5% APR; need = debt + debt // 100
  const p = plan(160_080_000n, 0n)
  assert.equal(p.debtNow, 160_000_001n)
  assert.equal(p.debtAhead, 160_000_153n)
  assert.equal(closeShortfall(p), 161_600_154n)
  assert.equal(closeShortfall(plan(160_080_000n, 100_000_000n)), 61_600_154n)
  assert.equal(closeShortfall(plan(160_080_000n, 170_000_000n)), 0n)
  // the 600 s matter: with no time ahead the shortfall would be 153 units smaller
  assert.equal(closeShortfall({ needAhead: p.needNow, idle: { usdc: 0n } }), 161_600_001n)
})

test('R10: a second transfer is inserted when idle USDC is below need(debt now) at the close pre-check', () => {
  // enough at transfer time, then interest accrued for an hour while the user was away
  const first = plan(160_080_000n, 0n)
  const idle = closeShortfall(first) // what the first transfer sent
  assert.equal(needsSecondTransfer(plan(160_080_000n, idle, 1_600n)), false) // within the 600 s
  assert.equal(needsSecondTransfer(plan(160_080_000n, idle, 1_000n + 86_400n * 30n)), true) // a month later
  assert.equal(needsSecondTransfer({ needNow: 0n, idle: { usdc: 0n } }), false) // no debt (collateral only)
  const late = plan(160_080_000n, idle, 1_000n + 86_400n * 30n)
  assert.ok(closeShortfall(late) > 0n) // the second transfer sends the new shortfall
})

test('S6a: the wallet is missing the shortfall minus its USDC, never negative', () => {
  assert.equal(walletMissing(161_600_154n, 100_000_000n), 61_600_154n)
  assert.equal(walletMissing(161_600_154n, 200_000_000n), 0n)
})

test('close record: steps in order; transfer2 hidden and finished until inserted; completed is the closed marker', () => {
  let r = newCloseRecord({ factory: 'f.testnet', owner: '0xABC', vault: VAULT, now: 1, autostart: true })
  assert.equal(r.owner, '0xabc')
  assert.equal(activeCloseStep(r), 'transfer')
  assert.deepEqual(visibleCloseSteps(r), ['transfer', 'close', 'withdrawWeth', 'withdrawUsdc'])
  r = patchStep(r, 'transfer', { status: 'done' })
  assert.equal(activeCloseStep(r), 'close')
  r = { ...patchStep(r, 'transfer2', { status: 'waiting' }), secondTransfer: true }
  assert.equal(activeCloseStep(r), 'transfer2')
  assert.deepEqual(visibleCloseSteps(r), ['transfer', 'transfer2', 'close', 'withdrawWeth', 'withdrawUsdc'])
  for (const id of ['transfer2', 'close', 'withdrawWeth']) r = patchStep(r, id, { status: 'done' })
  r = patchStep(r, 'withdrawUsdc', { status: 'skipped' })
  assert.equal(activeCloseStep(r), null)
  assert.equal(activeCloseStep({ ...newCloseRecord({ factory: 'f', owner: '0x1', vault: VAULT, now: 1 }), completed: true }), null)
})

test('close record storage: keyed <prefix>.close.v1.<factory>:<owner>:<vault>; sandbox never sees live', () => {
  const local = memory(), session = memory()
  globalThis.window = { localStorage: local, sessionStorage: session }
  assert.equal(closeKey('live', 'f.testnet', '0xABC', 'v10.f.testnet'), 'cmdk.live.close.v1.f.testnet:0xabc:v10.f.testnet')
  const r = newCloseRecord({ factory: 'f.testnet', owner: '0xABC', vault: VAULT, now: 1 })
  saveCloseRecord('live', r)
  assert.deepEqual(loadCloseRecord('live', 'f.testnet', '0xabc', 'v10.f.testnet'), r)
  assert.equal(loadCloseRecord('live', 'f.testnet', '0xabc', 'v11.f.testnet'), null) // another vault
  assert.equal(loadCloseRecord('sandbox', 'f.testnet', '0xabc', 'v10.f.testnet'), null)
  local.setItem(closeKey('live', 'f.testnet', '0xdef', 'v10.f.testnet'), '{"version":1,"steps":{}}')
  assert.equal(loadCloseRecord('live', 'f.testnet', '0xdef', 'v10.f.testnet'), null) // unknown shape is ignored
  clearCloseRecord('live', 'f.testnet', '0xabc', 'v10.f.testnet')
  assert.equal(loadCloseRecord('live', 'f.testnet', '0xabc', 'v10.f.testnet'), null)
  assert.deepEqual(session.keys(), [])
  delete globalThis.window
})

test('Start over appears only when debt, collateral and idle WETH are zero and idle USDC is at or below dust', () => {
  const dust = 10_000n
  const v = (debt, collateral, weth, usdc) => ({ markets: [{ debt, collateral }, { debt: 0n, collateral: 0n }], idle: { weth, usdc } })
  assert.equal(startOverAllowed(v(0n, 0n, 0n, 0n), dust), true)
  assert.equal(startOverAllowed(v(0n, 0n, 0n, dust), dust), true)
  assert.equal(startOverAllowed(v(0n, 0n, 0n, dust + 1n), dust), false)
  assert.equal(startOverAllowed(v(0n, 0n, 1n, 0n), dust), false)
  assert.equal(startOverAllowed(v(1n, 0n, 0n, 0n), dust), false)
  assert.equal(startOverAllowed(v(0n, 1n, 0n, 0n), dust), false)
})
