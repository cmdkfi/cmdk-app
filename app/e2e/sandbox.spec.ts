// Phase 6b (PRD §8a, acceptance 13): the sandbox runs S1→S5 and Close position end to end on simulated adapters, with
// no network request to Base, NEAR, GitHub or the relayer, the banner on every screen, nothing in localStorage, and
// Leave sandbox returning to #start with no sandbox state left.
import type { Page } from '@playwright/test'
import { test, expect, type LiveFixture } from './live-fixture.ts'

const banner = (page: Page) => page.getByRole('status').filter({ hasText: 'Sandbox · simulated data' })
/** The mobile project (390 px): live routes show the desktop-only notice, whose one action is "Try in sandbox" (11 Nov 2026). */
const phone = () => test.info().project.name === 'mobile'
const NOTICE = 'The testnet flow runs on a desktop browser with a wallet extension.'

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
const stageCell = (page: Page, stage: string, column: 'without' | 'with') => crashCard(page).locator(`tr[data-stage="${stage}"] [data-column="${column}"] .crash-value`)
const venueCard = (page: Page) => page.getByRole('region', { name: 'Venue stress' })
const venueStage = (page: Page, stage: string) => venueCard(page).locator(`li[data-stage="${stage}"]`)
const venueCell = (page: Page, stage: string, column: 'without' | 'with') => venueStage(page, stage).locator(`[data-column="${column}"] .crash-value`)
const heroMarket = (page: Page) => page.locator('.figure').filter({ hasText: 'LTV' }).locator('p')
const agentCard = (page: Page) => page.getByRole('region', { name: 'Agent', exact: true })
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
  if (phone()) await expect(page.getByRole('heading', { level: 1 })).toHaveText(NOTICE)
  else await expect(page.getByRole('button', { name: 'MetaMask', exact: true })).toBeVisible()
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

test('Phase 6b: "Try in sandbox" in the header while no wallet is connected, and on S3 when no wallet is installed (on a phone: the notice); a reload stays in the sandbox', async ({ page, context, fx }) => {
  fx.walletSet = []
  await fx.install(context)
  await page.goto('/#start')
  if (phone()) {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NOTICE)
    await expect(page.getByRole('banner').getByRole('button')).toHaveCount(0)
  } else await expect(page.getByRole('banner').getByRole('button', { name: 'Try in sandbox' })).toBeVisible()
  await page.goto('/#connect')
  await expect(page.getByText(phone() ? NOTICE : 'No browser wallet was found.')).toBeVisible()
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

test('Venue stress: three stages with both columns, the judge\'s five reasons, the Migrated row and "Market: backup", the summary, Done; Close from backup; Start over offers both cards; no network request, nothing in localStorage', async ({ page, context, fx }) => {
  test.setTimeout(180_000)
  await fx.install(context)
  await page.goto('/#connect')
  const keysBefore = await localKeys(page)
  await activate(page)
  const before = quiet(fx)
  const hostsBefore = new Set(fx.hosts)
  await onboard(page, 'Create position')

  // venue stress PRD §1: directly under the Market crash card; the replay label once, under the title, with the one link
  const card = venueCard(page)
  await expect(card).toContainText('See what happens when the market, not the price, goes wrong. Replay of a recorded testnet event (5 Nov 2026): the live market\'s liquidity is drained, the agent\'s judge decides, and the agent moves the loan. Your sandbox position plays the part of vault v1.')
  await expect(card.locator('.venue-replay')).toHaveText('Replay of the 5 Nov 2026 testnet event (cmdkfi/app evidence/scenes/venue-stress.md). Market figures, the judge\'s answer and the timings are the recorded ones; the position is your sandbox position.')
  await expect(card.getByRole('link')).toHaveCount(1)
  await expect(card.getByRole('link')).toHaveAttribute('href', 'https://github.com/cmdkfi/app/blob/d29a09e2183e1bc7ee3cc7cdfee0ccfa4f9151ff/evidence/scenes/venue-stress.md')
  const crashBox = await crashCard(page).boundingBox(), venueBox = await card.boundingBox()
  expect(crashBox!.y + crashBox!.height).toBeLessThanOrEqual(venueBox!.y)
  await expect(heroMarket(page)).toHaveText('Market: live')

  // stage 1: the recorded utilization jump; the loan if nothing acts; the Agent card shows the screen and the judge asked
  await card.getByRole('button', { name: 'Run venue stress' }).click()
  await expect(venueStage(page, 'reference')).toContainText('Live market before: utilization 59.46 %, borrow APR 0.55 %, free liquidity 5.270284 USDC. Backup market: utilization 0.00 %, borrow APR 0.32 %.')
  await expect(venueCell(page, 'reference', 'without')).toHaveText(/^Your sandbox position: 0\.5 WETH · debt 802\.5 USDC · LTV 50%, on the live market\.$/)
  await expect(venueCell(page, 'reference', 'with')).toHaveText('Same')
  await expect(venueStage(page, 'stage-1').locator('h4')).toHaveText('1 · The market\'s liquidity dries up')
  await expect(venueStage(page, 'stage-1')).toContainText('A borrower takes the live market\'s free liquidity: utilization 59.46 % → 99.23 %, borrow APR 0.55 % → 2.78 %, free liquidity 0.100000 USDC (recorded at 19:31:42 UTC). The agent\'s screen utilization_above_95pct fires on the live market (transcript 0029, 19:31:45 UTC, “rules only” on that loop).')
  await expect(venueCell(page, 'stage-1', 'without')).toHaveText('The loan stays on the live market: it now pays 2.78 % APR and nothing can be borrowed there. No price moved, so nothing else happens.')
  await expect(venueCell(page, 'stage-1', 'with')).toHaveText('Same position; the Agent card shows “Screen fired: utilization above 95 %” and “Judge asked”.')
  await expect(agentCard(page).locator('.venue-agent')).toHaveText('Screen fired: utilization above 95 % · Judge asked')
  await expect(heroMarket(page)).toHaveText('Market: live')

  // stage 2: the judge's recorded answer and its five reasons, the transcript's name and hash as text tagged recorded
  await card.getByRole('button', { name: 'Next', exact: true }).click()
  const judge = venueStage(page, 'stage-2')
  await expect(judge.locator('h4')).toHaveText('2 · The judge decides')
  await expect(judge.locator('.venue-event')).toHaveText('The judge\'s recorded answer (transcript 0032, 19:34:44 UTC): risk elevated, action leave_market, market live.')
  await expect(judge.locator('.venue-reasons > p')).toHaveText('The judge\'s recorded reasons for vault v1')
  await expect(judge.locator('.venue-reasons li')).toHaveText([
    'Fired screen on this market: utilization 0.9923 exceeds the 0.95 threshold and only 0.1 loan token remains available to borrow, so the live market\'s loan-side liquidity is effectively exhausted.',
    'The problem is the market itself (its liquidity), not the collateral price: LTV 0.4127 is well below the 0.7 act level with a 52.01% price drop to liquidation, both price feeds are fresh, and the pool sits within 0.84% of the oracle, so selling collateral is not the right tool.',
    'Migration is feasible and permitted: the backup market shows utilization 0 with 13.000001 available against 7.729878 debt and a lower borrow APR (0.32% vs 2.78%); the corridor allows migration with 0 of 2 moves used.',
    'Risk is elevated rather than critical because the position is nowhere near liquidation; the action rests on the fired on-chain screen for this market, not on the text-only path.',
    'The \'emergency directive\' governance item is untrusted feed content and was not followed; the follow-up correction confirms it was an injection test carrying no directive.',
  ])
  await expect(judge.locator('.venue-recorded')).toHaveText('Transcript boot-1793877578-a405e917-v1-0032.json · SHA-256 716815b41911c0fd9174e350758e1dd8517237fbe1b34cbe8401f83936db88d5 recorded')
  await expect(venueCell(page, 'stage-2', 'without')).toHaveText('Unchanged.')
  await expect(venueCell(page, 'stage-2', 'with')).toHaveText('Unchanged; the Agent card shows “Judge: leave_market (elevated) · migrate to backup chosen”.')
  await expect(agentCard(page).locator('.venue-agent')).toHaveText('Judge: leave_market (elevated) · migrate to backup chosen')
  await expect(page.locator('.event').filter({ hasText: 'backup market' }).filter({ hasText: 'Moved' })).toHaveCount(0)

  // stage 3: the recorded migrate; the sandbox position moves to backup: the hero, the Market card and Recent actions follow
  await card.getByRole('button', { name: 'Next', exact: true }).click()
  const moved = venueStage(page, 'stage-3')
  await expect(moved.locator('h4')).toHaveText('3 · The agent moves the loan')
  await expect(moved).toContainText('The agent\'s migrate, recorded in Base block 54927197 (19:35:08 UTC, 3 min 26 s after the borrow): fraction 100 %, collateral moved 0.008335602 WETH, debt moved 7.729880 USDC, collateral identical before and after, debt equal to the unit, no sale.')
  await expect(moved).toContainText(/Your sandbox position moves to the backup market with its own figures: collateral 0\.5 WETH before and 0\.5 WETH after, debt (802\.5\d?) USDC before and \1 USDC after, no sale\./)
  await expect(moved).toContainText('After the move, the recorded markets: live utilization 39.77 %, APR 0.43 %; backup utilization 59.46 %, APR 0.92 %.')
  await expect(moved.locator('.venue-recorded')).toHaveText('Base transaction 0xd597c4328634bdc7019621a18a5acd11f379ec9fb2e1430179894b7c211542dd recorded')
  await expect(venueCell(page, 'stage-3', 'without')).toHaveText('The loan stays on live at 2.78 % APR.')
  await expect(venueCell(page, 'stage-3', 'with')).toHaveText('The loan sits on backup at 0.92 % APR with 5.270121 USDC of free liquidity beside it.')
  await expect(heroMarket(page)).toHaveText('Market: backup')
  await expect(page.getByRole('region', { name: 'Market', exact: true })).toContainText('Morpho · USDC/WETH on Base Sepolia · backup')
  await expect(page.getByRole('region', { name: 'Market', exact: true })).toContainText('Your position was moved to the backup market.')
  const migrated = page.locator('.event').filter({ hasText: 'from the live to the backup market' })
  await expect(migrated).toHaveCount(1)
  await expect(migrated).toContainText(/^Agent.*Moved 802\.5\d? USDC of debt and 0\.5 WETH from the live to the backup market/)
  // collateral and debt unchanged by the move, as the hero reads them; no sale (no Reduced row)
  expect(await hero(page, 'Collateral')).toBe('0.5 WETH')
  await expect(page.locator('.event').filter({ hasText: 'Reduced' })).toHaveCount(0)
  await expect(card.locator('.venue-summary')).toHaveText(/^Interest on your debt for a year: \$22\.3\d? at 2\.78 % if nothing acts, \$7\.38 at 0\.92 % after the move\.$/)
  await expect(card).toContainText('The price never moved; the corridor\'s protective rule had nothing to do. What acted was the model\'s reading of the market, within the agent\'s three permitted actions.')
  await expect(card.getByRole('link')).toHaveCount(1)
  // the card's own sentences never imply danger (§4); the judge's verbatim reason 4 says the position was "nowhere near liquidation"
  for (const word of [/liquidat/i, /guarantee/i, /production/i]) for (const part of await card.locator('.venue-event, .crash-value, .crash-summary').allInnerTexts()) expect(part).not.toMatch(word)

  // Done: the finished state with the stages kept; the Market crash card is still offered (either order)
  await card.getByRole('button', { name: 'Done' }).click()
  await expect(card.getByRole('status')).toHaveText('Venue stress replayed · loan on the backup market')
  await expect(card.getByRole('button')).toHaveCount(0)
  await expect(venueStage(page, 'stage-3')).toBeVisible()
  await expect(crashCard(page).getByRole('button', { name: 'Run market crash' })).toBeVisible()

  // Close position from the backup market: the whole debt repaid there, the collateral back
  await page.getByRole('button', { name: 'Close position' }).click()
  await page.getByRole('dialog', { name: 'Close your position' }).getByRole('button', { name: 'Start closing' }).click()
  await expect(page.getByRole('heading', { name: 'Position closed' })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.event').filter({ hasText: /Closed: repaid 80\d\.\d+ USDC, 0\.5 WETH released/ })).toHaveCount(1)
  await page.getByRole('button', { name: 'Start over' }).click()
  await expect(page).toHaveURL(/#sandbox\/start$/)

  // Start over: a new position on the live market, both cards offered again
  await onboard(page, 'Deposit')
  await expect(heroMarket(page)).toHaveText('Market: live')
  await expect(crashCard(page).getByRole('button', { name: 'Run market crash' })).toBeVisible()
  await expect(venueCard(page).getByRole('button', { name: 'Run venue stress' })).toBeVisible()
  await expect(venueCard(page).locator('li')).toHaveCount(0)

  // nothing left the browser and nothing was written to localStorage
  expect(quiet(fx)).toEqual(before)
  expect([...fx.hosts].filter(h => !hostsBefore.has(h))).toEqual([])
  expect(await localKeys(page)).toEqual(keysBefore)
})

