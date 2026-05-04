# StagePolicies Autonomous Evolution Experiment Design

This note defines the P2-5 design for experimenting with StagePolicies evolution. It is not an implementation claim and does not report measured autonomous research improvement.

StagePolicies are part of the exploration governance layer. They control stage purpose, allowed intervention dimensions, promotion conditions, rollback conditions, termination conditions, budget ceilings, and reproducibility floors for node-internal exploration.

## Current Boundary

The governed top-level workflow remains fixed:

`collect_papers -> analyze_papers -> generate_hypotheses -> design_experiments -> implement_experiments -> run_experiments -> analyze_results -> figure_audit -> review -> write_paper`

StagePolicies operate inside the existing exploration implementation. They must not add, remove, reorder, or redefine top-level workflow nodes.

Current stages are:

- `feasibility`
- `baseline_hardening`
- `main_agenda`
- `ablation`

The existing `autolabos evolve` loop mutates prompts and skills under validation and rollback. It is not StagePolicy evolution and should not be described as autonomous stage-policy rewriting.

## Experiment Goal

The goal is to test whether policy variants can improve exploration governance without weakening evidence discipline.

Allowed evaluation targets:

- earlier detection of infeasible branches
- fewer repeated equivalent failures
- better baseline-hardening discipline
- cleaner single-change branch structure
- more reliable strongest-defensible branch selection
- fewer review backtracks caused by missing evidence

Disallowed success metrics:

- workflow completion alone
- generated-paper length
- PDF build success
- reviewer positivity without evidence
- paper-ready rate without baseline/comparator and claim-evidence checks

## Policy Candidate Contract

A policy candidate must be represented as an artifact, not an in-place mutation of production policy.

Recommended candidate artifact:

`experiment_tree/stage_policy_candidates/<candidate-id>.json`

Each candidate should include:

- candidate id
- parent policy id or baseline policy label
- stage-specific allowed changes
- stage-specific forbidden changes
- promotion conditions
- rollback conditions
- termination conditions
- budget ceilings
- reproducibility floors
- rationale
- expected risk
- validation status

Candidate policies may be evaluated in shadow mode before they influence execution.

## Current Gaps

Before runtime support, close these gaps:

- Stage decision history should distinguish current stage, proposed next stage, final decision, and applied next stage.
- A provisional first executed branch should not become paper evidence until strongest-defensible scoring and promotion artifacts support it.
- Shadow evaluation needs fixed persisted traces so policy candidates are compared against the same evidence, not against different generated runs.
- Candidate evaluation should record when an apparent improvement comes from budget relaxation or weakened reproducibility rather than better exploration governance.

## Required Invariants

Every candidate must preserve:

- fixed top-level workflow shape
- `BaselineLock` requirements before comparative claims
- `SingleChangeEnforcer` behavior after baseline lock
- executed-evidence-only promotion
- result-table and claim-evidence requirements
- deterministic minimum gate authority
- review-before-writing enforcement
- bounded stage budgets
- rollback and stop conditions
- inspectable stage decision history

No candidate may lower paper-readiness gates, remove baseline/comparator requirements, or promote smoke-only output as research evidence.

## Proposed Modes

### Disabled

Default mode. Production `STAGE_POLICY` remains unchanged.

### Shadow Evaluation

Candidate policies evaluate completed exploration traces and produce a sidecar report, but they do not alter branch proposals, stage transitions, or promotion decisions.

Recommended artifact:

`experiment_tree/stage_policy_shadow_report.json`

### Advisory Proposal

The system may propose policy edits with rationale and expected effect, but a human must approve before any policy can affect future runs.

Recommended artifact:

`experiment_tree/stage_policy_advisory_proposal.json`

### Gated Experiment

A candidate policy may be used for a bounded validation run only when:

- it passes invariant checks
- it is tied to a specific benchmark or validation task
- it writes candidate provenance to run artifacts
- it can be rolled back to the baseline policy
- it cannot alter review, paper, or claim-ceiling gates

## Evaluation Design

Compare baseline policy and candidate policy on fixed tasks or replayable traces.

Minimum comparison fields:

- task id or run id
- active policy id
- stage transition count
- rollback count
- repeated failure count
- executed branch count
- reproduced branch count
- strongest-defensible branch selected
- baseline lock present
- single-change violations
- result table present
- review decision
- paper-readiness ceiling

Recommended output:

`experiment_tree/stage_policy_eval_report.json`

The report should mark `policy_candidate_promoted=false` unless all required evidence is present and validation passes.

## Promotion Rules

A policy candidate may be promoted only when:

- it preserves all invariants
- it improves at least one predeclared operational metric
- it does not regress evidence quality or review outcomes
- it passes targeted tests and harness validation
- it has an explicit rollback plan
- it is reviewed by a human operator

Promotion should remain a repository/code review decision, not an automatic runtime mutation.

## Failure Conditions

Immediately block or reject a candidate if it:

- changes more than one intervention dimension while claiming clean comparison
- allows baseline-free comparative claims
- lowers reproducibility minimums below the evidence floor
- hides repeated equivalent failures as progress
- lets stage transition success substitute for executed evidence
- bypasses `review` or `write_paper` gates
- changes production policy without a candidate artifact

## Validation Plan

Before implementing runtime support:

1. Add schema tests for candidate policy artifacts.
2. Add invariant tests proving baseline, single-change, and evidence gates cannot be weakened.
3. Add shadow-evaluation tests on fixed exploration traces.
4. Run `npm test -- tests/explorationPolicies.test.ts tests/explorationManager.test.ts tests/evolveRun.test.ts`.
5. Run `npm run validate:harness` and `npm run build`.

If a future implementation changes TUI/web-visible policy state, also run the relevant TUI/web validation flow from a validation workspace.
