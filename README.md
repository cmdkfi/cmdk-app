# cmdk app

The new application foundation lives in [`app/`](app/). It uses React, Vite, and strict TypeScript. Its ten screens follow the product flow in `fffilimonov/prime/docs/04-app-requirements.md`: connect, configure a vault, approve an agent version, deposit, withdraw the borrowed USDC, monitor, change rules, repay and leave, verify, and explore demo scenes.

This first stage is an interface preview. Wallet connection, chain reads, signatures, relayer jobs, and live transactions are not connected. Values marked as examples are local calculations. The existing interactive prototype remains available at `/prototype/index.html` when running the new app.

## Run the new app

Use Node 22 and pnpm 11:

```sh
cd app
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://127.0.0.1:5173/>. `pnpm build` checks TypeScript and creates a static build in `app/dist/`. The build copies the legacy prototype and its bundled chart library into `app/dist/prototype/`.

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
