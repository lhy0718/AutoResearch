# P6 Live Validation Record

Updated: 2026-05-07

## Active Run

- Run id: `2dcc480e-b4e5-4863-9c7f-6872f9c672e7`
- Validation workspace: `<validation-workspace>/p6-paper-ready-live`
- Brief: `briefs/p6-paper-ready-validation-brief.md`
- Current node: `write_paper`
- Current state: failed at `write_paper` after manuscript artifacts were generated but the manuscript-quality gate stopped bounded repair

## Fresh Session Result

`npm run p6:start-live` started the run from the frozen P6 brief after running the TUI `/doctor` surface. Earlier validation workspace evidence from a prior run was invalidated by a test cleanup issue and is no longer used as P6 evidence.

Observed result:

- A fresh validation run was created.
- The run used the frozen P6 LoRA rank/dropout brief snapshot.
- The run produced inspectable workflow state, events, checkpoints, and node artifacts.
- The run advanced through the governed workflow to `run_experiments`.

## Resumed Session Result

Continuation used the P6 helper against the persisted run id.

Observed result:

- Resumed-session state projected the same persisted run instead of starting a new run.
- The helper advanced through multiple gated nodes after approval.
- Several same-flow live-validation defects were reproduced, recorded in `ISSUES.md`, repaired, and revalidated against this same run.
- The latest continuation approved `review`, ran `write_paper`, revalidated the LV-372/LV-373 fixes, and stopped with an explicit manuscript-quality gate failure instead of promoting the manuscript.

## Current Artifact Evidence

The run currently includes:

- brief snapshot
- `run_record.json`
- `events.jsonl`
- node checkpoints through `run_experiments`
- collected literature and analysis artifacts from earlier nodes
- generated experiment package under `outputs/lora-rank-dropout-interaction-in-budget-constrai-2dcc480e/experiment`
- `run_lora_rank_dropout_study.py`
- `metrics.json`
- `run_experiments_verify_report.json`
- `result_analysis.json`
- `result_table.json`
- `result_analysis_synthesis.json`
- `transition_recommendation.json`
- `figure_audit/figure_audit_summary.json`
- `review/paper_critique.json`
- `review/decision.json`
- `review/readiness_risks.json`
- `paper/main.tex`
- `paper/references.bib`
- `paper/session_trace.json`
- `paper/manuscript_quality_gate.json`
- `paper/manuscript_quality_failure.json`
- `paper/claim_evidence_table.json`
- `paper/evidence_links.json`
- `paper/readiness_risks.json`
- `study_summary.json`
- `condition_summary.json`
- `per_seed_results.jsonl`
- `study_results.csv`
- final audit outputs under `<repo-root>/outputs/audit/p6-live-2dcc480e-final/`
- per-condition and per-seed training/evaluation evidence

## Current Experiment Evidence

- Model: `Qwen/Qwen2.5-1.5B`, resolved from local cache.
- Hardware observed by the runner: 2 CUDA devices, both RTX 4090-class GPUs with roughly 24 GB VRAM each.
- Training/evaluation data: bounded ARC-Challenge and HellaSwag examples, marked non-synthetic by the generated runner.
- Conditions: 5 LoRA rank/dropout conditions x 5 seeds.
- Required runs: 25.
- Completed runs: 25.
- Failed runs: 0.
- Objective metric: `accuracy_delta_vs_baseline=0.04479166666666667`.
- Best non-baseline mean result in the completed table: rank=32/dropout=0.05, mean average accuracy 0.5083 versus baseline 0.4417.
- Run verifier status: pass.
- Result analysis status: pass for result-table handoff.
- Result table comparator: `rank_32_dropout_0_05` versus baseline `rank_8_dropout_0_0`.
- Headline result-table metric: `accuracy_delta_vs_baseline_mean`, baseline 0, comparator 0.066667, delta 0.0667.
- Result analysis trial count: 25 total / 25 executed / 0 cached.
- Figure audit status: completed with 0 severe mismatches, 1 warning for an empty figure directory, and no review block required.
- Review status: completed with manuscript state `paper_scale_candidate`, `paper_ready=false`, 1 paper-readiness blocker for narrow method scope, and a transition that allows drafting only under the downgraded claim ceiling.
- `write_paper` status: failed after three attempts, with manuscript artifacts generated but not accepted because the manuscript-quality gate stopped bounded repair.
- Final `autolabos audit --run` verdict: `blocked`.
- Final audit claim ceiling: `needs_repair_before_manuscript_promotion`.
- Final audit baseline/comparator status: present; comparative claims are not blocked by missing baseline/comparator evidence.
- Final audit result-table status: measured, 6/6 complete rows; paper-ready is not blocked by result-table completeness.
- Final audit figure status: warn, with 0 severe figure/result/caption mismatches.
- Final audit blockers after the readiness-artifact repair: `write_paper_failed`.
- Final audit outputs after the readiness-artifact repair: `<repo-root>/outputs/audit/p6-live-2dcc480e-after-readiness-artifact/`.
- Follow-up scientific-validator replay: the persisted P6 artifacts now classify as `lm_benchmark`; offline replay reports `method`, `results`, `related`, and `discussion` complete under that protocol.
- Follow-up live revalidation status: not complete. The attempted same-flow `write_paper` continuation did not emit new artifacts and appeared to attach to stale persisted `write_paper: running` state.

## Regression Validation

- `npm run build`: pass on 2026-05-07 after the final P6 code and documentation changes.
- `npm test`: pass on 2026-05-07 with 179 root test files / 1857 tests and 1 web test file / 14 tests.
- `npm run validate:harness`: pass on 2026-05-07 with 308 issue entries checked and no structural violations.
- `npm test -- tests/scientificWriting.test.ts -t "LM benchmark evidence"`: pass on 2026-05-07 after adding the LM benchmark/no-`latest_results.json` regression.
- `npm test -- tests/writePaperPdfBuild.test.ts -t "stops after visual repair"`: pass on 2026-05-07 after adding the failed-`write_paper` readiness-artifact regression.
- P6 targeted regressions were run for the continuation helper, manuscript-quality appendix repair scope, objective metric/result-table handling, and generated-runner argparse/verification repairs.
- Portability scan over the edited public docs/scripts found no new local validation workspace or Vault path leaks; the remaining `/tmp` matches are code-level safety checks in `src/core/agents/implementSessionManager.ts`.

## Current Limitation

The run is not paper-ready. It has real repeated-seed quantitative evidence, a complete audit-visible result table, figure audit, review artifacts, manuscript artifacts, `paper/paper_readiness.json`, and a final audit report, but `write_paper` failed the manuscript-quality gate after bounded repair. Follow-up offline replay shows the scientific-writing validator no longer blocks this run on tabular-CV-only requirements, but the same-flow live `write_paper -> audit` rerun still has to recover from the stale running state before manuscript promotion can be reconsidered.

## Next Action

Recover or safely reset the stale `write_paper: running` continuation boundary, rerun the gated `write_paper -> audit` path, and keep the claim ceiling at `paper_scale_candidate` or lower unless the live audit removes all blockers.
