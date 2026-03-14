# Reproducibility Expectations

Reproducibility claims must be backed by concrete artifacts.

## 1) Minimum artifact set (when applicable)

- Raw or summarized metrics (`metrics.json`, supplemental metrics)
- Objective evaluation (`objective_evaluation.json`)
- Result synthesis (`result_analysis.json`, optional synthesis artifact)
- Paper trace outputs (`paper/main.tex`, `paper/references.bib`, `paper/evidence_links.json`)

## 2) Run-state traceability

For each run, preserve:

- run id
- workflow node progression (`runs.json`)
- key generated artifacts in `.autolabos/runs/<run_id>/...`

## 3) Reproducibility claim language

- If required artifacts are missing, do not claim reproducibility is satisfied.
- Use weaker language when evidence is partial.

## 4) Contributor workflow

Before marking work complete:

1. Re-run the relevant flow or tests.
2. Confirm expected artifacts are present and parseable.
3. Record limitations and unresolved uncertainty.

## 5) Validation surfaces

- Runtime diagnostics: `/doctor` in TUI and web Doctor tab (environment + workspace harness checks).
- CI/internal gate: `npm run validate:harness` (issue log format + workspace/test run artifact structure).

No separate end-user command is required beyond `/doctor`.
