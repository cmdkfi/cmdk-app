# Lessons

## 2026-11-09 — Planning is not a go-ahead
- **What happened:** After the user answered the last open decision (D2) and restated the flow, I treated that as approval and started Phase 1 (branch, file moves, new entry). The user had asked only for a review, a PRD and a plan.
- **Rule:** An answer to a planning question is never implementation approval. Start code changes only after the user says so explicitly (e.g. "start", "implement", "go"). Ending a message with "once you answer X, I'll start" does not make a later answer an approval; ask "Shall I start Phase 1?" and wait.
- **Also:** When the user clarifies product behaviour mid-task ("most actions under the hood"), update the plan documents only; do not take it as momentum to build.

## 2026-11-09 — Phase 1 plan corrections
- **Routes:** I proposed folding S2 into `#start` to keep §8's four routes; the user required a fifth hash because browser Back must work between S1, S2 and S3. **Rule:** before merging screens into one route, check history/Back behaviour; every step the user can go Back to needs its own hash. States derived from the same read (S6/S7 on the position) can share a route.
- **Classifying leftovers:** I proposed moving `vault-layout` into `protocol/` because it was pure and tested; it is cockpit table layout. **Rule:** classify a module by what it encodes (protocol facts/owner-call args vs. old UI layout), not by being pure or tested.

## 2026-11-09 — Product correction from the product owner (Phase 2): don't derive "closed"
- **What happened:** I proposed scanning `Opened` logs to tell a closed vault from a set-up-but-never-opened one, and my resolver mapped "closed + local record" to S4. The product owner: the distinction is not needed. An empty vault with complete setup is reusable (S4 deposit step), Start over reuses it, and "Position closed" exists only as the terminal state of a close chain run in this session.
- **Rule:** when the protocol keeps no state for a distinction, first ask whether the product needs it before designing a reconstruction (log scans, heuristics). Prefer the state the user can act on (reusable vault) over a historical label.
- **Rule:** chain state always wins over local records in the resolver; a local record can only add information the chain cannot show (an onboarding step in progress), never override a position the chain shows.


## 2026-11-09 — Keep it simple: no legacy support, no predictive models, no inherited machinery
- **What happened:** the plan carried three things the product does not need: support for vaults made by the previous app, a frontend copy of the relayer's gas model to predict refusals, and the previous app's raw-transaction recovery and cancellation paths. The product owner cut all three.
- **Rule:** a new product supports only what it creates. Do not reconstruct history or compatibility for data the product never produced; ask first.
- **Rule:** when a server check is deterministic and happens before anything is sent, react to its answer instead of predicting it in the client.
- **Rule:** reusing a module does not mean wiring in every function it exports; list the functions actually used and leave the rest unwired.

## 2026-11-09 — Do not inherit code from a product you are replacing
- **What happened:** the plan moved twenty modules from the old cockpit into the new app "unchanged" because they were tested and encoded protocol facts. The product owner rejected this: nothing in the old app is known to be right for the new product, and the modules carry decisions (recovery paths, telemetry, multi-vault semantics) that were cut.
- **Rule:** when replacing a product, the old code is documentation. Write the new client from the protocol source of truth (cmdkfi/app), function by function with citations, and port only test vectors (bytes, numbers) as oracles. "Byte-identical to main" is not a quality claim.
- **Rule:** a reused module's tests are the valuable part; keep the vectors, not the implementation.

## 2026-11-09 — Phase 2b: check inherited predicates against the protocol's own check (product correction)
- **What happened:** Phase 2's "setup complete" reused the old `needsSetupApproval`, which treated any allowance below max as missing. The protocol's relayer refuses only a zero allowance (`scripts/relayer.py` l.478-483), and Circle's USDC lowers the allowance on every pull, so a vault that had repaid or closed would have been sent back to setup. The product owner adopted the relayer's rule and simplified resumed setup to always approve and derive only `authorize` from Base.
- **Rule:** a predicate that gates a user flow (complete / missing / allowed) must cite the protocol code that enforces the same condition, not a helper from the replaced app. If none exists, ask.
- **Also:** pin a dependency with a one-line lockfile edit and `pnpm install --frozen-lockfile`. An offline `pnpm install` re-resolved peer dependencies (500-line lockfile diff) and left `node_modules` out of step with the lockfile; check `node_modules/.pnpm/lock.yaml` against `pnpm-lock.yaml` before running checks.

## 2026-11-09 — Use maintained libraries for chain plumbing (product owner, after Phase 2b)
- **What happened:** Phase 2b hand-built the Base L1-fee call (serialize + GasPriceOracle.getL1Fee), typed an ERC-20 ABI and converted units by hand, although viem ships `publicActionsL2().estimateL1Fee`, `erc20Abi`, `parseUnits`/`formatUnits`, and Morpho publishes its math as an SDK.
- **Rule:** check for a maintained library before writing chain plumbing (ABIs of standard tokens, fee estimation, unit conversion, reference math). Keep own code only for protocol-specific pieces (fragments copied from cmdkfi/app) or trivially small ones, and say why in a comment.
- **Also:** a reference library can be a test oracle without becoming a runtime dependency (Morpho SDK as devDependency, kept out of app code by the boundary test).

## 2026-11-09 — Phase 3: completion checks read what the protocol controls; re-read the docs diff at phase start
- **What happened:** the design had step 6 complete when "wallet USDC increased", taken from the PRD table; the product owner changed it to "job done and idle USDC at the position address below dust". The wallet balance can move for unrelated reasons; the position address only moves through the vault. The product owner also asked that a Retry after a refusal say explicitly whether it re-sends the same signed message or asks for a new one, and that the open pre-check re-read liquidity as well as feeds.
- **Rule:** a step's completion predicate reads state only the protocol moves (position address, vault, Morpho), never a balance the user or anyone else can change independently.
- **Rule:** a Retry label names exactly what will happen (same signature vs new signature vs new request); never a generic "Retry" on a signed action.
- **Also:** the PRD and todo were edited on disk during the phase (S1 0.01 ETH prefill) and I found it only while editing the PRD at the end. Run `git diff HEAD -- docs tasks` at the start of each phase and before the Review note, and apply what the product owner added.

## 2026-11-09 — Phase 4: check each status rule against the contract that enforces it
- **What happened:** the first S5 draft showed the backup market as "Approved for migration" whenever its corridor was set. `Executor.migrate` also requires `migrateAllowed` on both corridors and neither market closed for the agent (l.304-309 via `_agentCorridor` l.470-474). It also carried an agent-card sentence and a contract link label that were not in the PRD, and a WETH dust threshold that no source defines. All were caught by re-reading PRD S5 and Executor.sol before the checks.
- **Rule:** a displayed status ("approved", "active", "budget left") is derived from the full precondition of the contract call it describes, with the line cited, and has a unit test per precondition.
- **Rule:** user-facing copy comes from the PRD or the scope message; do not add explanatory sentences or thresholds of my own.

## 2026-11-09 — Phase 5: a second flow on the same machinery is an extraction first, proven by the old tests
- **What happened:** close needed exactly the Phase 3 owner-call machinery (lock, nonce reconciliation, refusal top-up, Retry). I moved it unchanged into a generic runner and ran the 8 onboarding scenarios on it before writing any close code; only then did close use it. A copy would have meant two places to fix the next FR-6 change.
- **Rule:** when a second flow needs the same safety machinery, extract it first, prove the extraction with the first flow's existing tests, then build the second flow on it. No copy-and-adapt of safety code.
- **Rule:** a multi-step chain whose intermediate chain states classify as another screen's state (WETH idle after `close` reads as "deposited") needs its in-progress record in the entry resolver, with a reload test at such an intermediate step.

## 2026-11-09 — Phase 5b: measure a performance instruction against live data before building it
- **What happened:** the todo asked for one unfiltered eth_getLogs per window over the Executor, WETH and USDC addresses. A live measurement before writing code showed 4,208 logs / 2.7 MB per window (every testnet USDC transfer), so the change would have made activity slower and heavier. Asked the product owner; they chose two topic-filtered queries in one JSON-RPC batch.
- **Rule:** for a performance change, measure the proposed request shape against the live endpoint first; if it contradicts its own goal, stop and ask with the numbers.
- **Rule:** measure per leg as well as in total. The refresh went from 39 requests to 6, but its time barely moved: the NEAR RPC takes about 3 s per call. Report where the time goes instead of claiming a speed-up from a request count.

## 2026-11-09 — Phase 6: run a status panel against real data before calling its wording done
- **What happened:** every fixture scenario passed, but the read-only live run on v9 (a vault that never ran setup) showed "Registering (usually a few minutes)" for an agent that cannot register until the vault approves its version. The wording promised something the protocol would not do. Changed to "Waits for the setup step…" with a unit test.
- **Rule:** a status line must be true for every state the protocol allows, not only for the states the fixture models. Run a read-only live pass over real vaults in different states (complete, not set up) before closing a status feature.
- **Also:** after the NEAR switch, the measured time matched the per-leg explanation from Phase 5b (3 s per NEAR call): one refresh 3.5–4.5 s → 0.44–0.70 s with the same six requests.

## 2026-11-09 — Phase 7: creation is guarded by a fresh ownership read, never by a cached one
- **What happened:** the account-switch browser test was flaky; its failure screenshot showed the owner back on S1, and a probe confirmed the real defect behind it: the session's discovery cache still said "None for this wallet" after the run had created v10, so S3 offered Create position again, which would have overwritten the paused record and asked the relayer for a second vault. The create step re-ran discovery only before a *repeat* POST.
- **Rule:** creation is guarded by a fresh ownership read, never by a cached one. Any action that creates something unique per owner re-reads ownership immediately before it, every time, and adopts what exists.
- **Rule:** a cache of "what the user owns" is refreshed the moment the app itself changes ownership (vault created or adopted), and an account switch is treated as a new connect.
- **Also:** a flaky browser test is a finding until its screenshot is explained; here the timing flake hid a product defect.


## 2026-11-10 — Phase 7b: "chain first" means every protocol precondition of protection, not only the key
- **What happened:** I built the todo's rule (recorded key, future expiry, limited key list = registered) and it passed every fixture scenario. The read-only live run then showed v10 as "Active" while the running agent did not watch it: v10 approved the previous agent image's compose hash, and its still-valid key came from the previous boot. The product owner added the approval as the first check (agent/src/vaults.rs l.8-9, l.82-87) and a setup guard against a stale baked measurement.
- **Rule:** a status that claims protection is derived from the full precondition the protocol uses to protect (PRD fact 5: approved = running measurement, corridor, registered key), with the agent's code cited, even when the task names only part of it. Run the live read-only pass before the commit, not after.
- **Rule (product owner):** "Unavailable" is only for a read that failed. A known fact gets its own label (Outdated, Not approved), and a label never claims history the chain cannot show: "Revoked" needs evidence that a registration existed.
- **Also:** check the local gitignored `deployments/testnet.json` against cmdkfi/app main before running checks. The local copy was older than main, so a local build would have baked a measurement the running agent no longer has.
