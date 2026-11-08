import test from 'node:test'
import assert from 'node:assert/strict'
import { setupMessage, startSetupJob, readSetupJob, SetupError } from './vault-setup.ts'

const measurement = Object.fromEntries(['mrtd', 'rtmr0', 'rtmr1', 'rtmr2', 'compose_hash', 'os_image_hash'].map(key => [key, 'a'.repeat(64)]))
const config = { near: { factory: 'factory.testnet' }, agent: { measurement }, createVault: { markets: [{ id: `0x${'1'.repeat(64)}` }, { id: `0x${'2'.repeat(64)}` }] }, relayerUrl: 'https://primary', relayerUrlFallback: 'https://fallback' }
const rules = { floor: 30, target: 50, act: 70, budget: 20, migrate: true, exit: false }
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })

test('setup message uses exact field order, decimal fractions and one authorization', () => {
  const text = setupMessage('v1.factory.testnet', 1, 1793722200, config, rules)
  assert.ok(text.startsWith('{"protocol":"cmdk-vault/1","network":"testnet","vault":"v1.factory.testnet","method":"setup"'))
  const parsed = JSON.parse(text)
  assert.deepEqual(parsed.args.markets.map(market => [market.approve, market.authorize]), [[true, true], [false, false]])
  assert.deepEqual(parsed.args.markets.map(market => market.corridor), Array(2).fill({ target: '500000000000000000', act: '700000000000000000', floor: '300000000000000000', sell_budget: '200000000000000000', migrate_allowed: true, exit_allowed: false }))
  assert.deepEqual(parsed.args.measurement, measurement)
})

test('setup cannot be composed without the published measurement', () => {
  assert.throws(() => setupMessage('v1.factory.testnet', 1, 1793722200, { ...config, agent: { measurement: null } }, rules), SetupError)
})

test('posts the identical signed text only once and tracks its job', async () => {
  const message = setupMessage('v1.factory.testnet', 1, 1793722200, config, rules)
  const calls = []
  const id = await startSetupJob(config, 'v1.factory.testnet', message, `0x${'a'.repeat(130)}`, async (url, options) => { calls.push({ url, options }); return json(202, { ok: true, job: '0123456789abcdef' }) })
  assert.equal(id, '0123456789abcdef')
  assert.deepEqual(JSON.parse(calls[0].options.body), { vault: 'v1.factory.testnet', message, signature: `0x${'a'.repeat(130)}` })
  assert.equal(calls.length, 1)
  const job = await readSetupJob(config, id, async () => json(200, { ok: true, job: id, kind: 'owner_call', stage: 'vault_checked', vault: 'v1.factory.testnet' }))
  assert.equal(job.stage, 'vault_checked')
})

test('lost POST response and forgotten job are uncertain', async () => {
  await assert.rejects(startSetupJob(config, 'v1.factory.testnet', '{}', '0x', async () => { throw new Error('lost') }), error => error instanceof SetupError && error.uncertain)
  await assert.rejects(readSetupJob(config, '0123456789abcdef', async () => json(404, { ok: false })), error => error instanceof SetupError && error.uncertain)
})

import {repairSetupArgs} from './vault-setup.ts'
test('repair preserves existing corridors and avoids repeating granted authorization',()=>{
 const facts=[{id:'one',executor:'exec',loanToken:'loan',collateralToken:'coll',authorized:true,needsApproval:false,corridorSet:true},{id:'two',executor:'exec',loanToken:'loan',collateralToken:'coll',authorized:true,needsApproval:true,corridorSet:false}]
 const existing={target:'510000000000000000',act:'720000000000000000',floor:'320000000000000000',sell_budget:'180000000000000000',migrate_allowed:false,exit_allowed:true}
 const result=repairSetupArgs(config,rules,[facts[0],{...facts[1],corridor:existing}],true)
 assert.equal(result.measurement,null);assert.equal(result.markets[0].corridor,null);assert.equal(result.markets[0].authorize,false);assert.equal(result.markets[1].authorize,false);assert.deepEqual(result.markets[1].corridor,existing)
 assert.throws(()=>repairSetupArgs(config,rules,[facts[0]],true),/already complete/)
 const initial=repairSetupArgs(config,rules,facts.map(f=>({...f,authorized:false,needsApproval:true,corridorSet:false})),false)
 assert.deepEqual(initial.markets.map(m=>[m.approve,m.authorize]),[[true,true],[false,false]])
})

test('repair validates new corridors against the actual market LLTV rather than a demo constant',()=>{
 assert.throws(()=>repairSetupArgs(config,rules,[{id:'one',executor:'exec',loanToken:'loan',collateralToken:'coll',authorized:true,needsApproval:false,corridorSet:false,liquidationLtv:650000000000000000n}],true),/actual market/)
})

import {needsSetupApproval} from './vault-setup.ts'
test('setup repair can restore insufficient positive allowances as well as zero approvals',()=>{
 const max=(1n<<256n)-1n
 assert.equal(needsSetupApproval(max,max),false)
 assert.equal(needsSetupApproval(1n,max),true)
 assert.equal(needsSetupApproval(max,0n),true)
})
