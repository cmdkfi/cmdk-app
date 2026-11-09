// Setup completeness for a discovered vault (PRD D5 as revised 9 Nov: an empty vault with complete setup
// is reusable). Reads the same facts the previous app's setup screen collected:
// Morpho authorization and token allowances for each market's executor, corridor_set on the vault and on
// Base, and the vault's approved measurement. New module (Phase 2); vault-setup.ts is unchanged.
import { createPublicClient, http, parseAbi, type Address } from 'viem'
import { baseSepolia } from 'viem/chains'
import { viewNear, type AppConfig } from './near.ts'
import type { LivePosition } from './positions.ts'
import { needsSetupApproval, type repairSetupArgs } from './vault-setup.ts'

const permissionAbi = parseAbi(['function allowance(address,address) view returns(uint256)', 'function isAuthorized(address,address) view returns(bool)'])
type VaultState = { owner?: string; approved?: Record<string, string>; markets?: { id: string; corridor_set: boolean }[] }

export type SetupFact = Parameters<typeof repairSetupArgs>[2][number]
export type SetupFacts = { facts: SetupFact[]; measurementMatches: boolean }

export async function readSetupFacts(config: AppConfig, vaultId: string, owner: string, position: LivePosition): Promise<SetupFacts> {
  const state = await viewNear<VaultState>(config.nearRpcUrl, vaultId, 'get_state')
  if (state.owner?.toLowerCase() !== owner.toLowerCase()) throw new Error('The connected wallet is not this vault owner.')
  if (position.errors?.length || position.markets.length !== config.createVault?.markets.length || position.markets.some(m => m.readOnly || m.policyUnavailable)) {
    throw new Error('Not every registered market of this vault could be read.')
  }
  const client = createPublicClient({ chain: baseSepolia, transport: http(config.baseRpcUrl) })
  const facts = await Promise.all(position.markets.map(async m => {
    const executor = m.executor as Address
    const [authorized, loan, collateral] = await Promise.all([
      client.readContract({ address: m.morpho!, abi: permissionAbi, functionName: 'isAuthorized', args: [position.baseAddress, executor] }),
      client.readContract({ address: m.loanToken, abi: permissionAbi, functionName: 'allowance', args: [position.baseAddress, executor] }),
      client.readContract({ address: m.collateralToken, abi: permissionAbi, functionName: 'allowance', args: [position.baseAddress, executor] }),
    ])
    return {
      id: m.id, executor, loanToken: m.loanToken, collateralToken: m.collateralToken, authorized,
      needsApproval: needsSetupApproval(loan, collateral), liquidationLtv: m.liquidationLtv,
      corridorSet: m.agentTrigger !== null && state.markets?.find(item => item.id.toLowerCase() === m.id.toLowerCase())?.corridor_set === true,
      corridor: m.agentTarget !== null && m.agentTrigger !== null && m.floor != null && m.dailyBudget != null
        ? { target: m.agentTarget.toString(), act: m.agentTrigger.toString(), floor: m.floor.toString(), sell_budget: m.dailyBudget.toString(), migrate_allowed: !!m.migrateAllowed, exit_allowed: !!m.exitAllowed }
        : undefined,
    }
  }))
  const published = config.agent.measurement
  const measurementMatches = !!published && !!state.approved && Object.entries(published).every(([key, value]) => state.approved![key] === value)
  return { facts, measurementMatches }
}

/** Complete: corridors set on every market, allowances and Morpho authorization present, approved measurement equals the published one. */
export function setupComplete({ facts, measurementMatches }: SetupFacts): boolean {
  return measurementMatches && facts.length > 0 && facts.every(f => f.authorized && !f.needsApproval && f.corridorSet)
}
