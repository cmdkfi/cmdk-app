import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { AdapterKind, Adapters, WalletState } from './types.ts'
import { createLiveAdapters } from './live/index.ts'
import { createSandboxAdapters } from './sandbox/index.ts'

const AdapterContext = createContext<Adapters | null>(null)

/**
 * Exactly one adapter set exists at a time: live adapters are never constructed while
 * the sandbox is active, and vice versa. Mount with key={kind} so a switch disposes the old set.
 */
export function AdapterProvider({ kind, children }: { kind: AdapterKind; children: ReactNode }) {
  const adapters = useMemo(() => (kind === 'live' ? createLiveAdapters() : createSandboxAdapters()), [kind])
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
