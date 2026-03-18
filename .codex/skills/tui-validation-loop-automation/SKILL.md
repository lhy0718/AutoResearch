---
name: tui-validation-loop-automation
description: Use this skill when the task is to run or continue the real AutoLabOS validation loop from test/, keep ISSUES.md updated, and verify all relevant execution modes after each fix.
---

# TUI Validation Loop Automation

## Purpose
Run the full AutoLabOS live-validation loop:

reproduce → record → minimal fix → test update → rerun → adjacent regression check → cross-mode regression check

Use this skill when the goal is not just to inspect one symptom once, but to keep iterating until one real validation cycle is honestly completed.

## Working-root rule
- `test/` itself is the active AutoLabOS execution workspace.
- Do not create a separate validation workspace outside `test/`.
- If the runtime strictly requires nested internal run directories, keep them under `test/` only.
- Automated tests belong under `tests/`.

## Use this skill when
Use this skill when the user asks to:
- run the full TUI validation → fix → revalidation loop
- keep iterating until the live workflow is actually stable
- use ISSUES.md as the running log
- verify that one fix did not break other execution modes
- automate the repeated validation discipline for this repository

Typical trigger phrases:
- "run the TUI validation loop"
- "keep fixing what shows up"
- "validate until one cycle completes"
- "update ISSUES.md while working"
- "check cross-mode regressions too"

## Required loop
1. State the exact validation target.
2. Inventory all relevant execution modes and entry paths.
3. Reproduce the issue in the real flow.
4. Record or update `ISSUES.md`.
5. Classify the dominant taxonomy.
6. Apply the smallest plausible fix.
7. Add or update tests under `tests/`.
8. Rerun the same flow.
9. Check adjacent regressions.
10. Check all relevant execution modes for cross-mode regressions.
11. Decide whether to continue, narrow the hypothesis, or stop with an honest status.

## Per-mode validation requirements
For each relevant execution mode, verify:
- how the mode is exposed to the operator
- whether mode-specific policy/config is actually active
- whether artifact generation behavior matches expectations
- whether resume/reload behavior is coherent
- whether review/write_paper gates behave correctly
- whether TeX→PDF behavior is correct when relevant
- whether the mode has unique failures
- whether the fix introduced unintended cross-mode regressions

## Required issue record discipline
Every active issue entry should include:
- validation target
- environment/session context
- reproduction steps
- expected behavior
- actual behavior
- fresh vs existing session comparison
- root-cause hypothesis
- code/test changes
- regression status
- follow-up risks

## Guardrails
- Do not patch before reproducing.
- Do not declare success from tests alone.
- Do not fix one mode and assume all modes are fixed.
- Do not silently overwrite ISSUES.md history.
- Prefer minimal root-cause fixes over broad refactors.