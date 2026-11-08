import { useState } from 'react'
import { PrototypeButton, PrototypeSurface } from './ui/PrototypeControls.tsx'
import './wallet-demo.css'
import { PrototypeFilter, FilterIcon } from './ui/PrototypeFilter.tsx'

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
  const [query, setQuery] = useState('')
  const [asset, setAsset] = useState('all')
  const [autopilot, setAutopilot] = useState('all')
  const filtered = vaults.filter(vault => vault.name.toLowerCase().includes(query.trim().toLowerCase()) && (asset === 'all' || vault.collateral.endsWith(` ${asset}`)) && (autopilot === 'all' || vault.protection === `Autopilot ${autopilot}`))
  const hasFilters = query !== '' || asset !== 'all' || autopilot !== 'all'
  function clearFilters() { setQuery(''); setAsset('all'); setAutopilot('all') }
  return <><p className="demo-summary" role="status">{filtered.length} of {vaults.length} vaults · Base Sepolia · Sample portfolio</p>
    <PrototypeSurface className="demo-vault-tools">
      <div className="demo-vault-filter-row">
        <PrototypeFilter label="Asset" value={asset} onChange={setAsset} icon="asset" options={[{ value: 'all', label: 'All assets' }, { value: 'ETH', label: 'ETH' }, { value: 'WETH', label: 'WETH' }]} />
        <PrototypeFilter label="Autopilot" value={autopilot} onChange={setAutopilot} icon="status" options={[{ value: 'all', label: 'All statuses' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
        {hasFilters && <PrototypeButton onClick={clearFilters}>Clear filters</PrototypeButton>}
      </div>
      <label className="demo-vault-search"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" aria-label="Search vaults by name" placeholder="Filter vaults by name" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </PrototypeSurface>
    {filtered.length === 0 && <PrototypeSurface className="demo-vault-no-results"><h2>No vaults found</h2><p>Try another name or clear your filters.</p><PrototypeButton onClick={clearFilters}>Clear filters</PrototypeButton></PrototypeSurface>}
    {filtered.length > 0 && <PrototypeSurface className="demo-vault-table"><table><caption className="demo-table-caption">Demo vaults</caption>
      <thead><tr><th scope="col">Vault</th><th scope="col">Collateral</th><th scope="col">Debt</th><th scope="col">LTV</th><th scope="col">Autopilot</th></tr></thead>
      <tbody>{filtered.map(vault => <tr key={vault.name}>
        <th scope="row"><span className="demo-asset-name"><FilterIcon kind="asset"/>{vault.name}</span><small>Base Sepolia</small></th>
        <td>{vault.collateral}<small>{vault.value}</small></td><td>{vault.debt}</td><td>{vault.ltv}</td><td><span className="demo-autopilot">{vault.protection === 'Autopilot on' ? 'On' : 'Off'}</span></td>
      </tr>)}</tbody>
    </table></PrototypeSurface>}
    <div className="demo-vault-cards">{filtered.map(vault => <PrototypeSurface key={vault.name} className="demo-vault-compact">
      <div className="demo-card-heading"><div><h2 className="demo-asset-name"><FilterIcon kind="asset"/>{vault.name}</h2><small>Base Sepolia</small></div><span className="demo-autopilot">{vault.protection}</span></div>
      <dl><div><dt>Collateral</dt><dd>{vault.collateral}<small>{vault.value}</small></dd></div><div><dt>Debt</dt><dd>{vault.debt}</dd></div><div><dt>LTV</dt><dd>{vault.ltv}</dd></div></dl>
    </PrototypeSurface>)}</div>
  </>
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
