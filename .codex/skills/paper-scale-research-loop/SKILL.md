---
name: paper-scale-research-loop
description: Use this skill when the goal is to move AutoLabOS outputs from workflow completion toward evidence-backed, baseline-bearing, paper-scale research quality.
---

# Paper-Scale Research Loop

## Purpose
Drive real experiments, hypothesis refinement, evidence review, and manuscript improvement until the strongest branch is honestly judged against paper-scale standards.

This skill exists to prevent:
- workflow completion from being misreported as research completion
- write_paper completion from being misreported as paper readiness
- polished text from being mistaken for evidence-backed claims

## Use this skill when
Use this skill when the user asks to:
- assess research quality
- improve experiment quality
- judge manuscript readiness honestly
- push a topic toward paper scale
- decide whether outputs are only a memo, a draft, or a serious experimental paper candidate

## Required research discipline
Keep the broad topic fixed, but allow hypotheses and experiment design to evolve.

Always evaluate:
- broad topic
- current hypothesis
- related-work grounding
- baseline or comparator presence
- executed experiments
- quantitative result tables
- claim-to-evidence linkage
- limitations and failure cases
- strongest-branch selection

## Hard gate
Downgrade the output if any of the following are missing:
- fixed broad topic
- explicit current hypothesis
- grounded related work
- baseline/comparator
- real executed experiment
- quantitative comparison table
- claim-to-evidence linkage
- limitations/failure cases

## Output format
1. Current artifact status
2. Research-question status
3. Hypothesis status
4. Related-work depth
5. Experimental evidence status
6. Baseline/comparator status
7. Quantitative result status
8. Claim-to-evidence linkage status
9. Limitations/failure-case status
10. Honest output genre recommendation
11. Strongest next action

## Guardrails
- Do not reward polish without evidence.
- Do not over-credit abstract-only or plan-only runs.
- Do not call something paper-ready unless the evidence supports it.
- Prefer the strongest validated branch, not the most verbose one.