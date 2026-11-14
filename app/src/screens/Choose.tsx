import { useState, type CSSProperties } from 'react'
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
  const target = guided?.corridor.target
  const act = guided?.corridor.act
  const liquidation = q ? Number(q.lltv / 10n ** 14n) / 100 : null
  // The figure is the LTV the position would open at: the target, or lower when the market cannot lend the full amount.
  const startLtv = estimate?.limited && estimate.resultingLtv !== null ? Number(estimate.resultingLtv / 10n ** 14n) / 100 : target
  const sim = mode === 'sandbox'

  return <section className="page flow-page flow-start" aria-labelledby="screen-title">
    <DiscoveryBanner banner={banner} />
    <div className="page-head">
      <span className="flow-overline"><img src="/brand/near.svg" alt="Built on NEAR" /> <span>/</span> TESTNET EXPERIENCE</span>
      <h1 id="screen-title">Borrow against what you hold.</h1>
      <p className="muted">Start with ETH. Borrow USDC. Review the fixed limits your agent must respect, then keep control in your wallet.</p>
    </div>
    {app.isError && <p className="notice notice--warning" role="alert">The app configuration could not be loaded, so no estimate can be shown.</p>}
    <section className="split-11 amount-summary flow-cards" aria-label="Choose loan and position preview">
      <div className="surface flow-main-card">
        <div className="flow-card-heading"><div><span className="flow-eyebrow">01 / CHOOSE LOAN</span><h2>Your first position</h2></div><span className="flow-route">ETH → USDC</span></div>
        <p className="muted flow-card-lead">One live testnet route. Review the amount and market before continuing.</p>
        <div className="flow-asset-pair">
          <div className="flow-asset"><span>COLLATERAL</span><strong><img src="/brand/eth.svg" alt="" /> ETH</strong><small>Wrapped to WETH on Base</small></div>
          <div className="flow-asset"><span>YOU BORROW</span><strong><img src="/brand/usdc.svg" alt="" /> USDC</strong><small>Sent to your wallet</small></div>
        </div>
        <label htmlFor="deposit-amount" className="flow-amount-label">Amount to deposit</label>
        <div className="input">
          <input id="deposit-amount" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="0.0" value={text}
            aria-invalid={amountHint ? true : undefined} aria-describedby="deposit-hint" onChange={event => setText(event.target.value)} />
          <span style={{ fontWeight: 500 }} aria-hidden="true">ETH</span>
        </div>
        <p id="deposit-hint" className="muted small">
          {amountHint ?? <>
            {estimate?.value != null ? `≈ $${formatUnits(estimate.value, q!.loanDecimals, 2)} at the ${mode === 'sandbox' ? 'simulated' : 'live market'} oracle` : check.kind === 'ok' ? <>Value <Unavailable /></> : 'Value shown after you enter an amount'}
            {guided && ` · minimum ${guided.minDepositText} ETH`} · wallet balance shown after connecting
          </>}
        </p>
        <div className="flow-venue"><div><strong>Morpho · Base Sepolia</strong><small>Live market + approved backup market</small></div><span>TESTNET</span></div>
        <div className="notice flow-protection-note"><strong>Your agent acts inside fixed limits.</strong><p>It can never increase your debt on this venue, apart from up to 0.000002 USDC of rounding when it moves the loan.</p><p>Review the full limits on the next screen.</p></div>
        <div className="flow-card-actions"><span className="muted small">{sim ? 'Simulated estimates update' : 'Live estimates update'} every 30 s{q ? ` · block ${q.blockNumber.toString()}` : ''}</span><button type="button" className="btn primary" disabled={check.kind !== 'ok'} onClick={() => go(href('settings'))}>Continue <span aria-hidden="true">→</span></button></div>
      </div>
      <div className="surface flow-preview loan-summary">
        <span className="flow-eyebrow">POSITION PREVIEW</span>
        <h2>A measured response.</h2>
        <p className="muted">The agent can act when price movement raises your loan-to-value. {sim ? 'This preview uses the simulated market.' : 'This preview uses the current testnet market read.'}</p>
        <div className="flow-figure">{startLtv ?? '—'}<small>%</small></div>
        <div className="flow-metric-label">STARTING LOAN-TO-VALUE</div>
        {/* A 0–100 % LTV scale: the colours change at the act line and the liquidation line, and each label sits at its value (the act line above the bar, so it never collides with the liquidation label on a phone) */}
        <div className="flow-risk-meter" role="img" aria-label={`Starting LTV ${startLtv ?? 'unavailable'} percent; target ${target ?? 'unavailable'} percent, agent acts above ${act ?? 'unavailable'} percent, liquidation ${liquidation ?? 'unavailable'} percent`}
          style={{ '--act': `${act ?? 70}%`, '--liq': `${liquidation ?? 86}%` } as CSSProperties}>
          {act != null && <small className="flow-meter-act" style={{ left: `${act}%` }}>Acts {act}%</small>}<span style={{ left: `${startLtv ?? 50}%` }} /></div>
        <div className="flow-meter-labels"><span style={{ left: `${target ?? 50}%` }}>Target {target ?? '—'}%</span><span style={{ left: `${liquidation ?? 86}%` }}>Liquidation at {liquidation ?? '—'}%</span></div>
        <dl className="rows estimate">
        <div className="row"><dt className="k">Estimated borrow</dt><dd className="v loan-estimate">{estimate?.borrow != null ? `about ${usdc(estimate.borrow)}` : check.kind === 'ok' ? <Unavailable /> : '—'}</dd></div>
        {estimate?.limited ? <div className="row row--alert" role="status">
          <dt className="k">The market cannot lend the full amount now</dt>
          <dd className="v">{usdc(estimate.borrow!)} available{estimate.resultingLtv !== null ? ` · the position would open at ${formatWadPercent(estimate.resultingLtv)} LTV` : ''}{estimate.maxAmountAtTarget !== null && estimate.maxAmountAtTarget > 0n && guided ? <><br />Deposit up to {formatUnits(estimate.maxAmountAtTarget, 18, 6)} ETH to open at {guided.corridor.target}%</> : null}</dd>
        </div> : null}
        <div className="row">
          <dt className="k">Borrow rate</dt>
          <dd className="v">{q && q.borrowApr !== null ? `${formatFractionPercent(q.borrowApr)} APR` : quote.isPending && app.data ? 'reading…' : <Unavailable>rate unavailable</Unavailable>}</dd>
        </div>
        <div className="row"><dt className="k">Collateral yield</dt><dd className="v">None <span className="muted small">· Morpho collateral is idle</span></dd></div>
        <div className="row"><dt className="k">Collateral</dt><dd className="v">{check.kind === 'ok' ? `${text} ETH` : '—'}</dd></div>
        <div className="row"><dt className="k">Agent protection</dt><dd className="v">On <span className="muted small">· fixed limits</span></dd></div>
        </dl>
        <div className="notice flow-preview-note">A fast price gap may still liquidate a position. Protection is risk management, not insurance.</div>
      </div>
    </section>
    <ProtectionStage />
    <Catalogue />
    {estimate && !estimate.liquidityKnown && <p className="muted small">Market liquidity could not be read, so a shortfall cannot be ruled out.</p>}
  </section>
}
