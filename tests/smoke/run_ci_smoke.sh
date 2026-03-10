#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/common.sh"

ROOT_DIR="$SMOKE_ROOT_DIR"
MODE="${AUTOLABOS_SMOKE_MODE:-pending}"
CI_FLAG="${CI:-false}"

smoke_require_expect

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
