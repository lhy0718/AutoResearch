import { EventStream } from "../events.js";
import { saveReflexion } from "../agents/runtime/reflexion.js";
import { EpisodeMemory } from "../memory/episodeMemory.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { RunStore } from "../runs/runStore.js";
import {
  GRAPH_NODE_ORDER,
  GraphNodeId,
  RunGraphState,
  RunRecord,
  TransitionRecommendation,
  WorkflowApprovalMode
} from "../../types.js";
import { CheckpointStore } from "./checkpointStore.js";
import { CheckpointPhase, GraphNodeRegistry, JumpMode } from "./types.js";
import { defaultRunStatusForGraph } from "./defaults.js";

export class StateGraphRuntime {
  constructor(
    private readonly runStore: RunStore,
    private readonly nodeRegistry: GraphNodeRegistry,
    private readonly checkpointStore: CheckpointStore,
    private readonly eventStream: EventStream,
    private readonly options: {
      approvalMode?: WorkflowApprovalMode;
    } = {}
  ) {}

  async start(runId: string): Promise<RunRecord> {
    const run = await this.getRunOrThrow(runId);
    if (!run.currentNode) {
      run.currentNode = GRAPH_NODE_ORDER[0];
      run.graph.currentNode = run.currentNode;
    }
    run.status = "running";
    this.syncLatestSummary(run);
    await this.runStore.updateRun(run);
    return run;
  }

  async resume(runId: string, checkpointSeq?: number): Promise<RunRecord> {
    const current = await this.getRunOrThrow(runId);
    const checkpoint = await this.checkpointStore.load(runId, checkpointSeq);
    if (checkpoint) {
      const restored = structuredClone(checkpoint.runSnapshot);
      if (checkpointSeq == null && this.isCheckpointSnapshotStale(current, restored)) {
        current.status = current.status === "completed" ? "completed" : defaultRunStatusForGraph(current.graph);
        this.syncLatestSummary(current);
        await this.runStore.updateRun(current);
        return this.getRunOrThrow(runId);
      }

      if (checkpointSeq != null) {
        restored.graph.checkpointSeq = Math.max(
          restored.graph.checkpointSeq ?? 0,
          current.graph.checkpointSeq ?? 0
        );
        this.syncLatestSummary(restored);
        await this.saveCheckpointAndPersist(restored, "jump", `resume to checkpoint ${checkpoint.seq}`);
        return this.getRunOrThrow(runId);
      }

      this.syncLatestSummary(restored);
      await this.runStore.updateRun(restored);
      return this.getRunOrThrow(runId);
    }

    current.status = current.status === "completed" ? "completed" : defaultRunStatusForGraph(current.graph);
    this.syncLatestSummary(current);
    await this.runStore.updateRun(current);
    return this.getRunOrThrow(runId);
  }

  async step(runId: string, abortSignal?: AbortSignal): Promise<RunRecord> {
    this.throwIfAborted(abortSignal);
    let run = await this.getRunOrThrow(runId);
    run.graph.currentNode = run.currentNode;

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

    const before = await this.saveCheckpointAndPersist(run, "before");
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
      // Once a node returns, its result becomes the source of truth even if a
      // late Ctrl-C arrives before runtime persistence finishes.
      run = await this.getRunOrThrow(run.id);
      void started;
      void result.toolCallsUsed;
      void result.costUsd;

      if (result.status === "failure") {
        return this.handleFailure(run, node, result.error || "Node execution failed");
      }

      run.latestSummary = result.summary || run.latestSummary;
      run.graph.pendingTransition = result.transitionRecommendation;
      run.graph.nodeStates[node] = {
        ...run.graph.nodeStates[node],
        status: result.needsApproval ? "needs_approval" : "completed",
        updatedAt: new Date().toISOString(),
        note: result.summary,
        lastError: undefined
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

      this.syncLatestSummary(run, node);
      const after = await this.saveCheckpointAndPersist(run, "after");
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

      return this.getRunOrThrow(run.id);
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
        this.syncLatestSummary(run);
        await this.runStore.updateRun(run);
        return this.getRunOrThrow(run.id);
      }
      const message = error instanceof Error ? error.message : String(error);
      run = await this.getRunOrThrow(run.id);
      return this.handleFailure(run, node, message);
    }
  }

  async runUntilPause(
    runId: string,
    opts?: {
      abortSignal?: AbortSignal;
      stopAfterApprovalBoundary?: boolean;
      floorNode?: GraphNodeId;
    }
  ): Promise<RunRecord> {
    let run = await this.getRunOrThrow(runId);
    const continuePastCollectRecovery =
      Boolean(opts?.stopAfterApprovalBoundary) &&
      opts?.floorNode === "collect_papers" &&
      this.hasVisitedLaterNodes(run, opts.floorNode);
    let continuedPastCollectRecovery = false;
    try {
      this.throwIfAborted(opts?.abortSignal);
      if (run.status === "failed") {
        return run;
      }
      run.status = "running";
      this.syncLatestSummary(run);
      await this.runStore.updateRun(run);

      while (true) {
        this.throwIfAborted(opts?.abortSignal);
        run = await this.step(run.id, opts?.abortSignal);
        run = await this.pauseIfRegressedBelowFloor(run, opts?.floorNode);
        if (["completed", "failed"].includes(run.status)) {
          return run;
        }
        this.throwIfAborted(opts?.abortSignal);

        if (run.status === "paused" && run.graph.nodeStates[run.currentNode].status === "needs_approval") {
          const approvalNode = run.currentNode;
          run = await this.resolveApprovalGate(run, opts?.abortSignal);
          run = await this.pauseIfRegressedBelowFloor(run, opts?.floorNode);
          if (["completed", "failed"].includes(run.status)) {
            return run;
          }
          if (run.status === "paused") {
            return run;
          }
          if (opts?.stopAfterApprovalBoundary) {
            const shouldContinuePastCollectRecovery =
              continuePastCollectRecovery &&
              !continuedPastCollectRecovery &&
              approvalNode === opts.floorNode &&
              run.status === "running" &&
              run.currentNode !== approvalNode;
            if (shouldContinuePastCollectRecovery) {
              continuedPastCollectRecovery = true;
              continue;
            }
            return run;
          }
          continue;
        }

        if (run.status === "paused") {
          return run;
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        run = await this.getRunOrThrow(runId);
        run.status = "paused";
        this.syncLatestSummary(run);
        await this.runStore.updateRun(run);
        return this.getRunOrThrow(runId);
      }
      throw error;
    }
  }

  private async resolveApprovalGate(run: RunRecord, abortSignal?: AbortSignal): Promise<RunRecord> {
    while (run.status === "paused" && run.graph.nodeStates[run.currentNode].status === "needs_approval") {
      this.throwIfAborted(abortSignal);
      const action = this.selectApprovalResolution(run);
      if (action === "pause") {
        return run;
      }

      if (action === "apply_transition") {
        const recommendation = run.graph.pendingTransition;
        this.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: run.currentNode,
          payload: {
            text: `Minimal approval mode auto-applied ${recommendation?.action || "transition"}${recommendation?.targetNode ? ` -> ${recommendation.targetNode}` : ""}.`
          }
        });
        run = await this.applyPendingTransition(run.id);
        continue;
      }

      this.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: run.currentNode,
        payload: {
          text: `Minimal approval mode auto-approved ${run.currentNode}.`
        }
      });
      run = await this.approveCurrent(run.id, { continueAfterApprove: false, abortSignal });
    }

    return run;
  }

  private selectApprovalResolution(run: RunRecord): "pause" | "approve" | "apply_transition" {
    if (this.options.approvalMode === "manual") {
      return "pause";
    }

    const recommendation = run.graph.pendingTransition;
    if (!recommendation) {
      return "approve";
    }

    if (recommendation.action === "pause_for_human" || !recommendation.autoExecutable) {
      return "pause";
    }

    return "apply_transition";
  }

  async approveCurrent(
    runId: string,
    opts?: { continueAfterApprove?: boolean; abortSignal?: AbortSignal }
  ): Promise<RunRecord> {
    const run = await this.getRunOrThrow(runId);
    const node = run.currentNode;
    const state = run.graph.nodeStates[node];

    if (state.status !== "needs_approval") {
      return run;
    }

    if (node === "review" && run.graph.pendingTransition) {
      const recommendation = run.graph.pendingTransition;
      if (recommendation.action === "pause_for_human") {
        return run;
      }
      if (recommendation.action !== "advance") {
        return this.applyPendingTransition(run.id);
      }
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

    this.syncLatestSummary(run, node);
    await this.saveCheckpointAndPersist(run, "after", "approved");
    if (!next || !opts?.continueAfterApprove) {
      return this.getRunOrThrow(runId);
    }

    return this.runUntilPause(runId, {
      abortSignal: opts.abortSignal,
      floorNode: next
    });
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
    this.syncLatestSummary(run);
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
      return this.approveCurrent(run.id, { continueAfterApprove: false });
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
    const maxAttempts = Math.max(1, run.graph.retryPolicy.maxAttemptsPerNode);
    const nextAttempt = Math.min((run.graph.retryCounters[target] ?? 0) + 1, maxAttempts);
    run.graph.pendingTransition = undefined;
    run.currentNode = target;
    run.graph.currentNode = target;
    run.graph.nodeStates[target] = {
      ...run.graph.nodeStates[target],
      status: "running",
      updatedAt: new Date().toISOString(),
      note: "manual retry"
    };
    run.status = "running";

    this.syncLatestSummary(run, target);
    const checkpoint = await this.saveCheckpointAndPersist(run, "retry", "manual retry");
    this.eventStream.emit({
      type: "NODE_RETRY",
      runId: run.id,
      node: target,
      payload: { attempts: nextAttempt, checkpoint: checkpoint.seq }
    });

    return this.getRunOrThrow(runId);
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
          note: `Reset by backward jump (cycle ${run.graph.researchCycle})`,
          lastError: undefined
        };
      }
    }

    run.graph.pendingTransition = undefined;
    run.currentNode = targetNode;
    run.graph.currentNode = targetNode;
    run.status = "paused";

    this.syncLatestSummary(run, targetNode);
    const checkpoint = await this.saveCheckpointAndPersist(run, "jump", reason);
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

    return this.getRunOrThrow(runId);
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
    const maxAttempts = Math.max(1, run.graph.retryPolicy.maxAttemptsPerNode);
    const nextRetry = Math.min((run.graph.retryCounters[node] ?? 0) + 1, maxAttempts);
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

    this.syncLatestSummary(run, node);
    const failCheckpoint = await this.saveCheckpointAndPersist(run, "fail", errorMessage);
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

    if (nextRetry < maxAttempts) {
      run.status = "running";
      run.graph.nodeStates[node] = {
        ...run.graph.nodeStates[node],
        status: "running",
        updatedAt: new Date().toISOString(),
        note: `Auto retry scheduled after failed attempt ${nextRetry}/${maxAttempts}.`
      };
      this.syncLatestSummary(run, node);
      const retryCheckpoint = await this.saveCheckpointAndPersist(run, "retry", "auto retry");
      this.eventStream.emit({
        type: "NODE_RETRY",
        runId: run.id,
        node,
        payload: { attempt: nextRetry, checkpoint: retryCheckpoint.seq }
      });
      return this.getRunOrThrow(run.id);
    }

    const maxRollbacks = Math.max(0, run.graph.retryPolicy.maxAutoRollbacksPerNode);
    const currentRollbackCount = run.graph.rollbackCounters[node] ?? 0;

    if (currentRollbackCount >= maxRollbacks) {
      run.status = "failed";
      this.syncLatestSummary(run, node);
      await this.runStore.updateRun(run);
      return this.getRunOrThrow(run.id);
    }

    const prev = this.previousNode(node);
    if (!prev) {
      run.status = "failed";
      this.syncLatestSummary(run, node);
      await this.runStore.updateRun(run);
      return this.getRunOrThrow(run.id);
    }

    const restoredCollectQuery = await this.restoreRollbackCollectRequest(run, prev);
    const rollbackCount = currentRollbackCount + 1;
    run.graph.rollbackCounters[node] = rollbackCount;
    run.graph.retryCounters[node] = 0;
    const rollbackNote = restoredCollectQuery
      ? `Auto rollback from ${node} after ${nextRetry}/${maxAttempts} failed attempts (rollback ${rollbackCount}/${maxRollbacks}); reusing collect query "${restoredCollectQuery}".`
      : `Auto rollback from ${node} after ${nextRetry}/${maxAttempts} failed attempts (rollback ${rollbackCount}/${maxRollbacks}).`;

    run.currentNode = prev;
    run.graph.currentNode = prev;
    run.status = "running";

    run.graph.nodeStates[prev] = {
      ...run.graph.nodeStates[prev],
      status: "running",
      updatedAt: new Date().toISOString(),
      note: rollbackNote
    };

    this.syncLatestSummary(run, prev);
    const rollbackCheckpoint = await this.saveCheckpointAndPersist(run, "jump", `rollback to ${prev}`);
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

    return this.getRunOrThrow(run.id);
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

  private async getRunOrThrow(runId: string): Promise<RunRecord> {
    const run = await this.runStore.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    run.graph.currentNode = run.currentNode;
    run.graph.transitionHistory = run.graph.transitionHistory || [];
    run.graph.researchCycle = run.graph.researchCycle || 0;
    return run;
  }

  private async pauseIfRegressedBelowFloor(run: RunRecord, floorNode?: GraphNodeId): Promise<RunRecord> {
    if (!floorNode || ["completed", "failed"].includes(run.status)) {
      return run;
    }

    const currentIdx = GRAPH_NODE_ORDER.indexOf(run.currentNode);
    const floorIdx = GRAPH_NODE_ORDER.indexOf(floorNode);
    if (currentIdx < 0 || floorIdx < 0 || currentIdx >= floorIdx) {
      return run;
    }

    const currentState = run.graph.nodeStates[run.currentNode];
    run.status = "paused";
    run.graph.nodeStates[run.currentNode] = {
      ...currentState,
      status: currentState.status === "running" ? "pending" : currentState.status,
      updatedAt: new Date().toISOString(),
      note: appendPauseSuffix(
        currentState.note,
        `Paused before rerunning ${run.currentNode} because execution started from ${floorNode}.`
      )
    };

    this.syncLatestSummary(run);
    await this.runStore.updateRun(run);
    return this.getRunOrThrow(run.id);
  }

  private hasVisitedLaterNodes(run: RunRecord, floorNode: GraphNodeId): boolean {
    const floorIdx = GRAPH_NODE_ORDER.indexOf(floorNode);
    if (floorIdx < 0) {
      return false;
    }

    return GRAPH_NODE_ORDER.slice(floorIdx + 1).some((node) => {
      const state = run.graph.nodeStates[node];
      return state.status !== "pending" || Boolean(state.note) || Boolean(state.lastError);
    });
  }

  private async saveCheckpointAndPersist(
    run: RunRecord,
    phase: CheckpointPhase,
    reason?: string
  ) {
    const records = await this.checkpointStore.list(run.id);
    const highestSeq = records.reduce((max, record) => Math.max(max, record.seq), 0);
    run.graph.checkpointSeq = Math.max(run.graph.checkpointSeq ?? 0, highestSeq);
    run.updatedAt = new Date().toISOString();
    this.syncLatestSummary(run);
    const checkpoint = await this.checkpointStore.save(run, phase, reason);
    await this.runStore.updateRun(run);
    return checkpoint;
  }

  private syncLatestSummary(run: RunRecord, preferredNode?: GraphNodeId): void {
    const primaryNode = preferredNode ?? run.currentNode;
    const primaryNote = run.graph.nodeStates[primaryNode]?.note?.trim();
    if (primaryNote) {
      run.latestSummary = primaryNote;
      return;
    }

    const currentNote = run.graph.nodeStates[run.currentNode]?.note?.trim();
    if (currentNote) {
      run.latestSummary = currentNote;
    }
  }

  private isCheckpointSnapshotStale(current: RunRecord, snapshot: RunRecord): boolean {
    const currentSeq = current.graph.checkpointSeq ?? 0;
    const snapshotSeq = snapshot.graph.checkpointSeq ?? 0;
    if (currentSeq > snapshotSeq) {
      return true;
    }

    const currentUpdated = Date.parse(current.updatedAt || "");
    const snapshotUpdated = Date.parse(snapshot.updatedAt || "");
    return Number.isFinite(currentUpdated) && Number.isFinite(snapshotUpdated) && currentUpdated > snapshotUpdated;
  }

  private async restoreRollbackCollectRequest(
    run: RunRecord,
    targetNode: GraphNodeId
  ): Promise<string | undefined> {
    if (targetNode !== "collect_papers") {
      return undefined;
    }

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    const pendingRequest = await runContext.get<Record<string, unknown> | null>("collect_papers.request");
    if (pendingRequest) {
      const pendingQuery = pendingRequest.query;
      return typeof pendingQuery === "string" && pendingQuery.trim() ? pendingQuery.trim() : undefined;
    }

    const lastRequest = await runContext.get<Record<string, unknown> | null>("collect_papers.last_request");
    const lastResult = await runContext.get<{ stored?: number; completed?: boolean } | null>("collect_papers.last_result");
    if (!lastRequest || !lastResult || lastResult.completed === false || Number(lastResult.stored ?? 0) <= 0) {
      return undefined;
    }

    const query = typeof lastRequest.query === "string" ? lastRequest.query.trim() : "";
    if (!query) {
      return undefined;
    }

    const nextRequest = structuredClone(lastRequest);
    await runContext.put("collect_papers.request", nextRequest);
    const limit = typeof nextRequest.limit === "number" && Number.isFinite(nextRequest.limit) ? nextRequest.limit : null;
    await runContext.put("collect_papers.requested_limit", limit);
    return query;
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const lower = error.message.toLowerCase();
  return lower.includes("aborted") || lower.includes("abort");
}

function appendPauseSuffix(note: string | undefined, suffix: string): string {
  const base = (note || "").trim();
  if (!base) {
    return suffix;
  }
  if (base.includes(suffix)) {
    return base;
  }
  return `${base} ${suffix}`;
}
