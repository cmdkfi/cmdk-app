import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { guidedValues } from '../../scripts/guided-values.mjs'
import { readGuided } from './guided-config.ts'

const appValues = JSON.parse(await readFile(new URL('../../config.app.json', import.meta.url), 'utf8'))
const deployment = { base: { morpho: '0x' + '55'.repeat(20), executorDeployBlock: 54354973, gasPriceOracle: '0x420000000000000000000000000000000000000F', tokens: { weth: '0x4200000000000000000000000000000000000006', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' } } }
const clone = value => JSON.parse(JSON.stringify(value))

function urls(value, out = []) {
  if (typeof value === 'string' && /^[a-z]+:\/\//i.test(value)) out.push(value)
  else if (value && typeof value === 'object') Object.values(value).forEach(item => urls(item, out))
  return out
}

test('config.app.json guided blocks validate and every help and network URL is https and non-empty', () => {
  const values = guidedValues(appValues, deployment)
  const all = urls({ network: values.network, help: values.help })
  assert.ok(all.length >= 9, `expected faucet, docs and network URLs, found ${all.length}`)
  for (const url of all) assert.match(url, /^https:\/\/\S+$/)
  assert.ok(values.help.ethFaucets.length >= 1 && values.help.usdcFaucets.length >= 1)
})

test('network add-chain values are exactly the PRD Appendix C values', () => {
  assert.deepEqual(guidedValues(appValues, deployment).network, {
    chainId: '0x14a34', chainName: 'Base Sepolia', rpcUrls: ['https://sepolia.base.org'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: ['https://sepolia.basescan.org'],
  })
})

test('the validator rejects http, empty URLs, a wrong chain and an out-of-bounds corridor', () => {
  const bad = (mutate, pattern) => { const values = clone(appValues); mutate(values); assert.throws(() => guidedValues(values, deployment), pattern) }
  bad(v => { v.help.ethFaucets[0].url = 'http://faucet.example' }, /https/)
  bad(v => { v.help.connectingToBase = '' }, /empty/)
  bad(v => { v.network.chainId = '0x1' }, /Base Sepolia/)
  bad(v => { v.network.rpcUrls = ['http://sepolia.base.org'] }, /https/)
  bad(v => { v.guided.corridor.act = 50 }, /corridor/)
  bad(v => { v.guided.messageExpirySecs = 7200 }, /expiry/)
  bad(v => { v.guided.firstVaultNumber = 0 }, /firstVaultNumber/)
  bad(v => { delete v.guided.firstVaultNumber }, /firstVaultNumber/)
  assert.throws(() => guidedValues(appValues, { base: { ...deployment.base, morpho: 'nope' } }), /morpho/)
})

test('readGuided exposes typed values and refuses a config without a published deployment', () => {
  const values = guidedValues(appValues, deployment)
  const live = { id: '0x' + 'aa'.repeat(32), executor: '0x' + '44'.repeat(20), loan_token: '', collateral_token: '', slice_max: '1' }
  const config = { ...values, createVault: { cooldownSecs: 120, depositNear: '2', markets: [live] } }
  const guided = readGuided(config)
  assert.equal(guided.minDepositWei, 10n ** 15n)
  assert.equal(guided.walletTxGasLimit, 100000n)
  assert.equal(guided.usdcDust, 10000n)
  assert.equal(guided.cooldownSecs, 120)
  assert.equal(guided.firstVaultNumber, 10)
  assert.deepEqual(guided.liveMarket, { id: live.id, executor: live.executor })
  assert.throws(() => readGuided({ ...config, guided: null }), /published deployment/)
  assert.throws(() => readGuided({ ...config, createVault: null }), /published deployment/)
})
