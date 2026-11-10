import type { Page } from '@playwright/test'
import { test, expect, fixtureLog, ADDRESSES, BASE, LIVE, OWNER, vault, type LiveFixture } from './live-fixture.ts'

const { WETH, EXECUTOR, NOW, HEAD } = ADDRESSES
const E = 10n ** 18n
const VAULT = 'v10.factory.fixture.testnet'

function activeVault(fx: LiveFixture) {
  fx.factoryCount = 10
  fx.vaults.set(10, vault({ borrowShares: 160_080_000n }))
  fx.agentRows = [{ slot: 0, vault: VAULT, base_address: BASE, registration: 'registered', agent_status: 'active', expires_at: NOW + 86_400, last_tick_unix: Math.floor(Date.now() / 1000) - 40 }]
  fx.logs = [
    fixtureLog(WETH, 'Transfer', { from: OWNER, to: BASE, value: E / 10n }, HEAD - 11n),
    fixtureLog(EXECUTOR, 'Opened', { caller: BASE, market: LIVE, collateralIn: E / 10n, borrowed: 160_000_000n, ltv: 5n * 10n ** 17n }, HEAD - 10n),
    fixtureLog(EXECUTOR, 'Repaid', { caller: BASE, market: LIVE, repaid: 1_000_000n }, HEAD - 5n),
  ]
}

async function openPosition(page: Page) {
  await page.goto('/#connect') // Phase 8: no Connect button in the header; S3 lists the wallets
  await page.getByRole('button', { name: 'MetaMask', exact: true }).click()
  await expect(page).toHaveURL(/#position$/)
  await expect(page.getByText(new RegExp(`^Read at block ${HEAD}, \\d+ s ago$`))).toBeVisible()
  await expect(page.locator('.event')).toHaveCount(3)
}

const readLine = (page: Page, block: bigint, suffix = '') => page.getByText(new RegExp(`^Read at block ${block}, \\d+ (s|min) ago${suffix}$`))

test('§9 1, 2, 6 and Phase 7b: one S5 refresh is at most 8 HTTP requests: block pin + two Multicall3 rounds, recent actions up to the same block, one shared get_state, the key list, the agent list, the published manifest', async ({ page, context, fx }) => {
  activeVault(fx)
  await page.clock.install()
  await fx.install(context); await openPosition(page)
  await page.waitForTimeout(1_000) // let the first load settle (agent card, activity, close plan)
  fx.requests.length = 0; fx.ethCalls.length = 0
  fx.head += 1n
  await page.clock.fastForward(31_000)
  await expect(readLine(page, HEAD + 1n)).toBeVisible()
  await expect(page.locator('section.card').filter({ hasText: 'Agent' }).first().getByRole('status')).toHaveText('Active')
  await page.waitForTimeout(1_000)
  const refresh = fx.requests
  expect(refresh.length, JSON.stringify(refresh)).toBeLessThanOrEqual(8)
  const base = refresh.filter(r => r.host === 'base.fixture.test')
  // recent actions follow the position's block (Phase 7b): one batch of the two filtered log queries, new blocks only
  expect(base.map(r => r.calls)).toEqual([['eth_getBlockByNumber'], ['eth_call'], ['eth_call'], ['eth_getLogs', 'eth_getLogs']])
  await expect(page.getByText(new RegExp(`^Blocks \\d+–${HEAD + 1n}`))).toBeVisible()
  // both rounds went through Multicall3 aggregate3 at viem's baseSepolia address; no static read was repeated
  expect(fx.ethCalls.filter(name => name === 'aggregate3')).toHaveLength(2)
  for (const name of ['idToMarketParams', 'config', 'decimals']) expect(fx.ethCalls).not.toContain(name)
  // one NEAR get_state shared by the position and agent reads, plus the agent's key list; one relayer read
  expect(refresh.filter(r => r.calls.some(c => c.includes(':get_state')))).toHaveLength(1)
  expect(refresh.filter(r => r.calls.some(c => c.includes('view_access_key_list')))).toHaveLength(1)
  expect(refresh.filter(r => r.host === 'relayer.fixture.test').map(r => r.calls[0])).toEqual(['GET /agent/vaults'])
})

test('§9 4, 5: on return the saved snapshot paints at once with its block and age, marked refreshing and unusable for actions, until the live read lands; the remembered vault skips the factory scan', async ({ page, context, fx }) => {
  activeVault(fx)
  await fx.install(context); await openPosition(page)
  await page.waitForTimeout(1_500) // the persister writes at most once a second
  fx.head += 5n
  fx.baseDelayMs = 1_200
  fx.requests.length = 0
  await page.reload()
  await expect(readLine(page, HEAD, ' · refreshing')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.figure').filter({ hasText: 'Debt' }).locator('.big')).toHaveText('160 USDC')
  await expect(page.getByRole('button', { name: 'Close position' })).toBeDisabled()
  await expect(page.locator('#close-reason')).toHaveText('Refreshing your position…')
  await expect(readLine(page, HEAD + 5n)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Close position' })).toBeEnabled({ timeout: 20_000 })
  // discovery used the remembered vault: one get_state of v10, no factory get_config
  const near = fx.requests.filter(r => r.host === 'near.fixture.test').flatMap(r => r.calls)
  expect(near.filter(c => c.includes('get_config'))).toEqual([])
})

test('§9 3: the saved activity shows at once on return and only the blocks after it are read, in one window', async ({ page, context, fx }) => {
  activeVault(fx)
  await fx.install(context); await openPosition(page)
  await page.waitForTimeout(500)
  fx.head += 20n
  fx.logs.push(fixtureLog(EXECUTOR, 'Repaid', { caller: BASE, market: LIVE, repaid: 2_000_000n }, HEAD + 15n))
  fx.logWindows.length = 0
  fx.baseDelayMs = 800
  await page.reload()
  // the saved list (blocks up to HEAD − 1, two confirmations at the time) shows before the new window lands
  await expect(page.getByText('saved list, reading newer blocks…', { exact: false })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.event')).toHaveCount(3)
  await expect(page.locator('.event')).toHaveCount(4, { timeout: 20_000 })
  await expect(page.locator('.event').first()).toContainText('YouRepaid 2 USDC')
  // one window: from the first unsaved block (HEAD) to the new head; its two topic-filtered queries share the range
  expect([...new Set(fx.logWindows.map(([from, to]) => `${from}-${to}`))]).toEqual([`${HEAD}-${HEAD + 20n}`])
  expect(fx.logWindows).toHaveLength(2)
})

test('NEAR fallback: with the primary down, discovery and S5 read through the fallback URL', async ({ page, context, fx }) => {
  activeVault(fx)
  fx.nearPrimaryDown = true
  await fx.install(context); await openPosition(page)
  expect(fx.requests.some(r => r.host === 'near-fallback.fixture.test')).toBe(true)
  expect(fx.requests.filter(r => r.host === 'near.fixture.test')).toEqual([]) // aborted before the fixture answers
})
