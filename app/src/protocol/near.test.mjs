import test from 'node:test'
import assert from 'node:assert/strict'
import { discoverVaults, loadConfig, selectedOwnedVault } from './near.ts'

const config = { baseChainId: 84532, nearNetwork: 'testnet', nearRpcUrl: 'https://rpc.testnet.near.org', near: { factory: 'factory.testnet' } }
const response = value => ({ ok: true, json: async () => ({ result: { result: [...new TextEncoder().encode(JSON.stringify(value))] } }) })

test('discovers only vaults owned by the connected address, newest first', async () => {
  const requests = []
  const fetcher = async (_url, init) => {
    const query = JSON.parse(init.body).params
    requests.push(query)
    if (query.method_name === 'get_config') return response({ count: 3 })
    const number = Number(query.account_id.match(/^v(\d+)/)[1])
    return response({ owner: number === 2 ? '0xother' : '0xABC', markets: number === 3 ? [{}, {}] : [] })
  }
  const result = await discoverVaults(config, '0xabc', fetcher)
  assert.deepEqual(result.vaults.map(vault => vault.accountId), ['v3.factory.testnet', 'v1.factory.testnet'])
  assert.equal(result.vaults[0].marketCount, 2)
  assert.equal(result.failed, 0)
  assert.equal(requests[0].args_base64, 'e30=')
})

test('does not treat an unreadable vault as an empty result', async () => {
  const fetcher = async (_url, init) => {
    const query = JSON.parse(init.body).params
    if (query.method_name === 'get_config') return response({ count: 2 })
    if (query.account_id.startsWith('v1.')) throw new Error('timeout')
    return response({ owner: '0xabc' })
  }
  const result = await discoverVaults(config, '0xabc', fetcher)
  assert.equal(result.failed, 1)
  assert.equal(result.vaults.length, 1)
})

test('ignores a saved vault that does not belong to the discovered owner', () => {
  const owned = [{ accountId: 'v3.factory.testnet', number: 3, owner: '0xabc', marketCount: 1 }]
  assert.equal(selectedOwnedVault(owned, 'v2.factory.testnet')?.accountId, 'v3.factory.testnet')
  assert.equal(selectedOwnedVault([], 'v2.factory.testnet'), null)
})

test('requires the expected network configuration', async () => {
  await assert.rejects(loadConfig(async () => ({ ok: true, json: async () => ({ ...config, baseChainId: 1 }) })), /supported testnet/)
})

test('uses validated relayer factory for reading without enabling creation', async () => {
  const base = { ...config, baseRpcUrl: 'https://rpc.example', relayerUrl: 'https://relayer.example', relayerUrlFallback: '', near: { factory: null }, agent: { measurement: null }, createVault: null }
  const fetcher = async url => ({ ok: true, json: async () => url === '/config.json' ? structuredClone(base) : { chain_id: 84532, near_network: 'testnet', factory_exists: true, factory: 'published.testnet' } })
  const loaded = await loadConfig(fetcher)
  assert.equal(loaded.near.factory, 'published.testnet')
  assert.equal(loaded.createVault, null)
  await assert.rejects(loadConfig(async url => ({ ok: true, json: async () => url === '/config.json' ? structuredClone(base) : { chain_id: 1, near_network: 'testnet', factory_exists: true, factory: 'published.testnet' } })), /supported testnet factory/)
})

test('discovery retries a transient read once, and stops the remaining scan on an RPC-wide rate limit',async()=>{
 let calls=0
 const recovered=await discoverVaults(config,'0xabc',async()=>{calls++;if(calls===1)throw TypeError('Failed to fetch');return response({count:0})})
 assert.equal(calls,2);assert.equal(recovered.failed,0)
 let records=0
 const limited=await discoverVaults(config,'0xabc',async(_url,init)=>{const p=JSON.parse(init.body).params;if(p.method_name==='get_config')return response({count:10});records++;return new Response('',{status:429,headers:{'Retry-After':'60'}})})
 assert.equal(records,2);assert.equal(limited.failed,10);assert.equal(limited.unreadAccounts.length,10);assert.ok(limited.retryAt>Date.now())
})
