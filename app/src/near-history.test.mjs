import test from 'node:test'
import assert from 'node:assert/strict'
import {parseNearHistory} from './near-history.ts'
const account='v3.factory.testnet'
const row={transaction_hash:'9BxsADB2HygMmkFWVg6GWBPgZCeMJFmZvTWa37BkDHrW',signer_account_id:'relayer.testnet',receiver_account_id:account,block_timestamp:'1794122332596048490',actions:[{action:'FUNCTION_CALL',method:'owner_call'}],outcomes:{status:true}}
test('NearBlocks v3 opaque cursor is preserved and terminal page needs no metadata',()=>{assert.deepEqual(parseNearHistory({data:[row],meta:{next_page:'opaque=='}},account),{rows:[row],next:'opaque=='});assert.equal(parseNearHistory({data:[]},account).next,null)})
test('unrelated vaults and malformed records cannot enter the history',()=>{for(const altered of [{...row,receiver_account_id:'other.testnet'},{...row,transaction_hash:'invalid'},{...row,block_timestamp:'bad'},{...row,actions:[{}]}])assert.throws(()=>parseNearHistory({data:[altered]},account));assert.throws(()=>parseNearHistory({data:[],meta:{next_page:123}},account))})
import {readNearHistoryDetails} from './near-history.ts'
test('NEAR inspection decodes the exact owner method and rejects foreign transaction identities',async()=>{
 const vault={accountId:account,baseAddress:'0x'+'22'.repeat(20)}
 const message=JSON.stringify({protocol:'cmdk-vault/1',network:'testnet',vault:account,method:'withdraw',args:{amount:'1000000000000000'},nonce:4})
 const value={result:{transaction:{hash:row.transaction_hash,receiver_id:account,signer_id:row.signer_account_id,actions:[{FunctionCall:{method_name:'owner_call',args:Buffer.from(JSON.stringify({message,signature:'public-signature'})).toString('base64')}}]},status:{SuccessValue:Buffer.from('[]').toString('base64')}}}
 const detail=await readNearHistoryDetails({nearRpcUrl:'https://near'},row,vault,async()=>Response.json(value))
 assert.equal(detail.calls[0].method,'withdraw');assert.equal(detail.calls[0].ownerNonce,4);assert.deepEqual(detail.status,{success:true});assert.deepEqual(detail.baseHashes,[])
 await assert.rejects(readNearHistoryDetails({nearRpcUrl:'https://near'},row,vault,async()=>Response.json({result:{...value.result,transaction:{...value.result.transaction,receiver_id:'other.testnet'}}})),/identity mismatch/)
})
