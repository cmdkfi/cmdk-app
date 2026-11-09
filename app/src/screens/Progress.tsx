import { useAdapters, useWalletState } from '../adapters/AdapterProvider.tsx'
import { useAppConfig, useDiscovery, useMarketQuote } from '../components/data.ts'
import { useNow } from '../components/use-now.ts'
import { useOnboarding } from '../components/useOnboarding.ts'
import { checkDeposit, DEFAULT_DEPOSIT } from '../flow/amount.ts'
import type { ProgressStep } from '../flow/entry.ts'
import { formatUnits, formatWadPercent, shortAddress } from '../flow/format.ts'
import { newRecord, resumeStep, STEPS, type RetryKind, type StepId, type StepState, type StepStatus } from '../flow/onboarding.ts'
import { go, useSessionValue, type ScreenProps } from './common.tsx'

const BASE_SEPOLIA = 84532

const TITLE: Record<StepId, string> = {
  create: 'Create your position',
  setup: 'Approve agent and rules',
  wrap: 'Wrap ETH → WETH',
  transfer: 'Send WETH to your position address',
  open: 'Open position',
  withdraw: 'Send USDC to your wallet',
}

const WHY: Record<StepId, string> = {
  create: 'The relayer creates your vault on NEAR and pays for it. The vault gets a position address on Base that only it can sign for.',
  setup: 'One signature lets the vault approve the Executor for WETH and USDC, authorize it on Morpho, set your corridor on both markets and approve the published agent build.',
  wrap: 'Morpho takes WETH, not ETH. Only the WETH your wallet is missing is wrapped.',
  transfer: 'Collateral must sit at your position address before the vault can supply it to Morpho.',
  open: 'One signature supplies the WETH as collateral and borrows USDC to the target LTV in one Base transaction.',
  withdraw: 'Borrowed USDC lands at your position address; one more signature sends it to your wallet.',
}

const STATUS: Record<StepStatus, string> = {
  waiting: 'Waiting', prompting: 'Waiting for MetaMask…', submitted: 'Submitted', confirming: 'Confirming…', checking: 'Checking…',
  stale: 'Waiting for a fresh price', done: 'Done', skipped: 'Not needed', paused: 'Paused',
}

function retryLabel(kind: RetryKind, step: StepState): string {
  switch (kind) {
    case 'prompt': return 'Try again'
    case 'post': return 'Ask the relayer again'
    case 'resend': return 'Send the same signed message again'
    case 'resign': return 'Sign a new message'
    case 'topUp': return `Send ${step.topUp ? formatUnits(BigInt(step.topUp.amountWei), 18, 6) : ''} ETH for gas`
    case 'accept': return 'Open at the lower LTV'
    case 'check': return 'Check again'
  }
}

function Step({ id, index, step, explorer, onAct, now }: { id: StepId; index: number; step: StepState; explorer?: string; onAct: (kind: RetryKind) => void; now: number }) {
  const p = step.pause
  const wait = p?.retryAfter && p.since ? Math.max(0, Math.ceil(p.retryAfter - (now - p.since / 1000))) : 0
  return <li className={`step step--${step.status}`} aria-label={TITLE[id]}>
    <span className="step__index" aria-hidden="true">{index}</span>
    <div className="step__body">
      <div className="step__head"><strong>{TITLE[id]}</strong><span className="step__status" role="status">{STATUS[step.status]}</span></div>
      {step.note && <p className="step__note">{step.note}</p>}
      {step.topUp && step.topUp.status !== 'needed' && <p className="step__note">Gas top-up: {formatUnits(BigInt(step.topUp.amountWei), 18, 6)} ETH · {step.topUp.status === 'done' ? 'confirmed' : step.topUp.status === 'confirming' ? 'confirming…' : 'waiting for MetaMask…'}</p>}
      {step.txHash && explorer && <p className="step__note"><a href={`${explorer}/tx/${step.txHash}`} target="_blank" rel="noreferrer">Transaction {shortAddress(step.txHash)}</a></p>}
      {step.job && <p className="step__note">Relayer job <code>{step.job}</code></p>}
      {p && <div className="step__pause" role="alert">
        <p>{p.line}</p>
        {p.text && <pre className="step__error">{p.text}</pre>}
        {p.job && <p>Job <code>{p.job}</code></p>}
        {p.retry && <button type="button" className="prototype-button" disabled={wait > 0} onClick={() => onAct(p.retry!)}>{wait > 0 ? `Try again in ${wait} s` : retryLabel(p.retry, step)}</button>}
      </div>}
      <details className="step__why"><summary>Why</summary><p>{WHY[id]}</p></details>
    </div>
  </li>
}

export function Progress({ mode, href, discovery, resume }: Omit<ScreenProps, 'banner'> & { discovery: ReturnType<typeof useDiscovery>; resume?: ProgressStep }) {
  const { protocol } = useAdapters()
  const state = useWalletState()
  const app = useAppConfig().data
  const quote = useMarketQuote()
  const now = useNow()
  const owner = state.status === 'connected' ? state.address : undefined
  const chainOk = state.status === 'connected' && state.chainId === BASE_SEPOLIA
  const ob = useOnboarding(mode, app, owner, chainOk, () => go(href('position')))
  const [text] = useSessionValue(mode, 'amount', DEFAULT_DEPOSIT[mode])
  const explorer = app?.guided.network.blockExplorerUrls[0]?.replace(/\/$/, '')
  const r = ob.record

  if (!r) {
    const check = app ? checkDeposit(text, app.guided.minDepositWei) : { kind: 'empty' as const }
    const summary = discovery.result?.summary
    const status = discovery.entry.kind === 'found' ? discovery.entry.status : null
    const start = () => {
      if (!app || !owner || !summary) return
      const estimate = quote.data && check.kind === 'ok' ? protocol.estimateDeposit(app, quote.data, check.wei) : null
      const shown = estimate ? (estimate.limited ? estimate.resultingLtv : BigInt(app.guided.corridor.target) * 10n ** 16n) : null
      ob.begin(newRecord({ factory: app.config.near.factory, owner, amountWei: check.kind === 'ok' ? check.wei : null, shownLtv: shown, vault: { accountId: summary.vault.accountId, number: summary.vault.number, baseAddress: summary.vault.baseAddress }, resumeAt: resumeStep(status), now: Date.now() }))
    }
    return <section className="screen screen--wide" aria-labelledby="screen-title">
      <h1 id="screen-title">Opening your position</h1>
      {resume === 'deposit' && <p className="screen__lead">Your vault is ready. Deposit to open a position.</p>}
      {resume === 'setup' && <p className="screen__lead">Your vault exists but its setup is not complete. One signature finishes it.</p>}
      {resume === 'open' && <p className="screen__lead">Your WETH is at your position address. One signature opens the position.</p>}
      {summary && <p className="screen__note">Vault {summary.vault.accountId} · position address {shortAddress(summary.vault.baseAddress)}</p>}
      <div className="screen__actions">
        {check.kind === 'ok' || resume === 'setup' || resume === 'open'
          ? <button type="button" className="prototype-button is-primary" disabled={!summary || !owner} onClick={start}>{check.kind === 'ok' ? `Continue with ${formatUnits(check.wei, 18, 6)} ETH` : 'Continue'}</button>
          : <a className="prototype-button is-primary" href={href('start')}>Choose how much ETH to deposit</a>}
      </div>
    </section>
  }

  const active = STEPS.find(id => r.steps[id].status !== 'done' && r.steps[id].status !== 'skipped')
  const canContinue = !ob.running && !!active && r.steps[active].status === 'waiting'
  const registration = ob.registration
  return <section className="screen screen--wide progress" aria-labelledby="screen-title">
    <h1 id="screen-title">Opening your position</h1>
    <p className="screen__lead">
      {r.amountWei ? `Deposit ${formatUnits(BigInt(r.amountWei), 18, 6)} ETH, borrow USDC at ${app ? `${app.guided.corridor.target}%` : 'the target'} LTV.` : 'Resuming your position.'}
      {' '}Every signature and transaction is requested in order; you only act inside MetaMask.
    </p>
    <div className="progress__grid">
      <ol className="steps">
        {STEPS.map((id, index) => <Step key={id} id={id} index={index + 1} step={r.steps[id]} explorer={explorer} now={now} onAct={kind => ob.act(id, kind)} />)}
      </ol>
      <aside className="progress__rail prototype-surface" aria-label="Agent">
        <h2>Agent registration</h2>
        <p role="status">{!r.vault ? 'Starts after your vault exists.' : registration === 'registered' ? 'Registered and active on your vault.' : registration === 'unavailable' ? 'Unavailable: the agent list could not be read.' : 'Registering (usually a few minutes). The steps continue meanwhile.'}</p>
        {r.vault && <p className="screen__note">Vault {r.vault.accountId}<br />Position address <code>{r.vault.baseAddress}</code></p>}
        <p className="screen__note">The full verification panel arrives in Phase 6.</p>
      </aside>
    </div>
    {canContinue && <div className="screen__actions"><button type="button" className="prototype-button is-primary" onClick={ob.start}>Continue</button></div>}
    {r.steps.open.belowTarget && r.steps.open.status !== 'done' && <p className="screen__note">The market can lend less than the 50% target today; the position opens at {formatWadPercent(BigInt(r.steps.open.belowTarget))}.</p>}
  </section>
}
