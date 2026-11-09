// Discovery and the D4 rule (PRD D4, R8, FR-4, S0): only vaults numbered from `firstVaultNumber` count;
// the newest of them is the position. Its chain state is classified for the entry resolver. Any read
// that leaves the answer uncertain makes discovery fail; it never degrades to "no vault".
import type { AppConfig, Vault } from '../protocol/near.ts'
import type { LivePosition } from '../protocol/positions.ts'
import { setupComplete, type SetupFacts } from '../protocol/setup-facts.ts'
import type { VaultStatus } from './entry.ts'
import type { Guided } from './guided-config.ts'

export class DiscoveryError extends Error {}

export type PositionShape = 'liquidated' | 'active' | 'empty'

export function positionShape(position: LivePosition): PositionShape {
  const collateral = position.markets.reduce((sum, m) => sum + m.collateral, 0n)
  const owes = position.markets.some(m => m.debt > 0n || (m.borrowShares ?? 0n) > 0n)
  if (collateral === 0n && owes) return 'liquidated'
  return collateral > 0n || owes ? 'active' : 'empty'
}

const idle = (position: LivePosition, token: string) => position.freeBalances?.find(b => b.token.toLowerCase() === token.toLowerCase())?.balance ?? 0n

/** Classifies the chosen vault. `setupDone` is read only for an empty vault and is null otherwise. */
export function classifyVault(position: LivePosition, setupDone: boolean | null, guided: Pick<Guided, 'base' | 'minDepositWei' | 'usdcDust'>): VaultStatus {
  const shape = positionShape(position)
  if (shape === 'liquidated') return 'liquidated'
  if (shape === 'active') return idle(position, guided.base.usdc) > guided.usdcDust ? 'active-idle-usdc' : 'active'
  if (setupDone === null) throw new DiscoveryError('Setup state is required for an empty vault.')
  if (!setupDone) return 'setup'
  return idle(position, guided.base.weth) >= guided.minDepositWei ? 'deposited' : 'ready'
}

type Scan = { vaults: Vault[]; failed: number; unreadAccounts: string[] }
const vaultNumber = (accountId: string) => Number(/^v([1-9][0-9]*)\./.exec(accountId)?.[1] ?? NaN)

/** D4 / R8: the newest owned vault numbered from `first`; an unread account in that range makes it unknown. */
export function newestFromCutoff(scan: Scan, first: number): Vault | null {
  if (scan.failed > scan.unreadAccounts.length) throw new DiscoveryError('Some vault accounts could not be read.')
  if (scan.unreadAccounts.some(id => !(vaultNumber(id) < first))) throw new DiscoveryError('Some vault accounts could not be read.')
  return scan.vaults.filter(vault => vault.number >= first).sort((a, b) => b.number - a.number)[0] ?? null
}

const readable = (position: LivePosition) => !position.errors?.length && position.markets.length > 0 && !position.markets.some(m => m.readOnly)

export type DiscoveryPorts = {
  discoverVaults(config: AppConfig, owner: string): Promise<Scan>
  readLivePosition(config: AppConfig, vaultId: string, owner: string): Promise<LivePosition>
  readSetupFacts(config: AppConfig, vaultId: string, owner: string, position: LivePosition): Promise<SetupFacts>
}

export type DiscoveredVault = { status: VaultStatus | null; vault?: Vault; position?: LivePosition }

export async function discoverActiveVault(ports: DiscoveryPorts, config: AppConfig, guided: Guided, owner: string): Promise<DiscoveredVault> {
  const vault = newestFromCutoff(await ports.discoverVaults(config, owner), guided.firstVaultNumber)
  if (!vault) return { status: null }
  const position = await ports.readLivePosition(config, vault.accountId, owner)
  if (!readable(position)) throw new DiscoveryError(`Vault ${vault.accountId} could not be read completely.`)
  const setupDone = positionShape(position) === 'empty' ? setupComplete(await ports.readSetupFacts(config, vault.accountId, owner, position)) : null
  return { status: classifyVault(position, setupDone, guided), vault, position }
}
