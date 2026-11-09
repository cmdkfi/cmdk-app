// Decimal amounts typed by the user (PRD S1, D7). Plain digits with an optional fraction within the token's
// precision; no exponent, sign or rounding.

/** Parses a positive decimal into base units, or null when it is not one (zero is not positive). */
export function parseDecimal(text: string, decimals: number): bigint | null {
  const match = new RegExp(`^(0|[1-9]\\d*)(?:\\.(\\d{1,${decimals}}))?$`).exec(text)
  if (!match) return null
  const value = BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt((match[2] ?? '').padEnd(decimals, '0') || '0')
  return value > 0n ? value : null
}

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
