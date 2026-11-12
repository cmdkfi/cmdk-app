// Step-chain runner shared by S4 onboarding (useOnboarding.ts) and S6 close (useClose.ts): PRD D11, FR-5/5a/6/8, R4.
// Rules:
// - one step at a time, one open wallet prompt at a time; after a reload nothing prompts until Continue (armed);
// - every state change is written to the record before the next await, so a reload resumes where it stopped;
// - a step is done only when its chain check holds; "submitted"/"confirming" never count as done;
// - an account or chain change stops the run (the record is re-keyed to the new owner by the caller);
// - on another chain every user action requests the switch to Base Sepolia itself, and the active step says so with a
//   Switch button; it never waits in silence (Phase 8a, 10 Nov live run).
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address, Hex } from 'viem'
import { useAdapters, useWalletState } from '../adapters/AdapterProvider.tsx'
import { ProtocolError, type JobView, type OwnerIntent, type ProtocolAdapter, type VaultView, type WalletAdapter } from '../adapters/types.ts'
import type { LoadedConfig } from '../flow/config.ts'
import { formatUnits } from '../flow/format.ts'
import { reconcileLock, type OwnerLock } from '../flow/lock.ts'
import { jobPollDelay, patchStep, retryMode, topUpAmount, type RetryKind, type StepState } from '../flow/onboarding.ts'
import { clearLock, loadLock, saveLock } from '../flow/onboarding-record.ts'
import type { Mode } from '../flow/routes.ts'

export type ChainRecord<Id extends string> = { owner: string; createdAt: number; steps: Record<Id, StepState>; autostart?: boolean }

export type Env<Id extends string, R extends ChainRecord<Id>> = {
  app: LoadedConfig
  protocol: ProtocolAdapter
  wallet: WalletAdapter
  mode: Mode
  owner: Address
  get(): R
  update(fn: (r: R) => R): void
  patch(id: Id, patch: Partial<StepState>): void
  /** The vault the owner calls go to (known once onboarding's create step is done). */
  vault(): { accountId: string; baseAddress: Address }
  armed(): boolean
  live(): boolean
  /** A user action waiting for the step it targets (Retry variants). */
  take(id: Id): RetryKind | null
  sleep(ms: number): Promise<void>
}

const now = () => Date.now()

export function rejected(error: unknown): boolean {
  for (let e = error as { code?: number; name?: string; message?: string; cause?: unknown } | undefined, depth = 0; e && depth < 6; e = e.cause as typeof e, depth++) {
    if (e.code === 4001 || /UserRejected/.test(e.name ?? '') || /rejected|denied/i.test(e.message ?? '')) return true
  }
  return false
}

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The connected wallet's name for copy, or "your wallet" (Phase 8). */
function who<Id extends string, R extends ChainRecord<Id>>(env: Env<Id, R>): string {
  const s = env.wallet.getState()
  return s.status === 'connected' && s.walletName ? s.walletName : 'your wallet'
}
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export const SWITCH_LINE = 'Switch to Base Sepolia in your wallet.'

/** Run a wallet prompt; a rejection pauses the step with Retry and returns null. */
export async function prompted<Id extends string, R extends ChainRecord<Id>, T>(env: Env<Id, R>, id: Id, action: () => Promise<T>): Promise<T | null> {
  env.patch(id, { status: 'prompting', pause: undefined })
  try {
    return await action()
  } catch (error) {
    if (!env.live()) return null
    if (rejected(error)) env.patch(id, { status: 'paused', pause: { line: `You declined the request in ${who(env)}. Nothing was sent.`, retry: 'prompt' } })
    else env.patch(id, { status: 'paused', pause: { line: `${capital(who(env))} returned an error. Nothing was confirmed.`, text: message(error), retry: 'prompt' } })
    return null
  }
}

/** Wait until every receipt has status 1 and two confirmations (FR-5); a revert or a 180 s wait pauses the step. */
export async function confirmed<Id extends string, R extends ChainRecord<Id>>(env: Env<Id, R>, id: Id, hashes: Hex[]): Promise<boolean> {
  if (hashes.length === 0) return true
  const started = now()
  env.patch(id, { status: 'confirming' })
  for (;;) {
    if (!env.live()) return false
    const receipts = await env.protocol.readReceipts(env.app, hashes).catch(() => null)
    if (receipts?.some(r => r.status === 'reverted')) {
      env.patch(id, { status: 'paused', pause: { line: 'A Base transaction reverted. Check it on BaseScan before trying again.', text: receipts.filter(r => r.status === 'reverted').map(r => r.hash).join(', '), retry: 'check' } })
      return false
    }
    if (receipts && receipts.every(r => r.status === 'success' && r.confirmations >= 2)) return true
    if (now() - started > 180_000) {
      env.patch(id, { status: 'paused', pause: { line: 'Still waiting for two confirmations on Base.', text: hashes.join(', '), retry: 'check' } })
      return false
    }
    await env.sleep(2_000)
  }
}

/** FR-5 job polling. Returns the finished job, 'lost' (404 or unanswerable), or null when paused ("Still waiting"). */
export async function pollJob<Id extends string, R extends ChainRecord<Id>>(env: Env<Id, R>, id: Id, job: string): Promise<JobView | 'lost' | null> {
  const started = now()
  for (;;) {
    if (!env.live()) return null
    try {
      const j = await env.protocol.readJob(env.app, job)
      if (j.stage === 'done' || j.stage === 'failed') return j
    } catch (error) {
      if (error instanceof ProtocolError && error.kind === 'lost') return 'lost'
    }
    const delay = jobPollDelay(now() - started)
    if (delay === null) {
      env.patch(id, { status: 'paused', pause: { line: 'Still waiting for the relayer. The job keeps running on its side.', job, retry: 'check' } })
      return null
    }
    await env.sleep(delay)
  }
}

// ---- owner calls (FR-6) --------------------------------------------------------------------------------------------

export type OwnerSpec<Id extends string, R extends ChainRecord<Id>> = {
  id: Id
  /** The chain shows the step's result. */
  complete(v: VaultView, env: Env<Id, R>): boolean
  /** Nothing to do (e.g. no USDC to withdraw). */
  skip?(v: VaultView, env: Env<Id, R>): boolean
  /** Checks before the prompt; returns the intent, or null when the step paused. `action` is the user's pending choice. */
  intent(v: VaultView, env: Env<Id, R>, action: RetryKind | null): Promise<OwnerIntent | null>
  doneNote?(v: VaultView, env: Env<Id, R>): string | undefined
}

/**
 * The setup owner call's intent, shared by S4 setup and the S5 re-approval (Phase 7c). Phase 7b item 1a: approving a
 * measurement the published manifest no longer names costs a signature and leaves the vault unwatched (v10, 9 Nov),
 * so the measurement baked into config.json (the one setupArgs sends) is compared with the manifest right before the
 * prompt; a mismatch pauses the step. Setup approves the executor stored in the vault, and anyone can create a vault for
 * any owner with any policy, so a vault (from the fresh read `v`) without the published markets, executor and cooldown
 * is refused before the prompt.
 */
export const CONFIG_BEHIND = 'This app\'s configuration is behind the published agent version; try again later.'
export const POLICY_MISMATCH = 'This vault\'s markets, tokens, Executor, slice limit or cooldown differ from the published deployment, so no signature is requested. Anyone can create a vault for any address; this app sets up only vaults with the published settings.'

export async function setupIntent<Id extends string, R extends ChainRecord<Id>>(env: Env<Id, R>, id: Id, v: VaultView): Promise<OwnerIntent | null> {
  if (!v.policyMatches) { env.patch(id, { status: 'paused', pause: { line: POLICY_MISMATCH } }); return null }
  if (await env.protocol.configMatchesPublished(env.app)) return { method: 'setup' }
  env.patch(id, { status: 'paused', pause: { line: CONFIG_BEHIND, retry: 'check' } })
  return null
}

type Outcome = boolean | 'resign'

async function finishOwnerCall<Id extends string, R extends ChainRecord<Id>>(env: Env<Id, R>, spec: OwnerSpec<Id, R>, lock: OwnerLock): Promise<boolean> {
  const v = await env.protocol.readVault(env.app, lock.vault)
  clearLock(env.mode, lock.vault, env.owner)
  if (spec.complete(v, env)) { env.patch(spec.id, { status: 'done', pause: undefined, job: undefined, note: spec.doneNote?.(v, env) }); return true }
  env.patch(spec.id, { status: 'paused', job: undefined, pause: { line: 'The call ran, but the chain does not show the expected result. Sign again to retry.', retry: 'resign' } })
  return false
}

/**
 * Lost job or uncertain POST: resolve from owner_nonce and NEAR time only (FR-6, R4). `reason` says why the outcome is
 * unknown; the step shows it with the message's expiry and a countdown (Phase 7b).
 */
async function checkLock<Id extends string, R extends ChainRecord<Id>>(env: Env<Id, R>, spec: OwnerSpec<Id, R>, lock: OwnerLock, reason: string): Promise<Outcome> {
  env.patch(spec.id, { status: 'checking', pause: undefined, check: { reason, expiry: lock.expiry } })
  for (;;) {
    if (!env.live()) return false
    const [v, nearNow] = await Promise.all([env.protocol.readVault(env.app, lock.vault), env.protocol.readNearTime(env.app)]).catch(() => [null, null] as const)
    if (v && nearNow !== null) {
      const verdict = reconcileLock(lock, { ownerNonce: v.ownerNonce, nearNow, job: 'lost' })
      if (verdict === 'executed') { env.patch(spec.id, { check: undefined }); return finishOwnerCall(env, spec, lock) }
      if (verdict === 'pending') env.patch(spec.id, { check: { reason, expiry: lock.expiry, nearNow, readAt: now() } })
      if (verdict === 'expired') {
        clearLock(env.mode, lock.vault, env.owner)
        env.patch(spec.id, { status: 'paused', job: undefined, check: undefined, pause: { line: 'The signed message expired without being used. Sign again.', retry: 'resign' } })
        return false
      }
    }
    await env.sleep(10_000)
  }
}

async function post<Id extends string, R extends ChainRecord<Id>>(env: Env<Id, R>, spec: OwnerSpec<Id, R>, lock: OwnerLock): Promise<Outcome> {
  env.patch(spec.id, { status: 'submitted', pause: undefined })
  try {
    const job = await env.protocol.ownerCall(env.app, lock.vault, lock.message, lock.signature)
    const next = { ...lock, job, postedAt: now() }
    saveLock(env.mode, next)
    env.patch(spec.id, { job, status: 'confirming' })
    return follow(env, spec, next)
  } catch (error) {
    if (error instanceof ProtocolError && error.kind === 'uncertain') return checkLock(env, spec, lock, message(error))
    env.patch(spec.id, { status: 'paused', pause: { line: 'The relayer refused the request before sending anything.', text: message(error), retry: 'resign' } })
    clearLock(env.mode, lock.vault, env.owner)
    return false
  }
}

/** Follow a posted job to its end (FR-5, FR-6, D7). */
async function follow<Id extends string, R extends ChainRecord<Id>>(env: Env<Id, R>, spec: OwnerSpec<Id, R>, lock: OwnerLock): Promise<Outcome> {
  const job = await pollJob(env, spec.id, lock.job!)
  if (job === null) return false
  if (job === 'lost') return checkLock(env, spec, lock, `The relayer no longer knows job ${lock.job} (it may have restarted).`)
  if (job.stage === 'done') {
    if (!await confirmed(env, spec.id, job.receipts.map(r => r.hash))) return false
    return finishOwnerCall(env, spec, lock)
  }
  if (job.httpStatus === 400) return refused(env, spec, lock, job)
  if (/StaleFeed/.test(job.error ?? '')) {
    env.patch(spec.id, { status: 'paused', pause: { line: 'Price feed is stale on testnet; open is retried when it updates.', text: job.error, retry: 'resign' } })
    return checkLock(env, spec, lock, `The relayer reported: ${job.error ?? 'stale price feed'}.`).then(() => false)
  }
  // Failed after the relayer may have reached NEAR: owner_nonce decides (FR-6).
  env.patch(spec.id, { note: job.error })
  return checkLock(env, spec, lock, `The relayer reported a failure after the request may have reached the vault${job.error ? ` (${job.error})` : ''}.`)
}

/** Refused before sending (job failed, http_status 400): the lock stays; the user re-sends or re-signs. */
async function refused<Id extends string, R extends ChainRecord<Id>>(env: Env<Id, R>, spec: OwnerSpec<Id, R>, lock: OwnerLock, job: JobView): Promise<Outcome> {
  const short = env.protocol.fundsShortfall(job.error)
  const step = env.get().steps[spec.id]
  const action = env.take(spec.id)
  const nearNow = await env.protocol.readNearTime(env.app).catch(() => Math.floor(now() / 1000))
  const mode = retryMode(lock.expiry, nearNow)
  if (short) {
    // Reactive gas top-up (FR-8, D7, Q2).
    const topUp = step.topUp && step.topUp.status !== 'done' ? step.topUp : { amountWei: topUpAmount(short.have, short.need).toString(), status: 'needed' as const }
    if (topUp.status === 'confirming' && topUp.txHash) {
      if (!await confirmed(env, spec.id, [topUp.txHash])) return false
      env.patch(spec.id, { topUp: { ...topUp, status: 'done' } })
      return afterTopUp(env, spec, lock, mode)
    }
    if (action === 'topUp') {
      const tx = env.protocol.walletTx(env.app, { kind: 'topUp', to: env.vault().baseAddress, amount: BigInt(topUp.amountWei) })
      env.patch(spec.id, { topUp: { ...topUp, status: 'prompting' } })
      const hash = await prompted(env, spec.id, () => env.wallet.sendTransaction(tx))
      if (!hash) { env.patch(spec.id, { topUp: { ...topUp, status: 'needed' } }); return false }
      env.patch(spec.id, { topUp: { ...topUp, status: 'confirming', txHash: hash } })
      if (!await confirmed(env, spec.id, [hash])) return false
      env.patch(spec.id, { topUp: { ...topUp, status: 'done', txHash: hash } })
      return afterTopUp(env, spec, lock, mode)
    }
    env.patch(spec.id, { status: 'paused', topUp, pause: { line: `Your position address needs more ETH for gas. Send ${formatUnits(BigInt(topUp.amountWei), 18, 6)} ETH from your wallet, then the request goes again.`, text: job.error, retry: 'topUp' } })
    return false
  }
  if (action === 'resend' && mode === 'resend') return post(env, spec, lock)
  if (action === 'resend' || action === 'resign') { clearLock(env.mode, lock.vault, env.owner); env.patch(spec.id, { job: undefined }); return 'resign' }
  env.patch(spec.id, { status: 'paused', pause: { line: mode === 'resend' ? 'The relayer refused the request before sending anything. You can send the same signed message again.' : 'The relayer refused the request before sending anything. The signed message is about to expire; sign again.', text: job.error, retry: mode } })
  return false
}

/** After the top-up confirms: re-post the same message if it is still ≥ 45 s valid, otherwise sign again (D7). */
async function afterTopUp<Id extends string, R extends ChainRecord<Id>>(env: Env<Id, R>, spec: OwnerSpec<Id, R>, lock: OwnerLock, mode: 'resend' | 'resign'): Promise<Outcome> {
  if (mode === 'resend') return post(env, spec, lock)
  clearLock(env.mode, lock.vault, env.owner)
  env.patch(spec.id, { job: undefined })
  return 'resign'
}

/** One owner call: reconcile a pending lock first, then sign `owner_nonce + 1` and post it (FR-6). */
export async function ownerStep<Id extends string, R extends ChainRecord<Id>>(env: Env<Id, R>, spec: OwnerSpec<Id, R>): Promise<boolean> {
  const vault = env.vault()
  for (let round = 0; round < 3; round++) {
    let v = await env.protocol.readVault(env.app, vault.accountId)
    if (v.owner.toLowerCase() !== env.owner.toLowerCase()) {
      env.patch(spec.id, { status: 'paused', pause: { line: 'This vault belongs to another wallet. Connect its owner to continue.' } })
      return false
    }
    const lock = loadLock(env.mode, vault.accountId, env.owner)
    if (lock && lock.method !== spec.id) {
      env.patch(spec.id, { status: 'checking', check: undefined, note: `Waiting for an earlier ${lock.method} request to settle.` })
      return false
    }
    if (lock) {
      const outcome = lock.job ? await follow(env, spec, lock) : await checkLock(env, spec, lock, 'The relayer\'s answer to the signed request was not received.')
      if (outcome !== 'resign') return outcome
      v = await env.protocol.readVault(env.app, vault.accountId)
    } else {
      if (spec.complete(v, env)) { env.patch(spec.id, { status: 'done', pause: undefined, note: spec.doneNote?.(v, env) ?? 'Already on chain' }); return true }
      if (spec.skip?.(v, env)) { env.patch(spec.id, { status: 'skipped', pause: undefined }); return true }
    }
    if (!env.armed()) { env.patch(spec.id, { status: 'waiting' }); return false }
    const intent = await spec.intent(v, env, env.take(spec.id))
    if (!intent || !env.live()) return false
    const [nearNow, before] = await Promise.all([env.protocol.readNearTime(env.app), Promise.resolve(v.ownerNonce)])
    const nonce = before + 1, expiry = nearNow + env.app.guided.messageExpirySecs
    const text = env.protocol.composeOwnerMessage(env.app, v, intent, nonce, expiry)
    const signature = await prompted(env, spec.id, () => env.wallet.signMessage(text))
    if (!signature) return false
    if (!await env.protocol.checkOwnerSignature(text, signature, env.owner)) {
      env.patch(spec.id, { status: 'paused', pause: { line: `${capital(who(env))} signed with a different account than the vault owner. Nothing was sent.`, retry: 'prompt' } })
      return false
    }
    const after = await env.protocol.readVault(env.app, vault.accountId)
    if (after.ownerNonce !== before) {
      env.patch(spec.id, { status: 'paused', pause: { line: 'The vault changed while you were signing. Nothing was sent; sign again.', retry: 'prompt' } })
      return false
    }
    const next: OwnerLock = { vault: vault.accountId, owner: env.owner.toLowerCase(), method: spec.id, nonce, expiry, message: text, signature }
    saveLock(env.mode, next)
    const outcome = await post(env, spec, next)
    if (outcome !== 'resign') return outcome
  }
  return false
}

// ---- hook -----------------------------------------------------------------------------------------------------------

export type ChainOptions<Id extends string, R extends ChainRecord<Id>> = {
  mode: Mode
  app: LoadedConfig | undefined
  owner: Address | undefined
  chainOk: boolean
  /** Changes when the record identity changes (owner, factory, vault): the run stops and the record is reloaded. */
  key: string
  load(): R | null
  save(r: R): void
  active(r: R): Id | null
  /** A record that is already finished (e.g. the closed marker): nothing runs. */
  done?(r: R): boolean
  vault(r: R): { accountId: string; baseAddress: Address } | undefined
  drivers: Record<Id, (env: Env<Id, R>) => Promise<boolean>>
  /** When every step is finished: clear storage and return the record to keep (null drops it). */
  finish(r: R): R | null
  /** Queries to refresh once finished, before onFinished. */
  invalidate: QueryKey[]
  onFinished(): void
}

export type Chain<Id extends string, R extends ChainRecord<Id>> = {
  record: R | null
  running: boolean
  /** Arm the chain and run (the first click already armed it; after a reload this is "Continue"). */
  start(): void
  /** A paused step's action. */
  act(id: Id, kind: RetryKind): void
  /** Store a new record and start. */
  begin(record: R): void
}

export function useStepChain<Id extends string, R extends ChainRecord<Id>>(o: ChainOptions<Id, R>): Chain<Id, R> {
  const { protocol, wallet } = useAdapters()
  const queryClient = useQueryClient()
  const walletState = useWalletState()
  const { mode, app, owner, chainOk, key } = o
  // connected, but to another chain than Base Sepolia (the caller's chainOk also covers "not connected")
  const wrongChain = walletState.status === 'connected' && !chainOk
  const [record, setRecord] = useState<R | null>(null)
  const [running, setRunning] = useState(false)
  const ref = useRef<R | null>(null)
  const armed = useRef(false), busy = useRef(false), epoch = useRef(0)
  const actions = useRef(new Map<Id, RetryKind>())
  const opts = useRef(o)
  opts.current = o

  const commit = useCallback((next: R | null) => {
    ref.current = next
    if (next) opts.current.save(next)
    setRecord(next)
  }, [])

  // Re-key on owner, factory or vault change: stop the run, load that record, never prompt until armed.
  useEffect(() => {
    epoch.current++
    armed.current = false
    actions.current.clear()
    const r = opts.current.load()
    ref.current = r
    setRecord(r)
  }, [mode, key])

  /** On another chain the active step says so, with a Switch button (Phase 8a.3). */
  const showSwitch = useCallback(() => {
    const r = ref.current, id = r && opts.current.active(r)
    if (r && id && r.steps[id].pause?.retry !== 'switch') commit(patchStep(r, id, { status: 'paused', pause: { line: SWITCH_LINE, retry: 'switch' } }))
  }, [commit])

  /** Phase 8a.2: an action that needs Base Sepolia requests the switch (adding the chain when the wallet lacks it); once the wallet reports Base Sepolia the effects below continue the run. */
  const requestSwitch = useCallback(async () => {
    const a = opts.current.app
    if (!a) return
    try { await wallet.switchToBaseSepolia(a.guided.network) } catch { showSwitch() }
  }, [wallet, showSwitch])

  // A chain change stops the run and the active step shows the switch line; back on Base Sepolia the line gives way
  // to the step's own state and the run continues (armed only if the user acted).
  useEffect(() => {
    if (chainOk) {
      const r = ref.current, id = r && opts.current.active(r)
      if (r && id && r.steps[id].pause?.retry === 'switch') commit(patchStep(r, id, { status: 'waiting', pause: undefined }))
      return
    }
    epoch.current++
    armed.current = false
    if (wrongChain) showSwitch()
  }, [chainOk, wrongChain, commit, showSwitch])

  const run = useCallback(async () => {
    const { app: a, owner: w, chainOk: ok } = opts.current
    if (busy.current || !a || !w || !ok || !ref.current || opts.current.done?.(ref.current)) return
    busy.current = true
    setRunning(true)
    const my = epoch.current
    const env: Env<Id, R> = {
      app: a, protocol, wallet, mode, owner: w,
      get: () => ref.current!,
      update: fn => { if (epoch.current === my && ref.current) commit(fn(ref.current)) },
      patch: (id, p) => { if (epoch.current === my && ref.current) commit(patchStep(ref.current, id, p)) },
      vault: () => { const v = opts.current.vault(ref.current!); if (!v) throw new Error('The vault is not known yet.'); return v },
      armed: () => armed.current && epoch.current === my,
      live: () => epoch.current === my,
      take: id => { const kind = actions.current.get(id) ?? null; actions.current.delete(id); return kind },
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    }
    try {
      for (;;) {
        if (!env.live()) return
        const id = opts.current.active(env.get())
        if (!id) {
          const next = opts.current.finish(env.get())
          if (next) commit(next)
          else { ref.current = null; setRecord(null) }
          for (const queryKey of opts.current.invalidate) await queryClient.invalidateQueries({ queryKey })
          opts.current.onFinished()
          return
        }
        if (!await opts.current.drivers[id](env)) return
      }
    } catch (error) {
      const r = ref.current, id = r && opts.current.active(r)
      if (r && id && epoch.current === my) commit(patchStep(r, id, { status: 'paused', pause: { line: 'A read failed, so nothing more was requested.', text: message(error), retry: 'check' } }))
    } finally {
      if (epoch.current === my) { busy.current = false; setRunning(false) }
      else busy.current = false
    }
  }, [protocol, wallet, mode, commit, queryClient])

  // On load and after re-keying: reconcile (reads only, nothing prompts) — or arm once after the first click.
  useEffect(() => {
    const r = ref.current
    if (!r || !app || !owner || !chainOk) return
    if (r.autostart) { armed.current = true; commit({ ...r, autostart: undefined }) }
    void run()
  }, [record?.createdAt, record?.owner, app, owner, chainOk, run, commit])

  // every user action: on another chain the switch is requested first, and the run continues when it lands
  const go = () => { if (opts.current.chainOk) void run(); else void requestSwitch() }
  return {
    record, running,
    start: () => { armed.current = true; go() },
    act: (id, kind) => {
      armed.current = true
      if (kind !== 'switch') actions.current.set(id, kind)
      const r = ref.current
      if (r) {
        let next = patchStep(r, id, { status: 'waiting', pause: undefined })
        if (kind === 'post') next = patchStep(next, id, { job: undefined })
        if (kind === 'prompt') next = patchStep(next, id, { txHash: undefined })
        commit(next)
      }
      go()
    },
    begin: next => { armed.current = true; commit(next); go() },
  }
}
