---
name: stale-state-triage
description: 이슈가 stale UI 상태, stale 최상위 요약, refresh 불일치, resume 불일치, 또는 persisted artifact와 활성 인터랙티브 세션 간 불일치를 포함할 때 이 스킬을 사용합니다.
---

# Stale State Triage

## 목적
수정을 구현하기 전에 stale-state 버그를 가장 가능성이 높은 최소 실패 경계까지 좁힙니다.

## 이 스킬을 사용하는 경우
다음과 같은 이슈에 이 스킬을 사용합니다:
- stale된 최상위 요약
- 새로 저장된 persisted output이 UI에 반영되지 않음
- fresh session은 정상인데 기존 세션은 stale 상태로 남아 있음
- resume/reopen 동작이 live session 동작과 다름
- persisted data와 렌더링된 뷰 사이에 상태 드리프트가 있음

대표적인 트리거 문구:
- "stale"
- "top-level summary가 안 바뀜"
- "fresh로 열면 정상"
- "기존 세션만 이상함"
- "runs.json은 맞는데 UI가 틀림"
- "refresh 경로 문제 같음"
- "in-memory projection 문제"

## 필수 출력
항상 다음을 출력합니다:

1. 증상 요약
2. source-of-truth 상태
3. 세션 비교
4. 가장 가능성이 높은 실패 경계
5. 그 경계를 뒷받침하는 근거
6. 가장 위험이 낮은 수정 방향
7. 회귀 위험

## 경계 모델
다음 모델을 사용해 버그를 좁힙니다:

- persisted artifact 계층
- loader / read 계층
- projection / aggregation 계층
- refresh / subscription / invalidation 계층
- session resume / restore 계층
- renderer presentation 계층
- 계층 간 timing / race 경계

## 방법
1. 변경된 source of truth를 식별합니다.
2. persisted artifact가 그 새로운 truth를 반영하는지 확인합니다.
3. fresh process/session이 그 truth를 표시하는지 확인합니다.
4. 현재 실행 중인 세션만 stale 상태로 남아 있는지 확인합니다.
5. 어떤 경계가 업데이트에 실패했을 가능성이 가장 높은지 판단합니다.
6. 가장 강한 근거를 명시합니다.
7. 가장 위험이 낮은 수정 방향을 제안합니다.

## 수정 방향 규칙
다음 순서로 수정 방향을 우선합니다:
1. 누락된 refresh trigger
2. stale in-memory projection invalidation
3. resume / restore state refresh
4. loader refresh bug
5. renderer consumption bug
6. persistence bug

근거가 뒷받침되지 않는 한 persistence corruption으로 섣불리 확대 해석하지 마십시오.

## 가드레일
- "어떤 sync 문제인 것 같다" 같은 모호한 표현은 피합니다.
- 실패한 경계를 가능한 한 구체적으로 명명합니다.
- 근거와 추론을 분리합니다.
- fresh reopen으로 문제가 해결된다면, persistence corruption보다 refresh, projection, resume, 또는 cache-local 설명을 먼저 우선합니다.
- 계층 전반에 걸친 재작성보다 좁은 범위의 패치를 우선합니다.

## 좋은 완료 기준
이 스킬은 다음 조건을 만족하면 완료입니다:
- 하나의 주요 실패 경계가 식별되었고
- 그 선택이 근거로 뒷받침되며
- 권장된 패치 방향이 작고 테스트 가능하고
- 가능성 있는 회귀가 명시적으로 언급되었음