# Architecture (Harness-Focused)

This document captures the runtime contracts that must remain stable while improving quality enforcement.

## 1) Governed workflow contract

AutoLabOS operates around a governed 9-node research workflow:

`collect_papers -> analyze_papers -> generate_hypotheses -> design_experiments -> implement_experiments -> run_experiments -> analyze_results -> review -> write_paper`

This 9-node structure is the default top-level workflow contract and must remain stable unless an explicit contract change is made.

Do not casually add, remove, reorder, or redefine top-level nodes.

A top-level workflow change is allowed only when all of the following are true:

- the change clearly improves the research/runtime contract rather than duplicating an existing stage
- inspectable state transitions are preserved
- artifact audibility is preserved
- reproducibility is preserved
- review gating and claim-ceiling discipline are preserved
- safe backtracking behavior is preserved
- the change is reflected consistently in docs, runtime behavior, and validation expectations

Until those conditions are met, treat the 9-node workflow as fixed.

## 2) Shared runtime surfaces

- TUI (`autolabos`) and local web ops UI (`autolabos web`) share the same interaction/runtime layer.
- Node execution and transitions are controlled by `StateGraphRuntime`.
- Approval mode and transition recommendation behavior are part of runtime contracts.

Harness and runtime work must preserve both TUI and web behaviors unless a change is explicitly requested.

## 3) Artifact model

- Run-scoped source of truth: `.autolabos/runs/<run-id>/...`
- Public mirrored outputs: `outputs/` (single latest-run public bundle)
- Checkpoints and run context are persisted under each run directory.

Quality checks should be deterministic and file-based whenever possible.

Public-facing outputs must remain traceable to underlying run artifacts.

## 4) Node-internal loops are bounded

Internal control loops inside nodes are allowed and expected, including loops in analysis, design, implementation, execution, result interpretation, and writing.

However, these loops must remain:

- bounded
- auditable through artifacts or logs
- consistent with node purpose
- non-destructive to top-level workflow clarity

Node-internal iteration must not be used to smuggle in an undeclared top-level workflow redesign.

## 5) Review and paper-readiness contract

`review` is a gate, not a cosmetic pass.

The system must not treat workflow completion, `write_paper` completion, or successful PDF generation as equivalent to paper-ready research.

Top-level progression to paper-writing behavior should preserve the distinction between:

- system completion
- artifact completion
- research completion
- paper readiness

A paper-scale outcome requires evidence beyond successful orchestration, including baseline/comparator presence, real experiment execution, quantitative comparison, and claim-to-evidence linkage.

## 6) Research brief contract

A governed run should begin from a research brief that defines the execution contract.

At minimum, the brief structure should align with `docs/research-brief-template.md`, including:

- Topic
- Objective Metric
- Constraints
- Plan
- Research Question
- Why This Can Be Tested With A Small Real Experiment
- Baseline / Comparator
- Dataset / Task / Bench
- Target Comparison
- Minimum Acceptable Evidence
- Disallowed Shortcuts
- Allowed Budgeted Passes
- Paper Ceiling If Evidence Remains Weak
- Minimum Experiment Plan
- Paper-worthiness Gate
- Failure Conditions

Missing governance fields should be treated as execution risks, not harmless omissions.

For brief-governed runs, the brief is not only advisory prose. The runtime should enforce it as a contract:

- `design_experiments` should materialize brief completeness / design consistency artifacts and stop progression on explicit contract gaps.
- `analyze_results` should compare executed evidence against the brief's minimum acceptable evidence and emit a deterministic evidence-scale assessment.
- `review` should treat weak brief-governed evidence as a backtrack condition, not merely a drafting warning.
- `write_paper` should fail fast when pre-draft critique or brief-evidence assessment still classifies the run below paper scale.

## 7) Validation surfaces are first-class

The following are first-class validation surfaces for contract enforcement:

- real TUI validation
- local web validation
- targeted tests
- smoke checks
- harness validation
- artifact inspection
- `/doctor` diagnostics when applicable

For interactive defects, real behavior is the primary ground truth.
Tests and harness checks support but do not replace same-flow revalidation.

## 8) Harness engineering goals

- Turn important quality assumptions into explicit checks.
- Keep checks cheap enough for routine CI.
- Fail early on structural incompleteness such as missing required artifacts or malformed records.
- Keep enforcement incremental and compatible with current contracts.
- Prefer minimal, high-confidence enforcement that improves observability and reproducibility.

## 9) Reproducibility contract

A run should not be treated as trustworthy unless its outputs and transitions can be inspected and rechecked.

When applicable, validation should confirm:

- checkpoint/state consistency
- consistency between public-facing outputs and run-scoped artifacts
- observable behavioral change, not only modified code paths
- explicitly stated remaining validation or reproducibility gaps

## 10) Non-goals for this track

- No redesign of product UX without an explicit product-direction decision.
- No broad refactor of orchestration/runtime without contract justification.
- No speculative replacement of existing node logic.
- No weakening of review gating, evidence discipline, or reproducibility expectations for convenience.
