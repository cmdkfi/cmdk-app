# Protocol/frontend audit status — 2026-11-08

Source: cmdkfi/app at `672f1ff702b12307b1df31d10b27d9599b7765dd` (fetched again on this date). Frontend integration includes PRs #50–#71 and the #68 follow-up. This ledger supersedes the original findings as a status report; it does not erase their historical evidence.

“Implemented” means source and relevant automated/read-only browser checks pass. It does not mean every failure was induced with a real funded wallet. No new owner signatures or transactions were performed for this audit follow-up.

| Finding | Implementation and checks | Remaining gap |
|---|---|---|
| F01 recovery | Exact persisted owner intent; finalized NEAR-result and signed Base identity checks; nonce reconciliation; expired unused intent handling; direct reverted transaction unlocking; recovery helper tests (#50, #61, #69, #70). | Held cancellation now has an explicit one-nonce review, exact NEAR proof, durable nested intent, lost-job recovery and confirmed nonce reconciliation. Legacy records lacking exact intent can still require operator reconciliation. A live signed cancellation rehearsal remains outstanding. Never clear these locks blindly. |
| F02 unknown deployment | Owned registered markets remain visible read-only; market failures isolated (#52). | No outstanding source-level hiding defect identified; migration/unknown-executor transaction was not induced live. |
| F03 quote outages | Oracle-independent recovery panel reads ownership, registered parameters, borrow shares and balances; tests exclude oracle/IRM reads (#66). | Signed outage-path transaction remains unexecuted in QA. |
| F04 reapproval | Separate measurement approval and factual setup repair (#54, #58); #68 also repairs positive limited allowances. | Revoke/reapprove live cycle remains unexecuted in QA. |
| F05 account eligibility | Creation checks supported owner account before POST (#51); wallet/account tests. | Contract-wallet creation intentionally unsupported by current owner-signature model. |
| F06 free funds | Free USDC/WETH and gas reserve; wallet/vault repayment source; close/release and reopen from free funds (#53, #55, #63). | Additional owner-funded reopen variants were not signed in this audit. |
| F07 verification | Actual NEAR code/factory hash and restricted key checks, approved/published measurement, Base policy, explorer/copy controls (#53). | Partial: raw quote/event-log evidence and independent TDX verification are not exposed by vault get_state. Do not claim full attestation verification in the browser. |
| F08 agent limits | Actual Floor, migration/exit permissions, shared executor budget/window/session and cooldown (#53, #60). | No remaining display omission identified; policy failure stays explicit. |
| F09 activity | Grouped Base operations, Executor repayments, decoded NEAR owner intents and signed-call correlation; separate hash-checked agent transcript viewer (#57, #65). | Partial: browser access to raw quote/event-log and some transcript resources depends on evidence proxy routes/CORS; a transcript never proves execution. |
| F10 agent health | Position refresh and stale observation expiry (#59, #62). Copy explicitly describes a recent loop observation. | Partial: last successful market snapshot/execution health needs a separately defined protocol telemetry field; last_tick alone is insufficient. |
| F11 zero collateral debt | Explicit critical state distinguishes debt without collateral value from empty/no-debt and RPC failure (#52). | Extreme state covered mathematically; not created in user vault. |
| F12 create/setup lifecycle | Resumable tracked creation, create another, owner-bound state and factual setup repair (#51, #58); Q14 shared/independent rules (#71). | New vault + partial setup should receive another signed end-to-end rehearsal when the user is present. |
| F13 identity/icons | Token-address icon mapping; collateral-first Morpho names and backup identity (#64, #71). | No remaining known defect. |
| F14 selected vault | Explicit selection preserved in details navigation (#51). | Multi-owner browser rehearsal still useful; no extra vault was created for QA. |
| F15 review/risk navigation | Explicit pre-sign review (#55), contextual risk-reducing actions, review/Cancel keyboard focus, touch controls and mobile filter sizing (#68). | Contextual high-risk buttons reviewed in source; current live vault is empty, so that branch was not demonstrated with real debt. |
| F16 gates/scaling | PR build/TypeScript/tests (#56); obsolete demo components removed (#67); deduplicated reads, timeout/rate-limit handling (#59). Current suite: 71 Node tests. | Partial: no comprehensive React/browser E2E suite. Discovery still enumerates factory vaults (cap 10,000); factory has get_config/create_vault but no owner index. |
| F17 documentation | README describes actual React runtime, interest, routes, transactions and test limitations (#56, #67). Planning docs found in fffilimonov/prime, not missing protocol implementation. | Planning source: docs/04-app-requirements.md Q14 in prime; keep its role separate from deployed contract authority. |

## Next frontend work

1. Rehearse the implemented held-cancellation flow with the user when a genuine failed owner-call exists. Do not manufacture a failure or submit an unchanged intent to generate evidence. Protocol references: vault/src/lib.rs owner_call `cancel`; scripts/RELAYER.md failed/held jobs. Cancellation does not prove the original action never executed.
2. Add scenario-level component/browser coverage for wallet change, pending recovery, review focus and shared-rule setup. The current 71 helper tests do not substitute for this.
3. Rehearse changed signed flows with the user; do not submit unchanged rules merely to generate evidence.

## Note for Vadim (not sent)

- Factory owner discovery: confirm a supported owner-to-vault index or paginated API; current factory `get_config` exposes total count, not an owner lookup. Frontend cannot honestly make enumeration O(owned vaults) without an index.
- Agent health: define and publish the last successful market snapshot and last confirmed execution separately from loop tick/registration. Frontend currently makes only the weaker observation claim.
- Evidence: confirm supported public quote/event-log URLs and evidence-proxy CORS. Vault get_state is current contract state, not a raw TDX evidence archive. NearBlocks Testnet remains the user-approved transaction-discovery source; RPC receipts remain execution authority.

These are API/telemetry questions, not authorization to change deployed contracts or invent data. No message has been sent to Vadim.
