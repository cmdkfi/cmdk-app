// Hash routes (PRD §8): five live routes, mirrored under #sandbox/… only in a sandbox build (flow/build.ts); in any
// other build a #sandbox/… hash is an unknown route and goes to #start. Hand-rolled on purpose: five fixed hashes,
// redirects and guards fit in a few lines, and a router library would not remove the guard logic (flow/entry.ts).
// S6 close-in-progress and S7 closed are states of #position, not routes.
import { SANDBOX } from './build.ts'

export const ROUTES = ['start', 'settings', 'connect', 'progress', 'position'] as const
export type Route = (typeof ROUTES)[number]
export type Mode = 'live' | 'sandbox'
export type Place = { mode: Mode; route: Route }

const SANDBOX_ALIASES: Record<string, Route> = { close: 'position', closed: 'position' }

export function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value)
}

export function hashFor(place: Place): string {
  return SANDBOX && place.mode === 'sandbox' ? `#sandbox/${place.route}` : `#${place.route}`
}

/**
 * Parses location.hash. `entry` is true for the bare root ("" or "#"), where the landing
 * table decides the screen. `canonical` differs from the input when it must be replaced.
 */
export function parseHash(hash: string): { place: Place; canonical: string; entry: boolean } {
  const path = hash.replace(/^#/, '').split('?')[0].replace(/\/+$/, '')
  if (path === '') return { place: { mode: 'live', route: 'start' }, canonical: '#start', entry: true }
  if (SANDBOX && (path === 'sandbox' || path.startsWith('sandbox/'))) {
    const name = path.slice('sandbox/'.length)
    const route = isRoute(name) ? name : SANDBOX_ALIASES[name] ?? 'start'
    const place: Place = { mode: 'sandbox', route }
    return { place, canonical: hashFor(place), entry: false }
  }
  const place: Place = { mode: 'live', route: isRoute(path) ? path : 'start' }
  return { place, canonical: hashFor(place), entry: false }
}
