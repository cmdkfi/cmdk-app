import test from 'node:test'
import assert from 'node:assert/strict'
import { walletOptions } from './wallet-options.ts'
const make = (id,type='injected',name=id) => ({id,uid:id,name,type})
const generic=make('injected'), metamask=make('io.metamask'), rabby=make('io.rabby'), coinbase=make('com.coinbase.wallet','injected','Coinbase Wallet'), sdk=make('coinbaseWalletSDK','coinbaseWallet','Coinbase Wallet')
test('shows all discovered providers and suppresses generic duplicates',()=>{
 assert.deepEqual(walletOptions([generic,metamask,rabby,sdk],new Set(['injected','io.metamask','io.rabby'])),[metamask,rabby,sdk])
})
test('prefers installed Coinbase over SDK and keeps unknown EIP6963 brands',()=>{
 const other=make('org.example.wallet')
 assert.deepEqual(walletOptions([coinbase,sdk,other],new Set([coinbase.uid,other.uid])),[coinbase,other])
})
test('does not advertise absent extensions; preserves legacy injected support',()=>{
 assert.deepEqual(walletOptions([generic,metamask,sdk],new Set()),[sdk])
 assert.deepEqual(walletOptions([generic,sdk],new Set(['injected'])),[generic,sdk])
})
