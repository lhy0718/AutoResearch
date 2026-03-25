import { RunRecord } from "../types.js";
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
  if (input.pendingPlan) {
    return buildPendingPlanGuidance(input.pendingPlan);
  }

  if (input.humanIntervention) {
    return buildHumanInterventionGuidance(input.humanIntervention);
  }

  if (!input.run) {
    return {
      title: "Research brief",
      items: [
        {
          label: "new brief",
          description: "Create or open workspace Brief.md.",
          applyValue: "/new"
        },
        {
          label: "start latest brief",
          description: "Start workspace Brief.md or the latest legacy brief.",
          applyValue: "/brief start --latest"
        }
      ]
    };
  }

  const projection = projectRunForDisplay(input.run, input.projectionHints);
  const run = projection.run;
  const targetNode = projection.actionableNode;
  const targetNodeStatus = projection.actionableNodeStatus ?? run.graph.nodeStates[targetNode]?.status;
  const nodeStatus = run.graph.nodeStates[run.currentNode]?.status;

  if (run.status === "completed") {
    return {
      title: "Run complete",
      items: [
        {
          label: "new brief",
          description: "Create or open the next workspace Brief.md.",
          applyValue: "/new"
        },
        {
          label: "start latest brief",
          description: "Start workspace Brief.md or the latest legacy brief.",
          applyValue: "/brief start --latest"
        }
      ]
    };
  }

  const items: GuidanceItem[] = [];
  if (run.status === "paused" && nodeStatus === "needs_approval") {
    items.push({
      label: "approve",
      description: `Approve ${targetNode} and continue the workflow.`,
      applyValue: "/approve"
    });
  }

  items.push(buildRunItem(run, targetNode, targetNodeStatus, projection));
  items.push({
    label: "steering",
    description: steeringDescriptionForNode(targetNode)
  });

  return {
    title: items[0]?.label === "approve" ? "Approval" : "Next step",
    items
  };
}

function buildHumanInterventionGuidance(
  intervention: PendingHumanInterventionGuidance
): ContextualGuidance {
  const items: GuidanceItem[] = [
    {
      label: "answer",
      description: intervention.question
    }
  ];

  for (const [index, choice] of (intervention.choices || []).entries()) {
    items.push({
      label: `choice ${index + 1}`,
      description: choice.description ? `${choice.label}: ${choice.description}` : choice.label
    });
  }

  items.push({
    label: "approve",
    description: "Approve the current boundary if you want to continue with the current plan.",
    applyValue: "/approve"
  });

  return {
    title: intervention.title || "Awaiting input",
    items
  };
}

function buildRunItem(
  run: RunRecord,
  targetNode: RunRecord["currentNode"],
  targetNodeStatus: RunRecord["graph"]["nodeStates"][RunRecord["currentNode"]]["status"] | undefined,
  projection: ReturnType<typeof projectRunForDisplay>
): GuidanceItem {
  const runCommand = `/agent run ${targetNode} ${run.id}`;
  const retryCommand = `/agent retry ${targetNode} ${run.id}`;

  if (projection.usageLimitBlocked) {
    return {
      label: "run",
      description: `Retry ${targetNode}. If quota is still blocked, switch models with /model before retrying.`,
      applyValue: retryCommand
    };
  }

  if (projection.blockedByUpstream) {
    return {
      label: "run",
      description: `Recover ${targetNode} by retrying it first.`,
      applyValue: retryCommand
    };
  }

  if (
    (run.status === "failed" || targetNodeStatus === "failed" || projection.pausedRetry) &&
    targetNodeStatus !== "running" &&
    targetNodeStatus !== "pending"
  ) {
    return {
      label: "run",
      description: `Retry ${targetNode}.`,
      applyValue: retryCommand
    };
  }

  return {
    label: "run",
    description: `Continue ${targetNode}.`,
    applyValue: runCommand
  };
}

function buildPendingPlanGuidance(plan: PendingPlanGuidance): ContextualGuidance {
  const preview = plan.displayCommands?.[0] || plan.commands[0] || plan.command;
  const step = `${plan.stepIndex + 1}/${plan.totalSteps}`;

  return {
    title: plan.totalSteps > 1 ? "Plan ready" : "Command ready",
    items: [
      {
        label: "run",
        description: `Run step ${step}: ${preview}`,
        applyValue: "y"
      },
      {
        label: "cancel",
        description:
          plan.totalSteps > 1
            ? `Cancel the remaining plan from step ${step}.`
            : "Cancel this pending command.",
        applyValue: "n"
      }
    ]
  };
}

export function detectGuidanceLanguageFromText(text: string): GuidanceLanguage | undefined {
  return text.trim() ? "en" : undefined;
}

function steeringDescriptionForNode(node: RunRecord["currentNode"]): string {
  switch (node) {
    case "collect_papers":
      return "Add steering to narrow scope, sources, or ranking before the next run.";
    case "analyze_papers":
      return "Add steering to tighten relevance, evidence quality, or analysis depth.";
    case "generate_hypotheses":
      return "Add steering to bias toward stronger, simpler, or more testable hypotheses.";
    case "design_experiments":
      return "Add steering to prefer simpler, cheaper, or more decisive experiment designs.";
    case "implement_experiments":
      return "Add steering to constrain implementation scope or runtime assumptions.";
    case "run_experiments":
      return "Add steering to prioritize the most informative executions first.";
    case "analyze_results":
      return "Add steering to focus the analysis on the decision you care about most.";
    case "review":
      return "Add steering to tighten the review criteria before continuing.";
    case "write_paper":
      return "Add steering to emphasize the claims, evidence, or structure you want in the draft.";
    default:
      return "Add steering to redirect the next step.";
  }
}
