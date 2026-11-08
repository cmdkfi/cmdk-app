import {parseTransaction} from 'viem'
import type {SignedOwnerTransaction} from './owner-recovery.ts'
import type {PendingTransaction} from './transaction-recovery.ts'
export type Cancellation = PendingTransaction & {message:string; originalNear:string}
export type HeldRecord = PendingTransaction & {cancellation?:Cancellation}

export function cancellationMessage(vault:string,nonce:number,expiry:number) {
 if(!Number.isSafeInteger(nonce)||nonce<1||!Number.isSafeInteger(expiry)||expiry<1)throw Error('Owner nonce or expiry unavailable.')
 return JSON.stringify({protocol:'cmdk-vault/1',network:'testnet',vault,method:'cancel',args:{},nonce,expiry})
}
export function validateCancellation(signed:SignedOwnerTransaction[],base:string) {
 if(signed.length!==1)throw Error('Cancellation must contain one signed Base call.')
 const tx=parseTransaction(signed[0].raw as `0x02${string}`)
 if(tx.chainId!==84532||tx.to?.toLowerCase()!==base.toLowerCase()||(tx.value??0n)!==0n||(tx.data??'0x')!=='0x'||signed[0].from.toLowerCase()!==base.toLowerCase())throw Error('Not a zero-value self-transfer cancellation.')
 return signed[0]
}
export function cancellableNonce(signed:SignedOwnerTransaction[],base:string,confirmed:number,pending:number) {
 if(!Number.isSafeInteger(confirmed)||confirmed<0||confirmed!==pending)throw Error('Base transactions are still pending or confirming. Wait and check again.')
 const remaining=signed.filter(tx=>tx.nonce>=confirmed)
 if(!remaining.length)throw Error('Original nonces are already consumed. Reconcile the original action.')
 if(remaining[0].nonce!==confirmed||remaining.some((tx,i)=>tx.nonce!==confirmed+i||tx.from.toLowerCase()!==base.toLowerCase()))throw Error('Held calls do not form the next nonce sequence for this vault.')
 return confirmed
}
export function replaceHeldRecord(key:string,expected:string,next:HeldRecord|null,storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>=localStorage) {
 if(storage.getItem(key)!==expected)throw Error('Pending recovery changed. Reload its evidence before continuing.')
 if(next===null)storage.removeItem(key);else storage.setItem(key,JSON.stringify(next))
}
export function archiveCancellation(key:string,record:HeldRecord,hash:string,confirmedNonce:number,complete:boolean,storage:Pick<Storage,'getItem'|'setItem'>=localStorage) {
 const archiveKey=`${key}:cancel-evidence:${record.ownerNonce}`
 const existing=JSON.parse(storage.getItem(archiveKey)??'null') as {original?:PendingTransaction;confirmations?:unknown[]}|null
 if(existing&&existing.original?.message!==record.message)throw Error('Cancellation archive belongs to another intent. Recovery retained.')
 const {cancellation,...original}=record
 if(!cancellation)throw Error('Cancellation evidence unavailable.')
 const confirmations=(existing?.confirmations??[]) as {hash:string}[]
 const next={original,confirmations:[...confirmations.filter(item=>item.hash!==hash),{hash,confirmedNonce,complete,cancellation}]}
 storage.setItem(archiveKey,JSON.stringify(next))
 storage.setItem(`${key}:cancel-evidence:last`,archiveKey)
}
