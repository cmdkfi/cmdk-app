# Guided flow — action plan

## Start here (for the implementation session)
1. Read `AGENTS.md` (protocol repo rule), `tasks/lessons.md`, then `docs/prd-guided-flow.md` in full, then this file.
2. Mockups: canvas https://claude.ai/artifact/88dCh3D6TAgkirFhEjRhmp, sources in `docs/mockups/` (see its README).
2b. The previous app (`main` branch) is documentation only: read it for protocol facts and test vectors, never import from it (PRD §8b).
3. Protocol repo cmdkfi/app is cloned at `/Users/vf/cmdk/app`; PRD facts were checked at commit `47fd4fb` (= origin/main on 9 Nov 2026). Run `git fetch` there and re-check before each phase (R12).
4. Toolchain: Node 22, pnpm 11.7.0; `deployments/testnet.json` is fetched from cmdkfi/app main (gitignored) before `pnpm build`; see README "Development".
5. Work on this branch (`feat/guided-flow`), one PR per phase. Do not commit or push without being asked. Ask before starting each phase.

PRD: `docs/prd-guided-flow.md`. Phase 0 is closed (decisions D1–D11 resolved; two non-blocking questions for Vadim remain). One PR per phase into `feat/guided-flow`; the branch merges into `main` only after Phase 7.

## Phase 0 — Decisions and protocol confirmations (blocking)
- [x] D1 wrap: inline "Wrap ETH → WETH" action on the deposit step (product owner, 9 Nov). WETH is mandatory: Morpho Blue markets are ERC-20 only, Executor takes no native value.
- [x] D3 close: single "Close position" action with a manual USDC transfer to the position address when it is short (product owner, 9 Nov).
- [x] D11 chaining: signatures are requested automatically in sequence, not as separate user steps (product owner, 9 Nov).
- [x] Checked: migration between the two Morpho markets needs no borrow permission (`Executor.migrate` is atomic via flash loan). Cross-venue (Aave) or cross-chain moves would need a new bounded open-debt permission: protocol roadmap item for Vadim, not v1 frontend.
- [x] D2: yes, borrowed USDC is withdrawn to the wallet as the last chained prompt (product owner, 9 Nov). D4–D10 on adopted defaults. Full flow confirmed: come → connect → create vault, deposit WETH, get USDC → repay → close.
- [x] Gas model question withdrawn (product owner, 9 Nov): the app does not predict relayer refusals; it reacts to the relayer's 400 with a top-up step (FR-8, D7).
- [ ] (non-blocking) Vadim: confirm `/agent/vaults` is the intended source for "registering / registered / active" and its latency bound (minutes to ~15 min observed in code).

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

## Phase 6b — Sandbox mode (after the live flow is stable, before or after merge as decided then)
- [ ] Sandbox `WalletAdapter`: in-memory account, balances, instant signatures/transactions with fake hashes, scripted rejection toggle.
- [ ] Sandbox `ProtocolAdapter`: state machine create → setup → open → scripted price drop → agent `Reduced` → close; stage timers 1–3 s; simulated interest and feeds; activity list and verification rows marked "Simulated".
- [ ] UI: Try in sandbox entry on S3, no-MetaMask state and wallet-slot menu; explainer sheet with Activate (prefills 0.5 ETH, lands on `#sandbox/start`); persistent banner; wallet slot "Sandbox wallet"; disabled hash links tagged simulated; Leave sandbox confirmation (Leave / Stay) in banner and wallet menu; `#sandbox/…` routes mirroring every live route; `sessionStorage` only.
- [ ] Scripted scenario: ~20 s after open, −30% price → LTV ≈71% → simulated agent `Reduced` within the cooldown → LTV 50%; visible interest accrual; closed → Start over creates a new simulated vault instantly.
- [ ] Guard: live adapters are never constructed while the sandbox is active (unit test); fixture's unexpected-request guard proves zero network calls in sandbox (browser test).
- [ ] README and `docs/audit-status.md`: state why a labelled, isolated sandbox is acceptable after demo routes were removed.

## Phase 7 — Verification of the whole (before merge)
- [ ] Extend `e2e/fixture.ts`: `eth_sendTransaction` (wrap, WETH/USDC transfer, ETH top-up) with receipts and balance mutation, `wallet_addEthereumChain`, 4902 on switch, faucet-credit hooks (R11).
- [ ] Playwright (desktop project): happy path S1→S5 against `e2e/fixture.ts` (fake MetaMask, NEAR/Base/relayer fixtures), reload-resume at steps 2, 5, 6, rejection at each signature, relayer 400 and 404 job, close flow with and without shortfall, wallet short of USDC with faucet panel and auto-resume after the fixture credits USDC, wallet without Base Sepolia ETH with faucet panel and auto-continue, 4902 add-network prompt values, verification mismatch, desktop gate, no-MetaMask, one-click chaining (no page clicks between Create position and the position screen).
- [ ] Update `e2e/harness.tsx` mounts for the new components; keep "unexpected request fails the test".
- [ ] Browser test of an account switch mid-onboarding (moved from Phase 3): the runner stops, re-keys the record to the new owner and prompts nothing until Continue.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:bundle-boundary`, `pnpm test:browser` green locally and in `frontend quality` CI on the PR.
- [ ] Live rehearsal on Base Sepolia with a real MetaMask and a fresh wallet holding ≥0.015 ETH: deposit the default **0.01 ETH** (≈10–11 USDC of debt; live market liquidity was 66 USDC free on 9 Nov after the top-up, backup 17 USDC); record vault id, every job id, tx hashes, elapsed time per step, gas used; confirm ≈10 USDC in the wallet and a Morpho position at ≈50% LTV; then full repay-and-close (one Circle faucet claim of 20 USDC covers the shortfall); then start over. Save notes in `tasks/rehearsal-<date>.md`.
- [ ] Live rehearsal with a wallet that owns an old-app vault: lands on S5 with correct numbers and events.
- [ ] Copy review against README honesty constraints (PRD §1 item 15): testnet, unaudited, not insurance, no "verified" without result, submitted ≠ done.
- [ ] Preview deploy: run `deploy testnet` via `workflow_dispatch` from `feat/guided-flow`; smoke test on testnet.cmdk.fi (CORS, config.json, fonts, one full read of an existing vault).
- [ ] Update `README.md` navigation/transactions sections for the new flow; update `docs/audit-status.md` with what was dropped and why.
- [ ] The product owner approves; merge `feat/guided-flow` → `main` (deploys automatically).

## Mockups
- [x] Screen mockups prepared 9 Nov 2026 as a Design canvas: https://claude.ai/artifact/88dCh3D6TAgkirFhEjRhmp (12 artboards: S0 entry and navigation, S1 choose, S2 settings, S3 connect + get ETH, S4 progress + verification, S5 position, S6 close + get USDC, S7 closed, S8 sandbox entry, S9 sandbox progress, S10 sandbox position, S11 leave sandbox). PRD §7 is the visual source; the canvas is the layout reference for Phases 2–6 and 6b.
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

