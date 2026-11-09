import test from 'node:test'
import assert from 'node:assert/strict'
import { ROW_ORDER, verificationRows } from './verification.ts'

const NOW = 2_000_000_000
const ok = value => ({ ok: true, at: 1_000, value })
const failed = error => ({ ok: false, at: 2_000, error })
const allGood = () => ({
  vaultId: 'v10.f.testnet',
  measurement: ok({ matches: true, sourceCommit: 'abc1234', version: '0.1.0' }),
  compose: ok({ matchesApproved: true, matchesIndex: true, sha256: 'ef'.repeat(32) }),
  registration: ok({ registration: 'registered', agentStatus: 'active', expiresAt: NOW + 3600, registrationTx: 'TX' }),
  keys: ok({ limited: true, count: 1 }),
  code: ok({ matches: true }),
})
const status = rows => Object.fromEntries(rows.map(r => [r.id, r.status]))

test('§6 match: every live row Checked with its check time; the two static rows are never Checked', () => {
  const rows = verificationRows(allGood(), NOW)
  assert.deepEqual(rows.map(r => r.id), ROW_ORDER)
  assert.deepEqual(status(rows), { measurement: 'Checked', compose: 'Checked', registration: 'Checked', keys: 'Checked', code: 'Checked', relayer: 'Not checked', unchecked: 'Not checked' })
  assert.ok(rows.slice(0, 5).every(r => r.checkedAt === 1_000))
  assert.equal(rows[0].sourceCommit, 'abc1234')
  assert.equal(rows[2].registrationTx, 'TX')
})

test('§6 mismatch: each failed comparison is Mismatch on its own row only', () => {
  const cases = [
    ['measurement', f => { f.measurement = ok({ matches: false, sourceCommit: 'x', version: null }) }],
    ['compose', f => { f.compose = ok({ matchesApproved: false, matchesIndex: true, sha256: '00' }) }],
    ['compose', f => { f.compose = ok({ matchesApproved: true, matchesIndex: false, sha256: '00' }) }],
    ['compose', f => { f.compose = ok({ matchesApproved: true, matchesIndex: null, sha256: '00' }) }],
    ['registration', f => { f.registration = ok({ registration: 'registered', agentStatus: 'revoked', expiresAt: NOW + 1, registrationTx: null }) }],
    ['registration', f => { f.registration = ok({ registration: 'registered', agentStatus: 'active', expiresAt: NOW, registrationTx: null }) }],
    ['registration', f => { f.registration = ok({ registration: 'registration failed (gave up for this boot)', agentStatus: null, expiresAt: null, registrationTx: null }) }],
    ['keys', f => { f.keys = ok({ limited: false, count: 2 }) }],
    ['code', f => { f.code = ok({ matches: false }) }],
  ]
  for (const [id, mutate] of cases) {
    const facts = allGood(); mutate(facts)
    const s = status(verificationRows(facts, NOW))
    assert.equal(s[id], 'Mismatch', id)
    assert.equal(Object.values(s).filter(v => v === 'Mismatch').length, 1, `${id}: only one row`)
  }
})

test('§6 unavailable: a failed fetch is Unavailable on that row only, with the error and the time of the attempt', () => {
  for (const id of ['measurement', 'compose', 'registration', 'keys', 'code']) {
    const facts = allGood(); facts[id] = failed('HTTP 503')
    const rows = verificationRows(facts, NOW)
    const row = rows.find(r => r.id === id)
    assert.deepEqual([row.status, row.result, row.checkedAt], ['Unavailable', 'Could not be read: HTTP 503', 2_000])
    assert.equal(rows.filter(r => r.status === 'Unavailable').length, 1)
  }
})

test('§6 not checked: no vault yet, no approval yet, registering, no agent key yet', () => {
  assert.ok(verificationRows(null, NOW).every(r => r.status === 'Not checked'))
  const facts = allGood()
  facts.measurement = ok({ matches: null, sourceCommit: 'abc', version: null })
  facts.compose = ok({ matchesApproved: null, matchesIndex: true, sha256: '00' })
  facts.registration = ok(null)
  facts.keys = ok({ limited: null, count: 0 })
  const rows = verificationRows(facts, NOW)
  assert.deepEqual(status(rows), { measurement: 'Not checked', compose: 'Not checked', registration: 'Not checked', keys: 'Not checked', code: 'Checked', relayer: 'Not checked', unchecked: 'Not checked' })
  assert.equal(rows.find(r => r.id === 'registration').result, 'Waits for the setup step: the agent registers once your vault approves its version.')
  facts.measurement = ok({ matches: true, sourceCommit: 'abc', version: null }) // approved, no row yet: the agent is registering
  assert.equal(verificationRows(facts, NOW).find(r => r.id === 'registration').result, 'Registering (usually a few minutes).')
  facts.registration = ok({ registration: 'registering', agentStatus: null, expiresAt: null, registrationTx: null })
  assert.equal(verificationRows(facts, NOW).find(r => r.id === 'registration').result, 'Registering (usually a few minutes).')
})

test('§6 without facts: no vault → Not checked; first read running → Not checked "Checking…"; whole read failed → Unavailable', () => {
  const live = rows => rows.filter(r => r.id !== 'relayer' && r.id !== 'unchecked')
  assert.ok(live(verificationRows(null, NOW, { kind: 'no-vault' })).every(r => r.status === 'Not checked' && r.result === 'Starts after your vault exists.'))
  assert.ok(live(verificationRows(null, NOW, { kind: 'pending' })).every(r => r.status === 'Not checked' && r.result === 'Checking…'))
  assert.ok(live(verificationRows(null, NOW, { kind: 'failed', error: 'offline', at: 5 })).every(r => r.status === 'Unavailable' && r.checkedAt === 5))
})
