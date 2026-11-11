# cmdk testnet app — guided flow

The React/Vite application in `app/` guides one ETH → USDC position on Morpho (Base Sepolia, chain 84532), protected by
the cmdk agent through a NEAR testnet vault. It is deployed to https://testnet.cmdk.fi from `main` on every push (`deploy testnet`). **Testnet only,
unaudited, no real funds. Agent protection is risk management, not insurance.**

The protocol source of truth is [cmdkfi/app](https://github.com/cmdkfi/app) (contracts, vault, agent, relayer). This app
was written against cmdkfi/app `47fd4fb` and rechecked against `22a5191` (10 Nov); every ABI fragment, owner-message format and relayer rule in `app/src/protocol/`
cites the file and line it comes from. Check that repository before changing transaction logic. The product
requirements are in [`docs/prd-guided-flow.md`](docs/prd-guided-flow.md); the build plan and review notes per phase are
in [`tasks/todo.md`](tasks/todo.md).

Desktop and mobile: the same app stays mounted at every width, including when rotating a phone or resizing a window. Any
injected browser wallet works (every wallet announced through EIP-6963, plus `window.ethereum` when it is not
announced; no connect-modal library); plain accounts and EIP-7702 delegated accounts are supported, contract wallets are
not (the vault verifies owner messages with ecrecover). On mobile, use the wallet’s built-in browser; ordinary Safari/Chrome without an injected provider show wallet-browser guidance and a sandbox entry. WalletConnect/QR pairing is not configured. The header shows the wallet slot only once connected; connecting
happens on S3. A wallet that reports another chain is asked to switch to Base Sepolia right after connecting, and every
action that needs the chain asks again; the step says "Switch to Base Sepolia in your wallet." until it does.

## Navigation

Five hash routes. The bare root (`/`) runs the landing table: it sends a connected owner to the screen that matches their
vault (S4 for an unfinished setup or deposit, S5 for a position), otherwise to S1. Route guards redirect a screen that
does not apply (for example `#position` without a position goes to `#start`).

| Route | Screen | What it reads |
|---|---|---|
| `#start` | **S1 Choose** — collateral, borrow asset and venue (only ETH → USDC on Morpho Base is selectable), the deposit amount (0.01 ETH by default), the estimate | The live market every 30 s: Morpho market params and the Executor's market config (once per session), market totals, oracle price and IRM borrow rate (each poll). Value, borrow at the 50 % target, simple APR, and a liquidity warning with the largest deposit that still opens at 50 % |
| `#settings` | **S2 Settings** — the fixed protection rules (target 50 %, agent acts above 70 %, floor 30 %, at most 20 % of collateral sold per rolling day, migration and exit allowed) and the testnet/not-insurance acknowledgement | The rules come from `config.app.json`; the liquidation LTV (86 %) comes from the same live market read as S1 |
| `#connect` | **S3 Connect** — the wallets in this browser (EIP-6963), Base Sepolia (switch, or add with the values in `config.app.json`), account type, wallet funding, the existing vault, then **Create position** (or **Deposit** on a ready vault, or **Continue where you left off**) | Account code (`eth_getCode`), wallet ETH/WETH and the cost of a wrap and a transfer including Base's L1 fee, the owner's vault (NEAR), relayer health. A Get Base Sepolia ETH panel opens when the wallet is short |
| `#progress` | **S4 Opening your position** — the onboarding steps with their status, and the agent verification panel in the right rail | The vault (NEAR `get_state` plus one Base snapshot) before every step, relayer jobs, Base receipts (two confirmations), NEAR time for message expiry, the open plan (feeds and liquidity) right before the open signature |
| `#position` | **S5 Your position** — debt, collateral, LTV track, agent card (with **Approve current agent version** / **Approve agent** when an open position's vault does not approve the published agent version, Phase 7c; **Revoke agent** with a confirm sheet while the vault approves a version or holds the agent key, Phase 12), market card, recent actions, idle balances; **Close position** (S6) and the closed state with **Start over** (S7) | Every 30 s: the position at one Base block (one block read and two Multicall3 rounds) and the agent card (`/agent/vaults`, the vault's NEAR key list). Once: recent actions from Base logs in 10,000-block windows, the close plan (again on Close position) |

S6 (close) and S7 (closed, Start over) are states of `#position`, not routes. The agent verification panel (PRD §6) opens
from S5's "Verify the agent".

**Sandbox (Phase 6b).** "Try in sandbox" (on S3 and in the header while no wallet is connected) runs the same five screens
under `#sandbox/…` on a simulated wallet and a simulated protocol (`app/src/adapters/sandbox/`): stages advance on 2 s
timers and the agent registers after 5 s. The price never moves on a timer: on S5 the **Market crash** card (Phase 11,
PRD §8a.1) plays a scripted price path the user advances in three stages (−30%, −45%, back to the start) and shows a
calculated "without the agent" outcome (Morpho Blue's liquidation, from `Morpho.sol` `liquidate`) beside the sandbox
position, where the agent's protective reduce uses the protocol's own `repayToLtv`. A banner marks every sandbox screen, explorer links are
disabled and tagged "simulated", and verification rows read "Simulated (not checked)". The previous app removed demo
balances and demo routes; this sandbox is acceptable because it is isolated and labelled: it never instantiates the
live adapters, never contacts a network host and never writes localStorage (its state lives in sessionStorage and is
cleared by Leave sandbox or by closing the tab), which `e2e/sandbox.spec.ts` checks, and it makes no claim about the
live protocol.

### One vault per wallet

The app shows the owner's newest vault numbered from `guided.firstVaultNumber` (10) in `config.app.json`, found by
scanning the factory's vaults down from its count (two at a time, `Retry-After` honoured), **and only a vault that holds
the published policy** (the same cooldown and markets, each with the published Executor, tokens and `slice_max`;
`app/src/protocol/near/vault.ts` `policyMatches`). Anyone can call the factory's `create_vault` for any owner with any
Executor, and `setup` approves the Executor stored in the vault, so a vault with another policy is skipped like another
owner's (never refused: a refusal would let anyone lock a wallet out), and setup refuses it before any signature (PR #81).
**Vaults numbered below the cutoff were made by the previous app and are not used:** they are never read, shown or offered. A failed scan is shown
as "Could not read your vaults" with Retry; it never means "no position" and never offers creation. The vault found is
remembered per owner in the browser and verified with one `get_state` on return; the scan runs again when it no longer
belongs to the owner.

## Transactions and signatures

Signatures are owner messages for the vault (ERC-191 JSON in the field order of cmdkfi/app `scripts/p2_owner.py`), signed
with nonce `owner_nonce + 1` and an expiry of NEAR time + 600 s ("each signature expires in 10 minutes"). The relayer
posts them to the vault, which checks the owner's signature and builds every Base transaction itself. Wallet
transactions are sent by the owner's connected wallet. After one click (Create position, Start closing) the prompts
are requested in order, one at a time; a rejection pauses the step with an explicit Retry; after a reload nothing is
requested until Continue.

**Open** (S4):

| # | Step | Prompt |
|---|---|---|
| 1 | Create your vault | none — the relayer creates it (`POST /create-vault`). Discovery is re-read immediately before every create request, and a vault the wallet already owns is adopted instead |
| 2 | Approve agent and rules (`setup`) | 1 signature — approves the Executor for WETH and USDC, authorizes it on Morpho, sets the corridor on both markets, approves the published agent measurement (only what Base does not already show) |
| 3 | Wrap ETH → WETH | 1 wallet transaction (`WETH.deposit`) for the missing WETH only; skipped when the wallet holds enough |
| 4 | Send WETH to your position address | 1 wallet transaction (`WETH.transfer`) |
| 5 | Open position (`open`) | 1 signature — supplies the WETH at the position address and borrows to 50 % LTV, or to what the market can lend after a 1 % margin (paused with the new figure when that is more than 2 points below what S1 showed) |
| 6 | Send USDC to your wallet (`withdraw`) | 1 signature — all USDC idle at the position address to the owner |

**Close** (S6), after a review sheet (debt, interest over the next 10 minutes, the 1 % headroom, what is sent first,
collateral returned, destination; the protocol has no close without repaying):

| # | Step | Prompt |
|---|---|---|
| 1 | Send USDC to your position address | 1 wallet transaction (`USDC.transfer`) of the shortfall: the debt accrued 600 s ahead plus the relayer's 1 % headroom, minus the USDC already there; skipped when nothing is missing. If the wallet is short, a Get test USDC panel shows the exact amount missing and the chain continues by itself when it arrives |
| 1b | Second transfer | only when the debt, re-read right before the close signature, has outgrown the USDC there (interest while the user waited) |
| 2 | Close position (`close`) | 1 signature per market holding debt or collateral (normally one) — repays the whole debt and releases all collateral |
| 3 | Return WETH to your wallet (`withdraw`) | 1 signature, when WETH is idle at the position address |
| 4 | Return leftover USDC (`withdraw`) | 1 signature, when more than 0.01 USDC is idle |

When the relayer refuses a call because the position address lacks ETH for gas, its message is shown verbatim and a gas
top-up (one wallet ETH transfer) is offered; the same signed message is then posted again while at least 45 s of its
validity remain, otherwise a new signature is requested. A lost relayer job is resolved from the vault's `owner_nonce`
and NEAR time only; a signed message is never posted twice automatically.

**Start over** (S7) appears after this session's close finished and the position address holds nothing but dust. It
reuses the same vault: S1 with 0.01 ETH, S3 shows the vault "ready for a deposit" with a **Deposit** button, and S4
starts at the wrap step. No vault is created.

## Honesty rules

- Testnet, unaudited and "protection is risk management, not insurance" are in the footer of every screen, in the S2
  acknowledgement and on S5.
- A submitted transaction is never shown as done: a step is done only when its chain check holds (job done, receipts
  with two confirmations, and the state the step should produce).
- "Checked" in the verification panel is used only for a positive result obtained in this session. A failed read is
  "Unavailable", a check with nothing to compare yet is "Not checked", and the static rows are statements.
- Missing reads are labelled unavailable; they are never replaced by estimates or mock values. After a failed refresh
  the last snapshot stays visible, marked read-only with its block and age.
- Cached data only paints the screen. The last position snapshot is kept in the browser and shown on return as
  "Read at block N, X min ago · refreshing" until a live read lands; Close position, Start over and every step of the
  onboarding and close chains wait for live reads.
- "Position closed" is shown only after a close finished in this session; it is never derived from an empty vault.
- The agent card's status is read from the chain first: the vault's approved measurement against the published
  manifest (a stale approval is "Outdated": the running agent does not watch the vault), then the recorded agent key,
  its expiry and the NEAR key list. The agent's own listing adds its last check and may lag behind the chain ("the
  agent's list has not caught up yet"); it is not a heartbeat or a guarantee of execution.
- A step whose owner call has an unknown outcome ("Checking…") says why and when the signed message expires, with a
  countdown; until then only the vault's `owner_nonce` can show that it ran.

## Network reads

| Service | URL (`app/config.app.json`) | Notes |
|---|---|---|
| Base Sepolia RPC | `https://base-sepolia-rpc.publicnode.com` | Reads go through viem's Multicall3 batching and JSON-RPC batching; every read of one refresh is pinned to one block. The wallet's network entry uses `https://sepolia.base.org` |
| NEAR testnet RPC | `https://test.rpc.fastnear.com`, fallback `https://near-testnet.drpc.org` | Every NEAR call is a read; the fallback is asked only after a retryable failure of the primary (no answer or timeout, HTTP 5xx, 429), never after a NEAR error answer |
| Relayer | `https://relayer.cmdk.fi`, fallback `https://cmdk-relayer.fffilimonov.workers.dev` | POSTs go to the primary only, wait up to 60 s for the answer and are never repeated; GETs (12 s) fall back when the primary does not answer |
| Published manifest | `https://raw.githubusercontent.com/cmdkfi/app/main/deployments/testnet.json` | Read by the verification panel, the agent card (approved vs published measurement) and right before the setup signature (the app's baked measurement must equal it) |

Measured live on 9 Nov 2026 (vault v9, two markets, the app's own adapter):

| | Before the performance pass | After batching and caching (NEAR rpc.testnet.near.org) | After the NEAR switch (FastNEAR) |
|---|---|---|---|
| One S5 refresh | 39 requests, 3.8–4.0 s | 6 requests, 3.5–4.5 s | 6 requests, 0.44–0.70 s |
| First full S5 after connect | 85 requests, 13.0 s | 17 requests, 10.0 s | 17 requests, 1.8 s (return visit 1.05 s) |

Per NEAR call: FastNEAR 0.08–0.15 s, drpc 0.10–0.32 s, rpc.testnet.near.org 3.1–3.2 s. Base answered in 0.1–0.25 s.

## Development

Node 22 and pnpm 11.7.0:

```sh
cd app
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:5173. The strict port is intentional: the relayer's CORS configuration permits that origin. The
app configuration (`public/config.json`) is generated from the published deployment manifest `deployments/testnet.json` (a copy beside the repository if present, otherwise fetched from `cmdkfi/app` `main`)
(CI downloads it from cmdkfi/app `main`; locally, place it at the repository root) and `app/config.app.json`; never
invent an address. Every address in the generated config comes from the manifest.

```sh
pnpm typecheck              # TypeScript
pnpm build                  # production build into dist/; run it first: it generates public/config.json, which one unit test reads
pnpm test                   # 162 Node unit tests (protocol math, messages, flow rules), with protocol test vectors
pnpm test:bundle-boundary   # dist/ carries no test fixture or wallet-control markers (the sandbox ships, PRD §8a)
pnpm exec playwright install --with-deps chromium   # --with-deps also installs Chromium's system libraries on Linux (as CI does)
pnpm test:browser           # desktop and mobile Chromium scenarios, including screenshot comparisons, against a production build served by vite preview
pnpm test:visual:update     # rewrite the darwin screenshot baselines on purpose (linux: `frontend quality` run by hand with visual_baselines)
```

The browser scenarios run the real app against `app/e2e/live-fixture.ts`: fake wallets (EIP-1193, announced through EIP-6963, plus an optional unannounced `window.ethereum`) and
fakes of the Base RPC (including Multicall3), the NEAR RPC, the relayer and the published manifest. The fixture keeps
its own copies of the ABI fragments from cmdkfi/app, so an app ABI mistake cannot pass by agreeing with itself; any
request to an unknown host or an unknown method fails the test. They cover the one-click open and close chains, reloads
at every prompt, rejections, gas refusals, lost jobs, a stale feed, low liquidity, the shortfall and faucet paths, the
second close transfer, an account switch mid-flow, the creation guard, the verification rows, the request budget of one
refresh, the browser caches, the NEAR fallback, a relayer 503 on an owner call, an agent list that lags the chain, a
stale vault approval and its re-approval from S5 (including a reload mid-call), a setup guard against a stale app
configuration and the wallet's watch-asset request. They do not use a real extension, a live RPC or an on-chain
transaction, and they do not replace a live signed rehearsal.

The screens follow the approved **A Light** desktop/mobile proposal (`../design-proposals/full-light-v3/` in the design workspace), synchronized with the landing design. `app/src/styles/cmdk.css` contains the shared palette, panels, responsive layouts and phone bottom sheets. The older `docs/mockups/` files remain historical references. `app/e2e/visual.spec.ts` compares desktop and mobile screenshots per screen state against baselines in
`app/e2e/__screenshots__/{darwin,linux}/`; CI and the deploy workflow use the linux set. A deliberate visual change
updates darwin with `pnpm test:visual:update` and linux with the `frontend quality` workflow run by hand with `visual_baselines: true` (same runner and
steps as CI; its artifact `visual-baselines-linux` is downloaded with `gh run download`); the new images are reviewed
before they are committed.

Pull requests to `main` run `frontend quality` (build, unit tests, bundle boundary, browser scenarios); pushes to `main`
deploy to testnet.cmdk.fi. The `deploy testnet` workflow can also be run by hand on a branch, which replaces the live app with that branch until the next push to `main`. For a look that leaves the live app alone, the `preview` workflow (every pull request, or by hand on a branch) uploads a Worker version with its own `*.workers.dev` URL and posts it on the pull request; a preview serves the layout and the sandbox, while live relayer calls are refused from a preview origin by the relayer's CORS list.

## Responsive design review

The first screen keeps the available ETH → USDC route visible on phones and expands the asset catalogue on request.
Setup steps remain visible before connecting. Transaction progress puts the active step first on phones; confirmation,
revoke and sandbox dialogs become scrollable bottom sheets. Position metrics stack, long addresses wrap, and sandbox
crash comparisons stack without horizontal scrolling. Resizing never remounts the adapters or clears a flow.

Amounts, rates, balances, agent states and verification results still come from the existing adapters. No illustrative
mockup values enter live screens. Protocol messages, transaction ordering and recovery checks are unchanged.
The browser suite exercises both viewports against the existing fixtures; mobile tests additionally cover the compact
catalogue, no-wallet guidance, confirmations and layout widths from 320 to 1024 px. Real mobile wallet signing still
needs a device rehearsal; a browser fixture is not a wallet integration test.
