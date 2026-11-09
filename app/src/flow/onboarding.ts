// S4 onboarding (PRD S4, D11, FR-5, FR-5a, FR-7, D7/FR-8): the step list, its persisted record, and the pure rules
// the runner (components/useOnboarding.ts) applies. Hand-rolled on purpose: a handful of explicit states per step;
// a state-machine library would add more surface than it removes.
import type { Hex } from 'viem'
import type { VaultStatus } from './entry.ts'

export const STEPS = ['create', 'setup', 'wrap', 'transfer', 'open', 'withdraw'] as const
export type StepId = (typeof STEPS)[number]

/** "submitted" and "confirming" are never shown as done; only a chain predicate makes a step done (PRD S4). */
export type StepStatus = 'waiting' | 'prompting' | 'submitted' | 'confirming' | 'checking' | 'stale' | 'funding' | 'done' | 'skipped' | 'paused'

/** What the user can do on a paused step. */
export type RetryKind =
  | 'prompt' // request the MetaMask prompt again (new signature or transaction)
  | 'post' // create: a new /create-vault request (only after discovery found no vault)
  | 'resend' // owner call refused before sending: post the same signed message again (≥ 45 s valid)
  | 'resign' // owner call: sign a new message
  | 'topUp' // send the gas top-up, then re-post or re-sign
  | 'accept' // open: accept the lower LTV the market can lend now
  | 'check' // re-check (still waiting / reverted / unclear)

export type Pause = {
  /** One plain-language line. */
  line: string
  /** The relayer's or wallet's own error text, shown verbatim. */
  text?: string
  retry?: RetryKind
  /** create: seconds from the 429 Retry-After, counted from `since`. */
  retryAfter?: number
  since?: number
  /** The job id while "still waiting" (FR-5). */
  job?: string
}

export type TopUp = { amountWei: string; status: 'needed' | 'prompting' | 'confirming' | 'done'; txHash?: Hex }

export type StepState = {
  status: StepStatus
  job?: string
  txHash?: Hex
  pause?: Pause
  note?: string
  topUp?: TopUp
  /** create: a POST was made at least once (a repeat re-runs discovery first). */
  attempted?: boolean
  /** open: the LTV the market could lend when below the target (WAD), shown as "opened below target". */
  belowTarget?: string
  /** close transfer: the wallet holds less USDC than the shortfall; the Get test USDC panel shows these (S6a). */
  funding?: { shortfall: string; wallet: string; missing: string; checkedAt: number }
}

export type OnboardingRecord = {
  version: 1
  factory: string
  owner: string
  /** The deposit chosen on S1 (wei), or null when resuming a discovered vault without one. */
  amountWei: string | null
  /** LTV S1 showed for this amount (WAD); open pauses if the market now gives more than 2 points less. */
  shownLtv: string | null
  createdAt: number
  vault?: { accountId: string; number: number; baseAddress: Hex }
  steps: Record<StepId, StepState>
  /** Set by Create position / Continue-from-S4; the runner arms the chain once and clears it. */
  autostart?: boolean
}

export const isFinished = (s: StepStatus) => s === 'done' || s === 'skipped'

/** The step S0 resumes at for a discovered vault (PRD S0, D5 revised). */
export function resumeStep(status: VaultStatus | null): StepId {
  switch (status) {
    case 'setup': return 'setup'
    case 'ready': return 'wrap'
    case 'deposited': return 'open'
    case 'active-idle-usdc': return 'withdraw'
    default: return 'create'
  }
}

export function newRecord(o: { factory: string; owner: string; amountWei: bigint | null; shownLtv: bigint | null; vault?: OnboardingRecord['vault']; resumeAt: StepId; now: number; autostart?: boolean }): OnboardingRecord {
  const at = STEPS.indexOf(o.resumeAt)
  const steps = Object.fromEntries(STEPS.map((id, index) => [id, index < at ? { status: 'done', note: 'Already on chain' } : { status: 'waiting' }])) as Record<StepId, StepState>
  return { version: 1, factory: o.factory, owner: o.owner.toLowerCase(), amountWei: o.amountWei?.toString() ?? null, shownLtv: o.shownLtv?.toString() ?? null, createdAt: o.now, steps, ...(o.vault ? { vault: o.vault } : {}), ...(o.autostart ? { autostart: true } : {}) }
}

/** The first step not yet finished, or null when onboarding is complete. */
export function activeStep(r: OnboardingRecord): StepId | null {
  return STEPS.find(id => !isFinished(r.steps[id].status)) ?? null
}

/** Replace fields of one step of any step record (onboarding or close); `undefined` in the patch removes a field. */
export function patchStep<Id extends string, R extends { steps: Record<Id, StepState> }>(r: R, id: Id, patch: Partial<StepState>): R {
  const next: StepState = { ...r.steps[id], ...patch }
  for (const key of Object.keys(patch) as (keyof StepState)[]) if (patch[key] === undefined) delete next[key]
  return { ...r, steps: { ...r.steps, [id]: next } }
}

/** FR-5: poll a job every 1 s for the first 30 s, then every 2 s, and stop at 180 s ("Still waiting"). */
export function jobPollDelay(elapsedMs: number): number | null {
  if (elapsedMs < 30_000) return 1_000
  if (elapsedMs < 180_000) return 2_000
  return null
}

const TOPUP_STEP = 10n ** 14n // 0.0001 ETH
const TOPUP_MIN = 5n * 10n ** 14n // 0.0005 ETH

/** D7/FR-8 (Q2): (need − have) × 1.25, rounded up to 0.0001 ETH, at least 0.0005 ETH. */
export function topUpAmount(have: bigint, need: bigint): bigint {
  const short = need > have ? need - have : 0n
  const padded = (short * 125n + 99n) / 100n
  const rounded = (padded + TOPUP_STEP - 1n) / TOPUP_STEP * TOPUP_STEP
  return rounded < TOPUP_MIN ? TOPUP_MIN : rounded
}

/** After a refusal before sending: post the same signed message again only while it has ≥ 45 s left (relayer margin 30 s). */
export function retryMode(expiry: number, nearNow: number): 'resend' | 'resign' {
  return expiry - nearNow >= 45 ? 'resend' : 'resign'
}

const TWO_POINTS = 2n * 10n ** 16n

/** Q1: pause before the open signature when the market now gives more than 2 points less than S1 showed. */
export function belowShown(shownLtv: bigint | null, achievable: bigint): boolean {
  return shownLtv !== null && shownLtv - achievable > TWO_POINTS
}
