import {test,expect,OTHER} from './fixture.ts'
import {mkdir} from 'node:fs/promises'
import type {Page} from '@playwright/test'
async function connect(page:Page){await page.goto('/#connect');await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click();await page.locator('.wallet-option').filter({hasText:'MetaMask'}).click()}

test('discovery: initial transport failure is not an empty portfolio and recovers automatically',async({page,context,protocol})=>{
 if(process.env.CMDK_TEST_CHROME==='1')console.info(`Google Chrome ${page.context().browser()?.version()}`)
 protocol.fullPosition=true;protocol.factoryCount=1;protocol.failFactory=true;await protocol.install(context);await page.clock.install();await connect(page)
 await expect(page.getByRole('alert').filter({hasText:'Vault search unavailable'})).toBeVisible()
 await expect(page.getByRole('dialog',{name:'Wallet connection'})).not.toBeVisible()
 await expect(page.getByText('No vault belongs to this address yet.',{exact:true})).toHaveCount(0)
 await expect(page.getByRole('link',{name:/Create vault/})).toHaveCount(0)
 expect(protocol.factoryReads).toBe(2)
 if(process.env.CMDK_DISCOVERY_SHOTS){await mkdir(process.env.CMDK_DISCOVERY_SHOTS,{recursive:true});await page.screenshot({path:`${process.env.CMDK_DISCOVERY_SHOTS}/chrome-discovery-failure.png`})}
 protocol.failFactory=false;await page.clock.runFor(11000)
 await expect(page.getByRole('button',{name:'Verification details',exact:true})).toBeVisible()
 await expect(page.getByRole('alert').filter({hasText:'Vault search unavailable'})).toHaveCount(0)
 if(process.env.CMDK_DISCOVERY_SHOTS)await page.screenshot({path:`${process.env.CMDK_DISCOVERY_SHOTS}/chrome-discovery-recovered.png`})
 expect(protocol.posts).toEqual([]);expect(protocol.signs).toEqual([])
})

test('discovery: cached identities survive a failed refresh but never cross wallet identities',async({page,context,protocol})=>{
 protocol.factoryCount=1;await protocol.install(context);await page.clock.install();await connect(page)
 await expect(page.getByRole('button',{name:'Verification details',exact:true})).toBeVisible()
 protocol.failFactory=true;await page.getByRole('button',{name:'Refresh',exact:true}).click()
 const cached=page.getByRole('region',{name:'Previously found vaults'})
 await expect(cached).toContainText('v1.fixture.testnet');await expect(cached).toContainText('read-only')
 await expect(page.getByRole('alert').filter({hasText:'Vault search unavailable'})).toBeVisible()
 await page.evaluate(other=>window.fixtureWallet.changeAccount(other),OTHER)
 await expect(cached).toHaveCount(0);await expect(page.getByText(/Selected: v1/)).toHaveCount(0)
 expect(protocol.posts).toEqual([])
})

test('discovery: retry-after prevents requests before cooldown and then recovery restores discovery',async({page,context,protocol})=>{
 protocol.factoryCount=1;protocol.factoryRateLimit=true;await protocol.install(context);await page.clock.install();await connect(page)
 await expect(page.getByRole('alert')).toContainText('rate limited')
 await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeDisabled()
 expect(protocol.factoryReads).toBe(1);await page.clock.runFor(2000);expect(protocol.factoryReads).toBe(1)
 protocol.factoryRateLimit=false;await page.clock.runFor(9000)
 await expect(page.getByRole('button',{name:'Verification details',exact:true})).toBeVisible()
 expect(protocol.factoryReads).toBe(2);expect(protocol.posts).toEqual([])
})

test('discovery: partial scan retains unread vault but removes a rechecked transferred vault',async({page,context,protocol})=>{
 protocol.factoryCount=2;await protocol.install(context);await page.clock.install();await connect(page)
 await expect(page.getByText(/Selected: v2.fixture.testnet/)).toBeVisible()
 protocol.unreadVault='v1.fixture.testnet';protocol.transferredVault='v2.fixture.testnet'
 await page.getByRole('button',{name:'Refresh',exact:true}).click()
 await expect(page.getByRole('alert').filter({hasText:'Ownership check incomplete'})).toBeVisible()
 const cached=page.getByRole('region',{name:'Previously found vaults'})
 await expect(cached).toContainText('v1.fixture.testnet');await expect(cached).not.toContainText('v2.fixture.testnet')
 protocol.unreadVault='';await page.clock.runFor(11000)
 await expect(cached).toHaveCount(0);await expect(page.getByText(/Selected: v1.fixture.testnet/)).toBeVisible()
 expect(protocol.posts).toEqual([])
})


test('discovery: persistent transport failure stops after three automatic recovery attempts',async({page,context,protocol})=>{
 protocol.failFactory=true;await protocol.install(context);await page.clock.install();await connect(page)
 const failure=page.getByRole('alert').filter({hasText:'Vault search unavailable'})
 await expect(failure).toBeVisible();expect(protocol.factoryReads).toBe(2)
 for(const [delay,count] of [[11000,4],[31000,6],[61000,8]]){await page.clock.runFor(delay);await expect(failure).toBeVisible();expect(protocol.factoryReads).toBe(count)}
 await expect(page.getByText('Automatic retries paused. Refresh to try again.',{exact:true})).toBeVisible()
 await page.clock.runFor(120000);expect(protocol.factoryReads).toBe(8);expect(protocol.posts).toEqual([])
})


test('positions: last complete rows remain read-only through RPC outage and refresh automatically on recovery',async({page,context,protocol})=>{
 protocol.fullPosition=true;protocol.factoryCount=1;await protocol.install(context);await page.clock.install();await connect(page)
 const collateral=page.getByRole('cell',{name:/^1 WETH /}).or(page.getByRole('definition').filter({hasText:/^1 WETH/})).filter({visible:true})
 await expect(collateral).toBeVisible()
 protocol.failNearState=true;await page.getByRole('button',{name:'Refresh positions',exact:true}).click()
 await expect(page.getByText(/Showing the last complete snapshot; rows open read-only verification/)).toBeVisible()
 await expect(collateral).toBeVisible()
 protocol.failNearState=false;await page.clock.runFor(31000)
 await expect(page.getByText(/Showing the last complete snapshot; rows open read-only verification/)).toHaveCount(0)
 await expect(collateral).toBeVisible()
 expect(protocol.posts).toEqual([]);expect(protocol.signs).toEqual([])
})
