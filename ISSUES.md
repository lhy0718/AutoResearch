# ISSUES.md

## Current status
- Last updated: 2026-03-17
- All live-validation code bugs (LV-001 through LV-017) have been resolved.
- All research-quality and paper-readiness risks (R-001–R-003, P-001–P-003) have been addressed with artifact materialization, gate strengthening, and gate-warning surfacing.

## Active issues

None

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
