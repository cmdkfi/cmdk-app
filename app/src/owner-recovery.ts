import {nearQuery} from './near-rpc.ts'
import {keccak256,parseTransaction,recoverTransactionAddress,type Hex} from 'viem'
import type {AppConfig,Vault} from './near.ts'
import {readRelayerHealth} from './relayer.ts'
import {checkSetupSignature,type SetupJob} from './vault-setup.ts'
import type {PendingTransaction} from './transaction-recovery.ts'
export type SignedOwnerTransaction={raw:Hex;hash:Hex;from:string;nonce:number}
export function ownerPendingRecord(message:string,extra:Record<string,unknown>={}) {
 const parsed=JSON.parse(message) as {protocol?:string;network?:string;nonce?:number;expiry?:number}
 if(parsed.protocol!=='cmdk-vault/1'||parsed.network!=='testnet'||!Number.isSafeInteger(parsed.nonce)||!Number.isSafeInteger(parsed.expiry)||parsed.nonce!<1||parsed.expiry!<1)throw Error('Invalid owner recovery intent.')
 return {...extra,pending:true,kind:'owner' as const,message,ownerNonce:String(parsed.nonce),expiry:parsed.expiry,startedAt:Date.now()}
}
export async function validateSignedOwnerTransactions(value:unknown,vault:string):Promise<SignedOwnerTransaction[]> {
 if(!Array.isArray(value)||value.length>100)throw Error('Unexpected NEAR signed transaction result.')
 const signed:SignedOwnerTransaction[]=[]
 for(const item of value){
  if(!item||typeof item.raw!=='string'||!/^0x02[0-9a-fA-F]+$/.test(item.raw)||typeof item.hash!=='string'||typeof item.from!=='string'||!Number.isSafeInteger(item.nonce))throw Error('Incomplete signed Base transaction.')
  const tx=parseTransaction(item.raw as `0x02${string}`),from=await recoverTransactionAddress({serializedTransaction:item.raw as `0x02${string}`})
  if(tx.chainId!==84532||tx.nonce!==item.nonce||item.nonce<0||keccak256(item.raw as `0x02${string}`).toLowerCase()!==item.hash.toLowerCase()||from.toLowerCase()!==vault.toLowerCase()||item.from.toLowerCase()!==vault.toLowerCase())throw Error('Signed transaction does not match this Base Sepolia vault.')
  signed.push(item as SignedOwnerTransaction)
 }
 if(new Set(signed.map(tx=>tx.nonce)).size!==signed.length)throw Error('Duplicate signed nonce in NEAR result.')
 return signed.sort((a,b)=>a.nonce-b.nonce)
}
export async function readOwnerRecovery(config:AppConfig,vault:Vault,record:PendingTransaction,nearHash:string,fetcher:typeof fetch=fetch) {
 if(!record.message||!record.ownerNonce)throw Error('This legacy pending record has no exact owner intent. Inspect the protocol recovery evidence before clearing it.')
 if(!/^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(nearHash))throw Error('Enter the NEAR owner-call transaction hash.')
 const health=await readRelayerHealth(config,fetcher)
 if(health.chain_id!==84532||health.near_network!=='testnet'||health.factory!==config.near.factory||!health.sender?.endsWith('.testnet'))throw Error('Relayer sender or testnet identity unavailable.')
 const response=await fetcher(config.nearRpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({jsonrpc:'2.0',id:'recovery',method:'tx',params:{tx_hash:nearHash,sender_account_id:health.sender,wait_until:'FINAL'}})})
 if(!response.ok)throw Error('NEAR transaction status unavailable.')
 const data=await response.json() as {result?:{transaction?:{hash?:string;receiver_id?:string;signer_id?:string;actions?:{FunctionCall?:{method_name?:string;args?:string}}[]};status?:{SuccessValue?:string}}}
 const result=data.result,transaction=result?.transaction
 if(transaction?.hash!==nearHash||transaction.receiver_id!==vault.accountId||transaction.signer_id!==health.sender)throw Error('NEAR transaction belongs to another vault or sender.')
 const calls=transaction.actions?.filter(action=>action.FunctionCall?.method_name==='owner_call')??[]
 if(calls.length!==1||typeof calls[0].FunctionCall?.args!=='string'||typeof result?.status?.SuccessValue!=='string')throw Error('NEAR owner-call has no final successful result.')
 const decode=(text:string)=>JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(text),c=>c.charCodeAt(0))))
 const args=decode(calls[0].FunctionCall.args) as {message?:string;signature?:string}
 if(args.message!==record.message||typeof args.signature!=='string')throw Error('NEAR owner-call does not match the pending action.')
 await checkSetupSignature(args.message,args.signature,vault.owner)
 const intent=JSON.parse(args.message) as {nonce?:number;vault?:string}
 if(String(intent.nonce)!==record.ownerNonce||intent.vault!==vault.accountId)throw Error('Owner nonce or vault intent differs.')
 return validateSignedOwnerTransactions(decode(result.status.SuccessValue),vault.baseAddress!)
}

export async function verifyOwnerJob(config:AppConfig,vault:Vault,record:PendingTransaction,job:SetupJob,fetcher:typeof fetch=fetch) {
 if(job.vault!==vault.accountId||!job.near_tx)throw Error('The owner job has no matching NEAR transaction for this vault.')
 const signed=await readOwnerRecovery(config,vault,record,job.near_tx,fetcher)
 const sent=job.base_sent??[]
 if(new Set(sent.map(hash=>hash.toLowerCase())).size!==sent.length||sent.some(hash=>!signed.some(tx=>tx.hash.toLowerCase()===hash.toLowerCase()))||job.stage==='done'&&sent.length!==signed.length)throw Error('Relayer Base hashes do not match the exact NEAR owner-call result.')
 return signed
}

export async function unsubmittedOwnerExpired(config:AppConfig,vault:Vault,record:PendingTransaction,fetcher:typeof fetch=fetch) {
 if(!record.message||!record.ownerNonce||record.expiry===undefined)return false
 const intent=JSON.parse(record.message) as {protocol?:string;network?:string;vault?:string;nonce?:number;expiry?:number}
 if(intent.protocol!=='cmdk-vault/1'||intent.network!=='testnet'||intent.vault!==vault.accountId||String(intent.nonce)!==record.ownerNonce||intent.expiry!==record.expiry)return false
 const snapshot=await nearQuery<{block_hash?:string;result?:number[]}>(config.nearRpcUrl,{request_type:'call_function',finality:'final',account_id:vault.accountId,method_name:'get_state',args_base64:'e30='},fetcher)
 if(!snapshot.block_hash||!Array.isArray(snapshot.result))throw Error('Final NEAR state identity unavailable.')
 const state=JSON.parse(new TextDecoder().decode(new Uint8Array(snapshot.result))) as {owner?:string;base_address?:string;owner_nonce?:string|number}
 if(state.owner?.toLowerCase()!==vault.owner.toLowerCase()||state.base_address?.toLowerCase()!==vault.baseAddress?.toLowerCase()||!/^\d+$/.test(String(state.owner_nonce)))throw Error('Final NEAR owner state does not match the recovery vault.')
 if(BigInt(state.owner_nonce!)>=BigInt(record.ownerNonce))return false
 const response=await fetcher(config.nearRpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({jsonrpc:'2.0',id:'recovery-expiry',method:'block',params:{block_id:snapshot.block_hash}})})
 if(!response.ok)throw Error('Final NEAR block unavailable.')
 const data=await response.json() as {result?:{header?:{hash?:string;timestamp_nanosec?:string}}}
 const header=data.result?.header
 if(header?.hash!==snapshot.block_hash||!/^\d+$/.test(header.timestamp_nanosec??''))throw Error('Final NEAR block timestamp does not match its state snapshot.')
 return BigInt(header.timestamp_nanosec!)/1000000000n>BigInt(record.expiry)
}
