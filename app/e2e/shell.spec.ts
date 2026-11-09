import {test,expect,recordHosts} from './guided-fixture.ts'

const APP='localhost:5177',BASE_RPC='base.fixture.test'

test('shell: S1 renders with header, wallet slot and footer; only the app and the Base RPC are contacted',async({page,context,protocol})=>{
 const hosts=recordHosts(context);await protocol.install(context)
 await page.goto('/')
 await expect(page).toHaveURL(/#start$/)
 await expect(page.getByRole('link',{name:'cmdk home'})).toHaveText('⌘K')
 await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible()
 await expect(page.getByText('Testnet · Base Sepolia · no real funds',{exact:true})).toBeVisible()
 await expect(page.getByRole('heading',{level:1})).toHaveText('Borrow USDC against ETH. Keep risk on autopilot.')
 await expect(page.getByRole('contentinfo')).toContainText('Agent protection is risk management, not insurance.')
 await expect(page.getByText('Borrow rate')).toBeVisible()
 // Without a wallet: no NEAR, no relayer, no GitHub; the market read is the only external call.
 expect([...hosts].sort()).toEqual([BASE_RPC,APP].sort())
 expect(protocol.posts).toEqual([]);expect(protocol.signs).toEqual([]);expect(protocol.broadcasts).toEqual([])
 expect(protocol.walletCalls.filter(method=>!['eth_accounts','eth_chainId'].includes(method)),'wallet prompts on load').toEqual([])
})

test('routes: browser Back moves between S1, S2 and S3; guarded and sandbox routes redirect',async({page,context,protocol})=>{
 await protocol.install(context)
 await page.goto('/#start')
 await page.getByLabel('Amount to deposit').fill('0.1')
 await page.getByRole('button',{name:'Continue',exact:true}).click()
 await expect(page).toHaveURL(/#settings$/);await expect(page.getByRole('heading',{level:1})).toHaveText('Your protection, in one picture')
 await page.getByRole('checkbox').check()
 await page.getByRole('button',{name:'Continue to wallet'}).click()
 await expect(page).toHaveURL(/#connect$/);await expect(page.getByRole('heading',{level:1})).toHaveText('Connect MetaMask')
 await page.goBack();await expect(page).toHaveURL(/#settings$/)
 await page.goBack();await expect(page).toHaveURL(/#start$/)
 await expect(page.getByLabel('Amount to deposit')).toHaveValue('0.1')
 await page.goForward();await expect(page).toHaveURL(/#settings$/)
 await expect(page.getByRole('checkbox')).toBeChecked()
 for(const hash of ['#position','#progress','#close','#unknown']){await page.goto('/'+hash);await expect(page).toHaveURL(/#start$/)}
 for(const hash of ['#sandbox/close','#sandbox/closed']){await page.goto('/'+hash);await expect(page).toHaveURL(/#sandbox\/position$/)}
 await expect(page.getByRole('button',{name:'Sandbox wallet · simulated'})).toBeVisible()
 await expect(page.getByRole('link',{name:'cmdk home'})).toHaveAttribute('href','#sandbox/start')
})

test('wallet slot: connect, wrong network, switch, menu and disconnect',async({page,context,protocol})=>{
 await protocol.install(context,{chain:'0x1'})
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
})

test('desktop gate: below 960px the shell is not mounted, so no wallet call or read happens',async({page,context,protocol})=>{
 const hosts=recordHosts(context);await protocol.install(context)
 await page.setViewportSize({width:900,height:900})
 await page.goto('/')
 await expect(page.getByRole('heading',{name:'Open cmdk on a desktop browser'})).toBeVisible()
 await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toHaveCount(0)
 await page.waitForTimeout(500)
 expect(protocol.walletCalls,'no silent reconnect below 960px').toEqual([])
 expect([...hosts]).toEqual([APP])
 await page.setViewportSize({width:1280,height:900})
 await expect(page.getByRole('heading',{name:'Open cmdk on a desktop browser'})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible()
})
