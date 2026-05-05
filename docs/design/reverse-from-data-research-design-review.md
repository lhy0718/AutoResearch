# Reverse-From-Data Research Design Review

Status: P2-10 design review.

## Goal

Reverse-from-data mode starts from existing artifacts, datasets, logs, or preliminary results and proposes research questions, hypotheses, and execution briefs that can be tested honestly. It is useful for salvaging real observations without pretending they were prospective evidence.

## Boundary

This mode must remain inside the governed workflow. It does not replace `generate_hypotheses`, `design_experiments`, `review`, or `write_paper`, and it must not turn exploratory observations into confirmatory claims by wording alone.

## Allowed Inputs

- run-scoped metrics and result tables
- failed-run logs and verifier reports
- external dataset summaries with explicit source labels
- prior experiment portfolios
- operator-provided observations
- audit reports and blocker summaries

Inputs should be copied, summarized, or referenced through portable labels. Machine-local paths and private note locations are not part of the public contract.

## Required Output Contract

Recommended artifact:

`design_experiments/reverse_from_data_design.json`

Fields:

- mode: `reverse_from_data`
- source_artifacts
- observed_patterns
- candidate_research_questions
- candidate_hypotheses
- required_prospective_validation
- baseline_or_comparator_requirements
- disallowed_claims
- paper_ceiling_before_validation
- next_brief_patch

## Claim Ceiling

Reverse-from-data output is exploratory by default.

- If the same data generated the hypothesis and supports the claim, mark the claim as hypothesis-generating only.
- If no independent validation or held-out condition exists, block confirmatory language.
- If no comparator exists, block comparative claims.
- If result tables are incomplete, block quantitative paper-ready claims.
- If failed runs motivated the hypothesis, preserve them as visible context rather than filtering them out.

## Review Gate Interaction

`review` should treat reverse-from-data designs as higher risk for hindsight bias. A run can advance toward paper-scale only after the design records a prospective validation plan and execution artifacts show that the validation actually happened.

## Failure Conditions

Block or downgrade the mode if it:

- selects only favorable observations while hiding failures
- labels exploratory analysis as confirmatory
- proposes a hypothesis without a falsifiable validation condition
- omits a baseline/comparator when making improvement claims
- uses private or machine-local paths as the source of truth
- lets a generated story substitute for executed evidence

## Validation Plan

Future runtime support should add:

1. schema tests for `reverse_from_data_design.json`
2. audit checks that exploratory-origin claims stay downgraded until validated
3. regression cases where a result-first hypothesis cannot become `paper_ready` without a new validation run
4. portability scans for copied source labels
