// The sandbox's Market crash card (PRD §8a.1, Phase 11): its copy, built from the engine's figures (CrashView). The
// sentences are §8a.1's; every number comes from the view and is formatted exactly as the hero and Recent actions
// format it (flow/format.ts: truncated, same decimals), so one quantity never reads differently on S5. The figures
// printed in §8a.1 are approximate prose (product owner, 11 Nov).
import type { CrashStage, CrashView } from '../adapters/types.ts'
import { dollarText, formatUnits, formatWadPercent, usdcText, wethText } from './format.ts'

/** A sentence part; `strong` parts are bold (§8a.1 bolds "You keep …", "… is yours." and the summary figures). */
export type Seg = string | { strong: string }
export type CrashRow = { key: string; title: string; price: string; without: Seg[]; with: Seg[] }
export type CrashCopy = {
  rows: CrashRow[]
  summary: Seg[] | null
  /** The one button, or null once the run is finished. */
  button: string | null
  finished: string | null
}

export const CRASH_INTRO = 'See what happens in a crash. The price of ETH falls 45% and recovers; compare your position with and without the agent.'
export const CRASH_SCRIPTED = 'Scripted price path; numbers are illustrative.'
export const RUN_CRASH = 'Run market crash'
export const WITHOUT_HEAD = 'Without the agent'
export const WITHOUT_NOTE = 'Calculation: what Morpho would have done'
export const WITH_HEAD = 'With the agent'
export const WITH_NOTE = 'Your sandbox position'
const NEXT = ['Next: the price keeps falling', 'Next: the price recovers', 'Done']

const weth = wethText
const usdc = usdcText
const dollars = dollarText
const pct = (wad: bigint | null) => (wad === null ? 'unbounded' : formatWadPercent(wad))

/** Oracle price (1e36 scale; 6-decimal loan, 18-decimal collateral) as the dollar value of one ETH, formatted as the hero's values. */
export const priceText = (price: bigint): string => dollarText(price / 10n ** 18n)

function stageTitle(s: CrashStage, start: bigint): string {
  if (s.price >= start) return `${s.index} · The price recovers to ${priceText(s.price)}`
  const fall = Number((start - s.price) * 100n / start)
  return s.index === 1 ? `${s.index} · The price falls ${fall}%` : `${s.index} · The price falls further, ${fall}% in total`
}

function withoutText(s: CrashStage, view: CrashView, start: bigint): Seg[] {
  const w = s.without, liq = w.liquidation
  if (liq) {
    return [
      `LTV ${pct(liq.ltvBefore)}, above the ${pct(view.lltv)} liquidation line. A liquidator repays the whole ${usdc(liq.repaid)} debt and takes ${weth(liq.seized)} (debt × ${formatUnits(view.liquidationIncentive, 18, 4)}, Morpho's liquidation incentive at ${pct(view.lltv)} LLTV). `,
      { strong: `You keep ${weth(w.collateral)} (${dollars(w.value)}).` },
    ]
  }
  if (w.liquidatedEarlier) return [`You hold ${weth(w.collateral)} (${dollars(w.value)}).${s.price >= start ? ' The recovery does not help: the collateral is gone.' : ''}`]
  return [`LTV ${pct(w.ltv)}. Nothing happens; the position waits for the market.`]
}

function withText(s: CrashStage, view: CrashView, start: bigint): Seg[] {
  const w = s.with, r = w.reduce
  if (r) return [`LTV crosses ${pct(view.act)}: the agent sells ${weth(r.sold)} at ${priceText(s.price)} to repay ${usdc(r.repaid)}. Collateral ${weth(w.collateral)}, debt ${usdc(w.debt)}, LTV ${pct(w.ltv)}. A Reduced row appears in Recent actions.`]
  if (s.price >= start) return [`${weth(w.collateral)} (${dollars(w.value)}) against ${usdc(w.debt)} of debt: `, { strong: `${dollars(w.value - w.debt)} of collateral value is yours.` }]
  return [`LTV ${pct(w.ltv)}, below the ${pct(view.act)} line: no action. Collateral ${weth(w.collateral)}, debt ${usdc(w.debt)}.`]
}

export function crashCopy(view: CrashView): CrashCopy {
  const start = view.start
  if (view.status === 'ready' || !start) return { rows: [], summary: null, button: RUN_CRASH, finished: null }
  const rows: CrashRow[] = [{
    key: 'open', title: 'Open', price: priceText(start.price),
    without: [`${weth(start.collateral)} (${dollars(start.value)}) · debt ${usdc(start.debt)} · LTV ${pct(start.ltv)} · ${usdc(start.borrowed)} in your wallet`],
    with: ['Same'],
  }]
  for (const s of view.stages) rows.push({ key: `stage-${s.index}`, title: stageTitle(s, start.price), price: priceText(s.price), without: withoutText(s, view, start.price), with: withText(s, view, start.price) })
  const last = view.stages[view.stages.length - 1]
  const summary: Seg[] | null = view.stages.length === 3 && last.price >= start.price
    ? ['Collateral value net of debt after the crash: ', { strong: `${dollars(last.with.value - last.with.debt)} with the agent, ${dollars(last.without.value - last.without.debt)} without` }, `. Both keep the ${usdc(start.borrowed)} borrowed at open.`]
    : null
  return {
    rows, summary,
    button: view.status === 'done' ? null : NEXT[view.stages.length - 1] ?? null,
    finished: view.status === 'done' ? `Crash simulated · price back at ${priceText(last?.price ?? start.price)}` : null,
  }
}
