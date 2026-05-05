# Domain-Specific Research-Agent Plugin Structure

Status: P2-17 design review.

## Goal

Domain-specific research-agent plugins can provide task templates, dataset adapters, metric validators, baseline recommendations, and domain review heuristics without changing AutoLabOS core governance.

## Boundary

Plugins are extensions under the existing workflow. They must not replace artifact contracts, review gates, claim ceilings, figure audit, result table discipline, or audit-first reporting.

## Recommended Plugin Manifest

`plugins/<plugin-id>/plugin.json`

Fields:

- plugin_id
- domain
- version
- supported_nodes
- provided_templates
- provided_validators
- baseline_recommendations
- metric_definitions
- required_artifacts
- disallowed_claims
- safety_notes

## Allowed Extension Points

- research brief templates
- dataset/task adapters
- metric schema validators
- baseline/comparator catalogs
- result table normalizers
- domain-specific review checklists
- citation source hints

## Disallowed Extension Points

- lowering paper-readiness gates
- bypassing `review` before `write_paper`
- suppressing failed runs
- treating plugin heuristics as evidence
- writing outside declared plugin or run-scoped paths
- redefining top-level workflow nodes

## Claim Ceiling

Domain plugins may add stricter evidence floors. They may not weaken the core bar. If a plugin cannot validate domain-specific evidence, the run should downgrade or request human review rather than promote.

## Failure Conditions

Block plugin activation if it:

- lacks a manifest
- declares no supported nodes
- has validators that cannot be tied to artifacts
- introduces machine-local paths
- rewrites core governance behavior without an explicit contract change

## Validation Plan

Future implementation should add:

1. plugin manifest schema tests
2. allowed extension-point checks
3. validator provenance checks
4. regression tests proving plugins cannot lower core gates
