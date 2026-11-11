import type { Route } from '../flow/routes.ts'

const steps = ['Choose loan', 'Review limits', 'Connect & sign']

/** Orientation only: navigation still passes through the existing route guards. */
export function SetupProgress({ route }: { route: Route }) {
  const current = ['start', 'settings', 'connect'].indexOf(route)
  if (current < 0) return null
  return <ol className="setup-progress" aria-label="Setup steps">
    {steps.map((label, index) => <li key={label} className={index === current ? 'current' : index < current ? 'complete' : ''} aria-current={index === current ? 'step' : undefined}>
      <span className="setup-number" aria-hidden="true">{index < current ? '✓' : index + 1}</span><span>{label}</span>
    </li>)}
  </ol>
}
