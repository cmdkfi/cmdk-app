import test from 'node:test'
import assert from 'node:assert/strict'
import { assessRelayer, readRelayerHealth } from './relayer.ts'

const config = { baseChainId: 84532, nearNetwork: 'testnet', relayerUrl: 'https://primary', relayerUrlFallback: 'https://fallback', near: { factory: 'factory.testnet' } }
const health = { ok: true, chain_id: 84532, near_network: 'testnet', factory: 'factory.testnet', factory_exists: true, eth_float_wei: '0' }

test('fails closed on a mismatched factory or network', () => {
  assert.equal(assessRelayer(config, { ...health, factory: 'other.testnet' }).kind, 'failed')
  assert.equal(assessRelayer(config, { ...health, chain_id: 1 }).kind, 'failed')
  assert.equal(assessRelayer(config, { ...health, factory_exists: false }).kind, 'pending')
  assert.equal(assessRelayer(config, health).kind, 'ready')
})

test('uses fallback only when the primary does not answer', async () => {
  const urls = []
  const fetcher = async url => {
    urls.push(url)
    if (url.startsWith('https://primary')) throw new Error('offline')
    return { ok: true, json: async () => health }
  }
  assert.deepEqual(await readRelayerHealth(config, fetcher), health)
  assert.deepEqual(urls, ['https://primary/health', 'https://fallback/health'])
})
