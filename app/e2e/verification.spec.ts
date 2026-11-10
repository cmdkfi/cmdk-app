import type { Page } from '@playwright/test'
import { test, expect, BASE, MEASUREMENT, vault, type LiveFixture } from './live-fixture.ts'

const NOW = 2_000_000_000
const VAULT = 'v10.factory.fixture.testnet'
const ROWS = ['Agent version approved by your vault', 'Running agent matches the approved version', 'Agent registered on your vault', 'Agent key is limited', 'Vault code matches the factory', 'Relayer holds no authority', 'What is not checked here']

function activeVault(fx: LiveFixture, registration = 'registered') {
  fx.factoryCount = 10
  fx.vaults.set(10, vault({ borrowShares: 160_080_000n }))
  fx.agentRows = [{ slot: 0, vault: VAULT, base_address: BASE, registration, registration_tx: 'RegTx1111111111111111111111111111111111111111', agent_status: 'active', expires_at: NOW + 86_400, last_tick_unix: null }]
}

const panel = (page: Page) => page.getByRole('region', { name: 'Agent verification' })
const row = (page: Page, title: string) => panel(page).getByRole('listitem', { name: title })
async function statuses(page: Page) {
  const out: string[] = []
  for (const title of ROWS) out.push(await row(page, title).getByRole('status').innerText())
  return out
}

async function openVerification(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await expect(page).toHaveURL(/#position$/)
  await page.getByRole('button', { name: 'Verify the agent' }).click()
  await expect(panel(page)).toBeVisible()
  await expect(row(page, ROWS[4]).getByRole('status')).not.toHaveText('Not checked') // the live checks have landed
}

test('§6: every live row is Checked against the fixture, with its time and how to check it; the static rows are never Checked', async ({ page, context, fx }) => {
  activeVault(fx)
  await fx.install(context); await openVerification(page)
  expect(await statuses(page)).toEqual(['Checked', 'Checked', 'Checked', 'Checked', 'Checked', 'Statement', 'Statement'])
  for (const title of ROWS.slice(0, 5)) await expect(row(page, title)).toContainText(/Checked at \d/)
  await expect(row(page, ROWS[0])).toContainText('source commit f1x7ure')
  await expect(row(page, ROWS[0]).getByRole('link', { name: 'published manifest' })).toHaveAttribute('href', 'https://raw.githubusercontent.com/cmdkfi/app/main/deployments/testnet.json')
  await expect(row(page, ROWS[1])).toContainText(`SHA-256 of app-compose.json (${MEASUREMENT.compose_hash.slice(0, 12)}…)`)
  await expect(row(page, ROWS[2]).getByRole('link', { name: 'registration transaction' })).toHaveAttribute('href', 'https://testnet.nearblocks.io/txns/RegTx1111111111111111111111111111111111111111')
  await expect(row(page, ROWS[3]).getByRole('link', { name: 'your vault' })).toHaveAttribute('href', `https://testnet.nearblocks.io/address/${VAULT}`)
  await expect(row(page, ROWS[5]).getByRole('link', { name: 'scripts/RELAYER.md' })).toHaveAttribute('href', 'https://github.com/cmdkfi/app/blob/main/scripts/RELAYER.md')
  await expect(row(page, ROWS[6]).getByRole('link', { name: 'agent/MEASUREMENT.md' })).toHaveAttribute('href', 'https://github.com/cmdkfi/app/blob/main/agent/MEASUREMENT.md')
  for (const title of ROWS.slice(5)) await expect(row(page, title)).not.toContainText(/Checked at|Last tried at/)
  expect(fx.requests.some(r => r.host === 'raw.githubusercontent.com')).toBe(true)
})

test('§6: an altered published manifest shows Mismatch on the first row only', async ({ page, context, fx }) => {
  activeVault(fx)
  fx.publishedMeasurement = { ...MEASUREMENT, rtmr2: '00'.repeat(48) }
  await fx.install(context); await openVerification(page)
  expect(await statuses(page)).toEqual(['Mismatch', 'Checked', 'Checked', 'Checked', 'Checked', 'Statement', 'Statement'])
  await expect(row(page, ROWS[0])).toContainText('The values your vault approved differ from the published manifest.')
})

test('§6: a failing evidence fetch shows Unavailable on that row only', async ({ page, context, fx }) => {
  activeVault(fx)
  fx.evidenceDown = true
  await fx.install(context); await openVerification(page)
  expect(await statuses(page)).toEqual(['Checked', 'Unavailable', 'Checked', 'Checked', 'Checked', 'Statement', 'Statement'])
  await expect(row(page, ROWS[1])).toContainText('Could not be read: Evidence file app-compose.json is unavailable.')
})

test('§6 in the S4 rail: the registration row reads Registering while the agent row is pending; nothing is Checked without a result', async ({ page, context, fx }) => {
  fx.factoryCount = 9
  fx.agentRows = [{ slot: 0, vault: VAULT, base_address: BASE, registration: 'registering', agent_status: 'revoked', expires_at: null, last_tick_unix: null }]
  fx.rejectOnce.add('setup')
  await fx.install(context)
  await page.goto('/#start')
  await page.getByLabel('Amount to deposit').fill('0.1')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Continue to wallet' }).click()
  await page.getByRole('button', { name: 'Connect MetaMask' }).click()
  await page.getByRole('button', { name: 'Create position' }).click()
  await expect(page).toHaveURL(/#progress$/)
  await expect(panel(page)).toBeVisible()
  await expect(page.getByRole('listitem', { name: 'Approve agent and rules' })).toContainText('You declined the request in MetaMask', { timeout: 20_000 })
  await expect(row(page, ROWS[2])).toContainText('Registering (usually within a few minutes).')
  await expect(row(page, ROWS[2]).getByRole('status')).toHaveText('Not checked')
  await expect(row(page, ROWS[2])).toContainText(/Last tried at \d/)
  await expect(row(page, ROWS[2])).not.toContainText('Checked at')
  // the vault exists but approved nothing yet: no claim either way
  await expect(row(page, ROWS[0])).toContainText('Your vault has not approved an agent version yet; the setup step does that.')
  await expect(row(page, ROWS[0]).getByRole('status')).toHaveText('Not checked')
  await expect(row(page, ROWS[1]).getByRole('status')).toHaveText('Not checked')
})

test('Phase 7b: the agent list lagging the chain (live 9 Nov row) reads Active on the card and "not caught up" in the panel, never Revoked or Mismatch', async ({ page, context, fx }) => {
  activeVault(fx)
  // tasks/rehearsal-2026-11-10.md: v10 held the agent key on NEAR while the agent's list still said registering · revoked
  fx.agentRows = [{ slot: 0, vault: VAULT, base_address: BASE, registration: 'registering', registration_tx: null, agent_status: 'revoked', expires_at: null, last_tick_unix: null }]
  await fx.install(context); await openVerification(page)
  const card = page.locator('section.card-s5').filter({ hasText: 'Agent' }).first()
  await expect(card.getByRole('status')).toHaveText("Active · Your vault shows the registration; the agent's list has not caught up yet.")
  expect(await statuses(page)).toEqual(['Checked', 'Checked', 'Not checked', 'Checked', 'Checked', 'Statement', 'Statement'])
  await expect(row(page, ROWS[2])).toContainText("The agent's list has not caught up yet; your vault already holds the restricted agent key")
})

test('Phase 7b: a registered row without registration_tx says so and points to the vault\'s access keys on NearBlocks', async ({ page, context, fx }) => {
  activeVault(fx)
  fx.agentRows = [{ slot: 0, vault: VAULT, base_address: BASE, registration: 'registered', registration_tx: null, agent_status: 'active', expires_at: NOW + 86_400, last_tick_unix: null }]
  await fx.install(context); await openVerification(page)
  await expect(row(page, ROWS[2]).getByRole('status')).toHaveText('Checked')
  await expect(row(page, ROWS[2])).toContainText("The agent's list gives no registration transaction for it; your vault's access keys on NearBlocks show the agent key.")
  await expect(row(page, ROWS[2]).getByRole('link', { name: 'your vault' })).toHaveAttribute('href', `https://testnet.nearblocks.io/address/${VAULT}`)
})

test('Phase 7b: a vault that approved an earlier agent version reads Outdated on the card, even with a valid key; the panel says why', async ({ page, context, fx }) => {
  activeVault(fx)
  fx.agentRows = []
  fx.publishedMeasurement = { ...MEASUREMENT, compose_hash: 'db4f5085'.padEnd(64, '0') }
  await fx.install(context); await openVerification(page)
  const card = page.locator('section.card-s5').filter({ hasText: 'Agent' }).first()
  await expect(card.getByRole('status')).toHaveText('Outdated · Your vault approved an earlier agent version; the running agent does not watch it.')
  await expect(row(page, ROWS[0]).getByRole('status')).toHaveText('Mismatch')
  await expect(row(page, ROWS[2])).toContainText('The running agent does not watch your vault: it approved an earlier agent version (see the first row).')
})
