---
name: stale-state-triage
description: Use this skill when the issue involves stale UI state, stale top-level summaries, refresh mismatches, resume mismatches, or disagreement between persisted artifacts and the active interactive session.
---

# Stale State Triage

## Purpose
Narrow stale-state bugs to the most likely minimal failing boundary before implementing a fix.

## Use this skill when
Use this skill when the issue involves:

- stale top-level summaries
- newly written persisted outputs not reflected in the UI
- fresh sessions showing correct state while existing sessions remain stale
- resumed/reopened behavior differing from live-session behavior
- state drift between persisted data and rendered views
- stale behavior that only appears in one execution mode

Typical trigger phrases:
- "stale"
- "top-level summary didn't update"
- "fresh reopen fixes it"
- "only the existing session is wrong"
- "the file is correct but the UI is wrong"
- "looks like a refresh path problem"
- "in-memory projection bug"
- "only broken in one mode"

## Required output
Always produce:

1. Symptom summary
2. Source-of-truth state
3. Session comparison
4. Execution-mode comparison
5. Most likely failing boundary
6. Evidence supporting that boundary
7. Lowest-risk fix direction
8. Regression risk

## Boundary model
Use this model to narrow the bug:

- persisted artifact layer
- loader / read layer
- projection / aggregation layer
- refresh / subscription / invalidation layer
- session resume / restore layer
- renderer presentation layer
- mode-specific policy divergence boundary
- timing / race boundary across layers

## Method
1. Identify the changed source of truth.
2. Check whether persisted artifacts reflect the new truth.
3. Check whether a fresh process/session displays that truth.
4. Check whether the currently running session is the only stale one.
5. When relevant, test whether the same issue appears in other execution modes.
6. Determine which boundary most likely failed to update.
7. Record the strongest supporting evidence.
8. Recommend the lowest-risk fix direction.

## Fix-direction priority
Prefer these explanations in this order:

1. missing refresh trigger
2. stale in-memory projection invalidation
3. resume / restore refresh bug
4. loader refresh bug
5. mode-specific policy divergence bug
6. renderer consumption bug
7. persistence bug

Do not blame persistence corruption unless the evidence supports it.

## Guardrails
- Do not use vague statements like “some sync issue.”
- Name the boundary as specifically as possible.
- Separate evidence from inference.
- If fresh reopen fixes the issue, prefer refresh/projection/resume explanations before persistence corruption.
- Prefer narrow patches over cross-layer rewrites.

## Good completion criteria
This skill is complete when:

- one dominant failure boundary has been identified
- that boundary choice is supported by evidence
- the recommended patch direction is small and testable
- relevant session/mode comparisons have been completed
- likely regressions are explicitly called out