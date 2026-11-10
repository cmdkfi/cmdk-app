import type { Page } from '@playwright/test'
import { test, expect, fixtureLog, ADDRESSES, BASE, LIVE, OWNER, vault, type LiveFixture } from './live-fixture.ts'

const { WETH, USDC, EXECUTOR, NOW, HEAD, DEPLOY } = ADDRESSES
const VAULT = 'v10.factory.fixture.testnet'
const E = 10n ** 18n
// 160.08 M shares against equal totals (2000 USDC) are 160.000001 USDC of debt (Morpho toAssetsUp with virtual shares).
const SHARES = 160_080_000n

function activeVault(fx: LiveFixture, overrides: Parameters<typeof vault>[0] = {}) {
  fx.factoryCount = 10
  fx.vaults.set(10, vault({ borrowShares: SHARES, ...overrides }))
  fx.agentRows = [{ slot: 0, vault: VAULT, base_address: BASE, registration: 'registered', agent_status: 'active', expires_at: NOW + 86_400, last_tick_unix: Math.floor(Date.now() / 1000) - 40 }]
}

async function openPosition(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await expect(page).toHaveURL(/#position$/)
}

const card = (page: Page, title: string) => page.locator('section.card-s5').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
const fact = (page: Page, cardTitle: string, label: string) => card(page, cardTitle).locator('.card-s5__facts > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')
const figure = (page: Page, label: string) => page.locator('.hero-s5__figure').filter({ has: page.getByText(label, { exact: true }) })

test('active position: hero, agent, market, idle line and recent actions render from the reads', async ({ page, context, fx }) => {
  activeVault(fx)
  fx.sold = 5n * 10n ** 15n
  fx.logs = [
    fixtureLog(WETH, 'Transfer', { from: OWNER, to: BASE, value: E / 10n }, HEAD - 11n),
    fixtureLog(EXECUTOR, 'Opened', { caller: BASE, market: LIVE, collateralIn: E / 10n, borrowed: 160_000_000n, ltv: 5n * 10n ** 17n }, HEAD - 10n),
    fixtureLog(EXECUTOR, 'Reduced', { caller: BASE, market: LIVE, repaid: 20_000_000n, collateralSold: E / 100n, ltvBefore: 71n * 10n ** 16n, ltvAfter: 5n * 10n ** 17n, protective: true }, HEAD - 5n),
  ]
  await fx.install(context); await openPosition(page)

  await expect(page.getByRole('heading', { name: 'Your position' })).toBeVisible()
  await expect(page.getByText(new RegExp(`^Read at block ${HEAD}, \\d+ s ago$`))).toBeVisible()
  // hero: debt accrued to the read block, collateral in WETH and USD, LTV with the corridor and LLTV marks
  await expect(figure(page, 'Debt').locator('strong')).toHaveText('160 USDC')
  await expect(figure(page, 'Debt')).toContainText(`with interest accrued to block ${HEAD}`)
  await expect(figure(page, 'Collateral').locator('strong')).toHaveText('0.1 WETH')
  await expect(figure(page, 'Collateral')).toContainText('≈ $320 at the market oracle')
  await expect(figure(page, 'LTV').locator('strong')).toHaveText('50%')
  for (const [label, value] of [['Floor', '30%'], ['Target', '50%'], ['Agent acts', '70%'], ['Liquidation', '86%']]) {
    await expect(figure(page, 'LTV').locator('.vault-ltv-legend > div').filter({ hasText: label }).locator('dd')).toHaveText(value)
  }
  // agent card: /agent/vaults row + NEAR key check; sell budget (0.1 + 0.005) × 20 % − 0.005 = 0.016 WETH
  await expect(card(page, 'Agent').getByRole('status')).toHaveText('Active')
  await expect(fact(page, 'Agent', 'Last check')).toHaveText(/\(\d+ s ago\)$/)
  await expect(fact(page, 'Agent', 'Sell budget left today')).toHaveText('0.016 WETH of 0.021 WETH (20% per rolling 24 h)')
  await card(page, 'Agent').getByRole('button', { name: 'Verify the agent' }).click()
  await expect(page.getByRole('region', { name: 'Agent verification' })).toBeVisible() // the §6 panel (Phase 6)
  // market card
  await expect(fact(page, 'Market', 'Market')).toHaveText('Morpho · USDC/WETH on Base Sepolia · live')
  await expect(fact(page, 'Market', 'Liquidation LTV')).toHaveText('86%')
  // oracle source and freshness from the Executor's configured feed (named by the manifest's base.chainlink)
  await expect(fact(page, 'Market', 'Oracle')).toHaveText(/^Chainlink ETH\/USD · updated \d+ s ago$/)
  await expect(fact(page, 'Market', 'Market id')).toContainText(`${LIVE.slice(0, 10)}…${LIVE.slice(-6)}`)
  await expect(fact(page, 'Market', 'Market id').getByRole('link', { name: 'Executor' })).toHaveAttribute('href', `https://sepolia.basescan.org/address/${EXECUTOR}`)
  await expect(fact(page, 'Market', 'Backup market')).toHaveText('Approved for migration')
  await expect(fact(page, 'Market', 'Position address').getByRole('link')).toHaveAttribute('href', `https://sepolia.basescan.org/address/${BASE}`)
  await expect(fact(page, 'Market', 'Vault').getByRole('link')).toHaveAttribute('href', `https://testnet.nearblocks.io/address/${VAULT}`)
  // idle balances at the position address (the fixture vault holds 0.005 ETH for gas)
  await expect(page.locator('.idle-line')).toHaveText('At your position address, outside Morpho: 0.005 ETH for gas')
  // recent actions, newest first, labelled by event name
  const rows = card(page, 'Recent actions').locator('.actions__row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('AgentReduced: sold 0.01 WETH to repay 20 USDC, LTV 71% → 50%')
  await expect(rows.nth(1)).toContainText('YouOpened: supplied 0.1 WETH, borrowed 160 USDC at 50% LTV')
  await expect(rows.nth(2)).toContainText('YouSent 0.1 WETH from your wallet to your position address')
  await expect(rows.nth(0).getByRole('link', { name: 'BaseScan' })).toHaveAttribute('href', `https://sepolia.basescan.org/tx/${fx.logs[2].transactionHash}`)
  await expect(card(page, 'Recent actions').getByText(`Blocks ${DEPLOY}–${HEAD} (since the Executor was deployed)`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Load earlier' })).toHaveCount(0)
  // the only action: Close position, with what it will do (no USDC idle, wallet has none: a transfer comes first)
  await expect(page.getByRole('button', { name: 'Close position' })).toBeEnabled()
  await expect(page.locator('#close-reason')).toHaveText(/^You will first send 161\.6\d? USDC to your position address, then the debt is repaid and your WETH returns to your wallet\.$/)
  expect(fx.ethCalls).toEqual(expect.arrayContaining(['soldInWindow', 'closedForAgent']))
  expect(fx.signs).toEqual([]); expect(fx.posts).toEqual([]); expect(fx.txs).toEqual([])
})

test('read failure: the last snapshot stays, marked read-only with its age; the next good read clears it', async ({ page, context, fx }) => {
  activeVault(fx)
  await page.clock.install()
  await fx.install(context); await openPosition(page)
  await expect(figure(page, 'Debt').locator('strong')).toHaveText('160 USDC')
  fx.baseDown = true
  await page.clock.fastForward(31_000)
  await expect(page.getByRole('alert').filter({ hasText: new RegExp(`^The latest read failed\\. This is the snapshot from block ${HEAD}, \\d+ s ago; it is read-only until a read succeeds\\.$`) })).toBeVisible()
  await expect(page.getByText(new RegExp(`^Read at block ${HEAD}, \\d+ s ago · read-only$`))).toBeVisible()
  await expect(figure(page, 'Debt').locator('strong')).toHaveText('160 USDC')
  await expect(page.locator('.position--stale')).toHaveCount(1)
  fx.baseDown = false
  await page.clock.fastForward(31_000)
  await expect(page.getByText('The latest read failed', { exact: false })).toHaveCount(0)
  await expect(page.locator('.position--stale')).toHaveCount(0)
})

test('liquidated: collateral 0 with debt left shows the remaining debt, no recovery promise and no actions', async ({ page, context, fx }) => {
  activeVault(fx, { collateral: 0n })
  await fx.install(context); await openPosition(page)
  await expect(page.getByRole('heading', { name: 'Position liquidated' })).toBeVisible()
  await expect(page.getByText('Morpho liquidated the collateral. 160 USDC of debt remains on the market. This app offers no recovery for a liquidated position.')).toBeVisible()
  await expect(figure(page, 'Collateral').locator('strong')).toHaveText('0 WETH')
  await expect(figure(page, 'LTV').locator('strong')).toHaveText('unbounded')
  await expect(page.getByRole('button', { name: 'Close position' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /start over/i })).toHaveCount(0)
  await expect(page.getByText(/recover(ed|s)? your/i)).toHaveCount(0)
})

test('recent actions: Load earlier extends by 10,000 blocks until the Executor deploy block; the range is stated', async ({ page, context, fx }) => {
  activeVault(fx)
  fx.head = DEPLOY + 24_999n // 30,025,000: three windows down to the deploy block
  fx.logs = [
    fixtureLog(EXECUTOR, 'Repaid', { caller: BASE, market: LIVE, repaid: 1_000_000n }, DEPLOY + 23_999n),
    fixtureLog(USDC, 'Transfer', { from: BASE, to: OWNER, value: 160_000_000n }, DEPLOY + 11_999n),
    fixtureLog(EXECUTOR, 'CorridorSet', { caller: BASE, market: LIVE, corridor: { target: 5n * 10n ** 17n, act: 7n * 10n ** 17n, floor: 3n * 10n ** 17n, sellBudget: 2n * 10n ** 17n, migrateAllowed: true, exitAllowed: true, set: true } }, DEPLOY + 2_999n),
  ]
  await fx.install(context); await openPosition(page)
  const actions = card(page, 'Recent actions'), rows = actions.locator('.actions__row')
  await expect(actions.getByText(`Blocks ${DEPLOY + 15_000n}–${DEPLOY + 24_999n}`, { exact: true })).toBeVisible()
  await expect(rows).toHaveCount(1)
  await expect(rows.nth(0)).toContainText('YouRepaid 1 USDC')
  await page.getByRole('button', { name: 'Load earlier' }).click()
  await expect(actions.getByText(`Blocks ${DEPLOY + 5_000n}–${DEPLOY + 24_999n}`, { exact: true })).toBeVisible()
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(1)).toContainText('You160 USDC from your position address to your wallet')
  await page.getByRole('button', { name: 'Load earlier' }).click()
  await expect(actions.getByText(`Blocks ${DEPLOY}–${DEPLOY + 24_999n} (since the Executor was deployed)`)).toBeVisible()
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(2)).toContainText('YouRules set on the live market')
  await expect(page.getByRole('button', { name: 'Load earlier' })).toHaveCount(0)
  // every eth_getLogs stayed within 10,000 blocks (the fixture refuses wider ones), in three windows
  expect([...new Set(fx.logWindows.map(([from, to]) => `${from}-${to}`))]).toEqual([`${DEPLOY + 15_000n}-${DEPLOY + 24_999n}`, `${DEPLOY + 5_000n}-${DEPLOY + 14_999n}`, `${DEPLOY}-${DEPLOY + 4_999n}`])
})

test('Phase 7b: token legs of an Executor call fold into its row; one disclaimer (the footer); recent actions end at the position\'s block', async ({ page, context, fx }) => {
  activeVault(fx)
  const { MORPHO } = ADDRESSES
  fx.logs = [
    fixtureLog(WETH, 'Transfer', { from: OWNER, to: BASE, value: E / 10n }, HEAD - 11n),
    // Executor.open: the WETH leg to Morpho, Opened, the USDC leg from Morpho, all in one transaction
    fixtureLog(WETH, 'Transfer', { from: BASE, to: MORPHO, value: E / 10n }, HEAD - 10n, 1, 'open'),
    fixtureLog(EXECUTOR, 'Opened', { caller: BASE, market: LIVE, collateralIn: E / 10n, borrowed: 160_000_000n, ltv: 5n * 10n ** 17n }, HEAD - 10n, 2, 'open'),
    fixtureLog(USDC, 'Transfer', { from: MORPHO, to: BASE, value: 160_000_000n }, HEAD - 10n, 3, 'open'),
  ]
  await fx.install(context); await openPosition(page)
  const rows = card(page, 'Recent actions').locator('.actions__row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toHaveText(/^YouOpened: supplied 0\.1 WETH, borrowed 160 USDC at 50% LTV/)
  await expect(rows.nth(1)).toContainText('YouSent 0.1 WETH from your wallet to your position address')
  await expect(page.getByText(/not insurance/)).toHaveCount(1)
  await expect(page.locator('footer').getByText('Agent protection is risk management, not insurance.', { exact: false })).toHaveCount(1)
  await expect(card(page, 'Recent actions').getByText(`Blocks ${DEPLOY}–${HEAD} (since the Executor was deployed)`)).toBeVisible()
  await expect(page.getByText(new RegExp(`^Read at block ${HEAD}, `))).toBeVisible()
})

test('Phase 7b: Show USDC in MetaMask asks the wallet to watch the config USDC (symbol and decimals from the token), on S5 and in the wallet menu', async ({ page, context, fx }) => {
  activeVault(fx)
  await fx.install(context); await openPosition(page)
  const line = page.locator('.wallet-line')
  await expect(line).toContainText(`Your wallet ${OWNER.slice(0, 6)}…${OWNER.slice(-4)}`)
  await line.getByRole('button', { name: 'Show USDC in MetaMask' }).click()
  await expect(line.getByRole('status')).toHaveText('MetaMask accepted USDC.')
  const expected = { type: 'ERC20', options: { address: USDC, symbol: 'USDC', decimals: 6, image: expect.stringMatching(/\/tokens\/usdc\.png$/) } }
  expect(fx.watchAssets).toEqual([expected])
  await page.getByRole('button', { name: /· Base Sepolia/ }).click()
  await page.getByRole('menuitem', { name: 'Show USDC in MetaMask' }).click()
  await expect.poll(() => fx.watchAssets.length).toBe(2)
  expect(fx.watchAssets[1]).toEqual(expected)
})

