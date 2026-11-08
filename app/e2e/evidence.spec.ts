import {test,expect} from './fixture.ts'
import type {Page} from '@playwright/test'
async function open(page:Page){await page.goto('/e2e/harness.html');await page.getByRole('button',{name:'Open evidence preview',exact:true}).click();return page.getByRole('dialog',{name:'Verification evidence preview'}).getByRole('region',{name:'Agent evidence and telemetry'})}
async function files(panel:ReturnType<Page['locator']>){await panel.getByText('Evidence files (6)',{exact:true}).click()}

test('evidence: published boot, key and measurement bindings stay separate from independent RPC execution proof',async({context,page,protocol})=>{
 await protocol.install(context);const panel=await open(page)
 await expect(panel.getByText('Last successful published snapshot',{exact:true})).toBeVisible();await expect(panel.getByText('Current-boot transcript measurement matches the approved measurement and registered agent key.',{exact:true})).toBeVisible()
 await expect(panel.getByText(/Agent reports Base success; receipts not checked/)).toBeVisible()
 await files(panel);await expect(panel.getByText('registration-v2.json',{exact:true})).toHaveCount(0)
 await panel.getByRole('button',{name:'Check SHA-256 · info.json',exact:true}).click();await expect(panel.getByText(/Hash-checked info.json measurement fields match/)).toBeVisible()
 await panel.getByRole('button',{name:'Check SHA-256 · registration-v1.json',exact:true}).click();await expect(panel.getByText('Registration file matches this vault and its saved agent key.',{exact:true})).toBeVisible()
 await panel.getByRole('button',{name:'Verify NEAR / Base receipts',exact:true}).click();await expect(panel.locator('.agent-chain-proof')).toContainText('NEAR confirmed · Base confirmed (2 block confirmations)')
 expect(protocol.posts).toEqual([]);expect(protocol.signs).toEqual([]);expect(protocol.broadcasts).toEqual([])
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.getByRole('dialog',{name:'Verification evidence preview'}).press('Escape');await expect(panel).not.toBeVisible()
})

test('evidence: corrupt file and boot rollover never retain a verified SHA status',async({context,page,protocol})=>{
 protocol.corruptEvidence='info.json';await protocol.install(context);const panel=await open(page);await expect(panel.getByText(/Checked 2 of 2/)).toBeVisible();await files(panel)
 await panel.getByRole('button',{name:'Check SHA-256 · info.json',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('SHA-256 do not match')
 await expect(panel.getByText(/Hash-checked info.json measurement fields match/)).toHaveCount(0)
 protocol.corruptEvidence='';await panel.getByRole('button',{name:'Check SHA-256 · info.json',exact:true}).click();await expect(panel.getByText(/Hash-checked info.json measurement fields match/)).toBeVisible()
 protocol.rotateEvidence=true;await panel.getByRole('button',{name:'Check SHA-256 · event_log.json',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('boot or file changed')
 await page.getByRole('button',{name:'Refresh evidence preview',exact:true}).click();await expect(panel.locator('code').filter({hasText:'boot-2000000001-abcdef34'})).toBeVisible();await expect(panel.getByText(/Hash-checked info.json measurement fields match/)).toHaveCount(0)
 expect(protocol.posts).toEqual([])
})

for(const kind of ['hash','vault'] as const)test(`evidence: ${kind} mismatch cannot populate successful snapshot telemetry`,async({context,page,protocol})=>{
 protocol.corruptTranscript=kind==='hash';protocol.wrongTranscriptVault=kind==='vault';await protocol.install(context);const panel=await open(page)
 await expect(panel.getByRole('alert')).toContainText(kind==='hash'?'SHA-256 do not match':'another vault')
 await expect(panel.getByText('Last successful published snapshot',{exact:true})).toHaveCount(0)
 await expect(panel.getByText('Latest published execution attempt',{exact:true})).toHaveCount(0)
 await expect(panel.getByText('Published boot evidence',{exact:true})).toBeVisible()
})

test('evidence: bounded history scan exposes old attempts and reports actual Base revert despite a success report',async({context,page,protocol})=>{
 protocol.evidenceCount=7;protocol.secondaryError=true;protocol.agentReceiptStatus='0x0';await protocol.install(context);const panel=await open(page)
 await expect(panel.getByText(/Checked 5 of 7/)).toBeVisible();await expect(panel.getByRole('alert')).toContainText('secondary RPC timeout')
 await expect(panel.getByText('Last successful published snapshot',{exact:true})).toBeVisible();await expect(panel.getByText('No sent or NEAR-failed attempt in the 5 checked records.',{exact:true})).toBeVisible()
 await panel.getByRole('button',{name:'Inspect earlier transcripts',exact:true}).click();await expect(panel.getByText(/Checked 7 of 7/)).toBeVisible();await expect(panel.getByText(/Agent reports Base success/)).toBeVisible()
 await panel.getByRole('button',{name:'Verify NEAR / Base receipts',exact:true}).click();await expect(panel.locator('.agent-chain-proof')).toContainText('NEAR confirmed · Base reverted (2 block confirmations)')
 expect(protocol.posts).toEqual([]);expect(protocol.broadcasts).toEqual([])
})

test('evidence: unrelated NEAR call arguments cannot be labelled confirmed',async({context,page,protocol})=>{
 protocol.agentWrongArgs=true;await protocol.install(context);const panel=await open(page);await expect(panel.getByText('Latest published execution attempt',{exact:true})).toBeVisible()
 await panel.getByRole('button',{name:'Verify NEAR / Base receipts',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('arguments do not match')
 await expect(panel.locator('.agent-chain-proof')).toHaveCount(0);expect(protocol.posts).toEqual([])
})

test('evidence: changing selected vault discards the previous snapshot and verified file state',async({context,page,protocol})=>{
 await protocol.install(context);const panel=await open(page);await expect(panel.getByText('Last successful published snapshot',{exact:true})).toBeVisible();await files(panel)
 await panel.getByRole('button',{name:'Check SHA-256 · info.json',exact:true}).click();await expect(panel.getByText(/Hash-checked info.json measurement fields match/)).toBeVisible()
 await page.getByRole('button',{name:'Preview another vault',exact:true}).click();await expect(panel.getByText(/Checked 0 of 0/)).toBeVisible()
 await expect(panel.getByText('Last successful published snapshot',{exact:true})).toHaveCount(0);await expect(panel.getByText(/Hash-checked info.json measurement fields match/)).toHaveCount(0)
})
