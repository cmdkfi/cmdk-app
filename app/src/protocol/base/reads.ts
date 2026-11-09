// Base Sepolia reads, every set at one pinned block (scripts/VERIFY.md §2 step 2). ABIs: ./abi.ts.
import { createPublicClient, encodeAbiParameters, encodeFunctionData, http, keccak256, type PublicClient } from 'viem'
import { baseSepolia } from 'viem/chains'
import { publicActionsL2 } from 'viem/op-stack'
import type { VaultState } from '../near/vault.ts'
import type { SetupFact } from '../owner/message.ts'
import { chainlinkAbi, erc20Abi, executorAbi, irmAbi, morphoAbi, oracleAbi, wethAbi } from './abi.ts'
import { accrue, availableLiquidity, collateralValue, ltv, toAssetsUp } from './math.ts'

type Hex = `0x${string}`
const ZERO: Hex = '0x0000000000000000000000000000000000000000'
const BASE_SEPOLIA = 84532

export function baseClient(rpcUrl: string): PublicClient {
  return createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) }) as PublicClient
}

async function pinned(client: PublicClient) {
  if (await client.getChainId() !== BASE_SEPOLIA) throw new Error('The Base RPC is not Base Sepolia.')
  const block = await client.getBlock()
  return { blockNumber: block.number, blockTime: block.timestamp }
}

type Params = { loanToken: Hex; collateralToken: Hex; oracle: Hex; irm: Hex; lltv: bigint }

/** Morpho market id = keccak256(abi.encode(MarketParams)) — the id the protocol registers (Executor.sol config). */
export function marketId(p: Params): Hex {
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }], [p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv]))
}

export type Totals = { totalSupplyAssets: bigint; totalSupplyShares: bigint; totalBorrowAssets: bigint; totalBorrowShares: bigint; lastUpdate: bigint; fee: bigint }

export type MarketRead = {
  blockNumber: bigint
  blockTime: bigint
  id: Hex
  params: Params
  loanDecimals: number
  collateralDecimals: number
  feeds: { feed: Hex; maxAge: number; updatedAt: bigint | null }[]
  totals: Totals | null
  /** Collateral in loan units ×1e36, or null when the oracle read failed. */
  price: bigint | null
  /** Per-second WAD borrow rate, or null when the IRM read failed. */
  borrowRate: bigint | null
  /** Borrow assets accrued to this block (needs totals and rate). */
  borrowAccrued: bigint | null
  liquidity: bigint | null
}

async function totalsAt(client: PublicClient, morpho: Hex, id: Hex, blockNumber: bigint): Promise<Totals> {
  const t = await client.readContract({ address: morpho, abi: morphoAbi, functionName: 'market', args: [id], blockNumber })
  return { totalSupplyAssets: t[0], totalSupplyShares: t[1], totalBorrowAssets: t[2], totalBorrowShares: t[3], lastUpdate: t[4], fee: t[5] }
}

/**
 * One market: Morpho `idToMarketParams` (id recomputed and compared), the Executor's `config` for the same id (its
 * params must equal Morpho's), totals, oracle price, IRM rate and each Chainlink feed's age. A failed price, rate
 * or feed read is null; params, decimals and an id mismatch fail the read.
 */
export async function readMarket(client: PublicClient, m: { morpho: Hex; executor: Hex; id: Hex }, at?: { blockNumber: bigint; blockTime: bigint }): Promise<MarketRead> {
  const { blockNumber, blockTime } = at ?? await pinned(client)
  const [raw, settings] = await Promise.all([
    client.readContract({ address: m.morpho, abi: morphoAbi, functionName: 'idToMarketParams', args: [m.id], blockNumber }),
    client.readContract({ address: m.executor, abi: executorAbi, functionName: 'config', args: [m.id], blockNumber }),
  ])
  const params: Params = { loanToken: raw[0], collateralToken: raw[1], oracle: raw[2], irm: raw[3], lltv: raw[4] }
  if (marketId(params).toLowerCase() !== m.id.toLowerCase()) throw new Error('Morpho market parameters do not match the market id.')
  const e = settings.params
  if (marketId({ loanToken: e.loanToken, collateralToken: e.collateralToken, oracle: e.oracle, irm: e.irm, lltv: e.lltv }).toLowerCase() !== m.id.toLowerCase()) {
    throw new Error('The Executor is configured for different market parameters.')
  }
  const [loanDecimals, collateralDecimals] = await Promise.all([
    client.readContract({ address: params.loanToken, abi: erc20Abi, functionName: 'decimals', blockNumber }),
    client.readContract({ address: params.collateralToken, abi: erc20Abi, functionName: 'decimals', blockNumber }),
  ])
  const [priceRead, totalsRead, ...feedReads] = await Promise.allSettled([
    client.readContract({ address: params.oracle, abi: oracleAbi, functionName: 'price', blockNumber }),
    totalsAt(client, m.morpho, m.id, blockNumber),
    ...settings.feeds.map(feed => feed === ZERO ? Promise.reject(new Error('unused')) : client.readContract({ address: feed, abi: chainlinkAbi, functionName: 'latestRoundData', blockNumber })),
  ])
  const totals = totalsRead.status === 'fulfilled' ? totalsRead.value as Totals : null
  const price = priceRead.status === 'fulfilled' && (priceRead.value as bigint) > 0n ? priceRead.value as bigint : null
  let borrowRate: bigint | null = null
  if (totals && params.irm === ZERO) borrowRate = 0n
  else if (totals) {
    borrowRate = await client.readContract({
      address: params.irm, abi: irmAbi, functionName: 'borrowRateView', blockNumber,
      args: [{ loanToken: params.loanToken, collateralToken: params.collateralToken, oracle: params.oracle, irm: params.irm, lltv: params.lltv }, totals],
    }).catch(() => null)
  }
  const borrowAccrued = totals && borrowRate !== null ? accrue(totals.totalBorrowAssets, borrowRate, blockTime > totals.lastUpdate ? blockTime - totals.lastUpdate : 0n) : null
  const feeds = settings.feeds.map((feed, index) => {
    const r = feedReads[index]
    const updatedAt = r && r.status === 'fulfilled' ? (r.value as readonly [bigint, bigint, bigint, bigint, bigint])[3] : null
    return { feed, maxAge: settings.maxAges[index], updatedAt }
  }).filter(f => f.feed !== ZERO)
  return {
    blockNumber, blockTime, id: m.id, params, loanDecimals, collateralDecimals, feeds, totals, price, borrowRate, borrowAccrued,
    liquidity: totals && borrowAccrued !== null ? availableLiquidity(totals.totalSupplyAssets, borrowAccrued) : null,
  }
}

export type SnapshotMarket = {
  id: Hex
  executor: Hex
  collateral: bigint
  borrowShares: bigint
  /** Debt accrued to the read block (stored totals when the rate is unreadable). */
  debt: bigint
  value: bigint | null
  ltv: bigint | null
  lltv: bigint
  corridor: { target: bigint; act: bigint; floor: bigint; sellBudget: bigint; migrateAllowed: boolean; exitAllowed: boolean; set: boolean }
}

export type VaultSnapshot = {
  blockNumber: bigint
  blockTime: bigint
  baseAddress: Hex
  markets: SnapshotMarket[]
  setup: SetupFact[]
  idle: { eth: bigint; weth: bigint; usdc: bigint }
}

/**
 * Everything the app derives a vault's state from, at one block: per market the position (Morpho `position`), its
 * accrued debt, value and LTV, the Base corridor, and the setup facts (Morpho authorization of the market's executor,
 * loan and collateral allowances to it); plus ETH, WETH and USDC idle at the position address.
 */
export async function readVaultSnapshot(client: PublicClient, state: VaultState, tokens: { weth: Hex; usdc: Hex }): Promise<VaultSnapshot> {
  const at = await pinned(client)
  const { blockNumber } = at
  const user = state.base_address
  const markets = await Promise.all(state.markets.map(async vm => {
    const [market, position, corridor, authorized, loanAllowance, collateralAllowance] = await Promise.all([
      readMarket(client, { morpho: state.morpho, executor: vm.executor, id: vm.id }, at),
      client.readContract({ address: state.morpho, abi: morphoAbi, functionName: 'position', args: [vm.id, user], blockNumber }),
      client.readContract({ address: vm.executor, abi: executorAbi, functionName: 'corridors', args: [user, vm.id], blockNumber }),
      client.readContract({ address: state.morpho, abi: morphoAbi, functionName: 'isAuthorized', args: [user, vm.executor], blockNumber }),
      client.readContract({ address: vm.loan_token, abi: erc20Abi, functionName: 'allowance', args: [user, vm.executor], blockNumber }),
      client.readContract({ address: vm.collateral_token, abi: erc20Abi, functionName: 'allowance', args: [user, vm.executor], blockNumber }),
    ])
    if (!market.totals) throw new Error(`Morpho totals for ${vm.id} could not be read.`)
    const borrowAssets = market.borrowAccrued ?? market.totals.totalBorrowAssets
    const debt = toAssetsUp(position[1], borrowAssets, market.totals.totalBorrowShares)
    const value = market.price === null ? null : collateralValue(position[2], market.price)
    const snapshot: SnapshotMarket = {
      id: vm.id, executor: vm.executor, collateral: position[2], borrowShares: position[1], debt, value,
      ltv: value === null ? null : ltv(debt, value), lltv: market.params.lltv,
      corridor: { target: corridor[0], act: corridor[1], floor: corridor[2], sellBudget: corridor[3], migrateAllowed: corridor[4], exitAllowed: corridor[5], set: corridor[6] },
    }
    const fact: SetupFact = { market: vm.id, executor: vm.executor, authorized, loanAllowance, collateralAllowance, corridorSet: corridor[6], lltv: market.params.lltv }
    return { snapshot, fact }
  }))
  const [eth, weth, usdc] = await Promise.all([
    client.getBalance({ address: user, blockNumber }),
    client.readContract({ address: tokens.weth, abi: erc20Abi, functionName: 'balanceOf', args: [user], blockNumber }),
    client.readContract({ address: tokens.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [user], blockNumber }),
  ])
  return { ...at, baseAddress: user, markets: markets.map(m => m.snapshot), setup: markets.map(m => m.fact), idle: { eth, weth, usdc } }
}

export type WalletFunding = { blockNumber: bigint; eth: bigint; weth: bigint; wrapCost: bigint; transferCost: bigint }

/**
 * Wallet ETH and WETH, and an upper-bound cost of one WETH.deposit and one WETH.transfer from this wallet:
 * gas limit × live maxFeePerGas + Base's L1 data fee. The L1 fee uses viem's OP Stack action `estimateL1Fee`
 * (GasPriceOracle.getL1Fee on the serialized transaction, the same call agent/src/chain.rs l.824-834 makes), at the
 * oracle address from the deployment manifest.
 */
export async function readWalletFunding(client: PublicClient, w: { owner: Hex; weth: Hex; gasPriceOracle: Hex; gasLimit: bigint; amount: bigint }): Promise<WalletFunding> {
  const { blockNumber } = await pinned(client)
  const [eth, weth, fees] = await Promise.all([
    client.getBalance({ address: w.owner, blockNumber }),
    client.readContract({ address: w.weth, abi: erc20Abi, functionName: 'balanceOf', args: [w.owner], blockNumber }),
    client.estimateFeesPerGas(),
  ])
  const l2Client = client.extend(publicActionsL2())
  const l1 = (data: Hex, value: bigint) => l2Client.estimateL1Fee({ chain: baseSepolia, account: w.owner, to: w.weth, data, value, gasPriceOracleAddress: w.gasPriceOracle })
  const [wrapL1, transferL1] = await Promise.all([
    l1(encodeFunctionData({ abi: wethAbi, functionName: 'deposit' }), w.amount),
    // The position address may not exist yet; any 20-byte recipient serializes to the same size.
    l1(encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [w.owner, w.amount] }), 0n),
  ])
  const l2 = w.gasLimit * fees.maxFeePerGas
  return { blockNumber, eth, weth, wrapCost: l2 + wrapL1, transferCost: l2 + transferL1 }
}

/** Account code at an address (EOA: empty; EIP-7702 delegated: 0xef0100 ‖ address; contract: bytecode). */
export async function readCode(client: PublicClient, address: Hex): Promise<Hex | undefined> {
  return client.getCode({ address })
}
