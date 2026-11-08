import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData } from 'viem'
import { morphoActions, params, erc20 } from './live-actions.ts'
import { validateRecovery } from './transaction-recovery.ts'
const owner='0x1111111111111111111111111111111111111111', vault='0x2222222222222222222222222222222222222222'
const market={morpho:'0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',loanToken:owner,collateralToken:vault,oracle:owner,irm:vault,liquidationLtv:860000000000000000n}
const data=encodeFunctionData({abi:morphoActions,functionName:'supplyCollateral',args:[params(market),1000000000000000n,vault,'0x']})
const tx={from:owner,to:market.morpho,input:data,value:0n}
test('legacy recovery accepts the identified owner deposit for the selected vault and market',()=>{
 assert.doesNotThrow(()=>validateRecovery(tx,{pending:true},owner,vault,market))
 for(const altered of [{...tx,from:vault},{...tx,to:vault},{...tx,value:1n},{...tx,input:encodeFunctionData({abi:erc20,functionName:'approve',args:[market.morpho,1n]})}]) assert.throws(()=>validateRecovery(altered,{pending:true},owner,vault,market))
 assert.throws(()=>validateRecovery(tx,{},owner,owner,market))
 assert.throws(()=>validateRecovery(tx,{},owner,vault,{...market,oracle:vault}))
 assert.throws(()=>validateRecovery(tx,{kind:'owner'},owner,vault,market))
 assert.throws(()=>validateRecovery(tx,{job:'unresolved'},owner,vault,market))
})
test('new pending actions require exact target, calldata, native value and sender',()=>{
 const record={pending:true,to:tx.to,data,value:'0'}
 assert.doesNotThrow(()=>validateRecovery(tx,record,owner,vault,market))
 for(const altered of [{...tx,from:vault},{...tx,to:vault},{...tx,input:'0x'},{...tx,value:1n}]) assert.throws(()=>validateRecovery(altered,record,owner,vault,market))
})
