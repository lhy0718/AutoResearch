# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Read first

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

If this file conflicts with them, those docs win.

## Mission

AutoLabOS validates a 9-node research workflow through real TUI/web interaction and produces evidence-grounded artifacts.

Always prioritize:

1. correct live behavior
2. state and artifact consistency
3. reproducible validation
4. honest scientific writing
5. paper-readiness only when the bar is actually met

Do not confuse:

- workflow completed
- `write_paper` completed
- PDF built
- paper-ready manuscript

These are not the same.

## Core rules

- Do not change the top-level 9-node workflow unless explicitly required.
- Prefer small, validated fixes over broad refactors.
- Do not claim a fix until the same live flow has been rerun.
- Do not overclaim beyond the evidence in produced artifacts.
- Lower claim strength when evidence is weak.
- `review` is a gate, not a polish pass.

## Runtime map

Important paths:

- runtime bootstrap: `src/runtime/createRuntime.ts`
- shared session logic: `src/interaction/InteractionSession.ts`
- TUI: `src/tui/`
- web UI: `src/web/`
- run state/artifacts: `.autolabos/`
- project skills: `.agents/skills/`

## Commands

- install: `npm install`
- build: `npm run build`
- test: `npm test`
- watch tests: `npm run test:watch`
- single test: `npx vitest run tests/<test-file>.test.ts`
- dev TUI: `npm run dev`
- dev web: `npm run dev:web`
- smoke: `npm run test:smoke:natural-collect`
- smoke execute: `npm run test:smoke:natural-collect-execute`
- smoke all: `npm run test:smoke:all`
- smoke ci: `npm run test:smoke:ci`

Useful smoke env vars:

- `AUTOLABOS_FAKE_CODEX_RESPONSE=1`
- `AUTOLABOS_FAKE_SEMANTIC_SCHOLAR_RESPONSE=1`
- `AUTOLABOS_SMOKE_VERBOSE=1`

## Skills

Available skills:

- `execution-mode-matrix-validation`
- `paper-build-output-hygiene`
- `paper-scale-research-loop`
- `stale-state-triage`
- `tui-live-validation`
- `tui-live-validation-research-loop`
- `tui-validation-loop-automation`

Use them intentionally:

- `tui-live-validation`: reproduce or verify real TUI issues
- `stale-state-triage`: stale UI, refresh, resume, projection mismatch
- `tui-validation-loop-automation`: validation -> fix -> rerun loop
- `execution-mode-matrix-validation`: verify multiple execution modes
- `paper-build-output-hygiene`: check output bundle and paper artifacts
- `paper-scale-research-loop`: improve experiment/manuscript quality
- `tui-live-validation-research-loop`: use when live validation and research-quality iteration are both required

## Validation loop

For real validation work, do this:

1. run `/doctor`
2. reproduce in a fresh session
3. compare with resumed/existing session when relevant
4. record the issue in `ISSUES.md`
5. patch the smallest plausible root cause
6. add or update deterministic tests in `tests/`
7. rerun the same flow
8. check adjacent regressions
9. check cross-mode regressions

Do not stop just because one run, TeX build, or PDF build succeeded once.

## `test/` vs `tests/`

Do not confuse them:

- `test/` = operator-facing live execution environment
- `tests/` = automated tests

For real validation:

- use `test/` as the active workspace
- keep automated tests under `tests/`
- do not replace live validation with unit tests only

## Execution-mode coverage

Do not validate only one happy path.

Check all exposed modes that materially affect behavior, gating, artifacts, or operator UX, including when present:

- normal interactive execution
- fresh-session execution
- resumed-session execution
- unattended or long-running execution
- Overnight Mode
- Autonomous Mode
- paper-generation paths
- alternate entry paths

## ISSUES.md discipline

For each live-validation issue, record:

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

Use exactly one dominant taxonomy:

- `persisted_state_bug`
- `in_memory_projection_bug`
- `refresh_render_bug`
- `resume_reload_bug`
- `race_timing_bug`

## Artifact rules

AutoLabOS must generate its own artifacts.

Do not manually substitute for:

- experiment summaries
- result artifacts
- research README artifacts
- TeX outputs
- PDF outputs
- paper bundle artifacts
- structured summaries

If an expected artifact is missing or malformed, fix the responsible node, prompt, config, path, wiring, or bundling logic.

Do not fake outputs outside the workflow.

Operator-facing outputs should be visible under:

- `test/output/README.md`
- `test/output/reproduce/`
- `test/output/results/`
- `test/output/paper/`
- `test/output/artifacts/`

## Paper/build rules

Do not stop at TeX generation.

During live validation:

- require TeX generation
- require actual PDF generation
- treat “TeX exists but PDF missing” as incomplete unless a clear environment/toolchain constraint is documented

If PDF generation fails, diagnose whether the cause is:

- missing TeX toolchain
- malformed generated TeX
- missing assets/references/paths
- runtime/output wiring

Do not manually author TeX or PDF as a substitute.

## Research and writing rules

Every serious paper-target run should have:

- a clear research question
- a falsifiable hypothesis
- a baseline or comparator
- real executed experiments
- quantitative results
- claim-to-evidence linkage
- limitations or failure modes

Rules:

- claims must not exceed evidence
- weak evidence requires weaker language
- negative results are acceptable if honest
- do not fabricate statistics or reproducibility claims
- if the evidence is not strong enough, explicitly downgrade the output

## Definition of done

Do not report success unless:

- the issue was reproduced
- the same flow was rerun after the change
- the original symptom no longer reproduces
- relevant tests were rerun
- key artifacts were checked
- adjacent regression risk was reviewed
- remaining risks were stated

For paper-target work, also require:

- executed experiments with a baseline
- quantitative results
- clear claim-to-evidence linkage
- passing `review`, or an explicit blocked decision