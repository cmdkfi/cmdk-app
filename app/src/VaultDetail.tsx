import { LtvSimulation } from './LtvSimulation.tsx'
import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import { loadConfig, type Vault } from './near.ts'
import { readLivePosition, type LivePosition, type MarketPosition } from './positions.ts'
import { PrototypeButton, PrototypeSurface } from './ui/PrototypeControls.tsx'
import { AssetIcon } from './VaultTable.tsx'
import './vault-detail.css'

const pct = (value: bigint | null) => value === null ? 'Not set' : `${(Number(value) / 1e16).toFixed(1)}%`
const amount = (value: bigint, decimals: number) => Number(formatUnits(value, decimals)).toLocaleString('en-US', { maximumFractionDigits: 6 })

function MarketDetail({ market }: { market: MarketPosition }) {
  const empty = market.collateral === 0n && market.debt === 0n
  const current = market.ltv === null ? null : Number(market.ltv) / 1e16
  const thresholds = [{ name: 'Target', value: market.agentTarget, tone: 'target' }, { name: 'Act', value: market.agentTrigger, tone: 'act' }, { name: 'Liquidation', value: market.liquidationLtv, tone: 'liquidation' }]
  const position = (value: number) => `${Math.max(0, Math.min(100, value))}%`
  const risk = empty ? 'No open position' : current === null ? 'LTV unavailable' : market.ltv! >= market.liquidationLtv ? 'At or above liquidation threshold' : market.agentTrigger !== null && market.ltv! > market.agentTrigger ? 'Above agent act line' : 'Below liquidation threshold'
  return <section className="vault-market-detail" aria-label={`${market.loanSymbol} / ${market.collateralSymbol} market`}>
    <div className="vault-detail-heading"><h2 className="vault-token-pair"><span><AssetIcon symbol={market.loanSymbol} address={market.loanToken}/>{market.loanSymbol}</span><span className="vault-pair-divider">/</span><span><AssetIcon symbol={market.collateralSymbol} address={market.collateralToken}/>{market.collateralSymbol}</span></h2><span className="demo-autopilot">Autopilot · {market.autopilot}</span></div>
    <div className="vault-balance-grid">
      <PrototypeSurface><h3>Collateral</h3><strong>{amount(market.collateral, market.collateralDecimals)} <span>{market.collateralSymbol}</span></strong><p>{amount(market.collateralValue, market.loanDecimals)} {market.loanSymbol} at oracle</p></PrototypeSurface>
      <PrototypeSurface><h3>Debt</h3><strong>{amount(market.debt, market.loanDecimals)} <span>{market.loanSymbol}</span></strong><p>{empty ? 'No outstanding loan' : 'Stored market balance'}</p></PrototypeSurface>
    </div>
    <PrototypeSurface className="vault-ltv-surface">
      <div className="vault-detail-heading"><div><h3>Loan to Value (LTV)</h3><p>Your debt as a percentage of collateral value.</p></div><strong className="vault-current-ltv">{current === null ? '—' : pct(market.ltv)}</strong></div>
      <p className="vault-risk-description">{risk}</p>
      <div className="vault-ltv-track" role="img" aria-label={`Current LTV ${current === null ? 'unavailable' : pct(market.ltv)}. ${thresholds.map(t => `${t.name} ${pct(t.value)}`).join('. ')}`}>
        {current !== null && <span className="vault-ltv-fill" style={{ width: position(current) }} />}
        {thresholds.map(t => t.value !== null && <span key={t.name} className={`vault-ltv-tick ${t.tone}`} style={{ left: position(Number(t.value) / 1e16) }} />)}
        {current !== null && <span className="vault-ltv-current" style={{ left: position(current) }} />}
      </div>
      <div className="vault-scale-ends"><span>0%</span><span>100%</span></div>
      <dl className="vault-ltv-legend">{thresholds.map(t => <div key={t.name}><dt><i className={t.tone}/>{t.name}</dt><dd>{pct(t.value)}</dd></div>)}</dl>
      <p className="vault-ltv-explanation">Target is the protective repayment goal. Above Act, a protective session can start. Liquidation is the market’s liquidation threshold. Agent execution is not guaranteed.</p>
    </PrototypeSurface>
    <LtvSimulation market={market} />
    <details className="vault-market-id"><summary>Market details</summary><p>{market.id}</p><p>Collateral token: {market.collateralToken}</p><p>Loan token: {market.loanToken}</p></details>
  </section>
}

function samplePosition(): LivePosition {
  const second = sessionStorage.getItem('cmdk-demo-position') === '1'
  return { vault: 'Sandbox sample', baseAddress: `0xdE0000000000000000000000000000000000000${second ? 2 : 1}`, readAt: Date.now(), markets: [{
    id: `0x${'0'.repeat(63)}1`, collateral: (second ? 2n : 5n) * 10n ** 18n, debt: (second ? 2240n : 7000n) * 10n ** 6n,
    collateralValue: (second ? 5600n : 14000n) * 10n ** 6n, ltv: (second ? 40n : 50n) * 10n ** 16n,
    liquidationLtv: 86n * 10n ** 16n, agentTarget: second ? null : 50n * 10n ** 16n, agentTrigger: second ? null : 70n * 10n ** 16n,
    oraclePrice: 2800n * 10n ** 24n, autopilot: second ? 'Not configured' : 'Active',
    loanToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', collateralToken: '0x4200000000000000000000000000000000000006',
    loanSymbol: 'USDC', collateralSymbol: 'WETH', loanDecimals: 6, collateralDecimals: 18,
  }] }
}

export function VaultDetail({ vault, demo }: { vault: Vault | null; demo: boolean }) {
  const [revision, setRevision] = useState(0)
  const [read, setRead] = useState<{ key: string; position?: LivePosition; error?: string } | null>(null)
  const key = demo ? 'demo' : vault ? `${vault.accountId}:${vault.owner}` : 'none'
  useEffect(() => {
    let active = true
    setRead(null)
    if (demo) { setRead({ key, position: samplePosition() }); return }
    if (!vault) return
    loadConfig().then(config => readLivePosition(config, vault.accountId, vault.owner))
      .then(position => { if (active) setRead({ key, position }) })
      .catch(error => { if (active) setRead({ key, error: error instanceof Error ? error.message : 'Could not read vault.' }) })
    return () => { active = false }
  }, [key, revision])
  const current = read?.key === key ? read : null
  return <div className="vault-detail">
    <div className="vault-detail-heading"><a href="#connect">← Vaults</a>{!demo && vault && <PrototypeButton disabled={!current} onClick={() => setRevision(value => value + 1)}>Refresh</PrototypeButton>}</div>
    {!demo && !vault ? <p role="status">Select a vault from the Vaults list. If discovery is still loading, return to the list to see its status.</p> : !current ? <p role="status">Reading vault and market rules…</p> : current.error ? <p role="alert">{current.error}</p> : current.position && <>
      <p className="vault-detail-address">{current.position.baseAddress}<small>{current.position.vault} · {demo ? 'Demo data' : 'Base Sepolia'}</small></p>
      {!demo && <p className="demo-summary">Read {new Date(current.position.readAt).toLocaleTimeString()}. Debt and LTV exclude interest pending since the market’s last update. Refresh to update balances and agent status.</p>}
      {current.position.markets.length ? current.position.markets.map(market => <MarketDetail key={market.id} market={market}/>) : <p>No markets configured for this vault.</p>}
    </>}
  </div>
}
