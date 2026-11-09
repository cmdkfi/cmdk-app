# Protocol/frontend audit status — guided flow, 2026-11-09

Source: cmdkfi/app `47fd4fb` (origin/main, rechecked at every phase). Branch `feat/guided-flow` replaces the cockpit with
the guided flow of `docs/prd-guided-flow.md`; it was written from the protocol repository, not ported from the cockpit
(lessons 9 Nov: the old code is documentation). Checks: 135 Node unit tests, 49 desktop browser scenarios against the
controlled fixture (run three times), a production-bundle check (no fixture markers, no sandbox), and read-only live
checks against Base Sepolia, NEAR testnet and the relayer. **No live signed rehearsal has been done yet**
(Phase 7). "Implemented" below means source plus those checks; no failure was induced
with a funded wallet.

| Cockpit finding | In the guided flow | Why |
|---|---|---|
| F01 recovery | **Survives, reduced.** One pending owner intent per vault and owner (lock record); a lost job or uncertain POST is resolved from the job, the vault's `owner_nonce` and NEAR time only; a signed message is never posted twice automatically; a refusal before sending keeps the lock and re-sends only while ≥ 45 s valid (PRD FR-6). **Dropped:** raw-transaction recovery, held-transaction cancellation (`cancel`), exact-call rebroadcast, NEAR-receipt reconciliation. | Product owner, 9 Nov: the guided flow reacts to the relayer's deterministic answers instead of reconstructing raw Base transactions; FR-6 states "no raw-transaction, NEAR-receipt or cancellation handling". |
| F02 read failures / unknown deployment | **Survives.** A failed refresh keeps the last snapshot read-only with its block and age; a snapshot from an earlier visit paints as "refreshing" and never decides an action (FR-9, §9). Markets of the vault that are not in the session's static data are read live. | — |
| F03 quote outages | **Changed.** The oracle-independent recovery panel is dropped. S1 shows a failed oracle or IRM read as unavailable. The close does not need the oracle; it needs the IRM rate for the amount to send and pauses with the reason when the rate cannot be read. | Guided flow has one action on S5 (Close position, D3); no separate recovery panel. |
| F04 reapproval / revoke | **Changed.** The setup signature approves the published measurement when the vault has not; a separate approve/revoke control is dropped. The verification panel shows whether the approved values equal the published manifest. | Scope of the guided flow (PRD §6, D3). |
| F05 account eligibility | **Survives.** Contract wallets are blocked with the reason; EIP-7702 delegated accounts are allowed (product owner, Phase 2). | — |
| F06 free funds | **Changed.** Idle WETH, USDC and ETH at the position address are shown on S5; the close repays from idle USDC first and returns WETH and leftover USDC in its last steps. Separate repay, withdraw and reopen-from-free-funds actions are dropped. | D3: one action, Close position. |
| F07 verification | **Survives as PRD §6:** approved measurement vs published manifest, app-compose.json SHA-256 vs approved compose hash and the `/agent/` index, agent registration, limited agent key, vault code vs factory; static rows for the relayer's lack of authority and what is not checked (TDX quote, PCCS, RTMR replay). **Dropped:** boot-file browsing, transcript checks, execution verification. | PRD §6 scope (product owner, 9 Nov). Independent TDX verification remains outside the browser. |
| F08 agent limits | **Survives.** Floor, target, trigger and the market's liquidation LTV on the S5 track; remaining daily sell budget from `Executor.soldInWindow`; backup-market status by `Executor.migrate`'s preconditions. The corridor is fixed (`config.app.json`), not editable. | Fixed rules for the testnet prototype (FR-2). |
| F09 activity | **Changed.** Base logs only: Executor events by the position address and WETH/USDC transfers, 10,000-block windows with "Load earlier", the covered range stated, confirmed logs kept in the browser. **Dropped:** NearBlocks NEAR history, decoded owner intents, the transcript viewer. | FR-10: Base logs are the source; agent transcripts are not used for the list. |
| F10 agent health | **Changed.** The agent card shows registration, status, key expiry and the agent's last check from `/agent/vaults`, plus the NEAR key check; no transcript-derived snapshot. Not presented as a heartbeat. | Product owner, 9 Nov: status from `/agent/vaults` fields only. |
| F11 zero collateral with debt | **Survives.** "Position liquidated" with the remaining debt, no recovery promise, no actions. | — |
| F12 create/setup lifecycle | **Survives.** Resumable onboarding record, setup derived from Base facts (approve always, authorize per executor, corridor where unset); **strengthened** in Phase 7: creation is guarded by a fresh ownership read before every `/create-vault` POST, and an owned vault is adopted. **Dropped:** "create another vault". | D4 (one position per wallet), D5 (an empty vault is reused). |
| F13 identity/icons | **Changed.** The market is named live or backup with its market id prefix and the oracle feeds by name; S1 tiles use letters, not token icons. | Guided-flow design (PRD S1). |
| F14 selected vault | **Dropped.** One vault per wallet: the newest numbered from the cutoff (10). Vaults below the cutoff (made by the cockpit) are not used. | D4 / R8 (product owner, 9 Nov). |
| F15 review / risk navigation | **Changed.** A review sheet before the first close prompt; contextual risk actions dropped. | D3. |
| F16 gates / scaling | **Survives, changed.** `frontend quality` runs build, unit tests, the bundle boundary and the browser scenarios. Browser coverage is desktop Chromium only (the app is not mounted below 960 px, FR-16). Reads are batched (one S5 refresh is 6 HTTP requests) and NEAR uses FastNEAR with a drpc fallback. | Mobile dropped by the product owner (Phase 1). |
| F17 documentation | **Survives.** README rewritten for the guided flow (Phase 7). | — |

### Pending

- **Live signed rehearsal** on Base Sepolia with a real MetaMask (script: `tasks/rehearsal-2026-11-10.md`, Phase 7 step 3): open with 0.01 ETH, close with a faucet claim, Start over. Fixes from it come before anything else.
- **Sandbox (Phase 6b).** Not built and not in any production build: `#sandbox/…` goes to `#start`, the stub adapter is not bundled, and the bundle check fails on any "sandbox" string. The adapter interface and the route seams stay in source behind the `VITE_SANDBOX=1` build flag. Work starts only after the rehearsal is done and its fixes are committed.
- **Protocol paths not exercised live:** relayer refusals other than the gas check, a lost job, the R10 second transfer, migration to the backup market. They are covered by the controlled fixture only.

## Historical: cockpit audit ledger — 2026-11-08 (superseded by the guided flow)

Kept as evidence of what the replaced cockpit implemented and checked; the status above is current.

Source: cmdkfi/app at `672f1ff702b12307b1df31d10b27d9599b7765dd` (rechecked against protocol main `47fd4fb`; relevant contracts/relayer unchanged, evidence proxy added). Frontend integration includes PRs #50–#71 and the #68 follow-up. This ledger supersedes the original findings as a status report; it does not erase their historical evidence.

“Implemented” means source and relevant automated/read-only browser checks pass. It does not mean every failure was induced with a real funded wallet. No new owner signatures or transactions were performed for this audit follow-up.

| Finding | Implementation and checks | Remaining gap |
|---|---|---|
| F01 recovery | Exact persisted owner intent; finalized NEAR-result and signed Base identity checks; nonce reconciliation; expired unused intent handling; direct reverted transaction unlocking; recovery helper tests (#50, #61, #69, #70). | Held cancellation now has an explicit one-nonce review, exact NEAR proof, durable nested intent, lost-job recovery and confirmed nonce reconciliation. Legacy records lacking exact intent can still require operator reconciliation. A live signed cancellation rehearsal remains outstanding. Never clear these locks blindly. |
| F02 unknown deployment | Owned registered markets remain visible read-only; market failures isolated (#52). | Vault-wide failures now retain a same-vault last-successful snapshot explicitly read-only, keeping the inspection drawer mounted; no outstanding source-level hiding defect identified; migration/unknown-executor transaction was not induced live. |
| F03 quote outages | Oracle-independent recovery panel reads ownership, registered parameters, borrow shares and balances; tests exclude oracle/IRM reads (#66). | Signed outage-path transaction remains unexecuted in QA. |
| F04 reapproval | Separate measurement approval and factual setup repair (#54, #58); #68 also repairs positive limited allowances. | Revoke/reapprove live cycle remains unexecuted in QA. |
| F05 account eligibility | Creation checks supported owner account before POST (#51); wallet/account tests. | Contract-wallet creation intentionally unsupported by current owner-signature model. |
| F06 free funds | Free USDC/WETH and gas reserve; wallet/vault repayment source; close/release and reopen from free funds (#53, #55, #63). | Additional owner-funded reopen variants were not signed in this audit. |
| F07 verification | Actual NEAR code/factory hash and restricted key checks, approved/published measurement, Base policy, explorer/copy controls (#53). | Verification now exposes current published-boot files, bounded SHA-256/byte checks, rollover detection, registration/key and info.json measurement comparisons. Partial: independent TDX quote signature, collateral/TCB and RTMR replay verification remain outside the browser; hash/index consistency is not that verification. |
| F08 agent limits | Actual Floor, migration/exit permissions, shared executor budget/window/session and cooldown (#53, #60). | No remaining display omission identified; policy failure stays explicit. |
| F09 activity | Grouped Base operations, Executor repayments, decoded NEAR owner intents and signed-call correlation; separate hash-checked agent transcript viewer (#57, #65). | Verification now uses the allowlisted boot evidence route and hash-checked transcript history. Agent attempts have explicit FINAL NEAR / signed Base hash / receipt checks; a transcript alone never proves execution. Historical scan scope remains visible and can be extended on demand. |
| F10 agent health | Position refresh and stale observation expiry (#59, #62). Copy explicitly describes a recent loop observation. | Last successful published snapshot and execution attempt now come from hash-checked transcripts, with timestamps, secondary-RPC/read/disagreement errors and explicit earlier-history scanning. No new agent field is needed. Failed ticks can end without writing a transcript; neither transcript age nor last_tick is continuous health proof. |
| F11 zero collateral debt | Explicit critical state distinguishes debt without collateral value from empty/no-debt and RPC failure (#52). | Extreme state covered mathematically; not created in user vault. |
| F12 create/setup lifecycle | Resumable tracked creation, create another, owner-bound state and factual setup repair (#51, #58); Q14 shared/independent rules (#71). | New vault + partial setup should receive another signed end-to-end rehearsal when the user is present. |
| F13 identity/icons | Token-address icon mapping; collateral-first Morpho names and backup identity (#64, #71). | No remaining known defect. |
| F14 selected vault | Explicit selection preserved in details navigation (#51). | Multi-owner browser rehearsal still useful; no extra vault was created for QA. |
| F15 review/risk navigation | Explicit pre-sign review (#55), contextual risk-reducing actions, review/Cancel keyboard focus, touch controls and mobile filter sizing (#68). | Contextual high-risk buttons reviewed in source; current live vault is empty, so that branch was not demonstrated with real debt. |
| F16 gates/scaling | PR build/TypeScript/tests (#56); obsolete demo components removed (#67); deduplicated reads, timeout/rate-limit handling (#59). Current suite: 79 Node tests and 42 desktop/mobile browser cases. | 42 controlled browser cases now cover wallet connection, recovery and Edit rules on desktop/mobile Chromium; they run before merge and deployment. Partial: this is not comprehensive cross-browser/live-extension E2E coverage. Factory enumeration is the supported protocol path (six vaults at the developer response); no owner-index API is required before the deadline. A server-side cached loop is a post-deadline optimization, not a current integration blocker. |
| F17 documentation | README describes actual React runtime, interest, routes, transactions and test limitations (#56, #67). Planning docs found in fffilimonov/prime, not missing protocol implementation. | Planning source: docs/04-app-requirements.md Q14 in prime; keep its role separate from deployed contract authority. |

### Next frontend work (cockpit era, historical)

1. Rehearse the implemented held-cancellation flow with the user when a genuine failed owner-call exists. Do not manufacture a failure or submit an unchanged intent to generate evidence. Protocol references: vault/src/lib.rs owner_call `cancel`; scripts/RELAYER.md failed/held jobs. Cancellation does not prove the original action never executed.
2. Extend the 42-case browser suite when new protocol flows land; add WebKit/real-extension coverage separately. Controlled RPC/wallet fixtures and 79 helper tests do not replace live signed rehearsals.
3. Rehearse changed signed flows with the user; do not submit unchanged rules merely to generate evidence.

### Note for Vadim (not sent, cockpit era)

- Factory discovery resolved by the developer: enumeration via count and per-vault get_state is supported. There is no owner index before the deadline; a cached GET /vaults?owner= loop in the relayer is an optional post-deadline optimization.
- Agent telemetry resolved through transcripts; no measured-agent change is required. Current source stores the chosen proposal at top level (also accept nested decision proposals). Snapshot gate checks read_errors, rpc_second_error and rpc_disagree; early failed ticks may not produce a transcript. sent or near_error is an attempt, not confirmation.
- Evidence route and frontend integration are now present. File SHA checks use a second boot-index read; comparisons to approved measurement/key are labelled separately from independent TDX verification. Vault get_state is current contract state, not a raw TDX evidence archive. NearBlocks Testnet remains the user-approved transaction-discovery source; RPC receipts remain execution authority.

The developer supplied these integration decisions. No contract or agent change is requested; missing evidence remains explicit. No message has been sent to Vadim.


### Verification hierarchy — 2026-11-08

The drawer now leads with registration, published snapshot age, execution-proof level and per-file SHA status. Snapshot/execution, boot files, registration/policy, account security, contracts/raw data and permissions are separate disclosures. Contract failures do not suppress agent evidence; source retries keep unrelated evidence available. The heading remains fixed while the body scrolls on desktop and mobile. All raw state, receipt checks, copy actions and revocation confirmation remain available.

Protocol cross-check: cmdkfi/app origin/main `47fd4fb`, `vault/src/lib.rs` registration/get_state, `agent/MEASUREMENT.md` evidence channel, `agent/src/main.rs` sent proposal and `agent/src/chain.rs` snapshot error fields. A published snapshot remains an observation, not a heartbeat; SHA consistency remains separate from independent TDX verification. No protocol transaction or financial calculation changes. Existing motion is preserved; this task introduces no motion-token or animation changes.


### Verification interaction refinement — 2026-11-08

Registration, Agent activity and Evidence are now the three principal disclosures, with right-side chevrons and source/count labels. Advanced contains account security, contract/raw data and the unchanged permission/revocation flow. The fixed heading uses existing icon controls for refresh/copy; its link popover contains only explorer/transcript-index links, supports Tab/Escape and dismisses on outside interaction. NEAR failure recovery is compact and inline; raw error remains in Registration. Published snapshot ages use seconds/minutes/hours/days without an invented stale/healthy threshold. Exact timestamps remain in the activity details. File checks and receipt verification remain separate, with no protocol-write changes.

Design review applied Emil design foundations / touch-accessibility and the authenticated Design AI component and information-architecture examples (`https://ai.vlada.one/components.html`, `https://ai.vlada.one/information-architecture.html`): progressive disclosure, click-triggered link popover, visible recovery, modal focus containment and no hover-only actions. Disclosure toggles are immediate, including keyboard/reduced-motion; no motion fix is introduced. Protocol sources rechecked at cmdkfi/app main `47fd4fb`.


### Verification access during RPC/position failures — 2026-11-08

The public NEAR RPC returned HTTP 429 without an Access-Control-Allow-Origin header during live diagnosis, appearing as Failed to fetch in the browser. A separate frontend access defect hid Verification until a complete market snapshot loaded. Vaults now offers a read-only verification entry for its selected discovered vault, and the cockpit has a persistent vault-level inspection button independent of position loading. Existing market-specific verification remains available.

A direct `#verify?vault=<accountId>` route reads the public identity through the protocol-supported `GET /vault/<id>` (cmdkfi/app scripts/relayer.py vault_view and scripts/RELAYER.md), validates factory/account/response identity and addresses, and opens the same read-only panel without wallet discovery. The panel still independently reads NEAR registration and agent evidence; relayer identity is explicitly labelled and never substitutes for a successful registration check. Approval/revocation controls are not rendered in inspection mode. No trading, ownership-discovery or protocol transaction guards changed. Factory discovery itself still depends on its configured NEAR RPC; the direct route is independent of that owner scan.

Production-entry browser scenarios cover connected-owner access after initial market failure, no-wallet direct inspection during NEAR outage, retry after relayer failure and rejection of an unrelated returned vault. Earlier component-only checks did not prove this end-to-end access path.

### Vault discovery and position-read recovery — 2026-11-09

Protocol source checked at cmdkfi/app origin/main 47fd4fb: vault/factory/src/lib.rs exposes count and deterministic one-based vault IDs; vault/src/lib.rs get_state supplies ownership. Discovery continues that supported loop; there is no owner index, invented relayer endpoint or new RPC fallback.

Discovery limits concurrent reads to two, retries transient transport/server errors once and respects RPC Retry-After (60 seconds conservatively when unavailable). Visible-page recovery is bounded to three attempts. A failed or partial scan is never an empty portfolio and never offers creation. Previously verified identities remain in memory only for the same owner/factory, explicitly stale and limited to read-only inspection. Successfully rechecked ownership changes remove the old identity. Position refresh failures similarly retain only a source-matched last complete snapshot, disable protection claims and route rows to inspection until a complete read recovers.

Regression coverage includes initial outage/recovery, owner change, partial ownership reads, rate-limit cooldown, exhausted retry budget and last-complete position recovery on desktop/mobile. Controlled browser fixtures are isolated from the production bundle and perform no on-chain writes. Upstream RPC availability is not guaranteed by this change; persistent failure remains visible with manual retry. Existing protocol transaction and ownership guards are unchanged.
