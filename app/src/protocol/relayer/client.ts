// Relayer client (cmdkfi/app 47fd4fb): scripts/RELAYER.md l.57-111 (endpoints, `ok`, status codes, jobs) and the
// public Worker in cloud/src/index.ts (routes l.53-58, create-vault rate limit l.442-458, CORS l.494-501).
// GET may use the fallback URL when the primary does not answer; POST goes to the primary only and is never repeated.

type Fetch = typeof fetch
export type RelayerUrls = { primary: string; fallback: string }

export class RelayerError extends Error {
  readonly status?: number
  /** Seconds, from `Retry-After` (create-vault rate limit, cloud/src/index.ts l.458). */
  readonly retryAfter?: number
  /** The request may have been accepted (lost response, unknown job): never repeat it blindly. */
  readonly uncertain: boolean
  /** Refused before anything was sent (HTTP 400, RELAYER.md l.66). */
  readonly refused: boolean
  constructor(message: string, o: { status?: number; retryAfter?: number; uncertain?: boolean; refused?: boolean } = {}) {
    super(message)
    this.status = o.status
    this.retryAfter = o.retryAfter
    this.uncertain = o.uncertain ?? false
    this.refused = o.refused ?? false
  }
}

const TIMEOUT_MS = 12_000
/**
 * A POST is never repeated, so its answer is worth waiting for: a slow relayer (one answered after more than 12 s
 * during the 9 Nov rehearsal) would otherwise turn an accepted request into an uncertain one (Phase 7b).
 */
export const POST_TIMEOUT_MS = 60_000

async function body(response: Response): Promise<Record<string, unknown>> {
  try { return await response.json() as Record<string, unknown> } catch { return {} }
}

async function get(urls: RelayerUrls, path: string, fetcher: Fetch): Promise<Response> {
  try {
    return await fetcher(`${urls.primary}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    if (!urls.fallback) throw new RelayerError('The relayer did not answer.')
    try {
      return await fetcher(`${urls.fallback}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      throw new RelayerError('Neither relayer URL answered.')
    }
  }
}

/** GET that requires `ok: true` (RELAYER.md l.59). */
async function read<T>(urls: RelayerUrls, path: string, fetcher: Fetch): Promise<T> {
  const response = await get(urls, path, fetcher)
  const value = await body(response)
  if (!response.ok || value.ok !== true) throw new RelayerError(String(value.error ?? `Relayer answered HTTP ${response.status}.`), { status: response.status })
  return value as T
}

/** POST to the primary only; a lost response is uncertain (RELAYER.md l.84-93: the call may run anyway). */
async function post(urls: RelayerUrls, path: string, payload: unknown, fetcher: Fetch): Promise<string> {
  let response: Response
  try {
    response = await fetcher(`${urls.primary}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(POST_TIMEOUT_MS) })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new RelayerError(timedOut ? `The relayer did not answer within ${POST_TIMEOUT_MS / 1000} s; the request may have been accepted.` : 'The relayer did not confirm the request; it may have been accepted.', { uncertain: true })
  }
  const value = await body(response)
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After'))
    throw new RelayerError(String(value.error ?? 'Rate limited.'), { status: 429, retryAfter: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined })
  }
  if (response.status === 400) throw new RelayerError(String(value.error ?? 'Refused.'), { status: 400, refused: true })
  if (response.status !== 202 || value.ok !== true || typeof value.job !== 'string') {
    const text = typeof value.error === 'string' && value.error ? value.error : null
    // 5xx: the request may still have reached the vault; the status is part of the message the step shows (Phase 7b)
    if (response.status >= 500) throw new RelayerError(`The relayer answered HTTP ${response.status}${text ? ` (${text})` : ''}; the request may have been accepted.`, { status: response.status, uncertain: true })
    throw new RelayerError(text ?? `Relayer answered HTTP ${response.status}.`, { status: response.status })
  }
  return value.job
}

export type Health = { ok: boolean; chain_id?: number; near_network?: string; factory?: string | null; factory_exists?: boolean; eth_float_wei?: string; floats_left?: number; error?: string }

/** `GET /health` (RELAYER.md l.78; `factory_exists` added by the proxy, l.46-47). */
export function health(urls: RelayerUrls, fetcher: Fetch = fetch): Promise<Health> {
  return read<Health>(urls, '/health', fetcher)
}

export type Readiness = { kind: 'ready' | 'pending' | 'failed'; message: string }

/** Whether creation can be requested: same chain, network and factory as the app; factory deployed. */
export function assessHealth(h: Health, expect: { chainId: number; nearNetwork: string; factory: string }): Readiness {
  if (!h.ok) return { kind: 'failed', message: h.error || 'The relayer reported an error.' }
  if (h.chain_id !== expect.chainId || h.near_network !== expect.nearNetwork || (h.factory && h.factory !== expect.factory)) return { kind: 'failed', message: 'The relayer serves a different network or factory than this app.' }
  if (h.factory_exists !== true) return { kind: 'pending', message: 'The vault factory is not available yet.' }
  return { kind: 'ready', message: 'The relayer is ready.' }
}

export type Policy = { cooldown_secs: number; markets: { id: string; loan_token: string; collateral_token: string; executor: string; slice_max: string }[] }

/** `POST /create-vault {owner, policy, deposit_near}` (RELAYER.md l.73) → job id. */
export function createVault(urls: RelayerUrls, request: { owner: string; policy: Policy; depositNear: string }, fetcher: Fetch = fetch): Promise<string> {
  return post(urls, '/create-vault', { owner: request.owner, policy: request.policy, deposit_near: request.depositNear }, fetcher)
}

/** `POST /owner-call {vault, message, signature}` (RELAYER.md l.75) → job id. */
export function ownerCall(urls: RelayerUrls, request: { vault: string; message: string; signature: string }, fetcher: Fetch = fetch): Promise<string> {
  return post(urls, '/owner-call', { vault: request.vault, message: request.message, signature: request.signature }, fetcher)
}

export type Job = {
  ok: boolean
  job: string
  kind: 'owner_call' | 'create_vault'
  stage: 'accepted' | 'vault_checked' | 'base_sent' | 'vault_created' | 'float_sent' | 'done' | 'failed'
  times?: Record<string, number>
  vault?: string
  base_address?: string
  near_tx?: string
  base_sent?: string[]
  receipts?: { hash: string; status: number }[]
  error?: string
  http_status?: number
}

const STAGES = ['accepted', 'vault_checked', 'base_sent', 'vault_created', 'float_sent', 'done', 'failed']

/** `GET /job/<id>` (RELAYER.md l.96-111): a failed job is 200 with `ok: false`; 404 means unknown or dropped. */
export async function job(urls: RelayerUrls, id: string, fetcher: Fetch = fetch): Promise<Job> {
  if (!/^[0-9a-f]{16}$/.test(id)) throw new RelayerError('Invalid job id.')
  const response = await get(urls, `/job/${id}`, fetcher)
  const value = await body(response)
  if (response.status === 404) throw new RelayerError('The relayer no longer knows this job.', { status: 404, uncertain: true })
  if (response.status !== 200 || value.job !== id || !STAGES.includes(String(value.stage))) throw new RelayerError('The relayer returned an unexpected job.', { status: response.status, uncertain: true })
  return value as Job
}

export type VaultView = {
  ok: true
  vault: string
  state: Record<string, unknown>
  base: { address: string; eth_wei: string; pending_nonce: number; tokens: Record<string, string>; markets: { id: string; executor: string; morpho_authorized: boolean; loan_allowance: string; collateral_allowance: string; corridor: unknown; position: Record<string, string> }[] }
}

/** `GET /vault/<id>` (RELAYER.md l.74; scripts/relayer.py l.1095-1117). */
export function vaultView(urls: RelayerUrls, vault: string, fetcher: Fetch = fetch): Promise<VaultView> {
  return read<VaultView>(urls, `/vault/${encodeURIComponent(vault)}`, fetcher)
}

export type AgentVaultRow = {
  slot?: number; tag?: string; vault: string; base_address?: string
  registration?: string; registration_tx?: string; agent_status?: string; expires_at?: number; last_tick_unix?: number | null
}

/** `GET /agent/vaults` (cloud/src/index.ts l.24, l.58; row fields agent/src/main.rs l.1033-1034, vaults.rs l.213-224). */
export async function agentVaults(urls: RelayerUrls, fetcher: Fetch = fetch): Promise<AgentVaultRow[]> {
  const response = await get(urls, '/agent/vaults', fetcher)
  const value = await body(response) as { vaults?: AgentVaultRow[] }
  if (!response.ok || !Array.isArray(value.vaults)) throw new RelayerError('The agent vault list is unavailable.', { status: response.status })
  return value.vaults
}

export type EvidenceIndex = { boot: string; files: { name: string; bytes: number; sha256: string; path?: string }[] }

/** `GET /agent/` (cloud/src/index.ts l.24; agent/src/serve.rs l.105-114). */
export async function agentIndex(urls: RelayerUrls, fetcher: Fetch = fetch): Promise<EvidenceIndex> {
  const response = await get(urls, '/agent/', fetcher)
  const value = await body(response) as Partial<EvidenceIndex>
  if (!response.ok || typeof value.boot !== 'string' || !Array.isArray(value.files)) throw new RelayerError('The agent evidence index is unavailable.', { status: response.status })
  return value as EvidenceIndex
}

/** `GET /agent/evidence/<name>` (cloud/src/index.ts l.27, l.74; serve.rs l.142) as raw bytes. */
export async function agentEvidence(urls: RelayerUrls, name: string, fetcher: Fetch = fetch): Promise<Uint8Array> {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new RelayerError('Invalid evidence file name.')
  const response = await get(urls, `/agent/evidence/${name}`, fetcher)
  if (!response.ok) throw new RelayerError(`Evidence file ${name} is unavailable.`, { status: response.status })
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * The relayer's gas refusal (scripts/relayer.py l.814-819 `check_funds`: "the vault Base address holds %d wei, below
 * the %d wei the transactions may cost"; its estimate leaves out the L1 fee). Null for any other error.
 */
export function fundsShortfall(error: string | undefined): { have: bigint; need: bigint } | null {
  const m = /holds (\d+) wei, below the (\d+) wei/.exec(error ?? '')
  return m ? { have: BigInt(m[1]), need: BigInt(m[2]) } : null
}

