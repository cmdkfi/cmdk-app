import {useEffect,useRef,useState} from 'react'
import {parseAbi,formatUnits,type Hex} from 'viem'
import {useAccount,usePublicClient,useSignMessage} from 'wagmi'
import {loadConfig,viewNear,type Vault} from './near.ts'
import type {MarketPosition,VaultState} from './positions.ts'
import {ruleUpdates,rulesIntent,type Corridor} from './rules.ts'
import {erc20} from './live-actions.ts'
import {checkSetupSignature,startSetupJob,readSetupJob} from './vault-setup.ts'
import {ownerPendingRecord,assertFreshOwnerIntent,verifyOwnerJob} from './owner-recovery.ts'
import {clearPendingAction,updatePendingAction} from './transaction-recovery.ts'
import {PrototypeButton,PrototypeIconButton} from './ui/PrototypeControls.tsx'
import {marketTitle} from './vault-layout.ts'

const percent=(value:bigint)=>{const text=formatUnits(value,16);return text.includes('.')?text:`${text}.0`}
const abi=parseAbi(['function setCorridor(bytes32,(uint64 target,uint64 act,uint64 floor,uint64 sellBudget,bool migrateAllowed,bool exitAllowed,bool set),uint256)', 'function corridors(address,bytes32) view returns(uint64 target,uint64 act,uint64 floor,uint64 sellBudget,bool migrateAllowed,bool exitAllowed,bool set)', 'function isAuthorized(address,address) view returns(bool)'])
type Update=ReturnType<typeof ruleUpdates>[number]
type Props={vault:Vault;market:MarketPosition;backup?:MarketPosition;applyBackup?:boolean;onApplyBackupChange?:(value:boolean)=>void;onRefresh:()=>void;independent?:boolean}

export function EditRules({vault,market,backup,applyBackup=false,onApplyBackupChange,onRefresh,independent=false}:Props){
 const dialog=useRef<HTMLDialogElement>(null),flight=useRef(false)
 const client=usePublicClient({chainId:84532}),{address,chainId}=useAccount(),{signMessageAsync}=useSignMessage()
 const [values,setValues]=useState(['','','']),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false)
 const key=`cmdk-live-action:${vault.accountId}:${address}`
 const session=useRef('');session.current=`${vault.accountId}:${address}:${chainId}`
 const mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 function assertSession(expected:string){if(!mounted.current||session.current!==expected)throw Error('Wallet or vault changed. Reopen Edit rules.')}
 async function read(selected=market):Promise<Corridor>{
  if(!client||!selected.executor)throw Error('Executor unavailable.')
  return client.readContract({address:selected.executor,abi,functionName:'corridors',args:[vault.baseAddress as Hex,selected.id]})
 }
 async function open(animate=false){
  if(dialog.current)dialog.current.dataset.animate=String(animate)
  dialog.current?.showModal();setReady(false);setMessage('Reading Base Executor…')
  try{const current=await read();if(!current[6])throw Error('Configure this market first.');setValues([current[0],current[1],current[3]].map(percent));setReady(true);setMessage('')}
  catch(e){setMessage((e as Error).message)}
 }
 async function save(){
  if(flight.current||!client||!address)return
  const expected=session.current;flight.current=true;setBusy(true)
  try{
   if(chainId!==84532||await client.getChainId()!==84532)throw Error('Switch to Base Sepolia.')
   if(localStorage.getItem(key))throw Error('A vault action is pending. Check its status before saving rules.')
   const selected=[market,...applyBackup&&backup?[backup]:[]]
   if(selected.some(item=>item.readOnly))throw Error('Verify the registered Executor before editing this market.')
   const snapshots=await Promise.all(selected.map(async item=>({market:item,current:await read(item)})))
   const updates=ruleUpdates(snapshots,values),intent=rulesIntent(updates)
   const config=await loadConfig(),state=await viewNear<VaultState>(config.nearRpcUrl,vault.accountId,'get_state')
   if(state.owner?.toLowerCase()!==address.toLowerCase())throw Error('Connected wallet is not the vault owner.')
   if(selected.some(item=>state.markets?.find(entry=>entry.id?.toLowerCase()===item.id.toLowerCase())?.executor?.toLowerCase()!==item.executor?.toLowerCase()))throw Error('Registered Executor changed. Refresh before editing rules.')
   const expiry=Number((await client.getBlock()).timestamp)+600
   for(const update of updates){
    const item=selected.find(item=>item.id===update.market)!
    if(!item.executor)throw Error('Executor unavailable.')
    if(intent.method==='setup'){
     if(!item.morpho)throw Error('Morpho unavailable.')
     const [authorized,loan,collateral]=await Promise.all([
      client.readContract({address:item.morpho,abi,functionName:'isAuthorized',args:[vault.baseAddress as Hex,item.executor]}),
      client.readContract({address:item.loanToken,abi:erc20,functionName:'allowance',args:[vault.baseAddress as Hex,item.executor]}),
      client.readContract({address:item.collateralToken,abi:erc20,functionName:'allowance',args:[vault.baseAddress as Hex,item.executor]}),
     ])
     if(!authorized||loan===0n||collateral===0n)throw Error('Repair setup before applying shared rules to both markets.')
    }
    await client.simulateContract({account:vault.baseAddress as Hex,address:item.executor,abi,functionName:'setCorridor',args:[item.id,{target:BigInt(update.target),act:BigInt(update.act),floor:BigInt(update.floor),sellBudget:BigInt(update.sell_budget),migrateAllowed:update.migrate_allowed,exitAllowed:update.exit_allowed,set:false},BigInt(expiry)]})
   }
   const text=JSON.stringify({protocol:'cmdk-vault/1',network:'testnet',vault:vault.accountId,method:intent.method,args:intent.args,nonce:Number(state.owner_nonce)+1,expiry})
   setMessage(`Review changes to ${updates.length===2?'both markets':'one market'} in your wallet.`)
   assertSession(expected);const signature=await signMessageAsync({message:text});assertSession(expected);await checkSetupSignature(text,signature,address)
   for(const snapshot of snapshots){const latest=await read(snapshot.market);if(latest.some((value,index)=>value!==snapshot.current[index]))throw Error('Rules changed while signing. Reload and review again.')}
   await assertFreshOwnerIntent(config,vault,text);assertSession(expected)
   if(localStorage.getItem(key))throw Error('Another vault action started. Check its status.')
   localStorage.setItem(key,JSON.stringify(ownerPendingRecord(text,{rules:{origin:market.id,updates}})))
   const job=await startSetupJob(config,vault.accountId,text,signature)
   updatePendingAction(key,{message:text},{job});setMessage('Submitted. Check confirmation below.')
  }catch(e){setMessage((e as Error).message)}finally{setBusy(false);flight.current=false}
 }
 async function check(){
  if(flight.current||!client)return
  flight.current=true;setBusy(true)
  try{
   const record=JSON.parse(localStorage.getItem(key)??'{}')
   if(!record.rules||(record.rules.origin??record.rules.market)!==market.id)throw Error('This pending action is not a rules update from this panel.')
   if(!record.job)throw Error('No recoverable job. Check vault activity before resubmitting.')
   const updates:Update[]=record.rules.updates??[{market:record.rules.market,target:record.rules.target,act:record.rules.act,floor:record.rules.floor,sell_budget:record.rules.budget,migrate_allowed:record.rules.migrate,exit_allowed:record.rules.exit}]
   const config=await loadConfig(),job=await readSetupJob(config,record.job)
   if(job.stage!=='done'||job.base_sent?.length!==updates.length)throw Error(job.error??'Still pending. Check again.')
   await verifyOwnerJob(config,vault,record,job)
   for(const hash of job.base_sent){const receipt=await client.waitForTransactionReceipt({hash:hash as Hex,confirmations:2});if(receipt.status!=='success')throw Error('Transaction reverted.')}
   for(const update of updates){
    const item=[market,backup].find(item=>item?.id===update.market)
    if(!item)throw Error('Updated market is no longer available in this panel.')
    const c=await read(item)
    if(c[0].toString()!==update.target||c[1].toString()!==update.act||c[2].toString()!==update.floor||c[3].toString()!==update.sell_budget||c[4]!==update.migrate_allowed||c[5]!==update.exit_allowed||!c[6])throw Error('Stored rules differ. Inspect the vault before another update.')
   }
   const current=await read();setValues([current[0],current[1],current[3]].map(percent));clearPendingAction(key,record);setMessage('Confirmed on Base. Rules refreshed.');onRefresh()
  }catch(e){setMessage((e as Error).message)}finally{flight.current=false;setBusy(false)}
 }
 const title=independent?'Backup rules':'Edit rules'
 return <><PrototypeButton onClick={event=>void open(event.detail>0)}>{independent?'Edit backup rules':'Edit rules'}</PrototypeButton>
  <dialog ref={dialog} className="connect-dialog edit-rules" aria-label={title}>
   <div className="dialog-close"><PrototypeIconButton aria-label={`Close ${title}`} onClick={()=>dialog.current?.close()}>×</PrototypeIconButton></div>
   <h2>{title}</h2><p>{marketTitle(market)}</p>
   {['Target LTV','Trigger line','Daily budget'].map((label,index)=><label key={label}>{label} (%)<input inputMode="decimal" disabled={!ready||busy} value={values[index]} onChange={event=>setValues(values.map((value,i)=>i===index?event.target.value:value))}/></label>)}
   {backup&&<label className="shared-rules-check"><input type="checkbox" checked={applyBackup} disabled={busy||backup.readOnly} onChange={event=>onApplyBackupChange?.(event.target.checked)}/>Apply the same rules to the backup market</label>}
   <p>{applyBackup&&backup?'Target, Trigger and Budget apply to both markets.':'Only this market is updated.'} Floor and migration / exit permissions are preserved separately for each market. Unchanged rules are not submitted.</p>
   <PrototypeButton primary disabled={!ready||busy||!address||chainId!==84532} onClick={()=>void save()}>Review and sign rules</PrototypeButton>
   <PrototypeButton disabled={busy} onClick={()=>void check()}>Check confirmation</PrototypeButton>
   {(!address||chainId!==84532)&&<p>Connect the vault owner on Base Sepolia to save rules.</p>}<p role="status">{message}</p>
  </dialog></>
}
