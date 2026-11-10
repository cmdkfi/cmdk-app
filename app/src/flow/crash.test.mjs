// The Market crash card's copy (PRD §8a.1, Phase 11) from the engine's figures for the scripted path: 0.5 WETH opened
// at $3,210 and borrowed at 50%, the run started with no interest accrued (the figures of engine.test.mjs). Every
// number is expected as the S5 hero and Recent actions format it (flow/format.ts, truncated), not as §8a.1's prose
// prints it (product owner, 11 Nov: one quantity never reads differently on one screen).
import test from 'node:test'
import assert from 'node:assert/strict'
import { crashCopy, priceText, RUN_CRASH } from './crash.ts'
import { dollarText as $, formatWadPercent as pc, usdcText as u, wethText as w } from './format.ts'

const pct = n => BigInt(n) * 10n ** 16n
const P0 = 3210n * 10n ** 24n
const START = { price: P0, collateral: 5n * 10n ** 17n, debt: 802_500_000n, value: 1_605_000_000n, ltv: pct(50), borrowed: 802_500_000n }
const COLL1 = 285_714_285_714_285_715n
const STAGES = [
  {
    index: 1, price: 2247n * 10n ** 24n,
    without: { collateral: 5n * 10n ** 17n, debt: 802_500_000n, value: 1_123_500_000n, ltv: 714_285_714_285_714_285n, liquidation: null, liquidatedEarlier: false },
    with: { collateral: COLL1, debt: 321_000_000n, value: 642_000_000n, ltv: pct(50), reduce: { repaid: 481_500_000n, sold: 214_285_714_285_714_285n, ltvBefore: 714_285_714_285_714_285n } },
  },
  {
    index: 2, price: 17655n * 10n ** 23n,
    without: { collateral: 25_526_665_533_843_104n, debt: 0n, value: 45_067_328n, ltv: 0n, liquidation: { repaid: 802_500_000n, seized: 474_473_334_466_156_896n, ltvBefore: 909_090_909_090_909_090n }, liquidatedEarlier: false },
    with: { collateral: COLL1, debt: 321_000_000n, value: 504_428_571n, ltv: 636_363_636_904_302_155n, reduce: null },
  },
  {
    index: 3, price: P0,
    without: { collateral: 25_526_665_533_843_104n, debt: 0n, value: 81_940_596n, ltv: 0n, liquidation: null, liquidatedEarlier: true },
    with: { collateral: COLL1, debt: 321_000_000n, value: 917_142_857n, ltv: 349_999_999_801_401_243n, reduce: null },
  },
]
const view = (status, n) => ({ status, start: status === 'ready' ? null : START, stages: STAGES.slice(0, n), lltv: pct(86), act: pct(70), liquidationIncentive: 1_043_841_336_116_910_229n })
const text = segs => segs.map(s => (typeof s === 'string' ? s : `**${s.strong}**`)).join('')

test('prices: the dollar value of one ETH, formatted as the hero formats values', () => {
  assert.equal(priceText(P0), '$3,210')
  assert.equal(priceText(2247n * 10n ** 24n), '$2,247')
  assert.equal(priceText(17655n * 10n ** 23n), '$1,765.5')
  assert.equal(priceText(17655n * 10n ** 23n), $(17655n * 10n ** 5n))
})

test('before the run: one button, no rows', () => {
  assert.deepEqual(crashCopy(view('ready', 0)), { rows: [], summary: null, button: RUN_CRASH, finished: null })
})

test('the three stages: §8a.1 sentences with the engine values in the hero format, both columns, the buttons in order', () => {
  const [s1, s2, s3] = STAGES
  const one = crashCopy(view('running', 1))
  assert.equal(one.rows[0].title, 'Open')
  assert.equal(one.rows[0].price, priceText(P0))
  assert.equal(text(one.rows[0].without), `${w(START.collateral)} (${$(START.value)}) · debt ${u(START.debt)} · LTV ${pc(START.ltv)} · ${u(START.borrowed)} in your wallet`)
  assert.equal(text(one.rows[0].with), 'Same')
  assert.equal(one.rows[1].title, '1 · The price falls 30%')
  assert.equal(one.rows[1].price, priceText(s1.price))
  assert.equal(text(one.rows[1].without), `LTV ${pc(s1.without.ltv)}. Nothing happens; the position waits for the market.`)
  assert.equal(text(one.rows[1].with), `LTV crosses 70%: the agent sells ${w(s1.with.reduce.sold)} at ${priceText(s1.price)} to repay ${u(s1.with.reduce.repaid)}. Collateral ${w(s1.with.collateral)}, debt ${u(s1.with.debt)}, LTV ${pc(s1.with.ltv)}. A Reduced row appears in Recent actions.`)
  assert.equal(one.button, 'Next: the price keeps falling')
  assert.equal(one.summary, null)

  const two = crashCopy(view('running', 2))
  assert.equal(two.rows[2].title, '2 · The price falls further, 45% in total')
  assert.equal(two.rows[2].price, priceText(s2.price))
  assert.equal(text(two.rows[2].without), `LTV ${pc(s2.without.liquidation.ltvBefore)}, above the 86% liquidation line. A liquidator repays the whole ${u(s2.without.liquidation.repaid)} debt and takes ${w(s2.without.liquidation.seized)} (debt × 1.0438, Morpho's liquidation incentive at 86% LLTV). **You keep ${w(s2.without.collateral)} (${$(s2.without.value)}).**`)
  assert.equal(text(two.rows[2].with), `LTV ${pc(s2.with.ltv)}, below the 70% line: no action. Collateral ${w(s2.with.collateral)}, debt ${u(s2.with.debt)}.`)
  assert.equal(two.button, 'Next: the price recovers')

  const three = crashCopy(view('running', 3))
  assert.equal(three.rows[3].title, `3 · The price recovers to ${priceText(P0)}`)
  assert.equal(text(three.rows[3].without), `You hold ${w(s3.without.collateral)} (${$(s3.without.value)}). The recovery does not help: the collateral is gone.`)
  assert.equal(text(three.rows[3].with), `${w(s3.with.collateral)} (${$(s3.with.value)}) against ${u(s3.with.debt)} of debt: **${$(s3.with.value - s3.with.debt)} of collateral value is yours.**`)
  assert.equal(text(three.summary), `Collateral value net of debt after the crash: **${$(s3.with.value - s3.with.debt)} with the agent, ${$(s3.without.value - s3.without.debt)} without**. Both keep the ${u(START.borrowed)} borrowed at open.`)
  assert.equal(three.button, 'Done')
  assert.equal(three.finished, null)

  // what that reads as for the scripted path (the §8a.1 figures, truncated as the hero truncates)
  assert.equal(text(three.summary), 'Collateral value net of debt after the crash: **$596.14 with the agent, $81.94 without**. Both keep the 802.5 USDC borrowed at open.')
  assert.equal(text(one.rows[1].with), 'LTV crosses 70%: the agent sells 0.214285 WETH at $2,247 to repay 481.5 USDC. Collateral 0.285714 WETH, debt 321 USDC, LTV 50%. A Reduced row appears in Recent actions.')
})

test('after Done: the comparison stays, no button, the finished line', () => {
  const done = crashCopy(view('done', 3))
  assert.equal(done.rows.length, 4)
  assert.ok(done.summary)
  assert.equal(done.button, null)
  assert.equal(done.finished, `Crash simulated · price back at ${priceText(P0)}`)
})
