# Peer-Agent Artifact Coordination Review

Status: P2-11 design review.

## Goal

ArtifactReactor-style coordination lets specialized agents react to run artifacts rather than hidden conversational state. The goal is better coverage of implementation, review, figure, citation, and reproducibility risks while keeping deterministic gates authoritative.

## Boundary

Peer agents are advisory or task-scoped workers. They must not add top-level workflow nodes, bypass review, mutate paper-readiness gates, or promote artifacts without provenance.

## Coordination Model

Recommended queue artifact:

`coordination/peer_agent_tasks.jsonl`

Recommended response artifact:

`coordination/peer_agent_reports.jsonl`

Each task should include:

- task id
- requesting node
- artifact inputs
- allowed write scope
- expected output artifact
- budget and timeout
- gate authority: `advisory`, `required_check`, or `blocking_check`

Each report should include:

- task id
- agent role
- artifacts inspected
- files written
- findings
- uncertainty
- recommendation
- validation status

## Authority Rules

- Deterministic validators outrank peer-agent opinions.
- Review gates outrank peer-agent recommendations.
- A peer agent may identify blockers, but a blocker must map to a run artifact, validator issue, review finding, or audit finding.
- Agents should not communicate hidden claims that are absent from artifacts.

## Conflict Handling

If peer agents disagree, preserve both reports and add a coordinator summary. Do not average away disagreement. The safer paper-readiness ceiling wins until a deterministic check or human decision resolves the conflict.

## Failure Conditions

Block the coordination layer if it:

- edits outside its write scope
- rewrites another agent's artifacts without provenance
- hides failed checks
- treats agent consensus as evidence
- lets peer-agent praise override missing baselines, result tables, or claim-evidence links

## Validation Plan

Future implementation should add:

1. task/report schema validation
2. write-scope enforcement tests
3. conflict-preservation tests
4. audit integration showing peer-agent claims remain advisory unless linked to artifacts
