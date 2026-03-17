# ISSUES.md

## Current status
- Last updated: 2026-03-17
- All live-validation code bugs (LV-001 through LV-019) have been resolved.
- LV-020 (plan-vs-script drift detection gap) FIXED.
- All research-quality and paper-readiness risks (R-001–R-003, P-001–P-003) have been addressed with artifact materialization, gate strengthening, and gate-warning surfacing.

## Active issues

### LV-020 — implement_experiments does not detect experiment plan changes
- Status: FIXED
- Root-cause class: `persisted_state_bug`
- Validation target: design_experiments backward-jump → implement_experiments re-run
- Reproduction: After `analyze_results` triggers a backward jump to `design_experiments`, the plan is redesigned and `experiment_plan.yaml` is updated. When `implement_experiments` re-runs, the LLM sees the old verified script, decides it's "good enough," and produces zero file changes. The verify step passes (syntax-only check), and auto-handoff sends the unchanged old script to `run_experiments`.
- Expected behavior: `implement_experiments` should detect that the experiment plan changed and force re-implementation.
- Actual behavior: `workspace_changed_files.json` shows `"files": []`. Old script runs unchanged.
- Root cause: Five gaps in `ImplementSessionManager`:
  1. No plan hash comparison — can't detect that the plan changed
  2. No drift warning in LLM prompt — LLM defaults to reusing old script
  3. Early exit on verification pass without checking changes
  4. Auto-handoff ignores workspace change count
  5. Plan hash never saved to RunContext
- Fix (in `src/core/agents/implementSessionManager.ts`):
  1. Added `createHash` import and plan hash computation in `buildTaskSpec()`
  2. Added `plan_changed` and `plan_hash` fields to `ImplementTaskSpec.context`
  3. Compare current plan hash with stored `implement_experiments.plan_hash`
  4. Inject prominent drift warning in `buildAttemptPrompt()` when plan changed
  5. Save plan hash to RunContext after implementation
  6. Block auto-handoff when `plan_changed && workspaceChangedFiles.length === 0`
- Tests: Added regression test "blocks auto-handoff when experiment plan changed but script was not updated" in `tests/implementSessionManager.test.ts` — 855 tests passing.
- Regression: None observed.

### LV-019 — Backward jump does not reset target node to pending
- Status: FIXED
- Root-cause class: `persisted_state_bug`
- Validation target: analyze_results → backward jump to design_experiments
- Reproduction: After analyze_results detects objective not met and recommends backward jump to design_experiments, the jump resets all nodes _after_ the target to "pending" but leaves the target node itself with its old status ("skipped"). This causes the pipeline to be stuck — design_experiments cannot be re-executed.
- Root cause: In `StateGraphRuntime.jumpToNode()`, the backward-jump reset loop started at `targetIdx + 1` instead of `targetIdx`, so the target node was never reset.
- Fix: Changed loop start from `targetIdx + 1` to `targetIdx` in `src/core/stateGraph/runtime.ts` line 496.
- Tests: Added regression test "backward jump resets the target node itself to pending (LV-019)" in `tests/stateGraphRuntime.test.ts` — all 10 tests passing.
- Regression: None observed.

## Live-validation bugs

### LV-018 — Objective evaluation matches wrong metric key
- Status: FIXED
- Root-cause class: `in_memory_projection_bug`
- Validation target: analyze_results → objective_evaluation.json metric matching
- Reproduction: Run with metrics.json using `baseline_metrics`/`routed_metrics` structure and `primary_metric` as nested object. The objective evaluation matched `secondary_metrics.mean_generated_tokens_delta_vs_baseline` (117.5) instead of `accuracy_delta_vs_baseline` (-0.243), producing a false "met" status.
- Root cause: `findMatchingMetric` partial matching phase matched the generic preferred key `delta_vs_baseline` as a substring of `secondarymetricsmeangeneratedtokensdeltavsbaseline`. Also, `synthesizeRelativeMetrics` only handled `conditions` arrays, not `baseline_metrics`/`routed_metrics` structure, and `primary_metric` as a nested object was not promoted to a flat key.
- Fix:
  1. Added `promotePrimaryMetric()` to extract `primary_metric.value` as a top-level flat key
  2. Extended `synthesizeRelativeMetrics()` to handle `baseline_metrics` + `*_metrics` structure
  3. Tightened `findMatchingMetric` partial matching: requires ≥10 char target and ≥40% coverage of the matched key
- Tests: 2 regression tests in `tests/objectiveMetric.test.ts` — 853 total tests passing
- Regression: None observed

## Research completion risks

### R-001 — Paper-ready evidence still weaker than workflow completion evidence
- Status: ADDRESSED
- Resolution:
  - `design_experiments` now writes `baseline_summary.json` (comparator/baseline info)
  - `analyze_results` now writes `result_table.json` (compact quantitative result table)
  - `review` gate reads both artifacts; missing all 3 key artifacts → `blocked_for_paper_scale`
  - This ensures paper-readiness cannot be claimed without materialized evidence artifacts

### R-002 — Scientific gate warnings remain non-blocking but unresolved
- Status: ADDRESSED
- Resolution:
  - `write_paper` now populates `bundle.gateWarnings` from non-blocking gate issues
  - `scientificWriting.ts` limitations section builder appends gate warning categories as explicit limitation sentences
  - `applyGateWarningsToLimitations()` enriches the draft's limitations section post-hoc
  - Gate warnings are now visible in the manuscript rather than silently dropped

### R-003 — Risk of system-validation paper shape instead of experiment paper
- Status: ADDRESSED
- Resolution:
  - `classifyManuscriptType` in `paperCritique.ts` now checks `baselineSummaryPresent`, `resultTablePresent`, `richnessSummaryPresent`
  - All 3 missing → `blocked_for_paper_scale`
  - ≥2 missing → capped at `research_memo`
  - `richnessReadiness === "insufficient"` → capped at `research_memo`
  - This structurally prevents a system-validation-only package from reaching `paper_ready`

## Paper readiness risks

### P-001 — Baseline/comparator may be too weak or under-specified
- Status: ADDRESSED
- Resolution:
  - `design_experiments` node now writes `baseline_summary.json` with `baseline_conditions`, `treatment_conditions`, `comparison_metric`, `justification`
  - Review gate checks for this artifact and downgrades manuscript type when missing

### P-002 — Quantitative result packaging may be insufficient
- Status: ADDRESSED
- Resolution:
  - `analyze_results` node now writes `result_table.json` with `conditions`, `comparisons`, `primary_metric`, `summary`
  - Review gate checks for this artifact and downgrades manuscript type when missing

### P-003 — Related-work depth may still be shallower than needed
- Status: ADDRESSED
- Resolution:
  - `analyze_papers` node now writes `analyze_papers_richness_summary.json` with `total_papers`, `full_text_count`, `abstract_fallback_count`, `fulltext_coverage_pct`, `readiness`
  - Readiness classification: ≥5 full-text + ≥50% → adequate; ≥3 full-text → marginal; else insufficient
  - Review gate reads `richnessReadiness` and caps at `research_memo` when insufficient

## Next paper-scale iteration template

### Paper-scale Iteration N
- Goal:
- Research question:
- Why this is testable with a small real experiment:
- Corpus adequacy summary:
  - total collected:
  - full-text grounded:
  - comparator family coverage:
- Baseline/comparator:
- Dataset/task/metric:
- What was actually executed:
- Quantitative result summary:
- Claim→evidence status:
- Paper-readiness decision:
  - `paper_ready`
  - `paper_scale_candidate`
  - `research_memo`
  - `system_validation_note`
  - `blocked_for_paper_scale`
- Missing artifacts:
- Next action:
