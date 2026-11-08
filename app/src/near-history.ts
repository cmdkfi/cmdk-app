import {validateSignedOwnerTransactions} from './owner-recovery.ts'
export type NearHistoryRow={transaction_hash:string;signer_account_id:string;receiver_account_id:string;block_timestamp:string;actions:{action:string;method?:string}[];outcomes?:{status:boolean}}
export function parseNearHistory(value:unknown,account:string):{rows:NearHistoryRow[];next:string|null}{
 const data=value as {data?:NearHistoryRow[];meta?:{next_page?:unknown}}|null
 if(!data||!Array.isArray(data.data))throw Error('Unexpected NearBlocks response.')
 for(const row of data.data){if(typeof row.transaction_hash!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(row.transaction_hash)||row.receiver_account_id!==account||typeof row.signer_account_id!=='string'||!Array.isArray(row.actions)||row.actions.some(a=>!a||typeof a.action!=='string'||a.method!==undefined&&typeof a.method!=='string')||!/^\d{16,20}$/.test(row.block_timestamp))throw Error('NearBlocks returned incomplete or unrelated transaction records.')}
 if(data.meta?.next_page!==undefined&&data.meta.next_page!==null&&typeof data.meta.next_page!=='string')throw Error('Invalid NearBlocks pagination cursor.')
 return {rows:data.data,next:typeof data.meta?.next_page==='string'?data.meta.next_page:null}
}

export async function readNearHistoryDetails(config:import('./near.ts').AppConfig,row:NearHistoryRow,vault:import('./near.ts').Vault,fetcher:typeof fetch=fetch) {
 if(row.receiver_account_id!==vault.accountId)throw Error('Transaction belongs to another vault.')
 const response=await fetcher(config.nearRpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({jsonrpc:'2.0',id:'history',method:'tx',params:{tx_hash:row.transaction_hash,sender_account_id:row.signer_account_id,wait_until:'FINAL'}})})
 if(!response.ok)throw Error('NEAR transaction details unavailable.')
 const data=await response.json() as {result?:{transaction?:{hash?:string;receiver_id?:string;signer_id?:string;actions?:{FunctionCall?:{method_name:string;args:string}}[]};status?:{SuccessValue?:string;Failure?:unknown}}}
 const result=data.result,tx=result?.transaction
 if(!tx||tx.hash!==row.transaction_hash||tx.receiver_id!==vault.accountId||tx.signer_id!==row.signer_account_id)throw Error('NEAR transaction identity mismatch.')
 const decode=(text:string)=>JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(text),c=>c.charCodeAt(0))))
 const calls=(tx.actions??[]).flatMap<{method:string;args:unknown;ownerNonce?:number}>(action=>{
  if(!action.FunctionCall)return []
  const call=action.FunctionCall,args=decode(call.args) as Record<string,unknown>
  if(call.method_name==='owner_call'&&typeof args.message==='string'){
   const intent=JSON.parse(args.message) as {protocol?:string;network?:string;vault?:string;method?:string;args?:unknown;nonce?:number}
   if(intent.protocol!=='cmdk-vault/1'||intent.network!=='testnet'||intent.vault!==vault.accountId)throw Error('Unexpected owner-call intent.')
   return [{method:intent.method??'owner_call',args:intent.args,ownerNonce:intent.nonce}]
  }
  return [{method:call.method_name,args}]
 })
 let baseHashes:string[]=[]
 if(calls.length&&result?.status?.SuccessValue){const value=decode(result.status.SuccessValue);if(Array.isArray(value)&&value.length){baseHashes=(await validateSignedOwnerTransactions(value,vault.baseAddress!)).map(tx=>tx.hash)}}
 return {calls,status:result?.status?.SuccessValue!==undefined?{success:true}:result?.status?.Failure!==undefined?{failure:result.status.Failure}:{unavailable:true},baseHashes}
}
