import {VerificationDetails} from './VerificationDetails.tsx'
import {LiveVaultTable} from './LiveVaultTable.tsx'
import {useVaultSelection} from './VaultSelectionContext.tsx'
import {useNow} from './use-now.ts'
import {PrototypeButton} from './ui/PrototypeControls.tsx'

export function VaultDiscovery() {
 const state=useVaultSelection(),now=useNow()*1000
 const waiting=!!state.retryAt&&state.retryAt>now
 const readonly=state.stale||state.kind!=='ready'
 return <section className="vault-discovery" aria-labelledby="vault-discovery-heading">
  <div className="vault-discovery__heading"><div><h3 id="vault-discovery-heading">Owned by this address</h3><p>Vaults owned by this address on NEAR testnet.</p></div><PrototypeButton disabled={state.kind==='loading'||waiting} onClick={state.refresh}>{state.kind==='loading'?'Checking…':'Refresh'}</PrototypeButton></div>
  {state.kind==='loading'&&<p className="wallet-message" role="status">Checking your account and finding your vaults…</p>}
  {state.kind==='pending'&&<p role="status">Vault search is waiting for the published testnet factory address.</p>}
  {state.kind==='error'&&<p className="inline-error" role="alert">Vault search unavailable. {state.message}</p>}
  {state.failed>0&&<p role="alert">Ownership check incomplete: {state.failed} vault records could not be checked. This is not an empty portfolio.</p>}
  {(state.kind==='error'||state.failed>0)&&<p className="wallet-message">{waiting?`RPC cooldown until ${new Date(state.retryAt!).toLocaleTimeString()}.`:state.autoRetryStopped?'Automatic retries paused. Refresh to try again.':'Retrying automatically while this page is visible, up to three times. You can also refresh manually.'}</p>}
  {readonly&&state.vaults.length>0&&<section aria-label="Previously found vaults"><p role="status">Previously found vaults · read-only until ownership is checked again.{state.checkedAt?` Last complete check ${new Date(state.checkedAt).toLocaleString()}.`:''}</p><ul>{state.vaults.map(vault=><li key={vault.accountId}><code>{vault.accountId}</code> <a href={`#verify?vault=${encodeURIComponent(vault.accountId)}`}>Inspect vault {vault.number} ↗</a></li>)}</ul></section>}
  {state.kind==='ready'&&!readonly&&<>
   {state.vaults.length===0?<div className="vault-empty"><p>No vault belongs to this address yet.</p><a className="button" href="#create">Create vault →</a></div>:<><a className="button button--secondary" href="#create">Create vault</a><LiveVaultTable vaults={state.vaults} onOpen={id=>{state.select(id);window.location.hash=`vault?id=${encodeURIComponent(id)}`}}/></>}
   {state.selected&&<VerificationDetails key={state.selected.accountId} vault={state.selected} inspectionOnly/>}
   {state.selected&&<p className="vault-selection" role="status">Selected: {state.selected.accountId}. <a href={`#vault?id=${encodeURIComponent(state.selected.accountId)}`}>View vault details</a>.</p>}
  </>}
 </section>
}
