import test from 'node:test'
import assert from 'node:assert/strict'
import {marketTitle,hasPosition,sharedVisibleRules} from './vault-layout.ts'
const live={label:'live',collateralSymbol:'WETH',loanSymbol:'USDC',agentTarget:500000000000000000n,agentTrigger:700000000000000000n,dailyBudget:200000000000000000n}
test('Q14 names distinguish the migration destination without reversing the token pair',()=>{
 assert.equal(marketTitle(live),'Morpho · WETH/USDC')
 assert.equal(marketTitle({...live,label:'backup'}),'Morpho · WETH/USDC · backup')
})
test('shared-rule default reflects actual values; new unconfigured markets default to shared',()=>{
 assert.equal(sharedVisibleRules(live,{...live,label:'backup'}),true)
 assert.equal(sharedVisibleRules(live,{...live,agentTarget:550000000000000000n}),false)
 assert.equal(sharedVisibleRules(live,{...live,policyUnavailable:true}),false)
 const unconfigured={...live,agentTarget:null,agentTrigger:null,dailyBudget:null}
 assert.equal(sharedVisibleRules(unconfigured,unconfigured),true)
 assert.equal(sharedVisibleRules(live,unconfigured),false)
})
test('backup stays a compact row only while collateral, debt and borrow shares are all zero',()=>{
 assert.equal(hasPosition({collateral:0n,debt:0n,borrowShares:0n}),false)
 for(const position of [{collateral:1n,debt:0n},{collateral:0n,debt:1n},{collateral:0n,debt:0n,borrowShares:1n}])assert.equal(hasPosition(position),true)
})
