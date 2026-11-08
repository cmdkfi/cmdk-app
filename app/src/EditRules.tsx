import {editedCorridor} from './rules.ts'
import {useEffect,useRef,useState} from 'react'
import {parseAbi,formatUnits,type Hex} from 'viem'
import {useAccount,usePublicClient,useSignMessage} from 'wagmi'
import {loadConfig,viewNear,type Vault} from './near.ts'
import type {MarketPosition,VaultState} from './positions.ts'
import {checkSetupSignature,startSetupJob,readSetupJob} from './vault-setup.ts'
import {PrototypeButton} from './ui/PrototypeControls.tsx'
const percent=(value:bigint)=>{const text=formatUnits(value,16);return text.includes('.')?text:`${text}.0`}
const abi=parseAbi(['function corridors(address,bytes32) view returns(uint64 target,uint64 act,uint64 floor,uint64 sellBudget,bool migrateAllowed,bool exitAllowed,bool set)'])
export function EditRules({vault,market,onRefresh}:{vault:Vault;market:MarketPosition;onRefresh:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),flight=useRef(false)
 const client=usePublicClient({chainId:84532}),{address,chainId}=useAccount(),{signMessageAsync}=useSignMessage()
 const [values,setValues]=useState(['','','']),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false)
 const key=`cmdk-live-action:${vault.accountId}:${address}`
 const session=useRef('');session.current=`${vault.accountId}:${address}:${chainId}`
 const mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 function assertSession(expected:string){if(!mounted.current||session.current!==expected)throw Error('Wallet or vault changed. Reopen Edit rules.')}

 async function read(){if(!client||!market.executor)throw Error('Executor unavailable');return client.readContract({address:market.executor,abi,functionName:'corridors',args:[vault.baseAddress as Hex,market.id]})}
 async function open(){dialog.current?.showModal();setReady(false);setMessage('Reading Base Executor…');try{const c=await read();if(!c[6])throw Error('Configure this market first.');setValues([c[0],c[1],c[3]].map(v=>percent(v)));setReady(true);setMessage('')}catch(e){setMessage((e as Error).message)}}
 async function save(){if(flight.current||!client||!address)return;const expected=session.current;flight.current=true;setBusy(true)
 try{
 if(chainId!==84532||await client.getChainId()!==84532)throw Error('Switch to Base Sepolia.')
 if(localStorage.getItem(key))throw Error('A vault action is pending. Check its status before saving rules.')
 const c=await read();const edited=editedCorridor(c,values,market.liquidationLtv)
 const config=await loadConfig(),state=await viewNear<VaultState>(config.nearRpcUrl,vault.accountId,'get_state')
 if(state.owner?.toLowerCase()!==address.toLowerCase())throw Error('Connected wallet is not the vault owner.')
 const expiry=Number((await client.getBlock()).timestamp)+600
 const args={market:market.id,...edited}
 const message=JSON.stringify({protocol:'cmdk-vault/1',network:'testnet',vault:vault.accountId,method:'set_corridor',args,nonce:Number(state.owner_nonce)+1,expiry})
 setMessage('Confirm the updated rules in your wallet.')
 assertSession(expected);const signature=await signMessageAsync({message});assertSession(expected);await checkSetupSignature(message,signature,address)
 const latest=await read();if(latest.some((x,i)=>x!==c[i]))throw Error('Rules changed while signing. Reload the form and review again.')
 assertSession(expected);if(localStorage.getItem(key))throw Error('Another vault action started. Check its status.')
 localStorage.setItem(key,JSON.stringify({pending:true,kind:'owner'}))
 const job=await startSetupJob(config,vault.accountId,message,signature);localStorage.setItem(key,JSON.stringify({job}));setMessage('Submitted. Check confirmation below.')
 }catch(e){setMessage((e as Error).message)}finally{setBusy(false);flight.current=false}}
 async function check(){if(flight.current||!client)return;flight.current=true;setBusy(true);try{const record=JSON.parse(localStorage.getItem(key)??'{}');if(!record.job)throw Error('No recoverable job. Check vault activity before resubmitting.');const job=await readSetupJob(await loadConfig(),record.job);if(job.vault!==vault.accountId)throw Error('Job belongs to another vault.');if(job.stage!=='done'||job.base_sent?.length!==1)throw Error(job.error??'Still pending. Check again.');const receipt=await client.waitForTransactionReceipt({hash:job.base_sent[0] as Hex,confirmations:2});if(receipt.status!=='success')throw Error('Transaction reverted.');const c=await read();setValues([c[0],c[1],c[3]].map(v=>percent(v)));localStorage.removeItem(key);setMessage('Confirmed on Base. Rules refreshed.');onRefresh()}catch(e){setMessage((e as Error).message)}finally{flight.current=false;setBusy(false)}}
 return <><PrototypeButton onClick={()=>void open()}>Edit rules</PrototypeButton><dialog ref={dialog} className="connect-dialog edit-rules" aria-label="Edit rules"><PrototypeButton aria-label="Close Edit rules" onClick={()=>dialog.current?.close()}>×</PrototypeButton><h2>Edit rules</h2><p>{market.loanSymbol} / {market.collateralSymbol}</p>{['Target LTV','Trigger line','Daily budget'].map((label,i)=><label key={label}>{label} (%)<input inputMode="decimal" disabled={!ready||busy} value={values[i]} onChange={e=>setValues(values.map((v,j)=>j===i?e.target.value:v))}/></label>)}<p>Budget limits discretionary collateral sales over a rolling 24 hours. Floor and migration / exit permissions are preserved from Base.</p><PrototypeButton primary disabled={!ready||busy||!address||chainId!==84532} onClick={()=>void save()}>Review and sign rules</PrototypeButton><PrototypeButton disabled={busy} onClick={()=>void check()}>Check confirmation</PrototypeButton>{(!address||chainId!==84532)&&<p>Connect the vault owner on Base Sepolia to save rules.</p>}<p role="status">{message}</p></dialog></>
}
