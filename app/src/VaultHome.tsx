import { useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { WalletConnect } from './WalletConnect.tsx'
import { VaultDiscovery } from './VaultDiscovery.tsx'
import { useVaultSelection } from './VaultSelectionContext.tsx'
import { DemoVaults, DemoActivity } from './WalletDemo.tsx'
import { shortAddress } from './wallet-utils.ts'
import './vault-home.css'
import { PrototypeButton, PrototypeIconButton, PrototypeNavigation, PrototypeSurface } from './ui/PrototypeControls.tsx'

export function VaultHome({ activity = false }: { activity?: boolean }) {
  const { address, isConnected } = useAccount()
  const discovery = useVaultSelection()
  const [demo, setDemo] = useState(() => new URLSearchParams(window.location.search).get('demo') === 'wallet')
  function toggleDemo(enabled: boolean) {
    const url = new URL(window.location.href)
    if (enabled) url.searchParams.set('demo', 'wallet')
    else url.searchParams.delete('demo')
    window.history.replaceState(null, '', url)
    setDemo(enabled)
  }
  const wasConnected = useRef(isConnected)
  const closeAfterConnection = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (isConnected && !wasConnected.current) closeAfterConnection.current = true
    wasConnected.current = isConnected
    if (!isConnected) closeAfterConnection.current = false
    if (closeAfterConnection.current && (discovery.kind === 'ready' || discovery.kind === 'pending')) {
      dialog.current?.close()
      closeAfterConnection.current = false
    }
  }, [isConnected, discovery.kind])
  function open() {
    dialog.current?.showModal()
  }
  return <div className="vault-app">
    <header className="vault-header">
      <a className="vault-brand" href="#connect" aria-label="cmdk home">cmdk</a>
      <PrototypeNavigation activity={activity} />
      <div className="vault-header-actions"><span className="testnet-label">{demo ? 'Demo' : 'Testnet'}</span>{demo ? <span className="demo-address" title="Simulated wallet address">0xdE00…0001</span> : <PrototypeButton primary={!isConnected} onClick={open} aria-haspopup="dialog">{isConnected && address ? shortAddress(address) : 'Connect wallet'}</PrototypeButton>}</div>
    </header>
    <main className="vault-main">
      <div className="vault-title"><h1>{activity ? 'Activity' : 'Your vaults'}</h1></div>
      {demo && <div className="demo-notice"><div><strong>Demo workspace</strong><p>Sample address and data. No wallet connected; no transactions sent.</p></div><PrototypeButton onClick={() => toggleDemo(false)}>Exit demo</PrototypeButton></div>}
      {demo ? (activity ? <DemoActivity /> : <DemoVaults />) : !isConnected ? <PrototypeSurface className="vault-welcome">

        <h2>{activity ? 'Your activity starts here' : 'Connect to find your vaults'}</h2>
        <p>{activity ? 'Connect your wallet to view activity for your address.' : 'Find your vaults or create your first one.'}</p>
        <PrototypeButton primary onClick={open}>Connect wallet</PrototypeButton>
        <small>Connecting won’t move funds or request a signature.</small>
      </PrototypeSurface> : activity ? <PrototypeSurface className="vault-welcome"><h2>Activity is not available yet</h2><p>The activity feed for this address is not connected. Open a vault to inspect its available position data.</p><a className="button button--secondary" href="#connect">View vaults</a></PrototypeSurface> : <VaultDiscovery />}
      {!demo && <PrototypeButton className="explore-demo" onClick={() => toggleDemo(true)}>Explore demo <span aria-hidden="true">↗</span></PrototypeButton>}
    </main>
    <footer className="vault-footer">NEAR testnet · Base Sepolia <span>Unaudited. No real money.</span></footer>
    <dialog ref={dialog} className="connect-dialog" aria-label="Wallet connection" onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current?.close() } }}>
      <div className="dialog-close"><PrototypeIconButton aria-label="Close wallet panel" onClick={() => dialog.current?.close()}>×</PrototypeIconButton></div>
      <WalletConnect />
    </dialog>
  </div>
}
