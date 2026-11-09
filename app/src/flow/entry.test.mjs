import test from 'node:test'
import assert from 'node:assert/strict'
import { afterConnect, guard, landing } from './entry.ts'

const input = (wallet, discovery, { onboardingRecord = false, closeRecord = false } = {}) => ({ wallet, discovery, onboardingRecord, closeRecord })
const found = status => ({ kind: 'found', status })
const route = (r, extra = {}) => ({ kind: 'route', route: r, ...extra })
const WAIT = { kind: 'wait' }
const RECORD = { onboardingRecord: true }

// PRD S0, "Where / (and #start) lands" — one test per table row (revised 9 Nov: no derived "closed").
test('S0: not connected lands on S1', () => {
  assert.deepEqual(landing(input('disconnected', { kind: 'not-checked' })), route('start'))
})

test('S0: connected, discovery failed lands on S1 with the failure banner, never "no position"', () => {
  assert.deepEqual(landing(input('connected', { kind: 'failed' })), route('start', { banner: 'discovery-failed' }))
  assert.deepEqual(landing(input('connected', { kind: 'failed' }, RECORD)), route('start', { banner: 'discovery-failed' }))
})

test('S0: connected, no vaults lands on S1; a local creation record resumes S4 at create', () => {
  assert.deepEqual(landing(input('connected', found(null))), route('start'))
  assert.deepEqual(landing(input('connected', found(null), RECORD)), route('progress', { step: 'create' }))
})

test('S0: setup incomplete lands on S4 at the setup step', () => {
  assert.deepEqual(landing(input('connected', found('setup'))), route('progress', { step: 'setup' }))
})

test('S0: empty vault with complete setup lands on S4 at the deposit step', () => {
  assert.deepEqual(landing(input('connected', found('ready'))), route('progress', { step: 'deposit' }))
})

test('S0: WETH waiting at the position address lands on S4 at the open step', () => {
  assert.deepEqual(landing(input('connected', found('deposited'))), route('progress', { step: 'open' }))
})

test('S0: active position lands on S5', () => {
  assert.deepEqual(landing(input('connected', found('active'))), route('position', { variant: 'active' }))
})

test('S0: active with idle USDC lands on S4 withdraw only with a local onboarding record, else S5', () => {
  assert.deepEqual(landing(input('connected', found('active-idle-usdc'))), route('position', { variant: 'active' }))
  assert.deepEqual(landing(input('connected', found('active-idle-usdc'), RECORD)), route('progress', { step: 'withdraw' }))
})

test('S0: liquidated lands on S5 liquidated variant', () => {
  assert.deepEqual(landing(input('connected', found('liquidated'))), route('position', { variant: 'liquidated' }))
})

test('closed is shown only from this session\'s close record, never derived from a discovered vault', () => {
  assert.deepEqual(landing(input('connected', found('ready'), { closeRecord: true })), route('position', { variant: 'closed' }))
  for (const status of [null, 'setup', 'ready', 'deposited', 'active', 'active-idle-usdc', 'liquidated']) {
    const result = landing(input('connected', found(status)))
    assert.notEqual(result.variant, 'closed', `status ${status}`)
  }
})

// Item 2 (Phase 2): a local onboarding record never overrides chain state that shows a position.
test('a local onboarding record never overrides liquidated, active or this session\'s closed state', () => {
  assert.deepEqual(landing(input('connected', found('liquidated'), RECORD)), route('position', { variant: 'liquidated' }))
  assert.deepEqual(landing(input('connected', found('active'), RECORD)), route('position', { variant: 'active' }))
  assert.deepEqual(landing(input('connected', found('ready'), { onboardingRecord: true, closeRecord: true })), route('position', { variant: 'closed' }))
  assert.deepEqual(guard('progress', input('connected', found('liquidated'), RECORD)), route('start'))
  assert.deepEqual(guard('progress', input('connected', found('active'), RECORD)), route('start'))
})

test('landing waits while connecting or while vaults are being checked', () => {
  assert.deepEqual(landing(input('connecting', { kind: 'not-checked' })), WAIT)
  assert.deepEqual(landing(input('connected', { kind: 'checking' })), WAIT)
})

test('wrong network resolves like connected (discovery reads NEAR, not Base)', () => {
  assert.deepEqual(landing(input('wrong-network', found('active'))), route('position', { variant: 'active' }))
  assert.deepEqual(landing(input('wrong-network', { kind: 'failed' })), route('start', { banner: 'discovery-failed' }))
})

test('not-checked (no scan run yet) lands on S1 without a claim about vaults', () => {
  assert.deepEqual(landing(input('connected', { kind: 'not-checked' })), route('start'))
})

// PRD S0, route guards.
test('guard: #position without a position redirects to #start', () => {
  assert.deepEqual(guard('position', input('disconnected', { kind: 'not-checked' })), route('start'))
  assert.deepEqual(guard('position', input('connected', found(null))), route('start'))
  assert.deepEqual(guard('position', input('connected', found('ready'))), route('start'))
  assert.deepEqual(guard('position', input('connected', { kind: 'failed' })), route('start', { banner: 'discovery-failed' }))
})

test('guard: #position with a position stays, carrying the variant', () => {
  assert.deepEqual(guard('position', input('connected', found('active'))), route('position', { variant: 'active' }))
  assert.deepEqual(guard('position', input('connected', found('liquidated'))), route('position', { variant: 'liquidated' }))
  assert.deepEqual(guard('position', input('connected', found('ready'), { closeRecord: true })), route('position', { variant: 'closed' }))
})

test('guard: #progress needs unfinished onboarding and carries its step', () => {
  assert.deepEqual(guard('progress', input('disconnected', { kind: 'not-checked' })), route('start'))
  assert.deepEqual(guard('progress', input('connected', found(null))), route('start'))
  assert.deepEqual(guard('progress', input('connected', found('ready'))), route('progress', { step: 'deposit' }))
  assert.deepEqual(guard('progress', input('connected', found('setup'))), route('progress', { step: 'setup' }))
  assert.deepEqual(guard('progress', input('connected', found(null), RECORD)), route('progress', { step: 'create' }))
})

test('guard: #start with an active or liquidated position goes to #position; onboarding and closed stay', () => {
  assert.deepEqual(guard('start', input('connected', found('active'))), route('position', { variant: 'active' }))
  assert.deepEqual(guard('start', input('connected', found('liquidated'))), route('position', { variant: 'liquidated' }))
  assert.deepEqual(guard('start', input('connected', found('ready'), { closeRecord: true })), route('start'))
  assert.deepEqual(guard('start', input('connected', found('ready'))), route('start'))
})

test('guard: S1–S3 stay reachable while waiting; S4/S5 wait', () => {
  for (const r of ['start', 'settings', 'connect']) assert.deepEqual(guard(r, input('connected', { kind: 'checking' })), route(r))
  for (const r of ['position', 'progress']) assert.deepEqual(guard(r, input('connecting', { kind: 'not-checked' })), WAIT)
})

test('guard: settings and connect are never redirected, but keep the failure banner', () => {
  for (const r of ['settings', 'connect']) {
    for (const d of [found('active'), found(null), found('ready')]) assert.deepEqual(guard(r, input('connected', d)), route(r))
    assert.deepEqual(guard(r, input('connected', { kind: 'failed' })), route(r, { banner: 'discovery-failed' }))
  }
})

// Item 1 (Phase 2): the landing table re-runs when discovery resolves after a connect from S1–S3.
test('after connect: waits for discovery, then moves only when a vault needs S4 or S5', () => {
  assert.equal(afterConnect('connect', input('connected', { kind: 'checking' })), null)
  assert.deepEqual(afterConnect('connect', input('connected', found('active'))), route('position', { variant: 'active' }))
  assert.deepEqual(afterConnect('settings', input('connected', found('ready'))), route('progress', { step: 'deposit' }))
  assert.deepEqual(afterConnect('start', input('connected', found('setup'))), route('progress', { step: 'setup' }))
  // no vault, or an unknown scan: the user stays where they connected
  assert.deepEqual(afterConnect('connect', input('connected', found(null))), route('connect'))
  assert.deepEqual(afterConnect('connect', input('connected', { kind: 'failed' })), route('connect', { banner: 'discovery-failed' }))
})
