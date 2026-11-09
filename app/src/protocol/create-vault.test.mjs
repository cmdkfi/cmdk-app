import test from 'node:test'
import assert from 'node:assert/strict'
import { readCreateJob, startCreateVault, CreateVaultError } from './create-vault.ts'

const policy = { cooldownSecs: 120, depositNear: '2', markets: [{ id: `0x${'a'.repeat(64)}`, loan_token: `0x${'b'.repeat(40)}`, collateral_token: `0x${'c'.repeat(40)}`, executor: `0x${'d'.repeat(40)}`, slice_max: '1000000000' }] }
const config = { baseChainId: 84532, nearNetwork: 'testnet', relayerUrl: 'https://primary', relayerUrlFallback: 'https://fallback', near: { factory: 'factory.testnet' }, createVault: policy }
const health = { ok: true, chain_id: 84532, near_network: 'testnet', factory: 'factory.testnet', factory_exists: true, eth_float_wei: '0' }
const owner = `0x${'e'.repeat(40)}`
const json = (status, body, headers = new Headers()) => ({ status, ok: status >= 200 && status < 300, headers, json: async () => body })

test('checks health then sends one exact asynchronous create request', async () => {
  const calls = []
  const fetcher = async (url, options) => {
    calls.push({ url, options })
    return url.endsWith('/health') ? json(200, health) : json(202, { ok: true, job: '0123456789abcdef' })
  }
  assert.equal(await startCreateVault(config, owner, fetcher), '0123456789abcdef')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url, 'https://primary/create-vault')
  assert.deepEqual(JSON.parse(calls[1].options.body), { owner, policy: { cooldown_secs: 120, markets: policy.markets }, deposit_near: '2' })
})

test('does not post while the factory is unavailable', async () => {
  const calls = []
  await assert.rejects(startCreateVault(config, owner, async url => { calls.push(url); return json(200, { ...health, factory_exists: false }) }), /factory is not available/)
  assert.equal(calls.length, 1)
})

test('reports rate limits and never retries a POST that may have been accepted', async () => {
  const headers = new Headers({ 'Retry-After': '3600' })
  await assert.rejects(startCreateVault(config, owner, async url => url.endsWith('/health') ? json(200, health) : json(429, { ok: false, error: 'Too many vaults' }, headers)), error => error instanceof CreateVaultError && error.retryAfter === 3600)
  const calls = []
  await assert.rejects(startCreateVault(config, owner, async url => { calls.push(url); if (url.endsWith('/health')) return json(200, health); throw new Error('connection lost') }), error => error instanceof CreateVaultError && error.uncertain)
  assert.equal(calls.filter(url => url.includes('create-vault')).length, 1)
})

test('a forgotten job is uncertain, not a failed creation', async () => {
  await assert.rejects(readCreateJob(config, '0123456789abcdef', async () => json(404, { ok: false, error: 'no such job' })), error => error instanceof CreateVaultError && error.uncertain)
})
