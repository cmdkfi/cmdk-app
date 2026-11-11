// The testnet flow is desktop-only (product owner, 11 Nov 2026: MetaMask Mobile 8.18's in-app browser fails the first
// personal_sign with -32602, MetaMask/metamask-mobile#39052). Below 960 px the live routes show one notice with "Try in
// sandbox" and mount no adapter; the sandbox works at every width (e2e/sandbox.spec.ts runs it end to end on this project).
import { test, expect, vault } from './live-fixture.ts'

const APP = 'localhost:5177'
const NOTICE = 'The testnet flow runs on a desktop browser with a wallet extension.'
const SANDBOX_LINE = 'On a phone, try the sandbox: a simulated wallet and protocol, nothing touches Base Sepolia or NEAR.'

async function fits(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page must fit the viewport').toBe(true)
}

test('phone: every live route shows the notice, and no wallet call, relayer call or NEAR or Base read happens', async ({ page, context, fx }) => {
  // a wallet that owns a vault with an open position: on a desktop this would reconnect silently and read everything
  fx.factoryCount = 10; fx.vaults.set(10, vault())
  await fx.install(context)
  for (const hash of ['', '#start', '#settings', '#connect', '#progress', '#position', '#close', '#closed']) {
    await page.goto('/' + hash)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NOTICE)
    await expect(page.getByText(SANDBOX_LINE)).toBeVisible()
    // the notice's only action; no wallet list, no amount field, no wallet slot
    await expect(page.getByRole('main').getByRole('button')).toHaveText(['Try in sandbox'])
    await expect(page.getByRole('main').getByRole('link')).toHaveCount(0)
    await expect(page.locator('.wallet-slot')).toHaveCount(0)
    await expect(page.getByRole('contentinfo')).toContainText('Agent protection is risk management, not insurance.')
    await fits(page)
  }
  await page.waitForTimeout(500)
  expect(fx.walletCalls, 'no silent reconnect below 960 px').toEqual([])
  expect([...fx.hosts]).toEqual([APP])
  expect(fx.requests).toEqual([])
  expect(fx.posts).toEqual([]); expect(fx.signs).toEqual([]); expect(fx.txs).toEqual([])
})

test('phone: "Try in sandbox" from the notice opens the sheet and activates the sandbox', async ({ page, context, fx }) => {
  await fx.install(context)
  await page.goto('/#connect')
  await page.getByRole('main').getByRole('button', { name: 'Try in sandbox' }).click()
  const sheet = page.getByRole('dialog', { name: 'Try in sandbox' })
  await expect(sheet).toBeVisible()
  expect(await sheet.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await sheet.getByRole('button', { name: 'Activate sandbox' }).click()
  await expect(page).toHaveURL(/#sandbox\/start$/)
  await expect(page.getByRole('status').filter({ hasText: 'Sandbox · simulated data' })).toBeVisible()
  await expect(page.getByLabel('Amount to deposit')).toHaveValue('0.5')
  await fits(page)
  expect([...fx.hosts]).toEqual([APP])
  expect(fx.walletCalls).toEqual([])
})

test('phone and tablet: the notice below 960 px, the live screen from 960 px; narrowing again shows the notice', async ({ page, context, fx }) => {
  await fx.install(context)
  await page.goto('/#start')
  for (const width of [320, 360, 390, 768, 959]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NOTICE)
    await fits(page)
  }
  expect(fx.walletCalls).toEqual([])
  for (const width of [960, 1024]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Borrow against what you hold.')
    await fits(page)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NOTICE)
  // at 960 px and above the live shell behaves as on a desktop: a silent reconnect at most, never a prompt
  expect(fx.walletCalls.filter(method => !['eth_accounts', 'eth_chainId'].includes(method))).toEqual([])
  expect(fx.signs).toEqual([]); expect(fx.posts).toEqual([]); expect(fx.txs).toEqual([])
})

test('phone: the sandbox position, its close sheet, verification and the wallet menu fit from 320 to 768 px', async ({ page, context, fx }) => {
  test.setTimeout(120_000)
  await fx.install(context)
  await page.goto('/#start')
  await page.getByRole('main').getByRole('button', { name: 'Try in sandbox' }).click()
  await page.getByRole('dialog', { name: 'Try in sandbox' }).getByRole('button', { name: 'Activate sandbox' }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Continue to wallet' }).click()
  await page.getByRole('button', { name: 'Create position' }).click()
  await expect(page).toHaveURL(/#sandbox\/position$/, { timeout: 60_000 })
  for (const width of [320, 360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    await fits(page)
    await page.getByRole('button', { name: 'Close position', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Close your position' })
    await expect(sheet).toBeVisible()
    expect(await sheet.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Verify the agent' }).click()
  await expect(page.getByRole('heading', { name: 'Agent verification' })).toBeVisible()
  await fits(page)
  await page.getByRole('button', { name: /Sandbox wallet/ }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await fits(page)
  expect([...fx.hosts]).toEqual([APP])
})
