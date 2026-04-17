# ISSUES.md

Last updated: 2026-04-17

This file was compacted on 2026-03-22 to remove duplicated template fragments, malformed partial entries, and conflicting reused LV identifiers. Detailed pre-cleanup prose remains in git history.

Usage rules:
- `ISSUES.md` is for reproduced live-validation defects and tracked research/paper-readiness risks.
- `TODO.md` is for forward-looking follow-ups, proposal-only work, and backlog items.
- Canonical workflow and policy still live in `AGENTS.md` and `docs/`.

---

## Current active status

- Active live-validation defects:
  - `LV-102` `run_experiments` now reaches the repaired public runner bundle, but that runner can still fail fast with `RuntimeError("Missing parse_args() in runner setup chunk.")`, so the next blocker has moved from implement-stage materialization to runner integrity across chunk joins.
  - `LV-098` IEEE staging `pdf_url` rows cache HTML instead of PDF, so `analyze_papers` cannot preserve supplemental page images on abstract fallback for those papers.
- Active research/paper-readiness watchlist: see `Research and paper-readiness watchlist` below.
- Current watchlist snapshot:
  - `R-001` Result-table discipline and claim→evidence linkage — `MITIGATED`
  - `R-002` Scientific gate warnings surfacing — `MITIGATED`
  - `R-003` System-validation paper shape over-promotion — `MITIGATED`
  - `P-001` Baseline/comparator packaging — `MITIGATED`
  - `P-002` Compact quantitative result packaging — `MITIGATED`
  - `P-003` Related-work depth signaling — `MITIGATED`
- If a new runtime/UI defect is reproduced, add it under `Active live validation issues` with a fresh `LV-*` identifier and one dominant root-cause class.

---

## Resolved live validation issues

The resolved entries below are kept as recent validation history and regression context.

## Issue: LV-101

- Status: resolved
- Validation target: existing external-workspace TUI `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` after the deferred-results patch
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`

- Reproduction steps:
  1. Relaunch a fresh real TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let attempt 1/3 enter staged LLM mode and wait for the bounded hard timeout.
  4. Inspect `implement_experiments/status.json`, `implement_experiments/progress.jsonl`, and `events.jsonl`.

- Expected behavior:
  - The staged implementation turn should either stream/output usable Codex text and continue into implementation validation, or fail for a narrower request-level reason before consuming the full 600000ms budget.

- Actual behavior:
  - The same-flow retry used to stall before producing any implement-stage text, first as one giant staged LLM turn and later as the first runner chunk after decomposition.
  - After the staged runner was split into purpose-aligned chunks, the same persisted run eventually advanced through all three runner chunks and completed the rest of the implement bundle:
    - `Generating staged_llm unit 1/3 chunk 2/3: Dataset preparation, model setup, PEFT condition execution, and benchmark evaluation (...)`
    - `Generating staged_llm unit 1/3 chunk 3/3: Result aggregation, metrics JSON writing, public artifact export, and main entrypoint (...)`
    - `Generating staged_llm unit 2/3: Bounded experiment plan (...)`
    - `Generating staged_llm unit 3/3: Experiment usage and interpretation guide (...)`
    - `Implementation turn completed.`
    - `Local verification passed via python -m py_compile .../run_peft_instruction_study.py.`
  - The final `implement_experiments/status.json` for the same persisted run is now `completed` with `verifyStatus: "pass"`.

- Fresh vs existing session comparison:
  - Fresh session: not separately needed; the same persisted run was retried from a rebuilt real TUI session.
  - Existing session: the repaired flow now crosses the former stall boundary, completes implement-stage materialization, and passes local verification.
  - Divergence: none remains at the original boundary.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: the original staged implement request was too coarse; after purpose-aligned decomposition and chunked runner generation, the same live path can now materialize and verify successfully.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - added staged-LLM heartbeat progress updates and partial-response snapshotting to `implement_experiments`
      - added shared `decomposition_plan` contract emission plus a bounded staged repair turn when scaffolds omit that plan
      - added dynamic materialization chunk planning for large text-file units so runnable scripts can be generated as purpose-aligned subcalls instead of one giant file turn
    - `src/core/decompositionPlan.ts`
      - added reusable dynamic decomposition-plan types/parsing for future prompt-splitting migrations
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - added a regression that timeouting staged-LLM requests persist partial-response artifacts and timeout observations when progress is observed
      - added regressions for decomposition-plan artifact emission and decomposition-plan repair when the scaffold omits it
      - updated staged-LLM implement regressions to cover dynamic materialization plans and chunked runner generation

- Regression status:
  - Automated regression test linked: yes (`tests/implementSessionManager.test.ts`)
  - Re-validation result: resolved in the same persisted run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - New observation: the same-flow retry now survives the former stall, completes `implement_experiments`, and passes local `py_compile` verification.

- Most likely failing boundary:
  - resolved staged LLM request/materialization boundary inside `implement_experiments`

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/decomposition_plan.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/decomposition_plan_raw_response.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_plans/runner_script.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_plans/runner_script_raw_response.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_plans/runner__chunk1_setup_and_plan.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`

- Recommended next step:
  - move downstream to the new `run_experiments` failure now that the implement-stage stall is resolved.

## Issue: LV-100

- Status: resolved
- Validation target: existing external-workspace TUI `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` after the native Codex stream-materialization fix
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`

- Reproduction steps:
  1. Relaunch a fresh real TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let the staged implementation turn finish and inspect `implement_experiments/progress.jsonl`, `verify_report.json`, and the public experiment directory.

- Expected behavior:
  - `implement_experiments` should allow future public result files such as `outputs/.../experiment/results/summary.json` to remain absent at implement time.
  - Those files should be treated like deferred execution outputs that `run_experiments` is responsible for materializing later.

- Actual behavior:
  - Before the patch, the same live run could complete an implementation turn and then fail attempt 1 with:
    - `Implementer referenced artifact(s) that were not materialized: outputs/.../experiment/results/summary.json, .../condition_results.json, .../report.md`
  - The missing paths were public result files under `outputs/.../experiment/results/*`, not immediate implement-stage artifacts.
  - The node then restored the branch snapshot and retried instead of handing off to `run_experiments`.

- Fresh vs existing session comparison:
  - Fresh session: not separately needed.
  - Existing session: the same persisted run now crosses the former boundary, completes `implement_experiments`, and enters `run_experiments` instead of failing on deferred public result files.
  - Divergence: none remains at the original boundary.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: implement-stage artifact validation was projecting future public run outputs into the current materialization set and treating them as missing supplemental artifacts, even though those `results/*` files should only exist after `run_experiments`.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - broadened deferred execution artifact recognition so public `outputs/.../experiment/results/*` paths are treated as deferred run-time outputs rather than immediate implement-stage requirements
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - added a regression that missing public experiment result files under `outputs/.../experiment/results/*` do not fail implement-stage validation

- Regression status:
  - Automated regression test linked: yes (`tests/implementSessionManager.test.ts`)
  - `npm test`: passed
  - `npm run build`: passed
  - `npm run validate:harness`: passed
  - Same-flow live revalidation: resolved; the same persisted run no longer fails on missing deferred `results/*` artifacts and instead proceeds into `run_experiments`.

- Most likely failing boundary:
  - implement-stage artifact-validation boundary inside `materializeDeclaredArtifacts(...)` / deferred output classification

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/verify_report.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/`

- Recommended next step:
  - keep following the same persisted run from `run_experiments`, where the next real blocker is now runner integrity rather than implement-stage artifact classification.

## Issue: LV-102

- Status: in_progress
- Validation target: same persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after `implement_experiments` was repaired with dynamic decomposition, runner chunking, and local `py_compile` verification
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - nodes reached: `implement_experiments -> run_experiments`

- Reproduction steps:
  1. Relaunch a fresh real TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let `implement_experiments` complete and hand off to `run_experiments`.
  4. Inspect `run_record.json`, `events.jsonl`, and the runner traceback produced by `run_experiments`.

- Expected behavior:
  - The repaired public runner should preserve required setup helpers such as `parse_args()` across chunk joins and should survive both local `py_compile` verification and the initial `run_experiments` invocation.

- Actual behavior:
  - The same persisted run now completes `implement_experiments` and passes local `python -m py_compile`.
  - The next downstream failure is inside `run_experiments`, where the generated runner aborts immediately with:
    - `RuntimeError("Missing parse_args() in runner setup chunk.")`
  - `run_record.json` now shows:
    - `implement_experiments.status: completed`
    - `run_experiments.status: failed`

- Fresh vs existing session comparison:
  - Fresh session: not separately reproduced yet.
  - Existing session: reproduced directly on the same persisted run after implement-stage recovery.
  - Divergence: unknown; this is currently a downstream runner-integrity bug, not a session-state mismatch.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: chunked runner materialization can still produce an internally inconsistent final script where later orchestration code expects setup-surface helpers that were omitted, overwritten, or not preserved correctly across subchunk joins. Local `py_compile` is too weak to catch this semantic integrity failure.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - repairs Python runners that define `build_arg_parser()` but omit a callable `parse_args()` helper by inserting a bounded compatibility shim before handoff
      - re-runs local verification after the shim is materialized so the persisted public runner surface reflects the repaired contract before `run_experiments`
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - added a regression that a generated Python runner missing `parse_args()` is repaired before handoff and still passes local `py_compile`

- Regression status:
  - Automated regression test linked: yes (`tests/implementSessionManager.test.ts`)
  - `npm test`: passed after adding the `parse_args()` repair regression
  - `npm run build`: passed after adding the repair
  - `npm run validate:harness`: passed after updating this entry
  - Same-flow live revalidation: in progress; the same persisted run now starts a fresh `implement_experiments` repair thread from runner feedback and has already advanced through scaffold, decomposition repair, materialization planning, and runner subchunk planning into `unit 1/3 chunk 1/3 subchunk 1/2`, but it has not yet re-crossed the downstream `run_experiments` boundary.

- Most likely failing boundary:
  - runner integrity across staged chunk/subchunk joins in `implement_experiments`, only surfaced by `run_experiments`

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

- Recommended next step:
  - strengthen implement-stage verification so chunked runner bundles must pass a bounded semantic smoke check (for example, required helper presence and callable entrypoint integrity) before handing off to `run_experiments`.

## Issue: LV-099

- Status: resolved
- Validation target: existing external-workspace TUI `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` on the rebuilt native Codex runtime after removing automatic `previous_response_id` forwarding
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - rebuilt runtime launched from `dist/cli/main.js`

- Reproduction steps:
  1. Start a fresh real TUI session in `.autolabos-validation` on the rebuilt runtime.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let the staged LLM attempt localize branch focus and submit the native Codex OAuth request.
  4. Inspect `implement_experiments/status.json`, `implement_experiments/progress.jsonl`, `events.jsonl`, and `run_record.json`.

- Expected behavior:
  - The retry should progress beyond `Submitting request to Codex OAuth Responses backend.`
  - After streamed Codex output arrives, the run should materialize a structured implementation result or at least salvage non-empty final text for parsing into a runnable bundle.

- Actual behavior:
  - Before the parser fix, the same live retry progressed to:
    - `Submitting request to Codex OAuth backend.`
    - `Submitting request to Codex OAuth Responses backend.`
    - `Received streamed Codex OAuth output.`
    - then failed with:
      - `Implementation execution failed before any runnable implementation was produced: Codex OAuth backend returned no output text (status=in_progress).`
  - After the parser fix and same-flow revalidation, the retried run no longer reproduces that failure.
  - The live flow now advances past native Codex text materialization, validates the returned implementation, and continues into later branch/attempt handling.
  - A separate downstream problem remains possible in the same node when the implementer references artifacts that were never materialized, but that is no longer the native stream-materialization boundary covered by `LV-099`.

- Fresh vs existing session comparison:
  - Fresh session: no separate fresh-from-bootstrap repro was needed for this parser boundary; the same persisted run was retried from a freshly relaunched rebuilt TUI session.
  - Existing session: before the fix, the same persisted run failed at `Codex OAuth backend returned no output text (status=in_progress)` after streamed output arrived.
  - Revalidated session: after the fix, that same persisted run proceeds past text materialization and into later implementation validation/retry handling.
  - Fresh-vs-existing divergence is not the issue here; the original symptom disappeared in the same persisted run on a rebuilt fresh TUI session.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis confirmed: the native Codex OAuth stream parser was too narrow. It trusted `response.output_text.delta` plus `response.completed` as the primary success path and could drop usable text when the backend emitted completion-bearing `item.completed`/`*.done`-style events without a final `response.completed` payload.

- Code/test changes:
  - Code:
    - `src/integrations/codex/oauthResponsesTextClient.ts`
      - no longer infers `previous_response_id` from `threadId`
      - now salvages completion-bearing text candidates from `item.completed`, `message.completed`, and `*.done`/`*.completed` stream events
      - now merges response payload snapshots across stream events instead of trusting only `response.completed`
      - now selects the best available final text from streamed deltas, payload output, and salvaged completion candidates
    - `src/core/llm/client.ts`
      - stopped auto-forwarding `threadId` as `previousResponseId` for native Codex OAuth completions
    - `src/integrations/codex/codexCliClient.ts`
      - stopped auto-forwarding `threadId` as `previousResponseId` when the native Codex wrapper issues a text completion
  - Tests:
    - `tests/codexOAuthTextClient.test.ts`
      - added regression coverage that `threadId` alone no longer serializes `previous_response_id`
      - explicit `previousResponseId` still serializes when intentionally provided
      - added regressions that salvage text from `item.completed` without `response.completed`
      - added regressions that salvage text from `response.output_text.done`

- Regression status:
  - Automated regression test linked: yes (`tests/codexOAuthTextClient.test.ts`)
  - Re-validation result: fixed in the same live retry flow; the original `status=in_progress` no-output failure no longer reproduces.

- Most likely failing boundary:
  - resolved native Codex OAuth stream-materialization boundary inside `implement_experiments` staged LLM mode

- Follow-up risks:
  - Later `implement_experiments` validation can still fail for unrelated reasons such as missing materialized artifacts or branch-level implementation drift.
  - Long-running prompts may still expose new native Codex event shapes; the current parser is broader, but future provider changes could require more salvage coverage.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/verify_report.json`

- Recommended next step:
  - continue the same live `implement_experiments` flow and treat any remaining failure after text materialization as a new downstream issue rather than a recurrence of `LV-099`.

- Resolution notes:
  - The same persisted run `73050f85-6b56-4385-8c31-2ec69a5b7dec` was retried again from a freshly relaunched rebuilt TUI session.
  - The retried flow no longer reproduced `Codex OAuth backend returned no output text (status=in_progress)`.
  - In the same live run, `implement_experiments` progressed beyond text materialization, validated the returned implementation, and emitted later-stage observations such as:
    - `Implementer referenced artifact(s) that were not materialized: ...`
    - `Restored 36 path(s) before retrying the next candidate branch.`
    - `Implementation attempt 2/3 started.`
  - Those later observations confirm the original native stream-materialization boundary was crossed successfully and the parser fix changed the runtime behavior in the intended same flow.

## Issue: LV-098

- Status: in_progress
- Validation target: fresh external-workspace TUI `/brief start --latest` rerun for IEEE PEFT papers that previously reached `pdf_extract_failed` abstract fallback despite a nominal `pdf_url`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation/.live/abstract-image-rerun-wgj0hk`
  - run: `4600d589-7162-4d46-8d2e-a6939713bafc`
  - target papers:
    - `doi:10.1109/lsp.2024.3377590` (`Chain-of-LoRA...`)
    - `doi:10.1109/globecom52923.2024.10901572` (`Federated Low-Rank Adaptation...`)

- Reproduction steps:
  1. Start a fresh external workspace and run real TUI `/brief start --latest`.
  2. Let `collect_papers` finish and `analyze_papers` reach the two IEEE target papers above.
  3. Observe source resolution log lines and inspect the cached `analysis_cache/pdfs/*` and `analysis_cache/page_images/*` artifacts for those paper ids.

- Expected behavior:
  - If a real PDF is available but text extraction is unusable, `resolvePaperTextSource(...)` should preserve rendered page images and log:
    - `PDF extraction produced no usable text. Falling back to abstract with supplemental page images.`
  - The later analyzer path should then attach those images on the extractor call.

- Actual behavior:
  - The fresh rerun still logs:
    - `[doi:10.1109/lsp.2024.3377590] PDF extraction produced no usable text. Falling back to abstract.`
    - `[doi:10.1109/globecom52923.2024.10901572] PDF extraction produced no usable text. Falling back to abstract.`
  - Both papers persist as `source=abstract` with no supplemental page images.
  - Direct inspection of the cached pseudo-PDFs shows they are HTML, not PDF:
    - `<!DOCTYPE html> ... <script> var MEMBER_PROFILE_...`
  - Their page-image directories exist but contain no PNG files, so this is not a later analyzer drop; the renderer never received a real PDF to rasterize.

- Fresh vs existing session comparison:
  - Fresh session: the earlier fresh rerun in `.live/abstract-image-rerun-wgj0hk` reproduces the IEEE staging-url failure, the newer fresh rerun in `.live/ieee-filter-rerun-9RKL01` proves the new `no_pdf_url` path is working for other unusable metadata rows, and the targeted fresh rerun in `.live/ieee-targeted-fresh-20260416-213634` confirms both IEEE targets are selected in the active top-30 with `pdf_availability_score: 0`, but the live node has not yet advanced far enough to emit their per-paper source-resolution logs.
  - Existing session: no separate resumed-session divergence has been observed; the defect is anchored at fresh source resolution against persisted corpus metadata before resume handling matters.
  - Divergence: no meaningful fresh-vs-existing divergence established so far; the remaining gap is target-paper coverage in the fresh rerun.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: persisted corpus rows can carry invalid IEEE staging `pdf_url` values from provider metadata (for example `http://xplorestaging.ieee.org/...pdf?arnumber=...`) that return HTML instead of a PDF binary. When those URLs are cached, the image-rescue path never gets a real PDF to render, so abstract fallback cannot preserve supplemental page images.

- Code/test changes:
  - Code:
    - `src/core/analysis/paperText.ts`
      - added a smaller `pdftoppm -scale-to 1024` rescue render attempt for real PDFs that fail default rasterization.
      - added invalid-PDF detection so HTML masquerading as `.pdf` is no longer silently cached as a PDF.
      - now treats known unusable IEEE staging hosts such as `xplorestaging.ieee.org` as non-usable `pdf_url` metadata before download.
  - Tests:
    - `tests/paperTextImageFallback.test.ts`
    - `tests/paperText.test.ts`

- Regression status:
  - Automated regression test linked: yes (`tests/paperText.test.ts`, `tests/paperTextImageFallback.test.ts`)
  - Re-validation result: pending same-flow confirmation for the two IEEE targets; the latest fresh reruns already show real `No PDF URL found. Using abstract fallback.` behavior for other unusable rows in the same patched runtime, and the targeted rerun now proves both IEEE targets are in the selected set under the patched resolver.

- Most likely failing boundary:
  - persisted metadata / source-resolution boundary

- Follow-up risks:
  - the target IEEE papers may still require alternate public-PDF enrichment even after the staging host is rejected, so this patch may only convert the failure from fake-PDF handling to honest `no_pdf_url` fallback.
  - even with both targets selected, long-running earlier papers can delay the same-flow per-paper confirmation because the node is still bounded and sequential enough that rank 4/25 may take time to surface in logs.

- Evidence/artifacts:
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/events.jsonl`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/corpus.jsonl`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/analysis_cache/pdfs/doi_10.1109_lsp.2024.3377590.pdf`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/analysis_cache/pdfs/doi_10.1109_globecom52923.2024.10901572.pdf`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/analysis_cache/page_images/doi_10.1109_lsp.2024.3377590/`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/analysis_cache/page_images/doi_10.1109_globecom52923.2024.10901572/`
  - `.autolabos-validation/.live/ieee-filter-rerun-9RKL01/.autolabos/runs/686eee86-9033-4ad9-8017-af4b3bf2d7f0/events.jsonl`
  - `.autolabos-validation/.live/ieee-filter-rerun-9RKL01/.autolabos/runs/686eee86-9033-4ad9-8017-af4b3bf2d7f0/corpus.jsonl`
  - `.autolabos-validation/.live/ieee-targeted-fresh-20260416-213634/.autolabos/runs/00575beb-de5b-4c57-9316-0377db0f2c4f/events.jsonl`
  - `.autolabos-validation/.live/ieee-targeted-fresh-20260416-213634/.autolabos/runs/00575beb-de5b-4c57-9316-0377db0f2c4f/analysis_manifest.json`
  - `.autolabos-validation/.live/ieee-targeted-fresh-20260416-213634/.autolabos/runs/00575beb-de5b-4c57-9316-0377db0f2c4f/corpus.jsonl`

- Recommended next step:
  - add a metadata-repair or alternate-PDF-resolution step for known bad IEEE staging URLs before `downloadPdf(...)` is attempted, or explicitly downgrade those rows as `invalid_pdf_content` with a clearer operator-facing note.

## Issue: LV-097

- Status: resolved
- Validation target: existing external-workspace TUI `/retry` flow for paused `analyze_papers` on run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context: default external validation root `.autolabos-validation`, real TUI startup automation, resumed paused session after `LV-096` was closed

- Reproduction steps:
  1. Start a real TUI session in `.autolabos-validation`.
  2. Resume the paused run `73050f85-6b56-4385-8c31-2ec69a5b7dec` with `/retry`.
  3. Let `analyze_papers` rerun its rerank-fallback shortlist and inspect `run_record.json`, `events.jsonl`, `paper_summaries.jsonl`, and `evidence_store.jsonl`.
  4. Wait until the first selected paper (`Compresso...`) reaches planner timeout on the full-text path.

- Expected behavior:
  - A paused existing session should preserve or quickly re-materialize a first persisted summary/evidence row when `analyze_papers` is retried.
  - If the shortlist changes, the reset should still recover to a persisted first row within the same bounded retry cycle.

- Actual behavior:
  - Before the fix, `/retry` could recompute the rerank-fallback shortlist and log:
    - `Analysis selection changed since the previous run. Resetting summaries/evidence for the new paper set.`
  - The existing `paper_summaries.jsonl` and `evidence_store.jsonl` were removed.
  - The rerun then reached:
    - `Analyzing paper 1/30: "Compresso: Structured Pruning with Collaborative Prompting Learns Compact Large Language Models".`
    - `[cef2e06efd484520808dfbeeee2029c4d06bd799] Planner unavailable, falling back to direct extraction: planner exceeded the 15000ms timeout`
  - with no persisted rows re-created.
  - After the fix and same-flow revalidation:
    - `/retry` now reuses the cached selection instead of resetting persisted outputs.
    - Full-text planner timeout on resumed papers logs:
      - `Planner timed out on a full-text source. Using a deterministic source-grounded fallback analysis so the first persisted row can be materialized without another long LLM roundtrip.`
    - Persisted rows re-materialize and continue accumulating in the same resumed run.

- Fresh vs existing session comparison:
  - Fresh session: the earlier fresh external-workspace `/brief start --latest` flow for the same run family already materialized persisted rows, including the abstract-only planner-timeout fallback fixed in `LV-096`.
  - Existing session: after the fix, the paused-session `/retry` path now reuses the cached selection and materializes deterministic full-text fallback rows instead of stalling at zero.
  - Divergence: no remaining fresh-vs-existing divergence observed at the first-row persistence boundary.

- Root cause hypothesis:
  - Type: `resume_reload_bug`
  - Hypothesis confirmed: retrying `analyze_papers` from a paused run could re-enter selection planning and, when it hit a full-text planner-timeout paper before any new rows were re-materialized, the direct-extraction path left the run at zero persisted rows. The fix makes planner-timeout on a full-text source materialize a conservative full-text fallback row immediately.

- Code/test changes:
  - Code:
    - `src/core/analysis/paperAnalyzer.ts`
      - planner timeout on a full-text source now returns a deterministic source-grounded fallback draft immediately instead of falling through to a long direct-extraction wait when the planner has already timed out.
  - Tests:
    - `tests/paperAnalyzer.test.ts`
      - added a regression for planner timeout on a full-text source.
    - `tests/analyzePapers.test.ts`
      - added a node-level regression that persists a full-text fallback row when the first selected paper hits planner timeout.

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: fixed in the same real external-workspace TUI `/retry` flow

- Follow-up risks:
  - Deterministic full-text fallback rows are intentionally weaker than normal structured extraction+review, so they should stay under the existing claim ceiling.
  - Analyze latency remains non-trivial because full-text planner timeouts still burn wall time before the fallback kicks in, but the resumed session no longer regresses to a zero-row stall.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/analysis_manifest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/paper_summaries.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/evidence_store.jsonl`

- Resolution notes:
  - After rebuilding, the same paused external-workspace run was resumed with a real TUI `/retry`.
  - The resumed flow now logs:
    - `Reusing cached paper rerank from analysis_manifest.json for top 30; skipping a new LLM rerank.`
    - `Planner timed out on a full-text source. Using a deterministic source-grounded fallback analysis so the first persisted row can be materialized without another long LLM roundtrip.`
    - `Persisted analysis outputs for "...\" (1 summary row, 1 evidence row(s)).`
  - In the same resumed run, `paper_summaries.jsonl` and `evidence_store.jsonl` were re-created and continued growing beyond the first paper; at validation time the run had already reached 7 persisted summary rows and 7 persisted evidence rows while still running.

## Issue: LV-096

- Status: resolved
- Validation target: real external-workspace TUI flow `/brief start --latest` through `analyze_papers` first-paper persistence, plus an abstract-only `pdf_extract_failed` paper in the same run
- Environment/session context: default external validation root `.autolabos-validation`, real TUI startup automation, run `73050f85-6b56-4385-8c31-2ec69a5b7dec`

- Reproduction steps:
  1. Start a real TUI session in `.autolabos-validation`.
  2. Run `/brief start --latest`.
  3. Let `collect_papers` complete and `analyze_papers` begin on `Compresso...`.
  4. Observe the first paper hit full-text planner timeout, then full-text extractor timeout, then full-text-only retry timeout.
  5. Inspect `events.jsonl`, `paper_summaries.jsonl`, `evidence_store.jsonl`, and `run_record.json`.

- Expected behavior:
  - After repeated full-text timeout exhaustion, the node should materialize a weak but honest persisted output for the first paper so warm-start can end.
  - If a later selected paper falls back to `pdf_extract_failed`, a planner timeout on the abstract-only path should also materialize a deterministic fallback row instead of stalling before persistence.

- Actual behavior:
  - Before the fix, the abstract-only `pdf_extract_failed` branch could log:
    - `Planning analysis focus, claim targets, and verification checks.`
    - `Planner unavailable, falling back to direct extraction: planner exceeded the 45000ms timeout`
    - with no persisted rows yet materialized.
  - After the fix and same-flow revalidation:
    - `Compresso...` persisted a deterministic abstract fallback row immediately after the repeated full-text timeouts.
    - A later abstract-only paper (`Federated Low-Rank Adaptation for Large Language Model Fine-Tuning Over Wireless Networks`) logged:
      - `Planner timed out on an abstract-only source. Using a deterministic abstract fallback analysis to preserve a minimal, source-grounded summary.`
      - `Persisted analysis outputs for "Federated Low-Rank Adaptation for Large Language Model Fine-Tuning Over Wireless Networks" (1 summary row, 1 evidence row(s)).`
  - `paper_summaries.jsonl` and `evidence_store.jsonl` now materialize in the same run, and `run_record.json` records `Persisted 2 summary row(s) and 2 evidence row(s).`

- Fresh vs existing session comparison:
  - Fresh session: `/brief start --latest` succeeds, `collect_papers` completes, and `analyze_papers` now persists rows during the same bounded analyze cycle.
  - Existing session: no separate resumed session was required for the closing validation because the fixed fresh external-workspace run now proves both the repeated full-text timeout fallback and the abstract-only planner-timeout fallback materialize persisted outputs.
  - Divergence: no remaining fresh-vs-existing difference observed at the persistence boundary.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis confirmed: the `pdf_extract_failed` abstract path routed planner timeout into a second extraction-style LLM pass instead of synthesizing a deterministic fallback immediately, delaying warm-start persistence behind another timeout-prone step.

- Code/test changes:
  - Code:
    - `src/core/analysis/paperAnalyzer.ts`
      - planner timeout on an abstract-only source now returns a deterministic fallback draft immediately instead of falling through to direct extraction.
  - Tests:
    - `tests/paperAnalyzer.test.ts`
      - added a regression for planner timeout on an abstract-only source.

- Regression status:
  - Automated regression test linked: yes (`paperAnalyzer` planner-timeout abstract fallback case)
  - Re-validation result: fixed in a real external-workspace TUI flow under `.autolabos-validation`

- Follow-up risks:
  - Full-text planner/extractor retries still consume noticeable wall time before the existing repeated-timeout fallback kicks in, so analyze latency remains a quality-of-life concern even though persistence now succeeds.
  - The external-workspace TUI path is now proven through `collect_papers` and persisted `analyze_papers` rows, so future regressions at this boundary should be revalidated on the same workspace style, not only under repository-local fixtures.

- Evidence/artifacts:
  - `.autolabos-validation/Brief.md`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/collect_result.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/analysis_manifest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/paper_summaries.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/evidence_store.jsonl`

## Issue: LV-095

- Status: resolved
- Validation target: real `test/.tmp` broad compact-model brief through resumed `analyze_papers` first-paper persistence
- Environment/session context: resumed fresh-workspace run `b86d40eb-4e9c-454c-bb48-019563a90bed` in `test/.tmp/compact-brief-rerun-6`, after the shortlist-quality fix and a real TUI `/retry`

- Reproduction steps:
  1. Start a fresh run from the broad compact-model / lightweight PEFT brief and let `collect_papers` complete.
  2. Let `analyze_papers` build the rerank-fallback shortlist and begin paper `1/30` (`Compresso...`).
  3. Resume the same run with a real TUI `/retry` after the first stalled attempt.
  4. Observe the full-text + image attempt time out, then the full-text-only retry time out, then the abstract-only fallback begin.
  5. Inspect `events.jsonl`, `paper_summaries.jsonl`, and `evidence_store.jsonl`.

- Expected behavior:
  - After full-text and full-text-only analysis both time out, the node should quickly materialize a weak but honest abstract-only fallback row so serial warm-start can end and persisted related-work artifacts can start accumulating.
  - The first persisted summary/evidence row should appear within the same bounded retry cycle.

- Actual behavior:
  - The run reaches:
    - `Extractor timed out with 12 rendered PDF page image(s). Retrying once with full text only.`
    - `Full-text extraction timed out again after removing rendered page images. Falling back to abstract-only analysis for this paper.`
    - `Planner unavailable, falling back to direct extraction: planner exceeded the 45000ms timeout`
  - But no `paper_summaries.jsonl` or `evidence_store.jsonl` row is materialized yet.
  - `run_record.json` still reports `Persisted 0 summary row(s) and 0 evidence row(s).`
  - The live TUI session continues to show `Analyzing... 1/30` with no first persisted output.

- Fresh vs existing session comparison:
  - Fresh session: the same run starts correctly from the tightened shortlist and reaches paper `1/30`.
- Existing session: after `/retry`, the node still stalls before the first persisted fallback row.
  - Divergence: no evidence that this is a fresh-vs-existing shortlist problem anymore; the remaining boundary is first-paper fallback materialization latency.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: once full-text and full-text-only retries are exhausted, `analyze_papers` still spends another full abstract-only LLM roundtrip before synthesizing the deterministic fallback, so the first persisted row is delayed behind another timeout-prone path instead of being materialized immediately.

- Code/test changes:
  - Code:
    - `src/core/analysis/paperAnalyzer.ts`
    - `src/core/nodes/analyzePapers.ts`
  - Tests:
    - `tests/analyzePapers.test.ts`
    - `tests/paperAnalyzer.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: pass on the same real flow after rebuilding and rerunning from a fresh `test/.tmp` workspace with shortened analysis timeouts

- Follow-up risks:
  - The first persisted row now materializes promptly, but long-lived aborted Codex subprocesses are still worth watching because the timeout-heavy paper-analysis path can leak background CLI children.
- Evidence/artifacts:
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/run_record.json`
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/events.jsonl`
  - `/tmp/retry-analyze-b86-2.log`
  - `test/.tmp/compact-brief-rerun-8-g6F8m6/.autolabos/runs/6147662c-96c4-45e3-b580-4f81d824c462/run_record.json`
  - `test/.tmp/compact-brief-rerun-8-g6F8m6/.autolabos/runs/6147662c-96c4-45e3-b580-4f81d824c462/events.jsonl`
  - `test/.tmp/compact-brief-rerun-8-g6F8m6/.autolabos/runs/6147662c-96c4-45e3-b580-4f81d824c462/paper_summaries.jsonl`
  - `test/.tmp/compact-brief-rerun-8-g6F8m6/.autolabos/runs/6147662c-96c4-45e3-b580-4f81d824c462/evidence_store.jsonl`

- Resolution notes:
  - The fix stops spending another abstract-only LLM roundtrip after full-text and full-text-only retries have already timed out.
  - Instead, `analyze_papers` now synthesizes the same conservative deterministic abstract fallback row immediately and persists it.
  - In the same live flow, the fresh rerun `6147662c-96c4-45e3-b580-4f81d824c462` now logs:
    - `Using a deterministic abstract fallback immediately after repeated full-text timeouts...`
    - `Persisted analysis outputs for "Compresso..." (1 summary row, 1 evidence row(s)).`
    - `Warm-start persisted outputs; continuing remaining 29 paper(s) with concurrency 3.`
  - The first persisted rows remain properly weak and abstract-bounded:
    - `source_type: "abstract"`
    - `confidence: 0.3`
    - `Abstract-only fallback; no verified full-text extraction completed before timeout.`

## Issue: LV-094

- Status: resolved
- Validation target: real `test/`-workspace broad compact-model brief through `collect_papers -> analyze_papers`
- Environment/session context: fresh `test/` workspace run `d45c14cd-edb0-4b45-95cf-9668c712c9a3` using the broadened compact-model / PEFT brief and the same governed `/brief start --latest` entry path

- Reproduction steps:
  1. Update `test/Brief.md` to the broader compact-model / lightweight PEFT study.
  2. Start a fresh real run from `test/` using `/brief start --latest`.
  3. Let `collect_papers` finish and `analyze_papers` build its top-30 shortlist after the rerank timeout fallback.
  4. Inspect `analysis_manifest.json`, `paper_summaries.jsonl`, and `events.jsonl`.

- Expected behavior:
  - For this brief, the rerank-fallback shortlist should stay centered on instruction tuning, LoRA/PEFT, compact-model adaptation, and bounded recipe trade-offs.
  - Domain-specific papers from unrelated application areas should not dominate the top-30 when the fallback safeguard is active.

- Actual behavior:
  - `collect_papers` now uses the improved query `+\"low-rank adaptation\" +\"instruction tuning\"` and completes successfully.
  - However, the fallback shortlist still admits off-topic domain papers into the selected 30, including medical, multimodal, and narrow application papers such as:
    - `MentalQLM: A Lightweight Large Language Model for Mental Healthcare Based on Instruction Tuning and Dual LoRA Modules.`
    - `BioInstruct: Instruction Tuning of Large Language Models for Biomedical Natural Language Processing`
    - `Ziya-Visual: Bilingual Large Vision-Language Model via Multi-Task Instruction Tuning`
    - `ATFLRec: A Multimodal Recommender System with Audio-Text Fusion and Low-Rank Adaptation via Instruction-Tuned Large Language Model`
  - The shortlist is better than the older broad-query run, but still not tight enough to count as a clean related-work set for this run contract.

- Fresh vs existing session comparison:
  - Fresh session: the new run `d45c14cd-edb0-4b45-95cf-9668c712c9a3` reproduces the shortlist drift in the rerank-fallback path.
  - Existing session: earlier broad-query run `089dce45-0385-4a93-9d2d-b1b5b10678bc` was worse at collect time, but the same underlying shortlist weakness remains when rerank times out.
  - Divergence: collect quality improved with the tightened brief; shortlist purity is still the remaining boundary.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the strict rerank-fallback safeguard relies mostly on anchor hit counts, but it does not penalize domain-specific tokens strongly enough when those domains are absent from the research brief. As a result, papers that mention LoRA/instruction tuning in unrelated application areas still survive the fallback shortlist.

- Code/test changes:
  - Code: `src/core/nodes/analyzePapers.ts`
  - Tests: `tests/analyzePapers.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: pass on the same live flow after rebuilding and rerunning from a fresh `test/.tmp` workspace

- Follow-up risks:
  - The shortlist is materially cleaner, but some domain-specific titles can still remain if they are genuinely PEFT/instruction-tuning focused enough for this brief.
  - If a future brief is explicitly medical or multimodal, the guard still depends on the brief carrying those anchors.
- Evidence/artifacts:
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/collect_request.json`
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/collect_result.json`
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/analysis_manifest.json`
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/paper_summaries.jsonl`
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/events.jsonl`
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/analysis_manifest.json`
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/collect_request.json`
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/events.jsonl`

- Resolution notes:
  - After the first patch, the live rerun still showed off-topic domain titles because the rerun was launched from an old built artifact.
  - After rebuilding and rerunning the same `/brief start --latest` flow from a fresh workspace, the rerank-fallback safeguard now reports:
    - `Dropped 24 off-topic paper(s) and promoted 24 replacement(s).`
  - The fresh selected top-30 is now led by papers such as:
    - `Compresso: Structured Pruning with Collaborative Prompting Learns Compact Large Language Models`
    - `Towards Alignment-Centric Paradigm: A Survey of Instruction Tuning in Large Language Models`
    - `Hyperparameter Optimization for Large Language Model Instruction-Tuning`
    - `Chain-of-LoRA: Enhancing the Instruction Fine-Tuning Performance of Low-Rank Adaptation on Diverse Instruction Set`
    - `MiLoRA: Efficient Mixture of Low-Rank Adaptation for Large Language Models Fine-tuning`
  - In the same rerun, the earlier drifting titles no longer appear near the top of the selected shortlist, including:
    - `ATFLRec...`
    - `MentalQLM...`
    - `BioInstruct...`
    - `Ziya-Visual...`

## Issue: LV-085

- Status: resolved
- Validation target: real `test/`-workspace governed run for the LoRA rank × dropout factorial brief
- Environment/session context: real `test/` workspace run `2c473563-13ad-4e11-b32a-9ff63e358f10`, revalidated through the same governed flow after implement fallback recovery changes

- Reproduction steps:
  1. Start the real run from `test/` with the governed brief for the Mistral-7B LoRA rank/dropout sweep.
  2. Let the run progress through `collect_papers`, `analyze_papers`, `generate_hypotheses`, and `design_experiments`.
  3. Allow `implement_experiments` to attempt public-bundle materialization and local verification.
  4. Observe the run fail before `run_experiments` because the declared public script path was never materialized.

- Expected behavior:
  - `implement_experiments` should hand off a runnable public experiment bundle containing the declared entrypoint, config, and docs.
  - Local verification should only fail if the declared public bundle is truly incomplete or unrunnable.

- Actual behavior:
  - Before the fix, `implement_experiments` failed with:
    - `Local verification could not start because required artifact(s) were not materialized ... run_lora_rank_dropout_sweep.py`
  - After the fix, the same real run now materializes:
    - `run_lora_rank_dropout_sweep.py`
    - `lora_rank_dropout_config.json`
    - `README_lora_rank_dropout.md`
  - The workflow advances beyond `implement_experiments`; the next real failure is later in `run_experiments` on offline Hugging Face model/tokenizer availability.

- Fresh vs existing session comparison:
  - Fresh session: broader-brief reruns now also advance through `collect_papers` into `analyze_papers`
  - Existing session: the persisted run `2c473563-13ad-4e11-b32a-9ff63e358f10` no longer fails on missing public artifacts
  - Divergence: no remaining evidence that the dominant failure is implement-stage materialization

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `implement_experiments` is ending with a declared public run command, but the actual public script/config bundle was never materialized into `outputs/.../experiment/`; the old `metrics.json` symptom is stale and no longer the dominant blocker.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: `tests/implementSessionManager.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: pass on the same real flow; artifact materialization now succeeds and the blocker moved downstream

- Follow-up risks:
  - The active blocker has shifted to `LV-086` and later runner/environment boundaries.
- Evidence/artifacts:
  - `test/.autolabos/runs/2c473563-13ad-4e11-b32a-9ff63e358f10/events.jsonl`
  - `test/.autolabos/runs/2c473563-13ad-4e11-b32a-9ff63e358f10/run_record.json`
  - `test/.autolabos/runs/2c473563-13ad-4e11-b32a-9ff63e358f10/memory/run_context.json`
  - `test/.autolabos/runs/2c473563-13ad-4e11-b32a-9ff63e358f10/implement_result.json`
  - `test/outputs/lora-rank-dropout-interaction-study-for-mistral--2c473563/experiment/run_lora_rank_dropout_sweep.py`
  - `test/outputs/lora-rank-dropout-interaction-study-for-mistral--2c473563/experiment/lora_rank_dropout_config.json`

## Issue: LV-086

- Status: resolved
- Validation target: real `test/`-workspace governed run for the LoRA rank × dropout factorial brief after `run_experiments`
- Environment/session context: same persisted live run `1f46de0f-5beb-4de6-a219-abf483b74101`, revalidated by forcing `analyze_results` through a real `test/` TUI session after the preflight-only metrics patch

- Reproduction steps:
  1. Start the real run from `test/` with the governed LoRA rank/dropout brief.
  2. Let `implement_experiments` and `run_experiments` complete.
  3. Inspect `.autolabos/runs/<run-id>/metrics.json` and `analysis/result_table.json`.
  4. Observe that the recorded metrics come from `mode: "preflight"` with no training or evaluation executed.

- Expected behavior:
  - `run_experiments` should not treat preflight-only environment checks as successful executed experiment evidence for this paper-scale brief.
  - Objective evaluation should not infer research success from hardware/resource fields such as `device.gpu_count` when the stated objective is benchmark accuracy on ARC-Challenge and HellaSwag.

- Actual behavior:
  - Before the fix:
    - `metrics.json` contained `mode: "preflight"` and `primary_metric: null`
    - `run_experiments` summarized `Objective metric met: device.gpu_count=2 >= 0.015`
    - `analyze_results` carried that stale success claim into `result_analysis.json`
  - After the fix and same-flow rerun:
    - `analyze_results` fails with `Experiment only emitted preflight metrics; no training or evaluation was executed.`
    - `result_table.json` is empty and no longer exposes `device.gpu_count` as the objective metric
    - `result_analysis.json` now reports `objective_status: "missing"` and no longer carries success-style `verifier_feedback`
    - `run_record.json` pauses back at `run_experiments` with the preflight-only failure surfaced as the latest summary

- Fresh vs existing session comparison:
  - Fresh session: the patched code was exercised in a real `test/` TUI rerun using startup automation from the same workspace
  - Existing session: the same persisted run `1f46de0f-5beb-4de6-a219-abf483b74101` now shows corrected artifacts after rerunning `analyze_results`
  - Divergence: none observed for this boundary after the rerun

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: preflight-only metrics were being allowed through result analysis and stale success-style verifier feedback from `run_experiments` was being copied into `result_analysis.json`, leaving a misleading “objective met” trail even when no executed experiment evidence existed.

- Code/test changes:
  - Code:
    - `src/core/experiments/executedMetrics.ts`
    - `src/core/nodes/runExperiments.ts`
    - `src/core/nodes/analyzeResults.ts`
  - Tests:
    - `tests/objectiveMetricPropagation.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: pass on the same real flow; preflight-only metrics are now surfaced as failure and no longer over-promoted into public analysis artifacts

- Follow-up risks:
  - `run_experiments` still pauses upstream because the underlying experiment never executed beyond preflight; that is now an honest blocker rather than a misleading success signal.
- Evidence/artifacts:
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/metrics.json`
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/result_analysis.json`
  - `test/outputs/lora-rank-dropout-interaction-for-mistral-7b-ins-1f46de0f/analysis/result_table.json`
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/run_record.json`
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/events.jsonl`

## Issue: LV-ARCHIVE-ANCHOR

- Status: resolved
- Validation target: `ISSUES.md` structural compatibility with harness validation
- Environment/session context: repository root documentation state after archive compaction

- Reproduction steps:
  1. Run `npm run validate:harness` from the repository root.
  2. Observe that the validator scans `ISSUES.md`.
  3. Remove all structured `Issue:` entries from the file.

- Expected behavior: `ISSUES.md` remains machine-readable by the harness validator.
- Actual behavior: the validator reports `issue_entry_missing` when no structured issue headings remain.
- Fresh vs existing session comparison:
  - Fresh session: same validator result
  - Existing session: same validator result
  - Divergence: no

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the validator still expects at least one structured `Issue:` entry even when active defects are empty and older issues have been compacted into git history.

- Code/test changes:
  - Code: none
  - Tests: none

- Regression status:
  - Automated regression test linked: no
  - Re-validation result: pass once this archive anchor remains present

- Follow-up risks: validator and operator-facing issue management can drift again if the file is compacted without leaving any structured anchor.
- Evidence/artifacts: `npm run validate:harness`, `docs/live-validation-issue-template.md`
