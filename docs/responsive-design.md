# A Light desktop and mobile design

The implementation follows the approved full A Light proposal and the landing design: canvas `#f6f7f5`, white panels, charcoal text/actions, green status accents, 18 px panels and the existing local Cmdk font. The design archive is `design-proposals/full-light-v3/` in the parent workspace. The older `docs/mockups/` artboards describe the previous prototype.

The owner's request to implement desktop/mobile replaces the historical desktop-only requirement (PRD D9 / FR-16). The app now mounts at all widths, with the same route guards, adapters and transaction runners. Resizing does not destroy the wallet session or the flow. The first three screens share a setup indicator; route changes return focus to the heading.

## Screen coverage

| Area | Desktop | Mobile |
| --- | --- | --- |
| Choose | Asset catalogue, deposit and loan-summary panels | Available pair first, expandable catalogue, stacked panels |
| Settings | Corridor, explanation disclosure, three permission cards | Two-column corridor legend, stacked cards, acknowledgement before Continue |
| Connect | Detected browser wallets, funding/network help | Same checks and wallet choices; instructions for opening the site in a wallet browser when none is injected |
| Opening and recovery | Numbered steps beside verification | Active step first, verification below, wallet-request guidance |
| Position and agent states | Balance cards, corridor, agent and market panels, activity | Stacked cards and wrapping addresses; close/start-over action after position details |
| Close, revoke and sandbox confirmations | Centred native dialogs | Scrollable bottom sheets with safe-area spacing |
| Sandbox crash | Comparison table | Each stage stacks its without/with-agent outcomes |

The proposal's wallet handoff is represented by the existing provider's pending request and reconciliation states. Mobile live signing requires an injected provider in a wallet browser. WalletConnect/QR pairing and external-wallet universal links are not added; they require a separately configured transport. The UI does not display an Open wallet action that cannot perform a real handoff.

## Protocol boundary

Reviewed the local `cmdkfi/app` protocol source before removing the viewport gate: `vault/src/owner.rs` verifies the ERC-191 owner message and nonce/expiry, `scripts/p2_owner.py` specifies message ordering, and `executor/src/Executor.sol` enforces the corridor. No ABIs, addresses, transaction construction, signature handling, confirmation requirements or replay/recovery rules change.

All production amounts, rates, status labels and verification results continue to use the existing adapters. Sandbox behavior stays isolated and labelled. Future asset statuses follow the approved landing inventory; they remain unselectable.

## Review and checks

Run `pnpm build`, `pnpm test`, `pnpm test:bundle-boundary` and `pnpm test:browser` from `app/`. The browser configuration runs the same functional suite at desktop and mobile sizes, with additional mobile coverage at 320, 360, 390, 768 and 1024 px. Visual tests capture both artboards and assert no horizontal page overflow. Mobile screenshot names use a `mobile-` prefix.

A fixture pass validates UI and protocol sequencing, not a real mobile wallet or device. Rehearse signing, switching networks and returning after app suspension in a mobile wallet browser before release.

The implementation was checked with 162 unit tests, 179 Linux Chromium desktop/mobile scenarios, TypeScript, a production build and the bundle-boundary check. The 36 Linux visual baselines were refreshed and reviewed. Native macOS browser automation was unavailable in this session; the Darwin baselines still describe the previous design and must be refreshed on macOS before running local visual comparisons there.
