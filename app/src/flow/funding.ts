// S3 funding check (PRD S3, FR-7). The deposit step wraps only the WETH the wallet is missing, then
// transfers the full amount. With enough WETH already in the wallet, only the transfer's gas is needed.
export type FundingNeed = {
  wrap: bigint
  transactions: 1 | 2
  gas: bigint
  required: bigint
  missing: bigint
  enough: boolean
}

export function fundingNeed(amount: bigint, wallet: { eth: bigint; weth: bigint; wrapCost: bigint; transferCost: bigint }): FundingNeed {
  const wrap = amount > wallet.weth ? amount - wallet.weth : 0n
  const gas = (wrap > 0n ? wallet.wrapCost : 0n) + wallet.transferCost
  const required = wrap + gas
  const missing = required > wallet.eth ? required - wallet.eth : 0n
  return { wrap, transactions: wrap > 0n ? 2 : 1, gas, required, missing, enough: missing === 0n }
}
