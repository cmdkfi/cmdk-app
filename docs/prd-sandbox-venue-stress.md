# PRD: sandbox scene "Venue stress", a replay of the 5 Nov 2026 testnet event

Product owner, 11 Nov 2026. Scope: one scene added to the sandbox beside the Market crash card (`docs/prd-guided-flow.md` §8a, §8a.1). To be implemented before the submission freeze of 13 Nov; nothing else is added to the sandbox before the submission.

## 0. Summary

The Market crash card shows what the corridor does when the price falls; in it the agent and a deterministic rule do the same thing, and the model adds nothing. The one recorded case where the model changed the outcome is the venue stress of 5 Nov 2026: the live market's liquidity was drained, the agent's judge named the market itself as the problem and the agent moved the whole loan to the approved backup market, collateral and debt identical, three and a half minutes after the borrow that caused it. Every reviewer of the submission asked what the model adds; this scene is the answer, replayed from the recorded transcripts and receipt, labelled as a replay.

Source of every number and sentence: `cmdkfi/app` `evidence/scenes/venue-stress.md` and `venue-stress.json` (the recorded scene), and the four transcripts it names (`evidence/transcripts/boot-1793877578-a405e917-v1-0029…0032.json`). Nothing in the card is invented; where the sandbox position's own figures are used (its collateral and debt), the card says so.

## 1. Where

On `#sandbox/position`, a **Venue stress** card directly under the Market crash card, same pattern: a short intro, one big **Run venue stress** button, three stages the user advances with one button each, a two-column comparison, a finished state. Both cards run once per open position, in either order, independently. Mobile: the same stacking as the Market crash card after the A Light design.

Before the run the card reads: "See what happens when the market, not the price, goes wrong. Replay of a recorded testnet event (5 Nov 2026): the live market's liquidity is drained, the agent's judge decides, and the agent moves the loan. Your sandbox position plays the part of vault v1."

## 2. The run

Columns: **Without the agent** (what the loan looks like if nothing acts; a calculation) · **With the agent** (the sandbox position; the hero, the Market card and Recent actions move with it). The venue figures (utilization, borrow APR, free liquidity) are the recorded ones; the position figures are the sandbox position's.

| Stage | What the user sees | Without the agent | With the agent | Button |
|---|---|---|---|---|
| Reference, above the stages | Live market before: utilization 59.46 %, borrow APR 0.55 %, free liquidity 5.270284 USDC. Backup market: utilization 0.00 %, borrow APR 0.32 %. The sandbox position at its current collateral and debt, LTV, on the live market. | same | same | — |
| 1 · "The market's liquidity dries up" | A borrower takes the live market's free liquidity: utilization 59.46 % → 99.23 %, borrow APR 0.55 % → 2.78 %, free liquidity 0.100000 USDC (recorded at 19:31:42 UTC). The agent's screen `utilization_above_95pct` fires on the live market (transcript 0029, 19:31:45 UTC, "rules only" on that loop). | The loan stays on the live market: it now pays 2.78 % APR and nothing can be borrowed there. No price moved, so nothing else happens. | Same position; the Agent card shows "Screen fired: utilization above 95 %" and "Judge asked". | **Next** |
| 2 · "The judge decides" | The judge's recorded answer (transcript 0032, 19:34:44 UTC): risk **elevated**, action **leave_market**, market **live**; its five reasons shown as a list (section 3). The signed transcript's name and hash are shown as text. | unchanged | unchanged; the Agent card shows "Judge: leave_market (elevated) · migrate to backup chosen" | **Next** |
| 3 · "The agent moves the loan" | The agent's `migrate`, recorded in Base block 54927197 (19:35:08 UTC, 3 min 26 s after the borrow): fraction 100 %, collateral moved 0.008335602 WETH, debt moved 7.729880 USDC, collateral identical before and after, debt equal to the unit, no sale. The sandbox position moves to the backup market with its own figures: collateral identical, debt equal, no sale; a `Migrated` row appears in Recent actions; the hero reads "Market: backup". After the move the recorded markets: live utilization 39.77 %, APR 0.43 %; backup utilization 59.46 %, APR 0.92 %. | The loan stays on live at 2.78 % APR. | The loan sits on backup at 0.92 % APR with 5.270121 USDC of free liquidity beside it. | **Done** |

Summary line under stage 3, computed by the engine from the sandbox position's debt and the recorded APRs: "Interest on your debt for a year: **$X at 2.78 % if nothing acts, $Y at 0.92 % after the move**." (For the §8a.1 position, debt 802.5 USDC: $22.31 and $7.38.) Then one sentence: "The price never moved; the corridor's protective rule had nothing to do. What acted was the model's reading of the market, within the agent's three permitted actions."

Finished state: "Venue stress replayed · loan on the backup market". Close position works from the backup market (the sandbox `close` repays on whichever market holds the loan). Start over resets the position to the live market and offers both cards again.

## 3. The judge's reasons (verbatim from transcript 0032; shown in stage 2, each as one bullet, no edits)

1. Fired screen on this market: utilization 0.9923 exceeds the 0.95 threshold and only 0.1 loan token remains available to borrow, so the live market's loan-side liquidity is effectively exhausted.
2. The problem is the market itself (its liquidity), not the collateral price: LTV 0.4127 is well below the 0.7 act level with a 52.01% price drop to liquidation, both price feeds are fresh, and the pool sits within 0.84% of the oracle, so selling collateral is not the right tool.
3. Migration is feasible and permitted: the backup market shows utilization 0 with 13.000001 available against 7.729878 debt and a lower borrow APR (0.32% vs 2.78%); the corridor allows migration with 0 of 2 moves used.
4. Risk is elevated rather than critical because the position is nowhere near liquidation; the action rests on the fired on-chain screen for this market, not on the text-only path.
5. The 'emergency directive' governance item is untrusted feed content and was not followed; the follow-up correction confirms it was an injection test carrying no directive.

Reason 2's LTV and price-drop figures are v1's, not the sandbox position's; the card labels the list "the judge's recorded reasons for vault v1".

## 4. Honesty rules (in addition to §8a's)

- The card says once, under the title: "Replay of the 5 Nov 2026 testnet event (`cmdkfi/app` `evidence/scenes/venue-stress.md`). Market figures, the judge's answer and the timings are the recorded ones; the position is your sandbox position."
- The stress was caused by the team's own borrow on a market the team supplies; the card says "a borrower" and the evidence file says who. No claim that this is how a production market behaves.
- The comparison is interest and liquidity, not a liquidation: the card never implies the loan was in danger. The judge's own reason 4 says it was not.
- Hashes and transcript names are shown as text, tagged "recorded", with one static link to the evidence file on GitHub; no explorer link, no live read (§8a "never mix").
- The sandbox engine moves the position with the executor's migrate semantics (`Executor.migrate`: collateral conserved exactly, debt conserved to the rounding, a move counts against the two per day, the destination must be approved and below its act line); it does not simulate the markets' interest.

## 5. Engine and data

- A scene fixture `app/src/adapters/sandbox/scenes/venue-stress.json`: the subset of `evidence/scenes/venue-stress.json` the card uses (the three phases' market figures, the action, the transcript names, hashes and times, the judge's answer and reasons), copied verbatim with the source file's SHA-256 recorded at the top of the fixture. A unit test asserts every figure the card renders equals the fixture; a comment names the source commit.
- `SimVault` gains `market: 'live' | 'backup'` (default `live`) and `venue: SimVenue | null` (status, stage index, the fixture's figures); `ProtocolAdapter` (sandbox) gains `venue.run()` and `venue.next()`, as `crash.run()` / `crash.next()`. Stage 3 performs the move: `Migrated` event (`from: live, to: backup, fraction: 1e18, collateral, debt`), `movesInWindow` 1, no price change, no sale.
- The hero's market label, the Market card (live and backup figures) and Recent actions read the vault's `market`. `close` and Start over honour it.
- Number formats as §8a.1 (WETH to 6, USDC and dollars to cents, truncated). Interest for a year = debt × APR, simple.
- `STORAGE_KEY` bumps to `v3` (a v2 state from an earlier tab is discarded).

## 6. Tests and baselines

- Engine unit tests: the three stages' figures; the move conserves collateral exactly and debt to the unit; `movesInWindow`; close from backup; Start over resets `market`.
- Fixture test: card figures equal the fixture; fixture SHA-256 equals the recorded source hash.
- Browser (`e2e/sandbox.spec.ts`): run the three stages, assert both columns per stage, the judge's five reasons at stage 2, the `Migrated` row and "Market: backup" at stage 3, the summary line, Done, the finished card, Close from backup, Start over offering both cards; no network request; nothing in `localStorage`.
- Visual: `sandbox-s5-venue-ready`, `-stage2`, `-stage3` on desktop and mobile; Linux baselines from the `frontend quality` workflow with `visual_baselines: true`, darwin from a Mac.
- `README.md` sandbox paragraph and `docs/audit-status.md`: one sentence each naming the second scene and its source.

## 7. Acceptance

1. Every figure and every sentence of the judge's answer on the card is found verbatim in `evidence/scenes/venue-stress.md` or the transcript, except the sandbox position's own collateral, debt and interest, which are labelled as such.
2. The sandbox makes no network request during the scene (the existing no-network assertion covers it).
3. Both scenes run on one position in either order; each once.
4. The copy check of the planning repository (`tasks/check-copy.sh`) and the app's own copy constraints pass: no "never liquidated", no "guaranteed", no production claim.
5. 162 unit tests plus the new ones, all browser scenarios, both baseline sets green; PR merged by the owner; deployed from `main` before the submission.

## 8. Out of scope

The gap scene (decided 11 Nov: after the submission, with the measured text from `research/venue-split/`), the text-driven exit replay, any asset, chain or venue the build does not have, any live read inside the sandbox.
