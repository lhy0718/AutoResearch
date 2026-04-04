# ISSUES.md

Last updated: 2026-04-04

This file was compacted on 2026-03-22 to remove duplicated template fragments, malformed partial entries, and conflicting reused LV identifiers. Detailed pre-cleanup prose remains in git history.

Usage rules:
- `ISSUES.md` is for reproduced live-validation defects and tracked research/paper-readiness risks.
- `TODO.md` is for forward-looking follow-ups, proposal-only work, and backlog items.
- Canonical workflow and policy still live in `AGENTS.md` and `docs/`.

---

## Current active status

- Active live-validation defects:
  - `LV-085` implement-stage materialization boundary
  - `LV-086` preflight metrics over-promoted as executed evidence
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

## Issue: LV-085

- Status: active
- Validation target: real `test/`-workspace governed run for the LoRA rank × dropout factorial brief
- Environment/session context: fresh live TUI run in `test/`, run id `1f46de0f-5beb-4de6-a219-abf483b74101`, current node `implement_experiments`

- Reproduction steps:
  1. Start the real run from `test/` with the governed brief for the Mistral-7B LoRA rank/dropout sweep.
  2. Let the run progress through `collect_papers`, `analyze_papers`, `generate_hypotheses`, and `design_experiments`.
  3. Allow `implement_experiments` to repair after the earlier stale `peft` runner feedback.
  4. Observe the third implementation attempt fail before `run_experiments` is allowed to rerun.

- Expected behavior:
  - `implement_experiments` should validate runnable public artifacts such as the experiment script, config, and docs.
  - Run-owned execution outputs like `.autolabos/runs/<run-id>/metrics.json` should not be required to already exist before `run_experiments` executes.

- Actual behavior:
  - `implement_experiments` fails with:
    - `Implementer referenced artifact(s) that were not materialized: .autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/metrics.json`
  - The node then retries instead of handing the current experiment harness back to `run_experiments`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in the active live run
  - Existing session: not yet compared after this exact failure mode
  - Divergence: unknown

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the implement-stage artifact materialization check treats run-owned execution outputs such as `metrics.json` as if they must already be present during `implement_experiments`, even though those files are supposed to be produced by `run_experiments`.

- Code/test changes:
  - Code: pending
  - Tests: pending

- Regression status:
  - Automated regression test linked: no
  - Re-validation result: pending

- Follow-up risks:
  - The same validator boundary may also incorrectly require other run-owned execution artifacts before second-stage verification.
- Evidence/artifacts:
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/events.jsonl`
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/run_record.json`
  - `test/outputs/lora-rank-dropout-interaction-for-mistral-7b-ins-1f46de0f/experiment/experiment.py`

## Issue: LV-086

- Status: active
- Validation target: real `test/`-workspace governed run for the LoRA rank × dropout factorial brief after `run_experiments`
- Environment/session context: same fresh live run `1f46de0f-5beb-4de6-a219-abf483b74101`, artifacts inspected after `run_experiments` completed and `analyze_results` paused

- Reproduction steps:
  1. Start the real run from `test/` with the governed LoRA rank/dropout brief.
  2. Let `implement_experiments` and `run_experiments` complete.
  3. Inspect `.autolabos/runs/<run-id>/metrics.json` and `analysis/result_table.json`.
  4. Observe that the recorded metrics come from `mode: "preflight"` with no training or evaluation executed.

- Expected behavior:
  - `run_experiments` should not treat preflight-only environment checks as successful executed experiment evidence for this paper-scale brief.
  - Objective evaluation should not infer research success from hardware/resource fields such as `device.gpu_count` when the stated objective is benchmark accuracy on ARC-Challenge and HellaSwag.

- Actual behavior:
  - `metrics.json` contains:
    - `mode: "preflight"`
    - `notes: "No training/evaluation executed..."`
    - `primary_metric: null`
  - `run_experiments` still completes and summarizes:
    - `Objective metric met: device.gpu_count=2 >= 0.015`
  - `analyze_results` then builds a results table from hardware/resource fields and pauses only later with `incomplete_results_table`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in the active live run
  - Existing session: not yet compared after this exact failure mode
  - Divergence: unknown

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `run_experiments` currently accepts preflight-only metrics as a successful execution artifact, and the best-effort objective matcher is willing to promote resource metrics (for example `device.gpu_count`) into the objective summary even when no task metric exists.

- Code/test changes:
  - Code: pending
  - Tests: pending

- Regression status:
  - Automated regression test linked: no
  - Re-validation result: pending

- Follow-up risks:
  - Even when later gates pause the workflow, the misleading “objective met” summary can contaminate operator interpretation, review context, and any quality-improvement loop that reads `paper_readiness`-adjacent artifacts.
- Evidence/artifacts:
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/metrics.json`
  - `test/outputs/lora-rank-dropout-interaction-for-mistral-7b-ins-1f46de0f/analysis/result_table.json`
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/run_record.json`

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
