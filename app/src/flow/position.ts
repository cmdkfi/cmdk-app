// S5 position screen rules (PRD S5), pure: agent status, current market, sell budget, variant, event descriptions.
import type { Address } from 'viem'
import type { ActivityItem, AgentFacts, PositionMarket, PositionView } from '../adapters/types.ts'
import { formatUnits, formatWadPercent } from './format.ts'

export type AgentState = 'Active' | 'Registering' | 'Expired' | 'Revoked' | 'Unavailable'

/**
 * Agent status from the /agent/vaults row only (registration, agent_status, expires_at; labels of agent/src/vaults.rs
 * l.120-127 and agent/src/logic.rs l.653-669) plus the NEAR key check. `facts` null means the reads failed.
 */
export function agentState(facts: AgentFacts | null, nowSecs: number): { state: AgentState; detail?: string } {
  if (!facts) return { state: 'Unavailable', detail: 'The agent list or the vault keys could not be read.' }
  const row = facts.row
  if (!row) return { state: 'Registering', detail: 'The agent has not picked up this vault yet (usually a few minutes).' }
  const status = row.agent_status ?? ''
  if (status === 'revoked (registration expired)' || (typeof row.expires_at === 'number' && row.expires_at <= nowSecs)) return { state: 'Expired', detail: 'The registration expired; the agent re-registers on its own.' }
  if (status.startsWith('revoked')) return { state: 'Revoked', detail: status }
  if (row.registration === 'registering') return { state: 'Registering', detail: 'Registering (usually a few minutes).' }
  if (row.registration !== 'registered') return { state: 'Unavailable', detail: row.registration ?? 'No registration state.' }
  if (status !== 'active') return { state: 'Unavailable', detail: status || 'No agent status.' }
  if (!facts.keyLimited) return { state: 'Unavailable', detail: 'The vault keys on NEAR do not show exactly the restricted agent key.' }
  return { state: 'Active' }
}

/** The market holding the debt is the current one (live, or backup after a migration); else the one with collateral; else live. */
export function currentMarket(view: Pick<PositionView, 'markets'>, liveId: string): PositionMarket | null {
  const withDebt = view.markets.filter(m => m.debt > 0n).sort((a, b) => (b.debt > a.debt ? 1 : -1))
  if (withDebt[0]) return withDebt[0]
  return view.markets.find(m => m.collateral > 0n) ?? view.markets.find(m => m.id.toLowerCase() === liveId.toLowerCase()) ?? view.markets[0] ?? null
}

/** The sell budget of the current market's executor and collateral token (Executor._activeCollateral groups). */
export function budgetFor(view: Pick<PositionView, 'sellBudgets'>, market: PositionMarket) {
  return view.sellBudgets.find(b => b.executor.toLowerCase() === market.executor.toLowerCase() && b.token.toLowerCase() === market.collateralToken.toLowerCase()) ?? null
}

export type BackupStatus = 'current' | 'approved' | 'not-approved' | 'missing'

/**
 * Whether the agent may migrate to the backup market: both corridors set, migrateAllowed on both, neither closed for
 * the agent (Executor.migrate l.304-309 through _agentCorridor l.470-474). 'current' once the debt sits on the backup.
 */
export function backupStatus(view: Pick<PositionView, 'markets'>, current: PositionMarket | null, labels: Record<string, string>): BackupStatus {
  const backup = view.markets.find(m => labels[m.id.toLowerCase()] === 'backup')
  if (!backup) return 'missing'
  if (current && current.id.toLowerCase() === backup.id.toLowerCase()) return 'current'
  const usable = (m: PositionMarket) => m.corridor.set && m.corridor.migrateAllowed && !m.closedForAgent
  return usable(backup) && (!current || usable(current)) ? 'approved' : 'not-approved'
}

export type Variant = 'active' | 'liquidated' | 'closed' | 'empty'

/** liquidated: no collateral, debt left; closed: only from this session's close record (Phase 5); empty otherwise. */
export function positionVariant(view: Pick<PositionView, 'markets'>, closeRecord: boolean): Variant {
  const collateral = view.markets.reduce((sum, m) => sum + m.collateral, 0n)
  const debt = view.markets.reduce((sum, m) => sum + m.debt, 0n)
  if (collateral === 0n && debt > 0n) return 'liquidated'
  if (collateral > 0n || debt > 0n) return 'active'
  return closeRecord ? 'closed' : 'empty'
}

export type Described = { who: 'You' | 'Agent' | 'Transfer'; text: string }
type Ctx = { owner: Address; positionAddress: Address; weth: Address; usdc: Address; marketLabels: Record<string, string> }

const usdc = (v: unknown) => `${formatUnits(v as bigint, 6, 2)} USDC`
const weth = (v: unknown) => `${formatUnits(v as bigint, 18, 6)} WETH`
const pct = (v: unknown) => formatWadPercent(v as bigint)
const label = (ctx: Ctx, id: unknown) => ctx.marketLabels[String(id).toLowerCase()] ?? 'unknown'

/** One line per action; "You" and "Agent" by event name (PRD S5, Executor.sol l.80-97). */
export function describe(item: ActivityItem, ctx: Ctx): Described {
  const a = item.args
  switch (item.name) {
    case 'CorridorSet': return { who: 'You', text: `Rules set on the ${label(ctx, a.market)} market` }
    case 'Opened': return { who: 'You', text: `Opened: supplied ${weth(a.collateralIn)}, borrowed ${usdc(a.borrowed)} at ${pct(a.ltv)} LTV` }
    case 'Repaid': return { who: 'You', text: `Repaid ${usdc(a.repaid)}` }
    case 'Closed': return { who: 'You', text: `Closed: repaid ${usdc(a.repaid)}, ${weth(a.collateralOut)} released` }
    case 'Reduced': return { who: 'Agent', text: `Reduced: sold ${weth(a.collateralSold)} to repay ${usdc(a.repaid)}, LTV ${pct(a.ltvBefore)} → ${pct(a.ltvAfter)}` }
    case 'Migrated': return { who: 'Agent', text: `Moved ${usdc(a.debtMoved)} of debt and ${weth(a.collateralMoved)} from the ${label(ctx, a.from)} to the ${label(ctx, a.to)} market` }
    case 'Exited': return { who: 'Agent', text: `Exited: repaid ${usdc(a.repaid)}, sold ${weth(a.collateralSold)}` }
    case 'SessionEnded': return { who: 'Agent', text: `Ended a protective session at ${pct(a.ltv)} LTV` }
    case 'Transfer': {
      const token = item.token?.toLowerCase() === ctx.usdc.toLowerCase() ? usdc(a.value) : weth(a.value)
      const from = String(a.from).toLowerCase(), to = String(a.to).toLowerCase()
      const position = ctx.positionAddress.toLowerCase(), owner = ctx.owner.toLowerCase()
      if (from === owner && to === position) return { who: 'You', text: `Sent ${token} from your wallet to your position address` }
      if (from === position && to === owner) return { who: 'You', text: `${token} from your position address to your wallet` }
      return { who: 'Transfer', text: to === position ? `${token} arrived at your position address` : `${token} left your position address` }
    }
    default: return { who: 'Transfer', text: item.name }
  }
}
