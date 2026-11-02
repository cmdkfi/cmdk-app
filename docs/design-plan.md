# Design Plan (vladaone)

Project: **cmdk**  
Plan author: **[vladaone](https://github.com/vladaone)**  
Original plan: 1 November 2026  
Scope: prototype design for the NEAR Hackathon.

This document describes planned screens and user journeys. It does not certify that the features have been implemented. The current prototype may differ from this planning snapshot; verify behavior in the app and with the developer before treating any item as complete.

## 1. What the product does

A user borrows against crypto collateral. An agent monitors the position and acts within permissions granted by the user. Contracts check whether those actions are allowed.

The interface should make it clear at any moment:

- How much the user owes and how much collateral remains.
- How close the position is to risk thresholds and how fresh the data is.
- What the agent is allowed to do, what it is doing now, and why.
- How the user can repay debt, close the position, or revoke access.

Protection means risk management. It is neither insurance nor a guarantee against liquidation.

## 2. Hackathon scope

| Include | Do not present as a working feature |
| --- | --- |
| NEAR testnet and Base Sepolia | Mainnet or real funds |
| WETH / USDC, Morpho, direct WETH deposit | Deposits of any asset from any chain |
| Reduce, Migrate, Exit | Buy back / Relever |
| Rules, limits, approved markets | Unlimited agent authority |
| Action history and explanations | A guarantee against liquidation |
| Clearly labeled demo scenarios | Private transfers through Confidential Intents on testnet |
| Supported standard EVM wallets | Smart wallet support without developer confirmation |

**Reduce** sells some collateral and repays part of the debt.  
**Migrate** moves a position, or part of it, to another approved market.  
**Exit** repays the debt and returns remaining collateral from the market to the position address. Moving it to the owner's personal wallet is a separate owner action.

The agent cannot increase debt or choose an arbitrary recipient in this version.

## 3. Screen map

### 01 — Welcome

Purpose: explain the product quickly and provide two clear entry points.

- Headline: **Borrow against your crypto. Keep risk on autopilot.**
- Brief explanation of the loan and the agent's limits.
- **Open app** to start with a wallet.
- **Try demo** to explore without a wallet.
- Visible **Testnet prototype** label.

A small starting screen is enough for the hackathon; a large marketing site is a lower priority.

### 02 — Connect wallet

Purpose: connect the owner's wallet.

- List only the EVM wallets that are actually supported.
- Show the address after connection.
- Explain that this wallet authorizes the owner's actions.
- Show the test network.
- **Continue**.

States: connecting, connected, user rejected, unsupported wallet, and network error. Rejection must not erase information already entered.

### 03 — Open loan

One screen with sequential steps.

| Step | User action | Content |
| --- | --- | --- |
| Collateral | Enter a WETH amount | Available balance, estimated value, deposit instructions |
| Borrow | Choose a USDC amount | Debt, current rate, LTV, distance to thresholds |
| Review | Check the terms | Collateral, debt, market, risk, costs, required signatures |

Explain LTV as debt divided by collateral value. The market sets the liquidation threshold; the user cannot edit it.

Separate states: no position, position creation, deposit pending, collateral received, signature pending, transaction submitted, loan opened, and error. A submitted transaction must not be shown as complete.

Confirm the exact order of vault creation, WETH deposit, agent setup, debt opening, and USDC delivery with the developer. The journey below is a proposal, not a confirmed sequence of contract calls.

### 04 — Set up autopilot

Purpose: explain what the user authorizes the agent to do.

| Setting | Plain-language meaning | Value in the current specification |
| --- | --- | --- |
| Target LTV | Risk level to return to | 50% |
| Act line | When a protective sale starts | 70% |
| Minimum LTV / Floor | LTV below which the agent must not sell | 30% |
| Liquidation threshold | Where the market can liquidate | 86% for the selected demo market |
| Daily sell budget | Limit on ordinary sales over a rolling 24 hours | 20% of collateral |
| Approved markets | Where migration is allowed | Agreed markets only |
| Allow migration | Whether migration is allowed | At most two moves per 24 hours |
| Allow exit | Whether the agent may close the position | Separate permission |

Protective sales above the Act line are exempt from the ordinary daily budget and stop at the target level. Explain this exception before confirmation.

- Briefly explain Reduce, Migrate, and Exit.
- **Review & enable agent** → permission review → owner signature → authorization result.
- Do not add Buy back settings, a buy budget, or a buy cooldown.
- These values are not personalized financial advice.

### 05 — My loan

The main screen for everyday use.

| Block | Content |
| --- | --- |
| Outstanding debt | USDC owed |
| Collateral | WETH amount and value |
| Risk | LTV, Act line, liquidation threshold, and distance to thresholds |
| Agent | Status, last check time, current action |
| Market | Market, rate, price, data freshness |
| Recent activity | Recent owner and agent actions |
| Actions | Repay, Withdraw, Close loan, Manage agent |

Avoid a vague green “Funds are safe” status. Use concrete states such as **Agent active**, **Risk rising**, and **Action pending**.

States of this screen:

1. No position has been opened.
2. Agent monitoring.
3. Risk rising.
4. Action executing.
5. Action completed.
6. Action blocked by validation.
7. Transaction failed.
8. Agent unavailable or data stale.
9. Access revoked.
10. Position closed.
11. Position liquidated, showing the actual remainder and history without promising recovery.

When the agent is unavailable, do not imply that monitoring continues. The position remains open; owner actions remain available when the underlying infrastructure permits them.

### 06 — Activity

Purpose: explain what happened to the position.

Each entry includes:

- Time.
- Initiator: owner, rule, or AI.
- Action and reason.
- Status.
- Short result.

Statuses: **Proposed → Submitted → Confirmed**, with **Blocked** and **Failed** alternatives. Show additional authorization and signature stages when the backend supplies them.

**Action details**, opened from an entry, should show:

- What changed in the market.
- Why this action was chosen.
- Balances and risk before and after.
- Which limits were checked.
- A link to a real transaction, if one exists.
- A clear demo label instead of a fabricated transaction.

Before execution, show an estimate. After confirmation, show the actual result.

### 07 — Manage agent

A separate screen or a large side panel.

- Status, access expiration, and last check time.
- Three permitted actions.
- Risk rules and limits.
- Approved markets.
- **Edit rules**, followed by owner confirmation.
- **Revoke access**.
- Expandable **Verification** section with available evidence for the agent, model, and contracts.

Copy for revocation:

> Automatic actions stop. Your loan remains open. Previously signed calls may remain valid until they expire — up to 10 minutes.

Revoking access must not look like repaying debt. Do not show “Verified” without an actual verification result. Public positions do not become private merely because model execution is confidential.

## 4. Owner action dialogs

| Dialog | Show |
| --- | --- |
| Repay debt | USDC amount, source of funds, available balance, debt and LTV after repayment |
| Withdraw funds | Only the withdrawable balance, amount, and owner's wallet address |
| Close loan | Repayment method, expected remainder, costs, and consequences |
| Review transaction | What is signed and what will change |
| Transaction status | Signature pending, submitted, confirmed, rejected, or failed |
| Revoke access | Consequences and expiration of previously signed calls |

Collateral that secures debt is not a free withdrawal balance. Do not promise an exact amount received without a current quote.

For every action: validate input, allow cancellation without losing context, prevent duplicate submissions, and provide a clear recovery path after errors.

## 5. UX flow: first use

~~~mermaid
flowchart TD
    A[Welcome] --> B{How to start?}
    B -->|Try demo| C[Demo without wallet]
    B -->|Open app| D[Connect wallet]
    D --> E[Create position and deposit WETH]
    E --> F[Choose USDC amount]
    F --> G[Set agent rules]
    G --> H[Review terms and permissions]
    H --> I[Sign and execute operations]
    I --> J[Loan opened]
    J --> K[My loan]
    I -->|Rejected or failed| H
~~~

Confirm transaction order and when USDC reaches the owner with the developer: opening debt and withdrawing funds to a personal wallet may be separate operations.

Returning user: **Connect wallet → load existing position → My loan**, without repeating onboarding.

## 6. UX flow: automatic action

~~~mermaid
flowchart TD
    A[Monitoring] --> B[Risk detected]
    B --> C[Action selected]
    C --> D{Allowed by checks?}
    D -->|Yes| E[Executing]
    D -->|No| F[Blocked: no execution]
    E -->|Confirmed| G[Updated balances and risk]
    E -->|Failed| H[Show actual state]
    G --> I[Activity entry]
    F --> I
    H --> I
    I --> J{Agent available?}
    J -->|Yes| A
    J -->|No| K[Unavailable]
~~~

Do not ask the owner to sign every previously authorized action. Rules and permissions are set in advance.

A numeric protective trigger does not necessarily wait for AI. Distinguish rule-triggered actions from model decisions instead of labeling every action “AI decided.”

## 7. UX flow: repayment and exit

**Partial repayment:**  
My loan → Repay debt → enter amount → review new debt and LTV → sign → wait for confirmation → My loan.

**Close loan and withdraw:**  
My loan → Close loan → review terms → sign → wait for confirmation → see the remainder at the position address → Withdraw → confirm → funds arrive in the owner's wallet.

**Disable the agent:**  
My loan → Manage agent → Revoke access → confirm → show revoked access and the still-open loan.

## 8. Hackathon demo

Available without a wallet. Keep a persistent demo indicator. No real funds or transactions.

| Step | Data and result |
| --- | --- |
| Monitor | 2 WETH at $2,500; $5,000 collateral; 2,500 USDC debt; 50% LTV |
| Price drops | ETH at $1,750; $3,500 collateral; same debt; approximately 71.4% LTV |
| Reduce | Sell approximately 0.857 WETH and repay 1,500 USDC |
| Result | Approximately 1.143 WETH worth $2,000 remains; 1,000 USDC debt; 50% LTV |

This calculation is simplified: it excludes fees, interest, and slippage. Lower debt is not earned profit; some collateral was sold.

Controls: **Run / Pause / Next step / Reset / Replay**.

Also allow previewing **Blocked / Unavailable / Access revoked**. This UI demo is not proof that on-chain checks work.

The core presentation: open a position → show the rules → price drops → Reduce → result. If implementation permits, add a safety scene in which a contract rejects a forbidden action.

## 9. Visual style and interactions

The original design direction called for neutral surfaces, large financial figures, a Butter gradient in an accent area, and light and dark themes. The prototype has since changed; use the implemented UI as the visual source of truth. The brand is cmdk, and all interface copy is in English.

- One primary emphasis per screen; place reasons and consequences near the action.
- Convey risk with text and numbers, not color alone.
- Use motion to explain state and value changes without delaying actions.
- Avoid continuously animating important metrics.
- Avoid decorative delays for frequent or keyboard-driven interactions.
- Honor prefers-reduced-motion.
- Apply hover feedback only to pointer devices; keep keyboard focus visible.
- In dialogs, contain focus, close on Escape, and return focus to the opener.
- On mobile, use one column, readable amounts, reachable buttons, and no horizontal overflow.
- For long operations, show the actual stage rather than an invented progress percentage.

## 10. Priorities and readiness

### P0 — Core journey and demo

- [ ] My loan: normal state, risk, action, result.
- [ ] Open loan and confirmation states.
- [ ] Set up autopilot: three actions and limits.
- [ ] Repay / Close / Withdraw.
- [ ] Replayable demo with an unmistakable demo indicator.
- [ ] Check mobile and desktop in both themes.

### P1 — Control and trust

- [ ] Blocked / Failed / Unavailable / Access revoked.
- [ ] Activity and Action details.
- [ ] Manage agent and access revocation.
- [ ] Verification based on evidence that actually exists.
- [ ] Check keyboard, focus, and reduced motion.

### P2 — Presentation

- [ ] Welcome with Try demo.
- [ ] Consistent naming, error copy, and empty states.
- [ ] Demo video and screenshots.
- [ ] Check that interface claims match the working prototype.

Some P0/P1 UI has been built in the local prototype. These checkboxes remain unmarked because a local interface does not prove product implementation or end-to-end system verification.

## 11. Questions for the developer before final designs

1. What is the exact sequence for vault creation, collateral deposit, debt opening, and agent authorization? Where must the owner sign?
2. How does USDC reach the personal wallet: as part of loan opening or through a separate withdrawal?
3. Which stages, errors, timestamps, and verification results does the backend expose to the interface?
4. Which settings are editable, what are their valid ranges, and which markets are approved?
5. Which verification data and transaction links will actually be available for the demo?

Do not reintroduce the resolved Buy back question. It is outside the hackathon scope.

## 12. Sources and hackathon tracks

The primary track is **Unstoppable DeFi**. **AI Security & Defense** and **Privacy & Private AI** are secondary tracks only if working evidence supports the relevant mechanisms.

- [Project specification](https://github.com/fffilimonov/prime/blob/main/docs/01-design-and-feasibility.md)
- [Judges' README](https://github.com/fffilimonov/prime/blob/main/docs/02-judges-README.md)
- [NEAR Hackathon](https://nearhackathon.com/)
- [Official rules](https://nearhackathon.com/HACKATHON.md)

Source documents may change; compare with their latest versions before implementation. An older README mentions four methods and buy back. This plan uses the explicitly stated scope of the Three layers section: Reduce / Migrate / Exit.
