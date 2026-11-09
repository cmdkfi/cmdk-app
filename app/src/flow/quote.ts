// S1 estimate math (PRD S1, R2). Inputs are live reads; any missing read yields null, never a placeholder.
const WAD = 10n ** 18n
const SECONDS_PER_YEAR = 31_536_000

export type DepositEstimate = {
  /** Collateral value in loan-token units at the oracle price. */
  value: bigint | null
  /** Borrow needed to open at the target LTV. */
  target: bigint | null
  /** What the position would actually borrow: target, or the market's liquidity when that is lower. */
  borrow: bigint | null
  /** True when the market cannot lend the full target amount right now. */
  limited: boolean
  /** LTV the position would open at when limited (WAD). */
  resultingLtv: bigint | null
  liquidityKnown: boolean
}

export function estimateDeposit(amountWei: bigint, price: bigint | null, liquidity: bigint | null, targetWad: bigint): DepositEstimate {
  if (price === null || amountWei <= 0n) return { value: null, target: null, borrow: null, limited: false, resultingLtv: null, liquidityKnown: liquidity !== null }
  const value = amountWei * price / 10n ** 36n
  const target = value * targetWad / WAD
  if (liquidity === null || liquidity >= target) return { value, target, borrow: target, limited: false, resultingLtv: null, liquidityKnown: liquidity !== null }
  return { value, target, borrow: liquidity, limited: true, resultingLtv: value === 0n ? null : liquidity * WAD / value, liquidityKnown: true }
}

/** Morpho borrow APY from the per-second rate: e^(rate × year) − 1, as a fraction. */
export function borrowApy(ratePerSecond: bigint): number {
  return Math.expm1(Number(ratePerSecond) / 1e18 * SECONDS_PER_YEAR)
}

export function percentToWad(percent: number): bigint {
  return BigInt(Math.round(percent * 10)) * 10n ** 15n
}
