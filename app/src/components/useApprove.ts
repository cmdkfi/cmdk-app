// S5 re-approval (Phase 7c): a setup-only owner call for a vault with an open position whose approved measurement is
// not the published one (agent card Outdated, or Not approved after a revoke). Same intent, setupArgs and 1a guard as
// S4's setup step (runner.ts setupIntent; PRD fact 3: approve true, authorize from Base), on the shared runner, shown
// inline on the agent card. Persistence is the owner lock (lockKey, method 'approve'): after a reload a pending call is
// resumed as "Checking…" and nothing is prompted until Continue, as for close.
import type { Address } from 'viem'
import type { LoadedConfig } from '../flow/config.ts'
import type { StepState } from '../flow/onboarding.ts'
import { loadLock } from '../flow/onboarding-record.ts'
import type { Mode } from '../flow/routes.ts'
import { CONFIG_BEHIND, ownerStep, setupIntent, useStepChain, type Chain, type ChainRecord, type Env, type OwnerSpec } from './runner.ts'

export type ApproveId = 'approve'
type Vault = { accountId: string; baseAddress: Address }
export type ApproveRecord = ChainRecord<ApproveId> & { vault: Vault }

/**
 * The record lives in memory for this page (the lock is the durable part): a paused or finished call is shown again
 * when the card re-mounts, and a reload rebuilds it from the lock alone.
 */
const memory = new Map<string, ApproveRecord>()

const approveSpec: OwnerSpec<ApproveId, ApproveRecord> = {
  id: 'approve',
  // done when the vault approves the baked measurement, which the 1a guard found equal to the published manifest
  // right before signing (approveStep runs the guard before this check too)
  complete: v => v.measurementApproved,
  intent: (_v, env) => setupIntent(env, 'approve'),
  doneNote: () => 'Your vault approves the current agent version. The agent registers on its own.',
}

/**
 * With no call pending, the 1a guard runs first: if config.json is behind the manifest, its measurement cannot be the
 * current one, so "already approved" must not read as Done. A pending call (lock) is reconciled as it is.
 */
async function approveStep(env: Env<ApproveId, ApproveRecord>): Promise<boolean> {
  if (!loadLock(env.mode, env.get().vault.accountId, env.owner) && !await env.protocol.configMatchesPublished(env.app)) {
    env.patch('approve', { status: 'paused', pause: { line: CONFIG_BEHIND, retry: 'check' } })
    return false
  }
  return ownerStep(env, approveSpec)
}

export type Approve = Chain<ApproveId, ApproveRecord>

export function newApproveRecord(owner: Address, vault: Vault, now: number): ApproveRecord {
  return { owner: owner.toLowerCase(), createdAt: now, vault, steps: { approve: { status: 'waiting' } } }
}

export function useApprove(mode: Mode, app: LoadedConfig | undefined, owner: Address | undefined, chainOk: boolean, vault: Vault | undefined, onFinished: () => void): Approve {
  const key = `${mode}:${app?.config.near.factory ?? ''}:${owner?.toLowerCase() ?? ''}:${vault?.accountId ?? ''}`
  return useStepChain<ApproveId, ApproveRecord>({
    mode, app, owner, chainOk, key,
    load: () => {
      if (!owner || !vault) return null
      const kept = memory.get(key)
      if (kept) return kept
      const lock = loadLock(mode, vault.accountId, owner)
      if (lock?.method !== 'approve') return null
      const step: StepState = { status: 'checking', job: lock.job }
      return { owner: owner.toLowerCase(), createdAt: lock.postedAt ?? Date.now(), vault, steps: { approve: step } }
    },
    save: r => { memory.set(key, r) },
    active: r => (r.steps.approve.status === 'done' ? null : 'approve'),
    done: r => r.steps.approve.status === 'done',
    vault: r => r.vault,
    drivers: { approve: approveStep },
    // the finished record stays (Done on the card); the agent card, panel and position re-read
    finish: r => r,
    invalidate: [['agent'], ['verification'], ['position'], ['discovery']],
    onFinished,
  })
}
