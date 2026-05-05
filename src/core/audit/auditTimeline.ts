import path from "node:path";
import { promises as fs } from "node:fs";

import type { EventType } from "../events.js";
import type { GraphNodeId } from "../../types.js";

export interface AuditTimelineInput {
  runRoot: string;
  resultTableMeasured: boolean;
  resultTableCompleteRows: number;
  figureAuditStatus: string;
  reviewDecision?: string;
  claimCeilingAllowedLevel: string;
  paperReadinessVerdict: string;
  paperReady: boolean;
  blockers: Array<{ code: string; severity: "blocker" | "warning"; message: string; source: string }>;
}

export interface AuditTimelineEntry {
  id: string;
  source: "event" | "checkpoint" | "artifact" | "audit";
  kind: string;
  title: string;
  timestamp?: string;
  node?: GraphNodeId;
  severity?: "info" | "warning" | "blocker";
  evidence_path?: string;
  event_type?: EventType;
  checkpoint_seq?: number;
  decision?: string;
}

export interface AuditTimeline {
  version: 1;
  generated_at: string;
  measured: boolean;
  status: "available" | "timeline_incomplete";
  event_count: number;
  checkpoint_count: number;
  artifact_entry_count: number;
  entries: AuditTimelineEntry[];
  policy_note: string;
}

interface PersistedEventLike {
  id?: string;
  type?: string;
  timestamp?: string;
  node?: string;
  payload?: Record<string, unknown>;
}

interface CheckpointLike {
  seq?: number;
  node?: string;
  phase?: string;
  createdAt?: string;
  reason?: string;
}

export async function buildAuditTimeline(input: AuditTimelineInput): Promise<AuditTimeline> {
  const events = await readEvents(path.join(input.runRoot, "events.jsonl"));
  const checkpoints = await readCheckpoints(path.join(input.runRoot, "checkpoints"));
  const eventEntries = events.map(toEventEntry);
  const checkpointEntries = checkpoints.map(toCheckpointEntry);
  const artifactEntries = buildArtifactEntries(input);
  const auditEntries = buildAuditEntries(input);
  const entries = [...eventEntries, ...checkpointEntries, ...artifactEntries, ...auditEntries]
    .sort(compareTimelineEntries)
    .map((entry, index) => ({ ...entry, id: entry.id || `timeline_${index + 1}` }));

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    measured: events.length > 0 || checkpoints.length > 0,
    status: events.length > 0 || checkpoints.length > 0 ? "available" : "timeline_incomplete",
    event_count: events.length,
    checkpoint_count: checkpoints.length,
    artifact_entry_count: artifactEntries.length + auditEntries.length,
    entries,
    policy_note: "The timeline is reconstructed from durable run events, checkpoints, and preserved audit artifacts; missing event streams remain explicit."
  };
}

async function readEvents(filePath: string): Promise<PersistedEventLike[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseJsonObject)
      .filter((value): value is Record<string, unknown> => Boolean(value))
      .map((value) => value as PersistedEventLike);
  } catch {
    return [];
  }
}

async function readCheckpoints(checkpointsDir: string): Promise<CheckpointLike[]> {
  let files: string[];
  try {
    files = await fs.readdir(checkpointsDir);
  } catch {
    return [];
  }
  const records: CheckpointLike[] = [];
  for (const file of files.filter((item) => item.endsWith(".json") && item !== "latest.json").sort()) {
    const record = await readJsonObject(path.join(checkpointsDir, file));
    if (record) {
      records.push(record as CheckpointLike);
    }
  }
  return records;
}

function toEventEntry(event: PersistedEventLike): AuditTimelineEntry {
  const eventType = normalizeEventType(event.type);
  return {
    id: event.id || "",
    source: "event",
    kind: eventType || "event",
    title: humanizeEventTitle(eventType || event.type || "event"),
    ...(event.timestamp ? { timestamp: event.timestamp } : {}),
    ...(normalizeNode(event.node) ? { node: normalizeNode(event.node) } : {}),
    severity: eventType === "NODE_FAILED" || eventType === "TEST_FAILED" ? "warning" : "info",
    evidence_path: "events.jsonl",
    ...(eventType ? { event_type: eventType } : {})
  };
}

function toCheckpointEntry(checkpoint: CheckpointLike): AuditTimelineEntry {
  return {
    id: checkpoint.seq ? `checkpoint_${checkpoint.seq}` : "",
    source: "checkpoint",
    kind: "checkpoint_saved",
    title: `Checkpoint saved${checkpoint.phase ? ` (${checkpoint.phase})` : ""}`,
    ...(checkpoint.createdAt ? { timestamp: checkpoint.createdAt } : {}),
    ...(normalizeNode(checkpoint.node) ? { node: normalizeNode(checkpoint.node) } : {}),
    severity: "info",
    evidence_path: "checkpoints/",
    ...(Number.isFinite(checkpoint.seq) ? { checkpoint_seq: Number(checkpoint.seq) } : {}),
    ...(checkpoint.reason ? { decision: checkpoint.reason } : {})
  };
}

function buildArtifactEntries(input: AuditTimelineInput): AuditTimelineEntry[] {
  const entries: AuditTimelineEntry[] = [
    {
      id: "result_table_artifact",
      source: "artifact",
      kind: "result_table_status",
      title: input.resultTableMeasured
        ? `Result table measured with ${input.resultTableCompleteRows} complete row(s)`
        : "Result table missing or unmeasured",
      severity: input.resultTableMeasured && input.resultTableCompleteRows > 0 ? "info" : "blocker",
      evidence_path: "result_table.json"
    },
    {
      id: "figure_audit_artifact",
      source: "artifact",
      kind: "figure_audit_status",
      title: `Figure audit status: ${input.figureAuditStatus}`,
      severity: input.figureAuditStatus === "blocked" ? "blocker" : "info",
      node: "figure_audit",
      evidence_path: "figure_audit/figure_audit_summary.json"
    },
    {
      id: "review_decision_artifact",
      source: "artifact",
      kind: "review_decision",
      title: input.reviewDecision ? `Review decision: ${input.reviewDecision}` : "Review decision unavailable",
      severity: input.reviewDecision ? "info" : "warning",
      node: "review",
      evidence_path: "review/decision.json",
      ...(input.reviewDecision ? { decision: input.reviewDecision } : {})
    },
    {
      id: "paper_readiness_artifact",
      source: "artifact",
      kind: "paper_readiness_flag",
      title: `paper_ready flag: ${input.paperReady}`,
      severity: input.paperReady ? "warning" : "info",
      evidence_path: "paper/paper_readiness.json"
    }
  ];
  return entries;
}

function buildAuditEntries(input: AuditTimelineInput): AuditTimelineEntry[] {
  const entries: AuditTimelineEntry[] = [
    {
      id: "claim_ceiling_audit",
      source: "audit",
      kind: "claim_ceiling",
      title: `Claim ceiling: ${input.claimCeilingAllowedLevel}`,
      severity: "info",
      decision: input.claimCeilingAllowedLevel
    },
    {
      id: "paper_readiness_verdict",
      source: "audit",
      kind: "paper_readiness_verdict",
      title: `Paper-readiness audit verdict: ${input.paperReadinessVerdict}`,
      severity: input.paperReadinessVerdict === "blocked" ? "blocker" : input.paperReadinessVerdict === "needs-review" ? "warning" : "info",
      decision: input.paperReadinessVerdict
    }
  ];
  for (const blocker of input.blockers) {
    entries.push({
      id: `blocker_${blocker.code}`,
      source: "audit",
      kind: "blocker_detected",
      title: `${blocker.code}: ${blocker.message}`,
      severity: blocker.severity,
      decision: blocker.source
    });
  }
  return entries;
}

function compareTimelineEntries(left: AuditTimelineEntry, right: AuditTimelineEntry): number {
  const leftTime = left.timestamp ? Date.parse(left.timestamp) : Number.POSITIVE_INFINITY;
  const rightTime = right.timestamp ? Date.parse(right.timestamp) : Number.POSITIVE_INFINITY;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
}

function normalizeEventType(value: unknown): EventType | undefined {
  const text = typeof value === "string" ? value : "";
  return EVENT_TYPES.has(text) ? text as EventType : undefined;
}

const EVENT_TYPES = new Set<string>([
  "PLAN_CREATED",
  "TOOL_CALLED",
  "OBS_RECEIVED",
  "PATCH_APPLIED",
  "TEST_FAILED",
  "REFLECTION_SAVED",
  "CHECKPOINT_SAVED",
  "NODE_RETRY",
  "NODE_ROLLBACK",
  "NODE_JUMP",
  "TRANSITION_RECOMMENDED",
  "TRANSITION_APPLIED",
  "NODE_STARTED",
  "NODE_COMPLETED",
  "NODE_FAILED"
]);

function normalizeNode(value: unknown): GraphNodeId | undefined {
  const text = typeof value === "string" ? value : "";
  return GRAPH_NODES.has(text) ? text as GraphNodeId : undefined;
}

const GRAPH_NODES = new Set<string>([
  "collect_papers",
  "analyze_papers",
  "generate_hypotheses",
  "design_experiments",
  "implement_experiments",
  "run_experiments",
  "analyze_results",
  "figure_audit",
  "review",
  "write_paper"
]);

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    return parseJsonObject(await fs.readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function humanizeEventTitle(type: string): string {
  return type.toLowerCase().replace(/_/gu, " ");
}
