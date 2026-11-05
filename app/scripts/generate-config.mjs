import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const manifestUrl = 'https://raw.githubusercontent.com/cmdkfi/app/main/deployments/testnet.json'
const appValues = JSON.parse(await readFile(resolve(import.meta.dirname, '../config.app.json'), 'utf8'))
// This public manifest is owned by the backend repository. Fail the build if it cannot be read:
// silently shipping null or stale deployment data would disable live vault actions.
const response = await fetch(`${manifestUrl}?build=${Date.now()}`, { cache: 'no-store' })
if (!response.ok) throw new Error(`Could not read the published testnet manifest (HTTP ${response.status})`)
const deployment = await response.json()

// Deployment values must come from the published manifest, never a guessed address.
const factory = deployment?.near?.factory ?? null
const measurement = deployment?.agent?.measurement ?? null
const hashes = ['mrtd', 'rtmr0', 'rtmr1', 'rtmr2', 'compose_hash', 'os_image_hash']
// mrtd and rtmr0-2 are SHA-384 (96 hex), compose_hash and os_image_hash SHA-256 (64 hex): agent/MEASUREMENT.md §1
const hexLen = { mrtd: 96, rtmr0: 96, rtmr1: 96, rtmr2: 96, compose_hash: 64, os_image_hash: 64 }
const approvedMeasurement = measurement && hashes.every(key => new RegExp(`^[0-9a-f]{${hexLen[key]}}$`).test(measurement[key] ?? ''))
  ? Object.fromEntries(hashes.map(key => [key, measurement[key]])) : null
if (factory !== null && (typeof factory !== 'string' || !/^[a-z0-9._-]+$/.test(factory))) {
  throw new Error('Invalid NEAR factory in cmdkfi/app deployments/testnet.json')
}
const config = {
  baseChainId: deployment?.base?.chainId ?? appValues.baseChainId,
  nearNetwork: deployment?.near?.network ?? appValues.nearNetwork,
  nearRpcUrl: appValues.nearRpcUrl,
  baseRpcUrl: appValues.baseRpcUrl,
  relayerUrl: appValues.relayerUrl,
  relayerUrlFallback: appValues.relayerUrlFallback,
  near: { factory },
  agent: { measurement: approvedMeasurement, version: deployment?.agent?.version ?? null, sourceCommit: deployment?.agent?.sourceCommit ?? null },
  createVault: factory && deployment?.base?.executor && deployment?.base?.markets && deployment?.base?.tokens
    ? {
        cooldownSecs: appValues.policy.cooldownSecs,
        depositNear: appValues.policy.depositNear,
        markets: appValues.policy.markets.map(name => ({
          id: deployment.base.markets[name]?.id,
          loan_token: deployment.base.markets[name]?.loanToken,
          collateral_token: deployment.base.markets[name]?.collateralToken,
          executor: deployment.base.executor,
          slice_max: appValues.policy.sliceMax,
        })),
      }
    : null,
}
const output = resolve(root, 'app/public/config.json')
if (config.baseChainId !== 84532 || config.nearNetwork !== 'testnet') throw new Error('Deployment manifest does not match the supported testnet')
if (factory && (!config.createVault || config.createVault.markets.some(market =>
  !/^0x[0-9a-fA-F]{64}$/.test(market.id ?? '') ||
  ![market.loan_token, market.collateral_token, market.executor].every(address => /^0x[0-9a-fA-F]{40}$/.test(address ?? ''))
))) throw new Error('Published deployment manifest is incomplete for vault creation')
await mkdir(resolve(root, 'app/public'), { recursive: true })
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`)
console.log(factory ? 'Generated app config from deployment manifest' : 'Generated app config; NEAR factory deployment pending')
