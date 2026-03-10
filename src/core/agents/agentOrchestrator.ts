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
      await this.runtime.jumpToNode(runId, nodeId, "force", "manual node run");
    }

    const run = await this.runtime.runUntilPause(runId, opts?.abortSignal);
    if (["failed", "failed_budget"].includes(run.status)) {
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
        summary: run.graph.nodeStates[nodeId].note || run.latestSummary || `${nodeId} executed`
      }
    };
  }

  async runCurrentAgent(runId: string): Promise<AgentRunResponse> {
    return this.runCurrentAgentWithOptions(runId);
  }

  async runCurrentAgentWithOptions(
    runId: string,
    opts?: { abortSignal?: AbortSignal }
  ): Promise<AgentRunResponse> {
    await this.runtime.start(runId);
    const run = await this.runtime.runUntilPause(runId, opts?.abortSignal);

    if (["failed", "failed_budget"].includes(run.status)) {
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
    return this.runtime.approveCurrent(runId);
  }

  async applyPendingTransition(runId: string): Promise<RunRecord> {
    return this.runtime.applyPendingTransition(runId);
  }

  async retryCurrent(runId: string, node?: GraphNodeId): Promise<RunRecord> {
    return this.runtime.retryNode(runId, node);
  }

  async resumeRun(runId: string, checkpointSeq?: number): Promise<RunRecord> {
    return this.runtime.resume(runId, checkpointSeq);
  }

  async jumpToNode(
    runId: string,
    targetNode: GraphNodeId,
    mode: JumpMode,
    reason: string
  ): Promise<RunRecord> {
    return this.runtime.jumpToNode(runId, targetNode, mode, reason);
  }

  async getGraphStatus(runId: string): Promise<RunGraphState> {
    return this.runtime.getGraph(runId);
  }

  async getBudgetStatus(runId: string): Promise<RunGraphState["budget"]> {
    const graph = await this.runtime.getGraph(runId);
    return graph.budget;
  }

  async listCheckpoints(runId: string): Promise<number[]> {
    const items = await this.checkpointStore.list(runId);
    return items.map((item) => item.seq);
  }
}
