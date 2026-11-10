// The sandbox's Market crash card on S5 (PRD §8a.1, Phase 11): above the Agent and Market cards, one big button runs a
// scripted price path in three stages the user advances, each comparing the same loan without the agent (a
// calculation of what Morpho would have done) with the sandbox position (with the agent). The hero, the LTV track and
// Recent actions show the sandbox position, so they move with each stage. The live adapter has no crash: nothing renders.
import type { ReactNode } from 'react'
import { useCrash, useCrashStep } from '../components/data.ts'
import { CRASH_INTRO, CRASH_SCRIPTED, crashCopy, WITH_HEAD, WITH_NOTE, WITHOUT_HEAD, WITHOUT_NOTE, type Seg } from '../flow/crash.ts'

const text = (parts: Seg[]): ReactNode => parts.map((part, i) => (typeof part === 'string' ? <span key={i}>{part}</span> : <strong key={i}>{part.strong}</strong>))

export function MarketCrash({ vaultId }: { vaultId: string }) {
  const crash = useCrash(vaultId)
  const step = useCrashStep()
  if (crash.isError) return <section className="surface stack crash" aria-labelledby="crash-title"><h3 id="crash-title">Market crash</h3><p className="muted small" role="status">The simulated market could not be read.</p></section>
  const view = crash.data
  if (!view) return null
  const copy = crashCopy(view)
  const advance = () => step.mutate(view.status === 'ready' ? 'run' : 'next')
  return <section className="surface stack crash" aria-labelledby="crash-title">
    <div className="card-head">
      <h3 id="crash-title">Market crash</h3>
      {copy.finished && <span className="tag" role="status">{copy.finished}</span>}
    </div>
    {view.status === 'ready' && <p className="crash-intro">{CRASH_INTRO}</p>}
    {copy.rows.length > 0 && <table className="crash-table">
      <thead>
        <tr>
          <th scope="col">Price</th>
          <th scope="col">{WITHOUT_HEAD}<span>{WITHOUT_NOTE}</span></th>
          <th scope="col">{WITH_HEAD}<span>{WITH_NOTE}</span></th>
        </tr>
      </thead>
      <tbody>
        {copy.rows.map(row => <tr key={row.key} data-stage={row.key}>
          <th scope="row">{row.title}<span>{row.price}</span></th>
          <td data-column="without">{text(row.without)}</td>
          <td data-column="with">{text(row.with)}</td>
        </tr>)}
      </tbody>
    </table>}
    {copy.summary && <p className="crash-summary">{text(copy.summary)}</p>}
    {copy.button && <button type="button" className={`btn primary${view.status === 'ready' ? ' btn--big' : ''}`} disabled={step.isPending} onClick={advance}>{copy.button}</button>}
    {step.isError && <p className="notice notice--warning" role="alert">The simulated market did not move: {step.error instanceof Error ? step.error.message : String(step.error)}</p>}
    <p className="muted small">{CRASH_SCRIPTED}</p>
  </section>
}
