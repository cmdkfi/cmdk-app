// S4 effects runner (PRD S4, D11, FR-5/5a/6/7/8, R1, R2, R4). The only place S4 calls adapters. Rules:
// - one step at a time, one open MetaMask prompt at a time; after a reload nothing prompts until Continue (armed);
// - every state change is written to the record before the next await, so a reload resumes where it stopped;
// - a step is done only when its chain check holds; "submitted"/"confirming" never count as done;
// - an account or chain change stops the run (the record is re-keyed to the new owner by the caller).
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address, Hex } from 'viem'
import { useAdapters } from '../adapters/AdapterProvider.tsx'
import { ProtocolError, type AgentRegistration, type JobView, type OwnerIntent, type ProtocolAdapter, type VaultView, type WalletAdapter } from '../adapters/types.ts'
import type { LoadedConfig } from '../flow/config.ts'
import { formatUnits, formatWadPercent } from '../flow/format.ts'
import { reconcileLock, type OwnerLock } from '../flow/lock.ts'
import { activeStep, belowShown, jobPollDelay, patchStep, retryMode, topUpAmount, type OnboardingRecord, type RetryKind, type StepId, type StepState } from '../flow/onboarding.ts'
import { clearLock, clearRecord, loadLock, loadRecord, saveLock, saveRecord } from '../flow/onboarding-record.ts'
import type { Mode } from '../flow/routes.ts'

type Env = {
  app: LoadedConfig
  protocol: ProtocolAdapter
  wallet: WalletAdapter
  mode: Mode
  owner: Address
  get(): OnboardingRecord
  patch(id: StepId, patch: Partial<StepState>): void
  setVault(vault: NonNullable<OnboardingRecord['vault']>): void
  armed(): boolean
  live(): boolean
  /** A user action waiting for the step it targets (Retry variants). */
  take(id: StepId): RetryKind | null
  sleep(ms: number): Promise<void>
}

const now = () => Date.now()

function rejected(error: unknown): boolean {
  for (let e = error as { code?: number; name?: string; message?: string; cause?: unknown } | undefined, depth = 0; e && depth < 6; e = e.cause as typeof e, depth++) {
    if (e.code === 4001 || /UserRejected/.test(e.name ?? '') || /rejected|denied/i.test(e.message ?? '')) return true
  }
  return false
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Run a MetaMask prompt; a rejection pauses the step with Retry and returns null. */
async function prompted<T>(env: Env, id: StepId, action: () => Promise<T>): Promise<T | null> {
  env.patch(id, { status: 'prompting', pause: undefined })
  try {
    return await action()
  } catch (error) {
    if (!env.live()) return null
    if (rejected(error)) env.patch(id, { status: 'paused', pause: { line: 'You declined the request in MetaMask. Nothing was sent.', retry: 'prompt' } })
    else env.patch(id, { status: 'paused', pause: { line: 'MetaMask returned an error. Nothing was confirmed.', text: message(error), retry: 'prompt' } })
    return null
  }
}

/** Wait until every receipt has status 1 and two confirmations (FR-5); a revert or a 180 s wait pauses the step. */
async function confirmed(env: Env, id: StepId, hashes: Hex[]): Promise<boolean> {
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
async function pollJob(env: Env, id: StepId, job: string): Promise<JobView | 'lost' | null> {
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

// ---- create (no prompt) -------------------------------------------------------------------------------------------

/**
 * Before any repeat of the create POST (lost job, uncertain response, Retry): re-run discovery and adopt a vault that
 * appeared meanwhile (PRD S4 step 1, FR-6). 'none' only when the scan completed and found no vault from the cutoff.
 */
async function rediscover(env: Env): Promise<'adopted' | 'none' | 'unknown'> {
  env.patch('create', { status: 'checking', pause: undefined, note: 'Checking whether the vault was created…' })
  const found = await env.protocol.discoverPosition(env.app, env.owner).catch(() => undefined)
  if (found === undefined) {
    env.patch('create', { status: 'paused', note: undefined, pause: { line: 'Your vaults could not be read. Nothing is created until they can be.', retry: 'check' } })
    return 'unknown'
  }
  if (found) {
    env.setVault({ accountId: found.vault.accountId, number: found.vault.number, baseAddress: found.vault.baseAddress })
    env.patch('create', { status: 'done', job: undefined, note: 'Your vault was found on NEAR; it is used as is.' })
    return 'adopted'
  }
  return 'none'
}

async function adoptOrPause(env: Env): Promise<boolean> {
  const found = await rediscover(env)
  if (found === 'none') env.patch('create', { status: 'paused', job: undefined, note: undefined, pause: { line: 'The relayer lost the request and no vault exists yet. You can ask again.', retry: 'post' } })
  return found === 'adopted'
}

async function createStep(env: Env): Promise<boolean> {
  const r = env.get()
  if (r.vault) { env.patch('create', { status: 'done' }); return true }
  const step = r.steps.create
  if (step.job) {
    env.patch('create', { status: 'confirming', pause: undefined })
    const job = await pollJob(env, 'create', step.job)
    if (job === null) return false
    if (job === 'lost') return adoptOrPause(env)
    if (job.vault && job.baseAddress) env.setVault({ accountId: job.vault, number: Number(/^v(\d+)\./.exec(job.vault)?.[1] ?? 0), baseAddress: job.baseAddress })
    if (job.stage === 'done') { env.patch('create', { status: 'done', job: undefined }); return true }
    if (job.vault) { env.patch('create', { status: 'done', job: undefined, note: 'Vault created; the relayer did not send its gas float. The gas step tops it up if needed.' }); return true }
    env.patch('create', { status: 'paused', job: undefined, pause: { line: 'The relayer could not create the vault.', text: job.error, retry: 'post' } })
    return false
  }
  const action = env.take('create')
  if (!env.armed()) { env.patch('create', { status: 'waiting' }); return false }
  // Before any repeat of the POST, re-run discovery and adopt a vault that appeared meanwhile (PRD S4 step 1, FR-6).
  if (step.attempted) {
    const found = await rediscover(env)
    if (found === 'adopted') return true
    if (found === 'unknown') return false
    if (action !== 'post') {
      env.patch('create', { status: 'paused', note: undefined, pause: { line: 'No vault exists yet for this wallet. You can ask the relayer again.', retry: 'post' } })
      return false
    }
  }
  const readiness = await env.protocol.relayerReadiness(env.app).catch(error => ({ kind: 'failed' as const, message: message(error) }))
  if (readiness.kind !== 'ready') { env.patch('create', { status: 'paused', pause: { line: 'Creation is temporarily unavailable.', text: readiness.message, retry: 'post' } }); return false }
  env.patch('create', { status: 'submitted', attempted: true, pause: undefined, note: undefined })
  try {
    const job = await env.protocol.createVault(env.app, env.owner)
    env.patch('create', { job })
    return createStep(env)
  } catch (error) {
    if (error instanceof ProtocolError && error.kind === 'rate-limited') {
      env.patch('create', { status: 'paused', pause: { line: 'The relayer limits vault creation per hour. Try again when the countdown ends.', text: error.message, retryAfter: error.retryAfter, since: now(), retry: 'post' } })
      return false
    }
    if (error instanceof ProtocolError && error.kind === 'uncertain') return adoptOrPause(env)
    env.patch('create', { status: 'paused', pause: { line: 'The relayer refused the request.', text: message(error), retry: 'post' } })
    return false
  }
}

// ---- owner calls: setup, open, withdraw (FR-6) -------------------------------------------------------------------

type OwnerSpec = {
  id: 'setup' | 'open' | 'withdraw'
  /** The chain shows the step's result. */
  complete(v: VaultView, env: Env): boolean
  /** Nothing to do (e.g. no USDC to withdraw). */
  skip?(v: VaultView, env: Env): boolean
  /** Checks before the prompt; returns the intent, or null when the step paused. `action` is the user's pending choice. */
  intent(v: VaultView, env: Env, action: RetryKind | null): Promise<OwnerIntent | null>
  doneNote?(v: VaultView, env: Env): string | undefined
}

async function finishOwnerCall(env: Env, spec: OwnerSpec, lock: OwnerLock): Promise<boolean> {
  const v = await env.protocol.readVault(env.app, lock.vault)
  clearLock(env.mode, lock.vault, env.owner)
  if (spec.complete(v, env)) { env.patch(spec.id, { status: 'done', pause: undefined, job: undefined, note: spec.doneNote?.(v, env) }); return true }
  env.patch(spec.id, { status: 'paused', job: undefined, pause: { line: 'The call ran, but the chain does not show the expected result. Sign again to retry.', retry: 'resign' } })
  return false
}

/** Lost job or uncertain POST: resolve from owner_nonce and NEAR time only (FR-6, R4). */
async function checkLock(env: Env, spec: OwnerSpec, lock: OwnerLock): Promise<boolean | 'resign'> {
  env.patch(spec.id, { status: 'checking', pause: undefined })
  for (;;) {
    if (!env.live()) return false
    const [v, nearNow] = await Promise.all([env.protocol.readVault(env.app, lock.vault), env.protocol.readNearTime(env.app)]).catch(() => [null, null] as const)
    if (v && nearNow !== null) {
      const verdict = reconcileLock(lock, { ownerNonce: v.ownerNonce, nearNow, job: 'lost' })
      if (verdict === 'executed') return finishOwnerCall(env, spec, lock)
      if (verdict === 'expired') {
        clearLock(env.mode, lock.vault, env.owner)
        env.patch(spec.id, { status: 'paused', job: undefined, pause: { line: 'The signed message expired without being used. Sign again.', retry: 'resign' } })
        return false
      }
    }
    await env.sleep(10_000)
  }
}

async function post(env: Env, spec: OwnerSpec, lock: OwnerLock): Promise<boolean | 'resign'> {
  env.patch(spec.id, { status: 'submitted', pause: undefined })
  try {
    const job = await env.protocol.ownerCall(env.app, lock.vault, lock.message, lock.signature)
    const next = { ...lock, job, postedAt: now() }
    saveLock(env.mode, next)
    env.patch(spec.id, { job, status: 'confirming' })
    return follow(env, spec, next)
  } catch (error) {
    if (error instanceof ProtocolError && error.kind === 'uncertain') return checkLock(env, spec, lock)
    env.patch(spec.id, { status: 'paused', pause: { line: 'The relayer refused the request before sending anything.', text: message(error), retry: 'resign' } })
    clearLock(env.mode, lock.vault, env.owner)
    return false
  }
}

/** Follow a posted job to its end (FR-5, FR-6, D7). */
async function follow(env: Env, spec: OwnerSpec, lock: OwnerLock): Promise<boolean | 'resign'> {
  const job = await pollJob(env, spec.id, lock.job!)
  if (job === null) return false
  if (job === 'lost') return checkLock(env, spec, lock)
  if (job.stage === 'done') {
    if (!await confirmed(env, spec.id, job.receipts.map(r => r.hash))) return false
    return finishOwnerCall(env, spec, lock)
  }
  if (job.httpStatus === 400) return refused(env, spec, lock, job)
  if (/StaleFeed/.test(job.error ?? '')) {
    env.patch(spec.id, { status: 'paused', pause: { line: 'Price feed is stale on testnet; open is retried when it updates.', text: job.error, retry: 'resign' } })
    return checkLock(env, spec, lock).then(() => false)
  }
  // Failed after the relayer may have reached NEAR: owner_nonce decides (FR-6).
  env.patch(spec.id, { note: job.error })
  return checkLock(env, spec, lock)
}

/** Refused before sending (job failed, http_status 400): the lock stays; the user re-sends or re-signs. */
async function refused(env: Env, spec: OwnerSpec, lock: OwnerLock, job: JobView): Promise<boolean | 'resign'> {
  const vault = env.get().vault!
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
      const tx = env.protocol.walletTx(env.app, { kind: 'topUp', to: vault.baseAddress, amount: BigInt(topUp.amountWei) })
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
async function afterTopUp(env: Env, spec: OwnerSpec, lock: OwnerLock, mode: 'resend' | 'resign'): Promise<boolean | 'resign'> {
  if (mode === 'resend') return post(env, spec, lock)
  clearLock(env.mode, lock.vault, env.owner)
  env.patch(spec.id, { job: undefined })
  return 'resign'
}

async function ownerStep(env: Env, spec: OwnerSpec): Promise<boolean> {
  const vault = env.get().vault!
  for (let round = 0; round < 3; round++) {
    let v = await env.protocol.readVault(env.app, vault.accountId)
    if (v.owner.toLowerCase() !== env.owner.toLowerCase()) {
      env.patch(spec.id, { status: 'paused', pause: { line: 'This vault belongs to another wallet. Connect its owner to continue.' } })
      return false
    }
    const lock = loadLock(env.mode, vault.accountId, env.owner)
    if (lock && lock.method !== spec.id) {
      env.patch(spec.id, { status: 'checking', note: `Waiting for an earlier ${lock.method} request to settle.` })
      return false
    }
    if (lock) {
      const outcome = lock.job ? await follow(env, spec, lock) : await checkLock(env, spec, lock)
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
      env.patch(spec.id, { status: 'paused', pause: { line: 'MetaMask signed with a different account than the vault owner. Nothing was sent.', retry: 'prompt' } })
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

const live = (env: Env, v: VaultView) => v.markets.find(m => m.id.toLowerCase() === env.app.guided.liveMarket.id.toLowerCase())

const setupSpec: OwnerSpec = {
  id: 'setup',
  complete: v => v.setupComplete,
  intent: async () => ({ method: 'setup' }),
}

const openSpec: OwnerSpec = {
  id: 'open',
  complete: (v, env) => (live(env, v)?.collateral ?? 0n) > 0n,
  doneNote: (_v, env) => {
    const below = env.get().steps.open.belowTarget
    return below ? `Opened below target (${formatWadPercent(BigInt(below))})` : undefined
  },
  async intent(v, env, action) {
    const collateralIn = v.idle.weth
    if (collateralIn === 0n) { env.patch('open', { status: 'paused', pause: { line: 'There is no WETH at your position address to open with.', retry: 'check' } }); return null }
    for (;;) {
      const plan = await env.protocol.readOpenPlan(env.app, v, collateralIn)
      if (!env.live()) return null
      if (!plan.feedsFresh) {
        env.patch('open', { status: 'stale', pause: { line: 'Price feed is stale on testnet; retrying every 30 s.' } })
        await env.sleep(30_000)
        continue
      }
      env.patch('open', { pause: undefined })
      if (plan.value === null || plan.lendable === null) { env.patch('open', { status: 'paused', pause: { line: 'The market could not be read, so no signature is requested.', retry: 'prompt' } }); return null }
      if (plan.lendable < 10n ** BigInt(plan.loanDecimals)) {
        env.patch('open', { status: 'paused', pause: { line: 'The market has less than 1 USDC to lend right now. Nothing is signed; try again later.', retry: 'prompt' } })
        return null
      }
      const shown = env.get().shownLtv === null ? null : BigInt(env.get().shownLtv!)
      if (action !== 'accept' && belowShown(shown, plan.targetLtv)) {
        env.patch('open', { status: 'paused', pause: { line: `The market can lend less than before: your position would open at ${formatWadPercent(plan.targetLtv)} LTV instead of ${formatWadPercent(shown!)}.`, retry: 'accept' } })
        return null
      }
      env.patch('open', { belowTarget: plan.belowTarget ? plan.targetLtv.toString() : undefined, note: plan.belowTarget ? `Opens at ${formatWadPercent(plan.targetLtv)} LTV: the market cannot lend the full 50% now.` : undefined })
      return { method: 'open', collateralIn, targetLtv: plan.targetLtv }
    }
  },
}

const withdrawSpec: OwnerSpec = {
  id: 'withdraw',
  // PRD S4 step 6 (Phase 3 note): job done and the USDC idle at the position address below usdcDust.
  complete: (v, env) => env.get().steps.withdraw.job !== undefined && v.idle.usdc <= env.app.guided.usdcDust,
  skip: (v, env) => v.idle.usdc <= env.app.guided.usdcDust,
  intent: async (v, env) => ({ method: 'withdraw', amount: v.idle.usdc, destination: env.owner }),
}

// ---- wallet transactions: wrap and transfer (FR-7) ---------------------------------------------------------------

async function wrapStep(env: Env): Promise<boolean> {
  const r = env.get()
  if (r.amountWei === null) { env.patch('wrap', { status: 'paused', pause: { line: 'Choose how much ETH to deposit first.' } }); return false }
  const amount = BigInt(r.amountWei)
  const tokens = () => env.protocol.readWalletTokens(env.app, env.owner)
  if (r.steps.wrap.txHash) {
    if (!await confirmed(env, 'wrap', [r.steps.wrap.txHash])) return false
    if ((await tokens()).weth >= amount) { env.patch('wrap', { status: 'done', pause: undefined }); return true }
    env.patch('wrap', { status: 'paused', txHash: undefined, pause: { line: 'The wrap confirmed, but your wallet still holds less WETH than the deposit.', retry: 'prompt' } })
    return false
  }
  const t = await tokens()
  if (t.weth >= amount) { env.patch('wrap', { status: 'skipped', note: 'Your wallet already holds enough WETH.' }); return true }
  if (!env.armed()) { env.patch('wrap', { status: 'waiting' }); return false }
  const missing = amount - t.weth
  if (t.eth <= missing) { env.patch('wrap', { status: 'paused', pause: { line: 'Your wallet needs more Base Sepolia ETH to wrap the missing WETH and pay gas.', retry: 'prompt' } }); return false }
  const hash = await prompted(env, 'wrap', () => env.wallet.sendTransaction(env.protocol.walletTx(env.app, { kind: 'wrap', amount: missing })))
  if (!hash) return false
  env.patch('wrap', { txHash: hash, status: 'submitted', note: `Wrapping ${formatUnits(missing, 18, 6)} ETH` })
  return wrapStep(env)
}

async function transferStep(env: Env): Promise<boolean> {
  const r = env.get(), vault = r.vault!
  if (r.amountWei === null) { env.patch('transfer', { status: 'paused', pause: { line: 'Choose how much ETH to deposit first.' } }); return false }
  const amount = BigInt(r.amountWei)
  const atPosition = async () => (await env.protocol.readVault(env.app, vault.accountId)).idle.weth >= amount
  if (r.steps.transfer.txHash) {
    if (!await confirmed(env, 'transfer', [r.steps.transfer.txHash])) return false
    if (await atPosition()) { env.patch('transfer', { status: 'done', pause: undefined }); return true }
    env.patch('transfer', { status: 'paused', txHash: undefined, pause: { line: 'The transfer confirmed, but the position address shows less WETH than the deposit.', retry: 'check' } })
    return false
  }
  if (await atPosition()) { env.patch('transfer', { status: 'done', note: 'Already at your position address' }); return true }
  if (!env.armed()) { env.patch('transfer', { status: 'waiting' }); return false }
  const hash = await prompted(env, 'transfer', () => env.wallet.sendTransaction(env.protocol.walletTx(env.app, { kind: 'transfer', to: vault.baseAddress, amount })))
  if (!hash) return false
  env.patch('transfer', { txHash: hash, status: 'submitted' })
  return transferStep(env)
}

const DRIVERS: Record<StepId, (env: Env) => Promise<boolean>> = {
  create: createStep,
  setup: env => ownerStep(env, setupSpec),
  wrap: wrapStep,
  transfer: transferStep,
  open: env => ownerStep(env, openSpec),
  withdraw: env => ownerStep(env, withdrawSpec),
}

// ---- hook ---------------------------------------------------------------------------------------------------------

export type Onboarding = {
  record: OnboardingRecord | null
  running: boolean
  registration: AgentRegistration['state'] | null
  /** Arm the chain and run (Create position already armed it; after a reload this is "Continue"). */
  start(): void
  /** A paused step's action. */
  act(id: StepId, kind: RetryKind): void
  /** Store a new record (Create position / Continue on a discovered vault) and start. */
  begin(record: OnboardingRecord): void
}

export function useOnboarding(mode: Mode, app: LoadedConfig | undefined, owner: Address | undefined, chainOk: boolean, onFinished: () => void): Onboarding {
  const { protocol, wallet } = useAdapters()
  const queryClient = useQueryClient()
  const factory = app?.config.near.factory
  const [record, setRecord] = useState<OnboardingRecord | null>(null)
  const [running, setRunning] = useState(false)
  const [registration, setRegistration] = useState<AgentRegistration['state'] | null>(null)
  const ref = useRef<OnboardingRecord | null>(null)
  const armed = useRef(false), busy = useRef(false), epoch = useRef(0)
  const actions = useRef(new Map<StepId, RetryKind>())
  const deps = useRef({ app, owner, chainOk, onFinished })
  deps.current = { app, owner, chainOk, onFinished }

  const commit = useCallback((next: OnboardingRecord | null) => {
    ref.current = next
    if (next) saveRecord(mode, next)
    setRecord(next)
  }, [mode])

  // Re-key on owner (or factory) change: stop the run, load that owner's record, never prompt until armed.
  useEffect(() => {
    epoch.current++
    armed.current = false
    actions.current.clear()
    const r = owner && factory ? loadRecord(mode, factory, owner) : null
    ref.current = r
    setRecord(r)
  }, [mode, factory, owner])

  // A chain change stops the run; a step that was prompting is paused.
  useEffect(() => {
    if (chainOk) return
    epoch.current++
    armed.current = false
    const r = ref.current, id = r && activeStep(r)
    if (r && id && r.steps[id].status === 'prompting') commit(patchStep(r, id, { status: 'paused', pause: { line: 'The wallet left Base Sepolia. Switch back, then continue.', retry: 'prompt' } }))
  }, [chainOk, commit])

  const run = useCallback(async () => {
    const { app: a, owner: o, chainOk: ok } = deps.current
    if (busy.current || !a || !o || !ok || !ref.current) return
    busy.current = true
    setRunning(true)
    const my = epoch.current
    const env: Env = {
      app: a, protocol, wallet, mode, owner: o,
      get: () => ref.current!,
      patch: (id, p) => { if (epoch.current === my && ref.current) commit(patchStep(ref.current, id, p)) },
      setVault: vault => { if (epoch.current === my && ref.current) commit({ ...ref.current, vault }) },
      armed: () => armed.current && epoch.current === my,
      live: () => epoch.current === my,
      take: id => { const kind = actions.current.get(id) ?? null; actions.current.delete(id); return kind },
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    }
    try {
      for (;;) {
        if (!env.live()) return
        const id = activeStep(env.get())
        if (!id) {
          const r = env.get()
          clearRecord(mode, r.factory, r.owner)
          if (r.vault) clearLock(mode, r.vault.accountId, o)
          ref.current = null
          setRecord(null)
          await queryClient.invalidateQueries({ queryKey: ['discovery'] })
          deps.current.onFinished()
          return
        }
        if (!await DRIVERS[id](env)) return
      }
    } catch (error) {
      const r = ref.current, id = r && activeStep(r)
      if (r && id && epoch.current === my) commit(patchStep(r, id, { status: 'paused', pause: { line: 'A read failed, so nothing more was requested.', text: message(error), retry: 'check' } }))
    } finally {
      if (epoch.current === my) { busy.current = false; setRunning(false) }
      else busy.current = false
    }
  }, [protocol, wallet, mode, commit, queryClient])

  // On load and after re-keying: reconcile (reads only, nothing prompts) — or arm once after Create position.
  useEffect(() => {
    const r = ref.current
    if (!r || !app || !owner || !chainOk) return
    if (r.autostart) { armed.current = true; commit({ ...r, autostart: undefined }) }
    void run()
  }, [record?.createdAt, record?.owner, app, owner, chainOk, run, commit])

  // Agent registration (step 3): non-blocking, every 30 s while S4 is shown.
  const vaultId = record?.vault?.accountId
  useEffect(() => {
    if (!app || !vaultId) return
    let stop = false
    const check = async () => { const r = await protocol.readAgentRegistration(app, vaultId).catch(() => ({ state: 'unavailable' as const })); if (!stop) setRegistration(r.state) }
    void check()
    const timer = window.setInterval(check, 30_000)
    return () => { stop = true; window.clearInterval(timer) }
  }, [app, vaultId, protocol])

  return {
    record, running, registration,
    start: () => { armed.current = true; void run() },
    act: (id, kind) => {
      armed.current = true
      actions.current.set(id, kind)
      const r = ref.current
      if (r) {
        let next = patchStep(r, id, { status: 'waiting', pause: undefined })
        if (id === 'create' && kind === 'post') next = patchStep(next, 'create', { job: undefined })
        if (kind === 'prompt' && (id === 'wrap' || id === 'transfer')) next = patchStep(next, id, { txHash: undefined })
        commit(next)
      }
      void run()
    },
    begin: next => { armed.current = true; commit(next); void run() },
  }
}

