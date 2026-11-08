import { useEffect, useId, useRef, useState } from 'react'
import { loadConfig, viewNear, type AgentMeasurement, type Vault } from './near.ts'
import type { MarketPosition, VaultState } from './positions.ts'
import { PrototypeButton, PrototypeIconButton } from './ui/PrototypeControls.tsx'
export function VerificationDetails({vault, market}: {vault:Vault;market:MarketPosition}) {
  const headingId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [state,setState] = useState<VaultState>()
  const [published,setPublished] = useState<AgentMeasurement | null>(null)
  const [error,setError] = useState('')
  const [copied,setCopied] = useState('')
  const [loading,setLoading] = useState(false)
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  async function open() {
    dialog.current?.showModal(); setLoading(true); setError('');setState(undefined)
    try {
      const config = await loadConfig()
      const next = await viewNear<VaultState>(config.nearRpcUrl,vault.accountId,'get_state')
      if (next.owner?.toLowerCase() !== vault.owner.toLowerCase()) throw new Error('Vault owner changed.')
      if (live.current) { setState(next); setPublished(config.agent.measurement) }
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
      <h2 id={headingId}>Verification details</h2>
      <p>Live NEAR vault state and Base market policy. Attestation verification takes place on NEAR Testnet; the Base executor does not store enclave measurements.</p>
      {loading && <p role="status">Reading get_state…</p>}{error && <p role="alert">{error}</p>}
      {state && <><p>{registered ? 'NEAR reports an unexpired agent registration.' : 'No unexpired agent registration.'}</p><p>{matches ? 'Approved measurement matches the published deployment.' : approved ? 'Approved measurement is present; deployment match is not established.' : 'No approved measurement.'} This is a contract-state check, not an independent re-verification of the TDX quote.</p>
      <dl>{field('NEAR vault · get_state',vault.accountId,`https://testnet.nearblocks.io/address/${vault.accountId}#contract`)}
        {market.executor && field('Base Executor',market.executor,`https://sepolia.basescan.org/address/${market.executor}#code`)}
        {market.morpho && field('Morpho Blue',market.morpho,`https://sepolia.basescan.org/address/${market.morpho}#readContract`)}
        {field('Market ID',market.id)}
        {state.agent?.public_key && field('Registered agent',state.agent.public_key)}
        {state.agent?.expires_at && <div><dt>Registration expires</dt><dd>{new Date(state.agent.expires_at*1000).toLocaleString()}</dd></div>}
        {approved && Object.entries(approved).map(([key,value]) => field(key,value))}
        <div><dt>Target / Trigger / Daily sell budget</dt><dd>{[market.agentTarget,market.agentTrigger,market.dailyBudget ?? null].map(n => n === null ? 'Not configured' : `${(Number(n)/1e16).toFixed(1)}%`).join(' / ')}</dd></div>
      </dl><p>Policy values are read from the Base executor corridor for this NEAR vault’s Base address. Heartbeat interval and raw quote are not exposed by get_state.</p></>}
      <p role="status">{copied}</p>
    </dialog>
  </>
}
