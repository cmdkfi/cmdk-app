import {test} from 'node:test'
import assert from 'node:assert/strict'
import {positionTableRead} from './position-table-state.ts'
test('failed position refresh keeps the last complete snapshot only for the exact owner/vault source, then recovers',()=>{
 const fresh=positionTableRead(null,'alice:v1',[{debt:'1'}],[],100)
 const stale=positionTableRead(fresh,'alice:v1',[],['RPC unavailable'],200)
 assert.deepEqual(stale.rows,fresh.rows);assert.equal(stale.time,100);assert.equal(stale.staleSnapshot,true)
 assert.deepEqual(positionTableRead(fresh,'bob:v1',[],['RPC unavailable'],200).rows,[])
 const recovered=positionTableRead(stale,'alice:v1',[{debt:'2'}],[],300)
 assert.equal(recovered.staleSnapshot,false);assert.equal(recovered.time,300);assert.deepEqual(recovered.rows,[{debt:'2'}])
})
