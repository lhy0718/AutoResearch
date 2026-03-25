---
name: tui-validation-loop-automation
description: Use this skill when the task is to repeatedly run a real TUI validation loop from test/ itself as the execution environment, reproduce issues, record them in ISSUES.md, apply the smallest plausible fix, revalidate the same flow, and keep validation grounded in node-owned execution rather than external substitution.
---

# TUI Validation Loop Automation

## Purpose
Use `test/` itself as the AutoLabOS execution environment and run a repeated real-validation loop:

1. reproduce a live issue
2. record it structurally in `ISSUES.md`
3. apply the smallest plausible fix
4. rerun the same flow
5. check adjacent and cross-mode regressions
6. continue until the targeted validation blocker is either resolved or clearly narrowed down

The core principle of this skill is:

**live validation first, fix second, revalidation always.**

This skill is about preserving the truth of the real system behavior.
It is not about making the run look successful by manually performing work outside the governed workflow.

## Use this skill when
Use this skill when the user asks to:

- keep repeating TUI validation until issues are fixed
- automate a reproduce -> patch -> rerun loop
- run live validation from `test/`
- update `ISSUES.md` while iterating
- compare fresh-session and resumed/existing-session behavior repeatedly
- validate the same flow again after each minimal fix
- keep narrowing a failure boundary through repeated real runs

Typical trigger phrases:

- "repeat TUI validation"
- "validation loop automation"
- "reproduce, fix, and rerun"
- "keep updating ISSUES.md"
- "validate from test/"
- "run the live loop until the blocker is clear"

## What this skill is for
This skill is for:

- real TUI/workflow/state/artifact consistency validation
- issue reproduction in a real operator-facing environment
- structured issue logging
- minimal, test-backed fixes
- rerunning the same flow after each fix
- checking whether the fix holds across related modes or entry paths

## What this skill does not guarantee by itself
This skill alone does not guarantee:

- paper-quality research output
- sufficient experiment scope
- strong baselines or ablations
- publication-ready manuscript quality

If the task also requires improving experiment quality or manuscript quality, use this skill alongside the research-quality loop that governs those goals.

## Working-root rule
- `test/` itself is the active live-validation environment.
- Run the real validation flow from `test/`.
- Keep automated regression tests under `tests/`.
- Do not confuse `test/` with `tests/`.
- Do not replace live validation with unit tests alone.

## Ground-truth rule
For interactive or workflow defects, the real TUI behavior is the primary source of truth.

That means:

- a passing unit test is not enough
- a completed run is not enough
- a generated TeX file is not enough
- a generated PDF is not enough
- deterministic smoke, fake-provider fixtures, and replay-only checks are not enough when the user explicitly asked for direct live testing

A fix only counts when the same live flow is rerun and the observed symptom is resolved or materially narrowed.

If the user explicitly asks you to test the system yourself or to inspect actual runtime behavior, deterministic smoke can still be used later for regression coverage, but it must not be presented as satisfying that direct-testing request. If credentials, network access, or required binaries block the real flow, say so explicitly instead of silently substituting a fixture-driven run.

## Node-ownership rule
During live validation or test-driven execution, do not let the external coding agent perform work that belongs to an AutoLabOS workflow node.

In particular:

- do not let the coding agent perform work that belongs to `implement_experiments`
- do not hand-author experiment scripts, execution outputs, metrics files, result bundles, or other node-owned artifacts as substitutes for a successful node execution
- do not bypass node transitions by manually creating the artifacts that the workflow is supposed to generate
- do not treat externally fabricated outputs as evidence that the system worked

The coding agent may:

- patch AutoLabOS code
- patch prompts
- patch guards
- patch validation logic
- patch deterministic tests
- improve runtime recovery, logging, or error handling
- make the smallest plausible change needed so that the actual node can perform its own work successfully

The coding agent must not replace node-owned execution with manual stand-ins.

## Required loop
For each iteration, do this in order:

1. Run `/doctor` first when relevant.
2. Reproduce the issue in a fresh session whenever possible.
3. Compare against resumed/existing-session behavior when relevant.
4. Record the issue in `ISSUES.md` before patching.
5. State the smallest plausible root-cause hypothesis.
6. Patch the smallest plausible root cause.
7. Add or update deterministic tests under `tests/`.
8. Rerun the same live flow in `test/`.
9. Check adjacent regressions.
10. Check cross-mode regressions when the change could affect them.
11. Update `ISSUES.md` with what changed, what passed, and what remains risky.

Do not skip directly from "symptom observed" to "large refactor applied."

## ISSUES.md rule
Every active live-validation issue entry should include:

1. validation target
2. environment/session context
3. reproduction steps
4. expected behavior
5. actual behavior
6. fresh vs existing session comparison
7. root cause hypothesis
8. code/test changes
9. regression status
10. remaining risks

Prefer one issue entry per concrete blocker.
Prefer observed facts over broad conclusions.

## Fresh vs existing session rule
Always check whether the bug differs between:

- a fresh session
- a resumed or already-running session

If the symptom appears only in one of them, explicitly treat that as a boundary clue rather than incidental noise.

## Minimal-fix rule
Prefer the smallest high-confidence patch that explains the observed failure.

Good fixes usually:

- narrow a boundary
- preserve existing contracts
- add a deterministic regression test
- improve rerun reliability without rewriting unrelated layers

Avoid broad rewrites unless the evidence clearly shows they are necessary.

## Revalidation rule
Never declare success merely because:

- one run happened to complete
- one path worked once
- one output file appeared
- one test passed
- one PDF built

A claimed fix must survive rerunning the same flow and checking nearby regression paths.

## Cross-mode rule
When the touched code can affect more than one execution path, validate more than one path.

Examples include when relevant:

- fresh interactive execution
- resumed/existing-session execution
- unattended or long-running execution
- alternate entry paths
- paper-generation paths
- any mode with different gating, artifact behavior, or resume behavior

Do not assume one mode standing up means all modes are safe.

## Recommended output structure
When using this skill, structure the working report like this:

1. Validation target
2. Current loop iteration
3. Reproduction result
4. Fresh vs existing comparison
5. Root-cause hypothesis
6. Minimal patch
7. Tests added or updated
8. Same-flow revalidation result
9. Adjacent/cross-mode regression result
10. `ISSUES.md` update
11. Remaining risks
12. Next highest-value blocker

## Guardrails
- Do not patch before recording the issue.
- Do not confuse `test/` with `tests/`.
- Do not replace real validation with test-only confidence.
- Do not replace a user-requested direct live test with deterministic smoke, fake-provider fixtures, or replay-only evidence.
- Do not let the coding agent substitute for `implement_experiments` or other node-owned execution.
- Do not manually create artifacts that the workflow itself is supposed to generate.
- Do not overclaim based on one successful run.
- Separate observations from hypotheses.
- Prefer smaller patches over broader rewrites.

## Good completion standard
This skill is complete for a given blocker when:

- the live issue was reproduced or the failing boundary was narrowed with strong evidence
- the issue was recorded clearly enough for another agent to follow
- the smallest plausible fix was applied
- deterministic tests were added or updated where appropriate
- the same live flow was rerun
- adjacent regressions were checked
- cross-mode regressions were checked when relevant
- `ISSUES.md` reflects the current state honestly
- no node-owned work was silently replaced by external manual artifact creation
