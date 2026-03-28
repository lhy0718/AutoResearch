# TODO

Forward-looking follow-ups and proposal-only backlog for AutoLabOS.

Usage rules:
- This file is for pending follow-ups, operator UX backlog, and proposal-only work.
- This file does not replace `ISSUES.md`.
- `ISSUES.md` is reserved for reproduced live-validation defects and tracked research/paper-readiness risks.
- Canonical contracts still live in `AGENTS.md` and `docs/`.

## Now

- Make live-validation temp workspace builders emit `run_status.json` with `validation_scope=live_fixture`.
  - Current temp workspaces can still look noisier than intended in `/doctor` because legacy fixtures do not emit the new scope marker.
  - Keep this additive; do not weaken the default governed-run validator.

- Decide whether to add an additive backfill helper for legacy runs that predate `run_status.json`.
  - Current behavior is honest fallback projection.
  - Follow-up is whether a bounded backfill would improve operator surfaces without pretending old runs had artifacts they never wrote.

- Add a per-run completeness checklist artifact.
  - Summarize presence of `run_record.json`, `events.jsonl`, checkpoints, key node artifacts, and public mirrors.
  - Keep this separate from harness validation and do not turn it into a new gate by default.

## Next

- Strengthen `VerifiedRegistry` beyond metadata verification toward bounded content-equivalence checks.
  - Current state:
    - local corpus diagnosis
    - bounded external metadata lookup
    - repair/reject logging
  - Not yet implemented:
    - DOI landing content checks
    - arXiv page/content comparison
    - stronger content-level equivalence heuristics

- Promote the ad hoc real browser/TUI validation scripts into repo-owned validation helpers if they become recurring.
  - The repo now has real validation seams, but the live browser scripts used during recent work are still operator-local rather than first-class repo utilities.

- Add an additive artifact-to-output mapping helper note.
  - `operator_summary.md` is now clearer, but there is still no single thin helper that maps run-scoped canonical artifacts to public-facing outputs.

## Later

- Add a documented workflow-change proposal template in `docs/`.
  - Documentation only.
  - It should include:
    - affected node(s)
    - preserved contracts
    - review-gate impact
    - rollback safety

- Consider a richer operator-history browsing surface in TUI/web if `operator_history/*` becomes a frequent navigation target.
  - Keep `operator_history/*` additive and human-readable only.
  - Do not replace canonical JSON artifacts.

## Proposal-only

These came up in planning but are not current AutoLabOS contract and should not be treated as implemented behavior.

- `GATE_MODE=human` / `none` / `auto` style gate control
  - Current repo contract already uses `approval_mode` and `execution_approval_mode`.
  - Any `GATE_MODE`-style surface would be a new policy layer.

- `THEORY_PIPELINE` and `THEORY_MAX_ITERATIONS`
  - Mentioned as useful theory-mode controls.
  - Not part of the current repo contract.

- OpenClaw-style long-running bridge adapters
  - `use_message`
  - `use_cron`
  - `use_sessions_spawn`
  - `use_web_fetch`
  - `use_browser`
  - These stay proposal-only until they are explicitly designed into current operator/runtime contracts.

- `results-analysis` and `results-report` as new canonical artifact families
  - Current repo contract keeps existing per-run JSON artifacts as canonical.
  - Human-readable reporting should remain a thin helper layer unless the artifact contract is intentionally revised.

- Venue-pattern writing memory with strong trust scoring and automatic reload behavior
  - `EpisodeMemory` exists, but venue-style memory is not a current `write_paper` contract.
  - If adopted, it should start as advisory-only and stay clearly separated from hard gates.

- Community template registry with mandatory schema/routing/reproducibility gating
  - Useful future direction for experiment template intake.
  - Not yet a current top-level AutoLabOS contract.

## Not In Current Contract

- Any new top-level workflow node
- Any redefinition of `review` as merely a polish stage
- Any reporting layer that replaces canonical per-run artifacts
- Any new orchestration engine that bypasses `runs.sqlite` / `run_record.json` / `events.jsonl`
