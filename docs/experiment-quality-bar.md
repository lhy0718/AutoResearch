# Experiment and Result Quality Bar

This file defines structural and minimum-semantic quality gates for experiment, result,
and review artifacts.

## 1) Scope
Applies to:
- `run_experiments`
- `analyze_results`
- `review`

Checks here are deterministic where possible and artifact-driven by default.

This document does **not** try to fully score scientific novelty.
It does enforce a minimum boundary between:
- execution completed
- experiment structurally valid
- paper-worthy experimental evidence

## 2) Core distinction
The runtime must explicitly distinguish:
- smoke execution
- toy experiment
- structurally valid experiment
- paper-worthy experiment evidence

A successful run is not automatically paper-worthy evidence.

## 3) Required artifact expectations

### A. `run_experiments` success expectations
When execution is recorded as successful:
- `metrics.json` must exist and be parseable as an object.
- `objective_evaluation.json` should exist.
- `run_manifest.json` should exist and summarize what was run.
- `experiment_portfolio.json` or an equivalent design artifact should exist and describe the planned trial groups.
- At least one concrete run record must exist under the run artifact tree.

### B. `analyze_results` success expectations
When `analyze_results` is completed:
- `result_analysis.json` must exist.
- objective evaluation evidence must exist (`objective_evaluation.json`).
- transition/result recommendation artifacts should exist (`transition_recommendation.json`).
- the analysis must identify the compared systems or settings.
- the analysis must state whether the objective metric improved, worsened, or was inconclusive.
- when a portfolio or supplemental trial structure exists, `result_analysis.json` should expose the trial-group summary rather than flattening everything into one opaque run.
- when a governed brief declares minimum acceptable evidence, `analysis/evidence_scale_assessment.json` must exist and state whether the executed evidence satisfied that floor.

### C. `review` output expectations
When `review` is completed:
- `review/review_packet.json` must exist and contain core sections.
- `review/decision.json` and `review/revision_plan.json` must exist when review packet decisioning is present.
- `review/paper_critique.json` must exist as the pre-draft critique artifact (`stage=pre_draft_review`).
- review output must explicitly state whether the evidence is:
  - `system_validation_only`
  - `toy_experiment_only`
  - `paper_scale_candidate`
  - `blocked_for_paper_scale`

### D. Pre-draft critique as experiment evidence gate
The pre-draft critique (`review/paper_critique.json`) evaluates whether experiment evidence is strong enough to justify manuscript drafting. It assesses:
- Whether experiment results are more than smoke/workflow validation
- Whether at least one baseline or comparator exists
- Whether claims are supportable by the available evidence
- Whether the selected venue style is realistic for the current evidence package

If evidence is insufficient, `review` recommends backtrack to an upstream node rather than allowing progression to `write_paper`.
For brief-governed runs, this includes honoring the brief's paper ceiling and minimum evidence floor instead of treating them as advisory notes.

## 4) Paper-scale experiment minimum gate
For an experiment result to count as paper-scale candidate evidence, all of the following must hold:

1. A task or dataset is clearly identified.
2. An objective metric is clearly identified.
3. At least one baseline or comparator is explicit.
4. At least one executed comparison result exists.
5. The result analysis identifies the direction of change.
6. The experiment output is connected to the stated research question.
7. The run is not merely a smoke test of the workflow itself.
8. The evidence goes beyond a single thin run by including repeated trials/folds/seeds or explicit robustness evidence such as confidence intervals, stability metrics, or effect estimates.

If any of the above is missing, the result may still be valid runtime output,
but it must not be treated as paper-worthy experimental evidence.

## 5) Minimum comparison expectations
The system should prefer experiments that include at least one of:
- method vs baseline
- setting A vs setting B
- ablation on a key component
- constrained vs unconstrained condition
- with-feature vs without-feature comparison

If no comparator exists, `review` should downgrade the paper-readiness state.
If the brief explicitly requires multiple baselines or comparators, design and review should enforce that stronger floor rather than silently accepting a weaker comparison set.

## 6) Result table expectation
A paper-scale candidate should produce a compact structured summary that can be turned into a result table.
At minimum, the result artifacts should preserve:
- system / condition name
- dataset or task
- primary metric
- numeric result
- optional runtime / cost / memory side metrics
- notes on failure or caveats

If numeric comparison cannot be recovered from artifacts, the paper should not claim a quantitative result.

## 7) Failure and negative-result discipline
Negative or null results are allowed.
However, the artifacts must make one of the following explicit:
- baseline matched or outperformed the proposal
- no meaningful improvement was observed
- experimental setup was underpowered or inconclusive
- implementation or data limitations prevented a fair conclusion

Do not silently collapse null or negative results into vague prose.

## 8) Toy/smoke exclusion rule
The following do **not** count as paper-scale evidence by themselves:
- a single smoke run proving the pipeline executes
- internal workflow validation artifacts
- “run finished successfully” without an external task comparison
- trivial examples created only to test code paths
- outputs whose only purpose is harness verification

These may support system validation,
but they must not be elevated into experimental evidence sections of a paper.

## 9) Review-time downgrade rules
`review` should emit `blocked_for_paper_scale` or an equivalent downgrade when any of the following is true:
- no explicit baseline or comparator
- no recoverable quantitative result
- no external task/dataset grounding
- no link from experiment artifacts to the stated research question
- the “experiment” is mostly workflow validation
- the evidence is only a single thin run with no repeated-trial or robustness signal
- result claims exceed what artifacts support
- brief-governed minimum evidence is unmet (for example: required repeat count, baseline count, or uncertainty reporting is missing)

## 10) Why this bar exists
These artifacts are handoff boundaries between nodes.
Missing structure here causes:
- ambiguous runtime state
- weak operator trust
- brittle paper-stage behavior
- inflated claims from underpowered experiments

## 11) Intended strictness
- Strict on structural presence and non-empty required fields.
- Moderately strict on comparator/result traceability.
- Conservative on novelty/scientific significance scoring.
- Very strict about not mislabeling smoke validation as paper evidence.
