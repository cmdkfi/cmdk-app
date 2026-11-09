import { isAddress } from 'viem'
import type { AppConfig } from './near.ts'
import { assessRelayer, readRelayerHealth } from './relayer.ts'

export type CreateStage = 'accepted' | 'vault_created' | 'float_sent' | 'done' | 'failed'
export type CreateJob = {
  ok: boolean
  job: string
  kind: 'create_vault'
  stage: CreateStage
  vault?: string
  base_address?: string
  near_tx?: string
  float?: { tx?: string; receipt?: { status?: number } }
  error?: string
  http_status?: number
}

export class CreateVaultError extends Error {
  readonly retryAfter?: number
  readonly uncertain: boolean
  constructor(message: string, retryAfter?: number, uncertain = false) {
    super(message)
    this.retryAfter = retryAfter
    this.uncertain = uncertain
  }
}

async function errorText(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null)
  return typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
    ? body.error : `Relayer returned HTTP ${response.status}.`
}

export async function startCreateVault(config: AppConfig, owner: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!isAddress(owner)) throw new CreateVaultError('Connect a valid owner wallet first.')
  if (!config.near.factory || !config.createVault || config.createVault.markets.length === 0) {
    throw new CreateVaultError('Vault creation is waiting for the published deployment manifest.')
  }
  const health = await readRelayerHealth(config, fetcher)
  const readiness = assessRelayer(config, health)
  if (readiness.kind !== 'ready') throw new CreateVaultError(readiness.message)
  const body = {
    owner,
    policy: { cooldown_secs: config.createVault.cooldownSecs, markets: config.createVault.markets },
    deposit_near: config.createVault.depositNear,
  }
  let response: Response
  try {
    // Never retry a POST on a second endpoint: the first request may have been accepted.
    response = await fetcher(`${config.relayerUrl}/create-vault`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new CreateVaultError('The relayer did not confirm whether creation started. Check your vaults before trying again.', undefined, true)
  }
  if (response.status !== 202) {
    const message = await errorText(response)
    const retryAfter = response.status === 429 ? Number(response.headers.get('Retry-After')) : undefined
    throw new CreateVaultError(message, Number.isFinite(retryAfter) && retryAfter! > 0 ? retryAfter : undefined)
  }
  let result: unknown
  try { result = await response.json() } catch {
    throw new CreateVaultError('Creation may have started, but its job ID was unreadable. Check your vaults before trying again.', undefined, true)
  }
  const job = (result as { ok?: unknown; job?: unknown } | null)?.job
  if ((result as { ok?: unknown } | null)?.ok !== true || typeof job !== 'string' || !/^[0-9a-f]{16}$/.test(job)) {
    throw new CreateVaultError('Creation may have started, but the relayer did not return a valid job ID. Check your vaults before trying again.', undefined, true)
  }
  return job
}

export async function readCreateJob(config: AppConfig, job: string, fetcher: typeof fetch = fetch): Promise<CreateJob> {
  if (!/^[0-9a-f]{16}$/.test(job)) throw new CreateVaultError('Invalid create-vault job ID.', undefined, true)
  let response: Response
  try {
    response = await fetcher(`${config.relayerUrl}/job/${job}`, { cache: 'no-store' })
  } catch {
    response = await fetcher(`${config.relayerUrlFallback}/job/${job}`, { cache: 'no-store' })
  }
  if (response.status === 404) throw new CreateVaultError('The relayer lost this job record. Check the factory for your vault before creating another.', undefined, true)
  if (!response.ok) throw new CreateVaultError(await errorText(response), undefined, true)
  const result: unknown = await response.json()
  const value = result as Partial<CreateJob> | null
  if (!value || value.job !== job || value.kind !== 'create_vault' || !['accepted', 'vault_created', 'float_sent', 'done', 'failed'].includes(value.stage ?? '')) {
    throw new CreateVaultError('The relayer returned an unexpected job record.', undefined, true)
  }
  return value as CreateJob
}
