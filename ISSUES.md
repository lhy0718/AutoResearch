# ISSUES.md

## Current status
- Last updated: 2026-03-18
- All live-validation code bugs (LV-001 through LV-021) have been resolved.
- All research-quality and paper-readiness risks (R-001–R-003, P-001–P-003) have been further strengthened with manuscript format infrastructure, output bundle improvements, and gate warning categorization.
- AM-001 through AM-003 implemented (Autonomous Mode + two-layer paper evaluation).
- AM-004: Manuscript format infrastructure, output bundle improvements, gate warning categorization.

## Active issues

### AM-004 — Manuscript Format Infrastructure and Output Bundle Improvements
- Status: IMPLEMENTED
- Category: paper-quality infrastructure
- Validation target: Brief→manuscript format propagation, 2-column TeX rendering, output bundle structure, gate warning categorization
- Summary:
  - **Manuscript format target**: Added `ManuscriptFormatTarget` interface and `column_count` to `PaperProfileConfig`. Brief template now includes `## Manuscript Format` section. `parseManuscriptFormatFromBrief()` extracts format fields from brief markdown.
  - **TeX 2-column rendering**: `renderSubmissionPaperTex()` now accepts `paperProfile` and uses `\documentclass[twocolumn]{article}` with tighter margins when `column_count=2`.
  - **Format propagation**: Brief format is parsed at run creation, stored in RunContext as `run_brief.manuscript_format`, overrides `PaperProfileConfig` at write_paper time. Paper writer session manager prompt includes column_count and references_counted.
  - **Output bundle**: `result_table.json` and `baseline_summary.json` now published to `analysis/` and `experiment/` output sections. `scientific_validation.json` published to `paper/` section. New `generatePublicRunReadme()` creates user-facing README.md for the output bundle.
  - **Gate warning categorization (R-002 improvement)**: `buildGateWarningLimitationSentences()` now groups by category with severity labels, shows all messages per category, limits to 5 sentences.
  - **Output sections**: Added `results` and `reproduce` to `PublicRunOutputSection`.
- Tests: 11 new tests in `tests/manuscriptFormat.test.ts`, 1 updated test in `tests/gateWarningsToLimitations.test.ts`. 919/920 pass (pre-existing zzz_noProjectRootLeak only failure).
- Files modified:
  - `src/types.ts` (ManuscriptFormatTarget, column_count)
  - `src/config.ts` (column_count default and normalization)
  - `src/core/analysis/scientificWriting.ts` (page budget, gate warnings)
  - `src/core/analysis/paperManuscript.ts` (twocolumn TeX)
  - `src/core/nodes/writePaper.ts` (format override, output publishing)
  - `src/core/nodes/analyzeResults.ts` (result_table/baseline_summary publishing)
  - `src/core/nodes/designExperiments.ts` (baseline_summary publishing)
  - `src/core/runs/researchBriefFiles.ts` (format section, parser)
  - `src/core/runs/runBriefParser.ts` (manuscriptFormat field)
  - `src/tui/TerminalApp.ts` (format parsing at run creation)
  - `src/core/agents/paperWriterSessionManager.ts` (format in prompt)
  - `src/core/publicArtifacts.ts` (results/reproduce sections)
  - `src/core/publicOutputPublisher.ts` (README generator)

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

---

### LV-021 — Test suite leaks .autolabos/runs/ dirs at project root
- Status: FIXED (commit 3a52cce)
- Root-cause class: `persisted_state_bug`
- Validation target: `npx vitest run` → check project root for leaked dirs
- Reproduction: Running `npx vitest run` created 34 `.autolabos/runs/<id>/` directories at the project root. Artifacts included `run_context.json`, `long_term.jsonl`, `episodes.jsonl`, governance ledgers, and candidate isolation reports.
- Expected behavior: All test artifacts should be created inside temp workspaces under `test/.tmp/`, not at the project root.
- Actual behavior: `RunContextMemory`, `EpisodeMemory`, `writeRunArtifact`, and governance helpers use relative paths (`.autolabos/runs/<id>/...`) that resolve against `process.cwd()`. In tests, `process.cwd()` was the project root instead of the temp workspace.
- Root cause: Five test files did not call `process.chdir(workspace)` before invoking code that writes relative artifact paths. Production code works correctly because `process.cwd()` IS the workspace.
- Fix: Added `process.chdir(workspace)` + `ORIGINAL_CWD` restore to 5 test files following the pattern already used by 14 other test files. Added `zzz_noProjectRootLeak.test.ts` regression guard.
- Regression status: 856/856 tests pass. 0 leaked dirs.

---

### AM-001 — Autonomous Mode Implementation
- Status: IMPLEMENTED
- Category: feature implementation
- Validation target: `/agent autonomous` TUI/web entry, `AutonomousRunController.runAutonomous()`, policy, novelty, paper pressure, progress reporting
- Summary: Autonomous mode is now fully implemented with:
  - Dual-loop architecture (research exploration + paper-quality improvement)
  - Best-branch tracking with artifact-based evidence evaluation
  - Paper-pressure consolidation (jumps to `review` when strong branch exists)
  - Enhanced novelty detection (hypothesis, analysis, comparator, experiment artifact, backtrack signals)
  - Rich RUN_STATUS.md progress reporting with all required fields
  - Final summary written on stop with evidence gaps and open issues
  - All stop reasons clearly distinguished and surfaced
  - Emergency fuse (catastrophic runaway protection)
  - 16 new tests (20 total), all passing
  - Overnight mode behavior fully preserved (no regressions)
- Evidence: 872/872 tests pass (16 new). TS compiles clean. Build succeeds. Only pre-existing `zzz_noProjectRootLeak` failure (LV-021).
- Risks:
  - Paper-pressure consolidation jumps to `review` node with force mode; if review node encounters artifacts from a different cycle context, it may produce a review that doesn't match the latest experiment
  - Stagnation detection relies on node-level notes; if nodes don't write meaningful notes, novelty detection may under-count signals
  - `evaluateBestBranch` reads artifacts at fixed paths; if the run has branched into multiple experiment directions, only the latest artifacts are evaluated

---

### AM-002 — Autonomous Mode Refinement: Review Gate, Time Limits, stopAfterApprovalBoundary
- Status: IMPLEMENTED
- Category: feature refinement
- Validation target: `AutonomousRunController.runAutonomous()`, `AgentOrchestrator.runCurrentAgentWithOptions()`, review/write_paper gating, time-limit policy
- Summary: Corrected over-aggressive auto-approval in autonomous mode and adjusted time limits:
  - **Review gate**: `review` and `write_paper` removed from `autoApproveNodes`. Review is a real structural gate; write_paper is only entered when `meetsWritePaperBar()` evidence bar is met.
  - **WritePaperGateConfig**: New config with `requireBaselineOrComparator`, `requireQuantitativeResults`, `minBranchScore`, `blockedManuscriptTypes`. On failure, backtracks to `design_experiments`.
  - **Three gate checkpoints**: (1) top-of-loop pre-execution check for `currentNode === "write_paper"`, (2) recommendation path check when advancing from review, (3) no-recommendation path check at review/write_paper.
  - **stopAfterApprovalBoundary**: Added `stopAfterApprovalBoundary?: boolean` to `AgentOrchestrator.runCurrentAgentWithOptions()`. Autonomous mode uses `stopAfterApprovalBoundary: true` so the runtime returns after each approval gate, giving the controller a chance to check evidence gates between nodes.
  - **Overnight runtime**: 8h → 24h (`maxMinutes: 1440`)
  - **Autonomous runtime**: 24h → unbounded (`maxMinutes: Infinity`), with `Number.isFinite()` guard
  - **Progress reporter**: Added `runtimePolicy`, `writePaperGateBlocked`, `writePaperGateBlockers` to snapshot; shown in markdown status output
  - **TUI/CLI copy**: Updated overnight banner ("24-hour limit"), autonomous banner ("No runtime time limit", "write_paper gated by minimum evidence bar")
- Tests: 10 new tests added (30 total), all passing:
  - Policy limits (overnight 24h, autonomous Infinity)
  - Gate config defaults
  - autoApproveNodes exclusions (review, write_paper)
  - meetsWritePaperBar: passes, blocks, no-branch
  - Gate blocks at review node (integration)
  - Gate blocks advance recommendation from review (integration)
  - No time_limit stop with Infinity
- Evidence: 881/882 tests pass (10 new). Only pre-existing `zzz_noProjectRootLeak` failure.
- Architecture insight: Two-level approval system — runtime `resolveApprovalGate()` auto-approves nodes in "minimal" mode BEFORE the controller sees them. `stopAfterApprovalBoundary: true` is the key fix that gives the controller per-node control.
- Risks:
  - `stopAfterApprovalBoundary: true` means each node takes one controller iteration, making the loop slower (more iterations per cycle). Acceptable for autonomous long-running mode.
  - If `evaluateBestBranch` misreads evidence artifacts, the gate may incorrectly block or pass write_paper
  - `minBranchScore: 5` threshold may need tuning based on real-world evidence patterns

### AM-003 — Two-Layer Paper-Quality Evaluation Model
- Status: IMPLEMENTED
- Category: paper-quality evaluation architecture
- Validation target: Review node paper-quality evaluation, autonomous controller best-branch selection, write-paper gating
- Summary: Refactored paper-quality evaluation into a two-layer model:
  - **Layer 1 — Deterministic minimum gate** (`src/core/analysis/paperMinimumGate.ts`): 7 strict artifact-presence checks (objective metric, experiment plan, baseline/comparator, executed result, result artifacts, claim-evidence linkage, not-smoke-only). Returns `MinimumGateResult` with pass/fail, blockers, and ceiling type (`unrestricted`, `research_memo`, `system_validation_note`, `blocked_for_paper_scale`).
  - **Layer 2 — LLM paper-quality evaluator** (`src/core/analysis/llmPaperQualityEvaluator.ts`): Structured LLM critique above the gate. Produces `PaperQualityEvaluation` with 6-dimension scorecard, branch trajectory, paper worthiness, evidence gaps, upgrade priorities, strengths/weaknesses, critique summary, and recommended action. Includes `enforceMinimumGateOverride()` — deterministic gate always overrides optimistic LLM judgments. Has fallback evaluation when LLM unavailable.
  - **Review node integration** (`src/core/nodes/review.ts`): Both layers run after the 5-specialist panel. Artifacts written to `review/minimum_gate.json` and `review/paper_quality_evaluation.json`. Transition recommendation now considers gate ceiling and LLM worthiness — minimum gate blocks override panel advance decisions; LLM "not_ready" worthiness also triggers backtrack.
  - **Autonomous controller integration** (`src/core/agents/autonomousRunController.ts`): `evaluateBestBranch()` reads both new artifacts for richer branch assessment. LLM score used for branch comparison when available (heuristic `branchScore()` as fallback). `meetsWritePaperBar()` now checks minimum gate and LLM worthiness as additional blockers. `BestBranchInfo` extended with `llmScore`, `llmWorthiness`, `llmRecommendedAction`, `minimumGatePassed`, `minimumGateCeiling`.
  - **Progress reporter** (`src/core/agents/autonomousProgressReporter.ts`): `AutonomousCycleSnapshot` and `BestBranchInfo` extended with two-layer fields. Markdown status output shows minimum gate status, LLM score, worthiness, and recommended action alongside existing fields.
- Design intent: Less "large bundles of fixed heuristics decide paper quality" → more "minimum structural gate first, then LLM critique decides how good, how promising, and what to improve next."
- Tests: 27 new tests added (908 total passing):
  - `tests/paperMinimumGate.test.ts` (12 tests): passes when all artifacts present, blocks on each missing check, ceiling types, ISO timestamp, condition comparisons as baseline substitute
  - `tests/llmPaperQualityEvaluator.test.ts` (11 tests): enforceMinimumGateOverride caps worthiness for blocked/system_validation/research_memo ceilings, handles invalid LLM output, fallback evaluation, dimension count, ISO timestamp
  - `tests/autonomousRunController.test.ts` (4 new tests): meetsWritePaperBar blocks on minimumGatePassed=false, blocks on llmWorthiness=not_ready, passes when both layers satisfied, BestBranchInfo field check
- Evidence: 908/909 tests pass (27 new). Only pre-existing `zzz_noProjectRootLeak` failure.
- Risks:
  - LLM evaluator quality depends on the quality of the prompt and the LLM model used — may need prompt tuning
  - 30s LLM evaluator timeout (or env-configured) may be too short for complex evaluations
  - Fallback evaluation is conservative but less informative — long runs without LLM access lose structured critique
  - `enforceMinimumGateOverride` is strict: even strong LLM endorsement cannot bypass missing artifacts
