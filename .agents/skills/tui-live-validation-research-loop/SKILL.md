---
name: tui-live-validation-research-loop
description: Use this skill when the task is to run a real AutoLabOS TUI validation → fix → revalidation loop from test/ itself, across all exposed execution modes, while keeping a broad research topic fixed, allowing hypotheses to evolve, validating TeX→PDF, organizing outputs under test/output/, and continuing until paper quality plateaus.
---

# TUI Live Validation Research Loop

## Purpose
Run a real AutoLabOS TUI validation loop from `test/` itself as the active execution environment, repeatedly reproduce live issues, apply minimal fixes, rerun the same flows, validate all exposed execution modes, and continue until paper quality no longer improves.

This skill is the **top-level orchestrator**. It should explicitly use the following helper skills as needed:

- `tui-live-validation`
- `tui-validation-loop-automation`
- `paper-scale-research-loop`
- `stale-state-triage`
- `execution-mode-matrix-validation`
- `paper-build-output-hygiene`

## Fixed research topic for this skill
**Efficient Test-Time Reasoning for Small Language Models**

### Topic framing
Investigate how small language models can improve reasoning quality under constrained inference budgets through adaptive or structured test-time strategies.

### Topic rule
- Keep this broad topic fixed throughout the loop.
- Do not replace, reinterpret, or silently swap the topic unless the user explicitly asks to change it.
- Do not lock in one narrow hypothesis too early.
- Let AutoLabOS iteratively generate, test, revise, branch, and prune hypotheses inside this topic area.
- The brief should define the topic, constraints, baselines/comparators, and evaluation plan.
- Hypotheses may evolve repeatedly during the loop.

## When to use this skill
Use this skill when the user asks for any of the following:

- a real TUI validation → fix → rerun loop
- validation from `test/`
- validation across all execution modes
- continued iteration until paper quality plateaus
- broad-topic research looping with revisable hypotheses
- artifact/output hygiene enforcement
- TeX→PDF validation
- `ISSUES.md`-driven live validation and repair

Typical trigger phrases:
- "TUI 실검증 루프"
- "test/에서 검증해줘"
- "검증 → 수정 → 재검증 반복"
- "모든 실행모드 테스트"
- "논문 품질이 멈출 때까지"
- "TeX랑 PDF까지 검증"
- "ISSUES.md 해결하면서 진행"

## Working-root rule
- `test/` itself is the active AutoLabOS execution environment and operator-facing validation root.
- Do not default to `test/<run>/` validation workspaces unless the runtime absolutely requires nested internal run directories.
- If nested internal run directories are unavoidable, they must remain logically contained under `test/`.
- Automated tests still belong under `tests/`.
- Do not confuse `test/` with `tests/`.

## Main operating contract
You must explicitly use the helper skills below during the loop:

### 1. `execution-mode-matrix-validation`
Use this first to enumerate all execution modes currently exposed by the repository and ensure each mode is included in the validation plan.

At minimum, validate all relevant exposed modes such as:
- normal interactive TUI execution
- fresh-session execution
- resumed/existing-session execution
- unattended / long-running execution
- Overnight Mode
- Autonomous Mode
- draft / paper-generation paths
- any alternate entry path that materially changes runtime behavior, artifact generation, gating, or output layout

For each execution mode, verify:
- discoverability
- operator-facing clarity
- policy/config activation
- artifact/output behavior
- resume/reload behavior when relevant
- review/write_paper gate behavior when relevant
- TeX→PDF behavior when relevant
- cross-mode regressions after each fix

Do not assume fixing one mode fixes all others.

### 2. `tui-live-validation`
Use this at the start of each concrete validation target to produce a structured live-validation record before patching.

Always capture:
- validation target
- execution mode
- environment/session context
- reproduction steps
- expected behavior
- actual behavior
- fresh vs existing session comparison
- persisted artifact vs UI comparison
- likely failing boundary
- recommended next action

### 3. `stale-state-triage`
Use this whenever the symptom includes:
- stale UI summaries
- stale top-level state
- fresh-vs-existing divergence
- resume mismatch
- persisted artifact correct but rendered UI incorrect
- refresh/subscription/projection issues

Use it before editing when stale-state symptoms are suspected.

### 4. `tui-validation-loop-automation`
Use this as the top-level iteration loop:
- reproduce
- record in `ISSUES.md`
- patch minimally
- add/update tests
- rerun same flow
- check adjacent regressions
- check cross-mode regressions
- repeat

### 5. `paper-scale-research-loop`
Use this to maintain the broad topic while allowing hypotheses to evolve and while pushing the strongest branch toward stronger paper quality.

It must enforce:
- broad topic fixed
- hypotheses revisable
- explicit baselines/comparators
- actual executed experiments
- numeric result tables
- claim→evidence linkage
- honest limitations / failure cases
- strongest-branch pressure toward better paper quality

### 6. `paper-build-output-hygiene`
Use this to enforce:
- AutoLabOS must generate its own artifacts
- no manual substitution of TeX/PDF/paper artifacts
- coherent output organization under `test/output/`
- TeX generation
- PDF generation
- manuscript-format compliance reporting
- minimal unnecessary file/folder creation

## Critical artifact-generation rule
- Do **not** manually create, hand-author, or substitute any file that AutoLabOS itself is supposed to generate.
- Do **not** fabricate paper outputs, research outputs, experiment summaries, TeX outputs, PDF outputs, run README artifacts, or structured result artifacts outside the actual AutoLabOS workflow.
- The coding agent may fix code, prompts, config, runtime paths, bundling logic, and artifact wiring so that AutoLabOS generates the artifacts correctly.
- Any artifact that should have been generated by AutoLabOS is invalid for completion if it was manually created by the external coding agent.

## Current issue-reduction obligations
Explicitly reduce the currently open risks in `ISSUES.md` where possible, especially:

- stronger result-table discipline
- clearer claim→evidence linkage
- categorized scientific-gate warning handling
- stronger downgrade protection against system-validation paper shape
- explicit baseline/comparator packaging
- compact quantitative result packaging
- stronger related-work depth signaling

Do not merely restate these risks. Reduce them through real code/runtime/reporting changes and revalidate.

## Brief and manuscript-format requirements
The research brief must explicitly carry manuscript-format constraints, including:
- target column count
- target main-paper page budget
- whether References are excluded
- whether Appendices are excluded

For this loop, require:
- **2 columns**
- **8 pages main body**
- **References excluded from the page limit**
- **Appendices excluded from the page limit**

These constraints must be actively used by manuscript generation to:
- plan section length
- control content density
- avoid severely under-length drafts
- avoid uncontrolled overflow in the main body
- surface when the target is not met
- report page-budget compliance or deviation in visible artifacts

## Output hygiene and bundle rule
Reproducibility-critical outputs must be organized under `test/output/`.

When relevant, ensure `test/output/` can contain:
- `test/output/README.md`
- `test/output/reproduce/`
- `test/output/results/`
- `test/output/paper/`
- `test/output/artifacts/`

If runtime-critical canonical paths already exist elsewhere, do not break them blindly.
Instead:
- keep canonical runtime paths working
- also expose a coherent operator-facing bundle under `test/output/`

Avoid:
- unnecessary files/folders
- duplicate summaries
- redundant artifacts
- scattered outputs outside the intended run area

## Review and paper-quality gate rules
Explicitly verify that:
- `review` remains a structural gate
- weak evidence does not silently advance as paper-ready
- missing baseline/comparator, missing compact result table, missing claim→evidence linkage, or missing real experiment evidence causes downgrade or block
- scientific-gate warnings are categorized clearly enough for the operator and manuscript
- `write_paper completed` is visibly distinct from `paper_ready`
- negative results are allowed but framed honestly
- manuscript-length and format constraints from the brief are actually used, not merely stored

## TeX → PDF validation rule
Do not stop at TeX generation alone.

During live validation:
- require the system to generate TeX
- then require actual PDF generation
- treat “TeX exists but PDF was not generated” as incomplete validation unless PDF generation is impossible because of a clearly documented environment/toolchain constraint
- if PDF generation fails, classify the cause:
  - missing TeX toolchain
  - malformed generated TeX
  - missing assets / references / paths
  - runtime/output wiring problem
- record the failure in `ISSUES.md`
- fix the smallest plausible root cause where possible
- rerun TeX→PDF validation

Do not manually author TeX or PDF as a substitute.

## Stopping rule
Continue the loop until **paper quality no longer improves**.

Operationally:
- Do not stop merely because one workflow run completed.
- Do not stop merely because TeX or PDF was generated once.
- Continue iterating while paper-quality-relevant improvements are still being found, such as:
  - stronger baseline/comparator packaging
  - stronger result tables
  - clearer claim→evidence linkage
  - better warning categorization / limitation handling
  - stronger related-work grounding
  - better manuscript structure
  - better compliance with the requested 2-column 8-page main-body target
- Treat the loop as plateaued only when repeated full validation/fix cycles no longer produce meaningful improvement in paper-quality-relevant artifacts or gate-readiness.
- Also require that all currently exposed execution modes have been exercised before declaring completion.

## Full loop procedure
1. Start from the current repo state.
2. Use `test/` itself as the active AutoLabOS execution environment.
3. Read the repository contract docs.
4. Run `/doctor` first from `test/`.
5. Use `execution-mode-matrix-validation` to enumerate all exposed execution modes.
6. Pick the highest-value live validation target.
7. Use `tui-live-validation` to record the current failure or risk.
8. If stale-state symptoms are present, use `stale-state-triage`.
9. Patch the smallest plausible root cause.
10. Add or update deterministic tests under `tests/`.
11. Re-run the same TUI flow from `test/`.
12. Check adjacent regressions and cross-mode regressions.
13. Use `paper-scale-research-loop` to assess whether the strongest branch improved in paper-quality terms.
14. Use `paper-build-output-hygiene` to verify output structure, TeX/PDF, and operator-facing bundle quality.
15. Update `ISSUES.md`.
16. Reassess:
    - open risks
    - remaining paper-quality gaps
    - untested execution modes
17. Repeat until:
    - paper quality plateaus
    - all exposed execution modes have been exercised
    - remaining risks are explicitly documented

## Required deliverables per iteration
Always report:

1. validation target
2. execution mode under test
3. fresh vs existing session comparison
4. root-cause hypothesis and taxonomy
5. code changes
6. test changes
7. rerun / regression result
8. output-bundle result
9. paper-quality improvement result
10. `ISSUES.md` update
11. remaining risks

## README update rule
At the end, update `README.md` so it accurately documents:
- the current TUI validation workflow
- that the loop continues until paper quality plateaus
- how `ISSUES.md` is used
- that `test/` itself can be used as the execution environment
- where outputs are written
- what appears under `test/output/`
- how reproduction artifacts, research docs, TeX outputs, PDF outputs, and paper outputs are organized
- how broad topics and revisable hypotheses are handled
- how brief-level manuscript format/length targets are specified
- the default validation target of 2 columns and 8 main-body pages excluding References and Appendices
- how all exposed execution modes should be tested
- any new node, if one was added
- any new output-hygiene or run-bundle constraints
- how TeX→PDF validation is expected to behave

## Completion standard
Do not declare success merely because one path worked once.

Only mark the loop complete when:
- issues were reproduced
- fixes were applied
- relevant tests pass
- the same live flows were rerun
- adjacent regressions were checked
- cross-mode regressions were checked
- remaining risks are documented
- paper-quality-relevant artifacts improved or clearly plateaued
- all currently exposed execution modes were exercised