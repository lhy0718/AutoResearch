import { GraphNodeId, GRAPH_NODE_ORDER, RunGraphState, RunRecord } from "../../types.js";
import { CheckpointStore } from "../stateGraph/checkpointStore.js";
import { JumpMode } from "../stateGraph/types.js";
import { RunStore } from "../runs/runStore.js";
import { StateGraphRuntime } from "../stateGraph/runtime.js";

export interface AgentRunResponse {
  run: RunRecord;
  result: {
    status: "success" | "failure";
    summary: string;
    error?: string;
  };
}

export class AgentOrchestrator {
  constructor(
    private readonly runStore: RunStore,
    private readonly runtime: StateGraphRuntime,
    private readonly checkpointStore: CheckpointStore
  ) {}

  listAgents(): GraphNodeId[] {
    return [...GRAPH_NODE_ORDER];
  }

  async runAgent(runId: string, nodeId: GraphNodeId): Promise<AgentRunResponse> {
    return this.runAgentWithOptions(runId, nodeId);
  }

  async runAgentWithOptions(
    runId: string,
    nodeId: GraphNodeId,
    opts?: { abortSignal?: AbortSignal }
  ): Promise<AgentRunResponse> {
    await this.runtime.start(runId);
    const current = await this.runStore.getRun(runId);
    if (!current) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (current.currentNode !== nodeId) {
      if (shouldTreatManualRunAsApprovalHandoff(current, nodeId)) {
        await this.runtime.approveCurrent(runId, { continueAfterApprove: false, allowPauseForHuman: true });
      } else {
        await this.runtime.jumpToNode(runId, nodeId, "force", "manual node run");
      }
    }


function shouldTreatManualRunAsApprovalHandoff(run: RunRecord, nodeId: GraphNodeId): boolean {
  const recommendation = run.graph.pendingTransition;
  if (!recommendation || recommendation.action !== "pause_for_human") {
    return false;
  }
  if (recommendation.targetNode !== nodeId) {
    return false;
  }
  const currentIdx = GRAPH_NODE_ORDER.indexOf(run.currentNode);
  const targetIdx = GRAPH_NODE_ORDER.indexOf(nodeId);
  return currentIdx >= 0 && targetIdx === currentIdx + 1;
}
    await this.runtime.runUntilPause(runId, {
      abortSignal: opts?.abortSignal,
      stopAfterApprovalBoundary: true,
      floorNode: nodeId
    });
    const run = await this.getPersistedRunOrThrow(runId);
    if (run.status === "failed") {
      return {
        run,
        result: {
          status: "failure",
          summary: run.latestSummary || "",
          error: run.graph.nodeStates[run.currentNode].lastError || "node failed"
        }
      };
    }

    return {
      run,
      result: {
        status: "success",
        summary: summarizeRun(run, nodeId)
      }
    };
  }

  async runCurrentAgent(runId: string): Promise<AgentRunResponse> {
    return this.runCurrentAgentWithOptions(runId);
  }

  async runCurrentAgentWithOptions(
    runId: string,
    opts?: { abortSignal?: AbortSignal; stopAfterApprovalBoundary?: boolean }
  ): Promise<AgentRunResponse> {
    await this.runtime.start(runId);
    const current = await this.runStore.getRun(runId);
    if (!current) {
      throw new Error(`Run not found: ${runId}`);
    }
    await this.runtime.runUntilPause(runId, {
      abortSignal: opts?.abortSignal,
      floorNode: current.currentNode,
      stopAfterApprovalBoundary: opts?.stopAfterApprovalBoundary
    });
    const run = await this.getPersistedRunOrThrow(runId);

    if (run.status === "failed") {
      return {
        run,
        result: {
          status: "failure",
          summary: run.latestSummary || "",
          error: run.graph.nodeStates[run.currentNode].lastError || "node failed"
        }
      };
    }

    return {
      run,
      result: {
        status: "success",
        summary: run.graph.nodeStates[run.currentNode].note || run.latestSummary || "node executed"
      }
    };
  }

  async approveCurrent(runId: string): Promise<RunRecord> {
    await this.runtime.approveCurrent(runId, { continueAfterApprove: true });
    return this.getPersistedRunOrThrow(runId);
  }

  async applyPendingTransition(runId: string): Promise<RunRecord> {
    await this.runtime.applyPendingTransition(runId);
    return this.getPersistedRunOrThrow(runId);
  }

  async retryCurrent(runId: string, node?: GraphNodeId): Promise<RunRecord> {
    await this.runtime.retryNode(runId, node);
    return this.getPersistedRunOrThrow(runId);
  }

  async resumeRun(runId: string, checkpointSeq?: number): Promise<RunRecord> {
    await this.runtime.resume(runId, checkpointSeq);
    return this.getPersistedRunOrThrow(runId);
  }

  async jumpToNode(
    runId: string,
    targetNode: GraphNodeId,
    mode: JumpMode,
    reason: string
  ): Promise<RunRecord> {
    await this.runtime.jumpToNode(runId, targetNode, mode, reason);
    return this.getPersistedRunOrThrow(runId);
  }

  async getGraphStatus(runId: string): Promise<RunGraphState> {
    return this.runtime.getGraph(runId);
  }

  async listCheckpoints(runId: string): Promise<number[]> {
    const items = await this.checkpointStore.list(runId);
    return items.map((item) => item.seq);
  }

  private async getPersistedRunOrThrow(runId: string): Promise<RunRecord> {
    const run = await this.runStore.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    return run;
  }
}

function summarizeRun(run: RunRecord, requestedNode?: GraphNodeId): string {
  if (requestedNode) {
    const currentIdx = GRAPH_NODE_ORDER.indexOf(run.currentNode);
    const requestedIdx = GRAPH_NODE_ORDER.indexOf(requestedNode);
    if (currentIdx >= 0 && requestedIdx >= 0 && currentIdx < requestedIdx) {
      return run.graph.nodeStates[run.currentNode].note || run.graph.nodeStates[requestedNode].note || run.latestSummary || `${requestedNode} executed`;
    }
    return run.graph.nodeStates[requestedNode].note || run.latestSummary || `${requestedNode} executed`;
  }

  return run.graph.nodeStates[run.currentNode].note || run.latestSummary || "node executed";
}
