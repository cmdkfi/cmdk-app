// S1 market read (PRD S1, R2): live market parameters from Executor.config, Morpho totals,
// oracle price and IRM borrow rate, all at one pinned block. New module (Phase 2); ABIs follow
// cmdkfi/app executor/src/Executor.sol (config, MarketConfig) and Interfaces.sol (MarketParams, IOracle).
import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbi, type Address, type Hex } from 'viem'
import { baseSepolia } from 'viem/chains'
import type { AppConfig } from './near.ts'
import { accruedBorrowAssets } from './positions.ts'

const executorAbi = parseAbi([
  'struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }',
  'struct MarketConfig { MarketParams params; address pool; address[2] feeds; uint32[2] maxAges; }',
  'function config(bytes32 id) view returns (MarketConfig)',
])
const morphoAbi = parseAbi(['function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)'])
const oracleAbi = parseAbi(['function price() view returns (uint256)'])
const tokenAbi = parseAbi(['function decimals() view returns (uint8)'])
const irmAbi = parseAbi(['function borrowRateView((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv),(uint128 totalSupplyAssets,uint128 totalSupplyShares,uint128 totalBorrowAssets,uint128 totalBorrowShares,uint128 lastUpdate,uint128 fee)) view returns (uint256)'])
const ZERO = '0x0000000000000000000000000000000000000000'

export type MarketQuote = {
  blockNumber: bigint
  blockTime: bigint
  lltv: bigint
  loanToken: Address
  collateralToken: Address
  loanDecimals: number
  collateralDecimals: number
  /** Collateral price in loan units scaled by 1e36; null when unreadable. */
  price: bigint | null
  /** Supply minus accrued borrow at the read block; null when unreadable. */
  liquidity: bigint | null
  /** Per-second borrow rate (WAD); null when unreadable. */
  borrowRate: bigint | null
}

export async function readMarketQuote(config: AppConfig, market: { id: Hex; executor: Address }, morpho: Address): Promise<MarketQuote> {
  const client = createPublicClient({ chain: baseSepolia, transport: http(config.baseRpcUrl) })
  if (await client.getChainId() !== 84532) throw new Error('RPC is not Base Sepolia.')
  const block = await client.getBlock()
  const blockNumber = block.number
  const settings = await client.readContract({ address: market.executor, abi: executorAbi, functionName: 'config', args: [market.id], blockNumber })
  const p = settings.params
  const params = [p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv] as const
  const computed = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }], params))
  if (computed.toLowerCase() !== market.id.toLowerCase()) throw new Error('Executor market parameters do not match the published market ID.')
  const [loanDecimals, collateralDecimals] = await Promise.all([
    client.readContract({ address: p.loanToken, abi: tokenAbi, functionName: 'decimals', blockNumber }),
    client.readContract({ address: p.collateralToken, abi: tokenAbi, functionName: 'decimals', blockNumber }),
  ])
  const [priceRead, totalsRead] = await Promise.allSettled([
    client.readContract({ address: p.oracle, abi: oracleAbi, functionName: 'price', blockNumber }),
    client.readContract({ address: morpho, abi: morphoAbi, functionName: 'market', args: [market.id], blockNumber }),
  ])
  const price = priceRead.status === 'fulfilled' && priceRead.value > 0n ? priceRead.value : null
  const totals = totalsRead.status === 'fulfilled' ? totalsRead.value : null
  let borrowRate: bigint | null = null
  if (totals && p.irm !== ZERO) {
    borrowRate = await client.readContract({
      address: p.irm, abi: irmAbi, functionName: 'borrowRateView', blockNumber,
      args: [{ loanToken: p.loanToken, collateralToken: p.collateralToken, oracle: p.oracle, irm: p.irm, lltv: p.lltv },
        { totalSupplyAssets: totals[0], totalSupplyShares: totals[1], totalBorrowAssets: totals[2], totalBorrowShares: totals[3], lastUpdate: totals[4], fee: totals[5] }],
    }).catch(() => null)
  } else if (totals) borrowRate = 0n
  let liquidity: bigint | null = null
  if (totals && borrowRate !== null) {
    const borrowed = accruedBorrowAssets(totals[2], borrowRate, block.timestamp > totals[4] ? block.timestamp - totals[4] : 0n)
    liquidity = totals[0] > borrowed ? totals[0] - borrowed : 0n
  }
  return { blockNumber, blockTime: block.timestamp, lltv: p.lltv, loanToken: p.loanToken, collateralToken: p.collateralToken, loanDecimals, collateralDecimals, price, liquidity, borrowRate }
}
