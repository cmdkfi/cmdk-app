import type { CSSProperties } from 'react'
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
    return <section className="page" aria-labelledby="screen-title">
      <DiscoveryBanner banner={banner} />
      <div className="page-head"><h1 id="screen-title">Your protection, in one picture</h1></div>
      <p className="muted" role={app.isError ? 'alert' : 'status'}>{app.isError ? 'The fixed settings could not be loaded from the app configuration.' : 'Loading the fixed settings…'}</p>
      <div className="page-actions"><a className="btn ghost" href={href('start')}>Back</a></div>
    </section>
  }
  const c = guided.corridor
  // LLTV (WAD) as a percentage with two decimals, e.g. 0.86e18 → 86.
  const lltv = quote.data ? Number(quote.data.lltv / 10n ** 14n) / 100 : null
  // docs/mockups/S2-Settings: the track ends at the liquidation LTV (floor 30 → 34.9 % of the width at 86 %)
  const scale = (at: number) => `${Math.min(100, (at / (lltv ?? 100)) * 100)}%`
  // the floor's text follows the protocol README's corridor row (Floor, cmdkfi/app 31ecee2): an allowed exit is not sized by it
  const points = [
    { key: 'floor', at: c.floor, label: `Floor ${c.floor}%`, text: 'Sales are sized to stop at this line; a fill better than the oracle price can end a few hundredths of a point under it. An exit, if allowed, repays all debt and is not sized by this line.' },
    { key: 'target', at: c.target, label: `Target ${c.target}%`, text: 'You open here. The agent brings you back here.' },
    { key: 'act', at: c.act, label: `Reduce above ${c.act}%`, text: 'The agent sells collateral to repay part of the debt.' },
    { key: 'liq', at: lltv, label: lltv === null ? 'Liquidation unavailable' : `Liquidation ${lltv}%`, text: "Morpho's rule, not ours. Protection is not a guarantee." },
  ]
  const expiryMinutes = Math.round(guided.messageExpirySecs / 60)

  return <section className="page" aria-labelledby="screen-title">
    <DiscoveryBanner banner={banner} />
    <div className="page-head">
      <h1 id="screen-title">Your protection, in one picture</h1>
      <p className="muted">These limits are preset in the testnet flow. Review what the agent may do before connecting your wallet.</p>
    </div>

    <figure className="surface corridor" style={{ margin: 0 }} aria-label="Loan-to-value corridor">
      <div className="ltv-track" aria-hidden="true" style={{ marginTop: 36, '--target': scale(c.target), '--act': scale(c.act) } as CSSProperties}>
        <div className="ltv-fill" style={{ width: scale(c.target), background: 'var(--line)' }} />
        {points.filter(p => p.at !== null).map(p => <span key={p.key} className={`tick ${p.key}`} style={{ left: scale(p.at!) }} />)}
        <span className="cur" style={{ left: scale(c.target) }} />
      </div>
      <dl className="legend">
        {points.map(p => <div key={p.key}><dt><i className={p.key} />{p.label}</dt><dd className="small muted" style={{ fontSize: 13 }}>{p.text}</dd></div>)}
      </dl>
    </figure>

    <details className="surface rule-details"><summary>How protective selling works</summary>
      <p className="muted">Fixed for this prototype. You borrow at {c.target}% of your collateral's value. If the price falls and the ratio climbs past {c.act}%, the agent sells collateral to bring it back to {c.target}%. Below {c.act}% it may sell at its own discretion, at most {c.budget}% of your collateral per rolling day. A protective sale that started above {c.act}% can continue below it, back toward {c.target}%, for up to 24 hours.</p>
    </details>

    <div className="cols-3" aria-label="What the agent may do">
      <section className="surface stack" aria-labelledby="rules-will">
        <h3 id="rules-will">The agent will</h3>
        <ul className="list">
          <li>Reduce your debt when the ratio passes {c.act}%.</li>
          {c.migrate && <li>Move the position to the approved backup Morpho market if the live one becomes unsafe.</li>}
          {c.exit && <li>Exit, repaying everything from collateral, if nothing else works.</li>}
        </ul>
        <p className="muted small">At most one action per {guided.cooldownSecs} seconds.</p>
      </section>
      <section className="surface stack" aria-labelledby="rules-never">
        <h3 id="rules-never">The agent can never</h3>
        <ul className="list">
          {/* protocol README: a move may add up to two loan-token units (0.000002 USDC) of rounding */}
          <li>Increase your debt on this venue (a move may round it up by up to 0.000002 USDC).</li>
          {/* Executor.sol l.261-266, l.296: a protective session starts above the act line, sells toward target for up to 24 h (also below the act line) and is not budget-limited */}
          <li>Sell at its own discretion more than {c.budget}% of your collateral per rolling day (once the ratio passes {c.act}%, it sells what is needed to return to {c.target}%, for up to 24 hours).</li>
          <li>Send funds anywhere except repaying your loan.</li>
          <li>Change these limits.</li>
        </ul>
        <p className="muted small">Enforced by the vault's key restrictions and the Executor contract, not by the agent's good will.</p>
      </section>
      <section className="surface stack" aria-labelledby="rules-keep">
        <h3 id="rules-keep">You keep</h3>
        <ul className="list">
          <li>Every other action: only your signature moves funds.</li>
          <li>The right to close at any time by repaying.</li>
          <li>A {expiryMinutes}-minute expiry on every message you sign.</li>
          {/* vault/src/lib.rs l.419-424 revoke_agent: one owner signature deletes the key and clears the approval (S5, Phase 12) */}
          <li>The right to revoke the agent in one signature, on your position screen.</li>
        </ul>
        <p className="muted small">Which agent build you approve is checked on the next screens against the values published on GitHub.</p>
      </section>
    </div>

    <div className="notice">
      <label className="acknowledge">
        <input type="checkbox" checked={ack === 'yes'} onChange={event => setAck(event.target.checked ? 'yes' : '')} />
        <span>I understand this is a testnet prototype. Protection is risk management, not insurance against liquidation. No real funds are involved.</span>
      </label>
    </div>
    <div className="page-actions">
      <a className="btn ghost" href={href('start')}>Back</a>
      <button type="button" className="btn primary" disabled={ack !== 'yes'} onClick={() => go(href('connect'))}>Continue to wallet</button>
    </div>
  </section>
}
