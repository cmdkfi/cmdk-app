# A Light desktop and mobile design

The implementation follows the approved full A Light proposal and the landing design: canvas `#f6f7f5`, white panels, charcoal text/actions, green status accents, 18 px panels and the existing local Cmdk font. The older `docs/mockups/` artboards describe the previous prototype.

**Decision of 11 Nov 2026: the testnet flow is desktop-only again; on a phone the app offers the sandbox.** Inside MetaMask Mobile's in-app browser the first signature (`personal_sign` for setup) fails with -32602 "must provide an Ethereum address" (MetaMask Mobile 8.18, per-network site permissions; [MetaMask/metamask-mobile#39052](https://github.com/MetaMask/metamask-mobile/issues/39052)), and the live flow is not supported on phones before the submission.

The app stays mounted at every width (the old desktop gate, which unmounted the whole shell below 960 px, does not come back). Below 960 px the live routes (`#start`, `#settings`, `#connect`, `#progress`, `#position`, and `#close`/`#closed`, which redirect) render one notice instead of their screen: "The testnet flow runs on a desktop browser with a wallet extension. On a phone, try the sandbox: a simulated wallet and protocol, nothing touches Base Sepolia or NEAR." with "Try in sandbox" as its only action (`app/src/components/PhoneNotice.tsx`). The notice mounts no adapter, so no wallet call, no relayer call and no NEAR or Base read happens on those routes at that width. The sandbox routes (`#sandbox/…`) work unchanged at every width. At 960 px and above nothing changes. Widening the window from the notice brings the live shell back with fresh live adapters, as after a reload. The first three screens share a setup indicator; route changes return focus to the heading.

## Screen coverage

Live screens are shown at 960 px and above only; the mobile column below applies to the same screens in the sandbox.

| Area | Desktop | Mobile (sandbox) |
| --- | --- | --- |
| Live routes below 960 px | — | One notice with "Try in sandbox"; no adapter mounted |
| Choose | Asset catalogue, deposit and loan-summary panels | Available pair first, expandable catalogue, stacked panels |
| Settings | Corridor, explanation disclosure, three permission cards | Two-column corridor legend, stacked cards, acknowledgement before Continue |
| Connect | Detected browser wallets, funding/network help | The sandbox wallet, already connected |
| Opening | Numbered steps beside verification | Active step first, verification below |
| Position | Balance cards, corridor, agent and market panels, activity | Stacked cards and wrapping addresses; close/start-over action after position details |
| Close and sandbox confirmations | Centred native dialogs | Scrollable bottom sheets with safe-area spacing |
| Sandbox scenes | Comparison table | Each stage stacks its without/with-agent outcomes |

Signing on a phone is not supported. WalletConnect/QR pairing and external-wallet universal links are not added; they require a separately configured transport.

## Protocol boundary

Reviewed the local `cmdkfi/app` protocol source before removing the viewport gate: `vault/src/owner.rs` verifies the ERC-191 owner message and nonce/expiry, `scripts/p2_owner.py` specifies message ordering, and `executor/src/Executor.sol` enforces the corridor. No ABIs, addresses, transaction construction, signature handling, confirmation requirements or replay/recovery rules change.

All production amounts, rates, status labels and verification results continue to use the existing adapters. Sandbox behavior stays isolated and labelled. Future asset statuses follow the approved landing inventory; they remain unselectable.

## Review and checks

Run `pnpm build`, `pnpm test`, `pnpm test:bundle-boundary` and `pnpm test:browser` from `app/`. The desktop project runs the whole functional suite at 1280 px. The mobile project (390 px) runs `e2e/mobile.spec.ts` (the notice on every live route with no wallet call and no request but the app's own, the sandbox entry from it, widths from 320 to 1024 px), `e2e/sandbox.spec.ts` (the sandbox end to end) and the sandbox screenshots of `e2e/visual.spec.ts`. Visual tests capture both artboards at fixed heights, assert that the complete page fits, and check for horizontal overflow. This avoids the one-pixel document-height rounding drift seen between Chromium platforms without increasing screenshot tolerance. Dialogs keep normal desktop/phone viewport heights. Mobile screenshot names use a `mobile-` prefix.

Update 11 Nov 2026 (desktop-only testnet flow): 162 unit tests and 116 browser scenarios (90 desktop, 26 mobile, of which 14 live screenshots are skipped on the mobile project), with the mobile live baselines removed and `mobile-phone-notice` added.

The first implementation was checked with 162 unit tests, 179 Linux Chromium desktop/mobile scenarios, TypeScript, a production build and the bundle-boundary check. The fixed-artboard refresh passed all 36 scenarios on Linux x86_64 Chromium and all 36 on native macOS Chromium. Both platform baseline sets now cover desktop and mobile. The macOS refresh was run by the owner outside the agent sandbox; its local HTML report records 36 expected, zero unexpected and zero skipped tests.

S1 retains the debt-limit statement, including the up-to-0.000002-USDC rounding exception on a move, before the user continues to the full limits on S2.
