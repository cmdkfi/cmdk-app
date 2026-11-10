import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { AdapterKind, Adapters, WalletOption, WalletState } from './types.ts'
import { createLiveAdapters } from './live/index.ts'
import { createSandboxAdapters } from './sandbox/index.ts'
import { SANDBOX } from '../flow/build.ts'

const AdapterContext = createContext<Adapters | null>(null)

/**
 * Exactly one adapter set exists at a time: live adapters are never constructed while
 * the sandbox is active, and vice versa. Mount with key={kind} so a switch disposes the old set.
 */
export function AdapterProvider({ kind, children }: { kind: AdapterKind; children: ReactNode }) {
  // Outside a sandbox build the sandbox branch folds away and the stub module is not bundled.
  const adapters = useMemo(() => (SANDBOX && kind === 'sandbox' ? createSandboxAdapters() : createLiveAdapters()), [kind])
  useEffect(() => () => adapters.wallet.dispose(), [adapters])
  return <AdapterContext.Provider value={adapters}>{children}</AdapterContext.Provider>
}

export function useAdapters(): Adapters {
  const adapters = useContext(AdapterContext)
  if (!adapters) throw new Error('useAdapters must be used inside AdapterProvider')
  return adapters
}

export function useWalletState(): WalletState {
  const { wallet } = useAdapters()
  return useSyncExternalStore(wallet.subscribe, wallet.getState)
}

/** The injected wallets in this browser for the S3 list (Phase 8). */
export function useWallets(): WalletOption[] {
  const { wallet } = useAdapters()
  return useSyncExternalStore(wallet.subscribeWallets, wallet.getWallets)
}

/** The connected wallet's name for copy ("Waiting for Rabby Wallet…"), or "your wallet" when it has none. */
export function useWalletLabel(): string {
  const state = useWalletState()
  return state.status === 'connected' && state.walletName ? state.walletName : 'your wallet'
}
