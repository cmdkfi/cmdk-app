import test from 'node:test'
import assert from 'node:assert/strict'
import { marketMath, protectionStatus } from './positions.ts'

test('calculates stored Morpho debt, collateral value and LTV with integer rounding', () => {
  const result = marketMath(2n * 10n ** 18n, 2_500_000_000n, 2_500_000_000n, 2_500_000_000n, 2_500n * 10n ** 24n)
  assert.equal(result.collateralValue, 5_000_000_000n)
  assert.equal(result.debt, 2_499_000_401n)
  assert.equal(result.ltv, 499_800_080_200_000_000n)
})

test('zero collateral cannot produce a finite LTV', () => {
  const result = marketMath(0n, 1n, 1_000_000n, 1n, 2_500n * 10n ** 24n)
  assert.equal(result.collateralValue, 0n)
  assert.equal(result.ltv, null)
})

const agent = { public_key: 'key', expires_at: 2000 }
const observation = { agent_status: 'active', base_address: '0xABC', expires_at: 2000, last_tick_unix: 990 }
test('active protection requires configured rules and matching fresh observation', () => {
  assert.equal(protectionStatus(agent, true, false, observation, '0xabc', 1000), 'Active')
  assert.equal(protectionStatus(agent, false, false, observation, '0xabc', 1000), 'Not configured')
  assert.equal(protectionStatus(agent, true, true, observation, '0xabc', 1000), 'Closed for agent')
  assert.equal(protectionStatus(agent, true, false, null, '0xabc', 1000), 'Unavailable')
  assert.equal(protectionStatus(agent, true, false, { ...observation, last_tick_unix: 800 }, '0xabc', 1000), 'Unavailable')
  assert.equal(protectionStatus(agent, true, false, observation, '0xdef', 1000), 'Unavailable')
  assert.equal(protectionStatus(agent, true, false, observation, '0xabc', 2000), 'Expired')
})

test('accrued debt includes Morpho Taylor interest with integer rounding', async () => {
 const {accruedBorrowAssets} = await import('./positions.ts')
 assert.equal(accruedBorrowAssets(1000000n,0n,100n),1000000n)
 assert.equal(accruedBorrowAssets(1000000n,1000000000000000n,10n),1010050n)
 assert.throws(()=>accruedBorrowAssets(1n,1n,-1n))
})

import {remainingSellBudget} from './positions.ts'
test('shared budget follows the executor window base including already sold collateral',()=>{
 assert.equal(remainingSellBudget(100n,10n,200000000000000000n),12n)
 assert.equal(remainingSellBudget(0n,100n,200000000000000000n),0n)
 assert.equal(remainingSellBudget(100n,0n,0n),0n)
})
