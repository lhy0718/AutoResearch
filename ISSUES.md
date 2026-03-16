# ISSUES.md

## Current status
- Last updated: 2026-03-17
- All live-validation code bugs (LV-001 through LV-018) have been resolved.
- All research-quality and paper-readiness risks (R-001–R-003, P-001–P-003) have been addressed with artifact materialization, gate strengthening, and gate-warning surfacing.

## Active issues

None

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
