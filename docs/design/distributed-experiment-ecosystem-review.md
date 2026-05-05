# Distributed Experiment Ecosystem Review

Status: P2-12 design review.

## Goal

Distributed experiment support would allow multiple workers, machines, or services to execute bounded experiment jobs while preserving the same artifact, reproducibility, and paper-readiness discipline as a local run.

## Boundary

Distributed execution is an implementation detail under `run_experiments`. It must not redefine the governed workflow, weaken baseline-first requirements, or hide failed worker runs behind aggregate success.

## Job Contract

Recommended job artifact:

`run_experiments/distributed_jobs.jsonl`

Each job should include:

- job id
- parent run id
- trial group id
- command or managed runner id
- dataset/task label
- seed
- baseline/comparator role
- environment requirements
- timeout
- expected metrics path

Recommended worker report:

`run_experiments/distributed_worker_reports.jsonl`

Each report should include:

- job id
- worker label
- start and end timestamps
- status
- exit code
- metrics artifact
- log artifact
- environment snapshot
- failure summary

## Aggregation Rules

Aggregate reports must preserve:

- completed jobs
- failed jobs
- skipped jobs
- missing metrics
- per-condition counts
- baseline/comparator coverage
- seed or repeat coverage

An aggregate pass is invalid if failed or missing jobs are omitted from the denominator.

## Claim Ceiling

- Missing baseline jobs block comparative claims.
- Missing metrics block quantitative claims for the affected condition.
- Uneven execution across conditions must be reported as a limitation or blocker.
- Distributed completion does not imply paper readiness without result tables, review, claim-evidence mapping, and figure consistency.

## Failure Conditions

Block distributed promotion if it:

- loses worker provenance
- merges outputs without job identity
- treats stale or retried outputs as fresh without marking them
- omits failed workers from summaries
- mixes incompatible environments without a limitation note

## Validation Plan

Future implementation should add:

1. distributed job/report schema tests
2. aggregation tests that preserve failures
3. baseline/comparator coverage checks across workers
4. reproducibility checks for seeds, environment snapshots, and run manifests
