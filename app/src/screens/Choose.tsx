import { useAdapters } from '../adapters/AdapterProvider.tsx'
import { useMarketQuote, useAppConfig } from '../components/data.ts'
import { checkDeposit, defaultDeposit } from '../flow/amount.ts'
import { formatFractionPercent, formatUnits, formatWadPercent } from '../flow/format.ts'
import { DiscoveryBanner, go, Unavailable, useSessionValue, type ScreenProps } from './common.tsx'

type Tile = { glyph: string; token: string; name: string; detail?: string; enabled?: boolean }
// PRD FR-1 / D10: only ETH → USDC on Morpho Base is selectable; the rest is a catalogue with no dates.
const COLUMNS: { title: string; tiles: Tile[] }[] = [
  { title: 'Collateral', tiles: [
    { glyph: 'Ξ', token: 'eth', name: 'ETH', detail: 'Wrapped to WETH on Base', enabled: true },
    { glyph: '₿', token: 'btc', name: 'BTC' }, { glyph: 'N', token: 'near', name: 'NEAR' }, { glyph: 'Au', token: 'gold', name: 'Gold' }, { glyph: 'A', token: 'aapl', name: 'AAPL' },
  ] },
  { title: 'Borrow', tiles: [{ glyph: '$', token: 'usdc', name: 'USDC', detail: 'Circle test USDC on Base Sepolia', enabled: true }] },
  { title: 'Venue', tiles: [
    { glyph: 'M', token: 'venue', name: 'Morpho · Base', detail: 'Live market + approved backup market', enabled: true },
    { glyph: 'R', token: 'venue', name: 'Rhea · NEAR' }, { glyph: 'Aa', token: 'venue', name: 'Aave · Ethereum' }, { glyph: 'K', token: 'venue', name: 'Kamino · Solana' },
  ] },
]

// docs/mockups/Main.dc.html: one surface, three columns of tiles (token, label, tag). Tiles stay list items, not
// buttons: nothing here is selectable (FR-1), and disabled tiles are not focusable.
function Catalogue() {
  return <section className="surface cols-3 catalogue" style={{ gap: 24 }} aria-label="Catalogue">
    {COLUMNS.map(column => <div key={column.title} className="stack-10" role="group" aria-labelledby={`catalogue-${column.title}`}>
      <h3 id={`catalogue-${column.title}`} className="muted">{column.title}</h3>
      <ul className="plain-list">
        {column.tiles.map(tile => <li key={tile.name} className={`tile${tile.enabled ? ' selected' : ' disabled'}`} aria-disabled={tile.enabled ? undefined : true}>
          <span className={`token ${tile.token}`} aria-hidden="true">{tile.glyph}</span>
          <span className="label"><strong className="tile-name">{tile.name}</strong><span>{tile.detail ?? 'Not available yet'}</span></span>
          <span className={`tag${tile.enabled ? ' ok' : ''}`}>{tile.enabled ? 'Selected' : 'Coming soon'}</span>
        </li>)}
      </ul>
    </div>)}
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
      <h1 id="screen-title">Borrow USDC against ETH. Keep risk on autopilot.</h1>
      <p className="muted">Choose what you deposit, what you borrow and where. An agent watches the position and reduces risk within fixed limits. It can never increase your debt on this venue.</p>
    </div>
    <Catalogue />
    {app.isError && <p className="notice notice--warning" role="alert">The app configuration could not be loaded, so no estimate can be shown.</p>}
    <section className="surface split-12" aria-label="Amount">
      <div className="stack">
        <label htmlFor="deposit-amount" className="muted">Amount to deposit</label>
        <div className="input">
          <input id="deposit-amount" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="0.0" value={text}
            aria-invalid={amountHint ? true : undefined} aria-describedby="deposit-hint" onChange={event => setText(event.target.value)} />
          <span className="token eth" aria-hidden="true">Ξ</span><span style={{ fontWeight: 500 }} aria-hidden="true">ETH</span>
        </div>
        <p id="deposit-hint" className="muted small">
          {amountHint ?? <>
            {estimate?.value != null ? `≈ $${formatUnits(estimate.value, q!.loanDecimals, 2)} at the live market oracle` : check.kind === 'ok' ? <>Value <Unavailable /></> : 'Value shown after you enter an amount'}
            {guided && ` · minimum ${guided.minDepositText} ETH`} · wallet balance shown after connecting
          </>}
        </p>
      </div>
      <dl className="rows estimate">
        {estimate?.limited ? <div className="row row--alert" role="status">
          <dt className="k">The market cannot lend the full amount now</dt>
          <dd className="v">{usdc(estimate.borrow!)} available{estimate.resultingLtv !== null ? ` · the position would open at ${formatWadPercent(estimate.resultingLtv)} LTV` : ''}{estimate.maxAmountAtTarget !== null && estimate.maxAmountAtTarget > 0n && guided ? <><br />Deposit up to {formatUnits(estimate.maxAmountAtTarget, 18, 6)} ETH to open at {guided.corridor.target}%</> : null}</dd>
        </div> : <div className="row">
          <dt className="k">You borrow at {guided ? `${guided.corridor.target}%` : '—'} LTV</dt>
          <dd className="v">{estimate?.borrow != null ? `about ${usdc(estimate.borrow)}` : check.kind === 'ok' ? <Unavailable /> : '—'}</dd>
        </div>}
        <div className="row">
          <dt className="k">Borrow rate</dt>
          <dd className="v">{q && q.borrowApr !== null ? `${formatFractionPercent(q.borrowApr)} APR` : quote.isPending && app.data ? 'reading…' : <Unavailable>rate unavailable</Unavailable>}</dd>
        </div>
        <div className="row"><dt className="k">Collateral yield</dt><dd className="v">None <span className="muted small">· Morpho collateral is idle</span></dd></div>
        <div className="row"><dt className="k">Agent protection</dt><dd className="v">On <span className="muted small">· fixed limits</span></dd></div>
      </dl>
    </section>
    <div className="page-actions">
      <p className="muted small">
        Estimates update every 30 s from the market read{q ? ` (block ${q.blockNumber.toString()})` : ''}. A value that cannot be read is shown as unavailable.
        {estimate && !estimate.liquidityKnown && ' Market liquidity could not be read, so a shortfall cannot be ruled out.'}
      </p>
      <button type="button" className="btn primary" disabled={check.kind !== 'ok'} onClick={() => go(href('settings'))}>Continue</button>
    </div>
  </section>
}
