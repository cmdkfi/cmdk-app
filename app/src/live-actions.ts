import { parseAbi, parseUnits, type Address } from 'viem'
import type { MarketPosition } from './positions.ts'
export const WAD = 10n ** 18n
export const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function transfer(address,uint256) returns (bool)'])
export const morphoActions = parseAbi([
  'function supplyCollateral((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams,uint256 assets,address onBehalf,bytes data)',
  'function repay((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams,uint256 assets,uint256 shares,address onBehalf,bytes data) returns (uint256,uint256)',
])
export const executorActions = parseAbi(['function open(bytes32,uint256,uint256,uint256)', 'function close(bytes32,uint256)'])
export function params(m: MarketPosition) {
  if (!m.oracle || !m.irm) throw new Error('Market parameters unavailable.')
  return { loanToken: m.loanToken, collateralToken: m.collateralToken, oracle: m.oracle, irm: m.irm, lltv: m.liquidationLtv }
}
export function parseAmount(text: string, decimals: number) {
  if (!new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${decimals}})?$`).test(text)) throw new Error('Enter a positive amount within token precision.')
  const value = parseUnits(text, decimals)
  if (value <= 0n) throw new Error('Enter an amount above zero.')
  return value
}
export function borrowCapacity(m: MarketPosition) {
  if (m.agentTrigger === null || m.agentTrigger >= m.liquidationLtv) return 0n
  const limit = m.collateralValue * m.agentTrigger / WAD
  const remaining = limit > m.debt + 2n ? limit - m.debt - 2n : 0n
  return remaining < (m.liquidity ?? 0n) ? remaining : (m.liquidity ?? 0n)
}
export function borrowTarget(m: MarketPosition, amount: bigint) {
  if (amount <= 0n || amount > borrowCapacity(m) || m.collateralValue <= 0n) throw new Error('Amount exceeds the current risk corridor or market liquidity.')
  const target = (m.debt + amount + 2n) * WAD / m.collateralValue
  if (m.agentTrigger === null || target > m.agentTrigger || target >= m.liquidationLtv) throw new Error('Borrow exceeds the configured risk corridor.')
  return target
}
export function ownerMessage(vault: string, nonce: number, expiry: number, method: 'open' | 'withdraw' | 'close', args: Record<string, string>) {
  if (!vault.endsWith('.testnet') || !Number.isSafeInteger(nonce) || nonce < 1) throw new Error('Invalid testnet vault or owner nonce.')
  return JSON.stringify({protocol:'cmdk-vault/1',network:'testnet',vault,method,args,nonce,expiry})
}
export type Action = 'Deposit' | 'Borrow' | 'Repay' | 'Withdraw'
export function preview(m: MarketPosition, action: Action, value: bigint) {
  const collateral = m.collateral + (action === 'Deposit' ? value : 0n)
  const debt = action === 'Borrow' ? m.debt + value : action === 'Repay' ? m.debt > value ? m.debt - value : 0n : m.debt
  const collateralValue = collateral * m.oraclePrice / 10n ** 36n
  return { collateral, debt, ltv: collateralValue ? debt * WAD / collateralValue : null }
}
export const explorerAddress = (address: Address) => `https://sepolia.basescan.org/address/${address}`
