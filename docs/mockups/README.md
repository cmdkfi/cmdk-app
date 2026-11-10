# Guided flow mockups

Source files of the design canvas https://claude.ai/artifact/88dCh3D6TAgkirFhEjRhmp (12 artboards, 9 Nov 2026). The canvas is the reviewed layout reference for `docs/prd-guided-flow.md` §7; these files are the same artboards so the implementation session does not depend on the link.

Each `*.dc.html` is one screen. They share `cmdk.css`, whose tokens mirror `app/src/ui/prototype-controls.css` (dark theme). `canvas.json` is the canvas layout index. The files use the Design canvas format (`<x-dc>` wrapper, `support.js` head line); open the canvas to view them rendered, or read the markup directly for structure and copy.

| File | Screen |
|---|---|
| `S0-Entry.dc.html` | Header wallet slot states and the table of where `/` lands (PRD S0) |
| `Main.dc.html` | S1 Choose collateral, debt, venue; amount and estimate |
| `S2-Settings.dc.html` | S2 Protection in one picture (corridor + will / never / you keep) |
| `S3-Connect.dc.html` | S3 Connect MetaMask, funding check, Create position; S3a Get Base Sepolia ETH variant |
| `S4-Progress.dc.html` | S4 Chained onboarding steps with the agent verification rail |
| `S5-Position.dc.html` | S5 Position: debt, collateral, LTV corridor, agent, market, recent actions, Close position |
| `S6-Close.dc.html` | S6 Close position steps; S6a Get test USDC panel |
| `S7-Closed.dc.html` | S7 Closed state with Start over; liquidated variant note |
| `S8-Sandbox.dc.html` | S8 Sandbox entry sheet and banner |
| `S9-Sandbox-Progress.dc.html` | S9 Sandbox progress with "Simulated (not checked)" verification |
| `S10-Sandbox-Position.dc.html` | S10 Sandbox position after the scripted price drop and agent reduce |
| `S11-Sandbox-Leave.dc.html` | S11 Leave sandbox confirmation |

All numbers on the artboards are example values for layout only. Live screens read them from Base Sepolia, NEAR and the relayer; missing reads show "unavailable", never a placeholder.
