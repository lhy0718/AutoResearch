---
name: tui-state-validation
description: Use this skill when the task is to reproduce or analyze a concrete AutoLabOS TUI/web symptom, especially when stale state, fresh-vs-existing divergence, resume mismatch, or persisted-artifact-vs-UI disagreement may be involved.
---

# TUI State Validation

## Purpose
Produce a structured live-validation result for one concrete target before proposing or evaluating a code change.

Treat actual user-visible behavior as the source of truth and compare, when relevant:
- fresh sessions
- existing or resumed sessions
- persisted artifacts
- runtime projections and summaries

This skill is for narrowing the problem to the most likely minimal failing boundary before patching.

## Use this skill when
Use this skill when the user asks to:
- run TUI live validation
- reproduce an interactive bug
- compare fresh vs existing or resumed sessions
- check whether persisted outputs match what the UI shows
- verify whether a fix actually solved the live symptom
- triage stale summaries, stale panels, stale progress, or stale session-local state
- validate a specific execution mode or a specific end-to-end flow

Typical trigger phrases:
- "TUI live validation"
- "reproduce the interactive bug"
- "compare fresh vs existing session"
- "the existing session looks stale"
- "the screen looks wrong"
- "actually run it and verify"
- "persisted output is right but the UI is wrong"

## Output format
Always produce these sections:

1. Validation target
2. Execution mode
3. Environment / session context
4. Reproduction steps
5. Expected behavior
6. Actual behavior
7. Fresh vs existing session comparison
8. Persisted artifact vs UI comparison
9. Most likely failing boundary
10. Evidence supporting that boundary
11. Recommended next step
12. Regression risks

## Method
1. Restate the validation target in one sentence.
2. Identify the relevant execution mode, commands, flows, sessions, and screens.
3. Check `/doctor` output and current runtime context first when applicable.
4. When possible, compare all of:
   - fresh session
   - existing or resumed session
   - persisted artifact
   - top-level summary or projection
5. Record reproduction steps and observations clearly enough that another agent could follow them exactly.
6. Choose one dominant problem category:
   - `persisted_state_bug`
   - `in_memory_projection_bug`
   - `refresh_render_bug`
   - `resume_reload_bug`
   - `race_timing_bug`
7. Also identify the most likely failing boundary:
   - persisted artifact layer
   - loader / read layer
   - projection / aggregation layer
   - refresh / subscription / invalidation layer
   - session resume / restore layer
   - renderer presentation layer
   - mode-specific policy divergence boundary
   - timing / race boundary
8. Recommend the next action:
   - boundary investigation
   - instrumentation
   - minimal patch
   - rerun with a narrower hypothesis

## Guardrails
- Do not jump straight into editing before writing down the validation record.
- Do not assume persisted state is correct just because the file exists.
- Do not assume one working mode implies all modes work.
- If a fresh reopen fixes the symptom, explicitly suspect in-memory projection, refresh wiring, resume handling, or session-local cache before blaming persistence.
- Separate observations from hypotheses.
- Prefer precise reproduction notes over broad conclusions.