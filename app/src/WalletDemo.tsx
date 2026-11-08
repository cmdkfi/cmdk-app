import { useState } from 'react'
import { PrototypeButton, PrototypeSurface } from './ui/PrototypeControls.tsx'
import './wallet-demo.css'

const vaults = [
  { name: 'ETH vault', collateral: '5.00 ETH', value: '$14,000.00', debt: '7,000.00 USDC', ltv: '50.0%', protection: 'Autopilot on' },
  { name: 'WETH vault', collateral: '2.00 WETH', value: '$5,600.00', debt: '2,240.00 USDC', ltv: '40.0%', protection: 'Autopilot off' },
]
const actions = [
  { id: 1, vault: 'ETH vault', actor: 'agent', title: 'Reduced debt', amount: '−1,400.00 USDC', detail: 'Sample protective repayment · LTV returned to 50.0%', time: '8 Nov 2026 · 14:32 UTC' },
  { id: 2, vault: 'WETH vault', actor: 'you', title: 'Borrowed USDC', amount: '+2,240.00 USDC', detail: 'Sample loan opened against 2.00 WETH', time: '8 Nov 2026 · 11:10 UTC' },
  { id: 3, vault: 'ETH vault', actor: 'you', title: 'Updated rules', amount: '70.0% trigger', detail: 'Sample target 50.0% · Daily budget 20.0%', time: '7 Nov 2026 · 16:45 UTC' },
  { id: 4, vault: 'ETH vault', actor: 'you', title: 'Deposited collateral', amount: '+5.00 ETH', detail: 'Sample initial deposit', time: '7 Nov 2026 · 16:30 UTC' },
]

export function DemoVaults() {
  return <><p className="demo-summary">2 vaults · Base Sepolia · Sample portfolio</p><div className="demo-vault-grid">{vaults.map(vault => <PrototypeSurface key={vault.name} className="demo-vault">
    <div className="demo-card-heading"><h2>{vault.name}</h2><span className="testnet-label">Demo</span></div>
    <p className="demo-protection">{vault.protection}</p>
    <dl className="demo-metrics"><div><dt>Collateral</dt><dd>{vault.collateral}<small>{vault.value}</small></dd></div><div><dt>Debt</dt><dd>{vault.debt}</dd></div><div><dt>Loan-to-value</dt><dd>{vault.ltv}</dd></div></dl>
    <a className="prototype-button" href="#activity">View activity <span aria-hidden="true"> ↗</span></a>
  </PrototypeSurface>)}</div></>
}

export function DemoActivity() {
  const [actor, setActor] = useState('all')
  const [vault, setVault] = useState('all')
  const visible = actions.filter(action => (actor === 'all' || action.actor === actor) && (vault === 'all' || action.vault === vault))
  return <><div className="demo-filters"><div className="demo-filter-buttons" role="group" aria-label="Filter by action author">{[['all', 'All'], ['you', 'Your actions'], ['agent', 'Agent actions']].map(([value, label]) => <PrototypeButton key={value} primary={actor === value} aria-pressed={actor === value} onClick={() => setActor(value)}>{label}</PrototypeButton>)}</div><label className="demo-vault-filter">Vault<select value={vault} onChange={event => setVault(event.target.value)}><option value="all">All vaults</option>{vaults.map(item => <option key={item.name}>{item.name}</option>)}</select></label></div>
    <p className="demo-summary" role="status">{visible.length} sample events · All times UTC</p>
    <PrototypeSurface className="demo-activity"><ul>{visible.map(action => <li key={action.id}><div className="demo-event-main"><h2>{action.title}</h2><p>{action.vault} · {action.actor === 'agent' ? 'Agent' : 'You'} · Demo</p><p>{action.detail}</p></div><div className="demo-event-meta"><strong>{action.amount}</strong><small>{action.time}</small></div></li>)}</ul>{visible.length === 0 && <p className="demo-empty">No sample events match these filters.</p>}</PrototypeSurface>
  </>
}
