# Guided flow — action plan

## Start here (for the implementation session)
1. Read `AGENTS.md` (protocol repo rule), `tasks/lessons.md`, then `docs/prd-guided-flow.md` in full, then this file.
2. Mockups: canvas https://claude.ai/artifact/88dCh3D6TAgkirFhEjRhmp, sources in `docs/mockups/` (see its README).
3. Protocol repo cmdkfi/app is cloned at `/Users/vf/cmdk/app`; PRD facts were checked at commit `47fd4fb` (= origin/main on 9 Nov 2026). Run `git fetch` there and re-check before each phase (R12).
4. Toolchain: Node 22, pnpm 11.7.0; `deployments/testnet.json` is fetched from cmdkfi/app main (gitignored) before `pnpm build`; see README "Development".
5. Work on this branch (`feat/guided-flow`), one PR per phase. Do not commit or push without being asked. Ask before starting each phase.

PRD: `docs/prd-guided-flow.md`. Phase 0 is closed (decisions D1–D11 resolved; two non-blocking questions for Vadim remain). One PR per phase into `feat/guided-flow`; the branch merges into `main` only after Phase 7.

## Phase 0 — Decisions and protocol confirmations (blocking)
- [x] D1 wrap: inline "Wrap ETH → WETH" action on the deposit step (Vladimir, 9 Nov). WETH is mandatory: Morpho Blue markets are ERC-20 only, Executor takes no native value.
- [x] D3 close: single "Close position" action with a manual USDC transfer to the position address when it is short (Vladimir, 9 Nov).
- [x] D11 chaining: signatures are requested automatically in sequence, not as separate user steps (Vladimir, 9 Nov).
- [x] Checked: migration between the two Morpho markets needs no borrow permission (`Executor.migrate` is atomic via flash loan). Cross-venue (Aave) or cross-chain moves would need a new bounded open-debt permission: protocol roadmap item for Vadim, not v1 frontend.
- [x] D2: yes, borrowed USDC is withdrawn to the wallet as the last chained prompt (Vladimir, 9 Nov). D4–D10 on adopted defaults. Full flow confirmed: come → connect → create vault, deposit WETH, get USDC → repay → close.
- [ ] (non-blocking) Vadim: confirm the relayer gas model (gas table × min(2×basefee+prio, 2 gwei)) is stable enough for the frontend to predict refusals (FR-8), or expose a `GET /vault/<id>` field with the required ETH per method.
- [ ] (non-blocking) Vadim: confirm `/agent/vaults` is the intended source for "registering / registered / active" and its latency bound (minutes to ~15 min observed in code).

## Phase 1 — Branch and skeleton
- [ ] `git checkout -b feat/guided-flow` from `main`.
- [ ] Move pure protocol modules into `app/src/protocol/` unchanged (`near`, `near-rpc`, `near-security`, `relayer`, `positions`, `create-vault`, `vault-setup`, `initial-rules`, `live-actions` helpers, `owner-recovery`, `transaction-recovery`, `agent-evidence`, `activity`, `wallet`, `wallet-utils`, `protection-clock`, `verification-age`, `use-now`) with their `*.test.mjs`; fix imports; `pnpm test` green.
- [ ] Delete old screens and modules listed in PRD §8 with their tests; `pnpm typecheck` green.
- [ ] New `main.tsx`: providers, MetaMask-only wagmi config, hash router (`#start`, `#connect`, `#progress`, `#position`, and the `#sandbox/…` prefix), desktop gate (FR-16), theme.
- [ ] Entry resolver (PRD S0): wallet state + discovery + local onboarding record → landing screen; route guards; wallet-slot component with its five states and menu (Copy address, BaseScan, Disconnect / Leave sandbox); silent reconnect for returning users. Unit tests for the landing table.
- [ ] Adapter foundations (PRD §8a): `src/adapters/` with `WalletAdapter` and `ProtocolAdapter` interfaces, a live implementation wrapping wagmi and `protocol/*`, an `AdapterProvider` React context, and a stub sandbox implementation that compiles. No screen imports wagmi or `protocol/*` directly (lint rule or import test).
- [ ] Keep `styles/prototype-controls.css`, token icons, LTV track, header/footer shell; remove dead sidebar/table CSS.
- [ ] `pnpm build` and `pnpm test:bundle-boundary` green.

## Phase 2 — Choose, Settings, Connect (S1–S3)
- [ ] Catalogue tiles with enabled/disabled + "Coming soon" tag (FR-1).
- [ ] Amount input with min (D7), USD estimate and "about N USDC" from live oracle/IRM reads; "unavailable" fallbacks (never mock).
- [ ] Settings card from `config.json` with locked rows and explanations (FR-2); required acknowledgement checkbox.
- [ ] Connect screen: detect MetaMask, switch Base Sepolia, on 4902 add the network with the exact values from PRD Appendix C, EOA check, rejection keeps input, state in `sessionStorage` (FR-3).
- [ ] Get Base Sepolia ETH panel (S3a, FR-17): balance vs deposit + gas allowance, missing amount, copy address, faucet links from `config.app.json` `help`, 10 s balance polling, auto-continue.
- [ ] Add `help` block (faucet and docs URLs) to `config.app.json` and `scripts/generate-config.mjs`; unit test that all URLs are https and non-empty.
- [ ] Discovery after connect: `discoverVaults` + D4 rule → route to S5, resume S4, or "Create your position" (FR-4). Failed scan shows Retry, never "no position".
- [ ] Unit tests: active-vault selection (D4), amount validation, USDC estimate math.

## Phase 3 — Onboarding progress (S4)
- [ ] Step machine with persistence keyed `factory:owner:vault`; resume on reload; one active step.
- [ ] Step 1 create: `startCreateVault`/`readCreateJob`, 429 countdown, uncertain-POST handling, NearBlocks link.
- [ ] Step 2 setup: `repairSetupArgs` from `GET /vault/<id>` flags, sign, lock, `startSetupJob`/`readSetupJob`, receipts ×2 confirmations, verify flags/corridors after.
- [ ] Step 3 agent registration: poll `/agent/vaults`, non-blocking, honest latency copy.
- [ ] Prompt chaining (D11, FR-5a): automatic sequential MetaMask requests, one open prompt at a time, pause on rejection with Retry, no prompt on reload until Continue.
- [ ] Step 4 deposit to the position address: sub-state 4a wrap (`WETH.deposit()` for the missing amount, gas headroom check, skipped when wallet WETH suffices) then 4b `WETH.transfer(base_address, amount)`; confirm via receipt and position-address balance read.
- [ ] Step 5 open: `collateral_in` from the fresh WETH balance at the position address, `target_ltv` 0.5e18, simulate `Executor.open` before signing, feed-freshness error mapped to plain text; requested automatically after 4b.
- [ ] Step 6 withdraw USDC to wallet (if D2 = yes); requested automatically after 5.
- [ ] Conditional gas top-up step (FR-8) with cost model.
- [ ] Failure UX: relayer `error` verbatim, safe Retry only, "Needs manual check" with job id and NEAR hash otherwise.
- [ ] Unit tests: step predicates, resume logic, gas model, open argument derivation.

## Phase 4 — Position screen (S5)
- [ ] React Query polling of `readLivePosition` (30 s, paused when hidden); hero debt/collateral/LTV with segmented track; freshness line; stale snapshot kept read-only on error.
- [ ] Agent card from `protectionStatus` + `/agent/vaults`; remaining sell budget; Verify link.
- [ ] Market card: live vs backup from the market with debt; contract links.
- [ ] Recent actions from Executor logs (`topics[1] = base_address`) + token transfers; You/Agent labels; block range shown; "Load earlier".
- [ ] Idle balances line; liquidated state; closed state with Start over (D5).
- [ ] Unit tests: event labelling, market selection, closed/liquidated state derivation.

## Phase 5 — Close position (S6) and Start over (S7)
- [ ] Shortfall computation from fresh debt (accrued) × 1.01 vs idle USDC; USDC transfer step when short.
- [ ] Get test USDC panel (S6a, FR-17): exact missing amount, copy address, Circle faucet link with the "choose Base Sepolia" warning, CDP faucet as secondary, 10 s polling, auto-resume of the close chain.
- [ ] `close` signature with pre-sign review sheet; confirmation by `Closed` receipt and zero borrow shares.
- [ ] `withdraw` WETH, then leftover USDC > 0.01.
- [ ] Start over: D5 gate, `/create-vault` rate-limit countdown, new vault becomes active.
- [ ] Unit tests: shortfall math, step gating, start-over gate.

## Phase 6 — Verification panel
- [ ] Checklist rows per PRD §6 using `measurementMatches`, `evidenceIndex`, `readBootFile` (app-compose.json SHA-256), `/agent/vaults`, `readNearSecurity`; manifest fetched from raw GitHub with `sourceCommit` shown; `Unavailable` on fetch failure.
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
- [ ] Live rehearsal on Base Sepolia with a real MetaMask and a fresh wallet: record vault id, every job id, tx hashes, elapsed time per step, gas used; confirm USDC in wallet and Morpho position at ≈50% LTV; then full repay-and-close; then start over. Save notes in `tasks/rehearsal-<date>.md`.
- [ ] Live rehearsal with a wallet that owns an old-app vault: lands on S5 with correct numbers and events.
- [ ] Copy review against README honesty constraints (PRD §1 item 15): testnet, unaudited, not insurance, no "verified" without result, submitted ≠ done.
- [ ] Preview deploy: run `deploy testnet` via `workflow_dispatch` from `feat/guided-flow`; smoke test on testnet.cmdk.fi (CORS, config.json, fonts, one full read of an existing vault).
- [ ] Update `README.md` navigation/transactions sections for the new flow; update `docs/audit-status.md` with what was dropped and why.
- [ ] Vladimir approves; merge `feat/guided-flow` → `main` (deploys automatically).

## Mockups
- [x] Screen mockups prepared 9 Nov 2026 as a Design canvas: https://claude.ai/artifact/88dCh3D6TAgkirFhEjRhmp (12 artboards: S0 entry and navigation, S1 choose, S2 settings, S3 connect + get ETH, S4 progress + verification, S5 position, S6 close + get USDC, S7 closed, S8 sandbox entry, S9 sandbox progress, S10 sandbox position, S11 leave sandbox). PRD §7 is the visual source; the canvas is the layout reference for Phases 2–6 and 6b.
- [ ] Vladimir reviews the mockups; layout changes go back into the canvas before Phase 2 starts.

## Terminology
Vault = the NEAR account (contract, no keys). Position address = its Base address (`base_address`), the only place tokens are sent. Agent = restricted key for reduce/migrate/exit; it does not control the position address. See PRD "Terminology".

## Review notes
(high-level summaries are added here as phases complete)
