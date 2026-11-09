import { useCallback, useEffect, useRef, useState } from 'react'
import { AdapterProvider, useAdapters, useWalletState } from '../adapters/AdapterProvider.tsx'
import type { WalletState } from '../adapters/types.ts'
import { guard, landing, type EntryInput, type WalletEntry } from '../flow/entry.ts'
import { hashFor, parseHash, type Mode, type Route } from '../flow/routes.ts'
import { Choose, Connect, Position, Progress, Settings } from '../screens/index.tsx'
import { DesktopGate } from './DesktopGate.tsx'
import { WalletSlot } from './WalletSlot.tsx'

const BASE_SEPOLIA = 84532

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

function walletEntry(state: WalletState): WalletEntry {
  if (state.status === 'connected') return state.chainId === BASE_SEPOLIA ? 'connected' : 'wrong-network'
  return state.status
}

function Shell({ mode, route, entry, replace }: { mode: Mode; route: Route; entry: boolean; replace: (hash: string) => void }) {
  const { wallet } = useAdapters()
  const state = useWalletState()
  const href = useCallback((to: Route) => hashFor({ mode, route: to }), [mode])
  // Phase 1 wiring: wallet state only. Vault discovery (D4) and onboarding records arrive in Phases 2–3.
  const input: EntryInput = { wallet: walletEntry(state), discovery: { kind: 'not-checked' }, onboardingRecord: false }
  // The landing table applies once when the shell mounts on "/" or "#start" (PRD S0);
  // afterwards only the route guards run, so Start over can still reach S1.
  const landed = useRef(!(entry || route === 'start'))
  const resolution = mode === 'sandbox' ? { kind: 'route' as const, route } : !landed.current ? landing(input) : guard(route, input)

  useEffect(() => {
    if (resolution.kind !== 'route') return
    landed.current = true
    if (resolution.route !== route || entry) replace(href(resolution.route))
  }, [resolution.kind, resolution.kind === 'route' ? resolution.route : null, route, entry, href, replace])

  const leaveToStart = useCallback(() => { window.location.hash = '#start' }, [])
  const report = useCallback((action: () => Promise<void>) => () => { void action().catch(() => undefined) }, [])

  const screen = resolution.kind === 'wait'
    ? <section className="screen" role="status"><p className="screen__note">Connecting…</p></section>
    : { start: <Choose href={href} />, settings: <Settings href={href} />, connect: <Connect href={href} />, progress: <Progress />, position: <Position /> }[resolution.route]

  return <div className="app-shell">
    <header className="shell-header">
      <a className="shell-brand" href={href('start')} aria-label="cmdk home">⌘K</a>
      <div className="shell-header__actions">
        <WalletSlot
          kind={mode}
          state={state}
          checkingVaults={false}
          onConnect={report(() => wallet.connect())}
          onSwitch={report(() => wallet.switchToBaseSepolia())}
          onDisconnect={report(async () => { await wallet.disconnect(); window.location.hash = '#start' })}
          onLeaveSandbox={leaveToStart}
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
  const [hash, replace] = useHash()
  const { place, canonical, entry } = parseHash(hash)
  useEffect(() => {
    if (!entry && canonical !== hash) replace(canonical)
  }, [entry, canonical, hash, replace])
  return <div className="vault-app">
    <DesktopGate />
    <AdapterProvider kind={place.mode} key={place.mode}>
      <Shell mode={place.mode} route={place.route} entry={entry} replace={replace} />
    </AdapterProvider>
  </div>
}
