# AGENTS.md

## Mission

This repository builds and validates a governed research operating system that runs through real TUI/web interactions, produces evidence-grounded artifacts, and reaches paper-ready outputs only when the experimental and review bars are actually met.

Always prioritize:

1. Correct interactive behavior
2. State and artifact consistency
3. Reproducible validation
4. Honest scientific writing that does not exceed the evidence
5. Review-gated progression instead of appearance-driven completion

---

## Source of Truth

For detailed policy, defer to these documents first:

- `docs/architecture.md`
- `docs/tui-live-validation.md`
- `docs/experiment-quality-bar.md`
- `docs/paper-quality-bar.md`
- `docs/reproducibility.md`
- `docs/live-validation-issue-template.md`
- `docs/research-brief-template.md`

Keep this file short, high-signal, and operational.
Use the docs above as the canonical source for detailed rules.

---

## Codex Operating Style

- Read this file first, then open the relevant source-of-truth docs before editing behaviorally significant code.
- Prefer explicit, minimally scoped changes over broad speculative rewrites.
- Preserve the repository’s governed workflow, auditability, and observable artifacts.
- When a rule here conflicts with a more detailed rule in the docs, follow the docs.

---

## Skill Usage

Use repository-local skills in `.codex/skills` when the task matches their scope.

- Use the TUI/live-validation skill for interactive behavior, slash-command flows, session reload/resume issues, or anything that must be verified in a real TUI/web flow.
- Use the research-quality or paper-writing skill for claim-evidence alignment, paper-readiness checks, related-work depth, or genre/readiness downgrades.
- Use the reproducibility or artifact-validation skill for checkpoint/state consistency, artifact verification, harness expectations, or run-output audits.
- Use the brief/plan-oriented skill when creating or repairing governed research briefs or execution plans.

If a relevant skill exists, follow it in addition to this file and the docs.

---

## Working Rules

- Plan briefly before editing when the issue is complex.
- Do not claim a fix is complete until the same validation flow has been re-run.
- Record live-validation issues in `ISSUES.md` with reproduction steps, expected behavior, actual behavior, session comparison, root-cause hypothesis, and regression status.
- Lower the strength of any claim that is not backed by explicit evidence.
- Do not present partial success as full completion.
- Do not mark unverified improvements as done.
- Treat `/doctor`, targeted smoke checks, and live validation as first-class diagnostic surfaces when applicable.
- If the user explicitly asks for direct testing or to see actual runtime behavior, do not satisfy that request with deterministic smoke fixtures, fake-provider runs, or replay-only checks. Use a real TUI/web flow when the environment allows, or state the blocking limitation explicitly.
- Prefer bounded node-internal loops, auditable artifacts, and minimal high-confidence fixes over broad speculative refactors.

---

## Workflow Contract

The repository currently operates around a governed 9-node research workflow with bounded transitions, built-in backtracking, and checkpointed artifacts.

- Do not casually add, remove, reorder, or redefine top-level workflow nodes.
- Treat the 9-node structure as fixed unless there is an explicit contract change reflected in docs, runtime behavior, and validation expectations.
- Any workflow-structure change must preserve:
  - inspectable state transitions
  - artifact audibility
  - reproducibility
  - review gating
  - claim-ceiling discipline
  - safe backtracking behavior

---

## Required Validation Commands

Run the smallest relevant validation set that honestly covers the change.

Core commands:

- `npm run build` — required when changing shipped TypeScript/runtime or web build behavior
- `npm test` — required for most code changes affecting logic, state handling, workflow control, or CLI/TUI behavior
- `npm run test:web` — required when changing web UI behavior or web-facing interactive flows
- `npm run validate:harness` — required when changing harness expectations, governed workflow contracts, issue/brief/review artifacts, or reproducibility-facing validation logic

Targeted smoke checks when relevant:

- `npm run test:smoke:natural-collect`
- `npm run test:smoke:natural-collect-execute`
- `npm run test:smoke:all`
- other targeted smoke scripts in `tests/smoke/`

For interactive defects, do not rely on tests alone if a real TUI/web flow can be run.
Re-run the same flow that exposed the issue.
Deterministic smoke is a secondary diagnostic/regression tool, not a substitute for a user-requested direct live test.

---

## Do Not Confuse System Completion with Research Completion

These are not equivalent:

- workflow completed
- `write_paper` completed
- PDF build succeeded
- paper-ready experimental manuscript

The first three may indicate that the system ran successfully.
They do not, by themselves, mean the work is submission-ready.

For an experimental paper target, require at least:

- a clear research question
- a paper-worthy related-work corpus
- a falsifiable hypothesis
- a baseline or comparator
- real executed experiments
- quantitative result tables
- explicit claim-to-evidence mapping
- limitations or failure modes

If that bar is not met, downgrade the output explicitly, for example as:

- `paper_ready=false`
- `blocked_for_paper_scale`
- `paper_scale_candidate`
- `system_validation_note`
- `research_memo`

---

## Interactive Bug Taxonomy

Every live-validation issue must name one dominant root-cause class:

- `persisted_state_bug`
- `in_memory_projection_bug`
- `refresh_render_bug`
- `resume_reload_bug`
- `race_timing_bug`

---

## Research Quality Rules

- Do not substitute workflow artifacts for research contributions.
- Do not use toy smoke experiments as primary experimental evidence.
- Do not claim an experimental paper without a baseline or comparator.
- Do not over-rely on abstract-only evidence.
- Negative results are acceptable, but they still require real evidence and honest interpretation.
- If the experiment is not strong enough, explicitly lower the genre or readiness class of the output.
- Keep claims under the strongest defensible evidence ceiling established by the available artifacts.

---

## Review Is a Gate, Not a Polish Pass

`review` is not just a writing cleanup step.
It is a structural gate for:

- readiness
- methodology sanity
- experiment adequacy
- evidence linkage
- writing discipline
- reproducibility handoff
- claim-ceiling enforcement

Do not allow automatic progression to `write_paper` unless the work includes:

- a baseline or comparator
- a result table or equivalent quantitative comparison
- claim-to-evidence mapping
- evidence that real experiments were executed
- minimum acceptable related-work depth

If evidence is insufficient, prefer backtracking or explicit downgrade over cosmetic drafting.

---

## Research Brief Contract

A brief created from `/new` is not just an idea note.
It is the execution contract for a real research run.

Every brief must include:

- Topic
- Objective Metric
- Constraints
- Plan
- Research Question
- Why This Can Be Tested With A Small Real Experiment
- Baseline / Comparator
- Dataset / Task / Bench
- Target Comparison
- Minimum Acceptable Evidence
- Disallowed Shortcuts
- Allowed Budgeted Passes
- Paper Ceiling If Evidence Remains Weak
- Minimum Experiment Plan
- Paper-worthiness Gate
- Failure Conditions

Recommended when uncertainty is material:

- Notes
- Questions / Risks

Do not treat missing governance fields as harmless omissions for paper-scale work.

---

## ISSUES.md Expectations

`ISSUES.md` is not only a bug list.
It is also the running log for:

- live validation issues
- research completion risks
- paper readiness risks

Keep these categories distinct.

For interactive defects, always prefer:

1. real reproduction
2. issue logging
3. smallest plausible root-cause fix
4. same-flow revalidation
5. adjacent regression review

---

## Reproducibility Expectations

Do not treat a run as trustworthy unless its outputs and transitions can be inspected and rechecked.

When applicable:

- verify checkpoint/state consistency
- verify that public-facing outputs match underlying run artifacts
- run relevant smoke, harness, or live validation checks
- confirm that changed behavior is reflected in observable artifacts, not only in code paths
- state any remaining reproducibility or validation gaps explicitly

---

## Definition of Done

Do not report work as done unless:

- the issue was reproduced, or the missing reproduction was explicitly stated
- the same flow was re-run after the change when revalidation is applicable
- the original symptom no longer reproduces, or the remaining gap was stated honestly
- relevant tests, smoke checks, harness checks, or live validation were re-run as appropriate
- key artifacts were checked for consistency
- adjacent regression risk was reviewed
- remaining risks were stated in the final summary

For experimental-paper targets, also require:

- executed experiments with a baseline
- quantitative results
- clear claim-to-evidence linkage
- passing the review gate, or an explicit blocked decision
