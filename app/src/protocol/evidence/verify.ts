// The five agent-verification checks of PRD §6, written from cmdkfi/app at 47fd4fb. Each returns a plain result;
// the UI decides the wording ("Checked" only for a positive result in this session).
import type { AccessKey, NearAccount } from '../near/rpc.ts'
import { MEASUREMENT_KEYS, type Measurement } from '../near/vault.ts'
import type { AgentVaultRow } from '../relayer/client.ts'

/** Row 1: the vault approved exactly the published measurement (six fields, vault/src/attest.rs l.15-22). */
export function measurementMatches(approved: unknown, published: Measurement | null | undefined): boolean {
  if (!approved || typeof approved !== 'object' || !published) return false
  const a = approved as Record<string, unknown>
  return MEASUREMENT_KEYS.every(key => typeof a[key] === 'string' && a[key] === published[key])
}

export type PublishedManifest = { measurement: Measurement; sourceCommit: string | null; version: string | null }

/** The published `agent` block of deployments/testnet.json (fetched at run time from raw GitHub, PRD §6 row 1). */
export async function fetchPublishedManifest(url: string, fetcher: typeof fetch = fetch): Promise<PublishedManifest> {
  const response = await fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(`The published manifest is unavailable (HTTP ${response.status}).`)
  const manifest = await response.json() as { agent?: { measurement?: Record<string, unknown>; sourceCommit?: string; version?: string } }
  const m = manifest.agent?.measurement
  if (!m || !MEASUREMENT_KEYS.every(key => typeof m[key] === 'string' && /^[0-9a-f]+$/.test(m[key] as string))) throw new Error('The published manifest has no agent measurement.')
  return { measurement: Object.fromEntries(MEASUREMENT_KEYS.map(key => [key, m[key]])) as Measurement, sourceCommit: manifest.agent?.sourceCommit ?? null, version: manifest.agent?.version ?? null }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Row 2: `sha256sum app-compose.json` equals the compose hash (agent/MEASUREMENT.md l.99). */
export async function composeHashMatches(appCompose: Uint8Array, composeHash: string): Promise<boolean> {
  return (await sha256Hex(appCompose)) === composeHash.toLowerCase()
}

/** Row 3: the agent's own row for this vault on `/agent/vaults` (agent/src/main.rs l.1033-1034). */
export function agentRow(rows: AgentVaultRow[], vaultId: string): AgentVaultRow | null {
  return rows.find(row => row.vault === vaultId) ?? null
}

/** Row 3 result: registered and active on this vault, with an expiry in the future. */
export function agentRegistered(row: AgentVaultRow | null, nowSecs: number): boolean {
  return !!row && row.registration === 'registered' && row.agent_status === 'active' && typeof row.expires_at === 'number' && row.expires_at > nowSecs
}

const AGENT_METHODS = ['reduce', 'migrate', 'exit']

/**
 * Row 4: exactly one key on the vault, a function-call key for the vault itself, with exactly the methods
 * `reduce,migrate,exit` (vault/src/lib.rs l.46 AGENT_METHODS, l.498-503 `add_access_key_allowance`), and it is the
 * agent key the vault records.
 */
export function agentKeyLimited(keys: AccessKey[], vaultId: string, agentPublicKey: string | null | undefined): boolean {
  if (keys.length !== 1 || !agentPublicKey) return false
  const [key] = keys
  const p = key.access_key.permission
  if (p === 'FullAccess' || !p.FunctionCall) return false
  const methods = p.FunctionCall.method_names
  return key.public_key === agentPublicKey && p.FunctionCall.receiver_id === vaultId
    && methods.length === AGENT_METHODS.length && AGENT_METHODS.every(method => methods.includes(method))
}

/**
 * Row 5: the vault runs the factory's code. Vaults use a global contract (vault/factory/src/lib.rs l.152), so the
 * account reports `global_contract_hash`; `code_hash` is the fallback (scripts/reproduce-hash.sh l.122-125).
 */
export function codeMatchesFactory(account: NearAccount, factoryCodeHash: string): boolean {
  return !!factoryCodeHash && (account.global_contract_hash ?? account.code_hash) === factoryCodeHash
}
