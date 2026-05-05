# AutoSOTA Tracking Module Review

Status: P2-15 design review.

## Goal

An AutoSOTA-style module would track relevant baselines, comparator families, benchmark tasks, and reported metrics so research briefs and reviews can avoid shallow positioning.

## Boundary

SOTA tracking is a related-work and comparator discovery aid. It must not claim that a result is current SOTA unless the evidence source, retrieval time, benchmark definition, and metric comparability are explicit.

## Recommended Artifact

`related_work/sota_tracking_snapshot.json`

Fields:

- topic
- benchmark_or_task
- metric
- retrieved_at
- sources
- comparator_candidates
- reported_results
- comparability_notes
- freshness_limitations
- recommended_baselines
- unsupported_sota_claims

## Evidence Rules

- Every tracked result needs a citation or source artifact.
- Metric definitions must match before numeric comparison.
- Dataset splits and evaluation settings must be recorded when available.
- Abstract-only or metadata-only sources should be marked weak.
- Stale snapshots should trigger a freshness warning, not a silent SOTA claim.

## Claim Ceiling

- No source support means no related-work claim.
- Metric mismatch blocks ranking claims.
- Missing benchmark definition blocks SOTA claims.
- Stale or incomplete retrieval downgrades to comparator-discovery language.
- AutoLabOS experiment results still need executed baselines and result tables before comparison.

## Failure Conditions

Block SOTA tracking output if it:

- ranks methods with incomparable metrics
- omits source citations
- labels a snapshot as current without retrieval metadata
- uses paper titles alone as evidence
- lets a tracking snapshot substitute for running a baseline

## Validation Plan

Future implementation should add:

1. snapshot schema tests
2. citation/source presence checks
3. metric comparability checks
4. audit warnings for unsupported SOTA and improvement claims
