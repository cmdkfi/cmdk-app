import { useState } from 'react'
import type { Route, Mode } from '../flow/routes.ts'
import { readSession, writeSession } from '../flow/session.ts'

export type ScreenProps = { mode: Mode; href: (route: Route) => string; banner: { retry: () => void } | null }

/** PRD S0: a failed vault scan is never shown as "no position". */
export function DiscoveryBanner({ banner }: { banner: ScreenProps['banner'] }) {
  if (!banner) return null
  return <div className="notice notice--warning" role="alert">
    <span>Could not read your vaults. Nothing is shown as missing until they can be read.</span>
    <button type="button" className="prototype-button" onClick={banner.retry}>Retry</button>
  </div>
}

/** A value persisted in sessionStorage under the mode's own keys. */
export function useSessionValue(mode: Mode, name: string, initial: string) {
  const [value, setValue] = useState(() => readSession(mode, name) ?? initial)
  const update = (next: string) => { setValue(next); writeSession(mode, name, next) }
  return [value, update] as const
}

export function go(hash: string) { window.location.hash = hash }

export function Unavailable({ children = 'unavailable' }: { children?: string }) {
  return <span className="value-unavailable">{children}</span>
}
