// S6 close chain (PRD S6, S6a, D3, R10; Phase 5 decisions) on the shared runner (runner.ts): the only place S6 calls
// adapters. Steps: USDC shortfall transfer (wallet tx, with the Get test USDC wait), an R10 second transfer when the
// pre-check before the close signature is short, one `close` owner call per market holding debt or collateral, then
// `withdraw` WETH and leftover USDC to the owner.
import type { Address, Hex } from 'viem'
import type { ClosePlan } from '../adapters/types.ts'
import { activeCloseStep, closeShortfall, needsSecondTransfer, walletMissing, type CloseRecord, type CloseStepId, type CloseVault } from '../flow/close.ts'
import type { LoadedConfig } from '../flow/config.ts'
import { formatUnits } from '../flow/format.ts'
import { patchStep } from '../flow/onboarding.ts'
import { clearLock, clearRecord, loadCloseRecord, loadLock, loadRecord, saveCloseRecord } from '../flow/onboarding-record.ts'
import type { Mode } from '../flow/routes.ts'
import { confirmed, ownerStep, prompted, useStepChain, type Chain, type Env as ChainEnv, type OwnerSpec as ChainSpec } from './runner.ts'

type Env = ChainEnv<CloseStepId, CloseRecord>
type OwnerSpec = ChainSpec<CloseStepId, CloseRecord>

const usdc = (v: bigint) => `${formatUnits(v, 6, 6)} USDC`
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const plan = (env: Env): Promise<ClosePlan> => env.protocol.readClosePlan(env.app, env.get().vault.accountId, env.owner)

/** Step 1 (and the R10 second transfer): send the shortfall from the wallet; wait for test USDC when the wallet is short. */
async function transferStep(env: Env, id: 'transfer' | 'transfer2'): Promise<boolean> {
  const step = env.get().steps[id]
  if (step.txHash) {
    if (!await confirmed(env, id, [step.txHash])) return false
    // Done when the position address holds what the relayer requires now (debt + 1%).
    if (!needsSecondTransfer(await plan(env))) { env.patch(id, { status: 'done', pause: undefined, funding: undefined }); return true }
    env.patch(id, { status: 'paused', txHash: undefined, pause: { line: 'The transfer confirmed, but your position address still holds less USDC than the debt plus 1%. Send the rest.', retry: 'prompt' } })
    return false
  }
  let p = await plan(env)
  for (;;) {
    const shortfall = closeShortfall(p)
    if (shortfall === 0n) {
      env.patch(id, { status: 'skipped', funding: undefined, note: p.debtNow === 0n ? 'No debt to repay.' : 'Your position address already holds the debt plus 1%.' })
      return true
    }
    if (!env.armed()) { env.patch(id, { status: 'waiting' }); return false }
    if (p.walletUsdc >= shortfall) {
      env.patch(id, { funding: undefined, note: `Sending ${usdc(shortfall)}: the debt in 10 minutes plus 1%, minus the USDC already at your position address.` })
      const hash = await prompted(env, id, () => env.wallet.sendTransaction(env.protocol.walletTx(env.app, { kind: 'transfer', token: 'usdc', to: env.vault().baseAddress, amount: shortfall })))
      if (!hash) return false
      env.patch(id, { txHash: hash, status: 'submitted' })
      return transferStep(env, id)
    }
    // S6a: the panel shows the exact amount missing; re-read every 10 s and continue by itself.
    env.patch(id, { status: 'funding', pause: undefined, funding: { shortfall: shortfall.toString(), wallet: p.walletUsdc.toString(), missing: walletMissing(shortfall, p.walletUsdc).toString(), checkedAt: Date.now() } })
    await env.sleep(10_000)
    if (!env.live()) return false
    p = await plan(env)
  }
}

/** close {market}: done = job done, receipts at 2 confirmations, Morpho borrowShares 0 and collateral 0 for that market. */
const closeSpec = (market: Hex): OwnerSpec => ({
  id: 'close',
  complete: v => { const m = v.markets.find(x => same(x.id, market)); return !!m && m.borrowShares === 0n && m.collateral === 0n },
  intent: async () => ({ method: 'close', market }),
})

async function closeStep(env: Env): Promise<boolean> {
  for (;;) {
    const r = env.get()
    const lock = loadLock(env.mode, r.vault.accountId, env.owner)
    let market = lock?.method === 'close' ? r.closing : undefined
    if (!market) {
      const p = await plan(env)
      if (p.markets.length === 0) { env.patch('close', { status: 'done', pause: undefined, note: 'Nothing is left in Morpho.' }); return true }
      // R10: re-read immediately before the close signature; if short, insert a second transfer instead of failing.
      if (needsSecondTransfer(p)) {
        env.update(x => ({ ...patchStep(x, 'transfer2', { status: 'waiting', txHash: undefined, pause: undefined, note: 'Interest accrued since the first transfer; one more transfer covers the debt plus 1%.' }), secondTransfer: true }))
        env.patch('close', { status: 'waiting' })
        return true
      }
      market = p.markets[0].id
      const target = market
      env.update(x => ({ ...x, closing: target }))
    }
    if (!await ownerStep(env, closeSpec(market))) return false
    env.update(x => ({ ...x, closing: undefined }))
    if ((await plan(env)).markets.length === 0) return true
    // normally one market; another one still holds debt or collateral
    env.patch('close', { status: 'waiting', note: 'Another market still holds debt or collateral.' })
  }
}

const withdrawWethSpec: OwnerSpec = {
  id: 'withdrawWeth',
  complete: (v, env) => env.get().steps.withdrawWeth.job !== undefined && v.idle.weth === 0n,
  skip: v => v.idle.weth === 0n,
  intent: async (v, env) => ({ method: 'withdraw', token: 'weth', amount: v.idle.weth, destination: env.owner }),
}

const withdrawUsdcSpec: OwnerSpec = {
  id: 'withdrawUsdc',
  complete: (v, env) => env.get().steps.withdrawUsdc.job !== undefined && v.idle.usdc <= env.app.guided.usdcDust,
  skip: (v, env) => v.idle.usdc <= env.app.guided.usdcDust,
  intent: async (v, env) => ({ method: 'withdraw', token: 'usdc', amount: v.idle.usdc, destination: env.owner }),
}

const DRIVERS: Record<CloseStepId, (env: Env) => Promise<boolean>> = {
  transfer: env => transferStep(env, 'transfer'),
  transfer2: env => transferStep(env, 'transfer2'),
  close: closeStep,
  withdrawWeth: env => ownerStep(env, withdrawWethSpec),
  withdrawUsdc: env => ownerStep(env, withdrawUsdcSpec),
}

export type Close = Chain<CloseStepId, CloseRecord>

export function useClose(mode: Mode, app: LoadedConfig | undefined, owner: Address | undefined, chainOk: boolean, vault: CloseVault | undefined, onFinished: () => void): Close {
  const factory = app?.config.near.factory
  return useStepChain<CloseStepId, CloseRecord>({
    mode, app, owner, chainOk,
    key: `${factory ?? ''}:${owner?.toLowerCase() ?? ''}:${vault?.accountId ?? ''}`,
    load: () => (owner && factory && vault ? loadCloseRecord(mode, factory, owner, vault.accountId) : null),
    save: r => saveCloseRecord(mode, r),
    active: activeCloseStep,
    done: r => !!r.completed,
    vault: r => r.vault,
    drivers: DRIVERS,
    // Completed: the record stays as the "closed" marker; the onboarding record for this vault is cleared.
    finish: r => {
      if (owner) clearLock(mode, r.vault.accountId, owner)
      const onboarding = loadRecord(mode, r.factory, r.owner)
      if (onboarding?.vault && same(onboarding.vault.accountId, r.vault.accountId)) clearRecord(mode, r.factory, r.owner)
      return { ...r, completed: true, closing: undefined }
    },
    invalidate: [['discovery'], ['position']],
    onFinished,
  })
}
