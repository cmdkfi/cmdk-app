import { VaultTable } from './VaultTable.tsx'
import { useState } from 'react'
import { PrototypeButton, PrototypeSurface } from './ui/PrototypeControls.tsx'
import './wallet-demo.css'
import { PrototypeFilter } from './ui/PrototypeFilter.tsx'

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
  return <VaultTable demo vaults={vaults.map((row, i) => ({ ...row, name: 'USDC / WETH', onOpen: () => { sessionStorage.setItem('cmdk-demo-position', String(i)); window.location.hash = 'vault' }, loanSymbol: 'USDC', loanId: 'demo-usdc', vaultAddress: `0xdE0000000000000000000000000000000000000${i + 1}`,  asset: 'WETH', assetId: 'demo-weth', detail: `WETH / USDC · Demo market ${i + 1}`, collateral: `${i ? '2.00' : '5.00'} WETH`, value: `${i ? '5,600' : '14,000'} USDC at oracle`, liquidation: '86.0%', protection: i ? 'Not configured' : 'Active' }))} />
}

export function DemoActivity() {
  const [actor, setActor] = useState('all')
  const [vault, setVault] = useState('all')
  const visible = actions.filter(action => (actor === 'all' || action.actor === actor) && (vault === 'all' || action.vault === vault))
  return <><div className="demo-filters"><div className="demo-filter-buttons" role="group" aria-label="Filter by action author">{[['all', 'All'], ['you', 'Your actions'], ['agent', 'Agent actions']].map(([value, label]) => <PrototypeButton key={value} primary={actor === value} aria-pressed={actor === value} onClick={() => setActor(value)}>{label}</PrototypeButton>)}</div><PrototypeFilter label="Vault" value={vault} onChange={setVault} icon="asset" options={[{ value: 'all', label: 'All vaults' }, ...vaults.map(item => ({ value: item.name, label: item.name }))]} /></div>
    <p className="demo-summary" role="status">{visible.length} sample events · All times UTC</p>
    <PrototypeSurface className="demo-activity"><ul>{visible.map(action => <li key={action.id}><div className="demo-event-main"><h2>{action.title}</h2><p>{action.vault} · {action.actor === 'agent' ? 'Agent' : 'You'} · Demo</p><p>{action.detail}</p></div><div className="demo-event-meta"><strong>{action.amount}</strong><small>{action.time}</small></div></li>)}</ul>{visible.length === 0 && <p className="demo-empty">No sample events match these filters.</p>}</PrototypeSurface>
  </>
}
