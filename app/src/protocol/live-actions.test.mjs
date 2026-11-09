import test from 'node:test'
import assert from 'node:assert/strict'
import { borrowCapacity, borrowTarget, parseAmount, preview, ownerMessage, WAD } from './live-actions.ts'
const market = {collateral:2n*10n**18n, debt:3200n*10n**6n, collateralValue:6400n*10n**6n, oraclePrice:3200n*10n**24n, agentTrigger:70n*10n**16n, liquidationLtv:86n*10n**16n, liquidity:10000n*10n**6n}
test('capacity obeys both liquidity and configured trigger, with rounding reserve', () => {
 assert.equal(borrowCapacity(market),1280n*10n**6n-2n)
 assert.equal(borrowCapacity({...market,liquidity:1n}),1n)
 assert.equal(borrowCapacity({...market,agentTrigger:null}),0n)
 assert.equal(borrowCapacity({...market,debt:5000n*10n**6n}),0n)
})
test('owner borrow target cannot cross trigger or missing policy', () => {
 assert.ok(borrowTarget(market,100n*10n**6n)<market.agentTrigger)
 assert.throws(()=>borrowTarget(market,2000n*10n**6n))
 assert.throws(()=>borrowTarget({...market,agentTrigger:null},1n))
})
test('token decimals reject scientific, negative, rounded or zero inputs', () => {
 assert.equal(parseAmount('0.000001',6),1n)
 for(const text of ['0','-1','1e3','0.0000001','NaN']) assert.throws(()=>parseAmount(text,6))
})
test('deposit changes vault collateral; repay reduces debt; free withdrawal never changes Morpho position', () => {
 assert.equal(preview(market,'Deposit',2n*10n**18n).ltv,WAD/4n)
 assert.equal(preview(market,'Repay',market.debt).debt,0n)
 assert.equal(preview(market,'Withdraw',100n).collateral,market.collateral)
 assert.equal(preview(market,'Withdraw',100n).debt,market.debt)
})
test('owner payload uses NEAR testnet with nonce replay protection', () => {
 const msg=JSON.parse(ownerMessage('v1.factory.testnet',2,1000,'withdraw',{amount:'1'}))
 assert.equal(msg.network,'testnet');assert.equal(msg.nonce,2)
 assert.throws(()=>ownerMessage('vault.near',2,1000,'close',{}))
 assert.throws(()=>ownerMessage('v1.factory.testnet',NaN,1000,'close',{}))
})
