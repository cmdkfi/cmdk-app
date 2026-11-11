import { test, expect, vault } from './live-fixture.ts'

async function fits(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page must fit the viewport').toBe(true)
}

test('phone: compact catalogue expands; amount and acknowledgement gate the wallet step', async ({ page, context, fx }) => {
  await fx.install(context)
  await page.goto('/#start')
  await expect(page.getByLabel('Amount to deposit')).toHaveValue('0.01')
  await expect(page.locator('#asset-catalogue')).toBeHidden()
  await page.getByRole('button', { name: 'View assets and markets' }).click()
  await expect(page.locator('#asset-catalogue')).toBeVisible()
  await expect(page.getByText('Exploring', { exact: true })).toBeVisible()
  await fits(page)
  await page.getByRole('button', { name: 'Hide assets and markets' }).click()
  await page.getByLabel('Amount to deposit').fill('0.0001')
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
  await page.getByLabel('Amount to deposit').fill('0.02')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Continue to wallet' })).toBeDisabled()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Continue to wallet' }).click()
  await expect(page.getByRole('button', { name: 'MetaMask', exact: true })).toBeVisible()
  expect(fx.signs).toEqual([]); expect(fx.txs).toEqual([])
})

test('phone without injection: explains wallet browsers and still offers sandbox', async ({ page, context, fx }) => {
  fx.walletSet = []
  await fx.install(context)
  await page.goto('/#connect')
  await expect(page.getByText('No browser wallet was found.')).toBeVisible()
  await expect(page.getByText('Copy this page’s address')).toBeVisible()
  await page.getByRole('button', { name: 'Try in sandbox' }).last().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  expect(await sheet.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await sheet.getByRole('button', { name: 'Activate sandbox' }).click()
  await expect(page).toHaveURL(/#sandbox\/start$/)
  await expect(page.getByRole('status').filter({ hasText: 'Sandbox · simulated data' })).toBeVisible()
})

test('phone and tablet: position, verification, wallet menu and confirmations fit', async ({ page, context, fx }) => {
  test.setTimeout(60_000)
  fx.factoryCount = 10; fx.vaults.set(10, vault())
  await fx.install(context)
  await page.goto('/#connect')
  await page.getByRole('button', { name: 'MetaMask', exact: true }).click()
  await expect(page).toHaveURL(/#position$/)
  for (const width of [320, 360, 390, 768, 1024]) {
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
  await page.getByRole('button', { name: /· Base Sepolia/ }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await fits(page)
  expect(fx.signs).toEqual([]); expect(fx.txs).toEqual([])
})
