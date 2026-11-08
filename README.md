# cmdk testnet app

The React/Vite application in `app/` is deployed from `main` to https://testnet.cmdk.fi. It reads Base Sepolia (84532) and NEAR Testnet. The protocol source of truth is [cmdkfi/app](https://github.com/cmdkfi/app), where Vadim implemented the contracts, agent and relayer. Check that repository before changing transaction logic or ABIs.

## Current navigation

- **Vaults** (`#connect`): connect a supported EVM owner wallet, discover owned NEAR vaults and inspect collateral, debt, LTV, liquidation threshold and agent observation.
- **Vault cockpit** (`#vault?id=<NEAR account>`): position monitoring, free token balances, gas reserve, risk rules, verification and transaction actions. Explicit IDs select an owned vault; the bare route preserves the current selection.
- **Activity** (`#activity`): confirmed Base events plus separately indexed NEAR history from NearBlocks Testnet. Agent transcripts are evidence published by the agent, not transaction receipts.
- **Create** (`#create`): checked owner account, relayer readiness and a single tracked creation request, followed by initial setup.

There are no demo balances or demo routes in the running application. Legacy prototype/demo files remain historical source, not evidence of live product support. `app/src/main.tsx` is the production entry point.

## Transactions

Deposit supplies collateral directly to Morpho from the wallet. Repay supports wallet-funded Morpho repayment and owner-signed repayment from free vault USDC. Borrow uses a NEAR owner-call through the registered Base Executor; borrowed USDC remains at the vault until withdrawn. Close repays remaining debt from free vault funds and releases collateral into the vault. Withdraw transfers only free tokens to the connected owner wallet.

Every transaction requires the user's wallet confirmation. The action panel shows an explicit review, a fresh on-chain preflight and links to resulting receipts. Uncertain broadcasts are not automatically retried. Failed owner jobs with potentially executable signed Base transactions remain locked until safely reconciled; a relayer failure alone is not cancellation.

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
