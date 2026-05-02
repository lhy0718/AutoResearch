# AutoLabOS Governance Benchmark Implementation Checklist

Created: 2026-05-02
Updated: 2026-05-02

This checklist turns repo contracts and private planning notes into repo-local implementation work. Do not include machine-local reference paths or private documentation paths in this public checklist.

## Direction

AutoLabOS should not compete primarily as a stronger end-to-end AI scientist. The implementation direction is an artifact-grounded governance runtime that prevents paper-shaped output from being promoted to paper-ready evidence without baseline/comparator evidence, result tables, claim-evidence links, figure consistency, review-before-writing, and reproducible run artifacts.

The governed workflow remains fixed around:

`collect_papers -> analyze_papers -> generate_hypotheses -> design_experiments -> implement_experiments -> run_experiments -> analyze_results -> figure_audit -> review -> write_paper`

`figure_audit` is the approved independent checkpoint before `review`; no additional top-level workflow node is planned here.

## Reference Inputs Read

- Repo: `AGENTS.md`
- Repo: `docs/architecture.md`
- Repo: `docs/tui-live-validation.md`
- Repo: `docs/experiment-quality-bar.md`
- Repo: `docs/paper-quality-bar.md`
- Repo: `docs/reproducibility.md`
- Repo: `docs/research-brief-template.md`
- Repo: `docs/live-validation-issue-template.md`
- Competitive-analysis planning inputs, summarized here as repo-local implementation requirements without exposing local vault paths or private note names.

## Execution Order

1. Close the P0 competitive-analysis hardening slice: evidence gate, readiness/doctor gate, slug/log/provenance contract alignment, and quantified gate thresholds.
2. Make the benchmark seed bundle consumable without modifying any external reference source.
3. Add a deterministic benchmark condition model for gated, ungated, and ablation runs.
4. Validate required artifact contracts against real run directories.
5. Add scoring outputs for claim discipline, evidence linkage, result table completeness, figure audit, paper readiness, and live-validation failure handling.
6. Run AGB-001 as a dry-run to lock the contract.
7. Batch or replay AGB-002 through AGB-010.
8. Export paper/demo-ready artifact bundles only after run-scoped artifacts and public outputs agree.

## Unified Priority Checklist

This is the canonical checklist. Legacy numeric-only implementation items have been merged into the P0/P1/P2 sequence below.

### P0 — Sprint Queue

- [x] P0-1. Competitive-analysis hardening slice: evidence gates, readiness/doctor checks, slug/log/provenance contracts, and quantified thresholds.
- [x] P0-2. Research brief input path handling for benchmark and external brief starts.
- [x] P0-3. Benchmark seed import or reference execution.
- [x] P0-4. Gated, ungated, and ablation execution branches.
- [x] P0-5. Required artifact contract validation.
- [x] P0-6. Governance rubric and scoring output.
- [x] P0-7. AGB-001 dry-run contract lock.
- [ ] P0-8. AGB-001 live full-run validation. Live TUI run attempted on 2026-05-02; `LV-320`, `LV-321`, `LV-322`, `LV-323`, `LV-324`, and `LV-325` repairs are implemented with automated validation passing; rebuilt same-flow validation passed the LV-325 symptom, auto-repaired `LV-326` in-run, and is now back at `design_experiments` after an evidence-quality gate.

### P1 — Next Release Cycle

- [x] P1-1. Paper-readiness gate and claim ceiling.
- [x] P1-2. Claim-evidence table and unsupported-claim scoring.
- [x] P1-3. Result table validation and Baseline Compare surface.
- [x] P1-4. Figure audit and visualization-agent handoff review.
- [x] P1-5. Review-before-writing enforcement.
- [x] P1-6. Live-validation failure taxonomy and scoring.
- [ ] P1-7. AGB-002 through AGB-010 batch or replay.
- [ ] P1-8. Paper/system demo artifact bundle export.
- [ ] P1-9. Runtime and worker surfaces: environment bootstrapping, eval-history/fitness, prompt/skill contracts, failure memory, stage routing, model-worker adapter, and autonomy metrics.
- [ ] P1-10. Design and positioning reviews: StagePolicies, ExplorationManager, differentiation, baseline-first support, HITL modes, rapid iteration, external benchmark plans, artifact access, and responsible-use docs.

### P2 — Longer-Horizon Queue

- [x] P2-1. Whole-run evolution regression scope: existing `evolve` support covers fresh run cycles, `paper_readiness` fitness, `evo-N` tags, `--max-cycles`, target selection, and dry-run behavior.
- [ ] P2-2. Meta-Harness external multi-run loop.
- [ ] P2-3. Month-long autonomous execution checkpoint/resume review.
- [ ] P2-4. DeepReviewer-style review backend integration study.
- [ ] P2-5. StagePolicies autonomous evolution experiment design.
- [ ] P2-6. ExplorationManager autonomous knowledge-retention design review.
- [ ] P2-7. Multimodal memory layer review.
- [ ] P2-8. Node output serialization stability audit.
- [ ] P2-9. Intermediate artifact capture during experiment implementation and execution.
- [ ] P2-10. Reverse-from-data research design mode review.
- [ ] P2-11. ArtifactReactor-style peer-agent coordination review.
- [ ] P2-12. Distributed experiment ecosystem review.
- [ ] P2-13. Research World Model or knowledge-graph design review.
- [ ] P2-14. Zero-cost monitoring mode for long-running experiments.
- [ ] P2-15. AutoSOTA-style SOTA tracking module review.
- [ ] P2-16. Strategist/Worker loop separation experiment design.
- [ ] P2-17. Domain-specific research-agent plugin structure.

## Detailed Task Cards

### P0-1. Competitive-Analysis Hardening Slice

- [x] Status: completed 2026-05-02
- Merged source items:
  - Evidence-consistency gate hardening
  - Readiness/doctor gate hardening
  - Slug/log/provenance contract alignment
  - Quantified gate thresholds
- Related repo files:
  - Existing: `src/core/doctor.ts`
  - Existing: `src/core/analysis/paperMinimumGate.ts`
  - Existing: `src/core/analysis/resultsTableSchema.ts`
  - Existing: `src/core/analysis/figureAuditor.ts`
  - Existing: `src/core/nodes/review.ts`
  - Existing: `src/core/nodes/writePaper.ts`
  - Existing: `src/core/publicArtifacts.ts`
  - Existing: `src/core/publicOutputPublisher.ts`
  - Existing: `src/core/stateGraph/runtime.ts`
  - Tests: `tests/doctorHarnessIntegration.test.ts`, `tests/paperMinimumGate.test.ts`, `tests/reviewGateStrength.test.ts`, `tests/figureAuditor.test.ts`, `tests/publicOutputPublisher.test.ts`, `tests/stateGraphRuntime.test.ts`
- Planned files if needed:
  - None currently required; existing public-output manifest and runtime node targets already provide deterministic slug/provenance coverage.
- Validation commands:
  - `npm test -- tests/doctorHarnessIntegration.test.ts tests/paperMinimumGate.test.ts tests/figureAuditor.test.ts tests/paperGateThresholds.test.ts`
  - `npm run validate:harness`
  - `npm run build`
- Completion criteria:
  - `/doctor` and run-entry readiness checks fail early on missing provider/runtime prerequisites, unwritable workspace roots, malformed required config, and missing brief governance fields.
  - Claim, review, figure-audit, and paper-readiness gates record both measured values and configured thresholds in run-scoped artifacts or events.
  - Node output slugs, event ids, artifact paths, and public-output provenance links are deterministic and traceable back to `.autolabos/runs/<run-id>/`.
  - Unsupported claims are blocked, downgraded, or counted; successful PDF build and `write_paper completed` remain insufficient for `paper_ready`.

### P0-2. Research Brief Input Path Handling

- [x] Status: completed 2026-05-02
- Related repo files:
  - Existing: `src/core/runs/researchBriefFiles.ts`
  - Existing: `src/core/runs/runBriefParser.ts`
  - Existing: `src/core/commands/parseSlash.ts`
  - Existing: `src/interaction/InteractionSession.ts`
  - Tests: `tests/researchBriefFiles.test.ts`, `tests/runBriefParser.test.ts`, `tests/runBriefStartFlow.test.ts`, `tests/newSlashCommands.test.ts`
- Planned files if needed:
  - `tests/briefStartPath.test.ts`
- Validation commands:
  - `npm test -- tests/briefStartPath.test.ts tests/researchBriefFiles.test.ts tests/runBriefParser.test.ts tests/runBriefStartFlow.test.ts tests/newSlashCommands.test.ts`
  - `npm run build`
- Completion criteria:
  - `/brief start <path-to-AGB-001-brief.md>` is accepted as an input path without copying from or modifying an external reference source.
  - `--latest` behavior remains unchanged.
  - Missing required research-brief governance fields are surfaced as execution risks.
  - Path handling is covered by regression tests using a fixture path outside the repo.

### P0-3. Benchmark Seed Import Or Reference Execution

- [x] Status: completed 2026-05-02
- Related repo files:
  - Existing: `src/cli/main.ts`
  - Existing: `src/cli/args.ts`
  - Existing: `src/core/runs/researchBriefFiles.ts`
  - Existing: `src/core/validation/harnessValidationService.ts`
  - Existing: `src/core/validation/harnessValidators.ts`
  - Tests: `tests/harnessValidationService.test.ts`, `tests/harnessValidators.test.ts`, `tests/cliArgs.test.ts`
- Planned files if needed:
  - `src/core/benchmark/governanceSeedBundle.ts`
  - `src/cli/governanceBenchmark.ts`
  - `tests/governanceSeedBundle.test.ts`
- Validation commands:
  - `npm test -- tests/governanceSeedBundle.test.ts tests/cliArgs.test.ts`
  - `npm run validate:harness`
  - `npm run build`
- Completion criteria:
  - Repo supports either reference execution from an external reference path or an explicit import into a repo-controlled generated directory.
  - Any import command records source path, checksum or mtime, and task id.
  - No implementation path writes outside repo-controlled outputs unless explicitly requested.

### P0-4. Gated, Ungated, And Ablation Execution Branches

- [x] Status: completed 2026-05-02
- Related repo files:
  - Existing: `src/config/governance.default.yaml`
  - Existing: `src/config.ts`
  - Existing: `src/core/analysis/paperMinimumGate.ts`
  - Existing: `src/core/nodes/review.ts`
  - Existing: `src/core/nodes/figureAudit.ts`
  - Existing: `src/core/analysis/resultsTableSchema.ts`
  - Existing: `src/core/stateGraph/runtime.ts`
  - Tests: `tests/paperMinimumGate.test.ts`, `tests/reviewNode.test.ts`, `tests/figureAuditNode.test.ts`, `tests/resultTable.test.ts`, `tests/stateGraphRuntime.test.ts`
- Planned files if needed:
  - `src/core/benchmark/governanceCondition.ts`
  - `tests/governanceCondition.test.ts`
- Validation commands:
  - `npm test -- tests/governanceCondition.test.ts tests/paperMinimumGate.test.ts tests/reviewNode.test.ts tests/figureAuditNode.test.ts tests/resultTable.test.ts`
  - `npm run build`
- Completion criteria:
  - Conditions are explicit: `gated`, `ungated`, `no_claim_ceiling`, `no_review_gate`, `no_figure_audit`.
  - Ablations affect only benchmark/evaluation mode and do not weaken normal production defaults.
  - Each run records the active condition in run-scoped artifacts and events.

### P0-5. Required Artifact Contract Validation

- [x] Status: completed 2026-05-02
- Related repo files:
  - Existing: `src/core/validation/harnessValidators.ts`
  - Existing: `src/core/validation/harnessValidationService.ts`
  - Existing: `src/core/runs/runCompletenessChecklist.ts`
  - Existing: `src/core/publicArtifacts.ts`
  - Existing: `src/core/publicOutputPublisher.ts`
  - Tests: `tests/harnessValidators.test.ts`, `tests/harnessValidationService.test.ts`, `tests/runProjection.test.ts`, `tests/publicOutputPublisher.test.ts`
- Planned files if needed:
  - `src/core/benchmark/governanceArtifactContract.ts`
  - `tests/governanceArtifactContract.test.ts`
- Validation commands:
  - `npm test -- tests/governanceArtifactContract.test.ts tests/harnessValidators.test.ts tests/harnessValidationService.test.ts`
  - `npm run validate:harness`
- Completion criteria:
  - Benchmark validation checks required artifacts per task condition, including `result_table.json`, `evidence_store.jsonl`, `figure_audit/figure_audit_summary.json`, `review/*`, and `paper/*` where applicable.
  - `draft.md`, `main.tex`, or successful PDF build alone is never enough for paper-ready status.
  - Public `outputs/` bundles remain traceable to `.autolabos/runs/<run-id>/` artifacts.

### P0-6. Rubric Scoring Output

- [x] Status: completed 2026-05-02
- Related repo files:
  - Existing: `src/cli/evalHarness.ts`
  - Existing: `src/core/evaluation/evalHarness.ts`
  - Existing: `src/core/metaHarness/harnessApplier.ts`
  - Existing: `src/core/metaHarness/harnessLoader.ts`
  - Existing: `src/core/metaHarness/types.ts`
  - Tests: `tests/evalHarness.test.ts`, `tests/harnessLoader.test.ts`, `tests/harnessApplier.test.ts`, `tests/metaHarness.test.ts`
- Planned files if needed:
  - `src/core/benchmark/governanceRubric.ts`
  - `src/core/benchmark/governanceScorer.ts`
  - `tests/governanceRubric.test.ts`
  - `tests/governanceScorer.test.ts`
- Validation commands:
  - `npm test -- tests/governanceRubric.test.ts tests/governanceScorer.test.ts tests/evalHarness.test.ts`
  - `npm run validate:harness`
- Completion criteria:
  - Each task has a 10-point rubric over evidence linkage, claim discipline, gate correctness, artifact completeness, and repairability.
  - Scoring output includes primary metrics such as `false_paper_ready_rate`, `unsupported_claim_count`, `claim_to_evidence_coverage`, `missing_baseline_pass_rate`, and `figure_result_mismatch_rate`.
  - Placeholder values are never reported as measured results.

### P0-7. AGB-001 Dry-Run

- [x] Status: completed 2026-05-02 via deterministic benchmark replay
- Related repo files:
  - Existing: `src/cli/main.ts`
  - Existing: `src/cli/args.ts`
  - Existing: `src/cli/governanceBenchmark.ts`
  - Existing: `src/core/benchmark/governanceDryRun.ts`
  - Existing: `src/core/runs/researchBriefFiles.ts`
  - Existing: `src/core/validation/harnessValidationService.ts`
  - Existing: `src/core/nodes/review.ts`
  - Existing: `src/core/nodes/writePaper.ts`
- Generated files:
  - `outputs/governance-benchmark/AGB-001/README.md` generated by run/export tooling
- Validation commands:
  - `npm test -- tests/cliArgs.test.ts tests/governanceDryRun.test.ts tests/governanceArtifactContract.test.ts tests/governanceSeedBundle.test.ts tests/governanceScorer.test.ts`
  - `npm run dev -- governance-benchmark dry-run --seed outputs/governance-benchmark/seeds/AGB-001 --task AGB-001 --condition gated --condition ungated --out-dir outputs/governance-benchmark/AGB-001`
  - `npm run build`
  - `npm run validate:harness`
  - `npm test -- tests/collectPapers.test.ts -t "excludes blocked collected items"` after the full-suite run hit a transient afterEach timeout in that test.
  - Live flow is tracked separately in P0-8.
- Completion criteria:
  - [x] AGB-001 replays a run under both `gated` and `ungated` conditions.
  - [x] Missing baseline is detected from the seed result table.
  - [x] Comparative improvement claim is blocked or downgraded in the gated condition.
  - [x] Required artifacts and scoring outputs exist and are parseable in the replay output.

### P0-8. AGB-001 Live Full-Run Validation

- [ ] Status: attempted on 2026-05-02; `LV-320`, `LV-321`, `LV-322`, `LV-323`, `LV-324`, and `LV-325` repairs implemented with automated validation passing; rebuilt same-flow revalidation passed the LV-325 resolver symptom, exposed/repaired `LV-326` in-run, then backtracked from `analyze_results` to `design_experiments` on evidence quality
- Related repo files:
  - Existing: `src/cli/args.ts`
  - Existing: `src/cli/main.ts`
  - Existing: `src/app.ts`
  - Existing: `src/tui/TerminalApp.ts`
  - Existing: `src/runtime/createRuntime.ts`
  - Existing: `src/web/server.ts`
  - Existing: `src/core/stateGraph/runtime.ts`
  - Existing: `src/core/runs/researchBriefFiles.ts`
  - Existing: `src/core/benchmark/governanceCondition.ts`
  - Existing: `src/core/benchmark/governanceArtifactContract.ts`
- Planned files if needed:
  - Same-flow revalidation notes after `LV-321`, `LV-322`, `LV-323`, `LV-324`, `LV-325`, and `LV-326` repairs
- Validation commands:
  - `npm run build`
  - `npm test`
  - `npm run validate:harness`
  - Start AutoLabOS from a validation workspace, run `/doctor`, then run `/brief start <path-to-AGB-001-brief.md>`.
  - Re-run the same live flow after any fix before checking this item.
- Validation notes:
  - Live TUI run started from an external AGB-001 brief path under the `gated` benchmark condition.
  - `/doctor` was run before the live execution and surfaced pre-existing duplicate live-validation issue identifiers in `ISSUES.md`.
  - The run progressed through `collect_papers`, `analyze_papers`, `generate_hypotheses`, `design_experiments`, multiple `implement_experiments` attempts, and repeated `run_experiments` retries.
  - The final live state was `failed` at `run_experiments` after retry 3/3 with `TypeError: compute_classification_metrics() missing 1 required positional argument: 'records'`.
  - A restarted TUI session reloaded the same run as `status: failed`, `node: run_experiments`; the UI also showed `interaction: busy`, which is recorded in `LV-320`.
  - After the `LV-320` repair, a rebuilt real TUI revalidation under the `gated` benchmark condition no longer reproduced the missing `records` TypeError and advanced to a generated numeric-helper alias mismatch (`LV-321`).
  - The same revalidation then auto-rolled back and exposed rollback artifact loss: the public experiment runner path no longer existed when `implement_experiments` retried (`LV-322`).
  - After the `LV-322` repair, the rebuilt same-flow live run advanced past rollback artifact loss, then exposed a generated dataset-dispatch mismatch where the final entrypoint could not invoke generated `load_dataset(config)` or generated `fallback_dataset()` (`LV-323`).
  - After the `LV-323` repair, the rebuilt same-flow live run advanced past dataset-dispatch mismatch, then exposed a generated baseline-first evaluator whose final dispatcher called `run_baseline_first_condition_evaluation(records)` without `records` and did not unwrap the returned `conditions` mapping (`LV-324`).
  - After the `LV-324` repair, the rebuilt same-flow live run advanced into real `run_experiments`; the prior evaluator `records` TypeError did not reproduce, but the runner failed before metrics creation because the final baseline/retrieval condition resolver searched canonical names while generated helpers used semantically specific names (`LV-325`).
  - After the `LV-325` repair, rebuilt P0-8 run `26756a6f-cf0e-4cb6-9266-99f400bff3db` no longer reproduced the resolver-name failure. The first `run_experiments` attempt instead failed the metrics contract because `accuracy_delta_vs_baseline` was absent (`LV-326`).
  - The same run auto-repaired `LV-326`: `implement_experiments` regenerated the runner, local verification passed, `run_experiments` completed, and `metrics.json` contained `accuracy_delta_vs_baseline: 0`.
  - `analyze_results` then completed and correctly backtracked to `design_experiments` because `accuracy_delta_vs_baseline=0` did not satisfy `> 0` and evidence quality remained weak. P0-8 remains unchecked until the run either reaches downstream governance surfaces or fails earlier with a recorded blocker.
  - `LV-321`, `LV-322`, `LV-323`, `LV-324`, and `LV-325` repairs pass targeted regressions, full build, full test suite, harness validation, and same-flow revalidation for their original symptoms.
- Completion criteria:
  - [x] Live TUI run starts from the external AGB-001 brief path without copying private source paths into committed docs.
  - [x] `/doctor` output is checked before the live run.
  - [x] Run artifacts include traceable brief snapshot/source metadata, `events.jsonl`, `run_record.json`, and `runs.json`.
  - [x] Benchmark condition is recorded for the live run and matches the selected condition.
  - [ ] Missing baseline is detected in live run artifacts.
  - [ ] Comparative improvement claim is blocked or downgraded before paper-ready classification.
  - [ ] Required review and paper artifacts are present and parseable.
  - [x] Fresh-session and existing/resumed-session behavior are compared.
  - [x] Any live-validation issue is recorded in `ISSUES.md` with the required taxonomy and regression status.

### P1-1. Paper-Readiness Gate And Claim Ceiling

- [x] Status: completed 2026-05-02
- Related repo files:
  - Existing: `src/core/analysis/paperMinimumGate.ts`
  - Existing: `src/core/paperCritique.ts`
  - Existing: `src/core/analysis/llmPaperQualityEvaluator.ts`
  - Existing: `src/core/analysis/paperGateThresholds.ts`
  - Existing: `src/core/nodes/review.ts`
  - Existing: `src/core/nodes/writePaper.ts`
  - Tests: `tests/paperMinimumGate.test.ts`, `tests/paperCritique.test.ts`, `tests/reviewGateStrength.test.ts`, `tests/reviewDecision.test.ts`, `tests/paperGateThresholds.test.ts`, `tests/writePaperPdfBuild.test.ts`
- Planned files if needed:
  - `tests/governancePaperReadinessGate.test.ts`
- Validation commands:
  - `npm test -- tests/governancePaperReadinessGate.test.ts tests/paperCritique.test.ts tests/paperMinimumGate.test.ts tests/reviewGateStrength.test.ts tests/reviewDecision.test.ts tests/paperGateThresholds.test.ts`
  - `npm test -- tests/writePaperPdfBuild.test.ts tests/paperWriting.test.ts`
  - `npm run build`
- Completion criteria:
  - Weak evidence is classified as `system_validation_note`, `research_memo`, or `blocked_for_paper_scale`, not `paper_ready`.
  - `write_paper` fails fast when pre-draft critique or brief evidence assessment blocks paper-scale drafting.
  - AGB-001, AGB-002, AGB-003, AGB-009, and AGB-010 cannot pass as paper-ready when their intended missing evidence remains unresolved.

### P1-2. Claim-Evidence Table

- [x] Status: completed 2026-05-02
- Related repo files:
  - Existing: `src/core/nodes/writePaper.ts`
  - Existing: `src/core/analysis/scientificWriting.ts`
  - Existing: `src/core/analysis/citationConsistencyChecker.ts`
  - Existing: `src/core/analysis/verifiedRegistry.ts`
  - Existing: `src/core/exploration/evidenceSerializer.ts`
  - Tests: `tests/citationConsistencyChecker.test.ts`, `tests/evidenceSerializer.test.ts`, `tests/verifiedRegistry.test.ts`, `tests/scientificWriting.test.ts`
- Planned files if needed:
  - `src/core/benchmark/claimEvidenceScoring.ts`
  - `tests/claimEvidenceScoring.test.ts`
- Validation commands:
  - `npm test -- tests/claimEvidenceScoring.test.ts tests/citationConsistencyChecker.test.ts tests/evidenceSerializer.test.ts tests/governanceScorer.test.ts`
  - `npm run validate:harness`
  - `npm run build`
- Completion criteria:
  - `paper/claim_evidence_table.json` maps every major claim to literature, experiment, qualitative observation, or limitation evidence.
  - Unsupported claims are counted, downgraded, or blocked.
  - AGB scoring can compute `unsupported_claim_count`, `claim_to_evidence_coverage`, and citation support metrics from artifacts.

### P1-3. Result Table Validation And Baseline Compare

- [x] Status: completed 2026-05-02
- Related repo files:
  - Existing: `src/core/analysis/resultsTableSchema.ts`
  - Existing: `src/core/nodes/analyzeResults.ts`
  - Existing: `src/core/resultAnalysis.ts`
  - Existing: `src/core/resultAnalysisPresentation.ts`
  - Tests: `tests/resultTable.test.ts`, `tests/resultAnalysis.test.ts`, `tests/resultAnalysisPresentation.test.ts`, `tests/analyzeResultsAOCS.test.ts`
- Planned files if needed:
  - `src/core/benchmark/resultTableScoring.ts`
  - `tests/resultTableScoring.test.ts`
- Validation commands:
  - `npm test -- tests/resultTable.test.ts tests/resultAnalysis.test.ts tests/resultTableScoring.test.ts`
  - `npm run build`
- Completion criteria:
  - Result tables preserve condition, dataset/task, primary metric, numeric result, comparator status, and caveats.
  - Missing comparator or missing metric is represented explicitly, not silently omitted.
  - AGB-003 and AGB-009 block superiority/performance claims without valid comparator and metric evidence.

### P1-4. Figure Audit And Visualization Handoff

- [x] Status: completed 2026-05-02
- Related repo files:
  - Existing: `src/core/analysis/figureAuditor.ts`
  - Existing: `src/core/nodes/figureAudit.ts`
  - Existing: `src/core/nodes/review.ts`
  - Tests: `tests/figureAuditor.test.ts`, `tests/figureAuditNode.test.ts`, `tests/reviewNode.test.ts`
- Planned files if needed:
  - `src/core/benchmark/figureAuditScoring.ts`
  - `tests/figureAuditScoring.test.ts`
- Validation commands:
  - `npm test -- tests/figureAuditor.test.ts tests/figureAuditNode.test.ts tests/figureAuditScoring.test.ts`
  - `npm run build`
- Completion criteria:
  - `figure_audit/figure_audit_summary.json` detects figure/caption/result-table mismatch with an affected figure id.
  - Severe mismatch escalates review to repair or backtrack.
  - `no_figure_audit` ablation is recorded distinctly from a clean audit pass.

### P1-5. Review-Before-Writing

- [x] Status: completed 2026-05-02
- Related repo files:
  - Existing: `src/core/nodes/review.ts`
  - Existing: `src/core/nodes/writePaper.ts`
  - Existing: `src/core/reviewPacket.ts`
  - Existing: `src/core/reviewSystem.ts`
  - Tests: `tests/reviewNode.test.ts`, `tests/reviewDecision.test.ts`, `tests/paperWriting.test.ts`, `tests/writePaperPdfBuild.test.ts`
- Planned files if needed:
  - `tests/reviewBeforeWritingGovernance.test.ts`
- Validation commands:
  - `npm test -- tests/reviewNode.test.ts tests/reviewDecision.test.ts tests/reviewBeforeWritingGovernance.test.ts`
  - `npm run validate:harness`
  - `npm run build`
- Completion criteria:
  - `review/paper_critique.json` is produced before drafting and blocks weak evidence from entering `write_paper`.
  - `review/decision.json` recommends supported upstream targets for missing baseline, missing result table, unsupported claim, or figure mismatch.
  - `write_paper completed` remains visibly distinct from `paper_ready`.

### P1-6. Live-Validation Failure Taxonomy

- [x] Status: completed 2026-05-02
- Related repo files:
  - Existing: `ISSUES.md`
  - Existing: `docs/live-validation-issue-template.md`
  - Existing: `src/core/doctor.ts`
  - Existing: `src/core/validation/harnessValidators.ts`
  - Tests: `tests/doctorHarnessIntegration.test.ts`, `tests/harnessValidators.test.ts`, `tests/liveFixtureWorkspace.test.ts`
- Planned files if needed:
  - `src/core/benchmark/liveValidationScoring.ts`
  - `tests/liveValidationScoring.test.ts`
- Validation commands:
  - `npm test -- tests/doctorHarnessIntegration.test.ts tests/harnessValidators.test.ts tests/liveValidationScoring.test.ts tests/liveFixtureWorkspace.test.ts`
  - `npm run validate:harness`
  - `npm run build`
  - For real interactive defects: re-run the same TUI/web flow after fixes.
- Completion criteria:
  - Every live-validation case records one dominant class: `persisted_state_bug`, `in_memory_projection_bug`, `refresh_render_bug`, `resume_reload_bug`, or `race_timing_bug`.
  - AGB-009 separates syntax success from metric evidence.
  - AGB-010 preserves fallback labels and excludes deterministic fallback from paper-scale evidence.

### P1-7. AGB-002 Through AGB-010 Batch Or Replay

- [ ] Status: not started
- Related repo files:
  - Existing: `src/cli/evalHarness.ts`
  - Existing: `src/core/evaluation/evalHarness.ts`
  - Existing: `src/core/publicOutputPublisher.ts`
  - Existing: `src/core/validation/harnessValidationService.ts`
- Planned files if needed:
  - `src/cli/governanceBenchmark.ts`
  - `src/core/benchmark/governanceRunner.ts`
  - `tests/governanceRunner.test.ts`
- Validation commands:
  - `npm test -- tests/governanceRunner.test.ts tests/governanceScorer.test.ts tests/harnessValidationService.test.ts`
  - `npm run validate:harness`
  - `npm run build`
- Completion criteria:
  - All 10 tasks can be queued for gated/ungated runs or replayed from fixed artifacts.
  - AGB-002 validates scope-limited claims and limitations.
  - AGB-003 validates comparator-failure result table discipline.
  - AGB-004 validates citation support precision.
  - AGB-005 validates figure audit behavior.
  - AGB-006 validates BaselineLock and SingleChangeEnforcer behavior.
  - AGB-007 and AGB-008 validate literature discovery trace, abstention, and exclusion reasons.
  - AGB-009 and AGB-010 validate live execution evidence boundaries.

### P1-8. Paper/System Demo Artifact Bundle Export

- [ ] Status: not started
- Related repo files:
  - Existing: `src/core/publicOutputPublisher.ts`
  - Existing: `src/core/publicArtifacts.ts`
  - Existing: `src/cli/metaHarness.ts`
  - Existing: `src/core/metaHarness/metaHarness.ts`
  - Existing: `src/web/artifacts.ts`
  - Tests: `tests/publicOutputPublisher.test.ts`, `tests/webArtifacts.test.ts`, `tests/metaHarness.test.ts`
- Planned files if needed:
  - `src/core/benchmark/governanceBundleExporter.ts`
  - `tests/governanceBundleExporter.test.ts`
- Validation commands:
  - `npm test -- tests/governanceBundleExporter.test.ts tests/publicOutputPublisher.test.ts tests/webArtifacts.test.ts`
  - `npm run validate:harness`
  - `npm run build`
- Completion criteria:
  - Export bundle includes brief, condition, run config, events, required artifacts, scoring output, unsupported claim notes, and README.
  - Bundle distinguishes workflow completion, `write_paper` completion, PDF build success, and `paper_ready=true`.
  - At least 3 public demo bundles can be selected without editing run-scoped source artifacts.

### P1-9. Runtime And Worker Surfaces

- [ ] Status: not started
- Related repo files:
  - Existing: `.codex/skills/`
  - Existing: `node-prompts/`
  - Existing: `src/cli/args.ts`
  - Existing: `src/cli/main.ts`
  - Existing: `src/core/evaluation/evalHarness.ts`
  - Existing: `src/core/exploration/`
  - Existing: `src/core/nodes/implementExperiments.ts`
  - Existing: `src/core/resultAnalysisPresentation.ts`
  - Existing: `src/core/stateGraph/runtime.ts`
  - Tests: `tests/evalHarness.test.ts`, `tests/resultAnalysisPresentation.test.ts`, `tests/stateGraphRuntime.test.ts`
- Planned files if needed:
  - `src/core/runtime/environmentSnapshot.ts`
  - `src/core/runtime/modelWorkerAdapter.ts`
  - `src/core/evaluation/autonomyMetrics.ts`
  - `tests/environmentSnapshot.test.ts`
  - `tests/modelWorkerAdapter.test.ts`
  - `tests/autonomyMetrics.test.ts`
- Validation commands:
  - `npm test -- tests/evalHarness.test.ts tests/environmentSnapshot.test.ts tests/modelWorkerAdapter.test.ts tests/autonomyMetrics.test.ts tests/resultAnalysisPresentation.test.ts tests/stateGraphRuntime.test.ts`
  - `npm run validate:harness`
  - `npm run build`
- Completion criteria:
  - `implement_experiments` can include a non-blocking environment snapshot in its prompt context without weakening artifact validation.
  - Eval-harness history can be accumulated and surfaced as a fitness signal for prompt/skill evolution without automatically mutating production prompts.
  - `node-prompts/` and local skills have version, gate, and validation metadata where they are treated as runtime contracts.
  - Baseline comparison is visible as a distinct output surface while preserving `BaselineLock` and `SingleChangeEnforcer` enforcement.
  - Failure memory categorizes new failures in priority order: bug, prompt, architecture, hyperparameter.
  - Stage routing handles timeout partials, checkpoint write failures, and stale resume state with inspectable artifacts and safe pause/retry behavior.
  - Optional external or stronger model workers remain under AutoLabOS node contracts, artifact validators, retry policy, rollback policy, and trace-link recording.
  - Run-level autonomy metrics are recorded without replacing evidence-quality gates.

### P1-10. P1 Design And Positioning Reviews

- [ ] Status: not started
- Related repo files:
  - Existing: `docs/architecture.md`
  - Existing: `docs/experiment-quality-bar.md`
  - Existing: `docs/paper-quality-bar.md`
  - Existing: `docs/reproducibility.md`
  - Existing: `src/core/exploration/`
  - Existing: `src/core/metaHarness/`
  - Existing: `src/core/reviewSystem.ts`
- Planned docs if needed:
  - `docs/exploration-strategy-review.md`
  - `docs/differentiation.md`
  - `docs/external-benchmark-plan.md`
  - `docs/ethics-and-responsible-use.md`
  - `docs/long-run-stability-review.md`
  - `docs/domain-agent-plugin-design.md`
  - `docs/artifact-access-design.md`
- Validation commands:
  - Docs-only review: markdown/readability inspection plus portability scan.
  - If harness expectations change: `npm run validate:harness`.
  - If runtime code changes: `npm run build` and targeted `npm test`.
- Completion criteria:
  - StagePolicies evolution, ExplorationManager automation, artifact access permissions, rapid iteration, HITL modes, external benchmark targets, baseline-first support, and differentiation are documented before implementation.
  - External benchmark plans distinguish measurement targets from achieved results and never report placeholder scores as measured performance.
  - Differentiation and ethics documents emphasize enforceable governance, reproducibility, baseline discipline, claim ceilings, responsible use, and human review gates.
  - Any design that affects the governed workflow preserves the fixed top-level workflow contract unless an explicit architecture update is approved.

### P2-1. Whole-Run Evolution Regression Scope

- [x] Status: implemented, keep under regression coverage
- Related repo files:
  - Existing: `src/core/evolution/evolveRun.ts`
  - Existing: `src/cli/args.ts`
  - Existing: `src/cli/main.ts`
  - Tests: `tests/evolveRun.test.ts`, `tests/cliArgs.test.ts`
- Validation commands:
  - `npm test -- tests/evolveRun.test.ts tests/cliArgs.test.ts`
  - `npm run build`
- Completion criteria:
  - Fresh run cycles, `paper_readiness` fitness, `evo-N` tags, `--max-cycles`, target selection, and dry-run behavior stay regression-protected.
  - This item is not reimplemented unless a regression is found.

### P2-2 Through P2-17. Longer-Horizon Design Queue

- [ ] Status: not started
- Scope checklist:
  - [ ] P2-2. Meta-Harness external multi-run loop.
  - [ ] P2-3. Month-long autonomous execution checkpoint/resume review.
  - [ ] P2-4. DeepReviewer-style review backend integration study.
  - [ ] P2-5. StagePolicies autonomous evolution experiment design.
  - [ ] P2-6. ExplorationManager autonomous knowledge-retention design review.
  - [ ] P2-7. Multimodal memory layer review.
  - [ ] P2-8. Node output serialization stability audit.
  - [ ] P2-9. Intermediate artifact capture during experiment implementation and execution.
  - [ ] P2-10. Reverse-from-data research design mode review.
  - [ ] P2-11. ArtifactReactor-style peer-agent coordination review.
  - [ ] P2-12. Distributed experiment ecosystem review.
  - [ ] P2-13. Research World Model or knowledge-graph design review.
  - [ ] P2-14. Zero-cost monitoring mode for long-running experiments.
  - [ ] P2-15. AutoSOTA-style SOTA tracking module review.
  - [ ] P2-16. Strategist/Worker loop separation experiment design.
  - [ ] P2-17. Domain-specific research-agent plugin structure.
- Related repo files:
  - Existing: `docs/architecture.md`
  - Existing: `docs/experiment-quality-bar.md`
  - Existing: `docs/paper-quality-bar.md`
  - Existing: `docs/reproducibility.md`
  - Existing: `src/core/exploration/`
  - Existing: `src/core/metaHarness/`
  - Existing: `src/core/reviewSystem.ts`
- Planned docs if needed:
  - `docs/long-run-stability-review.md`
  - `docs/domain-agent-plugin-design.md`
  - `docs/artifact-access-design.md`
  - `docs/stage-evolution-design.md`
  - `docs/distributed-experiment-ecosystem-review.md`
  - `docs/research-world-model-review.md`
- Validation commands:
  - Docs-only review: markdown/readability inspection plus portability scan.
  - If harness expectations change: `npm run validate:harness`.
  - If runtime code changes: `npm run build` and targeted `npm test`.
- Completion criteria:
  - Each P2 item receives its own design note or an explicit deferral rationale before implementation.
  - Long-run checkpointing, review backend integration, autonomous StagePolicies, knowledge retention, multimodal memory, serialization stability, intermediate artifact capture, reverse-from-data design, peer-agent coordination, distributed experiments, knowledge graphs, zero-cost monitoring, SOTA tracking, strategist/worker separation, and domain-agent plugins remain under existing governance and artifact contracts.
  - Existing whole-run evolution behavior remains regression-protected rather than rebuilt.

## First Implementation Slice

Start with P0-1 through P0-6 before executing benchmark runs. These establish the hardening, input, condition, artifact, and scoring contracts. Then run P0-7 as the contract lock. Only after AGB-001 passes should P1-1 through P1-7 be broadened across AGB-002 through AGB-010. P1-8 through P1-10 and the P2 queue should be implemented incrementally after the P0 hardening slice has validation coverage.

## Validation Policy For Future Edits

- Docs-only checklist edits: no build required; run a markdown/readability inspection.
- TypeScript/runtime edits: `npm run build` plus targeted tests.
- Workflow, harness, artifact, or reproducibility edits: `npm run validate:harness`.
- TUI/web interactive behavior: same-flow live validation in addition to tests when the environment allows.
- Web UI edits: `npm run test:web`.
- Smoke paths: use targeted smoke commands when changing natural command or run execution flows.
