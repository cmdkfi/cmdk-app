import type { ReactNode } from 'react'

// Phase 1 skeleton only: a titled section with no figures and no protocol data.
export function Placeholder({ label, title, phase, children }: { label: string; title: string; phase: string; children?: ReactNode }) {
  return <section className="screen" aria-labelledby="screen-title">
    <span className="screen__label">{label}</span>
    <h1 id="screen-title">{title}</h1>
    <p className="screen__note">This screen is built in {phase}.</p>
    {children && <div className="screen__actions">{children}</div>}
  </section>
}
