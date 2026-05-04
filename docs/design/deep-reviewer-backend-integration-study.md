# Deep Reviewer Backend Integration Study

This note defines the P2-4 integration study for an optional stronger review backend. It is not an implementation claim and does not report measured review quality improvements.

Here, "Deep Reviewer-style" means an external or stronger structured review service that can critique claims, methodology, statistics, writing readiness, integrity, and paper-scale evidence. The exact provider is intentionally abstract in this study.

## Current Review Contract

AutoLabOS already treats `review` as a gate, not a polish pass.

The current review node produces:

- `review/pre_review_summary.json`
- `review/findings.jsonl`
- `review/scorecard.json`
- `review/consistency_report.json`
- `review/bias_report.json`
- `review/revision_plan.json`
- `review/decision.json`
- `review/minimum_gate.json`
- `review/paper_critique.json`
- `review/readiness_risks.json`
- `review/review_packet.json`

These artifacts preserve the distinction between:

- workflow completion
- review completion
- write-paper eligibility
- paper readiness

Any external review backend must feed this contract. It must not replace the deterministic minimum gate, claim ceiling, artifact validation, or human approval surfaces.

## Integration Goals

The backend may improve:

- claim verification depth
- methodology critique
- statistics critique
- related-work adequacy review
- limitation and failure-mode discovery
- adversarial paper-readiness judgment
- reviewer disagreement visibility

It must preserve:

- fixed top-level workflow shape
- run-scoped artifacts as source of truth
- deterministic minimum-gate authority
- claim-to-evidence discipline
- review-before-writing enforcement
- explicit downgrade paths
- inspectable reviewer provenance
- bounded cost, retries, and timeout behavior

## Non-Goals

This P2-4 slice does not:

- add a new workflow node
- enable automatic paper-ready promotion
- make external review blocking by default
- upload a full workspace to an external backend
- treat reviewer prose as evidence
- report benchmark or quality gains without measured validation
- let a positive external review override missing baseline, result table, or claim-evidence artifacts

## Adapter Contract

A future backend adapter should accept a bounded review bundle, not the whole workspace.

Allowed inputs:

- run metadata needed for review context
- `result_analysis.json`
- `baseline_comparison.json`
- `result_table.json`
- `analysis/evidence_scale_assessment.json`
- `figure_audit/figure_audit_summary.json`
- review packet inputs and prior review artifacts
- paper evidence-link artifacts when present
- generated manuscript excerpts only when needed for post-draft review

The adapter should return structured data equivalent to or mappable into:

- reviewer id and label
- review dimension
- score
- confidence
- recommendation
- findings with severity, evidence paths, claim ids, and fix hints
- backend provenance and policy metadata
- timeout or failure status

Reviewer output must be stored as run-scoped artifacts before it influences any transition.

## Proposed Modes

### Disabled

Default mode. Current review behavior remains unchanged.

### Advisory Shadow

The backend runs after or beside the current review panel and writes a sidecar artifact such as `review/external_review_report.json`.

The result may inform operator summaries, but it cannot change transition recommendations.

### Gated Shadow

The backend may add warnings or manual-review blockers when it finds evidence deficits, but it still cannot override a deterministic minimum-gate block or promote a run to paper-ready.

### Blocking

Blocking mode should remain disabled until validation shows stable behavior across benchmark and live-validation tasks. In this mode, external backend findings may block advancement, but only by adding conservative blockers. They must not force advancement.

## Safety Rules

- A positive external review cannot raise `blocked_for_paper_scale`, `system_validation_note`, or `research_memo` to `paper_ready` when deterministic evidence gates disagree.
- A negative external review may lower readiness or require human review if it cites concrete artifact paths, claim ids, or missing evidence classes.
- Missing, timed-out, or malformed backend output falls back to current review behavior and records an audit finding.
- Backend results must include enough provenance to distinguish model judgment, deterministic checks, and operator approval.
- Backend prompts and responses should be bounded and redact or exclude secrets, credentials, local-only paths, and unrelated workspace files.

## Artifact Plan

Future implementation should prefer additive artifacts:

- `review/external_review_request_manifest.json`
- `review/external_review_report.json`
- `review/external_review_reconciliation.json`

The reconciliation artifact should record:

- backend mode
- input artifact list
- backend status
- mapped findings
- findings accepted into the review packet
- findings ignored with reasons
- whether transition recommendation changed
- whether human review is required

## Validation Plan

Before enabling anything beyond advisory shadow:

1. Run unit tests for adapter parsing, malformed output fallback, timeout fallback, and provenance redaction.
2. Run harness validation to confirm review artifacts remain structurally complete.
3. Replay governance benchmark seeds where weak evidence should remain blocked.
4. Validate that positive backend judgments cannot override missing baseline, missing result table, unsupported claim, or failed brief evidence gates.
5. Run a live TUI or web review/resume flow if backend output affects operator-visible state.

## Open Risks

- Reviewer overconfidence can inflate weak evidence.
- External services can introduce privacy, policy, cost, or availability failures.
- Long context bundles can hide missing evidence behind fluent critique.
- Multiple reviewers can disagree without a deterministic reconciliation rule.
- Backend-specific schemas can leak into the core review contract if not normalized.

The first implementation should therefore be advisory, additive, and visibly lower-authority than deterministic gates.
