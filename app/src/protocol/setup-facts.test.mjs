import test from 'node:test'
import assert from 'node:assert/strict'
import { setupComplete } from './setup-facts.ts'

const LIVE = '0x' + 'aa'.repeat(32), BACKUP = '0x' + 'bb'.repeat(32)
const fact = (id, extra = {}) => ({ id, executor: '0x' + '44'.repeat(20), loanToken: '0xUSDC', collateralToken: '0xWETH', authorized: true, needsApproval: false, corridorSet: true, ...extra })

test('complete: both corridors set, allowances and authorization present, measurement approved', () => {
  assert.equal(setupComplete({ facts: [fact(LIVE), fact(BACKUP)], measurementMatches: true }), true)
})

test('incomplete when any part is missing', () => {
  assert.equal(setupComplete({ facts: [fact(LIVE), fact(BACKUP)], measurementMatches: false }), false)
  assert.equal(setupComplete({ facts: [fact(LIVE, { authorized: false }), fact(BACKUP)], measurementMatches: true }), false)
  assert.equal(setupComplete({ facts: [fact(LIVE), fact(BACKUP, { needsApproval: true })], measurementMatches: true }), false)
  assert.equal(setupComplete({ facts: [fact(LIVE), fact(BACKUP, { corridorSet: false })], measurementMatches: true }), false)
  assert.equal(setupComplete({ facts: [], measurementMatches: true }), false)
})
