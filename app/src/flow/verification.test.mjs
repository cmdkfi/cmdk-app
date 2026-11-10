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
  assert.deepEqual(status(rows), { measurement: 'Checked', compose: 'Checked', registration: 'Checked', keys: 'Checked', code: 'Checked', relayer: 'Statement', unchecked: 'Statement' })
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
    ['registration', f => { f.registration = ok({ registration: 'registered', agentStatus: 'revoked (another key registered)', expiresAt: NOW + 1, registrationTx: null }) }],
    ['registration', f => { f.keys = ok({ limited: null, count: 0 }); f.registration = ok({ registration: 'registered', agentStatus: 'revoked', expiresAt: NOW + 1, registrationTx: null }) }],
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
  assert.ok(verificationRows(null, NOW).every(r => r.status === (r.id === 'relayer' || r.id === 'unchecked' ? 'Statement' : 'Not checked')))
  const facts = allGood()
  facts.measurement = ok({ matches: null, sourceCommit: 'abc', version: null })
  facts.compose = ok({ matchesApproved: null, matchesIndex: true, sha256: '00' })
  facts.registration = ok(null)
  facts.keys = ok({ limited: null, count: 0 })
  const rows = verificationRows(facts, NOW)
  assert.deepEqual(status(rows), { measurement: 'Not checked', compose: 'Not checked', registration: 'Not checked', keys: 'Not checked', code: 'Checked', relayer: 'Statement', unchecked: 'Statement' })
  assert.equal(rows.find(r => r.id === 'registration').result, 'Waits for the setup step: the agent registers once your vault approves its version.')
  facts.measurement = ok({ matches: true, sourceCommit: 'abc', version: null }) // approved, no row yet: the agent is registering
  assert.equal(verificationRows(facts, NOW).find(r => r.id === 'registration').result, 'Registering (usually within a few minutes).')
  facts.registration = ok({ registration: 'registering', agentStatus: null, expiresAt: null, registrationTx: null })
  assert.equal(verificationRows(facts, NOW).find(r => r.id === 'registration').result, 'Registering (usually within a few minutes).')
})

test('§6 static rows are statements; nothing-to-compare and failed rows keep the time of the attempt (Phase 7b)', () => {
  const rows = verificationRows(allGood(), NOW)
  for (const id of ['relayer', 'unchecked']) {
    const row = rows.find(r => r.id === id)
    assert.deepEqual([row.status, row.checkedAt], ['Statement', null])
  }
})

test('§6 registration row: a list behind the chain is Not checked "has not caught up", never Mismatch; no registration_tx is said (Phase 7b)', () => {
  // the 9 Nov live row: {registration:"registering", agent_status:"revoked"} while the vault already held the agent key
  for (const [registration, agentStatus] of [['registering', 'revoked'], ['registered', 'revoked'], ['registered', 'revoked (registration expired)']]) {
    const facts = allGood(); facts.registration = ok({ registration, agentStatus, expiresAt: NOW + 3600, registrationTx: null })
    const row = verificationRows(facts, NOW).find(r => r.id === 'registration')
    assert.equal(row.status, 'Not checked', `${registration} · ${agentStatus}`)
    assert.match(row.result, /has not caught up yet/)
  }
  // under a stale approval the old key is not the running agent's: no "caught up" wording (Phase 7b)
  const stale = allGood(); stale.measurement = ok({ matches: false, sourceCommit: 'x', version: null }); stale.registration = ok(null)
  assert.equal(verificationRows(stale, NOW).find(r => r.id === 'registration').result, 'The running agent does not watch your vault: it approved an earlier agent version (see the first row).')
  const noKey = allGood(); noKey.keys = ok({ limited: null, count: 0 }); noKey.registration = ok({ registration: 'registering', agentStatus: 'revoked', expiresAt: null, registrationTx: null })
  assert.equal(verificationRows(noKey, NOW).find(r => r.id === 'registration').result, 'Registering (usually within a few minutes).')
  const noTx = allGood(); noTx.registration = ok({ registration: 'registered', agentStatus: 'active', expiresAt: NOW + 3600, registrationTx: null })
  const row = verificationRows(noTx, NOW).find(r => r.id === 'registration')
  assert.equal(row.status, 'Checked')
  assert.match(row.result, /gives no registration transaction for it; your vault's access keys on NearBlocks show the agent key\.$/)
})

test('§6 without facts: no vault → Not checked; first read running → Not checked "Checking…"; whole read failed → Unavailable', () => {
  const live = rows => rows.filter(r => r.id !== 'relayer' && r.id !== 'unchecked')
  assert.ok(live(verificationRows(null, NOW, { kind: 'no-vault' })).every(r => r.status === 'Not checked' && r.result === 'Starts after your vault exists.'))
  assert.ok(live(verificationRows(null, NOW, { kind: 'pending' })).every(r => r.status === 'Not checked' && r.result === 'Checking…'))
  assert.ok(live(verificationRows(null, NOW, { kind: 'failed', error: 'offline', at: 5 })).every(r => r.status === 'Unavailable' && r.checkedAt === 5))
})
