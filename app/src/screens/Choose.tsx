import { useAdapters } from '../adapters/AdapterProvider.tsx'
import { useMarketQuote, useAppConfig } from '../components/data.ts'
import { checkDeposit, DEFAULT_DEPOSIT } from '../flow/amount.ts'
import { formatFractionPercent, formatUnits, formatWadPercent } from '../flow/format.ts'
import { DiscoveryBanner, go, Unavailable, useSessionValue, type ScreenProps } from './common.tsx'

type Tile = { glyph: string; name: string; detail?: string; enabled?: boolean }
// PRD FR-1 / D10: only ETH → USDC on Morpho Base is selectable; the rest is a catalogue with no dates.
const COLUMNS: { title: string; tiles: Tile[] }[] = [
  { title: 'Collateral', tiles: [
    { glyph: 'Ξ', name: 'ETH', detail: 'Wrapped to WETH on Base', enabled: true },
    { glyph: '₿', name: 'BTC' }, { glyph: 'N', name: 'NEAR' }, { glyph: 'Au', name: 'Gold' }, { glyph: 'A', name: 'AAPL' },
  ] },
  { title: 'Borrow', tiles: [{ glyph: '$', name: 'USDC', detail: 'Circle test USDC on Base Sepolia', enabled: true }] },
  { title: 'Venue', tiles: [
    { glyph: 'M', name: 'Morpho · Base', detail: 'Live market + approved backup market', enabled: true },
    { glyph: 'R', name: 'Rhea · NEAR' }, { glyph: 'Aa', name: 'Aave · Ethereum' }, { glyph: 'K', name: 'Kamino · Solana' },
  ] },
]

function Catalogue() {
  return <div className="catalogue">
    {COLUMNS.map(column => <section key={column.title} className="catalogue__column" aria-labelledby={`catalogue-${column.title}`}>
      <h3 id={`catalogue-${column.title}`}>{column.title}</h3>
      <ul>
        {column.tiles.map(tile => <li key={tile.name} className={`tile${tile.enabled ? ' is-selected' : ' is-disabled'}`} aria-disabled={tile.enabled ? undefined : true}>
          <span className="tile__glyph" aria-hidden="true">{tile.glyph}</span>
          <span className="tile__text"><strong>{tile.name}</strong><small>{tile.detail ?? 'Not available yet'}</small></span>
          <span className={`tile__tag${tile.enabled ? '' : ' is-soon'}`}>{tile.enabled ? 'Selected' : 'Coming soon'}</span>
        </li>)}
      </ul>
    </section>)}
  </div>
}

export function Choose({ mode, href, banner }: ScreenProps) {
  const { protocol } = useAdapters()
  const app = useAppConfig()
  const quote = useMarketQuote()
  const [text, setText] = useSessionValue(mode, 'amount', DEFAULT_DEPOSIT[mode])
  const guided = app.data?.guided
  const check = guided ? checkDeposit(text, guided.minDepositWei) : { kind: 'empty' as const }
  const q = quote.data
  const estimate = q && app.data && check.kind === 'ok' ? protocol.estimateDeposit(app.data, q, check.wei) : null
  const usdc = (value: bigint) => `${formatUnits(value, q!.loanDecimals, 2)} USDC`

  let amountHint: string | null = null
  if (check.kind === 'invalid') amountHint = check.message
  else if (check.kind === 'below-min' && guided) amountHint = `The minimum deposit is ${guided.minDepositText} ETH.`

  return <section className="screen screen--wide" aria-labelledby="screen-title">
    <DiscoveryBanner banner={banner} />
    <h1 id="screen-title">Borrow USDC against ETH. Keep risk on autopilot.</h1>
    <p className="screen__lead">Choose what you deposit, what you borrow and where. An agent watches the position and reduces risk within fixed limits. It can never increase your debt on this venue.</p>
    <Catalogue />
    {app.isError && <p className="notice notice--warning" role="alert">The app configuration could not be loaded, so no estimate can be shown.</p>}
    <div className="amount-card prototype-surface">
      <label className="amount-field" htmlFor="deposit-amount">
        <span>Amount to deposit</span>
        <span className="amount-field__input">
          <input id="deposit-amount" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="0.0" value={text}
            aria-invalid={amountHint ? true : undefined} aria-describedby="deposit-hint" onChange={event => setText(event.target.value)} />
          <span aria-hidden="true">ETH</span>
        </span>
      </label>
      <p id="deposit-hint" className="amount-card__hint">
        {amountHint ?? <>
          {estimate?.value != null ? `≈ $${formatUnits(estimate.value, q!.loanDecimals, 2)} at the live market oracle` : check.kind === 'ok' ? <>Value <Unavailable /></> : 'Value shown after you enter an amount'}
          {guided && ` · minimum ${guided.minDepositText} ETH`} · wallet balance shown after connecting
        </>}
      </p>
      <dl className="estimate">
        {estimate?.limited ? <div className="estimate__row estimate__row--warning" role="status">
          <dt>The market cannot lend the full amount now</dt>
          <dd>{usdc(estimate.borrow!)} available{estimate.resultingLtv !== null ? ` · the position would open at ${formatWadPercent(estimate.resultingLtv)} LTV` : ''}{estimate.maxAmountAtTarget !== null && estimate.maxAmountAtTarget > 0n && guided ? <><br />Deposit up to {formatUnits(estimate.maxAmountAtTarget, 18, 6)} ETH to open at {guided.corridor.target}%</> : null}</dd>
        </div> : <div className="estimate__row">
          <dt>You borrow at {guided ? `${guided.corridor.target}%` : '—'} LTV</dt>
          <dd>{estimate?.borrow != null ? `about ${usdc(estimate.borrow)}` : check.kind === 'ok' ? <Unavailable /> : '—'}</dd>
        </div>}
        <div className="estimate__row">
          <dt>Borrow rate</dt>
          <dd>{q && q.borrowApr !== null ? `${formatFractionPercent(q.borrowApr)} APR` : quote.isPending && app.data ? 'reading…' : <Unavailable>rate unavailable</Unavailable>}</dd>
        </div>
        <div className="estimate__row"><dt>Collateral yield</dt><dd>None <small>· Morpho collateral is idle</small></dd></div>
        <div className="estimate__row"><dt>Agent protection</dt><dd>On <small>· fixed limits</small></dd></div>
      </dl>
      <p className="amount-card__note">
        Estimates update every 30 s from the market read{q ? ` (block ${q.blockNumber.toString()})` : ''}. A value that cannot be read is shown as unavailable.
        {estimate && !estimate.liquidityKnown && ' Market liquidity could not be read, so a shortfall cannot be ruled out.'}
      </p>
    </div>
    <div className="screen__actions">
      <button type="button" className="prototype-button is-primary" disabled={check.kind !== 'ok'} onClick={() => go(href('settings'))}>Continue</button>
    </div>
  </section>
}
