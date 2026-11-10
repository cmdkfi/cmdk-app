import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileLock } from './lock.ts'
import { activeStep, belowShown, jobPollDelay, newRecord, patchStep, resumeStep, retryMode, STEPS, topUpAmount } from './onboarding.ts'
import { clearLock, clearRecord, loadLock, loadRecord, lockKey, recordKey, saveLock, saveRecord } from './onboarding-record.ts'

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), keys: () => [...m.keys()] } }

test('resume step for each discovered vault status (PRD S0)', () => {
  assert.equal(resumeStep(null), 'create')
  assert.equal(resumeStep('setup'), 'setup')
  assert.equal(resumeStep('ready'), 'wrap')
  assert.equal(resumeStep('deposited'), 'open')
  assert.equal(resumeStep('active-idle-usdc'), 'withdraw')
})

test('a new record marks earlier steps done on chain; the active step is the first unfinished', () => {
  const r = newRecord({ factory: 'f.testnet', owner: '0xABC', amountWei: 10n ** 17n, shownLtv: 5n * 10n ** 17n, resumeAt: 'wrap', now: 1 })
  assert.equal(r.owner, '0xabc')
  assert.deepEqual(STEPS.map(id => r.steps[id].status), ['done', 'done', 'waiting', 'waiting', 'waiting', 'waiting'])
  assert.equal(activeStep(r), 'wrap')
  const skipped = patchStep(r, 'wrap', { status: 'skipped' })
  assert.equal(activeStep(skipped), 'transfer')
  const all = STEPS.reduce((acc, id) => patchStep(acc, id, { status: 'done' }), r)
  assert.equal(activeStep(all), null)
})

test('patchStep removes fields set to undefined', () => {
  const r = patchStep(newRecord({ factory: 'f', owner: 'o', amountWei: null, shownLtv: null, resumeAt: 'create', now: 1 }), 'setup', { status: 'paused', pause: { line: 'x' }, job: '0123456789abcdef' })
  const cleared = patchStep(r, 'setup', { status: 'waiting', pause: undefined, job: undefined })
  assert.deepEqual(cleared.steps.setup, { status: 'waiting' })
})

test('FR-5: job polling 1 s for 30 s, then 2 s, capped at 180 s', () => {
  assert.equal(jobPollDelay(0), 1000)
  assert.equal(jobPollDelay(29_999), 1000)
  assert.equal(jobPollDelay(30_000), 2000)
  assert.equal(jobPollDelay(179_999), 2000)
  assert.equal(jobPollDelay(180_000), null)
})

test('Q2: top-up = (need − have) × 1.25, rounded up to 0.0001 ETH, at least 0.0005 ETH', () => {
  // relayer.py check_funds example: 5 setup txs at 2 gwei ≈ 0.00096 ETH; the vault holds 0.0002 ETH
  assert.equal(topUpAmount(2n * 10n ** 14n, 96n * 10n ** 13n), 10n ** 15n) // 0.00076 × 1.25 = 0.00095 → 0.001
  assert.equal(topUpAmount(0n, 10n ** 14n), 5n * 10n ** 14n) // minimum
  assert.equal(topUpAmount(0n, 8n * 10n ** 14n), 10n ** 15n) // 0.001 exactly
  assert.equal(topUpAmount(0n, 8n * 10n ** 14n + 1n), 11n * 10n ** 14n) // rounds up
})

test('retry after a refusal re-sends the same message only with ≥ 45 s left', () => {
  assert.equal(retryMode(1000, 955), 'resend')
  assert.equal(retryMode(1000, 956), 'resign')
})

test('Q1: open pauses when the achievable LTV is more than 2 points below what S1 showed', () => {
  const pct = n => BigInt(n) * 10n ** 16n
  assert.equal(belowShown(pct(50), pct(48)), false)
  assert.equal(belowShown(pct(50), pct(48) - 1n), true)
  assert.equal(belowShown(null, 0n), false)
})

test('FR-6 lock reconciliation: job, owner_nonce and NEAR time decide', () => {
  const lock = { nonce: 4, expiry: 2000 }
  assert.equal(reconcileLock(lock, { ownerNonce: 3, nearNow: 1500, job: { stage: 'done' } }), 'done')
  assert.equal(reconcileLock(lock, { ownerNonce: 3, nearNow: 1500, job: { stage: 'failed', httpStatus: 400 } }), 'refused')
  assert.equal(reconcileLock(lock, { ownerNonce: 4, nearNow: 1500, job: 'lost' }), 'executed')
  assert.equal(reconcileLock(lock, { ownerNonce: 5, nearNow: 1500, job: { stage: 'failed', httpStatus: 502 } }), 'executed')
  assert.equal(reconcileLock(lock, { ownerNonce: 3, nearNow: 2001, job: 'lost' }), 'expired')
  assert.equal(reconcileLock(lock, { ownerNonce: 3, nearNow: 2000, job: 'lost' }), 'pending') // expiry is inclusive (owner.rs l.77)
  assert.equal(reconcileLock(lock, { ownerNonce: 3, nearNow: 1500, job: { stage: 'failed', httpStatus: 502 } }), 'pending')
  assert.equal(reconcileLock(lock, { ownerNonce: 3, nearNow: 1500, job: null }), 'pending')
})

test('Q3: record keyed factory:owner (vault inside), lock keyed vault:owner; sandbox keys never collide with live', () => {
  const local = memory(), session = memory()
  globalThis.window = { localStorage: local, sessionStorage: session }
  assert.equal(recordKey('live', 'f.testnet', '0xABC'), 'cmdk.live.onboarding.v1.f.testnet:0xabc')
  assert.equal(lockKey('live', 'v10.f.testnet', '0xABC'), 'cmdk.live.lock.v1.v10.f.testnet:0xabc')
  const r = newRecord({ factory: 'f.testnet', owner: '0xABC', amountWei: 1n, shownLtv: null, resumeAt: 'create', now: 1, vault: { accountId: 'v10.f.testnet', number: 10, baseAddress: '0x' + '15'.repeat(20) } })
  saveRecord('live', r)
  assert.deepEqual(loadRecord('live', 'f.testnet', '0xabc'), r)
  assert.equal(loadRecord('sandbox', 'f.testnet', '0xabc'), null)
  const lock = { vault: 'v10.f.testnet', owner: '0xabc', method: 'setup', nonce: 4, expiry: 2000, message: '{}', signature: '0x00' }
  saveLock('live', lock)
  assert.deepEqual(loadLock('live', 'v10.f.testnet', '0xABC'), lock)
  local.setItem(recordKey('live', 'f.testnet', '0xdef'), '{"version":2}')
  assert.equal(loadRecord('live', 'f.testnet', '0xdef'), null) // unknown shape is ignored, not trusted
  clearRecord('live', 'f.testnet', '0xabc'); clearLock('live', 'v10.f.testnet', '0xabc')
  assert.equal(loadRecord('live', 'f.testnet', '0xabc'), null)
  assert.equal(loadLock('live', 'v10.f.testnet', '0xabc'), null)
  assert.deepEqual(session.keys(), [])
  delete globalThis.window
})
