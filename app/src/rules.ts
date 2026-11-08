import {parseUnits} from 'viem'
export type Corridor = readonly [bigint,bigint,bigint,bigint,boolean,boolean,boolean]
export function editedCorridor(current:Corridor, values:string[], lltv:bigint){
 if(values.length!==3)throw Error('Three rule values are required.')
 const [target,act,budget]=values.map(value=>{if(!/^\d+(\.\d)?$/.test(value))throw Error('Use percentages with at most one decimal.');return parseUnits(value,16)})
 if(!current[6]||!(current[2]<target&&target+1000000000000000n<act&&act<lltv&&budget<=10n**18n))throw Error('Require Floor < Target; Target + 0.1 percentage points < Trigger < Liquidation; Budget ≤ 100.0%.')
 return {target:target.toString(),act:act.toString(),floor:current[2].toString(),sell_budget:budget.toString(),migrate_allowed:current[4],exit_allowed:current[5]}
}

export type RuleMarket = {id:`0x${string}`;liquidationLtv:bigint}
export function ruleUpdates(markets:{market:RuleMarket;current:Corridor}[],values:string[]) {
 return markets.flatMap(({market,current})=>{
  const edited=editedCorridor(current,values,market.liquidationLtv)
  if(edited.target===current[0].toString()&&edited.act===current[1].toString()&&edited.sell_budget===current[3].toString())return []
  return [{market:market.id,...edited}]
 })
}
export function rulesIntent(updates:ReturnType<typeof ruleUpdates>) {
 if(!updates.length)throw Error('No changes. Current rules are already stored on Base.')
 if(updates.length===1)return {method:'set_corridor' as const,args:updates[0]}
 return {method:'setup' as const,args:{markets:updates.map(({market,...corridor})=>({market,approve:false,authorize:false,corridor})),measurement:null}}
}
