#!/bin/sh
# Rewrites the Phase 9 screenshot baselines (e2e/visual.spec.ts), only on purpose (a deliberate visual change):
#   darwin — here, for local runs (this script);
#   linux  — on GitHub's ubuntu-latest runner, for `frontend quality` and `deploy testnet`: run `frontend quality` by hand on the
#            branch with visual_baselines = true, then `gh run download <run id> -n visual-baselines-linux -D e2e/__screenshots__/linux`.
#            (Docker emulation of amd64 on a laptop was too slow and memory-bound to be reliable, Phase 9.)
# Review the new images before committing them.
set -eu
cd "$(dirname "$0")/.."
pnpm exec playwright test e2e/visual.spec.ts --update-snapshots
echo "darwin baselines updated; run 'frontend quality' with visual_baselines = true for linux (see the comment at the top of this script)"
