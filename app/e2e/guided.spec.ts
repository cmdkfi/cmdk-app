import type {Page} from '@playwright/test'
import {test,expect,recordHosts} from './guided-fixture.ts'

async function chooseAndAcknowledge(page:Page,amount='0.1'){
 await page.goto('/#start')
 await page.getByLabel('Amount to deposit').fill(amount)
 await page.getByRole('button',{name:'Continue',exact:true}).click()
 await page.getByRole('checkbox').check()
 await page.getByRole('button',{name:'Continue to wallet'}).click()
 await expect(page).toHaveURL(/#connect$/)
}
const connect=(page:Page)=>page.getByRole('button',{name:'Connect MetaMask'}).click()

test('S1: estimates come from the live market read',async({page,context,protocol})=>{
 await protocol.install(context);await page.goto('/')
 await page.getByLabel('Amount to deposit').fill('0.1')
 // 0.1 ETH × 3200 USDC = 320 USDC value; 50% target = 160 USDC; liquidity 8000 USDC suffices.
 await expect(page.getByText('≈ $320 at the live market oracle')).toBeVisible()
 await expect(page.getByText('about 160 USDC')).toBeVisible()
 await expect(page.getByText(/^5\.0% \/ year$/)).toBeVisible()
 await expect(page.getByText('Collateral yield')).toBeVisible()
 for(const name of ['BTC','NEAR','Gold','AAPL','Rhea · NEAR','Aave · Ethereum','Kamino · Solana'])await expect(page.locator('.tile').filter({has:page.getByText(name,{exact:true})})).toHaveAttribute('aria-disabled','true')
 expect(protocol.guidedCalls).toContain('config');expect(protocol.guidedCalls).toContain('borrowRateView')
})

test('S1: failed oracle and IRM reads are shown as unavailable, never as numbers',async({page,context,protocol})=>{
 protocol.price=null;protocol.rate=null;await protocol.install(context);await page.goto('/')
 await page.getByLabel('Amount to deposit').fill('0.1')
 await expect(page.getByText('rate unavailable')).toBeVisible()
 await expect(page.locator('#deposit-hint')).toContainText('Value unavailable')
 await expect(page.locator('.estimate')).not.toContainText('USDC')
 expect(protocol.guidedCalls).toContain('price:empty');expect(protocol.guidedCalls).toContain('borrowRateView:empty')
})

test('S1: when the market cannot lend the full amount, a warning replaces the estimate (R2)',async({page,context,protocol})=>{
 protocol.supply=2_100n*10n**6n;protocol.borrowed=2_000n*10n**6n;await protocol.install(context);await page.goto('/')
 await page.getByLabel('Amount to deposit').fill('0.1')
 await expect(page.getByText('The market cannot lend the full amount now')).toBeVisible()
 await expect(page.getByText(/^100 USDC available · the position would open at 31\.2% LTV$/)).toBeVisible()
})

test('S1/S2 gating: amount below minimum blocks Continue; the acknowledgement blocks S3',async({page,context,protocol})=>{
 await protocol.install(context);await page.goto('/')
 const next=page.getByRole('button',{name:'Continue',exact:true})
 await expect(next).toBeDisabled()
 await page.getByLabel('Amount to deposit').fill('0.0005');await expect(page.getByText('The minimum deposit is 0.001 ETH.')).toBeVisible();await expect(next).toBeDisabled()
 await page.getByLabel('Amount to deposit').fill('0.001');await expect(next).toBeEnabled();await next.click()
 await expect(page.getByText('Liquidation 86%')).toBeVisible()
 await expect(page.getByText('Reduce above 70%')).toBeVisible()
 await expect(page.getByRole('button',{name:'Continue to wallet'})).toBeDisabled()
})

test('S3: short on Base Sepolia ETH opens the faucet panel and continues by itself when funds arrive',async({page,context,protocol})=>{
 protocol.walletEth=5n*10n**16n // 0.05 ETH for a 0.1 ETH deposit
 const hosts=recordHosts(context);await protocol.install(context);await page.clock.install()
 await chooseAndAcknowledge(page);await connect(page)
 await expect(page.getByText('None for this wallet')).toBeVisible()
 await expect(page).toHaveURL(/#connect$/) // no vault: the user stays on S3
 const panel=page.getByRole('region',{name:'Get Base Sepolia ETH'})
 await expect(panel).toBeVisible()
 await expect(panel).toContainText('ETH missing')
 await expect(panel).toContainText('0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A')
 await expect(panel.getByRole('link')).toHaveText(['Base docs: network faucets','Coinbase Developer Platform faucet','Alchemy Base Sepolia faucet'])
 await expect(page.getByText('2 transactions')).toBeVisible()
 protocol.walletEth=10n**18n;await page.clock.runFor(10_500)
 await expect(panel).toBeHidden()
 await expect(page.getByText('Enough')).toBeVisible()
 const create=page.getByRole('button',{name:'Create position'})
 await expect(create).toBeDisabled();await expect(page.getByText('Creating a position starts in Phase 3 of this build.')).toBeVisible()
 expect(protocol.signs).toEqual([]);expect(protocol.posts).toEqual([])
 expect([...hosts].sort()).toEqual(['base.fixture.test','localhost:5177','near.fixture.test','relayer.fixture.test'])
})

test('S3: WETH already in the wallet needs gas for one transfer only',async({page,context,protocol})=>{
 protocol.walletWeth=10n**17n;protocol.walletEth=10n**15n;await protocol.install(context)
 await chooseAndAcknowledge(page);await connect(page)
 await expect(page.getByText('WETH already in wallet')).toBeVisible()
 await expect(page.getByText('1 transaction',{exact:false})).toBeVisible()
 await expect(page.getByText('Enough')).toBeVisible()
 await expect(page.getByRole('region',{name:'Get Base Sepolia ETH'})).toHaveCount(0)
})

test('S3: a contract wallet is blocked with the reason',async({page,context,protocol})=>{
 protocol.contractWallet=true;await protocol.install(context)
 await chooseAndAcknowledge(page);await connect(page)
 await expect(page.getByText('Contract wallet (not supported)')).toBeVisible()
 await expect(page.getByRole('alert').filter({hasText:'ecrecover'})).toBeVisible()
 await expect(page.getByText('Base Sepolia ETH')).toHaveCount(0)
})

test('S3: an EIP-7702 delegated account is allowed and gets the funding check',async({page,context,protocol})=>{
 protocol.delegated=true;await protocol.install(context)
 await chooseAndAcknowledge(page);await connect(page)
 await expect(page.getByText('EIP-7702 delegated account (supported)')).toBeVisible()
 await expect(page.getByText('Enough')).toBeVisible()
 await expect(page.getByRole('alert').filter({hasText:'ecrecover'})).toHaveCount(0)
})

test('S3: failed vault discovery shows the banner and never offers creation',async({page,context,protocol})=>{
 protocol.failFactory=true;await protocol.install(context)
 await chooseAndAcknowledge(page);await connect(page)
 await expect(page.getByRole('alert').filter({hasText:'Could not read your vaults'})).toBeVisible()
 await expect(page.getByText('None for this wallet')).toHaveCount(0)
 await expect(page.getByText('Your vaults could not be read, so a position cannot be created.')).toBeVisible()
 protocol.failFactory=false;await page.getByRole('button',{name:'Retry'}).click()
 await expect(page.getByText('None for this wallet')).toBeVisible()
 await expect(page.getByRole('alert').filter({hasText:'Could not read your vaults'})).toHaveCount(0)
})

test('after connect from S3: an active vault opens the position screen (D4, landing re-run)',async({page,context,protocol})=>{
 protocol.fullPosition=true;protocol.factoryCount=10;protocol.idleUsdc=0n;await protocol.install(context)
 await chooseAndAcknowledge(page);await connect(page)
 await expect(page).toHaveURL(/#position$/)
 await expect(page.getByText('Active position')).toBeVisible()
})

test('after connect: an empty vault with complete setup is reused at the deposit step',async({page,context,protocol})=>{
 protocol.fullPosition=true;protocol.factoryCount=10;protocol.collateral=0n;protocol.idleWeth=0n;protocol.idleUsdc=0n;await protocol.install(context)
 await chooseAndAcknowledge(page);await connect(page)
 await expect(page).toHaveURL(/#progress$/)
 await expect(page.getByText('Your vault is ready. Deposit to open a position.')).toBeVisible()
 expect(protocol.signs).toEqual([]);expect(protocol.posts).toEqual([])
})

test('active vault with idle USDC and no local onboarding record lands on S5, not S4',async({page,context,protocol})=>{
 protocol.fullPosition=true;protocol.factoryCount=10;protocol.idleUsdc=50n*10n**6n;await protocol.install(context)
 await page.goto('/');await page.getByRole('button',{name:'Connect wallet',exact:true}).click()
 await expect(page).toHaveURL(/#position$/)
})

test('D4 / R8: vaults below firstVaultNumber are ignored, even unreadable ones; the wallet owns none',async({page,context,protocol})=>{
 protocol.fullPosition=true;protocol.factoryCount=9;protocol.unreadVault='v3.fixture.testnet';await protocol.install(context)
 await chooseAndAcknowledge(page);await connect(page)
 await expect(page.getByText('None for this wallet')).toBeVisible()
 await expect(page).toHaveURL(/#connect$/)
 await expect(page.getByRole('alert').filter({hasText:'Could not read your vaults'})).toHaveCount(0)
})

