// Display formatting for bigint token amounts and WAD ratios. Truncates (never rounds up) so a figure is
// not shown larger than it is.
export function formatUnits(value: bigint, decimals: number, maxFraction = 4, group = true): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const scale = 10n ** BigInt(decimals)
  const whole = abs / scale
  let fraction = (abs % scale).toString().padStart(decimals, '0').slice(0, Math.max(0, maxFraction)).replace(/0+$/, '')
  if (decimals === 0) fraction = ''
  const wholeText = group ? whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole.toString()
  return `${negative ? '-' : ''}${wholeText}${fraction ? `.${fraction}` : ''}`
}

/** WAD fraction as a percentage, e.g. 0.5e18 → "50%". */
export function formatWadPercent(wad: bigint, maxFraction = 1): string {
  return `${formatUnits(wad * 100n, 18, maxFraction, false)}%`
}

export function formatFractionPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`
}

/** 0x1234…7890: enough to recognise an address without hiding it entirely. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** A wallet error in plain words; the action can be tried again. */
export function connectionError(error: Error): string {
  const text = error.message.toLowerCase()
  if (text.includes('rejected') || text.includes('denied') || text.includes('cancelled')) return 'The wallet request was cancelled. You can try again.'
  if (text.includes('not found') || text.includes('not installed') || text.includes('provider')) return 'The wallet was not found in this browser. Install it, then try again.'
  return 'The wallet could not connect. Check the wallet and try again.'
}
