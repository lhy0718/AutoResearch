# TUI/Web Live Validation Discipline

This guide standardizes how live interactive issues are recorded and converted into regressions.

## 1) Live validation first

For interactive defects, real TUI/web behavior is the primary ground truth.

Minimum loop:

1. Reproduce in a real session.
2. Record the issue in `ISSUES.md` using the required fields.
3. Patch the smallest plausible root cause.
4. Re-run the same flow.
5. Check adjacent flows for regressions.

## 2) Required bug taxonomy

Tag root-cause hypotheses with one dominant class:

- `persisted_state_bug`
- `in_memory_projection_bug`
- `refresh_render_bug`
- `resume_reload_bug`
- `race_timing_bug`

## 3) Required issue fields

Every active live-validation issue entry must include:

- Validation target
- Environment/session context
- Reproduction steps
- Expected behavior
- Actual behavior
- Fresh vs existing session comparison
- Root cause hypothesis
- Code/test changes
- Regression status
- Follow-up risks

Use `docs/live-validation-issue-template.md`.

## 4) Fresh vs existing session rule

Always check both:

- **Fresh session**: clean process/session start.
- **Existing session**: resumed/ongoing process with prior state.

If behavior diverges, call it out explicitly in the issue entry.

## 4.5) `/doctor` as the first diagnostics surface

Use `/doctor` in TUI or the web Doctor tab first when triaging live issues.

- Environment checks show tool/runtime readiness.
- Harness diagnostics summarize issue-log integrity and run artifact consistency for the current workspace.
- Findings include a problem class and a short remediation hint so triage can move directly to reproduction/fix.

## 5) Live bug -> regression test workflow

When a live bug is confirmed:

1. Capture a minimal reproduction trace in `ISSUES.md`.
2. Identify the narrowest stable seam for a test (render projection, command handling, node transition, etc.).
3. Add a deterministic unit/integration test under `tests/`.
4. Link the test path back in the issue entry.
5. Mark regression status only after test passes and live flow is re-checked.

### Example mapping (repository-native)

- Live symptom: `/approve` looked successful when no pending approval existed.
- Regression test seam: TUI/interaction command guards.
- Test mapping:
  - `tests/terminalAppPlanExecution.test.ts`
  - `tests/interactionSession.test.ts`

This pattern is preferred over adding a separate heavy live-testing framework.
