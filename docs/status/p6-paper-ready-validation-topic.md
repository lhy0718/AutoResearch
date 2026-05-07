# P6 Paper-Ready Full E2E Validation Topic Decision

Updated: 2026-05-06

## Decision

Freeze the P6 full end-to-end validation topic as:

> PEFT LoRA rank x dropout interaction under a fixed small-model multiple-choice adaptation budget.

The first full live validation run should use a cached, locally runnable small LLM target instead of making the run depend on a new gated or uncached model download.

## Preferred Validation Brief

- Broad topic: LoRA rank and dropout interaction in small-model PEFT adaptation.
- Research question: Under a fixed data, training, and evaluation budget, does the LoRA rank x dropout choice measurably affect downstream multiple-choice accuracy and training efficiency?
- Current hypothesis: Higher rank is not automatically better under a constrained adaptation budget; small dropout may moderate overfitting at higher rank.
- Preferred base model for the first P6 run: `Qwen/Qwen2.5-1.5B`.
- Fallback base model if the preferred cached model fails preflight: `TinyLlama/TinyLlama-1.1B-Chat-v1.0`.
- Scale-up target after the first successful full run: a 7B-class model, only after model access, dependencies, runtime, and evaluator preflight are clean.

## Experimental Contract

- Current live-run training data: bounded ARC-Challenge and HellaSwag train examples, separate from validation examples.
- Current live-run evaluation tasks: ARC-Challenge and HellaSwag validation examples.
- Primary metric: average accuracy across ARC-Challenge and HellaSwag.
- Secondary metrics: train loss, wall-clock runtime, peak VRAM, failed-run visibility.
- Baseline: rank=8, dropout=0.0.
- Current live-run conditions: rank=8/dropout=0.0 baseline plus rank=16/dropout=0.0, rank=16/dropout=0.05, rank=32/dropout=0.0, and rank=32/dropout=0.05 comparators.
- Current live-run robustness signal: five seeds per condition, seeds 42 through 46.
- Scale-up candidate: add rank=4 and larger evaluation slices only after the current run clears analyze/review/audit gates.
- Result table minimum columns: model, rank, dropout, seed, task, accuracy, average accuracy, train loss, runtime, peak VRAM, status, failure note.

## Why This Topic

- It is a real experiment, not a governance seed replay.
- It has an explicit baseline and multiple comparators.
- It naturally produces a compact quantitative result table.
- It directly exercises `implement_experiments`, `run_experiments`, `analyze_results`, `figure_audit`, `review`, `write_paper`, and `autolabos audit --run`.
- It keeps the paper-readiness gate honest: null or negative results can still become a valid research memo, while incomplete or fallback-only evidence must not become paper-ready.
- It is close to known live-validation risk around PEFT runners, so failures are useful product evidence rather than wasted work.
- It matches the audit-first strategy: AutoLabOS should prove that baseline/comparator, result-table completeness, failed-run visibility, and claim ceiling can govern a real AI-generated research run before it claims paper readiness.

## Machine-Fit Rationale

The first P6 run should be sized for the current local workstation: dual RTX 4090 GPUs with roughly 24 GB VRAM each, 125 GiB system memory, and an Intel i9-14900K-class CPU. The current run confirmed CUDA visibility, local Qwen/Qwen2.5-1.5B cache availability, and a working PEFT/Transformers/Datasets stack.

This makes a cached 1B- to 1.5B-class model the right first full-run target. It lowers external setup risk while preserving the evidence contract: real training, explicit baseline, comparator rows, repeated seeds, quantitative metrics, limitations, and post-run audit.

## Current Live Evidence

The active P6 run `2dcc480e-b4e5-4863-9c7f-6872f9c672e7` completed `run_experiments` for the frozen topic on 2026-05-06 and reached the final audit gate on 2026-05-07.

- Model: `Qwen/Qwen2.5-1.5B`, resolved from local cache.
- Conditions: 5 condition markers x 5 seeds = 25 required runs.
- Completed runs: 25/25.
- Failed runs: 0.
- Primary delta: `accuracy_delta_vs_baseline=0.04479166666666667`.
- Best non-baseline condition by mean delta: rank=32/dropout=0.05, with mean average accuracy 0.5083 versus baseline 0.4417.
- Mean peak VRAM stayed near 5 GB for the largest condition, so the topic fits the current machine with room for guarded follow-up analysis.
- `figure_audit` completed with no severe figure/result/caption mismatch.
- `review` downgraded the output to `paper_scale_candidate`.
- `write_paper` generated manuscript artifacts but failed the manuscript-quality gate after bounded repair.
- `autolabos audit --run` returned `blocked` with a `needs_repair_before_manuscript_promotion` ceiling.
- Final audit result-table status: measured, 6/6 complete rows.
- Final audit after the readiness-artifact repair reports only `write_paper_failed` as the remaining blocker; the governance artifact contract now passes because `paper/paper_readiness.json` is emitted even for the stopped manuscript-quality path.
- Follow-up offline replay and same-flow live rerun now classify the run as an LM benchmark and find the scientific-writing method/results/related/discussion checks complete under that protocol.
- The follow-up final audit remains `blocked` after the LM benchmark validator repair, with top blockers `unsupported_claims_present` and `write_paper_failed`.
- The follow-up manuscript-materialization repair removes the unsupported-claim audit blocker by grounding reader-facing Method/Results prose in run-owned metrics and sanitizing repeated placeholder wording; the latest final audit remains `blocked` with top blocker `write_paper_failed`.

This is enough to keep the topic fixed as the first full-run validation topic. It is not enough to call the output paper-ready; the final audit requires the manuscript-quality gate blocker to be repaired before manuscript promotion is allowed.

## Paper Ceiling

- If all current repeated-seed conditions complete and uncertainty reporting is available, the run may be considered at most `paper_scale_candidate` before review.
- If repeat runs or uncertainty evidence support the strongest comparison and the review/audit gates find no blockers, the run may be considered for `conditionally-ready`.
- If fewer than the declared primary conditions complete, cap at `system_validation_note` or `research_memo`.
- If only fallback, smoke, or partial evidence exists, cap at `blocked_for_paper_scale`.
- If the strongest comparison is null or negative but artifacts are complete, report a scoped negative result rather than inflating the claim.

## Immediate P6 Follow-Up

1. Repair the remaining manuscript-quality findings: citation hygiene, result/visual completeness, and visual redundancy.
2. Rerun `write_paper -> autolabos audit --run` in the same governed flow, keeping the manuscript ceiling at `paper_scale_candidate` or lower unless the live audit removes all blockers without broadening claims beyond the evidence.
3. Treat any successful PDF or generated TeX as insufficient for `paper_ready` until the manuscript-quality gate and audit both pass.
