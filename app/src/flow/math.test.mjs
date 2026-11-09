import test from 'node:test'
import assert from 'node:assert/strict'
import { checkDeposit } from './amount.ts'
import { formatUnits, formatWadPercent } from './format.ts'
import { fundingNeed } from './funding.ts'
import { borrowApy, estimateDeposit, percentToWad } from './quote.ts'

const MIN = 10n ** 15n // 0.001 ETH

test('amount: empty, invalid, below minimum and valid deposits', () => {
  assert.deepEqual(checkDeposit('', MIN), { kind: 'empty' })
  assert.deepEqual(checkDeposit('  ', MIN), { kind: 'empty' })
  for (const text of ['abc', '-1', '1e3', '0', '.5', '1.', '0.0000000000000000001']) assert.equal(checkDeposit(text, MIN).kind, 'invalid', text)
  assert.deepEqual(checkDeposit('0.0009', MIN), { kind: 'below-min' })
  assert.deepEqual(checkDeposit('0.001', MIN), { kind: 'ok', wei: MIN })
  assert.deepEqual(checkDeposit(' 1.5 ', MIN), { kind: 'ok', wei: 15n * 10n ** 17n })
  assert.deepEqual(checkDeposit('1000000', MIN), { kind: 'ok', wei: 10n ** 24n }) // no maximum (D7)
})

// Oracle price: collateral (18 dec) in loan units (6 dec) scaled 1e36 → 3200 USDC per ETH = 3200e6 * 1e36 / 1e18.
const PRICE = 3200n * 10n ** 24n
const HALF = percentToWad(50)

test('estimate: value and borrow at the 50% target from the oracle price', () => {
  const e = estimateDeposit(10n ** 17n, PRICE, 10n ** 12n, HALF) // 0.1 ETH
  assert.equal(e.value, 320_000_000n) // 320 USDC
  assert.equal(e.target, 160_000_000n)
  assert.equal(e.borrow, 160_000_000n)
  assert.equal(e.limited, false)
  assert.equal(e.liquidityKnown, true)
})

test('estimate: insufficient liquidity replaces the target with what the market can lend and the resulting LTV (R2)', () => {
  const e = estimateDeposit(10n ** 17n, PRICE, 80_000_000n, HALF)
  assert.equal(e.limited, true)
  assert.equal(e.borrow, 80_000_000n)
  assert.equal(e.resultingLtv, 25n * 10n ** 16n) // 25%
})

test('estimate: a missing price yields no value and no borrow; missing liquidity is reported, not assumed', () => {
  assert.deepEqual(estimateDeposit(10n ** 17n, null, 10n ** 12n, HALF), { value: null, target: null, borrow: null, limited: false, resultingLtv: null, liquidityKnown: true })
  const e = estimateDeposit(10n ** 17n, PRICE, null, HALF)
  assert.equal(e.borrow, 160_000_000n)
  assert.equal(e.liquidityKnown, false)
})

test('borrow APY from the per-second rate', () => {
  assert.equal(borrowApy(0n), 0)
  const perSecond = BigInt(Math.round(Math.log(1.05) / 31_536_000 * 1e18)) // 5% APY
  assert.ok(Math.abs(borrowApy(perSecond) - 0.05) < 1e-9)
})

test('funding: wrap only the missing WETH; with enough WETH only one transfer is paid for', () => {
  const costs = { wrapCost: 1_000n, transferCost: 2_000n }
  const amount = 10n ** 17n
  assert.deepEqual(fundingNeed(amount, { eth: 10n ** 18n, weth: 0n, ...costs }), { wrap: amount, transactions: 2, gas: 3_000n, required: amount + 3_000n, missing: 0n, enough: true })
  // wallet already holds enough WETH: only the transfer's gas is required
  assert.deepEqual(fundingNeed(amount, { eth: 2_000n, weth: amount, ...costs }), { wrap: 0n, transactions: 1, gas: 2_000n, required: 2_000n, missing: 0n, enough: true })
  assert.equal(fundingNeed(amount, { eth: 1_999n, weth: amount * 2n, ...costs }).missing, 1n)
  // partial WETH: wrap the difference only
  const partial = fundingNeed(amount, { eth: 0n, weth: amount / 4n, ...costs })
  assert.equal(partial.wrap, amount - amount / 4n)
  assert.equal(partial.missing, partial.required)
  assert.equal(partial.enough, false)
})

test('format: truncates, groups and never rounds up', () => {
  assert.equal(formatUnits(123_456_789n, 6, 2), '123.45')
  assert.equal(formatUnits(1_234_567_000_000n, 6, 2), '1,234,567')
  assert.equal(formatUnits(10n ** 15n, 18, 6), '0.001')
  assert.equal(formatUnits(999_999n, 6, 2), '0.99')
  assert.equal(formatWadPercent(86n * 10n ** 16n), '86%')
  assert.equal(formatWadPercent(255n * 10n ** 15n), '25.5%')
})
