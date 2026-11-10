// S5 Revoke agent (Phase 12): one owner call `revoke_agent` (vault/src/lib.rs l.419-424: deletes the agent's key and
// clears the approved measurement in one NEAR transaction; no Base transaction; relayer.py OWNER_ARGS lists it with no
// fields). The mirror of useApprove.ts: the same runner, inline on the agent card, persisted through the owner lock
// (method 'revoke'); after a reload a pending call resumes as "Checking…" and nothing is prompted until Continue.
// Done only when a fresh read shows no agent key and no approval.
import type { Address } from 'viem'
import type { LoadedConfig } from '../flow/config.ts'
import type { StepState } from '../flow/onboarding.ts'
import { loadLock } from '../flow/onboarding-record.ts'
import type { Mode } from '../flow/routes.ts'
import { ownerStep, useStepChain, type Chain, type ChainRecord, type Env, type OwnerSpec } from './runner.ts'

export type RevokeId = 'revoke'
type Vault = { accountId: string; baseAddress: Address }
export type RevokeRecord = ChainRecord<RevokeId> & { vault: Vault }

const memory = new Map<string, RevokeRecord>()

const revokeSpec: OwnerSpec<RevokeId, RevokeRecord> = {
  id: 'revoke',
  complete: v => v.agentPublicKey === null && !v.approvesAny,
  intent: async () => ({ method: 'revoke_agent' }),
  doneNote: () => 'The agent key is deleted and the approval cleared. Approve the agent again when you want protection back.',
}

const revokeStep = (env: Env<RevokeId, RevokeRecord>) => ownerStep(env, revokeSpec)

export type Revoke = Chain<RevokeId, RevokeRecord>

export function newRevokeRecord(owner: Address, vault: Vault, now: number): RevokeRecord {
  return { owner: owner.toLowerCase(), createdAt: now, vault, steps: { revoke: { status: 'waiting' } } }
}

export function useRevoke(mode: Mode, app: LoadedConfig | undefined, owner: Address | undefined, chainOk: boolean, vault: Vault | undefined, onFinished: () => void): Revoke {
  const key = `${mode}:${app?.config.near.factory ?? ''}:${owner?.toLowerCase() ?? ''}:${vault?.accountId ?? ''}`
  return useStepChain<RevokeId, RevokeRecord>({
    mode, app, owner, chainOk, key,
    load: () => {
      if (!owner || !vault) return null
      const kept = memory.get(key)
      if (kept) return kept
      const lock = loadLock(mode, vault.accountId, owner)
      if (lock?.method !== 'revoke') return null
      const step: StepState = { status: 'checking', job: lock.job }
      return { owner: owner.toLowerCase(), createdAt: lock.postedAt ?? Date.now(), vault, steps: { revoke: step } }
    },
    save: r => { memory.set(key, r) },
    active: r => (r.steps.revoke.status === 'done' ? null : 'revoke'),
    done: r => r.steps.revoke.status === 'done',
    vault: r => r.vault,
    drivers: { revoke: revokeStep },
    // the finished record stays (Done on the card); the agent card, panel and position re-read
    finish: r => r,
    invalidate: [['agent'], ['verification'], ['position'], ['discovery']],
    onFinished,
  })
}
