import type { Page } from '@playwright/test'
import { test, expect, ADDRESSES, BASE, OWNER, vault, type LiveFixture } from './live-fixture.ts'

const { WETH, USDC, HEAD } = ADDRESSES
const E = 10n ** 18n
// 160.08 M shares on equal totals of 2000 USDC: 160.000001 USDC of debt at the read block (lastUpdate = block time);
// 600 s ahead at the fixture's 5% APR: 160.000153 USDC; the relayer needs debt + debt // 100 = 161.600154 USDC.
const SHARES = 160_080_000n
const NEED_AHEAD = 161_600_154n

const signed = (fx: LiveFixture) => fx.signs.map(text => JSON.parse(text) as { method: string; args: Record<string, string>; nonce: number })
const prompts = (fx: LiveFixture) => fx.walletCalls.filter(m => m === 'personal_sign' || m === 'eth_sendTransaction')
const step = (page: Page, title: string) => page.getByRole('listitem', { name: title })
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Close your position' })

function active(fx: LiveFixture, idleUsdc = 0n, walletUsdc = 0n) {
  fx.factoryCount = 10
  fx.vaults.set(10, vault({ borrowShares: SHARES, idle: { eth: 5n * 10n ** 15n, weth: 0n, usdc: idleUsdc } }))
  fx.wallet.usdc = walletUsdc
}

async function openPosition(page: Page) {
  await page.goto('/#connect') // Phase 8: no Connect button in the header; S3 lists the wallets
  await page.getByRole('button', { name: 'MetaMask', exact: true }).click()
  await expect(page).toHaveURL(/#position$/)
  await expect(page.getByRole('heading', { name: 'Your position' })).toBeVisible()
}

async function startClosing(page: Page) {
  await page.getByRole('button', { name: 'Close position' }).click()
  await expect(sheet(page)).toBeVisible()
  await sheet(page).getByRole('button', { name: 'Start closing' }).click()
}

async function expectClosed(page: Page) {
  await expect(page.getByRole('heading', { name: 'Position closed' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.figure').filter({ hasText: 'Debt' }).locator('.big')).toHaveText('0 USDC')
  await expect(page.locator('.figure').filter({ hasText: 'Collateral' }).locator('.big')).toHaveText('0 WETH')
  await expect(page.getByRole('button', { name: 'Start over' })).toBeVisible()
  // Phase 7b: no collateral, so no budget to report (was "no active corridor")
  await expect(page.locator('section.card').filter({ hasText: 'Sell budget left today' }).locator('.rows > .row').filter({ hasText: 'Sell budget left today' }).locator('dd')).toHaveText('no position')
}

test('review sheet: debt, interest, headroom, amount sent, collateral returned, destination, expiry and no close without repaying', async ({ page, context, fx }) => {
  active(fx, 0n, 500_000_000n)
  await fx.install(context); await openPosition(page)
  await expect(page.getByText('You will first send 161.6 USDC to your position address, then the debt is repaid and your WETH returns to your wallet.')).toBeVisible()
  await page.getByRole('button', { name: 'Close position' }).click()
  const s = sheet(page)
  const row = (label: string) => s.locator('.rows > .row').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')
  await expect(row('Debt now')).toHaveText(`160.000001 USDC accrued to block ${HEAD}`)
  await expect(row('Interest over the next 10 minutes')).toHaveText('up to 0.000152 USDC')
  await expect(row('Headroom (1%, returned to you)')).toHaveText('1.600001 USDC')
  await expect(row('USDC already at your position address')).toHaveText('0 USDC')
  await expect(row('You send first')).toHaveText('161.600154 USDC from your wallet to your position address')
  await expect(row('Collateral returned')).toHaveText('0.1 WETH')
  await expect(row('Destination')).toHaveText(`${OWNER} (your wallet)`)
  await expect(s.getByText('Each signature expires in 10 minutes.')).toBeVisible()
  await expect(s.getByText('The protocol has no close without repaying: the whole debt is repaid before your WETH is released.')).toBeVisible()
  await s.getByRole('button', { name: 'Cancel' }).click()
  await expect(s).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(prompts(fx)).toEqual([]); expect(fx.posts).toEqual([])
})

test('close with no shortfall: close, return WETH, return leftover USDC; closed variant with Start over', async ({ page, context, fx }) => {
  active(fx, 170_000_000n)
  await fx.install(context); await openPosition(page)
  await expect(page.getByText('Repays 160 USDC held at your position address, returns your WETH to your wallet.')).toBeVisible()
  await startClosing(page)
  await expectClosed(page)
  // no wallet transaction; three signatures in order, nonces owner_nonce + 1
  expect(fx.txs).toEqual([])
  expect(signed(fx).map(m => m.method)).toEqual(['close', 'withdraw', 'withdraw'])
  expect(signed(fx).map(m => m.nonce)).toEqual([4, 5, 6])
  expect(signed(fx)[0].args).toEqual({ market: expect.stringMatching(/^0x[0-9a-f]{64}$/) })
  expect(signed(fx)[1].args).toEqual({ token: WETH, amount: (E / 10n).toString(), destination: OWNER })
  // 170 − 160.000001 = 9.999999 USDC back to the wallet
  expect(signed(fx)[2].args).toEqual({ token: USDC, amount: '9999999', destination: OWNER })
  expect(fx.closes).toBe(1)
  expect(fx.wallet.weth).toBe(E / 10n); expect(fx.wallet.usdc).toBe(9_999_999n)
  await expect(step(page, 'Send USDC to your position address')).toHaveCount(0) // the steps list is gone once closed
})

test('close with a shortfall and enough wallet USDC: the exact shortfall is sent first', async ({ page, context, fx }) => {
  active(fx, 0n, 500_000_000n)
  await fx.install(context); await openPosition(page)
  await startClosing(page)
  await expectClosed(page)
  expect(prompts(fx)).toEqual(['eth_sendTransaction', 'personal_sign', 'personal_sign', 'personal_sign'])
  expect(fx.txs[0].to).toBe(USDC)
  expect(fx.txs[0].data.toLowerCase()).toContain(BASE.slice(2).toLowerCase())
  expect(BigInt('0x' + fx.txs[0].data.slice(-64))).toBe(NEED_AHEAD)
  expect(signed(fx).map(m => m.method)).toEqual(['close', 'withdraw', 'withdraw'])
  // the leftover is the headroom plus the 600 s of interest that did not accrue: 161.600154 − 160.000001
  expect(signed(fx)[2].args.amount).toBe('1600153')
  expect(fx.wallet.usdc).toBe(500_000_000n - NEED_AHEAD + 1_600_153n)
})

test('wallet short of USDC: the Get test USDC panel shows the exact amount missing; the close resumes by itself when USDC arrives', async ({ page, context, fx }) => {
  test.setTimeout(90_000)
  active(fx, 0n, 100_000_000n)
  await fx.install(context); await openPosition(page)
  await startClosing(page)
  const panel = page.getByRole('complementary', { name: 'Get test USDC' })
  await expect(panel).toBeVisible({ timeout: 15_000 })
  await expect(panel.getByText('61.600154 USDC missing')).toBeVisible()
  await expect(panel.locator('.rows > .row').filter({ hasText: 'USDC in your wallet' }).locator('dd')).toHaveText('100 USDC')
  await expect(panel.getByText('Choose Base Sepolia in the network dropdown; USDC sent on another network cannot reach this wallet.', { exact: false })).toBeVisible()
  await expect(panel.getByRole('link', { name: 'Circle faucet' })).toHaveAttribute('href', 'https://faucet.circle.com')
  await expect(panel.getByRole('link', { name: 'Coinbase Developer Platform faucet' })).toBeVisible()
  await expect(panel.getByText('The 1% headroom comes back to your wallet as leftover USDC in the last close step.')).toBeVisible()
  await expect(step(page, 'Send USDC to your position address').getByRole('status')).toHaveText('Waiting for test USDC')
  expect(prompts(fx)).toEqual([])
  // the faucet credits the wallet; nothing is clicked
  fx.wallet.usdc += 100_000_000n
  await expectClosed(page)
  expect(BigInt('0x' + fx.txs[0].data.slice(-64))).toBe(NEED_AHEAD)
  expect(signed(fx).map(m => m.method)).toEqual(['close', 'withdraw', 'withdraw'])
})

test('reload mid-close: stays on the position screen, nothing is requested until Continue, then the chain finishes', async ({ page, context, fx }) => {
  active(fx, 170_000_000n)
  fx.rejectOnce.add('withdraw')
  await fx.install(context); await openPosition(page)
  await startClosing(page)
  // close ran (collateral is now WETH idle at the position address); the WETH return was declined
  await expect(step(page, 'Return WETH to your wallet')).toContainText('You declined the request in MetaMask', { timeout: 20_000 })
  await expect(step(page, 'Close position').getByRole('status')).toHaveText('Done')
  const before = prompts(fx).length
  await page.reload()
  // the vault now reads as "WETH waiting, no Morpho position"; the unfinished close record keeps S5, not S4 open
  await expect(page).toHaveURL(/#position$/)
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(step(page, 'Return WETH to your wallet').getByRole('status')).toHaveText('Waiting')
  await expect(step(page, 'Close position').getByRole('status')).toHaveText('Done')
  await page.waitForTimeout(1_000)
  expect(prompts(fx).length).toBe(before)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expectClosed(page)
  expect(signed(fx).map(m => m.method)).toEqual(['close', 'withdraw', 'withdraw'])
  expect(fx.closes).toBe(1)
})

test('Start over: S1 with 0.01 ETH, S3 shows the vault ready with Deposit, S4 resumes at the wrap step on the same vault', async ({ page, context, fx }) => {
  test.setTimeout(90_000)
  active(fx, 170_000_000n)
  await fx.install(context); await openPosition(page)
  await startClosing(page)
  await expectClosed(page)
  fx.wallet.weth = 0n // the returned WETH has left the wallet, so the deposit wraps again
  const txsBefore = fx.txs.length
  await page.getByRole('button', { name: 'Start over' }).click()
  await expect(page).toHaveURL(/#start$/)
  await expect(page.getByLabel('Amount to deposit')).toHaveValue('0.01')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Continue to wallet' }).click()
  await expect(page).toHaveURL(/#connect$/)
  await expect(page.getByText('v10.factory.fixture.testnet · ready for a deposit')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create position' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Deposit', exact: true }).click()
  await expect(page).toHaveURL(/#progress$/)
  await expect(step(page, 'Create your position').getByRole('status')).toHaveText('Done')
  await expect(step(page, 'Approve agent and rules').getByRole('status')).toHaveText('Done')
  await expect(page).toHaveURL(/#position$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Your position' })).toBeVisible()
  // the first prompt after Start over is the wrap of 0.01 ETH; no vault was created
  expect(fx.txs[txsBefore]).toEqual({ to: WETH, data: '0xd0e30db0', value: (E / 100n).toString() })
  expect(fx.posts.filter(p => p.path === '/create-vault')).toEqual([])
  expect(signed(fx).map(m => m.method)).toEqual(['close', 'withdraw', 'withdraw', 'open', 'withdraw'])
})

test('R10: interest accrued while the close waited inserts a second transfer before the close signature instead of failing', async ({ page, context, fx }) => {
  test.setTimeout(90_000)
  active(fx, 0n, 500_000_000n)
  fx.rejectOnce.add('close')
  await fx.install(context); await openPosition(page)
  await startClosing(page)
  await expect(step(page, 'Close position')).toContainText('You declined the request in MetaMask', { timeout: 20_000 })
  await expect(step(page, 'Send USDC to your position address').getByRole('status')).toHaveText('Done')
  // 30 days pass before the user retries: Morpho interest makes the 161.600154 USDC sent short of need(debt now)
  fx.timeAhead = 30n * 86_400n
  await step(page, 'Close position').getByRole('button', { name: 'Try again' }).click()
  await expect(step(page, 'Send USDC to your position address (second transfer)')).toBeVisible({ timeout: 20_000 })
  await expectClosed(page)
  const usdcTransfers = fx.txs.filter(t => t.to === USDC).map(t => BigInt('0x' + t.data.slice(-64)))
  // second = need(debt accrued to +30 d + 600 s) − 161.600154: 162.265631 − 161.600154 = 0.665477 USDC
  expect(usdcTransfers).toEqual([NEED_AHEAD, 665_477n])
  expect(signed(fx).map(m => m.method)).toEqual(['close', 'withdraw', 'withdraw'])
  expect(fx.closes).toBe(1)
})
