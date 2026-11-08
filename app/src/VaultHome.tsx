import { Activity } from './Activity.tsx'
import { VaultDetail } from './VaultDetail.tsx'
import { useEffect, useRef } from 'react'
import { useAccount } from 'wagmi'
import { WalletConnect } from './WalletConnect.tsx'
import { VaultDiscovery } from './VaultDiscovery.tsx'
import { useVaultSelection } from './VaultSelectionContext.tsx'
import { CreateVaultJob } from './CreateVaultJob.tsx'
import { shortAddress } from './wallet-utils.ts'
import './vault-home.css'
import { PrototypeButton, PrototypeIconButton, PrototypeNavigation, PrototypeSurface } from './ui/PrototypeControls.tsx'

export function VaultHome({ activity = false, detail = false, create = false }: { activity?: boolean; detail?: boolean; create?: boolean }) {
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
      <a className="vault-brand" href="#connect" aria-label="cmdk home"><span aria-hidden="true">⌘K</span></a>
      <PrototypeNavigation activity={activity} />
      <div className="vault-header-actions"><span className="testnet-label">Testnet</span><PrototypeButton primary={!isConnected} onClick={open} aria-haspopup="dialog">{isConnected && address ? shortAddress(address) : 'Connect wallet'}</PrototypeButton></div>
    </header>
    <main className="vault-main">
      <div className="vault-title"><h1>{activity ? 'Activity' : detail ? 'Vault overview' : 'Your vaults'}</h1></div>
      {create ? <CreateVaultJob key={address?.toLowerCase() ?? 'disconnected'} /> : detail && isConnected ? <VaultDetail vault={discovery.selected} /> : !isConnected ? <PrototypeSurface className="vault-welcome">

        <h2>{activity ? 'Your activity starts here' : 'Connect to find your vaults'}</h2>
        <p>{activity ? 'Connect your wallet to view activity for your address.' : 'Find your vaults or create your first one.'}</p>
        <PrototypeButton primary onClick={open}>Connect wallet</PrototypeButton>
        <small>Connecting won’t move funds or request a signature.</small>
      </PrototypeSurface> : activity ? <Activity vaults={discovery.vaults} /> : <VaultDiscovery />}
    </main>
    <footer className="vault-footer">NEAR testnet · Base Sepolia <span>Unaudited. No real money.</span></footer>
    <dialog ref={dialog} className="connect-dialog" aria-label="Wallet connection" onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current?.close() } }}>
      <div className="dialog-close"><PrototypeIconButton aria-label="Close wallet panel" onClick={() => dialog.current?.close()}>×</PrototypeIconButton></div>
      <WalletConnect />
    </dialog>
  </div>
}
