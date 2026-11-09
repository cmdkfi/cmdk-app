import test from 'node:test'
import assert from 'node:assert/strict'
import {readNearSecurity} from './near-security.ts'
const vault={accountId:'v3.factory.testnet'},config={nearRpcUrl:'https://rpc.testnet.near.org',near:{factory:'factory.testnet'}}
const key={public_key:'agent',access_key:{permission:{FunctionCall:{receiver_id:vault.accountId,method_names:['reduce','migrate','exit'],allowance:'1'}}}}
function rpc(keys,hash='code') {return async (_url,options)=>{
 const {params}=JSON.parse(options.body)
 const result=params.request_type==='view_account'?{code_hash:'111',global_contract_hash:hash,amount:'1'}:params.request_type==='view_access_key_list'?{keys}:{result:[...new TextEncoder().encode(JSON.stringify({code_hash:'code'}))]}
 return Response.json({result})
}}
test('NEAR security checks global code identity and exact agent-key permissions',async()=>{
 const good=await readNearSecurity(config,vault,'agent',rpc([key]))
 assert.equal(good.restricted,true);assert.equal(good.codeMatches,true)
 for(const keys of [[],[key,key],[{...key,access_key:{permission:'FullAccess'}}],[{...key,access_key:{permission:{FunctionCall:{...key.access_key.permission.FunctionCall,method_names:[]}}}}]]) assert.equal((await readNearSecurity(config,vault,'agent',rpc(keys))).restricted,false)
 assert.equal((await readNearSecurity(config,vault,'another',rpc([key]))).restricted,false)
 assert.equal((await readNearSecurity(config,vault,'agent',rpc([key],'other'))).codeMatches,false)
})
