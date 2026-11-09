import test from 'node:test'
import assert from 'node:assert/strict'
import { agentState, backupStatus, budgetFor, currentMarket, describe, positionVariant } from './position.ts'

const NOW = 2_000_000_000
const row = (extra = {}) => ({ registration: 'registered', agent_status: 'active', expires_at: NOW + 3600, last_tick_unix: NOW - 30, ...extra })
const facts = (r, keyLimited = true) => ({ row: r, keyLimited, vaultAgent: { public_key: 'ed25519:k', expires_at: NOW + 3600 } })

test('agent status: Active only when registered, active, unexpired and the NEAR key check holds', () => {
  assert.equal(agentState(facts(row()), NOW).state, 'Active')
  assert.equal(agentState(facts(row(), false), NOW).state, 'Unavailable')
})

test('agent status: labels of agent/src/vaults.rs and logic.rs map to Registering, Expired, Revoked, Unavailable', () => {
  assert.equal(agentState(null, NOW).state, 'Unavailable')
  assert.equal(agentState(facts(null), NOW).state, 'Registering')
  assert.equal(agentState(facts(row({ registration: 'registering' })), NOW).state, 'Registering')
  assert.equal(agentState(facts(row({ agent_status: 'revoked (registration expired)' })), NOW).state, 'Expired')
  assert.equal(agentState(facts(row({ expires_at: NOW })), NOW).state, 'Expired')
  assert.equal(agentState(facts(row({ agent_status: 'revoked' })), NOW).state, 'Revoked')
  assert.equal(agentState(facts(row({ agent_status: 'revoked (another key registered)' })), NOW).state, 'Revoked')
  const gaveUp = agentState(facts(row({ registration: 'registration failed (gave up for this boot)' })), NOW)
  assert.deepEqual(gaveUp, { state: 'Unavailable', detail: 'registration failed (gave up for this boot)' })
})

const LIVE = '0x' + 'aa'.repeat(32), BACKUP = '0x' + 'bb'.repeat(32)
const EXEC = '0x' + '44'.repeat(20), WETH = '0x4200000000000000000000000000000000000006'
const market = (id, collateral, debt, extra = {}) => ({ id, executor: EXEC, collateral, debt, value: null, ltv: null, lltv: 86n * 10n ** 16n, corridor: { target: 0n, act: 0n, floor: 0n, sellBudget: 2n * 10n ** 17n, migrateAllowed: true, set: true }, closedForAgent: false, collateralToken: WETH, loanDecimals: 6, collateralDecimals: 18, ...extra })

test('current market: the one with debt (backup after a migration), else with collateral, else live', () => {
  assert.equal(currentMarket({ markets: [market(LIVE, 1n, 5n), market(BACKUP, 0n, 0n)] }, LIVE).id, LIVE)
  assert.equal(currentMarket({ markets: [market(LIVE, 0n, 0n), market(BACKUP, 3n, 2n)] }, LIVE).id, BACKUP)
  assert.equal(currentMarket({ markets: [market(LIVE, 0n, 0n), market(BACKUP, 3n, 0n)] }, LIVE).id, BACKUP)
  assert.equal(currentMarket({ markets: [market(BACKUP, 0n, 0n), market(LIVE, 0n, 0n)] }, LIVE).id, LIVE)
  assert.equal(currentMarket({ markets: [] }, LIVE), null)
})

test('backup status follows Executor.migrate: both corridors set, migrateAllowed, not closed for the agent', () => {
  const labels = { [LIVE]: 'live', [BACKUP]: 'backup' }
  const live = market(LIVE, 1n, 1n)
  const view = backup => ({ markets: [live, backup] })
  assert.equal(backupStatus(view(market(BACKUP, 0n, 0n)), live, labels), 'approved')
  assert.equal(backupStatus(view(market(BACKUP, 0n, 0n, { corridor: { ...live.corridor, set: false } })), live, labels), 'not-approved')
  assert.equal(backupStatus(view(market(BACKUP, 0n, 0n, { corridor: { ...live.corridor, migrateAllowed: false } })), live, labels), 'not-approved')
  assert.equal(backupStatus(view(market(BACKUP, 0n, 0n, { closedForAgent: true })), live, labels), 'not-approved')
  assert.equal(backupStatus(view(market(BACKUP, 0n, 0n)), market(LIVE, 1n, 1n, { closedForAgent: true }), labels), 'not-approved')
  const moved = market(BACKUP, 3n, 2n)
  assert.equal(backupStatus({ markets: [market(LIVE, 0n, 0n), moved] }, moved, labels), 'current')
  assert.equal(backupStatus({ markets: [live] }, live, labels), 'missing')
})

test('sell budget is the group of the current market executor and collateral token', () => {
  const view = { sellBudgets: [{ executor: EXEC, token: WETH, activeCollateral: 100n, sold: 10n, budgetWad: 2n * 10n ** 17n, remaining: 12n }] }
  assert.equal(budgetFor(view, market(LIVE, 1n, 1n)).remaining, 12n)
  assert.equal(budgetFor(view, market(LIVE, 1n, 1n, { executor: '0x' + '45'.repeat(20) })), null)
})

test('variant: liquidated is collateral 0 with debt; closed only from a close record; else empty', () => {
  assert.equal(positionVariant({ markets: [market(LIVE, 0n, 5n)] }, false), 'liquidated')
  assert.equal(positionVariant({ markets: [market(LIVE, 0n, 5n)] }, true), 'liquidated')
  assert.equal(positionVariant({ markets: [market(LIVE, 1n, 0n)] }, false), 'active')
  assert.equal(positionVariant({ markets: [market(LIVE, 0n, 0n)] }, false), 'empty')
  assert.equal(positionVariant({ markets: [market(LIVE, 0n, 0n)] }, true), 'closed')
})

const OWNER = '0x' + '19'.repeat(20), POSITION = '0x' + '15'.repeat(20), USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const ctx = { owner: OWNER, positionAddress: POSITION, weth: WETH, usdc: USDC, marketLabels: { [LIVE]: 'live', [BACKUP]: 'backup' } }
const item = (name, args, token) => ({ name, actor: 'you', blockNumber: 1n, time: null, transactionHash: '0x' + '01'.repeat(32), logIndex: 0, args, token })

test('event labelling: owner events are You, reduce/migrate/exit/session are Agent, with amounts', () => {
  assert.deepEqual(describe(item('Opened', { collateralIn: 10n ** 17n, borrowed: 160_000_000n, ltv: 5n * 10n ** 17n }), ctx), { who: 'You', text: 'Opened: supplied 0.1 WETH, borrowed 160 USDC at 50% LTV' })
  assert.deepEqual(describe(item('CorridorSet', { market: LIVE }), ctx), { who: 'You', text: 'Rules set on the live market' })
  assert.equal(describe(item('Repaid', { repaid: 1_000_000n }), ctx).who, 'You')
  assert.equal(describe(item('Closed', { repaid: 1n, collateralOut: 1n }), ctx).who, 'You')
  assert.deepEqual(describe(item('Reduced', { repaid: 20_000_000n, collateralSold: 10n ** 16n, ltvBefore: 71n * 10n ** 16n, ltvAfter: 5n * 10n ** 17n }), ctx), { who: 'Agent', text: 'Reduced: sold 0.01 WETH to repay 20 USDC, LTV 71% → 50%' })
  assert.deepEqual(describe(item('Migrated', { from: LIVE, to: BACKUP, debtMoved: 5_000_000n, collateralMoved: 10n ** 16n }), ctx), { who: 'Agent', text: 'Moved 5 USDC of debt and 0.01 WETH from the live to the backup market' })
  assert.equal(describe(item('Exited', { repaid: 1n, collateralSold: 1n }), ctx).who, 'Agent')
  assert.equal(describe(item('SessionEnded', { ltv: 7n * 10n ** 17n }), ctx).who, 'Agent')
})

test('event labelling: transfers between the wallet and the position address are You; others are Transfer', () => {
  assert.deepEqual(describe(item('Transfer', { from: OWNER, to: POSITION, value: 10n ** 17n }, WETH), ctx), { who: 'You', text: 'Sent 0.1 WETH from your wallet to your position address' })
  assert.deepEqual(describe(item('Transfer', { from: POSITION, to: OWNER, value: 160_000_000n }, USDC), ctx), { who: 'You', text: '160 USDC from your position address to your wallet' })
  assert.equal(describe(item('Transfer', { from: '0x' + '99'.repeat(20), to: POSITION, value: 1n }, USDC), ctx).who, 'Transfer')
})
