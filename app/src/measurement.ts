import type { AgentMeasurement, AppConfig } from './near.ts'
import { SetupError } from './vault-setup.ts'

const fields: Record<keyof AgentMeasurement, number> = { mrtd: 96, rtmr0: 96, rtmr1: 96, rtmr2: 96, compose_hash: 64, os_image_hash: 64 }
export const manifestUrl = 'https://raw.githubusercontent.com/cmdkfi/app/main/deployments/testnet.json'

export function isMeasurement(value: unknown): value is AgentMeasurement {
  if (!value || typeof value !== 'object') return false
  return Object.entries(fields).every(([key, length]) => {
    const field = (value as Record<string, unknown>)[key]
    return typeof field === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(field)
  })
}

export function measurementMatches(approved: unknown, current: AgentMeasurement): boolean {
  return isMeasurement(approved) && Object.keys(fields).every(key => approved[key as keyof AgentMeasurement] === current[key as keyof AgentMeasurement])
}

export type CurrentAgent = { measurement: AgentMeasurement; version: string | null; sourceCommit: string | null }
export async function readCurrentAgent(config: AppConfig, fetcher: typeof fetch = fetch): Promise<CurrentAgent> {
  let response: Response
  try { response = await fetcher(`${manifestUrl}?at=${Date.now()}`, { cache: 'no-store' }) }
  catch { throw new SetupError('Could not check the current agent measurement. Signing is paused.') }
  if (!response.ok) throw new SetupError('Could not check the current agent measurement. Signing is paused.')
  const manifest: unknown = await response.json().catch(() => null)
  const value = manifest as { base?: { chainId?: unknown }; near?: { factory?: unknown }; agent?: { measurement?: unknown; version?: unknown; sourceCommit?: unknown } } | null
  if (value?.base?.chainId !== config.baseChainId || value.near?.factory !== config.near.factory || !isMeasurement(value.agent?.measurement)) {
    throw new SetupError('The current deployment manifest is incomplete or differs from this app build. Signing is paused.')
  }
  return { measurement: value.agent.measurement, version: typeof value.agent?.version === 'string' ? value.agent.version : null, sourceCommit: typeof value.agent?.sourceCommit === 'string' ? value.agent.sourceCommit : null }
}

export function approvalMessage(vault: string, nonce: number, expiry: number, config: AppConfig, measurement: AgentMeasurement): string {
  if (!config.near.factory || !/^v[1-9][0-9]*$/.test(vault.split('.')[0]) || vault.slice(vault.indexOf('.') + 1) !== config.near.factory ||
    !Number.isSafeInteger(nonce) || nonce < 1 || !Number.isSafeInteger(expiry) || !isMeasurement(measurement)) throw new SetupError('Could not prepare the agent approval message.')
  return JSON.stringify({ protocol: 'cmdk-vault/1', network: 'testnet', vault, method: 'approve_measurement', args: measurement, nonce, expiry })
}
