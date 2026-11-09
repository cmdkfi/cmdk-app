// Position arithmetic in integers, mirroring cmdkfi/app executor/src/CorridorMath.sol (Morpho SharesMathLib and
// the executor's own rounding) and scripts/VERIFY.md §2-2.1 (accrual). No floating point except the display APR.

export const WAD = 10n ** 18n
/** CorridorMath.sol: Morpho's virtual shares and assets (SharesMathLib). */
export const VIRTUAL_SHARES = 1_000_000n
export const VIRTUAL_ASSETS = 1n
/** CorridorMath.sol ORACLE_SCALE: Morpho oracle prices are scaled by 1e36. */
export const ORACLE_SCALE = 10n ** 36n
const SECONDS_PER_YEAR = 31_536_000n

/** Debt of a borrower, rounded up. CorridorMath.sol l.18-22 `toAssetsUp`. */
export function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  const num = shares * (totalAssets + VIRTUAL_ASSETS)
  const den = totalShares + VIRTUAL_SHARES
  return (num + den - 1n) / den
}

/** Collateral value in loan units, rounded down. CorridorMath.sol l.25-27 `value`. */
export function collateralValue(collateral: bigint, price: bigint): bigint {
  return collateral * price / ORACLE_SCALE
}

/**
 * LTV in WAD, rounded up; 0 without debt. CorridorMath.sol l.30-34 `ltv`, except that where the contract returns
 * max uint (debt against worthless collateral) this returns null, which callers show as unbounded.
 */
export function ltv(debt: bigint, value: bigint): bigint | null {
  if (debt === 0n) return 0n
  if (value === 0n) return null
  return (debt * WAD + value - 1n) / value
}

/** Morpho's health rule as scripts/VERIFY.md §2 step 3 states it: liquidatable when debt > value × LLTV. */
export function liquidatable(debt: bigint, value: bigint, lltv: bigint): boolean {
  return debt > value * lltv / WAD
}

/**
 * Borrow assets accrued over `elapsed` seconds at a per-second WAD rate: Morpho's wTaylorCompounded (three terms),
 * as scripts/VERIFY.md §2.1 applies it to totalBorrowAssets.
 */
export function accrue(assets: bigint, ratePerSecond: bigint, elapsed: bigint): bigint {
  if (elapsed < 0n || ratePerSecond < 0n) throw new Error('Accrual needs a non-negative rate and elapsed time.')
  const first = ratePerSecond * elapsed
  const second = first * first / (2n * WAD)
  const third = second * first / (3n * WAD)
  return assets + assets * (first + second + third) / WAD
}

/** Debt that opens the position at `targetWad` of the collateral value (Executor.open borrows to the target). */
export function borrowAt(value: bigint, targetWad: bigint): bigint {
  return value * targetWad / WAD
}

/** What the market can lend now: supply minus (accrued) borrow, never negative. */
export function availableLiquidity(totalSupplyAssets: bigint, totalBorrowAssets: bigint): bigint {
  return totalSupplyAssets > totalBorrowAssets ? totalSupplyAssets - totalBorrowAssets : 0n
}

/** Simple borrow APR from the IRM's per-second WAD rate: rate × 31,536,000 / 1e18 (scripts/SCENES.md l.236). */
export function borrowApr(ratePerSecond: bigint): number {
  return Number(ratePerSecond * SECONDS_PER_YEAR) / 1e18
}

/** An allowance counts as present when above zero (scripts/relayer.py l.478-483 refuses only a zero allowance). */
export function allowancePresent(allowance: bigint): boolean {
  return allowance > 0n
}

/** Share of the market's liquidity the app plans to borrow: 1% stays free for accrual between read and open (Q1). */
export const LIQUIDITY_MARGIN_BPS = 100n

/** What the app may plan to borrow from `liquidity` now. */
export function lendable(liquidity: bigint): bigint {
  return liquidity * (10_000n - LIQUIDITY_MARGIN_BPS) / 10_000n
}

export type DepositEstimate = { value: bigint | null; target: bigint | null; borrow: bigint | null; limited: boolean; resultingLtv: bigint | null; liquidityKnown: boolean; maxAmountAtTarget: bigint | null }

/**
 * What a deposit would open (PRD S1, R2): value at the oracle price, the borrow to the target LTV, and — when the
 * market cannot lend that much now (after the 1% margin) — what it can lend, the LTV that gives, and the largest
 * deposit that would still open at the target. Missing price → nothing.
 */
export function depositEstimate(amount: bigint, price: bigint | null, liquidity: bigint | null, targetWad: bigint): DepositEstimate {
  const liquidityKnown = liquidity !== null
  const none = { value: null, target: null, borrow: null, limited: false, resultingLtv: null, liquidityKnown, maxAmountAtTarget: null }
  if (price === null || amount <= 0n) return none
  const value = collateralValue(amount, price)
  const target = borrowAt(value, targetWad)
  if (liquidity === null || lendable(liquidity) >= target) return { value, target, borrow: target, limited: false, resultingLtv: null, liquidityKnown, maxAmountAtTarget: null }
  const can = lendable(liquidity)
  return { value, target, borrow: can, limited: true, resultingLtv: value === 0n ? null : can * WAD / value, liquidityKnown, maxAmountAtTarget: depositForBorrow(can, price, targetWad) }
}

/** Largest collateral amount whose borrow at `targetWad` stays within `borrow` (inverse of collateralValue/borrowAt). */
export function depositForBorrow(borrow: bigint, price: bigint, targetWad: bigint): bigint {
  if (price === 0n || targetWad === 0n) return 0n
  return borrow * WAD / targetWad * ORACLE_SCALE / price
}

/**
 * `target_ltv` for Executor.open (executor/src/Executor.sol l.519-536 borrows value × targetLtv − debt − 2 from
 * Morpho, which reverts when the market cannot lend it): the configured target when the market can lend enough now,
 * otherwise the LTV the lendable amount gives (rounded down).
 */
export function openTargetLtv(value: bigint, debt: bigint, liquidity: bigint, targetWad: bigint): { targetLtv: bigint; borrow: bigint; belowTarget: boolean } {
  const wanted = borrowAt(value, targetWad) > debt ? borrowAt(value, targetWad) - debt : 0n
  const can = lendable(liquidity)
  if (can >= wanted) return { targetLtv: targetWad, borrow: wanted, belowTarget: false }
  return { targetLtv: value === 0n ? 0n : (debt + can) * WAD / value, borrow: can, belowTarget: true }
}
