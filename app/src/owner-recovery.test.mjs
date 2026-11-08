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
