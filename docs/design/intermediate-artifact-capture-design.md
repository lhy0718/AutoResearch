# Intermediate Artifact Capture Design

Status: implemented as the P2-9 bounded slice.

## Goal

`implement_experiments` and `run_experiments` can produce useful partial evidence before a full paper-scale result exists. The capture layer records those intermediate artifacts as auditable run-scoped facts without upgrading them into paper-ready evidence.

## Implemented Scope

- `src/core/artifacts/intermediateArtifactCapture.ts` builds a manifest for intermediate files.
- `implement_experiments` now writes `implement_experiments/intermediate_artifacts.json` during finalize for task specs, implementation results, verification reports, attempts, progress logs, scripts, and metrics pointers.
- `run_experiments` now writes `run_experiments/intermediate_artifacts.json` whenever it writes `run_experiments_verify_report.json`.
- The public experiment output also receives `implement_experiments_intermediate_artifacts.json` and `run_experiments_intermediate_artifacts.json`.
- The manifest records artifact role, requiredness, presence, parse status, byte size, and a claim-ceiling note.

## Claim Ceiling

Intermediate artifacts are diagnostic by default. They do not justify comparative, quantitative, or paper-ready claims unless later nodes link them to run-scoped metrics, result tables, review gates, and paper-readiness audits.

## Portability

Run-relative paths are normalized under the run directory. External paths are redacted as `<external-artifact>` so committed examples and public outputs do not expose machine-local locations.

## Remaining Extension Point

Per-attempt snapshots can be added to the manifest once they have a stable public naming contract. The current slice records the final attempt set and core intermediate files without expanding the workflow surface.
