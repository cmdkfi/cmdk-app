// The Venue stress card (docs/prd-sandbox-venue-stress.md §6, §7.1): the fixture is the source, verbatim; every recorded
// figure and sentence the card renders equals the fixture and reads verbatim in evidence/scenes/venue-stress.md; the
// sandbox position's own figures use the hero's formatters. The two source files are kept beside the fixture as test
// vectors only (adapters/sandbox/scenes/venue-stress.source.{json,md}, copied from cmdkfi/app at d29a09e; nothing in
// the app imports them).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import scene from '../adapters/sandbox/scenes/venue-stress.json' with { type: 'json' }
import { evidenceUrl, recordedPct, recordedTime, recordedUsdc, recordedWeth, RUN_VENUE, VENUE_CLOSING, VENUE_FINISHED, venueAgentNote, venueCopy } from './venue.ts'
import { formatWadPercent as pc, usdcText as u, wethText as w } from './format.ts'

const SCENES = new URL('../adapters/sandbox/scenes/', import.meta.url)
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
/** cmdkfi/app evidence/scenes/venue-stress.md at d29a09e2183e1bc7ee3cc7cdfee0ccfa4f9151ff (unchanged on main at 31ecee2). */
const MD_SHA256 = '1668beda351439e6639b03e69616f610a39ff014658a6e0254226c3f396cad0d'

const pct = n => BigInt(n) * 10n ** 16n
const E = 10n ** 18n
// the §8a.1 position: 0.5 WETH at $3,210, 802.5 USDC borrowed, LTV 50%, no interest accrued
const START = { collateral: 5n * E / 10n, debt: 802_500_000n, ltv: pct(50) }
const MOVE = { collateralBefore: 5n * E / 10n, collateralAfter: 5n * E / 10n, debtBefore: 802_500_000n, debtAfter: 802_500_000n, interestLive: 22_309_500n, interestBackup: 7_383_000n }
const view = (status, stage) => ({ status, stage, start: status === 'ready' ? null : START, move: stage >= 3 ? MOVE : null, scene })
const text = segs => segs.map(s => (typeof s === 'string' ? s : `**${s.strong}**`)).join('')
const plain = segs => segs.map(s => (typeof s === 'string' ? s : s.strong)).join('')

/** Every value of `part` equals `whole` at the same key; an array element equals some element of the source array. */
function assertSubset(part, whole, path = '$') {
  if (Array.isArray(part)) {
    assert.ok(Array.isArray(whole), `${path} is an array in the source`)
    part.forEach((item, i) => assert.ok(whole.some(candidate => { try { assertSubset(item, candidate); return true } catch { return false } }), `${path}[${i}] is in the source`))
  } else if (part && typeof part === 'object') {
    assert.ok(whole && typeof whole === 'object', `${path} is an object in the source`)
    for (const [key, value] of Object.entries(part)) assertSubset(value, whole[key], `${path}.${key}`)
  } else assert.equal(part, whole, path)
}

test('fixture: the source copy has the recorded SHA-256, and every fixture value equals the source at the same key', async () => {
  const bytes = await readFile(new URL('venue-stress.source.json', SCENES))
  assert.equal(sha256(bytes), scene.source.sha256)
  assert.equal(scene.source.sha256, '06dfdbef7b74ab2f098cfbb0bc24dd5f1e592abe81cb04508a4fc97446c535da')
  assert.deepEqual(scene.source, { repository: 'cmdkfi/app', path: 'evidence/scenes/venue-stress.json', commit: 'd29a09e2183e1bc7ee3cc7cdfee0ccfa4f9151ff', sha256: scene.source.sha256 })
  assert.match(scene._comment, /d29a09e2183e1bc7ee3cc7cdfee0ccfa4f9151ff/)
  const { _comment, source, ...subset } = scene
  assertSubset(subset, JSON.parse(bytes.toString('utf8')))
  assert.equal(sha256(await readFile(new URL('venue-stress.source.md', SCENES))), MD_SHA256)
})

test('recorded figures format exactly as evidence/scenes/venue-stress.md prints them', async () => {
  const md = await readFile(new URL('venue-stress.source.md', SCENES), 'utf8')
  const p = scene.phases
  const row = (label, values) => assert.ok(md.includes(`| ${label} | ${values.join(' | ')} |`), `md row ${label}`)
  row('live utilization', [p.before, p.after_borrow, p.after].map(x => recordedPct(x.markets.live.utilization)))
  row('live borrow APR', [p.before, p.after_borrow, p.after].map(x => recordedPct(x.markets.live.borrow_apr)))
  row('backup utilization', [p.before, p.after_borrow, p.after].map(x => recordedPct(x.markets.backup.utilization)))
  row('backup borrow APR', [p.before, p.after_borrow, p.after].map(x => recordedPct(x.markets.backup.borrow_apr)))
  row('live free liquidity (USDC)', [p.before, p.after_borrow].map(x => recordedUsdc(x.markets.live.free_liquidity_units)).concat(['7.829880']))
  row('backup free liquidity (USDC)', [p.before, p.after_borrow, p.after].map(x => recordedUsdc(x.markets.backup.free_liquidity_units)))
  row('UTC', [p.before, p.after_borrow, p.after].map(x => x.utc))
  const a = scene.actions[0]
  assert.ok(md.includes(`| ${a.block} | ${a.kind} | ${a.by} | ${a.from} -> ${a.to} | fraction ${a.fraction}, debt ${recordedUsdc(a.debt_moved_units)} USDC, collateral ${recordedWeth(a.collateral_moved_wei)} WETH | \`${a.tx}\` |`))
  assert.equal(recordedTime('2026-11-05 19:31:42 UTC'), '19:31:42 UTC')
  assert.equal(recordedTime('2026-11-05T19:31:45Z'), '19:31:45 UTC')
})

test('card: every recorded figure, name, hash and the judge\'s five reasons on the finished card equal the fixture and read verbatim in venue-stress.md', async () => {
  const md = await readFile(new URL('venue-stress.source.md', SCENES), 'utf8')
  const copy = venueCopy(view('done', 3))
  const all = copy.rows.flatMap(r => [...r.event.map(plain), plain(r.without), plain(r.with), ...(r.reasons ?? []), ...(r.recorded ?? []).map(x => x.value)]).join('\n')
  const p = scene.phases
  const t29 = scene.transcripts.find(t => t.name.endsWith('-0029.json')), t32 = scene.transcripts.find(t => t.name.endsWith('-0032.json'))
  const recorded = [
    recordedPct(p.before.markets.live.utilization), recordedPct(p.after_borrow.markets.live.utilization), recordedPct(p.after.markets.live.utilization),
    recordedPct(p.before.markets.live.borrow_apr), recordedPct(p.after_borrow.markets.live.borrow_apr), recordedPct(p.after.markets.live.borrow_apr),
    recordedPct(p.before.markets.backup.utilization), recordedPct(p.after.markets.backup.utilization),
    recordedPct(p.before.markets.backup.borrow_apr), recordedPct(p.after.markets.backup.borrow_apr),
    recordedUsdc(p.before.markets.live.free_liquidity_units), recordedUsdc(p.after_borrow.markets.live.free_liquidity_units), recordedUsdc(p.after.markets.backup.free_liquidity_units),
    recordedWeth(scene.actions[0].collateral_moved_wei), recordedUsdc(scene.actions[0].debt_moved_units), String(scene.actions[0].block), scene.actions[0].tx,
    t29.name, t29.sha256, t32.name, t32.sha256, 'utilization_above_95pct', 'rules only',
    t32.judge.answer.risk, t32.judge.answer.action,
  ]
  // the expected strings are as the md prints them (59.46 %, 0.008335602, …) and as the card shows them
  assert.deepEqual(recorded.slice(0, 13), ['59.46 %', '99.23 %', '39.77 %', '0.55 %', '2.78 %', '0.43 %', '0.00 %', '59.46 %', '0.32 %', '0.92 %', '5.270284', '0.100000', '5.270121'])
  for (const token of recorded) {
    assert.ok(all.includes(token), `card shows ${token}`)
    assert.ok(md.includes(token) || JSON.stringify(scene).includes(token), `${token} is recorded`)
  }
  // times: HH:MM:SS of the md's phase table and transcript table
  for (const time of ['19:31:42', '19:31:45', '19:34:44', '19:35:08']) { assert.ok(all.includes(`${time} UTC`)); assert.ok(md.includes(time)) }
  // 3 min 26 s: the move's block time minus the borrow's (ts 1793907308 − 1793907102)
  assert.equal(p.after.ts - p.after_borrow.ts, 206)
  assert.ok(all.includes('3 min 26 s after the borrow'))
  // the judge's reasons: five, each verbatim in the md's transcript section, in order, no edits
  const reasons = copy.rows.find(r => r.key === 'stage-2').reasons
  assert.equal(reasons.length, 5)
  assert.deepEqual(reasons, t32.judge.answer.reasons)
  for (const reason of reasons) assert.ok(md.includes(`- ${reason}\n`), reason.slice(0, 40))
})

test('card copy per stage: the PRD sentences with the recorded figures; the sandbox position\'s figures as the hero formats them', () => {
  const ready = venueCopy(view('ready', 0))
  assert.deepEqual(ready, { rows: [], summary: null, closing: null, button: RUN_VENUE, finished: null })
  assert.equal(RUN_VENUE, 'Run venue stress')

  const s1 = venueCopy(view('running', 1))
  assert.deepEqual(s1.rows.map(r => r.title), ['Before the borrow', '1 · The market\'s liquidity dries up'])
  assert.equal(text(s1.rows[0].event[0]), 'Live market before: utilization 59.46 %, borrow APR 0.55 %, free liquidity 5.270284 USDC. Backup market: utilization 0.00 %, borrow APR 0.32 %.')
  assert.equal(text(s1.rows[0].without), `Your sandbox position: ${w(START.collateral)} · debt ${u(START.debt)} · LTV ${pc(START.ltv)}, on the live market.`)
  assert.equal(text(s1.rows[0].without), 'Your sandbox position: 0.5 WETH · debt 802.5 USDC · LTV 50%, on the live market.')
  assert.equal(text(s1.rows[0].with), 'Same')
  assert.equal(text(s1.rows[1].event[0]), 'A borrower takes the live market\'s free liquidity: utilization 59.46 % → 99.23 %, borrow APR 0.55 % → 2.78 %, free liquidity 0.100000 USDC (recorded at 19:31:42 UTC). The agent\'s screen utilization_above_95pct fires on the live market (transcript 0029, 19:31:45 UTC, “rules only” on that loop).')
  assert.equal(text(s1.rows[1].without), 'The loan stays on the live market: it now pays 2.78 % APR and nothing can be borrowed there. No price moved, so nothing else happens.')
  assert.equal(text(s1.rows[1].with), 'Same position; the Agent card shows “Screen fired: utilization above 95 %” and “Judge asked”.')
  assert.equal(s1.button, 'Next'); assert.equal(s1.summary, null)

  const s2 = venueCopy(view('running', 2))
  assert.equal(s2.rows[2].title, '2 · The judge decides')
  assert.equal(text(s2.rows[2].event[0]), 'The judge\'s recorded answer (transcript 0032, 19:34:44 UTC): risk **elevated**, action **leave_market**, market **live**.')
  assert.deepEqual(s2.rows[2].recorded, [{ label: 'Transcript', value: 'boot-1793877578-a405e917-v1-0032.json' }, { label: 'SHA-256', value: '716815b41911c0fd9174e350758e1dd8517237fbe1b34cbe8401f83936db88d5' }])
  assert.equal(text(s2.rows[2].without), 'Unchanged.')
  assert.equal(text(s2.rows[2].with), 'Unchanged; the Agent card shows “Judge: leave_market (elevated) · migrate to backup chosen”.')
  assert.equal(s2.button, 'Next')

  const s3 = venueCopy(view('running', 3))
  const r3 = s3.rows[3]
  assert.equal(r3.title, '3 · The agent moves the loan')
  assert.equal(text(r3.event[0]), 'The agent\'s migrate, recorded in Base block 54927197 (19:35:08 UTC, 3 min 26 s after the borrow): fraction 100 %, collateral moved 0.008335602 WETH, debt moved 7.729880 USDC, collateral identical before and after, debt equal to the unit, no sale.')
  assert.equal(text(r3.event[1]), 'Your sandbox position moves to the backup market with its own figures: collateral 0.5 WETH before and 0.5 WETH after, debt 802.5 USDC before and 802.5 USDC after, no sale. A Migrated row appears in Recent actions, and the hero reads “Market: backup”.')
  assert.equal(text(r3.event[2]), 'After the move, the recorded markets: live utilization 39.77 %, APR 0.43 %; backup utilization 59.46 %, APR 0.92 %.')
  assert.deepEqual(r3.recorded, [{ label: 'Base transaction', value: '0xd597c4328634bdc7019621a18a5acd11f379ec9fb2e1430179894b7c211542dd' }])
  assert.equal(text(r3.without), 'The loan stays on live at 2.78 % APR.')
  assert.equal(text(r3.with), 'The loan sits on backup at 0.92 % APR with 5.270121 USDC of free liquidity beside it.')
  // computed by the engine from the position's debt and the recorded APRs; dollars in the hero's format (truncated to
  // cents, trailing zeros dropped, as the crash card's "$1,765.5"). The PRD's "$22.31 and $7.38" for this debt is
  // approximate prose: 802.5 × 2.78 % = 22.3095.
  assert.equal(text(s3.summary), 'Interest on your debt for a year: **$22.3 at 2.78 % if nothing acts, $7.38 at 0.92 % after the move**.')
  assert.equal(s3.closing, VENUE_CLOSING)
  assert.equal(VENUE_CLOSING, 'The price never moved; the corridor\'s protective rule had nothing to do. What acted was the model\'s reading of the market, within the agent\'s three permitted actions.')
  assert.equal(s3.button, 'Done'); assert.equal(s3.finished, null)

  const done = venueCopy(view('done', 3))
  assert.equal(done.button, null)
  assert.equal(done.finished, VENUE_FINISHED)
  assert.equal(VENUE_FINISHED, 'Venue stress replayed · loan on the backup market')
  assert.equal(done.rows.length, 4)
})

test('honesty (§4): "a borrower", no claim of danger, no production claim; the one link is the evidence file at the source commit', () => {
  const all = venueCopy(view('done', 3)).rows.flatMap(r => [...r.event.map(plain), plain(r.without), plain(r.with)]).join(' ')
  assert.ok(all.includes('A borrower takes'))
  for (const word of [/liquidat/i, /danger/i, /guarantee/i, /never liquidated/i, /audited/i, /production/i, /profit/i, /test wallet/i, /team/i]) assert.doesNotMatch(all, word)
  assert.equal(evidenceUrl(scene), 'https://github.com/cmdkfi/app/blob/d29a09e2183e1bc7ee3cc7cdfee0ccfa4f9151ff/evidence/scenes/venue-stress.md')
})

test('Agent card note: the fired screen at stage 1, the judge\'s answer from stage 2', () => {
  assert.equal(venueAgentNote(null), null)
  assert.equal(venueAgentNote(view('ready', 0)), null)
  assert.equal(venueAgentNote(view('running', 1)), 'Screen fired: utilization above 95 % · Judge asked')
  assert.equal(venueAgentNote(view('running', 2)), 'Judge: leave_market (elevated) · migrate to backup chosen')
  assert.equal(venueAgentNote(view('done', 3)), 'Judge: leave_market (elevated) · migrate to backup chosen')
})
