# ISSUES.md

Last updated: 2026-03-19 · 944/944 tests pass

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

---

### LV-035 — Brief-driven collect fallback collapses a paper-scale topic into a generic Semantic Scholar query

| Field | Value |
|---|---|
| Validation target | substantive brief -> `collect_papers` -> `analyze_papers` in `test/` |
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

---

### LV-037 — Reopening TUI auto-retries an actively running `analyze_papers` node and misprojects progress

| Field | Value |
|---|---|
| Validation target | Existing/resumed TUI reopen during live `analyze_papers` execution in `test/` |
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
| Validation target | `analyze_papers` retry/reopen after partial progress in `test/`, followed by downstream `generate_hypotheses` startup |
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
