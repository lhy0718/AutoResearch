# ISSUES.md

Last updated: 2026-04-03

This file was compacted on 2026-03-22 to remove duplicated template fragments, malformed partial entries, and conflicting reused LV identifiers. Detailed pre-cleanup prose remains in git history.

Usage rules:
- `ISSUES.md` is for reproduced live-validation defects and tracked research/paper-readiness risks.
- `TODO.md` is for forward-looking follow-ups, proposal-only work, and backlog items.
- Canonical workflow and policy still live in `AGENTS.md` and `docs/`.

---

## Current active status

- Active live-validation defects:
  - None currently open.
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

- None currently open.

---

## Research and paper-readiness watchlist

These are not active interactive defects. They stay here as mitigated or watchlist-style research/paper-readiness risks so they do not get lost in the fixed live-validation timeline.

### R-001 — Result-table discipline and claim→evidence linkage
- Status: MITIGATED
- What was done: `design_experiments` writes `baseline_summary.json`; `analyze_results` writes `result_table.json`; `review` gate checks both and blocks when missing.
- Remaining risk: quality of content inside these artifacts still depends on the generated analysis.

### R-002 — Scientific gate warnings surfacing
- Status: MITIGATED
- What was done: gate warnings are grouped by category with severity labels and surfaced as limitation sentences in the manuscript.
- Remaining risk: categories are still coarse and can require operator review.

### R-003 — System-validation paper shape over-promotion
- Status: MITIGATED
- What was done: manuscript classification now downgrades missing-baseline / missing-results / missing-richness cases.
- Remaining risk: a structurally complete fake-mode run can still look stronger than the underlying evidence.

### P-001 — Baseline/comparator packaging
- Status: MITIGATED
- What was done: `baseline_summary.json` is written by `design_experiments`; review downgrades when missing.

### P-002 — Compact quantitative result packaging
- Status: MITIGATED
- What was done: `result_table.json` is written by `analyze_results`; review downgrades when missing.

### P-003 — Related-work depth signaling
- Status: MITIGATED
- What was done: `analyze_papers_richness_summary.json` tracks full-text coverage and feeds readiness classification.
- Remaining risk: full-text grounding still depends on PDF availability.

---

## Historical archive

Older fixed live-validation entries, compact archived summaries, and legacy draft items have been moved out of this main operator-facing file.

If we need to resurrect one of those older cases, use git history rather than treating them as current active work.
