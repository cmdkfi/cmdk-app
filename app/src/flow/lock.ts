// Owner-call lock record and its reconciliation (PRD FR-6 as reworded in Phase 3, R4). One pending owner intent per
// vault and owner. No raw-transaction, NEAR-receipt or cancellation handling: the verdict comes from the job, the
// vault's owner_nonce and NEAR time only.
import type { Hex } from 'viem'

export type OwnerLock = {
  vault: string
  owner: string
  /** The step that signed it: S4 setup/open/withdraw or S6 close/withdrawWeth/withdrawUsdc (one lock per vault:owner). */
  method: string
  nonce: number
  expiry: number
  message: string
  signature: Hex
  job?: string
  postedAt?: number
}

export type JobOutcome = { stage: string; httpStatus?: number } | 'lost' | null

export type LockVerdict =
  | 'done' // job done: the step's chain check decides; release
  | 'refused' // refused before anything was sent (400): keep; same message may be re-posted on user action
  | 'executed' // owner_nonce reached the signed nonce: the NEAR call ran; re-read chain, release
  | 'expired' // NEAR time past expiry with the nonce unused: the message can no longer run; release, sign again
  | 'pending' // still unknown: keep checking

export function reconcileLock(lock: Pick<OwnerLock, 'nonce' | 'expiry'>, now: { ownerNonce: number; nearNow: number; job: JobOutcome }): LockVerdict {
  const job = now.job
  if (job && job !== 'lost' && job.stage === 'done') return 'done'
  if (job && job !== 'lost' && job.stage === 'failed' && job.httpStatus === 400) return 'refused'
  if (now.ownerNonce >= lock.nonce) return 'executed'
  if (now.nearNow > lock.expiry) return 'expired'
  return 'pending'
}
