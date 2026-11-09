import {positionTableRead,type PositionTableRead} from './position-table-state.ts'
import {marketTitle} from './vault-layout.ts'
import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import { loadConfig, type Vault } from './near.ts'
import { readLivePosition } from './positions.ts'
import { VaultTable, type VaultTableRow } from './VaultTable.tsx'
import { PrototypeButton } from './ui/PrototypeControls.tsx'

const amount = (value: bigint, decimals: number) => formatUnits(value, decimals)
const percent = (value: bigint | null) => value === null ? '—' : `${(Number(value) / 1e16).toFixed(1)}%`

export function LiveVaultTable({ vaults, onOpen }: { vaults: Vault[]; onOpen: (id: string) => void }) {
  const [revision, setRevision] = useState(0)
  const source=JSON.stringify(vaults.map(vault=>[vault.accountId,vault.owner.toLowerCase(),vault.baseAddress]))
  const [result, setResult] = useState<PositionTableRead<VaultTableRow&{sourceVault?:string}>|null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    loadConfig().then(async config => {
      const reads:PromiseSettledResult<Awaited<ReturnType<typeof readLivePosition>>>[]=[]
      for(let start=0;start<vaults.length;start+=2){if(!active)return;reads.push(...await Promise.allSettled(vaults.slice(start,start+2).map(vault=>readLivePosition(config,vault.accountId,vault.owner))))}
      if (!active) return
      const rows:(VaultTableRow&{sourceVault:string})[]=[]
      const errors: string[] = []
      reads.forEach((read, index) => {
        const vault = vaults[index]
        if (read.status === 'rejected') { errors.push(`Vault ${vault.number}: position unavailable. ${read.reason instanceof Error ? read.reason.message : 'Please retry.'}`); return }
        errors.push(...(read.value.errors ?? []))
        if (!read.value.markets.length && !read.value.errors?.length) errors.push(`Vault ${vault.number}: no configured markets.`)
        read.value.markets.forEach(market => rows.push({
          sourceVault:vault.accountId, marketLabel:market.label ?? `${market.id.slice(0,10)}…`, name: marketTitle(market), loanSymbol: market.loanSymbol, loanId: market.loanToken, vaultAddress: read.value.baseAddress, detail: `${market.collateralSymbol} / ${market.loanSymbol} · ${market.id.slice(0, 10)}… · ${vault.accountId}`,
          asset: market.collateralSymbol, assetId: market.collateralToken.toLowerCase(),
          collateral: `${amount(market.collateral, market.collateralDecimals)} ${market.collateralSymbol}`,
          value: market.priceUnavailable ? 'Oracle unavailable' : `${amount(market.collateralValue, market.loanDecimals)} ${market.loanSymbol} at oracle`,
          debt: `${amount(market.debt, market.loanDecimals)} ${market.loanSymbol}`,
          health: market.debt > 0n && market.collateralValue === 0n && !market.priceUnavailable ? 'Critical' : market.debt===0n ? 'No debt' : market.ltv && market.ltv>0n ? (Number(market.liquidationLtv)/Number(market.ltv)).toFixed(1) : '—', ltv: percent(market.ltv), liquidation: percent(market.liquidationLtv), protection: market.autopilot, protectionValidUntil:market.protectionValidUntil, registrationExpires:market.registrationExpires,
          onOpen: () => onOpen(vault.accountId),
        }))
      })
      setResult(previous=>positionTableRead(previous,source,rows,errors,Date.now()))
    }).catch(error => { if (active) setResult(previous=>positionTableRead(previous,source,[],[error instanceof Error?error.message:'Position loading failed.'],Date.now())) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [source, revision])
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setRevision(value => value + 1) }, 30000)
    return () => window.clearInterval(timer)
  }, [])
  const current = result?.source === source ? result : null
  return <div>
    <p className="demo-summary">Read from NEAR and Base Sepolia. Debt and LTV include interest calculated at the read block. Autopilot reflects registration, rules and a recent agent observation, not a guarantee of execution or a successful market read.</p>
    <PrototypeButton disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh positions</PrototypeButton>
    <p className="position-read-status" role="status">{loading ? 'Reading vault positions…' : ' '}</p>
    {current?.errors.map(error => <p role="alert" key={error}>{error}</p>)}
    {current?.staleSnapshot&&<p role="status">Position reads are incomplete.{current.time?' Showing the last complete snapshot; rows open read-only verification.':' Available rows are partial; rows open read-only verification.'}</p>}
    {current && current.rows.length > 0 && <VaultTable vaults={current.staleSnapshot?current.rows.map(row=>({...row,protection:'Unavailable',onOpen:()=>{const vault=vaults.find(item=>row.sourceVault===item.accountId);if(vault)window.location.hash=`verify?vault=${encodeURIComponent(vault.accountId)}`}})):current.rows} />}
    {current?.time && <p className="demo-summary">Last complete read {new Date(current.time).toLocaleTimeString()} · Updates every 30 seconds while visible.</p>}
  </div>
}
