import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import { loadConfig, type Vault } from './near.ts'
import { readLivePosition } from './positions.ts'
import { VaultTable, type VaultTableRow } from './VaultTable.tsx'
import { PrototypeButton } from './ui/PrototypeControls.tsx'

const amount = (value: bigint, decimals: number) => Number(formatUnits(value, decimals)).toLocaleString('en-US', { maximumFractionDigits: 6 })
const percent = (value: bigint | null) => value === null ? '—' : `${(Number(value) / 1e16).toFixed(1)}%`

export function LiveVaultTable({ vaults, onOpen }: { vaults: Vault[]; onOpen: (id: string) => void }) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ source: Vault[]; rows: VaultTableRow[]; errors: string[]; time: number } | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    setResult(null)
    loadConfig().then(async config => {
      const reads = await Promise.allSettled(vaults.map(vault => readLivePosition(config, vault.accountId, vault.owner)))
      if (!active) return
      const rows: VaultTableRow[] = []
      const errors: string[] = []
      reads.forEach((read, index) => {
        const vault = vaults[index]
        if (read.status === 'rejected') { errors.push(`Vault ${vault.number}: position unavailable. ${read.reason instanceof Error ? read.reason.message : 'Please retry.'}`); return }
        if (!read.value.markets.length) errors.push(`Vault ${vault.number}: no configured markets.`)
        read.value.markets.forEach(market => rows.push({
          name: `${market.loanSymbol} / ${market.collateralSymbol}`, loanSymbol: market.loanSymbol, loanId: market.loanToken, vaultAddress: read.value.baseAddress, detail: `${market.collateralSymbol} / ${market.loanSymbol} · ${market.id.slice(0, 10)}… · ${vault.accountId}`,
          asset: market.collateralSymbol, assetId: market.collateralToken.toLowerCase(),
          collateral: `${amount(market.collateral, market.collateralDecimals)} ${market.collateralSymbol}`,
          value: `${amount(market.collateralValue, market.loanDecimals)} ${market.loanSymbol} at oracle`,
          debt: `${amount(market.debt, market.loanDecimals)} ${market.loanSymbol}`,
          health: market.debt===0n ? 'No debt' : market.ltv && market.ltv>0n ? (Number(market.liquidationLtv)/Number(market.ltv)).toFixed(1) : '—', ltv: percent(market.ltv), liquidation: percent(market.liquidationLtv), protection: market.autopilot,
          onOpen: () => onOpen(vault.accountId),
        }))
      })
      setResult({ source: vaults, rows, errors, time: Date.now() })
    }).catch(error => { if (active) setResult({ source: vaults, rows: [], errors: [error instanceof Error ? error.message : 'Position loading failed.'], time: Date.now() }) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [vaults, revision])
  const current = result?.source === vaults ? result : null
  return <div>
    <p className="demo-summary">Read from NEAR and Base Sepolia. Debt and LTV include interest calculated at the read block. Autopilot reflects registration, rules and a recent agent observation, not a guarantee of execution.</p>
    <PrototypeButton disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh positions</PrototypeButton>
    {loading && <p role="status">Reading vault positions…</p>}
    {current?.errors.map(error => <p role="alert" key={error}>{error}</p>)}
    {current && current.rows.length > 0 && <VaultTable vaults={current.rows} />}
    {current && <p className="demo-summary">Last read {new Date(current.time).toLocaleTimeString()} · Refresh to update balances and agent status.</p>}
  </div>
}
