import {useEffect,useMemo,useRef,useState} from 'react'
import {loadConfig,type AppConfig,type Vault} from './near.ts'
import {useNow} from './use-now.ts'
import {PrototypeButton} from './ui/PrototypeControls.tsx'
import {attemptedProposals,baseHash,evidenceIndex,measurementMatches,nearHash,object,readBootFile,readEvidenceJson,readTranscript,snapshotIssue,transcriptIndex,transcriptSummary,verifyAgentExecution,type EvidenceFile,type EvidenceIndex,type ExecutionProof,type Json,type TranscriptRow,type VerifiedTranscript} from './agent-evidence.ts'

type Props={vault:Vault;active:boolean;revision:number;approved?:Record<string,string>|null;agentKey?:string;registrationExpires?:number}
type FileProof={text:string;checkedAt:number;error?:never}|{error:string;text?:never}
function reported(proposal:Json){const base=object(proposal.base);if(proposal.near_error)return `NEAR error reported: ${String(proposal.near_error)}`;if(proposal.error)return `Agent error: ${String(proposal.error)}`;if(base.error)return `Base error reported: ${String(base.error)}`;if(base.status===1)return 'Agent reports Base success; receipts not checked here yet.';if(base.status===0)return 'Agent reports Base revert; receipts not checked here yet.';return 'Sent attempt; outcome not verified.'}
const time=(value:unknown)=>typeof value==='number'?new Date(value*1000).toLocaleString():String(value??'Unavailable')
export function AgentEvidence({vault,active,revision,approved,agentKey,registrationExpires}:Props){
 const identity=`${vault.accountId}:${vault.baseAddress}:${vault.owner}`
 const [readIdentity,setReadIdentity]=useState(identity)
 const now=useNow(),generation=useRef(0),controller=useRef<AbortController>()
 const [config,setConfig]=useState<AppConfig>(),[index,setIndex]=useState<EvidenceIndex>(),[transcriptBoot,setTranscriptBoot]=useState(''),[rows,setRows]=useState<TranscriptRow[]>([]),[loaded,setLoaded]=useState<VerifiedTranscript[]>([])
 const [reading,setReading]=useState(false),[checking,setChecking]=useState(''),[indexError,setIndexError]=useState(''),[transcriptError,setTranscriptError]=useState(''),[files,setFiles]=useState<Record<string,FileProof>>({}),[proofs,setProofs]=useState<Record<string,(ExecutionProof&{checkedAt:number})|{error:string}>>({}),[copied,setCopied]=useState('')
 function current(run:number){return generation.current===run&&!controller.current?.signal.aborted}
 useEffect(()=>{
  setReadIdentity(identity)
  const run=++generation.current;controller.current?.abort();controller.current=new AbortController();const signal=controller.current.signal
  setConfig(undefined);setIndex(undefined);setTranscriptBoot('');setRows([]);setLoaded([]);setFiles({});setProofs({});setIndexError('');setTranscriptError('');setChecking('');setCopied('');setReading(active)
  if(!active)return()=>controller.current?.abort()
  void(async()=>{
   try{
    const cfg=await loadConfig();if(!current(run))return;setConfig(cfg)
    const results=await Promise.allSettled([readEvidenceJson(`${cfg.relayerUrl}/agent/`,signal),readEvidenceJson(`${cfg.relayerUrl}/agent/transcripts`,signal)])
    if(!current(run))return
    try{if(results[0].status==='rejected')throw results[0].reason;setIndex(evidenceIndex(results[0].value,vault.accountId))}catch(error){setIndexError((error as Error).message)}
    try{if(results[1].status==='rejected')throw results[1].reason;const parsed=transcriptIndex(results[1].value,vault.accountId);setTranscriptBoot(parsed.boot);setRows(parsed.rows);const batch=await Promise.all(parsed.rows.slice(0,5).map(row=>readTranscript(cfg.relayerUrl,row,vault,signal)));if(current(run))setLoaded(batch)}catch(error){if(current(run))setTranscriptError((error as Error).message)}
   }catch(error){if(current(run)){setIndexError((error as Error).message);setTranscriptError((error as Error).message)}}finally{if(current(run))setReading(false)}
  })()
  return()=>controller.current?.abort()
 },[active,revision,vault.accountId,vault.baseAddress,vault.owner])
 async function earlier(){if(!config||reading||checking||!controller.current)return;const run=generation.current;setReading(true);setTranscriptError('');try{const batch=await Promise.all(rows.slice(loaded.length,loaded.length+5).map(row=>readTranscript(config.relayerUrl,row,vault,controller.current!.signal)));if(current(run))setLoaded(previous=>[...previous,...batch])}catch(error){if(current(run))setTranscriptError((error as Error).message)}finally{if(current(run))setReading(false)}}
 async function verifyFile(row:EvidenceFile){if(!config||!index||checking||!controller.current)return;const run=generation.current;setChecking(row.name);setCopied('');try{const text=await readBootFile(config.relayerUrl,index,row,vault,controller.current.signal);if(current(run))setFiles(previous=>({...previous,[row.name]:{text,checkedAt:Date.now()}}))}catch(error){if(current(run))setFiles(previous=>({...previous,[row.name]:{error:(error as Error).message}}))}finally{if(current(run))setChecking('')}}
 async function receipts(transcript:VerifiedTranscript,proposal:Json,key:string){if(!config||checking||!controller.current)return;const run=generation.current;setChecking(key);try{const result=await verifyAgentExecution(config,vault,transcript,proposal,controller.current.signal);if(current(run))setProofs(previous=>({...previous,[key]:{...result,checkedAt:Date.now()}}))}catch(error){if(current(run))setProofs(previous=>({...previous,[key]:{error:(error as Error).message}}))}finally{if(current(run))setChecking('')}}
 async function copy(text:string){try{await navigator.clipboard.writeText(text);setCopied('SHA-256 copied')}catch{setCopied('Copy unavailable; select the hash to copy.')}}
 const infoProof=files['info.json']
 const info=useMemo(()=>{try{return infoProof?.text?object(JSON.parse(infoProof.text)):{} }catch{return{}}},[infoProof?.text])
 if(!active)return null
 if(readIdentity!==identity)return <section className="agent-evidence" aria-label="Agent evidence and telemetry"><p role="status">Reading the selected vault evidence…</p></section>
 const summary=transcriptSummary(loaded),snapshot=object(object(summary.successful?.data.inputs).snapshot)
 const infoMatches=measurementMatches(object(info.tcb_info),approved)
 const currentTranscript=loaded.find(row=>row.row.boot===index?.boot&&object(row.data.agent).public_key===agentKey)
 const matchingTranscript=!!currentTranscript&&measurementMatches(object(currentTranscript.data.agent).measurement,approved)
 return <section className="agent-evidence" aria-label="Agent evidence and telemetry">
  <h3>Agent observations</h3><p>Hash-checked published transcripts, not a heartbeat or a continuous health guarantee. Failed ticks can end without a new transcript.</p>
  <p className="position-read-status" role="status">{reading?'Reading published agent records…':checking?'Checking evidence…':copied||' '}</p>
  {transcriptError&&<p role="alert">{transcriptError}</p>}
  {summary.latest&&<p>Latest transcript: {time(summary.latest.data.time_utc)} · {summary.latest.row.boot}. <a href={`${config?.relayerUrl}/agent/transcripts/${summary.latest.row.name}`} target="_blank" rel="noreferrer">Read transcript ↗</a></p>}
  {summary.latest&&snapshotIssue(summary.latest)&&<p role="alert">Latest published snapshot: {snapshotIssue(summary.latest)}</p>}
  {summary.successful?<dl><div><dt>Last successful published snapshot</dt><dd>{time(snapshot.timestamp)} · block {String(snapshot.block)}<small>{Number(snapshot.timestamp)<=now?`${(now-Number(snapshot.timestamp)).toFixed(1)}s ago`:'Timestamp is ahead of this browser clock.'}</small><small>{summary.successful.row.boot}</small></dd></div></dl>:!reading&&!transcriptError&&<p>No successful snapshot in the {loaded.length} checked records.</p>}
  {summary.attempt?<><h3>Latest published execution attempt</h3><p>{time(summary.attempt.data.time_utc)} · {summary.attempt.row.boot}</p>{attemptedProposals(summary.attempt).map((proposal,i)=>{
   const key=`${summary.attempt!.row.name}:${i}`,proof=proofs[key],base=object(proposal.base),hash=proof&&'hash'in proof?proof.hash:baseHash(base.hash)?base.hash:undefined
   return <article key={key} aria-label={`Agent execution ${i+1}`}><p>{String(proposal.method??'Agent call')} · {reported(proposal)}</p>{nearHash(proposal.near_tx)&&<a href={`https://testnet.nearblocks.io/txns/${proposal.near_tx}`} target="_blank" rel="noreferrer">NEAR transaction ↗</a>}{hash&&<a href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">Base transaction ↗</a>}
    {nearHash(proposal.near_tx)?<PrototypeButton disabled={!!checking||reading} onClick={()=>void receipts(summary.attempt!,proposal,key)}>Verify NEAR / Base receipts</PrototypeButton>:<p>NEAR transaction hash unavailable in this report.</p>}
    {proof&&('error'in proof?<p role="alert">{proof.error}</p>:<p className="agent-chain-proof">RPC check: NEAR {proof.near} · Base {proof.base}{proof.base==='confirmed'||proof.base==='reverted'?' (2 block confirmations)':''}. Checked {new Date(proof.checkedAt).toLocaleTimeString()}.</p>)}
    <details><summary>Reported proposal</summary><pre>{JSON.stringify(proposal,null,2)}</pre></details>
   </article>
  })}</>:!reading&&!transcriptError&&<p>No sent or NEAR-failed attempt in the {loaded.length} checked records.</p>}
  <p>Checked {loaded.length} of {rows.length} published non-twin transcripts for this vault. A missing attempt in this range does not mean the agent never acted.</p>
  {loaded.length<rows.length&&<PrototypeButton disabled={reading||!!checking} onClick={()=>void earlier()}>{transcriptError?'Retry transcript scan':'Inspect earlier transcripts'}</PrototypeButton>}
  <h3>Published boot evidence</h3>{indexError&&<p role="alert">{indexError}</p>}
  {index&&<><p><code>{index.boot}</code>. Worker cache: up to 10.0s. A matching SHA-256 proves consistency with this index, not independent TDX verification.</p>{transcriptBoot&&transcriptBoot!==index.boot&&<p role="alert">Indexes describe different boots. Refresh before comparing current-boot telemetry.</p>}
   {approved&&agentKey?<p>{matchingTranscript?'Current-boot transcript measurement matches the approved measurement and registered agent key.':'No checked current-boot transcript matches both the approved measurement and registered key.'}{registrationExpires!==undefined&&registrationExpires<=now?' The saved registration is expired.':''}</p>:<p>Approved measurement or registered key is unavailable; no contract binding is claimed.</p>}
   {infoProof?.text&&<p>{infoMatches?'Hash-checked info.json measurement fields match the approved measurement.':'info.json fields do not establish a match to the approved measurement.'} Quote signature and TCB validation are not performed in this browser.</p>}
   <details><summary>Evidence files ({index.files.length})</summary><ul className="agent-evidence-files">{index.files.map(row=>{const proof=files[row.name];let registration:Json={};try{if(proof?.text&&row.name.includes('registration-'))registration=object(JSON.parse(proof.text))}catch{registration={}}
    return <li key={row.name}><strong>{row.name}</strong><span>{row.bytes.toLocaleString()} bytes</span><a href={`${config?.relayerUrl}/agent/evidence/${encodeURIComponent(row.name)}`} target="_blank" rel="noreferrer">Raw file ↗</a><PrototypeButton disabled={!!checking||reading} onClick={()=>void verifyFile(row)}>Check SHA-256 · {row.name}</PrototypeButton>{proof?.error&&<p role="alert">{proof.error}</p>}{proof?.text&&<p>SHA-256 matches published boot index. Checked {new Date(proof.checkedAt!).toLocaleTimeString()}.</p>}{row.name.includes('registration-')&&proof?.text&&<p>{registration.vault===vault.accountId&&registration.registered===true&&object(registration.vault_agent).public_key===agentKey?'Registration file matches this vault and its saved agent key.':'Registration file does not match this vault and saved agent key.'}</p>}
     {nearHash(registration.near_tx)&&<a href={`https://testnet.nearblocks.io/txns/${registration.near_tx}`} target="_blank" rel="noreferrer">Registration NEAR transaction ↗</a>}<details><summary>SHA-256 and file details</summary><code>{row.sha256}</code><PrototypeButton aria-label={`Copy SHA-256 ${row.name}`} onClick={()=>void copy(row.sha256)}>Copy hash</PrototypeButton>{proof?.text&&row.name!=='tdx_quote.hex'&&<pre>{proof.text}</pre>}</details></li>
   })}</ul></details>{!index.files.length&&<p>No allowed evidence files are listed for this vault and boot.</p>}
  </>}
 </section>
}
