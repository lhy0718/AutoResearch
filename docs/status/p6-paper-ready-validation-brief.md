# P6 Governed Research Brief

Updated: 2026-05-06

This brief is the frozen P6 full end-to-end live validation contract. The run may produce a paper-scale candidate only if the evidence gates pass. Workflow completion, `write_paper` completion, PDF build success, smoke execution, or fallback output are not paper-ready evidence by themselves.

## Topic

Study how LoRA rank and dropout interact during parameter-efficient small-model multiple-choice adaptation under a fixed local compute budget.

The first P6 run uses a cached, locally runnable small LLM target so the validation focuses on real training, result-table integrity, review gating, and paper-readiness audit rather than on new model access. A 7B-class run is a later scale-up target after preflight is clean.

## Objective Metric

- Primary metric: average accuracy across ARC-Challenge and HellaSwag.
- Secondary metrics: per-task accuracy, train loss, wall-clock runtime, peak VRAM, completed-condition count, failed-run visibility, and claim downgrade correctness.
- Meaningful improvement: at least +1.0 percentage point average accuracy over the baseline with uncertainty reporting that does not clearly contradict the direction of improvement.
- No-signal boundary: maximum condition spread below +0.5 percentage points, or confidence intervals that make the comparison inconclusive.

## Constraints

- Compute budget: dual-RTX-4090-class local workstation; run conditions may use one GPU each and can run in limited parallel when the generated experiment code supports it safely.
- Preferred base model: `Qwen/Qwen2.5-1.5B`.
- Fallback base model: `TinyLlama/TinyLlama-1.1B-Chat-v1.0` if the preferred model fails preflight.
- Scale-up target: a 7B-class model only after the first full P6 run is complete and model/runtime/evaluator preflight is clean.
- Current live-run training data: bounded ARC-Challenge and HellaSwag train examples, separate from validation examples.
- Current live-run evaluation tasks: ARC-Challenge and HellaSwag validation examples.
- Seeds: 42, 43, 44, 45, and 46 for the first repeated-seed run.
- LoRA conditions: rank=8/dropout=0.0 baseline plus rank=16/dropout=0.0, rank=16/dropout=0.05, rank=32/dropout=0.0, and rank=32/dropout=0.05 comparators.
- Baseline condition: rank=8, dropout=0.0.
- Provider/tooling constraints: no API-based judge for the quantitative result; generated code must write parseable metrics and result tables.
- Reproducibility constraints: preserve run id, brief path, model id, dataset id, seed, condition order, command line, environment summary, event trace, failed attempts, and all gate artifacts.
- Forbidden shortcuts: do not fabricate missing metrics, impute failed conditions, hide failed runs, treat fallback or smoke output as training evidence, or claim statistical significance without uncertainty evidence.

## Plan

1. Collect paper-scale related work on LoRA, PEFT hyperparameter sensitivity, instruction tuning, and downstream multiple-choice evaluation.
2. Identify comparator family and baseline convention for LoRA rank/dropout choices.
3. Test the hypothesis that rank and dropout interact under fixed small-model adaptation constraints.
4. Design the repeated-seed LoRA rank/dropout experiment with a locked baseline condition.
5. Implement node-owned experiment code for training, evaluation, metrics writing, failure recording, and result-table export.
6. Run all five repeated-seed primary conditions, preserving failed attempts if any condition fails.
7. Analyze per-task and average accuracy, runtime, VRAM, uncertainty, and failed-condition visibility.
8. Run figure audit and review before drafting.
9. Draft only if review permits; otherwise stop as `research_memo`, `system_validation_note`, or `blocked_for_paper_scale`.
10. Run `autolabos audit --run` on the resulting run artifacts and accept the audit verdict as the final paper-readiness decision.

## Manuscript Format

- columns: 2
- main_body_pages: 6
- references_excluded_from_page_limit: true
- appendices_excluded_from_page_limit: true

## Manuscript Template


## Appendix Preferences

Prefer appendix for:
- hyperparameter_grid
- environment_summary
- per_condition_logs
- bootstrap_details
- failed_run_records
- extended_related_work

Keep in main body:
- research_question
- baseline_and_conditions
- main_result_table
- uncertainty_summary
- claim_evidence_summary
- limitations

## Research Question

Under a fixed small-model adaptation budget, does the LoRA rank x dropout choice measurably affect ARC-Challenge and HellaSwag accuracy, and does any tested condition outperform the rank=8, dropout=0.0 baseline without unacceptable runtime or VRAM cost?

## Why This Can Be Tested With A Small Real Experiment

- Accessible dataset/task: ARC-Challenge and HellaSwag provide standard multiple-choice train/evaluation splits that can be bounded for a first local live run.
- Feasible implementation scope: PEFT LoRA training and evaluation can be implemented in one node-owned experiment package with explicit condition metadata.
- Feasible baseline: rank=8, dropout=0.0 is a common PEFT default-like comparator.
- Realistic run budget: a 1B- to 1.5B-class model keeps the first P6 run inside a local workstation budget while still requiring real model training and evaluation.
- Expected decision rule: if results are complete and uncertainty supports a direction, claims may be scoped to this model/task/budget; otherwise the run is downgraded.

## Baseline / Comparator

- Baseline condition marker: `rank_8_dropout_0_0`, repeated over seeds 42 through 46.
- Why it is relevant: rank=8 and dropout=0.0 are common simple LoRA settings and provide a clear default comparator.
- Expected comparison dimension: ARC-Challenge accuracy, HellaSwag accuracy, average accuracy, train loss, runtime, and peak VRAM.
- Additional comparators: rank=16/dropout=0.0, rank=16/dropout=0.05, rank=32/dropout=0.0, and rank=32/dropout=0.05.

## Dataset / Task / Bench

- Dataset(s): bounded ARC-Challenge and HellaSwag train examples for adaptation; held-out validation examples for evaluation.
- Task type: PEFT language model adaptation evaluated with fixed-prompt multiple-choice accuracy.
- Train/eval protocol: train each LoRA condition independently from the same base model; evaluate after training using the same prompts, seed, and metric parser for all conditions.
- Split or validation discipline: training data is separate from ARC-Challenge and HellaSwag evaluation data; all primary conditions use seeds 42 through 46; uncertainty is computed over repeated seeds and evaluation examples where available.
- Known limitations: one base model family, small bounded train/eval slices, possible sensitivity to prompt format and evaluator implementation.

## Target Comparison

- Proposed condition family: repeated-seed LoRA rank/dropout grid.
- Comparator or baseline name: `rank_8_dropout_0_0`.
- Comparison dimension: average accuracy across ARC-Challenge and HellaSwag, with runtime and peak VRAM as resource side metrics.
- Direction of expected improvement: higher rank may improve adaptation capacity, while small dropout may improve generalization, but the interaction direction is uncertain and may be null.

## Minimum Acceptable Evidence

- All five primary rank/dropout conditions either complete with parseable metrics for seeds 42 through 46 or fail with explicit failure records.
- At least the baseline and one non-baseline condition complete with ARC-Challenge and HellaSwag metrics.
- To claim a scoped improvement, the strongest completed condition must exceed the baseline by at least +1.0 percentage point average accuracy and include uncertainty reporting.
- To call the run `paper_scale_candidate`, all five primary conditions should complete and the result table should include uncertainty or robustness evidence.
- To consider `conditionally-ready`, repeat runs or an equivalent robustness signal must support the strongest comparison and all review/audit blockers must be clear.
- If fewer than the declared five primary conditions complete, the ceiling is `research_memo` or `system_validation_note`.

## Disallowed Shortcuts

- Do not skip the baseline condition.
- Do not substitute deterministic fallback rows for trained model evidence.
- Do not report only favorable conditions while hiding failed or null results.
- Do not interpolate missing ARC-Challenge or HellaSwag metrics.
- Do not treat train loss as a proxy for downstream accuracy.
- Do not claim statistical significance without uncertainty evidence.
- Do not treat workflow smoke artifacts, syntax checks, or PDF generation as paper evidence.
- Do not promote the result to paper-ready if review or audit reports unresolved blockers.

## Allowed Budgeted Passes

- One preflight pass for model, dataset, evaluator, CUDA, writable workspace, provider mode, and TTY support.
- One optional retry for a condition that fails due to transient environment issues, with the failed attempt preserved.
- Repeat runs for the baseline and strongest condition when runtime allows.
- One post-run audit pass with `autolabos audit --run`.
- No unbounded hyperparameter search beyond the declared grid unless the run is explicitly re-scoped.

## Paper Ceiling If Evidence Remains Weak

- If all declared repeated-seed conditions complete but uncertainty does not support a clear direction, cap at `research_memo` with a scoped null or inconclusive result.
- If some primary conditions fail but failures are visible and at least one baseline/comparator comparison exists, cap at `research_memo` or `system_validation_note`.
- If only fallback, smoke, syntax, or partial evidence exists, cap at `blocked_for_paper_scale`.
- If baseline/comparator metrics or result tables are missing, paper-ready is blocked.
- If figure/result/caption mismatch, unsupported citations, hidden failed runs, or unsupported claims remain, manuscript promotion is blocked.

## Minimum Experiment Plan

- Five complete baseline runs: rank=8, dropout=0.0, seeds 42 through 46.
- Twenty additional primary comparator runs from the declared grid.
- One result table with model, rank, dropout, seed, task, accuracy, average accuracy, train loss, runtime, peak VRAM, status, and failure note.
- One uncertainty summary over evaluation examples.
- One limitations note covering model scale, subset size, prompt/evaluator sensitivity, seed count, and compute budget.
- One claim-to-evidence mapping from every quantitative or comparative claim to concrete metrics artifacts.
- One audit report over the final run artifacts.

## Paper-worthiness Gate

- Is the research question explicit? Yes.
- Is the related work sufficient to position the study? Required before `review` can advance.
- Is there at least one explicit baseline? Yes, rank=8/dropout=0.0.
- Is there at least one real executed experiment? Required; smoke/fallback does not count.
- Is there at least one quantitative comparison? Required between baseline and at least one non-baseline condition.
- Can major claims be traced to evidence? Required through metrics, result table, evidence links, and audit output.
- Are limitations stated? Required.

If any answer is no, downgrade to `system_validation_note`, `research_memo`, or `blocked_for_paper_scale`.

## Failure Conditions

- Preferred and fallback cached models both fail preflight.
- Evaluation data cannot be loaded or parsed.
- Baseline condition cannot produce ARC-Challenge and HellaSwag metrics.
- The generated experiment code cannot write parseable `metrics.json`, result table, and failure records.
- Three or more primary conditions fail from non-transient implementation/runtime errors.
- `review` or `autolabos audit --run` reports unresolved paper-readiness blockers.
- The run hides failed attempts, substitutes fallback evidence, or claims paper-ready from incomplete evidence.

## Notes

- This run is a P6 validation target for AutoLabOS, not a claim that this topic will necessarily produce a publishable scientific result.
- A negative or null result is acceptable if the artifacts are complete and the claims remain scoped.
- The strongest acceptable product signal is that AutoLabOS preserves the difference between real paper-scale evidence, a research memo, and a blocked run.

## Questions / Risks

- The external evaluation harness may need installation or replacement with a node-owned local evaluator.
- The preferred cached model may require task-specific prompt formatting adjustments.
- Full factorial execution may expose PEFT runner generation or second-stage execution defects.
- A single seed may be insufficient for paper-ready status even if the first result table is complete.
- Runtime may require reducing the training subset or adding staged execution while preserving the declared evidence ceiling.
