import assert from 'node:assert/strict'
import test from 'node:test'
import { parseUsdcAmount, withdrawMessage } from './live-withdraw.ts'

const owner = '0x1111111111111111111111111111111111111111'
const token = '0x2222222222222222222222222222222222222222'
const config = { near: { factory: 'factory.testnet' }, createVault: { markets: [{ loan_token: token }] } }

test('USDC input uses six decimals and rejects zero, exponent and excessive precision', () => {
  assert.equal(parseUsdcAmount('12.345678'), 12345678n)
  for (const value of ['0', '1e3', '1.1234567', '-1', '']) assert.throws(() => parseUsdcAmount(value))
})

test('withdraw signs the exact owner-call message with the wallet as destination', () => {
  assert.equal(withdrawMessage('v1.factory.testnet', 2, 1000, config, token, 12345678n, owner),
    `{"protocol":"cmdk-vault/1","network":"testnet","vault":"v1.factory.testnet","method":"withdraw","args":{"token":"${token}","amount":"12345678","destination":"${owner}"},"nonce":2,"expiry":1000}`)
  assert.throws(() => withdrawMessage('v1.other.testnet', 2, 1000, config, token, 1n, owner))
  assert.throws(() => withdrawMessage('v1.factory.testnet', 2, 1000, config, '0x3333333333333333333333333333333333333333', 1n, owner))
})
