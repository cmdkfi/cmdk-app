import { isAddress, parseUnits, type Address, type Hex } from 'viem'
import type { AppConfig } from './near.ts'
import { SetupError } from './vault-setup.ts'

export const WETH = '0x4200000000000000000000000000000000000006' as Address
export const tokenAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const
export const marketAbi = [
  { type: 'function', name: 'market', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint128' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'uint128' }] },
  { type: 'function', name: 'position', stateMutability: 'view', inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [{ type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }] },
  { type: 'function', name: 'idToMarketParams', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }] },
] as const
export const oracleAbi = [{ type: 'function', name: 'price', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const
export const executorOpenAbi = [{ type: 'function', name: 'open', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'collateralIn', type: 'uint256' }, { name: 'targetLtv', type: 'uint256' }, { name: 'deadline', type: 'uint256' }], outputs: [] }] as const
const WAD = 10n ** 18n

export function parseWethAmount(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new SetupError('Enter a valid WETH amount with up to 18 decimal places.')
  const amount = parseUnits(value, 18)
  if (amount <= 0n) throw new SetupError('Enter more than zero WETH.')
  return amount
}

export function openQuote(collateralIn: bigint, supplied: bigint, debt: bigint, oraclePrice: bigint, targetLtv: bigint, supplyAssets: bigint, borrowAssets: bigint) {
  if (collateralIn <= 0n || oraclePrice <= 0n || targetLtv <= 0n || targetLtv >= WAD) throw new SetupError('The deposit or market quote is invalid.')
  const value = (supplied + collateralIn) * oraclePrice / (10n ** 36n)
  const maxDebt = value * targetLtv / WAD
  const borrowed = maxDebt > debt + 2n ? maxDebt - debt - 2n : 0n
  const liquidity = supplyAssets > borrowAssets ? supplyAssets - borrowAssets : 0n
  return { value, borrowed, liquidity, enoughLiquidity: borrowed > 0n && borrowed <= liquidity }
}

export function openMessage(vault: string, nonce: number, expiry: number, config: AppConfig, market: Hex, collateralIn: bigint, targetLtv: bigint): string {
  if (!config.near.factory || !/^v[1-9][0-9]*$/.test(vault.split('.')[0]) || vault.slice(vault.indexOf('.') + 1) !== config.near.factory) throw new SetupError('Select a vault from the published factory.')
  if (!config.createVault?.markets.some(item => item.id.toLowerCase() === market.toLowerCase()) || !/^0x[0-9a-fA-F]{64}$/.test(market)) throw new SetupError('This market is not in the published deployment.')
  if (!Number.isSafeInteger(nonce) || nonce < 1 || !Number.isSafeInteger(expiry) || collateralIn <= 0n || targetLtv <= 0n || targetLtv >= 860_000_000_000_000_000n) throw new SetupError('The open parameters are invalid.')
  return JSON.stringify({ protocol: 'cmdk-vault/1', network: 'testnet', vault, method: 'open', args: { market, collateral_in: collateralIn.toString(), target_ltv: targetLtv.toString() }, nonce, expiry })
}

export function validDepositTarget(position: string | undefined, marketToken: string, executor: string): position is Address {
  return !!position && isAddress(position) && marketToken.toLowerCase() === WETH.toLowerCase() && isAddress(executor)
}
