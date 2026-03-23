# ISSUES.md

Last updated: 2026-03-23

This file was compacted on 2026-03-22 to remove duplicated template fragments, malformed partial entries, and conflicting reused LV identifiers. Detailed pre-cleanup prose remains in git history.

---

## Active issues

### LV-070 — OpenAI Responses implement calls can collapse into opaque fetch failed errors with no actionable network cause
- Status: FIXED
- Validation target: `test/` live `implement_experiments` rerun under `providers.llm_mode=openai_api`
- Environment/session context: repo head on 2026-03-23, `test/` workspace, run `411d5215-b03a-46e4-bf89-ea5a42513288`, fresh patched tmux TUI session `autolabos-api-retry`.
- Reproduction steps:
  1. Resume run `411d5215-b03a-46e4-bf89-ea5a42513288` into `implement_experiments` from a fresh TUI session rooted at `test/`.
  2. Observe `Submitting request to OpenAI Responses API.` in the TUI.
  3. Wait for the request to resolve and inspect `implement_experiments/status.json` plus the live pane.
- Expected behavior: if the OpenAI request fails before an HTTP response arrives, the error should include actionable transport details such as the underlying cause code, errno, or syscall rather than only `fetch failed`.
- Actual behavior: before the fix, the run terminated with `Implementation execution failed before any runnable implementation was produced: fetch failed`, which hid the network failure class and made live triage guesswork.
- Fresh vs existing session comparison:
  - Fresh session: reproduced in a freshly relaunched `test/` TUI after restarting from the latest build.
  - Existing session: the earlier `autolabos-normal` session showed the same terminal summary, but without distinguishing whether the failure came from DNS, connect reset, TLS, or another pre-HTTP transport path.
- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: `responsesTextClient` forwarded raw fetch exceptions directly, so staged implement failures collapsed into the undifferentiated Node fetch message `fetch failed`.
- Code/test changes:
  - `src/integrations/openai/networkError.ts`
  - `src/integrations/openai/responsesTextClient.ts`
  - `src/integrations/openai/responsesPdfAnalysisClient.ts`
  - `tests/responsesTextClient.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/responsesTextClient.test.ts`.
  - Re-validation result: pass — focused `tests/responsesTextClient.test.ts`, full `npm test`, `npm run build`, and a fresh live rerun in `test/` all confirmed that the same implement failure now resolves to `Responses API network request failed before receiving an HTTP response: fetch failed | cause: Headers Timeout Error, code=UND_ERR_HEADERS_TIMEOUT` in both the TUI and persisted run artifacts.
- Remaining risks: the logging fix is in place, and a follow-up transport fix now routes long-running OpenAI experiment requests through Responses background mode with polling. Same-flow live revalidation on run `411d5215-b03a-46e4-bf89-ea5a42513288` confirmed that the prior ~300s `UND_ERR_HEADERS_TIMEOUT` boundary no longer reproduces: the TUI accepted background response `resp_03173fca9888c7bd0069c100536ba881a196e3217057c15131` and kept polling past the former failure window. Final implement completion is still pending, so the remaining risk has shifted from pre-HTTP headers timeout to whether the provider-side background job eventually reaches a terminal state that yields a runnable artifact.

### LV-068 — failed implement_experiments stop can be auto-approved into run_experiments without a runnable artifact
- Status: FIXED
- Validation target: `test/` live minimal-approval continuation from `implement_experiments` into `run_experiments`
- Environment/session context: `test/` workspace, tmux-backed live TUI session `autolabos-loop`, run `411d5215-b03a-46e4-bf89-ea5a42513288`, broad topic `Efficient Test-Time Reasoning for Small Language Models`.
- Reproduction steps:
  1. Let the substantive paper-scale run advance through `design_experiments` into `implement_experiments` under minimal approval mode.
  2. Observe `implement_experiments` stop with `Implementation execution failed before any runnable implementation was produced: implement_experiments staged_llm request timed out after 60000ms`.
  3. Let minimal approval auto-approve that stopped node.
  4. Observe the immediate handoff into `run_experiments`.
  5. Compare the live TUI with `.autolabos/runs/<run>/implement_experiments/status.json`, checkpoints `0021-implement_experiments-before.json` and `0022-implement_experiments-after.json`, and the subsequent `run_experiments` failure.
- Expected behavior: a no-artifact implementation stop should remain a failed implementation boundary and must not auto-advance into `run_experiments` until a runnable experiment artifact exists.
- Actual behavior: the stop is recorded as `needs_approval`, minimal approval auto-approves it, and `run_experiments` then fails with `No runnable experiment artifact found for run 411d5215-b03a-46e4-bf89-ea5a42513288. Execute implement_experiments first.`
- Fresh vs existing session comparison:
  - Fresh session: reproduced and revalidated in a fresh patched TUI relaunch from checkpoint 21. After the fix, the run stayed at `implement_experiments`, retried honestly, and later rolled back to `design_experiments` instead of starting `run_experiments` without an artifact.
  - Existing session: reproduced in the active tmux-backed TUI session listed above before the fix.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `createImplementExperimentsNode()` converts `ImplementSessionStopError` into `status: success` with `needsApproval: true`, so minimal approval treats an environment/no-artifact stop as an approvable completion instead of a failed node.
- Code/test changes:
  - Code: `src/core/nodes/implementExperiments.ts`
  - Tests: `tests/implementSessionManager.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/implementSessionManager.test.ts`
  - Re-validation result: pass — targeted regression, full `npm test`, `npm run build`, `npm run validate:harness`, same-flow live replay from checkpoint 21 in `test/`, and web bootstrap cross-mode verification all confirmed that a no-artifact implementation stop no longer auto-advances into `run_experiments`.
- Remaining risks: the next blocker is now the real `implement_experiments` provider-timeout path itself. The run fails honestly and rolls back, but it still does not produce a runnable artifact, so paper-scale progress remains blocked upstream of `run_experiments`.

### LV-069 — stale run_experiments feedback contaminates a fresh implement turn after design reruns
- Status: FIXED
- Validation target: `test/` live rerun of `411d5215-b03a-46e4-bf89-ea5a42513288` after `design_experiments` reruns and `implement_experiments` resumes with `run_experiments.status = pending`
- Environment/session context: repo head on 2026-03-23, `test/` workspace, run `411d5215-b03a-46e4-bf89-ea5a42513288`, normal `AUTOLABOS_IMPLEMENT_LLM_TIMEOUT_MS`.
- Reproduction steps:
  1. Reproduce the older bad `run_experiments` handoff so `implement_experiments.runner_feedback` stores `No runnable experiment artifact found...`.
  2. Fix the handoff semantics and let the workflow roll back through `design_experiments`, producing a newer design update while `run_experiments` is back to `pending`.
  3. Resume `implement_experiments` and inspect the early TUI progress log.
- Expected behavior: a fresh implementation turn after a newer design rerun should not inherit obsolete runner feedback from a no-longer-active `run_experiments` failure.
- Actual behavior: the implementation session still logged `Loaded runner feedback from run_experiments: No runnable experiment artifact found...`, even though `run_experiments` was `pending` and the design had been regenerated afterward.
- Fresh vs existing session comparison:
  - Fresh session: reproduced and revalidated in a freshly restarted patched TUI against the same `test/` run.
  - Existing session: reproduced in the normal-timeout live continuation before the fix.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `ImplementSessionManager.buildTaskSpec()` loaded persisted runner feedback unconditionally from run context, without checking whether `design_experiments` had been rerun after that feedback was recorded.
- Code/test changes:
  - `src/core/agents/implementSessionManager.ts`
  - `tests/implementSessionManager.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/implementSessionManager.test.ts`.
  - Re-validation result: pass — focused `tests/implementSessionManager.test.ts`, full `npm test`, `npm run build`, `npm run validate:harness`, and same-flow live `test/` replay all confirmed that stale runner feedback is cleared after a newer design rerun. The resumed TUI no longer logs `Loaded runner feedback from run_experiments`, and `run_context.json` now stores both feedback keys as `null`.
- Remaining risks: this removes prompt contamination, but the run is still blocked by the upstream `staged_llm` provider timeout in `implement_experiments`, so paper-scale execution remains incomplete.

### LV-067 — Suggested /agent run generate_hypotheses continuation overwrites partial analyze_papers provenance as skipped
- Status: FIXED
- Validation target: `test/` live TUI continuation from partial `analyze_papers` evidence into `generate_hypotheses`
- Environment/session context: `test/` workspace, existing tmux-backed TUI session `autolabos-loop`, run `411d5215-b03a-46e4-bf89-ea5a42513288`, broad topic `Efficient Test-Time Reasoning for Small Language Models`.
- Reproduction steps:
  1. Resume the existing TUI session with run `411d5215-b03a-46e4-bf89-ea5a42513288` paused in `analyze_papers` after partial evidence persistence.
  2. Observe the suggested continuation command `/agent run generate_hypotheses 411d5215-b03a-46e4-bf89-ea5a42513288`.
  3. Execute that exact suggested command from the live TUI.
  4. Inspect `.autolabos/runs/runs.json` after the run advances.
- Expected behavior: the run should progress into `generate_hypotheses` while preserving `analyze_papers` as an approved/completed partial-analysis boundary with its persisted evidence note intact.
- Actual behavior: the run progresses, but `analyze_papers` is rewritten to `status: skipped` with note `Skipped by jump: manual node run`, overwriting the partial-analysis provenance that justified the continuation.
- Fresh vs existing session comparison:
  - Fresh session: a fresh patched TUI session relaunched in `test/`, resumed checkpoint 8, and preserved `analyze_papers` as `completed` with the partial-analysis note intact while advancing into `generate_hypotheses`.
  - Existing session: reproduced in the live tmux-backed TUI session listed above before the fix, then matched the corrected persisted state after the patch.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `AgentOrchestrator.runAgentWithOptions()` always force-jumps when the requested node differs from `currentNode`, even when the current node is paused with a `pause_for_human` recommendation that explicitly targets the next node. That force jump marks the source node as `skipped` and destroys the audit trail.
- Code/test changes:
  - Code: `src/core/agents/agentOrchestrator.ts`
  - Tests: `tests/agentOrchestrator.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/agentOrchestrator.test.ts`
  - Re-validation result: pass — targeted regression, full `npm test`, `npm run build`, `npm run validate:harness`, same-flow live revalidation from checkpoint 8 in `test/`, and web bootstrap cross-mode projection all preserved the partial-analysis provenance.
- Remaining risks: the next live blocker has moved downstream to long-running `generate_hypotheses` completion quality; non-adjacent manual force-jumps and explicit backtracks still rely on the existing skip semantics and should be validated separately if touched.

### LV-039 — `smoke.yml` fails in build before CI smoke can start
- Status: OPEN
- Validation target: `.github/workflows/smoke.yml` build gate before `npm run test:smoke:ci`
- Environment/session context: project root, local reproduction of the GitHub Actions smoke workflow build gate on 2026-03-19.
- Reproduction steps:
  1. Run `npm run build` from the repository root.
  2. Observe the TypeScript compile phase before the smoke script is reached.
- Expected behavior: TypeScript build completes so the smoke job can reach `npm run test:smoke:ci`.
- Actual behavior: build fails before smoke starts because at least one caller was not updated for the new `chooseBranchPlan()` signature and `AnalysisManifestEntry.status` still rejects the runtime's `running` state.
- Fresh vs existing session comparison:
  - Fresh session: reproduced from a clean root-shell invocation.
  - Existing session: not yet revalidated in a resumed shell because the failure happens at compile time before session-specific state matters.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: one compile path missed the fourth `defaultFocusFiles` argument and the analysis manifest typing drifted behind persisted runtime behavior.
- Code/test changes: pending
- Regression status:
  - Automated regression test linked: no.
  - Re-validation result: pending re-validation after the minimal compile fix.
- Remaining risks: rerun both `npm run build` and the CI-smoke path after patching.

### LV-056 — Supervisor stops after auto-approved design instead of executing the new pending node
- Status: OPEN
- Validation target: `test/` live TUI continuation after `design_experiments` auto-approves into `implement_experiments`
- Environment/session context: `test/` workspace, resumed governed run `81820c46-d1b6-4080-8575-a35c60583480`, cycle 10, minimal approval mode.
- Reproduction steps:
  1. Resume the governed run in `test/` near the `design_experiments` completion boundary.
  2. Let `design_experiments` finish and auto-approve into `implement_experiments`.
  3. Observe the supervisor state after `currentNode` advances.
- Expected behavior: the supervised loop should continue directly into the new pending node.
- Actual behavior: the run advances to `implement_experiments`, then the supervisor returns early and leaves the node idle.
- Fresh vs existing session comparison:
  - Fresh session: not yet reproduced from a fresh run because the boundary depends on an existing cycle-10 design completion.
  - Existing session: reproduced on the resumed governed run listed above.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `InteractiveRunSupervisor.runUntilStop()` treats the first continuation result as terminal even when the workflow has advanced to a fresh pending node that should execute immediately.
- Code/test changes: pending
- Regression status:
  - Automated regression test linked: no.
  - Re-validation result: pending same-flow live revalidation after the minimal supervisor-loop patch.
- Remaining risks: confirm the loop continues exactly once into the new pending node without creating a self-loop when no progress occurs.

### LV-057 — `implement_experiments` reuses a stale Codex thread after run feedback changes the repair target
- Status: OPEN
- Validation target: `test/` live repair cycle after `run_experiments` fails with new runner feedback
- Environment/session context: `test/` workspace, resumed governed run `81820c46-d1b6-4080-8575-a35c60583480`, repair cycle after a new `run_experiments` failure.
- Reproduction steps:
  1. Resume the failed governed run after `run_experiments` reports new runner feedback.
  2. Allow the workflow to re-enter `implement_experiments`.
  3. Observe whether the implementation session starts from a fresh thread or reuses the previous thread.
- Expected behavior: a new runner failure should start a fresh implementation thread.
- Actual behavior: the old thread is reused and progress stalls while the previous context is replayed.
- Fresh vs existing session comparison:
  - Fresh session: not yet reproduced from a fresh run because the stale-thread boundary depends on prior repair history.
  - Existing session: reproduced on the resumed repair cycle listed above.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: thread reset depends on plan-hash changes only; fresh runner feedback does not clear the stale thread.
- Code/test changes: pending
- Regression status:
  - Automated regression test linked: no.
  - Re-validation result: pending same-flow revalidation after forcing a fresh implement thread whenever runner feedback is present.
- Remaining risks: verify the same run now starts with no carried-over thread and progresses into a fresh repair attempt.

### LV-055 — `implement_experiments` local verification can miss Python-invalid JSON booleans, letting a broken runner reach `run_experiments`
- Status: FIX IMPLEMENTED, LIVE REVALIDATION PENDING
- Validation target: `test/` revived `design_experiments -> implement_experiments -> run_experiments` cycle
- Environment/session context: `test/` workspace, resumed governed run on a revived `design_experiments -> implement_experiments -> run_experiments` cycle.
- Reproduction steps:
  1. Resume the governed run at the implementation boundary.
  2. Let `implement_experiments` produce Python source that still contains JSON literals such as `false` or `null`.
  3. Observe that local verification passes, then `run_experiments` fails at runtime with `NameError`.
- Expected behavior: implementation verification should fail before handoff when executable Python source contains JSON booleans or `null`.
- Actual behavior: the broken runner passes compile-time verification and only fails after `run_experiments` launches it.
- Fresh vs existing session comparison:
  - Fresh session: not yet revalidated from a fresh end-to-end run.
  - Existing session: reproduced on the resumed governed run before the deterministic fix was added.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `py_compile` catches syntax errors but not runtime-invalid JSON literals embedded in otherwise valid Python code.
- Code/test changes:
  - `src/core/agents/implementSessionManager.ts`
  - `tests/implementSessionManager.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/implementSessionManager.test.ts`.
  - Re-validation result: deterministic regression added; same-flow live revalidation still pending.
- Remaining risks: the next live blocker may move back to the implementation turn once this runtime-literal guard is exercised on the real run.

### LV-066 — staged `implement_experiments` provider calls can hang indefinitely in `staged_llm` mode
- Status: IN PROGRESS
- Validation target: `test/` live rerun of `98987fc4-6ce2-4d39-8623-6dacbcb1508d` after forcing `implement_experiments` from the failed `run_experiments` boundary
- Environment/session context: repo head on 2026-03-20, `test/` workspace, run `98987fc4-6ce2-4d39-8623-6dacbcb1508d`, `providers.llm_mode: openai_api`.
- Reproduction steps:
  1. Resume the failed run and force it back into `implement_experiments`.
  2. Observe the staged LLM path persist `Submitting request to OpenAI Responses API.`.
  3. Wait for node-local progress and compare `status.json.updatedAt` over time.
- Expected behavior: staged OpenAI/Ollama implementation turns should complete or fail within a bounded provider timeout.
- Actual behavior: the node can remain in `running` while waiting on a provider call with no node-local timeout or fallback boundary.
- Fresh vs existing session comparison:
  - Fresh session: not yet reproduced from a fresh run because the boundary depends on a failed implementation retry path.
  - Existing session: reproduced on the resumed failed run listed above.
- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: the staged LLM implementation path forwards the run abort signal but relies only on the long client safety timeout, so the node-owned execution has no practical bounded recovery path.
- Code/test changes:
  - `src/core/agents/implementSessionManager.ts`
  - `tests/implementSessionManager.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/implementSessionManager.test.ts`.
  - Re-validation result: deterministic regression added; live re-validation pending.
- Remaining risks: after bounding the staged-LLM timeout, the next blocker may expose the underlying provider error rather than the hang itself.

---

## Open risks

### R-001 — Result-table discipline and claim→evidence linkage
- Status: MITIGATED
- What was done: `design_experiments` writes `baseline_summary.json`; `analyze_results` writes `result_table.json`; `review` gate checks both and blocks when missing.
- Remaining risk: quality of content inside these artifacts still depends on the generated analysis.

### R-002 — Scientific gate warnings surfacing
- Status: MITIGATED
- What was done: gate warnings are grouped by category with severity labels and surfaced as limitation sentences in the manuscript.
- Remaining risk: categories are still coarse and can require operator review.

### R-003 — System-validation paper shape over-promotion
- Status: MITIGATED
- What was done: manuscript classification now downgrades missing-baseline / missing-results / missing-richness cases.
- Remaining risk: a structurally complete fake-mode run can still look stronger than the underlying evidence.

### P-001 — Baseline/comparator packaging
- Status: MITIGATED
- What was done: `baseline_summary.json` is written by `design_experiments`; review downgrades when missing.

### P-002 — Compact quantitative result packaging
- Status: MITIGATED
- What was done: `result_table.json` is written by `analyze_results`; review downgrades when missing.

### P-003 — Related-work depth signaling
- Status: MITIGATED
- What was done: `analyze_papers_richness_summary.json` tracks full-text coverage and feeds readiness classification.
- Remaining risk: full-text grounding still depends on PDF availability.

---

## Recent live validation log

### LV-065 — TUI startup could leak the OSC 11 terminal background response into the composer input
- Status: FIXED
- Validation target: fresh first-run TUI startup in tmux
- Environment/session context: repo head on 2026-03-22, fresh tmux-backed TUI startup in the workspace root.
- Reproduction steps:
  1. Start the TUI in tmux with terminal background probing enabled.
  2. Observe the composer immediately after startup.
  3. Check whether the OSC 11 terminal response is injected into input text.
- Expected behavior: terminal background probing should not leak raw OSC 11 responses into the composer.
- Actual behavior: raw `11;rgb:...` content could appear in the input buffer on startup.
- Fresh vs existing session comparison:
  - Fresh session: reproduced on startup before the fix.
  - Existing session: not observed as a resume-only issue; the symptom was startup-specific.
- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: OSC 11 background-query responses were reaching readline keypress handling and being projected into the composer.
- Code/test changes:
  - `src/tui/TerminalApp.ts`
  - `tests/terminalAppPlanExecution.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/terminalAppPlanExecution.test.ts`.
  - Re-validation result: `npm run build`, `npm test`, fresh tmux startup revalidation, and a general PTY check confirmed no leaked `11;rgb:...` text.

### LV-064 — Ctrl+C inside an active TUI selection menu canceled only the menu instead of exiting the app
- Status: FIXED
- Validation target: live TUI selection menu opened from `/model`
- Environment/session context: live TUI session with an active selection menu opened from `/model`.
- Reproduction steps:
  1. Launch the TUI and open the `/model` selection menu.
  2. Press Ctrl+C while the menu is active.
  3. Observe whether the app exits or only the menu closes.
- Expected behavior: Ctrl+C should trigger global shutdown even while a selection menu is active.
- Actual behavior: the menu was canceled but the app remained open.
- Fresh vs existing session comparison:
  - Fresh session: reproduced in a fresh TUI launch.
  - Existing session: no divergence noted; the bug was tied to the active menu state.
- Root cause hypothesis:
  - Type: `refresh_render_bug`
  - Hypothesis: active selection handling consumed Ctrl+C as a menu cancel instead of forwarding it to global shutdown.
- Code/test changes:
  - `src/tui/TerminalApp.ts`
  - `tests/terminalAppPlanExecution.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/terminalAppPlanExecution.test.ts`.
  - Re-validation result: `npm run build`, `npm test`, and live tmux revalidation confirmed `/model` followed by Ctrl+C exits immediately.

### LV-063 — OpenAI first-run setup asked reasoning effort before the relevant model was chosen
- Status: FIXED
- Validation target: fresh first-run setup under `providers.llm_mode=openai_api`
- Environment/session context: fresh first-run setup under `providers.llm_mode=openai_api` in both TUI and web bootstrap flows.
- Reproduction steps:
  1. Start from an unconfigured workspace with `providers.llm_mode=openai_api`.
  2. Open the first-run setup flow in TUI or web.
  3. Observe the ordering of model and reasoning prompts.
- Expected behavior: OpenAI setup should ask for the relevant model before reasoning effort and should not show PDF-specific controls.
- Actual behavior: OpenAI inherited Codex-first prompt ordering and separate PDF-specific controls.
- Fresh vs existing session comparison:
  - Fresh session: reproduced on first-run setup.
  - Existing session: not the dominant boundary because the issue was first-run projection.
- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: provider-gated onboarding and setup projection were too broad, so OpenAI could inherit Codex-first prompt ordering and separate PDF-specific controls.
- Code/test changes:
  - `src/config.ts`
  - `web/src/App.tsx`
  - `tests/configEnv.test.ts`
  - `web/src/App.test.tsx`
- Regression status:
  - Automated regression test linked: yes, `tests/configEnv.test.ts` and `web/src/App.test.tsx`.
  - Re-validation result: `npm run build`, `npm test`, focused config/web regressions, fresh TUI onboarding checks for OpenAI/Codex/Ollama, and fresh web bootstrap checks all passed.

### LV-062 — Fresh paper-scale runs could hang indefinitely in `analyze_papers` because Responses PDF planner/extractor/reviewer timeouts defaulted to unbounded waits
- Status: FIXED
- Validation target: fresh `collect_papers -> analyze_papers` path under `providers.llm_mode=openai_api`
- Environment/session context: fresh paper-scale run under `providers.llm_mode=openai_api`, `collect_papers -> analyze_papers` boundary.
- Reproduction steps:
  1. Start a fresh paper-scale run under OpenAI mode.
  2. Let `collect_papers` finish and enter `analyze_papers`.
  3. Observe whether planner/extractor/reviewer waits are bounded when remote PDF analysis slows or stalls.
- Expected behavior: planner, extractor, and reviewer waits should remain bounded so fallback can proceed.
- Actual behavior: zero default timeouts let remote PDF analysis wait indefinitely and block fallback.
- Fresh vs existing session comparison:
  - Fresh session: reproduced on a fresh paper-scale run.
  - Existing session: no separate divergence established; the issue was already visible on fresh progression.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: default planner/extractor/reviewer timeouts were zero, so remote PDF analysis could wait indefinitely and block fallback.
- Code/test changes:
  - `src/core/analysis/paperAnalyzer.ts`
  - `tests/paperAnalyzer.test.ts`
  - `tests/analyzePapers.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/paperAnalyzer.test.ts` and `tests/analyzePapers.test.ts`.
  - Re-validation result: targeted regressions, `npm test`, and harness validation passed.

### LV-061 — Rebooted host could leave a false-positive live TUI session lock when the saved PID was reused by a non-TUI process
- Status: FIXED
- Validation target: fresh TUI launch with a stale `tui-session-lock.json`
- Environment/session context: fresh TUI launch after a reboot-style stale `tui-session-lock.json` remained in the workspace.
- Reproduction steps:
  1. Leave behind a stale `tui-session-lock.json` with a reused PID.
  2. Launch the TUI after a reboot-style environment change.
  3. Observe whether startup treats the reused PID as a live TUI owner.
- Expected behavior: startup should reject stale locks owned by unrelated reused PIDs.
- Actual behavior: startup trusted PID reachability alone and treated a reused PID as a live TUI owner.
- Fresh vs existing session comparison:
  - Fresh session: reproduced on a fresh launch after the stale lock remained.
  - Existing session: not the relevant boundary because the symptom occurred before the app fully resumed.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: startup trusted PID reachability alone and treated a reused PID as a live TUI owner.
- Code/test changes:
  - `src/tui/TerminalApp.ts`
  - `tests/terminalAppLaunch.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/terminalAppLaunch.test.ts`.
  - Re-validation result: targeted regression plus live reboot-style stale-lock revalidation passed.

### LV-060 — fallback paper drafting leaked internal artifact paths into submission prose
- Status: FIXED
- Validation target: `write_paper` fallback drafting after staged LLM failures
- Environment/session context: `write_paper` fallback drafting after staged LLM failures during a governed paper-writing attempt.
- Reproduction steps:
  1. Reach `write_paper` and force the staged LLM path to fail.
  2. Let the fallback drafting path produce submission prose.
  3. Inspect the draft for leaked internal runtime paths.
- Expected behavior: fallback drafting should not leak internal artifact paths such as `.autolabos/` into submission prose.
- Actual behavior: raw run constraints were copied into fallback drafting and polish prompts, leaking internal artifact paths.
- Fresh vs existing session comparison:
  - Fresh session: reproduced on the first fallback drafting attempt after staged failure.
  - Existing session: no material divergence noted.
- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: raw run constraints were copied into fallback drafting and polish prompts, leaking internal artifact paths such as `.autolabos/` into submission prose.
- Code/test changes:
  - `src/core/analysis/paperWriting.ts`
  - `src/core/analysis/paperManuscript.ts`
  - `tests/paperSubmissionSanitization.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/paperSubmissionSanitization.test.ts`.
  - Re-validation result: deterministic sanitization regression plus same-flow live retry confirmed path leakage was removed.

### LV-059 — `write_paper` hard-failed on staged LLM fetch errors instead of degrading to stage-level fallback
- Status: FIXED
- Validation target: `review -> write_paper` under `providers.llm_mode=openai_api`
- Environment/session context: `review -> write_paper` under `providers.llm_mode=openai_api`, with staged LLM fetch errors injected.
- Reproduction steps:
  1. Reach `write_paper` under OpenAI mode.
  2. Force staged LLM fetch errors during drafting.
  3. Observe whether the node degrades to fallback or hard-fails.
- Expected behavior: staged LLM fetch errors should degrade to stage-level fallback rather than killing the node.
- Actual behavior: the staged-LLM paper-writing path awaited provider completions without the fallback wrapper used elsewhere.
- Fresh vs existing session comparison:
  - Fresh session: reproduced on a fresh `review -> write_paper` attempt.
  - Existing session: no distinct resume-only divergence was required to trigger it.
- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: the staged-LLM paper-writing path awaited provider completions without the fallback wrapper used elsewhere.
- Code/test changes:
  - `src/core/agents/paperWriterSessionManager.ts`
  - `tests/paperWriterSessionManager.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/paperWriterSessionManager.test.ts`.
  - Re-validation result: targeted regression passed and same-flow live revalidation confirmed the node no longer dies on staged fetch failures.

### LV-058 — `run_experiments` could monopolize host responsiveness during heavy local model execution
- Status: FIXED
- Validation target: governed local Python execution in `run_experiments`
- Environment/session context: governed local Python execution in `run_experiments` on a host sensitive to heavy local-model startup load.
- Reproduction steps:
  1. Launch a governed local Python experiment run that loads a heavy local model.
  2. Observe host responsiveness while `run_experiments` is active.
  3. Compare whether thread and priority limits keep the machine responsive.
- Expected behavior: local experiment execution should remain bounded enough that the host stays responsive.
- Actual behavior: local shell commands ran with unconstrained thread settings and normal priority, allowing model-loading work to saturate the host.
- Fresh vs existing session comparison:
  - Fresh session: reproduced on a fresh governed local execution.
  - Existing session: no divergence noted; the symptom followed the execution mode, not resume state.
- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: local shell commands ran with unconstrained thread settings and normal priority, allowing model-loading work to saturate the host.
- Code/test changes:
  - `src/tools/aciLocalAdapter.ts`
  - `tests/aciLocalAdapter.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/aciLocalAdapter.test.ts`.
  - Re-validation result: `npm run build`, `npm test`, `npm run validate:harness`, and same-run responsiveness probes all passed.

---

## Archived summary

| ID | Summary | Status |
|---|---|---|
| LV-054 | Failed-run natural steering ignored persisted transition recommendations | fixed |
| LV-053 | Duplicate TUI sessions in the same workspace could overlap recovery and execution | fixed |
| LV-052 | Fatal runner failures could leave `run_experiments` stuck in `running` | fixed |
| LV-051 | Recovered bundles could repeat an invalid bounded local scope | fix landed; live same-flow revalidation was pending at the time |
| LV-050 | `implement_experiments` could resume a stale thread after a design backtrack changed the plan | fixed |
| LV-049 | Canonical run-root `metrics.json` could be missing while public metrics existed | fixed |
| LV-048 | `generate_hypotheses` could hang after review-driven backtrack because staged LLM calls had no timeout/fallback boundary | fixed |
| LV-047 | Review pre-summary could drop explicit baseline/comparator information already present in artifacts | fixed |
| LV-046 | `implement_experiments` could reuse a stale public bundle after a design retry changed the plan | fixed / superseded by later bundle freshness validation |
| LV-045 | `design_experiments` retry could hang after loading retry context without committing a new panel | fixed |
| LV-044 | `run_experiments` could omit required `--run-dir` and `--metrics-path` arguments | fixed |
| LV-043 | Design retry ignored bounded failure evidence from the previous cycle | fixed |
| LV-040 | Codex runtime could fail when default `~/.codex` was not writable in the sandbox | fixed |
| LV-038 | `analyze_papers` selection regression could prune preserved artifacts before the guard fired | deterministic fix landed; clean same-flow live revalidation was pending at the time |
| LV-037 | Reopening the TUI could auto-retry an actively running `analyze_papers` node and misproject progress | fixed |
| LV-036 | `collect_papers` retry could leave a stale aborted-fetch error visible while the node was running | fixed |
| LV-035 | Brief-driven collect fallback could collapse a paper-scale topic into a generic Semantic Scholar query | fixed |
| LV-034 | `/new` could create a non-paper-scale brief and `/brief start` could run it anyway | fixed |
| LV-033 | Review critique could create an infinite backtrack loop | fixed |
| LV-032 | `/resume` did not trigger `continueSupervisedRun()` | fixed |
| LV-031 | `implement_experiments` could generate CPU-only code despite available GPU | fixed |
| LV-030 | TUI could crash with unhandled `EIO` when stdout disconnected during render | fixed |
| LV-029b | `recoverStaleRunningNode()` could reset status without triggering execution | fixed |
| LV-029 | Stale `running` node state could persist after TUI kill / resume | fixed |
| LV-028 | Harness validation could miss `ISSUES.md` when the workspace was a subdirectory | fixed |

---

## Legacy draft issues to re-triage

These older notes were removed from the main timeline because the previous document had conflicting reused LV IDs or partially duplicated template prose. Re-enter them with a fresh LV ID only after fresh reproduction.

| Legacy ID | Previous title | Last known state |
|---|---|---|
| H-039 | `implement_experiments` started with an empty branch focus when localization missed the governed experiment workspace | fixed |
| H-041 | `implement_experiments` paused because Codex API streaming disconnected in the sandboxed validation environment | environment blocker / needs fresh reproduction |
| H-042 | `implement_experiments` could materialize and execute the governed bundle but leave workflow state behind the artifacts | needs fresh reproduction |
| H-063 | `implement_experiments` ignored `providers.llm_mode` and still launched Codex under `openai_api` | fixed |
| H-064 | Provider slot routing drift left experiment work on the generic task slot and kept `/doctor` Codex-centric under non-Codex modes | fixed |
| H-065 | Recovered `implement_experiments` bundles could preserve `--dry-run` and hand them off as real execution | superseded by later bundle-validation work; re-triage if reproduced |
