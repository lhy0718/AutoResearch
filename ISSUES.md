# ISSUES.md

## Current status
- Last updated: 2026-03-17
- All live-validation code bugs (LV-001 through LV-017) have been resolved.
- Remaining items are research-quality and paper-readiness risks (not code bugs).

## Research completion risks

### R-001 — Paper-ready evidence still weaker than workflow completion evidence
- Status: open
- Blocking for paper-ready: yes
- Evidence:
  - end-to-end workflow is completed
  - `write_paper` completes
  - PDF build succeeds
  - but completion evidence is still stronger than experimental evidence
- Missing artifact:
  - stronger result table and clearer claim→evidence linkage
- Owner node:
  - `review`
  - `write_paper`
- Next action:
  - run `paper-scale-research-loop`
  - force paper-readiness downgrade unless experimental evidence improves

### R-002 — Scientific gate warnings remain non-blocking but unresolved
- Status: open
- Blocking for paper-ready: maybe
- Evidence:
  - scientific gate warns remain, even though they no longer block completion
- Missing artifact:
  - categorized warning summary
  - explicit resolution or limitation text in manuscript
- Owner node:
  - `review`
  - `write_paper`
- Next action:
  - select one representative warning
  - determine whether it is a true paper-quality blocker or only a style issue

### R-003 — Risk of system-validation paper shape instead of experiment paper
- Status: open
- Blocking for paper-ready: yes
- Evidence:
  - workflow validation artifacts are rich and easy to write around
  - this can crowd out external-task experimental contribution
- Missing artifact:
  - explicit downgrade logic in review
  - external-task experiment emphasis in manuscript plan
- Owner node:
  - `review`
  - `write_paper`
- Next action:
  - enforce `blocked_for_paper_scale` when baseline/result-table/claim-evidence mapping are missing

## Paper readiness risks

### P-001 — Baseline/comparator may be too weak or under-specified
- Status: open
- Blocking for paper-ready: yes
- Evidence:
  - paper-ready state requires explicit comparator discipline
- Missing artifact:
  - reviewer-readable baseline summary
- Owner node:
  - `design_experiments`
  - `run_experiments`
  - `review`
- Next action:
  - make comparator list explicit in experiment and paper artifacts

### P-002 — Quantitative result packaging may be insufficient
- Status: open
- Blocking for paper-ready: yes
- Evidence:
  - completion evidence exists, but result-table discipline may still be weak
- Missing artifact:
  - compact result table
  - numeric comparison summary
- Owner node:
  - `analyze_results`
  - `write_paper`
- Next action:
  - force result-table materialization before `paper_ready=true`

### P-003 — Related-work depth may still be shallower than needed
- Status: open
- Blocking for paper-ready: maybe
- Evidence:
  - workflow can complete with relatively shallow related-work positioning
- Missing artifact:
  - explicit full-text-grounded subset summary
- Owner node:
  - `collect_papers`
  - `analyze_papers`
  - `review`
- Next action:
  - separate shallow metadata coverage from paper-positioning-ready evidence

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
