// Entry resolver (PRD S0): wallet state + vault discovery + local onboarding record
// decide where "/" lands and which routes are allowed. Pure; no I/O.
import type { Route } from './routes.ts'

export type WalletEntry = 'disconnected' | 'connecting' | 'connected' | 'wrong-network'

/** State of the vault chosen by the D4 rule, derived from chain reads (Phase 2+). */
export type VaultStatus = 'onboarding' | 'active' | 'closed' | 'liquidated'

export type Discovery =
  | { kind: 'not-checked' } // no scan has run for this wallet yet; nothing is claimed
  | { kind: 'checking' }
  | { kind: 'failed' }
  | { kind: 'found'; status: VaultStatus | null } // null: the scan completed and found no vault

export type EntryInput = { wallet: WalletEntry; discovery: Discovery; onboardingRecord: boolean }

export type PositionVariant = 'active' | 'closed' | 'liquidated'

export type Resolution =
  | { kind: 'wait' }
  | { kind: 'route'; route: Route; banner?: 'discovery-failed'; variant?: PositionVariant }

const WAIT: Resolution = { kind: 'wait' }
const go = (route: Route, extra: Omit<Extract<Resolution, { kind: 'route' }>, 'kind' | 'route'> = {}): Resolution => ({ kind: 'route', route, ...extra })

/** Where "/" lands once wallet state and discovery are known (PRD S0 table). */
export function landing(input: EntryInput): Resolution {
  if (input.wallet === 'disconnected') return go('start')
  if (input.wallet === 'connecting') return WAIT
  const { discovery } = input
  if (discovery.kind === 'checking') return WAIT
  // Never "no position" and never Create position on a failed scan.
  if (discovery.kind === 'failed') return go('start', { banner: 'discovery-failed' })
  if (discovery.kind === 'not-checked') return go('start')
  const status = discovery.status
  if (status === 'liquidated') return go('position', { variant: 'liquidated' })
  if (status === 'onboarding' || input.onboardingRecord) return go('progress')
  if (status === 'active') return go('position', { variant: 'active' })
  if (status === 'closed') return go('position', { variant: 'closed' })
  return go('start')
}

/**
 * Route guards (PRD S0): #position needs a position, #progress needs an onboarding record
 * or a half-set-up vault, #start with an active (or liquidated) position goes to #position.
 * A closed position does not redirect #start, so Start over can reach S1.
 */
export function guard(route: Route, input: EntryInput): Resolution {
  const target = landing(input)
  if (target.kind === 'wait') return route === 'position' || route === 'progress' ? WAIT : go(route)
  switch (route) {
    case 'position':
      return target.route === 'position' ? target : go('start', target.banner ? { banner: target.banner } : {})
    case 'progress':
      return target.route === 'progress' || input.onboardingRecord ? go('progress') : go('start', target.banner ? { banner: target.banner } : {})
    case 'start':
      return target.route === 'position' && target.variant !== 'closed' ? target : go('start', target.banner ? { banner: target.banner } : {})
    default:
      return go(route)
  }
}
