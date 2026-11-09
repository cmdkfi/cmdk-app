import test from 'node:test'
import assert from 'node:assert/strict'
import { V } from '../vectors.mjs'
import { accrue, allowancePresent, borrowApr, collateralValue, depositEstimate, liquidatable, ltv, toAssetsUp, WAD } from './math.ts'

test('V14: stored debt, collateral value and LTV with the executor rounding', () => {
  const v = V.V14_marketMath
  const value = collateralValue(v.collateral, v.price)
  const debt = toAssetsUp(v.shares, v.totalAssets, v.totalShares)
  assert.equal(value, v.value)
  assert.equal(debt, v.debt)
  assert.equal(ltv(debt, value), v.ltv)
})

test('V15: zero collateral with debt has no finite LTV; no debt is LTV 0', () => {
  assert.equal(collateralValue(0n, V.V14_marketMath.price), 0n)
  assert.equal(ltv(V.V15_zeroCollateral.debt, 0n), null)
  assert.equal(ltv(0n, 0n), 0n)
})

test('V16: Morpho Taylor accrual; negative elapsed refused', () => {
  for (const [assets, rate, elapsed, expected] of V.V16_accrual.cases) assert.equal(accrue(assets, rate, elapsed), expected)
  assert.throws(() => accrue(1n, 1n, -1n))
})

test('V17: scripts/VERIFY.md worked example, at lastUpdate and accrued 378 s', () => {
  const v = V.V17_verifyExample
  const value = collateralValue(v.collateral, v.price)
  assert.equal(value, v.value)
  const debt = toAssetsUp(v.borrowShares, v.totalBorrowAssets, v.totalBorrowShares)
  assert.equal(debt, v.debt)
  assert.equal(ltv(debt, value), v.ltv)
  const accrued = accrue(v.totalBorrowAssets, v.rate, v.elapsed)
  assert.equal(accrued, v.accruedAssets)
  const accruedDebt = toAssetsUp(v.borrowShares, accrued, v.totalBorrowShares)
  assert.equal(accruedDebt, v.accruedDebt)
  assert.equal(ltv(accruedDebt, value), v.accruedLtv)
  assert.equal(liquidatable(accruedDebt, value, 86n * 10n ** 16n), false)
})

test('APR is simple: rate × 31,536,000 / 1e18 (scripts/SCENES.md l.236)', () => {
  assert.equal(borrowApr(0n), 0)
  assert.ok(Math.abs(borrowApr(1302065709n) - 0.04106194) < 1e-8) // 4.11 % a year, evidence/venue/2026-11-03-venue-step2.md l.185
})

test('allowance present means above zero (relayer.py check_setup_flags)', () => {
  assert.equal(allowancePresent(0n), false)
  assert.equal(allowancePresent(1n), true)
})

test('deposit estimate: value, borrow at target, and the liquidity cap with its resulting LTV (R2)', () => {
  const price = 3200n * 10n ** 24n, half = WAD / 2n
  assert.deepEqual(depositEstimate(10n ** 17n, price, 10n ** 12n, half), { value: 320_000_000n, target: 160_000_000n, borrow: 160_000_000n, limited: false, resultingLtv: null, liquidityKnown: true })
  assert.deepEqual(depositEstimate(10n ** 17n, price, 80_000_000n, half), { value: 320_000_000n, target: 160_000_000n, borrow: 80_000_000n, limited: true, resultingLtv: 25n * 10n ** 16n, liquidityKnown: true })
  assert.deepEqual(depositEstimate(10n ** 17n, null, 1n, half), { value: null, target: null, borrow: null, limited: false, resultingLtv: null, liquidityKnown: true })
  assert.equal(depositEstimate(10n ** 17n, price, null, half).liquidityKnown, false)
})
