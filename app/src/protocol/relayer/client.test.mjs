import test from 'node:test'
import assert from 'node:assert/strict'
import { V } from '../vectors.mjs'
import { assessHealth, createVault, fundsShortfall, health, job, ownerCall, RelayerError } from './client.ts'

const urls = { primary: 'https://primary', fallback: 'https://fallback' }
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const expect = { chainId: 84532, nearNetwork: 'testnet', factory: 'factory.testnet' }

test('V18: GET falls back only when the primary does not answer', async () => {
  const seen = []
  const fetcher = async url => { seen.push(url); if (url.startsWith('https://primary')) throw new Error('offline'); return json(200, V.V19_assess.health) }
  assert.deepEqual(await health(urls, fetcher), V.V19_assess.health)
  assert.deepEqual(seen, V.V18_fallback.urls)
  // a primary that answers (even with an error) is authoritative
  const seen2 = []
  await assert.rejects(health(urls, async url => { seen2.push(url); return json(500, { ok: false, error: 'boom' }) }), /boom/)
  assert.deepEqual(seen2, ['https://primary/health'])
})

test('V19/V21: readiness fails closed on another network or factory; pending until the factory exists', () => {
  const h = V.V19_assess.health
  assert.equal(assessHealth({ ...h, factory: 'other.testnet' }, expect).kind, 'failed')
  assert.equal(assessHealth({ ...h, chain_id: 1 }, expect).kind, 'failed')
  assert.equal(assessHealth({ ...h, factory_exists: false }, expect).kind, 'pending')
  assert.equal(assessHealth(h, expect).kind, 'ready')
})

test('V20: create-vault posts the exact body once, to the primary only', async () => {
  const calls = []
  const id = await createVault(urls, { owner: V.V20_create.owner, policy: V.V20_create.policy, depositNear: V.V20_create.depositNear }, async (url, init) => { calls.push({ url, init }); return json(202, { ok: true, job: '0123456789abcdef' }) })
  assert.equal(id, '0123456789abcdef')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://primary/create-vault')
  assert.deepEqual(JSON.parse(calls[0].init.body), { owner: V.V20_create.owner, policy: V.V20_create.policy, deposit_near: '2' })
})

test('V22: 429 carries Retry-After; a lost POST is uncertain and is not repeated', async () => {
  await assert.rejects(createVault(urls, { owner: V.V20_create.owner, policy: V.V20_create.policy, depositNear: '2' }, async () => json(429, { ok: false, error: 'Too many vaults' }, { 'Retry-After': String(V.V22_rateLimit.retryAfter) })),
    e => e instanceof RelayerError && e.retryAfter === V.V22_rateLimit.retryAfter && !e.uncertain)
  const calls = []
  await assert.rejects(createVault(urls, { owner: V.V20_create.owner, policy: V.V20_create.policy, depositNear: '2' }, async url => { calls.push(url); throw new Error('connection lost') }), e => e instanceof RelayerError && e.uncertain)
  assert.deepEqual(calls, ['https://primary/create-vault'])
})

test('V3: owner-call posts {vault, message, signature} once and returns the job; 400 is a refusal', async () => {
  const calls = []
  const message = V.V13_open.text
  assert.equal(await ownerCall(urls, { vault: 'v10.factory.testnet', message, signature: V.V3_ownerCall.signature }, async (url, init) => { calls.push({ url, init }); return json(202, { ok: true, job: V.V3_ownerCall.job }) }), V.V3_ownerCall.job)
  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(calls[0].init.body), { vault: 'v10.factory.testnet', message, signature: V.V3_ownerCall.signature })
  await assert.rejects(ownerCall(urls, { vault: 'v10.factory.testnet', message, signature: '0x' }, async () => json(400, { ok: false, error: 'insufficient funds' })), e => e instanceof RelayerError && e.refused && /insufficient/.test(e.message))
})

test('V4/V23: a lost POST response and a forgotten (404) job are uncertain; a failed job is returned, not thrown', async () => {
  await assert.rejects(ownerCall(urls, { vault: 'v10.factory.testnet', message: '{}', signature: '0x' }, async () => { throw new Error('lost') }), e => e instanceof RelayerError && e.uncertain)
  await assert.rejects(job(urls, V.V3_ownerCall.job, async () => json(404, { ok: false, error: 'no such job' })), e => e instanceof RelayerError && e.uncertain)
  const failed = await job(urls, V.V3_ownerCall.job, async () => json(200, { ok: false, job: V.V3_ownerCall.job, kind: 'owner_call', stage: 'failed', error: 'reverted', http_status: 200 }))
  assert.equal(failed.stage, 'failed')
  const vaultChecked = await job(urls, V.V3_ownerCall.job, async () => json(200, { ok: true, job: V.V3_ownerCall.job, kind: 'owner_call', stage: 'vault_checked', vault: 'v10.factory.testnet' }))
  assert.equal(vaultChecked.stage, 'vault_checked')
})

test('gas refusal text of relayer.py check_funds parses to have/need; anything else is null', () => {
  assert.deepEqual(fundsShortfall('the vault Base address holds 200000000000000 wei, below the 960000000000000 wei the transactions may cost'), { have: 200000000000000n, need: 960000000000000n })
  assert.equal(fundsShortfall('message expired or expires within 30 s'), null)
  assert.equal(fundsShortfall(undefined), null)
})

