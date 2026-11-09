import type { AppConfig } from './near.ts'

export type RelayerHealth = {
  sender?: string
  ok: boolean
  dry_run?: boolean
  factory: string | null
  factory_exists: boolean | null
  chain_id: number
  near_network: string
  eth_float_wei?: string
  wallet?: { floats_left?: number } | null
  error?: string
}

export type Readiness = { kind: 'ready' | 'pending' | 'failed'; message: string }

export async function readRelayerHealth(config: AppConfig, fetcher: typeof fetch = fetch): Promise<RelayerHealth> {
  let response: Response
  try {
    response = await fetcher(`${config.relayerUrl}/health`, { cache: 'no-store' })
  } catch {
    try {
      response = await fetcher(`${config.relayerUrlFallback}/health`, { cache: 'no-store' })
    } catch {
      throw new Error('Could not reach the relayer. Local development must use http://localhost:5173.')
    }
  }
  if (!response.ok) throw new Error(`Relayer health returned HTTP ${response.status}.`)
  return await response.json() as RelayerHealth
}

export function assessRelayer(config: AppConfig, health: RelayerHealth): Readiness {
  if (!health.ok) return { kind: 'failed', message: health.error || 'Relayer reported an error.' }
  if (health.chain_id !== config.baseChainId || health.near_network !== config.nearNetwork) {
    return { kind: 'failed', message: 'Relayer network does not match the app configuration.' }
  }
  if (!config.near.factory) return { kind: 'pending', message: 'Waiting for the published factory address in the deployment manifest.' }
  if (health.factory !== config.near.factory) return { kind: 'failed', message: 'Relayer factory does not match the published deployment.' }
  if (health.factory_exists !== true) return { kind: 'pending', message: 'The factory is not available on NEAR testnet yet.' }
  if (health.eth_float_wei !== '0' && (!health.wallet || !health.wallet.floats_left)) {
    return { kind: 'pending', message: 'Vault creation is waiting for relayer funding.' }
  }
  return { kind: 'ready', message: 'Relayer and testnet factory are available.' }
}
