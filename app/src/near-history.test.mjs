import test from 'node:test'
import assert from 'node:assert/strict'
import {parseNearHistory} from './near-history.ts'
const account='v3.factory.testnet'
const row={transaction_hash:'9BxsADB2HygMmkFWVg6GWBPgZCeMJFmZvTWa37BkDHrW',signer_account_id:'relayer.testnet',receiver_account_id:account,block_timestamp:'1794122332596048490',actions:[{action:'FUNCTION_CALL',method:'owner_call'}],outcomes:{status:true}}
test('NearBlocks v3 opaque cursor is preserved and terminal page needs no metadata',()=>{assert.deepEqual(parseNearHistory({data:[row],meta:{next_page:'opaque=='}},account),{rows:[row],next:'opaque=='});assert.equal(parseNearHistory({data:[]},account).next,null)})
test('unrelated vaults and malformed records cannot enter the history',()=>{for(const altered of [{...row,receiver_account_id:'other.testnet'},{...row,transaction_hash:'invalid'},{...row,block_timestamp:'bad'},{...row,actions:[{}]}])assert.throws(()=>parseNearHistory({data:[altered]},account));assert.throws(()=>parseNearHistory({data:[],meta:{next_page:123}},account))})
