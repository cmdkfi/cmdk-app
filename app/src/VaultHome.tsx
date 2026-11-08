import { useEffect, useRef } from 'react'
import { useAccount } from 'wagmi'
import { WalletConnect } from './WalletConnect.tsx'
import { VaultDiscovery } from './VaultDiscovery.tsx'
import { useVaultSelection } from './VaultSelectionContext.tsx'
import { shortAddress } from './wallet-utils.ts'
import './vault-home.css'

export function VaultHome({ activity = false }: { activity?: boolean }) {
  const { address, isConnected } = useAccount()
  const discovery = useVaultSelection()
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
      <nav aria-label="Main navigation"><a href="#connect" aria-current={!activity ? 'page' : undefined}>Vaults</a><a href="#activity" aria-current={activity ? 'page' : undefined}>Activity</a></nav>
      <div className="vault-header-actions"><span className="testnet-label">Testnet</span><button className={isConnected ? 'wallet-trigger connected' : 'wallet-trigger'} onClick={open} aria-haspopup="dialog">{isConnected && address ? shortAddress(address) : 'Connect wallet'}</button></div>
    </header>
    <main className="vault-main">
      <div className="vault-title"><h1>{activity ? 'Activity' : 'Your vaults'}</h1></div>
      {!isConnected ? <section className="vault-welcome">
        <span className="vault-symbol" aria-hidden="true">⌘</span>
        <h2>{activity ? 'Your activity starts here' : 'Connect to find your vaults'}</h2>
        <p>{activity ? 'Connect your wallet to view activity for your address.' : 'Find your vaults or create your first one.'}</p>
        <button className="wallet-trigger" onClick={open}>Connect wallet</button>
        <small>Connecting won’t move funds or request a signature.</small>
      </section> : activity ? <section className="vault-welcome"><h2>Activity is not available yet</h2><p>The activity feed for this address is not connected. Open a vault to inspect its available position data.</p><a className="button button--secondary" href="#connect">View vaults</a></section> : <VaultDiscovery />}
      <a className="explore-demo" href="#scenes">Explore demo <span aria-hidden="true">↗</span></a>
    </main>
    <footer className="vault-footer">NEAR testnet · Base Sepolia <span>Unaudited. No real money.</span></footer>
    <dialog ref={dialog} className="connect-dialog" aria-label="Wallet connection" onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current?.close() } }}>
      <button className="dialog-close" aria-label="Close wallet panel" onClick={() => dialog.current?.close()}>×</button>
      <WalletConnect />
    </dialog>
  </div>
}
