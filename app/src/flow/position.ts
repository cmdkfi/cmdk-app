// S5 position screen rules (PRD S5), pure: agent status, current market, sell budget, variant, event descriptions.
import type { Address } from 'viem'
import type { ActivityItem, AgentFacts, PositionMarket, PositionView } from '../adapters/types.ts'
import { formatWadPercent, usdcText, wethText } from './format.ts'

/**
 * Phase 7b: 'Outdated' — the vault approved another agent version than the published one, so the running agent does
 * not watch it; 'Not approved' — the vault approves none (never set up, or revoked: the chain cannot tell them apart).
 */
export type AgentState = 'Active' | 'Registering' | 'Expired' | 'Revoked' | 'Outdated' | 'Not approved' | 'Unavailable'

export const REGISTERING = 'Registering (usually within a few minutes).'

/**
 * Phase 7c: the agent card's re-approve button. Only for an open position (variant active, no other owner call
 * running): Outdated → "Approve current agent version", Not approved or Revoked (the chain holds no approval; the agent's
 * list may still show the registration, Phase 12) → "Approve agent"; null otherwise. An empty vault is re-approved by
 * S4's setup step instead (classifyVault 'setup').
 */
export function approveAction(state: AgentState | null, variant: Variant, busy: boolean): string | null {
  if (variant !== 'active' || busy) return null
  if (state === 'Outdated') return 'Approve current agent version'
  if (state === 'Not approved' || state === 'Revoked') return 'Approve agent'
  return null
}

/**
 * Phase 12: the agent card's Revoke agent button shows while the vault approves a measurement or holds an agent key
 * (revoke_agent clears both, vault/src/lib.rs l.419-424), from the chain facts only; never while another owner call
 * runs (`busy`) and never without facts.
 */
export function canRevoke(facts: AgentFacts | null, busy: boolean): boolean {
  if (!facts || busy) return false
  const approves = facts.approval.ok && facts.approval.matches !== null
  return approves || facts.vaultAgent !== null
}
/** agent/src/logic.rs l.653-660 AgentStatus::Replaced: the vault lists another key than the running agent's. */
export const REPLACED = 'revoked (another key registered)'

/**
 * The agent's row is behind the chain when it shows no registration yet: no row, Phase::Pending ("registering",
 * agent/src/vaults.rs l.120-127), or a vault read from before the key was added or extended ("revoked",
 * "revoked (registration expired)", agent/src/logic.rs l.663-669). Other labels (gave up, no TEE, another key) are
 * the agent's own statements, not lag.
 */
export function listBehind(row: { registration?: string; agent_status?: string } | null): boolean {
  if (!row || row.registration === 'registering') return true
  return row.registration === 'registered' && (row.agent_status === 'revoked' || row.agent_status === 'revoked (registration expired)')
}

/**
 * Agent status, chain first (Phase 7b). The approval comes first: the agent watches a vault only while its `approved`
 * equals the agent's own measurement (agent/src/vaults.rs l.8-9, l.82-87), and a joining vault's key from a previous
 * boot is replaced (l.307), so an old key under a stale approval protects nothing; the published manifest stands for
 * the running agent's measurement (PRD fact 5, §6 row 1). Then the vault's recorded agent (vault/src/lib.rs l.555, set by register_agent
 * l.490 with expires_at in seconds, removed by revoke_agent l.419-423) and the NEAR key check decide whether the
 * agent is registered. The agent's /agent/vaults row (labels of agent/src/vaults.rs l.120-127, agent/src/logic.rs
 * l.653-669, computed from the agent's own last read of the vault) adds liveness and may lag behind the chain: its
 * "revoked" counts only when the chain shows no key, or when it reports that the vault holds another key than its own.
 * `facts` null means the chain reads failed.
 */
export function agentState(facts: AgentFacts | null, nowSecs: number): { state: AgentState; detail?: string } {
  if (!facts) return { state: 'Unavailable', detail: 'The vault keys on NEAR could not be read.' }
  if (!facts.approval.ok) return { state: 'Unavailable', detail: 'The agent manifest could not be read.' }
  const row = facts.list.ok ? facts.list.row : null
  if (facts.approval.matches === null) {
    // never set up, or revoke_agent (vault/src/lib.rs l.419-424 clears approved and the key): Revoked only when the
    // agent's list shows it registered here and the chain holds no key
    if (row?.registration === 'registered' && !facts.vaultAgent) return { state: 'Revoked', detail: 'Your vault holds no agent key and approves no agent version.' }
    return { state: 'Not approved', detail: 'Your vault approves no agent version, so no agent watches it.' }
  }
  if (!facts.approval.matches) return { state: 'Outdated', detail: 'Your vault approved an earlier agent version; the running agent does not watch it.' }
  const listStatus = row?.agent_status ?? ''
  const key = facts.vaultAgent
  if (!key) {
    if (!facts.list.ok) return { state: 'Unavailable', detail: 'Your vault holds no agent key, and the agent\'s list could not be read.' }
    if (!row || row.registration === 'registering') return { state: 'Registering', detail: REGISTERING }
    // the agent registered here once and the vault no longer holds a key: revoked (revoke_agent), whatever the list's status
    if (row.registration === 'registered') return { state: 'Revoked', detail: 'Your vault holds no agent key.' }
    return { state: 'Unavailable', detail: row.registration ?? 'No registration state.' }
  }
  if (key.expires_at <= nowSecs) return { state: 'Expired', detail: 'The registration expired; the agent re-registers on its own.' }
  if (listStatus === REPLACED) return { state: 'Revoked', detail: 'The agent reports that your vault holds another agent key than its own.' }
  if (!facts.keyLimited) return { state: 'Unavailable', detail: 'The vault keys on NEAR do not show exactly the restricted agent key.' }
  if (!facts.list.ok) return { state: 'Active', detail: 'Your vault shows the registration; the agent\'s list could not be read.' }
  if (listBehind(row)) return { state: 'Active', detail: 'Your vault shows the registration; the agent\'s list has not caught up yet.' }
  if (row!.registration !== 'registered' || listStatus !== 'active') return { state: 'Active', detail: `Your vault shows the registration; the agent's list says: ${[row!.registration, listStatus].filter(Boolean).join(' · ')}.` }
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

const usdc = (v: unknown) => usdcText(v as bigint)
const weth = (v: unknown) => wethText(v as bigint)
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

export type ActionRow = Described & { transactionHash: string; blockNumber: bigint; time: bigint | null }

/**
 * Recent actions, one row per transaction (Phase 7b): token transfers that share a transaction with an Executor event
 * of this position are that event's internal legs (the Executor pulling from and Morpho paying the position address
 * inside open, close, reduce, migrate and exit: executor/src/Executor.sol l.172-376, `_pull`/`_transfer` l.612-618) and are folded into
 * the event's row. A transaction with only
 * transfers keeps them as one row. Order is kept (first appearance of each transaction).
 */
export function actionRows(items: ActivityItem[], ctx: Ctx): ActionRow[] {
  const groups = new Map<string, ActivityItem[]>()
  for (const item of items) {
    const key = item.transactionHash.toLowerCase()
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.values()].map(group => {
    const events = group.filter(i => i.name !== 'Transfer')
    const shown = (events.length > 0 ? events : group).map(i => describe(i, ctx))
    const who = shown.some(d => d.who === 'Agent') ? 'Agent' : shown.some(d => d.who === 'You') ? 'You' : 'Transfer'
    const first = group[0]
    return { who, text: shown.map(d => d.text).join(' · '), transactionHash: first.transactionHash, blockNumber: first.blockNumber, time: first.time }
  })
}
