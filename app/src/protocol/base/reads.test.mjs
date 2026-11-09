import test from 'node:test'
import assert from 'node:assert/strict'
import { custom, decodeFunctionData, encodeFunctionResult, multicall3Abi, toHex } from 'viem'
import { baseSepolia } from 'viem/chains'
import { chainlinkAbi, erc20Abi, executorAbi, irmAbi, morphoAbi, oracleAbi } from './abi.ts'
import { clientFor, marketId, readMarketStatic, readPositionSnapshot } from './reads.ts'

// A Base node that answers eth_call either directly or through Multicall3 aggregate3, and records every request and
// every inner function name, so the test can count rounds and see which reads a refresh makes.
const ABI = [...morphoAbi, ...executorAbi, ...erc20Abi, ...oracleAbi, ...chainlinkAbi, ...irmAbi]
const ZERO = '0x0000000000000000000000000000000000000000'
const MORPHO = '0x' + '55'.repeat(20), EXECUTOR = '0x' + '44'.repeat(20), IRM = '0x' + '77'.repeat(20), FEED = '0x' + '69'.repeat(20)
const WETH = '0x4200000000000000000000000000000000000006', USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const USER = '0x' + '15'.repeat(20)
const params = oracle => ({ loanToken: USDC, collateralToken: WETH, oracle, irm: IRM, lltv: 86n * 10n ** 16n })
const LIVE = marketId(params('0x' + '66'.repeat(20))), BACKUP = marketId(params('0x' + '68'.repeat(20)))
const paramsOf = id => params(id === LIVE ? '0x' + '66'.repeat(20) : '0x' + '68'.repeat(20))
const HEAD = 30_000_000n, NOW = 2_000_000_000n

function node() {
  const requests = [], inner = [], pin = { on: false }
  const answer = (to, data) => {
    // viem sends getBalance through the same aggregate3 as Multicall3's own getEthBalance
    if (to.toLowerCase() === baseSepolia.contracts.multicall3.address.toLowerCase()) {
      const m = decodeFunctionData({ abi: multicall3Abi, data })
      inner.push(m.functionName)
      return encodeFunctionResult({ abi: multicall3Abi, functionName: m.functionName, result: 0n })
    }
    const d = decodeFunctionData({ abi: ABI, data })
    inner.push(d.functionName)
    const [a0] = d.args ?? []
    const r = {
      idToMarketParams: () => { const p = paramsOf(a0); return [p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv] },
      config: () => ({ params: paramsOf(a0), pool: ZERO, feeds: [FEED, ZERO], maxAges: [1200, 0] }),
      decimals: () => (to.toLowerCase() === USDC.toLowerCase() ? 6 : 18),
      market: () => [10_000n * 10n ** 6n, 10_000n * 10n ** 6n, 2_000n * 10n ** 6n, 2_000n * 10n ** 6n, NOW, 0n],
      price: () => 3200n * 10n ** 24n,
      latestRoundData: () => [1n, 3200n * 10n ** 8n, 0n, NOW - 10n, 1n],
      borrowRateView: () => 1_585_489_600n,
      position: () => [0n, a0 === LIVE ? 160_080_000n : 0n, a0 === LIVE ? 10n ** 17n : 0n],
      corridors: () => [5n * 10n ** 17n, 7n * 10n ** 17n, 3n * 10n ** 17n, 2n * 10n ** 17n, true, true, true],
      closedForAgent: () => false,
      soldInWindow: () => 0n,
      balanceOf: () => 0n,
    }[d.functionName]
    return encodeFunctionResult({ abi: ABI, functionName: d.functionName, result: r() })
  }
  const transport = custom({
    async request({ method, params: p }) {
      requests.push(method)
      if (method === 'eth_chainId') return toHex(baseSepolia.id)
      if (method === 'eth_getBalance') return '0x0'
      if (method === 'eth_getBlockByNumber') return { number: toHex(HEAD), hash: '0x' + '77'.repeat(32), parentHash: '0x' + '76'.repeat(32), timestamp: toHex(NOW), baseFeePerGas: '0x1', gasLimit: '0x1', gasUsed: '0x0', transactions: [], uncles: [], logsBloom: '0x' + '00'.repeat(256), miner: ZERO, difficulty: '0x0', extraData: '0x', nonce: '0x0000000000000000', sha3Uncles: '0x' + '00'.repeat(32), stateRoot: '0x' + '00'.repeat(32), transactionsRoot: '0x' + '00'.repeat(32), receiptsRoot: '0x' + '00'.repeat(32), size: '0x1' }
      if (method === 'eth_call') {
        const [call, block] = p
        if (pin.on) assert.equal(block, toHex(HEAD), 'every refresh read is pinned to the block read first')
        if (call.to.toLowerCase() !== baseSepolia.contracts.multicall3.address.toLowerCase()) return answer(call.to, call.data)
        const { args: [calls] } = decodeFunctionData({ abi: multicall3Abi, data: call.data })
        return encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: calls.map(c => ({ success: true, returnData: answer(c.target, c.callData) })) })
      }
      throw new Error(`unexpected ${method}`)
    },
  })
  return { client: clientFor(transport), requests, inner, pin }
}

const state = { owner: '0x' + '19'.repeat(20), owner_nonce: 3, base_address: USER, morpho: MORPHO, markets: [LIVE, BACKUP].map(id => ({ id, loan_token: USDC, collateral_token: WETH, executor: EXECUTOR, previous_executors: [], slice_max: '1', corridor_set: true })) }

test('§9 1-2: an S5 refresh reads no static data and needs the block read plus two batched eth_calls (Multicall3)', async () => {
  const n = node()
  const statics = await Promise.all([LIVE, BACKUP].map(id => readMarketStatic(n.client, { morpho: MORPHO, executor: EXECUTOR, id })))
  assert.deepEqual(statics.map(s => s.feeds), [[{ feed: FEED, maxAge: 1200 }], [{ feed: FEED, maxAge: 1200 }]])
  n.requests.length = 0; n.inner.length = 0; n.pin.on = true // static data is read once at `latest`; a refresh is pinned
  const snap = await readPositionSnapshot(n.client, state, { weth: WETH, usdc: USDC }, statics)
  // no static read on a refresh
  for (const name of ['idToMarketParams', 'config', 'decimals']) assert.ok(!n.inner.includes(name), `${name} read on a refresh`)
  // one block pin and two aggregate3 rounds (moving reads with the ETH balance; then the IRM rates that take the totals)
  assert.deepEqual(n.requests, ['eth_getBlockByNumber', 'eth_call', 'eth_call'])
  assert.deepEqual([...new Set(n.inner)].sort(), ['balanceOf', 'borrowRateView', 'closedForAgent', 'corridors', 'getEthBalance', 'latestRoundData', 'market', 'position', 'price', 'soldInWindow'])
  // the numbers are the same as an unbatched read gives: 160.000001 USDC of debt on the live market at 50% LTV
  assert.equal(snap.blockNumber, HEAD)
  assert.equal(snap.markets[0].debt, 160_000_001n)
  assert.equal(snap.markets[0].ltv, 500_000_003_125_000_000n) // 160.000001 / 320 USDC, rounded up
  assert.equal(snap.setup.length, 0) // setup facts are not part of the S5 refresh
})
