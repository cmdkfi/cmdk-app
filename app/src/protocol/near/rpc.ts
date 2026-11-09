// NEAR JSON-RPC reads. Request shapes follow cmdkfi/app at 47fd4fb: `call_function` with finality "final" and
// base64 JSON args (scripts/relayer.py l.162-163), `view_account` (scripts/reproduce-hash.sh l.114-125);
// `view_access_key_list` follows the NEAR RPC documentation (the protocol repo only uses `view_access_key`).

export class NearRpcError extends Error {
  readonly retryable: boolean
  readonly retryAt?: number
  constructor(message: string, retryable: boolean, retryAt?: number) {
    super(message)
    this.retryable = retryable
    this.retryAt = retryAt
  }
}

type Fetch = typeof fetch
const TIMEOUT_MS = 12_000
const DEFAULT_COOLDOWN_MS = 60_000
const inflight = new Map<string, Promise<unknown>>()
const cooldown = new Map<string, number>()

/** One NEAR `query` call: 12 s timeout, identical in-flight requests shared, 429 honoured per RPC URL. */
async function query<T>(rpcUrl: string, params: Record<string, unknown>, fetcher: Fetch): Promise<T> {
  const until = cooldown.get(rpcUrl)
  if (until && until > Date.now()) throw new NearRpcError(`NEAR RPC is rate limited. Retry after ${new Date(until).toISOString()}.`, true, until)
  const key = `${rpcUrl}\n${JSON.stringify(params)}`
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>
  const task = (async () => {
    let response: Response
    try {
      response = await fetcher(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'cmdk', method: 'query', params }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new NearRpcError('NEAR RPC did not answer.', true)
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get('Retry-After'))
      const at = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_COOLDOWN_MS)
      cooldown.set(rpcUrl, at)
      throw new NearRpcError(`NEAR RPC is rate limited. Retry after ${new Date(at).toISOString()}.`, true, at)
    }
    if (!response.ok) throw new NearRpcError(`NEAR RPC answered HTTP ${response.status}.`, response.status >= 500)
    const body = await response.json() as { error?: unknown; result?: { error?: unknown } & Record<string, unknown> }
    if (body.error) throw new NearRpcError(`NEAR RPC error: ${JSON.stringify(body.error).slice(0, 300)}`, false)
    if (!body.result) throw new NearRpcError('NEAR RPC returned no result.', true)
    if (body.result.error) throw new NearRpcError(`NEAR RPC error: ${String(body.result.error).slice(0, 300)}`, false)
    return body.result as T
  })()
  inflight.set(key, task)
  try {
    return await task
  } finally {
    inflight.delete(key)
  }
}

const base64Json = (value: unknown) => btoa(JSON.stringify(value))

/** View method call, decoded as JSON. Mirrors scripts/relayer.py `near_view` (l.162-163). */
export async function viewFunction<T>(rpcUrl: string, account: string, method: string, args: Record<string, unknown> = {}, fetcher: Fetch = fetch): Promise<T> {
  const result = await query<{ result?: number[] }>(rpcUrl, {
    request_type: 'call_function', finality: 'final', account_id: account, method_name: method, args_base64: base64Json(args),
  }, fetcher)
  if (!Array.isArray(result.result)) throw new NearRpcError(`${account}.${method} returned no value.`, false)
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))) as T
}

export type NearAccount = { code_hash: string; global_contract_hash?: string; global_contract_account_id?: string; amount?: string }

/** Account view; a global-contract account reports `global_contract_hash` (scripts/reproduce-hash.sh l.122-125). */
export function viewAccount(rpcUrl: string, account: string, fetcher: Fetch = fetch): Promise<NearAccount> {
  return query<NearAccount>(rpcUrl, { request_type: 'view_account', finality: 'final', account_id: account }, fetcher)
}

export type AccessKey = {
  public_key: string
  access_key: { nonce?: number; permission: 'FullAccess' | { FunctionCall: { receiver_id: string; method_names: string[]; allowance: string | null } } }
}

/** All access keys of an account (NEAR RPC `view_access_key_list`). */
export async function viewAccessKeyList(rpcUrl: string, account: string, fetcher: Fetch = fetch): Promise<AccessKey[]> {
  const result = await query<{ keys?: AccessKey[] }>(rpcUrl, { request_type: 'view_access_key_list', finality: 'final', account_id: account }, fetcher)
  if (!Array.isArray(result.keys)) throw new NearRpcError('NEAR access-key list is unavailable.', true)
  return result.keys
}
