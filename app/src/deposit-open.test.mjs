import assert from 'node:assert/strict'
import test from 'node:test'
import { openMessage, openQuote, parseWethAmount, validDepositTarget, WETH } from './deposit-open.ts'

const config = { near: { factory: 'factory.testnet' }, createVault: { markets: [{ id: `0x${'1'.repeat(64)}` }] } }

test('open quote follows market integer math and blocks insufficient liquidity', () => {
  const collateral = 2n * 10n ** 18n
  const oracle = 2500n * 10n ** 24n
  const quote = openQuote(collateral, 0n, 0n, oracle, 500_000_000_000_000_000n, 10_000_000_000n, 0n)
  assert.equal(quote.borrowed, 2_499_999_998n)
  assert.equal(quote.enoughLiquidity, true)
  assert.equal(openQuote(collateral, 0n, 0n, oracle, 500_000_000_000_000_000n, 10_000_000n, 0n).enoughLiquidity, false)
})

test('WETH amount and published position checks reject unsafe inputs', () => {
  assert.equal(parseWethAmount('0.01'), 10n ** 16n)
  assert.throws(() => parseWethAmount('0'))
  assert.throws(() => parseWethAmount('1e3'))
  assert.equal(validDepositTarget('0x1111111111111111111111111111111111111111', WETH, '0x2222222222222222222222222222222222222222'), true)
  assert.equal(validDepositTarget('0x1111111111111111111111111111111111111111', '0x3333333333333333333333333333333333333333', '0x2222222222222222222222222222222222222222'), false)
})

test('open message uses the signed owner-call field order and WAD units', () => {
  const text = openMessage('v1.factory.testnet', 2, 1000, config, `0x${'1'.repeat(64)}`, 10n ** 16n, 500_000_000_000_000_000n)
  assert.equal(text, `{"protocol":"cmdk-vault/1","network":"testnet","vault":"v1.factory.testnet","method":"open","args":{"market":"0x${'1'.repeat(64)}","collateral_in":"10000000000000000","target_ltv":"500000000000000000"},"nonce":2,"expiry":1000}`)
  assert.throws(() => openMessage('v2.wrong.testnet', 2, 1000, config, `0x${'1'.repeat(64)}`, 1n, 500_000_000_000_000_000n))
})
