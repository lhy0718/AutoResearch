# Reproducibility Expectations

Reproducibility claims must be backed by concrete artifacts.

## 1) Minimum artifact set (when applicable)

- Runtime event trace (`events.jsonl`)
- Deferred background recovery record when used (`collect_background_job.json`)
- Planned portfolio / trial-group structure (`experiment_portfolio.json`)
- Run manifest (`run_manifest.json`)
- Matrix trial-group index when managed bundle execution materializes dataset/profile slices (`trial_group_matrix.json`)
- Per-slice managed trial-group metrics when present (`trial_group_metrics/*.json`)
- Raw or summarized metrics (`metrics.json`, supplemental metrics)
- Objective evaluation (`objective_evaluation.json`)
- Result synthesis (`result_analysis.json`, optional synthesis artifact)
- Transition decision (`transition_recommendation.json`)
- Paper trace outputs (`paper/main.tex`, `paper/references.bib`, `paper/evidence_links.json`)

## 2) Run-state traceability

For each run, preserve:

- run id
- workflow node progression (`runs.json`) including current node/status, pending transition state, and aggregate usage when available
- optional operational sqlite index (`.autolabos/runs/runs.sqlite`) when present; treat it as a hot-path mirror of run-index metadata plus usage/checkpoint/event/artifact lookup tables rather than as the sole reproducibility artifact
- full persisted run snapshot (`.autolabos/runs/<run-id>/run_record.json`) when debugging run-state divergence or replaying control-flow decisions
- append-only runtime events (`events.jsonl`)
- key gate/recovery artifacts (`transition_recommendation.json`, `collect_background_job.json` when present)
- key generated artifacts in `.autolabos/runs/<run_id>/...`, including trial-group matrix artifacts when present

## 3) Reproducibility claim language

- If required artifacts are missing, do not claim reproducibility is satisfied.
- Use weaker language when evidence is partial.

## 4) Contributor workflow

Before marking work complete:

1. Re-run the relevant flow or tests.
2. Confirm expected artifacts are present, parseable, and consistent across `runs.json`, `run_record.json` when present, optional `runs.sqlite` mirrors/indexes, `events.jsonl`, checkpoints, and other run-scoped artifacts.
3. Record limitations and unresolved uncertainty.

## 5) Validation surfaces

- Runtime diagnostics: `/doctor` in TUI and web Doctor tab (environment + workspace harness checks).
- CI/internal gate: `npm run validate:harness` (issue log format + workspace/test run artifact structure, including event logs and portfolio/manifest contracts).

No separate end-user command is required beyond `/doctor`, but maintainers should still run `npm run validate:harness` before declaring artifact-level reproducibility complete.
