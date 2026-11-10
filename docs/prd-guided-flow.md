# PRD — cmdk guided flow (testnet.cmdk.fi replacement)

Status: draft v2 for review, 9 Nov 2026 (v1 reviewed by the product owner the same day; D1 and D3 resolved, open-signature chaining added). Revised during Phase 2 (9 Nov): D5 reuses an empty vault and "closed" is never derived from chain state; EIP-7702 delegated accounts are allowed; the shell is not mounted below 960 px. Author: Claude Code with the product owner. Protocol facts checked against cmdkfi/app `47fd4fb` (= origin/main on 9 Nov 2026). Frontend facts checked against cmdk-app `61f71cc`.

This document describes a new, deliberately narrow frontend that replaces the current cockpit on https://testnet.cmdk.fi. It keeps the current visual identity and tech stack, reuses the proven protocol client modules, and exposes one guided path: choose collateral and debt → accept fixed agent settings → connect MetaMask → sign and fund → watch progress → see one position → repay and close → start over.

Companion action plan: `tasks/todo.md`.

---

## 0. Summary

| Item | Decision |
|---|---|
| Audience | Desktop users with MetaMask on Base Sepolia. Testnet only, unaudited, no real funds. |
| Product | Deposit ETH (wrapped to WETH), borrow USDC on Base Morpho, agent protects the position (reduce / migrate to backup market / exit). |
| What the user sees | Landing choice screen → read-only settings → wallet → guided progress → position screen with two actions → start over. |
| What the user never sees | Rule editing, multi-vault tables, held-transaction cancellation panel, NEAR history viewer, demo market, raw cockpit. |
| Sandbox | A "Try in sandbox" mode that runs the whole flow on a simulated wallet and simulated protocol, clearly labelled, with no real network calls. Built into the foundations (section 8a), shipped as soon as the live flow is stable. |
| Stack | Same libraries: React 18, Vite (pinned), TypeScript, wagmi/viem, TanStack Query, hash routing, Cloudflare Workers static assets via the existing `wrangler.jsonc` and GitHub workflows. **All application code is new, including the protocol layer**, which is written from cmdkfi/app (§8b). The previous app is documentation and a source of test vectors, not a dependency (product owner, 9 Nov). |
| Branch | `feat/guided-flow`; preview deploy via `workflow_dispatch` of `deploy-testnet.yml` from the branch; merge to `main` when accepted. |

---

## Terminology (fixed for code and copy)

| Term | Meaning | Where it appears |
|---|---|---|
| **Vault** | The NEAR account `v<N>.factory.prime-measure-1792736012.testnet`. A contract with no keys. It stores the owner's wallet address, verifies the owner's signed messages, and signs Base transactions through NEAR chain signatures. | Verification panel, NearBlocks links, code. Never as a place the user "sends" anything to. |
| **Position address** | The Base Sepolia address derived from the vault (`base_address` in the protocol). It holds WETH, USDC and gas ETH, and Morpho sees it as the borrower. Only the vault contract can sign for it: on the owner's signed messages for everything, and on the agent's restricted key for reduce, migrate and exit only. | All user-facing steps: "Send WETH to your position address", "Send USDC to your position address". |
| **Agent** | The TEE-hosted program with a function-call key on the vault limited to `reduce`, `migrate`, `exit`. It does not control the position address; it can only ask the vault to perform those three actions within the corridor. | Settings, position screen, verification. |
| **Owner / you** | The MetaMask wallet whose address is stored in the vault. | Everywhere. |

The earlier phrase "address on Base controlled by the agent" is replaced by "position address" throughout.

---

## 1. Protocol facts that shape the product (verified in code)

These are not design choices. Every screen below is constrained by them.

1. **Vault creation needs no user signature.** `POST /create-vault {owner, policy, deposit_near}` is executed and paid by the relayer (2 NEAR deposit + 0.005 ETH gas float to the position address). Rate limit: 2 per IP per hour, 20 per day (`cloud/src/index.ts`). Job stages: `accepted → vault_created → float_sent → done | failed`.
2. **Every owner action is one ERC-191 `personal_sign` of a JSON message**, relayed to the NEAR vault, which signs Base transactions through chain signatures. No Base gas is paid by the user for owner actions. Message envelope: `{protocol:"cmdk-vault/1", network:"testnet", vault, method, args, nonce, expiry}`; `nonce > owner_nonce`, `expiry ≤ now+3600`, relayer needs ≥30 s left (`vault/src/owner.rs`, `scripts/relayer.py`). One owner call at a time per vault.
3. **Setup is one signature** carrying both markets and the agent measurement: `setup {markets:[{market:LIVE, approve:true, authorize:true, corridor}, {market:BACKUP, approve:true, authorize:false, corridor}], measurement}` → 5 Base txs paid from the position address's ETH float (`vault/src/lib.rs` l.289-320; the vault emits an identical approve only once per message, so approving on both markets of one executor still gives 5). **Flags (product owner, 9 Nov, Phase 2b):** `approve` is always true, including in a resumed setup, because the relayer allows a repeated approve (`scripts/relayer.py` l.466); only `authorize` is derived from Base facts, per executor: true on the first market of an executor Morpho has not authorized, false everywhere else (l.468-477). A corridor is sent only where Base has none. **Setup complete** = Morpho authorization present, both allowances > 0 (the relayer refuses only a zero allowance, l.478-483; Circle's USDC lowers the allowance on every pull, so "not max" is not "missing"), both corridors set on Base, and the approved measurement equal to the published one.
4. **Corridor defaults are valid:** target 50% / act 70% / floor 30% / sell budget 20% / migrate allowed / exit allowed; `floor < target`, `target+0.1pp < act < lltv (86%)` (`executor/src/CorridorMath.sol`).
5. **There is no "AI enabled" flag.** The agent protects a market when: the vault's `approved` measurement equals the running agent's measurement, the market has `corridor_set`, and the agent has registered its key. Registration is asynchronous (agent polls every 60 s; the Worker cron that funds the agent key runs every minute since 10 Nov, previously every 10 min): expect a few minutes. Rehearsal on 9 Nov: setup 21:47, agent noticed 21:55, registered 22:01:42 UTC with the old 10-minute cron and the slow official NEAR RPC on the agent side, both since changed or being changed by the protocol team. "Off" = owner `revoke_agent`.
6. **Native ETH is never collateral, and Morpho cannot take ETH.** Morpho Blue markets hold ERC-20 tokens only; both the live and backup markets have `collateralToken` = WETH `0x4200…0006` (`deployments/testnet.json`), and the Executor states "no native value" (`Executor.sol` l.9). Nothing in the vault, executor or agent wraps ETH; the vault allowlist forbids `WETH.deposit()`; native ETH at the position address can only return to the owner via `sweep_eth`. Collateral must arrive as **WETH at the position address** (`base_address`), then the owner signs `open`. WETH is required; wrapping happens in the user's wallet.
7. **Only the owner can open or increase debt.** `open {market, collateral_in, target_ltv}` supplies collateral and borrows to the target in one Base tx (`Executor.open`). The agent's key is limited to `reduce`, `migrate`, `exit`; it can never increase debt. There is no borrow-to-target automation. **Migration does not need the agent to borrow on its own:** `Executor.migrate` moves debt and collateral atomically inside one Morpho flash loan (repay on the source, withdraw collateral, supply on the destination, borrow the same amount there, `Executor.sol` l.305-357 and `onMorphoFlashLoan` l.404-416), checks that debt is conserved up to rounding, and reverts if the destination LTV would exceed the trigger line. This covers moves between Morpho markets on Base. **It does not cover a future move to another venue (Aave) or another chain:** such a move cannot be atomic, so the agent would have to open a new debt position at the destination, which needs a new, bounded "may open debt at an approved destination" permission in the vault allowlist and Executor (noted by the product owner, 9 Nov; protocol work, out of scope here). Consequence for this frontend: the settings block must be a list of permission rows that can grow, and the copy must say "cannot increase your debt on this venue" rather than an absolute "never borrows".
8. **Borrowed USDC lands at the position address**, not in the user's wallet. Moving it to the wallet is a separate owner `withdraw {token, amount, destination}` signature.
9. **Repay and close draw USDC from the position address.** `close {market}` repays all debt from the idle USDC at the position address and returns WETH to the position address. Relayer precheck requires idle USDC ≥ debt × 1.01. If short, the user first transfers USDC from the wallet. Returning WETH to the wallet is another `withdraw` signature.
10. **Nothing releases collateral while debt > 0 for the owner.** Only the agent's `exit` sells collateral to repay, and it is not owner-triggerable. "Close without repay" as a one-click exit does not exist in the protocol today (see Decision D3).
11. **No vault deletion and no one-vault-per-owner enforcement.** The factory has no owner index; discovery enumerates `v1..vN.<factory>` and filters `owner`. The protocol also keeps no "ever opened" state per vault (`close` only clears `sessionStart`; `closedForAgent` is set by `exit` and cleared by `open`), so a closed vault cannot be told apart from one that was set up and never opened. Neither needs to be: an empty vault with complete setup is reusable, so "Start over" reuses it (D5) and a new vault is created only when the wallet owns none. Vaults numbered below `guided.firstVaultNumber` (10) were made by the previous app and are ignored (D4, R8).
12. **Gas for owner and agent Base transactions comes from the position address's ETH balance** (the 0.005 ETH float). The relayer refuses jobs the vault cannot pay for. Worst case at 2 gwei: setup ≈0.00096 ETH, open ≈0.0012 ETH, close ≈0.001 ETH, each transfer ≈0.00016 ETH. Agent actions also spend it. A top-up is a plain ETH transfer from the wallet.
13. **Verification evidence is public:** `GET /agent/` index, `/agent/vaults` (registration and status per vault), `/agent/evidence/<file>` (`app-compose.json`, quote, `info.json`, registration files), transcripts. The published measurement lives in `deployments/testnet.json` `agent.measurement` with `sourceCommit` and image digest. Full TDX reproduction requires Docker and is out of browser scope.
14. **Relayer CORS** allows `https://cmdk.fi`, `https://testnet.cmdk.fi`, `http://localhost:5173`.
15. **Honesty constraints from README/design docs:** testnet only, unaudited, "protection is risk management, not insurance", "no backstop in v1", enclave is defence in depth not the root of trust, a submitted transaction is not a completed one, never show "Verified" without a result, never replace missing reads with mock values.

---

## 2. Open decisions

Each decision has a recommended default. The PRD below assumes the recommended or adopted default unless marked otherwise.

| # | Question | Options | Recommended default |
|---|---|---|---|
| **D1** | How does ETH become WETH at the position address, given no auto-wrap exists? | — | **Resolved (product owner, 9 Nov):** the "Send WETH to your position address" step runs an inline **Wrap ETH → WETH** action from the user's wallet; the wrap is skipped when the wallet already holds enough WETH. WETH is mandatory (fact 6). |
| **D2** | Does onboarding end with borrowed USDC in the user's wallet? | (a) Yes: the flow asks for one more signature (`withdraw USDC → wallet`) right after `open` confirms, chained automatically. (b) No: USDC stays at the position address and the position screen shows "Send USDC to wallet". | **Resolved (product owner, 9 Nov): (a).** The last chained prompt withdraws the borrowed USDC to the connected wallet. |
| **D3** | What does "close without repay" mean? | — | **Resolved (product owner, 9 Nov):** one action only, **Close position**, which repays from the idle USDC at the position address and inserts a manual "Send USDC to your position address" transfer when it is short. No "close without repay" button. |
| **D11** | Signatures are not separate user steps. | — | **Resolved (product owner, 9 Nov):** after the user confirms the deposit, the app chains every required MetaMask prompt automatically (setup → wrap/transfer → open → withdraw) as soon as its predecessor is confirmed. The progress list shows sub-states; the user only acts inside MetaMask. One explicit button exists at the start ("Create position") and one per retry after a rejection. |
| **D4** | Which vault is "the position" for a wallet that owns several? | — | **Revised (product owner, 9 Nov, Phase 2):** only vaults numbered from `guided.firstVaultNumber` (10, in `config.app.json`) count; the **newest** of them is the position. Vaults below the cutoff were made by the previous app: they are not read, not shown and get no note, and a read failure on them does not fail discovery (R8). (Superseded: (b) newest vault with debt or collateral across all vaults, with a NearBlocks note for older ones.) |
| **D5** | When does "Start over" appear, and what does it do? | — | **Revised (product owner, 9 Nov, Phase 2):** Start over appears only as the terminal state of a close chain run in this session (kept in the local record). It **reuses the empty vault** and goes to S4 at the deposit step; no new vault is created. A new vault is created only when the wallet owns none (from the D4 cutoff). "Position closed" is never derived for a vault that was merely discovered. (Superseded: (a) create a new vault when the active vault is empty, which wasted the 2/IP/hour creation quota and needed a history scan to tell "closed" from "never opened".) |
| **D6** | Should "Close position" also revoke the agent on the old vault? | (a) Yes, one more signature. (b) No; an empty vault is harmless, the agent only acts where there is debt. | **(b), adopted.** |
| **D7** | Deposit amount bounds and gas top-up? | Minimum deposit, maximum deposit, and whether to offer "Top up gas" (plain ETH transfer to the position address) when its ETH is below the next action's cost. | **Adopted: min 0.001 ETH, no max**, USD value from the Chainlink oracle read. **Top-up is reactive** (simplified by the product owner, 9 Nov): the app does not predict relayer gas refusals; when the relayer refuses an owner call for insufficient funds (400 before sending), the step shows the relayer's message and offers the top-up transfer, then retries the same signed intent only if it is still fresh, otherwise re-signs. |
| **D8** | Labels for the fixed settings. | The request said "AI enabled". The protocol has an agent with a rule-based protective reduce and an LLM judge for discretionary moves. | **Adopted:** block titled **"Agent protection: on"** with the sub-line "Rule-based reduce at 70% LTV; AI-judged migrate/exit within your corridor". |
| **D9** | Desktop-only handling. | (a) Hard block under 960px with a message. (b) Allow but untested. | **(a), adopted.** |
| **D10** | Coming-soon catalogue text. | Venues: Rhea (NEAR), Aave (Ethereum), Kamino (Solana). Collateral: BTC, NEAR, Gold, AAPL. Debt: USDC only. | **Adopted as listed.** Disabled tiles, "Coming soon" tag, no date. |

All decisions are closed. Confirmed end-to-end flow (product owner, 9 Nov): user arrives → connects wallet → creates vault, deposits WETH and receives USDC → repays → closes. "Repay" and "close" are the two phases of the single Close position action.

---

## 3. Scope

### In scope
- Desktop web app at testnet.cmdk.fi, MetaMask only (EIP-6963 announced provider or `window.ethereum` with `isMetaMask`).
- Base Sepolia (84532) and NEAR testnet; markets `live` (selected) and `backup` (approved for migration); `demo` market never shown.
- Full guided onboarding with live progress and verification information.
- One position per wallet; repay and close; start over.
- Honest error, recovery, and reload behaviour for every owner call.
- Sandbox mode foundations: every screen talks to a protocol adapter interface, and a simulated adapter can replace the live one (section 8a). The sandbox UI itself may ship after the live flow (plan Phase 6b).
- Unit tests, Playwright fixture scenarios, live testnet rehearsal, deploy.

### Out of scope (v1)
- Rule editing, revoke agent UI, "close without repay", multiple positions, manual borrow more, partial repay, withdraw-only, held-transaction cancellation panel, NEAR transaction viewer, transcript browser, mobile layout, other wallets, mainnet, any venue or asset other than WETH/USDC on Base Morpho.

---

## 4. User flow

```
S1 Choose ──► S2 Settings (read-only) ──► S3 Connect MetaMask ──► S4 Progress ──► S5 Position
                                                                       ▲              │
                                            returning wallet with vault│              ├─► S6 Close position ─► S5 (closed) ─► S7 Start over ─► S4 (deposit, same vault)
                                                                       └──────────────┘
```

Returning users: when a connected wallet owns a vault (D4), the app skips S1–S4 and opens S5. If that vault's onboarding is incomplete (setup not done, no collateral yet, borrowed but not withdrawn), S4 opens at the first unfinished step.

### S0 — Entry and navigation (what `/` shows)

The app has one purpose, so it has no menu. The header holds three things: the brand mark (home), the **wallet slot**, and the testnet chip. The wallet slot is the only navigation control.

| Wallet slot state | Label | Click |
|---|---|---|
| Not connected | *(empty; only the testnet chip)* | Nothing. Connecting happens on S3 only (product owner, 10 Nov: no Connect button in the header). |
| Connecting / checking vaults | "Checking your vaults…" with a spinner | Nothing |
| Connected | `0x19E7…ff2A · Base Sepolia` | Menu: Copy address · View on BaseScan · Disconnect |
| Wrong network | `0x19E7…ff2A · Switch to Base Sepolia` (warning style) | Requests the network switch |
| Sandbox active | **Sandbox wallet · simulated** | Menu: Leave sandbox |

**Where `/` (and `#start`) lands**, decided after wallet state and vault discovery are known:

| Wallet | Vaults found for this wallet | Lands on |
|---|---|---|
| Not connected | — | S1 Choose. A returning user is reconnected silently when the wallet remembers the site; otherwise they reach the wallet step through Continue → S2 → S3 |
| Connected, discovery failed | unknown | S1 with a banner "Could not read your vaults. Retry" — never "no position", never Create position |
| Connected | none | S1 Choose with the wallet shown; Continue → S2 → S3 (already connected, so S3 is the funding check and the Create position button) |
| Connected | setup incomplete (any of corridors, allowances, Morpho authorization or approved measurement missing) | S4 Progress at the setup step |
| Connected | WETH waiting at the position address, no Morpho position | S4 Progress at the open step |
| Connected | local onboarding record and no vault yet | S4 Progress at the create step |
| Connected | active position (debt or collateral > 0) | S5 Position; when USDC above dust is idle at the position address, S4 at the withdraw step only if a local onboarding record exists, otherwise S5 with the idle-balances line |
| Connected | empty vault with complete setup (both corridors set, allowances and Morpho authorization present, approved measurement equal to the published one) | S4 Progress at the deposit step: "Your vault is ready. Deposit to open a position." No claim about the vault's history |
| Connected | liquidated (collateral 0, debt > 0) | S5 liquidated variant |

Chain state always wins over local records: a local onboarding record never overrides a position the chain shows (active or liquidated) or this session's closed state. The S5 closed variant exists only right after a close chain finished in this session.

**Routes.** Five live hash routes: `#start` (S1), `#settings` (S2), `#connect` (S3), `#progress` (S4), `#position` (S5). S6 close-in-progress and S7 closed are states of `#position`, derived from the same position read; the close chain runs on that screen. S2 has its own hash so browser Back works between S1, S2 and S3. Unknown hashes go to `#start`.

**Route guards.** `#position` without a position redirects to `#start`. `#progress` without an onboarding record or a half-set-up vault redirects to `#start`. `#start` with an active or liquidated position redirects to `#position` (the brand mark therefore goes to the position when one exists). Disconnecting returns to `#start` and clears nothing on chain; local onboarding records are kept per wallet and reused on reconnect. Sandbox routes mirror the same five under `#sandbox/…` (section 8a) and never redirect into live routes; `#sandbox/close` and `#sandbox/closed` redirect to `#sandbox/position`.

**Returning user, no clicks:** open the site, the wallet reconnects silently through the wallet's remembered permission, discovery runs, and the position screen appears. If no wallet remembers the site, S1 shows and the user connects on S3.

### S1 — Choose
- Three columns: **Collateral** (ETH enabled; BTC, NEAR, Gold, AAPL disabled "Coming soon"), **Borrow** (USDC enabled), **Venue** (Morpho on Base enabled; Rhea on NEAR, Aave on Ethereum, Kamino on Solana disabled "Coming soon").
- Amount field for ETH, **prefilled with 0.01 ETH** (editable; product owner, 9 Nov: the small default keeps test positions within the market's liquidity and lets one faucet claim cover the close), with USD estimate from the live market oracle read (`Executor.config` → oracle `price()`), min per D7. Estimated USDC to borrow at 50% target, shown as "about", recomputed every 30 s. Borrow rate shown from the IRM `borrowRateView` as a simple APR (rate × 31,536,000 / 1e18, `scripts/SCENES.md` l.236), labelled "APR", when readable; otherwise "rate unavailable", never a placeholder. A "Collateral yield: none" row states that Morpho Blue collateral is idle (there is no supply rate to show). Market liquidity is not shown by default; when the market cannot lend the full target amount, a warning replaces the estimate with the amount it can lend (after a 1% margin) and the resulting LTV, plus "Deposit up to N ETH to open at 50%" (R2; Q1, product owner 9 Nov).
- Header chips: "Testnet · Base Sepolia · no real funds". Footer: unaudited, protection is not insurance.
- Primary action: **Continue**. No wallet needed yet.

### S2 — Settings (read-only)
One picture, not a table (mockup review, 9 Nov 2026):

- **Corridor bar** with four marked points and one sentence each: Floor 30% (the agent never reduces below this), Target 50% (you open here; the agent brings you back here), Reduce above 70% (the agent sells collateral to repay part of the debt), Liquidation 86% (Morpho's rule, not ours; protection is not a guarantee).
- **Three short lists** side by side. *The agent will:* reduce past 70%; move to the approved backup Morpho market if the live one becomes unsafe; exit if nothing else works; at most one action per 120 s. *The agent can never:* increase your debt on this venue; sell more than 20% of collateral per day; send funds anywhere except repaying the loan; change these limits (enforced by the vault key restrictions and the Executor, not by the agent). *You keep:* every other action by your signature only; the right to close any time by repaying; a 10-minute expiry on every signed message.
- The **agent version** (measurement, source commit) is not shown here. It is not actionable on this screen; the verification panel on S4 and S5 compares it automatically against the vault's approved value and the published manifest, and shows the result.
- Checkbox: "I understand this is a testnet prototype; protection is risk management, not insurance." Required.
- Primary action: **Continue to wallet**. Secondary: Back.

### S3 — Connect MetaMask
- **Connect wallet** (product owner, 10 Nov; replaces MetaMask-only): the app lists every injected wallet announced through EIP-6963 (MetaMask, Rabby, Coinbase Wallet extension, Brave, OKX, …) plus a legacy `window.ethereum` entry when it is not announced, using wagmi's connectors, which the app already depends on; no third-party connect-modal library (they add WalletConnect, mobile and bundle weight the product does not use). Each entry shows the wallet's name and icon from its EIP-6963 announcement. No wallet detected → "Install a wallet" link (MetaMask by default) plus **Try in sandbox**. After connecting, the same checks as before: Base Sepolia switch or add, plain or EIP-7702 EOA only (contract wallets, including Coinbase Smart Wallet, are blocked with the reason because the vault verifies ERC-191 signatures with ecrecover). **Try in sandbox** stays as the secondary action (section 8a).
- Wrong chain → **Switch to Base Sepolia** (`wallet_switchEthereumChain`). If MetaMask answers 4902 (network unknown), the app calls `wallet_addEthereumChain` with: chainId `0x14a34` (84532), chainName "Base Sepolia", rpcUrls `https://sepolia.base.org`, nativeCurrency ETH/18, blockExplorerUrls `https://sepolia.basescan.org`. MetaMask shows its own confirmation; the user approves inside MetaMask. A "Having trouble?" line links the Base docs page for connecting to Base and the manual values above for copy-paste.
- **Testnet ETH check (section 4a).** After connecting, the app reads the wallet's Base Sepolia ETH balance and compares it with the chosen deposit plus a gas allowance for two transactions. If short, the **Get Base Sepolia ETH** panel opens (see S3a) and "Create position" stays disabled until the balance is enough. The balance is re-read every 10 s while the panel is open and the flow continues automatically when funds arrive.
- Contract wallet → blocked with message (reuse `accountKind`). EIP-7702 delegated accounts are allowed: they sign with their own key, and the vault verifies owner messages with `env::ecrecover` (`vault/src/owner.rs` l.46), which they satisfy; only contract wallets cannot (product owner, 9 Nov, Phase 2).
- Rejection keeps the entered amount. Disconnect returns to S1 with state retained in `sessionStorage`.
- After connect: discovery (D4). If a vault exists, route to S5 or the resume point in S4. If none, show "Create your position" and start S4 on click.

### S3a — Get Base Sepolia ETH (help panel)
Inline panel on S3 (and reachable from S4 if the wrap step fails for insufficient ETH). Content:
- Wallet address with a copy button, current balance, and the amount still missing.
- "Testnet ETH is free. Request it from one of these faucets, then come back; this page updates by itself." Links, in this order:
  1. Base docs, Network Faucets page (canonical list, kept current by Base).
  2. Coinbase Developer Platform faucet (Base Sepolia, needs a Coinbase developer login).
  3. Alchemy Base Sepolia faucet (needs an Alchemy login; requires a small mainnet ETH balance on the wallet).
- Copy rule: do not quote drip sizes or rate limits; they change. Say "limits apply, usually one request per day per faucet".
- The panel never blocks the rest of the screen; closing it keeps "Create position" disabled until the balance is enough.

### S4 — Progress
One screen, vertical step list, exactly one step active at a time. Each step shows: title, live status, transaction or job link when it exists, and an expandable "Why" line. A submitted item is "Submitted", never "Done", until confirmed with the stated evidence.

**Chaining (D11).** The user presses **Create position** once. From then on the app requests each MetaMask prompt automatically the moment its predecessor is confirmed; the user does not click per step. The active step shows "Waiting for MetaMask…" while a prompt is open. A rejected prompt pauses the chain on that step with a **Retry** button and keeps all data. There is no mid-flow user choice: the app reads the wallet's WETH balance and wraps only the missing amount before sending ("most actions under the hood", the product owner, 9 Nov).

| # | Step | MetaMask prompts (automatic) | Evidence of completion |
|---|---|---|---|
| 1 | Create your position | none | relayer job `done`; position address shown (vault id in the Why line); link to NearBlocks account. Creation is guarded by a fresh ownership read, never by a cached one (Phase 7): discovery is re-run immediately before **every** create POST (the first one and any repeat after an uncertain response or 404 job), and a vault the wallet already owns is adopted instead of creating another; this is the only way two vaults at or above the D4 cutoff could exist, and this step closes it. |
| 2 | Approve agent and rules | 1 signature (`setup`). A resumed setup always sends `approve: true` and derives only `authorize` from Base (fact 3). Right before the prompt the measurement baked into `config.json` is compared with the published manifest; if they differ the step pauses with "This app's configuration is behind the published agent version; try again later." and Check again (Phase 7b item 1a: approving a stale measurement costs a signature and leaves the vault unwatched, as happened to v10 on 9 Nov) | job `done`, 5 Base receipts status 1 with 2 confirmations, then setup complete per fact 3: `morpho_authorized`, both allowances > 0, both corridors `set`, measurement approved |
| 3 | Agent registration | none | `/agent/vaults` row `registration=registered`, `agent_status=active`, `expires_at` in future, NEAR access key present. Non-blocking: steps 4–6 proceed while this shows "Registering (usually within a few minutes)". While the agent's list lags behind a key the vault already holds, the row reads "The agent's list has not caught up yet" (Phase 7b). |
| 4 | Send WETH to your position address | sub-state 4a **Wrap ETH → WETH** (`WETH.deposit` for the missing amount, 1 tx) automatically when wallet WETH < amount; then 4b `WETH.transfer(base_address, amount)` (1 tx) | 4a receipt status 1 and wallet WETH ≥ amount; 4b receipt status 1 and `GET /vault/<id>` WETH balance at the position address ≥ amount |
| 5 | Open position at 50% LTV | 1 signature (`open`, `collateral_in` = WETH balance at the position address, `target_ltv` = 0.5e18, or what the market can lend now with a 1% margin when that is less: the step then reads "opened below target (X%)"). Immediately before the prompt the app re-reads the feeds (R1) and the liquidity: under 1 USDC lendable it pauses with an explanation and Retry; if the achievable LTV is more than 2 points below what S1 showed for this amount, it pauses and shows the new figure for the user to accept (Q1, product owner 9 Nov). Requested automatically after 4b confirms | job `done`, `Executor.open` receipt status 1 with 2 confirmations, Morpho position shows collateral |
| 6 | Send USDC to your wallet (D2) | 1 signature (`withdraw` USDC, full idle balance, destination = owner), requested automatically after 5 confirms; skipped when no USDC above dust is idle | job `done` and the USDC idle at the position address below `usdcDust` (the wallet balance is not compared; product owner, Phase 3) |
| — | Top up gas (D7, reactive) | 1 tx (plain ETH transfer to the position address) of (need − have) × 1.25 from the relayer's refusal text, rounded up to 0.0001 ETH, minimum 0.0005 ETH (Q2) | inserted only after the relayer refused the owner call for insufficient funds; after it confirms, the same signed message is posted again if it still has ≥ 45 s, otherwise a new signature is requested |

Total for a wallet without WETH: 2 transactions + 3 signatures (+1 tx if top-up needed). With WETH already in the wallet: 1 transaction + 3 signatures.

Rules for S4:
- Each owner call follows FR-6 (lock record keyed `vault:owner`, fresh `owner_nonce` read before and after signing); reconciliation after a reload or a lost job uses only the job, `owner_nonce` and NEAR time, shown as "Checking…".
- Failures show the relayer `error` text verbatim plus one plain-language line. Retry after a refusal says which it does: "Send the same signed message again" (≥ 45 s valid) or "Sign a new message". Job polling is 1 s for 30 s, then 2 s, capped at 180 s, then "Still waiting" with the job id and Check again (FR-5). An account or chain change pauses the chain and re-keys the record lookup to the new owner.
- Right rail: **Agent verification** panel (section 6), visible from step 1.
- The step list persists in `localStorage` keyed `factory:owner` with the vault inside the record (the vault does not exist before step 1; Q3), so reload resumes; nothing is prompted after a reload until the user clicks Continue.

### S5 — Position
- Hero: **Debt** (USDC, with accrued interest at the read block), **Collateral** (WETH and USD), **LTV** with the segmented track showing floor 30, target 50, trigger 70, liquidation 86. Data freshness line: "Read at block N, 12 s ago". Polling every 30 s while visible.
- **Agent** card: status `Active | Registering | Expired | Revoked | Outdated | Not approved | Unavailable`, chain first (Phase 7b, product owner after the 9 Nov rehearsal). The approval comes first: the vault's `approved` against the published manifest (the agent watches a vault only under its own measurement, agent/src/vaults.rs l.8-9, l.82-87), "Outdated" when it differs ("Your vault approved an earlier agent version; the running agent does not watch it"), "Not approved" when the vault approves none, "Unavailable" only for failed reads. Then the vault's recorded agent key with a future expiry plus the limited-key check means registered; `/agent/vaults` adds liveness or "the agent's list has not caught up yet", and its "revoked" counts only when the chain shows no key or the agent reports another key; last tick time; remaining daily sell budget; "Verify" link opening the verification panel.
- **Market** card: "Morpho · USDC/WETH on Base Sepolia · live" or "backup" (the market holding the debt is the current one); pair and LLTV; market id prefix (no explorer page exists for a Morpho market id, so the links go to the Morpho and Executor contracts); **oracle source and freshness** from the Executor's configured feeds ("Chainlink ETH/USD · updated N min ago", the same reads as the R1 check); backup status: "Approved for migration" only when both corridors are set with `migrateAllowed` and neither market is closed for the agent (`Executor.migrate` l.304-309, `_agentCorridor` l.470-474), otherwise the plain reason; links for the position address (BaseScan) and the vault (NearBlocks, URL from `config.app.json` `help.nearblocks`).
- **Recent actions**: the last 10 000 blocks of `eth_getLogs` on the Executor filtered by `topics[1] = base_address` plus WETH/USDC `Transfer` logs touching the position address, labelled **You** (CorridorSet, Opened, Repaid, Closed, and transfers between the wallet and the position address) or **Agent** (Reduced, Migrated, Exited, SessionEnded); transfers involving any other address are labelled **Transfer**. Amounts, time and a BaseScan link per row; the covered block range is stated. "Load earlier" extends the window by another 10 000 blocks back to the Executor's deploy block. RPC failure shows "Could not load recent actions" and keeps the previous list. (Phase 4: block windows replace the earlier "last 20 events" wording.)
- **Idle balances** line when WETH, USDC or ETH sits at the position address outside Morpho (always after close). Not a free-withdrawal promise for collateral inside Morpho.
- Action: **Close position** (D3). Nothing else. Its sub-line states what will happen: "Repays N USDC held at your position address, returns your WETH to your wallet" or "You will first send N USDC to your position address, then…".
- Closed state: shown only as the terminal state of a close chain run in this session (local record): zero debt, zero collateral, idle balances shown, **Start over** (D5). A discovered empty vault is never shown as closed; it lands on S4 at the deposit step.
- Critical state: collateral 0 with debt > 0 (liquidated) is shown as "Position liquidated" with the remaining debt, no promise of recovery.

### S6 — Close position
Guided steps on the position screen, same component and chaining rule as S4 (one click on **Close position**, then automatic MetaMask prompts):

| # | Step | User action | Condition |
|---|---|---|---|
| 1 | Send USDC to your position address | 1 MetaMask tx `USDC.transfer(base_address, shortfall)` | only if idle USDC < debt × 1.01 (relayer headroom); shortfall computed from a fresh read and shown; if the wallet's USDC is also short, the chain pauses here and the **Get test USDC** panel (S6a) opens with the exact amount missing; no partial close is offered |
| 2 | Close position | 1 signature (`close`) | — |
| 3 | Return WETH to your wallet | 1 signature (`withdraw` WETH) | idle WETH > 0 |
| 4 | Return leftover USDC | 1 signature (`withdraw` USDC) | idle USDC > 0.01 |

Review sheet before the first signature lists debt, interest, headroom, collateral returned, destination wallet, "each signature expires in 10 minutes". Confirmation of close is the `Closed` event receipt and a fresh Morpho read with zero borrow shares.

### S6a — Get test USDC (help panel)
Opens automatically when the wallet's USDC is below the shortfall during Close position. Content:
- Wallet address with a copy button, wallet USDC balance, and the exact USDC still missing (debt + accrued interest + 1% headroom − idle USDC at the position address − wallet USDC), refreshed every 10 s.
- "Test USDC is free from Circle's faucet. Choose **Base Sepolia** in the network dropdown; USDC sent on another network cannot reach this wallet." Primary link: Circle faucet (`https://faucet.circle.com`). Secondary: Coinbase Developer Platform faucet (also dispenses test USDC on Base Sepolia).
- Reminder that the 1% headroom returns as leftover USDC in the last close step.
- The chain resumes by itself when the balance covers the shortfall; the user does not click again.

### S7 — Start over
- Appears per D5, after a close chain finished in this session, and only when debt, collateral and idle WETH are zero and idle USDC is at most the dust threshold.
- Click → the close record is cleared and the user returns to **S1 with the 0.01 ETH default** to choose the amount; S2 as usual; S3 shows the vault as "ready for a deposit" and its button reads **Deposit** instead of Create position; S4 resumes at the wrap step on the **same vault**. No vault is created and no creation quota is used (Phase 5 implementation, 9 Nov).
- A new vault is created only when the wallet owns none above the cutoff (D4); then rate-limit refusals (429 with `Retry-After`) are shown as a countdown.
- While a close chain is unfinished, its record keeps the user on S5 through reloads, so returned WETH at the position address is not mistaken for a fresh deposit.

---

## 5. Functional requirements

**FR-1 Catalogue.** Only ETH → USDC on Morpho Base is selectable. Disabled options carry a "Coming soon" tag and are not focusable for selection. No date promises.

**FR-2 Fixed settings.** The corridor, markets, cooldown, slice max and measurement come from `config.json` (generated from `deployments/testnet.json` and `config.app.json`); the UI never lets the user change them. The setup message is built with `repairSetupArgs` so flags match Base state.

**FR-3 Wallet.** Any injected EIP-1193 wallet announced via EIP-6963 (plus legacy `window.ethereum`), desktop; wagmi connectors, no connect-modal library; the header shows the wallet slot only once connected (no Connect button in the header); Base Sepolia enforced; externally owned keys only: plain EOAs and EIP-7702 delegated EOAs (both verify under the vault's `ecrecover`), never contract wallets; connection state is not stored beyond wagmi's own persistence.

**FR-4 One position.** The app shows exactly one vault per connected wallet: the newest numbered from `firstVaultNumber` (D4). Discovery uses batch 2 and `Retry-After` handling; vaults below the cutoff and read failures on them are ignored. A failed scan is shown as "Could not read your vaults" with Retry; it never shows "no position" or offers creation. Creation is guarded by a fresh ownership read, never by a cached one: the create step re-runs discovery immediately before every `/create-vault` POST and adopts an owned vault (S4 step 1). The cached answer is refreshed as soon as a run creates or adopts a vault, the landing table runs again when MetaMask switches to another account, and S3 never overwrites an onboarding record that names a vault (it returns to S4). (Phase 7, 9 Nov.)

**FR-5a Chaining.** MetaMask prompts are requested automatically in order (D11); at most one prompt is open at a time; a rejection pauses the chain on that step; a page reload resumes at the first unconfirmed step and re-requests its prompt only after the user clicks Continue (no surprise prompts on load).

**FR-5 Progress truth.** Every step has an explicit completion predicate (section 4). "Submitted" and "Done" are distinct. Confirmations require 2 blocks for Base receipts. Job polling is 1 s for the first 30 s then 2 s, 180 s cap per job, then "Still waiting" with the job id.

**FR-6 Owner call safety.** One pending owner intent per vault and owner, kept as a local lock record (message, signature, nonce, expiry, job id), keyed `vault:owner`. The app signs `nonce = owner_nonce + 1` with `expiry = NEAR time + 600 s`, re-reads `owner_nonce` after signing and discards the signature if it changed. The lock is released when the job is `done` and the step's chain check holds; when `owner_nonce` has reached the signed nonce (the NEAR call ran: the app re-reads chain state, and the step's check decides whether to continue or retry with a new signature); or when NEAR time is past the expiry while `owner_nonce` is still below it (the message can no longer execute; sign again). A refusal before sending (job `failed`, `http_status` 400) keeps the lock; the same message may be posted again only after a user action and only while at least 30 s of validity remain (relayer `EXPIRY_MARGIN`; the app requires 45 s). A lost job (404) or lost POST response shows "Checking…" and is resolved only by these rules. A signed message is never posted twice automatically. No raw-transaction, NEAR-receipt or cancellation handling. Vault creation follows the same rule: before any repeat of the create POST (uncertain response or 404 job), discovery is re-run first and a vault that appeared meanwhile is adopted instead of creating another. (Reworded in Phase 3, 9 Nov.)

**FR-7 Amounts.** The wrap sub-step runs only when wallet WETH < amount and requires `amount − walletWETH < ethBalance − estimated gas`; it wraps exactly the missing amount. Transfer amount equals the chosen amount. `open` uses `collateral_in` = WETH balance at the position address read after the transfer, not the typed amount, and `target_ltv` = 0.5e18. Withdraw amounts come from fresh balance reads.

**FR-8 Gas.** The app does not model relayer gas. The relayer checks funds deterministically before sending anything and answers 400 with a message; the app shows that message and inserts the reactive top-up step (D7). The position screen shows the position address's ETH balance as a plain fact.

**FR-9 Position data.** Read with `readLivePosition` (pinned block, accrual, market math). Missing reads are labelled unavailable; the previous snapshot is kept read-only with its age. Never mock.

**FR-10 Recent actions.** Source: Base logs (section 4, S5). The list says which block range it covers. Agent transcripts are not used for the list.

**FR-11 Verification panel.** Section 6. "Verified" wording is only used for checks that returned a positive result in this session.

**FR-12 Close semantics.** One action, "Close position", exactly as S6. There is no "close without repay"; the protocol offers no owner path that releases collateral while debt exists, and this is stated in the Why line of the action.

**FR-13 Start over.** Only after a close chain finished in this session (D5); reuses the empty vault at the deposit step. The vault keeps its agent approval (D6).

**FR-14 Copy rules.** Testnet, unaudited and "not insurance" appear on S1, S2 and S5. No "funds are safe", no "guaranteed", no progress percentages, actual stage names only.

**FR-15 Accessibility.** Keyboard-reachable steps and dialogs, focus trap in dialogs, 44px targets, `prefers-reduced-motion` respected, hover only on pointer devices.

**FR-16 Desktop gate.** Below 960px: full-screen notice (D9). Decision (Phase 2): below 960 px the app shell is **not mounted** at all, so no adapters are created, MetaMask is not silently reconnected and no RPC, NEAR or relayer read runs on unsupported screens. Crossing 960 px mounts or unmounts the shell live; S1/S2 input survives in `sessionStorage`.

**FR-17 Testnet funding help.** The app detects insufficient Base Sepolia ETH (S3) and insufficient test USDC (S6) itself, shows the exact missing amount and the wallet address, links the faucets named in S3a/S6a, polls the balance every 10 s while the panel is open, and resumes the chain automatically when funds arrive. Faucet links open in a new tab. No drip sizes or limits are quoted. The network-add dialog uses the exact Base Sepolia values in S3 and never a third-party RPC.

---

## 6. Agent verification panel

Shown in S4's right rail and from S5. Compact checklist, each row with status `Checked | Mismatch | Unavailable | Not checked`, a timestamp, and a "how to check yourself" line.

| Row | Check | How the user can verify independently |
|---|---|---|
| Agent version approved by your vault | `get_state().approved` equals `deployments/testnet.json` `agent.measurement` (fetched from raw.githubusercontent.com at run time, with the `sourceCommit` shown) | Open the GitHub file; compare the six hex values with the vault state on NearBlocks |
| Running agent matches the approved version | `sha256(GET /agent/evidence/app-compose.json)` equals `approved.compose_hash`; `/agent/` index `sha256` equals the bytes | Download `app-compose.json` and hash it locally |
| Agent registered on your vault | `/agent/vaults` row: `registration=registered`, `agent_status=active`, `expires_at`, `registration_tx` | Open the registration tx on NearBlocks |
| Agent key is limited | NEAR `view_access_key_list`: exactly one function-call key, methods `reduce, migrate, exit`, matching `agent.public_key` | NearBlocks → vault → Access keys |
| Vault code matches factory | account `code_hash` equals factory `get_config().code_hash` | NearBlocks |
| Relayer holds no authority | static text with link to `scripts/RELAYER.md` | — |
| What is not checked here | TDX quote signature, PCCS collateral, RTMR replay — "needs Docker and `dstack-mr`; see `agent/MEASUREMENT.md`" | link |

Implementation: `protocol/evidence/verify.ts` (the five checks, each run independently so one failed fetch only marks its own row Unavailable), exposed through `ProtocolAdapter.readVerification`; manifest and doc links come from `config.app.json` `help.manifest`, `help.measurementDoc`, `help.relayerDoc`. **Scope is these rows only** (product owner, 9 Nov): no transcript index, no transcript reading, no execution verification, no boot-file browsing. Rows with nothing to compare yet (no vault, no approval, no agent key) read "Not checked"; the relayer row and the "not checked here" row are statements and never read "Checked". The panel shows in the S4 right rail from step 1 (re-checked every 30 s) and opens from S5 "Verify the agent" with a Check again button.

---

## 7. Visual requirements

Layout reference: Design canvas https://claude.ai/artifact/88dCh3D6TAgkirFhEjRhmp (12 artboards, 9 Nov 2026: S0 entry and navigation, S1–S8, S9 sandbox progress, S10 sandbox position after the scripted drop, S11 leave sandbox). **Visual pass (product owner, 10 Nov):** the artboards in `docs/mockups/` are the source of the screens' markup structure and CSS (`cmdk.css` tokens, proportions, type sizes, spacing, the 960/1120 px columns, tile and step styles), not a loose reference; the first build drifted because the screens were styled from scratch. Screenshot comparisons per screen in the browser suite guard against drift. Numbers on the artboards are example values for layout only.

- Keep the current look: `src/ui/prototype-controls.css` tokens (dark `--bg #0a0a0a`, `--surface #1a1a1a`, `--ink #fff`, `--muted #a3a3a3`, `--accent #fff`), `CmdkReference` font via `scripts/copy-prototype.mjs`, pill buttons, `.prototype-surface` 16px radius, header with "⌘K" brand and "Testnet" chip, `data-theme="dark"` default with the existing light variant.
- Reuse: `PrototypeButton`, `PrototypeIconButton`, `PrototypeSurface`, `TokenIcon`, `VerificationDisclosure`, `VerificationIcon`, the LTV track from `vault-detail.css`, the numbered progress list pattern from `.create-job__progress`.
- New components: catalogue tile (enabled/disabled with "Coming soon" tag), locked setting row, step list item with status, verification checklist row, position hero.
- Motion: 120–220 ms with `--ease-ui`, no continuous animation on figures, `prefers-reduced-motion` disables all.
- Layout: single column, `min(100%, 960px)` for S1–S3; two columns (steps 1.4fr / verification 1fr) for S4; S5 uses hero + three cards + list.

---

## 8. Architecture

```
app/
  src/
    main.tsx                 providers + hash router, five live routes (#start, #settings, #connect,
                             #progress, #position) mirrored under #sandbox/…
    screens/                 Choose, Settings, Connect, Progress, Position (close and closed are position states)
    flow/                    routes + entry resolver (S0), onboarding state machine + persistence,
                             close-flow state machine, pure helpers (amount, quote, funding)
    components/              shell, wallet slot, DesktopGate, buttons/surfaces/token icons, LTV track
    adapters/                WalletAdapter / ProtocolAdapter interfaces, live/ (wagmi MetaMask-only config,
                             pass-through to protocol/*), sandbox/ (§8a), AdapterProvider
    protocol/                NEW, written from cmdkfi/app (§8b): near/, owner/, relayer/, base/, evidence/, wallet/
    styles/                  prototype-controls.css (tokens, font), base, shell, LTV track, screen CSS
  e2e/                       live-fixture.ts (thin fake MetaMask + NEAR/Base/relayer RPC), specs; sandbox adapters
                             serve as the backend for UI scenarios
  scripts/                   generate-config.mjs (+ guided-values.mjs), copy-prototype.mjs, check-test-boundary.mjs
```

- **Nothing from the previous app's `src/` is imported.** Phase 1 moved twenty modules into `protocol/` unchanged; Phase 2b replaces them (§8b). Visual tokens and the font come from the same design source and are kept.
- State: TanStack Query for polling reads, small hand-rolled reducers for the two step machines (a few explicit states each; a state-machine library would add more surface than it removes). No global store.
- Config: `scripts/generate-config.mjs` reads `deployments/testnet.json` (fetched from cmdkfi/app main at build time) and `config.app.json`; the app never carries an address that is not in the manifest.
- Wallet: `createConfig({ chains:[baseSepolia], connectors:[injected({ target:'metaMask' })] })`.
- Build/deploy: `pnpm build`, `pnpm test`, `pnpm test:bundle-boundary`, `pnpm test:browser`, `wrangler deploy`; workflows unchanged. Vite is pinned to an exact version.

### 8b. Protocol layer, written from cmdkfi/app

Decision (product owner, 9 Nov 2026): the protocol client is written fresh against the protocol repository, function by function, each with a comment naming the protocol file it mirrors. The previous app's modules are read as documentation; their tests are mined for **vectors** (exact bytes, numbers) which become oracles for the new code. No old module is imported.

| File | Functions | Mirrors in cmdkfi/app |
|---|---|---|
| `protocol/near/rpc.ts` | `viewFunction(rpcUrl, account, method, args)` with 12 s timeout, in-flight dedupe, 429 `Retry-After` cooldown → typed error | NEAR JSON-RPC `query` `call_function` |
| `protocol/near/vault.ts` | `getState(vault)` → owner, owner_nonce, base_address, markets[{id, executor, corridor_set}], agent{public_key, expires_at}, approved, cooldown_secs; `getFactoryConfig()` → count, code_hash; `vaultId(n)`; `discover(owner, firstVaultNumber)` scanning `v<count>` down to `v<first>`, batch 2, and stopping at the first vault the owner holds (D4: the newest is the position); an unreadable account above it makes the answer unknown | `vault/src/lib.rs` `get_state`; `vault/factory/src/lib.rs` `get_config`, `vault_id` |
| `protocol/owner/message.ts` | `ownerMessage({vault, method, args, nonce, expiry})` producing the exact JSON text (field order `protocol, network, vault, method, args, nonce, expiry`, no spaces); `setupArgs`, `openArgs`, `withdrawArgs`, `closeArgs`; `wad(percent)`; `expiryFor(chainTime)` = +600 s; `recoverOwner(message, signature)` | `vault/src/owner.rs` (`OwnerMessage`, ERC-191 prefix, nonce > owner_nonce, expiry ≤ now+3600); `vault/src/lib.rs` owner_call arms; `scripts/p2_owner.py` reference signer |
| `protocol/relayer/client.ts` | `health`, `createVault(owner, policy, depositNear)`, `ownerCall(vault, message, signature)`, `job(id)`, `vault(id)`, `agentVaults()`; GET falls back to the second URL, POST never retries; `ok` checked, not HTTP status; `Retry-After` surfaced | `scripts/RELAYER.md` endpoints; `cloud/src/index.ts` routes, CORS, rate limit |
| `protocol/base/reads.ts` | Morpho `position`, `market`, `idToMarketParams` (+ id recomputation); Executor `config`, `corridors`; oracle `price`; IRM `borrowRateView`; ERC-20 `balanceOf`, `allowance`, `decimals`; Chainlink `latestRoundData` for feed age; `GasPriceOracle.getL1Fee`; all at one pinned block | `executor/src/Executor.sol`, `Interfaces.sol`; `agent/src/chain.rs` call list; `deployments/testnet.json` |
| `protocol/base/math.ts` | `accrue(assets, ratePerSecond, elapsed)` (Morpho three-term Taylor), `ltv(debt, collateral, price1e36)`, `borrowAt(collateral, price, targetLtv)`, `toAssetsUp(shares, totals)` | `scripts/VERIFY.md` §2; Morpho `SharesMathLib`/`MathLib` |
| `protocol/base/activity.ts` | Executor logs with `topics[1]` = position address (`CorridorSet, Opened, Repaid, Closed` = you; `Reduced, Migrated, Exited, SessionEnded` = agent) + WETH/USDC `Transfer` touching the position address; 10 000-block windows | `executor/src/Executor.sol` events (l.80-97); `DEPLOY.md` `cast logs` pattern |
| `protocol/evidence/verify.ts` | the five §6 checks: approved vs published measurement (manifest from raw GitHub, `sourceCommit` shown); `sha256(app-compose.json)` vs `compose_hash`; `/agent/vaults` row; `view_access_key_list` exactly one FunctionCall key `reduce,migrate,exit` matching `agent.public_key`; account `code_hash` vs factory | `agent/MEASUREMENT.md`; `agent/src/serve.rs` routes; `vault/src/lib.rs` `register_agent`; `deployments/testnet.json` |
| `protocol/wallet/tx.ts` | calldata builders: `WETH.deposit`, `WETH.transfer`, `USDC.transfer`, plain ETH value transfer | WETH9 ABI; ERC-20 |

Also `protocol/base/abi.ts` holds every ABI fragment once, each line citing its source; selectors the protocol pins (`agent/src/chain.rs` l.1001-1014, `vault/src/evm.rs` l.21-22) are cross-checked by a test. `flow/` imports nothing from `protocol/`; the live adapter is its only consumer, and the `ProtocolAdapter` interface lists only what the screens use.

Standard ABIs and actions come from viem where they exist (erc20Abi, OP Stack fee actions); protocol-specific fragments are copied from cmdkfi/app. Kept hand-rolled, each with a comment saying why: the WETH `deposit()` fragment (viem has no WETH ABI), the NEAR JSON-RPC view calls (three read-only calls; near-api-js would add an unused signing stack), the hash router (five fixed hashes) and the step reducers. The Morpho SDK (`@morpho-org/blue-sdk`) is a test-only oracle for the math.

Rules: every exported function has a one-line comment with the cmdkfi/app path it mirrors; every ABI fragment is copied from the protocol repo's Solidity or the agent's selector list, never typed from memory; message bytes, nonce/expiry rules and math are covered by vectors ported from the previous app's tests and cross-checked against `scripts/p2_owner.py` and `scripts/VERIFY.md`.

**Test vectors to port** (copied as data, not as code): exact `setup` message text and field order; `open`/`withdraw`/`close` argument shapes; accrual and LTV rounding cases including zero collateral; nonce replay refusal; relayer fallback-on-GET-only and 429 handling; discovery owner filtering and partial-scan failure.

**Browser fixture:** a new thin `e2e/live-fixture.ts` (fake MetaMask with `personal_sign`, `eth_sendTransaction`, `wallet_switchEthereumChain`/`wallet_addEthereumChain`, account and chain changes; NEAR, Base and relayer JSON fakes sized to the function list above). The previous `fixture.ts` is reference only and is deleted. Sandbox adapters back the UI-level scenarios.

### 8a. Sandbox mode (foundation)

Pattern observed in the Spark app on 9 Nov 2026: a "Try in Sandbox" button next to "Connect Wallet" opens a short explainer ("risk-free environment… unlimited tokens… no need to sign transactions") with one **Activate Sandbox** button. After activation the wallet slot in the header reads "Sandbox", balances appear (1,000,000 USDC), and every action dialog is the real one: the same multi-step sheet, the same copy, with each step completing instantly instead of waiting for a wallet. Exiting returns to the real app. We copy this shape, with our honesty rules on top.

**Architecture requirement (from day one).** Screens never call wagmi, viem, NEAR RPC or the relayer directly. They use two interfaces in `src/adapters/`:

| Interface | Live implementation | Sandbox implementation |
|---|---|---|
| `WalletAdapter` — connect, account, chain, `signMessage`, `sendTransaction`, balances | wagmi + MetaMask | In-memory account `0xSandbox…`, generous ETH/WETH/USDC balances, instant "signatures" and "transactions" with fake hashes, optional simulated rejection |
| `ProtocolAdapter` — relayer jobs, NEAR state reads, Morpho/Executor reads, activity logs, agent evidence | existing `protocol/*` modules | In-memory state machine: create → setup → open → agent actions → close, advancing on timers (1–3 s per stage) so the progress UI shows every state; deterministic scripted events (one price drop and one agent `Reduced`), simulated feeds and interest accrual |

The same adapter interfaces are what the Playwright fixtures drive, so the sandbox implementation doubles as the browser-test backend for most scenarios; only the live adapter's wire formats need the existing protocol fixture.

**The sandbox duplicates the live flow screen for screen.** Same components, same routes under `#sandbox/`, same copy, with the simulated adapters behind them:

| Live | Sandbox | Difference |
|---|---|---|
| S1 Choose | `#sandbox/start` | Wallet slot reads "Sandbox wallet"; balances 10 ETH, 5,000 USDC |
| S2 Settings | `#sandbox/settings` | None |
| S3 Connect | `#sandbox/connect` | Already "connected"; funding check always passes; no faucet panel; Create position enabled |
| S4 Progress | `#sandbox/progress` | Each stage advances on a 1–3 s timer; "Waiting for MetaMask…" is replaced by "Simulated signature" / "Simulated transaction"; agent registration completes in ~5 s; verification rows read "Simulated (not checked)" |
| S5 Position | `#sandbox/position` | After ~20 s a scripted price drop (−30%) pushes LTV from 50% to about 71%; the simulated agent posts a `Reduced` action within the cooldown and LTV returns to 50%; interest accrues visibly; hash links disabled and tagged "simulated" |
| S6 Close | `#sandbox/position` (close state; `#sandbox/close` redirects here) | Shortfall exists (interest), wallet has enough USDC, so the transfer step runs without a faucet panel; all steps instant |
| S7 Closed | `#sandbox/position` (closed state; `#sandbox/closed` redirects here) | Start over reuses the simulated vault at the deposit step |

**Entering.** "Try in sandbox" appears in three places: beside Connect MetaMask on S3, in the no-MetaMask state, and in the wallet-slot menu when not connected. It opens the explainer sheet (S8). **Activate sandbox** switches the adapters, sets the banner, and lands on `#sandbox/start` with the amount field prefilled (0.5 ETH in the sandbox, where liquidity is simulated) so the user can go straight to Continue.

**Exiting.** **Leave sandbox** sits in the banner and in the wallet-slot menu. It asks once ("Leave the sandbox? Simulated data is discarded.") with Leave and Stay, then clears `sessionStorage` sandbox keys, disposes the simulated adapters, and lands on `#start` with no wallet connected. Closing the tab also discards the sandbox.

**UI rules.**
- Entry: **Try in sandbox** beside Connect on S3 and in the no-MetaMask state. Explainer sheet with one **Activate sandbox** button and the sentences: "Simulated wallet and simulated protocol. Nothing touches Base Sepolia or NEAR. Numbers are illustrative." Route prefix `#sandbox/…` so a reload stays in the sandbox and a shared link is honest.
- While active: a persistent banner "Sandbox · simulated data" above the header, the wallet slot reads "Sandbox wallet", every hash and address link is disabled and tagged "simulated", verification rows read "Simulated (not checked)" and never "Checked".
- Exit: **Leave sandbox** in the banner and the wallet slot; clears all sandbox state (`sessionStorage` only) and returns to `#start`. Sandbox state is never written to the `localStorage` keys the live flow uses.
- Never mix: the live adapter is never instantiated while the sandbox is active, and vice versa. No live read is shown inside the sandbox, including prices.
- Record for README: the previous app deliberately removed demo balances and demo routes. The sandbox is allowed only because it is isolated, labelled on every screen, and makes no claims about the live protocol. `README.md` and `docs/audit-status.md` must say so when it lands.

---

## 9. Non-functional

- **Performance:** first paint under 1.5 s on broadband; position read under 3 s on public RPC; activity read bounded to 10 000 blocks per request.
- **Reads and caching (performance pass, product owner 9 Nov):**
  1. Contract reads are batched: the Base client is created with viem's multicall batching (Multicall3 on Base Sepolia from viem's chain definition) and JSON-RPC transport batching, so one refresh is a handful of requests instead of ~36; pinned-block reads stay pinned.
  2. Static deployment data (market params, token decimals, LLTV, Executor config with feeds and max ages, factory config) is read once per session (infinite stale time); only moving data (position, totals, price, feed timestamps, balances, corridor, sell budget) is polled every 30 s.
  3. Activity uses two topic-filtered `eth_getLogs` per window with address arrays, sent as one JSON-RPC batch (one HTTP request): [Executor, WETH, USDC] with topics [null, position address] (Executor events by caller, transfers from) and [WETH, USDC] with [Transfer, null, position address] (transfers to); events are classified client-side as before. (Phase 5b, product owner: one unfiltered query over the three addresses returned 4,208 logs / 2.7 MB per 10,000-block window on Base Sepolia on 9 Nov, against near zero filtered.) Confirmed logs and block timestamps are immutable and are persisted per position address in the browser; on return only the range from the last cached block to the head is fetched.
  4. The last position snapshot per vault is persisted (TanStack Query storage persister) and rendered immediately on return, labelled "read at block N, X min ago · refreshing", while live reads run (extends FR-9 across reloads).
  5. The owned vault id is cached per owner and verified with one `get_state`; the factory scan runs only when the cached vault no longer belongs to the owner.
  6. The NEAR `get_state` read is shared between the position and agent queries.
  7. NEAR RPC (product owner, 9 Nov): primary `https://test.rpc.fastnear.com`, fallback `https://near-testnet.drpc.org` (`config.app.json` `nearRpcUrl` / `nearRpcUrlFallback`, both https). The fallback is asked only for NEAR reads (every NEAR call the app makes is a view), and only after a retryable failure of the primary (no answer or timeout, HTTP 5xx, 429); a NEAR error answer is final. Measured live on 9 Nov per call: rpc.testnet.near.org 3.1–3.2 s, test.rpc.fastnear.com 0.08–0.15 s, near-testnet.drpc.org 0.10–0.32 s; one S5 refresh went from 3.5–4.5 s to 0.44–0.70 s, the first full S5 after connect from 10.0 s to 1.8 s (return visit 6.8 s → 1.05 s).
  Honesty constraints for every cache: each cached value carries its block and age and is never presented as current; cache keys include adapter kind, owner and vault, so nothing crosses wallets or modes; cached data only paints the screen and never decides an action; the onboarding and close chains read live before every prompt.
- **Resilience:** NEAR 429 cooldown honoured; relayer fallback URL for GET only; all polling stops when the tab is hidden.
- **Privacy:** no analytics, no API keys in the bundle, no third-party fonts.
- **Persistence:** `sessionStorage` for S1 input; `localStorage` for onboarding/close progress and owner locks, keyed by factory, owner and vault; cleared only on job completion or explicit "Dismiss" after reconciliation.
- **Rate limits:** show `Retry-After` countdowns for `/create-vault`.

---

## 9a. Risks and how the app handles them

| # | Risk | Source | Handling in this frontend |
|---|---|---|---|
| R1 | Chainlink ETH/USD on Base Sepolia goes stale (>1200 s); `Executor.open` reverts with `StaleFeed`. | `Executor.sol` `_requireFresh` | Before requesting the `open` signature, read both feeds' `updatedAt`; if stale, show "Price feed is stale on testnet; retrying every 30 s" and do not request a signature. Map the revert to the same copy. |
| R2 | Live market USDC liquidity is below the amount needed to reach 50% LTV. | Morpho `market()` totals; pool topped up by team script | S1 shows "available to borrow now" from the market read next to the estimate; S4 step 5 uses `min(target amount, liquidity)` and says when the position opened below target. |
| R3 | `/create-vault` rate limit: 2 per IP per hour, 20 per day for everyone. | `cloud/src/index.ts` | Countdown from `Retry-After`; the rehearsal plan schedules creations; the sandbox absorbs demos. |
| R4 | Relayer jobs live in memory and vanish on restart (404). | `scripts/relayer.py` | FR-6 minimal reconciliation: `owner_nonce` advanced → re-read state and continue; unchanged → wait for the 10-minute expiry, then re-sign. Shown as "Checking…", never "Failed". |
| R5 | Agent registration takes minutes to ~15 min and depends on a Worker cron. | `agent/src/main.rs`, `cloud/src/index.ts` | Step 3 is non-blocking; copy says "usually a few minutes"; position screen shows "Registering" as a normal state. |
| R6 | Position-address gas float (0.005 ETH) is consumed by owner and agent actions. | relayer `check_funds` | Reactive top-up step after a relayer funds refusal (FR-8, D7); position screen shows the gas balance. |
| R7 | Relayer service wallet out of ETH float or NEAR → creation refused. | `GET /health` `floats_left`, `eth_float_wei` | Reuse `assessRelayer`; S3 shows "Creation temporarily unavailable" with the relayer message, never a generic error. |
| R8 | Wallets that own vaults from the previous app. | factory has no owner index | Ignored by the `firstVaultNumber` cutoff (D4); the newest vault above the cutoff is the position; nothing older is read or shown. |
| R9 | Public Base RPC limits `eth_getLogs` ranges and rate-limits bursts. | publicnode | 10 000-block windows, sequential requests, "Load earlier"; activity failure keeps the last list. |
| R10 | Interest accrues between the shortfall read and the `close` precheck; the 1% headroom may be insufficient after a long pause. | relayer `REPAY_HEADROOM` | Re-read debt immediately before requesting the USDC transfer and again before the `close` signature; if short, add a second transfer step rather than fail. |
| R11 | Browser tests need wallet transactions, add-network and balance changes. | new `e2e/live-fixture.ts` | Written fresh in Phase 2b sized to §8b; sandbox adapters cover UI-level scenarios. |
| R12 | Protocol repo changes before or during implementation. | cmdkfi/app main | Re-check against origin/main at the start of each phase; pin the checked commit in the PR description. |
| R13 | Sandbox could be mistaken for live data. | this PRD §8a | Banner on every screen, disabled links, "Simulated" verification rows, isolated storage, README note. |

---

## 10. Acceptance criteria

1. A fresh MetaMask wallet with ≥0.015 Base Sepolia ETH completes S1→S5 with the default deposit of 0.01 ETH, 2 transactions and 3 signatures (plus wrap skip when WETH exists), ending with about 10 USDC in the wallet and a Morpho position at ≈50% LTV on the live market. The rehearsal amount is 0.01 ETH (product owner, 9 Nov): at today's price that is about $21 of collateral and 10–11 USDC of debt, so the live market's current liquidity (66 USDC on 9 Nov) carries several positions and one faucet claim covers the close.
2. Reloading at any step of S4 or S6 resumes at the correct step without resubmitting any owner call.
3. A wallet that owns only vaults below the `firstVaultNumber` cutoff is treated as owning none and can create a position; nothing about the older vaults is read or shown.
4. Rejecting a signature or transaction leaves the step retryable and the data intact.
5. Relayer 400 refusals show the relayer message; a simulated lost job (404) shows "Checking…" and reconciles from chain.
6. "Close position" with insufficient idle USDC inserts the transfer step with the exact shortfall; after completion debt = 0, WETH is back in the wallet, and "Start over" appears and leads to the deposit step on the same vault.
11. After clicking "Create position" once, a fresh wallet reaches S5 without clicking anything else in the page; all interaction is inside MetaMask (D11).
13. Sandbox: activating it from S3 runs S1→S5 and Close position end to end with no network request to Base, NEAR, GitHub or the relayer (verified by the fixture's "unexpected request" guard), every screen shows the sandbox banner, and Leave sandbox returns to `#start` with no sandbox state left in `localStorage`.
12. A MetaMask profile without Base Sepolia receives the add-network prompt with chain 84532 and `https://sepolia.base.org`; a wallet with zero Base Sepolia ETH sees the Get Base Sepolia ETH panel and the flow continues by itself once the fixture credits the balance; a wallet short of USDC during close sees the Get test USDC panel with the exact missing amount and resumes once credited.
7. Verification panel rows show `Checked` against the live relayer and GitHub manifest; a deliberately altered manifest in the fixture shows `Mismatch`.
8. Under 960px the gate renders; no MetaMask → install link only.
9. CI passes: typecheck, unit, bundle boundary (no fixture markers), Playwright desktop project.
10. Deployed preview from the branch via `workflow_dispatch` serves on testnet.cmdk.fi; CORS from the relayer works.

---

## Appendix A — Owner messages used

```
setup     {"markets":[{"market":LIVE,"approve":A,"authorize":B,"corridor":C},{"market":BACKUP,"approve":false,"authorize":false,"corridor":C}],"measurement":M}
open      {"market":LIVE,"collateral_in":"<wei>","target_ltv":"500000000000000000"}
withdraw  {"token":USDC|WETH,"amount":"<units>","destination":"<owner>"}
close     {"market":LIVE}
C = {"target":"500000000000000000","act":"700000000000000000","floor":"300000000000000000","sell_budget":"200000000000000000","migrate_allowed":true,"exit_allowed":true}
```

## Appendix B — Wallet transactions used

`WETH.deposit()` payable · `WETH.transfer(base_address, amount)` · `USDC.transfer(base_address, shortfall)` · plain ETH transfer to `base_address` (gas top-up).

## Appendix C — Testnet reference values and links

| Item | Value |
|---|---|
| Base Sepolia chain id | 84532 (`0x14a34`) |
| Public RPC for the MetaMask network entry | `https://sepolia.base.org` (Base docs, Network Information) |
| Explorer | `https://sepolia.basescan.org` |
| Faucet list | Base docs → Network Faucets (`https://docs.base.org/base-chain/tools/network-faucets`) |
| Coinbase Developer Platform faucet | `https://portal.cdp.coinbase.com/products/faucet` (ETH and USDC on Base Sepolia) |
| Alchemy faucet | `https://www.alchemy.com/faucets/base-sepolia` |
| Circle USDC faucet | `https://faucet.circle.com` (select Base Sepolia) |
| Connecting to Base docs | `https://docs.base.org/base-chain/quickstart/connecting-to-base` |
| NEAR testnet RPC | primary `https://test.rpc.fastnear.com`, fallback `https://near-testnet.drpc.org` for reads after a retryable failure of the primary (§9 7). Per call on 9 Nov: 0.08–0.15 s and 0.10–0.32 s, against 3.1–3.2 s for `https://rpc.testnet.near.org` |

Links are configuration (`config.app.json` → `help` block), not hard-coded in components, so they can be updated without a code change.

## Appendix D — Glossary

Vault: the user's NEAR account `v<N>.factory.prime-measure-1792736012.testnet` that owns the position address via chain signatures. Position address: the Base address where WETH, USDC and gas ETH live and from which Morpho is called (see Terminology). Corridor: floor / target / trigger ("act") / sell budget per market. Live market: Morpho USDC/WETH with Chainlink oracle. Backup market: same tokens, independent oracle, migration target. Measurement: the six TDX values identifying the agent build.
