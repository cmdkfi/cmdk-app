import test from 'node:test'
import assert from 'node:assert/strict'
import { V } from '../vectors.mjs'
import { NearRpcError, viewAccessKeyList, viewFunction } from './rpc.ts'
import { discover, getState, vaultId } from './vault.ts'

let n = 0
const rpcUrl = () => `https://rpc-${++n}.test` // module caches are per URL
const bytes = value => [...new TextEncoder().encode(JSON.stringify(value))]
const ok = result => Response.json({ jsonrpc: '2.0', id: 'cmdk', result })
const OWNER = '0x' + 'ab'.repeat(20)
const state = (owner = OWNER) => ({
  owner, owner_nonce: 3, signer: 's', path: 'p', base_address: '0x' + '11'.repeat(20), morpho: '0x' + '55'.repeat(20), cooldown_secs: 120, last_agent_action: 0,
  markets: [{ id: '0x' + 'aa'.repeat(32), loan_token: '0x' + '01'.repeat(20), collateral_token: '0x' + '02'.repeat(20), executor: '0x' + '44'.repeat(20), previous_executors: [], slice_max: '1', corridor_set: true }],
  approved: null, agent: null,
})

test('V24: identical concurrent reads share one request; a later read is fresh', async () => {
  let calls = 0
  const fetcher = async () => { calls++; await Promise.resolve(); return ok({ result: bytes({ value: calls }) }) }
  const url = rpcUrl()
  const [a, b] = await Promise.all([viewFunction(url, 'x.testnet', 'm', {}, fetcher), viewFunction(url, 'x.testnet', 'm', {}, fetcher)])
  assert.equal(calls, 1); assert.deepEqual(a, b)
  assert.deepEqual(await viewFunction(url, 'x.testnet', 'm', {}, fetcher), { value: 2 })
})

test('V25: 429 honours Retry-After with no repeated request; no header means a 60 s cooldown', async () => {
  let calls = 0
  const url = rpcUrl()
  const limited = async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': String(V.V25_429.retryAfter) } }) }
  await assert.rejects(viewFunction(url, 'x.testnet', 'm', {}, limited), /rate limited/)
  await assert.rejects(viewFunction(url, 'x.testnet', 'm', {}, limited), /Retry after/)
  assert.equal(calls, 1)
  const before = Date.now()
  await assert.rejects(viewFunction(rpcUrl(), 'x.testnet', 'm', {}, async () => new Response('', { status: 429 })), e => e instanceof NearRpcError && e.retryable && e.retryAt >= before + V.V25_429.defaultCooldownMs)
})

test('V26: call_function with finality final and base64 JSON args', async () => {
  let params
  await viewFunction(rpcUrl(), 'x.testnet', 'get_state', {}, async (_url, init) => { params = JSON.parse(init.body).params; return ok({ result: bytes({}) }) })
  assert.deepEqual(params, { request_type: 'call_function', finality: 'final', account_id: 'x.testnet', method_name: 'get_state', args_base64: V.V26_discovery.argsBase64 })
})

function nearFake({ count, owners = {}, unread = [], transientOnce = [] }) {
  const reads = []
  const seen = new Set()
  const fetcher = async (_url, init) => {
    const p = JSON.parse(init.body).params
    if (p.method_name === 'get_config') return ok({ result: bytes({ code_hash: 'code', signer: 's', path: 'p', morpho: 'm', count }) })
    const number = Number(/^v(\d+)\./.exec(p.account_id)[1])
    reads.push(number)
    if (unread.includes(number)) return Response.json({ jsonrpc: '2.0', id: 'cmdk', error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT' } } })
    if (transientOnce.includes(number) && !seen.has(number)) { seen.add(number); throw new TypeError('Failed to fetch') }
    return ok({ result: bytes(state(owners[number] ?? '0x' + 'cd'.repeat(20))) })
  }
  return { fetcher, reads }
}

test('V26 + D4: newest owned vault from the cutoff; owner match is case-insensitive; nothing below the cutoff is read', async () => {
  const fake = nearFake({ count: 13, owners: { 11: OWNER.toUpperCase().replace('0X', '0x'), 12: OWNER, 3: OWNER } })
  const found = await discover(rpcUrl(), 'factory.testnet', OWNER, 10, fake.fetcher)
  assert.equal(found.accountId, 'v12.factory.testnet')
  assert.equal(found.number, 12)
  assert.deepEqual(fake.reads, [13, 12])
  const none = nearFake({ count: 9, owners: { 3: OWNER } })
  assert.equal(await discover(rpcUrl(), 'factory.testnet', OWNER, 10, none.fetcher), null)
  assert.deepEqual(none.reads, [])
})

test('V27: an unreadable vault above the owned one makes the answer unknown, never "none"', async () => {
  const fake = nearFake({ count: 12, owners: { 10: OWNER }, unread: [11] })
  await assert.rejects(discover(rpcUrl(), 'factory.testnet', OWNER, 10, fake.fetcher), NearRpcError)
})

test('V28: a transient read is retried once; an RPC-wide rate limit stops the scan with retryAt', async () => {
  const fake = nearFake({ count: 10, owners: { 10: OWNER }, transientOnce: [10] })
  assert.equal((await discover(rpcUrl(), 'factory.testnet', OWNER, 10, fake.fetcher)).number, 10)
  let records = 0
  const limited = async (_url, init) => {
    const p = JSON.parse(init.body).params
    if (p.method_name === 'get_config') return ok({ result: bytes({ code_hash: 'c', signer: 's', path: 'p', morpho: 'm', count: 20 }) })
    records++
    return new Response('', { status: 429, headers: { 'Retry-After': '60' } })
  }
  await assert.rejects(discover(rpcUrl(), 'factory.testnet', OWNER, 10, limited), e => e instanceof NearRpcError && e.retryAt > Date.now())
  assert.ok(records <= 2, `stops after the first rate-limited batch, read ${records}`)
})

test('get_state is validated; vault ids follow the factory rule', async () => {
  await assert.rejects(getState(rpcUrl(), 'v1.f.testnet', async () => ok({ result: bytes({ owner: 'nope' }) })), /incomplete get_state/)
  assert.equal((await getState(rpcUrl(), 'v1.f.testnet', async () => ok({ result: bytes(state()) }))).owner_nonce, 3)
  assert.equal(vaultId('factory.testnet', 10), 'v10.factory.testnet')
  assert.throws(() => vaultId('factory.testnet', 0))
})

test('V36: view_access_key_list returns the key list of a live vault', async () => {
  const { readFile } = await import('node:fs/promises')
  const recorded = JSON.parse(await readFile(new URL(`../${V.V36_accessKeys.file}`, import.meta.url), 'utf8'))
  const keys = await viewAccessKeyList(rpcUrl(), recorded.account_id, async () => Response.json(recorded.response))
  assert.equal(keys.length, 1)
  assert.equal(keys[0].public_key, recorded.agent_public_key)
})
