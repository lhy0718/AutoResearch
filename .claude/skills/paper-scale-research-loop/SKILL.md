---
name: paper-scale-research-loop
description: Use this skill when the goal is to keep a broad research topic fixed while iteratively revising hypotheses, running real experiments with baselines/comparators, and improving the manuscript until it reaches paper-scale quality.
---

# Paper-Scale Research Loop

## Purpose
This skill is for producing a **real experimental paper candidate**, not merely a system-complete run.

It is designed for cases where you want:
- a broad topic to stay fixed
- hypotheses to evolve inside that topic
- real experiments with baselines/comparators
- result tables and quantitative evidence
- claim→evidence linkage
- limitations and failure cases
- an actual path toward paper-ready quality

This skill prioritizes:
- **verified research claims over paper-like prose**
- **broad-topic stability plus hypothesis refinement**
rather than prematurely locking in a narrow hypothesis.

## Use this skill when
Use this skill when the user wants:

- a paper-scale research loop
- a broad topic with revisable hypotheses
- real experiments with baselines
- a manuscript that is stronger than a research memo
- paper-ready pressure rather than just workflow completion

Typical trigger phrases:
- "paper-scale research"
- "real experiment paper"
- "baseline included"
- "broad topic"
- "revise the hypothesis as you go"
- "push toward paper-ready"

## What this skill enforces
It explicitly distinguishes:

- **workflow completed**
- **write_paper completed**
- **paper-shaped draft**
- **paper-ready experimental manuscript**

The first three are not enough.

## Broad topic rule
- The broad research topic must be fixed explicitly.
- A narrow hypothesis must not be frozen too early.
- AutoLabOS is expected to revise, branch, or prune hypotheses based on experiments, review findings, evidence gaps, and failure cases.
- The brief must define:
  - broad topic
  - objective metric
  - constraints
  - baselines/comparators
  - evaluation plan
- Hypothesis revision must be visible in artifacts and reporting.

## Hard gate: minimum paper-worthy conditions
If any of the following is missing, the result must be downgraded to something like `paper_ready=false`, `research_memo`, or `blocked_for_paper_scale`:

1. Explicit broad topic
2. A current hypothesis linked to that topic
3. Related work grounded in actual source material, not just titles
4. At least one explicit baseline or comparator
5. At least one actually executed experiment result
6. A numeric table or core quantitative comparison
7. Claim→evidence linkage for major claims
8. Limitations and/or failure cases in the manuscript
9. No mislabeling of workflow validation as research contribution

## Allowed hypothesis loop
This skill explicitly allows and encourages:

- generating an initial hypothesis
- refining a hypothesis after negative results
- adding comparators and revising the hypothesis
- branching into alternative hypotheses
- pruning weak branches
- focusing on the strongest branch
- upgrading the best branch into a paper candidate

The topic is fixed.
The hypothesis is allowed to evolve.

## Manuscript format rule
By default, for paper-generation validation:

- 2-column format
- 8-page main body
- References excluded
- Appendices excluded

This must be reflected both in the brief and in actual manuscript generation and evaluation.

## Two-layer paper evaluation
Use the current repository model:

- deterministic minimum gate
- LLM-based paper-quality evaluator

Rules:
- if the minimum gate is not met, optimistic LLM judgment must not promote the draft
- the LLM evaluator should drive strongest-branch selection, evidence-gap analysis, upgrade priority, and critique depth
- review remains a structural gate

## Loop goals
This skill drives two loops simultaneously:

1. **Research exploration loop**
   - maintain the broad topic
   - generate / revise / branch hypotheses
   - run real experiments
   - analyze outcomes

2. **Paper-quality improvement loop**
   - identify the strongest branch
   - improve baselines/comparators
   - improve result tables
   - improve claim→evidence linkage
   - improve limitation honesty
   - improve manuscript structure

## Stopping rule
Only consider stopping when one of the following is true:

- no meaningful hypothesis refinement remains within the broad topic
- repeated full cycles no longer improve paper-quality artifacts
- the strongest branch has largely exhausted its upgrade path
- the user explicitly stops the run

## Prohibited behaviors
- Do not define only a hypothesis without a broad topic.
- Do not treat toy runs or smoke validation as paper evidence.
- Do not declare paper-ready without baselines/comparators.
- Do not hide negative results or soften them rhetorically.
- Do not confuse `write_paper completed` with paper-ready.

## Good completion criteria
This skill has been used well when:

- the broad topic remained explicit and stable
- hypothesis revision history is preserved
- real experiments with baselines/comparators were run
- result tables and claim→evidence linkage exist
- the strongest branch was selected structurally
- review-gate pressure improved manuscript quality
- limitations and negative/failure cases are included honestly