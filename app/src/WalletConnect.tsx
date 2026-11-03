import { useEffect, useState } from 'react'
import { useAccount, useConnect, useConnectors, useDisconnect, usePublicClient } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { accountKind, connectionError, shortAddress } from './wallet-utils.ts'

export function WalletConnect() {
  const { address, chain, chainId, connector, isConnected } = useAccount()
  const connectors = useConnectors()
  const { connect, isPending, error, reset } = useConnect()
  const { disconnect } = useDisconnect()
  const client = usePublicClient({ chainId: baseSepolia.id })
  const [kind, setKind] = useState<'checking' | 'plain' | 'delegated' | 'contract' | 'unavailable'>('checking')
  const [availableInjected, setAvailableInjected] = useState<Set<string>>(new Set())

  useEffect(() => {
    let active = true
    Promise.all(connectors.filter(item => item.type === 'injected').map(async item => ({ uid: item.uid, provider: await item.getProvider().catch(() => undefined) }))).then(results => {
      if (active) setAvailableInjected(new Set(results.filter(item => item.provider).map(item => item.uid)))
    })
    return () => { active = false }
  }, [connectors])

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
  }, [address, client])

  const installed = connectors.filter(item => item.type === 'injected' && availableInjected.has(item.uid) && !item.name.toLowerCase().includes('coinbase'))
  const coinbase = connectors.find(item => item.id === 'coinbaseWalletSDK')
  const options = [...installed, ...(coinbase ? [coinbase] : [])]

  return <section className="card wallet-card" aria-labelledby="wallet-heading">
    <div className="card__header"><div><h2 id="wallet-heading">Connect an EVM wallet</h2><p>Use the address that will own your vault. No signature or transaction is requested here.</p></div></div>
    {!isConnected ? <>
      <div className="wallet-options">
        {options.map(item => <button className="wallet-option" key={item.uid} disabled={isPending} onClick={() => { reset(); connect({ connector: item }) }}><span>{item.name}</span><span aria-hidden="true">→</span></button>)}
      </div>
      {isPending && <p className="wallet-message" role="status">Open your wallet to approve the connection…</p>}
      {error && <p className="inline-error" role="alert">{connectionError(error)}</p>}
      {installed.length === 0 && <p className="wallet-message">No browser wallet detected. Install MetaMask or Rabby, then reload; Coinbase Wallet may also connect through its mobile app.</p>}
    </> : <>
      <div className="wallet-connected"><div><span className="wallet-label">Connected address</span><strong>{shortAddress(address!)}</strong><small>{connector?.name ?? 'EVM wallet'}</small></div><button className="button button--secondary" onClick={() => disconnect()}>Disconnect</button></div>
      <div className="wallet-details"><div><span>Wallet network</span><strong>{chain?.name ?? (chainId ? `Chain ${chainId}` : 'Unknown')}</strong></div><div><span>Account type on Base Sepolia</span><strong>{kind === 'checking' ? 'Checking…' : kind === 'plain' ? 'Standard wallet' : kind === 'delegated' ? 'Delegated EOA' : kind === 'contract' ? 'Contract wallet' : 'Could not verify'}</strong></div></div>
      {chain?.id !== baseSepolia.id && <p className="wallet-message">Your wallet can stay on this network for message signing. A later WETH deposit will ask you to switch to Base Sepolia.</p>}
      {kind === 'contract' && <p className="inline-error" role="alert">Smart contract wallets are planned for a later release. This address cannot sign owner actions in cmdk.</p>}
      {kind === 'unavailable' && <p className="inline-error" role="alert">Base Sepolia did not answer the account check. Owner actions will stay unavailable until it can be verified.</p>}
      {kind === 'delegated' && <p className="wallet-message">This delegated EOA can continue. Its signature will be checked against the owner address before any future action.</p>}
    </>}
  </section>
}

export function WalletStatus() {
  const { address, isConnected } = useAccount()
  return <span className="wallet-state">{isConnected && address ? shortAddress(address) : 'Wallet not connected'}</span>
}
