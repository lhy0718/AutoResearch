# ISSUES.md

## Current status
- Last updated: 2026-03-15T00:25:48 KST
- Current validation target: `test/` real TUI path `/new -> /brief start --latest` completes end-to-end with artifact/UI consistency checks
- Current test/ workspace: `test/tui-live-cycle-20260314-225525-iter8`
- Current active run: `a5dde90b-a4f8-44d1-be22-c1972cbdd3ed`
- Current overall state: done

## Active issues
- None (no blocking issue remains for the current validation target).

## Current iteration log
### Iteration 8
- Goal: finish live cycle through `write_paper` without stale/looping blocker.
- What was validated in `test/`:
  - persisted run status/checkpoints while `write_paper` executed
  - live artifact growth in `paper/` (`outline/draft/review/finalize`, gate artifacts)
  - existing-session vs fresh-read comparison for stale projection behavior
- What broke:
  - `write_paper` initially failed quality gate with `caption_internal_name`
  - `paperWriterSessionManager` stage timeout fallback (`90000ms`) repeatedly degraded stage outputs
- What changed:
  - `src/core/analysis/scientificWriting.ts`
    - sanitize internal-token captions before lint/gating
    - sanitize candidate/main/appendix visual captions in manuscript materialization
  - `src/core/agents/paperWriterSessionManager.ts`
    - disable default per-stage timeout by default (`DEFAULT_PAPER_WRITER_STAGE_TIMEOUT_MS = 0`)
    - apply timeout race only when explicit positive timeout is configured
  - `tests/scientificWriting.test.ts`
    - add regression for internal-token caption sanitization
- Tests run:
  - `npx vitest run tests/scientificWriting.test.ts`
  - `npx vitest run tests/paperWriterSessionManager.test.ts tests/scientificWriting.test.ts`
  - `npx vitest run tests/experimentGovernance.test.ts tests/objectiveMetricPropagation.test.ts tests/analyzePapers.test.ts tests/terminalAppPlanExecution.test.ts tests/interactionSession.test.ts tests/scientificWriting.test.ts tests/paperWriterSessionManager.test.ts`
- Re-validation result:
  - Run completed: `status=completed`, `currentNode=write_paper`, `checkpointSeq=42`
  - Final summary: LaTeX draft generated, scientific gate `warn(6)` (non-blocking), PDF build success
  - `paper/consistency_lint.json`: `manuscript.ok=true`, no `caption_internal_name`
  - Collection remained research-grade (`collect_result.json`: `stored=200`; scout `paper_count=40`)
- Decision: done
