import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Address } from 'viem'
import { useWalletLabel, useWalletState } from '../adapters/AdapterProvider.tsx'
import type { ClosePlan, PositionMarket, PositionView } from '../adapters/types.ts'
import { SESSION_START, useActivity, useAgent, useAppConfig, useClosePlan, useDiscovery, usePosition } from '../components/data.ts'
import { ShowUsdcButton } from '../components/ShowUsdc.tsx'
import { ExtLink } from '../components/Sandbox.tsx'
import { StepRow } from '../components/StepRow.tsx'
import { useClose, type Close } from '../components/useClose.ts'
import { newApproveRecord, useApprove, type Approve } from '../components/useApprove.ts'
import { useNow } from '../components/use-now.ts'
import { defaultDeposit } from '../flow/amount.ts'
import { closeShortfall, newCloseRecord, startOverAllowed, visibleCloseSteps, type CloseStepId } from '../flow/close.ts'
import type { LoadedConfig } from '../flow/config.ts'
import type { PositionVariant } from '../flow/entry.ts'
import { formatUnits, formatWadPercent, shortAddress } from '../flow/format.ts'
import { clearCloseRecord } from '../flow/onboarding-record.ts'
import { actionRows, agentState, approveAction, backupStatus, budgetFor, currentMarket, positionVariant, type AgentState, type Variant } from '../flow/position.ts'
import { Unavailable, useSessionValue, type ScreenProps } from './common.tsx'
import { VerificationPanel } from './VerificationPanel.tsx'

const BASE_SEPOLIA = 84532
/** The one close reason that keeps the button usable: clicking reads the plan again. */
const PLAN_FAILED = 'The amount to repay could not be read. Click to read it again.'

const usdc = (v: bigint) => `${formatUnits(v, 6, 2)} USDC`
const weth = (v: bigint) => `${formatUnits(v, 18, 6)} WETH`
const pctNum = (wad: bigint) => Number(wad * 10_000n / 10n ** 18n) / 100
const ago = (seconds: number) => (seconds < 90 ? `${Math.max(0, Math.round(seconds))} s ago` : seconds < 5400 ? `${Math.round(seconds / 60)} min ago` : `${Math.round(seconds / 3600)} h ago`)
const date = (secs: number | bigint) => new Date(Number(secs) * 1000).toLocaleString()
const usdcExact = (v: bigint) => `${formatUnits(v, 6, 6)} USDC`

const CLOSE_TITLE: Record<CloseStepId, string> = {
  transfer: 'Send USDC to your position address',
  transfer2: 'Send USDC to your position address (second transfer)',
  close: 'Close position',
  withdrawWeth: 'Return WETH to your wallet',
  withdrawUsdc: 'Return leftover USDC',
}

const CLOSE_WHY: Record<CloseStepId, string> = {
  transfer: 'The debt is repaid from USDC at your position address. The amount covers interest for the next 10 minutes plus the relayer\'s 1% headroom; the headroom comes back in the last step.',
  transfer2: 'Interest accrued since the first transfer, so the position address holds less than the debt plus 1% the relayer requires before it sends the close.',
  close: 'One signature repays the whole debt and releases all collateral in one Base transaction. There is no close without repaying.',
  withdrawWeth: 'The released WETH sits at your position address; one signature sends it to your wallet.',
  withdrawUsdc: 'USDC left above 0.01 (mostly the 1% headroom) goes back to your wallet.',
}

/** The Executor's configured feeds for the oracle line: "Chainlink ETH/USD · updated N min ago" (PRD S5). */
function OracleLine({ market, chainNow }: { market: PositionMarket; chainNow: number }) {
  if (market.feeds.length === 0) return <Unavailable>no feed configured</Unavailable>
  return <>{market.feeds.map((f, index) => {
    const name = f.description ? `Chainlink ${f.description.replace(/\s*\/\s*/g, '/')}` : `Feed ${shortAddress(f.address)}`
    const age = f.updatedAt === null ? null : chainNow - Number(f.updatedAt)
    return <span key={f.address} className="oracle-line">{index > 0 && ' · '}{name} · {age === null ? <Unavailable>update time unavailable</Unavailable> : `updated ${ago(age)}`}{age !== null && age > f.maxAge ? ' · stale' : ''}</span>
  })}</>
}

/** LTV with the segmented track (docs/mockups/S5-Position): floor, target, trigger from the Base corridor; liquidation from the market's LLTV. */
function LtvTrack({ m }: { m: PositionMarket }) {
  const marks = [
    { key: 'floor', at: m.corridor.set ? m.corridor.floor : null, label: 'Floor' },
    { key: 'target', at: m.corridor.set ? m.corridor.target : null, label: 'Target' },
    { key: 'act', at: m.corridor.set ? m.corridor.act : null, label: 'Agent acts' },
    { key: 'liq', at: m.lltv, label: 'Liquidation' },
  ]
  return <section className="surface" aria-label="Risk corridor">
    <div className="ltv-track" aria-hidden="true" style={{ marginTop: 12 }}>
      {m.ltv !== null && <div className="ltv-fill" style={{ width: `${Math.min(100, pctNum(m.ltv))}%` }} />}
      {marks.filter(x => x.at !== null).map(x => <span key={x.key} className={`tick ${x.key}`} style={{ left: `${pctNum(x.at!)}%` }} />)}
      {m.ltv !== null && <span className="cur" style={{ left: `${Math.min(100, pctNum(m.ltv))}%` }} />}
    </div>
    <dl className="legend">
      {marks.map(x => <div key={x.key}><dt><i className={x.key} />{x.label}</dt><dd>{x.at === null ? <Unavailable>not set</Unavailable> : formatWadPercent(x.at)}</dd></div>)}
    </dl>
  </section>
}

/** Phase 7c: the re-approve call inline on the agent card (button, then its step with the runner's statuses and retries). */
function ApproveInline({ label, approve, explorer, now, onBegin }: { label: string | null; approve: Approve; explorer: string; now: number; onBegin: (() => void) | null }) {
  const r = approve.record
  const step = r?.steps.approve
  const pending = !!step && step.status !== 'done'
  return <>
    {r && step && <ol className="steps">
      <StepRow title={APPROVE_TITLE} why={APPROVE_WHY} index={1} step={step} explorer={explorer} now={now} onAct={kind => approve.act('approve', kind)} active />
    </ol>}
    {pending && !approve.running && step.status === 'waiting' && <button type="button" className="btn primary" style={{ justifySelf: 'start' }} onClick={approve.start}>Continue</button>}
    {label && !pending && onBegin && <button type="button" className="btn primary" style={{ justifySelf: 'start' }} onClick={onBegin}>{label}</button>}
  </>
}

const APPROVE_TITLE = 'Approve the agent version'
const APPROVE_WHY = 'The agent watches your vault only while your vault approves its exact version (the six measurement values in the published manifest). One signature sets the approval; the rest of your setup is left as it is.'

function AgentCard({ vaultId, market, view, now, verifying, onVerify, variant, closing, approve, explorer, onApprove }: { vaultId: string; market: PositionMarket | null; view: PositionView; now: number; verifying: boolean; onVerify: () => void; variant: Variant; closing: boolean; approve: Approve; explorer: string; onApprove: (() => void) | null }) {
  const agent = useAgent(vaultId)
  const status = agent.isError && !agent.data ? agentState(null, now) : agent.data ? agentState(agent.data, now) : null
  const label = approveAction(status?.state ?? null, variant, closing)
  const row = agent.data?.list.ok ? agent.data.list.row : null
  const budget = market ? budgetFor(view, market) : null
  const collateral = view.markets.reduce((sum, m) => sum + m.collateral, 0n)
  const row2 = (k: string, v: ReactNode) => <div className="row"><dt className="k">{k}</dt><dd className="v">{v}</dd></div>
  return <section className="surface stack card" aria-labelledby="agent-title">
    <div className="card-head"><h3 id="agent-title">Agent</h3><span className={`tag${status ? AGENT_TAG[status.state] : ''}`} role="status">{status ? status.state : 'Reading…'}</span></div>
    {status?.detail && <p className="muted small agent-detail">{status.detail}</p>}
    <dl className="rows">
      {row2('Last check', row?.last_tick_unix ? `${date(row.last_tick_unix)} (${ago(now - row.last_tick_unix)})` : <Unavailable>none reported</Unavailable>)}
      {row2('Key expires', agent.data?.vaultAgent ? date(agent.data.vaultAgent.expires_at) : agent.data ? <Unavailable>no key on your vault</Unavailable> : <Unavailable />)}
      {row2('Discretionary sell budget left today', collateral === 0n
        ? <Unavailable>no position</Unavailable>
        : budget && budget.budgetWad > 0n
          ? <>{weth(budget.remaining)} <span className="muted small">of {weth((budget.activeCollateral + budget.sold) * budget.budgetWad / 10n ** 18n)} ({formatWadPercent(budget.budgetWad)} per rolling 24 h)</span></>
          : <Unavailable>no active corridor</Unavailable>)}
    </dl>
    {agent.isError && agent.data && <p className="muted small" role="alert">The last agent read failed; showing the previous one.</p>}
    <ApproveInline label={label} approve={approve} explorer={explorer} now={now} onBegin={onApprove} />
    <button type="button" className="btn ghost" style={{ justifySelf: 'start', paddingLeft: 0 }} aria-expanded={verifying} aria-controls="verify-panel" onClick={onVerify}>Verify the agent</button>
  </section>
}

/** Status tag colours of docs/mockups/S5-Position (Active is the artboard's ok tag). */
const AGENT_TAG: Record<AgentState, string> = { Active: ' ok', Registering: ' warn', Expired: ' bad', Revoked: ' bad', Outdated: ' bad', 'Not approved': ' bad', Unavailable: '' }

function MarketCard({ app, view, market, chainNow }: { app: LoadedConfig; view: PositionView; market: PositionMarket | null; chainNow: number }) {
  const explorer = app.guided.network.blockExplorerUrls[0].replace(/\/$/, '')
  const nearblocks = app.guided.help.nearblocks.replace(/\/$/, '')
  const labels = app.config.marketLabels
  const role = market ? labels[market.id.toLowerCase()] ?? 'unknown' : null
  const backup = backupStatus(view, market, labels)
  const BACKUP_TEXT = { current: 'Your position was moved to the backup market.', approved: 'Approved for migration', 'not-approved': 'Not approved for migration', missing: 'No backup market in this vault' } as const
  const row2 = (k: string, v: ReactNode) => <div className="row"><dt className="k">{k}</dt><dd className="v">{v}</dd></div>
  return <section className="surface stack card" aria-labelledby="market-title">
    <div className="card-head"><h3 id="market-title">Market</h3></div>
    <dl className="rows">
      {row2('Market', <>Morpho · USDC/WETH on Base Sepolia · {role ?? <Unavailable />}</>)}
      {market && row2('Liquidation LTV', formatWadPercent(market.lltv))}
      {market && row2('Oracle', <OracleLine market={market} chainNow={chainNow} />)}
      {market && row2('Market id', <><code title={market.id}>{market.id.slice(0, 10)}…{market.id.slice(-6)}</code> · <ExtLink href={`${explorer}/address/${view.morpho}`}>Morpho</ExtLink> · <ExtLink href={`${explorer}/address/${market.executor}`}>Executor</ExtLink></>)}
      {row2('Backup market', BACKUP_TEXT[backup])}
      {row2('Position address', <ExtLink href={`${explorer}/address/${view.vault.baseAddress}`}>{shortAddress(view.vault.baseAddress)}</ExtLink>)}
      {row2('Vault', <ExtLink href={`${nearblocks}/address/${view.vault.accountId}`}>{view.vault.accountId}</ExtLink>)}
    </dl>
  </section>
}

/** `live`: the snapshot is a live read of this session; the list then follows its block (Phase 7b). */
function RecentActions({ app, view, owner, live }: { app: LoadedConfig; view: PositionView; owner: `0x${string}`; live: boolean }) {
  const activity = useActivity(view.vault.baseAddress, live ? view.blockNumber : undefined)
  const explorer = app.guided.network.blockExplorerUrls[0].replace(/\/$/, '')
  // On return, the confirmed cached part is shown at once while the newest blocks are read (PRD §9 3).
  const pages = activity.data?.pages ?? (activity.cached ? [{ ...activity.cached, head: activity.cached.to }] : [])
  const fromCache = !activity.data && !!activity.cached
  const ctx = { owner, positionAddress: view.vault.baseAddress, weth: app.guided.base.weth, usdc: app.guided.base.usdc, marketLabels: app.config.marketLabels }
  const rows = actionRows(pages.flatMap(p => p.items), ctx)
  const range = pages.length ? `Blocks ${pages[pages.length - 1].from.toString()}–${pages[0].to.toString()}` : null
  return <section className="surface card" aria-labelledby="actions-title">
    <div className="card-head"><h3 id="actions-title">Recent actions</h3>{range && <span className="muted small">{range}{pages[pages.length - 1].reachedStart ? ' (since the Executor was deployed)' : ''}{fromCache ? ' · saved list, reading newer blocks…' : ''}</span>}</div>
    {activity.isPending && !fromCache && pages.length === 0 && <p className="muted small" style={{ marginTop: 8 }} role="status">Reading recent actions…</p>}
    {activity.isError && <p className="notice notice--warning" style={{ marginTop: 8 }} role="alert">{pages.length ? 'Could not load recent actions. The list below is the previous one.' : 'Could not load recent actions.'}<button type="button" className="btn" onClick={() => { void (pages.length ? activity.fetchNextPage() : activity.refetch()) }}>Retry</button></p>}
    {pages.length > 0 && rows.length === 0 && <p className="muted small" style={{ marginTop: 8 }}>No actions in this range.</p>}
    <ul className="plain-list" style={{ gap: 0, marginTop: 8 }}>
      {rows.map(row => <li key={row.transactionHash} className="event">
        <span className={`who ${row.who.toLowerCase()}`}>{row.who}</span>
        <span>{row.text} · <ExtLink href={`${explorer}/tx/${row.transactionHash}`}>BaseScan</ExtLink></span>
        <span className="when">{row.time !== null ? date(row.time) : `block ${row.blockNumber.toString()}`}</span>
      </li>)}
    </ul>
    {activity.hasNextPage && !activity.isError && !fromCache && <button type="button" className="btn ghost" style={{ paddingLeft: 0, marginTop: 8 }} disabled={activity.isFetchingNextPage} onClick={() => { void activity.fetchNextPage() }}>{activity.isFetchingNextPage ? 'Loading…' : 'Load earlier'}</button>}
  </section>
}

/** S6a: the wallet lacks test USDC for the shortfall; the close chain re-reads every 10 s and continues by itself. */
function GetUsdc({ app, address, funding, now }: { app: LoadedConfig; address: Address; funding: NonNullable<Close['record']>['steps']['transfer']['funding']; now: number }) {
  const [copied, setCopied] = useState(false)
  if (!funding) return null
  const [circle, ...others] = app.guided.help.usdcFaucets
  // docs/mockups/S6-Close "Get test USDC"
  return <aside className="help" aria-labelledby="get-usdc-title">
    <div className="card-head"><h2 id="get-usdc-title">Get test USDC</h2><span className="tag warn">{usdcExact(BigInt(funding.missing))} missing</span></div>
    <dl className="rows small" style={{ margin: 0 }}>
      <div className="row"><dt className="k">To send to your position address</dt><dd className="v">{usdcExact(BigInt(funding.shortfall))}</dd></div>
      <div className="row"><dt className="k">USDC in your wallet</dt><dd className="v">{usdcExact(BigInt(funding.wallet))}</dd></div>
      <div className="row"><dt className="k">Missing</dt><dd className="v"><strong>{usdcExact(BigInt(funding.missing))}</strong></dd></div>
    </dl>
    <p className="muted small">Test USDC is free from Circle's faucet. Choose <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>Base Sepolia</strong> in the network dropdown; USDC sent on another network cannot reach this wallet.</p>
    <div className="addr"><span>{address}</span>
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(address).then(() => setCopied(true), () => undefined) }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
    <ol>
      {circle && <li><a href={circle.url} target="_blank" rel="noreferrer">{circle.label}</a></li>}
      {others.map(link => <li key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a> <span className="muted small">— {link.note}</span></li>)}
    </ol>
    <p className="muted small">The 1% headroom comes back to your wallet as leftover USDC in the last close step.</p>
    <p className="small" role="status"><span className="pulse" aria-hidden="true" />Checking every 10 seconds; the close continues by itself. Last checked {Math.max(0, Math.round(now - funding.checkedAt / 1000))} s ago.</p>
  </aside>
}

/** The pre-sign review sheet (PRD S6): what closing repays, sends and returns, before the first prompt. */
function ReviewSheet({ app, plan, owner, onStart, onCancel }: { app: LoadedConfig; plan: ClosePlan; owner: Address; onStart: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal() }, [])
  const shortfall = closeShortfall(plan)
  const minutes = Math.round(app.guided.messageExpirySecs / 60)
  const r = (k: ReactNode, v: ReactNode) => <div className="row"><dt className="k">{k}</dt><dd className="v">{v}</dd></div>
  // docs/mockups/cmdk.css .sheet (the artboards draw it for the sandbox; S6 lists the same review as a notice)
  return <dialog ref={ref} className="sheet" style={{ width: 560 }} aria-labelledby="review-title" onCancel={event => { event.preventDefault(); onCancel() }}>
    <h2 id="review-title">Close your position</h2>
    <dl className="rows" style={{ margin: 0 }}>
      {r('Debt now', <>{usdcExact(plan.debtNow)} <span className="muted small">accrued to block {plan.blockNumber.toString()}</span></>)}
      {r(`Interest over the next ${minutes} minutes`, `up to ${usdcExact(plan.debtAhead - plan.debtNow)}`)}
      {r('Headroom (1%, returned to you)', usdcExact(plan.needAhead - plan.debtAhead))}
      {r('USDC already at your position address', usdcExact(plan.idle.usdc))}
      {r('You send first', shortfall > 0n ? `${usdcExact(shortfall)} from your wallet to your position address` : 'Nothing: your position address already holds the debt plus 1%')}
      {r('Collateral returned', weth(plan.collateral + plan.idle.weth))}
      {r('Destination', <><code>{owner}</code> (your wallet)</>)}
    </dl>
    <p className="muted small">Each signature expires in {minutes} minutes.</p>
    <p className="muted small">The protocol has no close without repaying: the whole debt is repaid before your WETH is released.</p>
    <div style={{ display: 'flex', gap: 12 }}>
      <button type="button" className="btn primary" onClick={onStart}>Start closing</button>
      <button type="button" className="btn" onClick={onCancel}>Cancel</button>
    </div>
  </dialog>
}

function CloseSteps({ app, close, owner, explorer, now }: { app: LoadedConfig; close: Close; owner: Address; explorer: string; now: number }) {
  const walletLabel = useWalletLabel()
  const r = close.record!
  const ids = visibleCloseSteps(r)
  const active = ids.find(id => r.steps[id].status !== 'done' && r.steps[id].status !== 'skipped')
  const canContinue = !close.running && !!active && r.steps[active].status === 'waiting'
  const funding = active && r.steps[active].status === 'funding' ? r.steps[active].funding : undefined
  // docs/mockups/S6-Close: steps (1.4fr) and the Get test USDC panel (1fr)
  return <div className="split-14">
    <section className="surface" aria-labelledby="closing-title">
      <div className="stack-8" style={{ marginBottom: 8 }}>
        <h2 id="closing-title">Closing your position</h2>
        <p className="muted small">Every signature and transaction is requested in order; you only act inside {walletLabel}.</p>
      </div>
      <ol className="steps">
        {ids.map((id, index) => <StepRow key={id} title={CLOSE_TITLE[id]} why={CLOSE_WHY[id]} index={index + 1} step={r.steps[id]} explorer={explorer} now={now} onAct={kind => close.act(id, kind)} active={id === active} prompt={id === 'transfer' || id === 'transfer2' ? 'transaction' : 'signature'} />)}
      </ol>
      {canContinue && <div className="step-actions"><button type="button" className="btn primary" onClick={close.start}>Continue</button></div>}
    </section>
    {funding && <GetUsdc app={app} address={owner} funding={funding} now={now} />}
  </div>
}

export function Position({ mode, href, variant: routeVariant, discovery }: Omit<ScreenProps, 'banner'> & { variant?: PositionVariant; discovery: ReturnType<typeof useDiscovery> }) {
  const app = useAppConfig().data
  const wallet = useWalletState()
  const now = useNow()
  const vaultId = discovery.result?.summary?.vault.accountId
  const owner = wallet.status === 'connected' ? wallet.address : undefined
  const position = usePosition(vaultId, owner)
  const view = position.data
  const chainOk = wallet.status === 'connected' && wallet.chainId === BASE_SEPOLIA
  const summary = discovery.result?.summary
  const closeVault = summary ? { accountId: summary.vault.accountId, number: summary.vault.number, baseAddress: summary.vault.baseAddress } : undefined
  const close = useClose(mode, app, owner, chainOk, closeVault, () => undefined)
  const closing = !!close.record && !close.record.completed
  const approve = useApprove(mode, app, owner, chainOk, closeVault, () => undefined)
  const [review, setReview] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const plan = useClosePlan(vaultId, owner, routeVariant !== 'closed' && !closing)
  const [, setAmount] = useSessionValue(mode, 'amount', defaultDeposit(mode))

  if (!app || !vaultId) return <section className="page page--tight" aria-labelledby="screen-title"><h1 id="screen-title">Your position</h1><p className="muted small" role="status">Reading your vault…</p></section>
  if (!view) {
    return <section className="page page--tight" aria-labelledby="screen-title">
      <h1 id="screen-title">Your position</h1>
      {position.isError
        ? <p className="notice notice--warning" role="alert">Your position could not be read. Nothing is shown until it can be.<button type="button" className="btn" onClick={() => { void position.refetch() }}>Retry</button></p>
        : <p className="muted small" role="status">Reading your position at the latest block…</p>}
    </section>
  }

  // 'closed' comes only from the resolver, which requires this session's completed close record (D5)
  const variant = closing ? 'active' : positionVariant(view, routeVariant === 'closed')
  const market = currentMarket(view, app.guided.liveMarket.id)
  const debt = view.markets.reduce((sum, m) => sum + m.debt, 0n)
  const collateral = view.markets.reduce((sum, m) => sum + m.collateral, 0n)
  const value = view.markets.every(m => m.value !== null) ? view.markets.reduce((sum, m) => sum + (m.value ?? 0n), 0n) : null
  const age = now - position.dataUpdatedAt / 1000
  const stale = position.isError
  // A snapshot from an earlier visit (persisted, PRD §9 4) paints the screen only; no action uses it.
  const restored = position.dataUpdatedAt < SESSION_START
  const idle = view.idle
  // USDC below guided.usdcDust is repay rounding (config.app.json), not a balance to report
  const showIdle = idle.weth > 0n || idle.usdc > app.guided.usdcDust || idle.eth > 0n
  const explorer = app.guided.network.blockExplorerUrls[0].replace(/\/$/, '')
  const chainNow = Number(view.blockTime) + (now - position.dataUpdatedAt / 1000)

  // Close position (PRD S5 action, S6): enabled only with a fresh snapshot, the owner on Base Sepolia and a plan read.
  let closeReason: string | null = null
  // on another chain, Start closing requests the switch itself (Phase 8a.2)
  if (!owner) closeReason = 'Connect the vault owner to close.'
  else if (stale) closeReason = 'The latest read failed; closing waits for a fresh one.'
  else if (restored) closeReason = 'Refreshing your position…'
  // one owner call at a time per vault (the shared lock): closing waits for a re-approval in progress (Phase 7c)
  else if (approve.record && approve.record.steps.approve.status !== 'done') closeReason = 'Waiting for the agent approval to finish.'
  else if (plan.isError) closeReason = PLAN_FAILED
  else if (!plan.data) closeReason = 'Reading the amount to repay…'
  const shortfall = plan.data ? closeShortfall(plan.data) : null
  const closeLine = plan.data && shortfall !== null
    ? shortfall === 0n
      ? `Repays ${usdc(plan.data.debtNow)} held at your position address, returns your WETH to your wallet.`
      : `You will first send ${usdc(shortfall)} to your position address, then the debt is repaid and your WETH returns to your wallet.`
    : null
  const startClosing = () => {
    if (!app || !owner || !closeVault) return
    setReview(false)
    close.begin(newCloseRecord({ factory: app.config.near.factory, owner, vault: closeVault, now: Date.now() }))
  }
  const startOver = () => {
    if (!owner) return
    clearCloseRecord(mode, app.config.near.factory, owner, vaultId)
    setAmount(defaultDeposit(mode))
    window.location.hash = href('start')
  }
  // Start over is decided on a live read only (never the persisted or a failed-read snapshot).
  const canStartOver = !restored && !stale && startOverAllowed(view, app.guided.usdcDust)

  // docs/mockups/S5-Position (S7-Closed for the closed variant): head with the one action on the right, three figures,
  // the corridor, agent and market, recent actions
  const figure = (label: string, big: ReactNode, unit: string | null, small: ReactNode) => <div className="surface stack-8 figure">
    <h3 className="muted">{label}</h3><div className="big">{big}{unit && <> <span>{unit}</span></>}</div><p className="muted small">{small}</p>
  </div>
  const amount = (text: string) => { const [n, unit] = text.split(' '); return [n, unit ?? null] as const }
  const [debtN, debtU] = amount(usdc(debt))
  const [collN, collU] = amount(weth(collateral))
  return <section className={`page page--tight position${stale ? ' position--stale' : ''}`} aria-labelledby="screen-title">
    <div className="page-head page-head--split">
      <div style={{ gap: 6 }}>
        <h1 id="screen-title">{variant === 'liquidated' ? 'Position liquidated' : variant === 'closed' ? 'Position closed' : 'Your position'}</h1>
        <p className="muted small" role="status">Read at block {view.blockNumber.toString()}, {ago(age)}{stale ? ' · read-only' : restored ? ' · refreshing' : ''}</p>
      </div>
      {variant === 'active' && !closing && <div className="stack-8 close-action" style={{ justifyItems: 'end', maxWidth: 420, textAlign: 'right' }}>
        <button type="button" className="btn primary" disabled={closeReason !== null && closeReason !== PLAN_FAILED} aria-describedby="close-reason" onClick={() => { void plan.refetch(); setReview(true) }}>Close position</button>
        <p id="close-reason" className="muted small">{closeReason ?? closeLine}</p>
      </div>}
      {variant === 'closed' && <div className="stack-8 close-action" style={{ justifyItems: 'end', maxWidth: 420, textAlign: 'right' }}>
        {canStartOver
          ? <button type="button" className="btn primary" onClick={startOver}>Start over</button>
          : <p className="small">Start over appears once your position address holds no WETH and no more than 0.01 USDC.</p>}
        <p className="muted small create-action__small">Start over reuses this vault: no new vault is created.</p>
      </div>}
    </div>
    {stale && <p className="notice notice--warning" role="alert">The latest read failed. This is the snapshot from block {view.blockNumber.toString()}, {ago(age)}; it is read-only until a read succeeds.</p>}
    {variant === 'liquidated' && <p className="notice notice--warning">Morpho liquidated the collateral. {usdc(debt)} of debt remains on the market. This app offers no recovery for a liquidated position.</p>}
    {review && plan.isFetching && <p className="muted small" role="status">Reading the amount to repay…</p>}
    {review && plan.isError && !plan.isFetching && <p className="notice notice--warning" role="alert">The amount to repay could not be read. Nothing is signed.</p>}
    {review && plan.data && !plan.isFetching && !plan.isError && owner && <ReviewSheet app={app} plan={plan.data} owner={owner} onStart={startClosing} onCancel={() => setReview(false)} />}
    {closing && owner && <CloseSteps app={app} close={close} owner={owner} explorer={explorer} now={now} />}

    <section className="cols-3" aria-label="Balances">
      {figure('Debt', debtN, debtU, `with interest accrued to block ${view.blockNumber.toString()}`)}
      {figure('Collateral', collN, collU, value !== null ? `≈ $${formatUnits(value, 6, 2)} at the market oracle` : <Unavailable>value unavailable</Unavailable>)}
      {figure('LTV', market?.ltv != null ? formatWadPercent(market.ltv) : debt > 0n && collateral === 0n ? 'unbounded' : <Unavailable />, null, null)}
    </section>
    {market && <LtvTrack m={market} />}

    {(owner && chainOk && mode === 'live') || showIdle ? <div className="stack-8">
      {owner && chainOk && mode === 'live' && <p className="muted small wallet-line">Your wallet <code title={owner}>{shortAddress(owner)}</code> · <ShowUsdcButton /></p>}
      {showIdle && <p className="muted small idle-line">At your position address, outside Morpho: {[idle.weth > 0n && weth(idle.weth), idle.usdc > app.guided.usdcDust && usdc(idle.usdc), idle.eth > 0n && `${formatUnits(idle.eth, 18, 6)} ETH for gas`].filter(Boolean).join(' · ')}</p>}
    </div> : null}

    <section className="cols-2 agent-market" aria-label="Agent and market">
      <AgentCard vaultId={vaultId} market={market} view={view} now={now} verifying={verifying} onVerify={() => setVerifying(v => !v)}
        variant={variant} closing={closing} approve={approve} explorer={explorer}
        onApprove={owner && closeVault && !restored && !stale ? () => approve.begin(newApproveRecord(owner, closeVault, Date.now())) : null} />
      <MarketCard app={app} view={view} market={market} chainNow={chainNow} />
    </section>
    {verifying && <div id="verify-panel"><VerificationPanel vaultId={vaultId} poll={false} /></div>}
    {owner && <RecentActions app={app} view={view} owner={owner} live={!restored} />}
  </section>
}
