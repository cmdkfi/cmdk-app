// Entry resolver (PRD S0): wallet state + vault discovery + local records decide where "/" lands and
// which routes are allowed. Pure; no I/O.
import type { Route } from './routes.ts'

export type WalletEntry = 'disconnected' | 'connecting' | 'connected' | 'wrong-network'

/**
 * Chain-derived state of the vault chosen by D4 (flow/active-vault.ts). There is deliberately no
 * "closed": a closed position is only known from a close chain run in this session (closeRecord).
 */
export type VaultStatus =
  | 'setup' // setup incomplete → S4 at the setup step
  | 'ready' // empty, setup complete → S4 at the deposit step ("Your vault is ready…")
  | 'deposited' // setup complete, WETH waiting at the position address, no Morpho position → S4 open step
  | 'active' // debt or collateral in Morpho
  | 'active-idle-usdc' // active, and USDC above dust is idle at the position address
  | 'liquidated' // collateral 0 with debt > 0

export type Discovery =
  | { kind: 'not-checked' } // no scan has run for this wallet; nothing is claimed
  | { kind: 'checking' }
  | { kind: 'failed' }
  | { kind: 'found'; status: VaultStatus | null } // null: the scan completed and found no vault

export type EntryInput = {
  wallet: WalletEntry
  discovery: Discovery
  /** A local onboarding record exists for this wallet (Phase 3). */
  onboardingRecord: boolean
  /** A close chain finished in this session for the active vault (Phase 5): the completed close record. */
  closeRecord: boolean
  /** A close chain is in progress for the active vault (an unfinished close record, Phase 5). */
  closing?: boolean
}

export type ProgressStep = 'create' | 'setup' | 'deposit' | 'open' | 'withdraw'
export type PositionVariant = 'active' | 'closed' | 'liquidated'

export type Resolution =
  | { kind: 'wait' }
  | { kind: 'route'; route: Route; banner?: 'discovery-failed'; variant?: PositionVariant; step?: ProgressStep }

type Extra = Omit<Extract<Resolution, { kind: 'route' }>, 'kind' | 'route'>
const WAIT: Resolution = { kind: 'wait' }
const go = (route: Route, extra: Extra = {}): Resolution => ({ kind: 'route', route, ...extra })

/** Where "/" lands once wallet state and discovery are known (PRD S0 table). */
export function landing(input: EntryInput): Resolution {
  if (input.wallet === 'disconnected') return go('start')
  if (input.wallet === 'connecting') return WAIT
  const { discovery } = input
  if (discovery.kind === 'checking') return WAIT
  // Never "no position" and never Create position on a failed scan.
  if (discovery.kind === 'failed') return go('start', { banner: 'discovery-failed' })
  if (discovery.kind === 'not-checked') return go('start')
  // A close in progress stays on the position screen at every step: after `close` the WETH waiting at the position
  // address would otherwise read as "deposited" (S4 open step).
  if (input.closing && discovery.status !== null) return go('position', { variant: 'active' })
  // Chain state first; a local onboarding record never overrides a position the chain shows.
  switch (discovery.status) {
    case 'liquidated': return go('position', { variant: 'liquidated' })
    case 'active': return go('position', { variant: 'active' })
    case 'active-idle-usdc': return input.onboardingRecord ? go('progress', { step: 'withdraw' }) : go('position', { variant: 'active' })
    case 'deposited': return go('progress', { step: 'open' })
    case 'setup': return go('progress', { step: 'setup' })
    case 'ready': return input.closeRecord ? go('position', { variant: 'closed' }) : go('progress', { step: 'deposit' })
    case null:
      return input.onboardingRecord ? go('progress', { step: 'create' }) : go('start')
  }
}

const keepBanner = (target: Resolution): Extra => (target.kind === 'route' && target.banner ? { banner: target.banner } : {})

/**
 * Route guards (PRD S0): #position needs a position (or this session's closed state), #progress needs
 * unfinished onboarding, #start with an active or liquidated position goes to #position.
 */
export function guard(route: Route, input: EntryInput): Resolution {
  const target = landing(input)
  if (target.kind === 'wait') return route === 'position' || route === 'progress' ? WAIT : go(route)
  switch (route) {
    case 'position':
      return target.route === 'position' ? target : go('start', keepBanner(target))
    case 'progress':
      return target.route === 'progress' ? target : go('start', keepBanner(target))
    case 'start':
      return target.route === 'position' && target.variant !== 'closed' ? target : go('start', keepBanner(target))
    default:
      return go(route, keepBanner(target))
  }
}

/** After a connect from S1–S3, the landing table re-runs once discovery resolves (PRD S3 "After connect"). */
export function afterConnect(route: Route, input: EntryInput): Resolution | null {
  const target = landing(input)
  if (target.kind === 'wait') return null
  // Only an existing vault moves the user; with none (or an unknown scan) they stay on S1–S3.
  return target.route === 'progress' || target.route === 'position' ? target : guard(route, input)
}
