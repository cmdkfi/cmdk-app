import { useState } from 'react'
import { TokenIcon } from './ui/TokenIcon.tsx'
import { PrototypeButton, PrototypeSurface } from './ui/PrototypeControls.tsx'
import { PrototypeFilter } from './ui/PrototypeFilter.tsx'
import './wallet-demo.css'

export type VaultTableRow = { name: string; loanSymbol: string; loanId: string; vaultAddress: string; collateral: string; value: string; debt: string; ltv: string; liquidation: string; protection: string; asset: string; assetId: string; detail: string; onOpen?: () => void }
export function AssetIcon({ symbol, address }: { symbol: string; address: string }) {
  const known = address === 'demo-weth' || address.toLowerCase() === '0x4200000000000000000000000000000000000006' ? 'WETH'
    : address === 'demo-usdc' || address.toLowerCase() === '0x036cbd53842c5426634e7929541ec2318f3dcf7e' ? 'USDC' : null
  return known ? <TokenIcon asset={known} /> : <span className="token-icon" aria-hidden="true">{symbol.slice(0, 1)}</span>
}
function VaultTitle({ vault }: { vault: VaultTableRow }) {
  const pair = <span className="vault-token-pair"><span><AssetIcon symbol={vault.loanSymbol} address={vault.loanId} />{vault.loanSymbol}</span><span className="vault-pair-divider">/</span><span><AssetIcon symbol={vault.asset} address={vault.assetId} />{vault.asset}</span></span>
  return <>{vault.onOpen ? <button className="vault-table-open" aria-label={`Open ${vault.loanSymbol} / ${vault.asset}, ${vault.vaultAddress}, ${vault.detail}`} onClick={vault.onOpen}>{pair}</button> : pair}</>
}
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

export function VaultTable({ vaults, demo = false }: { vaults: VaultTableRow[]; demo?: boolean }) {
  const [query, setQuery] = useState('')
  const [asset, setAsset] = useState('all')
  const [autopilot, setAutopilot] = useState('all')
  const filtered = vaults.filter(vault => `${vault.name} ${vault.detail} ${vault.vaultAddress}`.toLowerCase().includes(query.trim().toLowerCase()) && (asset === 'all' || vault.assetId === asset) && (autopilot === 'all' || vault.protection === autopilot))
  const hasFilters = query !== '' || asset !== 'all' || autopilot !== 'all'
  function clearFilters() { setQuery(''); setAsset('all'); setAutopilot('all') }
  return <><p className="demo-summary" role="status">{filtered.length} of {vaults.length} positions · Base Sepolia · {demo ? 'Demo' : 'On-chain'}</p>
    <PrototypeSurface className="demo-vault-tools">
      <div className="demo-vault-filter-row">
        <PrototypeFilter label="Collateral" value={asset} onChange={setAsset} icon="asset" options={[{ value: 'all', label: 'All collateral' }, ...Array.from(new Map(vaults.map(row => [row.assetId, { value: row.assetId, label: row.asset }])).values())]} />
        <PrototypeFilter label="Autopilot" value={autopilot} onChange={setAutopilot} icon="status" options={[{ value: 'all', label: 'All statuses' }, ...Array.from(new Set(vaults.map(row => row.protection))).map(value => ({ value, label: value }))]} />
        {hasFilters && <PrototypeButton onClick={clearFilters}>Clear filters</PrototypeButton>}
      </div>
      <label className="demo-vault-search"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" aria-label="Search vaults by token or address" placeholder="Filter by token or vault address" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </PrototypeSurface>
    {filtered.length === 0 && <PrototypeSurface className="demo-vault-no-results"><h2>No vaults found</h2><p>Try another name or clear your filters.</p><PrototypeButton onClick={clearFilters}>Clear filters</PrototypeButton></PrototypeSurface>}
    {filtered.length > 0 && <PrototypeSurface className="demo-vault-table"><table><caption className="demo-table-caption">Vault positions</caption>
      <thead><tr><th scope="col">Vault</th><th scope="col">Collateral</th><th scope="col">Debt</th><th scope="col">LTV / Liquidation</th><th scope="col">Autopilot</th></tr></thead>
      <tbody>{filtered.map(vault => <tr key={`${vault.name}:${vault.detail}`}>
        <th scope="row"><VaultTitle vault={vault} /><small className="vault-address" title={`${vault.vaultAddress} · ${vault.detail}`}>{shortAddress(vault.vaultAddress)}</small></th>
        <td>{vault.collateral}<small>{vault.value}</small></td><td>{vault.debt}</td><td>{vault.ltv}<small>Liquidation {vault.liquidation}</small></td><td><span className="demo-autopilot">{vault.protection}</span></td>
      </tr>)}</tbody>
    </table></PrototypeSurface>}
    <div className="demo-vault-cards">{filtered.map(vault => <PrototypeSurface key={`${vault.name}:${vault.detail}`} className="demo-vault-compact">
      <div className="demo-card-heading"><div><h2><VaultTitle vault={vault} /></h2><small className="vault-address" title={`${vault.vaultAddress} · ${vault.detail}`}>{shortAddress(vault.vaultAddress)}</small></div><span className="demo-autopilot">{vault.protection}</span></div>
      <dl><div><dt>Collateral</dt><dd>{vault.collateral}<small>{vault.value}</small></dd></div><div><dt>Debt</dt><dd>{vault.debt}</dd></div><div><dt>LTV / Liquidation</dt><dd>{vault.ltv}<small>Liquidation {vault.liquidation}</small></dd></div></dl>
    </PrototypeSurface>)}</div>
  </>
}

