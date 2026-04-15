#!/usr/bin/env bash

SMOKE_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SMOKE_VALIDATION_ROOT="${AUTOLABOS_VALIDATION_WORKSPACE_ROOT:-$(cd "${SMOKE_ROOT_DIR}/.." && pwd)/.autolabos-validation}"
SMOKE_WORK_DIR="${SMOKE_VALIDATION_ROOT}/smoke-workspace"
SMOKE_DEFAULT_RUN_ID="9727e56e-19bc-46bb-bf5c-88d3be06af0d"
readonly SMOKE_SCENARIO_ORDER=(
  pending
  execute
  composite
  composite-all
  llm-composite
  llm-composite-all
  llm-replan
)
readonly SMOKE_SCENARIO_SCRIPTS=(
  run_natural_collect_pending_command.sh
  run_natural_collect_execute_and_verify_artifacts.sh
  run_natural_composite_execute_and_verify_artifacts.sh
  run_natural_composite_run_all_execute_and_verify_artifacts.sh
  run_natural_llm_composite_execute_and_verify_artifacts.sh
  run_natural_llm_composite_run_all_execute_and_verify_artifacts.sh
  run_natural_llm_replan_after_failure.sh
)

smoke_require_expect() {
  if ! command -v expect >/dev/null 2>&1; then
    echo "FAIL: expect is required for PTY smoke tests"
    exit 1
  fi
}

smoke_has_expect() {
  command -v expect >/dev/null 2>&1
}

smoke_prepare_workspace() {
  rm -rf "$SMOKE_WORK_DIR/.autolabos"
  mkdir -p "$SMOKE_WORK_DIR/.autolabos/runs" "$SMOKE_WORK_DIR/.autolabos/logs"

  cat > "$SMOKE_WORK_DIR/.autolabos/config.yaml" <<'YAML'
version: 1
project_name: test
providers:
  llm_mode: codex_chatgpt_only
  codex:
    model: gpt-5.4
    reasoning_effort: xhigh
    auth_required: true
    fast_mode: false
  openai:
    model: gpt-5.4
    reasoning_effort: medium
    api_key_required: true
analysis:
  responses_model: gpt-5.4
papers:
  max_results: 200
  per_second_limit: 1
research:
  default_topic: Multi-agent collaboration
  default_constraints:
    - recent papers
    - last 5 years
  default_objective_metric: state-of-the-art reproducibility
workflow:
  mode: agent_approval
  wizard_enabled: true
  approval_mode: manual
experiments:
  runner: local_python
  timeout_sec: 3600
  allow_network: false
paper:
  template: acl
  build_pdf: true
  latex_engine: auto_install
paths:
  runs_dir: .autolabos/runs
  logs_dir: .autolabos/logs
YAML

  node - "$SMOKE_WORK_DIR" "$SMOKE_DEFAULT_RUN_ID" <<'NODE'
const fs = require("fs");
const path = require("path");

const [workDir, runId] = process.argv.slice(2);
const now = new Date().toISOString();
const runRoot = path.join(workDir, ".autolabos", "runs", runId);
const graphNodeIds = [
  "collect_papers",
  "analyze_papers",
  "generate_hypotheses",
  "design_experiments",
  "implement_experiments",
  "run_experiments",
  "analyze_results",
  "review",
  "write_paper"
];

const nodeStates = Object.fromEntries(
  graphNodeIds.map((id) => [id, { status: "pending", updatedAt: now }])
);

const runsFile = {
  version: 3,
  runs: [
    {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "AI agent automation",
      topic: "AI agent automation",
      constraints: ["recent papers", "last 5 years"],
      objectiveMetric: "state-of-the-art reproducibility",
      status: "pending",
      currentNode: "collect_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: now,
      updatedAt: now,
      graph: {
        currentNode: "collect_papers",
        nodeStates,
        retryCounters: {},
        rollbackCounters: {},
        checkpointSeq: 0,
        retryPolicy: {
          maxAttemptsPerNode: 3,
          maxAutoRollbacksPerNode: 2
        }
      },
      memoryRefs: {
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    }
  ]
};

fs.mkdirSync(path.join(workDir, ".autolabos", "runs"), { recursive: true });
fs.writeFileSync(
  path.join(workDir, ".autolabos", "runs", "runs.json"),
  JSON.stringify(runsFile, null, 2) + "\n",
  "utf8"
);

for (const dir of [
  runRoot,
  path.join(runRoot, "checkpoints"),
  path.join(runRoot, "memory"),
  path.join(runRoot, "patches"),
  path.join(runRoot, "exec_logs"),
  path.join(runRoot, "figures"),
  path.join(runRoot, "paper")
]) {
  fs.mkdirSync(dir, { recursive: true });
}

fs.writeFileSync(
  path.join(runRoot, "memory", "run_context.json"),
  JSON.stringify({ version: 1, items: [] }, null, 2) + "\n",
  "utf8"
);
fs.writeFileSync(path.join(runRoot, "memory", "long_term.jsonl"), "", "utf8");
fs.writeFileSync(path.join(runRoot, "memory", "episodes.jsonl"), "", "utf8");
NODE
}

smoke_run_id() {
  smoke_prepare_workspace
  node -e '
    const fs = require("fs");
    const path = require("path");
    const file = path.join(process.argv[1], ".autolabos", "runs", "runs.json");
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw);
      const first = Array.isArray(parsed.runs) && parsed.runs.length > 0 ? parsed.runs[0] : undefined;
      process.stdout.write((first && first.id) ? String(first.id) : "smoke-run-id");
    } catch {
      process.stdout.write("smoke-run-id");
    }
  ' "$SMOKE_WORK_DIR"
}

smoke_run_dir() {
  local run_id="$1"
  printf '%s/.autolabos/runs/%s\n' "$SMOKE_WORK_DIR" "$run_id"
}

smoke_reset_collect_artifacts() {
  local run_dir="$1"
  rm -f \
    "$run_dir/corpus.jsonl" \
    "$run_dir/bibtex.bib" \
    "$run_dir/collect_request.json" \
    "$run_dir/collect_result.json"
}

smoke_run_expect() {
  local exp_name="$1"
  local run_id="$2"
  expect "$SMOKE_ROOT_DIR/tests/smoke/$exp_name" "$SMOKE_WORK_DIR" "$run_id"
}

smoke_run_pending_without_expect() {
  local run_id="$1"
  python3 "$SMOKE_ROOT_DIR/tests/smoke/pending_smoke_without_expect.py" "$SMOKE_WORK_DIR" "$run_id"
}

smoke_bib_key_for_prefix() {
  local prefix="$1"
  printf '%s1' "${prefix//[^[:alnum:]]/}"
}

smoke_set_fake_codex_single_command() {
  local run_id="$1"
  local reply_line="$2"
  local command="$3"
  export AUTOLABOS_FAKE_CODEX_RESPONSE
  AUTOLABOS_FAKE_CODEX_RESPONSE="$(node -e '
    const [replyLine, runId, command] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      reply_lines: [replyLine],
      target_run_id: runId,
      recommended_command: command,
      should_offer_execute: true
    }));
  ' "$reply_line" "$run_id" "$command")"
  unset AUTOLABOS_FAKE_CODEX_RESPONSE_SEQUENCE || true
}

smoke_set_fake_codex_structured_actions() {
  local run_id="$1"
  local actions_json="$2"
  export AUTOLABOS_FAKE_CODEX_RESPONSE
  AUTOLABOS_FAKE_CODEX_RESPONSE="$(node -e '
    const [runId, actionsJson] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      target_run_id: runId,
      actions: JSON.parse(actionsJson)
    }));
  ' "$run_id" "$actions_json")"
  unset AUTOLABOS_FAKE_CODEX_RESPONSE_SEQUENCE || true
}

smoke_set_fake_codex_multi_step_plan() {
  local run_id="$1"
  local reply_line="$2"
  shift 2
  export AUTOLABOS_FAKE_CODEX_RESPONSE
  AUTOLABOS_FAKE_CODEX_RESPONSE="$(node -e '
    const [replyLine, runId, ...commands] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      reply_lines: [replyLine],
      target_run_id: runId,
      recommended_commands: commands,
      should_offer_execute: true
    }));
  ' "$reply_line" "$run_id" "$@")"
  unset AUTOLABOS_FAKE_CODEX_RESPONSE_SEQUENCE || true
}

smoke_set_fake_codex_two_turn_replan() {
  local run_id="$1"
  local initial_reply="$2"
  local first_step_or_actions="$3"
  local second_command="$4"
  local retry_reply="$5"
  local retry_command="$6"
  export AUTOLABOS_FAKE_CODEX_RESPONSE_SEQUENCE
  AUTOLABOS_FAKE_CODEX_RESPONSE_SEQUENCE="$(node -e '
    const [runId, initialReply, firstStepOrActions, secondCommand, retryReply, retryCommand] = process.argv.slice(1);
    const firstPayload = firstStepOrActions.trim().startsWith("[")
      ? {
          target_run_id: runId,
          actions: JSON.parse(firstStepOrActions)
        }
      : {
          reply_lines: [initialReply],
          target_run_id: runId,
          recommended_commands: [firstStepOrActions, secondCommand],
          should_offer_execute: true
        };
    process.stdout.write(JSON.stringify([
      firstPayload,
      {
        reply_lines: [retryReply],
        target_run_id: runId,
        recommended_command: retryCommand,
        should_offer_execute: true
      }
    ]));
  ' "$run_id" "$initial_reply" "$first_step_or_actions" "$second_command" "$retry_reply" "$retry_command")"
  unset AUTOLABOS_FAKE_CODEX_RESPONSE || true
}

smoke_set_fake_semantic_scholar_fixture() {
  local prefix="$1"
  local title_prefix="$2"
  export AUTOLABOS_FAKE_SEMANTIC_SCHOLAR_RESPONSE
  AUTOLABOS_FAKE_SEMANTIC_SCHOLAR_RESPONSE="$(node -e '
    const [prefix, titlePrefix] = process.argv.slice(1);
    const bibKey = `${prefix.replace(/[^a-z0-9]/gi, "")}1`;
    const papers = [
      {
        paperId: `${prefix}-1`,
        title: `${titlePrefix} One`,
        abstract: "A",
        year: 2025,
        venue: "NeurIPS",
        url: `https://example.org/${prefix}1`,
        authors: ["Alice"],
        externalIds: { DOI: `10.1000/${prefix}1` },
        citationStyles: {
          bibtex: `@article{${bibKey},\n  title = {${titlePrefix} One}\n}`
        }
      },
      {
        paperId: `${prefix}-2`,
        title: `${titlePrefix} Two`,
        abstract: "B",
        year: 2024,
        venue: "ICLR",
        url: `https://example.org/${prefix}2`,
        authors: ["Bob"],
        externalIds: { ArXiv: "2501.00002" }
      },
      {
        paperId: `${prefix}-3`,
        title: `${titlePrefix} Three`,
        abstract: "C",
        year: 2023,
        venue: "ACL",
        url: `https://example.org/${prefix}3`,
        authors: ["Carol"]
      }
    ];
    process.stdout.write(JSON.stringify(papers));
  ' "$prefix" "$title_prefix")"
}

smoke_known_modes() {
  printf '%s' "${SMOKE_SCENARIO_ORDER[*]}"
}

smoke_has_mode() {
  local mode="$1"
  local known_mode
  for known_mode in "${SMOKE_SCENARIO_ORDER[@]}"; do
    if [[ "$known_mode" == "$mode" ]]; then
      return 0
    fi
  done
  return 1
}

smoke_script_for_mode() {
  local mode="$1"
  local index=0
  local known_mode
  for known_mode in "${SMOKE_SCENARIO_ORDER[@]}"; do
    if [[ "$known_mode" == "$mode" ]]; then
      printf '%s' "${SMOKE_SCENARIO_SCRIPTS[$index]}"
      return 0
    fi
    index=$((index + 1))
  done
  return 1
}

smoke_run_mode() {
  local mode="$1"
  local script_name
  if ! smoke_has_mode "$mode"; then
    echo "FAIL: unknown smoke mode '$mode'"
    exit 1
  fi
  script_name="$(smoke_script_for_mode "$mode")"
  bash "$SMOKE_ROOT_DIR/tests/smoke/$script_name"
}

smoke_run_all_modes() {
  local mode
  for mode in "${SMOKE_SCENARIO_ORDER[@]}"; do
    smoke_run_mode "$mode"
  done
}

smoke_verify_collect_artifacts() {
  local run_dir="$1"
  local bib_key="$2"
  local minimum_rows="${3:-3}"
  local require_open_access="${4:-}"
  local expected_limit="${5:-}"
  local label="${6:-collect}"

  node -e '
    const fs = require("fs");
    const path = require("path");

    const [runDir, bibKey, minimumRowsRaw, requireOpenAccessRaw, expectedLimitRaw, label] = process.argv.slice(1);
    const minimumRows = Number(minimumRowsRaw || "3");
    const required = ["corpus.jsonl", "bibtex.bib", "collect_request.json", "collect_result.json"];

    for (const rel of required) {
      const full = path.join(runDir, rel);
      if (!fs.existsSync(full)) {
        console.error(`FAIL: missing artifact ${rel}`);
        process.exit(1);
      }
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size <= 0) {
        console.error(`FAIL: empty artifact ${rel}`);
        process.exit(1);
      }
    }

    const corpus = fs.readFileSync(path.join(runDir, "corpus.jsonl"), "utf8").trim().split(/\n+/).filter(Boolean);
    if (corpus.length < minimumRows) {
      console.error(`FAIL: corpus has too few rows (${corpus.length})`);
      process.exit(1);
    }

    const result = JSON.parse(fs.readFileSync(path.join(runDir, "collect_result.json"), "utf8"));
    if (typeof result.fetched !== "number" || result.fetched < minimumRows) {
      console.error(`FAIL: collect_result fetched invalid (${result.fetched})`);
      process.exit(1);
    }

    const request = JSON.parse(fs.readFileSync(path.join(runDir, "collect_request.json"), "utf8"));
    if (requireOpenAccessRaw === "true" && (!request.filters || request.filters.openAccessPdf !== true)) {
      console.error("FAIL: collect request missing open-access filter");
      process.exit(1);
    }

    if (expectedLimitRaw) {
      const expectedLimit = Number(expectedLimitRaw);
      if (!Number.isFinite(expectedLimit) || request.limit !== expectedLimit) {
        console.error(`FAIL: expected limit ${expectedLimit}, got ${request.limit}`);
        process.exit(1);
      }
    }

    const bib = fs.readFileSync(path.join(runDir, "bibtex.bib"), "utf8");
    if (bibKey && !bib.includes(`@article{${bibKey}`)) {
      console.error(`FAIL: bibtex missing expected entry ${bibKey}`);
      process.exit(1);
    }

    console.log(`PASS: ${label} artifacts verified for run ${path.basename(runDir)}`);
  ' "$run_dir" "$bib_key" "$minimum_rows" "$require_open_access" "$expected_limit" "$label"
}
