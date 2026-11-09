// Vault and factory views on NEAR (cmdkfi/app 47fd4fb).
import { NearRpcError, viewFunction } from './rpc.ts'

type Fetch = typeof fetch

/** Measurement field order of vault/src/attest.rs l.15-22. */
export const MEASUREMENT_KEYS = ['mrtd', 'rtmr0', 'rtmr1', 'rtmr2', 'compose_hash', 'os_image_hash'] as const
export type Measurement = Record<(typeof MEASUREMENT_KEYS)[number], string>

export type VaultMarket = {
  id: `0x${string}`
  loan_token: `0x${string}`
  collateral_token: `0x${string}`
  executor: `0x${string}`
  previous_executors: string[]
  slice_max: string
  corridor_set: boolean
}

export type VaultState = {
  owner: `0x${string}`
  owner_nonce: number
  signer: string
  path: string
  base_address: `0x${string}`
  morpho: `0x${string}`
  cooldown_secs: number
  last_agent_action: number
  markets: VaultMarket[]
  approved: Measurement | null
  agent: { public_key: string; expires_at: number } | null
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const ID = /^0x[0-9a-fA-F]{64}$/

/** `get_state` view. Mirrors vault/src/lib.rs l.539-557 (field names and shapes). */
export async function getState(rpcUrl: string, vault: string, fetcher: Fetch = fetch): Promise<VaultState> {
  const s = await viewFunction<Partial<VaultState>>(rpcUrl, vault, 'get_state', {}, fetcher)
  const markets = Array.isArray(s.markets) ? s.markets : null
  if (typeof s.owner !== 'string' || !ADDRESS.test(s.owner) || !Number.isSafeInteger(s.owner_nonce) || typeof s.base_address !== 'string' || !ADDRESS.test(s.base_address)
    || typeof s.morpho !== 'string' || !ADDRESS.test(s.morpho) || !markets
    || markets.some(m => !ID.test(m?.id ?? '') || !ADDRESS.test(m?.executor ?? '') || !ADDRESS.test(m?.loan_token ?? '') || !ADDRESS.test(m?.collateral_token ?? '') || typeof m?.corridor_set !== 'boolean')) {
    throw new NearRpcError(`${vault} returned an incomplete get_state.`, false)
  }
  return s as VaultState
}

export type FactoryConfig = { code_hash: string; signer: string; path: string; morpho: string; count: number }

/** Factory `get_config`. Mirrors vault/factory/src/lib.rs l.52-60 (Config) and l.156. */
export async function getFactoryConfig(rpcUrl: string, factory: string, fetcher: Fetch = fetch): Promise<FactoryConfig> {
  const c = await viewFunction<Partial<FactoryConfig>>(rpcUrl, factory, 'get_config', {}, fetcher)
  if (!Number.isSafeInteger(c.count) || (c.count as number) < 0 || typeof c.code_hash !== 'string') throw new NearRpcError('The factory returned an invalid config.', false)
  return c as FactoryConfig
}

/** Vault account of number n. Mirrors vault/factory/src/lib.rs l.167-168 (`v{n}.{factory}`). */
export function vaultId(factory: string, n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('Vault numbers start at 1.')
  return `v${n}.${factory}`
}

export type OwnedVault = { accountId: string; number: number; state: VaultState }

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function readState(rpcUrl: string, account: string, fetcher: Fetch): Promise<VaultState> {
  try {
    return await getState(rpcUrl, account, fetcher)
  } catch (error) {
    // One retry for a transient failure; a rate limit is never retried here.
    if (!(error instanceof NearRpcError) || !error.retryable || error.retryAt) throw error
    await pause(250)
    return getState(rpcUrl, account, fetcher)
  }
}

/**
 * The owner's newest vault numbered from `firstVaultNumber` (PRD D4, R8): scans v<count> down to v<first>, two at a
 * time, and stops at the first vault the owner holds. Any account above it that cannot be read makes the answer
 * unknown and throws; nothing below the cutoff is read. Owner match is case-insensitive (get_state hex vs wallet).
 */
export async function discover(rpcUrl: string, factory: string, owner: string, firstVaultNumber: number, fetcher: Fetch = fetch): Promise<OwnedVault | null> {
  const { count } = await getFactoryConfig(rpcUrl, factory, fetcher)
  const wanted = owner.toLowerCase()
  for (let top = count; top >= firstVaultNumber; top -= 2) {
    const batch = [top, top - 1].filter(n => n >= firstVaultNumber)
    const results = await Promise.allSettled(batch.map(n => readState(rpcUrl, vaultId(factory, n), fetcher)))
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        const reason = result.reason
        throw reason instanceof NearRpcError ? reason : new NearRpcError(`v${batch[index]} could not be read.`, true)
      }
      if (result.value.owner.toLowerCase() === wanted) return { accountId: vaultId(factory, batch[index]), number: batch[index], state: result.value }
    }
  }
  return null
}

/**
 * D4 with a remembered vault (PRD §9 5): when the owner's last known vault (from the cutoff) still names this owner,
 * one get_state answers; when it does not, or cannot be read, the factory scan runs as in `discover`.
 */
export async function discoverWithHint(rpcUrl: string, factory: string, owner: string, firstVaultNumber: number, hint: string | null, fetcher: Fetch = fetch): Promise<OwnedVault | null> {
  const suffix = `.${factory}`
  const number = hint?.startsWith('v') && hint.endsWith(suffix) ? Number(hint.slice(1, -suffix.length)) : 0
  if (hint && Number.isSafeInteger(number) && number >= firstVaultNumber && hint === vaultId(factory, number)) {
    const state = await readState(rpcUrl, hint, fetcher).catch(() => null)
    if (state && state.owner.toLowerCase() === owner.toLowerCase()) return { accountId: hint, number, state }
  }
  return discover(rpcUrl, factory, owner, firstVaultNumber, fetcher)
}

