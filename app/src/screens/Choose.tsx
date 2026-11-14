import { useState } from 'react'
import { TokenIcon } from '../components/TokenIcon.tsx'
import { ProtectionStage } from '../components/ProtectionStage.tsx'
import { useAdapters } from '../adapters/AdapterProvider.tsx'
import { useMarketQuote, useAppConfig } from '../components/data.ts'
import { checkDeposit, defaultDeposit } from '../flow/amount.ts'
import { formatFractionPercent, formatUnits, formatWadPercent } from '../flow/format.ts'
import { DiscoveryBanner, go, Unavailable, useSessionValue, type ScreenProps } from './common.tsx'

type Tile = { glyph: string; token: string; name: string; detail?: string; enabled?: boolean; status?: 'Production release' | 'Roadmap' | 'Exploring' }
// PRD FR-1 / D10: only ETH → USDC on Morpho Base is selectable; the rest is a catalogue with no dates.
const COLUMNS: { title: string; tiles: Tile[] }[] = [
  { title: 'Collateral', tiles: [
    { glyph: 'Ξ', token: 'eth', name: 'ETH', detail: 'Wrapped to WETH on Base', enabled: true },
    { glyph: '₿', token: 'btc', name: 'BTC', status: 'Production release' }, { glyph: 'N', token: 'near', name: 'NEAR', status: 'Roadmap' }, { glyph: 'Au', token: 'gold', name: 'Gold', status: 'Exploring' }, { glyph: '◇', token: 'aapl', name: 'Tokenized stocks', status: 'Roadmap' },
  ] },
  { title: 'Borrow', tiles: [{ glyph: '$', token: 'usdc', name: 'USDC', detail: 'Circle test USDC on Base Sepolia', enabled: true }] },
  { title: 'Venue', tiles: [
    { glyph: 'M', token: 'venue', name: 'Morpho · Base', detail: 'Live market + approved backup market', enabled: true },
    { glyph: 'R', token: 'venue', name: 'Rhea · NEAR', status: 'Roadmap' }, { glyph: 'Aa', token: 'venue', name: 'Aave · Ethereum', status: 'Roadmap' }, { glyph: 'K', token: 'venue', name: 'Kamino · Solana', status: 'Roadmap' },
  ] },
]

// Status labels match the approved A Light proposal and landing inventory; only the testnet route is enabled.
function Catalogue() {
  const [expanded, setExpanded] = useState(false)
  return <section className="surface catalogue-panel" aria-label="Catalogue">
    <div className="mobile-route">
      <div><TokenIcon asset="ETH" /><strong>ETH</strong><span aria-hidden="true">→</span><TokenIcon asset="USDC" /><strong>USDC</strong></div>
      <p className="muted small">Morpho · Base Sepolia · preset limits</p>
    </div>
    <div id="asset-catalogue" className={`cols-3 catalogue${expanded ? ' catalogue--expanded' : ''}`}>
      {COLUMNS.map(column => <div key={column.title} className="stack-10" role="group" aria-labelledby={`catalogue-${column.title}`}>
        <h3 id={`catalogue-${column.title}`}>{column.title}</h3>
        <ul className="plain-list">
          {column.tiles.map(tile => <li key={tile.name} className={`tile${tile.enabled ? ' selected' : ' disabled'}`} aria-disabled={tile.enabled ? undefined : true}>
            {tile.token === 'eth' || tile.token === 'usdc' ? <TokenIcon asset={tile.token === 'eth' ? 'ETH' : 'USDC'} /> : <span className={`token ${tile.token}`} aria-hidden="true">{tile.glyph}</span>}
            <span className="label"><strong className="tile-name">{tile.name}</strong>{tile.detail && <span>{tile.detail}</span>}</span>
            {tile.enabled ? <span className="selected-mark" aria-label="Selected">✓</span> : <span className={`tag${tile.status === 'Production release' ? ' warn' : ''}`}>{tile.status}</span>}
          </li>)}
        </ul>
        {column.title === 'Borrow' && <p className="muted small borrow-explainer">USDC goes to your wallet.<br />Withdrawals need your signature.</p>}
      </div>)}
    </div>
    <button className="btn ghost catalogue-toggle" type="button" aria-expanded={expanded} aria-controls="asset-catalogue" onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide assets and markets' : 'View assets and markets'}</button>
    <p className="muted small catalogue-note">Only ETH → USDC on Morpho is available today. Production release follows an audit. Exploring is not a commitment.</p>
  </section>
}

export function Choose({ mode, href, banner }: ScreenProps) {
  const { protocol } = useAdapters()
  const app = useAppConfig()
  const quote = useMarketQuote()
  const [text, setText] = useSessionValue(mode, 'amount', defaultDeposit(mode))
  const guided = app.data?.guided
  const check = guided ? checkDeposit(text, guided.minDepositWei) : { kind: 'empty' as const }
  const q = quote.data
  const estimate = q && app.data && check.kind === 'ok' ? protocol.estimateDeposit(app.data, q, check.wei) : null
  const usdc = (value: bigint) => `${formatUnits(value, q!.loanDecimals, 2)} USDC`

  let amountHint: string | null = null
  if (check.kind === 'invalid') amountHint = check.message
  else if (check.kind === 'below-min' && guided) amountHint = `The minimum deposit is ${guided.minDepositText} ETH.`

  return <section className="page" aria-labelledby="screen-title">
    <DiscoveryBanner banner={banner} />
    <div className="page-head">
      <h1 id="screen-title">Borrow against what you hold.</h1>
      <p className="muted">Start with ETH. Borrow USDC. Review the agent’s limits before you sign.</p>
    </div>
    <ProtectionStage />
    <Catalogue />
    {app.isError && <p className="notice notice--warning" role="alert">The app configuration could not be loaded, so no estimate can be shown.</p>}
    <section className="split-11 amount-summary" aria-label="Amount">
      <div className="surface stack-20">
        <label htmlFor="deposit-amount" className="muted">Amount to deposit</label>
        <div className="input">
          <input id="deposit-amount" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="0.0" value={text}
            aria-invalid={amountHint ? true : undefined} aria-describedby="deposit-hint" onChange={event => setText(event.target.value)} />
          <TokenIcon asset="ETH" /><span style={{ fontWeight: 500 }} aria-hidden="true">ETH</span>
        </div>
        <p id="deposit-hint" className="muted small">
          {amountHint ?? <>
            {estimate?.value != null ? `≈ $${formatUnits(estimate.value, q!.loanDecimals, 2)} at the ${mode === 'sandbox' ? 'simulated' : 'live market'} oracle` : check.kind === 'ok' ? <>Value <Unavailable /></> : 'Value shown after you enter an amount'}
            {guided && ` · minimum ${guided.minDepositText} ETH`} · wallet balance shown after connecting
          </>}
        </p>
        <div className="notice notice--good"><strong>Your agent acts inside fixed limits.</strong><p>It can never increase your debt on this venue, apart from up to 0.000002 USDC of rounding when it moves the loan.</p><p>Review the full limits on the next screen.</p></div>
      </div>
      <div className="surface stack-20 loan-summary">
        <h2>Loan summary</h2>
        <p className="big loan-estimate">{estimate?.borrow != null ? `about ${usdc(estimate.borrow)}` : check.kind === 'ok' ? <Unavailable /> : '—'}</p>
        <dl className="rows estimate">
        {estimate?.limited ? <div className="row row--alert" role="status">
          <dt className="k">The market cannot lend the full amount now</dt>
          <dd className="v">{usdc(estimate.borrow!)} available{estimate.resultingLtv !== null ? ` · the position would open at ${formatWadPercent(estimate.resultingLtv)} LTV` : ''}{estimate.maxAmountAtTarget !== null && estimate.maxAmountAtTarget > 0n && guided ? <><br />Deposit up to {formatUnits(estimate.maxAmountAtTarget, 18, 6)} ETH to open at {guided.corridor.target}%</> : null}</dd>
        </div> : <div className="row">
          <dt className="k">You borrow at {guided ? `${guided.corridor.target}%` : '—'} LTV</dt>
          <dd className="v">{guided ? `${guided.corridor.target}% of collateral value` : <Unavailable />}</dd>
        </div>}
        <div className="row">
          <dt className="k">Borrow rate</dt>
          <dd className="v">{q && q.borrowApr !== null ? `${formatFractionPercent(q.borrowApr)} APR` : quote.isPending && app.data ? 'reading…' : <Unavailable>rate unavailable</Unavailable>}</dd>
        </div>
        <div className="row"><dt className="k">Collateral yield</dt><dd className="v">None <span className="muted small">· Morpho collateral is idle</span></dd></div>
        <div className="row"><dt className="k">Agent protection</dt><dd className="v">On <span className="muted small">· fixed limits</span></dd></div>
        </dl>
      </div>
    </section>
    <div className="page-actions">
      <p className="muted small">
        Estimates update every 30 s from the {mode === 'sandbox' ? 'simulated market' : 'market read'}{q ? ` (block ${q.blockNumber.toString()})` : ''}. A value that cannot be read is shown as unavailable.
        {estimate && !estimate.liquidityKnown && ' Market liquidity could not be read, so a shortfall cannot be ruled out.'}
      </p>
      <button type="button" className="btn primary" disabled={check.kind !== 'ok'} onClick={() => go(href('settings'))}>Continue</button>
    </div>
  </section>
}
