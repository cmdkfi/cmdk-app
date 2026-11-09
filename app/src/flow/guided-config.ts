// Typed view of the guided-flow blocks that scripts/generate-config.mjs adds to config.json.
// loadConfig (protocol/near.ts, unchanged) returns the whole JSON object, so these keys pass through.
import type { Address, Hex } from 'viem'
import type { AppConfig } from '../protocol/near.ts'
import type { InitialRules } from '../protocol/initial-rules.ts'
import { parseAmount } from '../protocol/live-actions.ts'

export type HelpLink = { label: string; url: string; note: string }
export type AddChainParams = {
  chainId: string
  chainName: string
  rpcUrls: string[]
  nativeCurrency: { name: string; symbol: string; decimals: number }
  blockExplorerUrls: string[]
}
export type Guided = {
  corridor: InitialRules
  minDepositText: string
  minDepositWei: bigint
  messageExpirySecs: number
  walletTxGasLimit: bigint
  usdcDust: bigint
  /** Vaults numbered below this belong to the previous app and are ignored (PRD D4, R8). */
  firstVaultNumber: number
  cooldownSecs: number
  network: AddChainParams
  help: { metamaskInstall: string; connectingToBase: string; ethFaucets: HelpLink[]; usdcFaucets: HelpLink[] }
  base: { morpho: Address; weth: Address; usdc: Address; gasPriceOracle: Address; executorDeployBlock: number }
  liveMarket: { id: Hex; executor: Address }
}

type Raw = {
  guided?: { corridor: InitialRules; minDepositEth: string; messageExpirySecs: number; walletTxGasLimit: number; usdcDust: string; firstVaultNumber: number } | null
  network?: AddChainParams | null
  help?: Guided['help'] | null
  base?: Guided['base'] | null
}

export function readGuided(config: AppConfig): Guided {
  const raw = config as AppConfig & Raw
  const live = config.createVault?.markets[0]
  if (!raw.guided || !raw.network || !raw.help || !raw.base || !live) throw new Error('The app configuration has no published deployment for the guided flow.')
  return {
    corridor: raw.guided.corridor,
    minDepositText: raw.guided.minDepositEth,
    minDepositWei: parseAmount(raw.guided.minDepositEth, 18),
    messageExpirySecs: raw.guided.messageExpirySecs,
    walletTxGasLimit: BigInt(raw.guided.walletTxGasLimit),
    usdcDust: BigInt(raw.guided.usdcDust),
    firstVaultNumber: raw.guided.firstVaultNumber,
    cooldownSecs: config.createVault!.cooldownSecs,
    network: raw.network,
    help: raw.help,
    base: raw.base,
    liveMarket: { id: live.id as Hex, executor: live.executor as Address },
  }
}
