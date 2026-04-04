# Paper Quality Bar (Structural + Evidence Discipline)

This document captures minimum quality requirements around `write_paper` outputs.

It distinguishes between:
- paper-shaped draft
- system validation note
- research memo
- paper-ready experimental manuscript

A successful paper build is not automatically a paper-ready manuscript.

## 1) Structural artifact requirements
When `write_paper` succeeds:
- `paper/main.tex` must exist.
- `paper/references.bib` must exist.
- `paper/evidence_links.json` must exist.
- `paper/paper_readiness.json` should exist.
- `paper/paper_critique.json` must exist (post-draft critique artifact).
- `paper/claim_evidence_table.json` should exist when major claims are present.

## 2) Critique artifact requirements
The structured critique artifact (`paper_critique.json`) is emitted at two stages:
- `review/paper_critique.json` at `stage=pre_draft_review` (before drafting)
- `paper/paper_critique.json` at `stage=post_draft_review` (after drafting)

Each critique artifact must include:
- `manuscript_type`: one of `system_validation_note`, `research_memo`, `paper_scale_candidate`, `paper_ready`, `blocked_for_paper_scale`
- `overall_decision`: one of `advance`, `repair_then_retry`, `backtrack_to_implement`, `backtrack_to_design`, `backtrack_to_hypotheses`, `pause_for_human`
- `blocking_issues` and `non_blocking_issues` arrays with actionable issue objects
- Category scores for 10 quality dimensions
- Upstream deficit flags: `needs_additional_experiments`, `needs_additional_statistics`, `needs_additional_related_work`, `needs_design_revision`

## 3) Two-stage gating discipline
`write_paper completed` is NOT equivalent to `paper_ready`.

### Pre-draft gate (review)
`review` emits a pre-draft critique before allowing progression to `write_paper`.
If the evidence package is insufficient, `review` recommends backtrack instead of advance.
When a governed brief declares a minimum evidence floor, `review` should also honor the brief's paper ceiling instead of allowing a `research_memo`-grade run to drift into drafting.

### Post-draft critique (write_paper)
After drafting, `write_paper` emits a post-draft critique that can:
- Confirm `paper_ready` status if the manuscript is strong
- Recommend `repair_then_retry` for writing/style-only issues
- Recommend upstream backtrack for evidence/design/experiment deficits

### Write-paper entry gate
`write_paper` should fail fast before drafting when either of the following is already known:
- the pre-draft critique classifies the run below `paper_scale_candidate`
- the brief-governed evidence assessment says minimum acceptable evidence was not met

In that case the correct action is upstream repair/backtrack, not spending drafting or PDF-compilation effort on a manuscript that should still be blocked.

### Page-budget semantics
`write_paper` should treat page budgets as explicit targets/floors, not as an implicit upper cap:

- brief-derived main-body page targets are used for writing budgets
- brief-derived minimum main-body pages are checked after LaTeX build
- template-derived layout hints can adjust appendix format and word-budget estimation, but they do not replace the evidence bar

## 4) Template structure and manuscript critique
When a manuscript template is present, AutoLabOS uses it for structure and layout hints:
- preamble
- document class
- section order
- column layout
- appendix-format defaults

The critique system no longer introduces a separate style-target layer on top of the template.
Template handling is structural. Manuscript gating remains evidence- and quality-driven.

## 2) Evidence linkage sanity
`paper/evidence_links.json` must be structurally useful:
- contains a non-empty `claims` array when claims are present
- each major claim entry includes:
  - non-empty `claim_id`
  - non-empty statement text
  - at least one concrete evidence or citation reference
- reject obviously empty placeholder mappings
  - blank
  - `TODO`
  - `TBD`
  - `placeholder`
  - `unknown`

## 3) Claim-evidence table expectation
For papers that make experimental claims, `paper/claim_evidence_table.json` should map each major claim to:
- evidence source type
  - literature
  - experiment
  - qualitative observation
  - limitation
- artifact or citation reference
- confidence / strength level
- downgrade note when evidence is weak

If the manuscript makes claims that cannot be mapped back to evidence,
the review stage should block paper-ready status.

## 4) Review packet handoff discipline
Before drafting, review output should be structurally complete:
- review packet has core sections (`readiness`, `checks`, `suggested_actions`)
- decision and revision artifacts are present when decisioning is active
- readiness state explicitly distinguishes:
  - `system_validation_note`
  - `research_memo`
  - `paper_scale_candidate`
  - `paper_ready`
  - `blocked_for_paper_scale`

## 5) Paper-ready minimum gate
For a manuscript to be marked `paper_ready=true`, all of the following should hold:

1. The paper states a clear research question.
2. Related work is more than shallow title/abstract paraphrase.
3. The method section corresponds to actual executed work.
4. The experiment section identifies task/dataset/metric.
5. At least one baseline or comparator is explicit.
6. At least one quantitative result or compact result table is present.
7. Major claims are traceable to evidence.
8. Limitations or failure modes are stated.
9. The paper does not center internal workflow validation as the main scientific contribution.
10. Any brief-governed minimum evidence requirement (for example repeated runs, baseline count, or uncertainty reporting) has been satisfied.
11. The experiment evidence is not just a single thin run; it includes repeated trials or explicit robustness/uncertainty reporting.

## 6) Automatic downgrade / block conditions
The manuscript must not be labeled `paper_ready` when any of the following is true:
- no executed external experiment
- no baseline or comparator
- no result table or recoverable quantitative comparison
- claims exceed evidence
- related work is too shallow to support positioning
- the main contribution is really pipeline validation rather than research on an external task
- the evidence is only a single thin run with no repeated-trial or robustness support
- the manuscript is mostly generated filler around weak artifacts
- a governed brief explicitly required stronger evidence than the run actually produced

In such cases, downgrade to one of:
- `system_validation_note`
- `research_memo`
- `paper_scale_candidate`
- `blocked_for_paper_scale`

## 7) Claim strength and evidence discipline
- Do not overstate claims beyond available artifacts.
- If evidence is weak or incomplete, downgrade claim language explicitly.
- Do not fabricate statistics, confidence intervals, or reproducibility claims.
- Do not convert runtime completion into scientific success.
- Do not present workflow traces as if they were external experimental findings.

## 8) Related-work discipline
Related work should support positioning, not just decorate the paper.
At minimum:
- the paper should identify the most relevant comparator family
- the paper should position the proposed experiment against concrete prior approaches
- related work should not be purely metadata-level when stronger evidence is available
- if full-text grounding is limited, the manuscript should say so explicitly

## 9) Method/result consistency
The method and result sections must agree on what was actually run.
Do not claim:
- ablations that were not executed
- baseline comparisons that do not exist
- robustness checks that were not performed
- statistical procedures that were not run

## 10) Limitation discipline
A paper-ready manuscript must include limitations.
Typical limitations include:
- small dataset scope
- restricted compute budget
- shallow comparator set
- non-significant improvement
- sensitivity to prompts or implementation details
- incomplete literature coverage

## 11) Why this bar exists
Paper generation is the easiest place for weak evidence to become inflated prose.
This bar exists to preserve:
- honest scientific writing
- traceable claims
- clear downgrade paths
- operator trust in manuscript quality

## 12) Intended strictness
- Strict on structural artifact presence.
- Strict on claim→evidence linkage.
- Strict on blocking obviously underpowered “paper-ready” labels.
- Conservative on stylistic judgments.
