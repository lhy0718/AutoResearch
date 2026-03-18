---
name: tui-live-validation
description: Use this skill when the task is to run or analyze real TUI validation, reproduce an interactive issue, compare fresh sessions with existing sessions, or produce a structured validation record before proposing a fix.
---

# TUI Live Validation

## Purpose
Produce a structured validation result for a real TUI workflow before proposing or evaluating a code change.

This skill is not just for “running it once.”
It treats actual user-visible TUI behavior as the source of truth and checks consistency across:

- fresh sessions
- existing/resumed sessions
- persisted artifacts
- runtime projections and summaries

This skill focuses on **one concrete validation target at a time**.
Use `execution-mode-matrix-validation` separately when the goal is to inventory and verify all exposed execution modes.

## Use this skill when
Use this skill when the user asks to:

- run TUI live validation
- reproduce an interactive bug
- compare a fresh TUI session with an already-running session
- check whether persisted outputs match what the UI shows
- verify whether a fix actually solved the live symptom
- validate a specific execution mode or a specific end-to-end flow

Typical trigger phrases:
- "TUI live validation"
- "reproduce the interactive bug"
- "compare fresh vs existing session"
- "the existing session looks stale"
- "actually run it and verify"
- "the screen looks wrong"

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
9. Most likely problem boundary
10. Recommended next step

## Method
1. Restate the validation target in one sentence.
2. Identify the relevant execution mode, commands, flows, sessions, and screens.
3. Check `/doctor` output and current runtime context first.
4. When possible, compare all of:
   - fresh session
   - existing/resumed session
   - persisted artifact
   - top-level summary / projection
5. Record reproduction steps and observations clearly enough that another agent could follow them exactly.
6. Classify the issue using one dominant category:
   - `persisted_state_bug`
   - `in_memory_projection_bug`
   - `refresh_render_bug`
   - `resume_reload_bug`
   - `race_timing_bug`
7. Recommend the next action:
   - boundary investigation
   - patch
   - instrumentation
   - rerun with a narrower hypothesis

## Guardrails
- Do not jump straight into editing before writing down the validation record.
- Do not assume persisted state is correct just because the file exists.
- Do not assume one working mode implies all modes work.
- If a fresh reopen fixes the symptom, explicitly suspect in-memory projection, refresh wiring, resume handling, or session-local cache before blaming persistence.
- Separate observations from hypotheses.
- Prefer precise reproduction notes over broad conclusions.

## Good completion criteria
This skill is complete when:

- the symptom is described clearly enough that another agent can reproduce it
- fresh and existing-session behavior were explicitly compared when relevant
- persisted state and rendered state were explicitly compared when relevant
- the most likely failing boundary has been narrowed down
- the recommended next action is specific enough to guide the next loop