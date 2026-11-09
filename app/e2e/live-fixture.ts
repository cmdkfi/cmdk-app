// Browser-test backend sized to the protocol layer (PRD §8b, R11): a fake MetaMask (EIP-1193 + EIP-6963), Base
// JSON-RPC, NEAR RPC and the relayer as JSON fakes. Its ABI fragments are its own copies from the same cmdkfi/app
// sources (47fd4fb) as app/src/protocol/base/abi.ts, so an app ABI mistake cannot pass by agreeing with itself.
// Any request to another host, or an unknown method, is recorded and fails the test.
import { readFileSync } from 'node:fs'
import { test as base, expect, type BrowserContext } from '@playwright/test'
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, hexToString, keccak256, parseAbi, recoverMessageAddress, toHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { guidedValues } from '../scripts/guided-values.mjs'

const owner = privateKeyToAccount(('0x' + '11'.repeat(32)) as Hex)
export const OWNER = owner.address
export const OTHER = ('0x' + 'cd'.repeat(20)) as Hex
export const BASE = ('0x' + '15'.repeat(20)) as Hex // the vault's position address
export const FACTORY = 'factory.fixture.testnet'
const MORPHO = ('0x' + '55'.repeat(20)) as Hex, EXECUTOR = ('0x' + '44'.repeat(20)) as Hex, IRM = ('0x' + '77'.repeat(20)) as Hex
const ORACLE = ('0x' + '66'.repeat(20)) as Hex, BACKUP_ORACLE = ('0x' + '68'.repeat(20)) as Hex, FEED = ('0x' + '69'.repeat(20)) as Hex
const WETH = '0x4200000000000000000000000000000000000006' as Hex, USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Hex
const GAS_ORACLE = '0x420000000000000000000000000000000000000F' as Hex, ZERO = '0x0000000000000000000000000000000000000000' as Hex
const LLTV = 860000000000000000n
const NOW = 2_000_000_000
const pct = (n: number) => BigInt(n) * 10n ** 16n
const idOf = (p: readonly [Hex, Hex, Hex, Hex, bigint]) => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }], p))
const LIVE_PARAMS = [USDC, WETH, ORACLE, IRM, LLTV] as const, BACKUP_PARAMS = [USDC, WETH, BACKUP_ORACLE, IRM, LLTV] as const
export const LIVE = idOf(LIVE_PARAMS), BACKUP = idOf(BACKUP_PARAMS)
export const MEASUREMENT = { mrtd: 'ab'.repeat(48), rtmr0: 'bc'.repeat(48), rtmr1: 'cd'.repeat(48), rtmr2: 'de'.repeat(48), compose_hash: 'ef'.repeat(32), os_image_hash: 'fa'.repeat(32) }

const ABI = parseAbi([
  // executor/src/Interfaces.sol l.15-30
  'function position(bytes32 id, address user) view returns (uint256, uint128, uint128)',
  'function market(bytes32 id) view returns (uint128, uint128, uint128, uint128, uint128, uint128)',
  'function isAuthorized(address, address) view returns (bool)',
  // agent/src/chain.rs l.350
  'function idToMarketParams(bytes32 id) view returns (address, address, address, address, uint256)',
  // Interfaces.sol l.53
  'function price() view returns (uint256)',
  // agent/src/chain.rs l.481
  'function borrowRateView((address,address,address,address,uint256), (uint128,uint128,uint128,uint128,uint128,uint128)) view returns (uint256)',
  // Executor.sol l.15-20, l.438
  'struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }',
  'struct MarketConfig { MarketParams params; address pool; address[2] feeds; uint32[2] maxAges; }',
  'function config(bytes32 id) view returns (MarketConfig)',
  // Executor.sol l.65 (Corridor getter, l.22-32)
  'function corridors(address, bytes32) view returns (uint64, uint64, uint64, uint64, bool, bool, bool)',
  // Interfaces.sol l.83-86; TestToken.sol l.8
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address, address) view returns (uint256)',
  'function transfer(address, uint256) returns (bool)',
  'function decimals() view returns (uint8)',
  // scripts/rebalance_pool.py l.349
  'function deposit() payable',
  // agent/src/chain.rs l.824-834
  'function getL1Fee(bytes) view returns (uint256)',
  // executor/src/Interfaces.sol l.56-61
  'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)',
  // executor/src/Executor.sol l.453 and l.67 (public mapping)
  'function soldInWindow(address user, address token) view returns (uint256)',
  'function closedForAgent(address user, bytes32 id) view returns (bool)',
])

// Multicall3 (github.com/mds1/multicall, Multicall3.sol): viem's multicall batching sends readContract calls as one
// aggregate3, and getBalance as getEthBalance inside it. The fixture answers each inner call with its own handlers
// above, so an app ABI mistake still cannot pass by agreeing with itself.
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const MULTICALL = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
  'function getEthBalance(address addr) view returns (uint256 balance)',
])

// Events the fixture emits as logs: executor/src/Executor.sol l.80-97; ERC-20 Transfer (executor/src/TestToken.sol, WETH9).
const EVENTS = parseAbi([
  'struct Corridor { uint64 target; uint64 act; uint64 floor; uint64 sellBudget; bool migrateAllowed; bool exitAllowed; bool set; }',
  'event CorridorSet(address indexed caller, bytes32 indexed market, Corridor corridor)',
  'event Opened(address indexed caller, bytes32 indexed market, uint256 collateralIn, uint256 borrowed, uint256 ltv)',
  'event Reduced(address indexed caller, bytes32 indexed market, uint256 repaid, uint256 collateralSold, uint256 ltvBefore, uint256 ltvAfter, bool protective)',
  'event Repaid(address indexed caller, bytes32 indexed market, uint256 repaid)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])
type FixtureLog = { address: Hex; topics: Hex[]; data: Hex; blockNumber: bigint; transactionHash: Hex; logIndex: number }

/** One log of `EVENTS` at `blockNumber`, encoded as a node would return it. */
export function fixtureLog(address: Hex, eventName: 'CorridorSet' | 'Opened' | 'Reduced' | 'Repaid' | 'Transfer', args: Record<string, unknown>, blockNumber: bigint, logIndex = 0): FixtureLog {
  const item = EVENTS.find(e => e.type === 'event' && e.name === eventName)! as Extract<(typeof EVENTS)[number], { type: 'event' }>
  const topics = encodeEventTopics({ abi: EVENTS, eventName, args } as never) as Hex[]
  const unindexed = (item.inputs as readonly { indexed?: boolean; name?: string; type: string }[]).filter(i => !i.indexed)
  const data = unindexed.length ? encodeAbiParameters(unindexed as never, unindexed.map(i => args[i.name!]) as never) : '0x'
  return { address, topics, data, blockNumber, transactionHash: keccak256(toHex(`fixture-log-${eventName}-${blockNumber}-${logIndex}`)), logIndex }
}
export const HEAD = 30_000_100n, DEPLOY = 30_000_001n
export const ADDRESSES = { WETH, USDC, EXECUTOR, MORPHO, NOW, HEAD, DEPLOY }

export type VaultFixture = {
  owner: Hex
  ownerNonce: number
  collateral: bigint
  borrowShares: bigint
  idle: { eth: bigint; weth: bigint; usdc: bigint }
  authorized: boolean
  loanAllowance: bigint
  collateralAllowance: bigint
  corridorSet: boolean
  approved: typeof MEASUREMENT | null
}

export function vault(overrides: Partial<VaultFixture> = {}): VaultFixture {
  return { owner: OWNER, ownerNonce: 3, collateral: 10n ** 17n, borrowShares: 0n, idle: { eth: 5n * 10n ** 15n, weth: 0n, usdc: 0n }, authorized: true, loanAllowance: (1n << 256n) - 1n, collateralAllowance: (1n << 256n) - 1n, corridorSet: true, approved: MEASUREMENT, ...overrides }
}

const appValues = JSON.parse(readFileSync(new URL('../config.app.json', import.meta.url), 'utf8'))

export class LiveFixture {
  // wallet knobs
  chain = '0x14a34'; switchUnknown = false; rejectConnect = false; rejectSign = false
  code: 'plain' | 'delegated' | 'contract' = 'plain'
  wallet = { eth: 10n ** 18n, weth: 0n, usdc: 0n }
  // protocol knobs
  factoryCount = 0
  vaults = new Map<number, VaultFixture>()
  unreadVaults = new Set<number>()
  nearRateLimit = false
  price: bigint | null = 3200n * 10n ** 24n
  rate: bigint | null = 1585489600n // simple APR 5.0 %
  supply = 10_000n * 10n ** 6n; borrowed = 2_000n * 10n ** 6n
  l1Fee = 1_000n
  relayerPrimaryDown = false
  // S5 (Phase 4) knobs
  /** Base head; real Base Sepolia heights, because viem's Multicall3 only exists from block 1,059,647. */
  head = HEAD
  /** The Executor deploy block in config.json (where "Load earlier" stops). */
  deployBlock = DEPLOY
  /** Delay before answering Base RPC requests (shows a cached snapshot while the live read is pending). */
  baseDelayMs = 0
  /** Every HTTP request to the Base RPC, NEAR RPC and relayer, with the JSON-RPC methods or path it carried. */
  requests: { host: string; calls: string[] }[] = []
  /** Every Base JSON-RPC call answers with an error (a node outage). */
  baseDown = false
  /** Executor.soldInWindow for the position address. */
  sold = 0n
  logs: FixtureLog[] = []
  /** /agent/vaults rows; null answers 503. */
  agentRows: Record<string, unknown>[] | null = []
  logWindows: [bigint, bigint][] = []
  // S6 (Phase 5)
  closes = 0
  // S4 (Phase 3) knobs
  nearNow = NOW
  feedStale = false
  /** create-vault: 'ok', or 'lose-job' (the vault is created but GET /job answers 404). */
  createMode: 'ok' | 'lose-job' = 'ok'
  /** Per owner-call, consumed in order: 'lose-job' runs the call but forgets the job. */
  ownerCallModes: ('ok' | 'lose-job')[] = []
  /** ETH the relayer float puts at a new vault's position address (relayer check_funds needs `gasNeed`). */
  floatWei = 5n * 10n ** 15n
  gasNeed = 10n ** 15n
  /** Reject one prompt of each listed kind. */
  rejectOnce = new Set<'setup' | 'open' | 'withdraw' | 'close' | 'wrap' | 'transfer'>()
  jobs = new Map<string, Record<string, unknown>>()
  receipts = new Set<string>()
  // records
  walletCalls: string[] = []; signs: string[] = []; txs: { to: string; data: string; value: string }[] = []
  posts: { path: string; body: unknown }[] = []; addChain: unknown[] = []
  hosts = new Set<string>(); unexpected: string[] = []; runtimeErrors: string[] = []; ethCalls: string[] = []
  private connected = false; private added = false; private txCount = 0

  config() {
    const market = (id: Hex) => ({ id, loan_token: USDC, collateral_token: WETH, executor: EXECUTOR, slice_max: '1000000000' })
    return {
      ...guidedValues(appValues, { base: { morpho: MORPHO, executorDeployBlock: Number(this.deployBlock), gasPriceOracle: GAS_ORACLE, tokens: { weth: WETH, usdc: USDC }, chainlink: { ethUsd: { address: FEED, description: 'ETH / USD', maxAgeSeconds: 1200 } } } }),
      baseChainId: 84532, nearNetwork: 'testnet', nearRpcUrl: 'https://near.fixture.test', baseRpcUrl: 'https://base.fixture.test',
      relayerUrl: 'https://relayer.fixture.test', relayerUrlFallback: 'https://fallback.fixture.test', near: { factory: FACTORY },
      marketLabels: { [LIVE.toLowerCase()]: 'live', [BACKUP.toLowerCase()]: 'backup' },
      agent: { measurement: MEASUREMENT, version: '0.1.0', sourceCommit: 'fixture' },
      createVault: { cooldownSecs: 120, depositNear: '2', markets: [market(LIVE), market(BACKUP)] },
    }
  }

  private state(n: number) {
    const v = this.vaults.get(n)
    const nonce = v?.ownerNonce ?? 3
    const m = (id: Hex) => ({ id, loan_token: USDC, collateral_token: WETH, executor: EXECUTOR, previous_executors: [], slice_max: '1000000000', corridor_set: v?.corridorSet ?? false })
    return { owner: v?.owner ?? OTHER, owner_nonce: nonce, signer: 'signer.fixture.testnet', path: 'cmdk-base', base_address: BASE, morpho: MORPHO, cooldown_secs: 120, last_agent_action: 0, markets: [m(LIVE), m(BACKUP)], approved: v?.approved ?? null, agent: { public_key: 'ed25519:' + '2'.repeat(44), expires_at: NOW + 86400 } }
  }

  /** The newest fixture vault: the one whose Base state the app reads (one position address in this fixture). */
  private active(): VaultFixture | undefined {
    return [...this.vaults.entries()].sort((a, b) => b[0] - a[0])[0]?.[1]
  }

  wallet_(method: string, params: unknown[]): { result?: unknown; error?: { code: number; message: string }; emit?: [string, unknown][] } {
    this.walletCalls.push(method)
    switch (method) {
      case 'eth_accounts': return { result: this.connected ? [OWNER] : [] }
      case 'eth_requestAccounts':
        if (this.rejectConnect) { this.rejectConnect = false; return { error: { code: 4001, message: 'User rejected the request.' } } }
        this.connected = true
        return { result: [OWNER] }
      case 'eth_chainId': return { result: this.chain }
      case 'net_version': return { result: String(parseInt(this.chain, 16)) }
      case 'wallet_requestPermissions': return { error: { code: 4200, message: 'Unsupported in the fixture.' } }
      case 'wallet_revokePermissions': this.connected = false; return { result: null, emit: [['accountsChanged', []]] }
      case 'wallet_switchEthereumChain': {
        const chainId = (params[0] as { chainId: string }).chainId
        if (this.switchUnknown && !this.added) return { error: { code: 4902, message: 'Unrecognized chain ID.' } }
        this.chain = chainId
        return { result: null, emit: [['chainChanged', chainId]] }
      }
      case 'wallet_addEthereumChain': {
        const p = params[0] as { chainId: string }
        this.addChain.push(p); this.added = true; this.chain = p.chainId
        return { result: null, emit: [['chainChanged', p.chainId]] }
      }
      case 'personal_sign': {
        const text = hexToString(params[0] as Hex)
        const method = (() => { try { return JSON.parse(text).method as string } catch { return '' } })()
        if (this.rejectSign || this.rejectOnce.has(method as 'setup')) { this.rejectSign = false; this.rejectOnce.delete(method as 'setup'); return { error: { code: 4001, message: 'User rejected the request.' } } }
        this.signs.push(text)
        return { result: 'async-sign' }
      }
      case 'eth_sendTransaction': {
        const tx = params[0] as { to: Hex; data?: Hex; value?: Hex }
        const value = BigInt(tx.value ?? '0x0')
        const kind = tx.data?.startsWith('0xd0e30db0') ? 'wrap' : tx.data && tx.data.length > 10 ? 'transfer' : 'topUp'
        if (kind !== 'topUp' && this.rejectOnce.has(kind)) { this.rejectOnce.delete(kind); return { error: { code: 4001, message: 'User rejected the request.' } } }
        this.txs.push({ to: tx.to, data: tx.data ?? '0x', value: value.toString() })
        if (tx.to.toLowerCase() === WETH.toLowerCase() && tx.data?.startsWith('0xd0e30db0')) { this.wallet.eth -= value; this.wallet.weth += value }
        else if (tx.data && tx.data.length > 10) {
          const d = decodeFunctionData({ abi: ABI, data: tx.data })
          if (d.functionName === 'transfer') {
            const [to, amount] = d.args as [Hex, bigint]
            const key = tx.to.toLowerCase() === WETH.toLowerCase() ? 'weth' : 'usdc'
            this.wallet[key] -= amount
            const v = this.active()
            if (v && to.toLowerCase() === BASE.toLowerCase()) v.idle[key] += amount
          }
        } else {
          this.wallet.eth -= value
          const v = this.active()
          if (v && tx.to.toLowerCase() === BASE.toLowerCase()) v.idle.eth += value
        }
        const hash = keccak256(toHex(`fixture-tx-${++this.txCount}`))
        this.receipts.add(hash)
        return { result: hash }
      }
      case 'eth_estimateGas': case 'eth_blockNumber': case 'eth_getBlockByNumber': case 'eth_getTransactionCount': case 'eth_maxPriorityFeePerGas':
      case 'eth_gasPrice': case 'eth_feeHistory': case 'eth_call': case 'eth_getBalance': case 'eth_getTransactionReceipt':
        // MetaMask answers reads through its own RPC; the fixture answers them like the Base RPC.
        return { result: this.rpc(method, params) }
      default:
        this.unexpected.push(`wallet method ${method}`)
        return { error: { code: 4200, message: `Unsupported wallet method ${method}` } }
    }
  }

  private call(to: string, data: Hex): Hex {
    const d = decodeFunctionData({ abi: ABI, data })
    this.ethCalls.push(d.functionName)
    const args = (d.args ?? []) as readonly unknown[]
    const v = this.active()
    const result = (value: unknown) => encodeFunctionResult({ abi: ABI, functionName: d.functionName as never, result: value as never })
    const target = to.toLowerCase(), isLive = (id: unknown) => String(id).toLowerCase() === LIVE.toLowerCase()
    switch (d.functionName) {
      case 'idToMarketParams': return result(isLive(args[0]) ? LIVE_PARAMS : BACKUP_PARAMS)
      case 'config': { const p = isLive(args[0]) ? LIVE_PARAMS : BACKUP_PARAMS; return result({ params: { loanToken: p[0], collateralToken: p[1], oracle: p[2], irm: p[3], lltv: p[4] }, pool: ZERO, feeds: [FEED, ZERO], maxAges: [1200, 0] }) }
      case 'latestRoundData': return result([1n, 3200n * 10n ** 8n, 0n, BigInt(this.feedStale ? NOW - 5000 : NOW - 10), 1n])
      case 'market': return result([this.supply, this.supply, this.borrowed, this.borrowed, BigInt(NOW), 0n])
      case 'price': return this.price === null ? '0x' : result(this.price)
      case 'borrowRateView': return this.rate === null ? '0x' : result(this.rate)
      case 'decimals': return result(target === USDC.toLowerCase() ? 6 : 18)
      case 'position': return result(isLive(args[0]) && v ? [0n, v.borrowShares, v.collateral] : [0n, 0n, 0n])
      case 'corridors': return result([pct(50), pct(70), pct(30), pct(20), true, true, v?.corridorSet ?? false])
      case 'isAuthorized': return result(v?.authorized ?? false)
      case 'allowance': return result(target === USDC.toLowerCase() ? v?.loanAllowance ?? 0n : v?.collateralAllowance ?? 0n)
      case 'balanceOf': {
        const holder = String(args[0]).toLowerCase(), key = target === WETH.toLowerCase() ? 'weth' : 'usdc'
        if (holder === OWNER.toLowerCase()) return result(this.wallet[key])
        if (holder === BASE.toLowerCase()) return result(v?.idle[key] ?? 0n)
        return result(0n)
      }
      case 'getL1Fee': return result(this.l1Fee)
      case 'soldInWindow': return result(this.sold)
      case 'closedForAgent': return result(false)
      default: throw Error(`Unexpected eth_call ${d.functionName}`)
    }
  }

  private block() {
    return { number: '0x64', hash: '0x' + '77'.repeat(32), parentHash: '0x' + '76'.repeat(32), timestamp: toHex(NOW), baseFeePerGas: '0x3b9aca00', gasLimit: '0x1c9c380', gasUsed: '0x0', transactions: [], uncles: [], logsBloom: '0x' + '00'.repeat(256), miner: ZERO, difficulty: '0x0', extraData: '0x', nonce: '0x0000000000000000', sha3Uncles: '0x' + '00'.repeat(32), stateRoot: '0x' + '00'.repeat(32), transactionsRoot: '0x' + '00'.repeat(32), receiptsRoot: '0x' + '00'.repeat(32), size: '0x1' }
  }

  rpc(method: string, params: unknown[]): unknown {
    switch (method) {
      case 'eth_chainId': return '0x14a34'
      case 'eth_blockNumber': return toHex(this.head)
      case 'eth_getBlockByNumber': {
        const n = params[0] === 'latest' || params[0] === undefined ? this.head : BigInt(params[0] as string)
        return { ...this.block(), number: toHex(n), hash: keccak256(toHex(`block-${n}`)), timestamp: toHex(BigInt(NOW) - (this.head - n) * 2n) }
      }
      case 'eth_getLogs': {
        const f = params[0] as { address: string | string[]; topics: (Hex | null)[]; fromBlock: Hex; toBlock: Hex }
        const addresses = (Array.isArray(f.address) ? f.address : [f.address]).map(a => a.toLowerCase())
        const from = BigInt(f.fromBlock), to = BigInt(f.toBlock)
        if (to - from + 1n > 10_000n) throw Error(`eth_getLogs over ${to - from + 1n} blocks`)
        this.logWindows.push([from, to])
        return this.logs
          .filter(l => addresses.includes(l.address.toLowerCase()) && l.blockNumber >= from && l.blockNumber <= to)
          .filter(l => f.topics.every((t, i) => t === null || l.topics[i]?.toLowerCase() === t.toLowerCase()))
          .map(l => ({ ...l, blockNumber: toHex(l.blockNumber), logIndex: toHex(l.logIndex), blockHash: keccak256(toHex(`block-${l.blockNumber}`)), transactionIndex: '0x0', removed: false }))
      }
      case 'eth_getBalance': { const who = String(params[0]).toLowerCase(); return toHex(who === OWNER.toLowerCase() ? this.wallet.eth : who === BASE.toLowerCase() ? this.active()?.idle.eth ?? 0n : 0n) }
      case 'eth_getCode': return this.code === 'plain' ? '0x' : this.code === 'delegated' ? '0xef0100' + '99'.repeat(20) : '0x6080604052'
      case 'eth_getTransactionCount': return '0x3'
      case 'eth_maxPriorityFeePerGas': return '0x3b9aca00'
      case 'eth_gasPrice': return '0x77359400'
      case 'eth_estimateGas': return '0x186a0'
      case 'eth_feeHistory': return { oldestBlock: '0x63', baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'], gasUsedRatio: [0.5], reward: [['0x3b9aca00']] }
      case 'eth_getTransactionReceipt': {
        const hash = String(params[0])
        if (!this.receipts.has(hash)) return null
        return { transactionHash: hash, transactionIndex: '0x0', blockHash: '0x' + '77'.repeat(32), blockNumber: toHex(this.head - 4n), from: OWNER, to: BASE, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null, logs: [], logsBloom: '0x' + '00'.repeat(256), status: '0x1', type: '0x2' }
      }
      case 'eth_call': {
        const c = params[0] as { to: string; data: Hex }
        if (c.to.toLowerCase() !== MULTICALL3.toLowerCase()) return this.call(c.to, c.data)
        const m = decodeFunctionData({ abi: MULTICALL, data: c.data })
        if (m.functionName !== 'aggregate3') throw Error(`Unexpected Multicall3 call ${m.functionName}`)
        this.ethCalls.push('aggregate3')
        const results = (m.args[0] as readonly { target: Hex; allowFailure: boolean; callData: Hex }[]).map(inner => {
          if (inner.target.toLowerCase() === MULTICALL3.toLowerCase()) {
            const b = decodeFunctionData({ abi: MULTICALL, data: inner.callData })
            if (b.functionName !== 'getEthBalance') throw Error(`Unexpected Multicall3 inner call ${b.functionName}`)
            return { success: true, returnData: encodeFunctionResult({ abi: MULTICALL, functionName: 'getEthBalance', result: BigInt(this.rpc('eth_getBalance', [b.args[0]]) as string) }) }
          }
          const returnData = this.call(inner.target, inner.callData)
          return { success: returnData !== '0x', returnData }
        })
        return encodeFunctionResult({ abi: MULTICALL, functionName: 'aggregate3', result: results })
      }
      default: throw Error(`Unexpected Base RPC ${method}`)
    }
  }

  near(body: { id: unknown; method?: string; params: Record<string, string> }): { status?: number; json?: unknown; headers?: Record<string, string> } {
    const p = body.params
    const ok = (result: unknown) => ({ json: { jsonrpc: '2.0', id: body.id, result } })
    const value = (v: unknown) => ok({ result: [...Buffer.from(JSON.stringify(v))], block_height: 1, block_hash: 'fixture' })
    if (this.nearRateLimit) return { status: 429, headers: { 'Retry-After': '3', 'Access-Control-Expose-Headers': 'Retry-After' } }
    if (p.request_type === 'call_function' && p.account_id === FACTORY && p.method_name === 'get_config') return value({ code_hash: 'fixturecodehash', signer: 'signer.fixture.testnet', path: 'cmdk-base', morpho: MORPHO, count: this.factoryCount })
    const match = /^v(\d+)\./.exec(p.account_id ?? '')
    if (p.request_type === 'call_function' && match && p.method_name === 'get_state') {
      const n = Number(match[1])
      if (this.unreadVaults.has(n)) return { json: { jsonrpc: '2.0', id: body.id, error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT' } } } }
      return value(this.state(n))
    }
    if (body.method === 'block') return ok({ header: { height: 1, hash: 'fixture', timestamp_nanosec: String(BigInt(this.nearNow) * 1_000_000_000n) } })
    if (p.request_type === 'view_account') return ok({ code_hash: '11111111111111111111111111111111', global_contract_hash: 'fixturecodehash', amount: '1' })
    if (p.request_type === 'view_access_key_list') return ok({ keys: [{ public_key: 'ed25519:' + '2'.repeat(44), access_key: { nonce: 1, permission: { FunctionCall: { receiver_id: p.account_id, method_names: ['reduce', 'migrate', 'exit'], allowance: '1' } } } }] })
    throw Error(`Unexpected NEAR query ${JSON.stringify(p)}`)
  }

  /** relayer.py create_vault: the factory makes v<count+1>, the float goes to its position address (RELAYER.md l.73, l.195-206). */
  private createVault(id: string) {
    const n = ++this.factoryCount
    this.vaults.set(n, vault({ collateral: 0n, authorized: false, loanAllowance: 0n, collateralAllowance: 0n, corridorSet: false, approved: null, idle: { eth: this.floatWei, weth: 0n, usdc: 0n } }))
    if (this.createMode === 'ok') this.jobs.set(id, { ok: true, job: id, kind: 'create_vault', stage: 'done', vault: `v${n}.${FACTORY}`, base_address: BASE, near_tx: 'C'.repeat(44) })
  }

  /** Morpho toAssetsUp(borrowShares, totalBorrowAssets, totalBorrowShares) with the fixture's totals. */
  debtOf(v: VaultFixture): bigint {
    const num = v.borrowShares * (this.borrowed + 1n), den = this.borrowed + 1_000_000n
    return (num + den - 1n) / den
  }

  /** relayer.py owner_call: verify message and signature, check gas (check_funds), run the method, advance owner_nonce. */
  private async ownerCall(id: string, body: { vault: string; message: string; signature: Hex }) {
    const n = Number(/^v(\d+)\./.exec(body.vault)?.[1] ?? 0), v = this.vaults.get(n)
    const m = JSON.parse(body.message) as { vault: string; method: string; args: Record<string, string>; nonce: number; expiry: number }
    const signer = await recoverMessageAddress({ message: body.message, signature: body.signature })
    if (!v || signer.toLowerCase() !== v.owner.toLowerCase() || m.vault !== body.vault) throw Error('owner-call with a bad vault or signature')
    if (m.nonce !== v.ownerNonce + 1) throw Error(`owner-call nonce ${m.nonce}, expected ${v.ownerNonce + 1}`)
    if (v.idle.eth < this.gasNeed) {
      this.jobs.set(id, { ok: false, job: id, kind: 'owner_call', stage: 'failed', vault: body.vault, error: `the vault Base address holds ${v.idle.eth} wei, below the ${this.gasNeed} wei the transactions may cost`, http_status: 400 })
      return
    }
    if (m.method === 'close') {
      // relayer.py l.516-529: the vault must hold debt (Morpho stored totals) + debt // 100 of the loan token
      const debt = this.debtOf(v), need = debt + debt / 100n
      if (v.idle.usdc < need) {
        this.jobs.set(id, { ok: false, job: id, kind: 'owner_call', stage: 'failed', vault: body.vault, error: `close: the vault holds ${v.idle.usdc} of the loan token, below the ${need} it pulls (debt plus 1%)`, http_status: 400 })
        return
      }
    }
    v.ownerNonce = m.nonce
    if (m.method === 'close') {
      // Executor.close l.226-240: repay all shares (accrued debt; the fixture's lastUpdate is the block time), release all collateral
      if (String(m.args.market).toLowerCase() !== LIVE.toLowerCase()) throw Error(`close of an unexpected market ${m.args.market}`)
      v.idle.usdc -= this.debtOf(v); v.borrowShares = 0n
      v.idle.weth += v.collateral; v.collateral = 0n
      this.closes++
    }
    if (m.method === 'setup') { v.authorized = true; v.loanAllowance = (1n << 256n) - 1n; v.collateralAllowance = (1n << 256n) - 1n; v.corridorSet = true; v.approved = MEASUREMENT }
    if (m.method === 'open') {
      const collateralIn = BigInt(m.args.collateral_in), target = BigInt(m.args.target_ltv)
      v.idle.weth -= collateralIn; v.collateral += collateralIn
      const borrowed = v.collateral * (this.price ?? 0n) / 10n ** 36n * target / 10n ** 18n - 2n
      v.borrowShares += borrowed; v.idle.usdc += borrowed
    }
    if (m.method === 'withdraw') {
      const amount = BigInt(m.args.amount), key = String(m.args.token).toLowerCase() === WETH.toLowerCase() ? 'weth' : 'usdc'
      if (v.idle[key] < amount) throw Error(`withdraw of ${amount} ${key} above the idle ${v.idle[key]}`)
      v.idle[key] -= amount; this.wallet[key] += amount
    }
    const hash = keccak256(toHex(`fixture-owner-call-${id}`))
    this.receipts.add(hash)
    v.idle.eth -= 10n ** 14n
    if ((this.ownerCallModes.shift() ?? 'ok') === 'ok') this.jobs.set(id, { ok: true, job: id, kind: 'owner_call', stage: 'done', vault: body.vault, near_tx: 'N'.repeat(44), receipts: [{ hash, status: 1 }] })
  }

  relayer(method: string, path: string, body: unknown): { status: number; json: unknown; after?: () => void | Promise<void> } {
    if (method === 'GET' && path === '/health') return { status: 200, json: { ok: true, chain_id: 84532, near_network: 'testnet', factory: FACTORY, factory_exists: true, eth_float_wei: '5000000000000000' } }
    if (method === 'GET' && path === '/agent/vaults') return this.agentRows ? { status: 200, json: { boot: 'boot-fixture', operator: 'cmdk', vaults: this.agentRows } } : { status: 503, json: { ok: false } }
    if (method === 'GET' && path.startsWith('/job/')) {
      const job = this.jobs.get(path.slice(5))
      return job ? { status: 200, json: job } : { status: 404, json: { ok: false, error: 'no such job' } }
    }
    if (method === 'POST' && (path === '/create-vault' || path === '/owner-call')) {
      this.posts.push({ path, body })
      const id = keccak256(toHex(`job-${this.posts.length}`)).slice(2, 18)
      return { status: 202, json: { ok: true, job: id }, after: path === '/create-vault' ? () => this.createVault(id) : () => this.ownerCall(id, body as { vault: string; message: string; signature: Hex }) }
    }
    throw Error(`Unexpected relayer ${method} ${path}`)
  }

  async install(context: BrowserContext) {
    context.on('page', page => page.on('pageerror', error => this.runtimeErrors.push(error.message)))
    context.on('request', request => this.hosts.add(new URL(request.url()).host))
    await context.exposeBinding('__liveFixtureWallet', async (_source, method: string, params: unknown[]) => {
      const answer = this.wallet_(method, params ?? [])
      if (answer.result === 'async-sign') return { result: await owner.signMessage({ message: { raw: (params as Hex[])[0] } }) }
      return answer
    })
    await context.addInitScript(() => {
      const listeners = new Map<string, Set<(value: unknown) => void>>()
      const emit = (name: string, value: unknown) => listeners.get(name)?.forEach(fn => fn(value))
      const call = (window as unknown as { __liveFixtureWallet: (m: string, p: unknown[]) => Promise<{ result?: unknown; error?: { code: number; message: string }; emit?: [string, unknown][] }> }).__liveFixtureWallet
      const provider = {
        isMetaMask: true,
        on(name: string, fn: (value: unknown) => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn) },
        removeListener(name: string, fn: (value: unknown) => void) { listeners.get(name)?.delete(fn) },
        async request({ method, params = [] }: { method: string; params?: unknown[] }) {
          const answer = await call(method, params)
          if (answer.error) throw Object.assign(new Error(answer.error.message), { code: answer.error.code })
          answer.emit?.forEach(([name, value]) => emit(name, value))
          return answer.result
        },
      }
      Object.defineProperty(window, 'ethereum', { value: provider, configurable: true })
      Object.assign(window, { fixtureEmit: emit })
      window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: '4d2224fe-9aae-4a71-8d77-555555555555', name: 'MetaMask (fixture)', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'io.metamask' }, provider } })))
    })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      try {
        if (url.host === 'localhost:5177') {
          if (url.pathname === '/config.json') return route.fulfill({ json: this.config() })
          return route.continue()
        }
        if (['base.fixture.test', 'sepolia.base.org'].includes(url.host) && request.method() === 'POST') {
          const data = request.postDataJSON()
          this.requests.push({ host: url.host, calls: (Array.isArray(data) ? data : [data]).map((r: { method: string }) => r.method) })
          if (this.baseDelayMs) await new Promise(resolve => setTimeout(resolve, this.baseDelayMs))
          const one = (r: { id: unknown; method: string; params: unknown[] }) => (this.baseDown
            ? { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: 'fixture: the Base node is down' } }
            : { jsonrpc: '2.0', id: r.id, result: this.rpc(r.method, r.params ?? []) })
          return route.fulfill({ json: Array.isArray(data) ? data.map(one) : one(data) })
        }
        if (url.host === 'near.fixture.test' && request.method() === 'POST') {
          const body = request.postDataJSON()
          this.requests.push({ host: url.host, calls: [`${body.method}:${body.params?.request_type ?? ''}:${body.params?.method_name ?? ''}`] })
          const answer = this.near(body)
          return route.fulfill({ status: answer.status ?? 200, headers: answer.headers, json: answer.json ?? {} })
        }
        if (url.host === 'relayer.fixture.test' || url.host === 'fallback.fixture.test') {
          if (url.host === 'relayer.fixture.test' && this.relayerPrimaryDown) return route.abort('failed')
          if (request.method() === 'POST' && url.host !== 'relayer.fixture.test') throw Error('POST sent to the relayer fallback')
          this.requests.push({ host: url.host, calls: [`${request.method()} ${url.pathname}`] })
          const answer = this.relayer(request.method(), url.pathname, request.method() === 'POST' ? request.postDataJSON() : undefined)
          await answer.after?.()
          return route.fulfill({ status: answer.status, json: answer.json })
        }
        throw Error(`External request blocked: ${request.method()} ${url.href}`)
      } catch (error) {
        this.unexpected.push(String(error))
        return route.abort('failed')
      }
    })
  }
}

export const test = base.extend<{ fx: LiveFixture }>({
  fx: async ({}, use) => {
    const fixture = new LiveFixture()
    await use(fixture)
    expect(fixture.unexpected, 'Unhandled or forbidden requests').toEqual([])
    expect(fixture.runtimeErrors, 'Browser runtime errors').toEqual([])
  },
})
export { expect }
