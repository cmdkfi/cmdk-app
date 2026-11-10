# Guided flow — action plan

## Start here (for the implementation session)
1. Read `AGENTS.md` (protocol repo rule), `tasks/lessons.md`, then `docs/prd-guided-flow.md` in full, then this file.
2. Mockups: canvas (a private design tool; the sources below are the record), sources in `docs/mockups/` (see its README).
2b. The previous app (`main` branch) is documentation only: read it for protocol facts and test vectors, never import from it (PRD §8b).
3. Protocol repo cmdkfi/app (https://github.com/cmdkfi/app) is cloned locally; PRD facts were checked at commit `47fd4fb` (= origin/main on 9 Nov 2026). Run `git fetch` there and re-check before each phase (R12).
4. Toolchain: Node 22, pnpm 11.7.0; `deployments/testnet.json` is fetched from cmdkfi/app main (gitignored) before `pnpm build`; see README "Development".
5. Work on this branch (`feat/guided-flow`), one PR per phase. Do not commit or push without being asked. Ask before starting each phase.

PRD: `docs/prd-guided-flow.md`. Phase 0 is closed (decisions D1–D11 resolved; two non-blocking questions for the protocol developer remain). One PR per phase into `feat/guided-flow`; the branch merges into `main` only after Phase 7.

## Phase 0 — Decisions and protocol confirmations (blocking)
- [x] D1 wrap: inline "Wrap ETH → WETH" action on the deposit step (product owner, 9 Nov). WETH is mandatory: Morpho Blue markets are ERC-20 only, Executor takes no native value.
- [x] D3 close: single "Close position" action with a manual USDC transfer to the position address when it is short (product owner, 9 Nov).
- [x] D11 chaining: signatures are requested automatically in sequence, not as separate user steps (product owner, 9 Nov).
- [x] Checked: migration between the two Morpho markets needs no borrow permission (`Executor.migrate` is atomic via flash loan). Cross-venue (Aave) or cross-chain moves would need a new bounded open-debt permission: protocol roadmap item for the protocol developer, not v1 frontend.
- [x] D2: yes, borrowed USDC is withdrawn to the wallet as the last chained prompt (product owner, 9 Nov). D4–D10 on adopted defaults. Full flow confirmed: come → connect → create vault, deposit WETH, get USDC → repay → close.
- [x] Gas model question withdrawn (product owner, 9 Nov): the app does not predict relayer refusals; it reacts to the relayer's 400 with a top-up step (FR-8, D7).
- [ ] (non-blocking) protocol developer: confirm `/agent/vaults` is the intended source for "registering / registered / active" and its latency bound (minutes to ~15 min observed in code).

## Phase 1 — Branch and skeleton
- [x] `git checkout -b feat/guided-flow` from `main` (branch existed with the docs commit on top of `main` 61f71cc).
- [x] Move pure protocol modules into `app/src/protocol/` unchanged (`near`, `near-rpc`, `near-security`, `relayer`, `positions`, `create-vault`, `vault-setup`, `initial-rules`, `live-actions` helpers, `owner-recovery`, `transaction-recovery`, `agent-evidence`, `activity`, `wallet-utils`, `protection-clock`, `verification-age`, `use-now`, plus `discovery-state`, `vault-read-state`, `vault-funding`) with their `*.test.mjs`; byte-identical to `main`, no import changes needed; `pnpm test` green. `wallet.ts` replaced by `adapters/live/wagmi-config.ts`.
- [x] Delete old screens and modules listed in PRD §8 with their tests, plus every other old screen, `vault-layout`, `position-table-state`, `wallet-options`, old CSS and the old e2e specs/harness; `pnpm typecheck` green.
- [x] New `main.tsx`: providers, MetaMask-only wagmi config, hash router (five routes `#start`, `#settings`, `#connect`, `#progress`, `#position`, mirrored under `#sandbox/…`; `#sandbox/close|closed` → `#sandbox/position`), desktop gate (FR-16), theme.
- [x] Entry resolver (PRD S0): wallet state + discovery + local onboarding record → landing screen; route guards; wallet-slot component with its five states and menu (Copy address, BaseScan, Disconnect / Leave sandbox); silent reconnect for returning users. Unit tests for the landing table. Live wiring covers not connected / connecting / connected / wrong network only; discovery (D4) is wired in Phase 2, onboarding records in Phase 3.
- [x] Adapter foundations (PRD §8a): `src/adapters/` with `WalletAdapter` and `ProtocolAdapter` interfaces, a live implementation wrapping wagmi and `protocol/*`, an `AdapterProvider` React context, and a stub sandbox implementation that compiles. No screen imports wagmi or `protocol/*` directly (lint rule or import test). → `src/import-boundary.test.mjs`.
- [x] Keep `styles/prototype-controls.css`, token icons, LTV track, header/footer shell; remove dead sidebar/table CSS.
- [x] `pnpm build` and `pnpm test:bundle-boundary` green.
- [x] Old Playwright specs and harness removed; mobile project dropped (D9); `e2e/shell.spec.ts` smoke spec on the unchanged `e2e/fixture.ts` proves the shell renders with zero off-origin requests; `pnpm test:browser` green.
- [x] PRD §8, §8a and the S0 route paragraph updated to five routes.

## Phase 2 — Choose, Settings, Connect (S1–S3)
- [x] Catalogue tiles with enabled/disabled + "Coming soon" tag (FR-1).
- [x] S1 amount field prefilled with 0.01 ETH (PRD S1, product owner 9 Nov); applied in Phase 3 (`flow/amount.ts` `DEFAULT_DEPOSIT`, shared by S1, S3 and S4).
- [x] Amount input with min (D7), USD estimate and "about N USDC" from live oracle/IRM reads; "unavailable" fallbacks (never mock). New read module `protocol/market-quote.ts` (Executor.config → Morpho market, oracle price, IRM borrowRateView at one block); liquidity warning (R2).
- [x] Settings card from `config.json` with locked rows and explanations (FR-2); required acknowledgement checkbox. Corridor now in `config.app.json` `guided.corridor`; liquidation from the live LLTV read.
- [x] Connect screen: detect MetaMask, switch Base Sepolia, on 4902 add the network with the exact values from PRD Appendix C (passed as `addEthereumChainParameter` from config), account check (contract wallets blocked, EIP-7702 delegated allowed, Q2), rejection keeps input, state in `sessionStorage` (FR-3). Create position visibly disabled until Phase 3.
- [x] Get Base Sepolia ETH panel (S3a, FR-17): balance vs deposit + gas allowance (wrap only the missing WETH; with enough WETH only one transfer's gas), missing amount, copy address, faucet links from `config.app.json` `help`, 10 s balance polling, auto-continue. Gas = 100 000 × live maxFeePerGas + `GasPriceOracle.getL1Fee` per transaction (`protocol/wallet-funding.ts`).
- [x] Add `help` block (faucet and docs URLs) to `config.app.json` and `scripts/generate-config.mjs`; unit test that all URLs are https and non-empty (`scripts/guided-values.mjs`, `flow/guided-config.test.mjs`).
- [x] Discovery after connect: `discoverVaults` + D4 rule → route to S5, resume S4, or "Create your position" (FR-4). Failed scan shows Retry, never "no position". Landing re-runs when discovery resolves after a connect from S1–S3. Empty vault with complete setup → S4 deposit step (Q1); setup facts in `protocol/setup-facts.ts`.
- [x] Unit tests: active-vault selection (D4), amount validation, USDC estimate math, funding math, setup status, config validation, entry rules (local record never overrides chain state).
- [x] Desktop gate: shell not mounted below 960 px (FR-16).

## Phase 2b — Protocol layer written from cmdkfi/app (PRD §8b; product owner, 9 Nov)
- [x] Re-check cmdkfi/app origin/main; note the commit in the Review note.
- [x] Write `app/src/protocol/` fresh per the §8b table: `near/rpc.ts`, `near/vault.ts`, `owner/message.ts`, `relayer/client.ts`, `base/reads.ts`, `base/math.ts`, `base/activity.ts`, `evidence/verify.ts`, `wallet/tx.ts`. Each export carries a comment naming the cmdkfi/app file it mirrors; ABIs copied from the protocol repo's Solidity or `agent/src/chain.rs` selectors.
- [x] Port test vectors from the old tests as data (setup message bytes and field order, open/withdraw/close args, accrual and LTV rounding incl. zero collateral, nonce replay, relayer GET-only fallback and 429, discovery filtering and partial-scan failure); cross-check message bytes against `scripts/p2_owner.py` and math against `scripts/VERIFY.md`.
- [x] Fold Phase 2's `market-quote`, `wallet-funding`, `setup-facts` into the new layout (`base/reads.ts`, `base/math.ts`); keep their behaviour and tests.
- [x] Point `adapters/live/protocol.ts` at the new layer; the `ProtocolAdapter` interface lists only functions the screens use.
- [x] Delete every module moved from `main` in Phase 1 and their tests (`near`, `near-rpc`, `near-security`, `relayer`, `positions`, `create-vault`, `vault-setup`, `initial-rules`, `live-actions`, `owner-recovery`, `transaction-recovery`, `agent-evidence`, `activity`, `wallet-utils`, `protection-clock`, `verification-age`, `use-now`, `discovery-state`, `vault-read-state`, `vault-funding`). Re-create the three tiny helpers the UI needs (`shortAddress`, `accountKind`, `useNow`) under `flow/` or `components/`.
- [x] Replace `e2e/fixture.ts` and `e2e/guided-fixture.ts` with a thin `e2e/live-fixture.ts` sized to §8b (fake MetaMask incl. `eth_sendTransaction`, `wallet_addEthereumChain`; NEAR/Base/relayer fakes). Existing S1–S3 browser scenarios pass on it.
- [x] Pin Vite to the exact installed version in `app/package.json`.
- [x] Import-boundary test: screens/components import nothing from `protocol/`; adapters are the only consumers.
- [x] `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:bundle-boundary`, `pnpm test:browser` green; S1–S3 behave exactly as before against live Base Sepolia (one manual read).
- [x] Review note + lessons entry; commit on `feat/guided-flow` (no push).

## Phase 3 — Onboarding progress (S4)
- [x] Step machine (`flow/onboarding.ts`, runner `components/useOnboarding.ts`) with the record keyed `factory:owner`, vault inside (Q3); resume on reload; one active step; nothing prompts after a reload until Continue.
- [x] Step 1 create: `/create-vault` once, job polling, 429 countdown, uncertain POST or 404 job → discovery re-run and the appeared vault adopted before any repeat POST (only on user Retry). The vault id and position address are shown; the vault links to NearBlocks (`help.nearblocks`, added in Phase 4).
- [x] Step 2 setup: args from Base facts read by `readVault` (approve always true, authorize per executor, corridor where unset; Q4), sign, lock, `/owner-call`, job, receipts × 2 confirmations, then setup complete per fact 3.
- [x] Step 3 agent registration: `/agent/vaults` row + NEAR key list every 30 s, non-blocking, "usually a few minutes".
- [x] Prompt chaining (D11, FR-5a): five prompts in order, one at a time, pause on rejection with Retry.
- [x] Step 4: 4a wrap only the missing WETH, skipped when the wallet holds enough (FR-7); 4b transfer; receipts × 2 and balance predicates.
- [x] Step 5 open: `collateral_in` = WETH at the position address; feeds (R1) and liquidity re-read before the prompt; 1% margin; "opened below target (X%)"; pause under 1 USDC lendable; pause with the new figure when > 2 points below what S1 showed (Q1).
- Removed after Phase 3 acceptance (product owner, 9 Nov): simulating `Executor.open` before signing. Relayer prechecks plus the feed and liquidity reads cover the known reverts; a Base revert after the NEAR call resolves through the nonce rule into a re-sign.
- [x] Step 6 withdraw: all idle USDC to the owner; done = job done and idle USDC below `usdcDust`; skipped when none.
- [x] Reactive gas top-up (FR-8, D7, Q2): relayer refusal text verbatim, top-up (need − have) × 1.25 rounded up to 0.0001 ETH, min 0.0005 ETH, then the same signed message if ≥ 45 s valid, else a new signature.
- [x] Minimal reconciliation (FR-6, reworded in the PRD): lock keyed `vault:owner`; job → `owner_nonce` → NEAR time; "Checking…".
- [x] Failure UX: relayer `error` verbatim + one plain line; Retry labels say whether they re-send or re-sign; "Still waiting" with the job id after 180 s (FR-5). Paused steps show the job id; the NEAR transaction hash is not shown (not needed by the FR-6 rules).
- [x] S1 "Deposit up to N ETH to open at 50%" in the liquidity warning (Q1); S1 prefilled with 0.01 ETH.
- [x] Unit tests: resume step, record/lock storage and keys, job poll schedule, top-up amount, retry mode, 2-point rule, lock reconciliation table, open target LTV, feed freshness, refusal parser.
- [x] Browser: happy path (one click), reload at each prompt step without a prompt until Continue, rejection + Retry, gas refusal + top-up + same-message re-post, lost create job → adopted vault, lost owner-call job → owner_nonce, stale feed, Q1 accept-lower-LTV.

## Phase 4 — Position screen (S5)
- [x] `help.nearblocks` (https://testnet.nearblocks.io) in `config.app.json` and the validator; vault links on S4 and S5.
- [x] React Query polling of `readPosition` (30 s, paused while hidden); hero debt accrued to the read block, collateral in WETH and USD, LTV with the segmented track (floor/target/trigger from the Base corridor, liquidation from the market LLTV); "Read at block N, X s ago"; on a failed read the last snapshot stays, marked read-only with its age.
- [x] Agent card: status from `/agent/vaults` fields only (`registration`, `agent_status`, `expires_at`) plus the NEAR key check; **not** the previous app's 60-second tick rule (product owner, 9 Nov). Last check from `last_tick_unix`; key expiry; remaining daily sell budget from `Executor.soldInWindow` against the corridor `sellBudget` (CorridorMath.remainingBudget); "Verify the agent" opens a placeholder until Phase 6.
- [x] Market card: the market with debt is current (live or backup); pair, LLTV, market id prefix with Morpho and Executor links, backup status per `Executor.migrate`, position address and vault links.
- [x] Recent actions: Executor logs (`topics[1]` = position address) + WETH/USDC transfers over the last 10,000 blocks; You/Agent by event name; amounts, time, BaseScan link; "Load earlier" adds 10,000 blocks down to the Executor deploy block; the covered range is stated; a failure keeps the list and says so.
- [x] Idle balances line; liquidated variant (remaining debt, no recovery promise, no actions); closed variant only from the route's close record (Phase 5 writes it). Close position present, disabled: "Closing arrives in Phase 5".
- [x] Unit tests: event labelling, current-market selection, backup status, agent status derivation, sell budget math, variant derivation.
- [x] Browser: active position renders all cards; read failure keeps the last snapshot read-only; liquidated variant; Load earlier.

## Phase 5 — Close position (S6) and Start over (S7)
- [x] S5 market card: oracle source and freshness, "Chainlink ETH/USD · updated N min ago", from the Executor's configured feeds (the R1 reads); feed names from the manifest `base.chainlink` (address, description) carried into `config.json` by the generator; "stale" past the feed's maxAge.
- [x] Shared step-chain runner (`components/runner.ts`): the Phase 3 owner-call machinery and hook, generic over step id and record; S4 (`useOnboarding.ts`) and S6 (`useClose.ts`) are configurations of it.
- [x] Step 1 shortfall: need(debt accrued to now + 600 s) − idle USDC, floored at 0, where need = debt + debt // 100 (relayer `REPAY_HEADROOM`, relayer.py l.72, l.516-529); wallet USDC transfer of exactly that; done when idle USDC ≥ need(debt now).
- [x] Get test USDC panel (S6a): exact missing amount, wallet balance, copy address, Circle faucet first with the "choose Base Sepolia" warning, Coinbase faucet second, headroom reminder, 10 s re-read, the chain resumes by itself.
- [x] R10: debt re-read immediately before the close signature; if idle USDC < need(debt now), a second transfer step is inserted (shown only then) instead of failing.
- [x] `close {market}`: one owner call per market holding debt or collateral; done = job done, receipts at 2 confirmations, Morpho borrowShares 0 and collateral 0 for that market.
- [x] `withdraw` WETH when idle WETH > 0; `withdraw` USDC when idle USDC > usdcDust; each done when its job is done and the idle balance is gone.
- [x] Review sheet before the first prompt: debt, interest over the next 10 minutes, headroom, USDC already there, what is sent first, collateral returned, destination, "each signature expires in 10 minutes", no close without repaying. S5 sub-line under Close position (PRD S5).
- [x] Close record `cmdk.<mode>.close.v1.<factory>:<owner>:<vault>` with per-step state, written on every change; completed → the closed marker (`closeRecord`); an unfinished one keeps the resolver on S5 at every step (`closing`); the onboarding record for that vault is cleared on completion.
- [x] S7 closed variant: debt 0, collateral 0, idle balances, Start over only when debt, collateral and idle WETH are zero and idle USDC ≤ usdcDust. Start over clears the close record, resets the S1 amount to 0.01 ETH and goes to `#start`; S3 shows the vault "ready for a deposit" with a **Deposit** button; S4 resumes at the wrap step on the same vault (no `/create-vault`).
- [x] Unit tests: shortfall math with the 600 s accrual, R10 rule, wallet missing amount, close record steps and storage, Start over gating, closing/closed resolution, relayer need and debt-ahead math, manifest feed names.
- [x] Browser: review sheet content; close with no shortfall; close with shortfall and enough wallet USDC; wallet short → panel → fixture credit → auto-resume; reload mid-close (stays on S5, no prompt until Continue); Start over → S4 wrap step on the same vault.

## Phase 5b — Performance pass (PRD §9 "Reads and caching"; product owner, 9 Nov)
Items 1 and 2 are small and may be folded into Phase 5 or 6; 3–6 are a short dedicated pass before Phase 7, because they change what the first tester sees.
- [x] 1. Batch reads: `createPublicClient({ batch: { multicall: true } })` with `http(url, { batch: true })`; pinned `blockNumber` on every refresh read (static data is read once at `latest`); the fixture answers Multicall3 aggregate3 (and viem's `getEthBalance` inside it) at `baseSepolia.contracts.multicall3` by dispatching each inner call to its own handlers; browser test: one S5 refresh is 6 HTTP requests (Base: block pin + two aggregate3 rounds; NEAR: get_state + key list; relayer: agent list).
- [x] 2. Static data once per session: params, decimals, LLTV, Executor config (feeds, maxAges) in a query with `staleTime: Infinity` (loaded with the shell); the 30 s poll reads only moving data. Unit test (viem custom transport) that a refresh issues no static reads. The factory config is not part of it: discovery runs once per session and its `count` moves. The onboarding and close chains read static data live.
- [x] 3. Activity: two topic-filtered `eth_getLogs` per window with address arrays, sent as one JSON-RPC batch: [Executor, WETH, USDC] with [null, position] and [WETH, USDC] with [Transfer, null, position]; events classified client-side as before (product owner, Phase 5b: unfiltered, one window was 4,208 logs / 2.7 MB on Base Sepolia on 9 Nov; filtered, near zero). Decoded events and block timestamps persisted per position address once ≥ 2 confirmations; on return only last-cached-block+1 → head is fetched. Browser test: the saved list shows at once and one window is requested.
- [x] 4. Persist the last position snapshot per vault (TanStack Query persister, localStorage, key kind+owner+vault, live only); rendered at once on return with "Read at block N, X min ago · refreshing"; Close position and Start over wait for a live read. Browser test: reload shows the cached snapshot with its age before the live read lands.
- [x] 5. Cache the owned vault id per owner (live only); verify with one `get_state`; scan only when the cached vault no longer names the owner (or cannot be read). Unit tests for the mismatch, unreadable, sub-cutoff and other-factory paths.
- [x] 6. Share the NEAR `get_state` read between position and agent queries (one answer shared for 5 s in the live adapter; discovery's read seeds it); S5 only, the chains read live.
- [x] Measure before/after on the live RPC (requests per refresh, time to first full S5) and record both in the Review note.
- [x] NEAR RPC (product owner, after 5b): `nearRpcUrl` https://test.rpc.fastnear.com, `nearRpcUrlFallback` https://near-testnet.drpc.org (both https-validated); the fallback is asked for NEAR reads only after a retryable failure of the primary; PRD §9 item 7 and Appendix C record both URLs and the measurement.

## Phase 6 — Verification panel
- [x] `help.manifest` (raw GitHub deployments/testnet.json) in `config.app.json`, https-validated; also `help.measurementDoc` and `help.relayerDoc` for the panel's links (Appendix C: links are configuration).
- [x] Rows exactly as the PRD §6 table, each Checked | Mismatch | Unavailable | Not checked with the time of its check and a "how to check yourself" line: published manifest (with `sourceCommit`), NearBlocks vault page and registration transaction, agent/MEASUREMENT.md, scripts/RELAYER.md. Checks from `evidence/verify.ts` as it exists (`measurementMatches`, `fetchPublishedManifest`, `sha256Hex`/`composeHashMatches` with the `/agent/` index entry, `agentRow`, `agentKeyLimited`, `codeMatchesFactory`); no transcripts, no execution verification.
- [x] "Checked" only for a positive result in this session; each check is settled on its own, so a failed fetch is Unavailable on its row only; nothing to compare yet (no vault, no approval, no agent key) is Not checked; the relayer and "not checked here" rows are static statements.
- [x] Shown in the S4 right rail from step 1 (re-checked every 30 s; replaces the placeholder and the separate registration poll) and opened from S5's "Verify the agent" (checked on open and on "Check again").
- [x] Unit tests: row status derivation for match, mismatch, unavailable, not checked, and the no-vault / pending / failed states. Browser: all rows Checked against the fixture; an altered manifest is Mismatch on row 1 only; a failing evidence fetch is Unavailable on row 2 only; the registration row reads Registering while the agent row is pending (S4 rail).

## Phase 6b — Sandbox mode (original item list; see the updated section below for order and the production flag)
- [x] Sandbox `WalletAdapter`: in-memory account, balances, instant signatures/transactions with fake hashes, scripted rejection toggle (not built: optional in PRD §8a; rejections are covered by the live fixture).
- [x] Sandbox `ProtocolAdapter`: state machine create → setup → open → scripted price drop → agent `Reduced` → close; stage timers 1–3 s; simulated interest and feeds; activity list and verification rows marked "Simulated".
- [x] UI: Try in sandbox entry on S3, the no-wallet state and the header while disconnected (product owner, 10 Nov); explainer sheet with Activate (prefills 0.5 ETH, lands on `#sandbox/start`); persistent banner; wallet slot "Sandbox wallet"; disabled hash links tagged simulated; Leave sandbox confirmation (Leave / Stay) in banner and wallet menu; `#sandbox/…` routes mirroring every live route; `sessionStorage` only.
- [x] Scripted scenario: ~20 s after open, −30% price → LTV ≈71% → simulated agent `Reduced` within the cooldown → LTV 50%; visible interest accrual; closed → Start over reuses the simulated vault at the deposit step (PRD §8a S7 row, D5).
- [x] Guard: live adapters are never constructed while the sandbox is active (unit test); fixture's unexpected-request guard proves zero network calls in sandbox (browser test).
- [x] README and `docs/audit-status.md`: state why a labelled, isolated sandbox is acceptable after demo routes were removed.

## Phase 7 — Verification of the whole (before merge)
- Superseded: `e2e/fixture.ts` and `e2e/harness.tsx` belonged to the cockpit; the guided flow's browser fixture is `e2e/live-fixture.ts`, which covers these (wallet transactions with receipts and balance changes, add-chain and 4902, faucet credit).
- [ ] Playwright (desktop project): happy path S1→S5 against `e2e/fixture.ts` (fake MetaMask, NEAR/Base/relayer fixtures), reload-resume at steps 2, 5, 6, rejection at each signature, relayer 400 and 404 job, close flow with and without shortfall, wallet short of USDC with faucet panel and auto-resume after the fixture credits USDC, wallet without Base Sepolia ETH with faucet panel and auto-continue, 4902 add-network prompt values, verification mismatch, desktop gate, no-MetaMask, one-click chaining (no page clicks between Create position and the position screen).
- [x] Browser test of an account switch mid-onboarding (moved from Phase 3): the runner stops, re-keys the record to the new owner and prompts nothing until Continue; back on the owner, the landing table lands on S4 again.
- [x] R10 second-transfer browser scenario (close declined, 30 days pass, Retry inserts a second transfer of exactly the new shortfall).
- [x] Creation guarded by a fresh ownership read (product owner, step 1): discovery before every `/create-vault` POST with adoption; discovery refreshed when a run creates or adopts a vault; landing re-run on account change; S3 never overwrites a record that names a vault. Browser tests for each; PRD S4 step 1 and FR-4.
- [x] Sandbox kept out of production builds until Phase 6b: `__SANDBOX__` build flag (VITE_SANDBOX=1), `#sandbox/…` → `#start`, stub adapter not bundled, `check-test-boundary` fails on any "sandbox"/"Sandbox" in dist; seams kept in source with a flag-on route test.
- [x] Production bundle: no fixture or sandbox markers; `config.json` carries only addresses and market ids from `deployments/testnet.json`. Whole suite run three times.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:bundle-boundary`, `pnpm test:browser` green locally and in `frontend quality` CI on the PR.
- [ ] Live rehearsal on Base Sepolia with a real MetaMask and a fresh wallet holding ≥0.015 ETH: deposit the default **0.01 ETH** (≈10–11 USDC of debt; live market liquidity was 66 USDC free on 9 Nov after the top-up, backup 17 USDC); record vault id, every job id, tx hashes, elapsed time per step, gas used; confirm ≈10 USDC in the wallet and a Morpho position at ≈50% LTV; then full repay-and-close (one Circle faucet claim of 20 USDC covers the shortfall); then start over. Save notes in `tasks/rehearsal-<date>.md`.
- [ ] Live rehearsal with a wallet that owns an old-app vault: lands on S5 with correct numbers and events.
- [ ] Copy review against README honesty constraints (PRD §1 item 15): testnet, unaudited, not insurance, no "verified" without result, submitted ≠ done.
- [ ] Preview deploy: run `deploy testnet` via `workflow_dispatch` from `feat/guided-flow`; smoke test on testnet.cmdk.fi (CORS, config.json, fonts, one full read of an existing vault).
- [x] `README.md` rewritten for the guided flow (routes and reads, open/close prompts, honesty rules, commands, RPC choice with the measurement, the vault cutoff); `docs/audit-status.md` maps every cockpit finding to survives / changed / dropped with the reason, and lists what is pending (live rehearsal, sandbox).
- [ ] The product owner approves; merge `feat/guided-flow` → `main` (deploys automatically).

## Phase 7b — Rehearsal fixes (live rehearsal 9–10 Nov; product owner's findings)
Order: fixes first, deploy, then the phases below.
- [x] 1. Agent status: trust the chain first (vault key with future expiry + limited-key check = registered); the agent's list adds liveness or "the agent's list has not caught up yet"; its "revoked" means Revoked only when the chain shows no key or another key. Unit test with the live rows seen on 9 Nov ({registration:"registering", agent_status:"revoked"} while the chain already had the key). Amended by the product owner during the phase (live run, v10): the approval comes first — `approved` ≠ published manifest is **Outdated**, none is **Not approved** (Revoked only when the agent's list shows a registration and the chain holds no key), a failed manifest read is Unavailable; the same condition guards the panel's "not caught up" wording.
- [x] 1a. (product owner, during the phase) Before the setup signature, compare the baked `config.agent.measurement` with the runtime manifest; if they differ, pause the setup step with retry 'check' and "This app's configuration is behind the published agent version; try again later." 
- [x] 2. Activity grouping: fold token transfers that share a transaction hash with an Executor event into that event's row (one row per transaction).
- [x] 3. Verification: static rows tagged "Statement", not "Not checked"; "Last tried at" for rows with nothing to compare; when the agent's list has no registration_tx, say so and point to the vault's Access keys on NearBlocks.
- [x] 4. S5: one disclaimer (footer only); close sub-line rounded to two decimals; "Sell budget left today" reads "no position" when collateral is zero; two decimals on every USDC amount in recent actions; refresh recent actions together with the position so both block numbers agree.
- [x] 5. "Checking…" says why and until when ("relayer answered 503; waiting for the message to expire at HH:MM:SS unless the vault shows it ran") with a countdown; relayer POST timeout 60 s (posts are never retried).
- [x] 6. "Show USDC in MetaMask" (`wallet_watchAsset`, ERC20 from config) after the withdraw step and on S5 next to the wallet; browser test that the wallet receives the request with the config address.
- [x] 7. Registration copy: "usually within a few minutes" (cron now every minute); rehearsal file updated with the recorded values; commit, push, product owner deploys.

## Phase 7c — Re-approve from S5 (product owner, 10 Nov, after Phase 7b; before Phase 8)
- [x] Visibility rule (pure, unit-tested): an open position (variant active, no close running) whose agent card reads **Outdated** offers "Approve current agent version"; **Not approved** (revoked while open) offers "Approve agent"; nothing else.
- [x] The button runs a setup-only owner call on the shared runner: resumed setup, `approve: true`, `authorize` from Base, the same `setupArgs` as S4 (PRD fact 3), with the 1a guard (the setup intent and guard are shared with S4, not copied). Shown inline on the agent card with the same statuses and retry kinds; "Done" only when the job is done and the vault's `approved` equals the measurement the guard compared with the manifest right before signing.
- [x] Persisted through the existing lock (`lockKey`, method `approve`): a reload resumes checking without prompting, as for close.
- [x] S5 keeps polling while it runs; after Done the agent card and the verification panel re-read (Registering, then Active).
- [x] `classifyVault` stays `active`; S0 lands on S5 (PRD S0 table notes that re-approval happens on S5); never routed through S4.
- [x] Fixture scenario + browser test: Outdated → button → setup signed once → Active; reload during the call resumes checking. Unit test for the visibility rule.

## Phase 8 — Wallet: any injected wallet, header slot only when connected (PRD S0, S3, FR-3 as revised 10 Nov)
Added by the product owner after the 10 Nov live run (first in this phase): the wallet can report another chain than Base Sepolia although MetaMask's selector shows Base Sepolia (MetaMask keeps a network per site), and Continue on S4 then did nothing and said nothing (runner.ts returned while the chain was wrong).
- [x] 8a.1 Right after connect or reconnect, when the reported chain is not Base Sepolia, request `wallet_switchEthereumChain`, adding the chain from `config.network` when the wallet lacks it (PRD S3).
- [x] 8a.2 Every action that needs Base Sepolia (Continue, Retry, Create position, Start closing, the re-approval) requests the switch itself and proceeds once it succeeds.
- [x] 8a.3 While the wallet stays on another chain, the active step shows "Switch to Base Sepolia in your wallet." with a Switch button, never silence.
- [x] 8a.4 Browser tests: connect on the wrong chain → switch requested → the chain runs; switch refused → the step shows the line and the button.
- [x] Timing (before coding, product owner): "reload at each prompt step" alone, three runs at d8d2fe6: 11.9 s, 11.0 s, 11.2 s (7b: 12.8 s) with load average about 5 on 8 cores (a VM at about 160 % CPU). Not slower; the 7c failure was the 30 s test timeout under load average 35–45.
- [x] Remove the header Connect button; the wallet slot renders only when connected (menu: Copy address, BaseScan, Disconnect). S1/S2 work without a wallet; S3 is the only place to connect.
- [x] Connect wallet on S3: wagmi `injected()` with EIP-6963 discovery; list every announced provider with its name and icon, plus legacy `window.ethereum` when not announced; no connect-modal library (decision recorded in PRD S3). "Install a wallet" link when none is detected.
- [x] Keep the account check (plain / EIP-7702 EOA allowed; contract wallets blocked with the ecrecover reason), the network switch/add, and silent reconnect for returning users through wagmi's reconnect.
- [x] Fixture: announce two EIP-6963 wallets (MetaMask and a second one) and a legacy provider; browser tests for the list, connecting with the second wallet, the contract-wallet block, and the header slot absent before connecting.
- [x] README and PRD wording: "MetaMask" → "an injected wallet" wherever it is not about the MetaMask-specific network values.

## Phase 9 — Visual pass to the mockups (PRD §7 as revised 10 Nov)
- [x] Port `docs/mockups/cmdk.css` as the app's stylesheet (tokens, type scale, spacing, 960/1120 columns, tiles, rows, steps, checks, LTV track, help panels, sheets); keep the CmdkReference font.
- [x] Rebuild each screen's markup to the artboard structure: S0 header, S1 catalogue + amount card, S2 corridor + three lists, S3 facts + help panel variant, S4 steps + verification rail, S5 hero/corridor/agent/market/actions, S6 close steps + USDC panel, S7 closed, sandbox banner/sheet (for Phase 6b).
- [x] Screenshot comparison per screen in the browser suite (desktop viewport, fixture data) with a tolerance; update the baselines only on purpose.
- [x] Linux baselines: `frontend quality` run on the branch with `visual_baselines: true` (runs 42787573760, then 42787893201 after the input fix); the artifact is reviewed and committed (until then the 12 screenshot tests fail on CI and in `deploy testnet`).
- [ ] Product owner reviews the deployed preview screen by screen against the canvas before Phase 6b starts.

## Phase 6b (updated 10 Nov) — Sandbox for production
- [x] (product owner, 10 Nov, first) Sell-budget copy: the 20% budget limits discretionary sells only; S2 paragraph and "can never" item, S5 "Discretionary sell budget left today", PRD fact 4a with Executor.sol and logic.rs citations, lesson.
- [x] (product owner, 10 Nov) The scripted reduce returns LTV to 50% with `repayToLtv` (protective, not budget-limited; S10 figures superseded); the third entry is a header text link while disconnected.
- [x] Build the simulated adapters behind the existing seams (`VITE_SANDBOX`), then enable the flag in the production build once the sandbox passes its tests; remove the bundle check's "no sandbox string" rule in the same commit and replace it with "sandbox never persists to localStorage and never contacts a network host" tests.
- [x] Scope and rules exactly as PRD §8a (entry sheet, banner, `#sandbox/…` routes, scripted price drop and agent reduce, close, Start over, Leave sandbox).

## Phase 10 — Merge
- [x] (product owner, 10 Nov) PRD S4 table corrected to the app's six steps; registration is the rail's row, not a step.
- [x] (product owner, 10 Nov) Frozen artboard copy added: S4 head tag "Step N of 6", S5 "Risk corridor" heading, the agent card's "May do" row (fact 7; the product owner's message said fact 2, which is about owner signatures), S6 summary rows above the close steps (re-read every 10 s while closing). The S7 extra figure is skipped.
- [x] Final docs pass: README counts and protocol commit, PRD status line, audit status header and "pending" list.
- [ ] The product owner approves; merge PR #80 into main (main deploys automatically). Only on the product owner's explicit word.

## Phase 11 — Sandbox market crash (PRD §8a.1; product owner, 11 Nov, after the live review)
- [x] Commit the product owner's PRD §8a.1 and this phase first (`git diff HEAD -- docs tasks`).
- [x] Engine: remove the timed drop and reduce; add the three explicit stages (×0.70, ×0.55 of start, back to start) and the "without the agent" calculation with Morpho Blue's liquidation incentive, cited from the Morpho source (`Morpho.sol` `liquidate`, `LIQUIDATION_CURSOR`, `MAX_LIQUIDATION_INCENTIVE_FACTOR`); the protective reduce stays on `repayToLtv`. Unit tests with the §8a.1 figures.
- [x] S5 sandbox: the Market crash card under the hero with **Run market crash**, three stages advanced by the user, two columns per stage, the stage 3 summary line, the finished state, once per position, Start over offers it again; Close position available at every stage.
- [x] Copy exactly as §8a.1, including the honesty lines; S8 explainer sheet gains "Open a position, then run a market crash to see what the agent does."
- [x] Browser test for the whole run; screenshots before the run and at stage 3 (both platforms via the baseline job).
- [x] README and audit status: one sentence that the sandbox price path is scripted and shows a calculated "without the agent" outcome.
- [x] Five checks, commit, push; CI green. No deploy, no merge: the product owner reviews the deployed preview after their own deploy.

## Phase 12 — Screening fixes, test server, Revoke agent (product owner, 11 Nov; done by the planning session, no Opus agent)
- [x] A. Copy from the AI screening of 10 Nov, matching the protocol README: S2 floor sentence; the debt-rounding note on S1, S2 and the S5 "May do" row (a move may round the debt up by 0.000001 USDC); sandbox labels on S1 ("simulated oracle", "simulated market"); README deploy line and bundle-boundary line; README "One vault per wallet" and PRD D4/FR-4 say the vault must hold the published policy (PR #81).
- [x] B. Browser tests timing out at default parallelism: the cause is the Vite dev server (one process transforming hundreds of unbundled modules per page load for every worker; 13 s per six-step scenario at four workers against 1.7–2.4 s alone). The Playwright web server now builds once and serves `dist-e2e` with `vite preview`.
- [x] C. Revoke agent on S5 (PRD S5, FR-18): `revoke_agent` owner call (args {}), confirm sheet, inline step on the agent card, Revoked → Not approved → Approve agent; sandbox simulation with a 10 s list lag; vector V18 and message test; `canRevoke` and `approveAction('Revoked')` unit tests; engine test; one browser scenario; screenshot of the sheet.
- [x] Five checks; commit, push; CI green; linux baselines from the `frontend quality` job. No deploy, no merge without the product owner's word.

## Mockups
- [x] Screen mockups prepared 9 Nov 2026 as a Design canvas (a private design tool; `docs/mockups/` holds the sources) (12 artboards: S0 entry and navigation, S1 choose, S2 settings, S3 connect + get ETH, S4 progress + verification, S5 position, S6 close + get USDC, S7 closed, S8 sandbox entry, S9 sandbox progress, S10 sandbox position, S11 leave sandbox). PRD §7 is the visual source; the canvas is the layout reference for Phases 2–6 and 6b.
- [ ] The product owner reviews the mockups; layout changes go back into the canvas before Phase 2 starts.

## Terminology
Vault = the NEAR account (contract, no keys). Position address = its Base address (`base_address`), the only place tokens are sent. Agent = restricted key for reduce/migrate/exit; it does not control the position address. See PRD "Terminology".

## Review notes
(high-level summaries are added here as phases complete)

**Phase 1 (9 Nov 2026, cmdkfi/app still `47fd4fb`).** The 20 reused protocol modules and their tests now live in `app/src/protocol/`, byte-identical to `main`. Everything the new entry no longer uses is deleted: the old cockpit screens, rules/revoke/held-cancellation/history modules, `vault-layout`, table and dialog CSS, and the old Playwright specs and harness. The new shell has a header (brand, wallet slot, testnet chip), a footer and a CSS desktop gate below 960px. There are five live hash routes plus a `#sandbox/…` mirror; each screen is an empty titled placeholder with no data. Screens reach the outside world only through `src/adapters/`. `WalletAdapter` is backed by wagmi `actions` with a MetaMask-only config and silent reconnect. `ProtocolAdapter` passes straight through to `protocol/*`. The sandbox stub rejects every action and imports no live code. `src/import-boundary.test.mjs` enforces that boundary and was checked against a deliberate violation. `flow/entry.ts` covers every S0 landing row and guard (16 tests); `flow/routes.ts` has 6 tests. Live wiring passes `discovery: not-checked` and `onboardingRecord: false` until Phases 2–3; with those inputs the app never claims "no position". One deliberate copy split: the slot shows "Connecting…" while MetaMask connects and "Checking your vaults…" only when discovery actually runs. "Leave sandbox" currently just navigates to `#start`; its confirmation is Phase 6b. Results: typecheck clean, 89/89 unit tests, build, bundle boundary and 4/4 Playwright desktop tests. Recorded traffic on load is 62 requests, all to `localhost:5177`, and the only wallet calls are `eth_accounts`. Note for Phase 2: the landing table is applied once on mount. When discovery is wired, landing must re-run once discovery resolves after a connect from S1–S3 (PRD S3 "After connect").

**Phase 2 (9 Nov 2026, cmdkfi/app still `47fd4fb`).** S1–S3 are built against live reads only.
- *S1:* reads the live market at one pinned block. That gives the oracle value, "about N USDC" at the configured target, borrow APY from `borrowRateView`, and a liquidity warning in place of the estimate when the market cannot lend the full amount. Each failed read shows as unavailable.
- *S2:* draws the corridor from `config.json`, with liquidation from the live LLTV. The acknowledgement gates S3.
- *S3:* detects MetaMask and switches network with the add-chain values from config. Contract wallets are blocked; EIP-7702 delegated accounts are allowed (Q2). The funding check wraps only the missing WETH and needs one transfer's gas when the wallet already holds WETH. The S3a faucet panel polls every 10 s and closes itself when funds arrive. Create position stays visibly disabled with the Phase 3 reason.
- *Discovery:* applies D4: the newest vault numbered from `guided.firstVaultNumber` (10). Vaults below the cutoff are dropped after discovery, and their read failures are ignored. The chosen vault is classified with no history scan (Q1): `setup`, `ready` (deposit step), `deposited`, `active`, `active-idle-usdc` (S4 withdraw only with a local record) or `liquidated`. The previous-app compatibility path (multi-vault position scan, `unusable`/unrepairable setup, older-vaults note) was removed on the product owner's direction. Any uncertain read in the cutoff range fails discovery with Retry. The landing table re-runs when discovery resolves after a connect from S1–S3, and only moves the user when a vault needs S4/S5. A local record never overrides chain state.
- *Shell:* not mounted below 960 px (FR-16).
- *New code:* three read modules (`market-quote`, `wallet-funding`, `setup-facts`); existing protocol modules are unchanged. `fixture.ts` is unchanged; the extra RPC behaviour lives in `e2e/guided-fixture.ts`.
- *Build warning (item 4):* `main` shows the same `node:worker_threads` warning from `ox`.
- *Results:* typecheck, unit tests, build, bundle boundary and Playwright desktop; numbers in the phase report.

**Phase 2b (9 Nov 2026, cmdkfi/app still `47fd4fb`).** The protocol client in `app/src/protocol/` is new, written from cmdkfi/app: `near/rpc.ts`, `near/vault.ts`, `owner/message.ts`, `relayer/client.ts`, `base/abi.ts`, `base/reads.ts`, `base/math.ts`, `base/activity.ts`, `evidence/verify.ts`, `wallet/tx.ts`. Every export cites the protocol file it mirrors.
- *ABI sources:* every fragment is copied from Solidity (`Interfaces.sol`, `Executor.sol`, `TestToken.sol`) or from the agent's selector list (`chain.rs`). The one exception is `WETH.deposit()`, which comes from `scripts/rebalance_pool.py` l.349 (WETH9 predeploy). A test checks the selectors against the ones pinned in `chain.rs` and `evm.rs`.
- *Math* mirrors `CorridorMath.sol` and `VERIFY.md` §2.1. The VERIFY.md worked example passes to the wei.
- *Vectors:* 31 ported as data in `protocol/vectors.mjs`, plus the pinned selectors; each names the old test or source it came from. V29 and V33–V35 are inline in the `flow/` tests with their sources named. V2 (setup without a measurement) is covered by the config parser refusing a missing measurement. The vectors include:
  - owner-message bytes generated by `p2_owner.py`'s own `json.dumps` formula
  - the live `app-compose.json`, whose sha256 = the recorded compose hash
  - a live `view_access_key_list` response for v1
- *Folded in:* Phase 2's `market-quote`, `wallet-funding` and `setup-facts` now live in `base/reads.ts` and `base/math.ts`. `discover` scans v<count> down to `firstVaultNumber` and stops at the owner's newest vault, so nothing below the cutoff is read.
- *Product decisions applied:*
  - Setup complete = authorization present, both allowances > 0 (the relayer's rule), both corridors set, measurement approved.
  - A setup message always sends `approve: true` and derives only `authorize` from Base. This was a product correction; the Phase 2 rule was wrong for used USDC allowances.
  - S1 shows a simple APR.
- *Boundary:* the `ProtocolAdapter` interface is trimmed to what S1–S3 use. `flow/` no longer imports `protocol/`; the live adapter is its only consumer, and the boundary test enforces this.
- *Deleted:* all 20 modules moved from `main`, the 3 folded modules, `e2e/fixture.ts`, `guided-fixture.ts` and `data.ts`. `shortAddress`, `connectionError` and `accountKind` are re-created in `flow/`, `useNow` in `components/`. `e2e/live-fixture.ts` is written fresh with its own ABI copies; it added a browser test for the 4902 add-network path.
- *Vite* is pinned to 8.3.5; the lockfile change is one line.
- *Live read:* S1–S3 against Base Sepolia, NEAR testnet and the relayer, through a read-only provider exposing the published test wallet. Every figure was live. The live market can lend only 13 USDC right now, so S1 shows the R2 warning for a 0.1 ETH deposit.
- *Not ported:*
  - raw signed-transaction validation, cancellation, NEAR receipt or `tx` recovery, transcripts, execution proofs (FR-6, §6)
  - `discovery-state`, `vault-read-state`, `position-table-state` (D4 cutoff; the query cache keeps the last snapshot)
  - activity attribution by caller, replaced by event name
  - `remainingSellBudget`, re-derived in Phase 4 from `CorridorMath.remainingBudget`
  - `protectionStatus`: Phase 4 defines it from `/agent/vaults` fields only, not from the old 60-second tick rule

**Phase 2b follow-up (9 Nov 2026): standard libraries where they exist.**
- The Base L1 fee now uses viem's OP Stack `estimateL1Fee` at the manifest's GasPriceOracle address. The `getL1Fee` fragment is removed. The `WalletFunding` shape is unchanged.
- ERC-20 uses viem's `erc20Abi`; its `transfer` selector is still checked against `vault/src/evm.rs`.
- Units use viem `parseUnits`/`formatUnits`, behind our own validation (V8 still applies).
- `@morpho-org/blue-sdk@8.0.1` (with `morpho-ts@4.0.1`, both three weeks old) is a test-only oracle. `math.test.mjs` cross-checks `accrue`, `toAssetsUp`, collateral value and LTV against `MathLib.wTaylorCompounded`, `MathLib.mulDivDown`/`mulDivUp` and `SharesMath.toAssets`, alongside the VERIFY.md vectors. The boundary test fails if the SDK appears in app code.
- Hand-rolled pieces carry a comment saying why: WETH `deposit()`, NEAR view calls, hash router, step reducers.
- Lockfile: adding the SDK changed no resolved version. It added 3 packages; pnpm also recomputed peer-context suffixes on 54 existing lines.

**Phase 3 (9 Nov 2026, cmdkfi/app still `47fd4fb`).** S4 onboarding is built as the approved design.
- *Structure:* a pure step model (`flow/onboarding.ts`), lock reconciliation (`flow/lock.ts`) and storage (`flow/onboarding-record.ts`). The record is keyed `factory:owner` with the vault inside; the lock is keyed `vault:owner`. One runner (`components/useOnboarding.ts`) is the only place S4 calls adapters.
- *Chaining:* after Create position, the five prompts (setup, wrap, transfer, open, withdraw) are requested in order, one at a time. After a reload, reads reconcile on their own and nothing prompts until Continue.
- *Owner calls (FR-6, reworded in the PRD):*
  - Sign `owner_nonce + 1` with an expiry of NEAR time + 600 s; re-read `owner_nonce` after signing.
  - Follow the job (FR-5 schedule, "Still waiting" after 180 s), then two receipt confirmations, then the step's chain check.
  - A lost job or uncertain POST resolves from `owner_nonce` and NEAR time only.
- *Create:* re-runs discovery before any repeat POST and adopts a vault that appeared meanwhile.
- *Gas refusal:* shows the relayer's text verbatim and offers the top-up ((need − have) × 1.25, 0.0001 ETH steps, minimum 0.0005 ETH). After it confirms, the same signed message is posted again while ≥ 45 s valid; otherwise a new signature is requested.
- *Open:* re-reads feeds (R1) and liquidity first. It opens below target with a 1% margin when the market can't lend 50%, pauses under 1 USDC, and pauses with the new figure when more than 2 points below what S1 showed (Q1). S1's warning adds "Deposit up to N ETH to open at 50%". S1 is prefilled with 0.01 ETH (your on-disk PRD edit).
- *Withdraw:* done = job done and idle USDC below `usdcDust`.
- *Adapter additions*, each citing its protocol source: `readVault`, `readNearTime` (new `near/rpc.finalBlockTime`), `readWalletTokens`, `readOpenPlan` (new `base/math.openTargetLtv`, `feedsFresh`), `readReceipts`, `createVault`, `ownerCall`, `readJob`, `composeOwnerMessage`, `checkOwnerSignature`, `walletTx`, `fundsShortfall` (new parser of `relayer.py` l.814-819) and `readAgentRegistration`. WalletAdapter is unchanged.
- *Fixture:* `e2e/live-fixture.ts` gained relayer jobs and owner-call effects. It checks that the signature recovers to the owner and that the nonce is `owner_nonce + 1`, applies the relayer's gas check with its exact text, and has lost-job, rejection and stale-feed knobs.
- *Not done:*
  - `eth_call` simulation of `Executor.open` before signing (left unticked)
  - a NearBlocks link (no URL in config)
  - a browser test of an account switch mid-flow (the runner stops and re-keys on owner or chain change; that code path has no browser test)
- *Closed at acceptance (product owner, 9 Nov):* the `Executor.open` simulation is removed (relayer prechecks plus the feed and liquidity reads cover the known reverts; a Base revert after the NEAR call resolves through the nonce rule into a re-sign); the account-switch browser test moves to Phase 7; the NEAR hash on paused steps is not needed; the NearBlocks link is added in Phase 4.
- *Results:* typecheck, 103/103 unit tests, build, bundle boundary, 27/27 Playwright desktop; the 8 onboarding scenarios also passed 3× repeated. No live signed rehearsal (Phase 7).

**Phase 4 (9 Nov 2026, cmdkfi/app still `47fd4fb`; `git diff HEAD -- docs tasks` empty at start).** S5 is built from live reads only.
- *Adapter methods* (each cites its source in `adapters/types.ts`): `readPosition` (Morpho `position`/`market`, `Executor.corridors`, `closedForAgent` l.67, `soldInWindow` l.453, grouping of `_activeCollateral` l.504-517, `CorridorMath.remainingBudget` l.67-75), `readAgent` (`/agent/vaults` row of agent/src/main.rs l.1029-1034 and vaults.rs l.215-222, `view_access_key_list`, vault `get_state.agent` lib.rs l.539-557), `readActivity` (Executor events l.80-97 and ERC-20 `Transfer` in 10,000-block windows from `executorDeployBlock`).
- *New ABI fragments:* `soldInWindow(address,address)` (selector `03e29885`) and `closedForAgent(address,bytes32)` (`91dea56f`), both pinned in agent/src/chain.rs l.1004-1005 and checked by the selector test. Both decoded against the live Executor on Base Sepolia (block 56643763).
- *Pure rules* in `flow/position.ts`: `agentState`, `currentMarket`, `backupStatus`, `budgetFor`, `positionVariant`, `describe`.
- *Fixture:* head block, block timestamps per number, `eth_getLogs` filtered by address/topics/range (refuses windows over 10,000 blocks), `soldInWindow`, `closedForAgent`, `/agent/vaults` rows, a Base outage knob.
- *Differences from PRD S5, by the Phase 4 scope:* recent actions cover block windows (10,000 per step) rather than "last 20 events"; the market card does not show the oracle source; the closed variant's Start over is Phase 5.
- *Results:* typecheck, 112/112 unit tests, build, bundle boundary, 31/31 Playwright desktop; the 4 S5 scenarios also passed 3× repeated.

**Phase 5 (9 Nov 2026, cmdkfi/app still `47fd4fb`).** `git diff HEAD -- docs tasks` at start showed your PRD S5 update (block windows, Transfer label, no market-id explorer link, migration rule, oracle source and freshness). During the phase you added PRD §9 "Reads and caching" and the todo "Phase 5b — Performance pass" on disk (found by the diff before this note); they are not started here and wait for "start Phase 5b".
- *Oracle line (first item):* `guided-values.mjs` now carries `base.chainlink` (address, description) from `deployments/testnet.json` into `config.json`; the market card matches the Executor's configured feeds by address. Live read at block 56650232: ETH / USD (maxAge 1200 s, updated 277 s before the block) and USDC / USD (maxAge 86400 s).
- *Runner:* the Phase 3 owner-call machinery (prompt, receipts, job polling, lock reconciliation, refusal top-up, Retry) moved unchanged into `components/runner.ts`, generic over step id and record; the 8 onboarding scenarios passed on it before any close code ran, and 3× afterwards.
- *Adapter method:* `readClosePlan(app, vaultId, owner)` (relayer.py l.72 and l.516-529 for the need; Morpho accrual via `base/math.debtAt`; Executor.close l.226-240 for what is pulled). Intents extended: `close {market}` (vault/src/lib.rs l.356-359, `closeArgs`), `withdraw` with token WETH or USDC (lib.rs l.360-368), wallet `transfer` with token USDC. `VaultView.markets` carries `borrowShares`; `PositionMarket.feeds` carries the feed names. No new ABI fragment.
- *New math:* `repayNeed` (debt + debt // 100) and `debtAt` (shares at Morpho totals accrued to a given time).
- *Resolver:* `closing` (unfinished close record) keeps S5 at every step: after `close` the WETH waiting at the position address would otherwise read as "deposited" (S4 open step).
- *Fixture:* the relayer's close precheck with its exact refusal text, close/withdraw-by-token effects, USDC wallet transfers, manifest feed names.
- *Differences from PRD S7, by your Phase 5 decision:* Start over goes to `#start` with 0.01 ETH and then through S3 ("Deposit") to S4 at the wrap step; the PRD S7 line still says "S4 at the deposit step (choose the amount there)". Not edited.
- *Not covered by a browser test:* the R10 second transfer (unit-tested only) and the relayer's close refusal (the fixture has it; no scenario reaches it because the shortfall always covers the need).
- *Results:* typecheck, 121/121 unit tests, build, bundle boundary, 37/37 Playwright desktop; close and onboarding specs 3× repeated (42/42).

**Phase 5b (9 Nov 2026, cmdkfi/app still `47fd4fb`).** `git diff HEAD -- docs tasks` at start: your PRD S7 update only; unchanged during the phase.
- *Item 3 decision (product owner, during the phase):* an unfiltered address-array query was measured at 4,208 logs / 2.7 MB per window; the window is now two topic-filtered queries in one JSON-RPC batch. PRD §9 item 3 and this todo item are reworded accordingly.
- *Measured live* (Base Sepolia via base-sepolia-rpc.publicnode.com, NEAR via rpc.testnet.near.org, relayer.cmdk.fi; vault v9 of the live factory, two markets, read with the live ProtocolAdapter from node; the cutoff lowered to 1 for the measurement only, because no live vault is numbered 10 or higher):

  | | before | after |
  |---|---|---|
  | one S5 refresh (position + agent) | 39 HTTP requests (36 Base, 2 NEAR, 1 relayer), 3.8–4.0 s | 6 HTTP requests (3 Base, 2 NEAR, 1 relayer), 3.5–4.5 s |
  | first full S5 after connect, first visit (discovery, static data, position, agent, activity) | 85 requests, 13.0 s | 17 requests, 10.0 s |
  | first full S5 after connect, return (remembered vault, saved snapshot and activity) | — | 11 requests, 6.8 s; the saved snapshot paints as soon as discovery resolves |

- *Where the time goes:* each NEAR RPC request to rpc.testnet.near.org took 3.1–3.2 s (get_state and view_access_key_list alike), against 0.1–0.25 s for Base and 0.1–0.7 s for the relayer. A refresh needs one NEAR get_state before the Base reads, so it stays near 3.5 s with this endpoint whatever the request count. Choosing another NEAR testnet RPC in `config.app.json` is a product decision (the agent uses the same URL, agent/src/main.rs l.57); not changed here.
- *Close plan:* no longer polled every 30 s on S5 (it is a full live snapshot plus wallet balances and would break the refresh budget); read when S5 shows and again on Close position, and the review sheet waits for that read.
- *Fixture:* real Base heights (head 30,000,100; Multicall3 exists from block 1,059,647), Multicall3 aggregate3 and getEthBalance, address arrays in eth_getLogs, a request log per host, a Base delay knob.
- *Dependencies:* `@tanstack/react-query-persist-client` and `@tanstack/query-sync-storage-persister` 5.105.2 (pinned to the installed react-query; lockfile +39 lines, additions only).
- *Results:* typecheck, 127/127 unit tests, build, bundle boundary, 40/40 Playwright desktop; performance, position, close and onboarding specs 3× repeated (63/63).

**Phase 5b follow-up — NEAR RPC (9 Nov 2026).** `nearRpcUrl` = https://test.rpc.fastnear.com, `nearRpcUrlFallback` = https://near-testnet.drpc.org. Every NEAR call the app makes is a read; the fallback is asked only after a retryable failure of the primary (no answer or timeout, HTTP 5xx, 429), never after a NEAR error answer. The relayer GET rule falls back only on no answer; NEAR adds 5xx and 429 because a rate-limited or failing NEAR node is common and the reads are idempotent. Unit test for each case; a browser check reads discovery and S5 through the fallback with the primary down.

| live, vault v9, same script as 5b | rpc.testnet.near.org (5b after) | test.rpc.fastnear.com |
|---|---|---|
| one S5 refresh | 6 requests, 3.5–4.5 s | 6 requests, 0.44–0.70 s |
| first full S5 after connect, first visit | 17 requests, 10.0 s | 17 requests, 1.8 s |
| first full S5 after connect, return | 11 requests, 6.8 s | 11 requests, 1.05 s |

Per NEAR call (get_state, view_access_key_list): fastnear 0.08–0.15 s, drpc 0.10–0.32 s, rpc.testnet.near.org 3.1–3.2 s.

**Phase 6 (9 Nov 2026, cmdkfi/app still `47fd4fb`; `git diff HEAD -- docs tasks` empty at start).** The §6 panel is built on `evidence/verify.ts` as it exists.
- *Adapter method:* `readVerification(app, vaultId)` → `VerificationFacts`, five checks each settled on its own with its time: published manifest (help.manifest; vault/src/attest.rs l.15-22), app-compose.json bytes and the `/agent/` index entry (agent/MEASUREMENT.md l.99; agent/src/serve.rs l.105-114, l.142), `/agent/vaults` row (agent/src/main.rs l.1029-1034), `view_access_key_list` (vault/src/lib.rs l.46, l.498-503), `view_account` against the factory `get_config().code_hash` (vault/factory/src/lib.rs l.152; scripts/reproduce-hash.sh l.122-125). The old `readAgentRegistration` (S4's registration line) is removed; the panel's registration row replaces it. No new ABI fragment.
- *Pure rules:* `flow/verification.ts` `verificationRows`.
- *Registration row before setup:* register_agent needs an approved measurement, so with no approval and no agent row the row says it waits for the setup step instead of "Registering (usually a few minutes)" (found on the live v9 read).
- *Live read-only run* (readVerification + rows, fastnear): v1 — all five live rows Checked (compose hash 216124c1e33e…, registered until 13 Nov), 0.86 s; v9 (no setup) — rows 1–4 Not checked, code Checked, 0.22 s.
- *Fixture:* raw-GitHub manifest route (published measurement knob), `/agent/` index and `/agent/evidence/app-compose.json` (outage knob); the fixture's approved compose_hash is the SHA-256 of the bytes it serves.
- *PRD §6 "Implementation" line* still names the previous app's modules (`agent-evidence.ts`, `near-security.ts`); the panel uses `evidence/verify.ts`. Not edited.
- *Results:* typecheck, 133/133 unit tests, build, bundle boundary, 45/45 Playwright desktop; verification, performance and onboarding specs 3× repeated (48/48).


**Phase 7b (10 Nov 2026, cmdkfi/app `d4e22f1`; `git diff HEAD -- docs tasks` empty at start and, apart from this phase's own edits, before this note).**
- *Protocol re-check:* origin/main moved one commit past `47fd4fb`: `d4e22f1` (cloud/ only). The Worker now funds the agent key every minute, and `/agent/evidence/<file>` is cached for an hour. A failed agent read is tried twice with a 20 s limit, then answered with the last good copy and its `Age`. `Age` is not in `Access-Control-Expose-Headers`, so the browser cannot see that a copy is stale. The agent list's own `last_tick_unix` is what dates it. No change to ABIs, `scripts/relayer.py` or `agent/`. *Correction (Phase 7c):* during the phase main moved on to `22a5191` (4171c10 agent NEAR RPC failover, 2c696b7 compose pin, 22a5191 manifest db4f5085 with v1 and v4 re-approved), and the refreshed manifest came from it; this note's "d4e22f1" was the commit at the start of the phase.
- *Live finding:* during the phase the agent moved to image `4171c10` (boot 2286af92, compose `db4f5085`), as main's manifest says. The local `deployments/testnet.json` (gitignored) still had `216124c1` and was refreshed from main. The rehearsal vault v10 approved `216124c1`, so the running agent does not watch it; it still holds the previous boot's key, valid until 16 Nov.
- *1 Agent status:* chain first. Order of checks:
  1. The vault's `approved` against the published manifest (agent/src/vaults.rs l.8-9, l.82-87).
  2. The recorded key and its expiry (vault/src/lib.rs l.490, l.555).
  3. The NEAR key list.
  4. The agent's list, read on its own, which adds liveness or "has not caught up yet".

  Its "revoked" counts only when the chain has no key, or when the agent reports another key (logic.rs l.653-669). New states, per the product owner during the phase: **Outdated** (stale approval) and **Not approved** (none). Unavailable is kept for failed reads only. The panel's registration row uses the same rules.

  A read-only live run (fastnear + relayer.cmdk.fi) gave: v1 and v4 Active; v10 Outdated; v9 Not approved (used as test input only; it is below the cutoff and never shown).
- *1a Setup guard:* right before the setup prompt, `config.agent.measurement` is compared with the runtime manifest. If they differ, the step pauses with retry `check`.
- *Entry, read-only (asked by the product owner):* an empty vault with a stale approval is `setup` (`setupComplete` needs approved = config measurement, adapters/live/protocol.ts l.94), so S4 re-approves it. A vault with a **position** and a stale approval is classified `active` first (flow/active-vault.ts l.23-24) and lands on S5, which now shows Outdated but offers no re-approve action. A fix would touch `classifyVault`, the S0 table and S5 (a setup-only chain on the shared runner). Not changed; for the product owner to decide.
- *2 Recent actions:* one row per transaction. Token legs that share a transaction with an Executor event fold into its row (`actionRows`, Executor.sol l.172-376, l.612-618).
- *3 Verification:*
  - Static rows read **Statement**.
  - "Checked at" appears only for Checked and Mismatch; Not checked and Unavailable rows read "Last tried at".
  - A registered row without `registration_tx` says so and points to the vault's access keys on NearBlocks.
- *4 S5:*
  - One disclaimer (the footer).
  - The close sub-line uses two decimals.
  - The sell budget reads "no position" with zero collateral.
  - Recent-action USDC amounts already had two decimals; a unit test now covers every event.
  - Recent actions end at the position read's block and are extended on every position refresh: only blocks after the confirmed part are read, and older windows are reused. One refresh is now 8 requests: + 1 log batch (logs follow the position block) + 1 manifest read (the agent card's approval check).
- *5 Checking…:* the step shows the reason (relayer status and text, lost job, lost answer), the expiry and an m:ss countdown on NEAR's clock. The POST timeout is 60 s; GET stays at 12 s. A fixture `answer-503` mode replays the rehearsal's close attempt.
- *6 Show USDC in MetaMask:* `wallet_watchAsset` with the config USDC address and the token's own `symbol()`/`decimals()`. Placement (product owner): a wallet line on S5, the wallet-slot menu, and the S4 withdraw row while S4 is still shown.
- *7 Copy:*
  - "Registering (usually within a few minutes)."
  - The rehearsal file's expectations follow the 7b wording, and its results table and recorded values come from the recorded run (blanks kept where nothing was recorded).
  - PRD S4 step 2 and 3 and S5 agent card text are aligned with the decisions above.
- *Results:* typecheck, 142/142 unit tests, build, bundle boundary, 56/56 Playwright desktop. The onboarding, position, verification, performance and close specs passed 3× repeated (105/105, before the Outdated, Not approved and 1a tests were added).

**Phase 7c (10 Nov 2026, cmdkfi/app `22a5191`; `git diff HEAD -- docs tasks` empty at start, and only this phase's own edits before this note).**
- *Protocol re-check:* main is at `22a5191`, three commits past `d4e22f1`:
  - `4171c10`: the agent's NEAR RPC failover (agent/src/near.rs, main.rs)
  - `2c696b7`: the compose pin
  - `22a5191`: manifest measurement db4f5085, with v1 and v4 re-approved by the test wallet; DEPLOY.md says v3, v6 and v10 are watched again once they approve.

  No change to ABIs, `scripts/relayer.py` or `cloud/`. The local manifest equals main.
- *Rule:* `approveAction` (flow/position.ts): only for an active position with no close running. Outdated offers "Approve current agent version"; Not approved offers "Approve agent". Unit test over every state and variant.
- *Call:* `useApprove` (components/useApprove.ts) is a one-step chain on the shared runner. Its intent is `setupIntent`, now shared with S4 (runner.ts; S4's setup uses the same function), so it has the same `setupArgs` and the same 1a guard. With no lock, the guard also runs before the "already on chain" check, so a config behind the manifest never reads as Done.
  - Done = the vault's `approved` equals the baked measurement, which the guard matched with the manifest right before signing.
  - The record is kept in memory; the durable part is the owner lock (`lockKey`, method `approve`). After a reload the card rebuilds the step from the lock as Checking… and prompts nothing.
  - Close position waits while a re-approval is pending, since there is one owner call per vault.
- *Fix found by the browser test:* after Done, the card re-read the NEAR `get_state` answer that S5 shares for 5 s, from before the approval, so it still said Outdated. A chain's live `readVault` now replaces the shared answer (adapters/live/protocol.ts).
- *S0:* `classifyVault` is unchanged. The PRD S0 row for an active position notes that re-approval happens on S5, and PRD S5's action line names the button.
- *Fixture:* `vault({ agentKey })` and an old approved measurement.
- *Browser tests:*
  - Outdated → button → one `setup` signature (`approve: true`, the published measurement) → Done → Registering → Active after the agent registers
  - Not approved → "Approve agent"; a relayer 503 → reload → Checking… again from the lock, one signature and one POST
  - the 1a guard on S5
- *Results:* typecheck, 143/143 unit tests, build, bundle boundary, 59/59 Playwright desktop; the 7c scenarios passed 3× (9/9).
  - The first full run had 1 failure: "reload at each prompt step". Its snapshot shows "Checking your vaults…" after the 4th reload when the 30 s test timeout hit.
  - The machine's load average was 35–45, with a VM at 160 % CPU. 12 repeats on 4 workers failed 2× the same way. Alone it passes in 16.2 s; in 7b it took 12.8 s.
  - 7c adds no code to S4's reload path. The second full run passed 59/59. The test's 30 s budget for five reloads is tight under load; not changed.

**Phase 8 (10 Nov 2026, cmdkfi/app `22a5191`, unchanged; `git diff HEAD -- docs tasks` empty at start; before this note only this phase's own edits).**
- *Timing first (product owner):* "reload at each prompt step" alone at d8d2fe6: 11.9 s, 11.0 s, 11.2 s (load average about 5; 7b had 12.8 s), so 7c did not slow the S4 reload path. During this phase the full suite failed it twice more at the 30 s test timeout with load averages up to 22. Back to back alone, with the same tree stashed and restored: d8d2fe6 17.9 s and 15.9 s, Phase 8 14.0 s and 14.9 s. The time tracks the machine's load, not the code. That one test now has a 60 s budget, with a comment: it does five full reloads plus 5 s of fixed waits.
- *8a (live defect of 10 Nov):*
  - Right after a connect or a silent reconnect, the shell requests the switch to Base Sepolia once per connection. wagmi's `switchChain` adds the chain from `config.network` on a 4902. A later chain change is left to the action that needs the chain.
  - The runner never returns silently on the wrong chain. Continue, every Retry kind and a new chain (Create position via S4, Start closing, the S5 re-approval) request the switch themselves, and the run continues once the wallet reports Base Sepolia.
  - While the wallet stays connected to another chain, the active step is paused with "Switch to Base Sepolia in your wallet." and a **Switch to Base Sepolia** button (new retry kind `switch`). Back on the chain, the line gives way to the step's own state; it continues by itself only if the user acted, otherwise it waits for Continue (FR-5a).
  - Close position and the re-approval button are no longer disabled on another chain; their chains request the switch.
- *Wallets (PRD S3, FR-3):*
  - The wagmi config is `injected()` plus EIP-6963 discovery (one connector per announced wallet, with its name and icon); no connect-modal library.
  - `walletOptions` (adapters/live/wallet-options.ts, pure, unit-tested) lists the announced wallets plus `window.ethereum` only when no announced provider is that object (compared by identity).
  - S3 "Connect wallet" shows the list, or "Install a wallet" (`help.metamaskInstall`, MetaMask by default) when there is none.
  - The header has no Connect button; the slot appears from "Connecting…" on.
  - `WalletState.walletName` carries the connector's name, and every "MetaMask" in copy now names the connected wallet ("Waiting for Rabby Wallet…", "Show USDC in Rabby Wallet"), or "your wallet" for an unnamed provider.
  - The contract-wallet block (ecrecover) is unchanged.
- *Fixture:* `walletSet` announces MetaMask and/or Rabby over the same fake account, with `'legacy'` for an unannounced `window.ethereum` and `[]` for no wallet. `walletVia` records which provider each request came through. `rejectSwitch` refuses the switch.
- *Tests, unit:* the wallet list rule and the name fallback.
- *Tests, browser:*
  - no header button or slot before connecting
  - three wallets listed, connecting with the second one (its provider and name)
  - an announced `window.ethereum` listed once; no wallet → Install a wallet
  - connect on the wrong chain → switch requested once (refused → the slot offers it); 4902 → add-network values right after connect
  - connect on the wrong chain → the chain runs to S5
  - reload on the wrong chain with the switch refused → the line and button, a refused click keeps them, then the chain runs
  - a chain change mid-flow → the line, and Switch continues
- *Results:* typecheck, 145/145 unit tests, build, bundle boundary, 65/65 Playwright desktop (load average 29 during the run); the Phase 8 scenarios and the wallet-slot tests passed 3× repeated (27/27).
- *Docs:* PRD S3, scope, FR-5a, §8 and acceptance wording say "wallet"; the S3 heading is "Connect wallet". The README says any injected wallet. The rehearsal file has the second recorded run and the S3 step for Phase 8.

**Phase 9 (10 Nov 2026, cmdkfi/app `22a5191`, unchanged; `git diff HEAD -- docs tasks` empty at start; before this note only this phase's own edits).**
- *Stylesheet:* `app/src/styles/cmdk.css` is `docs/mockups/cmdk.css`, with the same selectors and values, scoped to `.vault-app`. Colours go through the tokens of `prototype-controls.css`, so the light variant still works, but it was not checked by eye. It replaces `shell.css`, `screens.css` and `ltv-track.css`. A named section holds the inline layout styles of the artboards (`page`, `split-14`, `cols-3`, …). A second marked section holds states no artboard draws: the wallet menu, step pauses and the Why details, the desktop gate, unavailable values, the dialog backdrop. The font stays CmdkReference.
- *Markup:* every screen follows its artboard.
  - Shell: header `.header/.brand/.chip`, `main` at 960 px for S1–S3 and 1120 px for S4–S7.
  - S1: the catalogue surface with token tiles, then the amount surface (input, then rows).
  - S2: the corridor scaled to the liquidation LTV, three list surfaces, the acknowledgement notice.
  - S3: facts in rows plus the action in one surface, with the `.help` aside for S3a. The wallet list (no artboard) uses the tile style.
  - S4: steps in a surface on the 1.4fr side, the verification rail on the 1fr side. Steps use the `.step` grid with ✓ when done. Checks use `.check` with status tags.
  - S5–S7: a split head with Close position / Start over on the right; three `.big` figures, the corridor surface, agent and market cards with rows and tags, `.event` rows; S6 has the steps beside the Get test USDC `.help` aside; the review sheet is `.sheet`.
  - No copy, flow rule or protocol code changed. Element roles kept for the tests: tiles stay list items, the help panels are `aside` (complementary), and the agent state is the card's status tag with the detail under it.
- *Screenshots:* `e2e/visual.spec.ts`, 12 states: S1, S2, S3 wallet list, S3 connected, S3a, S4 with a declined prompt and the rail, S5, S0 wallet menu, S6 Get test USDC, S6 review sheet, S7 closed, S5 liquidated. The clock is frozen at the fixture's NOW, UTC and en-US, animations off, tolerance `maxDiffPixelRatio` 0.01.
  - A 1280×2200 viewport instead of `fullPage`: a full-page capture resizes the viewport, the shell unmounts below 960 px (FR-16), and the first baselines caught "Connecting…" and a review sheet that had closed.
  - Baselines are per platform (`e2e/__screenshots__/{platform}/`): darwin for local runs, linux for `frontend quality` and `deploy testnet`. `pnpm test:visual:update` rewrites darwin. Linux comes from a new job in `frontend quality`, run by hand with `visual_baselines: true` (same runner, Node, pnpm and steps as the checks; a new workflow file could not be dispatched from a branch, because GitHub requires a hand-run workflow to exist on the default branch), whose artifact is downloaded with `gh run download`, reviewed and committed (product owner's choice). Producing them in Docker here failed: amd64 emulation in a 4 GB Docker VM shared with about ten other containers got the install killed for memory, then ran each test for about 44 s until it failed.
- *Fixed on review of the baselines:* the address box's Copy button wrapped onto two lines.
- *Artboard details that conflict with a PRD rule (not resolved; the app follows the PRD):*
  1. The artboards load Inter from Google Fonts. PRD §9: no third-party fonts; §7: CmdkReference.
  2. S0 draws a **Connect wallet** button in the header when not connected. PRD S0 and FR-3 (10 Nov): no Connect button; the slot appears only once connected.
  3. S7: "Starting over creates a new vault and position address", and a row "Older vaults of this wallet v3". PRD D5 reuses the empty vault; D4 never reads or shows vaults below the cutoff.
  4. S4 draws "Agent registration" as step 3 and the WETH deposit as one step with 4a wrap and 4b transfer. The PRD S4 table says the same, but the app has six steps (wrap and transfer separate, registration in the rail) since Phase 3. Not changed: it is a flow change, for the product owner to decide.
  5. S4 prints each Why line inline. PRD S4: "an expandable Why line". The app keeps `<details>`.
  6. S4's verification tags read "Registering", "Not yet", "Info", "Out of scope". PRD §6 statuses: Checked, Mismatch, Unavailable, Not checked, and Statement since Phase 7b.
  7. S5 links the market id to BaseScan. PRD S5: no explorer page exists for a Morpho market id; the links go to the Morpho and Executor contracts.
  8. S5 "Key expires in 6 days · renews automatically" is a promise the app does not make. The app shows the expiry date from the chain.
  9. S5 lists "Registered on your vault … NEAR tx" in Recent actions. PRD FR-10: the list comes from Base logs only.
  10. S6 shows the review as a notice under the steps; PRD S6 has a review sheet before the first signature (kept). S6 also puts the amount in step 1's title ("Send 81.14 USDC…"); the app's titles are fixed.
  11. S3 shows "Connect MetaMask" and "Try in sandbox". Superseded by PRD S3 (10 Nov); the sandbox is Phase 6b.
- *Artboard text the app does not have (not added: no copy changes in this phase):*
  - S4 head tag "Step 4 of 6 · waiting for MetaMask"
  - S5 "Risk corridor" heading with the oracle line beside it (the oracle stays in the market card)
  - the line under the LTV figure; the agent card's "May do" row; the market card's Venue/Pair split and live tag
  - the S6 summary rows above the steps
  - S7's "Left at position address" figure and its explanatory "Start over" section
  - S1 "Borrow rate … / year" (the app says APR, PRD S1)
- *Unused components:* `PrototypeControls.tsx`, `VerificationDisclosure.tsx` and `TokenIcon.tsx` were already unused before this phase; their old CSS is gone with `screens.css`.

**Phase 9 baselines (10 Nov 2026).** The first linux set showed an S1 defect macOS hid: with Linux font metrics, the amount input's intrinsic width pushed the input box into the estimate column. Fixed in `cmdk.css` (`.input input{width:0;flex:1}`, `.stack{min-width:0}`; 9da2437); the darwin images did not change. Second run's linux set reviewed screen by screen against darwin: same states (S5 connected, review sheet open, S4 paused with the rail, S6 with Get test USDC), font hinting differs only. The app serves no light theme (`main.tsx` pins `data-theme="dark"`), so no light captures; the light tokens in `prototype-controls.css` are unused. Product owner decisions on the conflicts (10 Nov): CmdkReference stays; the PRD wins on all eleven; the six S4 steps stay and the PRD S4 table is corrected in Phase 10; the frozen artboard copy ("Step N of 6", "Risk corridor", the agent card's "May do" row, the S6 summary rows) is added in Phase 10; the S7 extra figure is skipped.

**Phase 6b (10 Nov 2026, cmdkfi/app `22a5191`, unchanged; `git diff HEAD -- docs tasks` at start: only the sell-budget copy fix the product owner asked for that turn).**
- *Sell-budget copy (product owner, first):* the 20% per rolling day budget limits discretionary sells only. `Executor.reduce`'s protective branch sells `repayToLtv` to target, with no clamp, and is not recorded (`Executor.sol` l.261-266, l.296; `agent/src/logic.rs` l.174, l.472-474; discretionary branch l.270-290). Changed:
  - S2's paragraph and its "can never" item
  - S5 "Discretionary sell budget left today"
  - PRD fact 4a, S2 and FR-2
  - a lesson
- *Engine* (`adapters/sandbox/engine.ts`):
  - One in-memory state, advanced by the clock when read (no timers), kept in sessionStorage.
  - Stages take 2 s; the agent registers 5 s after setup; the owner_nonce + 1 rule and one owner call at a time apply.
  - Wallet transactions confirm after 1 s. The scripted −30% move comes 20 s after open, and the protective reduce 5 s later uses `repayToLtv` to 50% (product owner: not budget-limited, not counted; the S10 artboard's figures are superseded).
  - Unit tests: the `repayToLtv` vectors, stages and the nonce rule, the drop and reduce (peak between 71% and 72%, after between 49% and 50%, more than 40% sold), the close.
- *Adapters* (`adapters/sandbox/index.ts`, `config.ts`):
  - Every ProtocolAdapter and WalletAdapter method over the engine.
  - The config is built in memory from `config.app.json` through `guidedValues` with simulated addresses; nothing is fetched.
  - The sandbox wallet is "Sandbox wallet", connected from the start, with 10 ETH and 5,000 USDC.
  - A new boundary test: `adapters/sandbox` never imports `adapters/live`, `protocol/`, or wagmi/viem at runtime (probed with a violating file).
- *UI* (`components/Sandbox.tsx`):
  - "Try in sandbox" beside the S3 wallet list, in the no-wallet state, and as a header link while disconnected (product owner).
  - The S8 sheet (the PRD §8a sentences plus the artboard rows) and **Activate sandbox** (fresh state, 0.5 ETH, `#sandbox/start`).
  - The banner "Sandbox · simulated data · Leave sandbox"; S11 "Leave the sandbox? Simulated data is discarded." with Stay / Leave, which clears every `cmdk.sandbox.*` key and lands on `#start`.
  - Explorer links (`ExtLink`) disabled and tagged "simulated"; verification rows "Simulated (not checked)" (no check runs); prompts read "Simulated signature" / "Simulated transaction"; Show USDC hidden.
  - The same landing table and guards run in both modes.
- *Build:* the sandbox ships in every build (`VITE_SANDBOX=0` leaves it out); the bundle check's "no sandbox" rule is removed.
- *Found by the new browser test:* the TanStack persister wrote its live key (`cmdk.live.queries.v1`, empty) while in the sandbox. Its storage now ignores writes on `#sandbox` routes.
- *Found by the route test:* an alias redirect race. On `#sandbox/close`, App's canonical-hash effect, reading a stale hash, undid the guard's redirect, so `#sandbox/start` content showed under `#sandbox/position`. App now re-reads `location.hash`. Live routes have no alias, so only the sandbox showed it.
- *Browser:* `e2e/sandbox.spec.ts`. S3 → activate → S1 0.5 ETH → S2 → S3 → Create position → S4 with simulated rows → S5 → the drop and reduce (71.x% → 50%) → close → Start over → Leave. Across the run there were no new requests, wallet calls or hosts after activation, and no localStorage key was added. Also: the header entry, the no-wallet entry, a reload that stays in the sandbox, and Stay in the leave sheet. Screenshots of S8, sandbox S1 with the banner and S11 were added (15 states).

**Phase 10 (10 Nov 2026, cmdkfi/app `22a5191`, unchanged; `git diff HEAD -- docs tasks` empty at start).**
- *PRD S4:* the table now lists the six steps the app runs (create, setup, wrap, transfer, open, withdraw). Agent registration is described as the verification rail's row, and the head shows "Step N of 6".
- *Frozen copy, added (product owner):*
  - the S4 tag
  - "Risk corridor" over the LTV track (the oracle line stays in the market card)
  - "May do: Reduce · migrate to backup · exit · never increase your debt on this venue" (from config's migrate/exit flags; PRD fact 7)
  - the S6 rows "Debt incl. interest (fresh read)", "Relayer headroom (1%, returned as leftover)", "USDC at position address", "USDC in your wallet", "Still needed" (= the transfer's shortfall). The close plan is now re-read every 10 s while a close runs, for "fresh read".

  Browser assertions for each.
- *Layout fix found on the new baselines:* a long row value made its key wrap ("May / do"). Row keys no longer shrink below their width, capped at 55%.
- *Docs:* the PRD status line names the implemented state and the rechecked commit; I checked that vault/, executor/ and scripts/ are unchanged between `47fd4fb` and `22a5191`. The audit status has a 10 Nov header, the rehearsals as done, and the product owner's review of the preview as pending. The README names the rechecked commit and the new counts.
- *Merge:* not done; it waits for the product owner's explicit word (PR #80).

**Before merge (10 Nov 2026, product owner's live review passed: sandbox, v10, fresh wallet v11).** One fix: the sandbox setup emitted a single `CorridorSet` (live market), so recent actions showed "Rules set on the live market" only, while the live setup sets the corridor on both markets in two Base transactions and shows two rows. The engine now emits one event per market, each with its own transaction hash (`adapters/sandbox/engine.ts`, vault/src/lib.rs l.289-320). Covered by the engine unit test and `e2e/sandbox.spec.ts`. The screenshot baselines are unaffected (no sandbox recent actions in them).

**Phase 11 (11 Nov 2026, cmdkfi/app `22a5191`; the product owner's §8a.1 and this phase committed first, 906a331; `git diff HEAD -- docs tasks` empty before this note except the README/audit sentence and these ticks).**
- *Morpho source:* morpho-org/morpho-blue `430bd61` (main): `ConstantsLib.sol` l.11 `LIQUIDATION_CURSOR = 0.3e18`, l.14 `MAX_LIQUIDATION_INCENTIVE_FACTOR = 1.15e18`. `Morpho.sol` `liquidate`: l.365-369 is the incentive factor, l.377-379 the seized amount for a repaid amount (`wMulDown(LIF).mulDivDown(ORACLE_PRICE_SCALE, price)`), l.390-396 bad debt. `_isHealthy` is l.527-539. Read with `gh api`, not from memory.
- *Engine:*
  - No timed events remain (`DROP_AFTER_OPEN_MS` and `REDUCE_AFTER_DROP_MS` removed; storage key v2 discards a v1 tab state).
  - `crashRun()` / `crashNext()` give three stages (×0.70, ×0.55, ×1.00 of the price when run). After each price move the protective reduce runs (`repayToLtv`, unchanged). Beside it is the pure `withoutAgent()` with Morpho's health check, incentive and seize, capped at the collateral.
  - The run is once per position; every open resets it.
  - The adapter exposes `crash.read/run/next` as an optional `ProtocolAdapter.crash`; the live adapter has none.
- *Figures:* the unit tests assert the §8a.1 numbers exactly from the bigint math:
  - repay 481.5 USDC, sold 0.214285714285714285 WETH, LTV back to exactly 50%
  - seized 0.474473334466156896, kept 0.025527 WETH ($45.067328)
  - stage 3: $81.940596 without; $917.142857 / 321 USDC / $596.142857 with
  - LIF 1.043841336116910229
- *Card (`screens/MarketCrash.tsx`, copy in `flow/crash.ts`):*
  - Placed above the Agent and Market cards (after the LTV track) on an open sandbox position that is not closing.
  - Rows accumulate (Open, 1, 2, 3) in the two columns; the summary line comes after stage 3; Done leaves the finished tag and the table, with no button.
  - The honesty line shows once.
  - Close position stays enabled at every stage. The card disappears while a close runs and after it; Start over plus a new open offers the run again.
  - *Rounding:* the card rounds to the precision §8a.1 prints (0.286, 0.026, $82), so its copy is the PRD's verbatim. Everywhere else the app truncates (`flow/format.ts`). With the fixed clock of the screenshots, the hero reads 320.99 USDC (truncated; the debt is a hair under 321) beside the card's 321 USDC.
- *S8 sheet:* the §8a.1 sentence is added. The Agent row "Scripted: one price drop, one reduce" (not PRD copy, and now wrong) reads "Simulated; acts in the market crash you run".
- *After a mid-run close:* the sandbox price stays where the run left it. Start over opens the new position at that price, and its crash starts from there (the intro's "falls 45% and recovers" is relative, so it stays true).
- *Tests:*
  - 8 new unit tests: 4 engine tests (no timer, exact stages, interest, close mid-run and Start over) and 4 copy tests (each string as §8a.1).
  - Browser: the full run with both columns per stage, the `Reduced` row, the hero at 63.6%, the summary, Done and the finished card, still with no network request and no localStorage. A new scenario covers Close position at stage 2, Start over, and the crash offered again.
  - Two screenshots (before the run, at stage 3) from an engine state seeded at the frozen clock; the S8 baseline was updated for its new copy.

**Phase 11 follow-up (11 Nov 2026, product owner's acceptance with two changes).**
- *One format:*
  - The card now formats every number with the hero's formatters. `usdcText`, `wethText` and `dollarText` are exported from `flow/format.ts` and used by the hero, Recent actions and the card. The card's own rounding is removed, and the price uses the hero's dollar format (`$1,765.5`).
  - The copy tests compare against engine values formatted with those functions.
  - The browser run checks that the card's with-the-agent collateral, debt and LTV equal the hero's text.
  - PRD §8a.1 notes that its figures are approximate prose. Lesson added.
- *Start over:*
  - In the sandbox, Start over resets the price to $3,210 before it navigates. This is `crash.resetPrice()` on the sandbox adapter; the engine refuses it while a position is open, and the live adapter has no `crash`, so it does nothing there. The quote is re-read, so S1 shows "about 802.5 USDC" again.
  - Engine test: after a close at stage 2, the reset and a new open run the §8a.1 stages. Browser test: after Start over, S1 shows 802.5 USDC and the new run opens at $3,210 and falls to $2,247.
  - Noted in PRD §8a.1.
- *Left as is:* a stage row is a snapshot. If the user waits minutes, the live hero's debt can move past the snapshot's last cent.

