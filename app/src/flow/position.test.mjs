import test from 'node:test'
import assert from 'node:assert/strict'
import { actionRows, agentState, approveAction, backupStatus, budgetFor, canRevoke, currentMarket, describe, positionVariant } from './position.ts'

const NOW = 2_000_000_000
const row = (extra = {}) => ({ registration: 'registered', agent_status: 'active', expires_at: NOW + 3600, last_tick_unix: NOW - 30, ...extra })
const KEY = { public_key: 'ed25519:k', expires_at: NOW + 3600 }
/** Chain facts (the vault's recorded agent and the key check) plus the agent's list (a row, null, or a failed read). */
const facts = (r, { key = KEY, keyLimited = true, listFailed = false, approval = { ok: true, matches: true } } = {}) => ({ approval, keyLimited, vaultAgent: key, list: listFailed ? { ok: false, error: 'HTTP 503' } : { ok: true, row: r } })

test('agent status, chain first: a recorded, unexpired, restricted vault key is Active; the list adds liveness only', () => {
  assert.deepEqual(agentState(facts(row()), NOW), { state: 'Active' })
  assert.deepEqual(agentState(facts(null, { listFailed: true }), NOW), { state: 'Active', detail: "Your vault shows the registration; the agent's list could not be read." })
  assert.equal(agentState(facts(row(), { keyLimited: false }), NOW).state, 'Unavailable')
  assert.equal(agentState(facts(row(), { key: { ...KEY, expires_at: NOW } }), NOW).state, 'Expired')
  assert.equal(agentState(null, NOW).state, 'Unavailable')
})

test('agent status: the live 9 Nov rows that lagged the chain read Active, "the agent\'s list has not caught up yet" (Phase 7b)', () => {
  // tasks/rehearsal-2026-11-10.md: v10 registered on chain 22:01:42 UTC, the agent's list caught up about 22:05
  const lag = "Your vault shows the registration; the agent's list has not caught up yet."
  assert.deepEqual(agentState(facts(row({ registration: 'registering', agent_status: 'revoked' })), NOW), { state: 'Active', detail: lag })
  assert.deepEqual(agentState(facts(row({ agent_status: 'revoked' })), NOW), { state: 'Active', detail: lag })
  assert.deepEqual(agentState(facts(row({ agent_status: 'revoked (registration expired)' })), NOW), { state: 'Active', detail: lag })
  assert.deepEqual(agentState(facts(null), NOW), { state: 'Active', detail: lag })
  // the agent's own statements are shown, not taken for lag
  assert.deepEqual(agentState(facts(row({ registration: 'registration failed (gave up for this boot)', agent_status: 'active' })), NOW), { state: 'Active', detail: "Your vault shows the registration; the agent's list says: registration failed (gave up for this boot) · active." })
})

test('agent status: the approval comes first; a stale approval under a valid-looking key is Outdated (live v10, 9 Nov; Phase 7b)', () => {
  // v10 kept the previous boot's restricted key (unexpired) but approved compose 216124c1; the running agent is db4f5085
  const stale = { ok: true, matches: false }
  assert.deepEqual(agentState(facts(null, { approval: stale }), NOW), { state: 'Outdated', detail: 'Your vault approved an earlier agent version; the running agent does not watch it.' })
  assert.equal(agentState(facts(row(), { approval: stale }), NOW).state, 'Outdated')
  assert.equal(agentState(facts(row(), { approval: stale, key: { ...KEY, expires_at: NOW } }), NOW).state, 'Outdated')
  assert.deepEqual(agentState(facts(row(), { approval: { ok: false, error: 'HTTP 404' } }), NOW), { state: 'Unavailable', detail: 'The agent manifest could not be read.' })
  // approved null: never set up (v9 of the live factory, below firstVaultNumber, used here as a test input only) or revoked
  const none = { approval: { ok: true, matches: null }, key: null, keyLimited: false }
  assert.deepEqual(agentState(facts(null, none), NOW), { state: 'Not approved', detail: 'Your vault approves no agent version, so no agent watches it.' })
  assert.deepEqual(agentState(facts(row({ agent_status: 'revoked' }), none), NOW), { state: 'Revoked', detail: 'Your vault holds no agent key and approves no agent version.' })
})

test('agent status: "revoked" counts only when the chain shows no key, or the agent reports another key on the vault', () => {
  const none = { key: null, keyLimited: false }
  assert.deepEqual(agentState(facts(row({ agent_status: 'revoked' }), none), NOW), { state: 'Revoked', detail: 'Your vault holds no agent key.' })
  assert.equal(agentState(facts(row(), none), NOW).state, 'Revoked') // the list still shows a registration the owner revoked
  assert.equal(agentState(facts(row({ agent_status: 'revoked (another key registered)' })), NOW).state, 'Revoked')
  assert.deepEqual(agentState(facts(null, none), NOW), { state: 'Registering', detail: 'Registering (usually within a few minutes).' })
  assert.equal(agentState(facts(row({ registration: 'registering', agent_status: 'revoked' }), none), NOW).state, 'Registering')
  assert.equal(agentState(facts(null, { ...none, listFailed: true }), NOW).state, 'Unavailable')
  assert.deepEqual(agentState(facts(row({ registration: 'registration failed (gave up for this boot)', agent_status: 'revoked' }), none), NOW), { state: 'Unavailable', detail: 'registration failed (gave up for this boot)' })
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

const tx = n => '0x' + n.repeat(64)
const at = (name, args, hash, logIndex, token) => ({ name, actor: name === 'Transfer' ? 'transfer' : 'you', blockNumber: 7n, time: 100n, transactionHash: hash, logIndex, args, token })

test('recent actions: one row per transaction; transfer legs of an Executor event fold into its row (Phase 7b)', () => {
  const MORPHO = '0x' + '55'.repeat(20)
  // Executor.open as the rehearsal showed it: Opened plus the WETH pull and the USDC payout, newest log first
  const open = [
    at('Transfer', { from: MORPHO, to: POSITION, value: 10_616_729n }, tx('a'), 3, USDC),
    at('Opened', { collateralIn: 10n ** 16n, borrowed: 10_616_729n, ltv: 499n * 10n ** 15n }, tx('a'), 2),
    at('Transfer', { from: POSITION, to: MORPHO, value: 10n ** 16n }, tx('a'), 1, WETH),
  ]
  const send = [at('Transfer', { from: OWNER, to: POSITION, value: 10n ** 16n }, tx('b'), 0, WETH)]
  const rows = actionRows([...open, ...send], ctx)
  assert.equal(rows.length, 2)
  assert.deepEqual([rows[0].who, rows[0].text, rows[0].transactionHash], ['You', 'Opened: supplied 0.01 WETH, borrowed 10.61 USDC at 49.9% LTV', tx('a')])
  assert.deepEqual([rows[1].who, rows[1].text], ['You', 'Sent 0.01 WETH from your wallet to your position address'])
  // two Executor events in one transaction share its row; the agent's label wins
  const reduce = actionRows([at('Reduced', { repaid: 1n, collateralSold: 1n, ltvBefore: 0n, ltvAfter: 0n }, tx('c'), 1), at('SessionEnded', { ltv: 0n }, tx('c'), 0)], ctx)
  assert.equal(reduce.length, 1); assert.equal(reduce[0].who, 'Agent'); assert.match(reduce[0].text, /^Reduced: .* · Ended a protective session/)
})

test('recent actions: every USDC amount has at most two decimals (Phase 7b)', () => {
  const amount = 10_722_897n // the 9 Nov close transfer
  const texts = [
    describe(item('Transfer', { from: OWNER, to: POSITION, value: amount }, USDC), ctx).text,
    describe(item('Opened', { collateralIn: 1n, borrowed: amount, ltv: 0n }), ctx).text,
    describe(item('Repaid', { repaid: amount }), ctx).text,
    describe(item('Closed', { repaid: amount, collateralOut: 1n }), ctx).text,
    describe(item('Reduced', { repaid: amount, collateralSold: 1n, ltvBefore: 0n, ltvAfter: 0n }), ctx).text,
    describe(item('Migrated', { from: LIVE, to: BACKUP, debtMoved: amount, collateralMoved: 1n }), ctx).text,
    describe(item('Exited', { repaid: amount, collateralSold: 1n }), ctx).text,
  ]
  for (const text of texts) {
    assert.match(text, /10\.72 USDC/, text)
    assert.doesNotMatch(text, /\d\.\d{3,} USDC/, text)
  }
})

test('Phase 7c: the agent card offers re-approval only for an open position that is Outdated or Not approved, never while closing', () => {
  assert.equal(approveAction('Outdated', 'active', false), 'Approve current agent version')
  assert.equal(approveAction('Not approved', 'active', false), 'Approve agent')
  assert.equal(approveAction('Revoked', 'active', false), 'Approve agent') // Phase 12: the list still shows the registration the chain no longer has
  for (const state of ['Active', 'Registering', 'Expired', 'Unavailable', null]) assert.equal(approveAction(state, 'active', false), null, String(state))
  assert.equal(approveAction('Outdated', 'active', true), null) // a close chain holds the vault's one owner-call lock
  assert.equal(approveAction('Revoked', 'active', true), null)
  // Phase 12: Revoke agent shows while the chain holds an approval or a key, never while another owner call runs
  const key = { public_key: 'ed25519:k', expires_at: 2_000_000_000 }
  const facts = (approval, vaultAgent) => ({ approval, keyLimited: true, vaultAgent, list: { ok: true, row: null } })
  assert.equal(canRevoke(facts({ ok: true, matches: true }, key), false), true)
  assert.equal(canRevoke(facts({ ok: true, matches: false }, null), false), true, 'an outdated approval can be revoked')
  assert.equal(canRevoke(facts({ ok: true, matches: null }, key), false), true, 'a key without approval can be revoked')
  assert.equal(canRevoke(facts({ ok: true, matches: null }, null), false), false, 'nothing to revoke')
  assert.equal(canRevoke(facts({ ok: false, error: 'x' }, null), false), false, 'manifest unreadable and no key: nothing known to revoke')
  assert.equal(canRevoke(facts({ ok: false, error: 'x' }, key), false), true, 'the key alone is enough')
  assert.equal(canRevoke(facts({ ok: true, matches: true }, key), true), false, 'another owner call runs')
  assert.equal(canRevoke(null, false), false)
  for (const variant of ['empty', 'closed', 'liquidated']) {
    assert.equal(approveAction('Outdated', variant, false), null, variant)
    assert.equal(approveAction('Not approved', variant, false), null, variant)
  }
})
