import type { Page } from '@playwright/test'
import { test, expect, BASE, MEASUREMENT, OTHER, OWNER, vault, type LiveFixture } from './live-fixture.ts'

const WETH = '0x4200000000000000000000000000000000000006'
const prompts = (fx: LiveFixture) => fx.walletCalls.filter(m => m === 'personal_sign' || m === 'eth_sendTransaction')
const signed = (fx: LiveFixture) => fx.signs.map(text => JSON.parse(text).method as string)
const ownerCalls = (fx: LiveFixture) => fx.posts.filter(p => p.path === '/owner-call').map(p => p.body as { message: string; signature: string })
const step = (page: Page, title: string) => page.getByRole('listitem', { name: title })

async function createPosition(page: Page, amount = '0.1') {
  await page.goto('/#start')
  await page.getByLabel('Amount to deposit').fill(amount)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Continue to wallet' }).click()
  await page.getByRole('button', { name: 'MetaMask', exact: true }).click()
  await expect(page.getByText('None for this wallet')).toBeVisible()
  await page.getByRole('button', { name: 'Create position' }).click()
  await expect(page).toHaveURL(/#progress$/)
}

function fresh(fx: LiveFixture) {
  fx.factoryCount = 9 // the next vault is v10, the first one from the cutoff
}

test('happy path: one click on Create position reaches the position screen; five prompts in order, nothing else clicked (D11)', async ({ page, context, fx }) => {
  fresh(fx)
  await fx.install(context)
  await createPosition(page)
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Your position' })).toBeVisible()
  expect(prompts(fx)).toEqual(['personal_sign', 'eth_sendTransaction', 'eth_sendTransaction', 'personal_sign', 'personal_sign'])
  expect(signed(fx)).toEqual(['setup', 'open', 'withdraw'])
  expect(fx.posts.map(p => p.path)).toEqual(['/create-vault', '/owner-call', '/owner-call', '/owner-call'])
  // wrap the full 0.1 ETH (no WETH in the wallet), then transfer it to the position address
  expect(fx.txs[0]).toEqual({ to: WETH, data: '0xd0e30db0', value: (10n ** 17n).toString() })
  expect(fx.txs[1].to).toBe(WETH); expect(fx.txs[1].data.toLowerCase()).toContain(BASE.slice(2).toLowerCase())
  // open: collateral_in = the WETH at the position address, target 50 %; withdraw: all idle USDC to the owner
  const open = JSON.parse(fx.signs[1]); expect(open.args).toEqual({ market: expect.any(String), collateral_in: '100000000000000000', target_ltv: '500000000000000000' })
  const withdraw = JSON.parse(fx.signs[2]); expect(withdraw.args.amount).toBe('159999998')
  expect(fx.wallet.usdc).toBe(159_999_998n)
  // nonces follow owner_nonce + 1 each time
  expect(fx.signs.map(text => JSON.parse(text).nonce)).toEqual([4, 5, 6])
})

test('reload at each prompt step: nothing is requested until Continue (FR-5a)', async ({ page, context, fx }) => {
  // five full reloads plus 5 s of fixed waits: 11-18 s alone, and past the default 30 s in the full suite when the
  // machine is loaded (load average 22; d8d2fe6 and Phase 8 measured back to back at the same times, Phase 8 note)
  test.setTimeout(60_000)
  fresh(fx)
  for (const kind of ['setup', 'wrap', 'transfer', 'open', 'withdraw'] as const) fx.rejectOnce.add(kind)
  await fx.install(context)
  await createPosition(page)
  for (const title of ['Approve agent and rules', 'Wrap ETH → WETH', 'Send WETH to your position address', 'Open position', 'Send USDC to your wallet']) {
    await expect(step(page, title)).toContainText('You declined the request in MetaMask', { timeout: 20_000 })
    const before = prompts(fx).length
    await page.reload()
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(step(page, title).getByRole('status')).toHaveText('Waiting')
    await page.waitForTimeout(1_000)
    expect(prompts(fx).length, `no prompt after reload at "${title}"`).toBe(before)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
  }
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  expect(signed(fx)).toEqual(['setup', 'open', 'withdraw'])
})

test('rejection pauses the step with Retry and keeps the data; Retry asks again', async ({ page, context, fx }) => {
  fresh(fx)
  fx.rejectOnce.add('setup')
  await fx.install(context)
  await createPosition(page)
  const setup = step(page, 'Approve agent and rules')
  await expect(setup).toContainText('You declined the request in MetaMask. Nothing was sent.')
  await expect(page.locator('.page-head .tag')).toHaveText('Step 2 of 6') // the S4 head names the active step (Phase 10)
  await expect(step(page, 'Create your position').getByRole('status')).toHaveText('Done')
  expect(ownerCalls(fx)).toEqual([])
  await setup.getByRole('button', { name: 'Try again' }).click()
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  expect(fx.posts.filter(p => p.path === '/create-vault')).toHaveLength(1)
})

test('gas refusal: the relayer text is shown verbatim, the top-up is sent, and the same signed message is posted again (D7, FR-8)', async ({ page, context, fx }) => {
  fresh(fx)
  fx.floatWei = 2n * 10n ** 14n // the position address holds 0.0002 ETH; the relayer wants 0.001 ETH
  await fx.install(context)
  await createPosition(page)
  const setup = step(page, 'Approve agent and rules')
  await expect(setup).toContainText('the vault Base address holds 200000000000000 wei, below the 1000000000000000 wei the transactions may cost')
  await expect(setup).toContainText('Your position address needs more ETH for gas.')
  // Q2: (0.001 − 0.0002) × 1.25 = 0.001 ETH
  await setup.getByRole('button', { name: 'Send 0.001 ETH for gas' }).click()
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  const topUp = fx.txs.find(tx => tx.to.toLowerCase() === BASE.toLowerCase())
  expect(topUp).toEqual({ to: BASE, data: '0x', value: (10n ** 15n).toString() })
  const calls = ownerCalls(fx)
  expect(calls.length).toBe(4) // setup refused, setup again, open, withdraw
  expect(calls[1]).toEqual(calls[0]) // the same signed message, not a new signature
  expect(signed(fx)).toEqual(['setup', 'open', 'withdraw'])
})

test('lost create job: discovery runs before any repeat POST and adopts the vault that appeared (PRD S4 step 1)', async ({ page, context, fx }) => {
  fresh(fx)
  fx.createMode = 'lose-job'
  await fx.install(context)
  await createPosition(page)
  await expect(step(page, 'Create your position')).toContainText('Your vault was found on NEAR; it is used as is.', { timeout: 20_000 })
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  expect(fx.posts.filter(p => p.path === '/create-vault')).toHaveLength(1)
})

test('lost owner-call job: resolved from owner_nonce, never posted twice (FR-6, R4)', async ({ page, context, fx }) => {
  fresh(fx)
  fx.ownerCallModes = ['lose-job']
  await fx.install(context)
  await createPosition(page)
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  expect(ownerCalls(fx).map(c => JSON.parse(c.message).method)).toEqual(['setup', 'open', 'withdraw'])
  expect(signed(fx)).toEqual(['setup', 'open', 'withdraw'])
})

test('stale price feed: no open signature until the feed is fresh again (R1)', async ({ page, context, fx }) => {
  fresh(fx)
  fx.feedStale = true
  await fx.install(context)
  await page.clock.install()
  await createPosition(page)
  const open = step(page, 'Open position')
  await expect(open.getByRole('status')).toHaveText('Waiting for a fresh price', { timeout: 20_000 })
  await expect(open).toContainText('Price feed is stale on testnet; retrying every 30 s.')
  expect(signed(fx)).toEqual(['setup'])
  fx.feedStale = false
  await page.clock.runFor(31_000)
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  expect(signed(fx)).toEqual(['setup', 'open', 'withdraw'])
})

test('Q1: if the market now lends more than 2 points less than S1 showed, open pauses with the new figure; accepting opens below target', async ({ page, context, fx }) => {
  fresh(fx)
  fx.rejectOnce.add('transfer') // stop before open so the market can change
  await fx.install(context)
  await createPosition(page) // S1 showed 50 % (8000 USDC lendable)
  const transfer = step(page, 'Send WETH to your position address')
  await expect(transfer).toContainText('You declined', { timeout: 20_000 })
  fx.supply = fx.borrowed + 100n * 10n ** 6n // now 100 USDC: 99 lendable → 30.9 % LTV
  await transfer.getByRole('button', { name: 'Try again' }).click()
  const open = step(page, 'Open position')
  await expect(open).toContainText('your position would open at 30.9% LTV instead of 50%', { timeout: 20_000 })
  expect(signed(fx)).toEqual(['setup'])
  await open.getByRole('button', { name: 'Open at the lower LTV' }).click()
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  expect(JSON.parse(fx.signs[1]).args.target_ltv).toBe((99n * 10n ** 6n * 10n ** 18n / (320n * 10n ** 6n)).toString())
})


test('account switch mid-onboarding: the run stops, the other account sees none of it and nothing is prompted; back on the owner, S4 is shown again and Continue resumes', async ({ page, context, fx }) => {
  fresh(fx)
  fx.rejectOnce.add('setup')
  await fx.install(context)
  await createPosition(page)
  await expect(step(page, 'Approve agent and rules')).toContainText('You declined the request in MetaMask', { timeout: 20_000 })
  const before = prompts(fx).length
  const key = `cmdk.live.onboarding.v1.factory.fixture.testnet:${OWNER.toLowerCase()}`
  expect(await page.evaluate(k => localStorage.getItem(k) !== null, key)).toBe(true)
  // MetaMask switches to another account: it owns no vault and has no record, so S4 is left and nothing is asked
  await fx.switchAccount(page, OTHER)
  await expect(page).toHaveURL(/#start$/, { timeout: 20_000 })
  await page.waitForTimeout(1_000)
  expect(prompts(fx).length, 'no prompt for the other account').toBe(before)
  expect(fx.posts.filter(p => p.path === '/owner-call')).toEqual([])
  expect(await page.evaluate(k => localStorage.getItem(k) !== null, key), "the owner's record is kept under the owner's key").toBe(true)
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes('.onboarding.v1.')))).toEqual([key])
  // back to the owner: the landing table runs again for the new account and lands on S4, which waits for Continue
  await fx.switchAccount(page, OWNER)
  await expect(page).toHaveURL(/#progress$/, { timeout: 20_000 })
  await expect(page.getByRole('listitem', { name: 'Approve agent and rules' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(step(page, 'Approve agent and rules').getByRole('status')).toHaveText('Waiting')
  await page.waitForTimeout(1_000)
  expect(prompts(fx).length, 'no prompt until Continue').toBe(before)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  expect(signed(fx)).toEqual(['setup', 'open', 'withdraw'])
})

test('S3 after a switch away and back shows the owned vault and returns to S4; no second create request', async ({ page, context, fx }) => {
  fresh(fx)
  fx.rejectOnce.add('setup')
  await fx.install(context)
  await createPosition(page)
  await expect(step(page, 'Approve agent and rules')).toContainText('You declined the request in MetaMask', { timeout: 20_000 })
  await fx.switchAccount(page, OTHER)
  await expect(page).toHaveURL(/#start$/, { timeout: 20_000 })
  await fx.switchAccount(page, OWNER)
  await expect(page).toHaveURL(/#progress$/, { timeout: 20_000 })
  // the user walks to S3 anyway
  await page.evaluate(() => { window.location.hash = '#connect' })
  const facts = page.locator('.facts > div')
  await expect(facts.filter({ hasText: 'Existing position' }).locator('dd')).toHaveText('v10.factory.fixture.testnet', { timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Create position' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Continue where you left off' }).click()
  await expect(page).toHaveURL(/#progress$/)
  await expect(step(page, 'Create your position').getByRole('status')).toHaveText('Done')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  expect(fx.posts.filter(p => p.path === '/create-vault')).toHaveLength(1)
})

test('creation is guarded by a fresh ownership read: with a stale "none" and a vault that exists, it is adopted and nothing is created', async ({ page, context, fx }) => {
  fresh(fx)
  await fx.install(context)
  await page.goto('/#start')
  await page.getByLabel('Amount to deposit').fill('0.1')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Continue to wallet' }).click()
  await page.getByRole('button', { name: 'MetaMask', exact: true }).click()
  await expect(page.getByText('None for this wallet')).toBeVisible()
  // meanwhile the wallet's vault appears (another tab, or a create whose answer was lost); this page's check is stale
  fx.factoryCount = 10
  fx.vaults.set(10, vault({ collateral: 0n, authorized: false, loanAllowance: 0n, collateralAllowance: 0n, corridorSet: false, approved: null }))
  await page.getByRole('button', { name: 'Create position' }).click()
  await expect(page).toHaveURL(/#progress$/)
  await expect(step(page, 'Create your position')).toContainText('Your vault was found on NEAR; it is used as is.', { timeout: 20_000 })
  await expect(step(page, 'Create your position').getByRole('status')).toHaveText('Done')
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  expect(fx.posts.filter(p => p.path === '/create-vault')).toEqual([])
  expect(signed(fx)).toEqual(['setup', 'open', 'withdraw'])
})


test('Phase 7b: a relayer 503 on the POST shows Checking with the reason, the expiry and a countdown; nothing is re-posted; after expiry it asks for a new signature', async ({ page, context, fx }) => {
  fresh(fx)
  fx.ownerCallModes = ['answer-503']
  await fx.install(context)
  await page.clock.install()
  await createPosition(page)
  const setup = step(page, 'Approve agent and rules')
  await expect(setup.getByRole('status')).toHaveText('Checking…', { timeout: 20_000 })
  await expect(setup).toContainText(/The relayer answered HTTP 503 \(container restarting\); the request may have been accepted\. Waiting for the signed message to expire at \d{1,2}:\d{2}:\d{2}( [AP]M)? \((9:[0-5]\d|10:00) left\) unless the vault shows it ran\./)
  await page.clock.runFor(11_000)
  await expect(setup).toContainText(/\((9:[0-5]\d) left\)/)
  expect(ownerCalls(fx)).toHaveLength(1)
  // the message expires unused (NEAR time past its expiry, owner_nonce unchanged)
  fx.nearNow += 601
  // the check loop re-reads every 10 s of page time once the previous reads have answered: step the clock until it does
  await expect.poll(async () => { await page.clock.runFor(5_000); return setup.innerText() }, { timeout: 20_000 }).toContain('The signed message expired without being used. Sign again.')
  expect(ownerCalls(fx)).toHaveLength(1)
  await setup.getByRole('button', { name: 'Sign a new message' }).click()
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  expect(signed(fx)).toEqual(['setup', 'setup', 'open', 'withdraw'])
})

test('Phase 7b item 1a: when the published agent version differs from the app\'s config, setup pauses before any signature; Check again continues once they agree', async ({ page, context, fx }) => {
  fresh(fx)
  fx.publishedMeasurement = { ...MEASUREMENT, compose_hash: 'db4f5085'.padEnd(64, '0') } // the agent moved on (9 Nov)
  await fx.install(context)
  await createPosition(page)
  const setup = step(page, 'Approve agent and rules')
  await expect(setup).toContainText("This app's configuration is behind the published agent version; try again later.", { timeout: 20_000 })
  expect(signed(fx)).toEqual([])
  expect(ownerCalls(fx)).toHaveLength(0)
  fx.publishedMeasurement = { ...MEASUREMENT }
  await setup.getByRole('button', { name: 'Check again' }).click()
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  expect(signed(fx)).toEqual(['setup', 'open', 'withdraw'])
})

test('a vault without the published Executor: discovery skips it and setup refuses it before any signature', async ({ page, context, fx }) => {
  const hostile = ('0x' + '66'.repeat(20)) as `0x${string}`
  fx.factoryCount = 10
  fx.vaults.set(10, vault({ executor: hostile, collateral: 0n, approved: null })) // made for this owner by someone else
  fx.createExecutor = hostile // and a relayer that ignores the posted policy
  await fx.install(context)
  await createPosition(page) // S3 shows "None for this wallet": v10 is skipped
  const setup = step(page, 'Approve agent and rules')
  await expect(setup).toContainText("This vault's markets or Executor differ from the published deployment, so no signature is requested.", { timeout: 20_000 })
  expect(fx.posts.map(p => p.path)).toEqual(['/create-vault'])
  expect(prompts(fx)).toEqual([])
})

test('Phase 8a: connecting on another chain requests the switch at once; the chain then runs to the position screen', async ({ page, context, fx }) => {
  fresh(fx)
  fx.chain = '0x1' // the wallet kept another network for this site (10 Nov live run)
  await fx.install(context)
  await createPosition(page)
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  expect(fx.walletCalls.filter(m => m === 'wallet_switchEthereumChain')).toHaveLength(1)
  expect(signed(fx)).toEqual(['setup', 'open', 'withdraw'])
})

test('Phase 8a: after a reload on another chain with the switch refused, the step says "Switch to Base Sepolia in your wallet" with a button; switching continues the chain', async ({ page, context, fx }) => {
  fresh(fx)
  fx.rejectOnce.add('setup')
  await fx.install(context)
  await createPosition(page)
  const setup = step(page, 'Approve agent and rules')
  await expect(setup).toContainText('You declined the request in MetaMask', { timeout: 20_000 })
  // the live defect: the wallet reports another chain for this site and refuses (or ignores) the switch
  fx.chain = '0x1'; fx.rejectSwitch = true
  await page.reload()
  await expect(setup).toContainText('Switch to Base Sepolia in your wallet.', { timeout: 20_000 })
  const button = setup.getByRole('button', { name: 'Switch to Base Sepolia' })
  await expect(button).toBeVisible()
  await button.click() // refused again: the line stays, never silence
  await expect(setup).toContainText('Switch to Base Sepolia in your wallet.')
  expect(signed(fx)).toEqual([])
  fx.rejectSwitch = false
  await button.click()
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  expect(signed(fx)).toEqual(['setup', 'open', 'withdraw'])
})

test('Phase 8a: the wallet leaving Base Sepolia mid-flow pauses the step with the switch line; Continue requests the switch itself', async ({ page, context, fx }) => {
  fresh(fx)
  fx.rejectOnce.add('setup')
  await fx.install(context)
  await createPosition(page)
  const setup = step(page, 'Approve agent and rules')
  await expect(setup).toContainText('You declined the request in MetaMask', { timeout: 20_000 })
  fx.chain = '0x1'
  await page.evaluate(() => (window as unknown as { fixtureEmit: (n: string, v: unknown) => void }).fixtureEmit('chainChanged', '0x1'))
  await expect(setup).toContainText('Switch to Base Sepolia in your wallet.', { timeout: 20_000 })
  await setup.getByRole('button', { name: 'Switch to Base Sepolia' }).click()
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  expect(signed(fx)).toEqual(['setup', 'open', 'withdraw'])
})
