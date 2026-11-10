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

/** S1 → S2 → S3 → S4 in the sandbox: 0.5 ETH, accept, the one S3 button (Create position, or Deposit after Start over). */
async function onboard(page: Page, s3Button: 'Create position' | 'Deposit') {
  await expect(page.getByLabel('Amount to deposit')).toHaveValue('0.5')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/#sandbox\/settings$/)
  const accept = page.getByRole('checkbox')
  if (!(await accept.isChecked())) await accept.check()
  await page.getByRole('button', { name: 'Continue to wallet' }).click()
  await expect(page).toHaveURL(/#sandbox\/connect$/)
  await page.getByRole('button', { name: s3Button }).click()
  await expect(page).toHaveURL(/#sandbox\/position$/, { timeout: 60_000 })
}

const crashCard = (page: Page) => page.getByRole('region', { name: 'Market crash' })
const stageCell = (page: Page, stage: string, column: 'without' | 'with') => crashCard(page).locator(`tr[data-stage="${stage}"] [data-column="${column}"]`)
const heroLtv = (page: Page) => page.locator('.figure').filter({ hasText: 'LTV' }).locator('.big')
/** A hero figure as one line, e.g. "320.99 USDC" (the number and its unit are separate elements). */
const hero = async (page: Page, label: 'Debt' | 'Collateral' | 'LTV') => (await page.locator('.figure').filter({ hasText: label }).locator('.big').innerText()).replace(/\s+/g, ' ').trim()

function quiet(fx: LiveFixture) {
  return { requests: fx.requests.length, wallet: fx.walletCalls.length, unexpected: fx.unexpected.length }
}

test('Phase 6b/11: the sandbox runs open, the market crash (three stages, with and without the agent), close and Start over with no network request and nothing in localStorage; Leave clears it', async ({ page, context, fx }) => {
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
  await expect(page.locator('body')).not.toContainText('Market crash')
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
  // setup set the corridor on both markets: two rows, as in the live app (product owner's live review, 10 Nov)
  await expect(page.locator('.event').filter({ hasText: 'Rules set on the live market' })).toHaveCount(1)
  await expect(page.locator('.event').filter({ hasText: 'Rules set on the backup market' })).toHaveCount(1)
  await expect(banner(page)).toBeVisible()

  // PRD §8a.1: no timer. A minute later nothing has moved; the Market crash card offers the one button
  const card = crashCard(page)
  await expect(card).toContainText('See what happens in a crash. The price of ETH falls 45% and recovers; compare your position with and without the agent.')
  await expect(card).toContainText('Scripted price path; numbers are illustrative.')
  await page.clock.fastForward(61_000)
  await expect(heroLtv(page)).toHaveText('50%')
  await expect(page.locator('.event').filter({ hasText: 'Reduced' })).toHaveCount(0)

  // stage 1, −30%: without the agent nothing happens at 71.4%; the agent's protective reduce returns the position to 50%
  await card.getByRole('button', { name: 'Run market crash' }).click()
  await expect(stageCell(page, 'open', 'without')).toHaveText('0.5 WETH ($1,605) · debt 802.5 USDC · LTV 50% · 802.5 USDC in your wallet')
  await expect(stageCell(page, 'open', 'with')).toHaveText('Same')
  await expect(card.locator('tr[data-stage="stage-1"] th')).toHaveText('1 · The price falls 30%$2,247')
  await expect(stageCell(page, 'stage-1', 'without')).toHaveText('LTV 71.4%. Nothing happens; the position waits for the market.')
  // figures as the hero formats them (truncated); interest accrued since open moves the last digits of the debt
  await expect(stageCell(page, 'stage-1', 'with')).toHaveText(/^LTV crosses 70%: the agent sells 0\.214285 WETH at \$2,247 to repay 481\.5 USDC\. Collateral 0\.285714 WETH, debt (320\.99|321) USDC, LTV (49\.9|50)%\. A Reduced row appears in Recent actions\.$/)
  await expect(card.getByRole('columnheader', { name: /Without the agent/ })).toContainText('Calculation: what Morpho would have done')
  // the hero and Recent actions show the with-the-agent position: the same figures as the card
  await expect(heroLtv(page)).toHaveText(/^(49\.9|50)%$/)
  await expect(page.locator('.event').filter({ hasText: 'Agent' }).first()).toContainText(/Reduced: sold 0\.214285 WETH to repay 481\.5 USDC, LTV 71\.4% → (49\.9|50)%/)

  // stage 2, −45% in total: without the agent Morpho liquidates; with it, 63.6% and no action
  await card.getByRole('button', { name: 'Next: the price keeps falling' }).click()
  await expect(card.locator('tr[data-stage="stage-2"] th')).toHaveText('2 · The price falls further, 45% in total$1,765.5')
  await expect(stageCell(page, 'stage-2', 'without')).toHaveText(/^LTV 90\.9%, above the 86% liquidation line\. A liquidator repays the whole 802\.5 USDC debt and takes 0\.4744\d\d WETH \(debt × 1\.0438, Morpho's liquidation incentive at 86% LLTV\)\. You keep 0\.0255\d\d WETH \(\$45\.0\d\)\.$/)
  await expect(stageCell(page, 'stage-2', 'with')).toHaveText(/^LTV 63\.6%, below the 70% line: no action\. Collateral 0\.285714 WETH, debt (320\.99|321) USDC\.$/)
  await expect(heroLtv(page)).toHaveText('63.6%')
  // one quantity, one reading: the card's with-the-agent figures are the hero's text (product owner, 11 Nov)
  await expect(stageCell(page, 'stage-2', 'with')).toContainText(`LTV ${await hero(page, 'LTV')}, `)
  await expect(stageCell(page, 'stage-2', 'with')).toContainText(`Collateral ${await hero(page, 'Collateral')}, debt ${await hero(page, 'Debt')}.`)
  await expect(page.locator('.event').filter({ hasText: 'Reduced' })).toHaveCount(1)
  // Close position stays available at every stage
  await expect(page.getByRole('button', { name: 'Close position' })).toBeEnabled()

  // stage 3, back to $3,210: the summary line, then Done keeps the comparison and shows the finished state
  await card.getByRole('button', { name: 'Next: the price recovers' }).click()
  await expect(stageCell(page, 'stage-3', 'without')).toHaveText(/^You hold 0\.0255\d\d WETH \(\$81\.9\d\)\. The recovery does not help: the collateral is gone\.$/)
  await expect(stageCell(page, 'stage-3', 'with')).toHaveText(/^0\.285714 WETH \(\$917\.14\) against (320\.99|321) USDC of debt: \$596\.1\d of collateral value is yours\.$/)
  await expect(stageCell(page, 'stage-3', 'with')).toContainText(`${await hero(page, 'Collateral')} (`)
  await expect(stageCell(page, 'stage-3', 'with')).toContainText(`against ${await hero(page, 'Debt')} of debt`)
  await expect(page.locator('.figure').filter({ hasText: 'Collateral' })).toContainText('≈ $917.14 at the market oracle')
  await expect(card.locator('.crash-summary')).toHaveText(/^Collateral value net of debt after the crash: \$596\.1\d with the agent, \$81\.9\d without\. Both keep the 802\.5 USDC borrowed at open\.$/)
  await expect(card).not.toContainText('profit')
  await card.getByRole('button', { name: 'Done' }).click()
  await expect(card.getByRole('status')).toHaveText('Crash simulated · price back at $3,210')
  await expect(card.getByRole('button')).toHaveCount(0)
  await expect(card.locator('tr[data-stage="stage-3"]')).toBeVisible()

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

test('Phase 11: Close position works mid-crash (stage 2); Start over resets the price to $3,210 and offers the crash again on the new position', async ({ page, context, fx }) => {
  test.setTimeout(180_000)
  await fx.install(context)
  await page.goto('/#connect')
  await activate(page)
  await onboard(page, 'Create position')
  await crashCard(page).getByRole('button', { name: 'Run market crash' }).click()
  await crashCard(page).getByRole('button', { name: 'Next: the price keeps falling' }).click()
  await expect(heroLtv(page)).toHaveText('63.6%')

  // the close repays the with-the-agent position at the current price and returns its collateral
  await page.getByRole('button', { name: 'Close position' }).click()
  await page.getByRole('dialog', { name: 'Close your position' }).getByRole('button', { name: 'Start closing' }).click()
  await expect(crashCard(page)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Position closed' })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.event').filter({ hasText: /Closed/ }).first()).toContainText(/0\.2857\d* WETH/)
  await page.getByRole('button', { name: 'Start over' }).click()
  await expect(page).toHaveURL(/#sandbox\/start$/)
  // Start over put the price back to $3,210 (PRD §8a.1): 0.5 ETH borrows 802.5 USDC again, not the crashed amount
  await expect(page.getByText('about 802.5 USDC')).toBeVisible()

  // a new position: the run is offered again and reproduces the §8a.1 stages
  await onboard(page, 'Deposit')
  await expect(crashCard(page).getByRole('button', { name: 'Run market crash' })).toBeVisible()
  await expect(crashCard(page).locator('tr')).toHaveCount(0)
  await crashCard(page).getByRole('button', { name: 'Run market crash' }).click()
  await expect(crashCard(page).locator('tr[data-stage="open"] th')).toHaveText('Open$3,210')
  await expect(crashCard(page).locator('tr[data-stage="stage-1"] th')).toHaveText('1 · The price falls 30%$2,247')
})

