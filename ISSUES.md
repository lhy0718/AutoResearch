# ISSUES.md

Last updated: 2026-03-22 · 1008 tests pass, 0 skipped

---

## Active issues

### LV-039 — `smoke.yml` fails in build before CI smoke can start
- Status: OPEN (reproduced locally on the same `npm run build` path used by GitHub smoke)
- Taxonomy: `persisted_state_bug`
- Validation target: `.github/workflows/smoke.yml` build gate before `npm run test:smoke:ci`
- Environment: project root, local reproduction of the workflow steps on 2026-03-19
- Reproduction: `npm run build`
- Expected: TypeScript build completes so the smoke job can reach `npm run test:smoke:ci`
- Actual: Build fails first with `src/core/agents/implementSessionManager.ts(445,26): TS2554 Expected 4 arguments, but got 3` and `src/core/nodes/analy
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
zePapers.ts(847,19): TS2322 Type '"running"' is not assignable to type '"pending" | "completed" | "failed" | "skipped"'`
- Fresh vs existing: Same in both fresh and existing workspaces because the failure is in compile-time code paths, not persisted runtime state
- Root cause hypothesis: `chooseBranchPlan()` gained a fourth `defaultFocusFiles` argument and one caller was not updated; `AnalysisManifestEntry.status` drifted behind runtime behavior that persists `"running"` while analysis is in progress
- Code/test changes: Pending
- Regression status: Pending re-validation after the minimal compile fix
- Remaining risks: Need to rerun `npm run build` and the CI smoke path after patching

### LV-028 — Harness validation misses ISSUES.md when workspace is a subdirectory
- Status: FIXED (not reproduced in re-validation of the same flow)
- Taxonomy: `persisted_state_bug`
- Validation target: `/doctor` harness-validation check from `test/` workspace
- Environment: `test/` workspace (subdirectory of project root)
- Reproduction: `/doctor` runs `runHarnessValidation({ workspaceRoot: "test/" })`. Harness looks for `path.join(workspaceRoot, "ISSUES.md")` → `test/ISSUES.md`. The real file lives at project root `./ISSUES.md`. No fallback → `issues_file_missing` finding raised.
- Expected: Harness finds `ISSUES.md` when it lives in the parent directory of the workspace
- Actual: `issues_file_missing` finding, even though ISSUES.md exists one level up
- Root cause: `runHarnessValidation()` only checked `workspaceRoot` for ISSUES.md with no parent-directory fallback
- Fix: Added parent-directory fallback — when ISSUES.md is not found in `workspaceRoot`, check `path.dirname(workspaceRoot)/ISSUES.md` before raising the finding
- Files changed: `src/core/validation/harnessValidationService.ts` (~line 73-89)
- Tests: Regression test added in `tests/harnessValidationService.test.ts`
- Re-validation: `/doctor` harness-validation passes with ISSUES.md at project root and workspace at `test/`
- Adjacent regression: None


- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
### LV-029 — Stale "running" node persists after TUI process kill / resume
- Status: FIXED (not reproduced in re-validation of the same flow)
- Taxonomy: `resume_reload_bug`
- Validation target: TUI restart after process termination during node execution
- Environment: `test/` workspace, run `02e7a6ee`, `implement_experiments` node
- Reproduction: TUI process terminated (kill/Ctrl-C) while `implement_experiments` is in "running" state → node status persisted as "running" → TUI restart displays "implement_experiments running" but no execution is happening → `/approve` rejected ("node not in needs_approval state") → `/resume` restores state but does not trigger execution → node stuck indefinitely
- Expected: On TUI restart, stale "running" nodes should be detected and recovered to an executable state
- Actual: Node stuck in "running" with no execution; no recovery path available
- Root cause: 5-point failure chain: (1) TUI startup has no auto-detection of stale running nodes; (2) `/resume` only restores state, doesn't trigger execution; (3) `runtime.resume()` keeps "running" status; (4) `defaultRunStatusForGraph()` maps "running" → "running"; (5) no progress recovery in node session manager
- Fix: Added `recoverStaleRunningNode()` method to `TerminalApp.ts` — on TUI startup, detects nodes in "running" state and calls `orchestrator.retryCurrent()` to reset them, making them re-executable
- Files changed: `src/tui/TerminalApp.ts` (modified `start()` at ~line 317; added `recoverStaleRunningNode()` at ~line 4515)
- Tests: Regression test added in `tests/agentOrchestrator.test.ts`
- Re-validation: TUI restart correctly shows `implement_experiments pending` instead of stale `running`; `/retry` successfully triggers execution
- Adjacent regression: None


- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
---

## Open risks

### R-001 — Result-table discipline and claim→evidence linkage
- Status: MITIGATED
- What was done: `design_experiments` writes `baseline_summary.json`; `analyze_results` writes `result_table.json`; `review` gate checks both and blocks when missing.
- Remaining risk: Quality of content inside these artifacts depends on LLM output — not yet validated with a real end-to-end research run.

### R-002 — Scientific gate warnings surfacing
- Status: MITIGATED
- What was done: Gate warnings grouped by category with severity labels and surfaced as limitation sentences in the manuscript.
- Remaining risk: Categories are coarse; operator may still need manual inspection.

### R-003 — System-validation paper shape over-promotion
- Status: MITIGATED
- What was done: `classifyManuscriptType` checks `baselineSummaryPresent`, `resultTablePresent`, `richnessSummaryPresent`; all 3 missing → `blocked_for_paper_scale`; ≥2 missing → `research_memo`.
- Remaining risk: A fake-mode run can produce structural artifacts that pass the gate without real scientific content.

### P-001 — Baseline/comparator packaging
- Status: MITIGATED
- What was done: `baseline_summary.json` written by `design_experiments`; review gate downgrades when missing.

### P-002 — Compact quantitative result packaging
- Status: MITIGATED
- What was done: `result_table.json` written by `analyze_results`; review gate downgrades when missing.

### P-003 — Related-work depth signaling
- Status: MITIGATED
- What was done: `analyze_papers_richness_summary.json` with full-text coverage stats; readiness classification gates `review`.
- Remaining risk: Full-text grounding depends on Semantic Scholar PDF availability.

---

## Live validation issues

### LV-064 — Ctrl+C inside an active TUI selection menu canceled only the menu instead of exiting the app
- Status: FIXED
- Taxonomy: `refresh_render_bug`
- Validation target: live TUI selection menu opened from `/model`
- Environment/session context: fresh configured temp workspace `/tmp/autolabos-ctrlc-live`, live tmux TUI session on 2026-03-22
- Reproduction steps:
  1. Start the TUI in a configured workspace.
  2. Run `/model` to open the in-app selection menu.
  3. Press Ctrl+C while the selector is still open.
- Expected behavior: Ctrl+C should act as a global abort/exit shortcut and terminate the TUI immediately, regardless of whether a selector is open.
- Actual behavior: the selector intercepted Ctrl+C as a menu-cancel action, resolved the menu promise, and left the app running, which made Ctrl+C appear unresponsive.
- Fresh vs existing session comparison:
  - Fresh session: reproduced in a fresh configured workspace after opening the `/model` selection menu.
  - Existing session: same risk applies because the behavior was in the shared `TerminalApp` key handler, not in persisted run state.
  - Divergence: none.
- Root cause hypothesis:
  - Type: `refresh_render_bug`
  - Hypothesis: `handleKeypress()` gave the active selection menu first right of refusal and mapped Ctrl+C to `cancelSelectionMenu()` instead of forwarding it to the global shutdown path.
- Code/test changes:
  - Code: `src/tui/TerminalApp.ts` now routes Ctrl+C in active selection menus to `shutdown({ abortActive: true })`; Escape remains the explicit menu-cancel key.
  - Tests: `tests/terminalAppPlanExecution.test.ts` now verifies Ctrl+C shuts down even with an active selection menu and adds an Escape regression to preserve cancel behavior.
- Regression status:
  - Automated regression test linked: yes — `tests/terminalAppPlanExecution.test.ts`
  - Re-validation result: pass — `npm run build`, `npm test`, and live tmux revalidation in `/tmp/autolabos-ctrlc-live` (`/model` -> Ctrl+C => session exited)
- Follow-up risks: busy operations still honor the shutdown abort grace window so persisted run state can be paused cleanly; this change only removes the menu-specific interception.
- Evidence/artifacts: `src/tui/TerminalApp.ts`, `tests/terminalAppPlanExecution.test.ts`

### LV-063 — OpenAI first-run setup asked reasoning effort before the relevant model was chosen
- Status: FIXED
- Taxonomy: `in_memory_projection_bug`
- Validation target: fresh first-run setup wizard under `providers.llm_mode=openai_api`
- Environment/session context: project root, fresh setup flow reproduced via `runSetupWizard()` prompt sequence on 2026-03-22
- Reproduction steps:
  1. Start a fresh workspace with no existing config and enter the first-run setup wizard.
  2. Select `api` for `Primary LLM provider (codex/api/ollama)`.
  3. Observe the prompt sequence before choosing OpenAI chat/task models.
- Expected behavior: each reasoning effort prompt appears only after the corresponding model has been selected, and only for the active provider path.
- Actual behavior: the wizard previously projected Codex defaults into the OpenAI path, so `General chat reasoning effort` and `Research backend reasoning effort` could be asked before the relevant OpenAI model choices were completed; PDF analysis also exposed separate PDF model and reasoning controls instead of following the selected research backend model and reasoning.
- Fresh vs existing session comparison:
  - Fresh session: reproduced and revalidated in fresh first-run TUI flows for OpenAI, Codex, and Ollama, plus a fresh web bootstrap session.
  - Existing session: not applicable because the issue is on first-run onboarding before any saved session exists.
  - Divergence: no existing-session variant.
- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: provider gating for wizard prompts and setup-form projection was too broad, so OpenAI onboarding could inherit Codex-first sequencing and the web form exposed inactive-provider slots instead of projecting only the selected provider's configuration path.
- Code/test changes:
  - Code: `src/config.ts` now asks the OpenAI chat model before any OpenAI reasoning effort, only asks Codex reasoning effort in the `codex_chatgpt_only` branch, and collapses both PDF model and PDF reasoning onto the selected research backend model/effort; `web/src/App.tsx` now renders only the selected provider's model/effort sections during setup and workspace editing, with PDF behavior derived from the research backend instead of exposing separate controls.
  - Tests: regressions in `tests/configEnv.test.ts` verify OpenAI models are prompted before reasoning, the separate Responses PDF prompt is gone, and PDF model/reasoning config collapses to the backend model/effort; `web/src/App.test.tsx` verifies provider-specific section visibility in onboarding and workspace settings.
- Regression status:
  - Automated regression test linked: yes — `tests/configEnv.test.ts`
  - Re-validation result: pass — `npm run build`, `npm test`, focused config/web regressions, fresh live TUI first-run checks for OpenAI, Codex, and Ollama, and fresh web onboarding bootstrap rechecks all confirmed model-before-effort ordering and removal of separate PDF model/reasoning selectors.
- Follow-up risks: existing-session comparison is not applicable because the symptom exists before any saved session; live web validation confirmed bootstrap state and page load, but not browser-side DOM introspection because browser chat tools were unavailable.
- Evidence/artifacts: `src/config.ts`, `tests/configEnv.test.ts`, `web/src/App.tsx`, `web/src/App.test.tsx`

### LV-062 — Fresh paper-scale runs can hang indefinitely in `analyze_papers` because Responses PDF planner/extractor/reviewer timeouts default to unbounded waits
- Status: FIXED
- Taxonomy: `persisted_state_bug`
- Validation target: fresh `test/` run `98987fc4-6ce2-4d39-8623-6dacbcb1508d`, specifically `collect_papers -> analy
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
ze_papers` under `providers.llm_mode=openai_api`
- Environment: `test/` workspace, fresh governed brief for `Efficient Test-Time Reasoning for Small Language Models`, `providers.llm_mode=openai_api`
- Reproduction:
  1. Start a fresh governed run from `test/` with the substantive GSM8K small-model brief.
  2. Let `collect_papers` complete and `analyze_papers` select a PDF-backed paper.
  3. Observe the Responses PDF planner succeed, then the extractor request remain in-flight with no summaries, no evidence, no new checkpoints, and no transition.
- Expected: `analyze_papers` should either finish, time out within a bounded window, or fall back to local text/image analysis so the workflow can continue.
- Actual: default planner/extractor/reviewer timeouts were all `0`, so the remote Responses PDF path could wait indefinitely; the fresh run remained at `analyze_papers before` with no new artifacts.
- Fresh vs existing: reproduced on the new fresh run rather than only on a resumed session, so this was not a resume-only defect.
- Persisted artifact vs UI: TUI showed repeated `Submitting PDF analysis request to Responses API` progress, while persisted artifacts stayed frozen at `analysis_manifest.json` with `status: running`, no `paper_summaries.jsonl`, no `evidence_store.jsonl`, and `checkpoints/latest.json` stuck at `analyze_papers-before`.
- Root-cause hypothesis: Responses PDF analysis stages were wrapped in timeout helpers, but the default timeout constants were zero, making those safety boundaries inert; extractor timeout errors also stayed on the remote path instead of falling back locally.
- Code/test changes:
  - `src/core/analysis/paperAnalyzer.ts` now uses bounded default planner/extractor/reviewer timeouts, stops remote retry on timeout fingerprints, and treats those timeout fingerprints as eligible for local fallback.
  - regressions added in `tests/paperAnalyzer.test.ts` and `tests/analyzePapers.test.ts`.
- Regression status:
  - deterministic regressions VALIDATED (993/993 tests pass, including targeted timeout-fallback and shouldFallbackResponsesPdfToLocalText regressions)
  - harness validation OK: no structural violations
- Follow-up risks: none — the 45s default is conservative; if future models are slower, the env-var override remains available

### LV-061 — Rebooted host can leave a false-positive live TUI session lock when the saved PID is reused by a non-TUI process
- Status: FIXED
- Taxonomy: `persisted_state_bug`
- Validation target: fresh `test/` TUI launch after reboot with `test/.autolabos/runtime/tui-session-lock.json` still present from the prior session
- Environment: `test/` workspace, fresh interactive TUI after forced reboot
- Reproduction:
  1. Leave `test/.autolabos/runtime/tui-session-lock.json` behind from a previous live session.
  2. Reboot the host so the original TUI process is gone.
  3. Start a fresh TUI from `test/`.
  4. Observe that the saved PID may now belong to an unrelated process.
- Expected: stale lock should be discarded and the fresh TUI should start.
- Actual: the launcher only checked `process.kill(pid, 0)`, treated the reused PID as alive, and blocked the fresh validation loop with `Another AutoLabOS TUI session is already running ...`.
- Fresh vs existing: the existing TUI session no longer existed after reboot, but the fresh session was still refused because the persisted lock trusted PID reachability alone.
- Persisted artifact vs UI: persisted `test/.autolabos/runtime/tui-session-lock.json` claimed a live owner that no longer existed; startup UI trusted it and refused launch.
- Root-cause hypothesis: PID-only liveness checks allowed PID reuse after reboot or namespace reuse to masquerade as an active TUI owner.
- Code/test changes:
  - `src/tui/TerminalApp.ts` now verifies `/proc/<pid>/cwd` and `/proc/<pid>/cmdline` before treating a saved lock as live.
  - `tests/terminalAppLaunch.test.ts` adds a regression for reused live PIDs that do not belong to an AutoLabOS TUI process.
- Regression status:
  - targeted regression VALIDATED (993/993 tests pass, including reused-pid-lock clearance regression in terminalAppLaunch.test.ts)
  - harness validation OK: no structural violations
- Follow-up risks: on non-Linux platforms (macOS) where /proc is unavailable, the enhanced check degrades to always treating locks as stale; acceptable since stale-lock clearing is the safer failure mode


- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
### LV-060 — fallback paper drafting leaks internal artifact paths into submission prose
- Status: FIXED (same-flow live revalidation no longer dies at `fetch failed`; manuscript artifacts now materiali
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
ze, and deterministic submission sanitization removes `.autolabos/` leakage from fallback drafting)
- Taxonomy: `in_memory_projection_bug`
- Validation target: `test/` run `81820c46-d1b6-4080-8575-a35c60583480` at `write_paper` after staged LLM fetch failures trigger deterministic fallback drafting
- Environment: `test/` workspace, existing paper-scale run, `providers.llm_mode=openai_api`
- Reproduction:
  1. Retry `write_paper` on the existing run after staged LLM `fetch failed` fallback is enabled
  2. Let deterministic fallback draft/manuscript generation proceed
  3. Observe `submission_validation.json` fail because prose copied a raw constraint mentioning ``test/.autolabos/`` and `test/output/`
- Expected: submission prose may mention auditability and governed artifacts, but it should not leak internal run directories or local file paths
- Actual: fallback draft/manuscript copied the raw constraint text, so submission validation blocked PDF build with `Submission text leaked an absolute or internal file path. (.autolabos/`)`
- Fresh vs existing: Reproduced on the existing run in the same `write_paper` retry loop; the failing boundary is the fallback writing path, not run creation
- Persisted artifact vs UI: TUI showed only a submission-validation failure, while persisted `paper/draft.json`, `paper/manuscript.session.json`, and `paper/main.tex` made it clear the manuscript path had otherwise succeeded and only the internal-path leak was blocking progression
- Root cause hypothesis: `buildFallbackPaperDraft()` and the writing/polish prompt payloads carried raw run constraints directly into submission-facing prose, so fallback writing preserved backticked internal paths such as ``test/.autolabos/``
- Code/test changes:
  - `src/core/analysis/paperWriting.ts` now sanitizes narrative constraint text before using it in fallback paper drafting and writing prompts
  - `src/core/analysis/paperManuscript.ts` now passes sanitized constraints into the polish prompt payload
  - regression added in `tests/paperSubmissionSanitization.test.ts`
- Regression status:
  - deterministic sanitization regression pending validation below
  - pending same-flow live retry from `test/` after patch
- Remaining risks: The manuscript is still below paper-ready evidence quality; this fix only removes internal-path leakage from fallback submission prose

### LV-059 — `write_paper` hard-fails on staged LLM fetch errors instead of degrading to stage-level fallback
- Status: FIXED (same failure no longer kills the node in staged LLM mode after the session-manager fallback patch)
- Taxonomy: `in_memory_projection_bug`
- Validation target: `test/` live run `81820c46-d1b6-4080-8575-a35c60583480` at `review -> write_paper` with `providers.llm_mode=openai_api`
- Environment: `test/` workspace, existing resumed run, staged paper-writing path
- Reproduction:
  1. Resume the existing run after `review` advances to `write_paper`
  2. Let `PaperWriterSessionManager` enter `staged_llm` mode because `providers.llm_mode=openai_api`
  3. Hit a provider/network fetch failure during one of the writing stages
  4. Observe the node fail with the raw message `fetch failed`
- Expected: `write_paper` should preserve an honest manuscript/evidence ceiling, but a staged LLM transport failure should fall back to the deterministic staged defaults already available to the session manager instead of aborting the whole node immediately
- Actual: The staged LLM path propagated `fetch failed` directly, so `write_paper` failed before it could finish the fallback draft/manuscript path
- Fresh vs existing: Reproduced on the existing paper-scale run after real experiments and review had already completed; the failing boundary is the staged LLM paper-writer session path itself rather than fresh run creation
- Persisted artifact vs UI: The failure checkpoint recorded only `fetch failed`, while the run had already produced `paper/input_validation.json`, `paper/outline.json`, and review artifacts that were sufficient to continue into a conservative fallback manuscript path
- Root cause hypothesis: `PaperWriterSessionManager.runStage()` handled codex-session timeouts with a per-stage fallback, but the `staged_llm` branch awaited `llm.complete()` without any recovery wrapper, so transport/provider failures escaped as node-level write-paper failures
- Code/test changes:
  - `src/core/agents/paperWriterSessionManager.ts` now catches staged LLM stage failures, records trace/error metadata, emits a fallback message, and returns empty stage text so the existing fallback outline/draft/review/manuscript builders can continue
  - regression added in `tests/paperWriterSessionManager.test.ts`
- Regression status:
  - targeted staged-LLM fetch-failure regression passed
  - pending same-flow live revalidation from `test/` after patch
- Remaining risks: This keeps paper drafting honest and auditable under provider failure, but it does not create stronger experimental evidence; manuscript classification must still remain under the review/claim ceiling


- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
### LV-058 — `run_experiments` can monopolize host responsiveness during heavy local model execution
- Status: FIXED (not reproduced in short same-flow revalidation after the safety patch)
- Taxonomy: `race_timing_bug`
- Validation target: `test/` live validation loop while `run_experiments` launches the governed local Python runner
- Environment: `test/` workspace, existing run `81820c46-d1b6-4080-8575-a35c60583480`, server rebooted at `2026-03-19 18:49 KST`
- Reproduction:
  1. Resume the same run through `implement_experiments`
  2. Let the workflow auto-handoff into `run_experiments`
  3. Observe persisted state reach `currentNode=run_experiments` at `2026-03-19T09:44:51Z`
  4. Shortly after, the server becomes unresponsive and needs a hard reboot
- Expected: A governed local experiment may be slow, but it should not monopoli
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
ze the host to the point that the server stops responding
- Actual: The last persisted workload before reboot was the local Python command in `run_experiments`, with heavy model-loading stderr already present; the host stopped responding before the workflow could converge
- Fresh vs existing: Observed on the existing resumed run after multiple backtrack cycles; the failing boundary is the local execution surface itself, not fresh-run startup
- Persisted artifact vs UI: `runs.json` shows `currentNode=run_experiments` with checkpoint `1094`; `run_experiments_panel/execution_plan.json` shows a real local Python runner command with `--pilot-size 16`; the reboot cut the UI before a new verifier artifact could be written for that cycle
- Root cause hypothesis: `LocalAciAdapter.runCommand()` launches heavy local shell commands with default process priority and unconstrained BLAS/tokenizer thread settings, so a model-loading experiment can saturate host resources and tank server responsiveness
- Code/test changes:
  - `src/tools/aciLocalAdapter.ts` now launches local shell commands with conservative execution env caps (`OMP_NUM_THREADS=1`, `MKL_NUM_THREADS=1`, `OPENBLAS_NUM_THREADS=1`, `NUMEXPR_NUM_THREADS=1`, `TOKENIZERS_PARALLELISM=false`, `MALLOC_ARENA_MAX=2`) and best-effort lower child priority
  - regression test added in `tests/aciLocalAdapter.test.ts`
- Regression status:
  - `npm run build` passed
  - `npm test` passed
  - `npm run validate:harness` passed
  - same `test/` run resumed into `run_experiments`, and concurrent `date` / `python3 -c 'print(1)'` probes returned immediately while the node remained active
- Remaining risks: This was a short live revalidation rather than a full long-run stress test, so host-responsiveness risk is reduced but not mathematically eliminated

### LV-057 — `implement_experiments` reuses a stale Codex thread after run feedback changes the repair target
- Status: OPEN (reproduced in the same `test/` live run before patching)
- Taxonomy: `persisted_state_bug`
- Validation target: `test/` live repair cycle after `run_experiments` fails with new runner feedback
- Environment: `test/` workspace, existing run `81820c46-d1b6-4080-8575-a35c60583480`, cycle 10, `implement_experiments`
- Reproduction:
  1. Resume the run after `run_experiments` reports `NameError: name 'false' is not defined`
  2. Let `implement_experiments` start from the repaired design cycle
  3. Observe the same prior `threadId` reused in `progress.jsonl`
  4. Observe live tool activity repeatedly inspect the same runner lines instead of converging on a fresh repair turn
- Expected: A new runner failure should start a fresh implement thread so the repair prompt is anchored on the new governed feedback
- Actual: `implement_experiments` reuses the old thread even though the repair target changed, and live progress stalls while the old thread repeats read-only inspection commands
- Fresh vs existing: Reproduced on the existing resumed run; the evidence points to stale thread continuity across cycles rather than fresh-run startup
- Persisted artifact vs UI: TUI shows repeated `sed` / `rg` / `py_compile` tool activity, while persisted `status.json` and `progress.jsonl` remain stuck at the initial `locali
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
ze` entries for the cycle
- Root cause hypothesis: thread reset only occurs when the experiment plan hash changes; new `run_experiments` feedback does not clear the stale thread, so Codex keeps the old repair context
- Code/test changes: Pending
- Regression status: Pending same-flow revalidation after forcing a fresh implement thread whenever runner feedback is present
- Remaining risks: Need to verify the same run now starts with no carried-over thread and progresses into a fresh repair attempt

### LV-056 — Supervisor stops after auto-approved design instead of executing the new pending node
- Status: OPEN (reproduced in the same `test/` live run before patching)
- Taxonomy: `persisted_state_bug`
- Validation target: `test/` live TUI continuation after `design_experiments` completes and auto-approves into `implement_experiments`
- Environment: `test/` workspace, existing run `81820c46-d1b6-4080-8575-a35c60583480`, cycle 10, interactive TUI session
- Reproduction:
  1. Backtrack the failed run to `design_experiments`
  2. Let `design_experiments` complete and auto-approve
  3. Observe persisted state advance to `currentNode=implement_experiments`
  4. Observe `implement_experiments` node state remain `pending` and never start
- Expected: Once `design_experiments` auto-approves, the supervised run should continue and execute the new pending `implement_experiments` node in the same loop
- Actual: The run advances to `currentNode=implement_experiments`, but the supervisor returns early and leaves the new node pending with no live execution
- Fresh vs existing: Reproduced on the existing resumed run; the symptom is tied to supervised continuation after a backtrack cycle rather than initial run creation
- Persisted artifact vs UI: `runs.json` and checkpoint `1089-implement_experiments-after.json` both show `currentNode=implement_experiments` while `graph.nodeStates.implement_experiments.status=pending`; the UI stays parked instead of starting implementation
- Root cause hypothesis: `InteractiveRunSupervisor.runUntilStop()` only invokes `runCurrentAgentWithOptions()` once and treats any still-running result as paused, even when the run has advanced to a fresh pending node that should execute immediately
- Code/test changes: Pending
- Regression status: Pending same-flow revalidation after the minimal supervisor-loop patch
- Remaining risks: Need to confirm the loop continues exactly once into the new pending node without creating a self-loop when no progress occurs


- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
### LV-030 — TUI crashes with unhandled EIO when stdout disconnects during render
- Status: FIXED (not reproduced in re-validation of the same flow)
- Taxonomy: `race_timing_bug`
- Validation target: TUI long-running execution when controlling terminal/shell session disconnects
- Environment: `test/` workspace, run `02e7a6ee`, `run_experiments` node executing via tmux shell session
- Reproduction: TUI rendering every 120ms via `setInterval`. Controlling shell session (tmux/terminal) terminates → stdout becomes broken pipe → `process.stdout.write()` throws `Error: write EIO` → unhandled error event on WriteStream → process exits with crash
- Expected: TUI should handle stdout disconnection gracefully — stop rendering and let background work continue or exit cleanly
- Actual: Unhandled 'error' event crashes the process; any running node execution is lost
- Root cause: `render()` method calls `process.stdout.write()` 4 times per frame with 
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
zero error handling; no `process.stdout.on('error')` listener to catch async write failures
- Fix: (1) Wrapped all stdout.write() calls in render() with try-catch, setting `this.stopped = true` on failure; (2) Added `process.stdout.on('error')` listener in `start()` to catch async EIO/EPIPE
- Files changed: `src/tui/TerminalApp.ts` (render() ~line 4688, start() ~line 317)
- Tests: 934 pass; no dedicated test (requires simulating broken pipe)
- Re-validation: TUI restarted; LV-029 stale-node recovery correctly detected the crashed run_experiments and resumed
- Adjacent regression: None

### LV-031 — Implement-experiments agent generates CPU-only code despite available GPU
- Status: FIXED
- Taxonomy: `in_memory_projection_bug`
- Validation target: `implement_experiments` code generation on a machine with NVIDIA RTX 4090 GPUs
- Environment: `test/` workspace, run `02e7a6ee`, 2× RTX 4090 (24GB each), CUDA 12.8
- Reproduction: `implement_experiments` Codex agent generates `run_gsm8k_qwen25_experiment.py` that loads Qwen2.5-3B with `AutoModelForCausalLM.from_pretrained(...)` but never calls `.to('cuda')` or uses `device_map='auto'`. Model runs on CPU at ~17s/example. `run_experiments` exhausts 1800s budget completing only `greedy` config (107/200 examples), missing `always_revise` and `gated_revise` entirely. Status: `time_budget_exhausted`.
- Expected: Agent detects GPU availability and generates code that loads model onto CUDA, completing all configs within budget
- Actual: 30 minutes on CPU, only 1/3 configs completed, experiment marked as budget-exhausted, run backtracks
- Root cause: `implementSessionManager.ts` system prompt and attempt prompt had no instructions about GPU/device detection. The Codex agent defaulted to CPU-only PyTorch code.
- Fix: Added GPU-awareness instructions to both `buildSystemPrompt()` and `buildAttemptPrompt()` in `implementSessionManager.ts` — agent now instructed to check `torch.cuda.is_available()`, load models onto CUDA when available, and log device/VRAM in metrics
- Files changed: `src/core/agents/implementSessionManager.ts` (system prompt ~line 1125, attempt prompt ~line 1277)
- Tests: 934 pass
- Re-validation: Run backtracked to design_experiments; re-running with updated agent. Expect GPU-aware code in next implement_experiments execution.
- Adjacent regression: None


- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
### LV-029b — recoverStaleRunningNode resets status but does not trigger execution
- Status: FIXED (follow-up to LV-029)
- Taxonomy: `resume_reload_bug`
- Validation target: TUI restart stale-node recovery → automatic re-execution
- Environment: `test/` workspace, run `02e7a6ee`, `run_experiments` node
- Reproduction: After LV-029 fix, `recoverStaleRunningNode()` calls `orchestrator.retryCurrent()` but omits `continueSupervisedRun()`. Node status resets to "running" but no execution spawns. TUI shows "running" with 0% CPU indefinitely.
- Expected: Recovered node should begin actual execution immediately
- Actual: Node stuck in "running" state with no process spawned; `/retry` required manually
- Root cause: `recoverStaleRunningNode()` only called `retryCurrent()` without `continueSupervisedRun()` — unlike `handleRetry()` which calls both
- Fix: Added `this.setActiveRunId(run.id)` and `void this.continueSupervisedRun(run.id)` after `retryCurrent()` in `recoverStaleRunningNode()`
- Files changed: `src/tui/TerminalApp.ts` (~line 4526)
- Tests: 934 pass
- Re-validation: TUI restart now automatically triggers execution for recovered nodes
- Adjacent regression: None


- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
### LV-022 — Empty selection from LLM rerank failure
- Status: FIXED (not reproduced in re-validation of the same flow)
- Taxonomy: `in_memory_projection_bug`
- Validation target: `/agent run analy
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
ze_papers` with 200 collected papers
- Environment: `test/` workspace, run `a1b7f1c0`, `analyze_papers` node
- Reproduction: LLM rerank via gpt-5.4+xhigh returns error → `selectPapersForAnalysis` returns empty `selectedPaperIds` → analysis loop skips all papers → node completes with 0 analyzed papers
- Expected: Graceful fallback to deterministic scoring when LLM rerank fails
- Actual: Empty selection, 0 papers analyzed
- Root cause: `paperSelection.ts` returned `{ selectedPaperIds: [], rerankApplied: false }` on rerank failure, without falling back to the deterministic pre-ranked order
- Fix: Added deterministic fallback — when LLM rerank fails, select top N by deterministic score (title similarity 78%, citation count 10%, recency 7%, PDF availability 5%)
- Files changed: `src/core/analysis/paperSelection.ts` (~line 310)
- Tests: 3 tests updated in `tests/paperSelection.test.ts`; 22 paperSelection tests pass
- Re-validation: Rerank failure now returns top N deterministic candidates instead of empty
- Adjacent regression: None observed

### LV-023 — API calls hang indefinitely (no timeout)
- Status: FIXED (not reproduced in re-validation of the same flow)
- Taxonomy: `race_timing_bug`
- Validation target: `/agent run analy
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
ze_papers` → PDF analysis API calls
- Environment: `test/` workspace, OpenAI Responses API via gpt-5.4+xhigh
- Reproduction: OpenAI Responses API fetch hangs indefinitely when endpoint is slow or unresponsive; no timeout causes the entire node to freeze
- Expected: Safety timeout prevents indefinite hang
- Actual: Process blocked forever waiting for API response
- Root cause: `responsesTextClient.ts` and `responsesPdfAnalysisClient.ts` passed no timeout to `fetch()`
- Fix: Added 10-minute safety timeout via `AbortSignal.any([userAbort, AbortSignal.timeout(600000)])` to both clients
- Files changed: `src/integrations/openai/responsesTextClient.ts` (~line 122), `src/integrations/openai/responsesPdfAnalysisClient.ts` (~line 77)
- Tests: Existing client tests pass; timeout mechanism verified by code review
- Re-validation: API calls now have 10-minute upper bound
- Adjacent regression: None

### LV-024 — Timeout abort confused with user abort
- Status: FIXED (not reproduced in re-validation of the same flow)
- Taxonomy: `race_timing_bug`
- Validation target: `/agent run analy
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
ze_papers` → error handling in analysis loop
- Environment: `test/` workspace, analyze_papers node with timeout-enabled clients
- Reproduction: When a 10-minute timeout fires, the resulting AbortError was caught by `isAbortError(error)` and treated as a user-initiated abort, killing the entire analysis loop instead of just the failing paper
- Expected: Timeout abort = per-paper failure (skip paper, continue with next); user abort = stop entire analysis
- Actual: Both abort types killed the entire loop
- Root cause: Catch block at line ~1031 in `analyzePapers.ts` re-threw on any `isAbortError()` without checking whether the user's `abortSignal` was actually triggered
- Fix: Changed condition to `isAbortError(error) && abortSignal?.aborted` — only re-throw when the user-level abort signal is actually set
- Files changed: `src/core/nodes/analyzePapers.ts` (~line 1015)
- Tests: Updated abort test in `tests/analyzePapers.test.ts` (line 2376)
- Re-validation: Timeout now produces per-paper failure, loop continues
- Adjacent regression: None

### LV-025 — "fetch failed" not triggering local text fallback
- Status: FIXED (not reproduced in re-validation of the same flow)
- Taxonomy: `in_memory_projection_bug`
- Validation target: Responses API PDF analysis → local text fallback chain
- Environment: `test/` workspace, analy
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
ze_papers node
- Reproduction: OpenAI Responses API returns "fetch failed" when it cannot download PDF from URL (e.g., arxiv rate limit, invalid URL). `shouldFallbackResponsesPdfToLocalText()` did not match this error pattern → paper analysis failed instead of falling back to local text
- Expected: "fetch failed" triggers fallback to local text extraction
- Actual: Paper marked as failed; no fallback attempted
- Root cause: Fallback pattern list in `paperAnalyzer.ts` did not include `/fetch failed/i`
- Fix: Added `/fetch failed/i` to the `shouldFallbackResponsesPdfToLocalText` pattern list
- Files changed: `src/core/analysis/paperAnalyzer.ts` (line 556)
- Tests: 4 new tests in `tests/paperAnalyzer.test.ts`; 19 paperAnalyzer tests pass
- Re-validation: "fetch failed" now correctly triggers local text fallback
- Adjacent regression: None

### LV-026 — Rerank cache miss forces expensive re-rerank on node re-entry
- Status: FIXED (not reproduced in re-validation of the same flow)
- Taxonomy: `persisted_state_bug`
- Validation target: `/resume <run>` → `/agent run analy
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
ze_papers` re-entry
- Environment: `test/` workspace, run `a1b7f1c0`, analyze_papers node re-entry after rerank failure
- Reproduction: After LV-022 fix (deterministic fallback), manifest is written with `rerankApplied: false`. On node re-entry, `canReuseManifestSelection()` sees `rerankApplied === false` with `selectedPaperIds.length < totalCandidates` → returns `false` → forces a full LLM rerank of 200 papers with gpt-5.4+xhigh (~60+ seconds, expensive)
- Expected: Manifest with valid deterministic selections should be reusable without re-rerank
- Actual: Every re-entry forces a full expensive LLM rerank
- Root cause: `canReuseManifestSelection()` at line 1985 treated `rerankApplied === false` as "selection not yet done" rather than "deterministic fallback was used"
- Fix: Changed the condition to only reject cache when `selectedPaperIds.length === 0` (truly empty selection), not merely when `rerankApplied === false`
- Files changed: `src/core/nodes/analyzePapers.ts` (~line 1968)
- Tests: 1 new test; 929 tests pass
- Re-validation: Deterministic fallback cache reuse confirmed in test
- Adjacent regression: None

### LV-027 — Vitest globalTeardown deletes live TUI workspace in test/
- Status: FIXED (not reproduced in re-validation of the same flow)
- Taxonomy: `persisted_state_bug`
- Validation target: `test/.autolabos/` preservation during concurrent vitest runs
- Environment: `test/` workspace with active TUI run; `npx vitest run` from project root
- Reproduction: `tests/globalTeardown.ts` `cleanTestWorkspaces()` deletes all entries in `test/` except those in `KEEP = new Set(["smoke", ".env"])`. When `test/` is also the live TUI workspace, `.autolabos/`, `outputs/`, and the `output` symlink are destroyed. `tests/setupTempRoot.ts` sets `TMPDIR=test/` so all test temp dirs go there, and `globalTeardown.ts` sweeps them — along with everything else.
- Expected: Vitest temp cleanup should not destroy the live validation workspace
- Actual: `.autolabos/`, `outputs/`, and `output` symlink deleted during both vitest setup and teardown phases; TUI continues with in-memory state but loses config, runs.json, brief, corpus, checkpoints
- Root cause: `KEEP` set in `tests/globalTeardown.ts` was too narrow — only preserved `smoke` and `.env`
- Fix: Added `.autolabos`, `outputs`, `output` to the `KEEP` set in `tests/globalTeardown.ts`
- Files changed: `tests/globalTeardown.ts`
- Tests: 931/933 pass (2 skipped: 
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
zzz_noProjectRootLeak)
- Re-validation: Ran full vitest suite after fix; `test/.autolabos/` survives cleanup
- Adjacent regression: None — temp dirs still cleaned; only live workspace dirs preserved

---

## Resolved issues (archived)

| ID | Summary | Root cause | Commit |
|----|---------|------------|--------|
| LV-021 | Test suite leaks `.autolabos/runs/` at project root | `persisted_state_bug` | 3a52cce, 78f7f88 |
| LV-020 | `implement_experiments` ignores experiment plan changes | `persisted_state_bug` | — |
| LV-019 | Backward jump doesn't reset target node to pending | `persisted_state_bug` | — |
| LV-018 | Objective evaluation matches wrong metric key | `in_memory_projection_bug` | — |
| LV-001–LV-017 | Various TUI/runtime bugs | mixed | — |
| AM-001 | Autonomous Mode implementation | feature | — |
| AM-002 | Review gate, time limits, stopAfterApprovalBoundary | feature | — |
| AM-003 | Two-layer paper-quality evaluation (deterministic gate + LLM) | feature | — |
| AM-004 | Manuscript format infrastructure, output bundle, gate warnings | feature | a0df12d |

---

## Iteration template

### Paper-scale Iteration N
- Goal:
- Research question:
- Baseline/comparator:
- Dataset/task/metric:
- Quantitative result summary:
- Claim→evidence status:
- Paper-readiness decision: `paper_ready` · `paper_scale_candidate` · `research_memo` · `system_validation_note` · `blocked_for_paper_scale`
- Missing artifacts:
- Next action:

### Paper-scale Iteration 1 — Run 800dab9d
- Goal: Progress from brief → governed run → auditable paper-scale outputs for "Efficient Test-Time Reasoning for Small Language Models"
- Research question: Under a constrained inference budget, can an adaptive test-time reasoning policy improve GSM8K reasoning accuracy for a small instruction-tuned language model relative to greedy decoding and a fixed always-revise comparator?
- Baseline/comparator: greedy decoding (baseline) + fixed always-revise structured reflection (comparator) — defined in brief, not yet executed
- Dataset/task/metric: GSM8K, exact-match accuracy, secondary: tokens/latency
- Quantitative result summary: None — pipeline at `analyze_papers` (1/30 papers analyzed)
- Claim→evidence status: No claims, no evidence yet
- Paper-readiness decision: `blocked_for_paper_scale`
- Missing artifacts: paper_summaries (29/30), evidence_store (thin), hypotheses, experiment_plan, baseline_summary, result_table, review_packet, paper_critique, main.tex, main.pdf, evidence_links, claim_evidence_table
- Environment update (2026-03-19): `pdflatex` is now available at `/usr/bin/pdflatex`; PDF build blocker removed
- Next action: Resume run 800dab9d via `/resume 800dab9d` in TUI to progress `analyze_papers` → full pipeline

---

### LV-032 — `/resume` does not trigger `continueSupervisedRun()`

| Field | Value |
|---|---|
| Validation target | `/resume <run>` command |
| Environment | TUI, run 02e7a6ee, cycle 2 after review backtrack |
| Reproduction | 1. Review gate backtracks run to implement_experiments (cycle 2), status→paused. 2. `/resume 02e7a6ee`. 3. Run status→running but currentNode stays "pending" indefinitely. |
| Expected | After `/resume`, the supervised run loop should start executing the pending node. |
| Actual | `/resume` calls `orchestrator.resumeRun()` (sets status to running) but never calls `continueSupervisedRun()`. Execution never starts. |
| Fresh vs existing | Same in both fresh TUI and existing TUI — `/resume` always has this gap. |
| Root-cause class | `resume_reload_bug` |
| Hypothesis | `handleRunSelect(resume=true)` omits the `continueSupervisedRun()` call that `/agent retry` includes. |
| Fix | Added `void this.continueSupervisedRun(run.id)` after `resumeRun()` in `handleRunSelect`. |
| Files changed | `src/tui/TerminalApp.ts` (~line 2319) |
| Tests | Build passes. Need regression test. |
| Status | ✅ Fixed |
| Regression | None observed — `/agent retry` and stale recovery paths already had `continueSupervisedRun()`. |


- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
---

### LV-033 — Review critique creates infinite backtrack loop

| Field | Value |
|---|---|
| Validation target | review → write_paper transition |
| Environment | TUI, run 02e7a6ee, cycles 1→2→3 |
| Reproduction | 1. Run completes implement→run→analy
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
ze→review. 2. Panel says "advance" (4/5, 0.74 confidence). 3. Minimum gate passes all 7 checks. 4. Paper critique says `blocked_for_paper_scale` → `backtrack_to_implement`. 5. Cycle repeats with identical results → same critique → infinite loop. |
| Expected | After 2 backtrack cycles with unchanged results, review should advance to write_paper when panel recommends advance and minimum gate passes. |
| Actual | No cycle limit exists; critique override always wins over panel "advance" decision regardless of cycle count. |
| Root-cause class | `in_memory_projection_bug` |
| Hypothesis | `buildReviewTransitionRecommendation()` unconditionally applies critique backtrack override with no cycle cap. When evidence can't improve (same design→same code→same results→same critique), this creates an infinite loop. |
| Fix | Added `researchCycle` parameter to `buildReviewTransitionRecommendation()`. After 2+ backtrack cycles, if minimum gate passed and panel says "advance", skip critique backtrack override. |
| Files changed | `src/core/nodes/review.ts` (~lines 241-247, 308-315) |
| Tests | Build passes. Need regression test. |
| Status | ✅ Fixed |
| Regression | Critique override still applies for cycles 0-1, maintaining safety. Only bypassed after 2+ cycles with passing minimum gate. |

---

### LV-034 — `/new` creates a non-paper-scale brief and `/brief start` runs it anyway

| Field | Value |
|---|---|
| Validation target | Fresh-session TUI brief creation + `/brief start --latest` |
| Execution mode | Interactive TUI, fresh `test/` workspace |
| Environment | `test/` workspace after first-run onboarding, Codex provider, broad topic intended to stay within "Efficient Test-Time Reasoning for Small Language Models" |
| Reproduction | 1. Launch TUI from `test/`. 2. Run `/new`. 3. Inspect generated brief at `test/.autolabos/briefs/20260318-220659-research-brief.md`. 4. Compare it with `docs/research-brief-template.md`. 5. Run `/brief start --latest` without filling the placeholders. 6. Inspect `test/.autolabos/runs/runs.json` and `test/.autolabos/runs/e9526c8b-472b-4e80-a151-082d155d3dc4/memory/run_context.json`. |
| Expected | `/new` should generate a brief that matches the documented research-brief contract, and `/brief start` should block an unedited placeholder brief or any brief missing required governance sections. |
| Actual | `/new` generated a brief with only Topic, Objective Metric, Constraints, Plan, Manuscript Format, Notes, and Questions / Risks. `/brief start --latest` still created run `e9526c8b-472b-4e80-a151-082d155d3dc4` and advanced it into `analy
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
ze_papers` using placeholder strings as the topic, objective, and constraints. |
| Fresh vs existing | Fresh session: reproduced immediately after onboarding. Existing session: expected to behave the same because template generation and brief validation are file-based, not session-cached. Divergence: none observed/expected. |
| Persisted artifact vs UI | Persisted brief snapshot and `run_brief.extracted` in run context contain placeholder text from the template, and `runs.json` shows the run as `running` with `currentNode = analyze_papers`; the UI therefore allowed a paper-scale-invalid brief to drive real collection/execution. |
| Root-cause class | `persisted_state_bug` |
| Hypothesis | `buildResearchBriefTemplate()` drifted below the documented brief contract, `validateResearchBriefMarkdown()` only errors on Topic/Objective presence, and `startRunFromBriefPath()` blocks only on validation errors. Placeholder/template text is therefore treated as valid run input. |
| Fix | Extended the generated brief template to include the documented paper-scale sections, taught the Markdown parser to recognize those headings, and made brief validation block missing or non-substantive placeholder content before `/brief start` can create a run. |
| Files changed | `src/core/runs/researchBriefFiles.ts`; `src/core/runs/runBriefParser.ts`; `tests/briefValidation.test.ts`; `tests/terminalAppPlanExecution.test.ts` |
| Tests | Added/updated deterministic coverage in `tests/briefValidation.test.ts` and `tests/terminalAppPlanExecution.test.ts`; focused rerun passed; full `npm test` and `npm run validate:harness` passed. |
| Status | ✅ Fixed |
| Regression | Same-flow live rerun in `test/`: `/new` now writes a paper-scale brief template, and `/brief start --latest` leaves `test/.autolabos/runs/runs.json` empty when the template is untouched. Adjacent valid-brief start paths still pass. |

---

### LV-035 — Brief-driven collect fallback collapses a paper-scale topic into a generic Semantic Scholar query

| Field | Value |
|---|---|
| Validation target | substantive brief -> `collect_papers` -> `analy
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
ze_papers` in `test/` |
| Execution mode | Interactive TUI, fresh/existing `test/` workspace |
| Environment | `../node_modules/.bin/tsx ../src/cli/main.ts` launched from `test/`; existing run `800dab9d-c116-428d-be05-3466968e8fc6` |
| Reproduction | 1. Launch AutoLabOS with `test/` as the actual workspace root. 2. Observe existing run `800dab9d...` loaded at `analyze_papers needs_approval`. 3. Inspect persisted `run_context.json` / `collect_result.json` for the run. 4. Compare the fixed brief topic with `collect_papers.last_result.query` and the selected top-N titles in `analysis_manifest.json`. |
| Expected | When LLM literature-query generation fails or is unavailable, `collect_papers` should still preserve the fixed brief topic using short, topic-faithful Semantic Scholar phrase-bundle queries. The resulting corpus should stay aligned with test-time reasoning for small language models. |
| Actual | The persisted collect query collapsed to a generic fallback (`investigate how language models can improve`), and the selected analysis shortlist drifted off topic. The governed run therefore carried a paper-scale-invalid evidence base into `analyze_papers`. |
| Fresh vs existing | Fresh session: the same brief-driven collect path would use the same deterministic fallback logic because the failure is file/topic driven. Existing session: reproduced from the persisted run state in `test/`, where the off-topic query and corpus were already stored. Divergence: none in the underlying failure class. |
| Persisted artifact vs UI | Persisted artifacts showed the drift explicitly in `collect_papers.last_result.query`, `queryAttempts`, and off-topic selected papers. The TUI summary only surfaced the downstream `analyze_papers` pause, so the operator-visible state underreported the topic-drift root cause. |
| Root-cause class | `persisted_state_bug` |
| Hypothesis | `buildLiteratureQueryCandidates()` had no deterministic topic-preserving fallback path after `llm_generated`, so a paper-scale brief could degrade into a generic keyword anchor query when the LLM planner failed. |
| Fix | Added deterministic short-phrase Semantic Scholar fallback queries derived from the brief topic: anchor pairs such as `+"small language models" +"test-time reasoning"` and method bundles such as `("adaptive reasoning" | "structured reasoning") +"small language models"`. Generic keyword anchors are now only allowed when they still preserve enough topic-signal groups. |
| Files changed | `src/core/runConstraints.ts`; `tests/collectPapersDeterministicFallback.test.ts` |
| Tests | Added deterministic regression coverage for phrase-bundle fallback and retry behavior in `tests/collectPapersDeterministicFallback.test.ts`. |
| Status | ✅ Fixed |
| Regression | Fresh-session live revalidation in `test/` created run `81820c46-d1b6-4080-8575-a35c60583480` and persisted `collect_papers.last_result.query = +"small language models" +"test-time reasoning"` with `reason = brief_topic`; the observed stop was an operator abort during Semantic Scholar fetch, not a fallback-query regression. |

---

### LV-036 — `collect_papers` retry leaves stale aborted-fetch error visible while the node is running

| Field | Value |
|---|---|
| Validation target | `collect_papers` retry / stale-running recovery in `test/` |
| Execution mode | Interactive TUI, resumed existing fresh-session run `81820c46-d1b6-4080-8575-a35c60583480` |
| Environment | `../node_modules/.bin/tsx ../src/cli/main.ts` launched from `test/`; previous collect attempt had been interrupted by operator abort |
| Reproduction | 1. Launch TUI from `test/`. 2. Let stale-running recovery reopen run `81820c46...` at `collect_papers`. 3. Observe TUI shows `collect_papers running`. 4. Compare with persisted `run_context.json` and `collect_result.json`. 5. Retry with `/retry`. |
| Expected | Once a new fetch attempt starts, the old aborted-fetch error should be cleared from run context so the UI no longer surfaces a stale collect error while the node is running. |
| Actual | TUI remained in `collect_papers running`, but persisted `collect_papers.last_error = Operation aborted by user` and `last_result.fetchError` stayed intact from the prior attempt, so the UI kept surfacing the old error banner during the new retry. |
| Fresh vs existing | Fresh run: issue appeared after a user-aborted first collect attempt. Existing/resumed session: reproduced immediately through stale-running recovery plus `/retry`. Divergence: none once stale aborted state existed. |
| Persisted artifact vs UI | UI projected `running`, but persisted `collect_papers.last_error` and `last_result.fetchError` still described the previous aborted attempt. |
| Root-cause class | `persisted_state_bug` |
| Hypothesis | `collect_papers` only rewrote `last_error` after a new fetch finished or failed; retry start never wrote an in-progress result that cleared the stale error surface. |
| Fix | On `collect_papers` execute start, write an in-progress `last_result` and `last_error=null` before issuing the new Semantic Scholar fetch. |
| Files changed | `src/core/nodes/collectPapers.ts`; `tests/collectPapers.test.ts` |
| Tests | Added deterministic regression coverage that seeds a stale aborted collect error and asserts it is cleared before `streamSearchPapers()` begins. |
| Status | ✅ Fixed |
| Regression | Same-flow live revalidation in `test/` passed: fresh run `81820c46-d1b6-4080-8575-a35c60583480` advanced through `collect_papers`, persisted `collect_result.json`, and no stale aborted-fetch error remained in run state while the retry was active. |


- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
---

### LV-037 — Reopening TUI auto-retries an actively running `analyze_papers` node and misprojects progress

| Field | Value |
|---|---|
| Validation target | Existing/resumed TUI reopen during live `analy
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
ze_papers` execution in `test/` |
| Execution mode | Existing session vs fresh reopened session on the same run `81820c46-d1b6-4080-8575-a35c60583480` |
| Environment | `../node_modules/.bin/tsx ../src/cli/main.ts` launched from `test/`; `analyze_papers` was actively producing persisted artifacts |
| Reproduction | 1. Start a substantive brief run in `test/` and let it reach `analyze_papers`. 2. While the original TUI still shows live analysis, confirm persisted artifacts now contain `paper_summaries.jsonl` and `evidence_store.jsonl` rows. 3. Open a second TUI session in `test/` on the same run. 4. Observe startup logs and the status/detail panel. |
| Expected | Reopening the TUI should attach to the active run, preserve already persisted analysis progress, and avoid retrying the node unless it is truly stale. |
| Actual | The new TUI briefly loaded the persisted progress (`Analyzed 1 papers into 4 evidence item(s)` / `Persisted 1 summary row(s) and 4 evidence row(s)`), then `recoverStaleRunningNode()` immediately classified the live node as stale, reset it to pending for re-execution, and the UI reverted to `Selected 6/15` with `Persisted 0 summary row(s) and 0 evidence row(s)` while the run already had persisted outputs. |
| Fresh vs existing | Existing live session: remained attached to the already-running analysis but displayed stale `0/0` progress until refreshed. Fresh reopened session: reproduced the worse behavior by auto-retrying the still-active node. Divergence shows a resume/recovery-specific bug rather than a pure persistence failure. |
| Persisted artifact vs UI | Persisted artifacts showed `paper_summaries.jsonl` with 1 row, `evidence_store.jsonl` with 4 rows, and `analysis_manifest.json` / `runs.json` updated around `2026-03-19T01:47:57Z`. The reopened TUI still reset to a `0/0` in-progress projection after the automatic recovery path fired. |
| Root-cause class | `resume_reload_bug` |
| Hypothesis | `TerminalApp.recoverStaleRunningNode()` unconditionally retries any `running` node on startup, without checking whether the run or node was updated recently enough to indicate an active live execution. |
| Fix | Added a freshness gate in `recoverStaleRunningNode()` so recently updated running nodes are not auto-retried on reopen; only older inactive-looking runs are recovered automatically. |
| Files changed | `src/tui/TerminalApp.ts`; `tests/terminalAppPlanExecution.test.ts` |
| Tests | Added deterministic TerminalApp coverage for both cases: recently updated running nodes are left alone, and old running nodes are still auto-recovered. |
| Status | ✅ Fixed |
| Regression | Live existing-vs-fresh revalidation in `test/` passed: reopening the patched TUI no longer emitted the stale-recovery log and correctly loaded the in-progress run with persisted analysis counts instead of forcing a manual retry. |

---

### LV-038 — `analyze_papers` selection regression prunes preserved artifacts before the regression guard can stop it

| Field | Value |
|---|---|
| Validation target | `analy
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
ze_papers` retry/reopen after partial progress in `test/`, followed by downstream `generate_hypotheses` startup |
| Execution mode | Interactive TUI, resumed existing run `81820c46-d1b6-4080-8575-a35c60583480` |
| Environment | `../node_modules/.bin/tsx ../src/cli/main.ts` launched from `test/`; partial related-work analysis already existed on disk |
| Reproduction | 1. Start a governed run from the substantive brief in `test/`. 2. Let `analyze_papers` persist partial outputs. 3. Retry/reopen the run after selection/corpus drift. 4. Compare `analysis_manifest.json`, `paper_summaries.jsonl`, `evidence_store.jsonl`, and `hypothesis_generation/progress.jsonl`. |
| Expected | If the shortlist regresses under the same selection request after partial analysis already exists, AutoLabOS should preserve the previously completed summaries/evidence, pause for manual review if needed, and avoid shrinking the evidence base before hypothesis generation starts. |
| Actual | The canonical analysis state regressed: persisted summaries/evidence shrank, `generate_hypotheses` restarted against a smaller evidence bundle, and the hypothesis progress log showed a later restart from only 8 evidence items after earlier larger counts had already existed. |
| Fresh vs existing | Fresh run: partial analysis advanced normally at first. Existing/resumed flow: retry/reopen after partial progress exposed the regression, because the node re-entered selection-retarget logic with prior artifacts already on disk. |
| Persisted artifact vs UI | Persisted `analysis_manifest.json`, `paper_summaries.jsonl`, and `evidence_store.jsonl` showed the evidence-base shrink directly; downstream `hypothesis_generation/progress.jsonl` then restarted from the smaller evidence count. TUI logs mixed stale `analyze_papers` text with newer node transitions, so the artifact layer was the reliable source of truth. |
| Root-cause class | `persisted_state_bug` |
| Hypothesis | `retargetManifestForSelectionChange()` pruned `existingSummaryRows` / `existingEvidenceRows` before `shouldPreservePartialArtifactsOnSelectionRegression()` ran, so the preservation guard saw an already-truncated artifact set and could not protect the full partial analysis from a selection regression. |
| Fix | Reordered `analyzePapers.ts` so the selection-regression preservation guard runs on the pre-retarget artifact set; retarget pruning now happens only after the preservation check declines to intervene. |
| Files changed | `src/core/nodes/analyzePapers.ts`; `tests/analyzePapers.test.ts` |
| Tests | Added deterministic regression coverage that starts with two completed analyzed papers, changes the corpus to a smaller different shortlist under the same selection request, and asserts the original artifacts remain preserved instead of being pruned to the new shortlist. |
| Status | 🔄 Reproduced and narrowed; deterministic fix added |
| Regression | Targeted deterministic revalidation passed. Clean same-flow live revalidation is still pending because the currently running TUI process was started before the patch and continued mutating the same run. |

---

### LV-039 — `implement_experiments` starts with an empty branch focus when localization misses the governed experiment workspace

| Field | Value |
|---|---|
| Validation target | `implement_experiments` startup in governed run `81820c46-d1b6-4080-8575-a35c60583480` from `test/` |
| Execution mode | Interactive TUI, resumed existing run in `test/` |
| Environment | AutoLabOS launched from `test/`; run had already advanced through `design_experiments` and entered `implement_experiments` |
| Reproduction | 1. Resume run `81820c46-d1b6-4080-8575-a35c60583480` in `test/`. 2. Let `implement_experiments` start. 3. Inspect `implement_experiments/progress.jsonl` and live TUI status. |
| Expected | When search-backed locali
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
zation cannot find concrete repo files yet, the implementer should still receive a deterministic public experiment target so the first attempt can create a governed runnable artifact. |
| Actual | `implement_experiments` repeatedly logged `Search-backed localization: Localization did not identify any concrete files.` followed by `Branch focus branch_primary: (no explicit file focus)`, which left the implementer without a concrete file target in the governed public experiment directory. |
| Fresh vs existing | Existing resumed run reproduced the failure directly at the first implementation attempt. Fresh paper-scale run would hit the same logic because the failure depended on missing localization candidates, not resume state. |
| Persisted artifact vs UI | Persisted `implement_experiments/progress.jsonl` and the TUI both showed the same empty-focus symptom; there was no divergence between UI projection and disk state. |
| Root-cause class | `in_memory_projection_bug` |
| Hypothesis | `chooseBranchPlan()` only considered localized candidates and prior changed files. For a new governed experiment workspace both sets were empty, so the primary branch emitted no explicit focus files. |
| Fix | Added deterministic default branch focus files when localization is empty: `<public_dir>/experiment.py` and `<run_dir>/experiment_plan.yaml`, while still preferring search-derived candidates when available. |
| Files changed | `src/core/agents/implementSessionManager.ts`; `tests/implementSessionManager.test.ts` |
| Tests | Added prompt-level deterministic coverage asserting that the implementation prompt includes the governed public experiment script path in `branch_primary.focus_files` when localization misses. |
| Status | ✅ Fixed |
| Regression | Live same-flow revalidation in `test/` passed: resumed `implement_experiments` now persisted `Branch focus branch_primary: /home/hanyong/AutoLabOS/test/outputs/budget-aware-adaptive-and-structured-test-time-r-81820c46/experiment/experiment.py` instead of `(no explicit file focus)`. |

---

### LV-040 — Codex runtime blocks governed implementation when default `~/.codex` is not writable under the sandbox

| Field | Value |
|---|---|
| Validation target | `implement_experiments` Codex runtime preflight in governed run `81820c46-d1b6-4080-8575-a35c60583480` |
| Execution mode | Interactive TUI in `test/`, forced jump back to `implement_experiments` after design completed |
| Environment | AutoLabOS launched from `test/`; sandboxed Codex runtime could not write `/home/hanyong/.codex` or `/home/hanyong/.codex/shell_snapshots` |
| Reproduction | 1. Run `implement_experiments` from the governed `test/` workspace. 2. Observe the node fail immediately before actual implementation. 3. Compare the persisted node error with the live TUI failure text. |
| Expected | If the default home-based Codex directory is not writable inside the sandbox, the client should fall back to a governed workspace-local runtime home so live implementation can still proceed. |
| Actual | `implement_experiments` failed three times with blocking readiness errors: `codex-home: /home/hanyong/.codex: EROFS` and `codex-shell-snapshots: /home/hanyong/.codex/shell_snapshots: EROFS`, then auto-rolled back. |
| Fresh vs existing | Existing resumed run exposed the failure immediately once `implement_experiments` began. Fresh runs under the same sandbox would hit the same blocker because it was environment/writeability driven rather than run-history driven. |
| Persisted artifact vs UI | Persisted `runs.json`/node state and the live TUI showed the same blocking error text. The failure was fully represented on disk and in the UI. |
| Root-cause class | `persisted_state_bug` |
| Hypothesis | `CodexCliClient` always validated and used `~/.codex` when `CODEX_HOME` was unset, even under sandboxed executions where that path was read-only. |
| Fix | Added runtime fallback to `test/.autolabos/runtime/codex-home` when `CODEX_HOME` is unset and the default home path is not writable; both home and `shell_snapshots` readiness now resolve against that workspace-local fallback. |
| Files changed | `src/integrations/codex/codexCliClient.ts`; `tests/codexCliClient.test.ts` |
| Tests | Added deterministic Codex client coverage that mocks an unwritable home directory and asserts readiness falls back to a workspace-local runtime home. |
| Status | ✅ Fixed |
| Regression | Live same-flow revalidation in `test/` passed this layer: after the patch, `implement_experiments` no longer failed with `codex-home` / `codex-shell-snapshots` EROFS and progressed to actual Codex execution. |


- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
---

### LV-041 — `implement_experiments` still pauses because Codex API streaming disconnects before completion in the sandboxed validation environment

| Field | Value |
|---|---|
| Validation target | Same governed `implement_experiments` live flow after LV-039 and LV-040 fixes |
| Execution mode | Interactive TUI in `test/`; resumed and force-jumped existing run `81820c46-d1b6-4080-8575-a35c60583480` |
| Environment | Patched TUI; Codex client reached network execution, but the validation environment repeatedly disconnected while streaming `https://api.openai.com/v1/responses` |
| Reproduction | 1. Relaunch AutoLabOS from `test/` with LV-039 and LV-040 fixes applied. 2. Force-run `implement_experiments` on run `81820c46-d1b6-4080-8575-a35c60583480`. 3. Observe the live TUI retry loop and persisted `lastError`. |
| Expected | After branch-focus and runtime-home fixes, `implement_experiments` should complete or fail for experiment-code reasons, not for infrastructure connectivity. |
| Actual | The node advanced past branch planning and Codex runtime-home preflight, then repeatedly failed with streaming/network errors (`stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses)`), surfacing as `codex exec failed (exit 1)`. |
| Fresh vs existing | Existing resumed run reproduced the failure after the earlier blockers were fixed. Fresh runs in the same sandboxed environment are expected to hit the same network restriction because the failure is transport-layer rather than state-history driven. |
| Persisted artifact vs UI | The live TUI showed the full reconnect/disconnect sequence; persisted node state kept the summari
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
zed `codex exec failed (exit 1)` error and left the node pending/paused after cancellation. |
| Root-cause class | `race_timing_bug` |
| Hypothesis | The current validation environment still prevents or destabilizes long-lived Codex streaming requests, so the governed run cannot yet finish `implement_experiments` even though the local execution contract and writable runtime directories are now correct. |
| Fix | No repo-code fix yet. This is the current highest-value blocker after LV-039 and LV-040. |
| Files changed | none yet |
| Tests | none yet; this is currently a live environment blocker rather than a deterministic repo regression. |
| Status | 🔄 Active blocker |
| Regression | Live same-flow revalidation confirmed the previous blockers are gone and narrowed the remaining failure to Codex API stream disconnects during actual implementation execution. |

---

### LV-042 — `implement_experiments` can materialize and even execute the governed bundle, but the live turn does not complete and leaves workflow state behind the artifacts

| Field | Value |
|---|---|
| Validation target | Same governed `implement_experiments` flow in `test/` after LV-039/LV-040 fixes and bundle-recovery hardening |
| Execution mode | Interactive TUI in `test/`, resumed existing run `81820c46-d1b6-4080-8575-a35c60583480` |
| Environment | Escalated live TUI; public experiment bundle already existed and local verification / runner commands were observed in the live tool stream |
| Reproduction | 1. Relaunch AutoLabOS from `test/` with the latest implementer patches. 2. Retry `implement_experiments` on run `81820c46-d1b6-4080-8575-a35c60583480`. 3. Observe the live tool stream and compare it with the persisted run state and generated artifacts. |
| Expected | Once the governed experiment bundle is materiali
- Validation target: see the issue-specific validation target above
- Environment/session context: see the issue-specific environment/session details above
- Reproduction steps:
  1. Reopen the same run/workspace described above.
  2. Reproduce the same live flow described above.
  3. Compare persisted artifacts with the live UI/projection.
- Expected behavior: see the issue-specific expected behavior above
- Actual behavior: see the issue-specific actual behavior above
- Fresh vs existing session comparison:
  - Fresh session: see the issue-specific fresh-session note above
  - Existing session: see the issue-specific existing-session note above
  - Divergence: see the issue-specific divergence note above
- Root cause hypothesis:
  - Type: see the taxonomy / root-cause class above
  - Hypothesis: see the issue-specific hypothesis above
- Code/test changes:
  - Code: see the issue-specific files changed above, or `none yet`
  - Tests: see the issue-specific tests above, or `none yet`
- Regression status:
  - Automated regression test linked: see the issue-specific tests above, or pending
  - Re-validation result: see the issue-specific regression note above
- Follow-up risks: see the issue-specific remaining risks above
- Evidence/artifacts: see the run IDs, logs, checkpoints, and artifacts already cited above
zed and the local verification / runnable command is executed, the node should persist a completed implement result and advance toward `run_experiments` or a verified handoff state. |
| Actual | The live tool stream showed real work on the governed bundle: reads from the materialized experiment script/README plus `python -m py_compile` and the bounded experiment command. Public artifacts and experiment-run outputs were present on disk (`artifacts/smoke-real-4ex-1r/...`, `metrics.json` path exists), but workflow state remained at `implement_experiments` with `pending/running` and did not advance to `run_experiments`. |
| Fresh vs existing | Existing resumed run reproduced the issue because it already had a materialized bundle to reuse. A fresh run reaching the same bundle state would likely hit the same completion gap if the implementer turn remains open after producing artifacts and metrics. |
| Persisted artifact vs UI | Persisted artifacts show a runnable bundle plus real generated experiment outputs, while `runs.json` still reports `currentNode = implement_experiments` and does not transition to `run_experiments`. This is a direct workflow-state vs artifact mismatch. |
| Root-cause class | `persisted_state_bug` |
| Hypothesis | The implementer turn can continue reading docs / re-inspecting bundle files after enough evidence already exists to finish, so the node never commits the recovered/materialized result into final implement state before the operator interrupts or retries. |
| Fix | Not fixed yet. Next candidate fix is to add a bounded completion shortcut after recovered/materialized bundle verification succeeds so the node can finalize from persisted artifacts instead of waiting for a long Codex turn to voluntarily emit the terminal JSON. |
| Files changed | none yet |
| Tests | none yet |
| Status | 🔄 Active blocker |
| Regression | Live same-flow revalidation confirmed that branch-focus and Codex-home blockers are resolved and that real bundle artifacts are produced, but the workflow still fails to converge to a completed `implement_experiments` state. |

## LV-043 design retry ignores bounded failure evidence
- Category: live validation issue
- Status: active
- Validation target: `test/` substantive run `81820c46-d1b6-4080-8575-a35c60583480` after `analyze_results -> backtrack_to_design`.
- Execution mode: fresh/resumed TUI in `test/`, real governed run.
- Reproduction:
  1. Resume the run after `analyze_results` emits `transition_recommendation.json` with `backtrack_to_design`.
  2. Observe `design_experiments` restart.
  3. Inspect `result_analysis.json` and `transition_recommendation.json` showing `pilot_size=1`, `repeats=1`, objective miss, and explicit recommendation to revise design.
  4. Inspect current design node input path in `src/core/nodes/designExperiments.ts`; it reads hypotheses/constraints/objective but not prior result-analysis feedback.
- Expected behavior: design retry should ingest prior bounded-run evidence and explicitly avoid repeating the same underpowered scope; revised panel artifacts should reflect stronger bounded-local design.
- Actual behavior: backtracked design restart is driven by the original hypotheses/constraints path, so the retry can repeat an underpowered design despite existing negative evidence.
- Fresh vs existing: reproduced on the existing governed run after a real backtrack; risk applies equally to fresh runs once they reach the same boundary.
- Persisted artifact vs UI: persisted `result_analysis.json` and `transition_recommendation.json` clearly demand design revision; UI shows `Retrying design_experiments`, but persisted design panel artifacts remain from the original attempt until a new selection is emitted.
- Dominant taxonomy: `persisted_state_bug`
- Root-cause hypothesis: `design_experiments` does not load prior analysis feedback into the design request, so backtrack context is not preserved across node reruns.
- Planned fix: wire prior result-analysis and transition evidence into design retry input, persist a retry context artifact, and add deterministic regression coverage.

## LV-044 run_experiments omits required runner arguments after governed bundle generation
- Category: live validation issue
- Status: active
- Validation target: `test/` live run `81820c46-d1b6-4080-8575-a35c60583480` at `run_experiments`.
- Execution mode: resumed TUI in `test/` using the real operator flow.
- Reproduction:
  1. Launch the real TUI from `test/` and resume the run.
  2. Observe the status panel after the governed bundle has already been generated.
  3. The TUI shows `run_experiments error` with `run_gsm8k_budget_reasoning.py` usage output.
- Expected behavior: the governed runner command should always include `--run-dir` and `--metrics-path` when AutoLabOS invokes the generated experiment bundle.
- Actual behavior: the command reaches the runner without those required arguments, so the Python CLI exits immediately and the workflow stalls at `run_experiments`.
- Fresh vs existing: reproduced on the existing governed run via `/resume`; a fresh session reopening the same run shows the same persisted command-assembly failure.
- Persisted artifact vs UI: the TUI error matches the persisted run note/lastError exactly, so this is not a projection-only bug.
- Dominant taxonomy: `persisted_state_bug`
- Root-cause hypothesis: the `run_experiments` command assembly or argument forwarding path loses required execution paths even though the bundle and config already exist.
- Planned fix: patch the runner invocation builder to always materialize `--run-dir` and `--metrics-path`, add deterministic regression coverage, and rerun the same live flow.

- Update (2026-03-19): patched `implementSessionManager` recovered-bundle command normalization and revalidated in `test/`. The same live run now produces `run_experiments_panel/execution_plan.json` with the full absolute command, executes a real `pilot-8ex-1r-20260319-125038` bundle, and no longer reproduces the missing `--run-dir/--metrics-path` usage failure. Deterministic coverage: `tests/implementSessionManager.test.ts`; repo validation: `npm run build`, `npm test`, `npm run validate:harness`. Regression status: fixed for the original CLI-argument loss path.
- Update (2026-03-19): after the new 8-example bounded run, patched `design_experiments` live retry now writes `design_experiments_panel/retry_context.json` with `pilot_size=8`, `repeats=1`, `accuracy_delta_vs_baseline=-0.125`, and the transition evidence, and the fresh TUI log shows `Loaded design retry context from prior results`. Deterministic coverage: `tests/constraintPropagation.test.ts`; regression status: fixed for retry-context loss.

## LV-045 design_experiments retry can hang after loading retry context without committing a new panel
- Category: live validation issue
- Status: active
- Validation target: `test/` run `81820c46-d1b6-4080-8575-a35c60583480` after `pilot-8ex-1r-20260319-125038` backtracks to `design_experiments`.
- Execution mode: fresh TUI in `test/`, real resumed governed run.
- Reproduction:
  1. Let the same run execute the new 8-example bounded pilot and auto-backtrack from `analyze_results` to `design_experiments`.
  2. Observe the fresh TUI log: `Loaded design retry context from prior results`, `Submitting experiment design request`, `Designing experiments`, `Codex analysis session started`.
  3. Wait while `design_experiments` remains running.
  4. Persisted `design_experiments_panel/retry_context.json` updates, but `candidates.json`, `reviews.json`, and `selection.json` remain stale from the old attempt.
- Expected behavior: design retry should either commit a new panel selection in bounded time or fail over deterministically with an auditable fallback instead of hanging indefinitely.
- Actual behavior: the node can remain running with no new panel artifacts and queued steering unconsumed, blocking the next loop iteration.
- Fresh vs existing: reproduced in a fresh TUI reopen of the existing run; persisted retry_context agrees with the UI that the retry started, but the rest of the panel remains stale.
- Persisted artifact vs UI: UI shows active design retry; persisted retry_context confirms start; panel selection artifacts do not advance.
- Dominant taxonomy: `race_timing_bug`
- Root-cause hypothesis: `designExperimentsFromHypotheses` waits indefinitely on the LLM/Codex-backed completion path without a bounded timeout/fallback handoff, so retry context is loaded but no downstream panel artifacts are ever committed.
- Planned fix: bound the design LLM request with a timeout that degrades to deterministic fallback, add regression coverage, and rerun the same live retry flow.
- Update (2026-03-19): patched `src/core/analysis/researchPlanning.ts` to bound `designExperimentsFromHypotheses(...)` with a 45s timeout and deterministic fallback. Deterministic coverage: `tests/researchPlanning.test.ts` (`falls back deterministically when experiment design llm exceeds the timeout`). Live same-flow revalidation in `test/` passed: rerunning `design_experiments` on run `81820c46-d1b6-4080-8575-a35c60583480` updated `design_experiments_panel/candidates.json`, `reviews.json`, `selection.json`, and `brief_design_consistency.json` at `2026-03-19 13:03:57 +0900`, then advanced to the next cycle. Regression status: fixed for the hung design-panel boundary.

## LV-046 implement_experiments reuses a stale public bundle after design retry changes the plan
- Category: live validation issue
- Status: active
- Validation target: `test/` run `81820c46-d1b6-4080-8575-a35c60583480` after LV-045 fix, specifically the `design_experiments -> implement_experiments -> run_experiments` handoff.
- Execution mode: fresh TUI in `test/`, same governed run after a real negative pilot and design retry.
- Reproduction:
  1. Let the run finish `pilot-8ex-1r-20260319-125850` and backtrack to `design_experiments`.
  2. Retry `design_experiments`; observe new `experiment_plan.yaml` and `design_experiments_panel/*` artifacts written around `2026-03-19 13:03:57 +0900`.
  3. Observe `implement_result.json` immediately afterward.
  4. Compare the updated plan with the recovered bundle command and public bundle mtimes.
- Expected behavior: once the experiment plan changes, `implement_experiments` should only reuse a public bundle if the runnable implementation artifacts were regenerated for the current plan; otherwise it must re-implement or fail honestly rather than reusing the old bounded pilot.
- Actual behavior: `implement_result.json` was recovered from the pre-existing public bundle even though `context.plan_changed=true`. The recovered `run_command` still used the old `frozen_config.json` and `--pilot-size 8 --repeats 1`, and a new artifact directory `pilot-8ex-1r-20260319-130402` was started from that stale bundle.
- Fresh vs existing: reproduced in a fresh TUI reopen of the existing run. The persisted plan and implement result disagree even though the live UI shows the workflow continuing.
- Persisted artifact vs UI: persisted `experiment_plan.yaml` contains retry directives to materially exceed the previous 8x1 scope, but persisted `implement_result.json` and public `frozen_config.json` still reflect the old bundle. This is a direct persisted handoff mismatch that can silently flatten paper-quality gains.
- Dominant taxonomy: `persisted_state_bug`
- Root-cause hypothesis: recovered-bundle reuse/recovery logic in `implementSessionManager` only checks that a materialized bundle exists, not that its script/config/README were regenerated after the latest plan update.
- Planned fix: refuse stale bundle reuse/recovery when `plan_changed=true` and the recovered implementation artifacts predate the current plan, add deterministic regression coverage, and rerun the same live flow.

## LV-047 review pre-summary drops baseline/comparator information even when result_analysis and review_packet already have it
- Category: live validation issue
- Status: active
- Validation target: `test/` run `81820c46-d1b6-4080-8575-a35c60583480` at `review`, specifically `review/pre_review_summary.json`
- Execution mode: fresh TUI in `test/` and persisted artifact comparison on the same governed run
- Reproduction:
  1. Run the governed flow in `test/` through `analyze_results -> review`.
  2. Compare `review/pre_review_summary.json` with `result_analysis.json`, `result_table.json`, and `review/review_packet.json`.
  3. Observe the baseline/comparator fields.
- Expected behavior: pre-review summary should surface the explicit baseline/comparator already present in the analysis artifacts so review and paper-facing summaries stay coherent.
- Actual behavior: `pre_review_summary.json` reports `baseline: "(no explicit baseline identified)"` even though `result_analysis.json` includes `current_best_baseline`, `comparison_contract.baseline_binding.source_arm_name`, and `review_packet.json` clearly reasons about explicit baseline comparison.
- Fresh vs existing: reproduced from a fresh TUI reopen of the existing run; the mismatch is persisted on disk, not a session-only projection issue.
- Persisted artifact vs UI: persisted review pre-summary disagrees with persisted result-analysis/review-packet artifacts. The UI review outcome is conservative and correct, but one review-facing artifact underreports comparator discipline.
- Dominant taxonomy: `persisted_state_bug`
- Root-cause hypothesis: `buildPreReviewSummary()` only derives baselines from `report.condition_comparisons[*].label`, so runs that encode the baseline under `metrics.current_best_baseline`, `metrics.comparison_contract.baseline_binding`, or selected-design baselines lose the explicit comparator in the pre-summary.
- Planned fix: expand baseline extraction in `buildPreReviewSummary()` to include structured metric/report fields already present in `result_analysis.json`, add deterministic review-node coverage, then rerun the same review flow in `test/`.
- Update (2026-03-19): patched `src/core/nodes/review.ts` so `pre_review_summary.json` derives explicit baselines from `condition_comparisons`, `metrics.current_best_baseline.arm_name`, `metrics.comparison_contract.baseline_binding.source_arm_name`, and selected-design baselines. Added deterministic coverage in `tests/reviewNode.test.ts`. Revalidated with `npm run build`, `npm test`, `npm run validate:harness`, and a fresh TUI rerun of `review` in `test/`; the same run now rewrites `review/pre_review_summary.json` with `baseline: "current_best_baseline, fixed_cot_256"`. Status: fixed for review pre-summary baseline underreporting.

## LV-048 generate_hypotheses can hang after review-driven backtrack_to_hypotheses because staged LLM calls have no timeout/fallback boundary
- Category: live validation issue
- Status: active
- Validation target: `test/` run `81820c46-d1b6-4080-8575-a35c60583480` after review rerun applies `backtrack_to_hypotheses -> generate_hypotheses`
- Execution mode: fresh TUI in `test/`, same governed run after approving the review transition
- Reproduction:
  1. Rerun `review` and approve its `backtrack_to_hypotheses` transition.
  2. Run `generate_hypotheses` on the same run.
  3. Compare the live TUI status with `hypothesis_generation/status.json`, `hypothesis_generation/progress.jsonl`, and `hypotheses.jsonl`.
- Expected behavior: hypothesis generation should either advance through staged draft/review phases in bounded time or fail over to single-pass/deterministic fallback, eventually rewriting hypothesis artifacts for the new cycle.
- Actual behavior: the live TUI shows `Generating hypotheses...`, while the persisted current-cycle progress stops at `Codex analysis session started.` and the selected hypotheses artifacts remain from the old pre-review cycle.
- Fresh vs existing: reproduced in a fresh TUI reopen of the existing run after review backtracked to `generate_hypotheses`; this is a persisted execution gap rather than a stale session-only render issue.
- Persisted artifact vs UI: the UI shows active hypothesis generation, but persisted current-cycle artifacts only reach the first staged LLM call and do not advance to new drafts/selection. `hypotheses.jsonl` stays on the previous timestamp.
- Dominant taxonomy: `race_timing_bug`
- Root-cause hypothesis: `generateHypothesesFromEvidence()` does not bound its staged `llm.complete(...)` calls, so a stalled Codex/LLM completion can keep the node in `running` forever instead of dropping into the existing single-pass or deterministic fallback path.
- Planned fix: add bounded timeouts around staged and single-pass hypothesis generation LLM calls, add deterministic regression coverage, and rerun the same `review -> generate_hypotheses` flow in `test/`.
- Update (2026-03-19): patched `src/core/analysis/researchPlanning.ts` and `src/core/nodes/generateHypotheses.ts` so staged and single-pass hypothesis generation calls use bounded timeouts and fall through to the existing fallback path. Added deterministic coverage in `tests/generateHypothesesNode.test.ts`. Revalidated with `npm run build`, `npm test`, `npm run validate:harness`, and a fresh TUI rerun in `test/`. The same run now records `hypothesis_axes_timeout:45000ms`, falls through `single_pass`, then completes with fallback instead of remaining `running`; current-cycle `hypotheses.jsonl`, `hypothesis_generation/selection.json`, and `hypothesis_generation/llm_trace.json` were rewritten at `2026-03-19 14:35:13`. Status: fixed for bounded completion of review-driven hypothesis regeneration.

## LV-049 run_experiments can finish with public metrics present but canonical run-root metrics.json missing
- Category: live validation issue
- Status: active
- Validation target: `test/` run `81820c46-d1b6-4080-8575-a35c60583480` at `run_experiments`, with fresh TUI reopen plus harness/doctor inspection.
- Execution mode: fresh interactive TUI in `test/`, resumed existing governed run.
- Reproduction:
  1. Launch the real TUI from `test/`.
  2. Let the TUI recover the stale `run_experiments` node and rerun the governed command.
  3. Run `/doctor`.
  4. Compare `.autolabos/runs/81820c46-d1b6-4080-8575-a35c60583480/metrics.json`, `.autolabos/runs/81820c46-d1b6-4080-8575-a35c60583480/objective_evaluation.json`, and `outputs/budget-aware-adaptive-and-structured-test-time-r-81820c46/experiment/metrics.json`.
- Expected behavior: after a successful or partially successful governed experiment run, the canonical run root should contain `metrics.json` and `objective_evaluation.json`, and public output mirroring should be secondary to that canonical artifact contract.
- Actual behavior: `/doctor` reported `run_metrics_missing` for run `81820c46-d1b6-4080-8575-a35c60583480`; persisted inspection showed `objective_evaluation.json` present in the run root and `outputs/.../experiment/metrics.json` present in the public bundle, but `.autolabos/runs/.../metrics.json` was absent.
- Fresh vs existing: reproduced from a fresh TUI reopen of the existing run; the symptom is persisted on disk and is not a session-only render issue.
- Persisted artifact vs UI: the TUI continued `run_experiments` and showed the governed Python command running, while persisted artifacts violated the run-root contract that the harness and review layers depend on. This is a direct artifact-layer mismatch.
- Dominant taxonomy: `persisted_state_bug`
- Root-cause hypothesis: `run_experiments` validated and published metrics from `resolved.metricsPath`, but only mirrored them to the public experiment directory; it wrote `objective_evaluation.json` to the run root yet skipped canonical `metrics.json` when the execution plan targeted a bundle-local/public metrics path.
- Planned fix: always write canonical run-root `metrics.json` from the validated parsed metrics on the successful `run_experiments` path, regardless of where the runner emitted its raw metrics file; add deterministic regression coverage for public-path metrics.
- Update (2026-03-19): patched `src/core/nodes/runExperiments.ts` to write canonical run-root `metrics.json` before `objective_evaluation.json` on the success path. Added deterministic regression coverage in `tests/objectiveMetricPropagation.test.ts` for the case where `implement_experiments.metrics_path` points at a public bundle metrics file instead of `.autolabos/runs/<id>/metrics.json`. Targeted regression passed: `CI=1 npx vitest run tests/objectiveMetricPropagation.test.ts --pool=forks -t 'auto-runs managed quick_check and confirmatory profiles after a successful standard run'`. Same-flow live revalidation in `test/` is in progress on run `81820c46-d1b6-4080-8575-a35c60583480`.

## LV-050 implement_experiments can resume a stale Codex thread after a design backtrack changes the plan
- Category: live validation issue
- Status: active
- Validation target: `test/` run `81820c46-d1b6-4080-8575-a35c60583480` after `review -> generate_hypotheses -> design_experiments -> implement_experiments`
- Execution mode: fresh interactive TUI in `test/`, resumed existing governed run after the PDF/provider config migration.
- Reproduction:
  1. Let `review` backtrack the run to `generate_hypotheses`, then allow minimal-approval auto-progression through `design_experiments`.
  2. Observe the new cycle’s `experiment_plan.yaml` and `implement_task_spec.json` with `context.plan_changed=true`.
  3. Compare the TUI stream and `implement_experiments/status.json` / `implement_experiments/progress.jsonl`.
  4. Observe the thread id reused for `implement_experiments`.
- Expected behavior: when a new design cycle materially changes the experiment plan, `implement_experiments` should start a fresh implementation turn so the new plan is actually applied to a new prompt/thread.
- Actual behavior: the node entered `implement_experiments` with the previous `threadId` still attached (`019d0421-6ef0-7f00-bcea-7e694feb9342`) even though `implement_task_spec.json` marked `plan_changed=true`; persisted status stayed at `stage=localize`, `progressCount=4`, and the live TUI remained on `Implementing experiments...` with no new persisted progress.
- Fresh vs existing: reproduced from a fresh TUI restart of the existing governed run in `test/`; the stale-thread reuse is persisted through `run.nodeThreads` / `implement_experiments.thread_id`, not just an in-memory render issue.
- Persisted artifact vs UI: the UI shows a fresh `implement_experiments` turn, but persisted `status.json`, `progress.jsonl`, and `implement_task_spec.json` disagree about whether it is a truly fresh turn because the new plan is paired with an old implement thread.
- Dominant taxonomy: `resume_reload_bug`
- Root-cause hypothesis: `ImplementSessionManager.run()` always seeds `activeThreadId` from the previous implement cycle before it knows whether the experiment plan changed, so a backtracked design retry can resume a stale Codex thread instead of forcing a fresh implementation turn.
- Planned fix: if `taskSpec.context.plan_changed=true`, clear the saved implement thread id before the Codex call, start a fresh implementation thread, add deterministic regression coverage, and rerun the same live flow in `test/`.
- Update (2026-03-19): patched `src/core/agents/implementSessionManager.ts` so `implement_experiments` clears the saved thread id and starts a fresh implementation turn whenever `taskSpec.context.plan_changed=true`. Added deterministic coverage in `tests/implementSessionManager.test.ts` (`starts a fresh implement thread when the experiment plan changed`). Revalidated with `npm test`, `npm run validate:harness`, and a fresh TUI rerun in `test/`: `implement_experiments/progress.jsonl` now records `Experiment plan changed since the last implement cycle; starting a fresh implementation thread.`, and the new cycle no longer attaches the stale `019d0421-6ef0-7f00-bcea-7e694feb9342` thread to the retry attempt. Status: fixed for stale implement-thread reuse across design backtracks.

## LV-051 implement_experiments can still recover an invalid bounded-retry bundle that repeats the previous 12x1 local scope
- Category: live validation issue
- Status: active
- Validation target: `test/` run `81820c46-d1b6-4080-8575-a35c60583480` after the LV-050 fix, specifically the `implement_experiments -> run_experiments` handoff on the backtracked design cycle.
- Execution mode: fresh interactive TUI in `test/`, resumed existing governed run after the stale-thread fix.
- Reproduction:
  1. Resume run `81820c46-d1b6-4080-8575-a35c60583480` from `test/` after `review -> generate_hypotheses -> design_experiments`.
  2. Let the fixed `implement_experiments` cycle start fresh.
  3. Observe `implement_result.json`, `implement_experiments/status.json`, `run_experiments_panel/execution_plan.json`, and `test/outputs/.../experiment/frozen_config.json`.
  4. Compare the recovered bundle scope with `design_experiments_panel/retry_context.json`.
- Expected behavior: once the retry context says the next bounded local branch must materially exceed the previous `pilot_size=12, repeats=1` scope, `implement_experiments` should refuse to recover/reuse any bundle whose recovered runnable command still uses `12x1`.
- Actual behavior: the node started fresh, but recovered a plan-aligned bundle whose command still used `--pilot-size 12 --repeats 1`; `run_experiments` then failed honestly with `The bounded retry must materially exceed the previous local scope`.
- Fresh vs existing: reproduced from a fresh TUI reopen of the existing governed run; the mismatch is persisted in the recovered bundle artifacts and not only in the UI projection.
- Persisted artifact vs UI: `design_experiments_panel/retry_context.json` and `experiment_plan.yaml` demand a materially larger bounded retry, while `implement_result.json`, `execution_plan.json`, and `frozen_config.json` still encode the invalid `12x1` scope.
- Dominant taxonomy: `persisted_state_bug`
- Root-cause hypothesis: recovered-bundle validation only checked plan freshness by mtime; it did not inspect the recovered bundle’s runnable scope against the retry guard encoded in `frozen_config.json` / negative-control scope.
- Planned fix: reject recovered bundles whose `run_command` / `frozen_config.json` do not materially exceed the previous bounded local scope, add deterministic coverage, and rerun the same flow in `test/`.
- Update (2026-03-19): patched `src/core/agents/implementSessionManager.ts` so recovered-bundle reuse now parses `frozen_config.json` plus the recovered `run_command`, rejects bundles that do not exceed the previous local retry scope, and falls back to a fresh implementation turn instead of handing an invalid bundle to `run_experiments`. Added deterministic coverage in `tests/implementSessionManager.test.ts` (`does not reuse a recovered bundle when the bounded retry scope does not exceed the previous local scope`). Validation: targeted regression passed, `npm test` passed, `npm run validate:harness` passed, and `npm run build` passed outside the sandbox; inside the sandbox, `vite build` intermittently segfaulted, so the build gap is environment-side rather than a repo compile regression. Live same-flow revalidation for this specific guard is still pending because the current run remains stuck in the already-launched old `run_experiments` retry loop with the invalid `12x1` command.

## LV-052 run_experiments can remain in `running` after a fatal structural runner failure, preventing conservative backtrack or pause
- Category: live validation issue
- Status: fixed
- Validation target: `test/` run `81820c46-d1b6-4080-8575-a35c60583480` after the invalid `12x1` bounded retry reaches `run_experiments`
- Execution mode: fresh interactive TUI in `test/`, resumed existing governed run
- Reproduction:
  1. Resume the same governed run in `test/`.
  2. Let `run_experiments` execute the invalid recovered command `--pilot-size 12 --repeats 1`.
  3. Observe `run_experiments_verify_report.json`, `runs.json`, and the live TUI status.
- Expected behavior: once the runner hits a structural fatal error that cannot be auto-retried honestly, the node should converge to `failed` / `needs_approval` or backtrack conservatively, so the loop can move to the next design cycle.
- Actual behavior: `run_experiments_verify_report.json` records the fatal structural failure, but `runs.json` still shows `currentNode: "run_experiments"` with `status: "running"`, and the TUI keeps surfacing `run_experiments error` / `Running experiments...` with no pending approval.
- Fresh vs existing: reproduced from a fresh TUI reopen of the existing governed run; the stuck state is persisted in `runs.json`, not just a stale UI frame.
- Persisted artifact vs UI: persisted verifier artifacts already classify the run as failed, but persisted run-graph state still says `running`, blocking the next conservative transition.
- Dominant taxonomy: `persisted_state_bug`
- Root-cause hypothesis: `handleFailure()` persisted a `fail` checkpoint while the run still had `status: running`, then later wrote `status: failed` only to `runs.json`; on reload, `RunStore.applyCheckpointDerivedState()` preferred the fresher checkpoint snapshot and resurrected the stale `running` state.
- Code/test changes:
  - `src/core/stateGraph/runtime.ts`
  - `tests/stateGraphRuntime.test.ts`
- Update (2026-03-19): patched `StateGraphRuntime.handleFailure()` to (1) re-read the latest persisted run before applying failure bookkeeping so stale in-memory retries cannot overwrite exhausted counters, and (2) write a final terminal `fail` checkpoint after setting `run.status = "failed"` when retries/rollbacks are exhausted. Added deterministic regression coverage in `tests/stateGraphRuntime.test.ts` (`uses the latest persisted retry state when a stale run_experiments failure arrives`). Validation: targeted regression passed, `tests/terminalAppLaunch.test.ts` passed, `npm test` passed, `npm run build` passed, and `npm run validate:harness` passed outside the sandbox. Same-flow live revalidation in `test/` now converges the persisted run to `status: "failed"` / `nodeStates.run_experiments.status: "failed"` while `run_experiments_verify_report.json` remains `status: "fail"`, matching the TUI after the same fatal bounded-scope error.

## LV-053 duplicate TUI sessions in the same `test/` workspace can compound stale-run recovery and risk server unresponsiveness
- Category: live validation issue
- Status: fixed
- Validation target: real TUI launch discipline in `test/` during repeated live validation loops
- Execution mode: fresh interactive TUI in `test/`, plus a second concurrent fresh launch attempt in the same workspace
- Reproduction:
  1. Launch the real TUI from `test/`.
  2. Leave the first TUI attached to run `81820c46-d1b6-4080-8575-a35c60583480`.
  3. Start a second `../node_modules/.bin/tsx ../src/cli/main.ts` process from the same `test/` workspace.
- Expected behavior: only one live TUI session should own a workspace at a time; duplicate launches should fail fast with a clear operator-facing error instead of attaching a second renderer/recovery loop.
- Actual behavior: before the fix, nothing prevented multiple TUI sessions from reopening the same workspace/run concurrently, which could multiply stale-node recovery and repeated redraw/execution pressure.
- Fresh vs existing: the risk appears specifically when a fresh second session is opened while an existing session is still alive; the first session itself can be healthy.
- Persisted artifact vs UI: the problematic overlap is primarily runtime/session ownership rather than a persisted artifact mismatch, but it can amplify stale persisted-state recovery bugs like LV-052.
- Dominant taxonomy: `race_timing_bug`
- Root-cause hypothesis: `launchTerminalApp()` had no workspace-scoped ownership guard, so repeated operator restarts or accidental duplicate launches could create overlapping TUI processes in the same live validation workspace.
- Code/test changes:
  - `src/tui/TerminalApp.ts`
  - `tests/terminalAppLaunch.test.ts`
- Update (2026-03-19): added a workspace-scoped TUI session lock under `test/.autolabos/runtime/tui-session-lock.json`. A second live launch now fails fast with `Another AutoLabOS TUI session is already running for /home/hanyong/AutoLabOS/test ...`, while stale dead locks are cleared automatically. Deterministic validation passed in `tests/terminalAppLaunch.test.ts`, and same-flow live validation confirmed that a second `test/` TUI launch is rejected while the first session is active.

## LV-054 failed-run natural steering ignored the recorded `transition_recommendation.json` and only proposed retrying the failed node
- Category: live validation issue
- Status: fixed
- Validation target: failed run recovery in `test/`, specifically `run_experiments failed -> design_experiments` backtrack guidance for run `81820c46-d1b6-4080-8575-a35c60583480`
- Execution mode: fresh interactive TUI in `test/`, resumed existing governed run
- Reproduction:
  1. Reopen the failed run in `test/` after LV-052.
  2. Confirm the detail panel shows `Target design_experiments | Auto yes` from `transition_recommendation.json`.
  3. Enter natural steering such as `Backtrack this run to design_experiments and continue with the next governed cycle.`
- Expected behavior: natural failed-run guidance should use the recorded transition recommendation and offer a backtrack/apply action toward `design_experiments`.
- Actual behavior: before the fix, natural guidance ignored the recorded transition artifact, reported `Next action: run`, and armed `/agent retry run_experiments <run>` even though the visible recommendation targeted `design_experiments`.
- Fresh vs existing: reproduced from a fresh TUI reopen of the existing failed run; the mismatch was driven by persisted guidance state versus the natural-command resolver, not by a session-only render glitch.
- Persisted artifact vs UI: `transition_recommendation.json` clearly recommended `backtrack_to_design` with suggested commands `/agent jump design_experiments` and `/agent run design_experiments`, while the natural assistant still proposed retrying `run_experiments`.
- Dominant taxonomy: `persisted_state_bug`
- Root-cause hypothesis: `RunStore` did not hydrate `transition_recommendation.json` back into `run.graph.pendingTransition`, and `buildNaturalAssistantResponse()` always preferred `/agent retry <currentNode>` for failed runs instead of consulting a persisted transition recommendation.
- Code/test changes:
  - `src/core/runs/runStore.ts`
  - `src/core/commands/naturalAssistant.ts`
  - `tests/runStore.test.ts`
  - `tests/naturalAssistant.test.ts`
- Update (2026-03-19): patched `RunStore` to recover `pendingTransition` from `transition_recommendation.json` when the run record lacks one, and patched `naturalAssistant` so failed runs prefer `apply transition` guidance over blind retry when a recorded transition exists. Deterministic regressions passed (`hydrates a missing pendingTransition from transition_recommendation.json`, `prefers an apply-transition recommendation for failed runs when a pending transition exists`). Same-flow live revalidation in `test/` now proposes `/agent apply 81820c46-d1b6-4080-8575-a35c60583480`, successfully applies `backtrack_to_design -> design_experiments`, and advances the run into a new `design_experiments` cycle instead of retrying the failed `run_experiments` node.

## LV-055 implement_experiments local verification can miss Python-invalid JSON booleans, letting a broken runner reach run_experiments
- Category: live validation issue
- Status: active
- Validation target: `test/` run `81820c46-d1b6-4080-8575-a35c60583480` on the revived `design_experiments -> implement_experiments -> run_experiments` cycle
- Execution mode: fresh interactive TUI in `test/`, resumed existing governed run
- Reproduction:
  1. Reopen the failed run in `test/` and backtrack it to `design_experiments`.
  2. Let the revived cycle proceed through `implement_experiments`.
  3. Observe that local verification passes via `python -m py_compile`, then `run_experiments` launches the generated runner.
  4. Observe the runtime failure in the generated Python file: `NameError: name 'false' is not defined. Did you mean: 'False'?`
- Expected behavior: `implement_experiments` local verification should fail before handoff when a generated Python runner contains JSON literals like `false`, `true`, or `null` in executable code.
- Actual behavior: `py_compile` passed, `implement_experiments` completed, and the broken runner only failed later in `run_experiments` after loading model weights.
- Fresh vs existing: reproduced from a fresh `test/` TUI reopen of the existing governed run; the broken literal is persisted in the generated public runner, not a session-only projection issue.
- Persisted artifact vs UI: `implement_experiments` reported successful local verification and second-stage handoff readiness, but the persisted runner source at `test/outputs/.../run_gsm8k_budget_reasoning.py:919` still contained `"paper_ready": false`, which is invalid in Python runtime code.
- Dominant taxonomy: `persisted_state_bug`
- Root-cause hypothesis: local verification relies on `python -m py_compile`, which catches syntax errors but not runtime NameErrors caused by JSON literals embedded in otherwise syntactically valid Python dicts.
- Code/test changes:
  - `src/core/agents/implementSessionManager.ts`
  - `tests/implementSessionManager.test.ts`
- Update (2026-03-19): patched `ImplementSessionManager` to scan verified Python source for leaked JSON literals (`false`, `true`, `null`) after `py_compile` passes and convert them into an `implementation` verification failure before handoff. Added deterministic regression coverage in `tests/implementSessionManager.test.ts` (`fails local verification when a Python runner leaks JSON booleans into source`). Live same-flow revalidation is next: the same run should now stop at `implement_experiments` instead of failing later in `run_experiments`.

## LV-063 implement_experiments ignored `providers.llm_mode` and still launched Codex sessions under `openai_api`
- Category: live validation issue
- Status: fixed
- Validation target: fresh `test/` run `98987fc4-6ce2-4d39-8623-6dacbcb1508d` at `implement_experiments` with `test/.autolabos/config.yaml` set to `providers.llm_mode: openai_api`
- Execution mode: fresh interactive TUI in `test/`, resumed governed run
- Reproduction:
  1. Configure `test/.autolabos/config.yaml` with `providers.llm_mode: openai_api`.
  2. Resume a run that reaches `implement_experiments`.
  3. Observe the live process tree while implementation starts.
- Expected behavior: implementation must obey the configured provider and avoid spawning Codex when `llm_mode` is `openai_api`.
- Actual behavior: `implement_experiments` always called `CodexCliClient.runTurnStream(...)`, and a live `codex exec --json ...` subprocess appeared even though the workspace config selected `openai_api`.
- Fresh vs existing: reproduced from a fresh TUI reopen of an existing run; the mismatch was not a stale UI projection, but an unconditional implementation backend call site.
- Persisted artifact vs UI: operator-facing config and TUI implied the API provider was active, but the actual implementation subprocess was still Codex.
- Dominant taxonomy: `persisted_state_bug`
- Root-cause hypothesis: `ImplementSessionManager` never consulted `config.providers.llm_mode`; unlike `paperWriterSessionManager`, it unconditionally routed implementation turns through Codex and had no staged-LLM materialization path.
- Code/test changes:
  - `src/core/agents/implementSessionManager.ts`
  - `src/core/nodes/implementExperiments.ts`
  - `tests/implementSessionManager.test.ts`
- Update (2026-03-19): patched `ImplementSessionManager` to honor `providers.llm_mode`, choosing `codex_session` only for Codex-backed mode and `staged_llm` for `openai_api`/`ollama`. Added structured `file_edits` materialization so staged LLM responses can write runnable artifacts without silently falling back to Codex. Deterministic regression coverage confirms that `llm_mode=openai_api` does not invoke Codex and still materializes `experiment.py` for local verification.

## Issue: LV-064 provider slot routing drift left experiment work on the generic task slot, let Ollama interactive surfaces fall back to Codex, and kept `/doctor` Codex-centric under non-Codex modes

- Status: `resolved`
- Validation target: provider/slot adherence across `implement_experiments`, `analyze_papers` rerank, TUI/web natural-command surfaces, and `/doctor`
- Environment/session context: repo head on `2026-03-19`; automated validation plus live `test/` TUI reopen of run `98987fc4-6ce2-4d39-8623-6dacbcb1508d`; current workspace config `providers.llm_mode: openai_api`

- Reproduction steps:
  1. Inspect runtime routing in `src/runtime/createRuntime.ts`, `src/core/nodes/implementExperiments.ts`, `src/core/nodes/analyzePapers.ts`, `src/tui/TerminalApp.ts`, `src/interaction/InteractionSession.ts`, and `src/core/doctor.ts`.
  2. Compare configured `chat_*`, `experiment_*`, and provider mode fields against the actual clients each surface constructs.
  3. Run targeted regressions and reopen the real TUI from `test/` with the built CLI to confirm the active implementation backend.

- Expected behavior: configured provider mode and slot intent should be honored everywhere: experiment-facing work should use the configured `experiment_*` slot, `ollama` interactive/chat surfaces should stay on Ollama instead of falling back to Codex, and `/doctor` should only surface Codex as required when Codex is actually active.
- Actual behavior: before the fix, `implement_experiments` still consumed the generic routed task client, `ollama` natural assistant / command intent and paper rerank paths could drop to Codex, `resolveExperimentLlmProfile()` mislabeled Ollama as Codex, and `/doctor` always ran Codex CLI/login checks even when both primary and PDF paths were non-Codex.
- Fresh vs existing session comparison:
  - Fresh session: deterministic tests reproduced the routing drift regardless of session state.
  - Existing session: live `test/` TUI reopen showed the corrected boundary after the patch with `Implementation session starting in staged_llm mode.` under `openai_api`.
  - Divergence: no material fresh-vs-existing divergence; this was a mode-specific policy/config interpretation bug rather than a resume-only issue.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: provider config was normalized correctly, but several runtime call sites still hard-coded Codex-oriented defaults or reused the generic task client instead of consulting the configured provider/slot for the specific surface.

- Code/test changes:
  - Code:
    - `src/core/nodes/types.ts`
    - `src/runtime/createRuntime.ts`
    - `src/core/nodes/implementExperiments.ts`
    - `src/core/experimentLlmProfile.ts`
    - `src/core/nodes/analyzePapers.ts`
    - `src/core/doctor.ts`
    - `src/tui/TerminalApp.ts`
    - `src/interaction/InteractionSession.ts`
  - Tests:
    - `tests/providerRoutingConsistency.test.ts`
    - `tests/implementSessionManager.test.ts`

- Regression status:
  - Automated regression test linked: `yes` — `tests/providerRoutingConsistency.test.ts`, plus targeted reruns of `tests/implementSessionManager.test.ts`, `tests/ollama.test.ts`, `tests/interactionSession.test.ts`, and `tests/terminalAppPlanExecution.test.ts`
  - Re-validation result: `pass` for targeted regressions, `npm run build`, and `npm test`; `node dist/cli/validateHarness.js` still fails because of longstanding malformed legacy `ISSUES.md` entries outside this change.

- Follow-up risks: live `test/` TUI now honors the configured provider boundary, but the current run still exposes an unrelated `run_experiments` retry loop where OpenAI 401s can end as `metrics missing`; that is a separate workflow/runtime blocker, not a provider-routing regression.
- Evidence/artifacts:
  - live TUI from `test/` via `node ../dist/cli/main.js`
  - observed status line: `Implementation session starting in staged_llm mode.`
  - targeted validation:
    - `CI=1 npx vitest run tests/providerRoutingConsistency.test.ts tests/implementSessionManager.test.ts tests/ollama.test.ts tests/interactionSession.test.ts tests/terminalAppPlanExecution.test.ts --pool=forks`
  - full validation:
    - `npm run build`
    - `npm test`


## Issue: LV-065 recovered `implement_experiments` bundles can preserve `--dry-run` and hand them off as real execution, causing resumed `run_experiments` state to collapse into `missing_metrics`

- Status: `in_progress`
- Validation target: `test/` live run `98987fc4-6ce2-4d39-8623-6dacbcb1508d`, specifically `implement_experiments -> run_experiments` after a recovered public bundle
- Environment/session context: repo head on `2026-03-20`; `test/` workspace; `providers.llm_mode: openai_api`; fresh TUI reopen after server reboot; canonical public bundle at `test/outputs/experiment`

- Reproduction steps:
  1. Resume run `98987fc4-6ce2-4d39-8623-6dacbcb1508d` in `test/`.
  2. Observe that `implement_result.json` recovers a materialized bundle after an implementation stream failure.
  3. Inspect the recovered `run_command` and then `run_experiments_panel/execution_plan.json`.
  4. Let `run_experiments` execute the recovered command and inspect `run_experiments_verify_report.json` / `triage.json`.

- Expected behavior: recovered real-execution bundles should only hand off runnable commands that can emit governed metrics; a recovered command that still contains `--dry-run` should be rejected and force a fresh implementation turn instead of entering `run_experiments`.
- Actual behavior: the recovered bundle encoded `python3 .../experiment.py ... --pilot-size 4 --dry-run` in `implement_result.json`, `execution_plan.json`, and `triage.json`, so `run_experiments` ran a dry-run command, exited `0`, emitted no metrics, and the persisted failed state collapsed into `missing_metrics`.
- Fresh vs existing session comparison:
  - Fresh session: a fresh TUI reopen of the existing run shows the persisted dry-run handoff and the same `missing_metrics` triage.
  - Existing session: the earlier session history also shows the same recovered command being used after rollback.
  - Divergence: no; the bug is persisted in the recovered artifacts, not a frame-local projection.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: recovered-bundle validation checks plan freshness and retry scope, but it does not reject a recovered `run_command` that still includes `--dry-run`; local verification then treats the bundle as passable and auto-hands off a non-runnable real-execution command to `run_experiments`.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
  - Tests:
    - `tests/implementSessionManager.test.ts`

- Regression status:
  - Automated regression test linked: `yes` — `tests/implementSessionManager.test.ts`
  - Re-validation result: `pending`

- Follow-up risks: the historical `401 invalid_api_key` entries in the same run happened earlier and are not currently reproducible with the exact `test/.env` key; after this dry-run fix, the next live blocker may return to the original implementation/auth path rather than `missing_metrics`.
- Evidence/artifacts:
  - `test/.autolabos/runs/98987fc4-6ce2-4d39-8623-6dacbcb1508d/implement_result.json`
  - `test/.autolabos/runs/98987fc4-6ce2-4d39-8623-6dacbcb1508d/run_experiments_panel/execution_plan.json`
  - `test/.autolabos/runs/98987fc4-6ce2-4d39-8623-6dacbcb1508d/run_experiments_panel/triage.json`
  - `test/.autolabos/runs/98987fc4-6ce2-4d39-8623-6dacbcb1508d/run_experiments_verify_report.json`
  - `test/.autolabos/runs/98987fc4-6ce2-4d39-8623-6dacbcb1508d/failure_memory.jsonl`


## Issue: LV-066 staged `implement_experiments` provider calls can hang indefinitely in `staged_llm` mode

- Status: `in_progress`
- Validation target: `test/` live rerun of `98987fc4-6ce2-4d39-8623-6dacbcb1508d` after forcing `implement_experiments` from the failed `run_experiments` boundary
- Environment/session context: repo head on `2026-03-20`; `test/` workspace; `providers.llm_mode: openai_api`; built TUI launched from `test/`; same run resumed after LV-065 patch

- Reproduction steps:
  1. Launch the real TUI from `test/` and run `/doctor`.
  2. Force the failed run back to `implement_experiments`.
  3. Observe `implement_experiments/status.json`, `implement_experiments/progress.jsonl`, and the live TUI detail panel.

- Expected behavior: staged OpenAI/Ollama implementation turns should either complete or fail within a bounded provider timeout so the TUI can progress to retry/backtrack instead of waiting indefinitely.
- Actual behavior: after the LV-065 rerun crossed the stale recovered-bundle boundary, `implement_experiments` remained stuck at `Submitting request to OpenAI Responses API.` with `status.json.updatedAt` frozen and no further progress persisted.
- Fresh vs existing session comparison:
  - Fresh session: reproduced from a fresh built-TUI relaunch in `test/`.
  - Existing session: the same run remained in the same stalled provider call when reopened.
  - Divergence: no meaningful divergence; the stall is in the node-owned provider call path itself.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: the staged LLM implementation path forwards the run abort signal but has no node-local timeout shorter than the client’s 10-minute safety timeout, so a hung provider call leaves `implement_experiments` waiting with no bounded recovery path.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
  - Tests:
    - `tests/implementSessionManager.test.ts`

- Regression status:
  - Automated regression test linked: `yes` — `tests/implementSessionManager.test.ts`
  - Re-validation result: `pending`

- Follow-up risks: once the staged-LLM timeout is bounded, the next live blocker may expose the underlying provider error or a fresh implementation failure instead of a hang.
- Evidence/artifacts:
  - `test/.autolabos/runs/98987fc4-6ce2-4d39-8623-6dacbcb1508d/implement_experiments/status.json`
  - `test/.autolabos/runs/98987fc4-6ce2-4d39-8623-6dacbcb1508d/implement_experiments/progress.jsonl`
