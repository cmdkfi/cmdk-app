# Live rehearsal — guided flow on Base Sepolia, 10 Nov 2026

A script for one person with a real MetaMask. It runs the whole guided flow once: open a position with 0.01 ETH, watch
it, close it, Start over. Fill in every blank (`____`) as you go; the results block at the end is what goes back to the
agent. Do not skip a step or click ahead: the point is to see what a first-time user sees.

App under test: the preview of `feat/guided-flow` (product owner runs `deploy testnet` on the branch), at
https://testnet.cmdk.fi. Protocol checked: cmdkfi/app `47fd4fb`.

Tester: ____ Date and start time: ____ Browser and version: ____ MetaMask version: ____ Screen width (≥ 960 px): ____

---

## 0. Preparation (before opening the app)

1. **A fresh MetaMask account** (Account → Add account). It must never have owned a cmdk vault.
   Address: `0x____`
2. **Base Sepolia in MetaMask** is not required in advance: the app asks MetaMask to switch, or to add the network.
3. **At least 0.015 ETH on Base Sepolia** in that account: 0.01 ETH to deposit plus gas for two wallet transactions
   (wrap, transfer) and one USDC transfer at close. Faucets: Coinbase Developer Platform
   (https://portal.cdp.coinbase.com/products/faucet), Alchemy (https://www.alchemy.com/faucets/base-sepolia).
   ETH balance before starting: ____ ETH
4. **One Circle faucet claim of test USDC, kept for the close**: https://faucet.circle.com → choose **Base Sepolia** in the
   network dropdown (USDC sent on another network never reaches this wallet) → paste the address → 20 USDC.
   Do this now; do not spend it. USDC balance before starting: ____ USDC
5. **Browser devtools open on the Network tab**, "Preserve log" on. Relayer job ids and receipt hashes are in the
   responses of `POST /owner-call`, `POST /create-vault` and `GET /job/<id>`.
6. **Keep these open in other tabs:**
   - Relayer health: https://relayer.cmdk.fi/health — must show `"ok": true`, `"chain_id": 84532`,
     `"near_network": "testnet"`, `"factory_exists": true`. Value of `eth_float_wei`: ____
   - The agent's vault list: https://relayer.cmdk.fi/agent/vaults (your vault appears here after setup)
   - The NEAR factory on NearBlocks:
     https://testnet.nearblocks.io/address/factory.prime-measure-1792736012.testnet — note the latest vault number
     before you start: v____ (your vault will be the next one, probably v10)
   - BaseScan: https://sepolia.basescan.org
7. A stopwatch or clock with seconds. For every prompt, record when it appeared and when its step showed **Done**.

---

## S1 — Choose (`#start`)

**Do:** open https://testnet.cmdk.fi. Do not connect yet.

**Must be visible:**
- Heading "Borrow USDC against ETH. Keep risk on autopilot."; header chip "Testnet · Base Sepolia · no real funds";
  footer "Unaudited testnet prototype. Agent protection is risk management, not insurance."
- ETH, USDC and Morpho · Base selected; every other tile "Coming soon" and not selectable.
- Amount prefilled with **0.01** ETH.
- An estimate from the live market: "≈ $… at the live market oracle", "You borrow at 50% LTV — about … USDC",
  "Borrow rate …% APR". If the market cannot lend that much, a warning replaces the estimate and says up to how much ETH
  still opens at 50 %.

**Record:** estimated value ____ $, estimated borrow ____ USDC, APR ____ %, liquidity warning shown? ____

**Honesty check:** no number is shown where a read failed (it must say "unavailable").

Click **Continue**.

## S2 — Settings (`#settings`)

**Must be visible:** "Your protection, in one picture"; target 50 %, agent acts above 70 %, floor 30 %, at most 20 % of
collateral sold per day; the liquidation LTV from the live market (86 %).

**Do:** tick "I understand this is a testnet prototype. Protection is risk management, not insurance …" (Continue to
wallet stays disabled until you do), then **Continue to wallet**.

**Record:** liquidation LTV shown ____ %

## S3 — Connect (`#connect`)

**Do:** under **Connect wallet**, choose **MetaMask** in the list (Phase 8: every wallet in the browser is listed), approve in MetaMask. The app asks MetaMask to switch to Base Sepolia right after connecting (Phase 8a); if it is still on another network, **Switch to Base Sepolia** and
approve (or approve adding the network).

**Must be visible:** Wallet "MetaMask · 0x…", Network Base Sepolia, Account type "Plain account (supported)",
Base Sepolia ETH, "Needed for 0.01 ETH deposit … = … ETH" with **Enough**, Existing position **None for this wallet**,
and **Create position** enabled with the line "This is the only click: every signature and transaction after it is
requested automatically, and you only act inside MetaMask."

**Record:** needed total shown ____ ETH (wrap ____ + gas ____), time you click Create position: ____

Click **Create position** once. From here on, only act inside MetaMask.

## S4 — Opening your position (`#progress`)

Six steps, requested in order, one prompt at a time. The right rail shows **Agent verification** from the start.

Status words you will see, in this order for a healthy step: **Waiting** → **Waiting for MetaMask…** (prompt open) →
**Submitted** → **Confirming…** → **Done**. "Not needed" means the step was skipped because the chain already shows its
result.

| # | Step | Prompt in MetaMask | Record |
|---|---|---|---|
| 1 | Create your position | none (the relayer creates the vault; a moment of "Checking whether this wallet already owns a vault…" first is normal) | vault id `v____.factory.prime-measure-1792736012.testnet`; position address `0x____`; create job id ____; time to Done ____ s |
| 2 | Approve agent and rules | 1 signature (a JSON message with `"method":"setup"`) | prompt shown at ____; Done at ____; job id ____; Base tx hash(es) from `GET /job/<id>` → `receipts` ____; gas used ____ |
| 3 | Wrap ETH → WETH | 1 transaction to WETH (`deposit`, value 0.01 ETH) | prompt at ____; Done at ____; tx hash ____ (shown as "Transaction 0x…"); gas used ____ |
| 4 | Send WETH to your position address | 1 transaction to WETH (`transfer`) | prompt at ____; Done at ____; tx hash ____; gas used ____ |
| 5 | Open position | 1 signature (`"method":"open"`, `collateral_in` 10000000000000000, `target_ltv` 500000000000000000 or lower) | prompt at ____; Done at ____; job id ____; Base tx hash ____; gas used ____; note shown ("Opened below target …"?) ____ |
| 6 | Send USDC to your wallet | 1 signature (`"method":"withdraw"`, all USDC at the position address) | prompt at ____; Done at ____; job id ____; Base tx hash ____; USDC arrived in wallet ____ |

Gas for the signature steps is paid from the ETH the relayer put at your position address; find "Gas Used" on the
BaseScan page of each receipt hash.

**Honesty checks (by eye):**
- No step shows **Done** while its job or transaction is still running: there is always a **Submitted / Confirming…**
  phase first, and Done appears only after Base confirmations.
- The verification rows are never **Checked** before their result: before setup they read **Not checked** with "Your
  vault has not approved an agent version yet; the setup step does that." and "Waits for the setup step: the agent
  registers once your vault approves its version."
- After setup, the registration row reads **Not checked — "Registering (usually within a few minutes)."** until the
  agent has registered; only then **Checked — "Registered and active on your vault until …"**. While the agent's list
  lags behind a key the vault already holds, it reads **Not checked — "The agent's list has not caught up yet; …"**
  (Phase 7b), never Mismatch.
- Reload the page once during S4 (between two steps): nothing may be requested until you click **Continue**.
  Did any prompt appear on its own after the reload? ____

**Record:** time the agent registration row turned Checked ____ (minutes after setup Done: ____); total time from
Create position to the position screen ____ min.

When step 6 is Done the app moves to `#position` by itself.

## S5 — Your position (`#position`)

**Must be visible:**
- "Read at block N, X s ago" (refreshes every 30 s).
- Debt ≈ 10–11 USDC "with interest accrued to block N"; Collateral 0.01 WETH and its $ value; LTV ≈ 50 % (or the lower
  figure S4 announced) on the track with Floor 30 %, Target 50 %, Agent acts 70 %, Liquidation 86 %.
- Agent card: status (Registering → Active), last check, key expiry, "Sell budget left today …".
- Market card: "Morpho · USDC/WETH on Base Sepolia · live", Liquidation LTV 86 %, Oracle "Chainlink ETH/USD · updated …
  ago · Chainlink USDC/USD · updated … ago", backup status, position address and vault links.
- Recent actions with the covered block range: You / Transfer, You / Opened, You / … USDC to your wallet.
- **Close position** with the sub-line "You will first send … USDC to your position address, then …" (or "Repays …").

**Do:** click **Verify the agent**. All five live rows should read **Checked** once registration is done; the last two
rows are statements (**Statement**, no time). A row with nothing to compare yet shows "Last tried at …", never
"Checked at …" (Phase 7b).

**Record:** block ____, debt ____ USDC, LTV ____ %, agent status ____, verification rows (Checked / other) ____;
compare debt and LTV with BaseScan/Morpho if you can: ____

**Honesty checks:** the age in "Read at block …" keeps counting; "Agent protection is risk management, not insurance."
is on the screen.

## S6 — Close position (on `#position`)

**Do:** click **Close position**. A review sheet "Close your position" opens.

**Must be visible in the sheet:** Debt now; Interest over the next 10 minutes; Headroom (1 %, returned to you); USDC
already at your position address; You send first …; Collateral returned 0.01 WETH; Destination (your address);
"Each signature expires in 10 minutes."; "The protocol has no close without repaying: …".

**Record:** debt now ____, you send first ____ USDC, time you click **Start closing** ____

| # | Step | Prompt | Record |
|---|---|---|---|
| 1 | Send USDC to your position address | 1 transaction to USDC (`transfer`) of exactly the amount the sheet showed | prompt at ____; Done at ____; tx hash ____; gas ____ |
| 1b | Send USDC to your position address (second transfer) | only if it appears (interest while you waited) | appeared? ____; amount ____; tx hash ____ |
| 2 | Close position | 1 signature (`"method":"close"`) | prompt at ____; Done at ____; job id ____; Base tx hash ____; gas ____ |
| 3 | Return WETH to your wallet | 1 signature (`withdraw` WETH) | prompt at ____; Done at ____; job id ____; tx hash ____ |
| 4 | Return leftover USDC | 1 signature (`withdraw` USDC), when more than 0.01 USDC is left | prompt at ____; Done at ____; job id ____; amount returned ____ |

**Honesty checks:** Close position is **Done** only after Base confirms and Morpho shows zero debt and zero collateral;
the screen never says "Position closed" before every step is finished.

## S7 — Position closed, Start over

**Must be visible:** "Position closed"; Debt 0 USDC; Collateral 0 WETH; idle balances (ETH for gas may remain);
**Start over** (only once WETH is 0 and USDC ≤ 0.01 at the position address) with "Start over reuses this vault: no new
vault is created."

**Record:** WETH back in wallet ____, USDC in wallet ____, ETH left at the position address ____

**Do:** **Start over** → S1 shows 0.01 ETH → **Continue** → tick the acknowledgement → **Continue to wallet**.
**Must be visible on S3:** Existing position "v… · ready for a deposit" and the button **Deposit** (not Create
position). Click **Deposit**: S4 starts at **Wrap ETH → WETH** on the **same vault** (Create and Approve show Done).

**Record:** same vault id? ____; any `POST /create-vault` in the Network tab? ____ (must be none). You may stop after
the wrap prompt appears (reject it) or run the open again — note which: ____

---

## What to do if …

- **A step shows Paused.** Read the line and any grey error text (it is the relayer's or MetaMask's own text, copy it
  into the results). The button says exactly what it will do:
  - **Try again** — asks MetaMask again (a new signature or transaction).
  - **Send the same signed message again** — re-posts the message you already signed; no new signature. Offered only while
    it has at least 45 s of validity left.
  - **Sign a new message** — a new signature is needed (the old one expired, or the chain did not show the result).
  - **Ask the relayer again** — only on step 1, after the app re-checked that no vault exists for you.
  - **Send N ETH for gas** — the relayer refused because your position address lacks ETH for gas; one wallet
    transaction tops it up, then the same message is posted again.
  - **Open at the lower LTV** — the market can lend less than S1 showed; accept to open below 50 %, or wait and reload.
  - **Check again** — re-reads (after "Still waiting …" or a reverted transaction).
- **"Try again in N s" countdown on Create your position.** The relayer allows two vault creations per IP per hour.
  Wait for the countdown; do not open a second tab to retry.
- **Get Base Sepolia ETH panel on S3.** Your wallet is short for the deposit plus gas; it shows the amount missing.
  Request ETH from a faucet; the page re-checks every 10 s and Create position enables by itself.
- **Get test USDC panel during the close.** Your wallet holds less USDC than the transfer needs. Claim from the Circle
  faucet (Base Sepolia selected); the close continues by itself within 10 s of the USDC arriving.
- **"Waiting for a fresh price" / "Price feed is stale on testnet; retrying every 30 s."** The Chainlink ETH/USD feed on
  Base Sepolia is older than its 20-minute limit; the Executor would refuse to open. Wait; the app retries every 30 s
  and asks for the signature once the feed updates. Record how long it lasted.
- **"The market can lend less than before: your position would open at X % LTV instead of Y %."** Liquidity dropped
  since S1. Choose **Open at the lower LTV**, or wait. Record X and Y.
- **"Checking…" on a step after a relayer job was lost or the relayer answered 5xx.** The step says why (for example
  "The relayer answered HTTP 503 …") and "Waiting for the signed message to expire at HH:MM:SS (m:ss left) unless the
  vault shows it ran" (Phase 7b). The app resolves it from the vault's nonce and NEAR time only; it never posts the same
  message twice on its own. If it ends with "The signed message expired without being used. Sign again.", sign again.
- **"Still waiting for the relayer. The job keeps running on its side."** (after 3 minutes) Note the job id, open
  `https://relayer.cmdk.fi/job/<id>` in a tab, then **Check again**.
- **You switch accounts in MetaMask mid-flow.** The run stops at once and nothing is asked of the other account (you
  land on S1). Switch back to the owner account: the app returns to S4 and waits for **Continue**. Record whether
  anything was prompted for the other account: ____
- **MetaMask leaves Base Sepolia mid-flow.** The step pauses with "The wallet left Base Sepolia. Switch back, then
  continue."
- **A page reload at any point.** Expected: the screen comes back at the same step, nothing is requested until
  **Continue**.

## Timing expectations (so you know what is normal)

- Create your position: usually under a minute (relayer job, then the vault appears on NearBlocks).
- Approve agent and rules (setup job): about 1 minute from signature to Done.
- Wrap and transfer: each about 2–10 seconds after MetaMask confirms (two Base confirmations).
- Open position (open job): about 1 minute.
- Send USDC to your wallet: under a minute.
- Agent registration: usually within a few minutes after setup (the Worker's funding cron runs every minute since 10
  Nov); the open does not wait for it. Recorded 9 Nov with the old 10-minute cron: setup 21:47, agent noticed about
  21:55, registered on chain 22:01:42 UTC, the agent's list caught up about 22:05.
- Close chain: USDC transfer seconds; close, return WETH, return USDC each about 1 minute.
- The position screen refreshes every 30 s; a refresh normally completes in under a second.

Anything far outside these, write it down with the time.

---

## Results

| Screen | Pass / Fail | Notes |
|---|---|---|
| S1 Choose | pass | 0.01 ETH default (9 Nov, recorded below) |
| S2 Settings | pass | |
| S3 Connect | pass | Create position enabled once funded |
| S4 Opening (6 steps) | pass | 10.61 USDC borrowed at 49.9 % LTV; USDC visible in MetaMask only after importing the token |
| S4 reload: nothing prompted until Continue | not recorded | |
| S5 Position | pass with copy defects | "Revoked · revoked" while the agent's list lagged the chain (fixed in Phase 7b) |
| Verification panel (5 Checked after registration) | pass | all rows Checked after registration |
| S6 Close (review sheet + steps) | pass | first close attempt hit a relayer 503 during a redeploy; "Checking…" gave no reason (fixed in Phase 7b); second attempt done in 18 s |
| S7 Closed + Start over (same vault, no create) | pass | |

**Recorded values**

- Wallet address: `0x11B7…0A52`
- Vault id: `v10.factory.prime-measure-1792736012.testnet` Position address: `0xf09ceca0825211b1863f14708ac71f336d42a9fa`
- Relayer job ids: create, setup, open and withdraw not recorded at the time; close `87fe4d6b9182472b` (second attempt); the two return jobs not recorded. The Base transactions below were recovered from the chain on 11 Nov (Blockscout and the receipts); the job ids are not on chain.
- Wallet tx hashes (Base Sepolia, wallet `0x11b774eaf1a3a55d33cc8b9885d57ce454300a52`): wrap + WETH transfer in one batched call `0x5f22d55627eb813517f286ce1b975937e09a9acf54617b98a6bc442e81610de8` (21:48:16, 186,727 gas) · USDC transfer for the close `0xbb8b72e74190b590ab7112821c98cb9aa5bf9695beee5ea19b1d3e250b124978` (22:14:41, 10.722897 USDC, 202,924 gas) · no second USDC transfer · no gas top-up by the wallet: the position's gas float came from the relayer, `0x5ddecab2d5d6f23986045d7b7670c0a8268f3569959003b129899d84242a504d` (21:47:07, 0x0B7Ed66f… → position, 21,000 gas).
- Base tx hashes from jobs (sent by the position address `0xf09ceca0825211b1863f14708ac71f336d42a9fa`): setup = USDC approve `0x98d5de63fab9c11cb65d8aa85fbed406913e2f1cbe6d0725fbc23bff95f87c7e` (21:47:30, 55,785 gas), WETH approve `0x54846ca79da3e615a77f96726b4895200df84f0f932055a4756b0019a96336ad` (21:47:31, 46,343), Morpho `setAuthorization` `0xefc1e3ebb260cc3fc29ff78a4962237968bc990f865d3e4286a3722eca70c937` (21:47:32, 47,250), `setCorridor` live `0x73dc0bfb837c5fb213dc518b43fd4de1f9f834b6efd7d89b6d1d612815af94f0` (21:47:33, 84,133), `setCorridor` backup `0xe56763350cda5b6d419415b52d52ce270e37031a2becf6705f18d09de61a0c97` (21:47:35, 84,133) · open `0x847d9f649fdad68dd4b8ffe476e5386c750b3c62a1f3150a8c99d49af3a6d8d5` (21:48:39, 285,149) · withdraw USDC `0xd791f7ded7bffe053d26e6b494cbab81ad2f59c0f65533166558eafc9f4ee549` (21:49:03, 57,359) · close `0x6b85314c40749c7c5b5f82a3bdcf9e9037b982f4e637dbd61389d53cd0ba89cd` (22:25:43, 186,621) · withdraw WETH `0xe7265afac4e159a4a7f12eefbeb6596a26f3d7afe0679936fd29b9aa22317cea` (22:26:09, 46,521) · withdraw USDC `0x59314c7faba47bca1009cb942441c2f09291dede976dcdce96ddcda523e3d84f` (22:26:45, 40,259). All status 1.
- Gas used: listed with each transaction above.
- Times: Create position click ~21:46 → position screen after the withdraw at 21:49:03 (about 3 min); Start closing 22:14:41 → Position closed 22:26:45 (12 min, of which about 10 waiting out the first close attempt's expiry after the relayer 503).
- Agent registration: setup Done 21:47:35 → registered on chain 22:01:42 UTC (14 min; the agent's list caught up about 22:05)
- Opened LTV 49.9 %; debt at open 10.61 USDC; USDC sent for the close 10.722897 USDC; leftover USDC returned 0.106167

**Surprises** (anything unexpected, confusing, slow, or worded wrongly — one line each, with the screen and the time;
these go back to the agent as the fix list):

The surprises are listed under each recorded run below (they became the Phase 7b and Phase 8 fixes).

## Recorded results — product owner, 9–10 Nov 2026 (live on testnet.cmdk.fi, preview deploy from feat/guided-flow at a36e63f)

Wallet 0x11B7…0A52 (fresh MetaMask account). Vault **v10**, position address `0xf09ceca0825211b1863f14708ac71f336d42a9fa`. Times are UTC.

| Step | Result | Time | Notes |
|---|---|---|---|
| S1–S3 | pass | — | 0.01 ETH default; Create position enabled once funded |
| S4 step 1 create | pass | ~21:46 | relayer created v10 |
| S4 step 2 setup | pass | 21:47:33–35 | two CorridorSet receipts (live, backup) |
| S4 step 4 wrap + transfer | pass | 21:48:16 | 0.01 WETH to the position address |
| S4 step 5 open | pass | 21:48:39 | 10.61 USDC borrowed at 49.9% LTV |
| S4 step 6 withdraw | pass | 21:49:03 | USDC in the wallet (10.616729); visible in MetaMask only after importing the token |
| Agent registration | pass, slow | noticed ~21:55, registered on chain 22:01:42, agent list caught up ~22:05 | agent side: slow official NEAR RPC + 10-minute funding cron (both being changed by the protocol team) |
| S5 | pass with copy defects | — | showed "Revoked · revoked" while the agent list lagged behind the chain; verification rows all Checked after registration |
| S6 step 1 USDC transfer | pass | 22:14:41 | 10.722897 USDC |
| S6 step 2 close, first attempt | relayer 503 (relayer redeploy at that moment) | ~22:14:50 | app showed "Checking…" without a reason; waited for the 10-minute expiry, then offered "Sign a new message" |
| S6 step 2 close, second attempt | pass | job 87fe4d6b9182472b, done in 18 s, 22:25:43 | receipt status 1; debt 0, collateral 0 |
| S6 step 3 return WETH | pass | 22:26:09 | |
| S6 step 4 return leftover USDC | pass | 22:26:45 | 0.106167 USDC |
| S7 closed + Start over | pass | — | gas float 0.004994 ETH (0.005 − ~0.000006 for the whole open and close) |

Surprises → fixes (tasks/todo.md Phase 7b): agent status trusted the agent's list over the chain; "Checking…" gave no reason or ETA; POST timeout too short for a slow relayer; internal Morpho transfer legs shown as separate rows; static verification rows tagged "Not checked"; duplicated disclaimer; amounts with six decimals; "no active corridor" copy after close; no "Show USDC in MetaMask"; registration_tx absent in the agent's list after it adopted the on-chain key.

## Recorded results — second run, product owner, 10 Nov 2026 (live on testnet.cmdk.fi, preview deploy of d8d2fe6, agent compose db4f5085)

Same wallet 0x11B7…0A52, same vault **v10** (it had approved the previous agent version, compose 216124c1). Times are local.

| Step | Result | Time | Notes |
|---|---|---|---|
| S0 | pass | — | landed on S4, resumed at the setup step (empty vault whose approval is not the published one) |
| S4 setup (re-approve) | pass | ~09:36 | one signature; approve only, no Base transaction |
| Agent registration | pass | 09:37:20 | agent key registered on v10, expires 17 Nov (about a minute after setup: one-minute funding cron, agent NEAR RPC failover) |
| S4 wrap + transfer | pass | 09:37:44 | |
| S4 open | pass | 09:38:07 | 49.9 % LTV, 10.61 USDC |
| S4 withdraw | pass | 09:38:29 | |
| S5 | pass | — | Agent Active; backup "Approved for migration"; recent actions one row per transaction |

Defect found live (fixed in Phase 8): after connecting, the wallet reported a chain other than Base Sepolia although
MetaMask's network selector showed Base Sepolia (MetaMask keeps a network per site; the old app had left this site on
another chain). Continue on S4 then did nothing and said nothing (the runner returns while the chain is wrong).
