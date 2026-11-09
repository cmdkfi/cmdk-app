import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeFunctionData, getAbiItem, toFunctionSelector } from 'viem'
import { V } from '../vectors.mjs'
import { erc20Abi, executorAbi, wethAbi } from './abi.ts'
import { sendEth, transferToken, wrapEth } from '../wallet/tx.ts'
import { feedsFresh, marketId } from './reads.ts'

const selector = (abi, name) => toFunctionSelector(getAbiItem({ abi, name })).slice(2)

test('selectors of our fragments and of viem\'s erc20Abi equal the ones the protocol pins (chain.rs, evm.rs)', () => {
  const s = V.SELECTORS
  assert.equal(selector(executorAbi, 'corridors'), s.corridors)
  assert.equal(selector(executorAbi, 'config'), s.config)
  assert.equal(selector(executorAbi, 'soldInWindow'), s.soldInWindow)
  assert.equal(selector(executorAbi, 'closedForAgent'), s.closedForAgent)
  assert.equal(selector(erc20Abi, 'transfer'), s.transfer)
})

test('wallet transactions: wrap sends value to WETH.deposit; token transfer has no value; zero amounts refused', () => {
  const weth = '0x4200000000000000000000000000000000000006', usdc = '0x036CbD53842c5426634e7929541eC2318f3dCF7e', to = '0x' + '19'.repeat(20)
  const wrap = wrapEth(weth, 5n)
  assert.equal(wrap.to, weth); assert.equal(wrap.value, 5n)
  assert.equal(decodeFunctionData({ abi: wethAbi, data: wrap.data }).functionName, 'deposit')
  const t = transferToken(usdc, to, 7n)
  assert.equal(t.data.slice(2, 10), V.SELECTORS.transfer)
  assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: t.data }).args, [to, 7n])
  assert.equal(t.value, 0n)
  assert.deepEqual(sendEth(to, 3n), { to, data: '0x', value: 3n })
  for (const make of [() => wrapEth(weth, 0n), () => transferToken(usdc, to, 0n), () => sendEth(to, 0n)]) assert.throws(make)
})

test('market id is keccak256(abi.encode(MarketParams)) — the published live market id', () => {
  // deployments/testnet.json base.markets.live (cmdkfi/app 47fd4fb)
  const live = { loanToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', collateralToken: '0x4200000000000000000000000000000000000006', oracle: '0x7D0ebc71EBBEC6F215C2Ab818F9dB538A52f6a3E', irm: '0x46415998764C29aB2a25CbeA6254146D50D22687', lltv: 860000000000000000n }
  assert.equal(marketId(live), '0xa25ac5171b7e500b82653d3750b91bb44e2409c32ca3c9e80b0db077e8a4535c')
})

test('feed freshness mirrors Executor._requireFresh: answer > 0 and block time ≤ updatedAt + maxAge', () => {
  const feed = (answer, updatedAt, maxAge = 1200) => ({ feed: '0x' + '01'.repeat(20), maxAge, answer, updatedAt })
  assert.equal(feedsFresh({ blockTime: 10_000n, feeds: [feed(1n, 8_800n)] }), true)
  assert.equal(feedsFresh({ blockTime: 10_001n, feeds: [feed(1n, 8_800n)] }), false)
  assert.equal(feedsFresh({ blockTime: 10_000n, feeds: [feed(0n, 9_999n)] }), false)
  assert.equal(feedsFresh({ blockTime: 10_000n, feeds: [feed(null, null)] }), false)
  assert.equal(feedsFresh({ blockTime: 10_000n, feeds: [] }), true)
})

