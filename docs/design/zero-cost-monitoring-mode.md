# Zero-Cost Monitoring Mode

Status: P2-14 design review.

## Goal

Zero-cost monitoring observes an existing run without starting expensive execution, model calls, dataset downloads, or external compute. It helps operators inspect long-running or paused work while preserving budget and reproducibility boundaries.

## Boundary

Monitoring is observational. It must not execute experiment commands, mutate workflow state, advance nodes, retry failures, or mark outputs complete.

## Allowed Actions

- read run-scoped status artifacts
- inspect checkpoint freshness
- inspect log tails when logs are already present
- summarize verifier reports
- detect stale public projections
- emit a monitoring report

## Disallowed Actions

- starting or retrying experiment jobs
- calling LLM providers
- downloading datasets or papers
- rewriting node outputs
- changing `currentNode` or node status
- converting missing artifacts into success placeholders

## Recommended Artifact

`monitoring/zero_cost_monitor_report.json`

Fields:

- run_id
- inspected_at
- inspected_artifacts
- freshness
- active_process_hint
- stale_projection_findings
- missing_expected_artifacts
- failed_run_visibility
- recommended_operator_actions
- mutation_performed: always `false`

## Claim Ceiling

Monitoring output is operational evidence only. It may support statements about artifact presence, freshness, or inconsistency, but it cannot support scientific result claims or paper-readiness promotion.

## Failure Conditions

Block the mode if it:

- performs nonzero-cost work while claiming zero cost
- advances workflow state
- hides stale or failed artifacts
- rewrites public output to look current
- treats monitoring freshness as research progress

## Validation Plan

Future implementation should add:

1. tests proving no node state advances in monitoring mode
2. provider-call and command-execution guards
3. stale projection detection tests
4. audit integration for hidden failure and stale output findings
