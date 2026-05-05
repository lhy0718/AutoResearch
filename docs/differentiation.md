# Differentiation

This document states AutoLabOS positioning for P1 design review. It avoids benchmark-performance claims unless backed by executed, published artifacts.

## Core Position

AutoLabOS is a governed research operating system for evidence-grounded automation. Its distinguishing feature is not that it can produce a paper-shaped output; it is that progression is gated by inspectable artifacts, baseline discipline, reproducibility checks, and human-review boundaries.

## Differentiators

AutoLabOS emphasizes:

- fixed governed workflow with checkpointed transitions
- real TUI/web validation as a first-class diagnostic surface
- paper-readiness separated from workflow completion
- baseline/comparator requirements before comparative claims
- result-table and claim-evidence artifacts before paper-ready status
- review as a structural gate, not a writing polish pass
- public output bundles traceable to run-scoped artifacts
- bounded node-internal loops rather than unbounded autonomous drift
- explicit downgrade paths for weak or incomplete evidence

## What AutoLabOS Should Not Claim

Do not claim that AutoLabOS has achieved:

- fully autonomous month-long research execution
- external benchmark superiority
- universal paper readiness
- stronger science than the artifacts support
- replacement of human scientific judgment
- safe execution of arbitrary external actions

Those may be future measurement targets, but they are not achieved results unless backed by executed benchmark runs and reviewable artifacts.

## Relationship To Agentic Research Systems

AutoLabOS can share components with agentic research systems, including experiment managers, search budgets, tool-using workers, review panels, and paper drafting. Its design priority is different:

- governance before autonomy
- artifact contracts before prose quality
- baseline locks before optimization claims
- evidence ceilings before publication framing
- pause/backtrack before appearance-driven completion

## Judge Lane

AutoLabOS treats `figure_audit`, `review`, and paper-readiness audit as a judge lane. Planner/worker nodes can produce hypotheses, designs, code, experiments, analysis, and drafts, but the judge lane decides whether evidence is sufficient, whether claims must be downgraded, and whether manuscript promotion is blocked.

This separation exists to prevent self-grading, premature completion, and `write_paper` success being mistaken for paper-ready research evidence.

## Competitive Framing

When comparing AutoLabOS to other systems, use claims like:

- "designed to preserve a governed evidence trail"
- "requires explicit baseline/comparator artifacts for paper-scale claims"
- "keeps review and claim ceilings as progression gates"
- "separates system validation from research completion"

Avoid claims like:

- "more accurate"
- "better than system X"
- "fully automatic scientist"
- "paper-ready by default"

unless a matching benchmark report exists.
