import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyVault, discoverActiveVault, DiscoveryError, newestFromCutoff, positionShape } from './active-vault.ts'

const WETH = '0x4200000000000000000000000000000000000006'
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const guided = { base: { weth: WETH, usdc: USDC }, minDepositWei: 10n ** 15n, usdcDust: 10_000n, corridor: { floor: 30, target: 50, act: 70, budget: 20, migrate: true, exit: true } }
const market = (collateral, debt, extra = {}) => ({ id: '0x' + 'aa'.repeat(32), collateral, debt, borrowShares: debt, readOnly: false, ...extra })
const position = (markets, idle = {}) => ({
  vault: 'v', baseAddress: '0x' + '11'.repeat(20), readAt: 0, errors: [], markets,
  freeBalances: [{ token: WETH, symbol: 'WETH', decimals: 18, balance: idle.weth ?? 0n }, { token: USDC, symbol: 'USDC', decimals: 6, balance: idle.usdc ?? 0n }],
})
const vault = number => ({ accountId: `v${number}.factory.testnet`, number, owner: '0xowner', marketCount: 2 })

test('position shape: liquidated is collateral 0 with debt; any collateral or debt is active', () => {
  assert.equal(positionShape(position([market(0n, 5n), market(0n, 0n)])), 'liquidated')
  assert.equal(positionShape(position([market(1n, 0n), market(0n, 0n)])), 'active')
  assert.equal(positionShape(position([market(0n, 0n), market(3n, 2n)])), 'active') // migrated to backup
  assert.equal(positionShape(position([market(0n, 0n), market(0n, 0n)])), 'empty')
})

test('classify: active with idle USDC above dust is flagged; dust is ignored', () => {
  assert.equal(classifyVault(position([market(1n, 1n)], { usdc: 10_001n }), null, guided), 'active-idle-usdc')
  assert.equal(classifyVault(position([market(1n, 1n)], { usdc: 10_000n }), null, guided), 'active')
  assert.equal(classifyVault(position([market(0n, 1n)], { usdc: 50_000_000n }), null, guided), 'liquidated')
})

test('classify: empty vault by setup state and idle WETH (no derived "closed")', () => {
  const empty = position([market(0n, 0n), market(0n, 0n)])
  assert.equal(classifyVault(empty, true, guided), 'ready')
  assert.equal(classifyVault(empty, false, guided), 'setup')
  assert.equal(classifyVault(position([market(0n, 0n)], { weth: 10n ** 15n }), true, guided), 'deposited')
  assert.equal(classifyVault(position([market(0n, 0n)], { weth: 10n ** 15n - 1n }), true, guided), 'ready')
  assert.equal(classifyVault(position([market(0n, 0n)], { weth: 10n ** 18n }), false, guided), 'setup')
  assert.throws(() => classifyVault(empty, null, guided), DiscoveryError)
})

const scan = (numbers, unread = []) => ({ vaults: numbers.map(vault), failed: unread.length, unreadAccounts: unread.map(n => `v${n}.factory.testnet`) })

test('D4 / R8: the newest owned vault numbered from firstVaultNumber is the position; older ones are ignored', () => {
  assert.equal(newestFromCutoff(scan([3, 12, 10, 11]), 10).number, 12)
  assert.equal(newestFromCutoff(scan([10]), 10).number, 10) // the cutoff number itself counts
  assert.equal(newestFromCutoff(scan([1, 5, 9]), 10), null) // only previous-app vaults: owns none
  assert.equal(newestFromCutoff(scan([]), 10), null)
})

test('D4 / R8: an unread account below the cutoff is ignored; one at or above it fails discovery', () => {
  assert.equal(newestFromCutoff(scan([11], [2, 9]), 10).number, 11)
  assert.throws(() => newestFromCutoff(scan([11], [10]), 10), DiscoveryError)
  assert.throws(() => newestFromCutoff(scan([], [14]), 10), DiscoveryError)
  assert.throws(() => newestFromCutoff({ vaults: [], failed: 1, unreadAccounts: [] }, 10), DiscoveryError)
})

const config = { createVault: { markets: [] }, agent: { measurement: null } }
const ports = (result, positions, facts) => ({
  discoverVaults: async () => result,
  readLivePosition: async (_config, id) => positions[id],
  readSetupFacts: async () => { if (!facts) throw new Error('setup facts should not be read'); return facts },
})
const g10 = { ...guided, firstVaultNumber: 10 }

test('discovery: no vault from the cutoff is "found: null"; an incomplete read fails', async () => {
  assert.deepEqual(await discoverActiveVault(ports(scan([2, 4]), {}), config, g10, '0xowner'), { status: null })
  await assert.rejects(discoverActiveVault(ports(scan([10], [11]), {}), config, g10, '0xowner'), DiscoveryError)
  const broken = { 'v10.factory.testnet': { ...position([market(0n, 0n)]), errors: ['Market read failed'] } }
  await assert.rejects(discoverActiveVault(ports(scan([10]), broken), config, g10, '0xowner'), DiscoveryError)
})

test('discovery: only the chosen vault is read, and setup facts only when it is empty', async () => {
  const read = []
  const positions = new Proxy({}, { get: (_t, id) => { read.push(id); return id === 'v11.factory.testnet' ? position([market(1n, 1n)]) : undefined } })
  const active = await discoverActiveVault(ports(scan([10, 11, 3]), positions, null), config, g10, '0xowner')
  assert.equal(active.status, 'active')
  assert.deepEqual(read, ['v11.factory.testnet'])
  const complete = { facts: [{ authorized: true, needsApproval: false, corridorSet: true }], measurementMatches: true }
  const ready = await discoverActiveVault(ports(scan([10]), { 'v10.factory.testnet': position([market(0n, 0n)]) }, complete), config, g10, '0xowner')
  assert.equal(ready.status, 'ready')
  assert.equal(ready.vault.number, 10)
})
