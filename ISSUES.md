# ISSUES.md

Last updated: 2026-03-25

This file was compacted on 2026-03-22 to remove duplicated template fragments, malformed partial entries, and conflicting reused LV identifiers. Detailed pre-cleanup prose remains in git history.

---

## Current issue log

### LV-079 — downstream analyze failure can roll a successful real collect run back into a second provider search
- Status: FIXED
- Validation target: fresh direct live/provider-backed `collect_papers` TUI run using `/agent collect ...` without deterministic smoke fixtures or fake provider responses
- Environment/session context: repo head on 2026-03-25, temporary workspace `/tmp/autolabos-real-collect-hAu8a6` copied from `test/.autolabos`, run `411d5215-b03a-46e4-bf89-ea5a42513288`, real provider traffic enabled, no `AUTOLABOS_FAKE_*` collect fixtures, `OPENAI_API_KEY` absent while the workspace remained configured for Responses API PDF analysis.
- Reproduction steps:
  1. Launch a fresh TUI rooted at `/tmp/autolabos-real-collect-hAu8a6`, run `/doctor`, then submit `/agent collect "small language model reasoning" --limit 10 --last-years 5 --run 411d5215-b03a-46e4-bf89-ea5a42513288`.
  2. Let `collect_papers` complete with real Semantic Scholar/OpenAlex/Crossref/arXiv traffic, then keep the same session running as the workflow auto-advances into `analyze_papers`.
  3. Inspect the live PTY log plus `.autolabos/runs/411d5215-b03a-46e4-bf89-ea5a42513288/run_record.json`, `collect_result.json`, `collect_search_aggregation.json`, and `events.jsonl`.
- Expected behavior: once `collect_papers` has completed successfully, a downstream `analyze_papers` configuration failure should surface honestly at `analyze_papers`; it must not trigger a second real provider search or increment `collect_papers.executions`.
- Actual behavior: the live run completed real multi-provider collect successfully (`collect_result.json` recorded `completed=true`, `source="aggregated"`, `stored=34`), then `analyze_papers` failed with `OPENAI_API_KEY is required when PDF analysis mode is set to Responses API.` The runtime retried `analyze_papers`, and after retries/collect-enrichment timing converged it auto-rolled back to `collect_papers`, which reran the same real search and pushed `usage.byNode.collect_papers.executions` to `2`.
- Fresh vs existing session comparison:
  - Fresh session: reproduced in a fresh temporary workspace and same-session live TUI run with no reopen/reload boundary; the duplicate provider traffic happened inside the original session after `collect_papers` had already succeeded once.
  - Existing session: not yet separately exercised because the incorrect rollback happens before any restart boundary and already reproduces in the minimal fresh-session case.
  - Divergence: not established yet; current evidence shows the bug does not require session reopen/reload.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: generic `StateGraphRuntime` failure handling treated this `analyze_papers` environment/configuration error like a retry/rollback-worthy upstream problem, so it exhausted retries and rewound to `collect_papers` even though collect had already succeeded and the actual fix required credentials/configuration rather than a second provider search.
- Code/test changes:
  - Code: `src/core/stateGraph/runtime.ts` now classifies the Responses API PDF missing-key failure from `analyze_papers` as a non-retryable, non-rollbackable configuration failure. The runtime stops at `analyze_papers`, marks the run failed in place, and emits environment/configuration-focused observations instead of rewinding to `collect_papers`.
  - Tests: added a regression in `tests/stateGraphRuntime.test.ts` that runs a real collect->analyze runtime loop with `collect_papers` succeeding and `analyze_papers` failing on the Responses API key requirement, then asserts `collect_papers.executions=1`, `analyze_papers.executions=1`, `currentNode=analyze_papers`, and no auto rollback.
- Regression status:
  - Automated regression test linked: `tests/stateGraphRuntime.test.ts`
  - Re-validation result: FIXED via targeted `npx vitest run tests/stateGraphRuntime.test.ts`, full `npm run build`, full `npm test`, `npm run validate:harness`, same-flow direct PTY revalidation in `/tmp/autolabos-real-collect-rerun-g0saut`, and adjacent real open-access PTY revalidation in `/tmp/autolabos-real-collect-open-1nZuCN`.
- Remaining risks: real collect runs still fail honestly at `analyze_papers` when `OPENAI_API_KEY` is absent for Responses API PDF mode, so end-to-end progression still requires valid LLM credentials. The fix only removes the incorrect retry/rollback behavior and duplicate provider traffic.
- Evidence/artifacts: `/tmp/autolabos-real-collect-hAu8a6/.autolabos/runs/411d5215-b03a-46e4-bf89-ea5a42513288/run_record.json`; `/tmp/autolabos-real-collect-hAu8a6/.autolabos/runs/411d5215-b03a-46e4-bf89-ea5a42513288/collect_result.json`; `/tmp/autolabos-real-collect-hAu8a6/.autolabos/runs/411d5215-b03a-46e4-bf89-ea5a42513288/collect_search_aggregation.json`; `/tmp/autolabos-real-collect-hAu8a6/.autolabos/runs/411d5215-b03a-46e4-bf89-ea5a42513288/events.jsonl`; `/tmp/autolabos-real-collect-rerun-g0saut/.autolabos/runs/411d5215-b03a-46e4-bf89-ea5a42513288/run_record.json`; `/tmp/autolabos-real-collect-open-1nZuCN/.autolabos/runs/411d5215-b03a-46e4-bf89-ea5a42513288/run_record.json`; PTY logs from the same live runs on 2026-03-25

### LV-078 — reopened collect sessions can replay historical collect logs as if they are live
- Status: FIXED
- Validation target: reopened `test/smoke-workspace` TUI session after a confirmed collect run has already persisted `collect_background_job.json`
- Environment/session context: repo head on 2026-03-25, `test/smoke-workspace`, run `9727e56e-19bc-46bb-bf5c-88d3be06af0d`, fake Codex structured collect action, `AUTOLABOS_FAKE_SEMANTIC_SCHOLAR_RESPONSE` set to the 3-paper smoke fixture, collect flow already completed once and left deferred enrichment pending.
- Reproduction steps:
  1. Prepare `test/smoke-workspace`, launch a fresh TUI, run the natural query `최근 5년 관련도 순으로 100개 수집해줘`, confirm the pending collect step, and let `collect_papers` complete once.
  2. Exit the TUI before deferred enrichment finishes, then relaunch a fresh TUI process rooted at the same workspace without issuing a new collect command.
  3. Compare the reopened startup log with `.autolabos/runs/9727e56e-19bc-46bb-bf5c-88d3be06af0d/run_record.json` and the persisted event log.
- Expected behavior: the reopened session may replay recent persisted history for context, but those lines should be visibly marked as replayed so the operator can distinguish them from live recovery events; persisted state should continue to show that `collect_papers` only executed once.
- Actual behavior: before the fix, the reopened TUI printed historical `Node collect_papers started.`, `Searching Semantic Scholar for "AI agent automation" (requested_query).`, and completion lines with the same formatting as live stream events, then separately printed `Recovered deferred enrichment background task after restart...`. Persisted state showed no second execution (`run_record.json` kept `usage.byNode.collect_papers.executions=1`), but the operator-visible log looked like `collect_papers` had rerun.
- Fresh vs existing session comparison:
  - Fresh session: the initial live collect run logs were genuinely live and matched the one actual execution.
  - Existing session: reopening the same run replayed those old collect lines into the startup log with no replay marker, then appended the real deferred-enrichment recovery lines.
  - Divergence: yes — only the reopened-session path mixed historical and live lines indistinguishably.
- Root cause hypothesis:
  - Type: `refresh_render_bug`
  - Hypothesis: `loadHistoryForRun(...)` / `replayPersistedRunEvents(...)` in the TUI and web session surfaces appended persisted event lines through the same live log presentation path, so historical collect events were rendered as if they were happening again.
- Code/test changes:
  - Code: `src/tui/TerminalApp.ts` and `src/interaction/InteractionSession.ts` now route replayed persisted run events through replay-specific log helpers that prefix them with `Replay: ` instead of rendering them as live lines.
  - Tests: added a TUI regression in `tests/terminalAppPlanExecution.test.ts` for replay-labeled persisted `collect_papers` events and updated `tests/interactionSession.test.ts` to assert the same replay prefix for web session history.
- Regression status:
  - Automated regression test linked: `tests/terminalAppPlanExecution.test.ts`, `tests/interactionSession.test.ts`
  - Re-validation result: FIXED via `npx vitest run tests/terminalAppPlanExecution.test.ts tests/interactionSession.test.ts`, full `npm run build`, full `npm test`, and a fresh-plus-reopen PTY collect replay in `test/smoke-workspace`. The live PTY revalidation now shows `Replay: Node collect_papers started.` and `Replay: Searching Semantic Scholar ...` on reopen, the real recovery message remains unprefixed, and `run_record.json` still reports `collect_papers.executions=1`.
- Remaining risks: reopened sessions still replay up to 40 persisted events for context, so the startup log can remain verbose; however, those historical lines no longer masquerade as live execution or imply a second collect search.
- Evidence/artifacts: `test/smoke-workspace/.autolabos/runs/9727e56e-19bc-46bb-bf5c-88d3be06af0d/events.jsonl`; `test/smoke-workspace/.autolabos/runs/9727e56e-19bc-46bb-bf5c-88d3be06af0d/run_record.json`; PTY replay on 2026-03-25 showing replay-prefixed historical collect lines plus unprefixed deferred-enrichment recovery

### LV-077 — fake Semantic Scholar collect validation can still persist live multi-provider results
- Status: FIXED
- Validation target: fresh `test/smoke-workspace` TUI `collect_papers` replay driven by the natural-language collect flow and fake Semantic Scholar fixture
- Environment/session context: repo head on 2026-03-25, `test/smoke-workspace`, run `9727e56e-19bc-46bb-bf5c-88d3be06af0d`, fake Codex structured collect action, `AUTOLABOS_FAKE_SEMANTIC_SCHOLAR_RESPONSE` set to the 3-paper smoke fixture, no per-provider fake fixtures for OpenAlex/Crossref/arXiv.
- Reproduction steps:
  1. Prepare `test/smoke-workspace` with `tests/smoke/common.sh`, seed run `9727e56e-19bc-46bb-bf5c-88d3be06af0d`, and export the fake Codex collect action plus the fake 3-paper Semantic Scholar fixture.
  2. Launch a fresh TUI rooted at `test/smoke-workspace`, run `/doctor`, then submit the natural query `최근 5년 관련도 순으로 100개 수집해줘` and confirm the pending collect step.
  3. Inspect `.autolabos/runs/9727e56e-19bc-46bb-bf5c-88d3be06af0d/collect_result.json`, `collect_search_aggregation.json`, `corpus.jsonl`, and `collect_background_job.json`.
- Expected behavior: fake-fixture collect validation should stay deterministic — the persisted corpus should contain only the 3 fake Semantic Scholar papers, `collect_result.json` should stay on the Semantic Scholar single-provider path, and live public providers should not pollute the artifacts.
- Actual behavior: the live collect run persisted 114 papers, marked the result as `source="aggregated"`, and recorded successful OpenAlex/Crossref/arXiv searches in both `collect_result.json` and `collect_search_aggregation.json`; only 3 of the 114 papers came from the fake Semantic Scholar fixture, so the supposedly deterministic collect output was polluted by live provider traffic.
- Fresh vs existing session comparison:
  - Fresh session: reproduced in a fresh `test/smoke-workspace` launch; the collect artifacts contained 114 aggregated papers instead of the 3 fake fixture papers.
  - Existing session: reopening the same persisted run in a fresh TUI process re-ran the same cross-provider search and resumed deferred enrichment against the already polluted 114-paper corpus.
  - Divergence: no — both fresh and reopened-session validation showed the same provider fanout and polluted persisted outputs.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `collect_papers` still builds the full provider fanout even when `AUTOLABOS_FAKE_SEMANTIC_SCHOLAR_RESPONSE` is active, so deterministic live validation only fakes Semantic Scholar while OpenAlex/Crossref/arXiv keep contributing real persisted candidates.
- Code/test changes:
  - Code: `src/core/nodes/collectPapers.ts` now short-circuits `buildSearchProviders(...)` to Semantic Scholar only whenever the fake Semantic Scholar fixture env var is active, so live smoke validation no longer fans out into real provider traffic.
  - Tests: added a regression in `tests/collectPapers.test.ts` that passes OpenAlex/Crossref/arXiv stubs alongside a fake Semantic Scholar fixture env var and asserts only Semantic Scholar is used.
- Regression status:
  - Automated regression test linked: `tests/collectPapers.test.ts`
  - Re-validation result: FIXED via targeted `npx vitest run tests/collectPapers.test.ts`, full `npm run build`, `npm test`, `npm run validate:harness`, a fresh PTY-driven collect replay in `test/smoke-workspace`, and a reopened-session PTY check. After the fix, `collect_result.json` and `collect_search_aggregation.json` both stayed on the `semantic_scholar` single-provider path with exactly 3 fake smoke papers, and the reopened session no longer logged OpenAlex/Crossref/arXiv candidate fanout.
- Remaining risks: smoke-workspace `/doctor` still reports unrelated environment diagnostics (`OPENAI_API_KEY` missing for OpenAI mode and missing workspace-local `ISSUES.md`), and true multi-provider deterministic smoke coverage would still need explicit per-provider fakes if that becomes a future validation target.
- Evidence/artifacts: `test/smoke-workspace/.autolabos/runs/9727e56e-19bc-46bb-bf5c-88d3be06af0d/collect_result.json`, `test/smoke-workspace/.autolabos/runs/9727e56e-19bc-46bb-bf5c-88d3be06af0d/collect_search_aggregation.json`, `test/smoke-workspace/.autolabos/runs/9727e56e-19bc-46bb-bf5c-88d3be06af0d/corpus.jsonl`, `test/smoke-workspace/.autolabos/runs/9727e56e-19bc-46bb-bf5c-88d3be06af0d/collect_background_job.json`

### LV-076 — `/approve` can ignore an `analyze_results` backtrack recommendation and advance into `review`
- Status: FIXED
- Validation target: fresh `test/` replay of the paper-ready gate on substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`
- Environment/session context: repo head on 2026-03-25, `test/` workspace, substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`, fresh rebuilt TUI after the portfolio-artifact slice and paper-ready gate hardening.
- Reproduction steps:
  1. Start a fresh TUI rooted at `test/` and rerun `analyze_results` for run `411d5215-b03a-46e4-bf89-ea5a42513288` with `/agent run analyze_results 411d5215-b03a-46e4-bf89-ea5a42513288`.
  2. Wait for `.autolabos/runs/runs.json` to show `currentNode=analyze_results`, `run.status=paused`, `analyze_results.status=needs_approval`.
  3. Confirm `.autolabos/runs/411d5215-b03a-46e4-bf89-ea5a42513288/transition_recommendation.json` recommends `backtrack_to_design` with target `design_experiments`.
  4. Submit `/approve` and compare the resulting `currentNode` in `.autolabos/runs/runs.json` with the stored recommendation.
- Expected behavior: when `analyze_results` pauses with a non-advance pending transition such as `backtrack_to_design`, `/approve` should apply that stored transition and rewind the run to `design_experiments` rather than walking forward into `review`.
- Actual behavior: before the fix, the live replay produced `transition_recommendation.json` with `action=backtrack_to_design`, but `/approve` still cleared the pending transition and moved the run into `review`, so the approval path contradicted the persisted gate artifact.
- Fresh vs existing session comparison:
  - Fresh session: reproduced again on 2026-03-25 in a freshly rebuilt `test/` TUI by rerunning `analyze_results` and immediately approving the paused node.
  - Existing session: the earlier live replay from `run_experiments` had already shown the same divergence — the run paused at `analyze_results` with a paper-readiness backtrack recommendation, but `/approve` advanced it into `review`.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `StateGraphRuntime.approveCurrent(...)` only honored non-advance pending transitions for `review`, so `analyze_results` approvals discarded the persisted transition recommendation and advanced by graph order instead.
- Code/test changes:
  - Generalized `StateGraphRuntime.approveCurrent(...)` in `src/core/stateGraph/runtime.ts` so non-advance pending transitions are applied for `analyze_results` too, while preserving `pause_for_human` boundaries unless an explicit manual handoff requested them.
  - Updated `src/core/agents/agentOrchestrator.ts` so the existing analyze-papers `pause_for_human` handoff path (`/agent run <next-node>`) still works via an explicit `allowPauseForHuman` approval option.
  - Updated `src/interaction/InteractionSession.ts` and `src/tui/TerminalApp.ts` so `/agent review` stops cleanly and reports the rewound node if approving `analyze_results` backtracks instead of entering `review`.
  - Added regression coverage in `tests/agentOrchestrator.test.ts` and `tests/interactionSession.test.ts`.
- Regression status:
  - Automated regression test linked: `tests/agentOrchestrator.test.ts`, `tests/interactionSession.test.ts`
  - Re-validation result: FIXED via targeted regressions (`npx vitest run tests/agentOrchestrator.test.ts tests/interactionSession.test.ts`), full `npm test`, `npm run build`, `npm run validate:harness`, and same-flow live replay in `test/`. On the repaired build, rerunning `analyze_results` regenerated `transition_recommendation.json` with `backtrack_to_design`, and `/approve` then rewound the run to `design_experiments` at `2026-03-25T05:37:25Z` with the matching `backtrack_to_design` transition recorded in `runs.json`.
- Remaining risks: this closes the approval/artifact mismatch, but the substituted paper-scale run remains intentionally blocked for paper progression because its evidence is still too thin; future work should improve the actual experiment design or evidence scale rather than weakening this gate.

### LV-075 — `implement_experiments` local verification can miss DictWriter fieldname mismatches when CSV schemas come from named constants
- Status: FIXED
- Validation target: fresh `test/` replay of the cycle-8 `implement_experiments -> run_experiments` boundary on substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`
- Environment/session context: repo head on 2026-03-24, `test/` workspace, substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`, cycle 8 after the earlier scientific backtrack to `design_experiments`.
- Reproduction steps:
  1. Continue the live substitute loop into cycle 8 and allow `design_experiments` to rerun, then let `implement_experiments` publish a new public bundle and hand off to `run_experiments`.
  2. Inspect `.autolabos/runs/runs.json`, `.autolabos/runs/411d5215-b03a-46e4-bf89-ea5a42513288/exec_logs/run_experiments.txt`, and the emitted `test/outputs/experiment/experiment.py`.
  3. Compare the `csv.DictWriter(..., fieldnames=CONDITION_SUMMARY_FIELDNAMES)` schema with the actual row keys written by `write_condition_summary_csv(...)`.
- Expected behavior: `implement_experiments` local verification should reject public experiment bundles whose CSV summaries write keys outside named `DictWriter` fieldname constants, so the run never burns a real `run_experiments` attempt on a statically visible schema mismatch.
- Actual behavior: cycle 8 `implement_experiments` passed `python3 -m py_compile`, but `run_experiments` then failed at runtime with `ValueError: dict contains fields not in fieldnames: 'median_generated_tokens_per_example'` while writing `condition_summary.csv`. The generated bundle defined `csv.DictWriter(..., fieldnames=CONDITION_SUMMARY_FIELDNAMES)` and later wrote rows merged from a summary dict that included the extra median token field.
- Fresh vs existing session comparison:
  - Fresh session: reproduced in the continued live substitute loop after LV-074 was fixed and cycle 8 re-entered `implement_experiments`.
  - Existing session: earlier CSV-guard work only covered local `fieldnames = [...]` assignments, so this replay exposed the remaining blind spot where the schema was declared through a named constant instead.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `detectPythonCsvFieldnameMismatch(...)` only extracted fieldnames from a literal variable named `fieldnames`, so it missed otherwise equivalent `csv.DictWriter(..., fieldnames=CONDITION_SUMMARY_FIELDNAMES)` schemas and allowed a bad bundle to persist into runtime.
- Code/test changes:
  - Generalized `detectPythonCsvFieldnameMismatch(...)` in `src/core/agents/implementSessionManager.ts` so it resolves `DictWriter` fieldname constants by name instead of only looking for `fieldnames = [...]`.
  - Added regression coverage in `tests/implementSessionManager.test.ts` for the live failure shape where `CONDITION_SUMMARY_FIELDNAMES` is used with `csv.DictWriter(...)` and the returned summary dict adds `median_generated_tokens_per_example`.
  - Re-ran `npm test -- tests/implementSessionManager.test.ts` and `npm run build`.
- Regression status:
  - Automated regression test linked: `tests/implementSessionManager.test.ts`
  - Re-validation result: FIXED via same-flow live replay on substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`. Attempt 1 still failed on missing materialized artifacts, but attempt 2 published a corrected bundle, `run_experiments` completed successfully at `2026-03-24T12:06:57Z`, `analyze_results` completed at `2026-03-24T12:07:17Z`, and the run advanced through `review` into `write_paper` instead of crashing while writing `condition_summary.csv`.
  - Additional live evidence: the final public `test/outputs/experiment/experiment.py` no longer contained `median_generated_tokens_per_example`, so the previously observed schema leak did not survive the repaired flow.
- Remaining risks: later stages can still surface separate research-quality or paper-readiness blockers, but this specific `condition_summary.csv` runtime mismatch no longer reproduces in the same live workflow.

### LV-074 — `implement_experiments` local verification can still pass Hugging Face `model.generate(..., generator=...)` runners that crash immediately at runtime
- Status: FIXED
- Validation target: fresh `test/` replay of the cycle-7 `implement_experiments -> run_experiments` boundary on substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`
- Environment/session context: repo head on 2026-03-24, `test/` workspace, substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`, cycle 7 after the governed backtrack from `analyze_results` to `design_experiments`.
- Reproduction steps:
  1. From the live `test/` validation loop, let cycle 7 complete `design_experiments`, then allow `implement_experiments` to finish and hand off to `run_experiments`.
  2. Inspect `.autolabos/runs/runs.json` and `.autolabos/runs/411d5215-b03a-46e4-bf89-ea5a42513288/exec_logs/run_experiments.txt`.
  3. Compare the local verification result in `implement_experiments/status.json` with the actual runtime traceback from the executed public bundle.
- Expected behavior: `implement_experiments` local verification should reject Python experiment bundles that pass unsupported `generator` kwargs into Hugging Face `model.generate(...)`, so the run never burns a real `run_experiments` attempt on this predictable runtime failure.
- Actual behavior: cycle 7 `implement_experiments` passed `python3 -m py_compile`, published a new public bundle, and handed off to `run_experiments`, but runtime then failed immediately with `ValueError: The following model_kwargs are not used by the model: ['generator']` from `test/outputs/experiment/experiment.py` line 418 (`outputs = model.generate(**inputs, **generation_kwargs)`).
- Fresh vs existing session comparison:
  - Fresh session: reproduced in the still-running live substitute loop after LV-073 was fixed and the run advanced back through `design_experiments` into cycle 7 `implement_experiments`.
  - Existing session: earlier cycles had different late runtime and evidence-quality failures, but this replay exposed a new local-verification blind spot specific to `generator` being threaded through generation kwargs.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `implementSessionManager` only required `py_compile` plus a few source-level guards, so it still allowed a materially invalid real-execution bundle to be persisted and handed to `run_experiments` even though the unsupported `generator` kwarg was statically visible in source.
- Code/test changes:
  - Added a new `detectPythonUnsupportedGenerateKwarg(...)` local-verification guard in `src/core/agents/implementSessionManager.ts` and wired it into the `py_compile` verification pipeline before real-execution handoff.
  - Tightened the staged implement prompt to explicitly forbid `generator=` / `generation_kwargs['generator']` in `model.generate(...)`.
  - Added regression coverage in `tests/implementSessionManager.test.ts` for the live failure shape where `generation_kwargs["generator"] = ...` is later expanded into `model.generate(**inputs, **generation_kwargs)`.
  - Re-ran `npm test -- tests/implementSessionManager.test.ts`, `npm run build`, and `npm run validate:harness`.
- Regression status:
  - Automated regression test linked: `tests/implementSessionManager.test.ts`
  - Re-validation result: FIXED via same-flow live replay on substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`. After rebuilding and restarting the TUI, the run was rewound to `implement_experiments/pending`, `/doctor` passed, and a fresh `/agent run implement_experiments 411d5215-b03a-46e4-bf89-ea5a42513288` replay completed without the previous runtime crash. Attempt 1 failed earlier on missing materialized artifacts, attempt 2 produced a new public bundle whose `experiment.py` no longer threaded `generator` into `model.generate(...)`, `metrics.json` was written successfully, and the run advanced through `analyze_results` into an auto-executable `backtrack_to_design` recommendation instead of failing in `run_experiments`.
- Remaining risks: the loop is still blocked by experiment quality rather than this runtime seam — the replay finished with `accuracy_delta_vs_baseline=0`, so the next cycle still needs a stronger design to clear the governed review gate.

### LV-073 — `analyze_papers` can exhaust selected full-text papers at the 45s extractor boundary and pause with only thin evidence
- Status: FIXED
- Validation target: fresh `test/` rerun of `analyze_papers` from the rewound substitute run while cached PDF/text artifacts already exist
- Environment/session context: repo head on 2026-03-24, `test/` workspace, substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`, fresh live TUI session after rewinding the run back to `analyze_papers`.
- Reproduction steps:
  1. Start a fresh TUI rooted at `test/` and confirm `/doctor` passes.
  2. From the rewound substitute run, execute `/agent run analyze_papers 411d5215-b03a-46e4-bf89-ea5a42513288`.
  3. Wait for the node to settle and inspect `.autolabos/runs/runs.json` plus `.autolabos/runs/411d5215-b03a-46e4-bf89-ea5a42513288/analysis_manifest.json`.
  4. Compare the selected-paper statuses and the pending transition after the node pauses.
- Expected behavior: selected full-text papers with cached PDF/text artifacts should have enough bounded extractor time to complete structured analysis or fall back cleanly without burning most of the selected set at the same fixed timeout boundary.
- Actual behavior: the rerun paused at `analyze_papers` with `needs_approval`, preserving only `1` summary and `4` evidence items while `4/5` selected full-text papers failed with `paper_analysis_extractor_timeout_after_45000ms`. The run then recommended `/agent run generate_hypotheses ...` from this thin evidence package instead of recovering richer full-text support.
- Fresh vs existing session comparison:
  - Fresh session: reproduced in a freshly relaunched `test/` TUI after the earlier crash/restart repair work; the node advanced into live analysis and then paused with the repeated 45s extractor failures.
  - Existing session: the same substitute run already had weak downstream evidence from earlier cycles, but the fresh rerun made the current blocker explicit by re-failing the top selected full-text papers at the bounded extractor seam.
- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: `paperAnalyzer`'s default extractor timeout (`45_000ms`) is still too aggressive for current full-text PDF/hybrid extraction workloads, so bounded analysis now fails prematurely even when cached sources are already available.
- Code/test changes:
  - Raised `DEFAULT_ANALYSIS_EXTRACT_TIMEOUT_MS` from `45_000` to `120_000` in `src/core/analysis/paperAnalyzer.ts` while preserving the existing `AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS` override seam.
  - Added deterministic coverage in `tests/paperAnalyzer.test.ts` for the new default extractor timeout and widened timeout-fingerprint fallback assertions to accept the `120000ms` extractor boundary.
  - Re-ran `npm test -- tests/paperAnalyzer.test.ts tests/analyzePapers.test.ts` plus full `npm test && npm run build`.
- Regression status:
  - Automated regression test linked: `tests/paperAnalyzer.test.ts`, `tests/analyzePapers.test.ts`.
  - Re-validation result: FIXED via same-flow live replay on substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`. After rewinding to `analyze_papers/pending`, a fresh `test/` TUI passed `/doctor`, reran `/agent run analyze_papers 411d5215-b03a-46e4-bf89-ea5a42513288`, and `.autolabos/runs/runs.json` recorded `analyze_papers.status=completed` at `2026-03-24T10:43:23.164Z` with note `Analyzed 5 papers into 20 evidence item(s); 4 full-text and 1 abstract fallback (mode=responses_api_pdf).` The persisted `analysis_manifest.json` finished with `5/5` selected papers completed, `0` failed, and the run advanced into `generate_hypotheses`.
- Remaining risks: the extractor remains bounded, but slower planner/reviewer phases or weak downstream scientific evidence can still block paper readiness later in the loop. This fix specifically closes the repeated `paper_analysis_extractor_timeout_after_45000ms` seam on the selected full-text set.

### LV-072 — crash-restarted TUI can leave a recent running node stranded and still render stale analyze-results insight
- Status: FIXED
- Validation target: `test/` fresh TUI restart within one minute of a hard crash while `analyze_papers` is actively running
- Environment/session context: repo head on 2026-03-24, `test/` workspace, substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`, fresh TUI restart after a hard `SIGKILL` of the live `autolabos` process.
- Reproduction steps:
  1. From a live TUI rooted at `test/`, force-jump the surviving run back to `analyze_papers` and start it with `/agent run analyze_papers 411d5215-b03a-46e4-bf89-ea5a42513288`.
  2. Wait until `.autolabos/runs/runs.json` shows `currentNode=analyze_papers`, `run.status=running`, and `analyze_papers.status=running`.
  3. Hard-kill the TUI process with `SIGKILL`.
  4. Relaunch a fresh TUI session within one minute.
  5. Observe the relaunched screen and persisted run state without waiting five minutes.
- Expected behavior: a crash-restarted fresh TUI should recognize that the prior session died, recover the orphaned `running` node for re-execution, and avoid surfacing stale `analyze_results` insight while the run is back at `analyze_papers`.
- Actual behavior: the fresh TUI restart leaves the run stranded at `analyze_papers running` with no recovery, even though `runs.json` remains unchanged at `updatedAt=2026-03-24T09:39:54.114Z`. The relaunched screen simultaneously renders the old `Result analysis` card from `result_analysis.json`, so the user sees a stale downstream summary while the footer says `analyze_papers running`.
- Fresh vs existing session comparison:
  - Fresh session: re-validated with the patched build in `test/`. With the stale `result_analysis.json` artifact still present, a fresh TUI launch at `analyze_papers` no longer rendered the stale `Result analysis` card. After starting `analyze_papers`, hard-killing the live TUI, and relaunching once the dead lock PID had fully disappeared, `.autolabos/runs/runs.json` advanced from `updatedAt=2026-03-24T09:50:08.817Z` to `updatedAt=2026-03-24T09:51:37.537Z` while staying on `currentNode=analyze_papers`, proving the fresh restart recovered the recently running node immediately instead of waiting five minutes.
  - Existing session: before the fix, the original crash/restart path stranded the run at the old `analyze_papers running` timestamp and rendered stale downstream `Result analysis` content on the relaunched screen.
- Root cause hypothesis:
  - Type: `resume_reload_bug`
  - Hypothesis: `recoverStaleRunningNode()` skips recent `running` nodes for five minutes even when startup just replaced a dead TUI session lock, and `refreshActiveRunInsight()` surfaces `result_analysis.json` whenever it exists instead of gating it on the run's current node.
- Code/test changes:
  - Code: `src/core/runInsightSelection.ts`, `src/tui/TerminalApp.ts`, `src/interaction/InteractionSession.ts`
  - Tests: `tests/runInsightSelection.test.ts`, `tests/terminalAppPlanExecution.test.ts`, `tests/interactionSession.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/runInsightSelection.test.ts`, `tests/terminalAppPlanExecution.test.ts`, and `tests/interactionSession.test.ts`.
  - Re-validation result: pass — the targeted regressions passed, the full `npm test && npm run build` validation passed, and the same-flow live replay in `test/` confirmed both halves of the fix: no stale `Result analysis` card on `analyze_papers` with `result_analysis.json` still present, and immediate stale-lock-aware recovery of the crash-orphaned `analyze_papers` run on restart.
- Remaining risks: the shell-harness replay showed that an ultra-immediate relaunch can briefly see the just-killed PID before the OS fully reaps it; once the lock owner is truly dead, the stale-lock replacement path and recent-running-node recovery behave as intended.

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
- Status: FIXED
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
- Code/test changes:
  - `src/core/agents/implementSessionManager.ts`
  - `src/core/nodes/analyzePapers.ts`
- Regression status:
  - Automated regression test linked: no narrow unit regression; the compile/smoke gates are the effective regression surface for this issue.
  - Re-validation result: pass — `npm run build` and `npm run test:smoke:ci` both pass on the current tree, so the prior compile-time mismatch no longer reproduces.
- Remaining risks: keep the build/smoke gate in routine validation because this issue is guarded primarily by compile coverage rather than a focused unit test.

### LV-056 — Supervisor stops after auto-approved design instead of executing the new pending node
- Status: FIXED
- Validation target: `test/` live TUI `/agent run design_experiments` continuation after `design_experiments` auto-approves into `implement_experiments`, recreated on substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`
- Environment/session context: original reproduced run `81820c46-d1b6-4080-8575-a35c60583480` is no longer present in `test/.autolabos/runs`; the live revalidation used surviving substitute run `411d5215-b03a-46e4-bf89-ea5a42513288` after forcing a backward jump to `design_experiments` in cycle 5 and rerunning from a fresh build.
- Reproduction steps:
  1. Resume the governed run in `test/` near the `design_experiments` completion boundary.
  2. Let `design_experiments` finish and auto-approve into `implement_experiments`.
  3. Observe the supervisor state after `currentNode` advances.
- Expected behavior: the supervised loop should continue directly into the new pending node.
- Actual behavior: the run advances to `implement_experiments`, then the supervisor returns early and leaves the node idle.
- Fresh vs existing session comparison:
  - Fresh session: not yet reproduced from a fresh run because the boundary depends on an existing cycle-10 design completion.
  - Existing session: reproduced on the original resumed governed run before it disappeared from the workspace; the same class of boundary was then recreated and revalidated on substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the manual `/agent run <node>` path stops after `AgentOrchestrator.runAgentWithOptions()` auto-approves the requested node, but it did not resume supervised execution when that approval advanced the workflow to a later pending node such as `implement_experiments`.
- Code/test changes:
  - `src/tui/TerminalApp.ts`
  - `src/interaction/InteractionSession.ts`
  - `tests/terminalAppPlanExecution.test.ts`
  - `tests/interactionSession.test.ts`
- Regression status:
  - Automated regression test linked: yes — `tests/terminalAppPlanExecution.test.ts` and `tests/interactionSession.test.ts`.
  - Re-validation result: targeted regressions, full `npm test`, and `npm run build` now pass. In same-flow live revalidation on substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`, `/agent jump design_experiments ... --force` recreated the boundary and `/agent run design_experiments ...` advanced `design_experiments` to `completed` at `2026-03-24T07:49:27.595Z`; `runs.json` then immediately moved `implement_experiments` from `pending` to `running` at `2026-03-24T07:49:27.680Z` instead of stalling. The TUI was stopped after that handoff to avoid leaving the provider turn running, but the original stop-at-pending symptom no longer reproduced.
- Remaining risks: the supervisor handoff boundary is closed, but downstream `implement_experiments` quality and later runtime validation issues still depend on the generated artifact and are tracked separately under other LV entries.

### LV-057 — `implement_experiments` reuses a stale Codex thread after run feedback changes the repair target
- Status: FIXED
- Validation target: `test/` live repair cycle after `run_experiments` fails with new runner feedback, using substitute run `411d5215-b03a-46e4-bf89-ea5a42513288` because the original target run `81820c46-d1b6-4080-8575-a35c60583480` was no longer present in the workspace
- Environment/session context: `test/` workspace, substitute governed run `411d5215-b03a-46e4-bf89-ea5a42513288`, repair cycle after repeated `run_experiments` failures with fresh runner feedback.
- Reproduction steps:
  1. Resume the failed governed run after `run_experiments` reports new runner feedback.
  2. Allow the workflow to re-enter `implement_experiments`.
  3. Observe whether the implementation session starts from a fresh thread or reuses the previous thread.
- Expected behavior: a new runner failure should start a fresh implementation thread.
- Actual behavior: the old thread is reused and progress stalls while the previous context is replayed.
- Fresh vs existing session comparison:
  - Fresh session: not yet reproduced from a fresh run because the stale-thread boundary depends on prior repair history.
  - Existing session: reproduced on the resumed repair cycle class; live revalidation on substitute run `411d5215-b03a-46e4-bf89-ea5a42513288` first narrowed the bug, then passed after the bundle-reuse gate fix.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: thread reset depends on plan-hash changes only; fresh runner feedback does not clear the stale thread.
- Code/test changes:
  - `src/core/agents/implementSessionManager.ts`
  - `tests/implementSessionManager.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/implementSessionManager.test.ts`.
  - Re-validation result: focused regressions, full `npm test`, and `npm run build` now pass, including the fresh-thread runner-feedback case and a new regression that blocks bundle reuse for command-stage Traceback failures. In live validation on substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`, the first rerun at `2026-03-24T06:15:37Z` proved that runner feedback was loaded and the stale thread was cleared, but it also exposed a coupled bug: the repair path still reused the existing governed bundle because generic command-stage feedback incorrectly passed the recovery gate. After tightening that gate, the same failure state was re-run at `2026-03-24T06:20:45Z`; `implement_experiments/progress.jsonl` showed `Loaded runner feedback from run_experiments`, then `Submitting request to OpenAI Responses API.` and `OpenAI accepted background response resp_08fc551578eefe260069c22d3d8de481a19714de748dd73cfa; polling for completion.` with no intervening bundle-reuse message. The TUI was intentionally stopped after the fresh repair turn was already in staged OpenAI polling, which aborted the provider request but did not reproduce the original stale-thread or bundle-reuse symptom.
- Remaining risks: the stale-thread / stale-bundle symptom is closed, but successful repair completion still depends on the model producing a corrected runner; the currently failing CSV result-table schema is tracked separately below.

### LV-055 — `implement_experiments` local verification can miss Python-invalid JSON booleans, letting a broken runner reach `run_experiments`
- Status: FIXED
- Validation target: `test/` revived `design_experiments -> implement_experiments -> run_experiments` cycle that produces a fresh Python artifact containing JSON literals such as `false` or `null`.
- Environment/session context: `test/` workspace; the currently available substitute run `411d5215-b03a-46e4-bf89-ea5a42513288` is presently stuck at an aborted `implement_experiments` turn, so there is no fresh post-fix runnable artifact yet.
- Reproduction steps:
  1. Resume the governed run at the implementation boundary.
  2. Let `implement_experiments` produce Python source that still contains JSON literals such as `false` or `null`.
  3. Observe that local verification passes, then `run_experiments` fails at runtime with `NameError`.
- Expected behavior: implementation verification should fail before handoff when executable Python source contains JSON booleans or `null`.
- Actual behavior: the broken runner passes compile-time verification and only fails after `run_experiments` launches it.
- Fresh vs existing session comparison:
  - Fresh session: not yet revalidated from a fresh end-to-end run.
  - Existing session: reproduced on the resumed governed run before the deterministic fix was added; the current workspace does not yet contain a fresh implementation artifact that exercises the repaired verification path.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `py_compile` catches syntax errors but not runtime-invalid JSON literals embedded in otherwise valid Python code.
- Code/test changes:
  - `src/core/agents/implementSessionManager.ts`
  - `tests/implementSessionManager.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/implementSessionManager.test.ts`.
  - Re-validation result: deterministic regression added, and a same-run substitute live replay now confirms the verifier boundary. After LV-071 closed, the surviving substitute run `411d5215-b03a-46e4-bf89-ea5a42513288` began attempt 1 by immediately reusing the existing governed experiment bundle instead of re-entering Codex. Because no organically generated JSON-literal artifact survived in the public bundle, a one-line probe (`'json_literal_probe': false`) was injected into `test/outputs/experiment/experiment.py` to recreate the prior runtime-invalid shape on the real bundle-reuse path. Re-running `implement_experiments` then failed local verification on all three attempts with `Python source contains JSON literal false at experiment.py:374; use Python False instead.`, while persisted run state remained at `currentNode=implement_experiments` and `run_experiments.status=pending`, so the bad Python literal was rejected before handoff.
- Remaining risks: the live replay used a substitute injected bundle because no fresh organically generated JSON-literal artifact remained in the surviving workspace. That confirms the repaired verifier boundary on the real run path, but a future provider regression that emits a different literal-leak shape should still be checked on first sight.

### LV-066 — staged `implement_experiments` provider calls can hang indefinitely in `staged_llm` mode
- Status: FIXED
- Validation target: `test/` same-flow substitute rerun on `411d5215-b03a-46e4-bf89-ea5a42513288` after the original target run `98987fc4-6ce2-4d39-8623-6dacbcb1508d` was no longer present in the workspace
- Environment/session context: repo head on 2026-03-24, `test/` workspace, substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`, `providers.llm_mode: openai_api`.
- Reproduction steps:
  1. Resume the failed run and force it back into `implement_experiments`.
  2. Observe the staged LLM path persist `Submitting request to OpenAI Responses API.`.
  3. Wait for node-local progress and compare `status.json.updatedAt` over time.
- Expected behavior: staged OpenAI/Ollama implementation turns should complete or fail within a bounded provider timeout.
- Actual behavior: the node can remain in `running` while waiting on a provider call with no node-local timeout or fallback boundary.
- Fresh vs existing session comparison:
  - Fresh session: not yet reproduced from a fresh run because the boundary depends on a failed implementation retry path.
  - Existing session: originally reproduced on the resumed failed run class; live revalidation now passes on substitute run `411d5215-b03a-46e4-bf89-ea5a42513288` after forcing `analyze_results -> design_experiments -> implement_experiments` to invalidate bundle reuse and re-enter the staged OpenAI path.
- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: the staged LLM implementation path forwards the run abort signal but relies only on the long client safety timeout, so the node-owned execution has no practical bounded recovery path.
- Code/test changes:
  - `src/core/agents/implementSessionManager.ts`
  - `tests/implementSessionManager.test.ts`
- Regression status:
  - Automated regression test linked: yes, `tests/implementSessionManager.test.ts`.
  - Re-validation result: pass for deterministic coverage and same-flow live validation. Focused `tests/implementSessionManager.test.ts`, full `npm test`, and `npm run build` all passed after adding a 600000ms default staged-LLM node timeout with env override support (including explicit `AUTOLABOS_IMPLEMENT_LLM_TIMEOUT_MS=0` to disable it). In live validation, the first substitute `implement_experiments` attempt reused an existing governed bundle and was rejected as insufficient evidence; after forcing a new design cycle, the rerun entered real staged OpenAI polling, stayed active past the old ~300s failure boundary, retried once after verification feedback, and then completed at `2026-03-24T05:58:03Z` with `implement_experiments/status.json.status=completed` and the run advanced to `run_experiments`.
- Remaining risks: the indefinite hang boundary is now closed for the default configuration, but operators can still deliberately remove the node-owned timeout with `AUTOLABOS_IMPLEMENT_LLM_TIMEOUT_MS=0`, and future live failures may still surface as provider/network errors rather than silent hangs.

### LV-071 — local `implement_experiments` verification can pass runners that crash late when writing result tables
- Status: FIXED
- Validation target: `test/` same-flow substitute repair cycle on `411d5215-b03a-46e4-bf89-ea5a42513288` after `implement_experiments` hands a governed experiment bundle to `run_experiments`
- Environment/session context: repo head on 2026-03-24, `test/` workspace, substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`, real execution bundle in `test/outputs/experiment`, `providers.llm_mode: openai_api`.
- Reproduction steps:
  1. Resume the substitute run after `implement_experiments` produces or recovers the governed experiment bundle.
  2. Let `run_experiments` execute the generated runner through most of the evaluation loop.
  3. Observe whether the runner reaches result-table emission after local verification had already passed.
- Expected behavior: implementation verification or handoff validation should catch result-table schema mismatches before `run_experiments` spends real execution time on a runner that will crash at publish time.
- Actual behavior: `implement_experiments` passed local verification via `python3 -m py_compile`, but `run_experiments` later failed after real execution with `ValueError: dict contains fields not in fieldnames: 'total_latency_sec', 'total_generated_tokens'`.
- Fresh vs existing session comparison:
  - Fresh session: not yet reproduced from a fresh run.
  - Existing session: reproduced on substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`; `run_experiments` exhausted 3/3 attempts and failed at `2026-03-24T06:17:21Z`.
- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: current local verification is strong enough to catch syntax and some static handoff errors, but not semantic result-table schema mismatches inside generated Python, so an internally inconsistent governed bundle can survive `implement_experiments` and only fail near the end of `run_experiments`.
- Code/test changes:
  - Added a Python-side local verification guard in `src/core/agents/implementSessionManager.ts` that rejects governed bundles when `csv.DictWriter(...)` fieldnames do not cover keys returned from row dict literals, unless the script explicitly opts into `extrasaction='ignore'`.
  - Added `fails local verification when Python CSV rows contain keys outside DictWriter fieldnames` in `tests/implementSessionManager.test.ts`.
  - Re-ran `npx vitest run tests/implementSessionManager.test.ts`, `npm test`, and `npm run build` after the change; all passed.
- Regression status:
  - Automated regression test linked: yes — `tests/implementSessionManager.test.ts`
  - Re-validation result: pre-fix live failure reproduced on substitute run `411d5215-b03a-46e4-bf89-ea5a42513288`; `run_experiments` failed with a CSV writer schema mismatch after real execution, and the failure then fed back into `implement_experiments`. Two earlier bounded post-fix reruns were inconclusive because fresh staged OpenAI repair turns did not settle before the monitoring cutoff. A later extended same-flow replay from the cycle-5 failed `implement_experiments` state at `2026-03-24T08:29:55Z` did settle: attempt 1 completed the OpenAI turn but failed verification because referenced artifacts were not materialized, then attempts 2/3 reused the governed experiment bundle and failed local verification before any handoff with `Python source writes CSV row keys not present in fieldnames at experiment.py:372 (total_generated_tokens, total_latency_sec).` Persisted run state now shows `implement_experiments.status=failed`, `run_experiments.status=pending`, and `currentNode=implement_experiments`, so the bad CSV bundle is rejected inside `implement_experiments` instead of consuming real `run_experiments` execution time.
- Remaining risks: the new guard is a targeted static heuristic for the reproduced `csv.DictWriter(...)` mismatch shape, so other late Python/runtime consistency failures may still require separate verification improvements.

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
