import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { guidedValues } from '../../scripts/guided-values.mjs'
import { parseConfig } from './config.ts'

const appValues = JSON.parse(await readFile(new URL('../../config.app.json', import.meta.url), 'utf8'))
const deployment = { base: { morpho: '0x' + '55'.repeat(20), executorDeployBlock: 54354973, gasPriceOracle: '0x420000000000000000000000000000000000000F', tokens: { weth: '0x4200000000000000000000000000000000000006', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' }, chainlink: { ethUsd: { address: '0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1', description: 'ETH / USD', maxAgeSeconds: 1200 }, _comment: 'x' } } }
const clone = value => JSON.parse(JSON.stringify(value))
const measurement = { mrtd: 'ab'.repeat(48), rtmr0: 'bc'.repeat(48), rtmr1: 'cd'.repeat(48), rtmr2: 'de'.repeat(48), compose_hash: 'ef'.repeat(32), os_image_hash: 'fa'.repeat(32) }
const market = id => ({ id, loan_token: deployment.base.tokens.usdc, collateral_token: deployment.base.tokens.weth, executor: '0x' + '44'.repeat(20), slice_max: '1000000000' })

/** The shape scripts/generate-config.mjs writes. */
function generated() {
  return {
    ...guidedValues(appValues, deployment),
    baseChainId: 84532, nearNetwork: 'testnet', nearRpcUrl: appValues.nearRpcUrl, nearRpcUrlFallback: appValues.nearRpcUrlFallback, baseRpcUrl: appValues.baseRpcUrl, relayerUrl: appValues.relayerUrl, relayerUrlFallback: appValues.relayerUrlFallback,
    near: { factory: 'factory.testnet' }, marketLabels: {}, agent: { measurement, version: '0.1.0', sourceCommit: 'abc' },
    createVault: { cooldownSecs: 120, depositNear: '2', markets: [market('0x' + 'aa'.repeat(32)), market('0x' + 'bb'.repeat(32))] },
  }
}

function urls(value, out = []) {
  if (typeof value === 'string' && /^[a-z]+:\/\//i.test(value)) out.push(value)
  else if (value && typeof value === 'object') Object.values(value).forEach(item => urls(item, out))
  return out
}

test('config.app.json guided blocks validate and every help and network URL is https and non-empty', () => {
  const values = guidedValues(appValues, deployment)
  const all = urls({ network: values.network, help: values.help })
  assert.ok(all.length >= 9)
  for (const url of all) assert.match(url, /^https:\/\/\S+$/)
})

test('network add-chain values are exactly the PRD Appendix C values', () => {
  assert.deepEqual(guidedValues(appValues, deployment).network, {
    chainId: '0x14a34', chainName: 'Base Sepolia', rpcUrls: ['https://sepolia.base.org'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: ['https://sepolia.basescan.org'],
  })
})

test('the generator validator rejects http, empty URLs, a wrong chain, a bad corridor and a bad cutoff', () => {
  const bad = (mutate, pattern) => { const values = clone(appValues); mutate(values); assert.throws(() => guidedValues(values, deployment), pattern) }
  bad(v => { v.help.ethFaucets[0].url = 'http://faucet.example' }, /https/)
  bad(v => { v.help.connectingToBase = '' }, /empty/)
  bad(v => { v.help.manifest = 'http://raw.githubusercontent.com/cmdkfi/app/main/deployments/testnet.json' }, /help.manifest must use https/)
  bad(v => { delete v.help.relayerDoc }, /help.relayerDoc is empty/)
  bad(v => { v.network.chainId = '0x1' }, /Base Sepolia/)
  bad(v => { v.guided.corridor.act = 50 }, /corridor/)
  bad(v => { v.guided.messageExpirySecs = 7200 }, /expiry/)
  bad(v => { v.guided.firstVaultNumber = 0 }, /firstVaultNumber/)
})

test('parseConfig accepts the generated shape and derives typed values', () => {
  const { guided } = parseConfig(generated())
  assert.equal(guided.minDepositWei, 10n ** 15n)
  assert.equal(guided.walletTxGasLimit, 100000n)
  assert.equal(guided.usdcDust, 10000n)
  assert.equal(guided.firstVaultNumber, 10)
  assert.equal(guided.cooldownSecs, 120)
  assert.equal(guided.liveMarket.id, '0x' + 'aa'.repeat(32))
})

test('parseConfig accepts the config.json the generator wrote in this checkout', { skip: !existsSync(new URL('../../public/config.json', import.meta.url)) && 'no generated config.json' }, async () => {
  const written = JSON.parse(await readFile(new URL('../../public/config.json', import.meta.url), 'utf8'))
  assert.equal(parseConfig(written).guided.liveMarket.id, written.createVault.markets[0].id)
})

test('V29: the wrong network or a missing deployment refuses the whole config', () => {
  assert.throws(() => parseConfig({ ...generated(), baseChainId: 1 }), /supported testnet/)
  assert.throws(() => parseConfig({ ...generated(), near: { factory: null } }), /factory/)
  assert.throws(() => parseConfig({ ...generated(), guided: null }), /guided/)
  assert.throws(() => parseConfig({ ...generated(), agent: { measurement: null } }), /measurement/)
  assert.throws(() => parseConfig({ ...generated(), relayerUrl: 'http://relayer' }), /https/)
  assert.throws(() => parseConfig({ ...generated(), nearRpcUrlFallback: 'http://near' }), /nearRpcUrlFallback must be https/)
  assert.throws(() => parseConfig({ ...generated(), nearRpcUrlFallback: undefined }), /nearRpcUrlFallback must be https/)
})

test('feed names come from the manifest base.chainlink; a manifest without them is refused', () => {
  assert.deepEqual(guidedValues(appValues, deployment).base.feeds, [{ address: '0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1', description: 'ETH / USD' }])
  assert.throws(() => guidedValues(appValues, { base: { ...deployment.base, chainlink: { _comment: 'x' } } }), /chainlink lists no feeds/)
  assert.throws(() => guidedValues(appValues, { base: { ...deployment.base, chainlink: { ethUsd: { address: '0x12' } } } }), /needs address and description/)
})
