import { useVaultSelection } from './VaultSelectionContext.tsx'

export function VaultDiscovery() {
  const state = useVaultSelection()
  return <section className="vault-discovery" aria-labelledby="vault-discovery-heading">
    <div className="vault-discovery__heading"><div><h3 id="vault-discovery-heading">Owned by this address</h3><p>Vaults owned by this address on NEAR testnet.</p></div>{state.kind === 'ready' || state.kind === 'error' ? <button className="button button--secondary" onClick={state.refresh}>Refresh</button> : null}</div>
    {state.kind === 'loading' && <p className="wallet-message" role="status">Checking your account and finding your vaults…</p>}
    {state.kind === 'pending' && <p className="wallet-message" role="status">Vault search is waiting for the published testnet factory address. Your wallet is connected; no transaction is needed.</p>}
    {state.kind === 'error' && <p className="inline-error" role="alert">{state.message}</p>}
    {state.kind === 'ready' && <>
      {state.failed > 0 && <p className="wallet-message" role="status">{state.failed} vault {state.failed === 1 ? 'record could not' : 'records could not'} be checked. This list may be incomplete.</p>}
      {state.vaults.length === 0 && <div className="vault-empty"><p>{state.failed ? 'No vault was confirmed for this address.' : 'No vault belongs to this address yet.'}</p><a className="button" href="#create">Create vault <span aria-hidden="true">→</span></a></div>}
      {state.vaults.length > 0 && <a className="button button--secondary" href="#create">Create vault</a>}
      {state.vaults.length > 0 && <div className="vault-list" aria-label="Select a vault">
        {state.vaults.map(vault => <button key={vault.accountId} type="button" aria-pressed={state.selected?.accountId === vault.accountId} className={`vault-option ${state.selected?.accountId === vault.accountId ? 'vault-option--selected' : ''}`} onClick={() => { state.select(vault.accountId); window.location.hash = 'dashboard' }}>
          <span><strong>Vault {vault.number}</strong><small>{vault.accountId}</small></span><span className="vault-option__meta">{vault.marketCount} {vault.marketCount === 1 ? 'market' : 'markets'}<span aria-hidden="true">{' · Open vault →'}</span></span>
        </button>)}
      </div>}
      {state.selected && <p className="vault-selection" role="status">Selected: {state.selected.accountId}. <a href="#dashboard">View its position on My loan</a>.</p>}
    </>}
  </section>
}
