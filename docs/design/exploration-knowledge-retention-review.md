# ExplorationManager Knowledge-Retention Review

This note defines the P2-6 design review for autonomous knowledge retention inside `ExplorationManager`. It is not an implementation claim and does not report measured autonomous research improvement.

Knowledge retention means preserving branch, failure, evidence, and decision context so later node-internal exploration can avoid repeated mistakes and reuse defensible evidence traces. It does not mean persistent autonomous discovery is already solved, and it must not turn weak evidence into paper-ready claims.

## Boundary

The governed top-level workflow remains fixed:

`collect_papers -> analyze_papers -> generate_hypotheses -> design_experiments -> implement_experiments -> run_experiments -> analyze_results -> figure_audit -> review -> write_paper`

Knowledge retention is an internal sidecar for bounded exploration. It must not add workflow nodes, bypass `review`, weaken `claim ceiling`, or replace run-scoped artifacts as the source of truth.

Current relevant surfaces:

- `experiment_tree/research_tree.json`
- `experiment_tree/manager_state.json`
- `failure_memory.jsonl`
- `result_table.json`
- `figure_audit/figure_audit_summary.json`
- `review/decision.json`
- `paper/evidence_gate_decision.json`
- `paper/paper_readiness.json`

## What May Be Retained

Allowed retained knowledge:

- branch identity, parentage, stage, and change set
- baseline lock references and single-change checks
- executed evidence manifests
- reproducibility status and reproduction count
- objective metrics and result-table links
- failure fingerprints and retry policy
- stage transition decisions and rollback reasons
- promotion decisions and blocking reasons
- figure audit summaries and severe mismatch counts
- claim fingerprints that were blocked or downgraded

Disallowed retained knowledge:

- private absolute paths or machine-local source roots
- raw credentials, environment secrets, or provider tokens
- unverifiable natural-language summaries without artifact links
- paper-ready labels not backed by result, review, and claim-evidence artifacts
- hidden failed-run state
- memories that override baseline/comparator requirements

## Proposed Retention Artifact

Future implementation should write a separate sidecar instead of overloading `manager_state.json`:

`experiment_tree/knowledge_retention.json`

Recommended fields:

- `run_id`
- `generated_at`
- `source_artifacts`
- `retained_branch_summaries`
- `blocked_failure_fingerprints`
- `reusable_evidence_refs`
- `non_reusable_evidence_refs`
- `claim_ceiling_notes`
- `resume_hints`
- `redaction_status`
- `schema_version`

The artifact should contain repo-relative or run-relative references only. It should not record external local note paths, temporary workspaces, or non-repository mirror roots.

## Retention Rules

Retention may guide future exploration only when the retained item is traceable.

Required traceability:

- branch summary links to a research-tree node id
- metric claim links to `result_table.json`
- baseline/comparator decision links to `baseline_lock.json` or result-table rows
- failed branch memory links to a failure fingerprint
- figure claim links to `figure_audit_summary.json`
- paper-readiness note links to review and paper gate artifacts

If traceability is missing, the item may be retained as an operational hint but not as evidence.

## Reuse Rules

Retained knowledge may be reused for:

- avoiding a blocked failure fingerprint
- prioritizing a branch family with reproduced evidence
- warning that a stage transition previously failed
- preloading baseline/comparator constraints
- reminding review that a claim was previously downgraded
- reducing repeated equivalent debug branches

Retained knowledge may not be reused for:

- claiming improvement without a fresh or traceable comparator
- skipping result-table validation
- skipping figure audit
- treating fallback-only output as quantitative evidence
- auto-promoting a branch to paper-ready
- suppressing failed-run visibility

## Resume And Reload Contract

Knowledge retention must survive resume without changing meaning.

Resume checks should verify:

- retained branch ids still exist in `research_tree.json`
- referenced artifacts still exist and are non-empty
- blocked failure fingerprints still match `failure_memory.jsonl`
- current stage and retained stage hints do not conflict
- retained promotion notes do not contradict the latest review decision
- failed run state remains visible

If a retained reference is stale, the system should downgrade it to a non-evidence resume hint and record a repair action. It should not silently drop the stale reference if that would hide a failure or blocker.

## Claim Ceiling Interaction

The strongest allowed claim from retained knowledge is capped by the weakest linked artifact.

Examples:

- retained branch summary without executed evidence: operational planning hint only
- executed branch without baseline/comparator: descriptive result only
- fallback-only evidence: system validation note only
- result table without citation support for related work: related-work claim downgraded
- figure mismatch present: no manuscript promotion
- hidden failed run: blocked

`write_paper` completion remains only a workflow signal. It is not a retained proof of paper readiness.

## Audit Report Interaction

`autolabos audit` should be able to read retained knowledge later, but the audit verdict must remain controlled by artifact-level evidence:

- governance artifact contract
- result table completeness
- claim-evidence support
- figure audit
- review decision
- paper readiness gate
- failed-run visibility

Knowledge retention can add context to blockers and next actions. It cannot override blockers.

## Validation Plan

Before runtime implementation:

1. Add a schema test for `knowledge_retention.json`.
2. Add stale-reference tests for missing branch ids and missing artifacts.
3. Add resume tests proving retained hints do not change stage decisions without policy approval.
4. Add audit tests proving retained knowledge cannot override missing baseline/comparator, fallback-only evidence, or figure mismatch blockers.
5. Run `npm test -- tests/explorationManager.test.ts tests/explorationStatus.test.ts tests/paperReadinessAudit.test.ts`.
6. Run `npm run validate:harness` and `npm run build` if runtime code changes.

## Completion Criteria For A Future Implementation

- Knowledge retention is run-scoped and inspectable.
- Retained facts have artifact references or are explicitly marked as non-evidence hints.
- Resume/reload preserves retained context without changing evidence meaning.
- Failed branches and blocked claims remain visible.
- Claim ceilings are never raised by memory alone.
- Audit reports can use retention context only as explanatory support, not as a readiness override.
