# Protocol/frontend audit status — 2026-11-08

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

## Next frontend work

1. Rehearse the implemented held-cancellation flow with the user when a genuine failed owner-call exists. Do not manufacture a failure or submit an unchanged intent to generate evidence. Protocol references: vault/src/lib.rs owner_call `cancel`; scripts/RELAYER.md failed/held jobs. Cancellation does not prove the original action never executed.
2. Extend the 42-case browser suite when new protocol flows land; add WebKit/real-extension coverage separately. Controlled RPC/wallet fixtures and 79 helper tests do not replace live signed rehearsals.
3. Rehearse changed signed flows with the user; do not submit unchanged rules merely to generate evidence.

## Note for Vadim (not sent)

- Factory discovery resolved by the developer: enumeration via count and per-vault get_state is supported. There is no owner index before the deadline; a cached GET /vaults?owner= loop in the relayer is an optional post-deadline optimization.
- Agent telemetry resolved through transcripts; no measured-agent change is required. Current source stores the chosen proposal at top level (also accept nested decision proposals). Snapshot gate checks read_errors, rpc_second_error and rpc_disagree; early failed ticks may not produce a transcript. sent or near_error is an attempt, not confirmation.
- Evidence route and frontend integration are now present. File SHA checks use a second boot-index read; comparisons to approved measurement/key are labelled separately from independent TDX verification. Vault get_state is current contract state, not a raw TDX evidence archive. NearBlocks Testnet remains the user-approved transaction-discovery source; RPC receipts remain execution authority.

The developer supplied these integration decisions. No contract or agent change is requested; missing evidence remains explicit. No message has been sent to Vadim.


### Verification hierarchy — 2026-11-08

The drawer now leads with registration, published snapshot age, execution-proof level and per-file SHA status. Snapshot/execution, boot files, registration/policy, account security, contracts/raw data and permissions are separate disclosures. Contract failures do not suppress agent evidence; source retries keep unrelated evidence available. The heading remains fixed while the body scrolls on desktop and mobile. All raw state, receipt checks, copy actions and revocation confirmation remain available.

Protocol cross-check: cmdkfi/app origin/main `47fd4fb`, `vault/src/lib.rs` registration/get_state, `agent/MEASUREMENT.md` evidence channel, `agent/src/main.rs` sent proposal and `agent/src/chain.rs` snapshot error fields. A published snapshot remains an observation, not a heartbeat; SHA consistency remains separate from independent TDX verification. No protocol transaction or financial calculation changes. Existing motion is preserved; this task introduces no motion-token or animation changes.
