import test from 'node:test'
import assert from 'node:assert/strict'
import { V } from '../vectors.mjs'
import { NearRpcError, viewAccessKeyList, viewFunction } from './rpc.ts'
import { discover, discoverWithHint, getState, vaultId } from './vault.ts'

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

test('§9 5: a remembered vault still owned is one get_state; a mismatch, an unreadable or a sub-cutoff hint scans', async () => {
  const configs = fake => { let n = 0; const fetcher = async (url, init) => { if (JSON.parse(init.body).params.method_name === 'get_config') n++; return fake.fetcher(url, init) }; return { fetcher, count: () => n } }
  // still owned: no factory read, no scan
  const owned = nearFake({ count: 14, owners: { 12: OWNER } }), c1 = configs(owned)
  assert.equal((await discoverWithHint(rpcUrl(), 'factory.testnet', OWNER, 10, 'v12.factory.testnet', c1.fetcher)).accountId, 'v12.factory.testnet')
  assert.deepEqual(owned.reads, [12]); assert.equal(c1.count(), 0)
  // mismatch: the hinted vault names another owner → the scan runs from the factory count and finds the owned one
  const moved = nearFake({ count: 14, owners: { 13: OWNER } }), c2 = configs(moved)
  assert.equal((await discoverWithHint(rpcUrl(), 'factory.testnet', OWNER, 10, 'v12.factory.testnet', c2.fetcher)).accountId, 'v13.factory.testnet')
  assert.deepEqual(moved.reads, [12, 14, 13]); assert.equal(c2.count(), 1)
  // mismatch and nothing owned → null, as a scan says
  const gone = nearFake({ count: 12, owners: {} })
  assert.equal(await discoverWithHint(rpcUrl(), 'factory.testnet', OWNER, 10, 'v12.factory.testnet', gone.fetcher), null)
  // an unreadable hint falls back to the scan; a hint below the cutoff or of another factory is not read at all
  const unread = nearFake({ count: 12, owners: { 11: OWNER }, unread: [12] })
  await assert.rejects(discoverWithHint(rpcUrl(), 'factory.testnet', OWNER, 10, 'v12.factory.testnet', unread.fetcher)) // the scan meets v12 unreadable above v11: unknown, never "none"
  const low = nearFake({ count: 11, owners: { 11: OWNER, 3: OWNER } })
  assert.equal((await discoverWithHint(rpcUrl(), 'factory.testnet', OWNER, 10, 'v3.factory.testnet', low.fetcher)).accountId, 'v11.factory.testnet')
  assert.deepEqual(low.reads, [11, 10]) // the scan's batch of two; v3 (below the cutoff) is never read
  const other = nearFake({ count: 11, owners: { 11: OWNER } })
  await discoverWithHint(rpcUrl(), 'factory.testnet', OWNER, 10, 'v11.other.testnet', other.fetcher)
  assert.deepEqual(other.reads, [11, 10]) // a hint of another factory is ignored; only the scan reads
})


test('NEAR fallback: asked only after a retryable failure of the primary (no answer, 5xx, 429); a NEAR error is final', async () => {
  const run = async primary => {
    const urls = []
    const rpc = { primary: rpcUrl(), fallback: rpcUrl() }
    const fetcher = async (url, _init) => {
      urls.push(url === rpc.primary ? 'primary' : 'fallback')
      if (url === rpc.primary) return primary()
      return ok({ result: bytes({ answered: 'fallback' }) })
    }
    const value = await viewFunction(rpc, 'x.testnet', 'm', {}, fetcher).catch(error => error)
    return { urls, value }
  }
  const answered = await run(() => ok({ result: bytes({ answered: 'primary' }) }))
  assert.deepEqual(answered, { urls: ['primary'], value: { answered: 'primary' } })
  for (const failure of [() => { throw new TypeError('Failed to fetch') }, () => new Response('down', { status: 503 }), () => new Response('', { status: 429, headers: { 'Retry-After': '5' } })]) {
    const r = await run(failure)
    assert.deepEqual(r, { urls: ['primary', 'fallback'], value: { answered: 'fallback' } })
  }
  const nearError = await run(() => Response.json({ jsonrpc: '2.0', id: 'cmdk', error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT' } } }))
  assert.deepEqual(nearError.urls, ['primary'])
  assert.ok(nearError.value instanceof NearRpcError)
  // a single URL (no fallback configured) fails as before
  const single = await viewFunction(rpcUrl(), 'x.testnet', 'm', {}, async () => { throw new TypeError('Failed to fetch') }).catch(error => error)
  assert.ok(single instanceof NearRpcError && single.message === 'NEAR RPC did not answer.')
})
