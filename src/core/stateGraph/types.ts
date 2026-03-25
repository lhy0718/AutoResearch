import { GraphNodeId, RunGraphState, RunRecord, TransitionRecommendation } from "../../types.js";

export type CheckpointPhase = "before" | "after" | "fail" | "jump" | "retry";

export type JumpMode = "safe" | "force";

export interface CheckpointRecord {
  seq: number;
  runId: string;
  node: GraphNodeId;
  phase: CheckpointPhase;
  reason?: string;
  createdAt: string;
  runSnapshot: RunRecord;
}

export interface GraphNodeContext {
  run: RunRecord;
  graph: RunGraphState;
  abortSignal?: AbortSignal;
}

export interface GraphNodeResult {
  status: "success" | "failure";
  summary?: string;
  needsApproval?: boolean;
  error?: string;
  costUsd?: number;
  toolCallsUsed?: number;
  usage?: {
    costUsd?: number;
    toolCalls?: number;
    inputTokens?: number;
    outputTokens?: number;
    wallTimeMs?: number;
  };
  transitionRecommendation?: TransitionRecommendation;
}

export interface GraphNodeHandler {
  readonly id: GraphNodeId;
  execute(context: GraphNodeContext): Promise<GraphNodeResult>;
}

export interface GraphNodeRegistry {
  get(nodeId: GraphNodeId): GraphNodeHandler;
  list(): GraphNodeHandler[];
}
