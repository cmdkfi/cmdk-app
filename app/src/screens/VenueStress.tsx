// The sandbox's Venue stress card on S5 (docs/prd-sandbox-venue-stress.md), under the Market crash card: a replay of
// the recorded 5 Nov 2026 testnet event in three stages the user advances, each comparing the loan if nothing acts with
// the sandbox position (with the agent). Stage 3 moves the sandbox position to the backup market, so the hero, the
// Market card and Recent actions move with it. Hashes and transcript names are text tagged "recorded"; the only link is
// the static one to the evidence file (§4: no explorer link, no live read). The live adapter has no venue: nothing renders.
import type { ReactNode } from 'react'
import { useVenue, useVenueStep } from '../components/data.ts'
import type { Seg } from '../flow/crash.ts'
import { WITH_HEAD, WITH_NOTE, WITHOUT_HEAD } from '../flow/crash.ts'
import { evidenceUrl, RECORDED, VENUE_INTRO, VENUE_REASONS_LABEL, VENUE_REPLAY_AFTER, VENUE_REPLAY_BEFORE, VENUE_TITLE, VENUE_WITHOUT_NOTE, venueCopy } from '../flow/venue.ts'

const text = (parts: Seg[]): ReactNode => parts.map((part, i) => (typeof part === 'string' ? <span key={i}>{part}</span> : <strong key={i}>{part.strong}</strong>))

export function VenueStress({ vaultId }: { vaultId: string }) {
  const venue = useVenue(vaultId)
  const step = useVenueStep()
  if (venue.isError) return <section className="surface stack crash venue" aria-labelledby="venue-title"><h3 id="venue-title">{VENUE_TITLE}</h3><p className="muted small" role="status">The simulated market could not be read.</p></section>
  const view = venue.data
  if (!view) return null
  const copy = venueCopy(view)
  const source = view.scene.source
  const advance = () => step.mutate(view.status === 'ready' ? 'run' : 'next')
  return <section className="surface stack crash venue" aria-labelledby="venue-title">
    <div className="card-head">
      <h3 id="venue-title">{VENUE_TITLE}</h3>
      {copy.finished && <span className="tag" role="status">{copy.finished}</span>}
    </div>
    <p className="muted small venue-replay">{VENUE_REPLAY_BEFORE}<a href={evidenceUrl(view.scene)} target="_blank" rel="noreferrer"><code>{source.repository}</code> <code>{source.path.replace(/\.json$/, '.md')}</code></a>{VENUE_REPLAY_AFTER}</p>
    {view.status === 'ready' && <p className="crash-intro">{VENUE_INTRO}</p>}
    {copy.rows.length > 0 && <ol className="venue-stages">
      {copy.rows.map((row, index) => <li key={row.key} data-stage={row.key}>
        <h4>{row.title}</h4>
        {row.event.map((paragraph, i) => <p key={i} className="venue-event">{text(paragraph)}</p>)}
        {row.reasons && <div className="venue-reasons">
          <p className="small">{VENUE_REASONS_LABEL}</p>
          <ul>{row.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        </div>}
        {row.recorded && <p className="venue-recorded small">{row.recorded.map((r, i) => <span key={r.label}>{i > 0 && ' · '}{r.label} <code>{r.value}</code></span>)} <span className="tag">{RECORDED}</span></p>}
        <dl className="venue-compare">
          <div data-column="without"><dt>{WITHOUT_HEAD}{index === 0 && <span>{VENUE_WITHOUT_NOTE}</span>}</dt><dd className="crash-value">{text(row.without)}</dd></div>
          <div data-column="with"><dt>{WITH_HEAD}{index === 0 && <span>{WITH_NOTE}</span>}</dt><dd className="crash-value">{text(row.with)}</dd></div>
        </dl>
      </li>)}
    </ol>}
    {copy.summary && <p className="crash-summary venue-summary">{text(copy.summary)}</p>}
    {copy.closing && <p className="crash-summary">{copy.closing}</p>}
    {copy.button && <button type="button" className={`btn primary${view.status === 'ready' ? ' btn--big' : ''}`} disabled={step.isPending} onClick={advance}>{copy.button}</button>}
    {step.isError && <p className="notice notice--warning" role="alert">The simulated market did not move: {step.error instanceof Error ? step.error.message : String(step.error)}</p>}
  </section>
}
