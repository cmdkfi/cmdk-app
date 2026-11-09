import { useState } from 'react'
import { useWalletState } from '../adapters/AdapterProvider.tsx'
import type { PositionMarket, PositionView } from '../adapters/types.ts'
import { useActivity, useAgent, useAppConfig, useDiscovery, usePosition } from '../components/data.ts'
import { useNow } from '../components/use-now.ts'
import type { LoadedConfig } from '../flow/config.ts'
import type { PositionVariant } from '../flow/entry.ts'
import { formatUnits, formatWadPercent, shortAddress } from '../flow/format.ts'
import { agentState, backupStatus, budgetFor, currentMarket, describe, positionVariant } from '../flow/position.ts'
import { Unavailable } from './common.tsx'

const usdc = (v: bigint) => `${formatUnits(v, 6, 2)} USDC`
const weth = (v: bigint) => `${formatUnits(v, 18, 6)} WETH`
const pctNum = (wad: bigint) => Number(wad * 10_000n / 10n ** 18n) / 100
const ago = (seconds: number) => (seconds < 90 ? `${Math.max(0, Math.round(seconds))} s ago` : seconds < 5400 ? `${Math.round(seconds / 60)} min ago` : `${Math.round(seconds / 3600)} h ago`)
const date = (secs: number | bigint) => new Date(Number(secs) * 1000).toLocaleString()

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

function AgentCard({ vaultId, market, view, now }: { vaultId: string; market: PositionMarket | null; view: PositionView; now: number }) {
  const agent = useAgent(vaultId)
  const [verify, setVerify] = useState(false)
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
    <button type="button" className="link-button" aria-expanded={verify} onClick={() => setVerify(v => !v)}>Verify the agent</button>
    {verify && <p className="screen__note">The verification panel arrives in Phase 6. Nothing is shown as checked until then.</p>}
  </section>
}

function MarketCard({ app, view, market }: { app: LoadedConfig; view: PositionView; market: PositionMarket | null }) {
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
  const pages = activity.data?.pages ?? []
  const items = pages.flatMap(p => p.items)
  const ctx = { owner, positionAddress: view.vault.baseAddress, weth: app.guided.base.weth, usdc: app.guided.base.usdc, marketLabels: app.config.marketLabels }
  const range = pages.length ? `Blocks ${pages[pages.length - 1].from.toString()}–${pages[0].to.toString()}` : null
  return <section className="card-s5 card-s5--wide prototype-surface" aria-labelledby="actions-title">
    <h2 id="actions-title">Recent actions</h2>
    {range && <p className="screen__note">{range}{pages[pages.length - 1].reachedStart ? ' (since the Executor was deployed)' : ''}</p>}
    {activity.isPending && <p className="screen__note" role="status">Reading recent actions…</p>}
    {activity.isError && <p className="notice notice--warning" role="alert">{pages.length ? 'Could not load recent actions. The list below is the previous one.' : 'Could not load recent actions.'}<button type="button" className="prototype-button" onClick={() => { void (pages.length ? activity.fetchNextPage() : activity.refetch()) }}>Retry</button></p>}
    {pages.length > 0 && items.length === 0 && <p className="screen__note">No actions in this range.</p>}
    <ul className="actions">
      {items.map(item => { const d = describe(item, ctx); return <li key={`${item.transactionHash}:${item.logIndex}`} className="actions__row">
        <span className={`actions__who actions__who--${d.who.toLowerCase()}`}>{d.who}</span>
        <span className="actions__text">{d.text}</span>
        <span className="actions__meta">{item.time !== null ? date(item.time) : `block ${item.blockNumber.toString()}`} · <a href={`${explorer}/tx/${item.transactionHash}`} target="_blank" rel="noreferrer">BaseScan</a></span>
      </li> })}
    </ul>
    {activity.hasNextPage && !activity.isError && <button type="button" className="prototype-button" disabled={activity.isFetchingNextPage} onClick={() => { void activity.fetchNextPage() }}>{activity.isFetchingNextPage ? 'Loading…' : 'Load earlier'}</button>}
  </section>
}

export function Position({ variant: routeVariant, discovery }: { variant?: PositionVariant; discovery: ReturnType<typeof useDiscovery> }) {
  const app = useAppConfig().data
  const wallet = useWalletState()
  const now = useNow()
  const vaultId = discovery.result?.summary?.vault.accountId
  const position = usePosition(vaultId)
  const view = position.data
  const owner = wallet.status === 'connected' ? wallet.address : undefined

  if (!app || !vaultId) return <section className="screen" aria-labelledby="screen-title"><h1 id="screen-title">Your position</h1><p className="screen__note" role="status">Reading your vault…</p></section>
  if (!view) {
    return <section className="screen" aria-labelledby="screen-title">
      <h1 id="screen-title">Your position</h1>
      {position.isError
        ? <p className="notice notice--warning" role="alert">Your position could not be read. Nothing is shown until it can be.<button type="button" className="prototype-button" onClick={() => { void position.refetch() }}>Retry</button></p>
        : <p className="screen__note" role="status">Reading your position at the latest block…</p>}
    </section>
  }

  const variant = positionVariant(view, routeVariant === 'closed')
  const market = currentMarket(view, app.guided.liveMarket.id)
  const debt = view.markets.reduce((sum, m) => sum + m.debt, 0n)
  const collateral = view.markets.reduce((sum, m) => sum + m.collateral, 0n)
  const value = view.markets.every(m => m.value !== null) ? view.markets.reduce((sum, m) => sum + (m.value ?? 0n), 0n) : null
  const age = now - position.dataUpdatedAt / 1000
  const stale = position.isError
  const idle = view.idle
  // USDC below guided.usdcDust is repay rounding (config.app.json), not a balance to report
  const showIdle = idle.weth > 0n || idle.usdc > app.guided.usdcDust || idle.eth > 0n

  return <section className={`screen screen--wide position${stale ? ' position--stale' : ''}`} aria-labelledby="screen-title">
    <h1 id="screen-title">{variant === 'liquidated' ? 'Position liquidated' : variant === 'closed' ? 'Position closed' : 'Your position'}</h1>
    <p className="screen__note" role="status">Read at block {view.blockNumber.toString()}, {ago(age)}{stale ? ' · read-only' : ''}</p>
    {stale && <p className="notice notice--warning" role="alert">The latest read failed. This is the snapshot from block {view.blockNumber.toString()}, {ago(age)}; it is read-only until a read succeeds.</p>}
    {variant === 'liquidated' && <p className="notice notice--warning">Morpho liquidated the collateral. {usdc(debt)} of debt remains on the market. This app offers no recovery for a liquidated position.</p>}

    <div className="hero-s5">
      <div className="hero-s5__figure prototype-surface"><span>Debt</span><strong>{usdc(debt)}</strong><small>with interest accrued to block {view.blockNumber.toString()}</small></div>
      <div className="hero-s5__figure prototype-surface"><span>Collateral</span><strong>{weth(collateral)}</strong><small>{value !== null ? `≈ $${formatUnits(value, 6, 2)} at the market oracle` : <Unavailable>value unavailable</Unavailable>}</small></div>
      <div className="hero-s5__figure prototype-surface"><span>LTV</span><strong>{market?.ltv != null ? formatWadPercent(market.ltv) : debt > 0n && collateral === 0n ? 'unbounded' : <Unavailable />}</strong>{market && <LtvTrack m={market} />}</div>
    </div>

    {showIdle && <p className="idle-line">At your position address, outside Morpho: {[idle.weth > 0n && weth(idle.weth), idle.usdc > app.guided.usdcDust && usdc(idle.usdc), idle.eth > 0n && `${formatUnits(idle.eth, 18, 6)} ETH for gas`].filter(Boolean).join(' · ')}</p>}

    <div className="cards-s5">
      <AgentCard vaultId={vaultId} market={market} view={view} now={now} />
      <MarketCard app={app} view={view} market={market} />
    </div>
    {owner && <RecentActions app={app} view={view} owner={owner} />}

    {variant === 'active' && <div className="create-action">
      <button type="button" className="prototype-button is-primary" disabled aria-describedby="close-reason">Close position</button>
      <p id="close-reason">Closing arrives in Phase 5.</p>
    </div>}
    <p className="screen__note">Testnet prototype, unaudited. Protection is risk management, not insurance.</p>
  </section>
}
