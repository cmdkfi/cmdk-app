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

