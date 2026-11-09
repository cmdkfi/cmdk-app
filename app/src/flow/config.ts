// The app configuration: exactly the config.json that scripts/generate-config.mjs writes (deployment manifest +
// config.app.json, validated there by scripts/guided-values.mjs). Parsed and checked here; fetched by the adapter.
import { parseDecimal } from './amount.ts'

type Hex = `0x${string}`
export type HelpLink = { label: string; url: string; note: string }
export type AddChainParams = { chainId: string; chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] }
export type Corridor = { floor: number; target: number; act: number; budget: number; migrate: boolean; exit: boolean }
export type Measurement = { mrtd: string; rtmr0: string; rtmr1: string; rtmr2: string; compose_hash: string; os_image_hash: string }
export type PolicyMarket = { id: Hex; loan_token: Hex; collateral_token: Hex; executor: Hex; slice_max: string }

/** config.json as generate-config.mjs writes it today. */
export type AppConfig = {
  guided: { corridor: Corridor; minDepositEth: string; messageExpirySecs: number; walletTxGasLimit: number; usdcDust: string; firstVaultNumber: number }
  network: AddChainParams
  help: { metamaskInstall: string; connectingToBase: string; nearblocks: string; ethFaucets: HelpLink[]; usdcFaucets: HelpLink[] }
  base: { morpho: Hex; weth: Hex; usdc: Hex; gasPriceOracle: Hex; executorDeployBlock: number }
  baseChainId: number
  nearNetwork: string
  nearRpcUrl: string
  baseRpcUrl: string
  relayerUrl: string
  relayerUrlFallback: string
  near: { factory: string }
  marketLabels: Record<string, string>
  agent: { measurement: Measurement; version: string | null; sourceCommit: string | null }
  createVault: { cooldownSecs: number; depositNear: string; markets: PolicyMarket[] }
}

/** Typed values derived once from the config. */
export type Guided = {
  corridor: Corridor
  minDepositText: string
  minDepositWei: bigint
  messageExpirySecs: number
  walletTxGasLimit: bigint
  usdcDust: bigint
  firstVaultNumber: number
  cooldownSecs: number
  network: AddChainParams
  help: AppConfig['help']
  base: AppConfig['base']
  liveMarket: PolicyMarket
}

export type LoadedConfig = { config: AppConfig; guided: Guided }

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const ID = /^0x[0-9a-fA-F]{64}$/
const HTTPS = /^https:\/\/\S+$/
const HEX = { mrtd: 96, rtmr0: 96, rtmr1: 96, rtmr2: 96, compose_hash: 64, os_image_hash: 64 } as const

function fail(reason: string): never {
  throw new Error(`The app configuration is not usable: ${reason}.`)
}

/** Validates config.json and derives the typed values; any missing or malformed field refuses the whole config. */
export function parseConfig(value: unknown): LoadedConfig {
  if (!value || typeof value !== 'object') fail('not an object')
  const c = value as AppConfig
  if (c.baseChainId !== 84532 || c.nearNetwork !== 'testnet') fail('not the supported testnet')
  for (const [key, url] of [['nearRpcUrl', c.nearRpcUrl], ['baseRpcUrl', c.baseRpcUrl], ['relayerUrl', c.relayerUrl]] as const) if (typeof url !== 'string' || !HTTPS.test(url)) fail(`${key} must be https`)
  if (typeof c.relayerUrlFallback !== 'string' || (c.relayerUrlFallback !== '' && !HTTPS.test(c.relayerUrlFallback))) fail('relayerUrlFallback must be https or empty')
  if (!c.near || typeof c.near.factory !== 'string' || !/^[a-z0-9._-]+$/.test(c.near.factory)) fail('no published NEAR factory')
  const m = c.agent?.measurement
  if (!m || !Object.entries(HEX).every(([key, len]) => new RegExp(`^[0-9a-f]{${len}}$`).test((m as Record<string, string>)[key] ?? ''))) fail('no published agent measurement')
  const cv = c.createVault
  if (!cv || !Number.isInteger(cv.cooldownSecs) || typeof cv.depositNear !== 'string' || !Array.isArray(cv.markets) || cv.markets.length < 1
    || cv.markets.some(x => !ID.test(x.id) || ![x.loan_token, x.collateral_token, x.executor].every(a => ADDRESS.test(a)) || !/^\d+$/.test(x.slice_max))) fail('no vault policy')
  const g = c.guided
  if (!g || !g.corridor || typeof g.minDepositEth !== 'string' || !Number.isInteger(g.messageExpirySecs) || !Number.isInteger(g.walletTxGasLimit) || !/^\d+$/.test(g.usdcDust ?? '') || !Number.isInteger(g.firstVaultNumber) || g.firstVaultNumber < 1) fail('no guided block')
  if (!c.base || ![c.base.morpho, c.base.weth, c.base.usdc, c.base.gasPriceOracle].every(a => ADDRESS.test(a ?? '')) || !Number.isInteger(c.base.executorDeployBlock)) fail('no Base addresses')
  if (!c.network || c.network.chainId !== '0x14a34' || !c.network.rpcUrls?.every(u => HTTPS.test(u)) || !c.network.blockExplorerUrls?.every(u => HTTPS.test(u))) fail('no Base Sepolia network entry')
  if (!c.help || ![c.help.metamaskInstall, c.help.connectingToBase, c.help.nearblocks, ...(c.help.ethFaucets ?? []).map(l => l.url), ...(c.help.usdcFaucets ?? []).map(l => l.url)].every(u => HTTPS.test(u ?? ''))) fail('help links must be https')
  const minDepositWei = parseDecimal(g.minDepositEth, 18)
  if (minDepositWei === null) fail('invalid minimum deposit')
  return {
    config: c,
    guided: {
      corridor: g.corridor,
      minDepositText: g.minDepositEth,
      minDepositWei,
      messageExpirySecs: g.messageExpirySecs,
      walletTxGasLimit: BigInt(g.walletTxGasLimit),
      usdcDust: BigInt(g.usdcDust),
      firstVaultNumber: g.firstVaultNumber,
      cooldownSecs: cv.cooldownSecs,
      network: c.network,
      help: c.help,
      base: c.base,
      liveMarket: cv.markets[0],
    },
  }
}
