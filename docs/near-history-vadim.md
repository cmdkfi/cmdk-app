# NEAR history — note for Vadim

The frontend will use the public NearBlocks Testnet indexer for vault transaction discovery and pagination. Vlada approved this source on 2026-11-08.

Protocol source of truth remains cmdkfi/app. Current vault state comes from NEAR RPC get_state; execution claims must be verified against transaction/receipt outcomes. NearBlocks is a discovery index, not an attestation verifier.

Implementation requirements:
- Keep indexer lag, unavailable responses and incomplete pagination visible; never interpret them as proof of no activity.
- Separate confirmed on-chain operations from agent decision transcripts.
- Identify attestation updates from actual calls/receipt logs, not from the current approved measurement alone.
- Do not invent heartbeat intervals, historical registrations or execution guarantees.

Please confirm whether cmdk has a preferred production indexer/API or plans its own event history endpoint. The frontend source should remain replaceable. Production rate limits, CORS and authentication need checking before release; no API key should be embedded in the frontend.

This note does not request any protocol or contract change.
