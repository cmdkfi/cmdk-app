import test from 'node:test'
import assert from 'node:assert/strict'
import {privateKeyToAccount} from 'viem/accounts'
import {keccak256} from 'viem'
import {cancellationMessage,validateCancellation,cancellableNonce,replaceHeldRecord} from './held-cancellation.ts'
import {ownerPendingRecord,validateSignedOwnerTransactions} from './owner-recovery.ts'
import {clearPendingAction,updatePendingAction,ownerTransactionsConsumed} from './transaction-recovery.ts'
const account=privateKeyToAccount('0x'+'11'.repeat(32)),other='0x'+'22'.repeat(20)
const signed=[8,9,10].map(nonce=>({nonce,from:account.address,hash:'0x'+String(nonce).padStart(64,'0')}))
test('held batch cancellation advances one confirmed nonce at a time, never unlocks a suffix',()=>{
 assert.equal(cancellableNonce(signed,account.address,8,8),8)
 assert.equal(ownerTransactionsConsumed(signed,account.address,9),false)
 assert.equal(cancellableNonce(signed,account.address,9,9),9)
 assert.equal(ownerTransactionsConsumed(signed,account.address,11),true)
 for(const [confirmed,pending] of [[8,9],[9,10],[7,7],[11,11],[-1,-1]])assert.throws(()=>cancellableNonce(signed,account.address,confirmed,pending))
 assert.throws(()=>cancellableNonce([signed[0],signed[2]],account.address,8,8),/sequence/)
 assert.throws(()=>cancellableNonce(signed,other,8,8),/sequence/)
})
test('a recovered cancellation must be a signed Base Sepolia zero-value self-transfer',async()=>{
 async function row(overrides={}){const raw=await account.signTransaction({chainId:84532,nonce:8,to:account.address,value:0n,data:'0x',gas:30000n,maxFeePerGas:10000000n,maxPriorityFeePerGas:1n,type:'eip1559',...overrides});return{raw,hash:keccak256(raw),from:account.address,nonce:8}}
 const valid=await validateSignedOwnerTransactions([await row()],account.address)
 assert.equal(validateCancellation(valid,account.address).nonce,8)
 async function rejects(overrides){assert.throws(()=>validateCancellation([overrides],account.address))}
 for(const overrides of [{to:other},{value:1n},{data:'0x1234'},{chainId:1}])await rejects(await row(overrides))
 assert.throws(()=>validateCancellation([],account.address))
 assert.throws(()=>validateCancellation([...valid,...valid],account.address))
})
test('cancellation intent preserves the protocol message and exact original record through uncertain outcomes',()=>{
 const message=cancellationMessage('v3.factory.testnet',4,2000000000),intent=JSON.parse(message)
 assert.deepEqual(intent,{protocol:'cmdk-vault/1',network:'testnet',vault:'v3.factory.testnet',method:'cancel',args:{},nonce:4,expiry:2000000000})
 assert.throws(()=>cancellationMessage('v3.factory.testnet',0,2000000000))
 let value=JSON.stringify({kind:'owner',message:'original',ownerNonce:'3',job:'original-job'})
 const storage={getItem:()=>value,setItem:(_key,next)=>{value=next},removeItem:()=>{value=null}}
 const original=value,record=JSON.parse(value),cancellation={...ownerPendingRecord(message),originalNear:'near-proof'}
 replaceHeldRecord('vault',original,{...record,cancellation},storage)
 const persisted=value
 assert.equal(JSON.parse(value).message,'original')
 assert.equal(clearPendingAction('vault',JSON.parse(value),storage),false)
 assert.throws(()=>updatePendingAction('vault',record,{hash:'old-hash'},storage))
 assert.throws(()=>replaceHeldRecord('vault',original,null,storage),/changed/)
 assert.equal(value,persisted)
 replaceHeldRecord('vault',persisted,{...JSON.parse(value),cancellation:undefined},storage)
 assert.equal(JSON.parse(value).job,'original-job')
 assert.equal(JSON.parse(value).cancellation,undefined)
})
import {archiveCancellation} from './held-cancellation.ts'
test('confirmed cancellation evidence retains original intent and every cancellation across partial batches',()=>{
 const map=new Map(),storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)}
 const original={message:'original',ownerNonce:'3',job:'original-job'},record={...original,cancellation:{message:'cancel-1',originalNear:'near-1'}}
 archiveCancellation('vault',record,'hash-1',9,false,storage)
 archiveCancellation('vault',{...record,cancellation:{message:'cancel-2',originalNear:'near-1'}},'hash-2',10,true,storage)
 const saved=JSON.parse(map.get('vault:cancel-evidence:3'))
 assert.deepEqual(saved.original,original);assert.equal(saved.confirmations.length,2);assert.equal(saved.confirmations[1].complete,true)
 assert.throws(()=>archiveCancellation('vault',{...record,message:'different'},'hash-3',11,true,storage),/another intent/)
})
