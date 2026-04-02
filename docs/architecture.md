# Architecture (Harness-Focused)

This document captures the runtime contracts that must remain stable while improving quality enforcement.

## 1) Governed workflow contract

AutoLabOS operates around a governed fixed research workflow:

`collect_papers -> analyze_papers -> generate_hypotheses -> design_experiments -> implement_experiments -> run_experiments -> analyze_results -> figure_audit -> review -> write_paper`

The historical 9-node contract remains the architectural baseline for the research loop. `figure_audit` is the one approved post-analysis checkpoint added for independent figure-quality and vision-critique resume behavior. Beyond that deliberate checkpoint, the top-level governed workflow must remain stable unless an explicit contract change is made.

Do not casually add, remove, reorder, or redefine top-level nodes.

A top-level workflow change is allowed only when all of the following are true:

- the change clearly improves the research/runtime contract rather than duplicating an existing stage
- inspectable state transitions are preserved
- artifact audibility is preserved
- reproducibility is preserved
- review gating and claim-ceiling discipline are preserved
- safe backtracking behavior is preserved
- the change is reflected consistently in docs, runtime behavior, and validation expectations

Until those conditions are met, treat the governed workflow shape as fixed.

## 2) Shared runtime surfaces

- TUI (`autolabos`) and local web ops UI (`autolabos web`) share the same interaction/runtime layer.
- Node execution and transitions are controlled by `StateGraphRuntime`.
- Runtime events are persisted per run in `.autolabos/runs/<run-id>/events.jsonl`; high-churn telemetry should go there rather than into the run index surfaces.
- Deferred `collect_papers` recovery state is persisted in `.autolabos/runs/<run-id>/collect_background_job.json` whenever background enrichment is active, so restart recovery stays inspectable.
- Approval mode and transition recommendation behavior are part of runtime contracts.
- `/approve` must respect stored non-advance pending transitions (for example `analyze_results -> backtrack_to_design`) instead of advancing by graph order. Explicit manual `/agent run <next-node>` handoffs may resume `pause_for_human` transitions without weakening default approval behavior.

Harness and runtime work must preserve both TUI and web behaviors unless a change is explicitly requested.

## 3) Artifact model

- Run-scoped source of truth: `.autolabos/runs/<run-id>/...`, including `run_record.json` for the full persisted run snapshot
- Sqlite-backed operational hot path: `.autolabos/runs/runs.sqlite` for list/get/search/update index traffic plus sqlite-maintained usage, checkpoint, event, and artifact metadata indexes
- Lightweight compatibility mirror/projection: `.autolabos/runs/runs.json` (status, node pointer, pending transition, aggregate `usage`, without long transition-history payloads)
- Public mirrored outputs: `outputs/` (single latest-run public bundle)
- Checkpoints and run context are persisted under each run directory.
- Design/execution experiment contracts live in `experiment_portfolio.json` and `run_manifest.json`.
- Managed-bundle matrix slices, when materialized, are persisted as `trial_group_matrix.json` plus per-slice `trial_group_metrics/*.json`.
- Transition/gate decisions remain inspectable through artifacts such as `transition_recommendation.json`, `analysis/evidence_scale_assessment.json`, `review/*`, and `paper/write_paper_eligibility.json`.

Quality checks should be deterministic and file-based whenever possible.

Public-facing outputs must remain traceable to underlying run artifacts.

Because events, checkpoints, background-job recovery, and execution artifacts already live in per-run files, long-lived/full-fidelity run state should stay under the run directory and be projected into index surfaces only as needed for list/search flows. In the current rollout, `runs.sqlite` carries the operational run-index hot path plus sqlite-maintained usage/checkpoint/event/artifact indexes, while `runs.json` remains a compatibility mirror for inspection, doctor/harness checks, and legacy fixtures. Append-only artifacts should still live in per-run files rather than in sqlite or `runs.json`; sqlite should mirror their query-heavy metadata, not replace the files themselves.

## 4) Node-internal loops are bounded

Internal control loops inside nodes are allowed and expected, including loops in analysis, design, implementation, execution, result interpretation, and writing.

However, these loops must remain:

- bounded
- auditable through artifacts or logs
- consistent with node purpose
- non-destructive to top-level workflow clarity

Node-internal iteration must not be used to smuggle in an undeclared top-level workflow redesign.

## 5) Review and paper-readiness contract

`review` is a gate, not a cosmetic pass.

The system must not treat workflow completion, `write_paper` completion, or successful PDF generation as equivalent to paper-ready research.

Top-level progression to paper-writing behavior should preserve the distinction between:

- system completion
- artifact completion
- research completion
- paper readiness

A paper-scale outcome requires evidence beyond successful orchestration, including baseline/comparator presence, real experiment execution, quantitative comparison, and claim-to-evidence linkage.

Page-budget semantics should also remain explicit:

- `paper_profile.target_main_pages` drives main-body writing budgets
- `paper_profile.minimum_main_pages` gates the compiled-PDF floor check
- legacy `paper_profile.main_page_limit` is only a compatibility alias during migration and should not be treated as a hard maximum

## 6) Research brief contract

A governed run should begin from a research brief that defines the execution contract.

At minimum, the brief structure should align with `docs/research-brief-template.md`, including:

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

Missing governance fields should be treated as execution risks, not harmless omissions.

For brief-governed runs, the brief is not only advisory prose. The runtime should enforce it as a contract:

- `design_experiments` should materialize brief completeness / design consistency artifacts and stop progression on explicit contract gaps.
- `analyze_results` should compare executed evidence against the brief's minimum acceptable evidence and emit a deterministic evidence-scale assessment.
- `review` should treat weak brief-governed evidence as a backtrack condition, not merely a drafting warning.
- `write_paper` should fail fast when pre-draft critique or brief-evidence assessment still classifies the run below paper scale.

## 7) Validation surfaces are first-class

The following are first-class validation surfaces for contract enforcement:

- real TUI validation
- local web validation
- targeted tests
- smoke checks
- harness validation
- artifact inspection
- `/doctor` diagnostics when applicable

For interactive defects, real behavior is the primary ground truth.
Tests and harness checks support but do not replace same-flow revalidation.

## 8) Harness engineering goals

- Turn important quality assumptions into explicit checks.
- Keep checks cheap enough for routine CI.
- Fail early on structural incompleteness such as missing required artifacts or malformed records.
- Keep enforcement incremental and compatible with current contracts.
- Prefer minimal, high-confidence enforcement that improves observability and reproducibility.

## 9) Reproducibility contract

A run should not be treated as trustworthy unless its outputs and transitions can be inspected and rechecked.

When applicable, validation should confirm:

- checkpoint/state consistency
- consistency between public-facing outputs and run-scoped artifacts
- observable behavioral change, not only modified code paths
- explicitly stated remaining validation or reproducibility gaps

## 10) Non-goals for this track

- No redesign of product UX without an explicit product-direction decision.
- No broad refactor of orchestration/runtime without contract justification.
- No speculative replacement of existing node logic.
- No weakening of review gating, evidence discipline, or reproducibility expectations for convenience.

## 11) Exploration Engine (P2-9)

### 왜 fixed 9-node graph를 유지하는가

AutoLabOS의 핵심 가치는 governed, checkpointed, inspectable workflow다.
Exploration Engine은 이 graph를 대체하지 않는다.
`figure_audit`를 제외한 exploration 관련 신규 상위 노드는 추가하지 않는다.

### Exploration Manager가 내부 coordinator인 이유

새로운 상위 노드를 추가하면 기존 checkpoint/resume 계약이 깨진다.
ExplorationManager는 기존 노드 핸들러 내부에서 초기화되고, 자체 파일시스템(`experiment_tree/`)에 상태를 저장한다.
즉, `design_experiments ~ analyze_results` 구간의 bounded coordinator이지, `StateGraphRuntime`를 우회하는 별도 오케스트레이터가 아니다.

### Bounded Exploration Engine 삽입 위치

- `design_experiments` → ExplorationManager 초기화, baseline proposal
- `implement_experiments` → tree node 코드 구현
- `run_experiments` → tree node 실행
- `analyze_results` → evidence 수집, Gate 1+2(결정론적), promotion gate, writeup manifest 생성
- `figure_audit` → Gate 3(vision LLM critique) + 전체 audit 집계 → `figure_audit_summary.json`
- `review` → figure audit 결과 반영, strongest defensible branch 판정

### figure_audit 노드를 별도 추가한 이유

Gate 1+2는 결정론적이고 실행 시간이 1초 미만이므로 `analyze_results` 후처리로 충분하다.
Gate 3(vision LLM)는 실행 시간이 분 단위이고 비동기 LLM 호출이며 타임아웃/실패가 가능하다.
Gate 3 실패 시 `analyze_results` 전체를 재실행해야 하는 책임 혼재를 피하고, `analyze_results 완료 / figure_audit 미완` 상태를 독립 체크포인트로 resume할 수 있어야 한다.
`figure_auditor.enabled=false`이면 `figure_audit` 노드는 pass-through로 동작해 기존 경로와 동일한 결과를 낸다.

### Baseline Lock과 Single-Change Enforcement

`baseline_hardening` stage 완료 시 baseline lock이 생성된다.
이후 모든 branch는 lock의 `allowed_intervention_dimensions` 안에서 단 하나의 dimension만 바꿀 수 있다.
동시에 두 dimension이 바뀌면 `singleChangeEnforcer`가 차단한다.

### Executed-Evidence-Only와 Claim Ceiling의 연결

claim ceiling (`paperMinimumGate.ts`)은 claim-evidence 정합성을 검사한다.
`evidenceSerializer`는 그 이전 단계에서 미실행 항목이 claim source로 진입하지 못하도록 차단한다.
두 메커니즘은 독립적이지만 상호 보완적이다.

### Figure Auditor 역할

`figure_audit`는 `analyze_results` 완료 후, review 입력 전에 동작하는 품질 gate다.
역할은 미적 개선이 아니라 증거 정합성(`evidence_alignment`), 가독성, 게재 가능성(`publication_readiness`) 판정이다.
`empirical_validity_impact`와 `publication_readiness`는 별도 필드로 분리 저장된다.
severe mismatch는 review decision을 `revise` 이상으로 격상시킨다.

### AI-Scientist-v2와의 차이

유사점:
- experiment manager
- tree-based exploration
- stage-based policy
- search budget

차이점:
- AutoLabOS는 governed fixed graph를 유지하며 exploration tree가 그 안에 내장된다. `figure_audit`는 Gate 3의 독립 체크포인트 필요성 때문에 추가된 노드이며, exploration engine 자체가 상위 workflow를 늘리는 방식은 아니다.
- single-change enforcement와 baseline lock이 필수 gate다.
- review gate가 단순 LLM 점수가 아닌 5-specialist panel + 2-layer 구조다.
- checkpointed resume와 audit trail이 핵심 요구사항이다.
- Figure Auditor가 별도 노드로 분리되어 비동기 vision critique를 독립 resume 가능하게 한다.
