#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/common.sh"

ROOT_DIR="$SMOKE_ROOT_DIR"
MODE="${AUTOLABOS_SMOKE_MODE:-pending}"
CI_FLAG="${CI:-false}"

if ! smoke_has_expect; then
  if [[ "$MODE" == "pending" ]]; then
    echo "CI smoke mode: ${MODE} (CI=${CI_FLAG})"
    RUN_ID="$(smoke_run_id)"
    smoke_set_fake_codex_structured_actions \
      "$RUN_ID" \
      '[{"type":"collect","limit":100,"sort":{"field":"relevance","order":"desc"},"filters":{"last_years":5}}]'
    smoke_run_pending_without_expect "$RUN_ID"
    echo "PASS: CI smoke completed ($MODE)"
    exit 0
  fi
  smoke_require_expect
fi

echo "CI smoke mode: ${MODE} (CI=${CI_FLAG})"

if [[ "$MODE" == "all" ]]; then
  smoke_run_all_modes
elif smoke_has_mode "$MODE"; then
  smoke_run_mode "$MODE"
else
  echo "FAIL: unknown AUTOLABOS_SMOKE_MODE '$MODE' (use $(smoke_known_modes | tr ' ' '|')|all)"
  exit 1
fi

echo "PASS: CI smoke completed ($MODE)"
