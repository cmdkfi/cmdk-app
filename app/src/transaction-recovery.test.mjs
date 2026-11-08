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

import { encodeEventTopics, encodeAbiParameters, parseAbi } from 'viem'
import {validateDepositReceipt} from './transaction-recovery.ts'
const id='0x'+'ab'.repeat(32)
const eventAbi=parseAbi(['event SupplyCollateral(bytes32 indexed id,address indexed caller,address indexed onBehalf,uint256 assets)'])
const log={address:market.morpho,topics:encodeEventTopics({abi:eventAbi,eventName:'SupplyCollateral',args:{id,caller:owner,onBehalf:vault}}),data:encodeAbiParameters([{type:'uint256'}],[1000000000000000n])}
test('delegated wallet recovery checks the actual Morpho caller, vault, market and amount',()=>{
 const m={...market,id}
 assert.doesNotThrow(()=>validateDepositReceipt([log],{},owner,vault,m))
 assert.doesNotThrow(()=>validateDepositReceipt([log],{to:market.morpho,data},owner,vault,m))
 for(const logs of [[],[{...log,address:vault}],[log,log]]) assert.throws(()=>validateDepositReceipt(logs,{},owner,vault,m))
 assert.throws(()=>validateDepositReceipt([log],{},vault,vault,m))
 assert.throws(()=>validateDepositReceipt([log],{},owner,owner,m))
 assert.throws(()=>validateDepositReceipt([log],{},owner,vault,{...m,id:'0x'+'cd'.repeat(32)}))
 assert.throws(()=>validateDepositReceipt([log],{kind:'owner'},owner,vault,m))
 assert.throws(()=>validateDepositReceipt([{...log,data:encodeAbiParameters([{type:'uint256'}],[1n])}],{to:market.morpho,data},owner,vault,m))
})
