// Test vectors for the protocol layer, as data. Each entry names where its values come from: a test in the
// previous app (`main:app/src/<file> › <title>`), a cmdkfi/app file at 47fd4fb, or a live capture with its date.
// The previous app's code is not used; only these values are.

const MEASUREMENT = { mrtd: 'ab'.repeat(48), rtmr0: 'bc'.repeat(48), rtmr1: 'cd'.repeat(48), rtmr2: 'de'.repeat(48), compose_hash: 'ef'.repeat(32), os_image_hash: 'fa'.repeat(32) }
const LIVE = '0x' + 'aa'.repeat(32), BACKUP = '0x' + 'bb'.repeat(32), EXEC = '0x' + '44'.repeat(20)
const CORRIDOR = { target: '500000000000000000', act: '700000000000000000', floor: '300000000000000000', sell_budget: '200000000000000000', migrate_allowed: true, exit_allowed: true }

export const V = {
  // ---- owner messages -------------------------------------------------------------------------------------
  V1_setupMessage: {
    from: 'main:app/src/vault-setup.test.mjs › setup message uses exact field order, decimal fractions and one authorization; bytes produced with scripts/p2_owner.py l.38-39 json.dumps(separators=(",",":")); approve on both markets per the Q4 decision (relayer.py l.466)',
    rules: { floor: 30, target: 50, act: 70, budget: 20, migrate: true, exit: true },
    facts: [
      { market: LIVE, executor: EXEC, authorized: false, loanAllowance: 0n, collateralAllowance: 0n, corridorSet: false, lltv: 86n * 10n ** 16n },
      { market: BACKUP, executor: EXEC, authorized: false, loanAllowance: 0n, collateralAllowance: 0n, corridorSet: false, lltv: 86n * 10n ** 16n },
    ],
    measurement: MEASUREMENT,
    vault: 'v10.factory.testnet', nonce: 1, expiry: 1793722200,
    text: '{"protocol":"cmdk-vault/1","network":"testnet","vault":"v10.factory.testnet","method":"setup","args":{"markets":[{"market":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","approve":true,"authorize":true,"corridor":{"target":"500000000000000000","act":"700000000000000000","floor":"300000000000000000","sell_budget":"200000000000000000","migrate_allowed":true,"exit_allowed":true}},{"market":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","approve":true,"authorize":false,"corridor":{"target":"500000000000000000","act":"700000000000000000","floor":"300000000000000000","sell_budget":"200000000000000000","migrate_allowed":true,"exit_allowed":true}}],"measurement":{"mrtd":"abababababababababababababababababababababababababababababababababababababababababababababababab","rtmr0":"bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc","rtmr1":"cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd","rtmr2":"dededededededededededededededededededededededededededededededededededededededededededededededede","compose_hash":"efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef","os_image_hash":"fafafafafafafafafafafafafafafafafafafafafafafafafafafafafafafafa"}},"nonce":1,"expiry":1793722200}',
  },
  V5_resumedSetup: {
    from: 'main:app/src/vault-setup.test.mjs › repair preserves existing corridors and avoids repeating granted authorization (non-max allowance case dropped, Q4)',
    facts: [
      { market: LIVE, executor: EXEC, authorized: true, loanAllowance: 1n, collateralAllowance: 1n, corridorSet: true, lltv: 86n * 10n ** 16n },
      { market: BACKUP, executor: EXEC, authorized: true, loanAllowance: 0n, collateralAllowance: 1n, corridorSet: false, lltv: 86n * 10n ** 16n },
    ],
    expect: { markets: [[true, false, null], [true, false, CORRIDOR]], measurement: null },
  },
  V6_lltv: { from: 'main:app/src/vault-setup.test.mjs › repair validates new corridors against the actual market LLTV rather than a demo constant', lltv: 65n * 10n ** 16n },
  V7_payload: { from: 'main:app/src/live-actions.test.mjs › owner payload uses NEAR testnet with nonce replay protection', vault: 'v1.factory.testnet', nonce: 2, refusedVault: 'vault.near' },
  V9_freshNonce: { from: 'main:app/src/owner-recovery.test.mjs › owner state is checked again after signing before creating a pending request', messageNonce: 4, accepted: 3, refused: 4 },
  V10_expiry: { from: 'main:app/src/owner-recovery.test.mjs › an unsubmitted intent unlocks only after the same final NEAR block proves expiry and an unused nonce', expiry: 2000000000, expiredAt: 2000000001, validAt: 2000000000 },
  V11_nonceZero: { from: 'main:app/src/owner-recovery.test.mjs › owner recovery retains the exact signed intent and refuses invalid nonces', nonce: 0 },
  V12_expiryBound: { from: 'cmdkfi/app vault/src/owner.rs l.130-145 (expiry_at_the_bound_is_accepted, …_over_the_bound_is_refused, …_past_is_refused)', now: 1793000000, maxAhead: 3600 },
  V13_open: {
    from: 'main:app/src/vault-funding.test.mjs › free vault funding uses exact raw amounts and stored Target for each protocol method; bytes per p2_owner.py',
    text: '{"protocol":"cmdk-vault/1","network":"testnet","vault":"v10.factory.testnet","method":"open","args":{"market":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","collateral_in":"100000000000000000","target_ltv":"500000000000000000"},"nonce":2,"expiry":1793722800}',
    withdraw: '{"protocol":"cmdk-vault/1","network":"testnet","vault":"v10.factory.testnet","method":"withdraw","args":{"token":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","amount":"160000000","destination":"0x1919191919191919191919191919191919191919"},"nonce":3,"expiry":1793723400}',
    close: '{"protocol":"cmdk-vault/1","network":"testnet","vault":"v10.factory.testnet","method":"close","args":{"market":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"nonce":4,"expiry":1793724000}',
  },

  // ---- math ---------------------------------------------------------------------------------------------------
  V18_revoke: {
    from: 'cmdkfi/app vault/src/lib.rs l.419-424 (revoke_agent takes NoArgs; deletes the agent key and clears approved) and scripts/relayer.py OWNER_ARGS revoke_agent: () — composed as scripts/p2_owner.py l.38-39 does, json.dumps(separators=(",",":"))',
    text: '{"protocol":"cmdk-vault/1","network":"testnet","vault":"v10.factory.testnet","method":"revoke_agent","args":{},"nonce":5,"expiry":1793724600}',
  },
  V14_marketMath: { from: 'main:app/src/positions.test.mjs › calculates stored Morpho debt, collateral value and LTV with integer rounding', collateral: 2n * 10n ** 18n, shares: 2_500_000_000n, totalAssets: 2_500_000_000n, totalShares: 2_500_000_000n, price: 2_500n * 10n ** 24n, value: 5_000_000_000n, debt: 2_499_000_401n, ltv: 499_800_080_200_000_000n },
  V15_zeroCollateral: { from: 'main:app/src/positions.test.mjs › zero collateral cannot produce a finite LTV', debt: 1n },
  V16_accrual: { from: 'main:app/src/positions.test.mjs › accrued debt includes Morpho Taylor interest with integer rounding', cases: [[1_000_000n, 0n, 100n, 1_000_000n], [1_000_000n, 10n ** 15n, 10n, 1_010_050n]] },
  V17_verifyExample: {
    from: 'cmdkfi/app scripts/VERIFY.md §2 worked example (backup market, block 53819084, 3 Nov 2026)',
    collateral: 6_000_000_000_000_000n, borrowShares: 6_744_896_000_000n, totalBorrowAssets: 6_744_896n, totalBorrowShares: 6_744_896_000_000n, price: 2244675801807553502812018763n,
    value: 13_468_054n, debt: 6_744_896n, ltv: 500807020821270839n,
    rate: 1302065709n, elapsed: 378n, accruedAssets: 6_744_899n, accruedDebt: 6_744_899n, accruedLtv: 500807243570600475n,
  },
  V8_decimal: { from: 'main:app/src/live-actions.test.mjs › token decimals reject scientific, negative, rounded or zero inputs', ok: [['0.000001', 6, 1n]], refused: ['0', '-1', '1e3', '0.0000001', 'NaN'] },

  // ---- relayer and NEAR RPC ----------------------------------------------------------------------------------
  V3_ownerCall: { from: 'main:app/src/vault-setup.test.mjs › posts the identical signed text only once and tracks its job', job: '0123456789abcdef', signature: '0x' + 'a'.repeat(130) },
  V4_uncertain: { from: 'main:app/src/vault-setup.test.mjs › lost POST response and forgotten job are uncertain' },
  V18_fallback: { from: 'main:app/src/relayer.test.mjs › uses fallback only when the primary does not answer', urls: ['https://primary/health', 'https://fallback/health'] },
  V19_assess: { from: 'main:app/src/relayer.test.mjs › fails closed on a mismatched factory or network', health: { ok: true, chain_id: 84532, near_network: 'testnet', factory: 'factory.testnet', factory_exists: true, eth_float_wei: '0' } },
  V20_create: { from: 'main:app/src/create-vault.test.mjs › checks health then sends one exact asynchronous create request', owner: '0x' + 'e'.repeat(40), policy: { cooldown_secs: 120, markets: [{ id: '0x' + 'a'.repeat(64), loan_token: '0x' + 'b'.repeat(40), collateral_token: '0x' + 'c'.repeat(40), executor: '0x' + 'd'.repeat(40), slice_max: '1000000000' }] }, depositNear: '2' },
  V21_factoryMissing: { from: 'main:app/src/create-vault.test.mjs › does not post while the factory is unavailable' },
  V22_rateLimit: { from: 'main:app/src/create-vault.test.mjs › reports rate limits and never retries a POST that may have been accepted', retryAfter: 3600 },
  V23_lostJob: { from: 'main:app/src/create-vault.test.mjs › a forgotten job is uncertain, not a failed creation' },
  V24_dedupe: { from: 'main:app/src/near-rpc.test.mjs › concurrent identical reads share a request, but later preflights read fresh state' },
  V25_429: { from: 'main:app/src/near-rpc.test.mjs › HTTP 429 respects Retry-After … / unavailable Retry-After uses a conservative cooldown', retryAfter: 120, defaultCooldownMs: 59_000 },

  // ---- discovery ---------------------------------------------------------------------------------------------
  V26_discovery: { from: 'main:app/src/near.test.mjs › discovers only vaults owned by the connected address, newest first (rescaled to the D4 cutoff)', argsBase64: 'e30=' },
  V27_unreadable: { from: 'main:app/src/near.test.mjs › does not treat an unreadable vault as an empty result' },
  V28_retry: { from: 'main:app/src/near.test.mjs › discovery retries a transient read once, and stops the remaining scan on an RPC-wide rate limit' },

  // ---- evidence ----------------------------------------------------------------------------------------------
  V30_keys: { from: 'main:app/src/near-security.test.mjs › NEAR security checks global code identity and exact agent-key permissions' },
  V31_measurement: { from: 'main:app/src/agent-evidence.test.mjs › measurementMatches (equal, rtmr0 changed, approved undefined)', measurement: MEASUREMENT },
  V32_compose: { from: 'live capture 2026-11-09: https://relayer.cmdk.fi/agent/evidence/app-compose.json (boot-1793948092-14fda74d)', file: 'evidence/vectors/app-compose.216124c1e33e5256.2026-11-09.json', bytes: 19683, sha256: '216124c1e33e525670272566938268471719d6eb94fdf6048c67925cbab9bdb2' },
  V36_accessKeys: { from: 'live capture 2026-11-09: NEAR RPC view_access_key_list for v1.factory.prime-measure-1792736012.testnet', file: 'evidence/vectors/view_access_key_list.v1.2026-11-09.json' },

  // ---- selectors pinned by the protocol ----------------------------------------------------------------------
  SELECTORS: {
    from: 'cmdkfi/app agent/src/chain.rs l.1001-1014 (selectors_match_the_current_executor) and vault/src/evm.rs l.21-22',
    corridors: '2e18e9e7', config: 'cc718f76', soldInWindow: '03e29885', closedForAgent: '91dea56f', transfer: 'a9059cbb', approve: '095ea7b3',
  },
}
