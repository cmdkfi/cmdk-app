import test from 'node:test'
import assert from 'node:assert/strict'
import {fundingIntent} from './vault-funding.ts'
const market={id:'0x'+'12'.repeat(32),agentTarget:500000000000000000n,agentTrigger:700000000000000000n,liquidationLtv:860000000000000000n}
test('free vault funding uses exact raw amounts and stored Target for each protocol method',()=>{
 assert.deepEqual(fundingIntent(market,'collateral',1000000000000000n),{method:'open',args:{market:market.id,collateral_in:'1000000000000000',target_ltv:'500000000000000000'}})
 assert.deepEqual(fundingIntent(market,'loan',1000000n),{method:'open_from_stables',args:{market:market.id,stables_in:'1000000',target_ltv:'500000000000000000'}})
 for(const altered of [{...market,agentTarget:null},{...market,agentTarget:800000000000000000n},{...market,readOnly:true},{...market,policyUnavailable:true},{...market,priceUnavailable:true}])assert.throws(()=>fundingIntent(altered,'loan',1n))
 assert.throws(()=>fundingIntent(market,'collateral',0n))
})
