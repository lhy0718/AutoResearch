# ISSUES.md

Last updated: 2026-04-24

This file was compacted on 2026-03-22 to remove duplicated template fragments, malformed partial entries, and conflicting reused LV identifiers. Detailed pre-cleanup prose remains in git history.

Usage rules:
- `ISSUES.md` is for reproduced live-validation defects and tracked research/paper-readiness risks.
- `TODO.md` is for forward-looking follow-ups, proposal-only work, and backlog items.
- Canonical workflow and policy still live in `AGENTS.md` and `docs/`.

---

## Current active status

- Active live-validation defects:
  - `LV-108` `run_experiments` can complete after writing failed private metrics while stale public study artifacts still show completed baseline/comparator rows.
  - `LV-098` IEEE staging `pdf_url` rows cache HTML instead of PDF, so `analyze_papers` cannot preserve supplemental page images on abstract fallback for those papers.
- Active research/paper-readiness watchlist: see `Research and paper-readiness watchlist` below.
- Current watchlist snapshot:
  - `R-001` Result-table discipline and claim→evidence linkage — `MITIGATED`
  - `R-002` Scientific gate warnings surfacing — `MITIGATED`
  - `R-003` System-validation paper shape over-promotion — `MITIGATED`
  - `P-001` Baseline/comparator packaging — `MITIGATED`
  - `P-002` Compact quantitative result packaging — `MITIGATED`
  - `P-003` Related-work depth signaling — `MITIGATED`
- If a new runtime/UI defect is reproduced, add it under `Active live validation issues` with a fresh `LV-*` identifier and one dominant root-cause class.

---

## Active live validation issues

## Issue: LV-108

- Status: active
- Validation target: real backtrack flow for persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after LV-107 live revalidation
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - nodes reached after LV-107 guard: `implement_experiments -> run_experiments -> analyze_results`
  - backend: native Codex OAuth backend, not CLI subprocess fallback

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow implementation attempt 1 to fail pre-handoff on the argparse/run-command verifier.
  4. Allow implementation attempt 2 to complete and hand off to `run_experiments`.
  5. Inspect `.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`.
  6. Inspect `outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/study_results.json`.
  7. Inspect `outputs/identify-which-lightweight-parameter-efficient-i-73050f85/analysis/transition_recommendation.json`.

- Expected behavior:
  - `run_experiments` should fail or backtrack when every private metrics recipe fails before any baseline/comparator result is produced.
  - Public experiment artifacts should not retain stale successful rows that disagree with the private `metrics.json` used by `analyze_results`.
  - `analyze_results` should receive one coherent results surface, not failed private metrics plus stale public success artifacts.

- Actual behavior:
  - `run_experiments` completed after executing a compatible command:
    - `python .../run_peft_instruction_study.py --model-name Qwen/Qwen2.5-1.5B --instruction-dataset yahma/alpaca-cleaned --recipes baseline,lora,rslora,adalora --max-steps 64 --per-device-train-batch-size 1 --gradient-accumulation-steps 16 --metrics-path .../metrics.json`
  - Private `.autolabos/runs/.../metrics.json` recorded `completed_recipe_count: 0`, `failed_recipe_count: 4`, and per-recipe errors:
    - `TypeError: RecipeSpec.__init__() missing 3 required positional arguments: 'name', 'use_peft', and 'description'`
  - Private `device_info.study_peak_gpu_memory_gb` remained `0`, so the objective metric gate failed.
  - Public `study_results.json` still contained completed baseline and comparator rows with non-null accuracies and GPU memory values from a different/stale result schema.
  - `analyze_results` paused with `reason: "incomplete_results_table"` based on the failed private metrics.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in the newly launched rebuilt TUI process.
  - Existing session: persisted artifacts show the same private/public disagreement.
  - Divergence: no UI-only divergence; the defect is artifact/state consistency across private run metrics and public experiment outputs.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the run accepts process exit code 0 and a written metrics file as successful execution even when all recipe rows failed structurally. Public experiment artifacts are not cleared or atomically regenerated for the new execution, so stale successful artifacts can survive beside failed private metrics.

- Code/test changes:
  - Code: pending
  - Tests: pending

- Regression status:
  - Automated regression test linked: pending
  - Targeted tests: pending
  - Build: pending
  - Harness: pending
  - Same-flow live revalidation: pending
  - Adjacent regression review: pending

- Most likely failing boundary:
  - `run_experiments` success criteria and artifact consistency checks around private `metrics.json` vs public experiment artifacts.
  - Generated `run_peft_instruction_study.py` recipe construction / `RecipeSpec` compatibility in the implementation node.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/study_results.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/analysis/result_analysis.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/analysis/transition_recommendation.json`

---

## Resolved live validation issues

The resolved entries below are kept as recent validation history and regression context.

## Issue: LV-107

- Status: resolved
- Validation target: real backtrack flow for persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - nodes reached after LV-106 fix: `analyze_results -> design_experiments -> implement_experiments -> run_experiments`
  - backend: native Codex OAuth backend, not CLI subprocess fallback

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry analyze_results 73050f85-6b56-4385-8c31-2ec69a5b7dec` to apply the governed `backtrack_to_design` transition.
  3. Use `/retry` at `design_experiments`.
  4. Allow `design_experiments` to complete and auto-handoff into `implement_experiments`.
  5. Allow `implement_experiments` to complete and auto-handoff into `run_experiments`.

- Expected behavior:
  - Before auto-handoff, implementation verification should ensure the generated runner accepts the exact `run_command` flags that `run_experiments` will execute.
  - If `run_command` uses flags such as `--output-dir` or `--max-eval-examples`, the generated Python argparse surface should accept them or implementation verification should fail with `next_action: retry_patch`.
  - `run_experiments` should not be the first place that discovers a trivial CLI contract mismatch.

- Actual behavior:
  - `implement_experiments` completed after `python -m py_compile` passed and auto-approved the handoff.
  - The generated script accepted `--metrics-path` and `--public-dir`, but not `--output-dir` or `--max-eval-examples`.
  - The persisted implementation `run_command` still included `--output-dir ... --max-eval-examples 500`.
  - `run_experiments` failed immediately with argparse:
    - `run_peft_instruction_study.py: error: unrecognized arguments: --output-dir ... --max-eval-examples 500`

- Fresh vs existing session comparison:
  - Fresh session: reproduced in a newly launched TUI process after rebuilding `dist`.
  - Existing session: the failure is visible in the persisted run artifacts and `events.jsonl`.
  - Divergence: no fresh-vs-existing UI divergence; the defect is a persisted implementation handoff contract issue.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `implement_experiments` persists and trusts the LLM-returned `run_command` after only lightweight syntax verification. The verifier does not compare the returned command flags against the generated Python argparse surface, so a stale or incompatible command can be persisted and handed to `run_experiments`.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - added pre-handoff detection for Python argparse surfaces where `run_command` passes long-form flags that the generated runner does not accept
      - blocks auto-handoff with `failure_type: "implementation"` and `next_action: "retry_patch"` instead of letting `run_experiments` discover the CLI mismatch
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - added coverage that a generated Python runner missing `--output-dir` / `--max-eval-examples` support does not auto-handoff to `run_experiments`

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "argparse mismatch|parse_args helper"` passed; `npx vitest run tests/implementSessionManager.test.ts` passed
  - Build: `npm run build` passed
  - Broad tests: `npm test` passed
  - Harness: `npm run validate:harness` passed after adding this entry
  - Same-flow live revalidation: passed on 2026-04-24 in the real `.autolabos-validation` TUI flow
  - Live evidence:
    - `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` entered native Codex OAuth `staged_llm` mode with runner feedback from the prior argparse failure
    - implementation attempt 1 generated a runner whose `run_command` passed unsupported argparse flags
    - the new verifier blocked auto-handoff with `verify_report.json` status `fail`, `failure_type: "implementation"`, `next_action: "retry_patch"`, and `stderr_excerpt: "run_command passes unsupported Python argparse flag(s): --max-train-examples..."`
    - the TUI restored 57 paths and started implementation attempt 2 instead of handing the incompatible command to `run_experiments`
    - attempt 2 produced a compatible command and `run_experiments` executed it without the prior `--output-dir` / `--max-eval-examples` argparse failure
  - Adjacent regression review: broad implementation-session and full test suites passed; same-flow live retry confirmed the guarded backtrack path

- Most likely failing boundary:
  - Python runner handoff verification in `src/core/agents/implementSessionManager.ts`.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_panel/triage.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/experiment_governance/implementation_context.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

---

## Issue: LV-106

- Status: resolved
- Validation target: same persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after successful `run_experiments` retry and automatic `analyze_results`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - nodes reached: `run_experiments -> analyze_results`
  - existing TUI session, resumed from the persisted run after prior implementation repairs

- Reproduction steps:
  1. In the existing real TUI session, run `/agent retry run_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  2. Wait for the node-owned PEFT runner to complete.
  3. Inspect `.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`.
  4. Inspect `outputs/identify-which-lightweight-parameter-efficient-i-73050f85/analysis/result_table.json`.
  5. Inspect `.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/transition_recommendation.json`.

- Expected behavior:
  - When `metrics.json` contains an executed baseline row and executed comparator rows under `results`, `analyze_results` should project those rows into `condition_comparisons` / `results_table`.
  - The negative scientific result should remain visible as `accuracy_delta_vs_baseline=0`.
  - The transition should be driven by the objective/evidence gate, for example a design backtrack, not by a false `incomplete_results_table` pause.

- Actual behavior:
  - `run_experiments_verify_report.json` records `status: "pass"` and the fresh metrics contract is present.
  - `metrics.json` contains:
    - baseline row with `recipe: "baseline"` and `mean_accuracy: 0.546875`
    - comparator rows `lora_qv_r8` and `lora_qkvo_r16`
    - top-level `best_recipe: "lora_qv_r8"`
    - top-level `accuracy_delta_vs_baseline: 0`
    - bootstrap confidence intervals in each executed result row
  - `analysis/result_table.json` collapses the run to a single `primary` condition and leaves `comparisons: []`.
  - `transition_recommendation.json` records:
    - `action: "pause_for_human"`
    - `reason: "incomplete_results_table"`
    - evidence lines with `baseline=null, comparator=null`
  - `analyze_results_panel/inputs.json` simultaneously shows the underlying baseline recommendation was `backtrack_to_design`, so the false table incompleteness is overriding the governed backtrack.
  - Fixed behavior verified on 2026-04-24:
    - the same persisted TUI run was relaunched with the rebuilt runtime
    - `/agent retry analyze_results 73050f85-6b56-4385-8c31-2ec69a5b7dec` reran the real node
    - `result_analysis.json` now contains `condition_comparisons[0].source: "metrics.results"`
    - `result_analysis.json` now contains a structured `results_table` row with `metric: "mean_accuracy"`, `baseline: 0.546875`, and `comparator: 0.546875`
    - `transition_recommendation.json` now records `action: "backtrack_to_design"` / `targetNode: "design_experiments"` rather than `pause_for_human` / `incomplete_results_table`
    - the TUI applied `backtrack_to_design -> design_experiments` and paused before rerunning `design_experiments` because execution had started from `analyze_results`

- Fresh vs existing session comparison:
  - Fresh session: a new TUI process was launched in the same external validation workspace after rebuilding `dist`.
  - Existing session: reproduced in the prior real persisted TUI session and confirmed through run-scoped plus public analysis artifacts.
  - Divergence: the old process replayed the stale pause; the freshly launched rebuilt process reran `analyze_results` and cleared the false incomplete-table transition.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: `buildConditionComparisons` only promotes `metrics.comparison` and `metrics.condition_metrics`. The current node-owned PEFT runner writes executed conditions under `metrics.results`, so `buildStructuredResultsTable` falls back to the contract schema and reports null baseline/comparator values even though the executed rows are present.

- Code/test changes:
  - Code:
    - `src/core/resultAnalysis.ts`
      - added projection from node-owned `metrics.results` arrays into `condition_comparisons` when explicit `baseline` and `best_recipe` rows are present
      - preserves negative objective outcomes while allowing the structured results table to carry baseline/comparator values
  - Tests:
    - `tests/resultAnalysis.test.ts`
      - added coverage for projecting `metrics.results` baseline/comparator rows into `condition_comparisons`
    - `tests/objectiveMetricPropagation.test.ts`
      - added coverage that `analyze_results` no longer pauses with `incomplete_results_table` when `metrics.results` contains baseline and best comparator rows

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: `npx vitest run tests/resultAnalysis.test.ts tests/resultTable.test.ts tests/objectiveMetricPropagation.test.ts` passed
  - Build: `npm run build` passed
  - Same-flow live revalidation: passed
  - Adjacent regression review: targeted result-table and objective-propagation tests passed; broad `npm test` and `npm run validate:harness` passed after this `ISSUES.md` update

- Most likely failing boundary:
  - resolved; the remaining active workflow state is the governed scientific backtrack to `design_experiments` after a real negative result.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/analyze_results_panel/inputs.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/transition_recommendation.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/result_analysis.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/analysis/result_table.json`

---

## Issue: LV-105

- Status: resolved
- Validation target: same persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after removing `allow_network` as a runtime execution gate and rerunning `run_experiments`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - nodes reached: `run_experiments -> analyze_results`

- Reproduction steps:
  1. Relaunch the real TUI in `.autolabos-validation`.
  2. Run `/agent retry run_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Wait for the PEFT runner to complete after public Hugging Face model/dataset bootstrap.
  4. Inspect `run_record.json`, `metrics.json`, `run_experiments_verify_report.json`, and `events.jsonl`.

- Expected behavior:
  - If the experiment command exits `0` but `metrics.json` reports failed tuned conditions, missing objective metrics, or an incomplete baseline/comparator table, `run_experiments` should not present the run as a clean pass.
  - The verifier should classify the result as incomplete/degraded and keep the workflow from treating execution success as experiment adequacy.

- Actual behavior:
  - Original failing behavior: the same-flow retry ran for about 306 seconds and completed the public PEFT runner after Hugging Face bootstrap.
  - `run_experiments_verify_report.json` records:
    - `status: "pass"`
    - `stage: "success"`
    - `exit_code: 0`
  - However, `metrics.json` shows:
    - baseline evaluation succeeded with ARC-Challenge/HellaSwag raw accuracies
    - `successful_tuned_condition_count: 0`
    - `failed_condition_count: 3`
    - `all_conditions_succeeded: false`
    - primary metric values such as `baseline_value`, `best_tuned_value`, and `best_tuned_delta_vs_baseline` are `null`
  - `analyze_results` then pauses with:
    - `Objective metric "accuracy_delta_vs_baseline" was not found in metrics.json.`
    - `Results table is incomplete: baseline and comparator must both be populated for every reported row.`
  - Fixed behavior verified on 2026-04-23:
    - the same persisted TUI retry reran `run_experiments`
    - the PEFT command still produced incomplete comparator metrics
    - `run_experiments` emitted `TEST_FAILED`
    - `run_experiments_verify_report.json` now records:
      - `status: "fail"`
      - `stage: "metrics"`
      - `summary: Experiment metrics contract failed: Objective metric "accuracy_delta_vs_baseline" was not found in metrics.json. Study aggregate reports incomplete execution (1 completed, 3 failed). No tuned comparator condition completed successfully. ...`
  - Follow-up live behavior verified on 2026-04-24 after the `implement_experiments` repair completed:
    - targeted `/agent retry run_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` launched the generated runner again
    - the command completed and wrote a fresh `metrics.json`
    - `run_experiments_verify_report.json` records `status: "pass"` / `stage: "success"` because the runner now emits the required metrics contract fields and exits `0`
    - `metrics.json` includes numeric `accuracy_delta_vs_baseline`, `baseline_mean_accuracy`, `best_mean_accuracy`, per-condition accuracy rows, bootstrap CIs, GPU memory, and trainable-parameter counts
    - the scientific result is still negative: `accuracy_delta_vs_baseline=0`, so `analyze_results` correctly pauses with `Objective metric not met: accuracy_delta_vs_baseline=0 does not satisfy >= 0.01.`
    - this is no longer the LV-105 verifier defect; it is an honest experimental non-improvement result that should be handled by analysis/review, not hidden as a system failure.

- Fresh vs existing session comparison:
  - Fresh session: not separately rerun for this post-network-gate semantic boundary.
  - Existing session: reproduced directly on the same persisted run after the network-policy fix, then revalidated after the verifier fix.
  - Divergence: none established; the failing boundary was in persisted run-verifier semantics rather than stale UI state.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `run_experiments` is currently treating process exit code and metrics-file materialization as sufficient for verifier pass, without enforcing the metrics contract that tuned comparator conditions and the configured objective metric must be present for a baseline/comparator experiment.

- Code/test changes:
  - Code:
    - `src/core/nodes/runExperiments.ts`
      - added post-command metrics-contract validation after `objective_evaluation.json` is written
      - fails verifier reports when the configured objective metric is missing
      - fails baseline-first comparator runs when primary study aggregate reports incomplete execution, no successful tuned comparator, or non-numeric baseline/comparator/delta aggregate values
  - Tests:
    - `tests/runExperimentsExecutionProfile.test.ts`
      - added regression coverage for a command that exits `0` but writes incomplete comparator metrics

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: `npx vitest run tests/runExperimentsExecutionProfile.test.ts tests/objectiveMetricPropagation.test.ts` passed
  - Broad validation: `npm run build`, `npm test`, and `npm run validate:harness` passed
  - Same-flow live revalidation: confirmed
  - Latest state: same persisted retry now marks `run_experiments_verify_report.json` as `status: "fail"` / `stage: "metrics"` instead of `pass`.
  - Latest post-implementation same-flow retry: `run_experiments` completes with a metrics-contract pass, and `analyze_results` pauses on the scientific outcome because the objective threshold was not met.

- Most likely failing boundary:
  - resolved; the remaining boundary is research adequacy/objective-outcome interpretation in `analyze_results`, not `run_experiments` verifier semantics

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/exec_logs/run_experiments.txt`

- Recommended next step:
  - Treat the current `accuracy_delta_vs_baseline=0` as a real negative result unless a governed backtrack explicitly revises the experiment design or implementation; do not claim the target improvement was achieved.

## Issue: LV-103

- Status: resolved
- Validation target: existing external-workspace TUI same-flow `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` after removing heuristic decomposition/materialization/subdivision fallbacks and then tightening staged materialization/bootstrap guards
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`

- Reproduction steps:
  1. Remove heuristic `implement_experiments` fallback projection/chunking paths so staged LLM decomposition, materialization planning, and subdivision planning all require parseable provider plans.
  2. Run `npm run build`, `npm test`, and `npm run validate:harness`.
  3. Relaunch the real TUI in `.autolabos-validation`, reopen the failed run, and issue `/retry`.
  4. Inspect `implement_experiments/status.json` and `implement_experiments/progress.jsonl`.

- Expected behavior:
  - The same-flow retry should localize the real runner file, materialize substantive Python rather than placeholder skeleton text, and continue through staged scaffold/bootstrap/decomposition/materialization without provider-side aborts.
  - If the provider cannot supply a valid scaffold or chunk, the run should fail narrowly and honestly rather than reusing heuristic projections or recovering comment-only public bundles.

- Actual behavior:
  - The heuristic projection path is gone and the localizer now correctly focuses the true failing runner:
    - `outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`
  - Additional repo-side guards are now in place:
    - placeholder/comment-only staged chunk responses are rejected instead of being accepted as materialized Python
    - comment-only public bundles are no longer recoverable as valid implement results
    - staged scaffold and bootstrap prompts were compacted to reduce provider payload size
  - Live retries still fail at the Codex OAuth boundary before a runnable repair is produced:
    - retry at `2026-04-23T08:04:36Z` progressed past scaffold planning, then failed during bootstrap with:
      - `Implementation execution failed before any runnable implementation was produced: Codex OAuth backend returned an error ... request ID 7eb2608e-9fbc-4ab7-a0f9-2a04dba5b13a`
    - retry at `2026-04-23T08:09:15Z` failed even earlier at scaffold with:
      - `Implementation execution failed before any runnable implementation was produced: Codex OAuth backend returned an error ... request ID 6a75ce32-9ad4-41ac-8289-c530477e510c`
    - earlier same-day retries also showed:
      - provider abort after bootstrap wait: `This operation was aborted`
      - provider error after chunk subdivision wait: request ID `9e317b4c-a0e8-4c47-b940-e25beebd8f32`
    - latest live retry at `2026-04-23T09:12:18Z` confirmed the new prompt-artifact instrumentation works:
      - `implement_experiments/scaffold_prompt.txt` is written before the first scaffold request
      - `implement_experiments/scaffold_raw_response.txt` is written once scaffold planning completes
      - `implement_experiments/bootstrap_contract_prompt.txt` is written before the bootstrap request
      - the same run then advances to bootstrap and stalls again with:
        - `threadId: "resp_01a31167d1197b170169e9e27346308191bee3b4f775c77621"`
        - `status: "running"`
        - `message: "Still waiting on staged_llm provider output; no new provider progress for 119s."`
    - latest live retry at `2026-04-23T12:54:56Z` confirmed the additional prompt-compaction patch reached the live run:
      - `implement_experiments/scaffold_prompt.txt` shrank from `17781` bytes to `11984` bytes while `bootstrap_contract_prompt.txt` remained `8392` bytes
      - scaffold again completed after two heartbeat waits and progressed into bootstrap with:
        - `threadId: "resp_03bc692ebc4ffb2e0169ea16a1c9d48191934016106e50a3d7"`
      - bootstrap then reproduced the same no-text-delta wait pattern through at least:
        - `59s`
        - `119s`
        - `179s`
        - `240s`
        - `300s`
      - that retry eventually emitted streamed output after `360s` and then failed with:
        - `Implementation execution failed before any runnable implementation was produced: staged_llm bootstrap planning did not return a parseable bootstrap contract`
    - latest live retry at `2026-04-23T14:17:58Z` confirmed the bootstrap-specific compaction patch reached the live run:
      - `implement_experiments/bootstrap_contract_prompt.txt` shrank further from `8392` bytes to `6234` bytes
      - `implement_experiments/scaffold_prompt.txt` remained about `12KB` (`11987` bytes)
      - scaffold now completed after a single `59s` heartbeat and advanced into bootstrap with:
        - `threadId: "resp_0542f1f5a665db340169ea2a16ab4481919401ec38452679f2"`
      - bootstrap planning then completed successfully enough to write a parseable raw contract artifact:
        - `implement_experiments/bootstrap_contract_raw_response.txt` (`8762` bytes)
      - the run progressed past bootstrap and deep into staged materialization:
        - the public runner file expanded from the 44-line skeleton placeholder to `1923` lines
        - chunk generation advanced through dataset caching, evaluation helpers, and baseline-first PEFT execution decomposition
      - the remaining failure boundary shifted later in the flow:
        - `resp_086a26e641d247890169ea356b56688191bbd401ba9dbf6b32` timed out after `540s` with no text delta for the aggregate-metrics execution chunk
        - staged resubdivision succeeded and launched `resp_0fbed7ef14f965550169ea39b0a9e881918e4dca403d0f22ab`
        - the live attempt ultimately ended with:
          - `Implementation execution failed before any runnable implementation was produced: terminated`
    - latest live retry at `2026-04-23T22:05:40Z` confirmed late materialization artifact instrumentation reached the real flow:
      - the run again localized the same runner and passed scaffold, bootstrap, decomposition repair, materialization planning, and chunk subdivision planning
      - new per-chunk prompt artifacts appeared under `implement_experiments/unit_chunk_prompts`
      - new per-chunk raw response artifacts appeared under `implement_experiments/unit_chunk_responses`
      - observed live artifacts included:
        - `peft_runner__runner_core_setup__d0__chunk_1_2_subchunk_1_3.txt` prompt (`12910` bytes) and response (`15955` bytes)
        - `peft_runner__runner_core_data__d0__chunk_1_2_subchunk_2_3.txt` prompt (`13973` bytes) and response (`17838` bytes)
        - `peft_runner__runner_core_eval__d0__chunk_1_2_subchunk_3_3.txt` prompt (`14128` bytes) and response (`17442` bytes)
        - `peft_runner__runner_baseline_and_recipe_execution__d0__chunk_2_2_subchunk_1_3.txt` prompt and response (`38081` bytes)
        - `peft_runner__runner_result_aggregation_and_persistence__d0__chunk_2_2_subchunk_2_3.txt` prompt while no matching final response was produced
      - the public runner grew to `2333` lines before failure
      - the failing request waited through `59s`, `120s`, and `180s` heartbeat observations and then ended with:
        - `Implementation execution failed before any runnable implementation was produced: terminated`
      - a `runner_result_aggregation_and_persistence` `_partial_on_error` artifact was emitted, but it matched the previous successful response size (`38081` bytes), indicating the global partial snapshot can be stale across chunk requests.
  - The public runner file is no longer stuck at the 44-line canonical skeleton placeholder, but the live attempt still did not finish verification or produce a stable runnable repair.
  - Latest same-flow retry after routing single-chunk Python materialization through chunk generation completed successfully:
    - retry started at `2026-04-23T23:02:54Z`
    - dynamic materialization reached `Generating staged_llm unit 1/1 chunk 1/1: Implement the PEFT instruction study runner`
    - the request waited through heartbeat observations up to `539s`, then returned streamed Codex OAuth output
    - `unit_chunk_responses/peft_runner__peft_runner__d0__chunk_1_1.txt` was written
    - the public runner was rewritten to `690` lines
    - local verification passed via `python -m py_compile /home/hanyong/.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`
    - `implement_experiments/status.json` ended with `status: "completed"` and `verifyStatus: "pass"`
  - A remaining observability gap was found during this same live retry:
    - the Codex OAuth SSE parser accumulated `response.output_text.delta` internally, but the generic `CodexOAuthResponsesLLMClient` forwarded all progress as `status`
    - as a result, `implement_experiments/partial_response.txt` and `LLM>` progress lines only appeared after final completion, not during long-running Codex OAuth text deltas
    - this does not block completion, but it made long provider waits harder to inspect while the request was still running

- Fresh vs existing session comparison:
  - Fresh session: multiple fresh TUI relaunches on 2026-04-23 reproduced the provider-side scaffold/bootstrap/materialization instability before the final patch set.
  - Existing session: the same persisted run completed `implement_experiments` after the retryable `terminated`, per-request artifact isolation, and single-chunk Python chunk-routing fixes.
  - Divergence: none established; the same persisted run moved from failure to completed after code changes rather than after a state reset.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: the heuristic-free staged path is now behaving more honestly, but the live Codex OAuth provider remains unstable at the first scaffold/bootstrap planning turns for this run, intermittently returning backend errors or aborts before any usable structured response can be materialized.
  - Updated 2026-04-24 hypothesis: the remaining late materialization boundary includes provider-side `terminated` responses that are not AutoLabOS local timeout errors. Treating those as terminal prevents the existing dynamic re-subdivision path from making the request smaller. The global `partial_response.txt` is also reused across requests, so failed chunk snapshots can accidentally capture the previous successful chunk rather than the failed request.
  - Resolution update: confirmed. Once provider-side `terminated` was treated as retryable for materialization, request-local/attempt-local artifacts were isolated, and Python runner materialization always used the chunk path, the same live retry completed. The separate no-intermediate-output symptom was traced to Codex OAuth delta events being forwarded as `status` instead of `delta`.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - removed heuristic fallback projection for `decomposition_plan`
      - removed heuristic fallback materialization/subdivision plans
      - removed heuristic gating that skipped planning for “simple” units/chunks
      - tightened staged prompts to ask for the smallest purpose-aligned unit/chunk/subchunk set without fixed-size guidance
      - rejected placeholder/comment-only staged Python chunk responses and empty final materializations
      - blocked recovery of placeholder-only public script bundles
      - compacted staged scaffold and bootstrap planning prompts to reduce provider request size
      - raised the default staged LLM request timeout for `implement_experiments` from `600000ms` to `1800000ms`
      - clears the per-request partial snapshot before each staged LLM request so chunk `_partial_on_error` artifacts cannot reuse stale successful output
      - clears stale staged attempt artifact directories at the start of each staged bundle while preserving progress/status logs
      - treats provider-side `terminated` during chunk materialization as a retryable transient failure that triggers smaller dynamic re-subdivision
      - routes single-chunk Python runner materialization through chunk generation instead of the whole-file staged generation path
      - writes chunk-specific `_error.txt` artifacts when materialization requests fail
    - `src/core/agents/implementationLocalizer.ts`
      - added exact previous-script path preference so reruns prioritize the real failing runner over nearby manifests/analysis artifacts
    - `src/integrations/codex/oauthResponsesTextClient.ts`
      - emits Codex OAuth SSE `response.output_text.delta` frames as typed `delta` progress events while preserving status events
    - `src/core/llm/client.ts`
      - forwards Codex OAuth typed progress events unchanged so staged implement partial snapshots can observe real text deltas
  - Tests:
  - `tests/codexOAuthTextClient.test.ts`
      - added regression coverage that Codex OAuth streamed deltas reach the generic LLM progress callback
  - `tests/implementSessionManager.test.ts`
      - added regressions that fail loudly when decomposition, materialization, or subdivision plans are missing/unparseable instead of silently falling back
      - added regression coverage for comment-only canonical-skeleton chunk responses
      - added regression coverage that scaffold/bootstrap prompt artifacts and raw responses are persisted
      - added regression coverage that late chunk prompts/raw responses are persisted and that sibling/recursive subchunks receive parent draft context
      - added regression coverage that provider-side `terminated` re-subdivides the failing chunk and does not emit stale `_partial_on_error` snapshots
      - added regression coverage that stale chunk response artifacts from a previous retry are removed before the next staged bundle writes fresh artifacts
      - added regression coverage that single-chunk Python runner plans still use chunk generation, preserving retry/re-subdivision behavior
    - `tests/implementationLocalizer.test.ts`
      - added regression coverage that prefers the exact previous run script over adjacent manifest files

- Regression status:
  - Automated regression test linked: yes (`tests/implementSessionManager.test.ts`, `tests/implementationLocalizer.test.ts`)
  - Re-validation result:
    - targeted implement/localizer regressions passed
    - `npm run build` passed
    - `npm test` passed
    - live same-flow reruns are no longer blocked at bootstrap on the latest retry, but still fail later during staged chunk/resubchunk generation
    - latest same-flow retry with the smaller scaffold prompt still narrows to the bootstrap wait boundary rather than producing a runnable repair
    - latest same-flow retry with the smaller bootstrap prompt reaches bootstrap faster, yields a parseable bootstrap contract, and materially grows the runner file before terminating later in materialization
    - latest same-flow retry with per-chunk prompt/raw instrumentation confirms the next failure surface can now be audited at the individual chunk request level
    - latest same-flow retry now narrows the next patch target to provider-side `terminated` handling and stale per-request partial snapshot isolation
    - latest same-flow retry after those fixes completed `implement_experiments` with `verifyStatus: "pass"`
    - automated regression after the 2026-04-24 patch: `npx vitest run tests/implementSessionManager.test.ts`, `npm run build`, `npm test`, and `npm run validate:harness` passed
    - targeted Codex OAuth progress regression after the observability patch: `npx vitest run tests/codexOAuthTextClient.test.ts` passed

- Most likely failing boundary:
  - resolved for `implement_experiments` same-flow retry; next validation boundary is downstream `run_experiments` execution of the newly generated runner and its metrics contract

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/scaffold_prompt.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/scaffold_raw_response.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/bootstrap_contract_prompt.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/bootstrap_contract_raw_response.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_chunk_prompts/`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_chunk_responses/`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`
  - `docs/codex-oauth-live-diagnostics.md`

- Recommended next step:
  - rebuild the runtime with Codex OAuth delta-forwarding, rerun the required validation suite, then continue to downstream `run_experiments` to verify the generated PEFT runner produces the required `accuracy_delta_vs_baseline` metrics rather than only passing `py_compile`.

## Issue: LV-101

- Status: resolved
- Validation target: existing external-workspace TUI `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` after the deferred-results patch
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`

- Reproduction steps:
  1. Relaunch a fresh real TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let attempt 1/3 enter staged LLM mode and wait for the bounded hard timeout.
  4. Inspect `implement_experiments/status.json`, `implement_experiments/progress.jsonl`, and `events.jsonl`.

- Expected behavior:
  - The staged implementation turn should either stream/output usable Codex text and continue into implementation validation, or fail for a narrower request-level reason before consuming the full 600000ms budget.

- Actual behavior:
  - The same-flow retry used to stall before producing any implement-stage text, first as one giant staged LLM turn and later as the first runner chunk after decomposition.
  - After the staged runner was split into purpose-aligned chunks, the same persisted run eventually advanced through all three runner chunks and completed the rest of the implement bundle:
    - `Generating staged_llm unit 1/3 chunk 2/3: Dataset preparation, model setup, PEFT condition execution, and benchmark evaluation (...)`
    - `Generating staged_llm unit 1/3 chunk 3/3: Result aggregation, metrics JSON writing, public artifact export, and main entrypoint (...)`
    - `Generating staged_llm unit 2/3: Bounded experiment plan (...)`
    - `Generating staged_llm unit 3/3: Experiment usage and interpretation guide (...)`
    - `Implementation turn completed.`
    - `Local verification passed via python -m py_compile .../run_peft_instruction_study.py.`
  - The final `implement_experiments/status.json` for the same persisted run is now `completed` with `verifyStatus: "pass"`.

- Fresh vs existing session comparison:
  - Fresh session: not separately needed; the same persisted run was retried from a rebuilt real TUI session.
  - Existing session: the repaired flow now crosses the former stall boundary, completes implement-stage materialization, and passes local verification.
  - Divergence: none remains at the original boundary.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: the original staged implement request was too coarse; after purpose-aligned decomposition and chunked runner generation, the same live path can now materialize and verify successfully.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - added staged-LLM heartbeat progress updates and partial-response snapshotting to `implement_experiments`
      - added shared `decomposition_plan` contract emission plus a bounded staged repair turn when scaffolds omit that plan
      - added dynamic materialization chunk planning for large text-file units so runnable scripts can be generated as purpose-aligned subcalls instead of one giant file turn
    - `src/core/decompositionPlan.ts`
      - added reusable dynamic decomposition-plan types/parsing for future prompt-splitting migrations
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - added a regression that timeouting staged-LLM requests persist partial-response artifacts and timeout observations when progress is observed
      - added regressions for decomposition-plan artifact emission and decomposition-plan repair when the scaffold omits it
      - updated staged-LLM implement regressions to cover dynamic materialization plans and chunked runner generation

- Regression status:
  - Automated regression test linked: yes (`tests/implementSessionManager.test.ts`)
  - Re-validation result: resolved in the same persisted run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - New observation: the same-flow retry now survives the former stall, completes `implement_experiments`, and passes local `py_compile` verification.

- Most likely failing boundary:
  - resolved staged LLM request/materialization boundary inside `implement_experiments`

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/decomposition_plan.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/decomposition_plan_raw_response.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_plans/runner_script.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_plans/runner_script_raw_response.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_plans/runner__chunk1_setup_and_plan.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`

- Recommended next step:
  - move downstream to the new `run_experiments` failure now that the implement-stage stall is resolved.

## Issue: LV-100

- Status: resolved
- Validation target: existing external-workspace TUI `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` after the native Codex stream-materialization fix
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`

- Reproduction steps:
  1. Relaunch a fresh real TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let the staged implementation turn finish and inspect `implement_experiments/progress.jsonl`, `verify_report.json`, and the public experiment directory.

- Expected behavior:
  - `implement_experiments` should allow future public result files such as `outputs/.../experiment/results/summary.json` to remain absent at implement time.
  - Those files should be treated like deferred execution outputs that `run_experiments` is responsible for materializing later.

- Actual behavior:
  - Before the patch, the same live run could complete an implementation turn and then fail attempt 1 with:
    - `Implementer referenced artifact(s) that were not materialized: outputs/.../experiment/results/summary.json, .../condition_results.json, .../report.md`
  - The missing paths were public result files under `outputs/.../experiment/results/*`, not immediate implement-stage artifacts.
  - The node then restored the branch snapshot and retried instead of handing off to `run_experiments`.

- Fresh vs existing session comparison:
  - Fresh session: not separately needed.
  - Existing session: the same persisted run now crosses the former boundary, completes `implement_experiments`, and enters `run_experiments` instead of failing on deferred public result files.
  - Divergence: none remains at the original boundary.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: implement-stage artifact validation was projecting future public run outputs into the current materialization set and treating them as missing supplemental artifacts, even though those `results/*` files should only exist after `run_experiments`.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - broadened deferred execution artifact recognition so public `outputs/.../experiment/results/*` paths are treated as deferred run-time outputs rather than immediate implement-stage requirements
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - added a regression that missing public experiment result files under `outputs/.../experiment/results/*` do not fail implement-stage validation

- Regression status:
  - Automated regression test linked: yes (`tests/implementSessionManager.test.ts`)
  - `npm test`: passed
  - `npm run build`: passed
  - `npm run validate:harness`: passed
  - Same-flow live revalidation: resolved; the same persisted run no longer fails on missing deferred `results/*` artifacts and instead proceeds into `run_experiments`.

- Most likely failing boundary:
  - implement-stage artifact-validation boundary inside `materializeDeclaredArtifacts(...)` / deferred output classification

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/verify_report.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/`

- Recommended next step:
  - keep following the same persisted run from `run_experiments`, where the next real blocker is now runner integrity rather than implement-stage artifact classification.

## Issue: LV-102

- Status: resolved
- Validation target: same persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after `implement_experiments` was repaired with dynamic decomposition, runner chunking, and local `py_compile` verification
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - nodes reached: `implement_experiments -> run_experiments`

- Reproduction steps:
  1. Relaunch a fresh real TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let `implement_experiments` complete and hand off to `run_experiments`.
  4. Inspect `run_record.json`, `events.jsonl`, and the runner traceback produced by `run_experiments`.

- Expected behavior:
  - The repaired public runner should preserve required setup helpers such as `parse_args()` across chunk joins and should survive both local `py_compile` verification and the initial `run_experiments` invocation.

- Actual behavior:
  - Before the fix, the same persisted run completed `implement_experiments` and passed local `python -m py_compile`, but the generated runner then aborted immediately inside `run_experiments` with:
    - `RuntimeError("Missing parse_args() in runner setup chunk.")`
  - After the compatibility repair and same-flow continuation, that boundary no longer reproduces.
  - The same persisted run now advances beyond the `parse_args()`/config-join surface and fails later for a different reason (offline Hugging Face bootstrap), so `LV-102` is no longer the dominant blocker.

- Fresh vs existing session comparison:
  - Fresh session: not separately reproduced yet.
  - Existing session: reproduced directly on the same persisted run after implement-stage recovery.
  - Divergence: unknown; this is currently a downstream runner-integrity bug, not a session-state mismatch.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: chunked runner materialization can still produce an internally inconsistent final script where later orchestration code expects setup-surface helpers that were omitted, overwritten, or not preserved correctly across subchunk joins. Local `py_compile` is too weak to catch this semantic integrity failure.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - repairs Python runners that define `build_arg_parser()` but omit a callable `parse_args()` helper by inserting a bounded compatibility shim before handoff
      - re-runs local verification after the shim is materialized so the persisted public runner surface reflects the repaired contract before `run_experiments`
      - normalizes locked PEFT configs to the recipes-only runtime schema before handoff
      - aligns generated runner helper invocation kwargs and baseline-first locked-condition counting before handoff
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - added a regression that a generated Python runner missing `parse_args()` is repaired before handoff and still passes local `py_compile`
      - added regressions for locked PEFT config normalization, baseline-first locked-condition counting, and condition-helper kwarg repair

- Regression status:
  - Automated regression test linked: yes (`tests/implementSessionManager.test.ts`)
  - `npx vitest run tests/implementSessionManager.test.ts`: passed after the runner/config compatibility repairs
  - `npm run build`: passed after the repairs
  - `npm run validate:harness`: passed after updating this entry
  - Same-flow live revalidation: resolved; the same persisted run now crosses the old runner-integrity boundary and reaches a later offline-model/bootstrap failure in `run_experiments`.

- Most likely failing boundary:
  - resolved runner integrity across staged chunk/subchunk joins in `implement_experiments`, only surfaced by `run_experiments`

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

- Recommended next step:
  - keep the implement-stage compatibility repairs, and treat offline Hugging Face bootstrap as the next real `run_experiments` blocker rather than a recurrence of this runner-integrity issue.

## Issue: LV-104

- Status: resolved
- Validation target: same persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after removing `allow_network` as a runtime execution gate and rerunning `run_experiments` through the real TUI
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - nodes reached: `implement_experiments -> run_experiments`

- Reproduction steps:
  1. Remove `allow_network` as an execution-blocking runtime contract and keep network usage as metadata/labeling only.
  2. Rebuild and rerun the validation suite.
  3. Relaunch the real TUI in `.autolabos-validation`.
  4. Run `/agent retry run_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  5. Inspect `run_record.json`, `events.jsonl`, `pgrep` process state, and the active experiment bundle.

- Expected behavior:
  - The same persisted run should no longer stop before execution with an offline-policy/bootstrap refusal tied to `allow_network=false`.
  - `run_experiments` should be allowed to proceed into real model/dataset bootstrap, with network usage treated as a runtime dependency rather than a policy block.

- Actual behavior:
  - Before the policy change, the repaired PEFT runner failed immediately at the baseline Hugging Face bootstrap boundary with:
    - `LocalEntryNotFoundError: ... outgoing traffic has been disabled`
    - `To enable hf.co look-ups and downloads online, set 'local_files_only' to False.`
  - After removing the runtime network gate and rerunning the same persisted run through the real TUI, the old failure boundary no longer reproduces:
    - the retry is accepted in the real TUI
    - the persisted run moves back to `status: "running"` / `currentNode: "run_experiments"`
    - the parent PEFT runner process is alive
    - the embedded Hugging Face evaluation subprocess is also alive and actively executing the model/dataset bootstrap code path
  - The original `allow_network` / offline-policy blocker is therefore gone; the remaining downstream runtime outcome is now a true execution question rather than a policy refusal.

- Fresh vs existing session comparison:
  - Fresh session: a fresh full run had already shown the earlier bootstrap-policy gate at `implement_experiments`.
  - Existing session: after the policy removal, the same persisted run was retried from a freshly relaunched real TUI session and now proceeds into active execution instead of failing immediately at the offline-policy boundary.
  - Divergence: the existing-session rerun confirms the old failure was policy/runtime-contract driven rather than a stale-session-only artifact.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the earlier failure was caused by an execution contract that still forced the workflow to behave as offline/local-only when public Hugging Face assets were not prewarmed. Removing `allow_network` as a runtime gate and treating network use as metadata unblocked the same-flow execution path.

- Code/test changes:
  - Code:
    - `src/types.ts`
      - downgraded `allow_network` to deprecated compatibility metadata
    - `src/config.ts`
      - stopped persisting `allow_network` in new configs and normalized network state through metadata-only `network_policy`
    - `src/tools/commandPolicy.ts`
      - removed network fetch blocking from command policy
    - `src/tools/aciLocalAdapter.ts`
      - stopped forcing Hugging Face tooling into offline mode via the deprecated network flag
    - `src/core/agents/implementSessionManager.ts`
      - changed the bootstrap/environment contract so remote Hugging Face assets are treated as explicit runtime requirements instead of execution blockers
    - `src/core/nodes/runExperiments.ts`
      - removed the hard stop on bootstrap `requires_network` and downgraded it to runtime observation/labeling
  - Tests:
    - `tests/aciLocalAdapter.test.ts`
    - `tests/commandPolicy.test.ts`
    - `tests/configEnv.test.ts`
    - `tests/doctorHarnessIntegration.test.ts`
    - `tests/implementSessionManager.test.ts`
    - `tests/readinessRisks.test.ts`
    - `tests/runExperimentsExecutionProfile.test.ts`
      - updated/added regressions proving network use is metadata-only and no longer a hard execution block

- Regression status:
  - Automated regression tests linked: yes
  - `npx vitest run tests/configEnv.test.ts tests/commandPolicy.test.ts tests/aciLocalAdapter.test.ts tests/readinessRisks.test.ts tests/doctorHarnessIntegration.test.ts tests/runExperimentsExecutionProfile.test.ts tests/implementSessionManager.test.ts`: passed
  - `npm run build`: passed
  - `npm test`: passed
  - `npm run validate:harness`: passed
  - Same-flow live revalidation: resolved for the original boundary; the persisted run no longer fails at the old offline-policy/bootstrap gate and instead proceeds into active `run_experiments` execution with the Hugging Face evaluation subprocess alive.

- Most likely failing boundary:
  - resolved execution-policy boundary for public Hugging Face assets

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/exec_logs/run_experiments.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/experiment_config.yaml`
  - active process evidence from same-flow retry:
    - parent runner `python .../run_peft_instruction_study.py`
    - embedded evaluation subprocess `python -c ... AutoModelForCausalLM.from_pretrained(...) ... load_dataset(...)`

- Recommended next step:
  - continue tracking the in-flight `run_experiments` retry to determine the next real runtime blocker now that the old network-policy gate has been removed.

## Issue: LV-099

- Status: resolved
- Validation target: existing external-workspace TUI `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` on the rebuilt native Codex runtime after removing automatic `previous_response_id` forwarding
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - rebuilt runtime launched from `dist/cli/main.js`

- Reproduction steps:
  1. Start a fresh real TUI session in `.autolabos-validation` on the rebuilt runtime.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let the staged LLM attempt localize branch focus and submit the native Codex OAuth request.
  4. Inspect `implement_experiments/status.json`, `implement_experiments/progress.jsonl`, `events.jsonl`, and `run_record.json`.

- Expected behavior:
  - The retry should progress beyond `Submitting request to Codex OAuth Responses backend.`
  - After streamed Codex output arrives, the run should materialize a structured implementation result or at least salvage non-empty final text for parsing into a runnable bundle.

- Actual behavior:
  - Before the parser fix, the same live retry progressed to:
    - `Submitting request to Codex OAuth backend.`
    - `Submitting request to Codex OAuth Responses backend.`
    - `Received streamed Codex OAuth output.`
    - then failed with:
      - `Implementation execution failed before any runnable implementation was produced: Codex OAuth backend returned no output text (status=in_progress).`
  - After the parser fix and same-flow revalidation, the retried run no longer reproduces that failure.
  - The live flow now advances past native Codex text materialization, validates the returned implementation, and continues into later branch/attempt handling.
  - A separate downstream problem remains possible in the same node when the implementer references artifacts that were never materialized, but that is no longer the native stream-materialization boundary covered by `LV-099`.

- Fresh vs existing session comparison:
  - Fresh session: no separate fresh-from-bootstrap repro was needed for this parser boundary; the same persisted run was retried from a freshly relaunched rebuilt TUI session.
  - Existing session: before the fix, the same persisted run failed at `Codex OAuth backend returned no output text (status=in_progress)` after streamed output arrived.
  - Revalidated session: after the fix, that same persisted run proceeds past text materialization and into later implementation validation/retry handling.
  - Fresh-vs-existing divergence is not the issue here; the original symptom disappeared in the same persisted run on a rebuilt fresh TUI session.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis confirmed: the native Codex OAuth stream parser was too narrow. It trusted `response.output_text.delta` plus `response.completed` as the primary success path and could drop usable text when the backend emitted completion-bearing `item.completed`/`*.done`-style events without a final `response.completed` payload.

- Code/test changes:
  - Code:
    - `src/integrations/codex/oauthResponsesTextClient.ts`
      - no longer infers `previous_response_id` from `threadId`
      - now salvages completion-bearing text candidates from `item.completed`, `message.completed`, and `*.done`/`*.completed` stream events
      - now merges response payload snapshots across stream events instead of trusting only `response.completed`
      - now selects the best available final text from streamed deltas, payload output, and salvaged completion candidates
    - `src/core/llm/client.ts`
      - stopped auto-forwarding `threadId` as `previousResponseId` for native Codex OAuth completions
    - `src/integrations/codex/codexCliClient.ts`
      - stopped auto-forwarding `threadId` as `previousResponseId` when the native Codex wrapper issues a text completion
  - Tests:
    - `tests/codexOAuthTextClient.test.ts`
      - added regression coverage that `threadId` alone no longer serializes `previous_response_id`
      - explicit `previousResponseId` still serializes when intentionally provided
      - added regressions that salvage text from `item.completed` without `response.completed`
      - added regressions that salvage text from `response.output_text.done`

- Regression status:
  - Automated regression test linked: yes (`tests/codexOAuthTextClient.test.ts`)
  - Re-validation result: fixed in the same live retry flow; the original `status=in_progress` no-output failure no longer reproduces.

- Most likely failing boundary:
  - resolved native Codex OAuth stream-materialization boundary inside `implement_experiments` staged LLM mode

- Follow-up risks:
  - Later `implement_experiments` validation can still fail for unrelated reasons such as missing materialized artifacts or branch-level implementation drift.
  - Long-running prompts may still expose new native Codex event shapes; the current parser is broader, but future provider changes could require more salvage coverage.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/verify_report.json`

- Recommended next step:
  - continue the same live `implement_experiments` flow and treat any remaining failure after text materialization as a new downstream issue rather than a recurrence of `LV-099`.

- Resolution notes:
  - The same persisted run `73050f85-6b56-4385-8c31-2ec69a5b7dec` was retried again from a freshly relaunched rebuilt TUI session.
  - The retried flow no longer reproduced `Codex OAuth backend returned no output text (status=in_progress)`.
  - In the same live run, `implement_experiments` progressed beyond text materialization, validated the returned implementation, and emitted later-stage observations such as:
    - `Implementer referenced artifact(s) that were not materialized: ...`
    - `Restored 36 path(s) before retrying the next candidate branch.`
    - `Implementation attempt 2/3 started.`
  - Those later observations confirm the original native stream-materialization boundary was crossed successfully and the parser fix changed the runtime behavior in the intended same flow.

## Issue: LV-098

- Status: in_progress
- Validation target: fresh external-workspace TUI `/brief start --latest` rerun for IEEE PEFT papers that previously reached `pdf_extract_failed` abstract fallback despite a nominal `pdf_url`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation/.live/abstract-image-rerun-wgj0hk`
  - run: `4600d589-7162-4d46-8d2e-a6939713bafc`
  - target papers:
    - `doi:10.1109/lsp.2024.3377590` (`Chain-of-LoRA...`)
    - `doi:10.1109/globecom52923.2024.10901572` (`Federated Low-Rank Adaptation...`)

- Reproduction steps:
  1. Start a fresh external workspace and run real TUI `/brief start --latest`.
  2. Let `collect_papers` finish and `analyze_papers` reach the two IEEE target papers above.
  3. Observe source resolution log lines and inspect the cached `analysis_cache/pdfs/*` and `analysis_cache/page_images/*` artifacts for those paper ids.

- Expected behavior:
  - If a real PDF is available but text extraction is unusable, `resolvePaperTextSource(...)` should preserve rendered page images and log:
    - `PDF extraction produced no usable text. Falling back to abstract with supplemental page images.`
  - The later analyzer path should then attach those images on the extractor call.

- Actual behavior:
  - The fresh rerun still logs:
    - `[doi:10.1109/lsp.2024.3377590] PDF extraction produced no usable text. Falling back to abstract.`
    - `[doi:10.1109/globecom52923.2024.10901572] PDF extraction produced no usable text. Falling back to abstract.`
  - Both papers persist as `source=abstract` with no supplemental page images.
  - Direct inspection of the cached pseudo-PDFs shows they are HTML, not PDF:
    - `<!DOCTYPE html> ... <script> var MEMBER_PROFILE_...`
  - Their page-image directories exist but contain no PNG files, so this is not a later analyzer drop; the renderer never received a real PDF to rasterize.

- Fresh vs existing session comparison:
  - Fresh session: the earlier fresh rerun in `.live/abstract-image-rerun-wgj0hk` reproduces the IEEE staging-url failure, the newer fresh rerun in `.live/ieee-filter-rerun-9RKL01` proves the new `no_pdf_url` path is working for other unusable metadata rows, and the targeted fresh rerun in `.live/ieee-targeted-fresh-20260416-213634` confirms both IEEE targets are selected in the active top-30 with `pdf_availability_score: 0`, but the live node has not yet advanced far enough to emit their per-paper source-resolution logs.
  - Existing session: no separate resumed-session divergence has been observed; the defect is anchored at fresh source resolution against persisted corpus metadata before resume handling matters.
  - Divergence: no meaningful fresh-vs-existing divergence established so far; the remaining gap is target-paper coverage in the fresh rerun.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: persisted corpus rows can carry invalid IEEE staging `pdf_url` values from provider metadata (for example `http://xplorestaging.ieee.org/...pdf?arnumber=...`) that return HTML instead of a PDF binary. When those URLs are cached, the image-rescue path never gets a real PDF to render, so abstract fallback cannot preserve supplemental page images.

- Code/test changes:
  - Code:
    - `src/core/analysis/paperText.ts`
      - added a smaller `pdftoppm -scale-to 1024` rescue render attempt for real PDFs that fail default rasterization.
      - added invalid-PDF detection so HTML masquerading as `.pdf` is no longer silently cached as a PDF.
      - now treats known unusable IEEE staging hosts such as `xplorestaging.ieee.org` as non-usable `pdf_url` metadata before download.
  - Tests:
    - `tests/paperTextImageFallback.test.ts`
    - `tests/paperText.test.ts`

- Regression status:
  - Automated regression test linked: yes (`tests/paperText.test.ts`, `tests/paperTextImageFallback.test.ts`)
  - Re-validation result: pending same-flow confirmation for the two IEEE targets; the latest fresh reruns already show real `No PDF URL found. Using abstract fallback.` behavior for other unusable rows in the same patched runtime, and the targeted rerun now proves both IEEE targets are in the selected set under the patched resolver.

- Most likely failing boundary:
  - persisted metadata / source-resolution boundary

- Follow-up risks:
  - the target IEEE papers may still require alternate public-PDF enrichment even after the staging host is rejected, so this patch may only convert the failure from fake-PDF handling to honest `no_pdf_url` fallback.
  - even with both targets selected, long-running earlier papers can delay the same-flow per-paper confirmation because the node is still bounded and sequential enough that rank 4/25 may take time to surface in logs.

- Evidence/artifacts:
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/events.jsonl`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/corpus.jsonl`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/analysis_cache/pdfs/doi_10.1109_lsp.2024.3377590.pdf`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/analysis_cache/pdfs/doi_10.1109_globecom52923.2024.10901572.pdf`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/analysis_cache/page_images/doi_10.1109_lsp.2024.3377590/`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/analysis_cache/page_images/doi_10.1109_globecom52923.2024.10901572/`
  - `.autolabos-validation/.live/ieee-filter-rerun-9RKL01/.autolabos/runs/686eee86-9033-4ad9-8017-af4b3bf2d7f0/events.jsonl`
  - `.autolabos-validation/.live/ieee-filter-rerun-9RKL01/.autolabos/runs/686eee86-9033-4ad9-8017-af4b3bf2d7f0/corpus.jsonl`
  - `.autolabos-validation/.live/ieee-targeted-fresh-20260416-213634/.autolabos/runs/00575beb-de5b-4c57-9316-0377db0f2c4f/events.jsonl`
  - `.autolabos-validation/.live/ieee-targeted-fresh-20260416-213634/.autolabos/runs/00575beb-de5b-4c57-9316-0377db0f2c4f/analysis_manifest.json`
  - `.autolabos-validation/.live/ieee-targeted-fresh-20260416-213634/.autolabos/runs/00575beb-de5b-4c57-9316-0377db0f2c4f/corpus.jsonl`

- Recommended next step:
  - add a metadata-repair or alternate-PDF-resolution step for known bad IEEE staging URLs before `downloadPdf(...)` is attempted, or explicitly downgrade those rows as `invalid_pdf_content` with a clearer operator-facing note.

## Issue: LV-097

- Status: resolved
- Validation target: existing external-workspace TUI `/retry` flow for paused `analyze_papers` on run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context: default external validation root `.autolabos-validation`, real TUI startup automation, resumed paused session after `LV-096` was closed

- Reproduction steps:
  1. Start a real TUI session in `.autolabos-validation`.
  2. Resume the paused run `73050f85-6b56-4385-8c31-2ec69a5b7dec` with `/retry`.
  3. Let `analyze_papers` rerun its rerank-fallback shortlist and inspect `run_record.json`, `events.jsonl`, `paper_summaries.jsonl`, and `evidence_store.jsonl`.
  4. Wait until the first selected paper (`Compresso...`) reaches planner timeout on the full-text path.

- Expected behavior:
  - A paused existing session should preserve or quickly re-materialize a first persisted summary/evidence row when `analyze_papers` is retried.
  - If the shortlist changes, the reset should still recover to a persisted first row within the same bounded retry cycle.

- Actual behavior:
  - Before the fix, `/retry` could recompute the rerank-fallback shortlist and log:
    - `Analysis selection changed since the previous run. Resetting summaries/evidence for the new paper set.`
  - The existing `paper_summaries.jsonl` and `evidence_store.jsonl` were removed.
  - The rerun then reached:
    - `Analyzing paper 1/30: "Compresso: Structured Pruning with Collaborative Prompting Learns Compact Large Language Models".`
    - `[cef2e06efd484520808dfbeeee2029c4d06bd799] Planner unavailable, falling back to direct extraction: planner exceeded the 15000ms timeout`
  - with no persisted rows re-created.
  - After the fix and same-flow revalidation:
    - `/retry` now reuses the cached selection instead of resetting persisted outputs.
    - Full-text planner timeout on resumed papers logs:
      - `Planner timed out on a full-text source. Using a deterministic source-grounded fallback analysis so the first persisted row can be materialized without another long LLM roundtrip.`
    - Persisted rows re-materialize and continue accumulating in the same resumed run.

- Fresh vs existing session comparison:
  - Fresh session: the earlier fresh external-workspace `/brief start --latest` flow for the same run family already materialized persisted rows, including the abstract-only planner-timeout fallback fixed in `LV-096`.
  - Existing session: after the fix, the paused-session `/retry` path now reuses the cached selection and materializes deterministic full-text fallback rows instead of stalling at zero.
  - Divergence: no remaining fresh-vs-existing divergence observed at the first-row persistence boundary.

- Root cause hypothesis:
  - Type: `resume_reload_bug`
  - Hypothesis confirmed: retrying `analyze_papers` from a paused run could re-enter selection planning and, when it hit a full-text planner-timeout paper before any new rows were re-materialized, the direct-extraction path left the run at zero persisted rows. The fix makes planner-timeout on a full-text source materialize a conservative full-text fallback row immediately.

- Code/test changes:
  - Code:
    - `src/core/analysis/paperAnalyzer.ts`
      - planner timeout on a full-text source now returns a deterministic source-grounded fallback draft immediately instead of falling through to a long direct-extraction wait when the planner has already timed out.
  - Tests:
    - `tests/paperAnalyzer.test.ts`
      - added a regression for planner timeout on a full-text source.
    - `tests/analyzePapers.test.ts`
      - added a node-level regression that persists a full-text fallback row when the first selected paper hits planner timeout.

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: fixed in the same real external-workspace TUI `/retry` flow

- Follow-up risks:
  - Deterministic full-text fallback rows are intentionally weaker than normal structured extraction+review, so they should stay under the existing claim ceiling.
  - Analyze latency remains non-trivial because full-text planner timeouts still burn wall time before the fallback kicks in, but the resumed session no longer regresses to a zero-row stall.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/analysis_manifest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/paper_summaries.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/evidence_store.jsonl`

- Resolution notes:
  - After rebuilding, the same paused external-workspace run was resumed with a real TUI `/retry`.
  - The resumed flow now logs:
    - `Reusing cached paper rerank from analysis_manifest.json for top 30; skipping a new LLM rerank.`
    - `Planner timed out on a full-text source. Using a deterministic source-grounded fallback analysis so the first persisted row can be materialized without another long LLM roundtrip.`
    - `Persisted analysis outputs for "...\" (1 summary row, 1 evidence row(s)).`
  - In the same resumed run, `paper_summaries.jsonl` and `evidence_store.jsonl` were re-created and continued growing beyond the first paper; at validation time the run had already reached 7 persisted summary rows and 7 persisted evidence rows while still running.

## Issue: LV-096

- Status: resolved
- Validation target: real external-workspace TUI flow `/brief start --latest` through `analyze_papers` first-paper persistence, plus an abstract-only `pdf_extract_failed` paper in the same run
- Environment/session context: default external validation root `.autolabos-validation`, real TUI startup automation, run `73050f85-6b56-4385-8c31-2ec69a5b7dec`

- Reproduction steps:
  1. Start a real TUI session in `.autolabos-validation`.
  2. Run `/brief start --latest`.
  3. Let `collect_papers` complete and `analyze_papers` begin on `Compresso...`.
  4. Observe the first paper hit full-text planner timeout, then full-text extractor timeout, then full-text-only retry timeout.
  5. Inspect `events.jsonl`, `paper_summaries.jsonl`, `evidence_store.jsonl`, and `run_record.json`.

- Expected behavior:
  - After repeated full-text timeout exhaustion, the node should materialize a weak but honest persisted output for the first paper so warm-start can end.
  - If a later selected paper falls back to `pdf_extract_failed`, a planner timeout on the abstract-only path should also materialize a deterministic fallback row instead of stalling before persistence.

- Actual behavior:
  - Before the fix, the abstract-only `pdf_extract_failed` branch could log:
    - `Planning analysis focus, claim targets, and verification checks.`
    - `Planner unavailable, falling back to direct extraction: planner exceeded the 45000ms timeout`
    - with no persisted rows yet materialized.
  - After the fix and same-flow revalidation:
    - `Compresso...` persisted a deterministic abstract fallback row immediately after the repeated full-text timeouts.
    - A later abstract-only paper (`Federated Low-Rank Adaptation for Large Language Model Fine-Tuning Over Wireless Networks`) logged:
      - `Planner timed out on an abstract-only source. Using a deterministic abstract fallback analysis to preserve a minimal, source-grounded summary.`
      - `Persisted analysis outputs for "Federated Low-Rank Adaptation for Large Language Model Fine-Tuning Over Wireless Networks" (1 summary row, 1 evidence row(s)).`
  - `paper_summaries.jsonl` and `evidence_store.jsonl` now materialize in the same run, and `run_record.json` records `Persisted 2 summary row(s) and 2 evidence row(s).`

- Fresh vs existing session comparison:
  - Fresh session: `/brief start --latest` succeeds, `collect_papers` completes, and `analyze_papers` now persists rows during the same bounded analyze cycle.
  - Existing session: no separate resumed session was required for the closing validation because the fixed fresh external-workspace run now proves both the repeated full-text timeout fallback and the abstract-only planner-timeout fallback materialize persisted outputs.
  - Divergence: no remaining fresh-vs-existing difference observed at the persistence boundary.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis confirmed: the `pdf_extract_failed` abstract path routed planner timeout into a second extraction-style LLM pass instead of synthesizing a deterministic fallback immediately, delaying warm-start persistence behind another timeout-prone step.

- Code/test changes:
  - Code:
    - `src/core/analysis/paperAnalyzer.ts`
      - planner timeout on an abstract-only source now returns a deterministic fallback draft immediately instead of falling through to direct extraction.
  - Tests:
    - `tests/paperAnalyzer.test.ts`
      - added a regression for planner timeout on an abstract-only source.

- Regression status:
  - Automated regression test linked: yes (`paperAnalyzer` planner-timeout abstract fallback case)
  - Re-validation result: fixed in a real external-workspace TUI flow under `.autolabos-validation`

- Follow-up risks:
  - Full-text planner/extractor retries still consume noticeable wall time before the existing repeated-timeout fallback kicks in, so analyze latency remains a quality-of-life concern even though persistence now succeeds.
  - The external-workspace TUI path is now proven through `collect_papers` and persisted `analyze_papers` rows, so future regressions at this boundary should be revalidated on the same workspace style, not only under repository-local fixtures.

- Evidence/artifacts:
  - `.autolabos-validation/Brief.md`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/collect_result.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/analysis_manifest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/paper_summaries.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/evidence_store.jsonl`

## Issue: LV-095

- Status: resolved
- Validation target: real `test/.tmp` broad compact-model brief through resumed `analyze_papers` first-paper persistence
- Environment/session context: resumed fresh-workspace run `b86d40eb-4e9c-454c-bb48-019563a90bed` in `test/.tmp/compact-brief-rerun-6`, after the shortlist-quality fix and a real TUI `/retry`

- Reproduction steps:
  1. Start a fresh run from the broad compact-model / lightweight PEFT brief and let `collect_papers` complete.
  2. Let `analyze_papers` build the rerank-fallback shortlist and begin paper `1/30` (`Compresso...`).
  3. Resume the same run with a real TUI `/retry` after the first stalled attempt.
  4. Observe the full-text + image attempt time out, then the full-text-only retry time out, then the abstract-only fallback begin.
  5. Inspect `events.jsonl`, `paper_summaries.jsonl`, and `evidence_store.jsonl`.

- Expected behavior:
  - After full-text and full-text-only analysis both time out, the node should quickly materialize a weak but honest abstract-only fallback row so serial warm-start can end and persisted related-work artifacts can start accumulating.
  - The first persisted summary/evidence row should appear within the same bounded retry cycle.

- Actual behavior:
  - The run reaches:
    - `Extractor timed out with 12 rendered PDF page image(s). Retrying once with full text only.`
    - `Full-text extraction timed out again after removing rendered page images. Falling back to abstract-only analysis for this paper.`
    - `Planner unavailable, falling back to direct extraction: planner exceeded the 45000ms timeout`
  - But no `paper_summaries.jsonl` or `evidence_store.jsonl` row is materialized yet.
  - `run_record.json` still reports `Persisted 0 summary row(s) and 0 evidence row(s).`
  - The live TUI session continues to show `Analyzing... 1/30` with no first persisted output.

- Fresh vs existing session comparison:
  - Fresh session: the same run starts correctly from the tightened shortlist and reaches paper `1/30`.
- Existing session: after `/retry`, the node still stalls before the first persisted fallback row.
  - Divergence: no evidence that this is a fresh-vs-existing shortlist problem anymore; the remaining boundary is first-paper fallback materialization latency.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: once full-text and full-text-only retries are exhausted, `analyze_papers` still spends another full abstract-only LLM roundtrip before synthesizing the deterministic fallback, so the first persisted row is delayed behind another timeout-prone path instead of being materialized immediately.

- Code/test changes:
  - Code:
    - `src/core/analysis/paperAnalyzer.ts`
    - `src/core/nodes/analyzePapers.ts`
  - Tests:
    - `tests/analyzePapers.test.ts`
    - `tests/paperAnalyzer.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: pass on the same real flow after rebuilding and rerunning from a fresh `test/.tmp` workspace with shortened analysis timeouts

- Follow-up risks:
  - The first persisted row now materializes promptly, but long-lived aborted Codex subprocesses are still worth watching because the timeout-heavy paper-analysis path can leak background CLI children.
- Evidence/artifacts:
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/run_record.json`
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/events.jsonl`
  - `/tmp/retry-analyze-b86-2.log`
  - `test/.tmp/compact-brief-rerun-8-g6F8m6/.autolabos/runs/6147662c-96c4-45e3-b580-4f81d824c462/run_record.json`
  - `test/.tmp/compact-brief-rerun-8-g6F8m6/.autolabos/runs/6147662c-96c4-45e3-b580-4f81d824c462/events.jsonl`
  - `test/.tmp/compact-brief-rerun-8-g6F8m6/.autolabos/runs/6147662c-96c4-45e3-b580-4f81d824c462/paper_summaries.jsonl`
  - `test/.tmp/compact-brief-rerun-8-g6F8m6/.autolabos/runs/6147662c-96c4-45e3-b580-4f81d824c462/evidence_store.jsonl`

- Resolution notes:
  - The fix stops spending another abstract-only LLM roundtrip after full-text and full-text-only retries have already timed out.
  - Instead, `analyze_papers` now synthesizes the same conservative deterministic abstract fallback row immediately and persists it.
  - In the same live flow, the fresh rerun `6147662c-96c4-45e3-b580-4f81d824c462` now logs:
    - `Using a deterministic abstract fallback immediately after repeated full-text timeouts...`
    - `Persisted analysis outputs for "Compresso..." (1 summary row, 1 evidence row(s)).`
    - `Warm-start persisted outputs; continuing remaining 29 paper(s) with concurrency 3.`
  - The first persisted rows remain properly weak and abstract-bounded:
    - `source_type: "abstract"`
    - `confidence: 0.3`
    - `Abstract-only fallback; no verified full-text extraction completed before timeout.`

## Issue: LV-094

- Status: resolved
- Validation target: real `test/`-workspace broad compact-model brief through `collect_papers -> analyze_papers`
- Environment/session context: fresh `test/` workspace run `d45c14cd-edb0-4b45-95cf-9668c712c9a3` using the broadened compact-model / PEFT brief and the same governed `/brief start --latest` entry path

- Reproduction steps:
  1. Update `test/Brief.md` to the broader compact-model / lightweight PEFT study.
  2. Start a fresh real run from `test/` using `/brief start --latest`.
  3. Let `collect_papers` finish and `analyze_papers` build its top-30 shortlist after the rerank timeout fallback.
  4. Inspect `analysis_manifest.json`, `paper_summaries.jsonl`, and `events.jsonl`.

- Expected behavior:
  - For this brief, the rerank-fallback shortlist should stay centered on instruction tuning, LoRA/PEFT, compact-model adaptation, and bounded recipe trade-offs.
  - Domain-specific papers from unrelated application areas should not dominate the top-30 when the fallback safeguard is active.

- Actual behavior:
  - `collect_papers` now uses the improved query `+\"low-rank adaptation\" +\"instruction tuning\"` and completes successfully.
  - However, the fallback shortlist still admits off-topic domain papers into the selected 30, including medical, multimodal, and narrow application papers such as:
    - `MentalQLM: A Lightweight Large Language Model for Mental Healthcare Based on Instruction Tuning and Dual LoRA Modules.`
    - `BioInstruct: Instruction Tuning of Large Language Models for Biomedical Natural Language Processing`
    - `Ziya-Visual: Bilingual Large Vision-Language Model via Multi-Task Instruction Tuning`
    - `ATFLRec: A Multimodal Recommender System with Audio-Text Fusion and Low-Rank Adaptation via Instruction-Tuned Large Language Model`
  - The shortlist is better than the older broad-query run, but still not tight enough to count as a clean related-work set for this run contract.

- Fresh vs existing session comparison:
  - Fresh session: the new run `d45c14cd-edb0-4b45-95cf-9668c712c9a3` reproduces the shortlist drift in the rerank-fallback path.
  - Existing session: earlier broad-query run `089dce45-0385-4a93-9d2d-b1b5b10678bc` was worse at collect time, but the same underlying shortlist weakness remains when rerank times out.
  - Divergence: collect quality improved with the tightened brief; shortlist purity is still the remaining boundary.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the strict rerank-fallback safeguard relies mostly on anchor hit counts, but it does not penalize domain-specific tokens strongly enough when those domains are absent from the research brief. As a result, papers that mention LoRA/instruction tuning in unrelated application areas still survive the fallback shortlist.

- Code/test changes:
  - Code: `src/core/nodes/analyzePapers.ts`
  - Tests: `tests/analyzePapers.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: pass on the same live flow after rebuilding and rerunning from a fresh `test/.tmp` workspace

- Follow-up risks:
  - The shortlist is materially cleaner, but some domain-specific titles can still remain if they are genuinely PEFT/instruction-tuning focused enough for this brief.
  - If a future brief is explicitly medical or multimodal, the guard still depends on the brief carrying those anchors.
- Evidence/artifacts:
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/collect_request.json`
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/collect_result.json`
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/analysis_manifest.json`
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/paper_summaries.jsonl`
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/events.jsonl`
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/analysis_manifest.json`
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/collect_request.json`
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/events.jsonl`

- Resolution notes:
  - After the first patch, the live rerun still showed off-topic domain titles because the rerun was launched from an old built artifact.
  - After rebuilding and rerunning the same `/brief start --latest` flow from a fresh workspace, the rerank-fallback safeguard now reports:
    - `Dropped 24 off-topic paper(s) and promoted 24 replacement(s).`
  - The fresh selected top-30 is now led by papers such as:
    - `Compresso: Structured Pruning with Collaborative Prompting Learns Compact Large Language Models`
    - `Towards Alignment-Centric Paradigm: A Survey of Instruction Tuning in Large Language Models`
    - `Hyperparameter Optimization for Large Language Model Instruction-Tuning`
    - `Chain-of-LoRA: Enhancing the Instruction Fine-Tuning Performance of Low-Rank Adaptation on Diverse Instruction Set`
    - `MiLoRA: Efficient Mixture of Low-Rank Adaptation for Large Language Models Fine-tuning`
  - In the same rerun, the earlier drifting titles no longer appear near the top of the selected shortlist, including:
    - `ATFLRec...`
    - `MentalQLM...`
    - `BioInstruct...`
    - `Ziya-Visual...`

## Issue: LV-085

- Status: resolved
- Validation target: real `test/`-workspace governed run for the LoRA rank × dropout factorial brief
- Environment/session context: real `test/` workspace run `2c473563-13ad-4e11-b32a-9ff63e358f10`, revalidated through the same governed flow after implement fallback recovery changes

- Reproduction steps:
  1. Start the real run from `test/` with the governed brief for the Mistral-7B LoRA rank/dropout sweep.
  2. Let the run progress through `collect_papers`, `analyze_papers`, `generate_hypotheses`, and `design_experiments`.
  3. Allow `implement_experiments` to attempt public-bundle materialization and local verification.
  4. Observe the run fail before `run_experiments` because the declared public script path was never materialized.

- Expected behavior:
  - `implement_experiments` should hand off a runnable public experiment bundle containing the declared entrypoint, config, and docs.
  - Local verification should only fail if the declared public bundle is truly incomplete or unrunnable.

- Actual behavior:
  - Before the fix, `implement_experiments` failed with:
    - `Local verification could not start because required artifact(s) were not materialized ... run_lora_rank_dropout_sweep.py`
  - After the fix, the same real run now materializes:
    - `run_lora_rank_dropout_sweep.py`
    - `lora_rank_dropout_config.json`
    - `README_lora_rank_dropout.md`
  - The workflow advances beyond `implement_experiments`; the next real failure is later in `run_experiments` on offline Hugging Face model/tokenizer availability.

- Fresh vs existing session comparison:
  - Fresh session: broader-brief reruns now also advance through `collect_papers` into `analyze_papers`
  - Existing session: the persisted run `2c473563-13ad-4e11-b32a-9ff63e358f10` no longer fails on missing public artifacts
  - Divergence: no remaining evidence that the dominant failure is implement-stage materialization

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `implement_experiments` is ending with a declared public run command, but the actual public script/config bundle was never materialized into `outputs/.../experiment/`; the old `metrics.json` symptom is stale and no longer the dominant blocker.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: `tests/implementSessionManager.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: pass on the same real flow; artifact materialization now succeeds and the blocker moved downstream

- Follow-up risks:
  - The active blocker has shifted to `LV-086` and later runner/environment boundaries.
- Evidence/artifacts:
  - `test/.autolabos/runs/2c473563-13ad-4e11-b32a-9ff63e358f10/events.jsonl`
  - `test/.autolabos/runs/2c473563-13ad-4e11-b32a-9ff63e358f10/run_record.json`
  - `test/.autolabos/runs/2c473563-13ad-4e11-b32a-9ff63e358f10/memory/run_context.json`
  - `test/.autolabos/runs/2c473563-13ad-4e11-b32a-9ff63e358f10/implement_result.json`
  - `test/outputs/lora-rank-dropout-interaction-study-for-mistral--2c473563/experiment/run_lora_rank_dropout_sweep.py`
  - `test/outputs/lora-rank-dropout-interaction-study-for-mistral--2c473563/experiment/lora_rank_dropout_config.json`

## Issue: LV-086

- Status: resolved
- Validation target: real `test/`-workspace governed run for the LoRA rank × dropout factorial brief after `run_experiments`
- Environment/session context: same persisted live run `1f46de0f-5beb-4de6-a219-abf483b74101`, revalidated by forcing `analyze_results` through a real `test/` TUI session after the preflight-only metrics patch

- Reproduction steps:
  1. Start the real run from `test/` with the governed LoRA rank/dropout brief.
  2. Let `implement_experiments` and `run_experiments` complete.
  3. Inspect `.autolabos/runs/<run-id>/metrics.json` and `analysis/result_table.json`.
  4. Observe that the recorded metrics come from `mode: "preflight"` with no training or evaluation executed.

- Expected behavior:
  - `run_experiments` should not treat preflight-only environment checks as successful executed experiment evidence for this paper-scale brief.
  - Objective evaluation should not infer research success from hardware/resource fields such as `device.gpu_count` when the stated objective is benchmark accuracy on ARC-Challenge and HellaSwag.

- Actual behavior:
  - Before the fix:
    - `metrics.json` contained `mode: "preflight"` and `primary_metric: null`
    - `run_experiments` summarized `Objective metric met: device.gpu_count=2 >= 0.015`
    - `analyze_results` carried that stale success claim into `result_analysis.json`
  - After the fix and same-flow rerun:
    - `analyze_results` fails with `Experiment only emitted preflight metrics; no training or evaluation was executed.`
    - `result_table.json` is empty and no longer exposes `device.gpu_count` as the objective metric
    - `result_analysis.json` now reports `objective_status: "missing"` and no longer carries success-style `verifier_feedback`
    - `run_record.json` pauses back at `run_experiments` with the preflight-only failure surfaced as the latest summary

- Fresh vs existing session comparison:
  - Fresh session: the patched code was exercised in a real `test/` TUI rerun using startup automation from the same workspace
  - Existing session: the same persisted run `1f46de0f-5beb-4de6-a219-abf483b74101` now shows corrected artifacts after rerunning `analyze_results`
  - Divergence: none observed for this boundary after the rerun

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: preflight-only metrics were being allowed through result analysis and stale success-style verifier feedback from `run_experiments` was being copied into `result_analysis.json`, leaving a misleading “objective met” trail even when no executed experiment evidence existed.

- Code/test changes:
  - Code:
    - `src/core/experiments/executedMetrics.ts`
    - `src/core/nodes/runExperiments.ts`
    - `src/core/nodes/analyzeResults.ts`
  - Tests:
    - `tests/objectiveMetricPropagation.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: pass on the same real flow; preflight-only metrics are now surfaced as failure and no longer over-promoted into public analysis artifacts

- Follow-up risks:
  - `run_experiments` still pauses upstream because the underlying experiment never executed beyond preflight; that is now an honest blocker rather than a misleading success signal.
- Evidence/artifacts:
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/metrics.json`
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/result_analysis.json`
  - `test/outputs/lora-rank-dropout-interaction-for-mistral-7b-ins-1f46de0f/analysis/result_table.json`
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/run_record.json`
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/events.jsonl`

## Issue: LV-ARCHIVE-ANCHOR

- Status: resolved
- Validation target: `ISSUES.md` structural compatibility with harness validation
- Environment/session context: repository root documentation state after archive compaction

- Reproduction steps:
  1. Run `npm run validate:harness` from the repository root.
  2. Observe that the validator scans `ISSUES.md`.
  3. Remove all structured `Issue:` entries from the file.

- Expected behavior: `ISSUES.md` remains machine-readable by the harness validator.
- Actual behavior: the validator reports `issue_entry_missing` when no structured issue headings remain.
- Fresh vs existing session comparison:
  - Fresh session: same validator result
  - Existing session: same validator result
  - Divergence: no

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the validator still expects at least one structured `Issue:` entry even when active defects are empty and older issues have been compacted into git history.

- Code/test changes:
  - Code: none
  - Tests: none

- Regression status:
  - Automated regression test linked: no
  - Re-validation result: pass once this archive anchor remains present

- Follow-up risks: validator and operator-facing issue management can drift again if the file is compacted without leaving any structured anchor.
- Evidence/artifacts: `npm run validate:harness`, `docs/live-validation-issue-template.md`
