import { GRAPH_NODE_ORDER, GraphNodeId, RunRecord } from "../../types.js";

export interface NaturalAssistantContext {
  input: string;
  runs: RunRecord[];
  activeRunId?: string;
}

export interface NaturalAssistantResponse {
  lines: string[];
  targetRunId?: string;
  pendingCommand?: string;
}

const STRUCTURE_KEYWORDS = [
  "structure",
  "architecture",
  "pipeline",
  "workflow",
  "state graph",
  "flow",
  "구조",
  "아키텍처",
  "파이프라인",
  "워크플로",
  "상태 그래프",
  "흐름"
];

const NEXT_KEYWORDS = [
  "next",
  "what next",
  "recommend",
  "suggest",
  "how",
  "how do i",
  "what should i do",
  "해야",
  "다음",
  "추천",
  "어떻게",
  "뭐해",
  "무엇",
  "뭘",
  "진행"
];

const STATUS_KEYWORDS = [
  "status",
  "progress",
  "state",
  "paused",
  "stuck",
  "blocked",
  "halted",
  "상태",
  "진행",
  "현황",
  "멈",
  "중단",
  "막혔",
  "어디까지"
];

const EXECUTE_INTENT_KEYWORDS = [
  "run",
  "execute",
  "start",
  "go ahead",
  "do it",
  "retry",
  "approve",
  "실행",
  "시작",
  "재시도",
  "승인"
];

export function matchesNaturalAssistantIntent(input: string): boolean {
  const lower = input.trim().toLowerCase();
  if (!lower) {
    return false;
  }
  return (
    includesAny(lower, STRUCTURE_KEYWORDS) ||
    includesAny(lower, NEXT_KEYWORDS) ||
    includesAny(lower, STATUS_KEYWORDS) ||
    includesAny(lower, EXECUTE_INTENT_KEYWORDS)
  );
}

export function buildNaturalAssistantResponse(ctx: NaturalAssistantContext): NaturalAssistantResponse {
  const text = ctx.input.trim();
  const lower = text.toLowerCase();
  const wantsStructure = includesAny(lower, STRUCTURE_KEYWORDS);
  const wantsNext = includesAny(lower, NEXT_KEYWORDS);
  const wantsStatus = includesAny(lower, STATUS_KEYWORDS);
  const wantsExecution = includesAny(lower, EXECUTE_INTENT_KEYWORDS);
  const targetRun = resolveTargetRun(ctx.runs, ctx.activeRunId, lower);

  const lines: string[] = [];
  if (wantsStructure) {
    lines.push(
      "Workflow: collect_papers -> analyze_papers -> generate_hypotheses -> design_experiments -> implement_experiments -> run_experiments -> analyze_results -> figure_audit -> review -> write_paper"
    );
  }

  if (!targetRun) {
    lines.push("No run is active yet.");
    lines.push("Next action: new brief");
    lines.push("Create a Research Brief with /new and start it with /brief start --latest.");
    return { lines, pendingCommand: wantsExecution ? "/new" : undefined };
  }

  const nodeState = targetRun.graph.nodeStates[targetRun.currentNode];
  const doneCount = GRAPH_NODE_ORDER.filter((node) => {
    const status = targetRun.graph.nodeStates[node].status;
    return status === "completed" || status === "skipped";
  }).length;

  if (wantsStatus || wantsNext || wantsExecution) {
    lines.push(`Run: ${targetRun.id} | ${targetRun.title}`);
    lines.push(
      `Status: ${targetRun.status} | Node: ${targetRun.currentNode} (${nodeState.status}) | Progress: ${doneCount}/${GRAPH_NODE_ORDER.length}`
    );

    const recommendation = buildNextStepRecommendation(targetRun, nodeState.status);
    lines.push(...recommendation.lines);
    return {
      lines,
      targetRunId: targetRun.id,
      pendingCommand: wantsExecution ? recommendation.primaryCommand : undefined
    };
  }

  lines.push("I can answer run status and next-step questions. Ask: What should I do next?");
  return {
    lines,
    targetRunId: targetRun.id
  };
}

interface NextStepRecommendation {
  lines: string[];
  primaryCommand?: string;
}

function buildNextStepRecommendation(
  run: RunRecord,
  nodeStatus: RunRecord["graph"]["nodeStates"][GraphNodeId]["status"]
): NextStepRecommendation {
  if (run.status === "completed") {
    return {
      lines: ["Run is already completed.", "Next action: new brief"],
      primaryCommand: "/new"
    };
  }

  if (run.status === "failed" || nodeStatus === "failed") {
    const recommendation = run.graph.pendingTransition;
    if (recommendation) {
      return {
        lines: [
          "Next action: apply transition",
          `Apply the recorded transition to ${recommendation.targetNode || "stay"}.`
        ],
        primaryCommand: `/agent apply ${run.id}`
      };
    }

    const command = `/agent retry ${run.currentNode} ${run.id}`;
    return {
      lines: ["Next action: run", `This retries ${run.currentNode}.`],
      primaryCommand: command
    };
  }

  if (run.status === "paused" && nodeStatus === "needs_approval") {
    return {
      lines: ["Next action: approve", "Approve the current step to continue the workflow."],
      primaryCommand: "/approve"
    };
  }

  const command = `/agent run ${run.currentNode} ${run.id}`;
  return {
    lines: ["Next action: run", `This continues ${run.currentNode}.`],
    primaryCommand: command
  };
}

function resolveTargetRun(runs: RunRecord[], activeRunId: string | undefined, lowerInput: string): RunRecord | undefined {
  for (const run of runs) {
    if (lowerInput.includes(run.id.toLowerCase()) || lowerInput.includes(run.title.toLowerCase())) {
      return run;
    }
  }

  if (activeRunId) {
    const active = runs.find((run) => run.id === activeRunId);
    if (active) {
      return active;
    }
  }

  return runs[0];
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}
