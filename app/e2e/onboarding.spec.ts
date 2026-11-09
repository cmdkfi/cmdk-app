import type { Page } from '@playwright/test'
import { test, expect, BASE, type LiveFixture } from './live-fixture.ts'

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
  await page.getByRole('button', { name: 'Connect MetaMask' }).click()
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

