import test from 'node:test'
import assert from 'node:assert/strict'
import { marketMath } from './positions.ts'

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
