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

// Independent oracle: Morpho's own SDK (@morpho-org/blue-sdk, devDependency only; the boundary test keeps it out of app
// code). Our functions mirror CorridorMath.sol; the SDK mirrors Morpho Blue's MathLib/SharesMathLib. They must agree.
import { MathLib, SharesMath } from '@morpho-org/blue-sdk'

const ORACLE_PRICE_SCALE = 10n ** 36n
const cases = [
  // [borrowShares, totalBorrowAssets, totalBorrowShares, collateral, price, rate, elapsed]
  [V.V14_marketMath.shares, V.V14_marketMath.totalAssets, V.V14_marketMath.totalShares, V.V14_marketMath.collateral, V.V14_marketMath.price, 0n, 0n],
  [V.V17_verifyExample.borrowShares, V.V17_verifyExample.totalBorrowAssets, V.V17_verifyExample.totalBorrowShares, V.V17_verifyExample.collateral, V.V17_verifyExample.price, V.V17_verifyExample.rate, V.V17_verifyExample.elapsed],
  [10n ** 15n, 5_000_000_000n, 5n * 10n ** 15n, 10n ** 18n, 2_000n * 10n ** 24n, 1_585_489_600n, 86_400n],
  [1n, 1n, 1n, 1n, 1n, 10n ** 9n, 31_536_000n],
  [123_456_789_012n, 987_654_321n, 456_789_012_345_678n, 3n * 10n ** 17n, 2128137606814873744509394071n, 1302065709n, 3_600n],
]

test('Morpho SDK cross-check: accrual equals MathLib.wTaylorCompounded', () => {
  for (const [, assets, , , , rate, elapsed] of cases) {
    assert.equal(accrue(assets, rate, elapsed), assets + MathLib.wMulDown(assets, MathLib.wTaylorCompounded(rate, elapsed)))
  }
  assert.equal(accrue(V.V17_verifyExample.totalBorrowAssets, V.V17_verifyExample.rate, V.V17_verifyExample.elapsed), V.V17_verifyExample.accruedAssets)
})

test('Morpho SDK cross-check: debt equals SharesMath.toAssets rounded up', () => {
  for (const [shares, assets, totalShares] of cases) assert.equal(toAssetsUp(shares, assets, totalShares), SharesMath.toAssets(shares, assets, totalShares, 'Up'))
})

test('Morpho SDK cross-check: collateral value and LTV equal MathLib mulDivDown / mulDivUp', () => {
  for (const [shares, assets, totalShares, collateral, price] of cases) {
    const value = collateralValue(collateral, price)
    assert.equal(value, MathLib.mulDivDown(collateral, price, ORACLE_PRICE_SCALE))
    const debt = toAssetsUp(shares, assets, totalShares)
    if (value > 0n) assert.equal(ltv(debt, value), MathLib.mulDivUp(debt, WAD, value))
  }
})
