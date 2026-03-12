import { GRAPH_NODE_ORDER, RunRecord } from "../types.js";
import { projectRunForDisplay, RunProjectionHints } from "./runProjection.js";

export type GuidanceLanguage = "en" | "ko";

export interface GuidanceItem {
  label: string;
  description: string;
  applyValue?: string;
}

export interface ContextualGuidance {
  title: string;
  items: GuidanceItem[];
}

export interface PendingPlanGuidance {
  command: string;
  commands: string[];
  displayCommands?: string[];
  stepIndex: number;
  totalSteps: number;
}

export interface PendingHumanInterventionGuidance {
  title: string;
  question: string;
  choices?: Array<{
    label: string;
    description?: string;
  }>;
}

export interface ContextualGuidanceInput {
  run?: RunRecord;
  projectionHints?: RunProjectionHints;
  pendingPlan?: PendingPlanGuidance;
  humanIntervention?: PendingHumanInterventionGuidance;
  language?: GuidanceLanguage;
}

export function buildContextualGuidance(input: ContextualGuidanceInput): ContextualGuidance | undefined {
  const language = input.language ?? "en";
  if (input.pendingPlan) {
    return buildPendingPlanGuidance(input.pendingPlan, language);
  }

  if (input.humanIntervention) {
    return {
      title: localize(language, "Awaiting input", "답변 대기 중"),
      items: dedupeGuidanceItems([
        {
          label: input.humanIntervention.question,
          description: localize(language, "Reply directly in the TUI to continue the run", "TUI에 바로 답하면 실행이 재개됩니다")
        },
        ...(input.humanIntervention.choices || []).map((choice, index) => ({
          label: `${index + 1}) ${choice.label}`,
          description: choice.description || localize(language, "Choice", "선택지")
        })),
        {
          label: "/approve",
          description: localize(language, "Manual override for the current approval boundary", "현재 승인 경계를 수동으로 넘기기")
        },
        {
          label: "/agent transition",
          description: localize(language, "Inspect the pending transition before deciding", "결정 전에 pending transition 확인")
        }
      ])
    };
  }

  if (!input.run) {
    return {
      title: localize(language, "Start here", "시작 가이드"),
      items: dedupeGuidanceItems([
        { label: "/new", description: localize(language, "Create the first research brief file", "첫 research brief 파일 만들기") },
        { label: "/runs", description: localize(language, "Browse existing runs", "기존 run 둘러보기") },
        { label: "/doctor", description: localize(language, "Check keys and local environment", "키와 로컬 환경 점검") },
        { label: "/settings", description: localize(language, "Edit model and PDF settings", "모델과 PDF 설정 수정") },
        { label: "/model", description: localize(language, "Open the model selector", "모델 선택기 열기") },
        { label: "/help", description: localize(language, "Show the full command list", "전체 명령어 목록 보기") },
        { label: "/brief start --latest", description: localize(language, "Start the latest brief file", "가장 최근 brief 파일 실행") },
        {
          label: localize(language, "what natural inputs are supported?", "지원되는 자연어 입력을 보여줘"),
          description: localize(language, "Show the live natural-language catalog", "현재 지원하는 자연어 목록 보기")
        },
        {
          label: localize(language, "create a new run", "새 run 시작해줘"),
          description: localize(language, "Natural-language shortcut for starting", "시작용 자연어 예시")
        }
      ])
    };
  }

  const projection = projectRunForDisplay(input.run, input.projectionHints);
  const run = projection.run;
  const nodeStatus = run.graph.nodeStates[run.currentNode].status;
  const targetNode = projection.actionableNode;
  const targetNodeStatus = projection.actionableNodeStatus ?? run.graph.nodeStates[targetNode]?.status;
  const nextNode = getNextNode(targetNode);
  const statusCommand = `/agent status ${run.id}`;
  const graphCommand = `/agent graph ${run.id}`;
  const budgetCommand = `/agent budget ${run.id}`;
  const retryCommand = `/agent retry ${targetNode} ${run.id}`;
  const runCommand = `/agent run ${targetNode} ${run.id}`;
  const focusCommand = `/agent focus ${targetNode}`;
  const countCommand = `/agent count ${targetNode} ${run.id}`;
  const jumpNextCommand = nextNode ? `/agent jump ${nextNode} ${run.id}` : undefined;
  const nodeExampleCommand = nodeSpecificCommandExample({ ...run, currentNode: targetNode }, language);
  const statusPrompt = localize(language, "show current status", "현재 상태 보여줘");
  const nextPrompt = localize(language, "what should I do next?", "다음에 뭐 해야 해?");
  const countPrompt = naturalCountPromptForNode(targetNode, language);

  if (run.status === "completed") {
    return {
      title: localize(language, "Next actions", "다음 액션"),
      items: dedupeGuidanceItems([
        { label: "/new", description: localize(language, "Draft another research brief", "새 research brief 만들기") },
        { label: "/runs", description: localize(language, "Browse previous runs", "이전 run 둘러보기") },
        { label: statusCommand, description: localize(language, "Show the final run status", "최종 run 상태 보기") },
        { label: graphCommand, description: localize(language, "Inspect this completed workflow", "완료된 워크플로 상태 보기") },
        { label: countCommand, description: describeCountAction(run.currentNode, language) },
        { label: focusCommand, description: localize(language, `Focus ${run.currentNode}`, `${run.currentNode} 포커스 이동`) },
        { label: statusPrompt, description: localize(language, "Natural-language status query", "자연어 상태 질문") },
        { label: countPrompt, description: localize(language, "Natural-language artifact count query", "자연어 산출물 개수 질문") }
      ])
    };
  }

  if (run.status === "failed_budget") {
    return {
      title: localize(language, "Next actions", "다음 액션"),
      items: dedupeGuidanceItems([
        {
          label: budgetCommand,
          description: localize(language, "Inspect budget usage before retrying", "재시도 전에 예산 사용량 확인")
        },
        {
          label: retryCommand,
          description: localize(language, `Retry ${targetNode}`, `${targetNode} 재시도`)
        },
        {
          label: statusCommand,
          description: localize(language, "Show the current run status", "현재 run 상태 보기")
        },
        {
          label: graphCommand,
          description: localize(language, "Inspect the full workflow state", "전체 워크플로 상태 보기")
        },
        {
          label: focusCommand,
          description: localize(language, `Focus ${targetNode}`, `${targetNode} 포커스 이동`)
        },
        {
          label: countCommand,
          description: describeCountAction(targetNode, language)
        },
        jumpNextCommand
          ? {
              label: jumpNextCommand,
              description: localize(language, `Jump to ${nextNode}`, `${nextNode} 단계로 점프`)
            }
          : undefined,
        { label: nextPrompt, description: localize(language, "Ask for the recommended recovery step", "권장 복구 단계를 물어보기") },
        { label: statusPrompt, description: localize(language, "Natural-language status query", "자연어 상태 질문") }
      ])
    };
  }

  if (projection.usageLimitBlocked) {
    return {
      title: localize(language, "Next actions", "다음 액션"),
      items: dedupeGuidanceItems([
        {
          label: "/model",
          description: localize(
            language,
            "Switch away from the blocked model before retrying",
            "재시도 전에 막힌 모델 대신 다른 모델로 바꾸기"
          )
        },
        {
          label: statusCommand,
          description: localize(
            language,
            "Inspect the usage-limit block and paused retry state",
            "usage-limit block과 pause/retry 상태 확인"
          )
        },
        {
          label: retryCommand,
          description: localize(
            language,
            `Retry ${targetNode} after changing model or waiting for quota reset`,
            `모델 변경 또는 quota reset 이후 ${targetNode} 재시도`
          )
        },
        {
          label: countCommand,
          description: describeVerifyOutputsAction(targetNode, language)
        },
        {
          label: graphCommand,
          description: localize(language, "Inspect the full workflow state", "전체 워크플로 상태 보기")
        },
        {
          label: budgetCommand,
          description: localize(language, "Inspect budget usage", "예산 사용량 확인")
        },
        {
          label: focusCommand,
          description: localize(language, `Focus ${targetNode}`, `${targetNode} 포커스 이동`)
        },
        { label: nextPrompt, description: localize(language, "Ask for the recommended recovery step", "권장 복구 단계를 물어보기") },
        { label: statusPrompt, description: localize(language, "Natural-language status query", "자연어 상태 질문") }
      ])
    };
  }

  if (projection.blockedByUpstream) {
    return {
      title: localize(language, "Next actions", "다음 액션"),
      items: dedupeGuidanceItems([
        {
          label: retryCommand,
          description: localize(
            language,
            `Recover ${targetNode} before retrying ${run.currentNode}`,
            `${run.currentNode}보다 먼저 ${targetNode} 복구`
          )
        },
        {
          label: statusCommand,
          description: localize(
            language,
            "Show the downstream block and upstream failure details",
            "downstream block과 upstream 실패 원인 확인"
          )
        },
        {
          label: countCommand,
          description: describeMissingOutputsAction(targetNode, language)
        },
        {
          label: graphCommand,
          description: localize(language, "Inspect the full workflow state", "전체 워크플로 상태 보기")
        },
        {
          label: focusCommand,
          description: localize(language, `Focus ${targetNode}`, `${targetNode} 포커스 이동`)
        },
        {
          label: budgetCommand,
          description: localize(language, "Inspect budget usage", "예산 사용량 확인")
        },
        { label: nextPrompt, description: localize(language, "Ask for the recommended recovery step", "권장 복구 단계를 물어보기") },
        { label: statusPrompt, description: localize(language, "Natural-language status query", "자연어 상태 질문") }
      ])
    };
  }

  if (run.status === "failed" || nodeStatus === "failed" || targetNodeStatus === "failed") {
    const retryDescription = projection.pausedRetry
      ? localize(
          language,
          `Retry ${targetNode} after reviewing the last failed attempt`,
          `마지막 실패 시도를 확인한 뒤 ${targetNode} 재시도`
        )
      : localize(language, `Retry ${targetNode}`, `${targetNode} 재시도`);

    const countDescription = projection.noArtifactProgress
      ? describeNoOutputsAction(targetNode, language)
      : describeCountAction(targetNode, language);

    return {
      title: localize(language, "Next actions", "다음 액션"),
      items: dedupeGuidanceItems([
        {
          label: statusCommand,
          description: localize(language, "Show the current run status", "현재 run 상태 보기")
        },
        {
          label: retryCommand,
          description: retryDescription
        },
        {
          label: countCommand,
          description: countDescription
        },
        {
          label: graphCommand,
          description: localize(language, "Inspect the full workflow state", "전체 워크플로 상태 보기")
        },
        {
          label: budgetCommand,
          description: localize(language, "Inspect budget usage", "예산 사용량 확인")
        },
        {
          label: focusCommand,
          description: localize(language, `Focus ${targetNode}`, `${targetNode} 포커스 이동`)
        },
        jumpNextCommand
          ? {
              label: jumpNextCommand,
              description: localize(language, `Jump to ${nextNode}`, `${nextNode} 단계로 점프`)
            }
          : undefined,
        { label: nextPrompt, description: localize(language, "Ask for the recommended recovery step", "권장 복구 단계를 물어보기") },
        { label: statusPrompt, description: localize(language, "Natural-language status query", "자연어 상태 질문") }
      ])
    };
  }

  if (run.status === "paused" && nodeStatus === "needs_approval") {
    return {
      title: localize(language, "Next actions", "다음 액션"),
      items: dedupeGuidanceItems([
        {
          label: "/approve",
          description: localize(language, `Approve ${targetNode}`, `${targetNode} 승인`)
        },
        {
          label: retryCommand,
          description: localize(language, `Retry ${targetNode}`, `${targetNode} 재시도`)
        },
        {
          label: statusCommand,
          description: localize(language, "Show why the run is paused", "run이 멈춘 이유 보기")
        },
        {
          label: graphCommand,
          description: localize(language, "Inspect the full workflow state", "전체 워크플로 상태 보기")
        },
        {
          label: budgetCommand,
          description: localize(language, "Inspect budget usage", "예산 사용량 확인")
        },
        {
          label: focusCommand,
          description: localize(language, `Focus ${targetNode}`, `${targetNode} 포커스 이동`)
        },
        {
          label: countCommand,
          description: describeCountAction(targetNode, language)
        },
        {
          label: nextPrompt,
          description: localize(language, "Ask for the recommended next step", "권장 다음 단계를 물어보기")
        },
        {
          label: statusPrompt,
          description: localize(language, "Natural-language status query", "자연어 상태 질문")
        }
      ])
    };
  }

  if (run.status === "paused" && projection.pausedRetry) {
    return {
      title: localize(language, "Next actions", "다음 액션"),
      items: dedupeGuidanceItems([
        {
          label: statusCommand,
          description: localize(
            language,
            "Show why the run paused after the retry attempt",
            "재시도 후 왜 멈췄는지 확인"
          )
        },
        {
          label: countCommand,
          description: projection.noArtifactProgress
            ? describeNoOutputsAction(targetNode, language)
            : describeCountAction(targetNode, language)
        },
        {
          label: retryCommand,
          description: localize(
            language,
            `Retry ${targetNode} after reviewing the paused attempt`,
            `멈춘 시도를 확인한 뒤 ${targetNode} 재시도`
          )
        },
        {
          label: graphCommand,
          description: localize(language, "Inspect the full workflow state", "전체 워크플로 상태 보기")
        },
        {
          label: budgetCommand,
          description: localize(language, "Inspect budget usage", "예산 사용량 확인")
        },
        {
          label: focusCommand,
          description: localize(language, `Focus ${targetNode}`, `${targetNode} 포커스 이동`)
        },
        { label: nextPrompt, description: localize(language, "Ask for the recommended recovery step", "권장 복구 단계를 물어보기") },
        { label: statusPrompt, description: localize(language, "Natural-language status query", "자연어 상태 질문") }
      ])
    };
  }

  return {
    title: localize(language, "Next actions", "다음 액션"),
    items: dedupeGuidanceItems([
      {
        label: runCommand,
        description: localize(language, `Continue ${targetNode}`, `${targetNode} 계속 실행`)
      },
      {
        label: statusCommand,
        description: localize(language, "Show the current run status", "현재 run 상태 보기")
      },
      {
        label: graphCommand,
        description: localize(language, "Inspect the full workflow state", "전체 워크플로 상태 보기")
      },
      {
        label: budgetCommand,
        description: localize(language, "Inspect budget usage", "예산 사용량 확인")
      },
      {
        label: focusCommand,
        description: localize(language, `Focus ${targetNode}`, `${targetNode} 포커스 이동`)
      },
      {
        label: countCommand,
        description: describeCountAction(targetNode, language)
      },
      {
        label: retryCommand,
        description: localize(language, `Retry ${targetNode}`, `${targetNode} 재시도`)
      },
      jumpNextCommand
        ? {
            label: jumpNextCommand,
            description: localize(language, `Jump to ${nextNode}`, `${nextNode} 단계로 점프`)
          }
        : undefined,
      nodeExampleCommand,
      {
        label: naturalPromptForNode(targetNode, language),
        description: localize(language, "Natural-language example for this step", "이 단계에서 바로 쓸 수 있는 자연어 예시")
      },
      {
        label: countPrompt,
        description: localize(language, "Natural-language artifact count query", "자연어 산출물 개수 질문")
      },
      {
        label: nextPrompt,
        description: localize(language, "Natural-language next-step query", "자연어 다음 단계 질문")
      },
      {
        label: "/runs",
        description: localize(language, "Browse all runs", "전체 run 둘러보기")
      },
      {
        label: "/help",
        description: localize(language, "Show the full command list", "전체 명령어 목록 보기")
      }
    ])
  };
}

function buildPendingPlanGuidance(plan: PendingPlanGuidance, language: GuidanceLanguage): ContextualGuidance {
  const preview = plan.displayCommands?.[0] || plan.commands[0] || plan.command;
  const items: GuidanceItem[] = [
    {
      label: preview,
      description: localize(
        language,
        `Pending step ${plan.stepIndex + 1}/${plan.totalSteps}`,
        `대기 중인 단계 ${plan.stepIndex + 1}/${plan.totalSteps}`
      ),
      applyValue: plan.command
    },
    {
      label: "y",
      description: localize(
        language,
        `Run step ${plan.stepIndex + 1}/${plan.totalSteps}`,
        `${plan.stepIndex + 1}/${plan.totalSteps} 단계 실행`
      )
    }
  ];

  if (plan.totalSteps > 1) {
    items.push({
      label: "a",
      description: localize(
        language,
        `Run all remaining ${Math.max(1, plan.totalSteps - plan.stepIndex)} step(s)`,
        `남은 ${Math.max(1, plan.totalSteps - plan.stepIndex)}개 단계 모두 실행`
      )
    });
  }

  items.push({
    label: "n",
    description: localize(
      language,
      `Cancel the pending ${plan.totalSteps > 1 ? "plan" : "command"}`,
      `대기 중인 ${plan.totalSteps > 1 ? "계획" : "명령"} 취소`
    )
  });

  return {
    title: localize(language, "Pending plan", "대기 중인 계획"),
    items
  };
}

export function detectGuidanceLanguageFromText(text: string): GuidanceLanguage | undefined {
  const normalized = text.trim();
  if (!normalized) {
    return undefined;
  }
  if (/[\p{Script=Hangul}]/u.test(normalized)) {
    return "ko";
  }
  if (/[a-z]/i.test(normalized)) {
    return "en";
  }
  return undefined;
}

function naturalPromptForNode(node: RunRecord["currentNode"], language: GuidanceLanguage): string {
  switch (node) {
    case "collect_papers":
      return localize(language, "collect 100 papers from the last 5 years by relevance", "최근 5년 논문 100개를 관련도 순으로 수집해줘");
    case "analyze_papers":
      return localize(language, "analyze the top 50 papers", "상위 50개 논문만 분석해줘");
    case "generate_hypotheses":
      return localize(language, "generate hypotheses from the current papers", "현재 논문들로 가설을 생성해줘");
    case "design_experiments":
      return localize(language, "design experiments for this run", "이 run에 맞는 실험을 설계해줘");
    case "implement_experiments":
      return localize(language, "implement the experiment step", "실험 구현 단계를 진행해줘");
    case "run_experiments":
      return localize(language, "run the experiments", "실험을 실행해줘");
    case "analyze_results":
      return localize(language, "analyze the experiment results", "실험 결과를 분석해줘");
    case "review":
      return localize(language, "prepare the review packet", "검토 패킷을 준비해줘");
    case "write_paper":
      return localize(language, "write the paper draft", "논문 초안을 작성해줘");
    default:
      return localize(language, "what should I do next?", "다음에 뭐 해야 해?");
  }
}

function naturalCountPromptForNode(node: RunRecord["currentNode"], language: GuidanceLanguage): string {
  switch (node) {
    case "collect_papers":
      return localize(language, "how many papers were collected?", "논문 몇 개 모였어?");
    case "analyze_papers":
      return localize(language, "how many summaries and evidence rows are saved?", "요약과 근거가 몇 개 저장됐어?");
    case "generate_hypotheses":
      return localize(language, "how many hypotheses were generated?", "가설이 몇 개 생성됐어?");
    case "design_experiments":
      return localize(language, "show the saved experiment designs", "저장된 실험 설계를 보여줘");
    case "implement_experiments":
      return localize(language, "show the generated experiment files", "생성된 실험 파일을 보여줘");
    case "run_experiments":
      return localize(language, "show the experiment run outputs", "실험 실행 결과를 보여줘");
    case "analyze_results":
      return localize(language, "show the result analysis outputs", "결과 분석 산출물을 보여줘");
    case "review":
      return localize(language, "show the review outputs", "리뷰 산출물을 보여줘");
    case "write_paper":
      return localize(language, "show the paper draft outputs", "논문 초안 산출물을 보여줘");
    default:
      return localize(language, `show outputs from ${node}`, `${node} 산출물 보여줘`);
  }
}

function describeCountAction(node: RunRecord["currentNode"], language: GuidanceLanguage): string {
  switch (node) {
    case "collect_papers":
      return localize(language, "Count collected papers", "수집된 논문 개수 보기");
    case "analyze_papers":
      return localize(language, "Count persisted summaries and evidence", "저장된 요약과 근거 개수 보기");
    case "generate_hypotheses":
      return localize(language, "Count generated hypotheses", "생성된 가설 개수 보기");
    case "design_experiments":
      return localize(language, "Inspect saved experiment designs", "저장된 실험 설계 확인");
    case "implement_experiments":
      return localize(language, "Inspect generated experiment files", "생성된 실험 파일 확인");
    case "run_experiments":
      return localize(language, "Inspect run outputs and metrics", "실행 결과와 메트릭 확인");
    case "analyze_results":
      return localize(language, "Inspect result analysis outputs", "결과 분석 산출물 확인");
    case "review":
      return localize(language, "Inspect review outputs", "리뷰 산출물 확인");
    case "write_paper":
      return localize(language, "Inspect paper draft outputs", "논문 초안 산출물 확인");
    default:
      return localize(language, `Inspect outputs from ${node}`, `${node} 산출물 확인`);
  }
}

function describeVerifyOutputsAction(node: RunRecord["currentNode"], language: GuidanceLanguage): string {
  switch (node) {
    case "collect_papers":
      return localize(language, "Verify whether collect_papers stored any papers", "collect_papers가 논문을 실제로 저장했는지 확인");
    case "analyze_papers":
      return localize(
        language,
        "Verify whether analyze_papers persisted any summaries or evidence",
        "analyze_papers가 요약이나 근거를 실제로 저장했는지 확인"
      );
    case "generate_hypotheses":
      return localize(language, "Verify whether generate_hypotheses produced any hypotheses", "generate_hypotheses가 가설을 실제로 만들었는지 확인");
    case "design_experiments":
      return localize(language, "Verify whether design_experiments saved any experiment designs", "design_experiments가 실험 설계를 실제로 저장했는지 확인");
    case "implement_experiments":
      return localize(
        language,
        "Verify whether implement_experiments generated any experiment files",
        "implement_experiments가 실험 파일을 실제로 생성했는지 확인"
      );
    case "run_experiments":
      return localize(language, "Verify whether run_experiments produced any run outputs", "run_experiments가 실행 결과를 실제로 만들었는지 확인");
    case "analyze_results":
      return localize(language, "Verify whether analyze_results produced any result analyses", "analyze_results가 결과 분석을 실제로 만들었는지 확인");
    case "review":
      return localize(language, "Verify whether review produced any review outputs", "review가 리뷰 산출물을 실제로 만들었는지 확인");
    case "write_paper":
      return localize(language, "Verify whether write_paper produced any paper drafts", "write_paper가 논문 초안을 실제로 만들었는지 확인");
    default:
      return localize(language, `Verify whether ${node} produced any outputs`, `${node}가 산출물을 실제로 만들었는지 확인`);
  }
}

function describeMissingOutputsAction(node: RunRecord["currentNode"], language: GuidanceLanguage): string {
  switch (node) {
    case "collect_papers":
      return localize(language, "Check whether collect_papers stored the required papers", "collect_papers가 필요한 논문을 저장했는지 확인");
    case "analyze_papers":
      return localize(
        language,
        "Check whether analyze_papers produced the required summaries and evidence",
        "analyze_papers가 필요한 요약과 근거를 만들었는지 확인"
      );
    case "generate_hypotheses":
      return localize(language, "Check whether generate_hypotheses produced the required hypotheses", "generate_hypotheses가 필요한 가설을 만들었는지 확인");
    case "design_experiments":
      return localize(language, "Check whether design_experiments saved the required experiment designs", "design_experiments가 필요한 실험 설계를 저장했는지 확인");
    case "implement_experiments":
      return localize(
        language,
        "Check whether implement_experiments generated the required experiment files",
        "implement_experiments가 필요한 실험 파일을 생성했는지 확인"
      );
    case "run_experiments":
      return localize(language, "Check whether run_experiments produced the required run outputs", "run_experiments가 필요한 실행 결과를 만들었는지 확인");
    case "analyze_results":
      return localize(language, "Check whether analyze_results produced the required result analyses", "analyze_results가 필요한 결과 분석을 만들었는지 확인");
    case "review":
      return localize(language, "Check whether review produced the required review outputs", "review가 필요한 리뷰 산출물을 만들었는지 확인");
    case "write_paper":
      return localize(language, "Check whether write_paper produced the required paper drafts", "write_paper가 필요한 논문 초안을 만들었는지 확인");
    default:
      return localize(language, `Check whether ${node} produced the required outputs`, `${node}가 필요한 산출물을 만들었는지 확인`);
  }
}

function describeNoOutputsAction(node: RunRecord["currentNode"], language: GuidanceLanguage): string {
  switch (node) {
    case "collect_papers":
      return localize(language, "Confirm that collect_papers still has no stored papers", "collect_papers에 저장된 논문이 아직 없는지 확인");
    case "analyze_papers":
      return localize(
        language,
        "Confirm that analyze_papers still has no persisted summaries or evidence",
        "analyze_papers에 저장된 요약이나 근거가 아직 없는지 확인"
      );
    case "generate_hypotheses":
      return localize(language, "Confirm that generate_hypotheses still has no saved hypotheses", "generate_hypotheses에 저장된 가설이 아직 없는지 확인");
    case "design_experiments":
      return localize(language, "Confirm that design_experiments still has no saved experiment designs", "design_experiments에 저장된 실험 설계가 아직 없는지 확인");
    case "implement_experiments":
      return localize(
        language,
        "Confirm that implement_experiments still has no generated experiment files",
        "implement_experiments에 생성된 실험 파일이 아직 없는지 확인"
      );
    case "run_experiments":
      return localize(language, "Confirm that run_experiments still has no run outputs", "run_experiments에 실행 결과가 아직 없는지 확인");
    case "analyze_results":
      return localize(language, "Confirm that analyze_results still has no result analyses", "analyze_results에 결과 분석이 아직 없는지 확인");
    case "review":
      return localize(language, "Confirm that review still has no review outputs", "review에 리뷰 산출물이 아직 없는지 확인");
    case "write_paper":
      return localize(language, "Confirm that write_paper still has no paper drafts", "write_paper에 논문 초안이 아직 없는지 확인");
    default:
      return localize(language, `Confirm that ${node} still has no outputs`, `${node}에 산출물이 아직 없는지 확인`);
  }
}

function nodeSpecificCommandExample(run: RunRecord, language: GuidanceLanguage): GuidanceItem | undefined {
  switch (run.currentNode) {
    case "collect_papers":
      return {
        label: `/agent collect --additional 100 --run ${run.id}`,
        description: localize(language, "Collect 100 more papers into this run", "이 run에 논문 100개 추가 수집")
      };
    case "analyze_papers":
      return {
        label: `/agent run analyze_papers ${run.id} --top-n 50`,
        description: localize(language, "Analyze only the top 50 papers", "상위 50개 논문만 분석")
      };
    case "generate_hypotheses":
      return {
        label: `/agent run generate_hypotheses ${run.id} --top-k 3 --branch-count 6`,
        description: localize(language, "Generate focused hypothesis branches", "집중된 가설 브랜치 생성")
      };
    case "review":
      return {
        label: "/approve",
        description: localize(language, "Approve review and continue to write_paper", "검토를 승인하고 write_paper로 진행")
      };
    default:
      return undefined;
  }
}

function dedupeGuidanceItems(items: Array<GuidanceItem | undefined>): GuidanceItem[] {
  const seen = new Set<string>();
  const out: GuidanceItem[] = [];
  for (const item of items) {
    if (!item) {
      continue;
    }
    const key = `${item.applyValue || item.label}::${item.description}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

function getNextNode(currentNode: RunRecord["currentNode"]): RunRecord["currentNode"] | undefined {
  const index = GRAPH_NODE_ORDER.indexOf(currentNode);
  if (index === -1 || index === GRAPH_NODE_ORDER.length - 1) {
    return undefined;
  }
  return GRAPH_NODE_ORDER[index + 1];
}

function localize(language: GuidanceLanguage, english: string, korean: string): string {
  return language === "ko" ? korean : english;
}
