# ISSUES.md

Last updated: 2026-03-22

This file was compacted on 2026-03-22 to remove duplicated template fragments, malformed partial entries, and conflicting reused LV identifiers. Detailed pre-cleanup prose remains in git history.

---

## Active issues

### LV-039 — `smoke.yml` fails in build before CI smoke can start
- Status: OPEN
- Taxonomy: `persisted_state_bug`
- Validation target: `.github/workflows/smoke.yml` build gate before `npm run test:smoke:ci`
- Environment: project root, local reproduction of the workflow steps on 2026-03-19
- Reproduction: `npm run build`
- Expected: TypeScript build completes so the smoke job can reach `npm run test:smoke:ci`
- Actual: build fails before smoke starts because at least one caller was not updated for the new `chooseBranchPlan()` signature and `AnalysisManifestEntry.status` still rejects the runtime's `"running"` state.
- Root-cause hypothesis: one compile path missed the fourth `defaultFocusFiles` argument and the analysis manifest typing drifted behind persisted runtime behavior.
- Code/test changes: pending
- Regression status: pending re-validation after the minimal compile fix
- Remaining risks: rerun both `npm run build` and the CI-smoke path after patching.

### LV-056 — Supervisor stops after auto-approved design instead of executing the new pending node
- Status: OPEN
- Taxonomy: `persisted_state_bug`
- Validation target: `test/` live TUI continuation after `design_experiments` auto-approves into `implement_experiments`
- Environment: `test/` workspace, run `81820c46-d1b6-4080-8575-a35c60583480`, cycle 10
- Reproduction: `design_experiments` completes, auto-approves, and advances `currentNode` to `implement_experiments`, but the new node remains `pending` and never starts.
- Expected: the supervised loop should continue directly into the new pending node.
- Actual: the run advances to `implement_experiments`, then the supervisor returns early and leaves the node idle.
- Root-cause hypothesis: `InteractiveRunSupervisor.runUntilStop()` treats the first continuation result as terminal even when the workflow has advanced to a fresh pending node that should execute immediately.
- Code/test changes: pending
- Regression status: pending same-flow live revalidation after the minimal supervisor-loop patch
- Remaining risks: confirm the loop continues exactly once into the new pending node without creating a self-loop when no progress occurs.

### LV-057 — `implement_experiments` reuses a stale Codex thread after run feedback changes the repair target
- Status: OPEN
- Taxonomy: `persisted_state_bug`
- Validation target: `test/` live repair cycle after `run_experiments` fails with new runner feedback
- Environment: `test/` workspace, run `81820c46-d1b6-4080-8575-a35c60583480`, cycle 10
- Reproduction: after a new runner failure, `implement_experiments` resumes with the previous `threadId` and replays stale inspection work instead of anchoring on the new repair target.
- Expected: a new runner failure should start a fresh implementation thread.
- Actual: the old thread is reused and progress stalls while the previous context is replayed.
- Root-cause hypothesis: thread reset depends on plan-hash changes only; fresh runner feedback does not clear the stale thread.
- Code/test changes: pending
- Regression status: pending same-flow revalidation after forcing a fresh implement thread whenever runner feedback is present
- Remaining risks: verify the same run now starts with no carried-over thread and progresses into a fresh repair attempt.

### LV-055 — `implement_experiments` local verification can miss Python-invalid JSON booleans, letting a broken runner reach `run_experiments`
- Status: FIX IMPLEMENTED, LIVE REVALIDATION PENDING
- Taxonomy: `persisted_state_bug`
- Validation target: `test/` revived `design_experiments -> implement_experiments -> run_experiments` cycle
- Environment: `test/` workspace, resumed governed run
- Reproduction: local verification passes with `python -m py_compile`, but generated Python source still contains JSON literals such as `false`, which fail later at runtime with `NameError`.
- Expected: implementation verification should fail before handoff when executable Python source contains JSON booleans or `null`.
- Actual: the broken runner passes compile-time verification and only fails after `run_experiments` launches it.
- Root-cause hypothesis: `py_compile` catches syntax errors but not runtime-invalid JSON literals embedded in otherwise valid Python code.
- Code/test changes:
  - `src/core/agents/implementSessionManager.ts`
  - `tests/implementSessionManager.test.ts`
- Regression status: deterministic regression added; same-flow live revalidation still pending
- Remaining risks: the next live blocker may move back to the implementation turn once this runtime-literal guard is exercised on the real run.

### LV-066 — staged `implement_experiments` provider calls can hang indefinitely in `staged_llm` mode
- Status: IN PROGRESS
- Taxonomy: `race_timing_bug`
- Validation target: `test/` live rerun of `98987fc4-6ce2-4d39-8623-6dacbcb1508d` after forcing `implement_experiments` from the failed `run_experiments` boundary
- Environment: repo head on 2026-03-20, `test/` workspace, `providers.llm_mode: openai_api`
- Reproduction: `implement_experiments` enters `staged_llm`, persists `Submitting request to OpenAI Responses API.`, then stops making progress while `status.json.updatedAt` freezes.
- Expected: staged OpenAI/Ollama implementation turns should complete or fail within a bounded provider timeout.
- Actual: the node can remain in `running` while waiting on a provider call with no node-local timeout/fallback boundary.
- Root-cause hypothesis: the staged LLM implementation path forwards the run abort signal but relies only on the long client safety timeout, so the node-owned execution has no practical bounded recovery path.
- Code/test changes:
  - `src/core/agents/implementSessionManager.ts`
  - `tests/implementSessionManager.test.ts`
- Regression status: deterministic regression added; live re-validation pending
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
- Taxonomy: `in_memory_projection_bug`
- Validation target: fresh first-run TUI startup in tmux
- Root cause: OSC 11 background-query responses were reaching readline keypress handling and being projected into the composer.
- Code/test changes:
  - `src/tui/TerminalApp.ts`
  - `tests/terminalAppPlanExecution.test.ts`
- Validation: `npm run build`, `npm test`, fresh tmux startup revalidation, and a general PTY check confirmed no leaked `11;rgb:...` text.

### LV-064 — Ctrl+C inside an active TUI selection menu canceled only the menu instead of exiting the app
- Status: FIXED
- Taxonomy: `refresh_render_bug`
- Validation target: live TUI selection menu opened from `/model`
- Root cause: active selection handling consumed Ctrl+C as a menu cancel instead of forwarding it to global shutdown.
- Code/test changes:
  - `src/tui/TerminalApp.ts`
  - `tests/terminalAppPlanExecution.test.ts`
- Validation: `npm run build`, `npm test`, and live tmux revalidation confirmed `/model` followed by Ctrl+C exits immediately.

### LV-063 — OpenAI first-run setup asked reasoning effort before the relevant model was chosen
- Status: FIXED
- Taxonomy: `in_memory_projection_bug`
- Validation target: fresh first-run setup under `providers.llm_mode=openai_api`
- Root cause: provider-gated onboarding and setup projection were too broad, so OpenAI could inherit Codex-first prompt ordering and separate PDF-specific controls.
- Code/test changes:
  - `src/config.ts`
  - `web/src/App.tsx`
  - `tests/configEnv.test.ts`
  - `web/src/App.test.tsx`
- Validation: `npm run build`, `npm test`, focused config/web regressions, fresh TUI onboarding checks for OpenAI/Codex/Ollama, and fresh web bootstrap checks all passed.

### LV-062 — Fresh paper-scale runs could hang indefinitely in `analyze_papers` because Responses PDF planner/extractor/reviewer timeouts defaulted to unbounded waits
- Status: FIXED
- Taxonomy: `persisted_state_bug`
- Validation target: fresh `collect_papers -> analyze_papers` path under `providers.llm_mode=openai_api`
- Root cause: default planner/extractor/reviewer timeouts were zero, so remote PDF analysis could wait indefinitely and block fallback.
- Code/test changes:
  - `src/core/analysis/paperAnalyzer.ts`
  - `tests/paperAnalyzer.test.ts`
  - `tests/analyzePapers.test.ts`
- Validation: targeted regressions, `npm test`, and harness validation passed.

### LV-061 — Rebooted host could leave a false-positive live TUI session lock when the saved PID was reused by a non-TUI process
- Status: FIXED
- Taxonomy: `persisted_state_bug`
- Validation target: fresh TUI launch with a stale `tui-session-lock.json`
- Root cause: startup trusted PID reachability alone and treated a reused PID as a live TUI owner.
- Code/test changes:
  - `src/tui/TerminalApp.ts`
  - `tests/terminalAppLaunch.test.ts`
- Validation: targeted regression plus live reboot-style stale-lock revalidation passed.

### LV-060 — fallback paper drafting leaked internal artifact paths into submission prose
- Status: FIXED
- Taxonomy: `in_memory_projection_bug`
- Validation target: `write_paper` fallback drafting after staged LLM failures
- Root cause: raw run constraints were copied into fallback drafting and polish prompts, leaking internal paths such as `.autolabos/` into submission prose.
- Code/test changes:
  - `src/core/analysis/paperWriting.ts`
  - `src/core/analysis/paperManuscript.ts`
  - `tests/paperSubmissionSanitization.test.ts`
- Validation: deterministic sanitization regression plus same-flow live retry confirmed path leakage was removed.

### LV-059 — `write_paper` hard-failed on staged LLM fetch errors instead of degrading to stage-level fallback
- Status: FIXED
- Taxonomy: `in_memory_projection_bug`
- Validation target: `review -> write_paper` under `providers.llm_mode=openai_api`
- Root cause: the staged-LLM paper-writing path awaited provider completions without the fallback wrapper used elsewhere.
- Code/test changes:
  - `src/core/agents/paperWriterSessionManager.ts`
  - `tests/paperWriterSessionManager.test.ts`
- Validation: targeted regression passed and same-flow live revalidation confirmed the node no longer dies on staged fetch failures.

### LV-058 — `run_experiments` could monopolize host responsiveness during heavy local model execution
- Status: FIXED
- Taxonomy: `race_timing_bug`
- Validation target: governed local Python execution in `run_experiments`
- Root cause: local shell commands ran with unconstrained thread settings and normal priority, allowing model-loading work to saturate the host.
- Code/test changes:
  - `src/tools/aciLocalAdapter.ts`
  - `tests/aciLocalAdapter.test.ts`
- Validation: `npm run build`, `npm test`, `npm run validate:harness`, and same-run responsiveness probes all passed.

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
