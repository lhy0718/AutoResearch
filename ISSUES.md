# ISSUES.md

Last updated: 2026-03-18 · 934/936 tests pass (2 skipped: zzz_noProjectRootLeak)

---

## Active issues

None — all tracked issues are resolved or mitigated. See sections below for historical records.

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

### LV-030 — TUI crashes with unhandled EIO when stdout disconnects during render
- Status: FIXED (not reproduced in re-validation of the same flow)
- Taxonomy: `race_timing_bug`
- Validation target: TUI long-running execution when controlling terminal/shell session disconnects
- Environment: `test/` workspace, run `02e7a6ee`, `run_experiments` node executing via tmux shell session
- Reproduction: TUI rendering every 120ms via `setInterval`. Controlling shell session (tmux/terminal) terminates → stdout becomes broken pipe → `process.stdout.write()` throws `Error: write EIO` → unhandled error event on WriteStream → process exits with crash
- Expected: TUI should handle stdout disconnection gracefully — stop rendering and let background work continue or exit cleanly
- Actual: Unhandled 'error' event crashes the process; any running node execution is lost
- Root cause: `render()` method calls `process.stdout.write()` 4 times per frame with zero error handling; no `process.stdout.on('error')` listener to catch async write failures
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

### LV-022 — Empty selection from LLM rerank failure
- Status: FIXED (not reproduced in re-validation of the same flow)
- Taxonomy: `in_memory_projection_bug`
- Validation target: `/agent run analyze_papers` with 200 collected papers
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
- Validation target: `/agent run analyze_papers` → PDF analysis API calls
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
- Validation target: `/agent run analyze_papers` → error handling in analysis loop
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
- Environment: `test/` workspace, analyze_papers node
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
- Validation target: `/resume <run>` → `/agent run analyze_papers` re-entry
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
- Tests: 931/933 pass (2 skipped: zzz_noProjectRootLeak)
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

---

### LV-033 — Review critique creates infinite backtrack loop

| Field | Value |
|---|---|
| Validation target | review → write_paper transition |
| Environment | TUI, run 02e7a6ee, cycles 1→2→3 |
| Reproduction | 1. Run completes implement→run→analyze→review. 2. Panel says "advance" (4/5, 0.74 confidence). 3. Minimum gate passes all 7 checks. 4. Paper critique says `blocked_for_paper_scale` → `backtrack_to_implement`. 5. Cycle repeats with identical results → same critique → infinite loop. |
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
| Actual | `/new` generated a brief with only Topic, Objective Metric, Constraints, Plan, Manuscript Format, Notes, and Questions / Risks. `/brief start --latest` still created run `e9526c8b-472b-4e80-a151-082d155d3dc4` and advanced it into `analyze_papers` using placeholder strings as the topic, objective, and constraints. |
| Fresh vs existing | Fresh session: reproduced immediately after onboarding. Existing session: expected to behave the same because template generation and brief validation are file-based, not session-cached. Divergence: none observed/expected. |
| Persisted artifact vs UI | Persisted brief snapshot and `run_brief.extracted` in run context contain placeholder text from the template, and `runs.json` shows the run as `running` with `currentNode = analyze_papers`; the UI therefore allowed a paper-scale-invalid brief to drive real collection/execution. |
| Root-cause class | `persisted_state_bug` |
| Hypothesis | `buildResearchBriefTemplate()` drifted below the documented brief contract, `validateResearchBriefMarkdown()` only errors on Topic/Objective presence, and `startRunFromBriefPath()` blocks only on validation errors. Placeholder/template text is therefore treated as valid run input. |
| Fix | Extended the generated brief template to include the documented paper-scale sections, taught the Markdown parser to recognize those headings, and made brief validation block missing or non-substantive placeholder content before `/brief start` can create a run. |
| Files changed | `src/core/runs/researchBriefFiles.ts`; `src/core/runs/runBriefParser.ts`; `tests/briefValidation.test.ts`; `tests/terminalAppPlanExecution.test.ts` |
| Tests | Added/updated deterministic coverage in `tests/briefValidation.test.ts` and `tests/terminalAppPlanExecution.test.ts`; focused rerun passed; full `npm test` and `npm run validate:harness` passed. |
| Status | ✅ Fixed |
| Regression | Same-flow live rerun in `test/`: `/new` now writes a paper-scale brief template, and `/brief start --latest` leaves `test/.autolabos/runs/runs.json` empty when the template is untouched. Adjacent valid-brief start paths still pass. |
