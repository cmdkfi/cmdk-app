import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { accountKind } from './wallet-utils.ts'
import { discoverVaults, loadConfig, selectedOwnedVault, type Vault } from './near.ts'

type DiscoveryState =
  | { kind: 'disconnected' | 'loading' | 'pending'; vaults: Vault[]; failed: number; selected: Vault | null }
  | { kind: 'error'; vaults: Vault[]; failed: number; selected: Vault | null; message: string }
  | { kind: 'ready'; vaults: Vault[]; failed: number; selected: Vault | null }

type VaultSelection = DiscoveryState & { refresh: () => void; select: (accountId: string) => void }

const empty = (kind: 'disconnected' | 'loading' | 'pending'): DiscoveryState => ({ kind, vaults: [], failed: 0, selected: null })
const VaultSelectionContext = createContext<VaultSelection | null>(null)

export function VaultSelectionProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount()
  const client = usePublicClient({ chainId: baseSepolia.id })
  const [state, setState] = useState<DiscoveryState>(() => empty('disconnected'))
  const [stateOwner, setStateOwner] = useState<string | undefined>()
  const [revision, setRevision] = useState(0)
  const owner = isConnected ? address?.toLowerCase() : undefined
  const current = stateOwner === owner ? state : empty(owner ? 'loading' : 'disconnected')

  useEffect(() => {
    setStateOwner(owner)
    if (!owner) { setState(empty('disconnected')); return }
    let active = true
    setState(empty('loading'))
    Promise.resolve().then(async () => {
      if (!client || !address) throw new Error('Account verification is unavailable. Please retry.')
      const code = await client.getCode({ address })
      if (accountKind(code) === 'contract') throw new Error('This account type is not supported yet. Connect another wallet.')
      return loadConfig()
    }).then(async config => {
      if (!config.near.factory) { if (active) setState(empty('pending')); return }
      const result = await discoverVaults(config, owner)
      if (!active) return
      const key = `cmdk-vault:${config.near.factory}:${owner}`
      const saved = localStorage.getItem(key)
      const selected = selectedOwnedVault(result.vaults, saved)
      setState({ kind: 'ready', ...result, selected })
      if (selected) localStorage.setItem(key, selected.accountId)
    }).catch(error => {
      if (active) setState({ ...empty('disconnected'), kind: 'error', message: error instanceof Error ? error.message : 'Vault search failed.' })
    })
    return () => { active = false }
  }, [owner, revision, client, address])

  function select(accountId: string) {
    if (!owner || current.kind !== 'ready') return
    const selected = current.vaults.find(vault => vault.accountId === accountId)
    if (!selected) return
    setState({ ...current, selected })
    loadConfig().then(config => {
      if (config.near.factory) localStorage.setItem(`cmdk-vault:${config.near.factory}:${owner}`, selected.accountId)
    }).catch(() => {})
  }

  return <VaultSelectionContext.Provider value={{ ...current, refresh: () => setRevision(value => value + 1), select }}>{children}</VaultSelectionContext.Provider>
}

export function useVaultSelection(): VaultSelection {
  const value = useContext(VaultSelectionContext)
  if (!value) throw new Error('VaultSelectionProvider is missing.')
  return value
}
