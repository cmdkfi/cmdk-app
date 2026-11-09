import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { accountKind } from './wallet-utils.ts'
import {NearReadError} from './near-rpc.ts'
import {emptyDiscovery,retainDiscovery,reconcileDiscovery,type DiscoveryState} from './discovery-state.ts'
import { discoverVaults, loadConfig, selectedOwnedVault } from './near.ts'

type VaultSelection = DiscoveryState & {autoRetryStopped:boolean; refresh: () => void; select: (accountId: string) => void }

const VaultSelectionContext = createContext<VaultSelection | null>(null)

export function VaultSelectionProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount()
  const client = usePublicClient({ chainId: baseSepolia.id })
  const [state, setState] = useState<DiscoveryState>(() => emptyDiscovery('disconnected'))
  const retries=useRef(0)
  const [route, setRoute] = useState(window.location.hash)
  useEffect(() => { const update = () => setRoute(window.location.hash); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update) }, [])
  const [revision, setRevision] = useState(0)
  const owner = isConnected ? address?.toLowerCase() : undefined
  const current = state.owner === owner ? state : emptyDiscovery(owner ? 'loading' : 'disconnected',owner)

  useEffect(() => {
    if (!owner) { setState(emptyDiscovery('disconnected')); return }
    let active = true
    setState(previous=>retainDiscovery(previous,owner,'loading'))
    Promise.resolve().then(async () => {
      if (!client || !address) throw new Error('Account verification is unavailable. Please retry.')
      const code = await client.getCode({ address })
      if (accountKind(code) === 'contract') throw new Error('This account type is not supported yet. Connect another wallet.')
      return loadConfig()
    }).then(async config => {
      if (!config.near.factory) { if (active) setState(emptyDiscovery('pending',owner)); return }
      if(active)setState(previous=>previous.factory&&previous.factory!==config.near.factory?{...emptyDiscovery('loading',owner),factory:config.near.factory!}:previous)
      const result = await discoverVaults(config, owner)
      if (!active) return
      const key = `cmdk-vault:${config.near.factory}:${owner}`
      const saved = localStorage.getItem(key)
      setState(previous=>reconcileDiscovery(previous,owner,config.near.factory!,result,saved,Date.now()))
      if(!result.failed)retries.current=0
      const selected=selectedOwnedVault(result.vaults,saved)
      if(selected)localStorage.setItem(key,selected.accountId)
    }).catch(error => {
      if(active){if(error instanceof Error&&/not supported|configuration|invalid vault count/.test(error.message))retries.current=3;setState(previous=>retainDiscovery(previous,owner,'error',error instanceof Error?error.message:'Vault search failed.',error instanceof NearReadError?error.retryAt:undefined))}
    })
    return () => { active = false }
  }, [owner, revision, client, address])

  useEffect(()=>{retries.current=0},[owner])
  useEffect(()=>{
    if(!owner||state.owner!==owner||!(state.kind==='error'||state.kind==='ready'&&state.failed>0)||retries.current>=3)return
    const due=Math.max(Date.now()+[10000,30000,60000][retries.current],state.retryAt??0)
    let timer:ReturnType<typeof setTimeout>|undefined
    const recover=()=>{if(document.hidden)return;clearTimeout(timer);if(Date.now()<due){timer=setTimeout(recover,Math.min(due-Date.now(),2147483647));return}retries.current++;setRevision(value=>value+1)}
    timer=setTimeout(recover,Math.min(due-Date.now(),2147483647));document.addEventListener('visibilitychange',recover)
    return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',recover)}
  },[state.kind,state.failed,state.retryAt,state.owner,owner,revision])

  function select(accountId: string) {
    if (!owner || current.kind !== 'ready'||current.stale) return
    const selected = current.vaults.find(vault => vault.accountId === accountId)
    if (!selected) return
    setState({ ...current, selected })
    loadConfig().then(config => {
      if (config.near.factory) localStorage.setItem(`cmdk-vault:${config.near.factory}:${owner}`, selected.accountId)
    }).catch(() => {})
  }

  let routeId: string | null = null
  try { routeId = route.startsWith('#vault/') ? decodeURIComponent(route.slice(7)) : new URLSearchParams(route.split('?')[1]).get('id') } catch { /* Invalid routes use the first owned vault. */ }
  const routed = route.startsWith('#vault') ? selectedOwnedVault(current.vaults, routeId ?? current.selected?.accountId ?? null) : current.selected
  return <VaultSelectionContext.Provider value={{ ...current,autoRetryStopped:retries.current>=3, selected: routed, refresh: () => {retries.current=0;setRevision(value => value + 1)}, select }}>{children}</VaultSelectionContext.Provider>
}

export function useVaultSelection(): VaultSelection {
  const value = useContext(VaultSelectionContext)
  if (!value) throw new Error('VaultSelectionProvider is missing.')
  return value
}
