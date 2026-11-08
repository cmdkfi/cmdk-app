import type {MarketPosition} from './positions.ts'

export function marketTitle(market:Pick<MarketPosition,'collateralSymbol'|'loanSymbol'|'label'>) {
  return `Morpho · ${market.collateralSymbol}/${market.loanSymbol}${market.label==='backup'?' · backup':''}`
}
export function hasPosition(market:Pick<MarketPosition,'collateral'|'debt'|'borrowShares'>) {
  return market.collateral>0n||market.debt>0n||(market.borrowShares??0n)>0n
}
export function sharedVisibleRules(live:MarketPosition,backup:MarketPosition) {
  if(live.policyUnavailable||backup.policyUnavailable)return false
  if(live.agentTarget===null&&live.agentTrigger===null&&backup.agentTarget===null&&backup.agentTrigger===null)return true
  return live.agentTarget!==null&&backup.agentTarget!==null&&live.agentTrigger!==null&&backup.agentTrigger!==null&&live.dailyBudget!=null&&backup.dailyBudget!=null&&live.agentTarget===backup.agentTarget&&live.agentTrigger===backup.agentTrigger&&live.dailyBudget===backup.dailyBudget
}
