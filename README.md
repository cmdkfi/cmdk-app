# cmdk app prototype

Local interactive prototype of the cmdk crypto loan dashboard. It includes My loan, Autopilot, Verify, Demo, and Create vault, plus repayment and withdrawal previews.

## Run locally

From this directory:

```sh
python3 -m http.server 8765
```

Open <http://127.0.0.1:8765/>. The app is a static HTML prototype; no build or package installation is needed.

The screens use local demo data. There is no live market feed, connected wallet, real signature, or on-chain transaction. Lightweight Charts is bundled in `vendor/`; its license is included there.
