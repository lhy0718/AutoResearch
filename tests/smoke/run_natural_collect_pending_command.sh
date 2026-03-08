#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/common.sh"

ROOT_DIR="$SMOKE_ROOT_DIR"
RUN_ID="$(smoke_run_id)"

smoke_set_fake_codex_structured_actions \
  "$RUN_ID" \
  '[{"type":"collect","limit":100,"sort":{"field":"relevance","order":"desc"},"filters":{"last_years":5}}]'

smoke_run_expect "natural_collect_pending_command.exp" "$RUN_ID"
