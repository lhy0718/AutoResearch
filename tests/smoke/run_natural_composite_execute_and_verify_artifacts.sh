#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/common.sh"

ROOT_DIR="$SMOKE_ROOT_DIR"
RUN_ID="$(smoke_run_id)"
RUN_DIR="$(smoke_run_dir "$RUN_ID")"

smoke_reset_collect_artifacts "$RUN_DIR"
smoke_set_fake_codex_structured_actions \
  "$RUN_ID" \
  '[{"type":"clear","node":"collect_papers"},{"type":"collect","sort":{"field":"relevance","order":"desc"},"filters":{"last_years":5,"open_access":true}}]'
smoke_set_fake_semantic_scholar_fixture "composite" "Composite Paper"

smoke_run_expect "natural_composite_execute_and_verify_artifacts.exp" "$RUN_ID"
smoke_verify_collect_artifacts "$RUN_DIR" "$(smoke_bib_key_for_prefix "composite")" "3" "" "" "composite"
