# P5 Audit Timeline Roadmap

P5 strengthens the audit-first surface by explaining how the final verdict was reached from durable events, checkpoints, judge-lane artifacts, and explicit done-conditions.

## Priorities

1. Export `audit-timeline.json` from existing run events, checkpoints, review packets, figure audit artifacts, and paper-readiness outputs.
2. Export claim promotion and blocked-claim event artifacts without inventing support for unsupported claims.
3. Treat Research Brief evidence floors and governance condition metadata as external done-conditions.
4. Label `figure_audit`, `review`, and paper-readiness audit as the judge lane in reports and docs.
5. Record autonomy and evidence-integrity metrics only where preserved artifacts support them.

## Non-Goals

- No new broad autonomous scientist positioning.
- No hosted long-running agent platform claim.
- No weakening of claim ceilings, review gates, figure audit, result-table discipline, failed-run visibility, or citation support checks.
- No paper-ready-by-default claim from workflow completion, `write_paper` completion, or PDF build success.

## Full Live Validation Trigger

Run full live validation after P5-1 through P5-4 are implemented and targeted tests pass. That is the first point where a real run can verify that timeline reconstruction, done-condition enforcement, and judge-lane labeling are observable in artifacts rather than only in unit tests.

As of 2026-05-05, the P5 implementation preconditions are met in unit, harness, build, and seed-replay validation. The next live validation pass should use a real validation workspace and inspect the generated audit timeline, done-condition audit, judge-lane report sections, and claim-promotion artifacts without committing generated run outputs.
