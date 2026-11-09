import {test} from 'node:test'
import assert from 'node:assert/strict'
import {emptyDiscovery,retainDiscovery,reconcileDiscovery} from './discovery-state.ts'
const a={accountId:'v1.factory.testnet',number:1,owner:'alice',marketCount:2},b={...a,accountId:'v2.factory.testnet',number:2}
const good=reconcileDiscovery(emptyDiscovery('loading','alice'),'alice','factory.testnet',{vaults:[a,b],failed:0},a.accountId,100)
test('same-owner refresh/error preserves known identities as read-only, never carries them to another owner or factory',()=>{
 const failed=retainDiscovery(good,'alice','error','offline',999)
 assert.equal(failed.stale,true);assert.deepEqual(failed.vaults,good.vaults);assert.equal(failed.checkedAt,100)
 assert.deepEqual(retainDiscovery(good,'bob','loading').vaults,[])
 assert.deepEqual(reconcileDiscovery(good,'alice','other.testnet',{vaults:[],failed:1,unreadAccounts:[a.accountId]},null,200).vaults,[])
})
test('partial scan retains only unread records, removes rechecked non-owned vaults, and full recovery clears stale state',()=>{
 const partial=reconcileDiscovery(good,'alice','factory.testnet',{vaults:[],failed:1,unreadAccounts:[b.accountId]},null,200)
 assert.deepEqual(partial.vaults,[b]);assert.equal(partial.stale,true);assert.equal(partial.checkedAt,100)
 const recovered=reconcileDiscovery(partial,'alice','factory.testnet',{vaults:[a],failed:0},null,300)
 assert.deepEqual(recovered.vaults,[a]);assert.equal(recovered.stale,false);assert.equal(recovered.checkedAt,300)
 const empty=reconcileDiscovery(recovered,'alice','factory.testnet',{vaults:[],failed:0},null,400)
 assert.deepEqual(empty.vaults,[]);assert.equal(empty.stale,false)
})
