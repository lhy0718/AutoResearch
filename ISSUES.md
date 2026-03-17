# ISSUES.md

Last updated: 2026-03-18 · 926/926 tests pass

---

## Open risks

### R-001 — Result-table discipline and claim→evidence linkage
- Status: MITIGATED
- What was done: `design_experiments` writes `baseline_summary.json`; `analyze_results` writes `result_table.json`; `review` gate checks both and blocks when missing.
- Remaining risk: Quality of content inside these artifacts depends on LLM output — not yet validated with a real end-to-end research run.

### R-002 — Scientific gate warnings surfacing
- Status: MITIGATED
- What was done: Gate warnings grouped by category with severity labels and surfaced as limitation sentences in the manuscript.
- Remaining risk: Categories are coarse; operator may still need manual inspection.

### R-003 — System-validation paper shape over-promotion
- Status: MITIGATED
- What was done: `classifyManuscriptType` checks `baselineSummaryPresent`, `resultTablePresent`, `richnessSummaryPresent`; all 3 missing → `blocked_for_paper_scale`; ≥2 missing → `research_memo`.
- Remaining risk: A fake-mode run can produce structural artifacts that pass the gate without real scientific content.

### P-001 — Baseline/comparator packaging
- Status: MITIGATED
- What was done: `baseline_summary.json` written by `design_experiments`; review gate downgrades when missing.

### P-002 — Compact quantitative result packaging
- Status: MITIGATED
- What was done: `result_table.json` written by `analyze_results`; review gate downgrades when missing.

### P-003 — Related-work depth signaling
- Status: MITIGATED
- What was done: `analyze_papers_richness_summary.json` with full-text coverage stats; readiness classification gates `review`.
- Remaining risk: Full-text grounding depends on Semantic Scholar PDF availability.

---

## Resolved issues (archived)

| ID | Summary | Root cause | Commit |
|----|---------|------------|--------|
| LV-021 | Test suite leaks `.autolabos/runs/` at project root | `persisted_state_bug` | 3a52cce, 78f7f88 |
| LV-020 | `implement_experiments` ignores experiment plan changes | `persisted_state_bug` | — |
| LV-019 | Backward jump doesn't reset target node to pending | `persisted_state_bug` | — |
| LV-018 | Objective evaluation matches wrong metric key | `in_memory_projection_bug` | — |
| LV-001–LV-017 | Various TUI/runtime bugs | mixed | — |
| AM-001 | Autonomous Mode implementation | feature | — |
| AM-002 | Review gate, time limits, stopAfterApprovalBoundary | feature | — |
| AM-003 | Two-layer paper-quality evaluation (deterministic gate + LLM) | feature | — |
| AM-004 | Manuscript format infrastructure, output bundle, gate warnings | feature | a0df12d |

---

## Iteration template

### Paper-scale Iteration N
- Goal:
- Research question:
- Baseline/comparator:
- Dataset/task/metric:
- Quantitative result summary:
- Claim→evidence status:
- Paper-readiness decision: `paper_ready` · `paper_scale_candidate` · `research_memo` · `system_validation_note` · `blocked_for_paper_scale`
- Missing artifacts:
- Next action:
