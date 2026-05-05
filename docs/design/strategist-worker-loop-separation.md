# Strategist Worker Loop Separation

Status: P2-16 design review.

## Goal

Strategist/Worker separation splits planning from execution. Strategists propose bounded next actions and evaluation criteria. Workers execute within a narrow write scope and report artifacts. The separation should reduce hidden state and over-broad autonomous changes.

## Boundary

This is an internal coordination pattern. It must not add top-level workflow nodes or let planning output substitute for executed evidence.

## Strategist Contract

Recommended artifact:

`coordination/strategist_plan.json`

Fields:

- run_id
- current_node
- inspected_artifacts
- proposed_tasks
- expected evidence
- risk controls
- disallowed shortcuts
- stop conditions

Strategists may propose tasks but should not directly mutate experiment outputs.

## Worker Contract

Recommended artifact:

`coordination/worker_report.json`

Fields:

- task id
- write scope
- files changed
- commands run
- artifacts produced
- validation result
- failures
- handoff notes

Workers should not broaden their own task scope without a new strategist or operator decision.

## Gate Interaction

- Review and audit gates remain authoritative.
- Worker success does not imply research success.
- Strategist confidence does not imply evidence strength.
- Failed worker attempts remain visible.

## Failure Conditions

Block the loop if it:

- allows strategy to edit evidence artifacts without execution
- hides worker failures
- merges multiple unrelated interventions into one worker task
- lets planner approval bypass baseline, result-table, or claim-evidence requirements
- loses the mapping from task to produced artifact

## Validation Plan

Future implementation should add:

1. strategist and worker schema tests
2. write-scope checks
3. failure preservation tests
4. audit checks that planner claims are not treated as evidence
