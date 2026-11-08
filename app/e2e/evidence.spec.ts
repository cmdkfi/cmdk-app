import {test,expect} from './fixture.ts'
import type {Page} from '@playwright/test'
async function open(page:Page){await page.goto('/e2e/harness.html');await page.getByRole('button',{name:'Open evidence preview',exact:true}).click();const panel=page.getByRole('dialog',{name:'Verification evidence preview'}).getByRole('region',{name:'Agent evidence and telemetry'});await panel.getByText('Agent activity',{exact:true}).click();await panel.getByText('Evidence',{exact:true}).click();return panel}
async function files(panel:ReturnType<Page['locator']>){await expect(panel.getByRole('list',{name:'Evidence files',exact:true})).toBeVisible()}

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
 protocol.rotateEvidence=true;await panel.getByRole('button',{name:'Check SHA-256 · event_log.json',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('boot or file changed');await expect(panel.getByText(/Hash-checked info.json measurement fields match/)).toHaveCount(0)
 await page.getByRole('button',{name:'Refresh evidence preview',exact:true}).click();await expect(panel.locator('code').filter({hasText:'boot-2000000001-abcdef34'})).toBeVisible();await expect(panel.getByText(/Hash-checked info.json measurement fields match/)).toHaveCount(0)
 expect(protocol.posts).toEqual([])
})

for(const kind of ['hash','vault'] as const)test(`evidence: ${kind} mismatch cannot populate successful snapshot telemetry`,async({context,page,protocol})=>{
 protocol.corruptTranscript=kind==='hash';protocol.wrongTranscriptVault=kind==='vault';await protocol.install(context);const panel=await open(page)
 await expect(panel.getByRole('alert')).toContainText(kind==='hash'?'SHA-256 do not match':'another vault')
 await expect(panel.getByText('Last successful published snapshot',{exact:true})).toHaveCount(0)
 await expect(panel.getByText('Latest published execution attempt',{exact:true})).toHaveCount(0)
 await expect(panel.getByText('Evidence',{exact:true})).toBeVisible()
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
 await page.getByRole('button',{name:'Preview another vault',exact:true}).click();await panel.getByText('Agent activity',{exact:true}).click();await expect(panel.getByText(/Checked 0 of 0/)).toBeVisible()
 await expect(panel.getByText('Last successful published snapshot',{exact:true})).toHaveCount(0);await expect(panel.getByText(/Hash-checked info.json measurement fields match/)).toHaveCount(0)
})


test('verification: concise summary, source failure isolation, responsive drawer and focus return',async({context,page,protocol})=>{
 await protocol.install(context)
 await page.goto('/e2e/harness.html')
 const trigger=page.getByRole('button',{name:'Verification details',exact:true});await trigger.click()
 const drawer=page.getByRole('dialog',{name:'Verification details',exact:true})
 await expect(drawer.getByRole('heading',{name:'Verification',exact:true})).toBeVisible()
 await expect(drawer.getByRole('button',{name:'Close verification details',exact:true})).toBeFocused()
 await expect(drawer.getByRole('definition').filter({hasText:'Registered · unexpired'})).toBeVisible()
 await expect(drawer.getByRole('definition').filter({hasText:'Attempt found · receipts not checked'})).toBeVisible()
 await expect(drawer.getByText('Raw access-key permissions',{exact:true})).not.toBeVisible()
 await expect(drawer.getByText('Last successful published snapshot',{exact:true})).not.toBeVisible()
 await drawer.getByText('Registration',{exact:true}).click()
 await expect(drawer.getByText('Base policy unavailable:',{exact:false})).toBeVisible()
 await expect(drawer.getByRole('definition').filter({hasText:'Registered · unexpired'})).toBeVisible()
 await drawer.getByText('Registration',{exact:true}).click()
 await drawer.getByText('Agent activity',{exact:true}).click()
 await drawer.getByRole('button',{name:'Verify NEAR / Base receipts',exact:true}).click()
 await expect(drawer.getByRole('definition').filter({hasText:'Confirmed · RPC checked'})).toBeVisible()
 const body=drawer.locator('.verification-body'),heading=drawer.locator('.verification-heading')
 const before=await heading.boundingBox();await body.evaluate(el=>{el.scrollTop=el.scrollHeight});const after=await heading.boundingBox()
 expect(after!.y).toBe(before!.y)
 expect(await drawer.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
 await drawer.press('Escape');await expect(drawer).not.toBeVisible();await expect(trigger).toBeFocused()
 expect(protocol.posts).toEqual([]);expect(protocol.signs).toEqual([])
})


test('verification: NEAR outage does not hide published observations and retry preserves checked file evidence',async({context,page,protocol})=>{
 protocol.failNearState=true;await protocol.install(context);await page.goto('/e2e/harness.html')
 await page.getByRole('button',{name:'Verification details',exact:true}).click()
 const drawer=page.getByRole('dialog',{name:'Verification details',exact:true})
 await expect(drawer.getByRole('alert').getByText('NEAR state couldn’t be verified.',{exact:true})).toBeVisible()
 await expect(drawer.getByRole('definition').filter({hasText:'Attempt found · receipts not checked'})).toBeVisible()
 await drawer.getByText('Evidence',{exact:true}).click();await files(drawer)
 await drawer.getByRole('button',{name:'Check SHA-256 · info.json',exact:true}).click()
 await expect(drawer.getByRole('definition').filter({hasText:'1 of 6 SHA-256 matched'})).toBeVisible()
 protocol.failNearState=false;await drawer.getByRole('button',{name:'Retry NEAR state',exact:true}).click()
 await expect(drawer.getByRole('definition').filter({hasText:'Registered · unexpired'})).toBeVisible()
 await expect(drawer.getByRole('definition').filter({hasText:'1 of 6 SHA-256 matched'})).toBeVisible()
 expect(protocol.posts).toEqual([])
})

test('evidence: source-specific retry leaves the other source available',async({context,page,protocol})=>{
 protocol.failEvidenceIndex=true;await protocol.install(context);const panel=await open(page)
 await expect(panel.getByText('Boot evidence unavailable',{exact:true})).toBeVisible()
 await expect(panel.getByText('Last successful published snapshot',{exact:true})).toBeVisible()
 protocol.failEvidenceIndex=false;await panel.getByRole('button',{name:'Retry boot evidence',exact:true}).click()
 await expect(panel.getByText('Evidence files (6)',{exact:true})).toBeVisible()
 await expect(panel.getByText('Last successful published snapshot',{exact:true})).toBeVisible()
 expect(protocol.posts).toEqual([])
})


test('verification: disclosure keyboard controls, link popover and compact header stay independent',async({context,page,protocol})=>{
 await protocol.install(context);await page.goto('/e2e/harness.html');await page.getByRole('button',{name:'Verification details',exact:true}).click()
 const drawer=page.getByRole('dialog',{name:'Verification details',exact:true})
 const registration=drawer.locator('summary').filter({has:page.getByText('Registration',{exact:true})})
 const activity=drawer.locator('summary').filter({has:page.getByText('Agent activity',{exact:true})})
 await registration.focus();await registration.press('Enter');await expect(drawer.getByText('NEAR reports an unexpired agent registration.',{exact:true})).toBeVisible()
 await activity.focus();await activity.press('Space');await expect(drawer.getByText('Last successful published snapshot',{exact:true})).toBeVisible()
 await expect(drawer.getByText('NEAR reports an unexpired agent registration.',{exact:true})).toBeVisible()
 const more=drawer.getByRole('button',{name:'More verification links',exact:true})
 await more.click();const nav=drawer.getByRole('navigation',{name:'Verification links'})
 await expect(nav.getByRole('link',{name:'Open vault in explorer ↗'})).toHaveAttribute('href',/nearblocks.*fixture.testnet/)
 await expect(nav.getByRole('link',{name:'Open transcript index ↗'})).toHaveAttribute('href','https://relayer.fixture.test/agent/transcripts')
 const menuBox=await nav.boundingBox();expect(menuBox!.x).toBeGreaterThanOrEqual(0);expect(menuBox!.x+menuBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
 await more.press('Escape');await expect(nav).not.toBeVisible();await expect(drawer).toBeVisible();await expect(more).toBeFocused()
 await more.click();await drawer.getByRole('heading',{name:'Verification',exact:true}).click();await expect(nav).not.toBeVisible()
 const header=drawer.locator('.verification-heading');expect((await header.boundingBox())!.height).toBeLessThan(180)
 await page.emulateMedia({reducedMotion:'reduce'});await activity.press('Enter');await expect(drawer.getByText('Last successful published snapshot',{exact:true})).not.toBeVisible()
 expect(protocol.posts).toEqual([]);expect(protocol.signs).toEqual([])
})
