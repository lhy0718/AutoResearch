# Live Validation Playbook

This playbook is the operator checklist for validating real TUI/web behavior after workflow, state, artifact, or audit-surface changes.

Canonical policy remains in `docs/tui-live-validation.md` and issue entries must use `docs/live-validation-issue-template.md`.

## When To Use This

Use live validation when a change affects:

- TUI or web interaction
- run resume or reload behavior
- node transitions, backtracking, or approval gates
- public run projections versus run-scoped artifacts
- paper-readiness, review, figure-audit, claim-ceiling, or audit summaries

Deterministic tests and smoke fixtures are regression aids. They do not replace a direct live run when the user asked for actual runtime behavior.

## Workspace Setup

- Run live validation outside the implementation checkout.
- Use `<validation-workspace>` as the validation root placeholder.
- Set `AUTOLABOS_VALIDATION_WORKSPACE_ROOT=<validation-workspace>` when an explicit root is needed.
- Keep generated run artifacts under the validation workspace or ignored `outputs/`; do not commit generated live outputs.
- Run `/doctor` or the web Doctor tab first when triaging an interactive defect.

## Fresh-Run Flow

1. Start a clean TUI or web session from the current build.
2. Create or load the smallest brief that exercises the changed behavior.
3. Record the run id, provider mode, command path, and validation target.
4. Advance only through the nodes needed to exercise the target.
5. Inspect the visible UI state and the matching run-scoped artifacts.
6. Confirm that workflow completion, `write_paper` completion, PDF build, and `paper_ready` remain visibly distinct.
7. If the behavior fails, add an `ISSUES.md` entry before patching.

## Resume Flow

1. Stop the session after the target state is persisted.
2. Restart the TUI or web server against the same validation workspace.
3. Reopen the same run.
4. Compare resumed UI state against the persisted artifacts.
5. Classify divergence as one dominant root-cause type:
   - `persisted_state_bug`
   - `in_memory_projection_bug`
   - `refresh_render_bug`
   - `resume_reload_bug`
   - `race_timing_bug`
6. Re-run the same action that exposed the issue after the fix.

## Failed-Run Inspection Flow

1. Preserve the failed run; do not hide it by replacing outputs.
2. Inspect `run_record.json`, node events, failed node artifacts, and public projections.
3. Confirm failed status is visible in the TUI/web surface and any audit bundle.
4. Run `autolabos audit --run <run-artifact-root> --out-dir outputs/audit/<run-id>` when paper-readiness claims are involved.
5. Verify that hidden failed runs remain blocked by the audit report and are not promoted by `write_paper` or PDF artifacts.

## Issue Logging

For each reproduced live defect, add an `ISSUES.md` entry with:

- validation target
- environment/session context
- reproduction steps
- expected behavior
- actual behavior
- fresh versus existing session comparison
- dominant root-cause class
- code/test changes
- regression status
- follow-up risks
- evidence/artifacts

Use placeholders such as `<validation-workspace>`, `<repo-root>`, and `.autolabos/runs/<run-id>` rather than machine-local absolute paths.

## Regression Handoff

After the live defect is understood:

1. Add the smallest deterministic regression test that covers the stable code boundary.
2. Run the targeted test.
3. Run `npm run build` for shipped TypeScript or web behavior changes.
4. Run `npm run validate:harness` for workflow, artifact, harness, issue-log, or reproducibility-facing changes.
5. Re-run the same live flow that reproduced the issue.
6. Mark the issue resolved only when the original symptom no longer reproduces or the remaining blocker is explicitly recorded.
