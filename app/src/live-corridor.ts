import type { Hex } from 'viem'
import type { DemoRules } from './demo.ts'
import { validRules } from './demo.ts'
import type { AppConfig } from './near.ts'
import { SetupError } from './vault-setup.ts'

export const WAD = 10n ** 18n
const percent = (value: number) => BigInt(Math.round(value * 10)) * 10n ** 15n
export function corridorFromChain(value: readonly [bigint, bigint, bigint, bigint, boolean, boolean, boolean]): DemoRules {
  if (!value[6]) throw new SetupError('This market has no stored corridor.')
  return { target: Number(value[0]) / 1e16, act: Number(value[1]) / 1e16, floor: Number(value[2]) / 1e16, budget: Number(value[3]) / 1e16, migrate: value[4], exit: value[5] }
}

export function corridorMessage(vault: string, nonce: number, expiry: number, config: AppConfig, market: Hex, rules: DemoRules): string {
  if (!config.near.factory || !/^v[1-9][0-9]*$/.test(vault.split('.')[0]) || vault.slice(vault.indexOf('.') + 1) !== config.near.factory) throw new SetupError('Select a vault from the published factory.')
  if (!config.createVault?.markets.some(item => item.id.toLowerCase() === market.toLowerCase())) throw new SetupError('The market is not in the published deployment.')
  if (!Number.isSafeInteger(nonce) || nonce < 1 || !Number.isSafeInteger(expiry) || !validRules(rules) || ![rules.floor, rules.target, rules.act, rules.budget].every(value => Number.isFinite(value) && Math.round(value * 10) === value * 10)) throw new SetupError('The corridor needs valid one-decimal percentages.')
  const args = { market, target: percent(rules.target).toString(), act: percent(rules.act).toString(), floor: percent(rules.floor).toString(), sell_budget: percent(rules.budget).toString(), migrate_allowed: rules.migrate, exit_allowed: rules.exit }
  return JSON.stringify({ protocol: 'cmdk-vault/1', network: 'testnet', vault, method: 'set_corridor', args, nonce, expiry })
}
