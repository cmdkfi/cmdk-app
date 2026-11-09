import type { StorageMode } from './session.ts'
// Decimal amounts typed by the user (PRD S1, D7). Conversion is viem's parseUnits; our validation runs first because
// parseUnits rounds over-precise input and the product rejects it instead (vector V8).
import { parseUnits } from 'viem'

/** Parses a positive decimal into base units, or null when it is not one (zero is not positive). */
export function parseDecimal(text: string, decimals: number): bigint | null {
  const match = new RegExp(`^(0|[1-9]\\d*)(?:\\.(\\d{1,${decimals}}))?$`).exec(text)
  if (!match) return null
  const value = parseUnits(text, decimals)
  return value > 0n ? value : null
}

/**
 * S1 amount prefill (PRD S1, product owner 9 Nov): 0.01 ETH keeps test positions within the market's liquidity and lets
 * one faucet claim cover the close. The sandbox sets its own (0.5 ETH) when it lands in Phase 6b.
 */
export const defaultDeposit = (mode: StorageMode): string => (mode === 'live' ? '0.01' : '')

export type AmountCheck =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'below-min' }
  | { kind: 'ok'; wei: bigint }

/** S1 deposit amount in ETH (18 decimals), minimum from config, no maximum. */
export function checkDeposit(text: string, minWei: bigint): AmountCheck {
  const value = text.trim()
  if (value === '') return { kind: 'empty' }
  const wei = parseDecimal(value, 18)
  if (wei === null) return { kind: 'invalid', message: 'Enter a positive amount with at most 18 decimals.' }
  return wei < minWei ? { kind: 'below-min' } : { kind: 'ok', wei }
}
