---
name: tui-validation-loop-automation
description: Use this skill when the task is to repeatedly run a real TUI validation loop from test/ itself as the execution environment, reproduce issues, apply minimal fixes, revalidate, and keep ISSUES.md updated.
---

# TUI Validation Loop Automation

## Purpose
Use `test/` itself as the AutoLabOS execution environment and repeatedly run a real TUI validation loop:
reproduce issues, record them in `ISSUES.md`, apply the smallest plausible fix, rerun the same flow, and check adjacent regressions and cross-mode regressions.

The core principle of this skill is:
**live validation first, fix second, revalidation always.**

Important:
- The primary goal of this skill is **real TUI/workflow/state/artifact consistency validation**.
- `cycle completed`, `write_paper completed`, and `PDF built successfully` do not by themselves mean research quality is sufficient.
- If the task includes pushing the output toward paper-ready quality, use this skill together with `paper-scale-research-loop`.

## Use this skill when
Use this skill when the user asks to:

- keep running TUI validation until issues are fixed
- automate a reproduce → patch → rerun validation loop
- run live validation from `test/`
- keep `ISSUES.md` updated while iterating
- compare fresh vs existing session behavior repeatedly
- test all exposed execution modes while iterating

Typical trigger phrases:
- "automate the validation loop"
- "repeat TUI validation"
- "live validation cycle"
- "reproduce, fix, and rerun"
- "update ISSUES.md while working"
- "validate from test/"

## What this skill does not guarantee by itself
This skill alone does not guarantee:

- academic quality of the research topic
- sufficiency of the experimental scope
- baseline/ablation completeness
- paper-ready manuscript quality

For those goals, combine it with `paper-scale-research-loop`.

## Working directory rule
- The live validation execution environment is `test/` itself.
- Run the actual validation flow from `test/`.
- Do not treat `test/<run>/` as the default operator workspace.
- Internal runtime subdirectories are allowed only if strictly required by runtime mechanics.
- Automated tests still live under `tests/`.

## Output / artifact rules
- Reproducibility-facing outputs should be organized under `test/output/`.
- Do not manually create artifacts that AutoLabOS is supposed to generate.
- Avoid duplicate summaries, orphan temp folders, and unnecessary files/folders.
- When applicable, `test/output/` should contain:
  - reproduction code
  - experiment summaries
  - result tables
  - evidence-link summaries
  - paper artifacts
  - user-facing README / reproduction notes
  - TeX / PDF outputs

## Manuscript format rules
When this skill is used together with paper-generation validation, require:

- 2-column format
- 8 pages for the main body
- References excluded
- Appendices excluded

These constraints must be reflected in the brief and in the actual paper-generation behavior, not only stored as metadata.

## Workflow-structure rule
- Respect the repository’s current core workflow and do not casually remove, reorder, or redefine existing stages.
- If the need is strong, a new node may be added, but only when it clearly improves the runtime/research contract rather than duplicating an existing responsibility.
- Any workflow-structure change must preserve:
  - inspectable state transitions
  - auditable artifacts
  - reproducibility
  - review gating
  - claim-ceiling discipline
  - safe backtracking behavior
- Any structural workflow change must also be reflected in the docs, runtime behavior, and validation expectations.

## Loop contract
One iteration always follows this sequence:

1. **Fix the validation target**
   - State the exact flow being validated in one sentence.
2. **Enumerate execution modes**
   - Identify all exposed modes, for example:
     - interactive TUI
     - resumed/existing session
     - unattended / long-running mode
     - Autonomous / Overnight
     - draft / paper-generation path
3. **Collect current state**
   - session type
   - execution mode
   - relevant artifacts
   - visible symptom
   - recent failure point
4. **Reproduce**
   - Reproduce using the same commands, sequence, and conditions where possible.
5. **Record structurally**
   - Record the issue in `ISSUES.md`.
6. **Classify**
   - Use exactly one dominant taxonomy:
     - `persisted_state_bug`
     - `in_memory_projection_bug`
     - `refresh_render_bug`
     - `resume_reload_bug`
     - `race_timing_bug`
7. **Apply minimal fix**
   - Patch the smallest plausible boundary.
8. **Strengthen tests**
   - Add or update tests under `tests/`.
9. **Rerun the same flow**
   - Validate the same flow again.
10. **Check adjacent and cross-mode regressions**
   - Revalidate nearby flows and other relevant execution modes.
11. **Decide whether to continue**
   - success: move to the next bottleneck
   - failure: keep working on the same issue with a narrower hypothesis
   - uncertainty: add instrumentation and repeat

## Output format
Each iteration should report:

1. Validation target
2. Execution mode
3. Workspace / session context
4. Actual steps executed
5. Expected behavior
6. Actual behavior
7. Fresh vs existing comparison
8. Artifact vs UI comparison
9. Root-cause hypothesis
10. Applied fix
11. Added/updated tests
12. Revalidation result
13. Remaining risks
14. Next-step decision

## ISSUES.md update rules
- Treat `ISSUES.md` as an append-oriented live validation record.
- Do not silently overwrite history.
- Update status explicitly:
  - open
  - re-validating
  - blocked
  - fixed
- Record reproduction, fix, rerun result, and remaining risks.

## Fresh vs existing session rule
Do not skip this comparison when:

- the stale symptom appears only in an existing session
- resume/reload behaves differently
- persisted artifacts are correct but the UI summary is wrong
- reopening fixes the issue
- refresh/subscription/projection bugs are suspected

## All execution modes must be tested
- Do not fix one mode and declare global success.
- For every exposed mode, validate the relevant parts of:
  - discoverability
  - policy/config activation
  - artifact generation
  - resume/reload
  - review/write_paper gate behavior
  - TeX→PDF behavior
- Do not close the loop until all relevant modes have actually been exercised.

## Prohibited behaviors
- Do not patch before reproducing.
- Do not create ad hoc validation workspaces outside `test/`.
- Do not declare success based only on passing tests.
- Do not mix observations and guesses.
- Do not patch multiple unrelated failure boundaries at once.
- Do not slip in unrelated refactors.
- Do not manually create artifacts that AutoLabOS should generate.
- Do not confuse `write_paper completed` with paper-ready.

## Good completion criteria
You can stop the loop for a given issue only when:

- the symptom was reproduced and documented
- a dominant failure taxonomy was identified
- the minimal fix was applied
- tests were added or updated
- the same TUI flow no longer reproduces the issue
- adjacent and cross-mode regressions were checked
- `ISSUES.md` records the reproduction, fix, rerun, and remaining risks
- all relevant execution modes were exercised