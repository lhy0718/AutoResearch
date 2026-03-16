/**
 * Failure memory: lightweight run-scoped JSONL artifact that records repeated
 * failure patterns and "do not retry yet" conditions.
 *
 * Artifact path: .autolabos/runs/<run_id>/failure_memory.jsonl
 */

import path from "node:path";
import { promises as fs } from "node:fs";

import { GraphNodeId } from "../../types.js";
import { ensureDir } from "../../utils/fs.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface FailureRecord {
  failure_id: string;
  run_id: string;
  node_id: GraphNodeId;
  attempt: number;
  timestamp: string;

  /** Short classification: transient, structural, equivalent, resource, unknown. */
  failure_class: "transient" | "structural" | "equivalent" | "resource" | "unknown";

  /** One-line error fingerprint for dedup / clustering. */
  error_fingerprint: string;

  /** Full error message (truncated to 1200 chars). */
  error_message: string;

  /** If true, this failure pattern should not be retried without a design change. */
  do_not_retry: boolean;

  /** Human-readable reason for do_not_retry when set. */
  do_not_retry_reason?: string;
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export class FailureMemory {
  constructor(private readonly filePath: string) {}

  static forRun(runId: string): FailureMemory {
    return new FailureMemory(
      path.join(".autolabos", "runs", runId, "failure_memory.jsonl")
    );
  }

  async append(record: Omit<FailureRecord, "failure_id" | "timestamp">): Promise<FailureRecord> {
    const full: FailureRecord = {
      ...record,
      failure_id: `fail_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
      timestamp: new Date().toISOString()
    };
    await ensureDir(path.dirname(this.filePath));
    await fs.appendFile(this.filePath, `${JSON.stringify(full)}\n`, "utf8");
    return full;
  }

  async readAll(): Promise<FailureRecord[]> {
    let text = "";
    try {
      text = await fs.readFile(this.filePath, "utf8");
    } catch {
      return [];
    }
    const out: FailureRecord[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as FailureRecord);
      } catch {
        continue;
      }
    }
    return out;
  }

  async forNode(nodeId: GraphNodeId): Promise<FailureRecord[]> {
    const all = await this.readAll();
    return all.filter((r) => r.node_id === nodeId);
  }

  async hasDoNotRetry(nodeId: GraphNodeId): Promise<boolean> {
    const nodeRecords = await this.forNode(nodeId);
    return nodeRecords.some((r) => r.do_not_retry);
  }

  async countEquivalentFailures(nodeId: GraphNodeId, fingerprint: string): Promise<number> {
    const nodeRecords = await this.forNode(nodeId);
    return nodeRecords.filter((r) => r.error_fingerprint === fingerprint).length;
  }

  /** Cluster failures by fingerprint; returns [fingerprint, count][] sorted descending. */
  async failureClusters(nodeId: GraphNodeId): Promise<Array<[string, number]>> {
    const nodeRecords = await this.forNode(nodeId);
    const counts = new Map<string, number>();
    for (const r of nodeRecords) {
      counts.set(r.error_fingerprint, (counts.get(r.error_fingerprint) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }
}

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

/**
 * Build a short error fingerprint for dedup.  Strips numbers, paths,
 * and timestamps to cluster equivalent errors together.
 */
export function buildErrorFingerprint(errorMessage: string): string {
  return errorMessage
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]+/g, "<ts>")
    .replace(/\/[\w./-]+/g, "<path>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
