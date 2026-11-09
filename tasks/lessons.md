# Lessons

## 2026-11-09 — Planning is not a go-ahead
- **What happened:** After the user answered the last open decision (D2) and restated the flow, I treated that as approval and started Phase 1 (branch, file moves, new entry). The user had asked only for a review, a PRD and a plan.
- **Rule:** An answer to a planning question is never implementation approval. Start code changes only after the user says so explicitly (e.g. "start", "implement", "go"). Ending a message with "once you answer X, I'll start" does not make a later answer an approval; ask "Shall I start Phase 1?" and wait.
- **Also:** When the user clarifies product behaviour mid-task ("most actions under the hood"), update the plan documents only; do not take it as momentum to build.

## 2026-11-09 — Phase 1 plan corrections
- **Routes:** I proposed folding S2 into `#start` to keep §8's four routes; the user required a fifth hash because browser Back must work between S1, S2 and S3. **Rule:** before merging screens into one route, check history/Back behaviour; every step the user can go Back to needs its own hash. States derived from the same read (S6/S7 on the position) can share a route.
- **Classifying leftovers:** I proposed moving `vault-layout` into `protocol/` because it was pure and tested; it is cockpit table layout. **Rule:** classify a module by what it encodes (protocol facts/owner-call args vs. old UI layout), not by being pure or tested.
