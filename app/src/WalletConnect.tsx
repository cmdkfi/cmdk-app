import { useEffect, useState } from 'react'
import { useAccount, useConnect, useConnectors, useDisconnect, usePublicClient, useSwitchChain } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { walletOptions } from './wallet-options.ts'
import { PrototypeButton } from './ui/PrototypeControls.tsx'
import { accountKind, connectionError, shortAddress } from './wallet-utils.ts'


export function WalletConnect() {
  const { address, chain, chainId, connector, isConnected } = useAccount()
  const connectors = useConnectors()
  const { connect, isPending, error, reset } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain()
  const [detecting, setDetecting] = useState(true)
  const [pendingName, setPendingName] = useState('')
  const client = usePublicClient({ chainId: baseSepolia.id })
  const [kind, setKind] = useState<'checking' | 'plain' | 'delegated' | 'contract' | 'unavailable'>('checking')
  const [revision, setRevision] = useState(0)
  const [availableInjected, setAvailableInjected] = useState<Set<string>>(new Set())

  useEffect(() => {
    let active = true
    setDetecting(true)
    Promise.all(connectors.filter(item => item.type === 'injected').map(async item => ({ uid: item.uid, provider: await item.getProvider().catch(() => undefined) }))).then(results => {
      if (active) { setAvailableInjected(new Set(results.filter(item => item.provider).map(item => item.uid))); setDetecting(false) }
    })
    return () => { active = false }
  }, [connectors, revision])

  useEffect(() => {
    if (!address || !client) return
    let active = true
    setKind('checking')
    client.getCode({ address }).then(code => {
      if (active) setKind(accountKind(code))
    }).catch(() => {
      if (active) setKind('unavailable')
    })
    return () => { active = false }
  }, [address, client, revision])

  const options = walletOptions(connectors, availableInjected)
  const installed = options.filter(item => item.type === 'injected')

  return <section className="card wallet-card" aria-labelledby="wallet-heading">
    <div className="card__header"><div><h2 id="wallet-heading">Connect a wallet</h2><p>Find your vaults. Connecting won’t move funds or request a signature.</p></div></div>
    {!isConnected ? <>
      <div className="wallet-options">
        {options.map(item => <button className="wallet-option" key={item.uid} disabled={isPending} onClick={() => { reset(); setPendingName(item.name); connect({ connector: item }) }}><span>{item.name}</span><small>{item.type === 'injected' ? 'Detected' : 'Connect →'}</small></button>)}
      </div>
      {isPending && <p className="wallet-message" role="status">Open {pendingName || 'your wallet'} to approve the connection…</p>}
      {error && <p className="inline-error" role="alert">{connectionError(error)}</p>}
      {detecting && <p className="wallet-message" role="status">Looking for installed wallets…</p>}
      {!detecting && installed.length === 0 && <div className="wallet-message"><p>No wallet extension detected in this browser. Open testnet.cmdk.fi in the browser where your wallet is installed, or use Coinbase Wallet above.</p><p><a href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install MetaMask ↗</a> · <a href="https://rabby.io/" target="_blank" rel="noreferrer">Install Rabby ↗</a></p><PrototypeButton disabled={isPending} onClick={() => setRevision(value => value + 1)}>Check installed wallets</PrototypeButton></div>}
      <p className="wallet-message">Use an EVM account that supports message signing and Base Sepolia. Safe and other contract accounts are not supported. A separate NEAR wallet is not required.</p>

    </> : <>
      <div className="wallet-connected"><div><span className="wallet-label">Connected address</span><strong title={address}>{shortAddress(address!)}</strong><small style={{ overflowWrap: 'anywhere' }}>{address}</small><small>{connector?.name ?? 'EVM wallet'}</small></div><button className="button button--secondary" onClick={() => disconnect()}>Disconnect</button></div>
      <div className="wallet-details"><div><span>Wallet network</span><strong>{chain?.name ?? (chainId ? `Chain ${chainId}` : 'Unknown')}</strong></div><div><span>Account type on Base Sepolia</span><strong>{kind === 'checking' ? 'Checking…' : kind === 'plain' ? 'Standard wallet' : kind === 'delegated' ? 'Delegated EOA' : kind === 'contract' ? 'Contract wallet' : 'Could not verify'}</strong></div></div>
      {chainId !== baseSepolia.id && <div className="wallet-message"><p>Switch to Base Sepolia to manage this vault.</p><PrototypeButton disabled={switching} onClick={() => switchChain({chainId:baseSepolia.id})}>{switching ? 'Confirm in your wallet…' : 'Switch to Base Sepolia'}</PrototypeButton>{switchError && <p role="alert">The network switch did not complete. Select Base Sepolia in your wallet and try again.</p>}</div>}
      {kind === 'contract' && <p className="inline-error" role="alert">Smart contract wallets are planned for a later release. This address cannot sign owner actions in cmdk.</p>}
      {kind === 'unavailable' && <p className="inline-error" role="alert">Account verification failed. <button className="button button--secondary" onClick={() => setRevision(value => value + 1)}>Try again</button></p>}
      {kind === 'delegated' && <p className="wallet-message">This delegated EOA can continue. Its signature will be checked against the owner address before any future action.</p>}

    </>}
  </section>
}

export function WalletStatus() {
  const { address, isConnected } = useAccount()
  return <span className="wallet-state">{isConnected && address ? shortAddress(address) : 'Wallet not connected'}</span>
}
