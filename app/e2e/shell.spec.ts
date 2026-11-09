import type {BrowserContext} from '@playwright/test'
import {test,expect} from './fixture.ts'

const APP='http://localhost:5177/'
// Every request the browser makes; the shell may only load its own bundle and assets.
function recordRequests(context:BrowserContext){const urls:string[]=[];context.on('request',request=>urls.push(request.url()));return urls}
const offOrigin=(urls:string[])=>urls.filter(url=>!url.startsWith(APP))

test('shell: S1 renders with header, wallet slot and footer and makes zero network calls',async({page,context,protocol})=>{
 const urls=recordRequests(context);await protocol.install(context)
 await page.goto('/')
 await expect(page).toHaveURL(/#start$/)
 await expect(page.getByRole('link',{name:'cmdk home'})).toHaveText('⌘K')
 await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible()
 await expect(page.getByText('Testnet · Base Sepolia · no real funds',{exact:true})).toBeVisible()
 await expect(page.getByRole('heading',{level:1})).toHaveText('Borrow USDC against ETH. Keep risk on autopilot.')
 await expect(page.getByRole('contentinfo')).toContainText('Agent protection is risk management, not insurance.')
 await expect(page.getByRole('heading',{name:'Open cmdk on a desktop browser'})).toBeHidden()
 expect(offOrigin(urls),'requests that left the app origin').toEqual([])
 expect(protocol.posts).toEqual([]);expect(protocol.signs).toEqual([]);expect(protocol.broadcasts).toEqual([])
 expect(protocol.walletCalls.filter(method=>!['eth_accounts','eth_chainId'].includes(method)),'wallet prompts on load').toEqual([])
})

test('routes: browser Back moves between S1, S2 and S3; guarded and sandbox routes redirect',async({page,context,protocol})=>{
 const urls=recordRequests(context);await protocol.install(context)
 await page.goto('/#start')
 await page.getByRole('link',{name:'Continue',exact:true}).click()
 await expect(page).toHaveURL(/#settings$/);await expect(page.getByRole('heading',{level:1})).toHaveText('Your protection, in one picture')
 await page.getByRole('link',{name:'Continue to wallet'}).click()
 await expect(page).toHaveURL(/#connect$/);await expect(page.getByRole('heading',{level:1})).toHaveText('Connect MetaMask')
 await page.goBack();await expect(page).toHaveURL(/#settings$/)
 await page.goBack();await expect(page).toHaveURL(/#start$/)
 await page.goForward();await expect(page).toHaveURL(/#settings$/)
 // No wallet, no position, no onboarding record: S4 and S5 redirect to S1.
 for(const hash of ['#position','#progress','#close','#unknown']){await page.goto('/'+hash);await expect(page).toHaveURL(/#start$/)}
 // Sandbox mirrors the routes; close/closed are states of #sandbox/position.
 for(const hash of ['#sandbox/close','#sandbox/closed']){await page.goto('/'+hash);await expect(page).toHaveURL(/#sandbox\/position$/)}
 await expect(page.getByRole('button',{name:'Sandbox wallet · simulated'})).toBeVisible()
 await expect(page.getByRole('link',{name:'cmdk home'})).toHaveAttribute('href','#sandbox/start')
 expect(offOrigin(urls),'requests that left the app origin').toEqual([])
})

test('wallet slot: connect, wrong network, switch, menu and disconnect without network calls',async({page,context,protocol})=>{
 const urls=recordRequests(context);await protocol.install(context,{chain:'0x1'})
 await page.goto('/')
 await page.getByRole('button',{name:'Connect wallet',exact:true}).click()
 const wrong=page.getByRole('button',{name:'0x19E7…ff2A · Switch to Base Sepolia'})
 await expect(wrong).toBeVisible();await expect(page.getByText('Testnet · no real funds',{exact:true})).toBeVisible()
 await wrong.click()
 const slot=page.getByRole('button',{name:'0x19E7…ff2A · Base Sepolia'})
 await expect(slot).toBeVisible();await slot.click()
 const menu=page.getByRole('menu')
 await expect(menu.getByRole('menuitem')).toHaveText(['Copy address','View on BaseScan','Disconnect'])
 await expect(menu.getByRole('menuitem',{name:'View on BaseScan'})).toHaveAttribute('href','https://sepolia.basescan.org/address/0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A')
 await page.keyboard.press('Escape');await expect(menu).toBeHidden()
 await page.goto('/#settings');await slot.click();await page.getByRole('menuitem',{name:'Disconnect'}).click()
 await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible();await expect(page).toHaveURL(/#start$/)
 expect(protocol.walletCalls).toContain('eth_requestAccounts');expect(protocol.walletCalls).toContain('wallet_switchEthereumChain')
 expect(protocol.signs).toEqual([]);expect(protocol.posts).toEqual([])
 expect(offOrigin(urls),'requests that left the app origin').toEqual([])
})

test('desktop gate: below 960px the app is replaced by the notice',async({page,context,protocol})=>{
 const urls=recordRequests(context);await protocol.install(context)
 await page.setViewportSize({width:900,height:900})
 await page.goto('/')
 await expect(page.getByRole('heading',{name:'Open cmdk on a desktop browser'})).toBeVisible()
 await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeHidden()
 await page.setViewportSize({width:1280,height:900})
 await expect(page.getByRole('heading',{name:'Open cmdk on a desktop browser'})).toBeHidden()
 await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible()
 expect(offOrigin(urls),'requests that left the app origin').toEqual([])
})
