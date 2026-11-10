import test from 'node:test'
import assert from 'node:assert/strict'
import { walletName, walletOptions } from './wallet-options.ts'

const metamask = {}, rabby = {}, legacy = {}
const announced = [
  { id: 'io.metamask', name: 'MetaMask', icon: 'data:mm', type: 'injected', provider: metamask },
  { id: 'io.rabby', name: 'Rabby Wallet', icon: 'data:rabby', type: 'injected', provider: rabby },
]
const generic = { id: 'injected', name: 'Injected', type: 'injected', provider: undefined }

test('Phase 8: every EIP-6963 wallet is listed with its announced name and icon; window.ethereum only when not announced', () => {
  assert.deepEqual(walletOptions([generic, ...announced], metamask), [
    { id: 'io.metamask', name: 'MetaMask', icon: 'data:mm' },
    { id: 'io.rabby', name: 'Rabby Wallet', icon: 'data:rabby' },
  ])
  assert.deepEqual(walletOptions([generic, ...announced], legacy).map(w => w.id), ['io.metamask', 'io.rabby', 'injected'])
  assert.deepEqual(walletOptions([generic], legacy), [{ id: 'injected', name: 'Browser wallet' }])
  assert.deepEqual(walletOptions([{ ...generic, name: 'Brave Wallet' }], legacy), [{ id: 'injected', name: 'Brave Wallet' }])
  assert.deepEqual(walletOptions([generic], undefined), []) // no wallet in this browser: "Install a wallet"
})

test('Phase 8: the generic connector has no name for copy (copy says "your wallet")', () => {
  assert.equal(walletName('Rabby Wallet'), 'Rabby Wallet')
  assert.equal(walletName('Injected'), null)
  assert.equal(walletName(undefined), null)
})
