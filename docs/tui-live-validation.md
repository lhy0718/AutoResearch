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

### Direct-testing rule

If the user explicitly asks you to test the behavior yourself or to show actual runtime behavior, do not treat deterministic smoke fixtures, fake-provider runs, replay-only checks, or unit/integration tests as fulfilling that request.

Those tools are still useful as secondary diagnostics or regression checks, but the direct-testing request must use a real TUI/web flow when the environment allows. If credentials, network access, or required binaries block that real flow, state the limitation explicitly and do not present the fixture-driven result as equivalent to direct live validation.

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

## 6) Manuscript critique validation

A TUI validation run must verify the following paper-readiness signals:

### 6.1 Critique artifacts emitted
- `review/paper_critique.json` (pre-draft, `stage=pre_draft_review`) is emitted after `review`.
- `paper/paper_critique.json` (post-draft, `stage=post_draft_review`) is emitted after `write_paper`.
- Both artifacts conform to the `PaperCritique` schema.

### 6.2 Manuscript type classification
- Weak evidence runs are classified as `system_validation_note` or `research_memo`, not `paper_ready`.
- `write_paper completed` is visibly distinct from `paper_ready` in TUI/web summaries.
- Healthy runs with strong evidence can still advance and be classified as `paper_ready`.

### 6.3 Issue routing discipline
- Writing/style-only issues (abstract wording, section ordering, title style) stay local to `write_paper` repair.
- Upstream evidence deficits (missing baselines, unsupported claims, no result table, statistical insufficiency) trigger backtrack recommendations.
- Venue-style mismatch alone does NOT cause upstream backtrack.

### 6.4 Venue-style targeting
- Selected `target_venue_style` persists in run state/config.
- `target_venue_style` appears in critique artifacts and TUI summaries.
- Manuscripts under different venue styles produce different rhetorical emphasis.
- Style-fit critique is emitted separately from scientific adequacy critique.

### 6.5 Transition correctness
- Missing baseline/result table/claim-evidence support causes downgrade or backtrack.
- Critique recommendations map to supported transition targets (`implement_experiments`, `design_experiments`, `generate_hypotheses`).
- Pre-draft gate blocks weak evidence from reaching `write_paper`.
- Post-draft critique can trigger bounded backtrack when draft reveals upstream deficits.

### 6.6 TUI surfacing
- Manuscript type (e.g., `paper_ready`, `blocked_for_paper_scale`) appears in run projection.
- Selected venue style appears in run summaries.
- Blocking issues are surfaceable in run detail view.
- `workflow_completed` is visually distinct from `paper_ready`.
