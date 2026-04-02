import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { EvidenceScreeningResult, GovernanceDecision } from "./policyTypes.js";

export interface GovernanceTraceEntry {
  timestamp: string;
  runId: string | null;
  node: string | null;
  inputSummary: string;
  screeningResult: EvidenceScreeningResult | null;
  triggeredRules: string[];
  decision: GovernanceDecision;
  matchedSlotId: string | null;
  detail: string;
}

function defaultTraceDir(): string {
  return path.join(process.cwd(), ".autolabos", "governance", "traces");
}

export function appendGovernanceTrace(
  entry: GovernanceTraceEntry,
  traceDir = defaultTraceDir()
): void {
  const dateKey = (entry.timestamp || new Date().toISOString()).slice(0, 10);
  mkdirSync(traceDir, { recursive: true });
  const filePath = path.join(traceDir, `${dateKey}.jsonl`);
  appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

export function readGovernanceTrace(
  traceDir = defaultTraceDir(),
  date = new Date().toISOString().slice(0, 10)
): GovernanceTraceEntry[] {
  const filePath = path.join(traceDir, `${date}.jsonl`);
  if (!existsSync(filePath)) {
    return [];
  }
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as GovernanceTraceEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is GovernanceTraceEntry => Boolean(entry));
}
