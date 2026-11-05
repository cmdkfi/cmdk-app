import assert from 'node:assert/strict'
import test from 'node:test'
import { requiredRepayment, repaymentGap, totalForToken } from './exit-readiness.ts'

test('repayment readiness follows the relayer debt plus one percent check', () => {
  assert.equal(requiredRepayment(250_000_000n), 252_500_000n)
  assert.equal(repaymentGap(252_500_000n, 200_000_000n), 52_500_000n)
  assert.equal(repaymentGap(252_500_000n, 252_500_000n), 0n)
})

test('two markets using the same USDC balance need their combined repayment', () => {
  const markets = [{ loanToken: '0xABC', debt: 100_000_000n }, { loanToken: '0xabc', debt: 200_000_000n }]
  assert.equal(totalForToken(markets, '0xAbC'), 303_000_000n)
  assert.equal(repaymentGap(totalForToken(markets, '0xabc'), 200_000_000n), 103_000_000n)
})
