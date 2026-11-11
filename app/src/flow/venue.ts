// The sandbox's Venue stress card (docs/prd-sandbox-venue-stress.md): its copy, built from the engine's view. The
// sentences are the PRD's (§1, §2, §4). Two kinds of figures:
// - recorded ones (market utilization, APRs, free liquidity, times, block, amounts moved, transcript names and hashes,
//   the judge's answer) come from the scene fixture (adapters/sandbox/scenes/venue-stress.json, verbatim from
//   cmdkfi/app evidence/scenes/venue-stress.json) and are formatted exactly as evidence/scenes/venue-stress.md prints
//   them (scripts/venue_stress.py l.193-195: '%.2f %%', '%.6f' USDC, '%.9f' WETH), so each reads verbatim as recorded;
// - the sandbox position's own (collateral, debt, LTV, interest) use the hero's formatters (flow/format.ts), so one
//   quantity never reads differently on S5, and are labelled as the sandbox position's.
import type { VenueScene, VenueTranscript, VenueView } from '../adapters/types.ts'
import type { Seg } from './crash.ts'
import { dollarText, formatWadPercent, usdcText, wethText } from './format.ts'

export const VENUE_TITLE = 'Venue stress'
export const VENUE_INTRO = 'See what happens when the market, not the price, goes wrong. Replay of a recorded testnet event (5 Nov 2026): the live market\'s liquidity is drained, the agent\'s judge decides, and the agent moves the loan. Your sandbox position plays the part of vault v1.'
/** §4: said once, under the title, around the one static link to the evidence file. */
export const VENUE_REPLAY_BEFORE = 'Replay of the 5 Nov 2026 testnet event ('
export const VENUE_REPLAY_AFTER = '). Market figures, the judge\'s answer and the timings are the recorded ones; the position is your sandbox position.'
export const RUN_VENUE = 'Run venue stress'
export const VENUE_WITHOUT_NOTE = 'What the loan looks like if nothing acts; a calculation'
export const VENUE_REASONS_LABEL = 'The judge\'s recorded reasons for vault v1'
export const VENUE_CLOSING = 'The price never moved; the corridor\'s protective rule had nothing to do. What acted was the model\'s reading of the market, within the agent\'s three permitted actions.'
export const VENUE_FINISHED = 'Venue stress replayed · loan on the backup market'
export const RECORDED = 'recorded'

/** Recorded figures, formatted as evidence/scenes/venue-stress.md prints them (scripts/venue_stress.py l.193-195). */
export const recordedPct = (x: number): string => `${(100 * x).toFixed(2)} %`
export const recordedUsdc = (units: string): string => (Number(units) / 1e6).toFixed(6)
export const recordedWeth = (wei: string): string => (Number(wei) / 1e18).toFixed(9)
/** "2026-11-05 19:31:42 UTC" or "2026-11-05T19:31:45Z" → "19:31:42 UTC". */
export const recordedTime = (utc: string): string => `${utc.replace('T', ' ').slice(11, 19)} UTC`
/** The loop number of a transcript name, as the PRD names it ("transcript 0029"). */
const loop = (t: VenueTranscript) => t.name.replace(/\.json$/, '').split('-').pop() ?? t.name
const minutes = (secs: number) => `${Math.floor(secs / 60)} min ${secs % 60} s`

/** The evidence file on GitHub, at the commit the fixture was copied from (§4: one static link, no live read). */
export const evidenceUrl = (scene: VenueScene): string => `https://github.com/${scene.source.repository}/blob/${scene.source.commit}/${scene.source.path.replace(/\.json$/, '.md')}`

export type VenueRecord = { label: string; value: string }
export type VenueRow = {
  key: string
  title: string
  /** What the user sees: the recorded event, one paragraph per entry. */
  event: Seg[][]
  /** Stage 2: the judge's five reasons, verbatim. */
  reasons?: string[]
  /** Transcript names, hashes and the transaction, as text tagged "recorded". */
  recorded?: VenueRecord[]
  without: Seg[]
  with: Seg[]
}
export type VenueCopy = { rows: VenueRow[]; summary: Seg[] | null; closing: string | null; button: string | null; finished: string | null }

const transcript = (scene: VenueScene, n: string) => {
  const t = scene.transcripts.find(x => x.name.endsWith(`-${n}.json`))
  if (!t) throw new Error(`The scene has no transcript ${n}.`)
  return t
}

export function venueCopy(view: VenueView): VenueCopy {
  const { scene, start } = view
  if (view.status === 'ready' || !start) return { rows: [], summary: null, closing: null, button: RUN_VENUE, finished: null }
  const p = scene.phases, b = p.before.markets, ab = p.after_borrow.markets, af = p.after.markets
  const screened = transcript(scene, '0029'), judged = transcript(scene, '0032')
  const answer = judged.judge!.answer
  const move = scene.actions[0]
  const rows: VenueRow[] = [{
    key: 'reference', title: 'Before the borrow',
    event: [
      [`Live market before: utilization ${recordedPct(b.live.utilization)}, borrow APR ${recordedPct(b.live.borrow_apr)}, free liquidity ${recordedUsdc(b.live.free_liquidity_units)} USDC. Backup market: utilization ${recordedPct(b.backup.utilization)}, borrow APR ${recordedPct(b.backup.borrow_apr)}.`],
    ],
    without: [`Your sandbox position: ${wethText(start.collateral)} · debt ${usdcText(start.debt)} · LTV ${start.ltv === null ? 'unbounded' : formatWadPercent(start.ltv)}, on the live market.`],
    with: ['Same'],
  }]
  if (view.stage >= 1) rows.push({
    key: 'stage-1', title: '1 · The market\'s liquidity dries up',
    event: [[
      `A borrower takes the live market's free liquidity: utilization ${recordedPct(b.live.utilization)} → ${recordedPct(ab.live.utilization)}, borrow APR ${recordedPct(b.live.borrow_apr)} → ${recordedPct(ab.live.borrow_apr)}, free liquidity ${recordedUsdc(ab.live.free_liquidity_units)} USDC (recorded at ${recordedTime(p.after_borrow.utc)}). `,
      `The agent's screen ${screened.screens[0].replace(/^live:/, '')} fires on the live market (transcript ${loop(screened)}, ${recordedTime(screened.time_utc)}, “rules only” on that loop).`,
    ]],
    recorded: [{ label: 'Transcript', value: screened.name }, { label: 'SHA-256', value: screened.sha256 }],
    without: [`The loan stays on the live market: it now pays ${recordedPct(ab.live.borrow_apr)} APR and nothing can be borrowed there. No price moved, so nothing else happens.`],
    with: ['Same position; the Agent card shows “Screen fired: utilization above 95 %” and “Judge asked”.'],
  })
  if (view.stage >= 2) rows.push({
    key: 'stage-2', title: '2 · The judge decides',
    event: [[`The judge's recorded answer (transcript ${loop(judged)}, ${recordedTime(judged.time_utc)}): risk `, { strong: answer.risk }, ', action ', { strong: answer.action }, ', market ', { strong: answer.market }, '.']],
    reasons: answer.reasons,
    recorded: [{ label: 'Transcript', value: judged.name }, { label: 'SHA-256', value: judged.sha256 }],
    without: ['Unchanged.'],
    with: [`Unchanged; the Agent card shows “${venueAgentNote(view)!}”.`],
  })
  const m = view.move
  if (view.stage >= 3 && m) rows.push({
    key: 'stage-3', title: '3 · The agent moves the loan',
    event: [
      [`The agent's ${move.kind}, recorded in Base block ${move.block} (${recordedTime(p.after.utc)}, ${minutes(p.after.ts - p.after_borrow.ts)} after the borrow): fraction ${Number(BigInt(move.fraction) * 100n / 10n ** 18n)} %, collateral moved ${recordedWeth(move.collateral_moved_wei)} WETH, debt moved ${recordedUsdc(move.debt_moved_units)} USDC${scene.comparison.collateral_identical ? ', collateral identical before and after' : ''}${scene.comparison.debt_equal && scene.comparison.debt_equal_within_units === 1 ? ', debt equal to the unit' : ''}, no sale.`],
      [`Your sandbox position moves to the backup market with its own figures: collateral ${wethText(m.collateralBefore)} before and ${wethText(m.collateralAfter)} after, debt ${usdcText(m.debtBefore)} before and ${usdcText(m.debtAfter)} after, no sale. A Migrated row appears in Recent actions, and the hero reads “Market: backup”.`],
      [`After the move, the recorded markets: live utilization ${recordedPct(af.live.utilization)}, APR ${recordedPct(af.live.borrow_apr)}; backup utilization ${recordedPct(af.backup.utilization)}, APR ${recordedPct(af.backup.borrow_apr)}.`],
    ],
    recorded: [{ label: 'Base transaction', value: move.tx }],
    without: [`The loan stays on live at ${recordedPct(ab.live.borrow_apr)} APR.`],
    with: [`The loan sits on backup at ${recordedPct(af.backup.borrow_apr)} APR with ${recordedUsdc(af.backup.free_liquidity_units)} USDC of free liquidity beside it.`],
  })
  const summary: Seg[] | null = m && view.stage >= 3
    ? ['Interest on your debt for a year: ', { strong: `${dollarText(m.interestLive)} at ${recordedPct(ab.live.borrow_apr)} if nothing acts, ${dollarText(m.interestBackup)} at ${recordedPct(af.backup.borrow_apr)} after the move` }, '.']
    : null
  return {
    rows, summary, closing: summary ? VENUE_CLOSING : null,
    button: view.status === 'done' ? null : view.stage === 3 ? 'Done' : 'Next',
    finished: view.status === 'done' ? VENUE_FINISHED : null,
  }
}

/** What the Agent card shows during the scene (§2): the fired screen at stage 1, the judge's answer from stage 2. */
export function venueAgentNote(view: VenueView | null | undefined): string | null {
  if (!view || view.status === 'ready' || view.stage === 0) return null
  if (view.stage === 1) return 'Screen fired: utilization above 95 % · Judge asked'
  const answer = transcript(view.scene, '0032').judge!.answer
  return `Judge: ${answer.action} (${answer.risk}) · migrate to ${view.scene.destination} chosen`
}
