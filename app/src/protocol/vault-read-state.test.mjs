import test from 'node:test'
import assert from 'node:assert/strict'
import {failedVaultRead} from './vault-read-state.ts'
test('temporary vault-wide read failure retains the last observed snapshot only for the same owner/vault key',()=>{
 const position={readAt:100,markets:[{id:'known-market'}]},previous={key:'v1:owner-a',position}
 assert.equal(failedVaultRead(previous,'v1:owner-a','RPC unavailable').position,position)
 assert.equal(failedVaultRead(previous,'v2:owner-a','RPC unavailable').position,undefined)
 assert.equal(failedVaultRead(previous,'v1:owner-b','RPC unavailable').position,undefined)
 assert.equal(failedVaultRead(null,'v1:owner-a','RPC unavailable').error,'RPC unavailable')
})
