import { baseSepolia } from 'wagmi/chains'
import {
  connect, disconnect, getAccount, reconnect, sendTransaction, signMessage, switchChain,
  waitForTransactionReceipt, watchAccount, watchAsset,
} from 'wagmi/actions'
import type { WalletAdapter, WalletState } from '../types.ts'
import { createWagmiConfig } from './wagmi-config.ts'

const METAMASK_RDNS = ['io.metamask', 'io.metamask.flask']

function snapshot(account: ReturnType<typeof getAccount>): WalletState {
  if (account.status === 'connected') return { status: 'connected', address: account.address, chainId: account.chainId }
  if (account.status === 'connecting' || account.status === 'reconnecting') return { status: 'connecting' }
  return { status: 'disconnected' }
}

function same(a: WalletState, b: WalletState) {
  if (a.status !== b.status) return false
  return a.status !== 'connected' || (b.status === 'connected' && a.address === b.address && a.chainId === b.chainId)
}

export function createLiveWallet(): WalletAdapter {
  const config = createWagmiConfig()
  const listeners = new Set<() => void>()
  let state = snapshot(getAccount(config))
  const unwatch = watchAccount(config, {
    onChange(account) {
      const next = snapshot(account)
      if (same(state, next)) return
      state = next
      listeners.forEach(listener => listener())
    },
  })
  // Silent reconnect through MetaMask's remembered permission (PRD S0); never prompts.
  void reconnect(config).catch(() => undefined)

  const metaMask = () =>
    config.connectors.find(item => METAMASK_RDNS.includes(item.id)) ??
    config.connectors.find(item => item.id === 'metaMask')

  const injectedMetaMask = () => {
    const provider = (window as Window & { ethereum?: { isMetaMask?: boolean } }).ethereum
    return provider?.isMetaMask === true
  }

  return {
    kind: 'live',
    hasMetaMask: () => injectedMetaMask() || config.connectors.some(item => METAMASK_RDNS.includes(item.id)),
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async connect() {
      const connector = metaMask()
      if (!connector) throw new Error('MetaMask was not found in this browser.')
      await connect(config, { connector })
    },
    async disconnect() { await disconnect(config) },
    async switchToBaseSepolia(network) {
      await switchChain(config, {
        chainId: baseSepolia.id,
        addEthereumChainParameter: {
          chainName: network.chainName,
          nativeCurrency: network.nativeCurrency,
          rpcUrls: network.rpcUrls,
          blockExplorerUrls: network.blockExplorerUrls,
        },
      })
    },
    signMessage: message => signMessage(config, { message }),
    sendTransaction: tx => sendTransaction(config, { chainId: baseSepolia.id, to: tx.to, data: tx.data, value: tx.value }),
    waitForTransaction: (hash, confirmations) => waitForTransactionReceipt(config, { chainId: baseSepolia.id, hash, confirmations }),
    watchAsset: asset => watchAsset(config, { type: 'ERC20', options: { address: asset.address, symbol: asset.symbol, decimals: asset.decimals, image: asset.image } }),
    dispose() {
      unwatch()
      listeners.clear()
    },
  }
}
