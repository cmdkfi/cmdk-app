import {ownerPendingRecord} from './owner-recovery.ts'
import {revocationMessage,revocationConfirmed} from './revocation.ts'
import {useEffect,useRef,useState} from 'react'
import {useAccount,useSignMessage} from 'wagmi'
import {loadConfig,viewNear,type Vault} from './near.ts'
import type {VaultState} from './positions.ts'
import {checkSetupSignature,readSetupJob,startSetupJob} from './vault-setup.ts'
import {PrototypeButton} from './ui/PrototypeControls.tsx'
export function RevokeAgent({vault,onConfirmed}:{vault:Vault;onConfirmed:()=>void}){
 const {address,chainId}=useAccount(),{signMessageAsync}=useSignMessage()
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[review,setReview]=useState(false)
 const reviewStart=useRef<HTMLButtonElement>(null),cancelButton=useRef<HTMLButtonElement>(null)
 useEffect(()=>{if(review)cancelButton.current?.focus();else if(reviewStart.current?.closest('dialog')?.open) reviewStart.current?.focus()},[review])
 const flight=useRef(false),session=useRef('');session.current=`${address}:${vault.accountId}:${chainId}`
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 const key=`cmdk-live-action:${vault.accountId}:${address}`
 async function revoke(){if(flight.current||!address)return;flight.current=true;setBusy(true);const expected=session.current
 try{if(chainId!==84532)throw Error('Connect on Base Sepolia.');if(localStorage.getItem(key))throw Error('Another vault action is pending.')
 const config=await loadConfig();const state=await viewNear<VaultState>(config.nearRpcUrl,vault.accountId,'get_state');if(state.owner?.toLowerCase()!==address.toLowerCase())throw Error('Connect the vault owner.')
 const message=revocationMessage(vault.accountId,state.owner_nonce,Math.floor(Date.now()/1000))
 const signature=await signMessageAsync({message});await checkSetupSignature(message,signature,address)
 if(!mounted.current||session.current!==expected)throw Error('Wallet changed. Reopen verification.');if(localStorage.getItem(key))throw Error('Another vault action started.')
 localStorage.setItem(key,JSON.stringify(ownerPendingRecord(message)));const job=await startSetupJob(config,vault.accountId,message,signature);localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)??'{}'),job,operation:'revoke_agent'}));setStatus('Submitted. Check revocation status.');setReview(false)
 }catch(e){setStatus((e as Error).message)}finally{flight.current=false;setBusy(false)}}
 async function check(){if(flight.current)return;flight.current=true;setBusy(true);try{const record=JSON.parse(localStorage.getItem(key)??'{}');if(record.operation!=='revoke_agent'||!record.job)throw Error('No revocation job is available. Inspect vault activity before retrying.');const config=await loadConfig();const job=await readSetupJob(config,record.job);if(job.vault!==vault.accountId||job.stage!=='done'||!job.near_tx||job.base_sent?.length)throw Error(job.error??'Revocation is not confirmed yet.');const state=await viewNear<VaultState>(config.nearRpcUrl,vault.accountId,'get_state');if(!revocationConfirmed(state))throw Error('Agent or approved measurement remains present. Refresh before retrying.');localStorage.removeItem(key);setStatus('Agent revoked on NEAR. Approved measurement cleared.');onConfirmed()}catch(e){setStatus((e as Error).message)}finally{flight.current=false;setBusy(false)}}
 return <section><h3>Agent permissions</h3><p>Revoking removes the agent registration and approved measurement on NEAR. Re-enabling protection requires measurement approval and agent registration again. Already signed Base transactions remain valid until their nonce is consumed or their execution deadline expires; revocation does not cancel them.</p>{review?<><p>Confirm revocation for {vault.accountId}?</p><PrototypeButton disabled={busy} onClick={()=>void revoke()}>Sign revocation</PrototypeButton><PrototypeButton disabled={busy} buttonRef={cancelButton} onClick={()=>setReview(false)}>Cancel</PrototypeButton></>:<PrototypeButton buttonRef={reviewStart} disabled={busy||!address||address.toLowerCase()!==vault.owner.toLowerCase()||chainId!==84532} onClick={()=>setReview(true)}>Revoke agent</PrototypeButton>}<PrototypeButton disabled={busy} onClick={()=>void check()}>Check revocation status</PrototypeButton><p role="status">{status}</p></section>
}
