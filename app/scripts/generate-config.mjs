import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const source = resolve(root, 'deployments/testnet.json')
const appValues = JSON.parse(await readFile(resolve(import.meta.dirname, '../config.app.json'), 'utf8'))
let deployment = null
try {
  deployment = JSON.parse(await readFile(source, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

// Deployment values must come from the published manifest, never a guessed address.
const factory = deployment?.near?.factory ?? null
if (factory !== null && (typeof factory !== 'string' || !/^[a-z0-9._-]+$/.test(factory))) {
  throw new Error('Invalid NEAR factory in deployments/testnet.json')
}
const config = {
  baseChainId: deployment?.base?.chainId ?? appValues.baseChainId,
  nearNetwork: deployment?.near?.network ?? appValues.nearNetwork,
  nearRpcUrl: appValues.nearRpcUrl,
  relayerUrl: appValues.relayerUrl,
  relayerUrlFallback: appValues.relayerUrlFallback,
  near: { factory },
}
const output = resolve(root, 'app/public/config.json')
if (config.baseChainId !== 84532 || config.nearNetwork !== 'testnet') throw new Error('Deployment manifest does not match the supported testnet')
await mkdir(resolve(root, 'app/public'), { recursive: true })
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`)
console.log(factory ? 'Generated app config from deployment manifest' : 'Generated app config; NEAR factory deployment pending')
