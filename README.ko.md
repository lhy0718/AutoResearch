<div align="center">
  <h1>AutoLabOS</h1>
  <p><strong>논문 수집부터 실험 실행, 논문 초안 작성까지 이어지는 AI 에이전트 기반 연구 자동화를 위한 로컬 TUI와 web ops UI</strong></p>
  <p>
    논문 수집과 근거 분석부터 실험 실행, 논문 초안 작성까지 이어지는 흐름을
    워크스페이스 로컬에 머무는 체크포인트 가능한 워크플로로 묶습니다.
  </p>
  <p>
    <a href="./README.md"><strong>English</strong></a>
    ·
    <a href="./README.ko.md"><strong>한국어</strong></a>
  </p>
  <!-- CI & Quality -->
  <p>
    <a href="https://github.com/lhy0718/AutoLabOS/actions/workflows/ci.yml">
      <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/lhy0718/AutoLabOS/ci.yml?branch=main&style=flat-square&label=ci&logo=githubactions&logoColor=white" />
    </a>
    <a href="https://github.com/lhy0718/AutoLabOS/actions/workflows/smoke.yml">
      <img alt="Smoke" src="https://img.shields.io/github/actions/workflow/status/lhy0718/AutoLabOS/smoke.yml?branch=main&style=flat-square&label=smoke&logo=githubactions&logoColor=white" />
    </a>
    <img alt="Tests" src="https://img.shields.io/badge/tests-826%20passed-22C55E?style=flat-square&logo=vitest&logoColor=white" />
  </p>

  <!-- Tech stack -->
  <p>
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" />
    <img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A518-339933?style=flat-square&logo=node.js&logoColor=white" />
    <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black" />
  </p>

  <!-- Core features — unified teal -->
  <p>
    <img alt="9-node graph" src="https://img.shields.io/badge/state%20graph-9%20nodes-0F766E?style=flat-square" />
    <img alt="Checkpointed" src="https://img.shields.io/badge/checkpoints-built%20in-0F766E?style=flat-square" />
    <img alt="Experiment Governance" src="https://img.shields.io/badge/experiments-governed-0F766E?style=flat-square" />
    <img alt="Claim Ceiling" src="https://img.shields.io/badge/claims-ceiling%20enforced-0F766E?style=flat-square" />
  </p>

  <!-- Integrations -->
  <p>
    <img alt="OpenAI" src="https://img.shields.io/badge/OpenAI-supported-412991?style=flat-square&logo=openai&logoColor=white" />
    <img alt="Codex CLI" src="https://img.shields.io/badge/Codex%20CLI-supported-412991?style=flat-square&logo=openai&logoColor=white" />
    <img alt="Ollama" src="https://img.shields.io/badge/Ollama-supported-1A1A2E?style=flat-square" />
    <img alt="Semantic Scholar" src="https://img.shields.io/badge/Semantic%20Scholar-integrated-1857B6?style=flat-square" />
  </p>

  <!-- Community -->
  <p>
    <a href="https://github.com/lhy0718/AutoLabOS/stargazers">
      <img alt="Stars" src="https://img.shields.io/github/stars/lhy0718/AutoLabOS?style=flat-square&color=f5a623" />
    </a>
    <a href="https://github.com/lhy0718/AutoLabOS/commits/main">
      <img alt="Last commit" src="https://img.shields.io/github/last-commit/lhy0718/AutoLabOS?style=flat-square&color=6c757d" />
    </a>
  </p>
</div>

## 왜 AutoLabOS인가?

- `collect_papers`부터 `write_paper`까지 연구 루프를 고정 9단계 상태 그래프로 다루며, 집필 전 `review` 단계를 둡니다.
- 메인 워크플로는 `codex` 또는 `OpenAI API` 중에서 고를 수 있고, PDF 분석 모드는 별도로 바꿀 수 있습니다.
- 체크포인트, 제한, 재시도, 점프, 런별 메모리를 통해 작업 상태를 로컬에서 추적하고 복구할 수 있습니다.

## 핵심 특징

| 기능 | 제공하는 가치 |
| --- | --- |
| 브리프 중심 TUI | `/new`로 brief를 만들고 `/brief start`로 실행한 뒤 `/agent ...`, `/model`, `/settings`, `/doctor`로 브리프 중심 워크플로를 터미널에서 제어 |
| 로컬 Web Ops UI | `autolabos web`으로 브라우저 온보딩, 대시보드 제어, 아티팩트, 체크포인트, 라이브 세션 상태를 확인 |
| 결정적 자연어 라우팅 | 자주 쓰는 의도는 LLM fallback 전에 로컬 핸들러나 슬래시 명령으로 우선 처리 |
| 하이브리드 provider | Codex 로그인 기반 흐름과 OpenAI API 기반 흐름을 상황에 맞게 선택 |
| PDF 분석 모드 | 로컬 텍스트 추출 + Codex, 또는 Responses API 직접 분석 중 선택 가능 |
| 연구 실행 패턴 | ReAct, ReWOO, ToT, Reflexion 패턴을 노드 성격에 맞게 사용 |
| 로컬 ACI 실행 | `implement_experiments`, `run_experiments`를 파일/명령/테스트 액션으로 수행 |
| 자율 연구 모드 | 장시간 개방형 연구 탐색, 가설→실험→분석 반복과 논문 품질 개선을 병행하는 Autonomous Mode 지원 |
| 2계층 논문 평가 | 결정적 최소 게이트 + LLM 기반 논문 품질 평가로 감사 가능한 초안 진입 판단 |

## 여기서 시작하세요

- 처음 써본다면 `autolabos web`부터 추천합니다. 온보딩, 대시보드, 로그, 체크포인트, 아티팩트 브라우징을 한 화면에서 볼 수 있습니다.
- 터미널 중심, 브리프 기반 워크플로를 선호한다면 `autolabos`로 시작하면 됩니다.
- 두 명령 모두 AutoLabOS가 관리할 연구 프로젝트 폴더에서 실행하세요. 워크스페이스 상태는 `.autolabos/` 아래에 저장됩니다.

## 준비물

| 항목 | 필요한 경우 | 메모 |
| --- | --- | --- |
| `SEMANTIC_SCHOLAR_API_KEY` | 항상 필요 | 논문 탐색과 메타데이터 조회에 사용 |
| `OPENAI_API_KEY` | 메인 provider 또는 PDF 모드가 `api`일 때만 필요 | OpenAI API 모델 실행에 사용 |
| Codex CLI 로그인 | 메인 provider 또는 PDF 모드가 `codex`일 때만 필요 | 로컬 Codex 세션을 사용 |

## 빠른 시작

1. AutoLabOS를 설치하고 빌드합니다.

```bash
npm install
npm run build
npm link
```

2. 워크스페이스로 사용할 연구 프로젝트 폴더로 이동합니다.

```bash
cd /path/to/your-research-project
```

3. 추천 경로인 브라우저 UI를 실행합니다.

```bash
autolabos web
```

기본 주소는 `http://127.0.0.1:4317`입니다. TUI에서 먼저 시작하고 싶다면 `autolabos`를 실행하면 됩니다.

4. 온보딩을 완료합니다. 아직 `.autolabos/config.yaml`이 없다면 웹에서는 onboarding이, TUI에서는 setup wizard가 열리며 같은 워크스페이스 스캐폴드와 설정을 작성합니다.

5. 첫 실행이 성공했는지 확인합니다. 프로젝트 안에 `.autolabos/config.yaml`이 생기고, 대시보드 또는 TUI 홈 화면에서 run을 시작할 수 있으면 준비가 끝난 것입니다.

6. TUI에서는 `/new`로 Markdown brief를 만든 뒤 `/brief start --latest`로 실행을 시작합니다. 웹에서는 구조화된 입력칸, 자연어 brief, 또는 워크플로 카드로 시작할 수 있습니다.

## 첫 실행에서 일어나는 일

- AutoLabOS는 워크스페이스 설정을 `.autolabos/config.yaml`에 저장하고, 실행 시 `process.env` 또는 `.env`의 `SEMANTIC_SCHOLAR_API_KEY`, `OPENAI_API_KEY`를 읽습니다.
- TUI 첫 실행 wizard는 모델 중심입니다. primary provider, model slot, reasoning 기본값, PDF 모드, 그리고 `api`가 필요할 때만 OpenAI API key를 묻습니다.
- TUI에서는 워크스페이스 폴더 이름이 자동으로 `project_name`이 되며, research brief를 명시적으로 시작하기 전까지 run을 만들지 않습니다.
- 기본 LLM provider를 고릅니다. `codex`는 로컬 Codex 세션을 사용하고, `api`는 OpenAI API 모델을 사용합니다.
- PDF 분석 모드는 별도로 고릅니다. `codex`는 로컬에서 텍스트를 추출한 뒤 분석하고, `api`는 PDF를 Responses API로 직접 보냅니다.
- 메인 provider 또는 PDF 모드가 `api`이면 onboarding과 `/settings`에서 OpenAI 모델을 선택할 수 있습니다.
- `/model`은 먼저 활성 백엔드를 고른 뒤, 나중에 슬롯과 모델을 다시 바꿀 수 있게 해줍니다.

## TUI Brief-First 흐름

- `/new`는 `.autolabos/briefs/<timestamp>-<slug>.md` 아래에 Markdown 템플릿을 만듭니다.
- `$EDITOR` 또는 `$VISUAL`이 설정되어 있으면 AutoLabOS가 brief를 그 편집기로 열고, 필수 섹션을 검증한 뒤 지금 바로 실행할지 한 번만 묻습니다.
- `/brief start <path>` 또는 `/brief start --latest`는 brief를 `.autolabos/runs/<run_id>/brief/source_brief.md`로 스냅샷하고, `topic`, `objective metric`, `constraints`, `plan`을 추출한 뒤 `collect_papers`부터 자동 시작합니다.
- 생성되는 템플릿은 `# Research Brief`, `## Topic`, `## Objective Metric`, `## Constraints`, `## Plan`을 필수 골격으로 쓰고, `## Notes`, `## Questions / Risks`는 선택입니다.
- `## Manuscript Format` 섹션을 추가하면 원고 형식 타깃을 지정할 수 있습니다.
- 자연어로 run을 바로 만드는 경로도 남아 있지만, TUI에서는 외부에서 편집 가능하고 추적 가능한 brief 파일을 남기는 file-first 흐름을 권장합니다.

### 원고 형식 타깃

Brief에 원고 형식 제약을 지정하면, TeX 생성과 섹션 길이 계획에 반영됩니다:

```markdown
## Manuscript Format
- columns: 2
- main_body_pages: 8
- references_excluded_from_page_limit: true
- appendices_excluded_from_page_limit: true
```

| 필드 | 기본값 | 효과 |
|---|---|---|
| `columns` | `2` | `\documentclass[twocolumn]{article}` 또는 단일 컬럼 |
| `main_body_pages` | `8` | 섹션별 단어 수 목표 계획에 사용 |
| `references_excluded_from_page_limit` | `true` | 참고 문헌이 페이지 제한에 포함되지 않음 |
| `appendices_excluded_from_page_limit` | `true` | 부록이 페이지 제한에 포함되지 않음 |

형식이 지정되면 page budget manager가 섹션별 단어 수를 목표에 맞추고, scientific_validation.json에 규정 준수 상태를 보고합니다.

## 처음 사용자용 문제 해결

- 저장소 체크아웃 환경에서 웹 자산이 없다는 메시지가 보이면, AutoLabOS 패키지 루트에서 `npm --prefix web run build`를 한 번 실행한 뒤 `autolabos web`을 다시 시작하세요.
- `npm link`를 쓰지 않으려면 AutoLabOS 저장소 루트에서 `node dist/cli/main.js` 또는 `node dist/cli/main.js web`으로 실행할 수 있습니다.
- 다른 호스트나 포트가 필요하면 `autolabos web --host 0.0.0.0 --port 8080`을 사용하세요.
- 로컬 개발 모드는 `npm run dev`, `npm run dev:web`입니다.

## Web Ops UI

`autolabos web`은 TUI와 같은 런타임을 공유하는 로컬 단일 사용자용 브라우저 UI를 실행합니다.

- 온보딩은 같은 비대화형 setup helper를 사용하므로, 웹에서 초기 설정해도 TUI wizard와 동일한 `.autolabos/config.yaml`과 `.env` 값이 생성됩니다.
- 대시보드에서 run 검색/선택, 9개 노드 워크플로 보기, 노드 액션, 라이브 로그, 체크포인트, 아티팩트, 메타데이터, `/doctor` 요약을 확인할 수 있습니다.
- 하단 컴포저는 슬래시 명령과 지원되는 자연어 입력을 모두 받습니다.
- 새 run은 구조화된 입력칸으로 만들 수도 있고, 하나의 자연어 research brief로 만들 수도 있습니다. brief parser가 주제, 목표 지표, 제약, 짧은 계획 힌트를 추출한 뒤 `collect_papers`부터 바로 자동 시작할 수 있습니다.
- 복합 자연어 실행 계획은 `y/a/n` 대신 `Run next`, `Run all`, `Cancel` 버튼으로 제어합니다.
- 아티팩트 브라우저는 `.autolabos/runs/<run_id>` 범위로 제한되며, 주요 텍스트 파일·이미지·PDF는 inline preview를 제공합니다.

웹 사용 흐름:

1. `autolabos web`으로 서버를 시작합니다.
   관리하려는 연구 프로젝트 폴더에서 실행합니다.
   저장소 체크아웃 환경에서 웹 자산이 없다는 메시지가 나오면 AutoLabOS 패키지 루트에서 `npm --prefix web run build`를 한 번 실행한 뒤 서버를 다시 시작합니다.
2. 브라우저에서 `http://127.0.0.1:4317`을 엽니다.
3. 아직 설정되지 않았다면 onboarding을 완료합니다.
4. run을 만들거나 선택한 뒤 워크플로 카드나 컴포저로 실행을 제어합니다.

## 노드와 에이전트 구조

AutoLabOS에는 이름이 비슷해서 헷갈리기 쉬운 두 레이어가 있습니다.

- 오케스트레이션 레이어: `/agent ...`가 대상으로 삼는 9개 그래프 노드입니다. 코드에서는 `AgentId`가 현재 `GraphNodeId`의 alias입니다.
- 역할 레이어: 각 노드 내부 프롬프트, 이벤트, 세션 매니저에서 쓰는 export된 `agentRole` 정체성입니다. 예를 들면 `implementer`, `runner`, `paper_writer`, `reviewer`가 여기에 속합니다.
- 일부 노드는 여기서 한 단계 더 내려가 node 내부 정체성이나 결정적 컨트롤러로 fan-out합니다. 프롬프트 중심 예시는 `generate_hypotheses` 안의 evidence synthesizer + skeptical reviewer, 그리고 `review` 안의 5인 specialist panel이고, 결정적 패널/컨트롤러 예시는 이제 `design_experiments`, `run_experiments`, `analyze_results`에도 들어갑니다.

### 노드와 역할 매핑

- `Node` 열부터 읽으면 됩니다. `/agent ...`는 항상 이 9개 노드 중 하나를 대상으로 삼습니다.
- `Exported role(s)`는 프롬프트, 이벤트, 세션 매니저에서 보이는 공개 `agentRole` 정체성입니다.
- `Internal helpers`는 노드 내부에서만 쓰는 persona 또는 결정적 controller이지, 별도의 상위 `/agent` 대상은 아닙니다.

| Node | Exported role(s) | Internal helpers | 추가 레이어가 하는 일 |
| --- | --- | --- | --- |
| `collect_papers` | `collector_curator` | 없음 | 후보 논문 집합을 수집하고 정리합니다 |
| `analyze_papers` | `reader_evidence_extractor` | 없음 | 선택된 논문에서 요약과 근거를 추출합니다 |
| `generate_hypotheses` | `hypothesis_agent` | `evidence synthesizer`, `skeptical reviewer` | 아이디어를 만들고 바로 비판적으로 압박합니다 |
| `design_experiments` | `experiment_designer` | `feasibility reviewer`, `statistical reviewer`, `ops-capacity planner` | 실행 가능성, 통계 품질, 실행 적합성을 함께 점검합니다 |
| `implement_experiments` | `implementer` | 없음 | ACI 액션으로 코드와 워크스페이스 변경을 만듭니다 |
| `run_experiments` | `runner` | `trial manager`, `failure triager`, `resource/log watchdog`, `rerun planner` | 실행을 관리하고 실패를 분류하며 재실행 여부를 판단합니다 |
| `analyze_results` | `analyst_statistician` | `metric auditor`, `robustness reviewer`, `confounder detector`, `decision calibrator` | 결과가 다음 판단에 쓸 만큼 견고한지 점검합니다 |
| `review` | `reviewer` | `claim verifier`, `methodology reviewer`, `statistics reviewer`, `writing readiness reviewer`, `integrity reviewer` | 초안 작성 전 다전문가 검토 게이트를 수행합니다 |
| `write_paper` | `paper_writer`, `reviewer` | 없음 | 논문 초안을 작성하고 reviewer 시각으로 한 번 더 비평합니다 |

### 실행 그래프

```mermaid
stateDiagram-v2
    [*] --> collect_papers
    collect_papers --> analyze_papers: complete
    analyze_papers --> generate_hypotheses: complete
    generate_hypotheses --> design_experiments: complete
    design_experiments --> implement_experiments: complete
    implement_experiments --> run_experiments: auto_handoff 또는 complete
    run_experiments --> analyze_results: complete
    analyze_results --> review: auto_advance
    analyze_results --> implement_experiments: auto_backtrack_to_implement
    analyze_results --> design_experiments: auto_backtrack_to_design
    analyze_results --> generate_hypotheses: auto_backtrack_to_hypotheses
    analyze_results --> analyze_results: human_clarification_required
    review --> write_paper: auto_advance
    review --> implement_experiments: auto_backtrack_to_implement
    review --> design_experiments: auto_backtrack_to_design
    review --> generate_hypotheses: auto_backtrack_to_hypotheses
    write_paper --> [*]: auto_complete
```

상위 워크플로우는 계속 고정 9노드 그래프입니다. 최근 자동화는 노드 내부의 bounded loop로 들어가므로, evidence window 확장, 보강 실험 프로필, objective grounding 재시도, 논문 초안 repair 때문에 상위 노드를 더 늘리지는 않습니다.

### 실행 제어 표

| 계층 | 설정 또는 명령 | 기본값 | 하는 일 | 사람이 개입하는 시점 |
| --- | --- | --- | --- | --- |
| Workflow mode | `agent_approval` | 고정 | 논문 수집부터 논문 작성까지 9개 노드 연구 그래프를 실행 | 자체적으로 pause를 만들지는 않음 |
| Approval mode | `workflow.approval_mode: minimal` | 예 | 일반 완료 게이트를 자동 승인하고, review 결과를 포함한 안전한 전이 추천을 자동 적용 | recommendation이 `pause_for_human`이거나 `autoExecutable=false`이면 멈춤 |
| Approval mode | `workflow.approval_mode: manual` | 선택 | 자동 해소 대신 모든 승인 경계에서 멈춤 | `/approve`, `/agent apply`, `/agent jump` 같은 명시적 명령으로 진행 |
| Overnight | `/agent overnight` | 필요할 때만 실행 | 보수적인 야간 자동운전 정책 (24시간 제한) | `write_paper` 직전, low-confidence 또는 허용되지 않은 backtrack, 반복 recommendation, 시간 제한, 수동 전용 recommendation에서 멈춤 |
| Autonomous | `/agent autonomous` | 필요할 때만 실행 | 장시간 개방형 자율 연구 탐색 (시간 제한 없음) | 사용자 명시적 중단, 자원 한계, 정체 감지, 비상 퓨즈에서 멈춤 |
| TUI supervisor | Interactive run supervisor | `autolabos` 기본 동작 | `minimal` 모드로 run을 계속 진행하고, 재시작 후에도 pending question을 복원하며, 실제 사람 답변이 필요할 때만 제어를 돌려줌 | 같은 TUI 안에서 답변을 받고 지정된 resume action을 적용한 뒤 자동으로 다시 실행 |

### 인간 개입이 필요한 조건

| 위치 | 조건 | 결과 |
| --- | --- | --- |
| `analyze_results` | best-effort metric rematch 뒤에도 objective metric을 구체적인 수치 신호에 연결하지 못함 | TUI가 어떤 metric 또는 성공 기준을 쓸지 질문하고, 답변을 저장한 뒤 `analyze_results`를 재시도하고 자동 실행을 이어감 |
| `analyze_results` | hypothesis reset 추천이 나왔지만 confidence가 낮아 `autoExecutable=true`가 아님 | TUI가 명시적인 다음 단계 선택지를 보여주고, 선택된 transition 또는 jump를 적용한 뒤 자동 실행을 이어감 |
| 모든 노드 (`manual` approval mode) | 노드가 승인 경계에 도달함 | `/approve`, `/agent apply`, 또는 다른 명시적 운영자 선택을 기다림 |
| `/agent overnight` | `write_paper` 도달, low-confidence 또는 비허용 recommendation, recommendation 반복 과다, 24시간 제한 도달 | overnight 실행을 중단하고 운영자에게 제어를 돌려줌 |
| `/agent autonomous` | 명시적 사용자 중단, 자원 한계, 정체(stagnation) 임계치 초과, 비상 퓨즈 | autonomous 실행을 중단하고 운영자에게 제어를 돌려줌 |

기본 설정에서는 review 결과가 자동으로 `write_paper` 또는 지원되는 backtrack으로 적용됩니다. `minimal` 모드에서 review는 별도의 수동 hold 지점이 아닙니다.

### Bounded Automation 및 내부 패널

| 노드 | 내부 자동화 | 트리거 | 제한 또는 산출물 |
| --- | --- | --- | --- |
| `analyze_papers` | fresh `top_n` 선택을 자동 확장하고 manifest 기반 완료 분석을 재사용 | 처음 선택된 범위의 evidence가 너무 얇아 가설 grounding이 약할 때 | 최대 2회 자동 확장 |
| `design_experiments` | 생성된 후보를 결정적인 `designer / feasibility / statistical / ops-capacity` 패널로 점수화하고 선택 | `designExperimentsFromHypotheses(...)`가 후보 설계를 반환했을 때 | 설계 실행마다 1회 수행되며 내부 `design_experiments_panel/*` 아티팩트를 남김 |
| `run_experiments` | execution plan을 만들고, 실패를 분류하고, transient failure에 대해 1회 자동 재시도 정책을 적용 | primary run command가 해석되었을 때 | policy block, missing metrics, invalid metrics는 재시도하지 않고, transient command failure만 1회 재시도 |
| `run_experiments` | managed `standard -> quick_check -> confirmatory` 프로필을 연쇄 실행 | managed `real_execution` bundle이 standard run을 observed/met로 끝냈을 때 | supplemental run은 best effort이며 primary success를 뒤집지 않음 |
| `analyze_results` | best-effort metric rematch로 objective grounding을 다시 시도한 뒤 결정적 result panel로 confidence를 보정 | 캐시된 또는 fresh objective evaluation이 `missing` 또는 `unknown`이거나, 최종 transition recommendation을 확정해야 할 때 | 사람 clarification pause 전 1회 bounded rematch, 그리고 내부 `analyze_results_panel/*` 아티팩트 생성 |
| `write_paper` | 문헌 커버리지가 얇을 때 drafting 전에 작은 query planner와 coverage auditor가 붙은 bounded related-work scout를 수행 | 검증된 writing bundle의 analyzed paper/corpus 수가 부족하거나 review context가 citation gap을 가리킬 때 | best-effort Semantic Scholar scout를 `paper/related_work_scout/*`에 기록하고, planned query를 coverage가 충분해지면 일찍 멈춘 뒤 메인 `corpus.jsonl` 대신 집필용 in-memory bundle에만 합침 |
| `write_paper` | validation-aware repair를 한 번 더 돌리고 재검증 | draft validation에서 repair 가능한 borrowed grounding warning이 나올 때 | 최대 1회 repair, warning 수가 늘어나면 채택하지 않음 |

### Overnight 모드 vs Autonomous 모드

AutoLabOS는 두 가지 무인 운영 모드를 제공합니다. 두 모드 모두 9노드 워크플로우와 모든 안전 게이트를 보존합니다.

| | Overnight 모드 | Autonomous 모드 |
|---|---|---|
| 명령어 | `/agent overnight [run]` | `/agent autonomous [run]` |
| 실행 시간 제한 | **24시간** | **제한 없음** |
| 목적 | 보수적 단일 패스 무인 실행 | 개방형 장시간 자율 연구 탐색 |
| 백트래킹 | 제한적, 보수적 | 광범위하게 완화 |
| 루핑 | `write_paper` 도달 또는 반복 recommendation 시 정지 | 가설→실험→분석 사이클을 반복 |
| 논문 초안 진입 게이트 | 기본적으로 `write_paper` 전에 정지 | 최소 증거 기준 충족 시에만 진입 — 미충족 시 백트랙 |
| 정지 조건 | 시간 제한, `write_paper` 도달, 반복 recommendation, low confidence | 사용자 중단, 자원 소진, 정체 감지, 비상 퓨즈 |

**Autonomous 모드**는 최소한의 사용자 개입으로 지속적인 가설→실험→분석 루프를 실행하도록 설계되었습니다. 두 개의 병렬 루프를 운영합니다:

1. **연구 탐색 루프** — 가설 생성/정제, 실험 설계/실행, 결과 분석, 다음 가설 도출
2. **논문 품질 개선 루프** — 가장 강한 브랜치 식별, 기준선(baseline) 강화, 주장→증거 연결 개선, 원고 준비 상태 향상

이 모드는 **2계층 논문 평가 모델**을 사용합니다:
- **1계층 (결정적 최소 게이트)**: 증거가 부족한 브랜치가 `write_paper`에 진입하는 것을 범주적으로 차단하는 7가지 아티팩트 존재 확인
- **2계층 (LLM 논문 품질 평가)**: 브랜치 품질을 점수화하고, 증거 갭을 식별하며, 개선 조치를 권고하는 구조화된 LLM 비평

Autonomous 모드는 run 아티팩트 디렉터리 안에 `RUN_STATUS.md` 파일을 기록합니다. 이 파일은 각 반복마다 현재 사이클, 노드, 가설, 최고 브랜치, 증거 갭, 논문 품질 점수, 게이트 상태, 정지 위험을 추적합니다.

Autonomous 모드의 정지 조건:
- 명시적 사용자 중단
- 자원 또는 디스크 한계
- 반복적 비생산적 루핑이 임계치 초과 (novelty/stagnation 감지)
- 치명적 런타임 실패 (비상 퓨즈)

논문 품질이 일시적으로 정체되거나 단일 실험이 부정적이라는 이유만으로는 **정지하지 않습니다**.

### 단계별 연결 그래프

아래 4개의 그래프는 전체 9개 노드를 모두 덮으며, 각 단계 안에서 실제로 어떤 역할 에이전트나 세션 매니저가 일을 수행하는지 보여줍니다.

#### 수집과 읽기

```mermaid
flowchart LR
    Topic["run topic + 수집 제약"] --> CP["collect_papers"]
    CP --> CC["collector_curator"]
    CC --> SS["Semantic Scholar 검색"]
    SS --> Enrich["enrichment + BibTeX 복구"]
    Enrich --> Corpus["corpus.jsonl + bibtex.bib"]

    Corpus --> AP["analyze_papers"]
    AP --> Select["selection request + hybrid rerank"]
    Select --> Manifest["analysis_manifest resume / prune"]
    Manifest --> RE["reader_evidence_extractor"]
    RE --> Pdf["로컬 text/image 분석 또는 Responses API PDF"]
    Pdf --> ReviewLoop["extractor -> reviewer normalization"]
    ReviewLoop --> Evidence["paper_summaries.jsonl + evidence_store.jsonl"]
```

#### 가설과 실험 설계

```mermaid
flowchart LR
    Evidence["paper_summaries.jsonl + evidence_store.jsonl"] --> GH["generate_hypotheses"]
    GH --> HA["hypothesis_agent"]
    HA --> Axes["evidence synthesizer -> evidence axes"]
    Axes --> ToT["ToT branch expansion"]
    ToT --> Drafts["mechanism / contradiction / intervention drafts"]
    Drafts --> Reviews["skeptical reviewer"]
    Reviews --> Select["diversity + evidence-quality top-k selection"]
    Select --> Hyp["hypotheses.jsonl + axes/reviews/llm_trace"]

    Hyp --> DE["design_experiments"]
    DE --> ED["experiment_designer"]
    ED --> Profiles["constraint profile + objective metric profile"]
    Profiles --> Plans["설계 후보"]
    Plans --> Panel["designer + feasibility + statistical + ops-capacity panel"]
    Panel --> Choice["panel selection"]
    Choice --> Bundle{"managed real_execution bundle 지원?"}
    Bundle -->|yes| Managed["bundle sections + runnable profiles"]
    Bundle -->|no| Plain["plain experiment plan"]
    Managed --> PlanYaml["experiment_plan.yaml"]
    Plain --> PlanYaml
```

#### 구현, 실행, 결과 루프

```mermaid
flowchart LR
    PlanYaml["experiment_plan.yaml"] --> IE["implement_experiments"]
    IE --> IM["ImplementSessionManager"]
    IM --> Impl["implementer"]
    IM --> Localizer["ImplementationLocalizer + branch planning"]
    IM --> Codex["Codex CLI session"]
    IM --> Memory["EpisodeMemory + LongTermStore"]
    Codex --> VerifyPatch["로컬 검증 + verify report"]
    VerifyPatch --> Handoff{"auto handoff?"}

    Handoff -->|yes| RX["run_experiments"]
    Handoff -->|no| Gate["승인 경계<br/>minimal이면 자동 해소"]
    Gate --> RX

    RX --> Runner["runner"]
    Runner --> Trial["trial manager"]
    Trial --> ACI["Local ACI preflight/tests/command 실행"]
    ACI --> Triage["failure triager + rerun planner"]
    Triage -->|transient면 1회 재시도| ACI
    ACI --> Watchdog["resource/log watchdog"]
    Watchdog --> Profiles["managed standard -> quick_check -> confirmatory"]
    Profiles --> Metrics["metrics.json + supplemental runs + run_verifier_feedback"]
    Metrics -. runner feedback .-> IM
    Metrics --> AR["analyze_results"]
    AR --> Analyst["analyst_statistician"]
    Analyst --> Ground["best-effort metric rematch"]
    Ground --> ResultPanel["metric auditor + robustness reviewer + confounder detector + decision calibrator"]
    ResultPanel --> Synth["objective evaluation + synthesis + transition recommendation"]

    Synth -->|advance| RV["review"]
    Synth -->|backtrack_to_implement| IE
    Synth -->|backtrack_to_design| DE["design_experiments"]
    Synth -->|backtrack_to_hypotheses| GH["generate_hypotheses"]
```

#### 리뷰, 집필, 서피싱

```mermaid
flowchart LR
    Inputs["result_analysis + corpus + evidence + hypotheses + experiment_plan"] --> RV["review"]
    RV --> Panel["runReviewPanel"]
    Panel --> Claim["claim verifier"]
    Panel --> Method["methodology reviewer"]
    Panel --> Stats["statistics reviewer"]
    Panel --> Ready["writing readiness reviewer"]
    Panel --> Integrity["integrity reviewer"]
    Panel --> Score["scorecard + consistency + bias"]
    Panel --> Decision["decision + revision_plan"]
    Score --> Packet["review_packet.json + checklist.md"]
    Decision --> Packet
    Packet --> Insight["review insight + suggested actions"]
    Insight --> Gate{"review outcome 적용"}

    Gate -->|advance| WP["write_paper"]
    Gate -->|backtrack_to_hypotheses| GH["generate_hypotheses"]
    Gate -->|backtrack_to_design| DE["design_experiments"]
    Gate -->|backtrack_to_implement| IE["implement_experiments"]

    WP --> PWM["PaperWriterSessionManager"]
    PWM --> Mode["Codex session 또는 staged LLM"]
    Mode --> Writer["paper_writer"]
    Mode --> Reviewer["reviewer"]
    Writer --> Outline["outline"]
    Outline --> Draft["draft"]
    Draft --> Review["review critique"]
    Review --> Final["finalize"]
    Final --> Validate["draft validation"]
    Validate --> Repair{"repair 가능한 borrowed warning?"}
    Repair -->|yes| Revise["validation-aware repair (최대 1회)"]
    Revise --> Revalidate["재검증"]
    Repair -->|no| Tex["paper/main.tex + references.bib + evidence_links.json"]
    Revalidate --> Tex
    Tex --> Build{"PDF build enabled?"}
    Build -->|yes| Latex["LaTeX compile + optional repair"]
    Build -->|no| Done["LaTeX 산출물만 생성"]
    Latex --> Pdf["paper/main.pdf (optional)"]
```

| 그래프 노드 | 주 역할 | 현재 구현 형태 |
| --- | --- | --- |
| `collect_papers` | `collector_curator` | Semantic Scholar 검색, 중복 제거, 보강, BibTeX 생성 |
| `analyze_papers` | `reader_evidence_extractor` | 논문 선택 랭킹과 재개 가능한 planner -> extractor -> reviewer 기반 로컬/Responses API PDF 분석, evidence가 얇으면 bounded top-N auto-expansion 포함 |
| `generate_hypotheses` | `hypothesis_agent` | evidence-axis synthesis, ToT branching, skeptical review, diversity-aware top-k selection |
| `design_experiments` | `experiment_designer` | 실험 후보 설계 생성 뒤 결정적인 `designer / feasibility / statistical / ops-capacity` 패널로 선택하고 `experiment_plan.yaml`을 기록 |
| `implement_experiments` | `implementer` | `ImplementSessionManager`, localization, Codex 패치, 검증, optional handoff |
| `run_experiments` | `runner` | ACI 기반 preflight/tests/command 실행, execution-plan + triage + watchdog 제어, transient failure 1회 재시도, managed supplemental profile chaining, verifier feedback |
| `analyze_results` | `analyst_statistician` | best-effort metric rematching, 결정적 result panel 기반 confidence calibration, 결과 합성, transition recommendation |
| `review` | `reviewer` | `runReviewPanel`, 5인 specialist reviewer, heuristic+LLM refinement, review packet 생성, transition recommendation |
| `write_paper` | `paper_writer`, `reviewer` | `PaperWriterSessionManager`, bounded related-work scout, outline/draft/review/finalize, validation-aware repair, optional LaTeX repair |

역할 카탈로그와 실제 멀티턴 런타임은 완전히 같은 범위는 아닙니다. 가장 깊은 멀티턴 session manager는 여전히 `implement_experiments`, `write_paper`이고, `review`는 가장 강한 LLM-panelized 노드로 남아 있으며, `generate_hypotheses`도 evidence-synthesis / skeptical-review 프롬프트를 유지합니다. 새로 강화된 `design_experiments`, `run_experiments`, `analyze_results`는 상위 그래프 역할이나 운영자 표면을 바꾸지 않고, 노드 내부에서만 동작하는 결정적 패널/컨트롤러를 추가한 형태입니다.

### 아티팩트 흐름

```mermaid
flowchart TB
    A["collect_papers"] --> A1["collect_request.json<br/>collect_result.json<br/>collect_enrichment.jsonl<br/>corpus.jsonl<br/>bibtex.bib"]
    A1 --> B["analyze_papers"]
    B --> B1["analysis_manifest.json<br/>paper_summaries.jsonl<br/>evidence_store.jsonl"]
    B1 --> C["generate_hypotheses"]
    C --> C1["hypotheses.jsonl<br/>hypothesis_generation/evidence_axes.json<br/>hypothesis_generation/selection.json<br/>hypothesis_generation/drafts.jsonl<br/>hypothesis_generation/reviews.jsonl"]
    C1 --> D["design_experiments"]
    D --> D1["experiment_plan.yaml<br/>baseline_summary.json<br/>design_experiments_panel/candidates.json<br/>design_experiments_panel/reviews.json<br/>design_experiments_panel/selection.json"]
    D1 --> E["implement_experiments"]
    E --> F["run_experiments"]
    F --> F1["exec_logs/run_experiments.txt<br/>exec_logs/observations.jsonl<br/>metrics.json<br/>objective_evaluation.json<br/>run_experiments_supplemental_runs.json (optional)<br/>run_experiments_verify_report.json<br/>run_experiments_panel/execution_plan.json<br/>run_experiments_panel/triage.json<br/>run_experiments_panel/rerun_decision.json"]
    F1 --> G["analyze_results"]
    G --> G1["result_analysis.json<br/>result_table.json<br/>result_analysis_synthesis.json<br/>transition_recommendation.json<br/>figures/performance.svg<br/>analyze_results_panel/inputs.json<br/>analyze_results_panel/reviews.json<br/>analyze_results_panel/scorecard.json<br/>analyze_results_panel/decision.json"]
    G1 --> H["review"]
    H --> H1["review/findings.jsonl<br/>review/scorecard.json<br/>review/consistency_report.json<br/>review/bias_report.json<br/>review/revision_plan.json<br/>review/decision.json<br/>review/review_packet.json<br/>review/minimum_gate.json<br/>review/paper_quality_evaluation.json<br/>review/checklist.md"]
    H1 --> I["write_paper"]
    I --> I1["paper/main.tex<br/>paper/references.bib<br/>paper/evidence_links.json<br/>paper/scientific_validation.json<br/>paper/draft.json<br/>paper/validation.json<br/>paper/validation_repair_report.json<br/>paper/related_work_scout/* (optional)<br/>paper/main.pdf (optional)"]
```

모든 run 아티팩트는 `.autolabos/runs/<run_id>/` 아래에 저장되므로, TUI와 로컬 웹 UI 양쪽에서 같은 실행 결과를 추적하고 점검할 수 있습니다.

사용자가 바로 열어보는 deliverable은 `outputs/<sanitized-run-title>-<run_id_prefix>/` 아래로 미러링되고, `.autolabos`는 런타임 상태, 메모리, 체크포인트, 패널 내부 상태를 보관하는 내부 source of truth로 유지됩니다. public output root에는 항상 `manifest.json`이 있으며, run id, title, output root, 섹션별 generated file, 그리고 `.autolabos` 밖에서 수정된 workspace 파일 목록을 기록합니다.

| Public section | 보통 여기에 미러링되는 파일 |
| --- | --- |
| `experiment/` | `experiment_plan.yaml`, `baseline_summary.json`, 재사용 가능한 experiment bundle 파일, `metrics.json`, `objective_evaluation.json`, `run_experiments_verify_report.json`, optional supplemental metrics, `workspace_changed_files.json` |
| `analysis/` | `result_analysis.json`, `result_analysis_synthesis.json`, `result_table.json`, `baseline_summary.json`, `transition_recommendation.json`, optional `figures/performance.svg` |
| `review/` | `review_packet.json`, `checklist.md`, `decision.json`, `findings.jsonl`, `minimum_gate.json`, `paper_quality_evaluation.json` |
| `paper/` | `main.tex`, `references.bib`, `evidence_links.json`, `scientific_validation.json`, optional `main.pdf`, optional `build.log` |
| `results/` | 컴팩트 정량 결과 요약 |
| `reproduce/` | 재현 스크립트 및 노트 |

`analyze_papers`는 `analysis_manifest.json`을 이용해 미완료 작업만 재개합니다. 선택된 논문 집합이 바뀌거나, 분석 설정이 바뀌거나, `paper_summaries.jsonl` / `evidence_store.jsonl`가 manifest와 어긋나면 AutoLabOS는 오래된 행을 정리하고 영향받은 논문만 다시 큐에 넣은 뒤 downstream 노드를 계속 진행합니다.

새로운 중간 파이프라인 강화는 v1에서 내부 전용으로만 노출됩니다. `design_experiments`는 `design_experiments_panel/*`, `run_experiments`는 `run_experiments_panel/*`, `analyze_results`는 `analyze_results_panel/*`를 쓰고, 대응되는 run-context memory key는 `design_experiments.panel_selection`, `run_experiments.triage`, `analyze_results.panel_decision`입니다.

managed `run_experiments`는 successful standard run 뒤에 자동으로 `quick_check`, `confirmatory`를 따라 돌리면 `run_experiments_supplemental_runs.json`도 남깁니다. `write_paper`는 planned query variant와 coverage audit가 붙은 bounded related-work scout를 실행하면 `paper/related_work_scout/*`도 남기고, bounded repair loop가 실제로 실행되면 `validation_repair_report.json`과 `validation_repair.*` 아티팩트도 기록합니다.

TUI brief 흐름으로 시작한 run은 source Markdown brief를 `.autolabos/runs/<run_id>/brief/source_brief.md`에 스냅샷하고, provenance를 `run_brief.*` memory entry에 기록합니다. 사람 답변이 필요한 경우에는 활성 요청이 `.autolabos/runs/<run_id>/human_intervention/request.json`에도 미러링되고 `human_intervention.pending`, `human_intervention.history`로 추적됩니다.

### 제어 표면

```mermaid
flowchart TB
    TUI["브리프 중심 TUI<br/>/new + /brief start + /agent + /model + /doctor"] --> Session["인터랙션 세션"]
    Web["로컬 Web Ops UI<br/>온보딩 + 대시보드 + 컴포저 + 아티팩트 브라우저"] --> Session
    Natural["자연어 라우팅<br/>먼저 deterministic, 이후 LLM fallback"] --> Session

    Session --> Runtime["공유 런타임<br/>run store + checkpoint store + event stream + orchestrator"]
    Runtime --> Nodes["9개 노드 워크플로 실행"]
    Runtime --> Artifacts["run 아티팩트<br/>.autolabos/runs/<run_id>"]
    Runtime --> State["run 상태와 메모리<br/>context + episodes + long-term store"]
    Runtime --> Insight["analyze_results / review insight 카드"]

    Artifacts --> Web
    State --> TUI
    Insight --> TUI
    Insight --> Web
```

### Review Decision Loop

```mermaid
flowchart LR
    ReviewNode["review 노드"] --> Packet["review_packet.json"]
    Packet --> Parse["parseReviewPacket"]
    Parse --> Insight["buildReviewInsightCard<br/>formatReviewPacketLines"]
    Insight --> TUI["TUI active run insight<br/>/agent review 출력"]
    Insight --> Web["웹 review preview<br/>suggested action 버튼"]
    TUI --> Approve["자동 전이 또는 /approve (pause된 경우)"]
    Web --> Approve
    Approve --> Runtime["StateGraphRuntime.approveCurrent / auto gate resolver"]
    Runtime -->|advance| Paper["write_paper"]
    Runtime -->|safe backtrack| Backtrack["generate_hypotheses / design_experiments / implement_experiments"]
```

### 구체적인 에이전트 런타임

```mermaid
flowchart LR
    UI["CLI / TUI / Web UI"] --> Session["InteractionSession + web composer"]
    Session --> Bootstrap["createAutoLabOSRuntime"]
    Bootstrap --> Orchestrator["AgentOrchestrator"]
    Bootstrap --> Overnight["AutonomousRunController"]
    Bootstrap --> Runtime["StateGraphRuntime"]
    Bootstrap --> Providers["RoutedLLMClient + CodexCliClient + SemanticScholarClient + ResponsesPdfAnalysisClient + LocalAciAdapter"]
    Orchestrator --> Runtime
    Overnight --> Orchestrator
    Runtime --> Registry["DefaultNodeRegistry"]
    Runtime --> Stores["RunStore + CheckpointStore + EventStream"]
    Providers --> Registry

    Registry --> Collect["collect_papers"]
    Registry --> Analyze["analyze_papers"]
    Registry --> Hyp["generate_hypotheses"]
    Registry --> Design["design_experiments"]
    Registry --> Impl["implement_experiments"]
    Registry --> Run["run_experiments"]
    Registry --> Results["analyze_results"]
    Registry --> Review["review"]
    Registry --> Paper["write_paper"]

    Collect --> Scholar["Semantic Scholar + enrichment"]
    Analyze --> AnalyzeStack["paperSelection + paperAnalyzer + analysis manifest"]
    Hyp --> HypStack["researchPlanning.generateHypothesesFromEvidence + ToT"]
    Design --> DesignStack["researchPlanning.designExperimentsFromHypotheses + designExperimentsPanel"]
    Impl --> ImplStack["ImplementSessionManager + ImplementationLocalizer"]
    Run --> RunStack["LocalAciAdapter + runExperimentsPanel + runVerifierFeedback"]
    Results --> ResultStack["resultAnalysis + analyzeResultsPanel + synthesis + transition recommendation"]
    Review --> ReviewStack["runReviewPanel + reviewPacket + transition recommendation"]
    Paper --> PaperStack["PaperWriterSessionManager + paperWriting + LaTeX build"]
```

핵심 소스 영역:

- `src/runtime/createRuntime.ts`: 설정, provider, store, runtime, orchestrator, 공용 실행 의존성을 조립
- `src/interaction/*`: TUI와 웹 컴포저가 함께 쓰는 공용 command/session 레이어
- `src/core/stateGraph/*`: 노드 실행, 재시도, 승인, 제한, 점프, 체크포인트 처리
- `src/core/nodes/*`: 9개 워크플로 핸들러와 아티팩트 생성 로직
- `src/core/analysis/researchPlanning.ts`, `src/core/designExperimentsPanel.ts`, `src/core/runExperimentsPanel.ts`, `src/core/analyzeResultsPanel.ts`, `src/core/reviewSystem.ts`, `src/core/reviewPacket.ts`: 다단계 가설 생성/실험 설계, 결정적 중간 패널/컨트롤러, specialist review panel, review packet 빌드/서피싱
- `src/core/agents/*`: 세션 매니저, export된 역할 정의, search-backed implementation localization
- `src/integrations/*`, `src/tools/*`: provider 클라이언트, Semantic Scholar 연동, Responses PDF 분석, 로컬 실행 어댑터
- `src/web/*`, `web/src/*`, `src/interaction/*`, `src/tui/*`: 같은 런타임 위에 얹힌 로컬 HTTP 서버, 브라우저 UI, 터미널 surface와 insight 카드

## 자주 쓰는 명령어

| 명령어 | 설명 |
| --- | --- |
| `/new` | research brief 파일 생성 |
| `/brief start <path|--latest>` | brief 파일에서 연구 시작 |
| `/runs [query]` | run 목록 조회 또는 검색 |
| `/run <run>` | run 선택 |
| `/resume <run>` | run 재개 |
| `/agent collect [query] [options]` | 필터, 정렬, 서지 옵션으로 논문 수집 |
| `/agent run <node> [run]` | 특정 그래프 노드부터 실행 |
| `/agent status [run]` | 노드 상태 조회 |
| `/agent graph [run]` | 그래프 상태 보기 |
| `/agent resume [run] [checkpoint]` | 최신 또는 특정 체크포인트에서 재개 |
| `/agent retry [node] [run]` | 노드 재시도 |
| `/agent jump <node> [run] [--force]` | 노드 점프 |
| `/model` | 모델 및 reasoning selector 열기 |
| `/settings` | provider, model, PDF 설정 수정 |
| `/doctor` | 환경 점검 |

자주 쓰는 수집 옵션:

- `--run <run_id>`
- `--limit <n>`
- `--additional <n>`
- `--last-years <n>`
- `--year <spec>`
- `--date-range <start:end>`
- `--sort <relevance|citationCount|publicationDate|paperId>`
- `--order <asc|desc>`
- `--field <csv>`
- `--venue <csv>`
- `--type <csv>`
- `--min-citations <n>`
- `--open-access`
- `--bibtex <generated|s2|hybrid>`
- `--dry-run`

예시:

- `/agent collect --last-years 5 --sort relevance --limit 100`
- `/agent collect "agent planning" --sort citationCount --order desc --min-citations 100`
- `/agent collect --additional 200 --run <run_id>`

## 자연어 제어

AutoLabOS는 모든 문장을 규칙으로 처리하려고 하지 않습니다. 대신 지원하는 deterministic intent family를 정의하고, 이 범위는 로컬 핸들러나 슬래시 명령으로 우선 처리한 뒤 나머지는 workspace 기반 LLM으로 넘깁니다.

TUI 안에서 아래처럼 입력하면 현재 지원 목록을 확인할 수 있습니다.

- `지원되는 자연어 입력을 보여줘`
- `what natural inputs are supported?`

대표 예시:

- `새 research run 시작해줘`
- `최근 5년 관련도 순으로 100개 수집해줘`
- `현재 상태 보여줘`
- `collect_papers로 돌아가줘`
- `논문 몇 개 모였어?`

TUI에서는 디스크에 editable brief를 남길 수 있는 `/new` + `/brief start --latest` 경로를 권장합니다. 자연어 기반 run 생성도 빠른 one-shot 시작용으로 계속 지원합니다.

복합 자연어 실행 계획은 단계별로 멈춥니다.

- `y`: 다음 step 1개만 실행
- `a`: 남은 step을 더 멈추지 않고 모두 실행
- `n`: 남은 계획 취소

구현 위치:

- deterministic 라우팅: [src/core/commands/naturalDeterministic.ts](./src/core/commands/naturalDeterministic.ts)
- 상태 / 다음 단계 로컬 응답: [src/core/commands/naturalAssistant.ts](./src/core/commands/naturalAssistant.ts)

<details>
<summary>전체 슬래시 명령어 목록</summary>

| 명령어 | 설명 |
| --- | --- |
| `/help` | 명령 목록 표시 |
| `/new` | research brief 파일 생성 |
| `/brief start <path|--latest>` | brief 파일에서 연구 시작 |
| `/doctor` | 환경 점검 |
| `/runs [query]` | run 목록/검색 |
| `/run <run>` | run 선택 |
| `/resume <run>` | run 재개 |
| `/agent list` | 그래프 노드 목록 |
| `/agent run <node> [run]` | 노드 실행 |
| `/agent status [run]` | 노드 상태 조회 |
| `/agent collect [query] [options]` | 필터/정렬 옵션으로 논문 수집 |
| `/agent recollect <n> [run]` | 현재 run에 논문을 추가 수집 |
| `/agent focus <node>` | safe jump로 노드 포커스 이동 |
| `/agent graph [run]` | 그래프 상태 출력 |
| `/agent resume [run] [checkpoint]` | 최신/특정 체크포인트 재개 |
| `/agent retry [node] [run]` | 노드 재시도 |
| `/agent jump <node> [run] [--force]` | 노드 점프 |
| `/agent overnight [run]` | 보수적 overnight 자동운전 (24시간 제한) |
| `/agent autonomous [run]` | 개방형 자율 연구 탐색 (시간 제한 없음) |
| `/model` | 화살표 선택기로 모델/effort 선택 |
| `/approve` | 멈춘 현재 노드를 승인 |
| `/retry` | 현재 노드 재시도 |
| `/settings` | provider, model, PDF 설정 수정 |
| `/quit` | 종료 |

</details>

<details>
<summary>지원하는 자연어 입력 범주</summary>

1. 도움말 / 설정 / 모델 / 환경 점검 / 종료
   - 예: `도움말 보여줘`, `모델 선택기 열어줘`, `환경 점검해줘`
2. run 라이프사이클
   - 예: `새 run 시작해줘`, `run 목록 보여줘`, `alpha run 열어줘`, `이전 run 재개해줘`
   - 예: `새 연구를 시작해줘: 주제: 멀티에이전트 코드 수정, 목표: pass@1, 제약: 최신 논문만`
3. run title 변경
   - 예: `run title을 Multi-agent collaboration으로 바꿔줘`
4. 워크플로 구조 / 현재 상태 / 다음 단계
   - 예: `현재 상태 보여줘`, `다음에 뭐 해야 해?`, `워크플로 구조 알려줘`
5. 논문 수집
   - 예: `최근 5년 관련도 순으로 100개 수집해줘`
   - 예: `오픈액세스 리뷰 논문 50개 수집해줘`
   - 예: `논문 200개 더 수집해줘`
   - 예: `기존 논문을 지우고 새 논문 100개 다시 수집해줘`
6. 노드 제어
   - 예: `collect_papers로 이동해줘`, `가설 노드 다시 실행해줘`, `implement_experiments에 집중해줘`
7. 그래프 / 승인
   - 예: `그래프 보여줘`, `멈춘 현재 노드 승인해줘`, `현재 노드 재시도해줘`
8. 수집된 논문 직접 질의
   - 예: `논문 몇 개 모았어?`
   - 예: `pdf 경로가 없는 논문이 몇 개야?`
   - 예: `citation이 가장 높은 논문이 뭐야?`
   - 예: `논문 제목 3개 보여줘`

</details>

<details>
<summary>런타임 기본값, 저장 구조, 실행 디테일</summary>

### 상태 그래프

고정 그래프 노드:

1. `collect_papers`
2. `analyze_papers`
3. `generate_hypotheses`
4. `design_experiments`
5. `implement_experiments`
6. `run_experiments`
7. `analyze_results`
8. `review`
9. `write_paper`

### 런타임 정책

- 체크포인트: `.autolabos/runs/<run_id>/checkpoints/`
- 체크포인트 phase: `before | after | fail | jump | retry`
- 재시도 정책: `maxAttemptsPerNode=3`
- 자동 롤백 정책: `maxAutoRollbacksPerNode=2`
- 점프 모드:
  - `safe`: 현재 또는 이전 노드만 허용
  - `force`: 미래 노드 점프 허용, 건너뛴 노드는 기록
### 에이전트 실행 패턴

- ReAct 루프: `PLAN_CREATED -> TOOL_CALLED -> OBS_RECEIVED`
- ReWOO 분리(Planner/Worker): 고비용 노드 중심
- ToT(Tree-of-Thoughts): 가설/설계 노드에서 사용
- Reflexion: 실패 episode를 저장해 재시도 시 재활용

### 메모리 계층

- Run context memory: run 단기 상태
- Long-term store: JSONL 기반 요약/색인 히스토리
- Episode memory: Reflexion 실패 학습

### ACI (Agent-Computer Interface)

표준 액션:

- `read_file`
- `write_file`
- `apply_patch`
- `run_command`
- `run_tests`
- `tail_logs`

`implement_experiments`, `run_experiments` 노드는 ACI를 통해 실행됩니다.

### 명령 팔레트

- `/` 입력: 명령 목록 열기
- `Tab`: 자동완성
- `↑/↓`: 후보 이동
- `Enter`: 실행
- run 제안 항목은 `run_id + title + current_node + status + 상대 시간`을 표시
- 입력이 비어 있으면 현재 상태 기준의 다음 액션, 정확한 명령어, 자연어 예시를 함께 표시
- 다음 액션 패널은 이제 실행, 상태, 그래프, 산출물 개수, 점프, 자연어 질문까지 더 넓게 보여줍니다
- 이 안내는 최근 사용자 입력이나 OS 로케일에 맞춰 한/영으로 바뀌며, 빈 입력에서 `Tab`을 누르면 첫 추천 액션이 바로 채워집니다

### Run 메타데이터

`runs.json` 주요 필드:

- `version: 3`
- `workflowVersion: 3`
- `currentNode`
- `graph` (`RunGraphState`)
- `nodeThreads` (`Partial<Record<GraphNodeId, string>>`)
- `memoryRefs` (`runContextPath`, `longTermPath`, `episodePath`)

### 생성 경로

- `.autolabos/config.yaml`
- `.autolabos/runs/runs.json`
- `.autolabos/runs/<run_id>/checkpoints/*`
- `.autolabos/runs/<run_id>/memory/*`
- `.autolabos/runs/<run_id>/paper/*`

</details>

## 개발

```bash
npm run build
npm test
npm run test:smoke:all
npm run test:smoke:natural-collect
npm run test:smoke:natural-collect-execute
npm run test:smoke:ci
```

스모크 테스트 안내:

- smoke harness 파일은 `tests/smoke/` 아래에 있습니다.
- 수동 실행용 예시 workspace는 `/test` 아래에 있습니다.
- smoke는 루트 `/test` 상태를 덮어쓰지 않도록 `/test/smoke-workspace`를 별도 workspace로 사용합니다.
- `test:smoke:natural-collect`는 자연어 수집 요청 -> pending `/agent collect ...` 생성 흐름을 검증합니다.
- `test:smoke:natural-collect-execute`는 자연어 수집 요청 -> `y` 실행 -> 수집 산출물 생성 흐름을 검증합니다.
- `test:smoke:all`은 `/test/smoke-workspace` 기준 전체 로컬 smoke 묶음을 실행합니다.
- 실제 Codex 호출 없이 `AUTOLABOS_FAKE_CODEX_RESPONSE`를 사용합니다.
- execute smoke는 `AUTOLABOS_FAKE_SEMANTIC_SCHOLAR_RESPONSE`도 사용합니다.
- `test:smoke:ci`는 CI 모드 smoke 선택 실행입니다.
  - 기본 모드: `pending`
  - 추가 모드: `execute`, `composite`, `composite-all`, `llm-composite`, `llm-composite-all`, `llm-replan`
  - CI에서 `AUTOLABOS_SMOKE_MODE=<mode>` 또는 `AUTOLABOS_SMOKE_MODE=all`로 시나리오를 전환할 수 있습니다.
- smoke 출력은 기본적으로 조용하며, 전체 PTY 로그가 필요하면 `AUTOLABOS_SMOKE_VERBOSE=1`을 사용합니다.
