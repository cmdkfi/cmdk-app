import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { guidedValues } from './guided-values.mjs'

const root = resolve(import.meta.dirname, '../..')
const source = resolve(root, 'deployments/testnet.json')
const appValues = JSON.parse(await readFile(resolve(import.meta.dirname, '../config.app.json'), 'utf8'))
let deployment = null
let deploymentSource = source
try {
  deployment = JSON.parse(await readFile(source, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  // A fresh clone has no local copy: read the published manifest (the same URL the app reads at run time).
  // Without network, the config is generated without a deployment, as before.
  try {
    const response = await fetch(appValues.help.manifest)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    deployment = await response.json()
    deploymentSource = appValues.help.manifest
  } catch (fetchError) {
    console.warn(`No deployments/testnet.json beside the repository and the published manifest could not be fetched (${fetchError.message})`)
  }
}

// Deployment values must come from the published manifest, never a guessed address.
const factory = deployment?.near?.factory ?? null
const measurement = deployment?.agent?.measurement ?? null
const hashes = ['mrtd', 'rtmr0', 'rtmr1', 'rtmr2', 'compose_hash', 'os_image_hash']
// mrtd and rtmr0-2 are SHA-384 (96 hex), compose_hash and os_image_hash SHA-256 (64 hex): agent/MEASUREMENT.md §1
const hexLen = { mrtd: 96, rtmr0: 96, rtmr1: 96, rtmr2: 96, compose_hash: 64, os_image_hash: 64 }
const approvedMeasurement = measurement && hashes.every(key => new RegExp(`^[0-9a-f]{${hexLen[key]}}$`).test(measurement[key] ?? ''))
  ? Object.fromEntries(hashes.map(key => [key, measurement[key]])) : null
if (factory !== null && (typeof factory !== 'string' || !/^[a-z0-9._-]+$/.test(factory))) {
  throw new Error('Invalid NEAR factory in deployments/testnet.json')
}
// Guided-flow blocks (PRD FR-2, FR-17): validated, and only emitted with a published deployment.
const guided = deployment ? guidedValues(appValues, deployment) : { guided: null, network: null, help: null, base: null }
const config = {
  ...guided,
  baseChainId: deployment?.base?.chainId ?? appValues.baseChainId,
  nearNetwork: deployment?.near?.network ?? appValues.nearNetwork,
  nearRpcUrl: appValues.nearRpcUrl,
  nearRpcUrlFallback: appValues.nearRpcUrlFallback,
  baseRpcUrl: appValues.baseRpcUrl,
  relayerUrl: appValues.relayerUrl,
  relayerUrlFallback: appValues.relayerUrlFallback,
  near: { factory },
  marketLabels: Object.fromEntries(Object.entries(deployment?.base?.markets ?? {}).filter(([,market]) => /^0x[0-9a-fA-F]{64}$/.test(market.id ?? '')).map(([name,market]) => [market.id.toLowerCase(),name])),
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
console.log(factory ? `Generated app config from the deployment manifest (${deploymentSource})` : 'Generated app config without a deployment manifest: no local deployments/testnet.json and the published one could not be fetched')
