#!/usr/bin/env bash
set -euo pipefail

EVAL_OUTPUT="outputs/eval-harness/latest.json"
BASELINE_PATH="outputs/eval-harness/baseline.json"
HISTORY_DIR="outputs/eval-harness/history"
# Regression threshold for skill pass-rate comparisons. If any skill drops by more than this
# amount relative to the saved baseline, the script exits non-zero.
REGRESSION_THRESHOLD="0.05"

mkdir -p "$(dirname "$EVAL_OUTPUT")" "$HISTORY_DIR"

npm run eval:harness -- --limit 20 --output "$EVAL_OUTPUT"
npx tsx src/cli/evolveSkills.ts "$EVAL_OUTPUT" "$BASELINE_PATH" "$REGRESSION_THRESHOLD"
