import { useState } from 'react'
import { useDemo } from './DemoContext.tsx'
import { demoLtv } from './demo.ts'
import { useVaultSelection } from './VaultSelectionContext.tsx'
import './loan-dashboard.css'

type LoanId = 'primary' | 'second'
type ChartMetric = 'asset' | 'risk' | 'debt'
const money = (value: number, digits = 0) => value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const activePhases = ['opened', 'withdrawn', 'risk', 'protected', 'repaid']

function TokenPair() {
  return <span className="loan-tokens" aria-hidden="true"><span>♢</span><span>$</span></span>
}

function RiskBand({ ltv, act, target }: { ltv: number; act: number; target: number }) {
  return <div className="loan-risk-band" role="meter" aria-label="Loan-to-value" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ltv}>
    <div className="loan-risk-track" style={{ background: `linear-gradient(to right, var(--green) 0 ${act}%, var(--yellow) ${act}% 86%, var(--red) 86% 100%)` }}><span className="loan-risk-marker" style={{ left: `${Math.min(99, ltv)}%` }} /></div>
    <div className="loan-risk-markers"><span>Target {target}%</span><span>Agent acts {act}%</span><span>Morpho liquidation 86%</span></div>
  </div>
}

function PositionGraph({ metric, stage, price, collateral, debt, target }: { metric: ChartMetric; stage: number; price: number; collateral: number; debt: number; target: number }) {
  const [point, setPoint] = useState<number | null>(null)
  const labels = ['09:41', '09:52', '09:55', '09:58']
  const series = metric === 'asset' ? [2500, 1750, 1750, 1750] : metric === 'risk' ? [50, 71.4, 71.4, debt > 0 ? debt / (collateral * price) * 100 : 0] : [2500, 2500, 2500, debt]
  const max = metric === 'asset' ? 2750 : metric === 'risk' ? 90 : 3000
  const min = metric === 'asset' ? 1500 : 0
  const x = (index: number) => 28 + index * 180
  const y = (value: number) => 166 - (value - min) / (max - min) * 132
  const path = series.map((value, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(value).toFixed(1)}`).join(' ')
  const selected = point ?? stage
  const current = metric === 'asset' ? `$${money(series[selected])}` : metric === 'risk' ? `${series[selected].toFixed(1)}%` : `${money(series[selected])} USDC`
  return <div className="loan-graph">
    <div className="loan-graph-readout"><strong>{current}</strong><span>{metric === 'asset' ? 'ETH price' : metric === 'risk' ? 'Loan-to-value' : 'Outstanding debt'}</span><small>2 Nov 2026 · {labels[selected]} · demo replay</small></div>
    <svg viewBox="0 0 600 200" role="img" aria-label={`${metric === 'asset' ? 'ETH price' : metric === 'risk' ? 'LTV' : 'Debt'} in the demo scenario, from 09:41 to 09:58`} preserveAspectRatio="none">
      {[35, 79, 123, 167].map(value => <line key={value} x1="28" x2="572" y1={value} y2={value} className="loan-gridline" />)}
      {metric === 'risk' && <line x1="28" x2="572" y1={y(70)} y2={y(70)} className="loan-threshold" />}
      <path d={path} className="loan-chart-future" />
      <path d={series.slice(0, stage + 1).map((value, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(value).toFixed(1)}`).join(' ')} className="loan-chart-current" />
      <circle cx={x(stage)} cy={y(series[stage])} r="5" className="loan-chart-dot" />
      {series.map((value, index) => <circle key={index} cx={x(index)} cy={y(value)} r="22" className="loan-hit" onMouseEnter={() => setPoint(index)} onMouseLeave={() => setPoint(null)} onFocus={() => setPoint(index)} onBlur={() => setPoint(null)} tabIndex={0} aria-label={`${labels[index]}: ${metric === 'asset' ? '$' : ''}${money(value, metric === 'risk' ? 1 : 0)}${metric === 'risk' ? '%' : metric === 'debt' ? ' USDC' : ''}`} />)}
    </svg>
    <div className="loan-graph-axis">{labels.map(label => <span key={label}>{label}</span>)}</div>
    <div className="loan-graph-steps">{['Monitor', 'Price drop', 'Reduce', 'Result'].map((label, index) => <div key={label} className={index === stage ? 'current' : ''}><small>{labels[index]}</small><span>{label}</span></div>)}</div>
    <div className="loan-graph-explain">{stage === 0 ? 'Autopilot watches the 70% LTV line.' : stage === 1 ? 'ETH fell 30%. LTV crossed the agent trigger.' : stage === 2 ? 'The demo agent sold collateral to reduce debt.' : `Loan-to-value returned to the ${target}% target.`}</div>
  </div>
}

export function LoanDashboard() {
  const { state, dispatch } = useDemo()
  const vaultSelection = useVaultSelection()
  const [selected, setSelected] = useState<LoanId>('primary')
  const [tab, setTab] = useState<'ongoing' | 'assets'>('ongoing')
  const [metric, setMetric] = useState<ChartMetric>('asset')
  const hasLocalLoan = activePhases.includes(state.phase)
  const example = selected === 'second' || !hasLocalLoan
  const debt = selected === 'second' ? 900 : hasLocalLoan ? state.debt : 2500
  const collateral = selected === 'second' ? 1.2 : hasLocalLoan ? state.collateral : 2
  const price = selected === 'second' ? 2500 : hasLocalLoan ? state.price : 2500
  const ltv = selected === 'second' ? 30 : hasLocalLoan ? demoLtv(state) : 50
  const trigger = state.rules.act
  const liquidation = debt > 0 ? debt / (collateral * .86) : null
  const distance = liquidation === null ? null : (1 - liquidation / price) * 100
  const stage = state.phase === 'protected' || state.phase === 'repaid' ? 3 : state.phase === 'risk' ? 1 : 0
  const loans = [
    { id: 'primary' as const, debt: hasLocalLoan ? state.debt : 2500, collateral: hasLocalLoan ? state.collateral : 2, ltv: hasLocalLoan ? demoLtv(state) : 50, label: hasLocalLoan ? 'Local demo position' : 'Example position' },
    { id: 'second' as const, debt: 900, collateral: 1.2, ltv: 30, label: 'Second example position' },
  ]
  return <div className="loan-dashboard">
    <div className="intro"><span className="eyebrow">06 / Position · local demo</span><h1>My loan</h1><p>Review each position separately. Live balances will appear here after vault and market reads are connected.</p></div>
    {vaultSelection.selected && <section className="card loan-connected-vault" aria-labelledby="connected-vault-title"><div><span className="eyebrow">Connected wallet · selected vault</span><h2 id="connected-vault-title">Vault {vaultSelection.selected.number}</h2><p>{vaultSelection.selected.accountId}</p></div><div className="loan-connected-vault__details"><span>{vaultSelection.selected.marketCount} {vaultSelection.selected.marketCount === 1 ? 'market' : 'markets'}</span><a href="#connect">Change vault ↗</a></div><p className="loan-connected-vault__note">Position balances are not connected yet. The loans below are separate examples and do not represent this vault.</p></section>}
    {vaultSelection.kind === 'loading' && <p className="loan-vault-notice" role="status">Checking your connected wallet for vaults…</p>}
    {vaultSelection.kind === 'pending' && <p className="loan-vault-notice" role="status">Your wallet is connected. Vault discovery is waiting for the published testnet factory.</p>}
    {vaultSelection.kind === 'error' && <p className="loan-vault-notice" role="status">Vault search could not finish. <a href="#connect">Retry on Connect</a>.</p>}
    <section className="card loan-list-card" aria-labelledby="loans-title"><div className="loan-section-head"><div><h2 id="loans-title">Your loans</h2><p>Two example vault positions · select one to view</p></div><span className="loan-muted">2 demo loans</span></div>
      <div className="loan-list">{loans.map(loan => <button key={loan.id} className={`loan-list-item ${selected === loan.id ? 'is-selected' : ''}`} aria-pressed={selected === loan.id} onClick={() => { setSelected(loan.id); setTab('ongoing') }}><span className="loan-list-name"><TokenPair /><span><strong>WETH / USDC</strong><small>Morpho · Base Sepolia · Testnet</small><em>{loan.label}</em></span></span><span><small>Debt</small><strong>{money(loan.debt)} USDC</strong></span><span><small>Collateral</small><strong>{loan.collateral.toFixed(3)} WETH</strong></span><span><small>Risk · LTV</small><strong>{loan.ltv.toFixed(1)}%</strong><em>{loan.ltv >= trigger ? 'Above agent trigger' : 'Below agent trigger'}</em></span><span className="loan-select-icon" aria-hidden="true">{selected === loan.id ? '✓' : '→'}</span></button>)}</div>
    </section>
    <section className="card loan-active" aria-labelledby="active-loan-title"><div className="loan-section-head"><div><h2 id="active-loan-title">Active loan</h2><p>{example ? 'Example position · no on-chain loan connected' : 'Local demo position · no on-chain loan connected'}</p></div><span className="loan-muted">WETH / USDC</span></div>
      <div className="loan-tabs" role="tablist" aria-label="Active loan views"><button role="tab" aria-selected={tab === 'ongoing'} onClick={() => setTab('ongoing')}>Ongoing loan</button><button role="tab" aria-selected={tab === 'assets'} onClick={() => setTab('assets')}>Asset overview</button></div>
      {tab === 'ongoing' ? <div className="loan-active-body"><div className="loan-balance-row"><div><small>Outstanding loan</small><div className="loan-balance">{money(debt)} <span>USDC</span></div></div><div><small>Collateral</small><strong>{collateral.toFixed(3)} WETH</strong><span>${money(collateral * price, 2)}</span></div></div><div className="loan-facts"><div><small>LTV</small><strong>{ltv.toFixed(1)}%</strong></div><div><small>Agent trigger</small><strong>{trigger}%</strong></div><div><small>Morpho liquidation</small><strong>86%</strong></div><div><small>Liquidation price</small><strong>{liquidation === null ? 'No debt' : `$${money(liquidation, 2)}`}</strong></div><div><small>Borrow rate</small><strong>Feed not connected</strong></div></div></div> : <div className="loan-assets" role="tabpanel"><div><small>Total debt</small><strong>{money(debt)} USDC</strong></div><div><small>Total collateral</small><strong>${money(collateral * price, 2)}</strong></div><div><small>Collateral asset</small><strong>{collateral.toFixed(3)} WETH</strong></div><p>One selected loan. Market interest and fees are not connected.</p></div>}
      <div className="loan-actions">{example ? <button className="button" onClick={() => { window.location.hash = 'create' }}>Start a demo loan <span aria-hidden="true">→</span></button> : <>{state.phase === 'opened' ? <button className="button" onClick={() => { window.location.hash = 'take' }}>Take the USDC <span aria-hidden="true">→</span></button> : <button className="button" onClick={() => { window.location.hash = 'leave' }}>{state.phase === 'repaid' ? 'Withdraw collateral' : 'Repay'} <span aria-hidden="true">→</span></button>}<button className="button button--secondary" onClick={() => { window.location.hash = 'change' }}>View rules</button>{state.phase !== 'opened' && <button className="loan-text-action" onClick={() => { window.location.hash = 'leave' }}>Close loan</button>}</>}</div>
    </section>
    <section className="card loan-position" aria-labelledby="position-title"><div className="loan-section-head"><div><h2 id="position-title">Your position</h2><p>{selected === 'second' ? 'Static example · no replay for this vault' : 'Demo replay · 2 Nov 2026'}</p></div><div className="loan-chart-controls">{selected === 'primary' && hasLocalLoan && <>{state.phase === 'withdrawn' && <button className="button button--secondary" onClick={() => dispatch({ type: 'price-drop' })}>Simulate price drop</button>}{state.phase === 'risk' && <button className="button button--secondary" disabled={ltv < trigger} onClick={() => dispatch({ type: 'reduce' })}>Run demo Reduce</button>}</>}<div className="loan-segmented" role="tablist" aria-label="Chart metric">{(['asset','risk','debt'] as const).map(item => <button key={item} role="tab" aria-selected={metric === item} onClick={() => setMetric(item)}>{item === 'asset' ? 'ETH price' : item === 'risk' ? 'LTV' : 'Debt'}</button>)}</div></div></div>
      {selected === 'second' ? <div className="loan-static-position"><strong>{ltv.toFixed(1)}% LTV</strong><p>No price replay is recorded for this example vault. Its numbers are shown above.</p></div> : <><PositionGraph metric={metric} stage={stage} price={price} collateral={collateral} debt={debt} target={state.rules.target} /><div className="loan-mini-grid"><div><small>Collateral value</small><strong>${money(collateral * price, 2)}</strong><span>{collateral.toFixed(3)} WETH at ${money(price)}</span></div><div><small>Risk · LTV</small><strong>{ltv.toFixed(1)}%</strong><span>Agent acts at {trigger}%</span></div><div><small>Loan balance</small><strong>{money(debt)} USDC</strong><span>At the selected demo stage</span></div></div></>}
    </section>
    <section className="card loan-health" aria-labelledby="health-title"><div className="loan-section-head"><div><h2 id="health-title">Position health</h2><p>Distance from current ETH price to liquidation</p></div><button className="loan-text-action" onClick={() => { window.location.hash = 'change' }}>Agent rules ↗</button></div><div className="loan-health-number">{distance === null ? 'No debt' : `${distance.toFixed(1)}%`} <span>{debt === 0 ? 'Loan repaid' : ltv >= trigger ? 'Above agent trigger' : 'Below agent trigger'}</span></div><RiskBand ltv={ltv} act={trigger} target={state.rules.target} /><div className="loan-health-facts"><div><small>ETH price</small><strong>${money(price, 2)}</strong></div><div><small>Agent trigger</small><strong>{debt > 0 ? `$${money(debt / (collateral * trigger / 100), 2)}` : 'No debt'}</strong></div><div><small>Liquidation price</small><strong>{liquidation === null ? 'No debt' : `$${money(liquidation, 2)}`}</strong></div></div><div className="loan-agent-status"><span aria-hidden="true">♢</span><div><strong>{state.phase === 'risk' && selected === 'primary' ? 'Risk detected' : state.phase === 'protected' && selected === 'primary' ? 'Reduce completed' : 'Autopilot example'}</strong><small>No live agent check or key connected</small></div><span aria-hidden="true">→</span></div></section>
    <section className="card loan-activity" aria-labelledby="activity-title"><div className="loan-section-head"><div><h2 id="activity-title">Activity</h2><p>Events for the selected demo position</p></div></div>{selected === 'primary' && state.events.length ? state.events.map((event, index) => <div className="loan-activity-row" key={`${index}-${event}`}><span>{event}</span><small>{index === 0 ? 'Latest' : 'Demo'}</small></div>) : <div className="loan-activity-row"><span>Example position</span><small>No recorded transactions</small></div>}</section>
  </div>
}
