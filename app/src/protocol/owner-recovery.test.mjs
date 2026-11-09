import test from 'node:test'
import assert from 'node:assert/strict'
import {keccak256} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {ownerPendingRecord,validateSignedOwnerTransactions} from './owner-recovery.ts'
const account=privateKeyToAccount('0x'+'11'.repeat(32))
test('owner recovery retains the exact signed intent and refuses invalid nonces',()=>{
 const message=JSON.stringify({protocol:'cmdk-vault/1',network:'testnet',nonce:4,expiry:2000000000})
 const record=ownerPendingRecord(message,{operation:'repay'})
 assert.equal(record.message,message);assert.equal(record.ownerNonce,'4');assert.equal(record.kind,'owner');assert.equal(record.operation,'repay')
 assert.throws(()=>ownerPendingRecord(JSON.stringify({...JSON.parse(message),nonce:0})))
})
test('recovered Base calls require a valid signature, exact hash, nonce, chain and vault',async()=>{
 const raw=await account.signTransaction({chainId:84532,nonce:7,to:account.address,value:0n,gas:21000n,maxFeePerGas:10000000n,maxPriorityFeePerGas:1n,type:'eip1559'})
 const row={raw,hash:keccak256(raw),from:account.address,nonce:7}
 assert.deepEqual(await validateSignedOwnerTransactions([row],account.address),[row])
 for(const altered of [{...row,nonce:6},{...row,hash:'0x'+'00'.repeat(32)},{...row,from:'0x'+'22'.repeat(20)}]) await assert.rejects(validateSignedOwnerTransactions([altered],account.address))
 await assert.rejects(validateSignedOwnerTransactions([row,row],account.address),/Duplicate/)
 await assert.rejects(validateSignedOwnerTransactions([row],'0x'+'22'.repeat(20)))
 const mainnet=await account.signTransaction({chainId:1,nonce:7,to:account.address,value:0n,gas:21000n,maxFeePerGas:10000000n,maxPriorityFeePerGas:1n,type:'eip1559'})
 await assert.rejects(validateSignedOwnerTransactions([{...row,raw:mainnet,hash:keccak256(mainnet)}],account.address))
})
import {readOwnerRecovery} from './owner-recovery.ts'
test('lost jobs recover only from the exact finalized NEAR owner-call intent',async()=>{
 const vault={accountId:'v3.factory.testnet',owner:account.address,baseAddress:account.address}
 const config={relayerUrl:'https://relayer',relayerUrlFallback:'https://fallback',nearRpcUrl:'https://near',near:{factory:'factory.testnet'}}
 const hash='1'.repeat(44),sender='relayer.testnet'
 const message=JSON.stringify({protocol:'cmdk-vault/1',network:'testnet',vault:vault.accountId,nonce:4,expiry:2000000000,method:'revoke_agent',args:{}})
 const signature=await account.signMessage({message})
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64')
 const fetcher=async(url,options)=>url==='https://relayer/health'?Response.json({chain_id:84532,near_network:'testnet',factory:'factory.testnet',sender}):Response.json({result:{transaction:{hash,receiver_id:vault.accountId,signer_id:sender,actions:[{FunctionCall:{method_name:'owner_call',args:encode({message,signature})}}]},status:{SuccessValue:encode([])}}})
 assert.deepEqual(await readOwnerRecovery(config,vault,ownerPendingRecord(message),hash,fetcher),[])
 await assert.rejects(readOwnerRecovery(config,vault,{...ownerPendingRecord(message),message:message+' '},hash,fetcher),/does not match/)
 await assert.rejects(readOwnerRecovery(config,vault,{pending:true},hash,fetcher),/legacy/)
})
import {verifyOwnerJob,unsubmittedOwnerExpired} from './owner-recovery.ts'
test('an unsubmitted intent unlocks only after the same final NEAR block proves expiry and an unused nonce',async()=>{
 const vault={accountId:'v3.factory.testnet',owner:account.address,baseAddress:account.address},config={nearRpcUrl:'https://near'}
 const message=JSON.stringify({protocol:'cmdk-vault/1',network:'testnet',vault:vault.accountId,nonce:4,expiry:2000000000}),record=ownerPendingRecord(message),block='A'.repeat(44)
 function rpc(nonce,time,hash=block){return async(_url,options)=>JSON.parse(options.body).method==='query'?Response.json({result:{block_hash:block,result:[...new TextEncoder().encode(JSON.stringify({owner:vault.owner,base_address:vault.baseAddress,owner_nonce:nonce}))]}}):Response.json({result:{header:{hash,timestamp_nanosec:(BigInt(time)*1000000000n).toString()}}})}
 assert.equal(await unsubmittedOwnerExpired(config,vault,record,rpc(3,2000000001)),true)
 assert.equal(await unsubmittedOwnerExpired(config,vault,record,rpc(4,2000000001)),false)
 assert.equal(await unsubmittedOwnerExpired(config,vault,record,rpc(3,2000000000)),false)
 await assert.rejects(unsubmittedOwnerExpired(config,vault,record,rpc(3,2000000001,'B'.repeat(44))),/timestamp/)
 assert.equal(await unsubmittedOwnerExpired(config,vault,{pending:true},rpc(3,2000000001)),false)
})
test('job confirmation is bound to its exact NEAR result, including NEAR-only owner calls',async()=>{
 const vault={accountId:'v3.factory.testnet',owner:account.address,baseAddress:account.address},config={relayerUrl:'https://relayer',nearRpcUrl:'https://near',near:{factory:'factory.testnet'}},hash='1'.repeat(44),sender='relayer.testnet'
 const message=JSON.stringify({protocol:'cmdk-vault/1',network:'testnet',vault:vault.accountId,nonce:4,expiry:2000000000,method:'revoke_agent',args:{}}),signature=await account.signMessage({message}),record=ownerPendingRecord(message)
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64')
 const fetcher=async url=>url.endsWith('/health')?Response.json({chain_id:84532,near_network:'testnet',factory:config.near.factory,sender}):Response.json({result:{transaction:{hash,receiver_id:vault.accountId,signer_id:sender,actions:[{FunctionCall:{method_name:'owner_call',args:encode({message,signature})}}]},status:{SuccessValue:encode([])}}})
 const job={vault:vault.accountId,near_tx:hash,stage:'done',base_sent:[]}
 assert.deepEqual(await verifyOwnerJob(config,vault,record,job,fetcher),[])
 await assert.rejects(verifyOwnerJob(config,vault,record,{...job,base_sent:['0x'+'aa'.repeat(32)]},fetcher),/Base hashes/)
 await assert.rejects(verifyOwnerJob(config,vault,record,{...job,vault:'other.testnet'},fetcher),/matching NEAR/)
})
import {assertFreshOwnerIntent} from './owner-recovery.ts'
test('owner state is checked again after signing before creating a pending request',async()=>{
 const vault={accountId:'v3.factory.testnet',owner:account.address},config={nearRpcUrl:'https://near'},message=JSON.stringify({vault:vault.accountId,nonce:4,expiry:2000000000})
 const rpc=nonce=>async()=>Response.json({result:{result:[...new TextEncoder().encode(JSON.stringify({owner:account.address,owner_nonce:nonce}))]}})
 await assertFreshOwnerIntent(config,vault,message,rpc(3))
 await assert.rejects(assertFreshOwnerIntent(config,vault,message,rpc(4)),/changed while signing/)
})
