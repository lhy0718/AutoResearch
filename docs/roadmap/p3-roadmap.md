# P3 Roadmap

Status: draft roadmap after P0/P1/P2 checklist completion.

## Direction

P3 should shift from checklist completion to product hardening and demo reliability. The core positioning stays audit-first: AutoLabOS should prevent false paper-readiness claims rather than present itself as a fully autonomous scientist.

## P3-1. Audit UX Hardening

Goal: make `autolabos audit` easier to inspect and demo.

Candidate work:

- add compact terminal summary output
- add blocker severity grouping
- add stable report section anchors
- add examples for `--seed`, `--run`, and `--out-dir`
- add snapshot tests for Markdown report structure

Completion signal:

- audit reports remain conservative and easy to scan without weakening claim ceilings.

## P3-2. Public Demo Bundle

Goal: produce a repo-safe demo package showing AGB false-paper-ready blocking.

Candidate work:

- add demo script for AGB-001, AGB-003, and AGB-010 audit runs
- export sample audit reports under a generated or fixture directory
- document expected verdicts and blockers
- ensure generated examples do not contain machine-local paths

Completion signal:

- a reviewer can run the demo and see false paper-ready claims blocked.

## P3-3. Live Validation Playbook

Goal: make live TUI/web validation repeatable after major workflow changes.

Candidate work:

- add a short operator playbook for fresh run, resume, and failed-run inspection
- map live validation issue taxonomy to exact reproduction artifacts
- keep live checks separate from deterministic smoke tests

Completion signal:

- interactive regressions can be reproduced, logged, fixed, and revalidated without relying on replay-only fixtures.

## P3-4. Audit Integration For P2 Design Notes

Goal: turn selected P2 design contracts into audit findings where they are mature enough.

Candidate work:

- reverse-from-data exploratory-origin downgrades
- distributed worker hidden-failure checks
- research-world-model provenance checks
- AutoSOTA unsupported ranking warnings
- strategist/worker scope and failure-preservation checks
- plugin manifest gate preservation checks

Completion signal:

- audit reports can identify violations without treating advisory design notes as implemented runtime claims.

## P3-5. Release Hygiene

Goal: make the current completion state easier to publish and review.

Candidate work:

- add changelog or release note for the audit-first milestone
- verify npm package metadata and CLI help text
- run full test/build/harness before release commits
- keep `docs/design/`, `docs/status/`, and `docs/roadmap/` separated by purpose

Completion signal:

- release reviewers can understand what is implemented, what is design-only, and what remains future work.

## Non-Goals

- no broad research OS repositioning
- no paper-ready-by-default claims
- no workflow node reshaping
- no weakening of baseline, result-table, figure-audit, review, or claim-evidence gates
