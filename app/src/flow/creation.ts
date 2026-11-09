// Relayer readiness for vault creation (PRD R7): reuse assessRelayer; a failed read is "unavailable",
// never "ready".
import type { AppConfig } from '../protocol/near.ts'
import { assessRelayer, type Readiness, type RelayerHealth } from '../protocol/relayer.ts'

export async function relayerReadiness(ports: { readRelayerHealth(config: AppConfig): Promise<RelayerHealth> }, config: AppConfig): Promise<Readiness> {
  return assessRelayer(config, await ports.readRelayerHealth(config))
}
