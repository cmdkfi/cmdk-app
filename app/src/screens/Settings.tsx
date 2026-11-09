import { useAppConfig, useMarketQuote } from '../components/data.ts'
import { DiscoveryBanner, go, useSessionValue, type ScreenProps } from './common.tsx'

// PRD S2: one picture, read-only. Corridor values come from config.json (FR-2); liquidation is the
// live market's LLTV, shown as unavailable when it cannot be read.
export function Settings({ mode, href, banner }: ScreenProps) {
  const app = useAppConfig()
  const quote = useMarketQuote()
  const [ack, setAck] = useSessionValue(mode, 'ack', '')
  const guided = app.data?.guided
  if (!guided) {
    return <section className="screen" aria-labelledby="screen-title">
      <DiscoveryBanner banner={banner} />
      <h1 id="screen-title">Your protection, in one picture</h1>
      <p className="screen__note" role={app.isError ? 'alert' : 'status'}>{app.isError ? 'The fixed settings could not be loaded from the app configuration.' : 'Loading the fixed settings…'}</p>
      <div className="screen__actions"><a className="prototype-button" href={href('start')}>Back</a></div>
    </section>
  }
  const c = guided.corridor
  // LLTV (WAD) as a percentage with two decimals, e.g. 0.86e18 → 86.
  const lltv = quote.data ? Number(quote.data.lltv / 10n ** 14n) / 100 : null
  const points = [
    { key: 'floor', at: c.floor, label: `Floor ${c.floor}%`, text: 'The agent never reduces below this.' },
    { key: 'target', at: c.target, label: `Target ${c.target}%`, text: 'You open here. The agent brings you back here.' },
    { key: 'act', at: c.act, label: `Reduce above ${c.act}%`, text: 'The agent sells collateral to repay part of the debt.' },
    { key: 'liquidation', at: lltv, label: lltv === null ? 'Liquidation unavailable' : `Liquidation ${lltv}%`, text: "Morpho's rule, not ours. Protection is not a guarantee." },
  ]
  const expiryMinutes = Math.round(guided.messageExpirySecs / 60)

  return <section className="screen screen--wide" aria-labelledby="screen-title">
    <DiscoveryBanner banner={banner} />
    <h1 id="screen-title">Your protection, in one picture</h1>
    <p className="screen__lead">Fixed for this prototype. You borrow at {c.target}% of your collateral's value. If the price falls and the ratio climbs past {c.act}%, the agent sells a little collateral to bring it back to {c.target}%, never more than {c.budget}% of your collateral per day.</p>

    <figure className="corridor prototype-surface" aria-label="Loan-to-value corridor">
      <div className="corridor__track" aria-hidden="true" style={{ background: `linear-gradient(90deg, var(--raised) 0%, #73c7a2 ${c.floor}%, #73c7a2 ${c.target}%, #e4ba69 ${c.act}%, #ee858e ${lltv ?? 100}%, #ee858e 100%)` }}>
        {points.filter(p => p.at !== null).map(p => <span key={p.key} className={`corridor__mark corridor__mark--${p.key}`} style={{ left: `${p.at}%` }} />)}
      </div>
      <dl className="corridor__legend">
        {points.map(p => <div key={p.key} className={`corridor__point corridor__point--${p.key}`}><dt>{p.label}</dt><dd>{p.text}</dd></div>)}
      </dl>
    </figure>

    <div className="rules">
      <section className="rules__list prototype-surface" aria-labelledby="rules-will">
        <h3 id="rules-will">The agent will</h3>
        <ul>
          <li>Reduce your debt when the ratio passes {c.act}%.</li>
          {c.migrate && <li>Move the position to the approved backup Morpho market if the live one becomes unsafe.</li>}
          {c.exit && <li>Exit, repaying everything from collateral, if nothing else works.</li>}
        </ul>
        <p>At most one action per {guided.cooldownSecs} seconds.</p>
      </section>
      <section className="rules__list prototype-surface" aria-labelledby="rules-never">
        <h3 id="rules-never">The agent can never</h3>
        <ul>
          <li>Increase your debt on this venue.</li>
          <li>Sell more than {c.budget}% of your collateral in a day.</li>
          <li>Send funds anywhere except repaying your loan.</li>
          <li>Change these limits.</li>
        </ul>
        <p>Enforced by the vault's key restrictions and the Executor contract, not by the agent's good will.</p>
      </section>
      <section className="rules__list prototype-surface" aria-labelledby="rules-keep">
        <h3 id="rules-keep">You keep</h3>
        <ul>
          <li>Every other action: only your signature moves funds.</li>
          <li>The right to close at any time by repaying.</li>
          <li>A {expiryMinutes}-minute expiry on every message you sign.</li>
        </ul>
        <p>Which agent build you approve is checked on the next screens against the values published on GitHub.</p>
      </section>
    </div>

    <label className="acknowledge">
      <input type="checkbox" checked={ack === 'yes'} onChange={event => setAck(event.target.checked ? 'yes' : '')} />
      <span>I understand this is a testnet prototype. Protection is risk management, not insurance against liquidation. No real funds are involved.</span>
    </label>
    <div className="screen__actions">
      <a className="prototype-button" href={href('start')}>Back</a>
      <button type="button" className="prototype-button is-primary" disabled={ack !== 'yes'} onClick={() => go(href('connect'))}>Continue to wallet</button>
    </div>
  </section>
}
