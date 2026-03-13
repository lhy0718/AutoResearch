---
name: tui-live-validation
description: 작업이 실제 TUI 검증을 실행하거나 분석하는 것일 때, 인터랙티브 이슈를 재현할 때, fresh 세션과 기존 세션을 비교할 때, 또는 수정안을 제시하기 전에 구조화된 검증 보고서를 만들어야 할 때 이 스킬을 사용합니다.
---

# TUI Live Validation

## 목적
코드 변경을 제안하거나 평가하기 전에, 실제 TUI 워크플로우에 대한 구조화된 검증 결과를 생성합니다.

## 이 스킬을 사용하는 경우
사용자가 다음을 요청할 때 이 스킬을 사용합니다:
- TUI 실검증 실행
- 인터랙티브 버그 재현
- fresh TUI 세션과 이미 실행 중인 세션 비교
- persisted output이 UI에 표시되는 내용과 일치하는지 확인
- 수정이 실제 live 증상을 해결했는지 검증

대표적인 트리거 문구:
- "TUI 실검증"
- "live validation"
- "interactive bug 재현"
- "fresh session이랑 비교"
- "기존 세션만 stale"
- "실제로 실행해서 확인"
- "화면 표시가 이상함"

## 출력 형식
항상 다음 섹션을 출력합니다:

1. 검증 대상
2. 환경 / 세션 컨텍스트
3. 재현 절차
4. 기대 동작
5. 실제 동작
6. fresh 세션 vs 기존 세션 비교
7. persisted artifact vs UI 비교
8. 가능성이 높은 문제 영역
9. 권장되는 다음 단계

## 방법
1. 검증 대상을 한 문장으로 다시 정리합니다.
2. 관련된 흐름, 명령, 세션 모드, 또는 화면을 식별합니다.
3. 동작을 재현하거나 제공된 근거를 점검합니다.
4. 정확한 절차와 관찰 내용을 기록합니다.
5. 다음을 비교합니다:
   - fresh 세션 동작
   - 기존 세션 동작
   - persisted artifact
   - 화면에 보이는 최상위 summary 또는 projection
6. 이슈를 하나의 주요 범주로 분류합니다:
   - persistence bug
   - loader bug
   - projection / aggregation bug
   - refresh / subscription bug
   - resume / session bug
   - timing / race bug
   - renderer-only bug
7. 다음 행동을 권장합니다:
   - 경계 조사
   - 패치
   - 계측 추가
   - 더 좁은 가설로 재실행

## 가드레일
- 검증 기록을 작성하기 전에 바로 수정에 들어가지 마십시오.
- persisted 상태가 올바르다고 해서 live UI도 올바르다고 간주하지 마십시오.
- fresh reopen으로 문제가 해결된다면, in-memory projection, refresh 연결, resume 처리, 또는 세션 로컬 캐시를 명시적으로 의심하십시오.
- 관찰된 사실과 가설을 분리하십시오.
- 넓은 결론보다 정확한 재현 기록을 우선하십시오.

## 좋은 완료 기준
다음 조건을 만족하면 이 스킬은 완료입니다:
- 다른 에이전트가 재현할 수 있을 정도로 증상이 충분히 명확하게 기술되었고
- 필요할 때 fresh 세션과 기존 세션 동작이 명시적으로 비교되었으며
- 필요할 때 persisted 상태와 화면 표시 상태가 명시적으로 비교되었고
- 실패했을 가능성이 높은 경계가 좁혀졌음