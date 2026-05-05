# Research World Model Knowledge-Graph Review

Status: P2-13 design review.

## Goal

A research world model or knowledge graph can help AutoLabOS remember relationships among papers, claims, datasets, methods, artifacts, failures, and review decisions. Its purpose is navigation and traceability, not evidence creation.

## Boundary

The graph is a memory/index layer. It must remain subordinate to run-scoped artifacts, validators, review gates, audit reports, and claim-evidence tables.

## Recommended Artifact

`memory/research_world_model.json`

Minimum fields:

- version
- run_id
- nodes
- edges
- source_artifacts
- generated_at
- stale_references

Recommended node types:

- paper
- claim
- dataset
- metric
- method
- baseline
- comparator
- experiment
- result
- figure
- review_finding
- limitation
- failure

Recommended edge types:

- cites
- supports
- contradicts
- evaluates_on
- compares_against
- produced_by
- blocked_by
- downgraded_by
- visualizes
- derived_from

## Provenance Rules

Every graph node and edge that could influence a claim must link to a source artifact, citation, or review finding. Unprovenanced graph facts should be marked as hints and must not support paper-ready claims.

## Claim Ceiling

- A graph edge saying a claim is supported is not support by itself.
- Graph summaries must not override missing result tables, citations, baselines, or figure audits.
- Stale graph references should downgrade confidence and trigger reinspection.
- Private notes and machine-local paths must not become graph source identifiers in committed artifacts.

## Failure Conditions

Block graph use for readiness if it:

- stores claims without source artifacts
- collapses disagreement into a single unsupported truth
- drops failed runs or limitations
- treats retrieved memory as current evidence
- references private or local-only sources as canonical

## Validation Plan

Future implementation should add:

1. graph schema tests
2. source-artifact link checks
3. stale-reference detection
4. audit integration that reports unprovenanced claim-support edges
