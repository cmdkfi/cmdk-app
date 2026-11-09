import test from 'node:test'
import assert from 'node:assert/strict'
import { guard, landing } from './entry.ts'

const input = (wallet, discovery, onboardingRecord = false) => ({ wallet, discovery, onboardingRecord })
const found = status => ({ kind: 'found', status })
const route = (r, extra = {}) => ({ kind: 'route', route: r, ...extra })
const WAIT = { kind: 'wait' }

// PRD S0, "Where / (and #start) lands" — one test per table row.
test('S0: not connected lands on S1', () => {
  assert.deepEqual(landing(input('disconnected', { kind: 'not-checked' })), route('start'))
})

test('S0: connected, discovery failed lands on S1 with the failure banner, never "no position"', () => {
  assert.deepEqual(landing(input('connected', { kind: 'failed' })), route('start', { banner: 'discovery-failed' }))
  // a local record does not override an unknown scan
  assert.deepEqual(landing(input('connected', { kind: 'failed' }, true)), route('start', { banner: 'discovery-failed' }))
})

test('S0: connected, no vaults lands on S1', () => {
  assert.deepEqual(landing(input('connected', found(null))), route('start'))
})

test('S0: onboarding started but not finished lands on S4 (chain state or local record)', () => {
  assert.deepEqual(landing(input('connected', found('onboarding'))), route('progress'))
  assert.deepEqual(landing(input('connected', found(null), true)), route('progress'))
  // start over: the old vault is closed but a new creation is recorded locally
  assert.deepEqual(landing(input('connected', found('closed'), true)), route('progress'))
})

test('S0: active position lands on S5', () => {
  assert.deepEqual(landing(input('connected', found('active'))), route('position', { variant: 'active' }))
})

test('S0: closed position only lands on S5 closed variant', () => {
  assert.deepEqual(landing(input('connected', found('closed'))), route('position', { variant: 'closed' }))
})

test('S0: liquidated lands on S5 liquidated variant, ahead of any local record', () => {
  assert.deepEqual(landing(input('connected', found('liquidated'))), route('position', { variant: 'liquidated' }))
  assert.deepEqual(landing(input('connected', found('liquidated'), true)), route('position', { variant: 'liquidated' }))
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
  assert.deepEqual(guard('position', input('connected', found('onboarding'))), route('start'))
  assert.deepEqual(guard('position', input('connected', { kind: 'failed' })), route('start', { banner: 'discovery-failed' }))
})

test('guard: #position with a position stays, carrying the variant', () => {
  assert.deepEqual(guard('position', input('connected', found('active'))), route('position', { variant: 'active' }))
  assert.deepEqual(guard('position', input('connected', found('closed'))), route('position', { variant: 'closed' }))
  assert.deepEqual(guard('position', input('connected', found('liquidated'))), route('position', { variant: 'liquidated' }))
})

test('guard: #progress needs an onboarding record or a half-set-up vault', () => {
  assert.deepEqual(guard('progress', input('disconnected', { kind: 'not-checked' })), route('start'))
  assert.deepEqual(guard('progress', input('connected', found(null))), route('start'))
  assert.deepEqual(guard('progress', input('connected', found('active'))), route('start'))
  assert.deepEqual(guard('progress', input('connected', found('onboarding'))), route('progress'))
  assert.deepEqual(guard('progress', input('connected', found(null), true)), route('progress'))
})

test('guard: #start with an active or liquidated position goes to #position; closed stays for Start over', () => {
  assert.deepEqual(guard('start', input('connected', found('active'))), route('position', { variant: 'active' }))
  assert.deepEqual(guard('start', input('connected', found('liquidated'))), route('position', { variant: 'liquidated' }))
  assert.deepEqual(guard('start', input('connected', found('closed'))), route('start'))
  assert.deepEqual(guard('start', input('connected', found('onboarding'))), route('start'))
})

test('guard: S1–S3 stay reachable while waiting; S4/S5 wait', () => {
  for (const r of ['start', 'settings', 'connect']) assert.deepEqual(guard(r, input('connected', { kind: 'checking' })), route(r))
  for (const r of ['position', 'progress']) assert.deepEqual(guard(r, input('connecting', { kind: 'not-checked' })), WAIT)
})

test('guard: settings and connect are never redirected', () => {
  for (const r of ['settings', 'connect']) {
    for (const d of [{ kind: 'failed' }, found('active'), found(null)]) assert.deepEqual(guard(r, input('connected', d)), route(r))
  }
})
