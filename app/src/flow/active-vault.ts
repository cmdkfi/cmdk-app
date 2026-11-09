// Classification of the vault D4 picked (PRD S0, D4, D5 revised): pure, over the adapter's summary. Discovery
// itself (newest vault numbered from firstVaultNumber) happens in the adapter; a read it cannot complete throws.
import { loadVaultHint, saveVaultHint } from './caches.ts'
import type { StorageMode } from './session.ts'
import type { Address } from 'viem'
import type { PositionSummary, ProtocolAdapter } from '../adapters/types.ts'
import type { LoadedConfig } from './config.ts'
import type { VaultStatus } from './entry.ts'

export type PositionShape = 'liquidated' | 'active' | 'empty'

export function positionShape(summary: Pick<PositionSummary, 'markets'>): PositionShape {
  const collateral = summary.markets.reduce((sum, m) => sum + m.collateral, 0n)
  const owes = summary.markets.some(m => m.debt > 0n)
  if (collateral === 0n && owes) return 'liquidated'
  return collateral > 0n || owes ? 'active' : 'empty'
}

/** liquidated, active (idle USDC above dust flagged), or for an empty vault: setup / deposited / ready. */
export function classifyVault(summary: Pick<PositionSummary, 'markets' | 'idle' | 'setupComplete'>, guided: Pick<LoadedConfig['guided'], 'minDepositWei' | 'usdcDust'>): VaultStatus {
  const shape = positionShape(summary)
  if (shape === 'liquidated') return 'liquidated'
  if (shape === 'active') return summary.idle.usdc > guided.usdcDust ? 'active-idle-usdc' : 'active'
  if (!summary.setupComplete) return 'setup'
  return summary.idle.weth >= guided.minDepositWei ? 'deposited' : 'ready'
}

export type DiscoveredVault = { status: VaultStatus | null; summary?: PositionSummary }

/**
 * D4 with the remembered vault (PRD §9 5): the vault last found for this owner is passed as a hint and verified by the
 * adapter with one get_state; the scan runs when it no longer belongs to the owner. The answer is remembered again.
 */
export async function discoverActiveVault(protocol: Pick<ProtocolAdapter, 'discoverPosition'>, app: LoadedConfig, owner: Address, mode: StorageMode = 'sandbox'): Promise<DiscoveredVault> {
  const factory = app.config.near.factory
  const summary = await protocol.discoverPosition(app, owner, loadVaultHint(mode, factory, owner))
  saveVaultHint(mode, factory, owner, summary?.vault.accountId ?? null)
  return summary ? { status: classifyVault(summary, app.guided), summary } : { status: null }
}
