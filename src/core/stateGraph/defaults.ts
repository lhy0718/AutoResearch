import { GRAPH_NODE_ORDER, GraphNodeId, NodeState, RunGraphState, RunStatus } from "../../types.js";

export function createDefaultNodeState(): Record<GraphNodeId, NodeState> {
  const now = new Date().toISOString();
  return GRAPH_NODE_ORDER.reduce(
    (acc, node) => {
      acc[node] = {
        status: "pending",
        updatedAt: now
      };
      return acc;
    },
    {} as Record<GraphNodeId, NodeState>
  );
}

export function createDefaultGraphState(): RunGraphState {
  return {
    currentNode: GRAPH_NODE_ORDER[0],
    nodeStates: createDefaultNodeState(),
    retryCounters: {},
    rollbackCounters: {},
    researchCycle: 0,
    transitionHistory: [],
    checkpointSeq: 0,
    retryPolicy: {
      maxAttemptsPerNode: 3,
      maxAutoRollbacksPerNode: 2,
      maxAutoBackwardJumps: 4
    }
  };
}

export function defaultRunStatusForGraph(graph: RunGraphState): RunStatus {
  const current = graph.nodeStates[graph.currentNode];
  if (current.status === "needs_approval") {
    return "paused";
  }
  if (current.status === "failed") {
    return "failed";
  }
  return "running";
}
