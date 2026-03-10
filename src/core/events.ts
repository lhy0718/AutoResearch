import { AgentRoleId, GraphNodeId } from "../types.js";

export type EventType =
  | "PLAN_CREATED"
  | "TOOL_CALLED"
  | "OBS_RECEIVED"
  | "PATCH_APPLIED"
  | "TEST_FAILED"
  | "REFLECTION_SAVED"
  | "CHECKPOINT_SAVED"
  | "NODE_RETRY"
  | "NODE_ROLLBACK"
  | "NODE_JUMP"
  | "TRANSITION_RECOMMENDED"
  | "TRANSITION_APPLIED"
  | "BUDGET_EXCEEDED"
  | "NODE_STARTED"
  | "NODE_COMPLETED"
  | "NODE_FAILED";

export interface AutoLabOSEvent {
  id: string;
  type: EventType;
  timestamp: string;
  runId: string;
  node?: GraphNodeId;
  agentRole?: AgentRoleId;
  payload: Record<string, unknown>;
}

export type EventListener = (event: AutoLabOSEvent) => void;

export interface EventStream {
  emit(event: Omit<AutoLabOSEvent, "id" | "timestamp">): AutoLabOSEvent;
  subscribe(listener: EventListener): () => void;
  history(limit?: number): AutoLabOSEvent[];
}

export class InMemoryEventStream implements EventStream {
  private readonly listeners = new Set<EventListener>();
  private readonly items: AutoLabOSEvent[] = [];

  emit(event: Omit<AutoLabOSEvent, "id" | "timestamp">): AutoLabOSEvent {
    const next: AutoLabOSEvent = {
      ...event,
      id: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
      timestamp: new Date().toISOString()
    };

    this.items.push(next);
    for (const listener of this.listeners) {
      listener(next);
    }
    return next;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  history(limit = 200): AutoLabOSEvent[] {
    if (limit <= 0) {
      return [];
    }
    return this.items.slice(-limit);
  }
}
