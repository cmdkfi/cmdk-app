// Phase 6b (PRD §8a, acceptance 13): the sandbox runs S1→S5 and Close position end to end on simulated adapters, with
// no network request to Base, NEAR, GitHub or the relayer, the banner on every screen, nothing in localStorage, and
// Leave sandbox returning to #start with no sandbox state left.
import type { Page } from '@playwright/test'
import { test, expect, type LiveFixture } from './live-fixture.ts'

const banner = (page: Page) => page.getByRole('status').filter({ hasText: 'Sandbox · simulated data' })

async function localKeys(page: Page) {
  return page.evaluate(() => Object.keys(window.localStorage).sort())
}

async function activate(page: Page) {
  await page.getByRole('button', { name: 'Try in sandbox' }).first().click()
  const sheet = page.getByRole('dialog', { name: 'Try in sandbox' })
  await expect(sheet).toContainText('Simulated wallet and simulated protocol. Nothing touches Base Sepolia or NEAR. Numbers are illustrative.')
  await sheet.getByRole('button', { name: 'Activate sandbox' }).click()
  await expect(page).toHaveURL(/#sandbox\/start$/)
  await expect(banner(page)).toBeVisible()
}

function quiet(fx: LiveFixture) {
  return { requests: fx.requests.length, wallet: fx.walletCalls.length, unexpected: fx.unexpected.length }
}

test('Phase 6b: the sandbox runs open, the scripted drop and reduce, close and Start over with no network request and nothing in localStorage; Leave clears it', async ({ page, context, fx }) => {
  test.setTimeout(120_000)
  await fx.install(context)
  await page.clock.install()
  await page.goto('/#connect')
  await expect(page.getByRole('button', { name: 'MetaMask', exact: true })).toBeVisible()
  const keysBefore = await localKeys(page)
  await activate(page)
  const before = quiet(fx)
  const hostsBefore = new Set(fx.hosts)

  // S1 → S2 → S3: the same screens, 0.5 ETH prefilled, the sandbox wallet already "connected"
  await expect(page.getByLabel('Amount to deposit')).toHaveValue('0.5')
  await expect(page.getByText('5.0% APR')).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/#sandbox\/settings$/)
  await expect(banner(page)).toBeVisible()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Continue to wallet' }).click()
  await expect(page).toHaveURL(/#sandbox\/connect$/)
  await expect(page.locator('.facts')).toContainText('Sandbox wallet')
  await page.getByRole('button', { name: 'Create position' }).click()

  // S4: every step completes on the simulated timers; verification rows are "Simulated (not checked)"
  await expect(page).toHaveURL(/#sandbox\/progress$/)
  await expect(page.getByRole('listitem', { name: 'Agent version approved by your vault' }).getByRole('status')).toHaveText('Simulated (not checked)')
  await expect(page.getByText(/^Checked$/)).toHaveCount(0)
  await expect(page).toHaveURL(/#sandbox\/position$/, { timeout: 60_000 })

  // S5: the position at 50 %; links are disabled and tagged simulated
  await expect(page.locator('.figure').filter({ hasText: 'LTV' }).locator('.big')).toHaveText('50%')
  await expect(page.locator('.simulated-link').first()).toContainText('simulated')
  await expect(page.locator('a[href*="basescan"], a[href*="nearblocks"]')).toHaveCount(0)
  await expect(banner(page)).toBeVisible()

  // the scripted −30 % move 20 s after open, the protective reduce 5 s later; the next 30 s read shows both
  await page.clock.fastForward(31_000)
  await page.clock.fastForward(31_000)
  await expect(page.locator('.event').filter({ hasText: 'Agent' }).first()).toContainText(/Reduced: sold [\d.]+ WETH to repay [\d.,]+ USDC, LTV 71\.\d% → (49\.\d|50)%/, { timeout: 20_000 })
  await expect(page.locator('.figure').filter({ hasText: 'LTV' }).locator('.big')).toHaveText(/^(49\.\d|50)%$/)

  // S6 → S7: Close position with the review sheet; the shortfall (interest) is sent from the sandbox wallet
  await page.getByRole('button', { name: 'Close position' }).click()
  await page.getByRole('dialog', { name: 'Close your position' }).getByRole('button', { name: 'Start closing' }).click()
  await expect(page.getByRole('heading', { name: 'Position closed' })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Start over' }).click()
  await expect(page).toHaveURL(/#sandbox\/start$/)

  // nothing left the browser and nothing was written to localStorage
  expect(quiet(fx)).toEqual(before)
  expect([...fx.hosts].filter(h => !hostsBefore.has(h))).toEqual([])
  expect(await localKeys(page)).toEqual(keysBefore)

  // Leave sandbox: confirmation, then #start with no sandbox state in sessionStorage
  await banner(page).getByRole('button', { name: 'Leave sandbox' }).click()
  const leave = page.getByRole('dialog', { name: 'Leave the sandbox?' })
  await expect(leave).toContainText('Simulated data is discarded.')
  await leave.getByRole('button', { name: 'Leave' }).click()
  await expect(page).toHaveURL(/#start$/)
  await expect(banner(page)).toHaveCount(0)
  expect(await page.evaluate(() => Object.keys(window.sessionStorage).filter(k => k.startsWith('cmdk.sandbox.')))).toEqual([])
  // back in the live app its own keys may be written again; none is the sandbox's
  expect((await localKeys(page)).filter(k => /sandbox/i.test(k))).toEqual([])
})

test('Phase 6b: "Try in sandbox" in the header while no wallet is connected, and on S3 when no wallet is installed; a reload stays in the sandbox', async ({ page, context, fx }) => {
  fx.walletSet = []
  await fx.install(context)
  await page.goto('/#start')
  await expect(page.getByRole('banner').getByRole('button', { name: 'Try in sandbox' })).toBeVisible()
  await page.goto('/#connect')
  await expect(page.getByText('No browser wallet was found.')).toBeVisible()
  await activate(page)
  await page.reload()
  await expect(page).toHaveURL(/#sandbox\/start$/)
  await expect(banner(page)).toBeVisible()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Try in sandbox' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Sandbox wallet/ })).toBeVisible()
  await page.getByRole('button', { name: /Sandbox wallet/ }).click()
  await page.getByRole('menuitem', { name: 'Leave sandbox' }).click()
  await page.getByRole('dialog', { name: 'Leave the sandbox?' }).getByRole('button', { name: 'Stay' }).click()
  await expect(page).toHaveURL(/#sandbox\/start$/)
})
