import { useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { useWalletState } from '../adapters/AdapterProvider.tsx'
import type { ClosePlan, PositionMarket, PositionView } from '../adapters/types.ts'
import { SESSION_START, useActivity, useAgent, useAppConfig, useClosePlan, useDiscovery, usePosition } from '../components/data.ts'
import { StepRow } from '../components/StepRow.tsx'
import { useClose, type Close } from '../components/useClose.ts'
import { useNow } from '../components/use-now.ts'
import { DEFAULT_DEPOSIT } from '../flow/amount.ts'
import { closeShortfall, newCloseRecord, startOverAllowed, visibleCloseSteps, type CloseStepId } from '../flow/close.ts'
import type { LoadedConfig } from '../flow/config.ts'
import type { PositionVariant } from '../flow/entry.ts'
import { formatUnits, formatWadPercent, shortAddress } from '../flow/format.ts'
import { clearCloseRecord } from '../flow/onboarding-record.ts'
import { agentState, backupStatus, budgetFor, currentMarket, describe, positionVariant } from '../flow/position.ts'
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

/** LTV with the segmented track: floor, target, trigger from the Base corridor; liquidation from the market's LLTV. */
function LtvTrack({ m }: { m: PositionMarket }) {
  const marks = [
    { key: 'floor', at: m.corridor.set ? m.corridor.floor : null, label: 'Floor' },
    { key: 'target', at: m.corridor.set ? m.corridor.target : null, label: 'Target' },
    { key: 'act', at: m.corridor.set ? m.corridor.act : null, label: 'Agent acts' },
    { key: 'liquidation', at: m.lltv, label: 'Liquidation' },
  ]
  return <div className="vault-ltv-surface">
    <div className="vault-ltv-track" aria-hidden="true">
      {m.ltv !== null && <span className="vault-ltv-fill" style={{ width: `${Math.min(100, pctNum(m.ltv))}%` }} />}
      {marks.filter(x => x.at !== null).map(x => <span key={x.key} className={`vault-ltv-tick ${x.key}`} style={{ left: `${pctNum(x.at!)}%` }} />)}
      {m.ltv !== null && <span className="vault-ltv-current" style={{ left: `${Math.min(100, pctNum(m.ltv))}%` }} />}
    </div>
    <dl className="vault-ltv-legend vault-ltv-legend--four">
      {marks.map(x => <div key={x.key}><dt><i className={x.key} />{x.label}</dt><dd>{x.at === null ? <Unavailable>not set</Unavailable> : formatWadPercent(x.at)}</dd></div>)}
    </dl>
  </div>
}

function AgentCard({ vaultId, market, view, now, verifying, onVerify }: { vaultId: string; market: PositionMarket | null; view: PositionView; now: number; verifying: boolean; onVerify: () => void }) {
  const agent = useAgent(vaultId)
  const status = agent.isError && !agent.data ? agentState(null, now) : agent.data ? agentState(agent.data, now) : null
  const row = agent.data?.row
  const budget = market ? budgetFor(view, market) : null
  return <section className="card-s5 prototype-surface" aria-labelledby="agent-title">
    <h2 id="agent-title">Agent</h2>
    <p className="card-s5__status" role="status"><strong>{status ? status.state : 'Reading…'}</strong>{status?.detail && <span> · {status.detail}</span>}</p>
    <dl className="card-s5__facts">
      <div><dt>Last check</dt><dd>{row?.last_tick_unix ? `${date(row.last_tick_unix)} (${ago(now - row.last_tick_unix)})` : <Unavailable>none reported</Unavailable>}</dd></div>
      <div><dt>Key expires</dt><dd>{row?.expires_at ? date(row.expires_at) : agent.data?.vaultAgent ? date(agent.data.vaultAgent.expires_at) : <Unavailable>no key</Unavailable>}</dd></div>
      <div><dt>Sell budget left today</dt><dd>{budget && budget.budgetWad > 0n
        ? <>{weth(budget.remaining)} <small>of {weth((budget.activeCollateral + budget.sold) * budget.budgetWad / 10n ** 18n)} ({formatWadPercent(budget.budgetWad)} per rolling 24 h)</small></>
        : <Unavailable>no active corridor</Unavailable>}</dd></div>
    </dl>
    {agent.isError && agent.data && <p className="screen__note" role="alert">The last agent read failed; showing the previous one.</p>}
    <button type="button" className="link-button" aria-expanded={verifying} aria-controls="verify-panel" onClick={onVerify}>Verify the agent</button>
  </section>
}

function MarketCard({ app, view, market, chainNow }: { app: LoadedConfig; view: PositionView; market: PositionMarket | null; chainNow: number }) {
  const explorer = app.guided.network.blockExplorerUrls[0].replace(/\/$/, '')
  const nearblocks = app.guided.help.nearblocks.replace(/\/$/, '')
  const labels = app.config.marketLabels
  const role = market ? labels[market.id.toLowerCase()] ?? 'unknown' : null
  const backup = backupStatus(view, market, labels)
  const BACKUP_TEXT = { current: 'Your position was moved to the backup market.', approved: 'Approved for migration', 'not-approved': 'Not approved for migration', missing: 'No backup market in this vault' } as const
  return <section className="card-s5 prototype-surface" aria-labelledby="market-title">
    <h2 id="market-title">Market</h2>
    <dl className="card-s5__facts">
      <div><dt>Market</dt><dd>Morpho · USDC/WETH on Base Sepolia · {role ?? <Unavailable />}</dd></div>
      {market && <div><dt>Liquidation LTV</dt><dd>{formatWadPercent(market.lltv)}</dd></div>}
      {market && <div><dt>Oracle</dt><dd><OracleLine market={market} chainNow={chainNow} /></dd></div>}
      {market && <div><dt>Market id</dt><dd><code title={market.id}>{market.id.slice(0, 10)}…{market.id.slice(-6)}</code> · <a href={`${explorer}/address/${view.morpho}`} target="_blank" rel="noreferrer">Morpho</a> · <a href={`${explorer}/address/${market.executor}`} target="_blank" rel="noreferrer">Executor</a></dd></div>}
      <div><dt>Backup market</dt><dd>{BACKUP_TEXT[backup]}</dd></div>
      <div><dt>Position address</dt><dd><a href={`${explorer}/address/${view.vault.baseAddress}`} target="_blank" rel="noreferrer">{shortAddress(view.vault.baseAddress)}</a></dd></div>
      <div><dt>Vault</dt><dd><a href={`${nearblocks}/address/${view.vault.accountId}`} target="_blank" rel="noreferrer">{view.vault.accountId}</a></dd></div>
    </dl>
  </section>
}

function RecentActions({ app, view, owner }: { app: LoadedConfig; view: PositionView; owner: `0x${string}` }) {
  const activity = useActivity(view.vault.baseAddress)
  const explorer = app.guided.network.blockExplorerUrls[0].replace(/\/$/, '')
  // On return, the confirmed cached part is shown at once while the newest blocks are read (PRD §9 3).
  const pages = activity.data?.pages ?? (activity.cached ? [{ ...activity.cached, head: activity.cached.to }] : [])
  const fromCache = !activity.data && !!activity.cached
  const items = pages.flatMap(p => p.items)
  const ctx = { owner, positionAddress: view.vault.baseAddress, weth: app.guided.base.weth, usdc: app.guided.base.usdc, marketLabels: app.config.marketLabels }
  const range = pages.length ? `Blocks ${pages[pages.length - 1].from.toString()}–${pages[0].to.toString()}` : null
  return <section className="card-s5 card-s5--wide prototype-surface" aria-labelledby="actions-title">
    <h2 id="actions-title">Recent actions</h2>
    {range && <p className="screen__note">{range}{pages[pages.length - 1].reachedStart ? ' (since the Executor was deployed)' : ''}{fromCache ? ' · saved list, reading newer blocks…' : ''}</p>}
    {activity.isPending && !fromCache && <p className="screen__note" role="status">Reading recent actions…</p>}
    {activity.isError && <p className="notice notice--warning" role="alert">{pages.length ? 'Could not load recent actions. The list below is the previous one.' : 'Could not load recent actions.'}<button type="button" className="prototype-button" onClick={() => { void (pages.length ? activity.fetchNextPage() : activity.refetch()) }}>Retry</button></p>}
    {pages.length > 0 && items.length === 0 && <p className="screen__note">No actions in this range.</p>}
    <ul className="actions">
      {items.map(item => { const d = describe(item, ctx); return <li key={`${item.transactionHash}:${item.logIndex}`} className="actions__row">
        <span className={`actions__who actions__who--${d.who.toLowerCase()}`}>{d.who}</span>
        <span className="actions__text">{d.text}</span>
        <span className="actions__meta">{item.time !== null ? date(item.time) : `block ${item.blockNumber.toString()}`} · <a href={`${explorer}/tx/${item.transactionHash}`} target="_blank" rel="noreferrer">BaseScan</a></span>
      </li> })}
    </ul>
    {activity.hasNextPage && !activity.isError && !fromCache && <button type="button" className="prototype-button" disabled={activity.isFetchingNextPage} onClick={() => { void activity.fetchNextPage() }}>{activity.isFetchingNextPage ? 'Loading…' : 'Load earlier'}</button>}
  </section>
}

/** S6a: the wallet lacks test USDC for the shortfall; the close chain re-reads every 10 s and continues by itself. */
function GetUsdc({ app, address, funding, now }: { app: LoadedConfig; address: Address; funding: NonNullable<Close['record']>['steps']['transfer']['funding']; now: number }) {
  const [copied, setCopied] = useState(false)
  if (!funding) return null
  const [circle, ...others] = app.guided.help.usdcFaucets
  return <section className="help-panel prototype-surface" aria-labelledby="get-usdc-title">
    <div className="help-panel__head">
      <h2 id="get-usdc-title">Get test USDC</h2>
      <span className="help-panel__missing">{usdcExact(BigInt(funding.missing))} missing</span>
    </div>
    <dl className="card-s5__facts">
      <div><dt>To send to your position address</dt><dd>{usdcExact(BigInt(funding.shortfall))}</dd></div>
      <div><dt>USDC in your wallet</dt><dd>{usdcExact(BigInt(funding.wallet))}</dd></div>
      <div><dt>Missing</dt><dd><strong>{usdcExact(BigInt(funding.missing))}</strong></dd></div>
    </dl>
    <div className="help-panel__address"><code>{address}</code>
      <button type="button" className="prototype-button" onClick={() => { void navigator.clipboard?.writeText(address).then(() => setCopied(true), () => undefined) }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
    <p>Test USDC is free from Circle's faucet. Choose <strong>Base Sepolia</strong> in the network dropdown; USDC sent on another network cannot reach this wallet.</p>
    <ul className="help-panel__links">
      {circle && <li><a className="prototype-button is-primary" href={circle.url} target="_blank" rel="noreferrer">{circle.label}</a></li>}
      {others.map(link => <li key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a> <span>— {link.note}</span></li>)}
    </ul>
    <p className="help-panel__small">The 1% headroom comes back to your wallet as leftover USDC in the last close step.</p>
    <p className="help-panel__small" role="status">Checking every 10 seconds; the close continues by itself. Last checked {Math.max(0, Math.round(now - funding.checkedAt / 1000))} s ago.</p>
  </section>
}

/** The pre-sign review sheet (PRD S6): what closing repays, sends and returns, before the first prompt. */
function ReviewSheet({ app, plan, owner, onStart, onCancel }: { app: LoadedConfig; plan: ClosePlan; owner: Address; onStart: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal() }, [])
  const shortfall = closeShortfall(plan)
  const minutes = Math.round(app.guided.messageExpirySecs / 60)
  return <dialog ref={ref} className="sheet prototype-surface" aria-labelledby="review-title" onCancel={event => { event.preventDefault(); onCancel() }}>
    <h2 id="review-title">Close your position</h2>
    <dl className="card-s5__facts">
      <div><dt>Debt now</dt><dd>{usdcExact(plan.debtNow)} <small>accrued to block {plan.blockNumber.toString()}</small></dd></div>
      <div><dt>Interest over the next {minutes} minutes</dt><dd>up to {usdcExact(plan.debtAhead - plan.debtNow)}</dd></div>
      <div><dt>Headroom (1%, returned to you)</dt><dd>{usdcExact(plan.needAhead - plan.debtAhead)}</dd></div>
      <div><dt>USDC already at your position address</dt><dd>{usdcExact(plan.idle.usdc)}</dd></div>
      <div><dt>You send first</dt><dd>{shortfall > 0n ? `${usdcExact(shortfall)} from your wallet to your position address` : 'Nothing: your position address already holds the debt plus 1%'}</dd></div>
      <div><dt>Collateral returned</dt><dd>{weth(plan.collateral + plan.idle.weth)}</dd></div>
      <div><dt>Destination</dt><dd><code>{owner}</code> (your wallet)</dd></div>
    </dl>
    <p>Each signature expires in {minutes} minutes.</p>
    <p>The protocol has no close without repaying: the whole debt is repaid before your WETH is released.</p>
    <div className="screen__actions">
      <button type="button" className="prototype-button is-primary" onClick={onStart}>Start closing</button>
      <button type="button" className="prototype-button" onClick={onCancel}>Cancel</button>
    </div>
  </dialog>
}

function CloseSteps({ app, close, owner, explorer, now }: { app: LoadedConfig; close: Close; owner: Address; explorer: string; now: number }) {
  const r = close.record!
  const ids = visibleCloseSteps(r)
  const active = ids.find(id => r.steps[id].status !== 'done' && r.steps[id].status !== 'skipped')
  const canContinue = !close.running && !!active && r.steps[active].status === 'waiting'
  const funding = active && r.steps[active].status === 'funding' ? r.steps[active].funding : undefined
  return <section className="card-s5 card-s5--wide prototype-surface" aria-labelledby="closing-title">
    <h2 id="closing-title">Closing your position</h2>
    <p className="screen__note">Every signature and transaction is requested in order; you only act inside MetaMask.</p>
    <ol className="steps">
      {ids.map((id, index) => <StepRow key={id} title={CLOSE_TITLE[id]} why={CLOSE_WHY[id]} index={index + 1} step={r.steps[id]} explorer={explorer} now={now} onAct={kind => close.act(id, kind)} />)}
    </ol>
    {funding && <GetUsdc app={app} address={owner} funding={funding} now={now} />}
    {canContinue && <div className="screen__actions"><button type="button" className="prototype-button is-primary" onClick={close.start}>Continue</button></div>}
  </section>
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
  const [review, setReview] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const plan = useClosePlan(vaultId, owner, routeVariant !== 'closed' && !closing)
  const [, setAmount] = useSessionValue(mode, 'amount', DEFAULT_DEPOSIT[mode])

  if (!app || !vaultId) return <section className="screen" aria-labelledby="screen-title"><h1 id="screen-title">Your position</h1><p className="screen__note" role="status">Reading your vault…</p></section>
  if (!view) {
    return <section className="screen" aria-labelledby="screen-title">
      <h1 id="screen-title">Your position</h1>
      {position.isError
        ? <p className="notice notice--warning" role="alert">Your position could not be read. Nothing is shown until it can be.<button type="button" className="prototype-button" onClick={() => { void position.refetch() }}>Retry</button></p>
        : <p className="screen__note" role="status">Reading your position at the latest block…</p>}
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
  if (!owner || !chainOk) closeReason = 'Connect the vault owner on Base Sepolia to close.'
  else if (stale) closeReason = 'The latest read failed; closing waits for a fresh one.'
  else if (restored) closeReason = 'Refreshing your position…'
  else if (plan.isError) closeReason = PLAN_FAILED
  else if (!plan.data) closeReason = 'Reading the amount to repay…'
  const shortfall = plan.data ? closeShortfall(plan.data) : null
  const closeLine = plan.data && shortfall !== null
    ? shortfall === 0n
      ? `Repays ${usdc(plan.data.debtNow)} held at your position address, returns your WETH to your wallet.`
      : `You will first send ${usdcExact(shortfall)} to your position address, then the debt is repaid and your WETH returns to your wallet.`
    : null
  const startClosing = () => {
    if (!app || !owner || !closeVault) return
    setReview(false)
    close.begin(newCloseRecord({ factory: app.config.near.factory, owner, vault: closeVault, now: Date.now() }))
  }
  const startOver = () => {
    if (!owner) return
    clearCloseRecord(mode, app.config.near.factory, owner, vaultId)
    setAmount(DEFAULT_DEPOSIT[mode])
    window.location.hash = href('start')
  }
  // Start over is decided on a live read only (never the persisted or a failed-read snapshot).
  const canStartOver = !restored && !stale && startOverAllowed(view, app.guided.usdcDust)

  return <section className={`screen screen--wide position${stale ? ' position--stale' : ''}`} aria-labelledby="screen-title">
    <h1 id="screen-title">{variant === 'liquidated' ? 'Position liquidated' : variant === 'closed' ? 'Position closed' : 'Your position'}</h1>
    <p className="screen__note" role="status">Read at block {view.blockNumber.toString()}, {ago(age)}{stale ? ' · read-only' : restored ? ' · refreshing' : ''}</p>
    {stale && <p className="notice notice--warning" role="alert">The latest read failed. This is the snapshot from block {view.blockNumber.toString()}, {ago(age)}; it is read-only until a read succeeds.</p>}
    {variant === 'liquidated' && <p className="notice notice--warning">Morpho liquidated the collateral. {usdc(debt)} of debt remains on the market. This app offers no recovery for a liquidated position.</p>}

    <div className="hero-s5">
      <div className="hero-s5__figure prototype-surface"><span>Debt</span><strong>{usdc(debt)}</strong><small>with interest accrued to block {view.blockNumber.toString()}</small></div>
      <div className="hero-s5__figure prototype-surface"><span>Collateral</span><strong>{weth(collateral)}</strong><small>{value !== null ? `≈ $${formatUnits(value, 6, 2)} at the market oracle` : <Unavailable>value unavailable</Unavailable>}</small></div>
      <div className="hero-s5__figure prototype-surface"><span>LTV</span><strong>{market?.ltv != null ? formatWadPercent(market.ltv) : debt > 0n && collateral === 0n ? 'unbounded' : <Unavailable />}</strong>{market && <LtvTrack m={market} />}</div>
    </div>

    {showIdle && <p className="idle-line">At your position address, outside Morpho: {[idle.weth > 0n && weth(idle.weth), idle.usdc > app.guided.usdcDust && usdc(idle.usdc), idle.eth > 0n && `${formatUnits(idle.eth, 18, 6)} ETH for gas`].filter(Boolean).join(' · ')}</p>}

    <div className="cards-s5">
      <AgentCard vaultId={vaultId} market={market} view={view} now={now} verifying={verifying} onVerify={() => setVerifying(v => !v)} />
      <MarketCard app={app} view={view} market={market} chainNow={chainNow} />
    </div>
    {verifying && <div id="verify-panel"><VerificationPanel vaultId={vaultId} poll={false} /></div>}
    {closing && owner && <CloseSteps app={app} close={close} owner={owner} explorer={explorer} now={now} />}
    {owner && <RecentActions app={app} view={view} owner={owner} />}

    {variant === 'active' && !closing && <div className="create-action">
      <button type="button" className="prototype-button is-primary" disabled={closeReason !== null && closeReason !== PLAN_FAILED} aria-describedby="close-reason" onClick={() => { void plan.refetch(); setReview(true) }}>Close position</button>
      <p id="close-reason">{closeReason ?? closeLine}</p>
    </div>}
    {review && plan.isFetching && <p className="screen__note" role="status">Reading the amount to repay…</p>}
    {review && plan.isError && !plan.isFetching && <p className="notice notice--warning" role="alert">The amount to repay could not be read. Nothing is signed.</p>}
    {review && plan.data && !plan.isFetching && !plan.isError && owner && <ReviewSheet app={app} plan={plan.data} owner={owner} onStart={startClosing} onCancel={() => setReview(false)} />}
    {variant === 'closed' && <div className="create-action">
      {canStartOver
        ? <button type="button" className="prototype-button is-primary" onClick={startOver}>Start over</button>
        : <p>Start over appears once your position address holds no WETH and no more than 0.01 USDC.</p>}
      <p className="create-action__small">Start over reuses this vault: no new vault is created.</p>
    </div>}
    <p className="screen__note">Testnet prototype, unaudited. Protection is risk management, not insurance.</p>
  </section>
}
