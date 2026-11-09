// Base Sepolia reads, every set at one pinned block (scripts/VERIFY.md §2 step 2). ABIs: ./abi.ts.
import { createPublicClient, encodeAbiParameters, encodeFunctionData, http, keccak256, type PublicClient, type Transport } from 'viem'
import { baseSepolia } from 'viem/chains'
import { publicActionsL2 } from 'viem/op-stack'
import type { VaultState } from '../near/vault.ts'
import type { SetupFact } from '../owner/message.ts'
import { chainlinkAbi, erc20Abi, executorAbi, irmAbi, morphoAbi, oracleAbi, wethAbi } from './abi.ts'
import { accrue, availableLiquidity, collateralValue, ltv, remainingSellBudget, toAssetsUp } from './math.ts'

type Hex = `0x${string}`
const ZERO: Hex = '0x0000000000000000000000000000000000000000'
const BASE_SEPOLIA = 84532

/**
 * A Base Sepolia client with viem's multicall batching (readContract calls issued in the same tick and at the same
 * block go through Multicall3 aggregate3 at viem's `baseSepolia.contracts.multicall3`) and JSON-RPC batching on
 * the transport (concurrent requests share one HTTP request). One client per RPC URL, so batches can form across
 * the reads of one refresh (PRD §9 "Reads and caching" 1).
 */
export function clientFor(transport: Transport): PublicClient {
  return createPublicClient({ chain: baseSepolia, transport, batch: { multicall: true } }) as PublicClient
}

const clients = new Map<string, PublicClient>()
export function baseClient(rpcUrl: string): PublicClient {
  let client = clients.get(rpcUrl)
  if (!client) { client = clientFor(http(rpcUrl, { batch: true })); clients.set(rpcUrl, client) }
  return client
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

/**
 * Deployment data of one market that does not move (PRD §9 2): Morpho `idToMarketParams` (id recomputed and
 * compared), the Executor's `config` for the same id (its params must equal Morpho's; its feeds and max ages), and
 * both tokens' decimals. Read once per session for S1 and S5; the onboarding and close chains read it live.
 */
export type MarketStatic = {
  id: Hex
  morpho: Hex
  executor: Hex
  params: Params
  loanDecimals: number
  collateralDecimals: number
  feeds: { feed: Hex; maxAge: number }[]
}

export type MarketRead = {
  blockNumber: bigint
  blockTime: bigint
  id: Hex
  params: Params
  loanDecimals: number
  collateralDecimals: number
  feeds: { feed: Hex; maxAge: number; answer: bigint | null; updatedAt: bigint | null }[]
  totals: Totals | null
  /** Collateral in loan units ×1e36, or null when the oracle read failed. */
  price: bigint | null
  /** Per-second WAD borrow rate, or null when the IRM read failed. */
  borrowRate: bigint | null
  /** Borrow assets accrued to this block (needs totals and rate). */
  borrowAccrued: bigint | null
  liquidity: bigint | null
}

/** Static data of one market; an id mismatch between Morpho and the Executor fails the read. */
export async function readMarketStatic(client: PublicClient, m: { morpho: Hex; executor: Hex; id: Hex }): Promise<MarketStatic> {
  if (await client.getChainId() !== BASE_SEPOLIA) throw new Error('The Base RPC is not Base Sepolia.')
  const [raw, settings] = await Promise.all([
    client.readContract({ address: m.morpho, abi: morphoAbi, functionName: 'idToMarketParams', args: [m.id] }),
    client.readContract({ address: m.executor, abi: executorAbi, functionName: 'config', args: [m.id] }),
  ])
  const params: Params = { loanToken: raw[0], collateralToken: raw[1], oracle: raw[2], irm: raw[3], lltv: raw[4] }
  if (marketId(params).toLowerCase() !== m.id.toLowerCase()) throw new Error('Morpho market parameters do not match the market id.')
  const e = settings.params
  if (marketId({ loanToken: e.loanToken, collateralToken: e.collateralToken, oracle: e.oracle, irm: e.irm, lltv: e.lltv }).toLowerCase() !== m.id.toLowerCase()) {
    throw new Error('The Executor is configured for different market parameters.')
  }
  const [loanDecimals, collateralDecimals] = await Promise.all([
    client.readContract({ address: params.loanToken, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address: params.collateralToken, abi: erc20Abi, functionName: 'decimals' }),
  ])
  const feeds = settings.feeds.map((feed, index) => ({ feed, maxAge: settings.maxAges[index] })).filter(f => f.feed !== ZERO)
  return { id: m.id, morpho: m.morpho, executor: m.executor, params, loanDecimals, collateralDecimals, feeds }
}

/** Round 1 of a market's moving data at a block: totals, oracle price, each feed's latest round. Issued in one tick. */
function movingReads(client: PublicClient, s: MarketStatic, blockNumber: bigint) {
  return Promise.allSettled([
    client.readContract({ address: s.params.oracle, abi: oracleAbi, functionName: 'price', blockNumber }),
    client.readContract({ address: s.morpho, abi: morphoAbi, functionName: 'market', args: [s.id], blockNumber }),
    ...s.feeds.map(f => client.readContract({ address: f.feed, abi: chainlinkAbi, functionName: 'latestRoundData', blockNumber })),
  ])
}

/** Round 2 (needs the totals): the IRM's borrowRateView; zero IRM is rate 0; a failed read is null. */
async function rateRead(client: PublicClient, s: MarketStatic, totals: Totals | null, blockNumber: bigint): Promise<bigint | null> {
  if (!totals) return null
  if (s.params.irm === ZERO) return 0n
  return client.readContract({
    address: s.params.irm, abi: irmAbi, functionName: 'borrowRateView', blockNumber,
    args: [{ loanToken: s.params.loanToken, collateralToken: s.params.collateralToken, oracle: s.params.oracle, irm: s.params.irm, lltv: s.params.lltv }, totals],
  }).catch(() => null)
}

function marketFrom(s: MarketStatic, at: { blockNumber: bigint; blockTime: bigint }, round1: PromiseSettledResult<unknown>[], borrowRate: bigint | null): MarketRead {
  const [priceRead, totalsRead, ...feedReads] = round1
  const t = totalsRead.status === 'fulfilled' ? totalsRead.value as readonly bigint[] : null
  const totals: Totals | null = t ? { totalSupplyAssets: t[0], totalSupplyShares: t[1], totalBorrowAssets: t[2], totalBorrowShares: t[3], lastUpdate: t[4], fee: t[5] } : null
  const price = priceRead.status === 'fulfilled' && (priceRead.value as bigint) > 0n ? priceRead.value as bigint : null
  const borrowAccrued = totals && borrowRate !== null ? accrue(totals.totalBorrowAssets, borrowRate, at.blockTime > totals.lastUpdate ? at.blockTime - totals.lastUpdate : 0n) : null
  const feeds = s.feeds.map((f, index) => {
    const r = feedReads[index]
    const round = r && r.status === 'fulfilled' ? r.value as readonly [bigint, bigint, bigint, bigint, bigint] : null
    return { feed: f.feed, maxAge: f.maxAge, answer: round ? round[1] : null, updatedAt: round ? round[3] : null }
  })
  return {
    ...at, id: s.id, params: s.params, loanDecimals: s.loanDecimals, collateralDecimals: s.collateralDecimals, feeds, totals, price, borrowRate, borrowAccrued,
    liquidity: totals && borrowAccrued !== null ? availableLiquidity(totals.totalSupplyAssets, borrowAccrued) : null,
  }
}

/** Static data (given, or read now) plus the moving reads at one block. A failed price, rate or feed read is null. */
export async function readMarket(client: PublicClient, m: { morpho: Hex; executor: Hex; id: Hex }, at?: { blockNumber: bigint; blockTime: bigint }, known?: MarketStatic): Promise<MarketRead> {
  const [s, block] = await Promise.all([known ?? readMarketStatic(client, m), at ?? pinned(client)])
  const round1 = await movingReads(client, s, block.blockNumber)
  const t = round1[1].status === 'fulfilled' ? round1[1].value as readonly bigint[] : null
  const totals = t ? { totalSupplyAssets: t[0], totalSupplyShares: t[1], totalBorrowAssets: t[2], totalBorrowShares: t[3], lastUpdate: t[4], fee: t[5] } : null
  return marketFrom(s, block, round1, await rateRead(client, s, totals, block.blockNumber))
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
  /** Executor.closedForAgent: set by the agent's exit, cleared by open (Executor.sol l.67). */
  closedForAgent: boolean
  collateralToken: Hex
  loanDecimals: number
  collateralDecimals: number
  price: bigint | null
  /** Morpho totals and the IRM rate at the read block (null rate: the IRM read failed); for accrual ahead (close). */
  totals: Totals
  borrowRate: bigint | null
  /** The Executor's configured Chainlink feeds for this market (Executor.config feeds/maxAges, l.15-20). */
  feeds: MarketRead['feeds']
}

/** Remaining daily sell budget of one executor and collateral token (Executor._activeCollateral + CorridorMath.remainingBudget). */
export type SellBudget = { executor: Hex; token: Hex; activeCollateral: bigint; sold: bigint; budgetWad: bigint; remaining: bigint }

export type VaultSnapshot = {
  blockNumber: bigint
  blockTime: bigint
  baseAddress: Hex
  markets: SnapshotMarket[]
  setup: SetupFact[]
  idle: { eth: bigint; weth: bigint; usdc: bigint }
  sellBudgets: SellBudget[]
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * The shared core of a vault snapshot at one block, in two batched rounds: round 1 is every moving read that does not
 * depend on another (per market: totals, price, feeds, Morpho position, Base corridor, closedForAgent, and the setup
 * facts when asked; per executor and collateral token: soldInWindow; balances at the position address); round 2 is
 * the IRM rates, which take the totals as arguments.
 */
async function snapshotAt(client: PublicClient, state: VaultState, tokens: { weth: Hex; usdc: Hex }, statics: MarketStatic[], at: { blockNumber: bigint; blockTime: bigint }, setup: boolean): Promise<VaultSnapshot> {
  const { blockNumber } = at
  const user = state.base_address
  const staticOf = (id: Hex) => {
    const s = statics.find(x => sameAddress(x.id, id))
    if (!s) throw new Error(`No deployment data for market ${id}.`)
    return s
  }
  // One budget per (executor, collateral token), as Executor._activeCollateral groups them (l.504-517).
  const groups = [...new Map(state.markets.map(vm => [`${vm.executor.toLowerCase()}:${staticOf(vm.id).params.collateralToken.toLowerCase()}`, { executor: vm.executor, token: staticOf(vm.id).params.collateralToken }])).values()]
  const round1 = state.markets.map(vm => Promise.all([
    movingReads(client, staticOf(vm.id), blockNumber),
    client.readContract({ address: state.morpho, abi: morphoAbi, functionName: 'position', args: [vm.id, user], blockNumber }),
    client.readContract({ address: vm.executor, abi: executorAbi, functionName: 'corridors', args: [user, vm.id], blockNumber }),
    client.readContract({ address: vm.executor, abi: executorAbi, functionName: 'closedForAgent', args: [user, vm.id], blockNumber }),
    setup ? Promise.all([
      client.readContract({ address: state.morpho, abi: morphoAbi, functionName: 'isAuthorized', args: [user, vm.executor], blockNumber }),
      client.readContract({ address: vm.loan_token, abi: erc20Abi, functionName: 'allowance', args: [user, vm.executor], blockNumber }),
      client.readContract({ address: vm.collateral_token, abi: erc20Abi, functionName: 'allowance', args: [user, vm.executor], blockNumber }),
    ]) : Promise.resolve(null),
  ]))
  const solds = groups.map(g => client.readContract({ address: g.executor, abi: executorAbi, functionName: 'soldInWindow', args: [user, g.token], blockNumber }))
  const balances = Promise.all([
    client.getBalance({ address: user, blockNumber }),
    client.readContract({ address: tokens.weth, abi: erc20Abi, functionName: 'balanceOf', args: [user], blockNumber }),
    client.readContract({ address: tokens.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [user], blockNumber }),
  ])
  const [reads, sold, [eth, weth, usdc]] = await Promise.all([Promise.all(round1), Promise.all(solds), balances])
  const rates = await Promise.all(state.markets.map((vm, index) => {
    const t = reads[index][0][1]
    const v = t.status === 'fulfilled' ? t.value as readonly bigint[] : null
    return rateRead(client, staticOf(vm.id), v ? { totalSupplyAssets: v[0], totalSupplyShares: v[1], totalBorrowAssets: v[2], totalBorrowShares: v[3], lastUpdate: v[4], fee: v[5] } : null, blockNumber)
  }))
  const markets = state.markets.map((vm, index) => {
    const [moving, position, corridor, closed, facts] = reads[index]
    const s = staticOf(vm.id)
    const market = marketFrom(s, at, moving, rates[index])
    if (!market.totals) throw new Error(`Morpho totals for ${vm.id} could not be read.`)
    const borrowAssets = market.borrowAccrued ?? market.totals.totalBorrowAssets
    const debt = toAssetsUp(position[1], borrowAssets, market.totals.totalBorrowShares)
    const value = market.price === null ? null : collateralValue(position[2], market.price)
    const snapshot: SnapshotMarket = {
      id: vm.id, executor: vm.executor, collateral: position[2], borrowShares: position[1], debt, value,
      ltv: value === null ? null : ltv(debt, value), lltv: s.params.lltv,
      corridor: { target: corridor[0], act: corridor[1], floor: corridor[2], sellBudget: corridor[3], migrateAllowed: corridor[4], exitAllowed: corridor[5], set: corridor[6] },
      closedForAgent: closed, collateralToken: s.params.collateralToken, loanDecimals: s.loanDecimals, collateralDecimals: s.collateralDecimals, price: market.price,
      totals: market.totals, borrowRate: market.borrowRate, feeds: market.feeds,
    }
    const fact: SetupFact | null = facts ? { market: vm.id, executor: vm.executor, authorized: facts[0], loanAllowance: facts[1], collateralAllowance: facts[2], corridorSet: corridor[6], lltv: s.params.lltv } : null
    return { snapshot, fact }
  })
  const snapshots = markets.map(m => m.snapshot)
  const sellBudgets = groups.map((g, index) => {
    const active = snapshots.filter(m => sameAddress(m.executor, g.executor) && sameAddress(m.collateralToken, g.token) && m.corridor.set && !m.closedForAgent && m.collateral > 0n)
    const activeCollateral = active.reduce((sum, m) => sum + m.collateral, 0n)
    const budgetWad = active.length ? active.reduce((min, m) => (m.corridor.sellBudget < min ? m.corridor.sellBudget : min), active[0].corridor.sellBudget) : 0n
    return { executor: g.executor, token: g.token, activeCollateral, sold: sold[index], budgetWad, remaining: remainingSellBudget(activeCollateral, sold[index], budgetWad) }
  })
  return { ...at, baseAddress: user, markets: snapshots, setup: markets.flatMap(m => (m.fact ? [m.fact] : [])), idle: { eth, weth, usdc }, sellBudgets }
}

/**
 * Everything the app derives a vault's state from, read live at one block (discovery, the onboarding and close
 * chains): per market the position, its accrued debt, value and LTV, the Base corridor and the setup facts (Morpho
 * authorization of the market's executor, loan and collateral allowances to it); plus ETH, WETH and USDC idle at the
 * position address. Static market data is read here too, never taken from a cache.
 */
export async function readVaultSnapshot(client: PublicClient, state: VaultState, tokens: { weth: Hex; usdc: Hex }): Promise<VaultSnapshot> {
  const [statics, at] = await Promise.all([
    Promise.all(state.markets.map(vm => readMarketStatic(client, { morpho: state.morpho, executor: vm.executor, id: vm.id }))),
    pinned(client),
  ])
  return snapshotAt(client, state, tokens, statics, at, true)
}

/**
 * The S5 refresh (PRD §9 1-2): the same snapshot without setup facts, with static data given (read once per session)
 * and a single block pin, so one refresh is the block read plus two batched rounds. Markets missing from `statics`
 * are read live first.
 */
export async function readPositionSnapshot(client: PublicClient, state: VaultState, tokens: { weth: Hex; usdc: Hex }, statics: MarketStatic[]): Promise<VaultSnapshot> {
  const missing = state.markets.filter(vm => !statics.some(s => sameAddress(s.id, vm.id)))
  const [extra, block] = await Promise.all([
    Promise.all(missing.map(vm => readMarketStatic(client, { morpho: state.morpho, executor: vm.executor, id: vm.id }))),
    client.getBlock(),
  ])
  return snapshotAt(client, state, tokens, [...statics, ...extra], { blockNumber: block.number, blockTime: block.timestamp }, false)
}

/** Latest block number (the head the activity window counts back from). */
export async function readHead(client: PublicClient): Promise<bigint> {
  if (await client.getChainId() !== BASE_SEPOLIA) throw new Error('The Base RPC is not Base Sepolia.')
  return client.getBlockNumber()
}

/** Timestamps of the given blocks (for the activity list). */
export async function readBlockTimes(client: PublicClient, numbers: bigint[]): Promise<Map<bigint, bigint>> {
  const unique = [...new Set(numbers)]
  const blocks = await Promise.all(unique.map(blockNumber => client.getBlock({ blockNumber })))
  return new Map(blocks.map(b => [b.number, b.timestamp]))
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

/**
 * Executor._requireFresh (executor/src/Executor.sol l.481-489): every configured feed must answer > 0 and be no older
 * than its maxAge at the block. An unreadable feed counts as not fresh.
 */
export function feedsFresh(m: Pick<MarketRead, 'feeds' | 'blockTime'>): boolean {
  return m.feeds.every(f => f.answer !== null && f.answer > 0n && f.updatedAt !== null && m.blockTime <= f.updatedAt + BigInt(f.maxAge))
}

export type ReceiptRead = { hash: Hex; status: 'success' | 'reverted' | 'pending'; confirmations: number }

/** Receipt status and confirmation count (FR-5: two confirmations) for each hash; a missing receipt is pending. */
export async function readReceipts(client: PublicClient, hashes: Hex[]): Promise<ReceiptRead[]> {
  const head = await client.getBlockNumber()
  return Promise.all(hashes.map(async hash => {
    const receipt = await client.getTransactionReceipt({ hash }).catch(() => null)
    if (!receipt) return { hash, status: 'pending' as const, confirmations: 0 }
    return { hash, status: receipt.status, confirmations: Number(head - receipt.blockNumber + 1n) }
  }))
}

/** ETH, WETH and USDC held by an address at one block (IERC20.balanceOf, Interfaces.sol l.83). */
export async function readTokenBalances(client: PublicClient, holder: Hex, tokens: { weth: Hex; usdc: Hex }) {
  const { blockNumber } = await pinned(client)
  const [eth, weth, usdc] = await Promise.all([
    client.getBalance({ address: holder, blockNumber }),
    client.readContract({ address: tokens.weth, abi: erc20Abi, functionName: 'balanceOf', args: [holder], blockNumber }),
    client.readContract({ address: tokens.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [holder], blockNumber }),
  ])
  return { blockNumber, eth, weth, usdc }
}

