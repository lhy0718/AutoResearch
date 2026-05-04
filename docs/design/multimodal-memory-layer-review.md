# Multimodal Memory Layer Review

This note defines the P2-7 design review for a multimodal memory layer. It is not an implementation claim and does not report measured visual reasoning, autonomous discovery, or paper-readiness improvement.

Multimodal memory means retaining references to visual and structured research artifacts so future review, audit, and bounded exploration can explain prior figure/table/caption decisions. It does not mean images, captions, screenshots, tables, or generated figures become evidence by being remembered.

## Boundary

The governed top-level workflow remains fixed:

`collect_papers -> analyze_papers -> generate_hypotheses -> design_experiments -> implement_experiments -> run_experiments -> analyze_results -> figure_audit -> review -> write_paper`

The multimodal memory layer is a run-scoped sidecar. It must remain subordinate to:

- run-scoped artifacts
- result-table validation
- `figure_audit`
- review-before-writing
- claim ceilings
- audit reports
- failed-run visibility

It must not add workflow nodes, bypass `figure_audit`, replace artifact contracts, or promote visual polish as scientific evidence.

## Current Multimodal Surfaces

Relevant existing artifact surfaces include:

- `figures/performance.svg`
- `paper/figures/*`
- `figure_audit/gate1_gate2_issues.json`
- `figure_audit/figure_audit_summary.json`
- `figure_audit/per_figure/*.json`
- `result_table.json`
- `paper/claim_status_table.json`
- `paper/evidence_gate_decision.json`
- `paper/paper_readiness.json`
- `review/decision.json`

These artifacts remain the source of truth. A memory layer may reference them, summarize them, or flag stale links, but it should not duplicate them as a second authority.

## Proposed Artifact

Future implementation should write:

`memory/multimodal_memory.json`

Recommended fields:

- `run_id`
- `generated_at`
- `schema_version`
- `source_artifacts`
- `visual_items`
- `table_items`
- `caption_claim_links`
- `figure_audit_links`
- `result_table_links`
- `reusable_evidence_refs`
- `non_evidence_hints`
- `stale_or_blocked_refs`
- `redaction_status`

All paths should be run-relative or repo-relative. The artifact should avoid storing raw binary image payloads by default; it should store references, hashes, dimensions, captions, and audit status.

## Visual Item Contract

Each retained visual item should include:

- stable visual id
- source artifact path
- content hash
- media type
- created by node
- caption or caption reference
- linked result-table rows
- linked claim ids
- figure audit status
- severe mismatch count
- publication-readiness status
- whether it is evidence, a diagnostic, or a non-evidence hint

The memory record should distinguish:

- executed-result visualization
- diagnostic/debug visualization
- manuscript figure
- appendix figure
- external-paper figure reference
- generated placeholder or fallback visual

Generated placeholders and fallback visuals must default to non-evidence hints.

## Table And Caption Contract

Tables and captions are part of the multimodal memory layer only when they can be linked back to artifacts.

Required links:

- table memory links to `result_table.json` rows or an equivalent executed result artifact
- caption memory links to a figure id and manuscript source
- claim memory links to `claim_status_table.json` or `evidence_gate_decision.json`
- mismatch memory links to `figure_audit_summary.json` or per-figure audit files

If a caption says more than the linked result table supports, memory should preserve the mismatch as a blocker, not as a reusable summary.

## Evidence Classes

Recommended evidence classes:

- `evidence`: executed result, linked to result table, claim table, and figure audit pass
- `diagnostic`: useful for debugging or interpretation, not sufficient for paper claims
- `manuscript_context`: relevant to writing or layout, not evidence by itself
- `external_reference`: cited or inspected external visual context, subject to citation support
- `fallback`: deterministic or placeholder visual, never quantitative evidence by itself
- `blocked`: known mismatch, unsupported claim, stale path, or failed-run-linked visual

Only `evidence` items may support result claims, and only within the claim ceiling established by linked artifacts.

## Figure Audit Interaction

`figure_audit` remains the gate for figure/result/caption consistency.

Memory may retain:

- per-figure issue summaries
- severe mismatch counts
- recommended repairs
- audit pass-through status
- publication-readiness labels
- links from figure ids to result-table rows

Memory may not:

- clear a severe mismatch
- override `review_block_required`
- treat a pass-through disabled audit as a visual-evidence pass
- promote a manuscript figure when linked result evidence is missing
- hide or drop a figure issue on resume

## Claim Ceiling Interaction

The strongest claim supported by a multimodal memory item is capped by its weakest linked artifact.

Examples:

- visual without result table link: non-evidence manuscript context
- figure with severe mismatch: blocked for manuscript promotion
- caption with unsupported improvement language: comparative claim blocked
- fallback chart: diagnostic or system-validation note only
- external visual without citation support: related-work claim downgraded
- complete result-linked figure with clean audit: conditionally reusable evidence, still subject to review

`write_paper` completion does not change any of these ceilings.

## Resume And Staleness Rules

On resume, a future implementation should verify:

- visual source artifacts still exist and match stored hashes
- figure ids still match audit records
- linked result-table rows still exist
- linked claim ids still exist
- `review_block_required` has not been ignored
- paper readiness did not become stronger because memory was present

If any check fails, the memory item should be marked `stale_or_blocked` and downgraded to a non-evidence hint. Staleness must remain visible if it affects a claim, figure, or review decision.

## Audit Report Interaction

`autolabos audit` may later use multimodal memory to enrich:

- figure/result/caption mismatch explanations
- top blockers
- unsupported claim context
- next action checklists
- stale artifact warnings

The audit verdict must still come from artifact-level checks: governance contract, result table, claim evidence, figure audit, review, paper readiness, and failed-run visibility.

## Privacy And Portability

The multimodal layer should not store:

- raw screenshots unless a future contract explicitly marks them as safe artifacts
- credentials or provider request payloads
- machine-local source roots
- external document locations
- unredacted human notes unrelated to artifact evidence

Public bundles should include only portable references or explicitly selected artifacts.

## Validation Plan

Before runtime implementation:

1. Add schema tests for `memory/multimodal_memory.json`.
2. Add hash/staleness tests for missing or changed figure artifacts.
3. Add tests proving a severe figure mismatch cannot be cleared by memory.
4. Add tests proving fallback or placeholder visuals cannot support quantitative claims.
5. Add audit tests showing multimodal memory enriches blockers without overriding verdicts.
6. Run `npm test -- tests/figureAuditNode.test.ts tests/figureAuditor.test.ts tests/paperReadinessAudit.test.ts`.
7. Run `npm run validate:harness` and `npm run build` if runtime code changes.

## Completion Criteria For A Future Implementation

- Multimodal memory is run-scoped and inspectable.
- Visual/table/caption references link back to source artifacts.
- Evidence classes distinguish evidence from diagnostics, manuscript context, fallback, and blocked items.
- `figure_audit` remains authoritative for visual mismatch blockers.
- Claim ceilings are never raised by remembered visual context.
- Stale or blocked visual references stay visible through resume and audit.
