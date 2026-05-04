# Node Output Serialization Stability Audit

This note defines the P2-8 design audit for node output serialization stability. It is not a runtime implementation claim and does not report new measured reliability.

Serialization stability means node outputs remain parseable, portable, traceable, and semantically stable across fresh runs, resume/reload, harness validation, public output publishing, and audit reports.

## Boundary

The governed top-level workflow remains fixed:

`collect_papers -> analyze_papers -> generate_hypotheses -> design_experiments -> implement_experiments -> run_experiments -> analyze_results -> figure_audit -> review -> write_paper`

Serialization rules must not add workflow nodes, weaken artifact gates, replace review, or let malformed outputs count as evidence.

The source of truth remains run-scoped artifacts under `.autolabos/runs/<run-id>/`. Hot-path indexes, public outputs, reports, and memory sidecars are projections unless their contract explicitly says otherwise.

## Current Critical Surfaces

Serialization stability applies to:

- `runs.json`
- `runs.sqlite` metadata mirrors when present
- `run_record.json`
- `events.jsonl`
- `checkpoints/latest.json`
- numbered checkpoint files
- `run_status.json`
- `run_completeness_checklist.json`
- `collect_result.json`
- `paper_summaries.jsonl`
- `corpus.jsonl`
- `hypotheses.jsonl`
- `experiment_portfolio.json`
- `run_manifest.json`
- `metrics.json`
- `objective_evaluation.json`
- `result_table.json`
- `result_analysis.json`
- `transition_recommendation.json`
- `figure_audit/figure_audit_summary.json`
- `review/*`
- `paper/*`
- future memory sidecars such as `experiment_tree/knowledge_retention.json` and `memory/multimodal_memory.json`

## Serialization Rules

Node outputs should follow these rules:

- JSON artifacts are UTF-8, parseable, newline-terminated, and object or array shaped according to their contract.
- JSONL artifacts are UTF-8, newline-delimited, and every non-empty line is parseable JSON.
- Atomic writes are preferred for run-scoped artifacts so partial files do not become persisted truth.
- Paths inside artifacts are repo-relative, run-relative, or explicit portable placeholders.
- Timestamps are ISO-8601 strings with timezone information, preferably UTC.
- Numeric metrics are finite numbers. `NaN`, `Infinity`, and stringified numeric sentinels are not valid metric evidence.
- Missing optional values should be absent or `null` by contract; the same field should not alternate between incompatible shapes.
- Arrays preserve stable item identity through explicit ids when order matters.
- Status fields use bounded vocabularies rather than free-form prose when they drive gates.
- Public-output copies preserve provenance back to run-scoped source artifacts.

## Null And Missing Semantics

Future schemas should distinguish:

- field absent: producer version did not emit the field
- `null`: producer measured or considered the field but no value exists
- empty array: producer measured and found no items
- empty object: producer emitted a structured placeholder with no entries
- `"unknown"`: explicit epistemic state only when a bounded vocabulary allows it

This distinction matters for result tables, review decisions, paper-readiness gates, figure audit summaries, and audit reports.

## Path Stability

Stored paths should be stable under:

- repo relocation
- validation workspace relocation
- public bundle export
- resume/reload from `.autolabos/runs/<run-id>/`
- audit report generation

Disallowed in committed contracts:

- machine-local absolute paths
- temporary validation paths
- private reference roots
- external note locations
- provider cache paths as evidence

When a local absolute path is unavoidable at runtime, a public or committed artifact should also store a safe label or run-relative source path.

## Stale State And Projection Rules

When multiple surfaces summarize the same run, the latest checkpointed run state must remain inspectable.

Required consistency checks:

- `runs.json` should not claim a later node than the latest checkpoint supports.
- `run_record.json` should not contradict checkpoint status.
- `checkpoints/latest.json` should point to an existing numbered checkpoint.
- public outputs should not claim stronger readiness than run-scoped artifacts.
- audit summaries should not hide failed runs or missing evidence.
- memory sidecars should downgrade stale references rather than silently dropping them.

If a projection is stale, it should be repaired, marked stale, or excluded from readiness claims.

## Node Output Risk Classes

Recommended audit classes:

- `malformed_json`: file is not parseable
- `malformed_jsonl`: one or more non-empty JSONL lines are not parseable
- `shape_drift`: field shape changed incompatibly
- `path_escape`: artifact references a non-portable path
- `non_finite_metric`: metric contains `NaN` or infinity
- `status_vocab_drift`: gate-driving status is outside the allowed vocabulary
- `stale_projection`: projected status contradicts source artifacts
- `missing_provenance`: public or paper output lacks source artifact trace
- `hidden_failure`: failed run state is absent from summary or audit output

These classes should map to harness or audit findings before they are treated as paper-readiness evidence.

## Claim Ceiling Interaction

Serialization errors lower claim ceilings.

Examples:

- malformed result table: paper-ready blocked
- non-finite metric: quantitative claim blocked
- stale public output: readiness claim downgraded to run-inspection required
- missing provenance: claim-evidence support incomplete
- malformed figure audit: manuscript promotion blocked or requires review
- hidden failed run: blocked

`write_paper` completion or PDF build success cannot compensate for serialization instability in required evidence artifacts.

## Audit Report Interaction

`autolabos audit` should treat serialization stability as a prerequisite for evidence interpretation.

Future audit integration may add:

- parseability blockers
- stale projection blockers
- non-portable path warnings
- non-finite metric blockers
- status vocabulary warnings
- provenance gap summaries

Audit may summarize serialization findings, but it should continue to derive verdicts from artifact-level contracts, result tables, claim evidence, figure audit, review gates, paper readiness, and failed-run visibility.

## Validation Plan

Before runtime implementation:

1. Inventory required JSON and JSONL artifact schemas by node.
2. Add schema or shape tests for high-risk artifacts.
3. Add non-finite metric tests for result and metrics artifacts.
4. Add path portability tests for public-output and audit artifacts.
5. Add stale projection tests across `runs.json`, `run_record.json`, and checkpoints.
6. Add audit tests proving malformed required evidence blocks paper readiness.
7. Run `npm test -- tests/harnessValidators.test.ts tests/harnessValidationService.test.ts tests/nodeArtifactHelpers.test.ts tests/paperReadinessAudit.test.ts`.
8. Run `npm run validate:harness` and `npm run build` if runtime code changes.

## Completion Criteria For A Future Implementation

- Required node outputs have documented parseability and shape expectations.
- Gate-driving statuses use bounded vocabularies.
- Metrics cannot persist as non-finite values.
- Stored paths remain portable or explicitly labeled as local-only runtime context.
- Stale projections are visible and do not strengthen readiness.
- Public outputs and audit reports remain traceable to run-scoped artifacts.
- Serialization failures lower or block claim ceilings instead of being ignored.
