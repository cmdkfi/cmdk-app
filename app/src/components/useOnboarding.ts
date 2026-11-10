// S4 onboarding (PRD S4, D11, FR-5/5a/6/7/8, R1, R2, R4): the step drivers on the shared runner (runner.ts). The only
// place S4 calls adapters.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { Address } from 'viem'
import { ProtocolError } from '../adapters/types.ts'
import type { LoadedConfig } from '../flow/config.ts'
import { formatUnits, formatWadPercent } from '../flow/format.ts'
import { activeStep, belowShown, type OnboardingRecord, type RetryKind, type StepId } from '../flow/onboarding.ts'
import { clearLock, clearRecord, loadRecord, saveRecord } from '../flow/onboarding-record.ts'
import type { Mode } from '../flow/routes.ts'
import { confirmed, message, ownerStep, pollJob, prompted, setupIntent, useStepChain, type Env as ChainEnv, type OwnerSpec as ChainSpec } from './runner.ts'

type Env = ChainEnv<StepId, OnboardingRecord>
type OwnerSpec = ChainSpec<StepId, OnboardingRecord>

const now = () => Date.now()
const setVault = (env: Env, vault: NonNullable<OnboardingRecord['vault']>) => env.update(r => ({ ...r, vault }))

// ---- create (no prompt) -------------------------------------------------------------------------------------------

/**
 * Before any repeat of the create POST (lost job, uncertain response, Retry): re-run discovery and adopt a vault that
 * appeared meanwhile (PRD S4 step 1, FR-6). 'none' only when the scan completed and found no vault from the cutoff.
 */
async function rediscover(env: Env, note = 'Checking whether the vault was created…'): Promise<'adopted' | 'none' | 'unknown'> {
  env.patch('create', { status: 'checking', pause: undefined, note })
  const found = await env.protocol.discoverPosition(env.app, env.owner).catch(() => undefined)
  if (found === undefined) {
    env.patch('create', { status: 'paused', note: undefined, pause: { line: 'Your vaults could not be read. Nothing is created until they can be.', retry: 'check' } })
    return 'unknown'
  }
  if (found) {
    setVault(env, { accountId: found.vault.accountId, number: found.vault.number, baseAddress: found.vault.baseAddress })
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
    if (job.vault && job.baseAddress) setVault(env, { accountId: job.vault, number: Number(/^v(\d+)\./.exec(job.vault)?.[1] ?? 0), baseAddress: job.baseAddress })
    if (job.stage === 'done') { env.patch('create', { status: 'done', job: undefined }); return true }
    if (job.vault) { env.patch('create', { status: 'done', job: undefined, note: 'Vault created; the relayer did not send its gas float. The gas step tops it up if needed.' }); return true }
    env.patch('create', { status: 'paused', job: undefined, pause: { line: 'The relayer could not create the vault.', text: job.error, retry: 'post' } })
    return false
  }
  const action = env.take('create')
  if (!env.armed()) { env.patch('create', { status: 'waiting' }); return false }
  // Creation is guarded by a fresh ownership read, never by a cached one (PRD S4 step 1, FR-4): discovery runs again
  // immediately before every POST, and a vault the wallet already owns is adopted instead of creating another.
  const found = await rediscover(env, step.attempted ? 'Checking whether the vault was created…' : 'Checking whether this wallet already owns a vault…')
  if (found === 'adopted') return true
  if (found === 'unknown') return false
  if (step.attempted && action !== 'post') {
    env.patch('create', { status: 'paused', note: undefined, pause: { line: 'No vault exists yet for this wallet. You can ask the relayer again.', retry: 'post' } })
    return false
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

const live = (env: Env, v: { markets: { id: string; collateral: bigint }[] }) => v.markets.find(m => m.id.toLowerCase() === env.app.guided.liveMarket.id.toLowerCase())

const setupSpec: OwnerSpec = {
  id: 'setup',
  complete: v => v.setupComplete,
  intent: (_v, env) => setupIntent(env, 'setup'),
}

const openSpec: OwnerSpec = {
  id: 'open',
  complete: (v, env) => (live(env, v)?.collateral ?? 0n) > 0n,
  doneNote: (_v, env) => {
    const below = env.get().steps.open.belowTarget
    return below ? `Opened below target (${formatWadPercent(BigInt(below))})` : undefined
  },
  async intent(v, env, action: RetryKind | null) {
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
  intent: async (v, env) => ({ method: 'withdraw', token: 'usdc', amount: v.idle.usdc, destination: env.owner }),
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
  const hash = await prompted(env, 'transfer', () => env.wallet.sendTransaction(env.protocol.walletTx(env.app, { kind: 'transfer', token: 'weth', to: vault.baseAddress, amount })))
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
  /** Arm the chain and run (Create position already armed it; after a reload this is "Continue"). */
  start(): void
  /** A paused step's action. */
  act(id: StepId, kind: RetryKind): void
  /** Store a new record (Create position / Continue on a discovered vault) and start. */
  begin(record: OnboardingRecord): void
}

export function useOnboarding(mode: Mode, app: LoadedConfig | undefined, owner: Address | undefined, chainOk: boolean, onFinished: () => void): Onboarding {
  const factory = app?.config.near.factory
  const queryClient = useQueryClient()
  const chain = useStepChain<StepId, OnboardingRecord>({
    mode, app, owner, chainOk,
    key: `${factory ?? ''}:${owner?.toLowerCase() ?? ''}`,
    load: () => (owner && factory ? loadRecord(mode, factory, owner) : null),
    save: r => saveRecord(mode, r),
    active: activeStep,
    vault: r => r.vault,
    drivers: DRIVERS,
    finish: r => {
      clearRecord(mode, r.factory, r.owner)
      if (r.vault && owner) clearLock(mode, r.vault.accountId, owner)
      return null
    },
    invalidate: [['discovery']],
    onFinished,
  })
  // A vault created or adopted by this run makes the owner's cached vault check stale: refresh it at once, so S0 and S3
  // see the vault (Phase 7: a stale "none" let S3 offer a second creation after an account switch).
  const vaultId = chain.record?.vault?.accountId
  useEffect(() => {
    if (vaultId) void queryClient.invalidateQueries({ queryKey: ['discovery'] })
  }, [vaultId, queryClient])
  return chain
}
