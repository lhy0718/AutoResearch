# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

    # Install dependencies (also installs web sub-package)
    npm install

    # Build TypeScript + web UI bundle
    npm run build

    # Run all unit tests (vitest, file parallelism disabled)
    npm test

    # Watch mode during development
    npm run test:watch

    # Run a single test file
    npx vitest run tests/<test-file>.test.ts

    # Start TUI without build step
    npm run dev

    # Start local web UI (builds web assets, then launches server)
    npm run dev:web

    # Smoke tests
    npm run test:smoke:natural-collect
    npm run test:smoke:natural-collect-execute
    npm run test:smoke:all
    npm run test:smoke:ci

Smoke test env vars:
- `AUTOLABOS_FAKE_CODEX_RESPONSE=1`
- `AUTOLABOS_FAKE_SEMANTIC_SCHOLAR_RESPONSE=1`
- `AUTOLABOS_SMOKE_VERBOSE=1`

## Repository contract

Follow these first:

- `AGENTS.md`
- `README.md`
- `ISSUES.md`
- `docs/architecture.md`
- `docs/tui-live-validation.md`
- `docs/experiment-quality-bar.md`
- `docs/paper-quality-bar.md`
- `docs/reproducibility.md`
- `docs/live-validation-issue-template.md`
- `docs/research-brief-template.md`

Unless there is an explicit, justified contract change:
- preserve the top-level workflow contract
- prefer small, validated fixes over broad refactors
- keep `review` as a structural gate
- do not overclaim beyond artifacts
- do not confuse `workflow completed`, `write_paper completed`, `PDF built`, and `paper_ready`

## Architecture overview

AutoLabOS is a TypeScript/ESM CLI (`npm run build` → `dist/cli/main.js`) that automates the scientific research loop through a state-graph workflow.

Two UI surfaces share the same runtime:
- a slash-first TUI
- a local web ops UI

Workspace state lives under `.autolabos/` in the active project directory.

### Source layout

    src/
      cli/
      runtime/
      core/
        stateGraph/
        nodes/
        agents/
        analysis/
        commands/
        runs/
        memory/
        llm/
        collection/
        evaluation/
        experiments/
      integrations/
      interaction/
      tui/
      tools/
      web/
      config.ts
      types.ts
    web/
    tests/
    tests/smoke/
    .agents/skills/

### Important runtime facts

- Runtime bootstrap lives in `src/runtime/createRuntime.ts`
- Shared interaction/session logic lives in `src/interaction/InteractionSession.ts`
- TUI surface lives in `src/tui/`
- Web surface lives in `src/web/`
- Runs and artifacts are stored under `.autolabos/`
- Internal panels and review systems may exist inside nodes, but do not silently assume this changes the top-level workflow contract

## Required operating mode for real validation work

When the task is to run a real AutoLabOS TUI validation → fix → revalidation loop, use the following skills explicitly:

- `tui-live-validation`
- `tui-validation-loop-automation`
- `paper-scale-research-loop`
- `stale-state-triage`
- `execution-mode-matrix-validation`
- `paper-build-output-hygiene`

Use `tui-live-validation-research-loop` as the top-level operating skill when appropriate.

## Fixed broad research topic for validation loops

For the current research-validation loop, keep the broad topic fixed as:

**Efficient Test-Time Reasoning for Small Language Models**

Important:
- keep the broad topic fixed unless the user explicitly changes it
- do not lock one narrow hypothesis too early
- allow AutoLabOS to iteratively generate, test, revise, branch, and prune hypotheses inside this topic area
- the brief should define the broad topic, constraints, baselines/comparators, and evaluation plan
- hypotheses may evolve during the loop

## test/ is the live execution environment

For real TUI validation work:

- use `test/` itself as the active AutoLabOS execution environment
- do not default to creating `test/<run>/` workspaces unless runtime mechanics absolutely require nested internal run directories
- launch, resume, inspect, and validate TUI flows from `test/`
- keep automated tests under `tests/`
- do not confuse `test/` with `tests/`

If the runtime assumes a different workspace layout, fix it so `test/` can act as the direct operator-facing validation environment cleanly.

## Execution-mode coverage is mandatory

Do not validate only one happy-path mode.

Enumerate and validate all execution modes currently exposed by the repository, including when present:

- normal interactive TUI execution
- fresh-session execution
- resumed/existing-session execution
- unattended / long-running execution
- Overnight Mode
- Autonomous Mode
- draft / paper-generation paths
- any alternate entry path that materially changes runtime behavior, artifact generation, gating, or output layout

For each mode, verify:
- discoverability
- operator clarity
- policy/config activation
- artifact/output behavior
- resume/reload behavior when relevant
- review/write_paper gate behavior when relevant
- TeX→PDF behavior when relevant
- cross-mode regressions after each fix

Do not assume fixing one mode fixes all others.

## TUI validation loop rule

When doing real validation work, the loop must be:

1. run `/doctor` first
2. reproduce in a fresh session
3. compare against an existing/resumed session when relevant
4. record the issue in `ISSUES.md`
5. patch the smallest plausible root cause
6. add/update deterministic tests under `tests/`
7. rerun the same flow
8. check adjacent regressions
9. check cross-mode regressions
10. repeat until paper quality no longer improves

Do not stop merely because:
- one workflow run completed
- TeX was generated
- PDF was generated once

## ISSUES.md discipline

`ISSUES.md` is the live validation tracker.

Always record:
- validation target
- environment/session context
- reproduction steps
- expected behavior
- actual behavior
- fresh vs existing comparison
- dominant root-cause hypothesis
- code/test changes
- regression status
- follow-up risks

Use exactly one dominant taxonomy per issue:
- `persisted_state_bug`
- `in_memory_projection_bug`
- `refresh_render_bug`
- `resume_reload_bug`
- `race_timing_bug`

## Output hygiene and artifact-generation rules

AutoLabOS must generate its own artifacts.

Do not manually create, hand-author, or substitute:
- experiment summaries
- result artifacts
- research README artifacts
- TeX outputs
- PDF outputs
- paper bundle artifacts
- structured result summaries

If an expected artifact is missing or malformed:
- fix the relevant node
- fix the prompt
- fix the config
- fix the runtime path
- fix the wiring
- fix the bundling logic

Do not fake the output outside the product workflow.

### Output bundle rule

Reproducibility-facing outputs should be visible under:

- `test/output/README.md`
- `test/output/reproduce/`
- `test/output/results/`
- `test/output/paper/`
- `test/output/artifacts/`

If canonical runtime paths must remain elsewhere, keep them working, but also provide a coherent operator-facing bundle under `test/output/`.

Avoid:
- unnecessary files/folders
- duplicate summaries
- redundant artifacts
- scattered important outputs outside the intended run area

## Brief and manuscript-format requirements

The research brief must explicitly carry manuscript-format constraints:
- target column count
- target main-paper page budget
- whether References are excluded
- whether Appendices are excluded

For the current validation loop, require:
- 2 columns
- 8 pages main body
- References excluded from the page limit
- Appendices excluded from the page limit

These constraints must be actively used by manuscript generation to:
- plan section length
- control density
- avoid under-length drafts
- avoid uncontrolled overflow
- surface target violations
- report page-budget compliance or deviation in visible artifacts

## TeX → PDF validation rule

Do not stop at TeX generation alone.

During live validation:
- require TeX generation
- require actual PDF generation
- treat “TeX exists but PDF was not generated” as incomplete validation unless the failure is caused by a clearly documented environment/toolchain constraint
- if PDF generation fails, diagnose whether the cause is:
  - missing TeX toolchain
  - malformed generated TeX
  - missing assets / references / paths
  - runtime/output wiring

Record the failure in `ISSUES.md`, fix the smallest plausible root cause where possible, and rerun the TeX→PDF flow.

Do not manually author TeX or PDF as a substitute.

## Scientific writing / agent behavior principles

- Claims must not exceed what the evidence supports
- Weak evidence requires weaker language
- Manuscript completeness requires explicit method details, result variance or equivalent support, and internal consistency checks
- Use claim→evidence traceability
- Never fabricate statistics, confidence intervals, or reproducibility claims without artifacts
- Negative results are allowed, but they must be framed honestly
- Baseline/comparator, quantitative comparison, and claim→evidence linkage are required for serious paper-readiness claims
- `review` and `write_paper` must continue to respect evidence-quality gates

## Test conventions

- All unit tests are under `tests/` as `*.test.ts`
- Smoke tests live under `tests/smoke/`
- Tests frequently switch `process.cwd()` to isolated temp workspaces
- Run a single unit test with:
  - `npx vitest run tests/<name>.test.ts`

For live validation work:
- add or update regression tests for the bug being fixed
- add or update tests for output-path routing and artifact generation when relevant
- add or update tests for mode-specific behavior when relevant
- add or update tests for TeX→PDF behavior when relevant
- do not rely on tests alone; always rerun the actual live flow

## Completion rule

Do not declare success merely because one path worked once.

Only treat a live issue as fixed when:
- it was reproduced
- the fix was applied
- relevant tests pass
- the same live flow was rerun
- adjacent regressions were checked
- cross-mode regressions were checked
- remaining risks were documented
- paper-quality-relevant artifacts improved or clearly plateaued
- all exposed execution modes were exercised