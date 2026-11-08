import {VaultFunding} from './VaultFunding.tsx'
import {useNow} from './use-now.ts'
import {protectionLabel} from './protection-clock.ts'
import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import { loadConfig, type Vault } from './near.ts'
import { readLivePosition, type LivePosition, type MarketPosition } from './positions.ts'
import { PrototypeButton, PrototypeSurface } from './ui/PrototypeControls.tsx'
import { AssetIcon } from './VaultTable.tsx'
import './vault-detail.css'
import { EditRules } from './EditRules.tsx'
import { VaultSetup } from './VaultSetup.tsx'
import { LiveActions } from './LiveActions.tsx'
import { VerificationDetails } from './VerificationDetails.tsx'

const pct = (value: bigint | null) => value === null ? 'Not set' : `${(Number(value) / 1e16).toFixed(1)}%`
const amount = (value: bigint, decimals: number) => formatUnits(value, decimals)

function MarketDetail({ market, vault, onRefresh }: { market: MarketPosition; vault: Vault; onRefresh: () => void }) {
  const now=useNow()
  const empty = market.collateral === 0n && market.debt === 0n
  const current = market.ltv === null ? null : Number(market.ltv) / 1e16
  const thresholds = [{ name: 'Target', value: market.agentTarget, tone: 'target' }, { name: 'Act', value: market.agentTrigger, tone: 'act' }, { name: 'Liquidation', value: market.liquidationLtv, tone: 'liquidation' }]
  const position = (value: number) => `${Math.max(0, Math.min(100, value))}%`
  const risk = market.priceUnavailable ? 'Oracle unavailable · risk cannot be priced' : market.collateralValue === 0n && market.debt > 0n ? 'Critical · debt without collateral value' : empty ? 'No open position' : current === null ? 'LTV unavailable' : market.ltv! >= market.liquidationLtv ? 'At or above liquidation threshold' : market.agentTrigger !== null && market.ltv! > market.agentTrigger ? 'Above agent act line' : 'Below liquidation threshold'
  return <section className="vault-market-detail" aria-label={`${market.loanSymbol} / ${market.collateralSymbol} market`}>
    <div className="vault-detail-heading"><h2 className="vault-token-pair"><span><AssetIcon symbol={market.loanSymbol} address={market.loanToken}/>{market.loanSymbol}</span><span className="vault-pair-divider">/</span><span><AssetIcon symbol={market.collateralSymbol} address={market.collateralToken}/>{market.collateralSymbol}</span></h2><span className="vault-market-role">{market.label ?? `${market.id.slice(0,10)}…`}</span><span className="demo-autopilot">Autopilot · {protectionLabel(market.autopilot,market.protectionValidUntil,market.registrationExpires,now)}</span></div>
    {market.policyUnavailable && <p role="alert">Executor policy telemetry unavailable. Position balances are still shown; borrowing and setup repair require a successful policy read.</p>}
    <div className="cockpit-columns"><div className="cockpit-monitor"><div className="vault-balance-grid">
      <PrototypeSurface><h3>Collateral</h3><strong>{amount(market.collateral, market.collateralDecimals)} <span>{market.collateralSymbol}</span></strong><p>{market.priceUnavailable ? 'Oracle unavailable' : `${amount(market.collateralValue, market.loanDecimals)} ${market.loanSymbol} at oracle`}</p></PrototypeSurface>
      <PrototypeSurface><h3>Debt</h3><strong>{amount(market.debt, market.loanDecimals)} <span>{market.loanSymbol}</span></strong><p>{empty ? 'No outstanding loan' : 'Includes interest at the read block'}</p></PrototypeSurface>
    </div>
    <PrototypeSurface className="vault-ltv-surface">
      <div className="vault-detail-heading"><div><h3>Loan to Value (LTV)</h3><p>Your debt as a percentage of collateral value.</p></div><strong className="vault-current-ltv">{current === null ? '—' : pct(market.ltv)}</strong></div>
      <p className="vault-risk-description">{risk}</p>
      <p>Liquidation buffer: {market.ltv === null ? '—' : `${((Number(market.liquidationLtv)-Number(market.ltv))/1e16).toFixed(1)} percentage points`}</p>
      <p>Daily sell budget: {pct(market.dailyBudget ?? null)} · Floor {pct(market.floor ?? null)}</p>
      <div className="vault-ltv-track" role="img" aria-label={`Current LTV ${current === null ? 'unavailable' : pct(market.ltv)}. ${thresholds.map(t => `${t.name} ${pct(t.value)}`).join('. ')}`}>
        {current !== null && <span className="vault-ltv-fill" style={{ width: position(current) }} />}
        {thresholds.map(t => t.value !== null && <span key={t.name} className={`vault-ltv-tick ${t.tone}`} style={{ left: position(Number(t.value) / 1e16) }} />)}
        {current !== null && <span className="vault-ltv-current" style={{ left: position(current) }} />}
      </div>
      <div className="vault-scale-ends"><span>0%</span><span>100%</span></div>
      <dl className="vault-ltv-legend">{thresholds.map(t => <div key={t.name}><dt><i className={t.tone}/>{t.name}</dt><dd>{pct(t.value)}</dd></div>)}</dl>
      <details className="vault-agent-limits"><summary>Agent limits and session</summary>
      <p>Migration {market.migrateAllowed === undefined ? 'unavailable' : market.migrateAllowed ? 'allowed' : 'disabled'} · Exit {market.exitAllowed === undefined ? 'unavailable' : market.exitAllowed ? 'allowed' : 'disabled'}</p>
      {market.telemetry ? <><p>Discretionary sales in rolling 24h: {formatUnits(market.telemetry.sold,market.collateralDecimals)} {market.collateralSymbol} · Moves {market.telemetry.moves.toString()}</p><p>Remaining discretionary sales: {market.telemetry.budget ? `${formatUnits(market.telemetry.budget.remaining,market.collateralDecimals)} ${market.collateralSymbol} · shared across this Executor’s active markets · ${(Number(market.telemetry.budget.fraction)/1e16).toFixed(1)}% minimum budget` : 'Unavailable'}</p><p>Effective cooldown remaining at read: {market.telemetry.cooldownRemaining.toString()}s · Agent-closed {market.telemetry.closed ? 'yes' : 'no'}</p><p>Protective session: {market.telemetry.sessionStart === 0n ? 'None' : new Date(Number(market.telemetry.sessionStart)*1000).toLocaleString()} · Base cooldown {market.telemetry.cooldown.toString()}s</p><p>Protective reductions are not limited by the discretionary sell budget. These counters are a read-block snapshot; execution rechecks limits.</p></> : <p>Agent execution counters unavailable.</p>}
      </details>
      <p className="vault-ltv-explanation">Target is the protective repayment goal. Above Act, a protective session can start. Liquidation is the market’s liquidation threshold. Agent execution is not guaranteed.</p>
    </PrototypeSurface>
    {!market.readOnly && <EditRules vault={vault} market={market} onRefresh={onRefresh} />}
    <VerificationDetails vault={vault} market={market} />
    </div><aside className="cockpit-actions"><LiveActions key={`${vault.accountId}:${vault.owner}:${market.id}`} market={market} vault={vault} onRefresh={onRefresh} />{!market.readOnly&&<VaultFunding key={`funding:${vault.accountId}:${vault.owner}:${market.id}`} market={market} vault={vault} onRefresh={onRefresh}/>}</aside></div>
    <details className="vault-market-id"><summary>Market details</summary><p>{market.id}</p><p>Collateral token: {market.collateralToken}</p><p>Loan token: {market.loanToken}</p></details>
  </section>
}

export function VaultDetail({ vault }: { vault: Vault | null }) {
  const [revision, setRevision] = useState(0)
  const [read, setRead] = useState<{ key: string; position?: LivePosition; error?: string } | null>(null)
  const key = vault ? `${vault.accountId}:${vault.owner}` : 'none'
  useEffect(() => {
    let active = true
    if (!vault) return
    loadConfig().then(config => readLivePosition(config, vault.accountId, vault.owner))
      .then(position => { if (active) setRead({ key, position }) })
      .catch(error => { if (active) setRead({ key, error: error instanceof Error ? error.message : 'Could not read vault.' }) })
    return () => { active = false }
  }, [key, revision])
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setRevision(value => value + 1) }, 30000)
    return () => window.clearInterval(timer)
  }, [key])
  const current = read?.key === key ? read : null
  return <div className="vault-detail">
    <div className="vault-detail-heading"><a href="#connect">← Vaults</a>{vault && <PrototypeButton disabled={!current} onClick={() => setRevision(value => value + 1)}>Refresh</PrototypeButton>}</div>
    {!vault ? <p role="status">Select a vault from the Vaults list. If discovery is still loading, return to the list to see its status.</p> : !current ? <p role="status">Reading vault and market rules…</p> : current.error ? <p role="alert">{current.error}</p> : current.position && <>
      <p className="vault-detail-address">{current.position.baseAddress}<small>{current.position.vault} · Base Sepolia</small></p>
      {<p className="demo-summary">Read {new Date(current.position.readAt).toLocaleTimeString()}. Debt and LTV include accrued interest at the read block. Updates every 30 seconds while visible. Refresh for a new snapshot.</p>}
      <PrototypeSurface><h3>Free vault balances</h3>{current.position.freeBalances?.map(token => <p key={token.token}>{formatUnits(token.balance,token.decimals)} {token.symbol} · available to withdraw</p>)}<p>Gas reserve: {current.position.gasBalance === undefined ? 'Unavailable' : `${formatUnits(current.position.gasBalance,18)} test ETH`}</p><p>Free tokens are separate from collateral locked in Morpho.</p></PrototypeSurface>
      {vault && <details><summary>Inspect / repair vault setup</summary><VaultSetup key={`${vault.accountId}:${vault.owner}`} vault={vault} onComplete={() => setRevision(value => value + 1)} /></details>}
      {current.position.errors?.map(error => <p role="alert" key={error}>{error}</p>)}
      {current.position.markets.length ? current.position.markets.map(market => <MarketDetail key={market.id} market={market} vault={vault!} onRefresh={() => setRevision(value => value + 1)}/>) : <p>{current.position.errors?.length ? 'Market reads are incomplete. Retry to load missing positions.' : 'No markets configured for this vault.'}</p>}
    </>}
  </div>
}
