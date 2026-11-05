import assert from 'node:assert/strict'
import test from 'node:test'
import { corridorFromChain, corridorMessage } from './live-corridor.ts'

const market = `0x${'1'.repeat(64)}`
const config = { near: { factory: 'factory.testnet' }, createVault: { markets: [{ id: market }] } }
const rules = { floor: 30, target: 50, act: 70, budget: 20, migrate: true, exit: false }

test('reads the executor corridor without changing its values', () => {
  assert.deepEqual(corridorFromChain([500000000000000000n, 700000000000000000n, 300000000000000000n, 200000000000000000n, true, false, true]), rules)
  assert.throws(() => corridorFromChain([0n, 0n, 0n, 0n, false, false, false]))
})

test('signs the exact one-market set_corridor message and rejects invalid rules', () => {
  assert.equal(corridorMessage('v1.factory.testnet', 2, 1000, config, market, rules), `{"protocol":"cmdk-vault/1","network":"testnet","vault":"v1.factory.testnet","method":"set_corridor","args":{"market":"${market}","target":"500000000000000000","act":"700000000000000000","floor":"300000000000000000","sell_budget":"200000000000000000","migrate_allowed":true,"exit_allowed":false},"nonce":2,"expiry":1000}`)
  assert.throws(() => corridorMessage('v1.factory.testnet', 2, 1000, config, market, { ...rules, act: 86 }))
  assert.throws(() => corridorMessage('v1.factory.testnet', 2, 1000, config, market, { ...rules, floor: 30.01 }))
})
