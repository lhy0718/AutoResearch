import {
  GRAPH_NODE_ORDER,
  GraphNodeId,
  NodeOptionPackage,
  NodeOptionPackageName,
  NodeOptions,
  NodeState,
  RunGraphState,
  RunStatus
} from "../../types.js";

export const DEFAULT_NODE_OPTIONS: NodeOptions = {
  node: "all",
  maxAttemptsPerNode: 3,
  skipLLMReview: false,
  evidenceDepth: "deep",
  requireBaselineComparator: false
};

export const BUILT_IN_NODE_OPTION_PACKAGES: Record<NodeOptionPackageName, NodeOptionPackage> = {
  fast: {
    name: "fast",
    description: "Minimize retries and review depth for quick operator iteration.",
    nodeOverrides: [
      {
        node: "all",
        maxAttemptsPerNode: 1,
        skipLLMReview: true,
        evidenceDepth: "shallow",
        requireBaselineComparator: false
      }
    ]
  },
  thorough: {
    name: "thorough",
    description: "Use the default governed retry depth with full review and deeper evidence collection.",
    nodeOverrides: [
      {
        node: "all",
        maxAttemptsPerNode: 3,
        skipLLMReview: false,
        evidenceDepth: "deep",
        requireBaselineComparator: false
      }
    ]
  },
  paper_scale: {
    name: "paper_scale",
    description: "Match thorough defaults while flagging paper-scale baseline/comparator expectations.",
    nodeOverrides: [
      {
        node: "all",
        maxAttemptsPerNode: 3,
        skipLLMReview: false,
        evidenceDepth: "deep",
        requireBaselineComparator: true
      }
    ]
  }
};

export function resolveNodeOptionPackage(
  packageName?: NodeOptionPackageName
): NodeOptionPackage | undefined {
  if (!packageName) {
    return undefined;
  }
  return BUILT_IN_NODE_OPTION_PACKAGES[packageName];
}

export function resolveNodeOptionsForPackage(packageName?: NodeOptionPackageName): NodeOptions {
  const optionPackage = resolveNodeOptionPackage(packageName);
  if (!optionPackage) {
    return { ...DEFAULT_NODE_OPTIONS };
  }

  return optionPackage.nodeOverrides.reduce<NodeOptions>(
    (acc, override) => ({
      ...acc,
      ...override
    }),
    { ...DEFAULT_NODE_OPTIONS }
  );
}

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

export function createDefaultGraphState(packageName?: NodeOptionPackageName): RunGraphState {
  const resolvedNodeOptions = resolveNodeOptionsForPackage(packageName);
  return {
    currentNode: GRAPH_NODE_ORDER[0],
    nodeStates: createDefaultNodeState(),
    retryCounters: {},
    rollbackCounters: {},
    researchCycle: 0,
    transitionHistory: [],
    checkpointSeq: 0,
    retryPolicy: {
      maxAttemptsPerNode: resolvedNodeOptions.maxAttemptsPerNode,
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
