import {AgentEvidence} from './AgentEvidence.tsx'
import {useNow} from './use-now.ts'
import {protectionLabel} from './protection-clock.ts'
import {AgentApproval} from './AgentApproval.tsx'
import {readNearSecurity} from './near-security.ts'
import {RevokeAgent} from './RevokeAgent.tsx'
import { useEffect, useId, useRef, useState } from 'react'
import { loadConfig, viewNear, type AgentMeasurement, type Vault } from './near.ts'
import { readLivePosition, type MarketPosition, type VaultState } from './positions.ts'
import { PrototypeButton, PrototypeIconButton } from './ui/PrototypeControls.tsx'
export function VerificationDetails({vault, market}: {vault:Vault;market:MarketPosition}) {
  const now=useNow()
  const [agentActive,setAgentActive]=useState(false),[agentRevision,setAgentRevision]=useState(0)
  const generation=useRef(0)
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
  const [policyError,setPolicyError] = useState('')
  const [copied,setCopied] = useState('')
  const [loading,setLoading] = useState(false)
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  useEffect(()=>{generation.current++;dialog.current?.close();setAgentActive(false);setLoading(false);setState(undefined);setPolicy(undefined)},[vault.accountId,vault.owner,market.id])
  async function open(refreshEvidence=true) {
    const run=++generation.current;const current=()=>live.current&&generation.current===run
    setAgentActive(true);if(refreshEvidence)setAgentRevision(value=>value+1)
    if (!dialog.current?.open) dialog.current?.showModal(); setLoading(true); setError('');setPolicyError('');setState(undefined);setPolicy(undefined);setCopied('');setSecurity(undefined);setSecurityError('');setReadAt(undefined);setPublished(null)
    try {
      const config = await loadConfig()
      if(!current())return
      if(current())setEvidenceUrl(`${config.relayerUrl}/agent/transcripts`)
      const next = await viewNear<VaultState>(config.nearRpcUrl,vault.accountId,'get_state')
      if(!current())return
      if (next.owner?.toLowerCase() !== vault.owner.toLowerCase()) throw new Error('Vault owner changed.')
      if(current()){setState(next);setPublished(config.agent.measurement);setReadAt(Date.now())}
      await Promise.allSettled([
        (async()=>{try {const result=await readNearSecurity(config,vault,next.agent?.public_key);if(current())setSecurity(result)}catch(e){if(current())setSecurityError((e as Error).message)}})(),
        (async()=>{try {const position=await readLivePosition(config,vault.accountId,vault.owner);const fresh=position.markets.find(item=>item.id===market.id);if(!fresh)throw Error('Selected market is no longer configured.');if(current())setPolicy(fresh)}catch(e){if(current())setPolicyError((e as Error).message)}})()
      ])
    } catch (e) { if (current()) setError((e as Error).message) } finally { if (current()) setLoading(false) }
  }
  const approved = state?.approved
  const matches = !!approved && !!published && Object.entries(published).every(([key,value]) => approved[key] === value)
  const registered = !!state?.agent?.public_key && (state.agent.expires_at ?? 0) > now
  async function copy(text:string) { try { await navigator.clipboard.writeText(text); setCopied('Copied') } catch { setCopied('Copy unavailable; select the address to copy.') } }
  const short=(value:string)=>value.length>24?`${value.slice(0,12)}…${value.slice(-8)}`:value
  const field = (label:string,value:string,href?:string) => <div className="verification-field" key={label}><dt>{label}</dt><dd>{href ? <a href={href} target="_blank" rel="noreferrer">{short(value)} ↗</a> : <code title={value}>{short(value)}</code>}<PrototypeButton onClick={() => void copy(value)} aria-label={`Copy ${label}`}>Copy</PrototypeButton></dd></div>
  return <><PrototypeButton onClick={() => void open()} aria-haspopup="dialog">Verification details</PrototypeButton>
    <dialog ref={dialog} className="connect-dialog verification-dialog" aria-labelledby={headingId} onClose={()=>{generation.current++;setAgentActive(false);setLoading(false)}}>
      <header className="verification-heading">
        <div className="verification-title"><h2 id={headingId}>Verification details</h2><PrototypeIconButton aria-label="Close verification details" onClick={() => dialog.current?.close()}>×</PrototypeIconButton></div>
        <p>Morpho · WETH/USDC{market.label==='backup'?' · backup':''}</p>
        <div className="verification-address"><a href={`https://testnet.nearblocks.io/address/${vault.accountId}#contract`} target="_blank" rel="noreferrer">{short(vault.accountId)} ↗</a><PrototypeButton aria-label="Copy vault address" onClick={()=>void copy(vault.accountId)}>Copy</PrototypeButton></div>
        <PrototypeButton disabled={loading} onClick={()=>void open()}>Refresh telemetry</PrototypeButton>
        <span className="verification-feedback" role="status">{copied}</span>
      </header>
      <div className="verification-body">
      <dl className="verification-overview" aria-label="Contract verification summary"><div><dt>Agent registration</dt><dd>{state ? registered?'Registered · unexpired':'No unexpired registration' : loading?'Reading NEAR…':'Unavailable'}</dd></div></dl>
      {error && <div className="verification-source-error" role="alert"><strong>NEAR state unavailable</strong><p>{error}</p><PrototypeButton disabled={loading} onClick={()=>void open(false)}>Retry NEAR state</PrototypeButton></div>}
      {agentActive&&<AgentEvidence vault={vault} active={agentActive} revision={agentRevision} approved={state?.approved} agentKey={state?.agent?.public_key} registrationExpires={state?.agent?.expires_at}/>}
      <details className="verification-disclosure"><summary>Agent registration & policy</summary>
      <p>Registration and attestation state are read from the NEAR vault. Market policy is read from the Base executor.</p>
      {readAt && <p>NEAR state read {new Date(readAt).toLocaleString()}</p>}
      {loading && <p role="status">Reading contract state and market policy…</p>}
      {policyError && <div role="alert"><p>Base policy unavailable: {policyError}</p><PrototypeButton disabled={loading} onClick={()=>void open(false)}>Retry contract reads</PrototypeButton></div>}
      {state && <><p>{registered ? 'NEAR reports an unexpired agent registration.' : 'No unexpired agent registration.'}</p><p>{matches ? 'Approved measurement matches the published deployment.' : approved ? 'Approved measurement is present; deployment match is not established.' : 'No approved measurement.'} This is a contract-state check, not an independent re-verification of the TDX quote.</p>
      <dl>
        {state.signer && field('NEAR Chain Signatures signer',state.signer,`https://testnet.nearblocks.io/address/${state.signer}#contract`)}
        {state.path && field('Derivation path',state.path)}
        {state.base_address && field('Vault Base address',state.base_address,`https://sepolia.basescan.org/address/${state.base_address}`)}
        {state.cooldown_secs !== undefined && <div><dt>Agent cooldown</dt><dd>{state.cooldown_secs.toFixed(1)} seconds</dd></div>}
        {state.last_agent_action !== undefined && <div><dt>Last agent action recorded by NEAR</dt><dd>{state.last_agent_action===0?'None recorded':new Date(state.last_agent_action*1000).toLocaleString()}</dd></div>}
        <div><dt>Current protection status</dt><dd>{policy ? protectionLabel(policy.autopilot,policy.protectionValidUntil,policy.registrationExpires,now) : 'Unavailable'}</dd></div>
        {state.agent?.public_key && field('Registered agent',state.agent.public_key)}
        {state.agent?.expires_at && <div><dt>Registration expires</dt><dd>{new Date(state.agent.expires_at*1000).toLocaleString()}</dd></div>}
        {approved && Object.entries(approved).map(([key,value]) => field(key,value))}
        <div><dt>Floor / Migration / Exit</dt><dd>{policy?.floor == null ? 'Unavailable' : `${(Number(policy.floor)/1e16).toFixed(1)}%`} / {policy?.migrateAllowed===undefined?'Unavailable':policy.migrateAllowed?'allowed':'disabled'} / {policy?.exitAllowed===undefined?'Unavailable':policy.exitAllowed?'allowed':'disabled'}</dd></div>
        <div><dt>Target / Trigger / Daily sell budget</dt><dd>{!policy||policy.policyUnavailable?'Unavailable':[policy.agentTarget,policy.agentTrigger,policy.dailyBudget??null].map(n => n === null ? 'Not configured' : `${(Number(n)/1e16).toFixed(1)}%`).join(' / ')}</dd></div>
      </dl><p>Policy values are read from the Base executor corridor for this NEAR vault’s Base address. Heartbeat interval and raw quote are not exposed by get_state.</p></>}
      </details>
      <details className="verification-disclosure"><summary>NEAR account security</summary>
      {securityError && <div role="alert"><p>NEAR account security unavailable: {securityError}</p><PrototypeButton disabled={loading} onClick={()=>void open(false)}>Retry account security</PrototypeButton></div>}
      {security && <><p>{security.codeMatches ? 'Vault code hash matches the factory configuration.' : 'Vault code hash does not match the factory configuration.'}</p><p>{security.restricted ? 'Exactly one registered agent key, restricted to reduce / migrate / exit on this vault.' : 'Access-key restrictions do not match the expected single registered agent key. Inspect the raw permissions.'}</p><dl>{field('Vault code hash',security.account.global_contract_hash ?? security.account.code_hash)}{security.factoryCodeHash && field('Factory code hash',security.factoryCodeHash)}</dl><details><summary>Raw access-key permissions</summary><pre>{JSON.stringify(security.keys,null,2)}</pre></details></>}
      </details>
      <details className="verification-disclosure"><summary>Contracts & raw data</summary><dl>
        {field('NEAR vault · get_state',vault.accountId,`https://testnet.nearblocks.io/address/${vault.accountId}#contract`)}
        {market.executor && field('Base Executor',market.executor,`https://sepolia.basescan.org/address/${market.executor}#code`)}
        {market.morpho && field('Morpho Blue',market.morpho,`https://sepolia.basescan.org/address/${market.morpho}#readContract`)}
        {field('Market ID',market.id)}
      </dl><details><summary>Full contract state</summary><pre>{state?JSON.stringify(state,null,2):'NEAR state unavailable'}</pre></details>
      {evidenceUrl && <a href={evidenceUrl} target="_blank" rel="noreferrer">Agent decision transcripts ↗</a>}</details>
      <details className="verification-disclosure verification-permissions"><summary>Agent permissions</summary>
        {state && !matches && !market.readOnly && <AgentApproval vault={vault} onConfirmed={()=>void open()} />}
        <RevokeAgent vault={vault} onConfirmed={()=>void open()} />
      </details>
      </div>
    </dialog>
  </>
}
