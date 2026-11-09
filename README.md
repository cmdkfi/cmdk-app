# cmdk testnet app

The React/Vite application in `app/` is deployed from `main` to https://testnet.cmdk.fi. It reads Base Sepolia (84532) and NEAR Testnet. The protocol source of truth is [cmdkfi/app](https://github.com/cmdkfi/app), where Vadim implemented the contracts, agent and relayer. Check that repository before changing transaction logic or ABIs.

## Current navigation

- **Vaults** (`#connect`): connect a supported EVM owner wallet, discover owned NEAR vaults and inspect collateral, debt, LTV, liquidation threshold and agent observation.
- **Vault cockpit** (`#vault?id=<NEAR account>`): position monitoring, free token balances, gas reserve, risk rules, verification and transaction actions. Explicit IDs select an owned vault; the bare route preserves the current selection.
- **Activity** (`#activity`): confirmed Base events plus separately indexed NEAR history from NearBlocks Testnet. Agent transcripts are evidence published by the agent, not transaction receipts.
- **Create** (`#create`): checked owner account, relayer readiness and a single tracked creation request, followed by initial setup.

There are no demo balances or demo routes in the running application. Unused React demo screens and their obsolete scene tests have been removed. The root static prototype remains historical design source, not evidence of live product support. `app/src/main.tsx` is the production entry point.

## Transactions

Deposit supplies collateral directly to Morpho from the wallet. Repay supports wallet-funded Morpho repayment and owner-signed repayment from free vault USDC. Borrow uses a NEAR owner-call through the registered Base Executor; borrowed USDC remains at the vault until withdrawn. Close repays remaining debt from free vault funds and releases collateral into the vault. Withdraw transfers only free tokens to the connected owner wallet.

Every transaction requires the user's wallet confirmation. The action panel shows an explicit review, a fresh on-chain preflight and links to resulting receipts. Uncertain broadcasts are not automatically retried. Failed owner jobs with potentially executable signed Base transactions remain locked until safely reconciled; a relayer failure alone is not cancellation. The cockpit’s Held transaction cancellation panel verifies the original NEAR result and offers one protocol `cancel` at a time. It keeps the original intent locked while cancellation is uncertain, preserves confirmation evidence in local browser storage, and unlocks only after all original Base nonces are consumed. A race can still allow an original call to execute; inspect Activity after reconciliation. Lost cancellation jobs can be recovered using their exact finalized NEAR hash. Legacy records without an exact owner intent require separate operator reconciliation.

Edit rules reads Base Executor corridors, changes Target, Trigger and Budget, and preserves Floor and permissions. Measurement approval and revocation are NEAR owner calls. Verification compares published and approved measurements, code identity and access-key restrictions; it does not independently verify a TDX quote or guarantee agent execution.

Debt includes interest calculated at the read block. Positions update every 30 seconds while visible. A recent agent-loop observation is not proof of a successful market snapshot or transaction. Missing reads are reported; they are not replaced by mock values.

## Development

Use Node 22 and pnpm 11.7.0:

```sh
cd app
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:5173. The strict port is intentional: the relayer's CORS configuration permits that origin. Build configuration is generated from `deployments/testnet.json`; do not invent unpublished contract addresses.

```sh
pnpm build
pnpm test
```

Pull requests run build/TypeScript and the Node test suite through `frontend quality`. Main pushes run the same checks before the Cloudflare deployment. Helper tests do not replace signed transaction testing or desktop/mobile browser verification. Native Rust/Solidity protocol checks belong to cmdkfi/app and require its toolchains.

## Browser scenario tests

```sh
cd app
pnpm exec playwright install chromium
pnpm build
pnpm test:bundle-boundary
pnpm test:browser
```

Playwright runs 21 scenarios in desktop and mobile Chromium (42 cases). Wallet rejection/retry/disconnection and unsupported-account discovery use the production entry. Network/account switching, Edit rules and recovery use the real React components in an isolated test entry. They do not mock component functions or protocol calculations.

Only controlled EIP-1193, Base/NEAR RPC and relayer responses are used. Signatures come from public throwaway fixture keys. No real extension, live RPC, relayer POST or on-chain transaction is used. Unknown external requests fail the test; SDK analytics are swallowed locally. The fixture models the API/ABI shapes in cmdkfi/app at `672f1ff702b12307b1df31d10b27d9599b7765dd` (rechecked against `910811b`: relevant contracts and relayer are unchanged), not a chain emulator or contract execution proof.

Coverage includes shared-rule Floor/permission preservation, exact signed payload bytes, nonce/account/corridor changes while signing, no-op/invalid/rejected saves, receipt/state mismatch, direct reverted receipt recovery, held suffixes across reload, lost cancellation jobs, mismatched NEAR evidence, and explicit exact-call rebroadcast. Browser TypeScript is checked separately. PR and deployment workflows run the suite before merge/publication; failure traces, screenshots and HTML reports are retained as CI artifacts for seven days.

`e2e/harness.html` is dev/test-only. The production bundle boundary check rejects fixture markers or test entries in `dist/`. These tests supplement live signed rehearsals; they do not replace them. WebKit/Safari, real extensions and arbitrary protocol failures remain outside this suite.

## Agent observations and boot evidence

Verification reads /agent/ and /agent/transcripts from the configured Worker. It filters the selected vault, rejects twins, checks filename/boot/loop/vault/network identity and SHA-256, and scans five transcripts at a time with an explicit earlier-history control. Last successful published snapshot requires complete timestamp/block fields, no read_errors, no rpc_second_error and no rpc_disagree. Early failed ticks may write no transcript; this is not a heartbeat or continuous health guarantee.

The current protocol puts the chosen proposal at transcript.proposal; nested decisions[].proposal is also accepted. sent:true and near_error identify attempts. Receipt verification is read-only: FINAL NEAR outcome, exact vault/key/method/args, validated Base Sepolia signed transaction, matching Base receipt and two block confirmations. Agent-reported success and RPC-confirmed success/revert remain separate.

Boot file checks are size-bounded and compare bytes/SHA-256 against the index, then re-read the index to detect boot/file rollover. Registration files are restricted to the selected vault. info.json and current-boot transcript measurement/key comparisons use the loaded NEAR state. They do not independently validate the TDX quote signature, PCCS collateral/TCB or RTMR replay. Worker caching is up to ten seconds. Closing the drawer or changing vault aborts stale evidence work and discards old proofs.

Protocol source checked against cmdkfi/app main 47fd4fb; relevant agent code remains unchanged from the preceding review. Factory enumeration is the supported owner discovery mechanism; no owner-index or new agent telemetry API is required before the deadline. NearBlocks remains the NEAR discovery source; job responses and transcripts provide call detail, receipts provide execution outcomes.

A vault-wide background read failure preserves the same owner/vault’s last successful snapshot, visibly read-only, instead of unmounting Verification. Cached data is never carried to a different vault or owner; independent recovery remains available.

For the isolated RPC-failure and recovery scenarios in installed Google Chrome:
```sh
CMDK_TEST_CHROME=1 pnpm --dir app exec playwright test e2e/discovery.spec.ts --project=desktop
```
The normal browser suite covers desktop and mobile with controlled test-only RPC/wallet fixtures; it does not submit live transactions.
