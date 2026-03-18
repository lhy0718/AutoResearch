---
name: execution-mode-matrix-validation
description: Use this skill when you need to enumerate every execution mode and entry path exposed by the repository and validate mode-specific policy differences, artifacts, resume/reload behavior, review gates, and TeX→PDF behavior.
---

# Execution Mode Matrix Validation

## Purpose
Enumerate **all execution modes currently exposed by the repository** and validate whether each one actually behaves according to its intended policy and artifact rules.

The core goal is to avoid the common mistake of assuming:
**“if one mode works, everything works.”**

## Use this skill when
Use this skill when the user asks to:

- test all execution modes
- validate mode-specific policy differences
- check interactive / resume / autonomous / overnight behavior
- verify cross-mode regressions after a fix

Typical trigger phrases:
- "test every execution mode"
- "execution mode matrix"
- "cross-mode regression"
- "validate every entry path"

## Validation scope
When present, include:

- normal interactive TUI execution
- fresh-session execution
- resumed/existing-session execution
- unattended / long-running execution
- Overnight Mode
- Autonomous Mode
- draft / paper-generation path
- any other entry path that materially changes runtime behavior, artifact generation, gating, or output layout

## Required checks per mode
For each mode, verify:

1. discoverability
2. operator-facing explanation clarity
3. intended policy/config activation
4. artifact/output behavior
5. resume/reload behavior
6. review/write_paper gate behavior
7. TeX→PDF behavior
8. mode-specific failures
9. unintended cross-mode regressions

## Output format
Always produce:

1. execution mode inventory
2. intended policy differences
3. observed behavior per mode
4. cross-mode behaviors that are consistent
5. behaviors that fail only in specific modes
6. cross-mode regression status
7. highest-priority mode to fix next
8. next validation plan

## Guardrails
- Do not stop after one happy-path validation.
- Do not assume success in interactive mode implies success in autonomous mode.
- Distinguish intended divergence from unintended divergence.
- Do not collapse mode-specific bugs into generic bugs.

## Good completion criteria
This skill is complete when:

- all exposed execution modes have been enumerated
- each relevant mode has been exercised at least once
- intended mode differences and unintended regressions are clearly documented
- cross-mode regression checks were rerun after fixes