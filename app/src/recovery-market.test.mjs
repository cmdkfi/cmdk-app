import test from 'node:test'
import assert from 'node:assert/strict'
import {encodeAbiParameters,keccak256} from 'viem'
import {readRecoveryMarket} from './recovery-market.ts'
const owner='0x'+'11'.repeat(20),base='0x'+'22'.repeat(20),morpho='0x'+'33'.repeat(20)
const params=['0x'+'44'.repeat(20),'0x'+'55'.repeat(20),'0x'+'66'.repeat(20),'0x'+'77'.repeat(20),860000000000000000n]
const id=keccak256(encodeAbiParameters([{type:'address'},{type:'address'},{type:'address'},{type:'address'},{type:'uint256'}],params))
const state={owner,base_address:base,morpho,markets:[{id}]}
const fetcher=async()=>Response.json({result:{result:[...new TextEncoder().encode(JSON.stringify(state))]}})
const calls=[]
const client={getChainId:async()=>84532,readContract:async call=>{calls.push(call.functionName);switch(call.functionName){case'position':return[0n,42n,0n];case'idToMarketParams':return params;case'symbol':return call.address===params[0]?'USDC':'WETH';case'decimals':return call.address===params[0]?6:18;case'balanceOf':return 1000000n;default:throw Error('Recovery must not read oracle/IRM or telemetry')}}}
test('recovery reads actual borrow shares and balances without oracle, interest or Executor dependencies',async()=>{
 const data=await readRecoveryMarket({nearRpcUrl:'https://near'},{accountId:'v3.factory.testnet'},owner,id,client,fetcher)
 assert.equal(data.borrowShares,42n);assert.equal(data.loan.decimals,6);assert.equal(data.collateral.decimals,18);assert.equal(data.loan.free,1000000n);assert.equal(data.base,base)
 assert.ok(!calls.includes('price'));assert.ok(!calls.includes('borrowRateView'));assert.ok(!calls.includes('corridors'))
 await assert.rejects(readRecoveryMarket({nearRpcUrl:'https://near'},{accountId:'v3.factory.testnet'},base,id,client,fetcher),/Owned vault/)
 await assert.rejects(readRecoveryMarket({nearRpcUrl:'https://near'},{accountId:'v3.factory.testnet'},owner,'0x'+'88'.repeat(32),client,fetcher),/no longer registered/)
})
