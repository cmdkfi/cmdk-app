import test from 'node:test'
import assert from 'node:assert/strict'
import { approvalMessage, isMeasurement, measurementMatches, readCurrentAgent } from './measurement.ts'

const measurement = {
  mrtd: 'a'.repeat(96), rtmr0: 'b'.repeat(96), rtmr1: 'c'.repeat(96), rtmr2: 'd'.repeat(96),
  compose_hash: 'e'.repeat(64), os_image_hash: 'f'.repeat(64),
}
const config = { baseChainId: 84532, near: { factory: 'factory.testnet' } }

test('measurement requires all six fields at their published lengths', () => {
  assert.equal(isMeasurement(measurement), true)
  assert.equal(isMeasurement({ ...measurement, mrtd: 'a'.repeat(64) }), false)
  assert.equal(isMeasurement({ ...measurement, compose_hash: null }), false)
  assert.equal(measurementMatches({ ...measurement }, measurement), true)
  assert.equal(measurementMatches({ ...measurement, rtmr1: '0'.repeat(96) }, measurement), false)
})

test('current measurement is fetched from main and checked against the app deployment', async () => {
  const calls = []
  const current = await readCurrentAgent(config, async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ base: { chainId: 84532 }, near: { factory: 'factory.testnet' }, agent: { measurement, version: 'v2' } }), { status: 200 })
  })
  assert.deepEqual(current.measurement, measurement)
  assert.equal(calls[0].url.startsWith('https://raw.githubusercontent.com/cmdkfi/app/main/deployments/testnet.json?at='), true)
  assert.equal(calls[0].options.cache, 'no-store')
  await assert.rejects(readCurrentAgent(config, async () => new Response(JSON.stringify({ base: { chainId: 84532 }, near: { factory: 'other.testnet' }, agent: { measurement } }), { status: 200 })))
})

test('approval signs exactly one measurement update at the next owner nonce', () => {
  const message = approvalMessage('v2.factory.testnet', 3, 1793722200, config, measurement)
  assert.deepEqual(JSON.parse(message), { protocol: 'cmdk-vault/1', network: 'testnet', vault: 'v2.factory.testnet', method: 'approve_measurement', args: measurement, nonce: 3, expiry: 1793722200 })
  assert.throws(() => approvalMessage('v2.other.testnet', 3, 1793722200, config, measurement))
})
