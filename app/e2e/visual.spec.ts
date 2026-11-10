// Phase 9 (PRD §7, 10 Nov): one screenshot per screen state against the fixture, so the markup and CSS taken from
// docs/mockups cannot drift unnoticed. Baselines are per platform (playwright.config.ts snapshotPathTemplate):
// darwin for local runs, linux for CI and the deploy workflow; scripts/update-visual-baselines.sh rewrites both, and
// only on purpose. Time is frozen at the fixture's clock, timezone and locale are fixed, animations are off.
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, fixtureLog, ADDRESSES, BASE, LIVE, OWNER, vault, type LiveFixture } from './live-fixture.ts'
import { SandboxEngine, STAGE_MS, STORAGE_KEY } from '../src/adapters/sandbox/engine.ts'
import { stringifyBig } from '../src/flow/json.ts'

const { WETH, EXECUTOR, MORPHO, USDC, NOW, HEAD } = ADDRESSES
const E = 10n ** 18n
const VAULT = 'v10.factory.fixture.testnet'
const SHARES = 160_080_000n

// A tall fixed viewport instead of fullPage: a full-page capture resizes the viewport, and the app unmounts its shell
// below 960 px (FR-16), which would reset the screen being captured.
test.use({ timezoneId: 'UTC', locale: 'en-US', viewport: { width: 1280, height: 2200 } })

async function frozen(page: Page) {
  // the fixture's NOW plus 20 s: block times, feed ages and "N s ago" lines are fixed
  await page.clock.setFixedTime(new Date((NOW + 20) * 1000))
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 })
}

async function connect(page: Page) {
  await page.goto('/#connect')
  await page.getByRole('button', { name: 'MetaMask', exact: true }).click()
}

function position(fx: LiveFixture, overrides: Parameters<typeof vault>[0] = {}) {
  fx.factoryCount = 10
  fx.vaults.set(10, vault({ borrowShares: SHARES, ...overrides }))
  fx.agentRows = [{ slot: 10, vault: VAULT, base_address: BASE, registration: 'registered', registration_tx: 'RegTx1111111111111111111111111111111111111111', agent_status: 'active', expires_at: NOW + 6 * 86_400, last_tick_unix: NOW - 18 }]
  fx.logs = [
    fixtureLog(WETH, 'Transfer', { from: OWNER, to: BASE, value: E / 10n }, HEAD - 11n),
    fixtureLog(WETH, 'Transfer', { from: BASE, to: MORPHO, value: E / 10n }, HEAD - 10n, 1, 'open'),
    fixtureLog(EXECUTOR, 'Opened', { caller: BASE, market: LIVE, collateralIn: E / 10n, borrowed: 160_000_000n, ltv: 5n * 10n ** 17n }, HEAD - 10n, 2, 'open'),
    fixtureLog(USDC, 'Transfer', { from: MORPHO, to: BASE, value: 160_000_000n }, HEAD - 10n, 3, 'open'),
    fixtureLog(USDC, 'Transfer', { from: BASE, to: OWNER, value: 160_000_000n }, HEAD - 9n),
  ]
}

test('S1 Choose', async ({ page, context, fx }) => {
  await fx.install(context); await frozen(page)
  await page.goto('/#start')
  await expect(page.getByText('5.0% APR')).toBeVisible()
  await shot(page, 's1-choose')
})

test('S2 Settings', async ({ page, context, fx }) => {
  await fx.install(context); await frozen(page)
  await page.goto('/#settings')
  await expect(page.getByText('Liquidation 86%')).toBeVisible()
  await shot(page, 's2-settings')
})

test('S3 Connect: the wallets in this browser', async ({ page, context, fx }) => {
  fx.walletSet = ['metamask', 'rabby']
  await fx.install(context); await frozen(page)
  await page.goto('/#connect')
  await expect(page.getByRole('button', { name: 'Rabby Wallet' })).toBeVisible()
  await shot(page, 's3-wallets')
})

test('S3 Connect: connected, funded, Create position', async ({ page, context, fx }) => {
  fx.factoryCount = 9
  await fx.install(context); await frozen(page)
  await connect(page)
  await expect(page.getByText('None for this wallet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create position' })).toBeEnabled()
  await shot(page, 's3-connected')
})

test('S3a Get Base Sepolia ETH', async ({ page, context, fx }) => {
  fx.factoryCount = 9
  fx.wallet.eth = 4n * 10n ** 15n
  await fx.install(context); await frozen(page)
  await connect(page)
  await expect(page.getByRole('complementary', { name: 'Get Base Sepolia ETH' })).toBeVisible()
  await shot(page, 's3a-get-eth')
})

test('S4 Progress: a declined prompt, with the verification rail', async ({ page, context, fx }) => {
  fx.factoryCount = 9
  fx.rejectOnce.add('setup')
  await fx.install(context); await frozen(page)
  await connect(page)
  await page.getByRole('button', { name: 'Create position' }).click()
  await expect(page.getByRole('listitem', { name: 'Approve agent and rules' })).toContainText('You declined the request in MetaMask', { timeout: 20_000 })
  await expect(page.getByRole('listitem', { name: 'Vault code matches the factory' }).getByRole('status')).toHaveText('Checked')
  await shot(page, 's4-progress')
})

test('S5 Position', async ({ page, context, fx }) => {
  position(fx)
  await fx.install(context); await frozen(page)
  await connect(page)
  await expect(page).toHaveURL(/#position$/)
  await expect(page.locator('.event')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Close position' })).toBeEnabled()
  await expect(page.locator('.card-head').getByRole('status').first()).toHaveText('Active')
  await shot(page, 's5-position')
})

test('S0 header: connected, wallet menu open', async ({ page, context, fx }) => {
  position(fx)
  await fx.install(context); await frozen(page)
  await connect(page)
  await expect(page).toHaveURL(/#position$/)
  await page.getByRole('button', { name: /· Base Sepolia/ }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close position' })).toBeEnabled()
  await expect(page).toHaveScreenshot('s0-wallet-menu.png', { clip: { x: 0, y: 0, width: 1280, height: 280 }, animations: 'disabled', maxDiffPixelRatio: 0.01 })
})

test('S6 Close: wallet short of USDC, Get test USDC', async ({ page, context, fx }) => {
  position(fx, { idle: { eth: 5n * 10n ** 15n, weth: 0n, usdc: 0n } })
  fx.wallet.usdc = 100_000_000n
  await fx.install(context); await frozen(page)
  await connect(page)
  await page.getByRole('button', { name: 'Close position' }).click()
  await page.getByRole('dialog', { name: 'Close your position' }).getByRole('button', { name: 'Start closing' }).click()
  await expect(page.getByRole('complementary', { name: 'Get test USDC' })).toBeVisible({ timeout: 15_000 })
  await shot(page, 's6-close-get-usdc')
})

test('S6 review sheet', async ({ page, context, fx }) => {
  position(fx, { idle: { eth: 5n * 10n ** 15n, weth: 0n, usdc: 0n } })
  await fx.install(context); await frozen(page)
  await connect(page)
  await page.getByRole('button', { name: 'Close position' }).click()
  await expect(page.getByRole('dialog', { name: 'Close your position' })).toBeVisible()
  await shot(page, 's6-review-sheet')
})

test('S5 Revoke the agent sheet', async ({ page, context, fx }) => {
  position(fx)
  await fx.install(context); await frozen(page)
  await connect(page)
  await page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Agent', exact: true }) }).getByRole('button', { name: 'Revoke agent' }).click()
  await expect(page.getByRole('dialog', { name: 'Revoke the agent?' })).toBeVisible()
  await shot(page, 's5-revoke-sheet')
})

test('S7 Position closed, Start over', async ({ page, context, fx }) => {
  position(fx, { idle: { eth: 5n * 10n ** 15n, weth: 0n, usdc: 200_000_000n } })
  await fx.install(context); await frozen(page)
  await connect(page)
  await page.getByRole('button', { name: 'Close position' }).click()
  await page.getByRole('dialog', { name: 'Close your position' }).getByRole('button', { name: 'Start closing' }).click()
  await expect(page.getByRole('heading', { name: 'Position closed' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Start over' })).toBeVisible()
  await shot(page, 's7-closed')
})

test('S5 liquidated', async ({ page, context, fx }) => {
  position(fx, { collateral: 0n })
  fx.logs = []
  await fx.install(context); await frozen(page)
  await connect(page)
  await expect(page.getByRole('heading', { name: 'Position liquidated' })).toBeVisible()
  await expect(page.getByText('No actions in this range.')).toBeVisible()
  await shot(page, 's5-liquidated')
})

// Phase 6b sandbox (docs/mockups S8, S11, the banner of S8–S11)
test('S8 Try in sandbox sheet', async ({ page, context, fx }) => {
  await fx.install(context); await frozen(page)
  await page.goto('/#connect')
  await page.getByRole('button', { name: 'Try in sandbox' }).last().click()
  await expect(page.getByRole('dialog', { name: 'Try in sandbox' })).toBeVisible()
  await shot(page, 's8-sandbox-sheet')
})

test('Sandbox S1 with the banner', async ({ page, context, fx }) => {
  await fx.install(context); await frozen(page)
  await page.goto('/#connect')
  await page.getByRole('button', { name: 'Try in sandbox' }).last().click()
  await page.getByRole('dialog', { name: 'Try in sandbox' }).getByRole('button', { name: 'Activate sandbox' }).click()
  await expect(page.getByText('about 802.5 USDC')).toBeVisible()
  await shot(page, 'sandbox-s1')
})

test('S11 Leave the sandbox?', async ({ page, context, fx }) => {
  await fx.install(context); await frozen(page)
  await page.goto('/#connect')
  await page.getByRole('button', { name: 'Try in sandbox' }).last().click()
  await page.getByRole('dialog', { name: 'Try in sandbox' }).getByRole('button', { name: 'Activate sandbox' }).click()
  await page.getByRole('status').filter({ hasText: 'Sandbox · simulated data' }).getByRole('button', { name: 'Leave sandbox' }).click()
  await expect(page.getByRole('dialog', { name: 'Leave the sandbox?' })).toBeVisible()
  await shot(page, 's11-leave-sandbox')
})

// Phase 11 sandbox market crash (PRD §8a.1). The sandbox engine's state for a position opened with 0.5 ETH, built with
// the engine itself on the frozen clock (create, setup, wrap, transfer, open, USDC to the wallet, as S4 runs them) and
// seeded into sessionStorage, so block numbers and action times are fixed; the stages are then clicked in the page.
function sandboxOpenPosition(): string {
  const pct = (n: number) => BigInt(n) * 10n ** 16n
  let now = (NOW + 20) * 1000 - 30_000
  // the corridor only steers the agent's reduce, which runs in the page's own engine (built from sandboxConfig)
  const engine = new SandboxEngine({ target: pct(50), act: pct(70), floor: pct(30), budget: pct(20) }, () => now, false)
  const deposit = 5n * E / 10n
  engine.createVault(); now += STAGE_MS
  engine.ownerCall('setup', {}, 1); now += STAGE_MS
  engine.walletTx({ kind: 'wrap', amount: deposit }); engine.walletTx({ kind: 'transfer', token: 'weth', amount: deposit })
  engine.ownerCall('open', { collateral_in: deposit.toString(), target_ltv: pct(50).toString() }, 2); now += STAGE_MS
  engine.ownerCall('withdraw', { token: 'usdc', amount: engine.state().vault!.idle.usdc.toString() }, 3); now += STAGE_MS
  now = (NOW + 20) * 1000
  return stringifyBig(engine.state())
}

async function sandboxPosition(page: Page, context: BrowserContext, fx: LiveFixture) {
  await fx.install(context); await frozen(page)
  await context.addInitScript(([key, value]) => { window.sessionStorage.setItem(key, value) }, [STORAGE_KEY, sandboxOpenPosition()] as const)
  await page.goto('/#sandbox/position')
  await expect(page.getByRole('region', { name: 'Market crash' })).toBeVisible()
}

test('Sandbox S5: Market crash before the run', async ({ page, context, fx }) => {
  await sandboxPosition(page, context, fx)
  await expect(page.getByRole('button', { name: 'Run market crash' })).toBeVisible()
  await shot(page, 'sandbox-s5-crash-ready')
})

test('Sandbox S5: Market crash at stage 3', async ({ page, context, fx }) => {
  await sandboxPosition(page, context, fx)
  const card = page.getByRole('region', { name: 'Market crash' })
  await card.getByRole('button', { name: 'Run market crash' }).click()
  await card.getByRole('button', { name: 'Next: the price keeps falling' }).click()
  await card.getByRole('button', { name: 'Next: the price recovers' }).click()
  await expect(card.locator('.crash-summary')).toContainText('$596.14 with the agent, $81.94 without')
  await expect(page.locator('.event').filter({ hasText: 'Reduced' })).toHaveCount(1)
  await shot(page, 'sandbox-s5-crash-stage3')
})

