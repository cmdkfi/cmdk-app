import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { V } from '../vectors.mjs'
import { agentKeyLimited, agentRegistered, agentRow, codeMatchesFactory, composeHashMatches, measurementMatches, sha256Hex } from './verify.ts'

const vault = 'v3.factory.testnet'
const key = { public_key: 'agent', access_key: { permission: { FunctionCall: { receiver_id: vault, method_names: ['reduce', 'migrate', 'exit'], allowance: '1' } } } }

test('V31: measurement matches only when all six fields are equal', () => {
  const m = V.V31_measurement.measurement
  assert.equal(measurementMatches({ ...m }, m), true)
  assert.equal(measurementMatches({ ...m, rtmr0: '00' }, m), false)
  assert.equal(measurementMatches(undefined, m), false)
  assert.equal(measurementMatches({}, m), false)
  assert.equal(measurementMatches(m, null), false)
})

test('V32: sha256 of the recorded app-compose.json equals its recorded compose hash', async () => {
  const bytes = new Uint8Array(await readFile(new URL(`../${V.V32_compose.file}`, import.meta.url)))
  assert.equal(bytes.length, V.V32_compose.bytes)
  assert.equal(await sha256Hex(bytes), V.V32_compose.sha256)
  assert.equal(await composeHashMatches(bytes, V.V32_compose.sha256), true)
  assert.equal(await composeHashMatches(bytes.slice(1), V.V32_compose.sha256), false)
})

test('V30: exactly one function-call key for the vault with exactly reduce, migrate, exit, and it is the agent key', () => {
  assert.equal(agentKeyLimited([key], vault, 'agent'), true)
  for (const keys of [[], [key, key], [{ ...key, access_key: { permission: 'FullAccess' } }], [{ ...key, access_key: { permission: { FunctionCall: { ...key.access_key.permission.FunctionCall, method_names: [] } } } }]]) assert.equal(agentKeyLimited(keys, vault, 'agent'), false)
  assert.equal(agentKeyLimited([key], vault, 'another'), false)
  assert.equal(agentKeyLimited([key], 'v4.factory.testnet', 'agent'), false)
  assert.equal(agentKeyLimited([key], vault, null), false)
})

test('V36: the live v1 key list is limited to the agent key it records', async () => {
  const recorded = JSON.parse(await readFile(new URL(`../${V.V36_accessKeys.file}`, import.meta.url), 'utf8'))
  assert.equal(agentKeyLimited(recorded.response.result.keys, recorded.account_id, recorded.agent_public_key), true)
})

test('V30: code identity uses the global contract hash, then code_hash', () => {
  assert.equal(codeMatchesFactory({ code_hash: '111', global_contract_hash: 'code' }, 'code'), true)
  assert.equal(codeMatchesFactory({ code_hash: '111', global_contract_hash: 'other' }, 'code'), false)
  assert.equal(codeMatchesFactory({ code_hash: 'code' }, 'code'), true)
  assert.equal(codeMatchesFactory({ code_hash: 'code' }, ''), false)
})

test('agent row: registered, active and unexpired on this vault', () => {
  const rows = [{ vault, registration: 'registered', agent_status: 'active', expires_at: 2000 }]
  assert.equal(agentRegistered(agentRow(rows, vault), 1000), true)
  assert.equal(agentRegistered(agentRow(rows, vault), 2000), false)
  assert.equal(agentRegistered(agentRow(rows, 'v4.factory.testnet'), 1000), false)
  assert.equal(agentRegistered({ ...rows[0], agent_status: 'expired' }, 1000), false)
})
