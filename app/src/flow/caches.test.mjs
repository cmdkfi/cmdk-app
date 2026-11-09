import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmedActivity, persistable } from './caches.ts'
import { parseBig, stringifyBig } from './json.ts'

const OWNER = '0x' + '19'.repeat(20)

test('§9 4: only live position snapshots keyed by owner and vault are persisted; sandbox and other queries never', () => {
  assert.equal(persistable(['position', 'live', OWNER, 'v10.f.testnet']), true)
  assert.equal(persistable(['position', 'sandbox', OWNER, 'v10.f.testnet']), false)
  assert.equal(persistable(['position', 'live', null, 'v10.f.testnet']), false)
  assert.equal(persistable(['position', 'live', OWNER, null]), false)
  for (const name of ['discovery', 'agent', 'close-plan', 'activity', 'static', 'quote', 'funding']) assert.equal(persistable([name, 'live', OWNER, 'v10.f.testnet']), false)
})

test('bigint JSON round-trips snapshots exactly', () => {
  const value = { blockNumber: 30_000_100n, markets: [{ debt: 160_000_001n, ltv: null, id: '0xaa' }], idle: { eth: 0n } }
  assert.deepEqual(parseBig(stringifyBig(value)), value)
  assert.deepEqual(parseBig(stringifyBig({ $bigint: 'x', other: 1 })), { $bigint: 'x', other: 1 }) // only the exact shape converts
})

const item = blockNumber => ({ name: 'Opened', actor: 'you', blockNumber, time: 1n, transactionHash: '0x01', logIndex: 0, args: {} })

test('§9 3: only blocks with at least two confirmations at the head are kept; the kept range is contiguous', () => {
  const pages = [{ from: 101n, to: 200n, reachedStart: false, items: [item(200n), item(199n), item(150n)] }, { from: 1n, to: 100n, reachedStart: true, items: [item(50n)] }]
  const keep = confirmedActivity(pages, 200n)
  assert.equal(keep.from, 1n)
  assert.equal(keep.to, 199n) // head − 1: two confirmations (head − block + 1 ≥ 2)
  assert.deepEqual(keep.items.map(i => i.blockNumber), [199n, 150n, 50n]) // block 200 has one confirmation: not kept
  assert.equal(keep.reachedStart, true)
  assert.equal(confirmedActivity([{ from: 200n, to: 200n, reachedStart: false, items: [] }], 200n), null)
  assert.equal(confirmedActivity([], 200n), null)
})
