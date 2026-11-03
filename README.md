# cmdk app

The new application foundation lives in [`app/`](app/). It uses React, Vite, and strict TypeScript. Its ten screens follow the product flow in `fffilimonov/prime/docs/04-app-requirements.md`: connect, configure a vault, approve an agent version, deposit, withdraw the borrowed USDC, monitor, change rules, repay and leave, verify, and explore demo scenes.

The app has a connected wallet, a relayer readiness screen, and a separate local loan demo. My loan can read a selected vault's position from NEAR and Base Sepolia when the published factory is configured. Create vault can start and track a testnet relayer job when the factory and market deployment manifest is published. It does not open a loan, transfer user tokens, or sign vault setup. The existing interactive prototype remains available at `/prototype/index.html` when running the new app.

My loan shows two selectable example vault positions, a selected loan summary, a dated demo scenario chart, position health, and local activity. The first position reflects the local demo journey after a loan is opened; the second remains a fixed example. Neither is presented as an on-chain balance. A vault may distribute one loan across multiple Morpho markets. When a connected wallet has a discovered vault, My loan reads its market positions and shows debt, collateral, LTV, and configured risk lines in a separate on-chain panel. The owner can refresh that read. Debt uses Morpho's stored market totals, so interest since the last accrual is not included. The demo chart and actions below are still examples and do not control the selected vault.

The Connect screen supports injected EVM wallets (including MetaMask and Rabby) and Coinbase Wallet in EOA mode. It checks the connected address's code on Base Sepolia and identifies standard, delegated, and contract accounts. After connection, it reads the NEAR factory and finds vaults owned by that EVM address. If several exist, the owner can select one; the choice is saved in this browser and displayed on My loan. Selection populates read-only position balances when the testnet factory and vault are available. It does not enable signatures or transactions.

Vault discovery needs `deployments/testnet.json` with `near.factory`. The dev and build scripts generate `app/public/config.json` from that manifest. If the manifest is absent, the app clearly reports that factory deployment data is pending. Do not enter a planned address by hand. When the published deployment manifest becomes available, add it to this repository at `deployments/testnet.json` and rebuild.

The Connect screen also reads relayer `/health`, using the documented fallback URL only when the primary endpoint does not answer. It compares the relayer's chain, network, factory, and gas funding with the generated config and reports deployment or funding delays. Create vault performs the same check before one `POST /create-vault`, then polls `GET /job/<id>` for acceptance, vault creation, gas funding, and completion. It keeps the job ID in this browser session so a reload can resume checking. If the POST outcome is unknown or the job record is lost, the app does not automatically retry creation; check the factory for an existing vault first. A vault whose gas funding failed must receive funds before setup can continue. The local demo form remains independent of this testnet action.

## Run the new app

Use Node 22 and pnpm 11:

```sh
cd app
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:5173/>. `pnpm build` checks TypeScript and creates a static build in `app/dist/`. The build copies the legacy prototype and its bundled chart library into `app/dist/prototype/`.

### Try the local loan journey

On Connect, choose **Start local demo**. Set rules, create a demo vault, continue past the agent version explanation, and open a demo loan. Withdraw the example USDC, then use **Simulate ETH price drop** and **Run demo Reduce** on My loan. Open **Repay & leave** to repay the remaining debt and return the WETH. Each step updates the same local position across screens. The demo state persists in this browser; **Reset local demo** on Connect starts over. All amounts, events, and agent actions are local examples, with no wallet signing or network transaction.

## Existing interactive prototype

The root `index.html` is the existing interactive prototype of the cmdk crypto loan dashboard. It includes My loan, Autopilot, Verify, Demo, and Create vault, plus repayment and withdrawal previews.

### Run it directly

From this directory:

```sh
python3 -m http.server 8765
```

Open <http://127.0.0.1:8765/>. This prototype is static HTML and needs no build.

The screens use local demo data. There is no live market feed, connected wallet, real signature, or on-chain transaction. Lightweight Charts is bundled in `vendor/`; its license is included there.

The English [Design Plan](docs/design-plan.md) records the proposed screens and user journeys. It is a planning snapshot, so check the app and current product documentation for implemented behavior.
