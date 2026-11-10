// S6 close and S7 Start over (PRD S6, S6a, S7, D3, D5, R10; Phase 5 decisions): the close step list, its persisted
// record, and the pure rules the runner (components/useClose.ts) applies. Amounts come from the adapter's ClosePlan,
// which applies the relayer's headroom (relayer.py REPAY_HEADROOM) and Morpho's accrual; nothing here reads a chain.
import type { Hex } from 'viem'
import { isFinished, type StepState } from './onboarding.ts'

/** transfer2 is the R10 second transfer; it stays hidden (and finished) unless the close pre-check inserts it. */
export const CLOSE_STEPS = ['transfer', 'transfer2', 'close', 'withdrawWeth', 'withdrawUsdc'] as const
export type CloseStepId = (typeof CLOSE_STEPS)[number]

export type CloseVault = { accountId: string; number: number; baseAddress: Hex }

export type CloseRecord = {
  version: 1
  factory: string
  owner: string
  vault: CloseVault
  createdAt: number
  steps: Record<CloseStepId, StepState>
  /** R10: the second transfer was inserted before the close signature. */
  secondTransfer?: boolean
  /** The market the pending `close` owner call targets (one call per market holding debt or collateral). */
  closing?: Hex
  /** Every step finished: the "closed" marker the entry resolver reads (closeRecord), until Start over clears it. */
  completed?: boolean
  /** Set by "Start closing" on the review sheet; the runner arms the chain once and clears it. */
  autostart?: boolean
}

export function newCloseRecord(o: { factory: string; owner: string; vault: CloseVault; now: number; autostart?: boolean }): CloseRecord {
  const steps = Object.fromEntries(CLOSE_STEPS.map(id => [id, id === 'transfer2' ? { status: 'skipped' } : { status: 'waiting' }])) as Record<CloseStepId, StepState>
  return { version: 1, factory: o.factory, owner: o.owner.toLowerCase(), vault: o.vault, createdAt: o.now, steps, ...(o.autostart ? { autostart: true } : {}) }
}

/** The first unfinished step, or null when the chain is complete (or the record is already the closed marker). */
export function activeCloseStep(r: CloseRecord): CloseStepId | null {
  if (r.completed) return null
  return CLOSE_STEPS.find(id => !isFinished(r.steps[id].status)) ?? null
}

/** The steps the screen lists: transfer2 only once inserted. */
export const visibleCloseSteps = (r: CloseRecord): CloseStepId[] => CLOSE_STEPS.filter(id => id !== 'transfer2' || r.secondTransfer)

/**
 * Phase 5 step 1: shortfall = need(debt accrued to now + 600 s) − idle USDC at the position address, floored at 0,
 * where need is the relayer's debt + debt // 100. The 600 s (messageExpirySecs) covers interest while the user acts.
 */
export function closeShortfall(plan: { needAhead: bigint; idle: { usdc: bigint } }): bigint {
  return plan.needAhead > plan.idle.usdc ? plan.needAhead - plan.idle.usdc : 0n
}

/** R10: re-read just before the close signature; if idle USDC is below need(debt now), insert a second transfer. */
export function needsSecondTransfer(plan: { needNow: bigint; idle: { usdc: bigint } }): boolean {
  return plan.idle.usdc < plan.needNow
}

/** S6a: what the wallet still lacks to send the shortfall. */
export function walletMissing(shortfall: bigint, walletUsdc: bigint): bigint {
  return shortfall > walletUsdc ? shortfall - walletUsdc : 0n
}

/** S7: Start over only once debt, collateral and idle WETH are zero and idle USDC is at or below usdcDust. */
export function startOverAllowed(v: { markets: { debt: bigint; collateral: bigint }[]; idle: { weth: bigint; usdc: bigint } }, usdcDust: bigint): boolean {
  return v.markets.every(m => m.debt === 0n && m.collateral === 0n) && v.idle.weth === 0n && v.idle.usdc <= usdcDust
}
