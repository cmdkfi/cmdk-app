import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountKind, connectionError, shortAddress } from './wallet-utils.ts'

test('allows plain and EIP-7702 delegated accounts, but rejects contracts', () => {
  assert.equal(accountKind(undefined), 'plain')
  assert.equal(accountKind('0x'), 'plain')
  assert.equal(accountKind('0xef0100aabb'), 'delegated')
  assert.equal(accountKind('0xEF0100aabb'), 'delegated')
  assert.equal(accountKind('0x60806040'), 'contract')
})

test('formats an address without hiding its identity entirely', () => {
  assert.equal(shortAddress('0x1234567890123456789012345678901234567890'), '0x1234…7890')
})

test('gives actionable connection errors', () => {
  assert.match(connectionError(new Error('User rejected request')), /cancelled/)
  assert.match(connectionError(new Error('provider not found')), /not found/)
})
