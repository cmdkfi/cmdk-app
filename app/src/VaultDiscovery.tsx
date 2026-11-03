import { useEffect, useState } from 'react'
import { discoverVaults, loadConfig, type Vault } from './near.ts'

type State =
  | { kind: 'loading' }
  | { kind: 'pending' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; vaults: Vault[]; failed: number }

export function VaultDiscovery({ address }: { address: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    setState({ kind: 'loading' })
    loadConfig().then(async config => {
      if (!config.near.factory) { if (active) setState({ kind: 'pending' }); return }
      const result = await discoverVaults(config, address)
      if (!active) return
      setState({ kind: 'ready', ...result })
      const key = `cmdk-vault:${config.near.factory}:${address.toLowerCase()}`
      const saved = localStorage.getItem(key)
      const chosen = result.vaults.find(vault => vault.accountId === saved) ?? result.vaults[0]
      setSelected(chosen?.accountId ?? null)
      if (chosen) localStorage.setItem(key, chosen.accountId)
    }).catch(error => {
      if (active) setState({ kind: 'error', message: error instanceof Error ? error.message : 'Vault search failed.' })
    })
    return () => { active = false }
  }, [address, revision])

  function choose(accountId: string) {
    setSelected(accountId)
    loadConfig().then(config => {
      if (config.near.factory) localStorage.setItem(`cmdk-vault:${config.near.factory}:${address.toLowerCase()}`, accountId)
    }).catch(() => {})
  }

  return <section className="vault-discovery" aria-labelledby="vault-discovery-heading">
    <div className="vault-discovery__heading"><div><h3 id="vault-discovery-heading">Your vaults</h3><p>Vaults owned by this address on NEAR testnet.</p></div>{state.kind === 'ready' || state.kind === 'error' ? <button className="button button--secondary" onClick={() => setRevision(value => value + 1)}>Refresh</button> : null}</div>
    {state.kind === 'loading' && <p className="wallet-message" role="status">Looking for your vaults…</p>}
    {state.kind === 'pending' && <p className="wallet-message" role="status">Vault search is waiting for the published testnet factory address. Your wallet is connected; no transaction is needed.</p>}
    {state.kind === 'error' && <p className="inline-error" role="alert">{state.message} Try Refresh when the network is available.</p>}
    {state.kind === 'ready' && <>
      {state.failed > 0 && <p className="wallet-message" role="status">{state.failed} vault {state.failed === 1 ? 'record could not' : 'records could not'} be checked. This list may be incomplete.</p>}
      {state.vaults.length === 0 && <div className="vault-empty"><p>{state.failed ? 'No vault was confirmed for this address.' : 'No vault belongs to this address yet.'}</p><a className="button" href="#create">Preview vault setup <span aria-hidden="true">→</span></a></div>}
      {state.vaults.length > 0 && <div className="vault-list" aria-label="Select a vault">
        {state.vaults.map(vault => <button key={vault.accountId} type="button" aria-pressed={selected === vault.accountId} className={`vault-option ${selected === vault.accountId ? 'vault-option--selected' : ''}`} onClick={() => choose(vault.accountId)}>
          <span><strong>Vault {vault.number}</strong><small>{vault.accountId}</small></span><span className="vault-option__meta">{vault.marketCount} {vault.marketCount === 1 ? 'market' : 'markets'}<span aria-hidden="true">{selected === vault.accountId ? ' ✓' : ' →'}</span></span>
        </button>)}
      </div>}
      {selected && <p className="vault-selection" role="status">Selected: {selected}. The remaining app screens still show example values.</p>}
    </>}
  </section>
}
