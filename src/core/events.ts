import path from "node:path";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";

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
  history(limit?: number, runId?: string): AutoLabOSEvent[];
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

  history(limit = 200, runId?: string): AutoLabOSEvent[] {
    return sliceEventHistory(this.items, limit, runId);
  }
}

export class PersistedEventStream implements EventStream {
  private readonly listeners = new Set<EventListener>();
  private readonly items: AutoLabOSEvent[] = [];

  constructor(
    private readonly runsDir: string,
    private readonly retainedHistoryLimit = 1000
  ) {}

  emit(event: Omit<AutoLabOSEvent, "id" | "timestamp">): AutoLabOSEvent {
    const next = createEventRecord(event);
    this.items.push(next);
    if (this.items.length > this.retainedHistoryLimit) {
      this.items.splice(0, this.items.length - this.retainedHistoryLimit);
    }
    persistEventToRunLog(this.runsDir, next);
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

  history(limit = 200, runId?: string): AutoLabOSEvent[] {
    return sliceEventHistory(this.items, limit, runId);
  }
}

export function readPersistedRunEvents(input: {
  runsDir: string;
  runId: string;
  limit?: number;
}): AutoLabOSEvent[] {
  const limit = input.limit ?? 200;
  if (limit <= 0) {
    return [];
  }

  try {
    const raw = readFileSync(runEventLogPath(input.runsDir, input.runId), "utf8");
    const parsed = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as AutoLabOSEvent;
        } catch {
          return undefined;
        }
      })
      .filter((event): event is AutoLabOSEvent => isAutoLabOSEvent(event));
    return parsed.slice(-limit);
  } catch {
    return [];
  }
}

function createEventRecord(event: Omit<AutoLabOSEvent, "id" | "timestamp">): AutoLabOSEvent {
  return {
    ...event,
    id: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    timestamp: new Date().toISOString()
  };
}

function persistEventToRunLog(runsDir: string, event: AutoLabOSEvent): void {
  const eventPath = runEventLogPath(runsDir, event.runId);
  mkdirSync(path.dirname(eventPath), { recursive: true });
  appendFileSync(eventPath, `${JSON.stringify(event)}\n`, "utf8");
}

function runEventLogPath(runsDir: string, runId: string): string {
  return path.join(runsDir, runId, "events.jsonl");
}

function sliceEventHistory(
  items: AutoLabOSEvent[],
  limit: number,
  runId?: string
): AutoLabOSEvent[] {
  if (limit <= 0) {
    return [];
  }
  const filtered = runId ? items.filter((item) => item.runId === runId) : items;
  return filtered.slice(-limit);
}

function isAutoLabOSEvent(event: unknown): event is AutoLabOSEvent {
  return Boolean(
    event &&
      typeof event === "object" &&
      typeof (event as AutoLabOSEvent).id === "string" &&
      typeof (event as AutoLabOSEvent).type === "string" &&
      typeof (event as AutoLabOSEvent).timestamp === "string" &&
      typeof (event as AutoLabOSEvent).runId === "string" &&
      typeof (event as AutoLabOSEvent).payload === "object"
  );
}
