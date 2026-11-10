import { baseSepolia } from 'wagmi/chains'
import {
  connect, disconnect, getAccount, reconnect, sendTransaction, signMessage, switchChain,
  waitForTransactionReceipt, watchAccount, watchAsset, watchConnectors,
} from 'wagmi/actions'
import type { WalletAdapter, WalletOption, WalletState } from '../types.ts'
import { createWagmiConfig } from './wagmi-config.ts'
import { walletName, walletOptions } from './wallet-options.ts'

function snapshot(account: ReturnType<typeof getAccount>): WalletState {
  if (account.status === 'connected') return { status: 'connected', address: account.address, chainId: account.chainId, walletName: walletName(account.connector?.name) }
  if (account.status === 'connecting' || account.status === 'reconnecting') return { status: 'connecting' }
  return { status: 'disconnected' }
}

function same(a: WalletState, b: WalletState) {
  if (a.status !== b.status) return false
  return a.status !== 'connected' || (b.status === 'connected' && a.address === b.address && a.chainId === b.chainId && a.walletName === b.walletName)
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
  // Silent reconnect through the wallet's remembered permission (PRD S0); never prompts.
  void reconnect(config).catch(() => undefined)

  // The S3 list: recomputed whenever a wallet announces itself (EIP-6963); providers are compared by identity to tell
  // whether window.ethereum was announced.
  let wallets: WalletOption[] = []
  const walletListeners = new Set<() => void>()
  let listed = 0
  const list = async () => {
    const mine = ++listed
    const infos = await Promise.all(config.connectors.map(async c => ({ id: c.id, name: c.name, icon: c.icon, type: c.type, provider: await c.getProvider().catch(() => undefined) })))
    if (mine !== listed) return
    wallets = walletOptions(infos, (window as Window & { ethereum?: unknown }).ethereum)
    walletListeners.forEach(listener => listener())
  }
  void list()
  const unwatchConnectors = watchConnectors(config, { onChange: () => { void list() } })

  return {
    kind: 'live',
    getWallets: () => wallets,
    subscribeWallets(listener) {
      walletListeners.add(listener)
      return () => { walletListeners.delete(listener) }
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async connect(walletId) {
      const connector = config.connectors.find(item => item.id === walletId)
      if (!connector) throw new Error('This wallet was not found in this browser.')
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
      unwatchConnectors()
      listeners.clear()
      walletListeners.clear()
    },
  }
}
