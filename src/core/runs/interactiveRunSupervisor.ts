import path from "node:path";

import { AgentOrchestrator } from "../agents/agentOrchestrator.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import {
  appendHumanInterventionHistory,
  clearPendingHumanInterventionRequest,
  HumanInterventionRequest,
  isActiveHumanInterventionRequest,
  readPendingHumanInterventionRequest,
  resolveHumanInterventionAnswer
} from "../humanIntervention.js";
import { GraphNodeId, RunRecord } from "../../types.js";
import { RunStore } from "./runStore.js";

export type InteractiveSupervisorOutcome =
  | {
      status: "awaiting_human";
      run: RunRecord;
      request: HumanInterventionRequest;
    }
  | {
      status: "paused";
      run: RunRecord;
      reason: string;
    }
  | {
      status: "completed" | "failed" | "failed_budget";
      run: RunRecord;
      summary: string;
    };

export type AnswerHumanInterventionResult =
  | {
      status: "resumed";
      run: RunRecord;
      message: string;
    }
  | {
      status: "invalid_answer";
      request: HumanInterventionRequest;
      message: string;
    };

export class InteractiveRunSupervisor {
  constructor(
    private readonly workspaceRoot: string,
    private readonly runStore: RunStore,
    private readonly orchestrator: AgentOrchestrator
  ) {}

  async runUntilStop(
    runId: string,
    opts?: { abortSignal?: AbortSignal }
  ): Promise<InteractiveSupervisorOutcome> {
    const response = await this.orchestrator.runCurrentAgentWithOptions(runId, {
      abortSignal: opts?.abortSignal
    });
    const run = response.run;
    if (run.status === "completed") {
      return {
        status: "completed",
        run,
        summary: response.result.summary
      };
    }
    if (run.status === "failed") {
      return {
        status: "failed",
        run,
        summary: response.result.error || response.result.summary
      };
    }
    if (run.status === "failed_budget") {
      return {
        status: "failed_budget",
        run,
        summary: response.result.error || response.result.summary
      };
    }

    const pendingRequest = await this.getActiveRequest(run);
    if (pendingRequest) {
      return {
        status: "awaiting_human",
        run,
        request: pendingRequest
      };
    }

    return {
      status: "paused",
      run,
      reason: run.graph.pendingTransition?.reason || response.result.summary || "Run paused."
    };
  }

  async answerHumanIntervention(
    runId: string,
    request: HumanInterventionRequest,
    answer: string
  ): Promise<AnswerHumanInterventionResult> {
    const resolved = resolveHumanInterventionAnswer(request, answer);
    if ("error" in resolved) {
      return {
        status: "invalid_answer",
        request,
        message: resolved.error
      };
    }

    const runContext = new RunContextMemory(this.resolveRunContextPath(runId));
    await appendHumanInterventionHistory(runContext, {
      requestId: request.id,
      sourceNode: request.sourceNode,
      kind: request.kind,
      title: request.title,
      answer: resolved.answer,
      selectedChoiceId: resolved.selectedChoice?.id,
      resumeAction: resolved.resumeAction,
      targetNode: resolved.targetNode,
      answeredAt: new Date().toISOString()
    });
    await clearPendingHumanInterventionRequest(runContext);

    if (request.kind === "objective_metric_clarification") {
      await runContext.put("analyze_results.objective_clarification", resolved.answer);
      await runContext.put("objective_metric.last_evaluation", null);
    }

    let updatedRun: RunRecord;
    switch (resolved.resumeAction) {
      case "retry_current":
        updatedRun = await this.orchestrator.retryCurrent(runId, request.sourceNode);
        break;
      case "approve_current":
        updatedRun = await this.orchestrator.approveCurrent(runId);
        break;
      case "apply_transition":
        updatedRun = await this.orchestrator.applyPendingTransition(runId);
        break;
      case "jump":
        if (!resolved.targetNode) {
          return {
            status: "invalid_answer",
            request,
            message: "The selected answer does not define a jump target."
          };
        }
        updatedRun = await this.orchestrator.jumpToNode(
          runId,
          resolved.targetNode,
          "safe",
          `human intervention: ${request.kind}`
        );
        break;
      default:
        return {
          status: "invalid_answer",
          request,
          message: "Unsupported resume action."
        };
    }

    return {
      status: "resumed",
      run: updatedRun,
      message: resolved.selectedChoice
        ? `Applied "${resolved.selectedChoice.label}" and resumed the run.`
        : "Recorded the answer and resumed the run."
    };
  }

  async getActiveRequest(run: RunRecord): Promise<HumanInterventionRequest | undefined> {
    const runContext = new RunContextMemory(this.resolveRunContextPath(run.id));
    const request = await readPendingHumanInterventionRequest(runContext);
    return isActiveHumanInterventionRequest(run, request) ? request : undefined;
  }

  private resolveRunContextPath(runId: string): string {
    return path.join(this.workspaceRoot, ".autolabos", "runs", runId, "memory", "run_context.json");
  }
}
