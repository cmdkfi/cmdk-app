import {parseTransaction,type Hex} from 'viem'
import {validateSignedOwnerTransactions} from './owner-recovery.ts'
import type {AppConfig,Vault} from './near.ts'
export type Json=Record<string,unknown>
export const object=(value:unknown):Json=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Json:{}
const bootPattern=/^boot-([0-9]{1,12})-[0-9a-f]{8}$/
const transcriptPattern=/^(boot-([0-9]{1,12})-[0-9a-f]{8})-((?:v|vault)[0-9]{1,6})(-twin)?-([0-9]{4,6})\.json$/
const hexHash=/^[0-9a-f]{64}$/
export const nearHash=(value:unknown):value is string=>typeof value==='string'&&/^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(value)
export const baseHash=(value:unknown):value is Hex=>typeof value==='string'&&/^0x[0-9a-fA-F]{64}$/.test(value)
export type EvidenceFile={name:string;bytes:number;sha256:string}
export type EvidenceIndex={boot:string;files:EvidenceFile[]}
export type TranscriptRow=EvidenceFile&{boot:string;vault:string;twin:boolean;loop:number}
export type VerifiedTranscript={row:TranscriptRow;data:Json}
const publicNames=new Set(['app-compose.json','vm_config.json','tdx_quote.hex','event_log.json','info.json'])
export function evidenceName(name:string,account:string){const tag=account.split('.')[0];if(!/^(v|vault)[0-9]{1,6}$/.test(tag))return publicNames.has(name);return publicNames.has(name)||name===`registration-${tag}.json`||new RegExp(`^reregistration-${tag}-[0-9]{1,6}\\.json$`).test(name)}
function file(value:unknown):EvidenceFile{const row=object(value);if(typeof row.name!=='string'||!Number.isSafeInteger(row.bytes)||Number(row.bytes)<0||Number(row.bytes)>2_000_000||typeof row.sha256!=='string'||!hexHash.test(row.sha256))throw Error('Invalid evidence file metadata.');return{name:row.name,bytes:Number(row.bytes),sha256:row.sha256}}
export function evidenceIndex(value:unknown,account:string):EvidenceIndex{
 const index=object(value);if(typeof index.boot!=='string'||!bootPattern.test(index.boot)||!Array.isArray(index.files)||index.files.length>500)throw Error('Invalid boot evidence index.')
 const files=index.files.map(file);if(new Set(files.map(row=>row.name)).size!==files.length)throw Error('Duplicate evidence filename.')
 return{boot:index.boot,files:files.filter(row=>evidenceName(row.name,account))}
}
export function transcriptIndex(value:unknown,account:string):{boot:string;rows:TranscriptRow[]}{
 const index=object(value);if(typeof index.boot!=='string'||!bootPattern.test(index.boot)||!Array.isArray(index.transcripts))throw Error('Invalid transcript index.')
 const rows=index.transcripts.map(value=>{const f=file(value),r=object(value),match=f.name.match(transcriptPattern);if(!match||r.boot!==match[1]||r.vault!==match[3]||r.twin!==!!match[4]||r.loop!==Number(match[5]))throw Error('Transcript filename and metadata disagree.');return{...f,boot:r.boot as string,vault:r.vault as string,twin:r.twin as boolean,loop:Number(r.loop)}})
 if(new Set(rows.map(row=>row.name)).size!==rows.length)throw Error('Duplicate transcript filename.')
 return{boot:index.boot,rows:rows.filter(row=>row.vault===account.split('.')[0]&&!row.twin).sort((a,b)=>Number(b.boot.match(bootPattern)![1])-Number(a.boot.match(bootPattern)![1])||b.loop-a.loop)}
}
async function bytes(url:string,limit:number,signal:AbortSignal,fetcher:typeof fetch){
 const response=await fetcher(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),cache:'no-store'});if(!response.ok)throw Error(`Evidence read failed (HTTP ${response.status}).`)
 if(Number(response.headers.get('Content-Length'))>limit){await response.body?.cancel();throw Error('Evidence exceeds the read limit.')}
 const reader=response.body?.getReader();if(!reader)throw Error('Evidence response has no body.')
 const chunks:Uint8Array[]=[];let length=0
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit)throw Error('Evidence exceeds the read limit.');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
 const output=new Uint8Array(length);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.byteLength}return output
}
export async function readEvidenceJson(url:string,signal:AbortSignal,fetcher:typeof fetch=fetch){return JSON.parse(new TextDecoder().decode(await bytes(url,4_000_000,signal,fetcher))) as unknown}
export async function verifiedFile(url:string,row:EvidenceFile,signal:AbortSignal,fetcher:typeof fetch=fetch){
 const content=await bytes(url,2_000_000,signal,fetcher)
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',content))].map(n=>n.toString(16).padStart(2,'0')).join('')
 if(content.byteLength!==row.bytes||digest!==row.sha256)throw Error('File bytes or SHA-256 do not match the published index.')
 return new TextDecoder().decode(content)
}
export async function readTranscript(base:string,row:TranscriptRow,vault:Vault,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<VerifiedTranscript>{
 const data=object(JSON.parse(await verifiedFile(`${base}/agent/transcripts/${encodeURIComponent(row.name)}`,row,signal,fetcher)))
 if(object(data.vault).id!==vault.accountId||data.network!=='Base Sepolia'||data.twin!==false||object(data.agent).boot!==row.boot||data.loop!==row.loop||typeof data.time_utc!=='string'||!Number.isFinite(Date.parse(data.time_utc))||!Array.isArray(data.decisions))throw Error('Transcript belongs to another vault, boot, loop or network, or is incomplete.')
 const snapshot=object(object(data.inputs).snapshot)
 if(snapshot.user!==undefined&&String(snapshot.user).toLowerCase()!==vault.baseAddress?.toLowerCase())throw Error('Snapshot belongs to another Base vault.')
 return{row,data}
}
export function snapshotIssue(transcript:VerifiedTranscript){
 const s=object(object(transcript.data.inputs).snapshot)
 if(!Number.isSafeInteger(s.timestamp)||Number(s.timestamp)<=0||!Number.isFinite(new Date(Number(s.timestamp)*1000).getTime())||!Number.isSafeInteger(s.block)||Number(s.block)<0||typeof s.user!=='string'||!/^0x[0-9a-f]{40}$/i.test(s.user)||!Array.isArray(s.read_errors)||!Array.isArray(s.rpc_disagree)||!('rpc_second_error'in s))return 'Snapshot validation fields are incomplete.'
 if(s.read_errors.length)return `Read errors: ${s.read_errors.map(String).join('; ')}`
 if(s.rpc_second_error!==null)return `Second RPC: ${String(s.rpc_second_error)}`
 if(s.rpc_disagree.length)return `RPC disagreement: ${s.rpc_disagree.map(String).join('; ')}`
 return null
}
export function attemptedProposals(transcript:VerifiedTranscript):Json[]{
 const top=object(transcript.data.proposal),nested=(transcript.data.decisions as unknown[]).map(decision=>object(object(decision).proposal))
 const proposals=[top,...nested].filter(p=>p.sent===true||typeof p.near_error==='string'&&!!p.near_error)
 return proposals.filter((p,index)=>proposals.findIndex(other=>(nearHash(p.near_tx)?other.near_tx===p.near_tx&&other.method===p.method:JSON.stringify(other)===JSON.stringify(p)))===index)
}
export function transcriptSummary(loaded:VerifiedTranscript[]){return{latest:loaded[0],successful:loaded.find(row=>snapshotIssue(row)===null),attempt:loaded.find(row=>attemptedProposals(row).length>0)}}
export async function readBootFile(base:string,index:EvidenceIndex,row:EvidenceFile,vault:Vault,signal:AbortSignal,fetcher:typeof fetch=fetch){
 if(!evidenceName(row.name,vault.accountId)||!index.files.some(file=>file.name===row.name&&file.sha256===row.sha256))throw Error('File is not in the selected boot index.')
 const content=await verifiedFile(`${base}/agent/evidence/${encodeURIComponent(row.name)}`,row,signal,fetcher)
 const latest=evidenceIndex(await readEvidenceJson(`${base}/agent/`,signal,fetcher),vault.accountId)
 if(latest.boot!==index.boot||!latest.files.some(file=>file.name===row.name&&file.sha256===row.sha256&&file.bytes===row.bytes))throw Error('Published boot or file changed. Refresh evidence before trusting this result.')
 return content
}
export function measurementMatches(value:unknown,approved:Record<string,string>|undefined|null){
 const m=object(value);if(!approved)return false
 const fields={mrtd:96,rtmr0:96,rtmr1:96,rtmr2:96,compose_hash:64,os_image_hash:64}
 return Object.entries(fields).every(([key,length])=>typeof approved[key]==='string'&&new RegExp(`^[0-9a-f]{${length}}$`,'i').test(approved[key])&&typeof m[key]==='string'&&String(m[key]).replace(/^0x/,'').toLowerCase()===approved[key].toLowerCase())
}
export type ExecutionProof={near:'confirmed'|'reverted';base:'confirmed'|'reverted'|'pending'|'unavailable';hash?:Hex}
export async function verifyAgentExecution(config:AppConfig,vault:Vault,transcript:VerifiedTranscript,proposal:Json,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<ExecutionProof>{
 if(!nearHash(proposal.near_tx)||!['reduce','migrate','exit'].includes(String(proposal.method)))throw Error('No supported agent call with a NEAR hash to verify.')
 signal=AbortSignal.any([signal,AbortSignal.timeout(15000)])
 const response=await fetcher(config.nearRpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({jsonrpc:'2.0',id:'agent-proof',method:'tx',params:{tx_hash:proposal.near_tx,sender_account_id:vault.accountId,wait_until:'FINAL'}})})
 if(!response.ok)throw Error('NEAR receipt read unavailable.')
 const result=object(object(await response.json()).result),tx=object(result.transaction),key=object(transcript.data.agent).public_key
 const calls=Array.isArray(tx.actions)?tx.actions.map(action=>object(object(action).FunctionCall)).filter(call=>Object.keys(call).length):[]
 if(tx.hash!==proposal.near_tx||tx.receiver_id!==vault.accountId||tx.signer_id!==vault.accountId||typeof key!=='string'||!key.startsWith('ed25519:')||tx.public_key!==key||calls.length!==1||calls[0].method_name!==proposal.method)throw Error('NEAR transaction does not match this vault, agent key or proposal.')
 const encodedArgs=calls[0].args
 if(typeof encodedArgs!=='string')throw Error('NEAR call arguments unavailable.')
 const actualArgs=object(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encodedArgs),char=>char.charCodeAt(0)))))
 const keys=proposal.method==='reduce'?['market','amount']:proposal.method==='migrate'?['from','to','fraction']:['market']
 const expectedArgs=object(proposal.args)
 if(keys.some(key=>typeof expectedArgs[key]!=='string'||actualArgs[key]!==expectedArgs[key]))throw Error('NEAR call arguments do not match the proposal.')
 if(result.final_execution_status!=='FINAL')throw Error('NEAR finality is not established.')
 const status=object(result.status)
 if('Failure'in status)return{near:'reverted',base:'unavailable'}
 if(!Array.isArray(result.receipts_outcome)||!result.receipts_outcome.length)throw Error('Final NEAR receipt outcomes unavailable.')
 if(result.receipts_outcome.some(receipt=>'Failure'in object(object(object(receipt).outcome).status)))return{near:'reverted',base:'unavailable'}
 if(typeof status.SuccessValue!=='string')throw Error('NEAR outcome is not final and successful.')
 if(!vault.baseAddress)throw Error('Vault Base address unavailable.')
 const decoded=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(status.SuccessValue),char=>char.charCodeAt(0))))
 const signed=await validateSignedOwnerTransactions(decoded,vault.baseAddress)
 if(signed.length!==1)throw Error('Expected one Base call signed by this agent proposal.')
 const hash=signed[0].hash,reported=object(proposal.base).hash
 if(reported!==undefined&&(!baseHash(reported)||reported.toLowerCase()!==hash.toLowerCase()))throw Error('Reported Base hash differs from the NEAR signed result.')
 const rpc=async(method:string,params:unknown[])=>{const res=await fetcher(config.baseRpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({jsonrpc:'2.0',id:'agent-proof',method,params})});if(!res.ok)throw Error('Base receipt read unavailable.');const body=object(await res.json());if(body.error!==undefined||!('result'in body))throw Error('Base RPC returned no verified result.');return body.result}
 const [chain,receipt,head]=await Promise.all([rpc('eth_chainId',[]),rpc('eth_getTransactionReceipt',[hash]),rpc('eth_blockNumber',[])])
 if(chain!=='0x14a34')throw Error('Receipt RPC is not Base Sepolia.')
 if(receipt===null)return{near:'confirmed',base:'pending',hash}
 const rc=object(receipt),signedTx=parseTransaction(signed[0].raw as `0x02${string}`)
 if(rc.transactionHash!==hash||String(rc.from).toLowerCase()!==vault.baseAddress.toLowerCase()||String(rc.to).toLowerCase()!==signedTx.to?.toLowerCase()||!baseHash(rc.blockHash)||typeof rc.blockNumber!=='string'||!/^0x[0-9a-f]+$/i.test(rc.blockNumber)||typeof head!=='string'||!/^0x[0-9a-f]+$/i.test(head)||!['0x0','0x1'].includes(String(rc.status)))throw Error('Base receipt does not match the signed agent call.')
 if(BigInt(head)<BigInt(rc.blockNumber)+1n)return{near:'confirmed',base:'pending',hash}
 return{near:'confirmed',base:rc.status==='0x1'?'confirmed':'reverted',hash}
}
