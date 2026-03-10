import { EventStream } from "../events.js";
import { RunStore } from "../runs/runStore.js";
import { GRAPH_NODE_ORDER, GraphNodeId, RunRecord, TransitionRecommendation } from "../../types.js";
import { AgentOrchestrator } from "./agentOrchestrator.js";

export interface AutonomousRunPolicy {
  mode: "overnight";
  maxMinutes: number;
  minTransitionConfidence: number;
  minDeepBacktrackConfidence: number;
  autoApproveNodes: GraphNodeId[];
  allowedBacktracks: GraphNodeId[];
  maxBackwardJumps: number;
  maxDeepBacktracks: number;
  stopOnRepeatedRecommendation: number;
  stopBeforeWritePaper: boolean;
}

export interface AutonomousRunResult {
  run: RunRecord;
  status: "completed" | "stopped" | "failed" | "canceled";
  reason: string;
  approvalsApplied: number;
  transitionsApplied: number;
  iterations: number;
}

export function buildDefaultOvernightPolicy(): AutonomousRunPolicy {
  return {
    mode: "overnight",
    maxMinutes: 8 * 60,
    minTransitionConfidence: 0.75,
    minDeepBacktrackConfidence: 0.88,
    autoApproveNodes: [
      "design_experiments",
      "implement_experiments",
      "run_experiments",
      "analyze_results"
    ],
    allowedBacktracks: ["implement_experiments", "design_experiments", "generate_hypotheses"],
    maxBackwardJumps: 4,
    maxDeepBacktracks: 1,
    stopOnRepeatedRecommendation: 2,
    stopBeforeWritePaper: true
  };
}

export class AutonomousRunController {
  constructor(
    private readonly runStore: RunStore,
    private readonly orchestrator: AgentOrchestrator,
    private readonly eventStream: EventStream
  ) {}

  async runOvernight(
    runId: string,
    policy: AutonomousRunPolicy = buildDefaultOvernightPolicy(),
    opts?: { abortSignal?: AbortSignal }
  ): Promise<AutonomousRunResult> {
    const startedAt = Date.now();
    let approvalsApplied = 0;
    let transitionsApplied = 0;
    let iterations = 0;
    let repeatedRecommendationCount = 0;
    let lastRecommendationKey: string | undefined;

    let run = await this.getRunOrThrow(runId);
    this.emit(run, `Overnight autonomy started. Max ${policy.maxMinutes} minutes, stop_before_write_paper=${policy.stopBeforeWritePaper}.`);

    while (true) {
      this.throwIfAborted(opts?.abortSignal);
      run = await this.getRunOrThrow(runId);

      if (Date.now() - startedAt > policy.maxMinutes * 60 * 1000) {
        this.emit(run, "Overnight autonomy stopped: time budget reached.");
        return {
          run,
          status: "stopped",
          reason: "Overnight time budget reached.",
          approvalsApplied,
          transitionsApplied,
          iterations
        };
      }

      if (policy.stopBeforeWritePaper && run.currentNode === "write_paper") {
        this.emit(run, "Overnight autonomy stopped before write_paper for manual review.");
        return {
          run,
          status: "stopped",
          reason: "Reached write_paper gate.",
          approvalsApplied,
          transitionsApplied,
          iterations
        };
      }

      if (run.status === "completed") {
        this.emit(run, "Overnight autonomy completed the run.");
        return {
          run,
          status: "completed",
          reason: "Run completed.",
          approvalsApplied,
          transitionsApplied,
          iterations
        };
      }

      if (run.status === "failed" || run.status === "failed_budget") {
        this.emit(run, `Overnight autonomy stopped because the run ${run.status}.`);
        return {
          run,
          status: "failed",
          reason: `Run ${run.status}.`,
          approvalsApplied,
          transitionsApplied,
          iterations
        };
      }

      const state = run.graph.nodeStates[run.currentNode];
      if (run.status === "paused" && state.status === "needs_approval") {
        const recommendation = run.graph.pendingTransition;
        if (recommendation) {
          const key = recommendationKey(recommendation);
          repeatedRecommendationCount = key === lastRecommendationKey ? repeatedRecommendationCount + 1 : 1;
          lastRecommendationKey = key;
          if (repeatedRecommendationCount > policy.stopOnRepeatedRecommendation) {
            this.emit(run, `Overnight autonomy stopped after repeated recommendation: ${key}.`);
            return {
              run,
              status: "stopped",
              reason: `Repeated recommendation: ${key}.`,
              approvalsApplied,
              transitionsApplied,
              iterations
            };
          }

          if (this.canApplyRecommendation(run, recommendation, policy)) {
            this.emit(
              run,
              `Applying recommended transition ${recommendation.action} -> ${recommendation.targetNode || "stay"}.`
            );
            run = await this.orchestrator.applyPendingTransition(run.id);
            transitionsApplied += 1;
            continue;
          }
        }

        if (policy.autoApproveNodes.includes(run.currentNode)) {
          this.emit(run, `Auto-approving ${run.currentNode}.`);
          run = await this.orchestrator.approveCurrent(run.id);
          approvalsApplied += 1;
          continue;
        }

        this.emit(run, `Overnight autonomy paused for manual review at ${run.currentNode}.`);
        return {
          run,
          status: "stopped",
          reason: `Manual review required at ${run.currentNode}.`,
          approvalsApplied,
          transitionsApplied,
          iterations
        };
      }

      const response = await this.orchestrator.runCurrentAgentWithOptions(run.id, {
        abortSignal: opts?.abortSignal
      });
      run = response.run;
      iterations += 1;
    }
  }

  private canApplyRecommendation(
    run: RunRecord,
    recommendation: TransitionRecommendation,
    policy: AutonomousRunPolicy
  ): boolean {
    if (!recommendation.autoExecutable) {
      return false;
    }
    if (recommendation.confidence < policy.minTransitionConfidence) {
      return false;
    }
    if (recommendation.action === "pause_for_human") {
      return false;
    }
    if (recommendation.action === "advance") {
      return true;
    }
    if (!recommendation.targetNode) {
      return false;
    }
    if (!policy.allowedBacktracks.includes(recommendation.targetNode)) {
      return false;
    }

    const backwardJumps = (run.graph.transitionHistory || []).filter((item) => {
      if (!item.toNode) {
        return false;
      }
      return GRAPH_NODE_ORDER.indexOf(item.toNode) < GRAPH_NODE_ORDER.indexOf(item.fromNode);
    }).length;
    const deepBacktracks = (run.graph.transitionHistory || []).filter((item) => {
      return item.toNode === "generate_hypotheses";
    }).length;
    const isDeepBacktrack = recommendation.targetNode === "generate_hypotheses";

    if (backwardJumps >= policy.maxBackwardJumps) {
      return false;
    }
    if (isDeepBacktrack && recommendation.confidence < policy.minDeepBacktrackConfidence) {
      return false;
    }
    if (isDeepBacktrack && deepBacktracks >= policy.maxDeepBacktracks) {
      return false;
    }
    if (isDeepBacktrack && !supportsHypothesisBacktrack(recommendation)) {
      return false;
    }
    return true;
  }

  private async getRunOrThrow(runId: string): Promise<RunRecord> {
    const run = await this.runStore.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    return run;
  }

  private emit(run: RunRecord, text: string): void {
    this.eventStream.emit({
      type: "OBS_RECEIVED",
      runId: run.id,
      node: run.currentNode,
      payload: { text }
    });
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error("Operation aborted by user");
    }
  }
}

function recommendationKey(recommendation: TransitionRecommendation): string {
  return `${recommendation.action}:${recommendation.targetNode || "stay"}`;
}

function supportsHypothesisBacktrack(recommendation: TransitionRecommendation): boolean {
  const text = [recommendation.reason, ...recommendation.evidence].join(" ").toLowerCase();
  const hasHypothesisSignal =
    text.includes("hypothesis") ||
    text.includes("idea set") ||
    text.includes("shortlisted") ||
    text.includes("not support");
  const hasExecutionSignal =
    text.includes("runtime") ||
    text.includes("verifier") ||
    text.includes("metrics file") ||
    text.includes("missing metrics");
  return hasHypothesisSignal && !hasExecutionSignal;
}
