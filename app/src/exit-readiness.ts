export function requiredRepayment(debt: bigint): bigint {
  if (debt < 0n) throw new Error('Debt cannot be negative.')
  return debt + debt / 100n
}

export function repaymentGap(required: bigint, available: bigint): bigint {
  return available >= required ? 0n : required - available
}

export function totalForToken(markets: { loanToken: string; debt: bigint }[], token: string): bigint {
  return markets.filter(market => market.loanToken.toLowerCase() === token.toLowerCase())
    .reduce((total, market) => total + requiredRepayment(market.debt), 0n)
}
