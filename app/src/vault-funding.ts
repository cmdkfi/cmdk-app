import type {MarketPosition} from './positions.ts'
export function fundingIntent(market:MarketPosition,source:'collateral'|'loan',amount:bigint) {
 if(amount<=0n||market.readOnly||market.policyUnavailable||market.priceUnavailable||market.agentTarget===null||market.agentTrigger===null||market.agentTarget>market.agentTrigger||market.agentTarget>=market.liquidationLtv)throw Error('Fresh supported market, oracle and risk corridor are required.')
 const target=market.agentTarget.toString()
 return source==='collateral'?{method:'open' as const,args:{market:market.id,collateral_in:amount.toString(),target_ltv:target}}:{method:'open_from_stables' as const,args:{market:market.id,stables_in:amount.toString(),target_ltv:target}}
}
