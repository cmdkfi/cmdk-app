import {readNearSecurity} from './near-security.ts'
import {RevokeAgent} from './RevokeAgent.tsx'
import { useEffect, useId, useRef, useState } from 'react'
import { loadConfig, viewNear, type AgentMeasurement, type Vault } from './near.ts'
import { readLivePosition, type MarketPosition, type VaultState } from './positions.ts'
import { PrototypeButton, PrototypeIconButton } from './ui/PrototypeControls.tsx'
export function VerificationDetails({vault, market}: {vault:Vault;market:MarketPosition}) {
  const headingId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [policy,setPolicy] = useState<MarketPosition>()
  const [readAt,setReadAt] = useState<number>()
  const [evidenceUrl,setEvidenceUrl]=useState('')
  const [state,setState] = useState<VaultState>()
  const [published,setPublished] = useState<AgentMeasurement | null>(null)
  const [security,setSecurity]=useState<Awaited<ReturnType<typeof readNearSecurity>>>()
  const [securityError,setSecurityError]=useState('')
  const [error,setError] = useState('')
  const [copied,setCopied] = useState('')
  const [loading,setLoading] = useState(false)
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  async function open() {
    if (!dialog.current?.open) dialog.current?.showModal(); setLoading(true); setError('');setState(undefined);setPolicy(undefined);setCopied('');setSecurity(undefined);setSecurityError('')
    try {
      const config = await loadConfig()
      if(live.current)setEvidenceUrl(`${config.relayerUrl}/agent/transcripts`)
      const next = await viewNear<VaultState>(config.nearRpcUrl,vault.accountId,'get_state')
      if (next.owner?.toLowerCase() !== vault.owner.toLowerCase()) throw new Error('Vault owner changed.')
      try { const result = await readNearSecurity(config,vault,next.agent?.public_key);if(live.current)setSecurity(result) } catch(e) {if(live.current)setSecurityError((e as Error).message)}
      const position = await readLivePosition(config,vault.accountId,vault.owner)
      const fresh = position.markets.find(item=>item.id===market.id)
      if (!fresh) throw Error('Selected market is no longer configured.')
      if (live.current) { setState(next); setPolicy(fresh);setReadAt(Date.now());setPublished(config.agent.measurement) }
    } catch (e) { if (live.current) setError((e as Error).message) } finally { if (live.current) setLoading(false) }
  }
  const approved = state?.approved
  const matches = !!approved && !!published && Object.entries(published).every(([key,value]) => approved[key] === value)
  const registered = !!state?.agent?.public_key && (state.agent.expires_at ?? 0) > Date.now()/1000
  async function copy(text:string) { try { await navigator.clipboard.writeText(text); setCopied('Copied') } catch { setCopied('Copy unavailable; select the address to copy.') } }
  const field = (label:string,value:string,href?:string) => <div className="verification-field" key={label}><dt>{label}</dt><dd>{href ? <a href={href} target="_blank" rel="noreferrer">{value} ↗</a> : <code>{value}</code>}<PrototypeButton onClick={() => void copy(value)} aria-label={`Copy ${label}`}>Copy</PrototypeButton></dd></div>
  return <><PrototypeButton onClick={() => void open()} aria-haspopup="dialog">Verification details</PrototypeButton>
    <dialog ref={dialog} className="connect-dialog verification-dialog" aria-labelledby={headingId}>
      <div className="dialog-close"><PrototypeIconButton aria-label="Close verification details" onClick={() => dialog.current?.close()}>×</PrototypeIconButton></div>
      <h2 id={headingId}>Verification details</h2><PrototypeButton disabled={loading} onClick={()=>void open()}>Refresh telemetry</PrototypeButton>{readAt && <p>Last read {new Date(readAt).toLocaleTimeString()}</p>}
      <p>Live NEAR vault state and Base market policy. Attestation verification takes place on NEAR Testnet; the Base executor does not store enclave measurements.</p>
      {loading && <p role="status">Reading get_state…</p>}{error && <p role="alert">{error}</p>}
      {state && <><p>{registered ? 'NEAR reports an unexpired agent registration.' : 'No unexpired agent registration.'}</p><p>{matches ? 'Approved measurement matches the published deployment.' : approved ? 'Approved measurement is present; deployment match is not established.' : 'No approved measurement.'} This is a contract-state check, not an independent re-verification of the TDX quote.</p>
      <dl>{field('NEAR vault · get_state',vault.accountId,`https://testnet.nearblocks.io/address/${vault.accountId}#contract`)}
        {market.executor && field('Base Executor',market.executor,`https://sepolia.basescan.org/address/${market.executor}#code`)}
        {market.morpho && field('Morpho Blue',market.morpho,`https://sepolia.basescan.org/address/${market.morpho}#readContract`)}
        {field('Market ID',market.id)}
        {state.signer && field('NEAR Chain Signatures signer',state.signer,`https://testnet.nearblocks.io/address/${state.signer}#contract`)}
        {state.path && field('Derivation path',state.path)}
        {state.base_address && field('Vault Base address',state.base_address,`https://sepolia.basescan.org/address/${state.base_address}`)}
        {state.cooldown_secs !== undefined && <div><dt>Agent cooldown</dt><dd>{state.cooldown_secs.toFixed(1)} seconds</dd></div>}
        {state.last_agent_action !== undefined && <div><dt>Last agent action recorded by NEAR</dt><dd>{state.last_agent_action===0?'None recorded':new Date(state.last_agent_action*1000).toLocaleString()}</dd></div>}
        <div><dt>Current protection status</dt><dd>{policy?.autopilot ?? 'Unavailable'}</dd></div>
        {state.agent?.public_key && field('Registered agent',state.agent.public_key)}
        {state.agent?.expires_at && <div><dt>Registration expires</dt><dd>{new Date(state.agent.expires_at*1000).toLocaleString()}</dd></div>}
        {approved && Object.entries(approved).map(([key,value]) => field(key,value))}
        <div><dt>Floor / Migration / Exit</dt><dd>{policy?.floor == null ? 'Unavailable' : `${(Number(policy.floor)/1e16).toFixed(1)}%`} / {policy?.migrateAllowed ? 'allowed' : 'disabled'} / {policy?.exitAllowed ? 'allowed' : 'disabled'}</dd></div>
        <div><dt>Target / Trigger / Daily sell budget</dt><dd>{[policy?.agentTarget ?? null,policy?.agentTrigger ?? null,policy?.dailyBudget ?? null].map(n => n === null ? 'Not configured' : `${(Number(n)/1e16).toFixed(1)}%`).join(' / ')}</dd></div>
      </dl><p>Policy values are read from the Base executor corridor for this NEAR vault’s Base address. Heartbeat interval and raw quote are not exposed by get_state.</p></>}
      {securityError && <p role="alert">{securityError}</p>}
      {security && <><h3>NEAR account security</h3><p>{security.codeMatches ? 'Vault code hash matches the factory configuration.' : 'Vault code hash does not match the factory configuration.'}</p><p>{security.restricted ? 'Exactly one registered agent key, restricted to reduce / migrate / exit on this vault.' : 'Access-key restrictions do not match the expected single registered agent key. Inspect the raw permissions.'}</p><dl>{field('Vault code hash',security.account.global_contract_hash ?? security.account.code_hash)}{security.factoryCodeHash && field('Factory code hash',security.factoryCodeHash)}</dl><details><summary>Raw access-key permissions</summary><pre>{JSON.stringify(security.keys,null,2)}</pre></details></>}
      <p>{evidenceUrl && <a href={evidenceUrl} target="_blank" rel="noreferrer">Agent decision transcripts ↗</a>} Decision evidence is published by the agent. Confirm execution through chain receipts.</p><RevokeAgent vault={vault} onConfirmed={()=>void open()} /><p role="status">{copied}</p>
    </dialog>
  </>
}
