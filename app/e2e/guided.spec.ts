import type { Page } from '@playwright/test'
import { test, expect, OWNER, vault } from './live-fixture.ts'

async function chooseAndAcknowledge(page: Page, amount = '0.1') {
  await page.goto('/#start')
  await page.getByLabel('Amount to deposit').fill(amount)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Continue to wallet' }).click()
  await expect(page).toHaveURL(/#connect$/)
}
const connect = (page: Page) => page.getByRole('button', { name: 'MetaMask', exact: true }).click()

test('S1: estimates come from the live market read', async ({ page, context, fx }) => {
  await fx.install(context); await page.goto('/')
  await page.getByLabel('Amount to deposit').fill('0.1')
  // 0.1 ETH × 3200 USDC = 320 USDC value; 50% target = 160 USDC; liquidity 8000 USDC suffices.
  await expect(page.getByText('≈ $320 at the live market oracle')).toBeVisible()
  await expect(page.getByText('about 160 USDC')).toBeVisible()
  await expect(page.getByText(/^5\.0% APR$/)).toBeVisible()
  await expect(page.getByText('Collateral yield')).toBeVisible()
  for (const name of ['BTC', 'NEAR', 'Gold', 'AAPL', 'Rhea · NEAR', 'Aave · Ethereum', 'Kamino · Solana']) await expect(page.locator('.tile').filter({ has: page.getByText(name, { exact: true }) })).toHaveAttribute('aria-disabled', 'true')
  expect(fx.ethCalls).toEqual(expect.arrayContaining(['idToMarketParams', 'config', 'market', 'price', 'borrowRateView', 'decimals']))
})

test('S1: failed oracle and IRM reads are shown as unavailable, never as numbers', async ({ page, context, fx }) => {
  fx.price = null; fx.rate = null
  await fx.install(context); await page.goto('/')
  await page.getByLabel('Amount to deposit').fill('0.1')
  await expect(page.getByText('rate unavailable')).toBeVisible()
  await expect(page.locator('#deposit-hint')).toContainText('Value unavailable')
  await expect(page.locator('.estimate')).not.toContainText('USDC')
})

test('S1: when the market cannot lend the full amount, a warning replaces the estimate (R2)', async ({ page, context, fx }) => {
  fx.supply = 2_100n * 10n ** 6n; fx.borrowed = 2_000n * 10n ** 6n
  await fx.install(context); await page.goto('/')
  await page.getByLabel('Amount to deposit').fill('0.1')
  await expect(page.getByText('The market cannot lend the full amount now')).toBeVisible()
  // liquidity 100 USDC, 1% margin → 99 USDC; 99 / 320 = 30.9 %; 99 USDC at 50 % needs 198 USDC of collateral = 0.061875 ETH
  await expect(page.getByText('99 USDC available · the position would open at 30.9% LTV')).toBeVisible()
  await expect(page.getByText('Deposit up to 0.061875 ETH to open at 50%')).toBeVisible()
})

test('S1/S2 gating: amount below minimum blocks Continue; the acknowledgement blocks S3', async ({ page, context, fx }) => {
  await fx.install(context); await page.goto('/')
  const next = page.getByRole('button', { name: 'Continue', exact: true })
  // PRD S1: prefilled with 0.01 ETH, editable
  await expect(page.getByLabel('Amount to deposit')).toHaveValue('0.01')
  await expect(next).toBeEnabled()
  await page.getByLabel('Amount to deposit').fill(''); await expect(next).toBeDisabled()
  await page.getByLabel('Amount to deposit').fill('0.0005'); await expect(page.getByText('The minimum deposit is 0.001 ETH.')).toBeVisible(); await expect(next).toBeDisabled()
  await page.getByLabel('Amount to deposit').fill('0.001'); await expect(next).toBeEnabled(); await next.click()
  await expect(page.getByText('Liquidation 86%')).toBeVisible()
  await expect(page.getByText('Reduce above 70%')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to wallet' })).toBeDisabled()
})

test('S3: short on Base Sepolia ETH opens the faucet panel and continues by itself when funds arrive', async ({ page, context, fx }) => {
  fx.wallet.eth = 5n * 10n ** 16n // 0.05 ETH for a 0.1 ETH deposit
  await fx.install(context); await page.clock.install()
  await chooseAndAcknowledge(page); await connect(page)
  await expect(page.getByText('None for this wallet')).toBeVisible()
  await expect(page).toHaveURL(/#connect$/)
  const panel = page.getByRole('complementary', { name: 'Get Base Sepolia ETH' })
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('ETH missing')
  await expect(panel).toContainText(OWNER)
  await expect(panel.getByRole('link')).toHaveText(['Base docs: network faucets', 'Coinbase Developer Platform faucet', 'Alchemy Base Sepolia faucet'])
  await expect(page.getByText('2 transactions')).toBeVisible()
  fx.wallet.eth = 10n ** 18n; await page.clock.runFor(10_500)
  await expect(panel).toBeHidden()
  await expect(page.getByText('Enough')).toBeVisible()
  // funded now: Create position is enabled and nothing has been requested yet
  await expect(page.getByRole('button', { name: 'Create position' })).toBeEnabled()
  expect(fx.signs).toEqual([]); expect(fx.posts).toEqual([]); expect(fx.txs).toEqual([])
  expect([...fx.hosts].sort()).toEqual(['base.fixture.test', 'localhost:5177', 'near.fixture.test', 'relayer.fixture.test'])
})

test('S3: WETH already in the wallet needs gas for one transfer only', async ({ page, context, fx }) => {
  fx.wallet.weth = 10n ** 17n; fx.wallet.eth = 10n ** 15n
  await fx.install(context)
  await chooseAndAcknowledge(page); await connect(page)
  await expect(page.getByText('WETH already in wallet')).toBeVisible()
  await expect(page.getByText('1 transaction', { exact: false })).toBeVisible()
  await expect(page.getByText('Enough')).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Get Base Sepolia ETH' })).toHaveCount(0)
})

test('S3: a contract wallet is blocked with the reason', async ({ page, context, fx }) => {
  fx.code = 'contract'
  await fx.install(context)
  await chooseAndAcknowledge(page); await connect(page)
  await expect(page.getByText('Contract wallet (not supported)')).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'ecrecover' })).toBeVisible()
  await expect(page.getByText('Base Sepolia ETH')).toHaveCount(0)
})

test('S3: an EIP-7702 delegated account is allowed and gets the funding check', async ({ page, context, fx }) => {
  fx.code = 'delegated'
  await fx.install(context)
  await chooseAndAcknowledge(page); await connect(page)
  await expect(page.getByText('EIP-7702 delegated account (supported)')).toBeVisible()
  await expect(page.getByText('Enough')).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'ecrecover' })).toHaveCount(0)
})

test('S3: failed vault discovery shows the banner and never offers creation', async ({ page, context, fx }) => {
  fx.factoryCount = 10; fx.unreadVaults.add(10)
  await fx.install(context)
  await chooseAndAcknowledge(page); await connect(page)
  await expect(page.getByRole('alert').filter({ hasText: 'Could not read your vaults' })).toBeVisible()
  await expect(page.getByText('None for this wallet')).toHaveCount(0)
  await expect(page.getByText('Your vaults could not be read, so a position cannot be created.')).toBeVisible()
  fx.unreadVaults.clear(); await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText('None for this wallet')).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not read your vaults' })).toHaveCount(0)
})

test('after connect from S3: an active vault opens the position screen (D4, landing re-run)', async ({ page, context, fx }) => {
  fx.factoryCount = 10; fx.vaults.set(10, vault())
  await fx.install(context)
  await chooseAndAcknowledge(page); await connect(page)
  await expect(page).toHaveURL(/#position$/)
  await expect(page.getByRole('heading', { name: 'Your position' })).toBeVisible()
})

test('after connect: an empty vault with complete setup is reused at the deposit step', async ({ page, context, fx }) => {
  fx.factoryCount = 10; fx.vaults.set(10, vault({ collateral: 0n }))
  await fx.install(context)
  await chooseAndAcknowledge(page); await connect(page)
  await expect(page).toHaveURL(/#progress$/)
  await expect(page.getByText('Your vault is ready. Deposit to open a position.')).toBeVisible()
  expect(fx.signs).toEqual([]); expect(fx.posts).toEqual([])
})

test('Q4: a used USDC allowance below max still counts as setup complete; a zero allowance does not', async ({ page, context, fx }) => {
  fx.factoryCount = 10; fx.vaults.set(10, vault({ collateral: 0n, loanAllowance: 12_345n }))
  await fx.install(context)
  await chooseAndAcknowledge(page); await connect(page)
  await expect(page.getByText('Your vault is ready. Deposit to open a position.')).toBeVisible()
  fx.vaults.set(10, vault({ collateral: 0n, loanAllowance: 0n }))
  await page.reload()
  await expect(page.getByText('Your vault exists but its setup is not complete. One signature finishes it.')).toBeVisible()
})

test('active vault with idle USDC and no local onboarding record lands on S5, not S4', async ({ page, context, fx }) => {
  fx.factoryCount = 10; fx.vaults.set(10, vault({ borrowShares: 1_000n, idle: { eth: 0n, weth: 0n, usdc: 50n * 10n ** 6n } }))
  await fx.install(context)
  await page.goto('/#connect'); await page.getByRole('button', { name: 'MetaMask', exact: true }).click()
  await expect(page).toHaveURL(/#position$/)
})

test('D4 / R8: vaults below firstVaultNumber are never read; the wallet owns none', async ({ page, context, fx }) => {
  fx.factoryCount = 9; fx.vaults.set(3, vault()); fx.unreadVaults.add(5)
  await fx.install(context)
  await chooseAndAcknowledge(page); await connect(page)
  await expect(page.getByText('None for this wallet')).toBeVisible()
  await expect(page).toHaveURL(/#connect$/)
  await expect(page.getByRole('alert').filter({ hasText: 'Could not read your vaults' })).toHaveCount(0)
})
