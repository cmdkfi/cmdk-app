# Corrections from the contracts

Checked on 2 November 2026: this prototype at `0719847` against `cmdkfi/app` at `840ecbc`
(`executor/src/Executor.sol`, `vault/src/lib.rs`, `vault/src/owner.rs`, `vault/factory/src/lib.rs`)
and `design/app-screens.md`.

The look, the copy and the demo numbers are correct. Below are the places where a flow shows
something the contracts do not do, and the steps the app needs that are not there yet.

## How the owner acts

- **One wallet transaction:** sending WETH (or USDC) to the position address on Base Sepolia.
  This is the only step that needs a network, gas and a wallet transaction.
- **Signed messages for everything else:** a personal-sign message (ERC-191) that the owner's
  wallet signs, one method per message. The vault on NEAR checks it, NEAR's signing network
  signs the Base transaction, and it lands on Base. No gas for the user, no network switch.
  Every message expires in 10 minutes.

Owner methods (`vault/src/lib.rs:252`): `setup`, `set_corridor`, `open`, `repay`, `close`,
`withdraw`, `approve_measurement`, `revoke_agent` (plus `cancel`, `sweep_eth`, `set_executor`,
which the app does not need on screen).
Agent methods (`vault/src/lib.rs:46`): `reduce`, `migrate`, `exit`. The owner cannot call them.

Create vault is one signed message: `setup`, carrying the token approvals, the rules for the
live and backup markets, and the agent version. Later changes use the single methods
(`set_corridor`, `approve_measurement`, …).

## Corrections

### 1. Remove "Ceiling"
Prototype: the corridor has Floor / Target / Ceiling / Agent trigger; "your loan cannot start above
this LTV".
Contracts: the corridor is `target`, `act`, `floor`, `sellBudget`, `migrateAllowed`, `exitAllowed`
(`Executor.sol:22`). There is no ceiling, so nothing enforces it.
Change: remove the field. The starting-LTV slider is limited by the act line (starting LTV must be
below act).

### 2. "Market moves" is not editable
Prototype: an editable number, default 2.
Contracts: a constant, `MAX_MOVES = 2` per rolling 24 hours (`Executor.sol:51`).
Change: show it as fixed text: "Up to 2 moves per 24 hours".

### 3. Migrate and Exit are switches
Prototype: "Move only to an approved market" and "Exit the position…" are fixed checkmarks.
Contracts: `migrateAllowed` and `exitAllowed` are the owner's on/off choices in the corridor.
Change: two switches, both on by default. Reduce stays fixed (always allowed inside the corridor).

### 4. Opening a loan is a signed message, not wallet transactions
Prototype: "A real wallet would ask for separate approval, supply and borrow confirmations",
network Base Sepolia, example fee ≈ $0.03.
Contracts: after the WETH has arrived at the position address, `open` is one signed message;
supply and borrow happen in that one call (`Executor.sol:172`).
Change: the review sheet says what is signed: market, WETH supplied, USDC borrowed, LTV,
"expires in 10 minutes". No network row, no fee row.
Progress after signing: Signed → Checked by your vault on NEAR → Signed for Base by NEAR's
signing network (about 8 s) → Done on Base (1–2 s), each step linking to its transaction.
The same sheet and steps apply to repay, close, withdraw, rules and revoke.

### 5. Repay and Close use USDC at the position address
Prototype: "Pay with USDC — use USDC from your wallet", with a USDC approval step.
Contracts: `repay` and `close` take USDC from the position address (`Executor.sol:210`, `:225`).
There is no approval prompt: the vault sets approvals once, in `setup`.
Change: show the USDC available at the position address. If it is not enough, the first step is
"Send USDC to your position address" (a wallet transfer), then the signed `repay` or `close`.
`close` repays the exact debt and returns all WETH to the position address; taking it to the
wallet is a separate Withdraw (item 9).

### 6. Remove the owner's "Reduce with WETH"
Prototype: the Repay dialog offers "Reduce with WETH: sell part of your collateral to repay debt".
Contracts: selling collateral is `reduce`, which only the agent's key can call. The owner has
`repay` (from USDC) and `close`.
Change: remove the option from Repay.

### 7. The owner approves an agent version, not a "7-day session"
Prototype: "Agent access approved · You approved a 7-day session".
Contracts: the owner approves a measurement (`vault/src/lib.rs:364`): only code with this
fingerprint can get the agent's key. The agent then registers itself (`register_agent`,
`lib.rs:421`); its key is valid for 7 days and renews by itself.
Change: the activity entry reads "Agent version approved"; the 7 days appear as
"Agent key valid until <date>".

## Missing steps

### 8. The agent version, inside Create vault
The review step before signing shows the agent version: measurement (short hash with copy),
source commit, a "How to rebuild and compare" link, and one sentence: only code with this
fingerprint can get the agent's key. The same single Create vault signature approves it.
After signing, with no user action: "Agent registering… → Agent registered, key valid until
<date>". "Watching your loan" appears only after the agent's first check of this position.
Approving a newer agent version later is its own signature: "Approve this agent version".

### 9. Take the USDC (last step of Create vault, and in Withdraw)
Contracts: `open` borrows to the position address (`Executor.sol:528`), not to the wallet.
Moving it out is a signed `withdraw` (`vault/src/lib.rs:309`).
- After "Loan opened": "2,500 USDC available at your position address", a destination field
  (default: the connected wallet), one signature: "Withdraw to my wallet".
- Explain once: this is the only way money leaves, and only your signature can do it.
- The Withdraw button on My loan offers every free balance at the position address
  (USDC, and WETH after a close), not only WETH.

### 10. Verify: the vault checklist
The current Verify page shows the proof of one decision; keep it as the "Proof" view opened from
an activity entry. The Verify page itself is a read-only checklist, each line with its live value
and a "check it yourself" link (`design/app-screens.md` §9):
1. Your vault has exactly one key: the agent's, limited to `reduce`, `migrate`, `exit`.
2. Your vault's code hash equals the published one and cannot change.
3. Your corridor as stored on Base matches what you set (each market).
4. Your LTV computed with Morpho's own math and oracle.
5. The executor is the only contract authorized on your position.
6. The approved agent measurement and its current key registration.
7–13. Links to the recorded evidence (attacks, transcripts, live sale, injection run, revoke and withdraw).

### Smaller items on My loan
- The band on My loan also marks floor and target (the Create vault band already does).
- Each agent activity entry says why ("ETH fell 30%; LTV crossed your act line (70%)") and who
  decided: "Rule" or "AI judgment".
- After a partial move the loan is one card with a row per market (collateral, debt, LTV,
  liquidation price), and Close asks for one signature per market.

## Answers to the design plan, §11

1. **Order and signatures:**
   1. The vault is created for your wallet address (no signature).
   2. One signed `setup`: approvals, rules on the live and backup markets, and the agent version.
   3. The agent registers itself.
   4. Wallet transfer of WETH to the position address.
   5. Signed `open`.
   6. Signed `withdraw` for the USDC.

   In total, 1 transaction and 3 signatures. (`setup` in this form is vault item V7, in progress.)
2. **USDC reaches the wallet** by a separate signed `withdraw` after `open` (item 9).
4. **Editable settings and ranges:**
   - Floor < target; act at least 0.1 percentage point above target; act below 86%
     (`CorridorMath.sol:82`).
   - Daily sell budget 0–100% of collateral.
   - Migrate and exit on/off.
   - Moves fixed at 2 per 24 hours.
   - Approved markets: the live and the backup market.
