import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AdapterProvider, useAdapters, useWalletState } from '../adapters/AdapterProvider.tsx'
import type { WalletState } from '../adapters/types.ts'
import { afterConnect, guard, landing, type EntryInput, type Resolution, type WalletEntry } from '../flow/entry.ts'
import { hashFor, parseHash, type Mode, type Route } from '../flow/routes.ts'
import { Choose } from '../screens/Choose.tsx'
import { Connect } from '../screens/Connect.tsx'
import { Position } from '../screens/Position.tsx'
import { Progress } from '../screens/Progress.tsx'
import { loadCloseRecord, loadRecord } from '../flow/onboarding-record.ts'
import { Settings } from '../screens/Settings.tsx'
import { useAppConfig, useDeploymentStatic, useDiscovery } from './data.ts'
import { DesktopGate } from './DesktopGate.tsx'
import { WalletSlot } from './WalletSlot.tsx'

const BASE_SEPOLIA = 84532
const DESKTOP = '(min-width: 960px)'
const BEFORE_WALLET: Route[] = ['start', 'settings', 'connect']

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const changed = () => setHash(window.location.hash)
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  // Redirects replace the history entry so browser Back skips them.
  const replace = useCallback((next: string) => {
    window.history.replaceState(window.history.state, '', next)
    setHash(next)
  }, [])
  return [hash, replace] as const
}

/** FR-16 / D9: below 960 px the shell (adapters, silent reconnect, reads) is not mounted at all. */
function useDesktop() {
  return useSyncExternalStore(
    listener => { const query = window.matchMedia(DESKTOP); query.addEventListener('change', listener); return () => query.removeEventListener('change', listener) },
    () => window.matchMedia(DESKTOP).matches,
  )
}

function walletEntry(state: WalletState): WalletEntry {
  if (state.status === 'connected') return state.chainId === BASE_SEPOLIA ? 'connected' : 'wrong-network'
  return state.status
}

type Pending = 'entry' | 'connect' | null

function Shell({ mode, route, entry, replace }: { mode: Mode; route: Route; entry: boolean; replace: (hash: string) => void }) {
  const { wallet } = useAdapters()
  const state = useWalletState()
  const app = useAppConfig()
  const owner = state.status === 'connected' ? state.address : undefined
  const discovery = useDiscovery(owner)
  // Static deployment data (once per session, PRD §9 2) loads with the shell, alongside discovery.
  useDeploymentStatic(mode === 'live')
  const href = useCallback((to: Route) => hashFor({ mode, route: to }), [mode])
  // Onboarding and close records are local (flow/onboarding-record.ts); the close record is per vault.
  const factory = app.data?.config.near.factory
  const onboardingRecord = mode === 'live' && !!owner && !!factory && loadRecord(mode, factory, owner) !== null
  const vaultId = discovery.result?.summary?.vault.accountId
  const close = mode === 'live' && owner && factory && vaultId ? loadCloseRecord(mode, factory, owner, vaultId) : null
  const input: EntryInput = { wallet: walletEntry(state), discovery: discovery.entry, onboardingRecord, closeRecord: !!close?.completed, closing: !!close && !close.completed }

  // The landing table runs once on "/" or "#start", and again when discovery resolves after a connect
  // from S1–S3 (PRD S0, S3). Otherwise only the route guards run, so Start over can reach S1.
  const [pending, setPending] = useState<Pending>(entry || route === 'start' ? 'entry' : null)
  const previous = useRef(state.status)
  useEffect(() => {
    if (previous.current !== 'connected' && state.status === 'connected' && BEFORE_WALLET.includes(route)) setPending(current => current ?? 'connect')
    previous.current = state.status
  }, [state.status, route])

  let resolution: Resolution
  if (mode === 'sandbox') resolution = { kind: 'route', route }
  else if (pending === 'entry') resolution = landing(input)
  else if (pending === 'connect') resolution = afterConnect(route, input) ?? guard(route, input)
  else resolution = guard(route, input)

  const target = resolution.kind === 'route' ? resolution.route : null
  const settled = pending === 'entry' ? resolution.kind === 'route' : pending === 'connect' ? afterConnect(route, input) !== null : false
  useEffect(() => {
    if (settled) setPending(null)
    if (target && (target !== route || entry)) replace(href(target))
  }, [settled, target, route, entry, href, replace])

  const run = useCallback((action: () => Promise<void>) => () => { void action().catch(() => undefined) }, [])
  const explorer = app.data?.guided.network.blockExplorerUrls[0]
  const banner = resolution.kind === 'route' && resolution.banner === 'discovery-failed' ? { retry: discovery.retry } : null

  let screen
  if (resolution.kind === 'wait') screen = <section className="screen" role="status"><p className="screen__note">{state.status === 'connecting' ? 'Connecting…' : 'Checking your vaults…'}</p></section>
  else switch (resolution.route) {
    case 'start': screen = <Choose mode={mode} href={href} banner={banner} />; break
    case 'settings': screen = <Settings mode={mode} href={href} banner={banner} />; break
    case 'connect': screen = <Connect mode={mode} href={href} banner={banner} discovery={discovery} />; break
    case 'progress': screen = <Progress mode={mode} href={href} discovery={discovery} resume={resolution.step} />; break
    case 'position': screen = <Position mode={mode} href={href} variant={resolution.variant} discovery={discovery} />; break
  }

  return <div className="app-shell">
    <header className="shell-header">
      <a className="shell-brand" href={href('start')} aria-label="cmdk home">⌘K</a>
      <div className="shell-header__actions">
        <WalletSlot
          kind={mode}
          state={state}
          checkingVaults={state.status === 'connected' && discovery.entry.kind === 'checking'}
          explorer={explorer}
          onConnect={run(() => wallet.connect())}
          onSwitch={run(async () => { if (app.data) await wallet.switchToBaseSepolia(app.data.guided.network) })}
          onDisconnect={run(async () => { await wallet.disconnect(); window.location.hash = '#start' })}
          onLeaveSandbox={() => { window.location.hash = '#start' }}
        />
        <span className="shell-chip">{mode === 'live' && state.status === 'disconnected' ? 'Testnet · Base Sepolia · no real funds' : 'Testnet · no real funds'}</span>
      </div>
    </header>
    <main className="shell-main">{screen}</main>
    <footer className="shell-footer">
      <span>Unaudited testnet prototype. Agent protection is risk management, not insurance.</span>
      <a href="https://github.com/cmdkfi/app" target="_blank" rel="noreferrer">Protocol source</a>
    </footer>
  </div>
}

export function App() {
  const desktop = useDesktop()
  const [hash, replace] = useHash()
  const { place, canonical, entry } = parseHash(hash)
  useEffect(() => {
    if (desktop && !entry && canonical !== hash) replace(canonical)
  }, [desktop, entry, canonical, hash, replace])
  if (!desktop) return <div className="vault-app"><DesktopGate /></div>
  return <div className="vault-app">
    <AdapterProvider kind={place.mode} key={place.mode}>
      <Shell mode={place.mode} route={place.route} entry={entry} replace={replace} />
    </AdapterProvider>
  </div>
}
