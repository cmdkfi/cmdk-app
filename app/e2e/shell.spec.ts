import { shortAddress } from '../src/flow/format.ts'
import { test, expect, OWNER } from './live-fixture.ts'

const APP = 'localhost:5177', BASE_RPC = 'base.fixture.test'
const SHORT = shortAddress(OWNER)

test('shell: S1 renders with header, wallet slot and footer; only the app and the Base RPC are contacted', async ({ page, context, fx }) => {
  await fx.install(context)
  await page.goto('/')
  await expect(page).toHaveURL(/#start$/)
  await expect(page.getByRole('link', { name: 'cmdk home' })).toHaveText('⌘K')
  // Phase 8 (PRD S0, 10 Nov): no Connect button in the header; the wallet slot appears only once connected
  await expect(page.getByRole('banner').getByRole('button')).toHaveCount(0)
  await expect(page.locator('.wallet-slot')).toHaveCount(0)
  await expect(page.getByText('Testnet · Base Sepolia · no real funds', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Borrow USDC against ETH. Keep risk on autopilot.')
  await expect(page.getByRole('contentinfo')).toContainText('Agent protection is risk management, not insurance.')
  await expect(page.getByText('5.0% APR')).toBeVisible()
  // Without a wallet: no NEAR, no relayer, no GitHub; the market read is the only external call.
  expect([...fx.hosts].sort()).toEqual([BASE_RPC, APP].sort())
  expect(fx.posts).toEqual([]); expect(fx.signs).toEqual([]); expect(fx.txs).toEqual([])
  expect(fx.walletCalls.filter(method => !['eth_accounts', 'eth_chainId'].includes(method)), 'wallet prompts on load').toEqual([])
})

test('routes: browser Back moves between S1, S2 and S3; guarded routes redirect; sandbox hashes go to #start', async ({ page, context, fx }) => {
  await fx.install(context)
  await page.goto('/#start')
  await page.getByLabel('Amount to deposit').fill('0.1')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/#settings$/); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your protection, in one picture')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Continue to wallet' }).click()
  await expect(page).toHaveURL(/#connect$/); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Connect wallet')
  await page.goBack(); await expect(page).toHaveURL(/#settings$/)
  await page.goBack(); await expect(page).toHaveURL(/#start$/)
  await expect(page.getByLabel('Amount to deposit')).toHaveValue('0.1')
  await page.goForward(); await expect(page).toHaveURL(/#settings$/)
  await expect(page.getByRole('checkbox')).toBeChecked()
  for (const hash of ['#position', '#progress', '#close', '#unknown']) { await page.goto('/' + hash); await expect(page).toHaveURL(/#start$/) }
  // no sandbox until Phase 6b: every #sandbox/… hash goes to #start in the live app
  for (const hash of ['#sandbox/start', '#sandbox/close', '#sandbox/position']) { await page.goto('/' + hash); await expect(page).toHaveURL(/#start$/) }
  await expect(page.getByText(/[sS]andbox/)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'cmdk home' })).toHaveAttribute('href', '#start')
})

test('wallet slot: connect on S3 on the wrong chain, the switch is requested at once; refused, the slot offers it; menu and disconnect', async ({ page, context, fx }) => {
  fx.chain = '0x1'; fx.rejectSwitch = true
  await fx.install(context)
  await page.goto('/#connect')
  await page.getByRole('button', { name: 'MetaMask', exact: true }).click()
  const wrong = page.getByRole('button', { name: `${SHORT} · Switch to Base Sepolia` })
  await expect(wrong).toBeVisible(); await expect(page.getByText('Testnet · no real funds', { exact: true })).toBeVisible()
  // Phase 8a.1: right after the connect, the switch was requested once (and refused here)
  expect(fx.walletCalls.filter(m => m === 'wallet_switchEthereumChain')).toHaveLength(1)
  fx.rejectSwitch = false
  await wrong.click()
  const slot = page.getByRole('button', { name: `${SHORT} · Base Sepolia` })
  await expect(slot).toBeVisible(); await slot.click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem')).toHaveText(['Copy address', 'View on BaseScan', 'Show USDC in MetaMask', 'Disconnect'])
  await expect(menu.getByRole('menuitem', { name: 'View on BaseScan' })).toHaveAttribute('href', `https://sepolia.basescan.org/address/${OWNER}`)
  await page.keyboard.press('Escape'); await expect(menu).toBeHidden()
  await page.goto('/#settings'); await slot.click(); await page.getByRole('menuitem', { name: 'Disconnect' }).click()
  await expect(page).toHaveURL(/#start$/); await expect(page.locator('.wallet-slot')).toHaveCount(0)
  expect(fx.walletCalls).toContain('eth_requestAccounts')
  expect(fx.signs).toEqual([]); expect(fx.posts).toEqual([])
})

test('Phase 8a.1: a wallet without Base Sepolia gets the add-network request with the config values (4902) right after connecting', async ({ page, context, fx }) => {
  fx.chain = '0x1'; fx.switchUnknown = true
  await fx.install(context)
  await page.goto('/#connect')
  await page.getByRole('button', { name: 'MetaMask', exact: true }).click()
  await expect(page.getByRole('button', { name: `${SHORT} · Base Sepolia` })).toBeVisible()
  expect(fx.addChain).toEqual([{ chainId: '0x14a34', chainName: 'Base Sepolia', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: ['https://sepolia.basescan.org'] }])
})

test('Phase 8: S3 lists every EIP-6963 wallet and an unannounced window.ethereum; connecting with the second one uses its provider and its name', async ({ page, context, fx }) => {
  fx.walletSet = ['metamask', 'rabby', 'legacy']
  await fx.install(context)
  await page.goto('/#connect')
  const list = page.getByRole('list', { name: 'Wallets in this browser' })
  await expect(list.getByRole('button')).toHaveText(['MetaMask', 'Rabby Wallet', 'Browser wallet'])
  await expect(page.locator('.wallet-slot')).toHaveCount(0)
  await list.getByRole('button', { name: 'Rabby Wallet' }).click()
  await expect(page.getByRole('button', { name: `${SHORT} · Base Sepolia` })).toBeVisible()
  await expect(page.locator('.facts').getByText(`Rabby Wallet · ${SHORT}`)).toBeVisible()
  await expect(page.locator('.create-action__small')).toContainText('you only act inside Rabby Wallet')
  expect(fx.walletVia.find(c => c.method === 'eth_requestAccounts')?.via).toBe('io.rabby')
})

test('Phase 8: an announced window.ethereum is listed once', async ({ page, context, fx }) => {
  await fx.install(context)
  await page.goto('/#connect')
  await expect(page.getByRole('list', { name: 'Wallets in this browser' }).getByRole('button')).toHaveText(['MetaMask'])
})

test('Phase 8: a browser without any wallet shows "Install a wallet" and nothing to connect', async ({ page, context, fx }) => {
  fx.walletSet = []
  await fx.install(context)
  await page.goto('/#connect')
  await expect(page.getByText('No browser wallet was found.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Install a wallet' })).toHaveAttribute('href', /^https:\/\//)
  await expect(page.getByRole('list', { name: 'Wallets in this browser' })).toHaveCount(0)
})

test('desktop gate: below 960px the shell is not mounted, so no wallet call or read happens', async ({ page, context, fx }) => {
  await fx.install(context)
  await page.setViewportSize({ width: 900, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Open cmdk on a desktop browser' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'cmdk home' })).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(fx.walletCalls, 'no silent reconnect below 960px').toEqual([])
  expect([...fx.hosts]).toEqual([APP])
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.getByRole('heading', { name: 'Open cmdk on a desktop browser' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'cmdk home' })).toBeVisible()
})
