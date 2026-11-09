// The agent verification panel (PRD §6): row statuses from the adapter's facts. Pure.
// "Checked" only for a positive result obtained in this session; a failed fetch is "Unavailable", never a guess;
// a check with nothing to compare yet (no approval, no agent key, no vault) is "Not checked"; static rows are
// statements, never "Checked".
import type { Fetched, VerificationFacts } from '../adapters/types.ts'

export type RowStatus = 'Checked' | 'Mismatch' | 'Unavailable' | 'Not checked'
export type RowId = 'measurement' | 'compose' | 'registration' | 'keys' | 'code' | 'relayer' | 'unchecked'
export type VerificationRow = { id: RowId; status: RowStatus; result: string; checkedAt: number | null; registrationTx?: string | null; sourceCommit?: string | null }

export const ROW_ORDER: RowId[] = ['measurement', 'compose', 'registration', 'keys', 'code', 'relayer', 'unchecked']

const unavailable = (f: Extract<Fetched<unknown>, { ok: false }>, id: RowId): VerificationRow => ({ id, status: 'Unavailable', result: `Could not be read: ${f.error}`, checkedAt: f.at })

/** Static rows (PRD §6 rows 6 and 7): statements with links, not live checks. */
const STATIC: VerificationRow[] = [
  { id: 'relayer', status: 'Not checked', checkedAt: null, result: 'Statement, not a live check: the relayer holds no authority. It cannot make the vault sign anything; the vault checks the owner\'s signature and its allowlist and builds every Base transaction itself (scripts/RELAYER.md).' },
  { id: 'unchecked', status: 'Not checked', checkedAt: null, result: 'The TDX quote signature, the PCCS collateral and the RTMR replay are not checked here: they need Docker and dstack-mr (agent/MEASUREMENT.md).' },
]

/** Without facts: no vault yet (Not checked), the first read still running (Not checked, "Checking…"), or the whole read failed (Unavailable). */
export type Waiting = { kind: 'no-vault' } | { kind: 'pending' } | { kind: 'failed'; error: string; at: number }

export function verificationRows(facts: VerificationFacts | null, nowSecs: number, waiting: Waiting = { kind: 'no-vault' }): VerificationRow[] {
  if (!facts) {
    const live = (['measurement', 'compose', 'registration', 'keys', 'code'] as RowId[]).map((id): VerificationRow => waiting.kind === 'failed'
      ? { id, status: 'Unavailable', result: `Could not be read: ${waiting.error}`, checkedAt: waiting.at }
      : { id, status: 'Not checked', result: waiting.kind === 'pending' ? 'Checking…' : 'Starts after your vault exists.', checkedAt: null })
    return [...live, ...STATIC]
  }
  const rows: VerificationRow[] = []

  const m = facts.measurement
  if (!m.ok) rows.push(unavailable(m, 'measurement'))
  else if (m.value.matches === null) rows.push({ id: 'measurement', status: 'Not checked', result: 'Your vault has not approved an agent version yet; the setup step does that.', checkedAt: m.at, sourceCommit: m.value.sourceCommit })
  else rows.push({
    id: 'measurement', checkedAt: m.at, sourceCommit: m.value.sourceCommit,
    status: m.value.matches ? 'Checked' : 'Mismatch',
    result: m.value.matches ? `Your vault approved exactly the six values published in the manifest${m.value.version ? ` (agent ${m.value.version})` : ''}.` : 'The values your vault approved differ from the published manifest.',
  })

  const c = facts.compose
  if (!c.ok) rows.push(unavailable(c, 'compose'))
  else if (c.value.matchesApproved === null) rows.push({ id: 'compose', status: 'Not checked', result: 'Your vault has not approved a compose hash yet; the setup step does that.', checkedAt: c.at })
  else if (c.value.matchesApproved && c.value.matchesIndex === true) rows.push({ id: 'compose', status: 'Checked', result: `SHA-256 of app-compose.json (${c.value.sha256.slice(0, 12)}…) equals your vault's approved compose hash and the agent's index entry.`, checkedAt: c.at })
  else rows.push({
    id: 'compose', status: 'Mismatch', checkedAt: c.at,
    result: !c.value.matchesApproved ? 'SHA-256 of the served app-compose.json differs from the compose hash your vault approved.' : c.value.matchesIndex === null ? 'The agent\'s evidence index lists no app-compose.json.' : 'The agent\'s evidence index gives a different SHA-256 for app-compose.json than its bytes.',
  })

  const r = facts.registration
  if (!r.ok) rows.push(unavailable(r, 'registration'))
  // register_agent needs an approved measurement (vault/src/attest.rs): before setup there is nothing to register yet
  else if (r.value === null && m.ok && m.value.matches === null) rows.push({ id: 'registration', status: 'Not checked', result: 'Waits for the setup step: the agent registers once your vault approves its version.', checkedAt: r.at })
  else if (r.value === null || r.value.registration === 'registering') rows.push({ id: 'registration', status: 'Not checked', result: 'Registering (usually a few minutes).', checkedAt: r.at })
  else if (r.value.registration === 'registered' && r.value.agentStatus === 'active' && r.value.expiresAt !== null && r.value.expiresAt > nowSecs) {
    rows.push({ id: 'registration', status: 'Checked', result: `Registered and active on your vault until ${new Date(r.value.expiresAt * 1000).toLocaleString()}.`, checkedAt: r.at, registrationTx: r.value.registrationTx })
  } else rows.push({ id: 'registration', status: 'Mismatch', result: `${r.value.registration}${r.value.agentStatus ? ` · ${r.value.agentStatus}` : ''}${r.value.expiresAt !== null && r.value.expiresAt <= nowSecs ? ' · registration expired' : ''}`, checkedAt: r.at, registrationTx: r.value.registrationTx })

  const k = facts.keys
  if (!k.ok) rows.push(unavailable(k, 'keys'))
  else if (k.value.limited === null) rows.push({ id: 'keys', status: 'Not checked', result: 'Your vault records no agent key yet; registration adds it.', checkedAt: k.at })
  else rows.push({
    id: 'keys', checkedAt: k.at, status: k.value.limited ? 'Checked' : 'Mismatch',
    result: k.value.limited ? 'Exactly one key: a function-call key for reduce, migrate and exit, and it is the agent key your vault records.' : `The vault's ${k.value.count} access key(s) are not exactly the restricted agent key.`,
  })

  const code = facts.code
  if (!code.ok) rows.push(unavailable(code, 'code'))
  else rows.push({ id: 'code', checkedAt: code.at, status: code.value.matches ? 'Checked' : 'Mismatch', result: code.value.matches ? 'The vault runs the factory\'s code (same code hash).' : 'The vault\'s code hash differs from the factory\'s.' })

  return [...rows, ...STATIC]
}
