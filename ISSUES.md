# ISSUES.md

Last updated: 2026-03-18 · 931/933 tests pass (2 skipped: zzz_noProjectRootLeak)

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
