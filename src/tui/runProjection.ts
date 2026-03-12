import { AutoLabOSEvent } from "../core/events.js";
import { GRAPH_NODE_ORDER, GraphNodeId, NodeStatus, RunRecord, RunStatus } from "../types.js";

const ACTIVE_NODE_STATUSES = new Set<NodeStatus>(["running", "needs_approval"]);

export function applyEventToRunProjection(run: RunRecord, event: AutoLabOSEvent): RunRecord {
  if (run.id !== event.runId || !event.node) {
    return run;
  }

  switch (event.type) {
    case "NODE_STARTED":
      return updateProjectedRun(run, event.node, event.timestamp, {
        runStatus: "running",
        nodeStatus: "running",
        clearLastError: true
      });
    case "NODE_JUMP":
      return updateProjectedRun(run, event.node, event.timestamp, {
        runStatus: "paused",
        nodeStatus: "pending",
        note: buildJumpNote(event),
        clearLastError: true,
        clearPendingTransition: true
      });
    case "NODE_RETRY":
      return updateProjectedRun(run, event.node, event.timestamp, {
        runStatus: "running",
        nodeStatus: "running",
        note: buildRetryNote(event),
        clearLastError: true,
        clearPendingTransition: true
      });
    case "NODE_ROLLBACK":
      return updateProjectedRun(run, event.node, event.timestamp, {
        runStatus: "running",
        nodeStatus: "running",
        note: buildRollbackNote(event),
        clearLastError: true,
        clearPendingTransition: true
      });
    case "NODE_FAILED":
      return updateProjectedRun(run, event.node, event.timestamp, {
        runStatus: "failed",
        nodeStatus: "failed",
        note: readStringPayload(event.payload.error),
        lastError: readStringPayload(event.payload.error),
        clearPendingTransition: true
      });
    case "BUDGET_EXCEEDED":
      return updateProjectedRun(run, event.node, event.timestamp, {
        runStatus: "failed_budget",
        nodeStatus: "failed",
        note: readStringPayload(event.payload.reason),
        lastError: readStringPayload(event.payload.reason),
        clearPendingTransition: true
      });
    case "NODE_COMPLETED":
      return updateProjectedRun(run, event.node, event.timestamp, {
        runStatus: event.node === GRAPH_NODE_ORDER[GRAPH_NODE_ORDER.length - 1] ? "completed" : undefined,
        nodeStatus: "completed",
        note: readStringPayload(event.payload.summary),
        clearLastError: true
      });
    default:
      return run;
  }
}

export function normalizeRunForDisplay(run: RunRecord): RunRecord {
  const currentNode = resolveDisplayNode(run);
  const nodeStatus = run.graph.nodeStates[currentNode]?.status;
  const runStatus = resolveDisplayRunStatus(run.status, nodeStatus, currentNode !== run.currentNode);
  if (currentNode === run.currentNode && runStatus === run.status) {
    return run;
  }

  return {
    ...run,
    currentNode,
    status: runStatus,
    graph: {
      ...run.graph,
      currentNode
    }
  };
}

export function resolveFailedNode(run: RunRecord): GraphNodeId {
  const failed = GRAPH_NODE_ORDER.filter((node) => run.graph.nodeStates[node]?.status === "failed");
  if (failed.length === 0) {
    return run.currentNode;
  }

  return failed.sort((left, right) => {
    return updatedAtMs(run.graph.nodeStates[left]?.updatedAt) - updatedAtMs(run.graph.nodeStates[right]?.updatedAt);
  })[failed.length - 1];
}

function resolveDisplayNode(run: RunRecord): GraphNodeId {
  const activeNodes = GRAPH_NODE_ORDER.filter((node) => ACTIVE_NODE_STATUSES.has(run.graph.nodeStates[node]?.status));
  if (activeNodes.length > 0) {
    return activeNodes.sort((left, right) => {
      return updatedAtMs(run.graph.nodeStates[left]?.updatedAt) - updatedAtMs(run.graph.nodeStates[right]?.updatedAt);
    })[activeNodes.length - 1];
  }

  if (run.graph.currentNode !== run.currentNode) {
    const graphNode = run.graph.currentNode;
    const graphNodeStatus = run.graph.nodeStates[graphNode]?.status;
    if (graphNodeStatus && graphNodeStatus !== "failed") {
      return graphNode;
    }
  }

  return run.currentNode;
}

function resolveDisplayRunStatus(runStatus: RunStatus, nodeStatus: NodeStatus | undefined, nodeChanged: boolean): RunStatus {
  if (nodeStatus === "running") {
    return "running";
  }
  if (nodeStatus === "needs_approval") {
    return "paused";
  }
  if (nodeChanged && nodeStatus === "pending" && (runStatus === "failed" || runStatus === "running")) {
    return "paused";
  }
  return runStatus;
}

function updateProjectedRun(
  run: RunRecord,
  node: GraphNodeId,
  updatedAt: string,
  options: {
    runStatus?: RunStatus;
    nodeStatus?: NodeStatus;
    note?: string;
    lastError?: string;
    clearLastError?: boolean;
    clearPendingTransition?: boolean;
  }
): RunRecord {
  const currentState = run.graph.nodeStates[node];
  const nextState = {
    ...currentState,
    updatedAt,
    status: options.nodeStatus ?? currentState.status,
    note: options.note ?? currentState.note,
    lastError: options.clearLastError ? undefined : (options.lastError ?? currentState.lastError)
  };

  return {
    ...run,
    currentNode: node,
    status: options.runStatus ?? run.status,
    updatedAt,
    graph: {
      ...run.graph,
      currentNode: node,
      pendingTransition: options.clearPendingTransition ? undefined : run.graph.pendingTransition,
      nodeStates: {
        ...run.graph.nodeStates,
        [node]: nextState
      }
    }
  };
}

function buildJumpNote(event: AutoLabOSEvent): string {
  const mode = readStringPayload(event.payload.mode);
  const reason = readStringPayload(event.payload.reason);
  if (mode && reason) {
    return `Jumped (${mode}): ${reason}`;
  }
  if (mode) {
    return `Jumped (${mode})`;
  }
  return reason ? `Jumped: ${reason}` : "Jumped";
}

function buildRetryNote(event: AutoLabOSEvent): string {
  const attempt = readNumberPayload(event.payload.attempt) ?? readNumberPayload(event.payload.attempts);
  return typeof attempt === "number" ? `Retry scheduled (${attempt})` : "Retry scheduled";
}

function buildRollbackNote(event: AutoLabOSEvent): string {
  const from = readStringPayload(event.payload.from);
  return from ? `Auto rollback from ${from}` : "Auto rollback";
}

function readStringPayload(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumberPayload(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function updatedAtMs(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
