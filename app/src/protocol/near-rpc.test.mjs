import test from 'node:test'
import assert from 'node:assert/strict'
import {nearQuery} from './near-rpc.ts'
test('concurrent identical reads share a request, but later preflights read fresh state',async()=>{
 let calls=0
 const fetcher=async()=>{calls++;await Promise.resolve();return Response.json({result:{value:calls}})}
 const params={request_type:'view_account',account_id:'v3.testnet',finality:'final'}
 const [a,b]=await Promise.all([nearQuery('https://rpc',params,fetcher),nearQuery('https://rpc',params,fetcher)])
 assert.equal(calls,1);assert.deepEqual(a,b)
 assert.deepEqual(await nearQuery('https://rpc',params,fetcher),{value:2})
})
test('HTTP 429 respects Retry-After without issuing repeated requests',async()=>{
 let calls=0
 const fetcher=async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'120'}})}
 await assert.rejects(nearQuery('https://limited',{},fetcher),/rate limited/)
 await assert.rejects(nearQuery('https://limited',{},fetcher),/Retry after/)
 assert.equal(calls,1)
})

test('unavailable Retry-After uses a conservative cooldown instead of hammering an opaque rate limit',async()=>{
 const before=Date.now()
 await assert.rejects(nearQuery('https://no-exposed-retry',{},async()=>new Response('',{status:429})),error=>error.retryAt>=before+59000&&error.retryable===true)
})
