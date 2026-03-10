import { EventStream } from "../events.js";
import { saveReflexion } from "../agents/runtime/reflexion.js";
import { EpisodeMemory } from "../memory/episodeMemory.js";
import { RunStore } from "../runs/runStore.js";
import {
  GRAPH_NODE_ORDER,
  GraphNodeId,
  RunGraphState,
  RunRecord,
  TransitionRecommendation
} from "../../types.js";
import { CheckpointStore } from "./checkpointStore.js";
import { GraphNodeRegistry, JumpMode } from "./types.js";
import { defaultRunStatusForGraph } from "./defaults.js";

export class StateGraphRuntime {
  constructor(
    private readonly runStore: RunStore,
    private readonly nodeRegistry: GraphNodeRegistry,
    private readonly checkpointStore: CheckpointStore,
    private readonly eventStream: EventStream
  ) {}

  async start(runId: string): Promise<RunRecord> {
    const run = await this.getRunOrThrow(runId);
    if (!run.currentNode) {
      run.currentNode = GRAPH_NODE_ORDER[0];
      run.graph.currentNode = run.currentNode;
    }
    run.status = "running";
    await this.runStore.updateRun(run);
    return run;
  }

  async resume(runId: string, checkpointSeq?: number): Promise<RunRecord> {
    const checkpoint = await this.checkpointStore.load(runId, checkpointSeq);
    if (checkpoint) {
      await this.runStore.updateRun(checkpoint.runSnapshot);
      return checkpoint.runSnapshot;
    }

    const run = await this.getRunOrThrow(runId);
    run.status = run.status === "completed" ? "completed" : defaultRunStatusForGraph(run.graph);
    await this.runStore.updateRun(run);
    return run;
  }

  async step(runId: string, abortSignal?: AbortSignal): Promise<RunRecord> {
    this.throwIfAborted(abortSignal);
    let run = await this.getRunOrThrow(runId);
    run.graph.currentNode = run.currentNode;

    if (this.isBudgetExceeded(run)) {
      return this.failByBudget(run, "Budget exceeded before executing next node.");
    }

    const node = run.currentNode;
    run.graph.nodeStates[node] = {
      ...run.graph.nodeStates[node],
      status: "running",
      updatedAt: new Date().toISOString()
    };
    run.status = "running";
    await this.runStore.updateRun(run);

    this.eventStream.emit({
      type: "NODE_STARTED",
      runId: run.id,
      node,
      payload: { node }
    });

    const before = await this.checkpointStore.save(run, "before");
    this.eventStream.emit({
      type: "CHECKPOINT_SAVED",
      runId: run.id,
      node,
      payload: { checkpoint: before.seq, phase: before.phase }
    });

    const started = Date.now();
    try {
      this.throwIfAborted(abortSignal);
      const result = await this.nodeRegistry.get(node).execute({
        run,
        graph: run.graph,
        abortSignal
      });
      this.throwIfAborted(abortSignal);
      run = await this.getRunOrThrow(run.id);
      const elapsed = Date.now() - started;
      run.graph.budget.wallClockMsUsed += elapsed;
      run.graph.budget.toolCallsUsed += result.toolCallsUsed ?? 0;
      if (typeof result.costUsd === "number") {
        run.graph.budget.usdUsed = (run.graph.budget.usdUsed ?? 0) + result.costUsd;
      }

      if (this.isBudgetExceeded(run)) {
        return this.failByBudget(run, "Budget exceeded after node execution.");
      }

      if (result.status === "failure") {
        return this.handleFailure(run, node, result.error || "Node execution failed");
      }

      run.latestSummary = result.summary || run.latestSummary;
      run.graph.pendingTransition = result.transitionRecommendation;
      run.graph.nodeStates[node] = {
        ...run.graph.nodeStates[node],
        status: result.needsApproval ? "needs_approval" : "completed",
        updatedAt: new Date().toISOString(),
        note: result.summary
      };
      run.status = result.needsApproval ? "paused" : "running";

      if (!result.needsApproval) {
        const next = this.nextNode(node);
        if (!next) {
          run.status = "completed";
        } else {
          run.currentNode = next;
          run.graph.currentNode = next;
        }
      }

      const after = await this.checkpointStore.save(run, "after");
      this.eventStream.emit({
        type: "CHECKPOINT_SAVED",
        runId: run.id,
        node,
        payload: { checkpoint: after.seq, phase: after.phase }
      });
      this.eventStream.emit({
        type: "NODE_COMPLETED",
        runId: run.id,
        node,
        payload: { summary: result.summary || "completed" }
      });
      if (result.transitionRecommendation) {
        this.eventStream.emit({
          type: "TRANSITION_RECOMMENDED",
          runId: run.id,
          node,
          payload: {
            action: result.transitionRecommendation.action,
            targetNode: result.transitionRecommendation.targetNode,
            reason: result.transitionRecommendation.reason,
            confidence: result.transitionRecommendation.confidence
          }
        });
      }

      await this.runStore.updateRun(run);
      return run;
    } catch (error) {
      if (isAbortError(error)) {
        run = await this.getRunOrThrow(run.id);
        run.status = "paused";
        run.graph.nodeStates[node] = {
          ...run.graph.nodeStates[node],
          status: "pending",
          updatedAt: new Date().toISOString(),
          note: "Canceled by user"
        };
        await this.runStore.updateRun(run);
        return run;
      }
      const message = error instanceof Error ? error.message : String(error);
      return this.handleFailure(run, node, message);
    }
  }

  async runUntilPause(runId: string, abortSignal?: AbortSignal): Promise<RunRecord> {
    let run = await this.getRunOrThrow(runId);
    try {
      this.throwIfAborted(abortSignal);
      run.status = "running";
      await this.runStore.updateRun(run);

      while (true) {
        this.throwIfAborted(abortSignal);
        run = await this.step(run.id, abortSignal);
        if (["completed", "failed", "failed_budget"].includes(run.status)) {
          return run;
        }

        const state = run.graph.nodeStates[run.currentNode];
        if (state.status === "needs_approval") {
          return run;
        }

        if (run.status === "paused") {
          return run;
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        run = await this.getRunOrThrow(runId);
        run.status = "paused";
        await this.runStore.updateRun(run);
        return run;
      }
      throw error;
    }
  }

  async approveCurrent(runId: string): Promise<RunRecord> {
    const run = await this.getRunOrThrow(runId);
    const node = run.currentNode;
    const state = run.graph.nodeStates[node];

    if (state.status !== "needs_approval") {
      return run;
    }

    run.graph.pendingTransition = undefined;
    run.graph.nodeStates[node] = {
      ...state,
      status: "completed",
      updatedAt: new Date().toISOString()
    };

    const next = this.nextNode(node);
    if (!next) {
      run.status = "completed";
    } else {
      run.currentNode = next;
      run.graph.currentNode = next;
      run.status = "running";
    }

    await this.checkpointStore.save(run, "after", "approved");
    await this.runStore.updateRun(run);
    return run;
  }

  async applyPendingTransition(runId: string): Promise<RunRecord> {
    const run = await this.getRunOrThrow(runId);
    const recommendation = run.graph.pendingTransition;
    if (!recommendation) {
      return run;
    }

    run.graph.pendingTransition = undefined;
    run.graph.transitionHistory = [
      ...(run.graph.transitionHistory || []),
      {
        action: recommendation.action,
        sourceNode: recommendation.sourceNode,
        fromNode: run.currentNode,
        toNode: recommendation.targetNode,
        reason: recommendation.reason,
        confidence: recommendation.confidence,
        autoExecutable: recommendation.autoExecutable,
        appliedAt: new Date().toISOString()
      }
    ];
    await this.runStore.updateRun(run);

    this.eventStream.emit({
      type: "TRANSITION_APPLIED",
      runId: run.id,
      node: recommendation.targetNode || run.currentNode,
      payload: {
        action: recommendation.action,
        fromNode: run.currentNode,
        targetNode: recommendation.targetNode,
        reason: recommendation.reason,
        confidence: recommendation.confidence
      }
    });

    if (recommendation.action === "advance") {
      return this.approveCurrent(run.id);
    }

    if (recommendation.action === "pause_for_human" || !recommendation.targetNode) {
      return run;
    }

    if (recommendation.targetNode === run.currentNode) {
      return this.retryNode(run.id, recommendation.targetNode);
    }

    return this.jumpToNode(run.id, recommendation.targetNode, "safe", recommendation.reason);
  }

  async retryNode(runId: string, node?: GraphNodeId): Promise<RunRecord> {
    const run = await this.getRunOrThrow(runId);
    const target = node || run.currentNode;
    run.graph.pendingTransition = undefined;
    run.currentNode = target;
    run.graph.currentNode = target;
    run.graph.nodeStates[target] = {
      ...run.graph.nodeStates[target],
      status: "running",
      updatedAt: new Date().toISOString(),
      note: "manual retry"
    };
    run.graph.retryCounters[target] = (run.graph.retryCounters[target] ?? 0) + 1;
    run.status = "running";

    const checkpoint = await this.checkpointStore.save(run, "retry", "manual retry");
    this.eventStream.emit({
      type: "NODE_RETRY",
      runId: run.id,
      node: target,
      payload: { attempts: run.graph.retryCounters[target], checkpoint: checkpoint.seq }
    });

    await this.runStore.updateRun(run);
    return run;
  }

  async jumpToNode(runId: string, targetNode: GraphNodeId, mode: JumpMode, reason: string): Promise<RunRecord> {
    const run = await this.getRunOrThrow(runId);
    const currentIdx = GRAPH_NODE_ORDER.indexOf(run.currentNode);
    const targetIdx = GRAPH_NODE_ORDER.indexOf(targetNode);

    if (targetIdx < 0) {
      throw new Error(`Unknown target node: ${targetNode}`);
    }

    if (mode === "safe" && targetIdx > currentIdx) {
      throw new Error("Safe jump only allows current/previous nodes.");
    }

    if (targetIdx > currentIdx) {
      for (let idx = currentIdx; idx < targetIdx; idx += 1) {
        const node = GRAPH_NODE_ORDER[idx];
        run.graph.nodeStates[node] = {
          ...run.graph.nodeStates[node],
          status: "skipped",
          updatedAt: new Date().toISOString(),
          note: `Skipped by jump: ${reason}`
        };
      }
    }

    if (targetIdx < currentIdx) {
      run.graph.researchCycle = (run.graph.researchCycle || 0) + 1;
      for (let idx = targetIdx + 1; idx < GRAPH_NODE_ORDER.length; idx += 1) {
        const node = GRAPH_NODE_ORDER[idx];
        run.graph.nodeStates[node] = {
          ...run.graph.nodeStates[node],
          status: "pending",
          updatedAt: new Date().toISOString(),
          note: `Reset by backward jump (cycle ${run.graph.researchCycle})`
        };
      }
    }

    run.graph.pendingTransition = undefined;
    run.currentNode = targetNode;
    run.graph.currentNode = targetNode;
    run.status = "paused";

    const checkpoint = await this.checkpointStore.save(run, "jump", reason);
    this.eventStream.emit({
      type: "NODE_JUMP",
      runId: run.id,
      node: targetNode,
      payload: {
        mode,
        reason,
        checkpoint: checkpoint.seq
      }
    });

    await this.runStore.updateRun(run);
    return run;
  }

  async getGraph(runId: string): Promise<RunGraphState> {
    const run = await this.getRunOrThrow(runId);
    return run.graph;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error("Operation aborted by user");
    }
  }

  private async handleFailure(run: RunRecord, node: GraphNodeId, errorMessage: string): Promise<RunRecord> {
    run.graph.pendingTransition = undefined;
    const nextRetry = (run.graph.retryCounters[node] ?? 0) + 1;
    run.graph.retryCounters[node] = nextRetry;

    run.graph.nodeStates[node] = {
      ...run.graph.nodeStates[node],
      status: "failed",
      updatedAt: new Date().toISOString(),
      lastError: errorMessage,
      note: errorMessage
    };

    await saveReflexion({
      runId: run.id,
      nodeId: node,
      attempt: nextRetry,
      errorMessage,
      planExcerpt: `Node ${node}`,
      observations: [errorMessage],
      episodeMemory: new EpisodeMemory(run.memoryRefs.episodePath),
      eventStream: this.eventStream
    });

    const failCheckpoint = await this.checkpointStore.save(run, "fail", errorMessage);
    this.eventStream.emit({
      type: "CHECKPOINT_SAVED",
      runId: run.id,
      node,
      payload: { checkpoint: failCheckpoint.seq, phase: failCheckpoint.phase }
    });
    this.eventStream.emit({
      type: "NODE_FAILED",
      runId: run.id,
      node,
      payload: { error: errorMessage, retryAttempt: nextRetry }
    });

    if (nextRetry < run.graph.retryPolicy.maxAttemptsPerNode) {
      run.status = "running";
      run.graph.nodeStates[node] = {
        ...run.graph.nodeStates[node],
        status: "running",
        updatedAt: new Date().toISOString(),
        note: `Auto retry scheduled (${nextRetry}/${run.graph.retryPolicy.maxAttemptsPerNode})`
      };
      const retryCheckpoint = await this.checkpointStore.save(run, "retry", "auto retry");
      this.eventStream.emit({
        type: "NODE_RETRY",
        runId: run.id,
        node,
        payload: { attempt: nextRetry, checkpoint: retryCheckpoint.seq }
      });
      await this.runStore.updateRun(run);
      return run;
    }

    const rollbackCount = (run.graph.rollbackCounters[node] ?? 0) + 1;
    run.graph.rollbackCounters[node] = rollbackCount;

    if (rollbackCount > run.graph.retryPolicy.maxAutoRollbacksPerNode) {
      run.status = "failed";
      await this.runStore.updateRun(run);
      return run;
    }

    const prev = this.previousNode(node);
    if (!prev) {
      run.status = "failed";
      await this.runStore.updateRun(run);
      return run;
    }

    run.currentNode = prev;
    run.graph.currentNode = prev;
    run.status = "running";

    run.graph.nodeStates[prev] = {
      ...run.graph.nodeStates[prev],
      status: "running",
      updatedAt: new Date().toISOString(),
      note: `Auto rollback from ${node}`
    };

    const rollbackCheckpoint = await this.checkpointStore.save(run, "jump", `rollback to ${prev}`);
    this.eventStream.emit({
      type: "NODE_ROLLBACK",
      runId: run.id,
      node: prev,
      payload: {
        from: node,
        rollbackCount,
        checkpoint: rollbackCheckpoint.seq
      }
    });

    await this.runStore.updateRun(run);
    return run;
  }

  private async failByBudget(run: RunRecord, reason: string): Promise<RunRecord> {
    run.graph.pendingTransition = undefined;
    run.status = "failed_budget";
    run.graph.nodeStates[run.currentNode] = {
      ...run.graph.nodeStates[run.currentNode],
      status: "failed",
      updatedAt: new Date().toISOString(),
      note: reason,
      lastError: reason
    };

    const checkpoint = await this.checkpointStore.save(run, "fail", reason);
    this.eventStream.emit({
      type: "BUDGET_EXCEEDED",
      runId: run.id,
      node: run.currentNode,
      payload: {
        reason,
        budget: run.graph.budget,
        checkpoint: checkpoint.seq
      }
    });

    await this.runStore.updateRun(run);
    return run;
  }

  private nextNode(node: GraphNodeId): GraphNodeId | undefined {
    const idx = GRAPH_NODE_ORDER.indexOf(node);
    if (idx < 0 || idx === GRAPH_NODE_ORDER.length - 1) {
      return undefined;
    }
    return GRAPH_NODE_ORDER[idx + 1];
  }

  private previousNode(node: GraphNodeId): GraphNodeId | undefined {
    const idx = GRAPH_NODE_ORDER.indexOf(node);
    if (idx <= 0) {
      return undefined;
    }
    return GRAPH_NODE_ORDER[idx - 1];
  }

  private isBudgetExceeded(run: RunRecord): boolean {
    const budget = run.graph.budget;
    if (budget.toolCallsUsed > budget.policy.maxToolCalls) {
      return true;
    }
    if (budget.wallClockMsUsed > budget.policy.maxWallClockMinutes * 60 * 1000) {
      return true;
    }
    if (typeof budget.usdUsed === "number" && budget.usdUsed > budget.policy.maxUsd) {
      return true;
    }
    return false;
  }

  private async getRunOrThrow(runId: string): Promise<RunRecord> {
    const run = await this.runStore.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    run.graph.transitionHistory = run.graph.transitionHistory || [];
    run.graph.researchCycle = run.graph.researchCycle || 0;
    return run;
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const lower = error.message.toLowerCase();
  return lower.includes("aborted") || lower.includes("abort");
}
