import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import { loadConfig, type Vault } from './near.ts'
import { readLivePosition, type LivePosition, type MarketPosition } from './positions.ts'

type ReadState = { kind: 'loading' } | { kind: 'ready'; position: LivePosition } | { kind: 'error'; message: string }
const amount = (value: bigint, decimals: number, places = 2) => Number(formatUnits(value, decimals)).toLocaleString('en-US', { maximumFractionDigits: places })
const percent = (value: bigint | null) => value === null ? 'Unavailable' : `${(Number(value) / 1e16).toFixed(1)}%`

function MarketRow({ market }: { market: MarketPosition }) {
  const empty = market.collateral === 0n && market.debt === 0n
  return <div className="live-market">
    <div className="live-market__head"><strong>{market.collateralSymbol} / {market.loanSymbol}</strong><span>{empty ? 'No open position' : market.ltv === null ? 'Collateral needed' : market.ltv >= market.liquidationLtv ? 'At liquidation threshold' : market.agentTrigger !== null && market.ltv >= market.agentTrigger ? 'Above agent trigger' : 'Below agent trigger'}</span></div>
    <div className="live-market__values">
      <div><small>Debt</small><strong>{amount(market.debt, market.loanDecimals)} {market.loanSymbol}</strong></div>
      <div><small>Collateral</small><strong>{amount(market.collateral, market.collateralDecimals, 4)} {market.collateralSymbol}</strong></div>
      <div><small>Collateral value</small><strong>{amount(market.collateralValue, market.loanDecimals)} {market.loanSymbol}</strong></div>
      <div><small>LTV</small><strong>{percent(market.ltv)}</strong></div>
    </div>
    <div className="live-market__limits"><span>Agent acts {market.agentTrigger === null ? 'not set' : percent(market.agentTrigger)}</span><span>Morpho liquidation {percent(market.liquidationLtv)}</span></div>
    <small className="live-market__id">Market {market.id}</small>
  </div>
}

export function LiveVaultPosition({ vault }: { vault: Vault }) {
  const [revision, setRevision] = useState(0)
  const [read, setRead] = useState<ReadState>({ kind: 'loading' })

  useEffect(() => {
    let active = true
    setRead({ kind: 'loading' })
    loadConfig().then(config => readLivePosition(config, vault.accountId, vault.owner)).then(position => {
      if (active) setRead({ kind: 'ready', position })
    }).catch(error => {
      if (active) setRead({ kind: 'error', message: error instanceof Error ? error.message : 'Could not read this position.' })
    })
    return () => { active = false }
  }, [vault.accountId, vault.owner, revision])

  return <section className="card loan-connected-vault" aria-labelledby="connected-vault-title">
    <div><span className="eyebrow">Connected wallet · on-chain vault</span><h2 id="connected-vault-title">Vault {vault.number}</h2><p>{vault.accountId}</p></div>
    <div className="loan-connected-vault__details"><span>{vault.marketCount} {vault.marketCount === 1 ? 'market' : 'markets'}</span><a href="#connect">Change vault ↗</a></div>
    <div className="loan-live-content">
      <div className="loan-live-content__head"><div><h3>Current position</h3><p>Read from NEAR and Base Sepolia. Morpho debt uses stored market totals; pending interest is not included.</p></div><button type="button" className="button button--secondary" onClick={() => setRevision(value => value + 1)} disabled={read.kind === 'loading'}>Refresh</button></div>
      {read.kind === 'loading' && <p role="status">Reading your markets…</p>}
      {read.kind === 'error' && <p role="alert">Position unavailable: {read.message}</p>}
      {read.kind === 'ready' && <>
        {read.position.markets.length === 0 ? <p>No markets are configured for this vault.</p> : read.position.markets.map(market => <MarketRow key={market.id} market={market} />)}
        <p className="loan-live-content__stamp">Last read {new Date(read.position.readAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} · Position address {read.position.baseAddress}</p>
      </>}
    </div>
    <p className="loan-connected-vault__note">The two loans below are local examples. They are separate from this vault.</p>
  </section>
}
