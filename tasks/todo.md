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
- [x] Step 1 create: `/create-vault` once, job polling, 429 countdown, uncertain POST or 404 job → discovery re-run and the appeared vault adopted before any repeat POST (only on user Retry). The vault id and position address are shown; a NearBlocks link is **not** added (no NearBlocks URL in config yet).
- [x] Step 2 setup: args from Base facts read by `readVault` (approve always true, authorize per executor, corridor where unset; Q4), sign, lock, `/owner-call`, job, receipts × 2 confirmations, then setup complete per fact 3.
- [x] Step 3 agent registration: `/agent/vaults` row + NEAR key list every 30 s, non-blocking, "usually a few minutes".
- [x] Prompt chaining (D11, FR-5a): five prompts in order, one at a time, pause on rejection with Retry.
- [x] Step 4: 4a wrap only the missing WETH, skipped when the wallet holds enough (FR-7); 4b transfer; receipts × 2 and balance predicates.
- [x] Step 5 open: `collateral_in` = WETH at the position address; feeds (R1) and liquidity re-read before the prompt; 1% margin; "opened below target (X%)"; pause under 1 USDC lendable; pause with the new figure when > 2 points below what S1 showed (Q1).
- [ ] Step 5: simulate `Executor.open` (eth_call) before signing — **not done**; the feed and liquidity reads cover the known revert causes (StaleFeed, insufficient liquidity). Decide in Phase 7 whether to add it.
- [x] Step 6 withdraw: all idle USDC to the owner; done = job done and idle USDC below `usdcDust`; skipped when none.
- [x] Reactive gas top-up (FR-8, D7, Q2): relayer refusal text verbatim, top-up (need − have) × 1.25 rounded up to 0.0001 ETH, min 0.0005 ETH, then the same signed message if ≥ 45 s valid, else a new signature.
- [x] Minimal reconciliation (FR-6, reworded in the PRD): lock keyed `vault:owner`; job → `owner_nonce` → NEAR time; "Checking…".
- [x] Failure UX: relayer `error` verbatim + one plain line; Retry labels say whether they re-send or re-sign; "Still waiting" with the job id after 180 s (FR-5). Paused steps show the job id; the NEAR transaction hash is not shown (not needed by the FR-6 rules).
- [x] S1 "Deposit up to N ETH to open at 50%" in the liquidity warning (Q1); S1 prefilled with 0.01 ETH.
- [x] Unit tests: resume step, record/lock storage and keys, job poll schedule, top-up amount, retry mode, 2-point rule, lock reconciliation table, open target LTV, feed freshness, refusal parser.
- [x] Browser: happy path (one click), reload at each prompt step without a prompt until Continue, rejection + Retry, gas refusal + top-up + same-message re-post, lost create job → adopted vault, lost owner-call job → owner_nonce, stale feed, Q1 accept-lower-LTV.

## Phase 4 — Position screen (S5)
- [ ] React Query polling of `readLivePosition` (30 s, paused when hidden); hero debt/collateral/LTV with segmented track; freshness line; stale snapshot kept read-only on error.
- [ ] Agent card status from `/agent/vaults` fields only (`registration`, `agent_status`, `expires_at`, `last_tick_unix`) plus the vault's `agent` and corridors; **not** the previous app's 60-second tick rule (product owner, 9 Nov). Remaining sell budget; Verify link.
- [ ] Market card: live vs backup from the market with debt; contract links.
- [ ] Recent actions from Executor logs (`topics[1] = base_address`) + token transfers; You/Agent labels; block range shown; "Load earlier".
- [ ] Idle balances line; liquidated state; closed state with Start over (D5).
- [ ] Unit tests: event labelling, market selection, closed/liquidated state derivation.

## Phase 5 — Close position (S6) and Start over (S7)
- [ ] Shortfall computation from fresh debt (accrued) × 1.01 vs idle USDC; USDC transfer step when short.
- [ ] Get test USDC panel (S6a, FR-17): exact missing amount, copy address, Circle faucet link with the "choose Base Sepolia" warning, CDP faucet as secondary, 10 s polling, auto-resume of the close chain.
- [ ] `close` signature with pre-sign review sheet; confirmation by `Closed` receipt and zero borrow shares.
- [ ] `withdraw` WETH, then leftover USDC > 0.01.
- [ ] Close record: when the close chain finishes, write the local record that makes S5 show the closed variant (`closeRecord` input of `flow/entry.ts`); "Position closed" is never derived from a discovered vault (D5 revised, 9 Nov).
- [ ] Start over (D5 revised): reuses the empty vault and goes to S4 at the deposit step; no `/create-vault` call. A new vault (with the 429 `Retry-After` countdown) only when the wallet owns none from the D4 cutoff.
- [ ] Unit tests: shortfall math, step gating, close record → closed variant, Start over → deposit step on the same vault.

## Phase 6 — Verification panel
- [ ] Checklist rows per PRD §6 using `measurementMatches`, `evidenceIndex`, `readBootFile` (app-compose.json SHA-256), `/agent/vaults`, `readNearSecurity`; manifest fetched from raw GitHub with `sourceCommit` shown; `Unavailable` on fetch failure. Nothing else from `agent-evidence.ts` (no transcripts, no execution verification).
- [ ] "What is not checked here" row and links to `agent/MEASUREMENT.md`, `scripts/RELAYER.md`.
- [ ] Unit tests: row status derivation for match / mismatch / unavailable.

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
- *Results:* typecheck, 103/103 unit tests, build, bundle boundary, 27/27 Playwright desktop; the 8 onboarding scenarios also passed 3× repeated. No live signed rehearsal (Phase 7).

