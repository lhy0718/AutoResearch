import path from "node:path";

import { EventType } from "../../core/events.js";
import { AgentRoleId, GraphNodeId } from "../../types.js";
import { CodexEvent } from "./codexCliClient.js";

export interface MappedCodexEvent {
  type: EventType;
  runId: string;
  node: GraphNodeId;
  agentRole?: AgentRoleId;
  payload: Record<string, unknown>;
}

interface MapArgs {
  event: CodexEvent;
  runId: string;
  node: GraphNodeId;
  agentRole?: AgentRoleId;
  workspaceRoot?: string;
}

const SESSION_EVENT_TYPES = new Set([
  "thread.started",
  "turn.started",
  "turn.completed",
  "session.started",
  "session.completed",
  "response.completed",
  "item.completed",
  "message.completed"
]);

export function mapCodexEventToAutoLabOSEvents(args: MapArgs): MappedCodexEvent[] {
  const event = unwrapCodexEvent(args.event);
  const eventType = asString(event.type) || "unknown";
  const command = extractCommand(event);
  const paths = extractPaths(event, args.workspaceRoot);
  const text = extractText(event);
  const lowered = eventType.toLowerCase();

  if (command) {
    return [
      baseMapped(args, "TOOL_CALLED", {
        command,
        source_event: eventType
      })
    ];
  }

  if (isFailureEvent(lowered, event)) {
    const message =
      asString(event.error) ||
      asString((event as Record<string, unknown>).message) ||
      asString((event as Record<string, unknown>).stderr) ||
      text ||
      "Codex reported a failure";
    return [
      baseMapped(args, "TEST_FAILED", {
        error: message,
        source_event: eventType
      })
    ];
  }

  if (paths.length > 0 && isPatchLikeEvent(lowered, event)) {
    return paths.map((filePath) =>
      baseMapped(args, "PATCH_APPLIED", {
        file: filePath,
        source_event: eventType
      })
    );
  }

  if (text && !SESSION_EVENT_TYPES.has(lowered) && !lowered.includes("delta")) {
    return [
      baseMapped(args, "OBS_RECEIVED", {
        text,
        source_event: eventType
      })
    ];
  }

  return [];
}

function baseMapped(args: MapArgs, type: EventType, payload: Record<string, unknown>): MappedCodexEvent {
  return {
    type,
    runId: args.runId,
    node: args.node,
    agentRole: args.agentRole,
    payload
  };
}

function unwrapCodexEvent(event: CodexEvent): CodexEvent {
  if (event.type === "agent_event" && event.event && typeof event.event === "object") {
    return event.event as CodexEvent;
  }
  return event;
}

function isPatchLikeEvent(loweredType: string, event: CodexEvent): boolean {
  if (
    loweredType.includes("patch") ||
    loweredType.includes("file") ||
    loweredType.includes("edit") ||
    loweredType.includes("write")
  ) {
    return true;
  }
  return extractPaths(event).length > 0;
}

function isFailureEvent(loweredType: string, event: CodexEvent): boolean {
  if (loweredType.includes("failed") || loweredType.includes("error")) {
    return true;
  }
  const status = asString((event as Record<string, unknown>).status)?.toLowerCase();
  return status === "error" || status === "failed";
}

function extractCommand(event: CodexEvent): string | undefined {
  const record = event as Record<string, unknown>;
  const direct =
    asString(record.command) ||
    asString(record.cmd) ||
    asString(record.shell_command) ||
    asString(record.input);
  if (direct && looksLikeCommand(direct)) {
    return direct.trim();
  }

  const item = record.item;
  if (item && typeof item === "object") {
    const fromItem = extractCommand(item as CodexEvent);
    if (fromItem) {
      return fromItem;
    }
  }

  return undefined;
}

function extractPaths(event: CodexEvent, workspaceRoot?: string): string[] {
  const out = new Set<string>();
  walkObject(event, (value) => {
    const candidate = asString(value);
    if (!candidate || !looksLikePath(candidate)) {
      return;
    }
    const normalized = normalizePath(candidate, workspaceRoot);
    if (normalized) {
      out.add(normalized);
    }
  });
  return [...out];
}

function extractText(event: CodexEvent): string | undefined {
  const record = event as Record<string, unknown>;
  const direct =
    asString(record.text) ||
    asString(record.message) ||
    asString(record.output_text) ||
    asString(record.stdout) ||
    asString(record.stderr) ||
    asString(record.content);
  if (direct) {
    return oneLine(direct);
  }

  const item = record.item;
  if (item && typeof item === "object") {
    return extractText(item as CodexEvent);
  }

  return undefined;
}

function normalizePath(candidate: string, workspaceRoot?: string): string | undefined {
  const trimmed = candidate.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) {
    return undefined;
  }

  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.includes("/")) {
    return workspaceRoot ? path.join(workspaceRoot, trimmed) : trimmed;
  }

  return undefined;
}

function looksLikeCommand(value: string): boolean {
  return /\s/.test(value.trim()) || /^(python|python3|node|npm|yarn|pnpm|bash|sh|make)\b/.test(value.trim());
}

function looksLikePath(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("/") ||
    /\.(py|js|ts|tsx|json|yaml|yml|md|tex|txt|diff|sh|mjs|cjs)$/i.test(trimmed)
  );
}

function walkObject(value: unknown, visit: (value: unknown) => void): void {
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      walkObject(item, visit);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    walkObject(nested, visit);
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}
