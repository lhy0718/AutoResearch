# ISSUES.md

## Current status
- Last updated: 2026-03-14T21:46 (local)
- Current validation target: `test/` 실제 TUI에서 `/new` -> `/brief start --latest` 경로 1회가 `write_paper`까지 정상 완료되는지 검증
- Current test/ workspace: `test/tui-live-cycle-20260314-live205507` (fresh repro), `test/tui-live-cycle-20260314-12` (baseline repro)
- Current active run: `84b99657-e0c6-4e7d-92a3-07c66cce1383` (analyze timeout path -> generate_hypotheses rollback)
- Current overall state: re-validating

## Active issues
### Issue: zero-evidence analyze path still blocks end-to-end completion (generate_hypotheses rollback loop)
- Status: open
- First seen in: `test/tui-live-cycle-20260314-live205507` 재시도 경로
- Validation target: analyze 실패 경계에서도 workflow가 manual dead-end 없이 회복 경로를 타고 1회 cycle 완료까지 도달
- Symptom: timeout-only analyze 실패 시 `needs_approval`로 pause 후 `/approve`를 누르면 `generate_hypotheses`가 "evidence 없음"으로 3회 실패하고 auto-rollback으로 `analyze_papers` pending으로 복귀
- Expected: zero-evidence 상황에서 다음 단계로 진입하지 않거나, 진입하더라도 rollback loop 없이 명확한 recovery action으로 수렴
- Actual: bounded analyze 실패는 기록되지만, 승인 후 `generate_hypotheses` 실패-rollback 루프가 cycle 완료를 막음
- Scope: analyze->generate_hypotheses transition policy / zero-evidence gating / rollback recovery UX
- Evidence:
  - `test/tui-live-cycle-20260314-12/.autolabos/runs/runs.json` (generate_hypotheses failed + rollbackCounters.generate_hypotheses = 1)
  - `test/tui-live-cycle-20260314-12/.autolabos/runs/84b99657-e0c6-4e7d-92a3-07c66cce1383/checkpoints/latest.json`
  - poll 기록: short-timeout live 검증에서 `running -> paused(needs_approval)` 전이는 확인되나 이후 `/approve`에서 `generate_hypotheses` 실패/rollback
- Suspected root cause: analyze zero-output 경계에 대한 transition recommendation이 "다음 노드 승인 진행"과 "분석 재시도 필요"를 충분히 분리하지 못해 실패 루프를 유발
- Fix strategy: zero-evidence analyze pause 시 `/approve`가 generate_hypotheses로 전진하지 않도록 transition policy를 tighten하거나 explicit retry-only recommendation으로 제한
- Owner agent: investigator -> fixer
- Files involved: `src/core/nodes/analyzePapers.ts`, `src/core/stateGraph/runtime.ts` (transition handling), 필요 시 `src/core/runs/interactiveRunSupervisor.ts`
- Tests added/updated under tests/: `tests/analyzePapers.test.ts`, `tests/terminalAppPlanExecution.test.ts`, `tests/renderFrame.test.ts`
- Live-validation artifacts under test/: `test/tui-live-cycle-20260314-live205507`, `test/tui-live-cycle-20260314-12`
- Latest result: `/approve` no-op 오해 유발 문제 및 long-running 무진행 경계는 완화됨(실검증에서 timeout 후 pause 경계 확인). 단, cycle 완료 blocker는 zero-evidence rollback loop로 이동.
- Next probe: zero-evidence analyze 결과에서 `suggestedCommands`/transition action을 retry-first로 고정했을 때 generate_hypotheses rollback loop가 사라지는지 live 재검증
- Exit condition: `/new` -> `/brief start --latest` 경로의 1회 run이 `completed`로 끝나고, 중간 stale-running/무진행 구간이 재현되지 않음

## Current iteration log
### Iteration 1
- Goal: fresh live 검증으로 baseline timeout/zero-output 패턴 재확인 및 artifact/UI 비교
- What was validated in test/: `test/tui-live-cycle-20260314-live205507`에서 `/new` -> `/brief start --latest` 실행, collect 200 확보, fresh vs existing 비교
- What broke: analyze 재시도/중단 경계에서 진행 표시 일관성이 약함 (stale-running 계열 관찰)
- What changed: 없음 (관찰/증거 수집)
- Tests run: 없음 (live-first)
- Re-validation result: full cycle 미완료
- Decision: continue

### Iteration 2
- Goal: paused/pending 상태에서 `/approve` 오해 유발 no-op 제거, 올바른 `/retry` 경로를 명시
- What was validated in test/: `test/tui-live-cycle-20260314-12`에서 paused canceled run에 대해 `/approve` 동작 재검증
- What broke: 이전에는 `/approve`가 성공처럼 보이지만 실제 상태 변화 없음
- What changed:
  - `src/tui/TerminalApp.ts`: no pending approval 시 `/approve`를 거부하고 `/retry` 안내
  - `src/interaction/InteractionSession.ts`: 동일 guard 적용
  - `src/tui/renderFrame.ts`: paused+non-approval 상태 placeholder를 `/retry` 중심으로 변경
  - `tests/terminalAppPlanExecution.test.ts`: `/approve` no-op guard 테스트 추가
  - `tests/renderFrame.test.ts`: paused non-approval placeholder 테스트 추가
- Tests run: `npx vitest run tests/terminalAppPlanExecution.test.ts tests/renderFrame.test.ts`
- Re-validation result: live TUI에서 `/approve` 시 더 이상 false-success 로그가 나오지 않고 `/retry` 안내가 표시됨
- Decision: continue

### Iteration 3
- Goal: analyze retry의 장시간 무진행 구간을 bounded-timeout + timeout-aware zero-output guard로 끊어 stalled-running을 제거
- What was validated in test/: `test/tui-live-cycle-20260314-12`에서 short-timeout live 재검증 (`AUTOLABOS_ANALYSIS_*_TIMEOUT_MS=5000`)
- What broke: `/approve` 후 generate_hypotheses가 evidence 부재로 3회 실패하고 auto-rollback되어 cycle 완료에 실패
- What changed:
  - `src/core/analysis/paperAnalyzer.ts`: planner/extractor/reviewer default timeout을 각각 20s/45s/20s로 bounded
  - `src/core/nodes/analyzePapers.ts`: timeout-only zero-output 실패에 대해 early-pause sample을 완화(2 -> 3)하여 과도한 조기 중단 완화
  - `tests/analyzePapers.test.ts`: timeout-only 실패 샘플 정책 회귀 테스트 추가
- Tests run:
  - `npx vitest run tests/analyzePapers.test.ts tests/paperAnalyzer.test.ts tests/terminalAppPlanExecution.test.ts tests/renderFrame.test.ts tests/interactionSession.test.ts`
- Re-validation result:
  - 이전: `running + 0 output` 장시간 정체
  - 이후: live에서 `running -> paused(needs_approval, first 3/30 failed)`로 전이 확인 (stalled-running 경계 완화)
  - 미해결: 승인 후 `generate_hypotheses` rollback loop
- Decision: continue
