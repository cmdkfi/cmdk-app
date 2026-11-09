import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {privateKeyToAccount} from 'viem/accounts'
import {encodeFunctionData,parseAbi,keccak256} from 'viem'
import {evidenceIndex,transcriptIndex,verifiedFile,readTranscript,snapshotIssue,transcriptSummary,attemptedProposals,readBootFile,measurementMatches,verifyAgentExecution} from './agent-evidence.ts'
const boot='boot-1793948092-abcdef12',vault={accountId:'v1.factory.testnet',owner:'0x'+'11'.repeat(20),baseAddress:privateKeyToAccount('0x'+'22'.repeat(32)).address}
const signal=()=>new AbortController().signal
const meta=(name,text)=>({name,bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')})
const data=(loop=1)=>({agent:{boot,public_key:'ed25519:'+'2'.repeat(44)},vault:{id:vault.accountId},network:'Base Sepolia',twin:false,loop,time_utc:'2026-11-08T12:00:00Z',inputs:{snapshot:{timestamp:1794139200,block:100,user:vault.baseAddress,read_errors:[],rpc_disagree:[],rpc_second_error:null}},decisions:[]})
const row=(loop,text)=>({...meta(`${boot}-v1-${String(loop).padStart(4,'0')}.json`,text),boot,vault:'v1',twin:false,loop})
test('boot file allowlist excludes unrelated vaults and traversal; transcript metadata must agree with its filename',()=>{
 const files=['info.json','registration-v1.json','registration-v2.json','reregistration-v1-12.json','../tdx_quote.hex'].map(name=>meta(name,'{}'))
 assert.deepEqual(evidenceIndex({boot,files},vault.accountId).files.map(f=>f.name),['info.json','registration-v1.json','reregistration-v1-12.json'])
 const first=row(1,'{}'),last=row(12,'{}')
 assert.deepEqual(transcriptIndex({boot,transcripts:[first,last]},vault.accountId).rows.map(r=>r.loop),[12,1])
 assert.throws(()=>transcriptIndex({boot,transcripts:[{...first,twin:true}]},vault.accountId),/disagree/)
 assert.throws(()=>evidenceIndex({boot,files:[files[0],files[0]]},vault.accountId),/Duplicate/)
})
test('SHA and byte count gate transcript identity before any telemetry is accepted',async()=>{
 const text=JSON.stringify(data()),r=row(1,text)
 const fetcher=async()=>new Response(text)
 const verified=await readTranscript('https://agent',r,vault,signal(),fetcher)
 assert.equal(snapshotIssue(verified),null)
 await assert.rejects(verifiedFile('https://agent',r,signal(),async()=>new Response(text+'x')),/SHA-256/)
 const wrong=JSON.stringify({...data(),vault:{id:'v2.factory.testnet'}})
 await assert.rejects(readTranscript('https://agent',row(1,wrong),vault,signal(),async()=>new Response(wrong)),/another vault/)
 await assert.rejects(verifiedFile('https://agent',{...r,bytes:r.bytes+1},signal(),fetcher),/bytes/)
})
test('snapshot errors do not become healthy timestamps; top-level and nested sent proposals are observed, not confirmed',()=>{
 const older={row:row(1,''),data:data(1)},newer={row:row(2,''),data:data(2)}
 newer.data.inputs.snapshot.rpc_second_error='secondary timeout';older.data.proposal={method:'reduce',sent:true,near_tx:'1'.repeat(44)}
 assert.match(snapshotIssue(newer),/secondary timeout/)
 assert.equal(transcriptSummary([newer,older]).successful,older)
 assert.equal(transcriptSummary([newer,older]).attempt,older)
 newer.data.decisions=[{proposal:{method:'exit',near_error:'NEAR refused'}}]
 assert.equal(attemptedProposals(newer).length,1)
 newer.data.decisions=[{proposal:{sent:false,proposed:true}}];assert.equal(attemptedProposals(newer).length,0)
 delete newer.data.inputs.snapshot.rpc_second_error;assert.match(snapshotIssue(newer),/incomplete/)
})
test('boot rollover invalidates a hash-correct evidence file; hash equality is not measurement authentication',async()=>{
 const text='{"tcb_info":{}}',r=meta('info.json',text),index={boot,files:[r]}
 await assert.rejects(readBootFile('https://agent',index,r,vault,signal(),async url=>new Response(url.endsWith('/agent/')?JSON.stringify({boot:'boot-1793948093-abcdef12',files:[r]}):text)),/boot or file changed/)
 const approved=Object.fromEntries(['mrtd','rtmr0','rtmr1','rtmr2','compose_hash','os_image_hash'].map((k,i)=>[k,'ab'.repeat(i<4?48:32)]))
 assert.equal(measurementMatches({...approved},approved),true)
 assert.equal(measurementMatches({...approved,rtmr0:'00'},approved),false)
 assert.equal(measurementMatches({},undefined),false)
})
async function execution(){
 const base=privateKeyToAccount('0x'+'22'.repeat(32)),to='0x'+'44'.repeat(20),market='0x'+'aa'.repeat(32),near='1'.repeat(44)
 const raw=await base.signTransaction({chainId:84532,type:'eip1559',to,nonce:8,value:0n,data:encodeFunctionData({abi:parseAbi(['function reduce(bytes32,uint256,uint256)']),functionName:'reduce',args:[market,100n,2000000000n]}),gas:300000n,maxFeePerGas:1000000000n,maxPriorityFeePerGas:1n})
 const hash=keccak256(raw),signed={raw,hash,from:base.address,nonce:8},tr={row:row(1,''),data:data()},proposal={sent:true,method:'reduce',args:{market,amount:'100'},near_tx:near,base:{hash,status:1}}
 const callArgs=Buffer.from(JSON.stringify({...proposal.args,tx:{}})).toString('base64')
 const nearResult={final_execution_status:'FINAL',receipts_outcome:[{outcome:{status:{SuccessValue:''}}}],transaction:{hash:near,receiver_id:vault.accountId,signer_id:vault.accountId,public_key:tr.data.agent.public_key,actions:[{FunctionCall:{method_name:'reduce',args:callArgs}}]},status:{SuccessValue:Buffer.from(JSON.stringify([signed])).toString('base64')}}
 const receipt={transactionHash:hash,from:base.address,to,blockNumber:'0x63',blockHash:'0x'+'77'.repeat(32),status:'0x1'}
 const calls=[],state={nearResult,receipt,chain:'0x14a34',head:'0x64'}
 const fetcher=async(_url,options)=>{const req=JSON.parse(options.body);calls.push(req.method);return Response.json({result:req.method==='tx'?state.nearResult:req.method==='eth_chainId'?state.chain:req.method==='eth_blockNumber'?state.head:state.receipt})}
 return{tr,proposal,state,calls,fetcher,config:{nearRpcUrl:'https://near',baseRpcUrl:'https://base'}}
}
test('execution verification binds NEAR method, agent key, args and signed Base hash before checking real receipt status',async()=>{
 const x=await execution();assert.deepEqual(await verifyAgentExecution(x.config,vault,x.tr,x.proposal,signal(),x.fetcher),{near:'confirmed',base:'confirmed',hash:x.proposal.base.hash})
 x.state.receipt.status='0x0';assert.equal((await verifyAgentExecution(x.config,vault,x.tr,x.proposal,signal(),x.fetcher)).base,'reverted')
 x.state.head='0x63';assert.equal((await verifyAgentExecution(x.config,vault,x.tr,x.proposal,signal(),x.fetcher)).base,'pending')
 assert(x.calls.every(method=>['tx','eth_chainId','eth_getTransactionReceipt','eth_blockNumber'].includes(method)))
})
test('unrelated NEAR receipt, mismatched args, wrong Base chain and receipt identity never produce confirmation',async()=>{
 const x=await execution();x.state.nearResult.transaction.public_key='ed25519:other'
 await assert.rejects(verifyAgentExecution(x.config,vault,x.tr,x.proposal,signal(),x.fetcher),/agent key/)
 x.state.nearResult.transaction.public_key=x.tr.data.agent.public_key
 await assert.rejects(verifyAgentExecution(x.config,vault,x.tr,{...x.proposal,args:{...x.proposal.args,amount:'101'}},signal(),x.fetcher),/arguments/)
 x.state.nearResult.final_execution_status='EXECUTED_OPTIMISTIC';await assert.rejects(verifyAgentExecution(x.config,vault,x.tr,x.proposal,signal(),x.fetcher),/finality/);x.state.nearResult.final_execution_status='FINAL'
 x.state.chain='0x1';await assert.rejects(verifyAgentExecution(x.config,vault,x.tr,x.proposal,signal(),x.fetcher),/not Base Sepolia/)
 x.state.chain='0x14a34';x.state.receipt.transactionHash='0x'+'99'.repeat(32)
 await assert.rejects(verifyAgentExecution(x.config,vault,x.tr,x.proposal,signal(),x.fetcher),/does not match/)
})
test('NEAR revert and absent Base receipt remain separate from a reported sent flag',async()=>{
 const x=await execution();x.state.nearResult.status={Failure:{error:'revert'}}
 assert.deepEqual(await verifyAgentExecution(x.config,vault,x.tr,x.proposal,signal(),x.fetcher),{near:'reverted',base:'unavailable'})
 const y=await execution();y.state.receipt=null
 assert.equal((await verifyAgentExecution(y.config,vault,y.tr,y.proposal,signal(),y.fetcher)).base,'pending')
})
