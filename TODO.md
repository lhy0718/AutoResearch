# TODO

Operator follow-ups and proposal-only backlog for AutoLabOS.

Scope rules:
- This file is for pending follow-ups, operator UX backlog, and proposal-only items.
- This file does not replace `ISSUES.md`.
- `ISSUES.md` stays reserved for live-validation defects, runtime blockers, and reproducible issues.
- Canonical contracts still live in `AGENTS.md` and `docs/`.

## Now

- Refine `paper/manuscript_quality_*` wording so operator-facing summaries do not show confusing labels like `Reason category: Clean Pass.` on stopped manuscript-quality runs.
  - Keep the existing artifact family.
  - Limit the change to clearer presentation / mapping, not a new manuscript-quality contract.

- Decide whether `required` network runs should surface with a stronger readiness risk signal than `declared` runs outside `/doctor` as well.
  - Current `/doctor` emphasis is stronger.
  - Follow-up is whether `/jobs`, run detail, and readiness-risk rollups should also differentiate them more sharply.

- Review temp/live-validation workspace completeness policy.
  - Current live-validation temp workspaces can legitimately fail `/doctor` because they omit `ISSUES.md`, `events.jsonl`, or some review artifacts.
  - Decide whether these fixtures should stay intentionally incomplete or gain a documented reduced-contract mode.

## Next

- Add a stage-by-stage human-readable operator history if we want more than the latest `operator_summary.md`.
  - Current behavior is additive but latest-stage-oriented.
  - If needed, add a separate stage timeline helper instead of mutating canonical artifacts.

- Add a per-run completeness checklist artifact summarizing:
  - `run_record.json`
  - `events.jsonl`
  - checkpoints
  - key node artifacts
  - public mirror presence
  - This should be additive and should not replace harness validation.

- Improve web/TUI live-validation automation around the Doctor tab and command flows.
  - The repo now has real browser/TUI validation seams, but the ad hoc browser script used during validation is not committed as a first-class test utility.
  - If this becomes recurring, promote it into a repo-owned validation helper.

## Later

- Extend `VerifiedRegistry` beyond metadata verification toward bounded full-content equivalence checks.
  - Current state:
    - local corpus diagnosis
    - bounded external metadata lookup
    - repair/reject logging
  - Not yet implemented:
    - DOI landing content checks
    - arXiv page/content comparison
    - stronger content-level equivalence heuristics

- Add a documented workflow-change proposal template in `docs/` for future cases where the fixed 9-node structure may need review.
  - This is documentation only.
  - It should include:
    - affected node(s)
    - preserved contracts
    - rollback safety
    - review-gate impact

- Consider a dedicated operator note mapping between public outputs and run-scoped artifacts.
  - Current `operator_summary.md` is helpful but not yet a full artifact-to-output map.
  - Keep this additive and human-readable only.

## Proposal-only

These came up in planning but are not current AutoLabOS contract and should not be treated as implemented behavior.

- `GATE_MODE=human` / `none` / `auto` style gate control
  - Current repo contract uses `approval_mode` and `execution_approval_mode`.
  - Any `GATE_MODE`-style surface would be a new policy layer.

- `THEORY_PIPELINE` and `THEORY_MAX_ITERATIONS`
  - Mentioned as useful theory-mode controls.
  - Not part of the current repo contract.

- OpenClaw-style long-running bridge adapters:
  - `use_message`
  - `use_cron`
  - `use_sessions_spawn`
  - `use_web_fetch`
  - `use_browser`
  - These should stay proposal-only until explicitly designed into current operator/runtime contracts.

- `results-analysis` and `results-report` as new canonical artifact families
  - Current repo contract keeps existing per-run JSON artifacts as canonical.
  - Human-readable reporting should remain a thin helper layer unless the artifact contract is intentionally revised.

- Venue-pattern writing memory with strong trust scoring and automatic reload behavior
  - `EpisodeMemory` exists, but venue-style memory is not a current write-paper contract.
  - If adopted, it should start as advisory-only and stay clearly separated from hard gates.

- Community template registry with mandatory schema/routing/reproducibility gating
  - Useful future direction, especially for experiment template intake.
  - Not yet a current top-level AutoLabOS contract.

## Not In Current Contract

- Any new top-level workflow node
- Any redefinition of `review` as merely a polish stage
- Any reporting layer that replaces canonical per-run artifacts
- Any new orchestration engine that bypasses `runs.sqlite` / `run_record.json` / `events.jsonl`

