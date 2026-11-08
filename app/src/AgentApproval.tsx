import {useRef,useState} from 'react'
import {useAccount,useSignMessage} from 'wagmi'
import {loadConfig,viewNear,type AgentMeasurement,type Vault} from './near.ts'
import type {VaultState} from './positions.ts'
import {checkSetupSignature,readSetupJob,startSetupJob} from './vault-setup.ts'
import {PrototypeButton} from './ui/PrototypeControls.tsx'

export function AgentApproval({vault,onConfirmed}:{vault:Vault;onConfirmed:()=>void}) {
 const {address,chainId}=useAccount(),{signMessageAsync}=useSignMessage()
 const [measurement,setMeasurement]=useState<AgentMeasurement|null>(null),[status,setStatus]=useState(''),[busy,setBusy]=useState(false)
 const flight=useRef(false),session=useRef('');session.current=`${address}:${vault.accountId}:${chainId}`
 const key=`cmdk-live-action:${vault.accountId}:${address}`
 async function review(){setBusy(true);try{const config=await loadConfig();if(!config.agent.measurement)throw Error('No published agent measurement.');setMeasurement(config.agent.measurement);setStatus('Review the complete published measurement before approving. Existing corridors and token permissions are unchanged.')}catch(e){setStatus((e as Error).message)}finally{setBusy(false)}}
 async function approve(){if(flight.current||!measurement||!address||chainId!==84532)return;flight.current=true;setBusy(true);const expected=session.current
 try{
 if(localStorage.getItem(key))throw Error('Another vault action is pending.')
 const config=await loadConfig(),state=await viewNear<VaultState>(config.nearRpcUrl,vault.accountId,'get_state')
 if(state.owner?.toLowerCase()!==address.toLowerCase())throw Error('Connect the vault owner.')
 if(!config.agent.measurement||Object.entries(measurement).some(([k,v])=>config.agent.measurement![k as keyof AgentMeasurement]!==v))throw Error('Published measurement changed. Review it again.')
 const nonce=Number(state.owner_nonce)+1,expiry=Math.floor(Date.now()/1000)+600
 if(!Number.isSafeInteger(nonce)||nonce<1)throw Error('Owner nonce unavailable.')
 const message=JSON.stringify({protocol:'cmdk-vault/1',network:'testnet',vault:vault.accountId,method:'approve_measurement',args:measurement,nonce,expiry})
 const signature=await signMessageAsync({message});await checkSetupSignature(message,signature,address)
 if(session.current!==expected)throw Error('Wallet changed. Reopen verification.')
 if(localStorage.getItem(key))throw Error('Another vault action started.')
 localStorage.setItem(key,JSON.stringify({pending:true,kind:'owner',operation:'approve_measurement',measurement,ownerNonce:String(nonce),expiry,startedAt:Date.now()}))
 const job=await startSetupJob(config,vault.accountId,message,signature)
 localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)??'{}'),job}));setStatus('Submitted to NEAR. Check approval status. No Base transaction is required.')
 }catch(e){setStatus((e as Error).message)}finally{flight.current=false;setBusy(false)}}
 async function check(){if(flight.current)return;flight.current=true;setBusy(true);try{
 const record=JSON.parse(localStorage.getItem(key)??'{}');if(record.operation!=='approve_measurement'||!record.job||!record.measurement)throw Error('No measurement approval job. Inspect activity before retrying.')
 const config=await loadConfig(),job=await readSetupJob(config,record.job)
 if(job.vault!==vault.accountId||job.stage!=='done'||!job.near_tx||job.base_sent?.length)throw Error(job.error??'Approval is not confirmed.')
 const state=await viewNear<VaultState>(config.nearRpcUrl,vault.accountId,'get_state')
 if(!state.approved||Object.entries(record.measurement).some(([k,v])=>state.approved![k]!==v))throw Error('Stored measurement does not match the approval. Inspect NEAR before retrying.')
 localStorage.removeItem(key);setMeasurement(null);setStatus('Measurement confirmed on NEAR. Agent registration is separate and must be observed before protection is active.');onConfirmed()
 }catch(e){setStatus((e as Error).message)}finally{flight.current=false;setBusy(false)}}
 return <section><h3>Approve agent measurement</h3><p>Restore measurement approval after revocation or review a newly published agent version. Approval allows that version to register; it does not confirm registration or execution health.</p><PrototypeButton disabled={busy} onClick={()=>void review()}>Review published measurement</PrototypeButton>{measurement&&<><pre>{JSON.stringify(measurement,null,2)}</pre><PrototypeButton disabled={busy||!address||address.toLowerCase()!==vault.owner.toLowerCase()||chainId!==84532} onClick={()=>void approve()}>Sign measurement approval</PrototypeButton><PrototypeButton disabled={busy} onClick={()=>setMeasurement(null)}>Cancel review</PrototypeButton></>}<PrototypeButton disabled={busy} onClick={()=>void check()}>Check approval status</PrototypeButton><p role="status">{status}</p></section>
}
