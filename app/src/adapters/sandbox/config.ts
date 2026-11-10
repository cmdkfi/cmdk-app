// The sandbox's app configuration (PRD §8a, Phase 6b), built in memory: the product values of config.app.json through
// the same validator the build uses (scripts/guided-values.mjs), with simulated addresses and ids in place of the
// deployment manifest. Nothing is fetched, not even /config.json. The service URLs are required by the parser and are
// never contacted: no sandbox code path reads them.
import appValues from '../../../config.app.json'
import { guidedValues } from '../../../scripts/guided-values.mjs'
import { parseConfig, type LoadedConfig } from '../../flow/config.ts'

const sim = (tail: string) => `0x5a4d${tail.padStart(36, '0')}` as const
export const SIM = {
  morpho: sim('11'), weth: sim('e7'), usdc: sim('dc'), executor: sim('44'), feed: sim('69'), gasOracle: sim('0f'),
  live: `0x5a4d${'a'.repeat(60)}` as const,
  backup: `0x5a4d${'b'.repeat(60)}` as const,
}
export const SANDBOX_FACTORY = 'factory.sandbox.simulated'
export const SANDBOX_VAULT = `v10.${SANDBOX_FACTORY}`
/** The measurement the simulated vault approves; it never reaches a verification check (§8a: "Simulated (not checked)"). */
const MEASUREMENT = { mrtd: '5a'.repeat(48), rtmr0: '5a'.repeat(48), rtmr1: '5a'.repeat(48), rtmr2: '5a'.repeat(48), compose_hash: '5a'.repeat(32), os_image_hash: '5a'.repeat(32) }
const NEVER = 'https://sandbox.invalid'

export function sandboxConfig(): LoadedConfig {
  const market = (id: string) => ({ id, loan_token: SIM.usdc, collateral_token: SIM.weth, executor: SIM.executor, slice_max: '1000000000' })
  return parseConfig({
    ...guidedValues(appValues, { base: { morpho: SIM.morpho, executorDeployBlock: 30_000_000, gasPriceOracle: SIM.gasOracle, tokens: { weth: SIM.weth, usdc: SIM.usdc }, chainlink: { ethUsd: { address: SIM.feed, description: 'ETH / USD' } } } }),
    baseChainId: 84532, nearNetwork: 'testnet',
    nearRpcUrl: NEVER, nearRpcUrlFallback: NEVER, baseRpcUrl: NEVER, relayerUrl: NEVER, relayerUrlFallback: '',
    near: { factory: SANDBOX_FACTORY },
    marketLabels: { [SIM.live]: 'live', [SIM.backup]: 'backup' },
    agent: { measurement: MEASUREMENT, version: 'simulated', sourceCommit: null },
    createVault: { cooldownSecs: appValues.policy.cooldownSecs, depositNear: appValues.policy.depositNear, markets: [market(SIM.live), market(SIM.backup)] },
  })
}
