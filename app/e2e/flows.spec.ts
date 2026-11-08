import {test,expect,OWNER,OTHER,KEY,LIVE,BACKUP} from './fixture.ts'
import type {Page} from '@playwright/test'
async function connect(page:Page){await page.locator('.wallet-option').filter({hasText:'MetaMask'}).click();await expect(page.getByText(OWNER,{exact:true})).toBeVisible()}
async function rules(page:Page){await page.getByRole('button',{name:'Edit rules',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Edit rules',exact:true});await expect(dialog.getByLabel('Target LTV (%)')).toHaveValue('50.0');return dialog}
async function pending(page:Page){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'null'),KEY)}
async function cancellation(page:Page){await page.getByText('Held transaction cancellation',{exact:true}).click();return page.locator('.held-cancellation')}

test('wallet: rejected connection can retry, then disconnect through the production app',async({context,page,protocol})=>{
 await protocol.install(context,{rejectConnect:true});await page.goto('/#connect')
 await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click()
 const dialog=page.getByRole('dialog',{name:'Wallet connection'})
 await dialog.locator('.wallet-option').filter({hasText:'MetaMask'}).click()
 await expect(dialog.getByRole('alert')).toContainText('cancelled')
 await dialog.locator('.wallet-option').filter({hasText:'MetaMask'}).click()
 await expect(page.getByText('No vault belongs to this address yet.')).toBeVisible()
 await expect(dialog).not.toBeVisible()
 await page.locator('.vault-header-actions button').click();await expect(dialog.getByText(OWNER,{exact:true})).toBeVisible()
 await dialog.getByRole('button',{name:'Disconnect',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Connect to find your vaults'})).toBeVisible()
 expect(protocol.signs).toEqual([]);expect(protocol.posts).toEqual([])
})

test('wallet: network switch and account change update the actual wallet component',async({context,page,protocol})=>{
 await protocol.install(context,{chain:'0x1'});await page.goto('/e2e/harness.html');await connect(page)
 await page.getByRole('button',{name:'Switch to Base Sepolia',exact:true}).click()
 await expect(page.locator('.wallet-details')).toContainText('Base Sepolia')
 await page.evaluate(other=>window.fixtureWallet.changeAccount(other),OTHER)
 await expect(page.getByText(OTHER,{exact:true})).toBeVisible();await expect(page.getByText(OWNER,{exact:true})).not.toBeVisible()
 expect(protocol.signs).toEqual([]);expect(protocol.posts).toEqual([])
})

test('wallet: contract account cannot reach vault creation through discovery',async({context,page,protocol})=>{
 protocol.contractWallet=true;await protocol.install(context);await page.goto('/#connect');await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click();await connect(page)
 await expect(page.getByText('This account type is not supported yet. Connect another wallet.')).toBeVisible()
 await expect(page.getByRole('link',{name:/Create vault/})).toHaveCount(0)
 expect(protocol.posts).toEqual([])
})

test('rules: shared edit preserves each market floor and permissions and posts the exact signed bytes once',async({context,page,protocol})=>{
 await protocol.install(context);await page.goto('/e2e/harness.html');await connect(page)
 const dialog=await rules(page);await expect(dialog.getByRole('checkbox')).not.toBeChecked();await dialog.getByRole('checkbox').check()
 await dialog.getByLabel('Target LTV (%)').fill('55.0');await dialog.getByLabel('Trigger line (%)').fill('75.0');await dialog.getByLabel('Daily budget (%)').fill('25.0')
 await dialog.getByRole('button',{name:'Review and sign rules'}).click();await expect(dialog.getByRole('status')).toContainText('Submitted')
 expect(protocol.posts).toHaveLength(1);expect(protocol.signs).toHaveLength(1);expect(protocol.posts[0].message).toBe(protocol.signs[0])
 const intent=JSON.parse(protocol.posts[0].message);expect(intent).toMatchObject({network:'testnet',method:'setup',nonce:4,args:{measurement:null}})
 expect(intent.args.markets.map((m:{market:string})=>m.market)).toEqual([LIVE,BACKUP])
 expect(intent.args.markets[0]).toMatchObject({approve:false,authorize:false,corridor:{floor:'300000000000000000',target:'550000000000000000',sell_budget:'250000000000000000',migrate_allowed:true,exit_allowed:true}})
 expect(intent.args.markets[1].corridor).toMatchObject({floor:'250000000000000000',migrate_allowed:false,exit_allowed:false})
 expect((await pending(page)).rules.updates).toHaveLength(2)
 protocol.confirmRules();protocol.corridors.get(LIVE)![0]=560000000000000000n
 await dialog.getByRole('button',{name:'Check confirmation',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Stored rules differ');expect(await pending(page)).not.toBeNull()
 protocol.corridors.get(LIVE)![0]=550000000000000000n
 await dialog.getByRole('button',{name:'Check confirmation',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Confirmed on Base')
 await expect(dialog.getByLabel('Target LTV (%)')).toHaveValue('55.0');expect(await pending(page)).toBeNull();expect(protocol.posts).toHaveLength(1)
})

test('rules: no-op, invalid corridor and rejected signature never create a pending POST',async({context,page,protocol})=>{
 await protocol.install(context);await page.goto('/e2e/harness.html');await connect(page);const dialog=await rules(page)
 await dialog.getByRole('button',{name:'Review and sign rules'}).click();await expect(dialog.getByRole('status')).toContainText('No changes')
 await dialog.getByLabel('Target LTV (%)').fill('80.0');await dialog.getByRole('button',{name:'Review and sign rules'}).click();await expect(dialog.getByRole('status')).toContainText('Require Floor')
 await dialog.getByLabel('Target LTV (%)').fill('55.0');await page.evaluate(()=>{window.fixtureWallet.rejectSign=true});await dialog.getByRole('button',{name:'Review and sign rules'}).click();await expect(dialog.getByRole('status')).toContainText(/rejected/i)
 expect(protocol.signs).toEqual([]);expect(protocol.posts).toEqual([]);expect(await pending(page)).toBeNull()
})

test('rules: nonce changing during signature fails closed before relayer submission',async({context,page,protocol})=>{
 await protocol.install(context);await page.goto('/e2e/harness.html');await connect(page);const dialog=await rules(page)
 protocol.onSign=()=>{protocol.ownerNonce=4}
 await dialog.getByLabel('Target LTV (%)').fill('55.0');await dialog.getByRole('button',{name:'Review and sign rules'}).click();await expect(dialog.getByRole('status')).toContainText('nonce changed')
 expect(protocol.signs).toHaveLength(1);expect(protocol.posts).toEqual([]);expect(await pending(page)).toBeNull()
})

test('rules: account changing while signing cannot submit the old owner intent',async({context,page,protocol})=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});protocol.onSign=()=>gate
 await protocol.install(context);await page.goto('/e2e/harness.html');await connect(page);const dialog=await rules(page)
 await dialog.getByLabel('Target LTV (%)').fill('55.0');await dialog.getByRole('button',{name:'Review and sign rules'}).click();await expect.poll(()=>protocol.signs.length).toBe(1)
 await page.evaluate(other=>window.fixtureWallet.changeAccount(other),OTHER);await expect(page.getByText(OTHER,{exact:true})).toBeVisible();release()
 await expect(dialog.getByRole('status')).toContainText('Wallet or vault changed')
 expect(protocol.posts).toEqual([]);expect(await pending(page)).toBeNull()
})

test('recovery: one cancellation retains a held suffix; reload and second cancellation reconcile the batch',async({context,page,protocol})=>{
 await protocol.install(context,{pending:true});await page.goto('/e2e/harness.html');await connect(page);let panel=await cancellation(page)
 await panel.getByRole('button',{name:'Inspect held calls',exact:true}).click();await expect(panel.getByRole('heading',{name:'Review one cancellation'})).toBeFocused()
 await panel.getByRole('button',{name:'Sign one cancellation'}).click();await expect(panel.getByRole('status')).toContainText('Cancellation submitted')
 expect((await pending(page)).message).toBe(protocol.originalMessage);expect((await pending(page)).cancellation.job).toBeDefined()
 await page.getByRole('button',{name:'Check transaction status',exact:true}).click();await expect(page.locator('.live-actions').last().getByRole('status')).toContainText('cancellation is pending')
 expect(protocol.broadcasts).toEqual([])
 await page.reload();await connect(page);panel=await cancellation(page);await expect(panel.getByRole('status')).toContainText('persisted')
 protocol.finishCancel=true;protocol.confirmed=9;protocol.pending=9
 await panel.getByRole('button',{name:'Check cancellation',exact:true}).click();await expect(panel.getByRole('status')).toContainText('further held nonces remain')
 expect((await pending(page)).message).toBe(protocol.originalMessage);expect((await pending(page)).cancellation).toBeUndefined()
 await panel.getByRole('button',{name:'Inspect held calls',exact:true}).click();await panel.getByRole('button',{name:'Sign one cancellation'}).click();await expect(panel.getByRole('status')).toHaveText('Cancellation submitted. Check confirmation; do not repeat the signature.')
 expect((await pending(page)).cancellation).toBeDefined();protocol.confirmed=10;protocol.pending=10
 await panel.getByRole('button',{name:'Check cancellation',exact:true}).click();await expect(panel.getByRole('status')).toContainText('All original Base nonces are consumed')
 expect(await pending(page)).toBeNull();expect(protocol.posts).toHaveLength(2);expect(protocol.signs).toHaveLength(2)
 const evidence=await page.evaluate(key=>JSON.parse(localStorage.getItem(`${key}:cancel-evidence:3`)!),KEY);expect(evidence.original.message).toBe(protocol.originalMessage);expect(evidence.confirmations).toHaveLength(2)
})

test('recovery: lost cancellation response stays locked and recovers only from its exact NEAR evidence',async({context,page,protocol})=>{
 protocol.losePost=true;await protocol.install(context,{pending:true});await page.goto('/e2e/harness.html');await connect(page);const panel=await cancellation(page)
 await panel.getByRole('button',{name:'Inspect held calls',exact:true}).click();await panel.getByRole('button',{name:'Sign one cancellation'}).click();await expect(panel.getByRole('status')).toContainText('did not confirm')
 expect((await pending(page)).cancellation.job).toBeUndefined()
 await panel.getByRole('button',{name:'Check cancellation',exact:true}).click();await expect(panel.getByRole('status')).toContainText('uncertain')
 protocol.finishCancel=true;protocol.confirmed=9;protocol.pending=9
 await panel.getByLabel('Cancellation NEAR hash').fill('1'.repeat(44));await panel.getByRole('button',{name:'Check cancellation',exact:true}).click();await expect(panel.getByRole('status')).toContainText('does not match')
 expect((await pending(page)).cancellation).toBeDefined()
 await panel.getByLabel('Cancellation NEAR hash').fill(protocol.lastCancelNear);await panel.getByRole('button',{name:'Check cancellation',exact:true}).click();await expect(panel.getByRole('status')).toContainText('further held nonces remain')
 expect(protocol.posts).toHaveLength(1);expect(protocol.signs).toHaveLength(1)
})

test('recovery: pending Base nonce prevents a cancellation signature',async({context,page,protocol})=>{
 protocol.pending=9;await protocol.install(context,{pending:true});await page.goto('/e2e/harness.html');await connect(page);const panel=await cancellation(page)
 await panel.getByRole('button',{name:'Inspect held calls',exact:true}).click();await expect(panel.getByRole('status')).toContainText('pending or confirming')
 await expect(panel.getByRole('button',{name:'Sign one cancellation'})).toHaveCount(0);expect(protocol.signs).toEqual([]);expect(protocol.posts).toEqual([])
 expect((await pending(page)).message).toBe(protocol.originalMessage)
})

test('rules: persisted recovery blocks editing, Escape closes drawer, mobile has no overflow',async({context,page,protocol})=>{
 await protocol.install(context,{pending:true});await page.goto('/e2e/harness.html');await connect(page);const dialog=await rules(page)
 await dialog.getByLabel('Target LTV (%)').fill('55.0');await dialog.getByRole('button',{name:'Review and sign rules'}).click();await expect(dialog.getByRole('status')).toContainText('vault action is pending')
 await dialog.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'Edit rules',exact:true})).toBeFocused()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 expect(protocol.signs).toEqual([]);expect(protocol.posts).toEqual([])
})


test('recovery: missing cancellation receipt permits only explicit rebroadcast of its verified self-transfer',async({context,page,protocol})=>{
 await protocol.install(context,{pending:true});await page.goto('/e2e/harness.html');await connect(page);const panel=await cancellation(page)
 await panel.getByRole('button',{name:'Inspect held calls',exact:true}).click();await panel.getByRole('button',{name:'Sign one cancellation'}).click();await expect(panel.getByRole('status')).toContainText('Cancellation submitted')
 await panel.getByRole('button',{name:'Check cancellation',exact:true}).click();await expect(panel.getByRole('button',{name:'Broadcast verified cancellation'})).toBeVisible();expect(protocol.broadcasts).toEqual([])
 await panel.getByRole('button',{name:'Broadcast verified cancellation'}).click();await expect(panel.getByRole('status')).toContainText('Existing cancellation broadcast')
 expect(protocol.broadcasts).toEqual([protocol.lastCancel!.raw]);expect(protocol.posts).toHaveLength(1);expect(protocol.signs).toHaveLength(1)
 expect((await pending(page)).message).toBe(protocol.originalMessage)
})


test('rules: corridor changing during signature never overwrites the newer on-chain Floor',async({context,page,protocol})=>{
 await protocol.install(context);await page.goto('/e2e/harness.html');await connect(page);const dialog=await rules(page)
 protocol.onSign=()=>{protocol.corridors.get(LIVE)![2]=350000000000000000n}
 await dialog.getByLabel('Target LTV (%)').fill('55.0');await dialog.getByRole('button',{name:'Review and sign rules'}).click();await expect(dialog.getByRole('status')).toContainText('Rules changed while signing')
 expect(protocol.posts).toEqual([]);expect(protocol.signs).toHaveLength(1);expect(await pending(page)).toBeNull()
})

test('recovery: a confirmed direct revert releases only its own lock and survives reload',async({context,page,protocol})=>{
 await protocol.install(context,{directRevert:true});await page.goto('/e2e/harness.html');await connect(page)
 const actions=page.locator('.live-actions').last();await actions.getByRole('button',{name:'Check transaction status',exact:true}).click()
 await expect(actions.getByRole('status')).toContainText('Transaction reverted. No position change was applied.');expect(await pending(page)).toBeNull()
 await page.reload();await connect(page);expect(await pending(page)).toBeNull()
 await expect(page.getByRole('button',{name:'Check transaction status',exact:true})).toHaveCount(0)
 expect(protocol.posts).toEqual([]);expect(protocol.signs).toEqual([]);expect(protocol.broadcasts).toEqual([])
})
