import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { FailureClass, FailureMemoryEntry, RetryPolicy, ExplorationStage } from "./types.js";
import type { FailureRecord } from "../experiments/failureMemory.js";

type ExplorationFailureRecord = FailureRecord & {
  exploration_failure_class?: FailureClass | null;
  exploration_retry_policy?: RetryPolicy | null;
  exploration_equivalent_to?: string | null;
  exploration_affects_stage?: ExplorationStage[];
};

function deriveRunIdFromMemoryPath(memoryPath: string): string {
  const runDir = path.basename(path.dirname(memoryPath));
  return runDir || "unknown-run";
}

export function loadExplorationFailureEntries(memoryPath: string): FailureMemoryEntry[] {
  if (!existsSync(memoryPath)) {
    return [];
  }
  const raw = readFileSync(memoryPath, "utf8");
  const entries: FailureMemoryEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as ExplorationFailureRecord;
      if (!parsed.exploration_failure_class || !parsed.exploration_retry_policy) {
        continue;
      }
      entries.push({
        failure_fingerprint: parsed.error_fingerprint,
        failure_class: parsed.exploration_failure_class,
        retry_policy: parsed.exploration_retry_policy,
        equivalent_to: parsed.exploration_equivalent_to ?? null,
        affects_stage: parsed.exploration_affects_stage ?? [],
        first_seen_at: parsed.timestamp,
        occurrence_count: 1
      });
    } catch {
      continue;
    }
  }
  return entries;
}

export function appendExplorationFailure(memoryPath: string, entry: FailureMemoryEntry): void {
  mkdirSync(path.dirname(memoryPath), { recursive: true });
  const timestamp = new Date().toISOString();
  const record: ExplorationFailureRecord = {
    failure_id: `fail_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    run_id: deriveRunIdFromMemoryPath(memoryPath),
    node_id: "design_experiments",
    attempt: 0,
    timestamp,
    failure_class: "equivalent",
    error_fingerprint: entry.failure_fingerprint,
    error_message: `Exploration failure memory entry for ${entry.failure_fingerprint}`.slice(0, 1200),
    do_not_retry: entry.retry_policy === "block",
    do_not_retry_reason: entry.retry_policy === "block" ? "Blocked by exploration retry policy." : undefined,
    exploration_failure_class: entry.failure_class,
    exploration_retry_policy: entry.retry_policy,
    exploration_equivalent_to: entry.equivalent_to,
    exploration_affects_stage: [...entry.affects_stage]
  };
  writeFileSync(memoryPath, `${existsSync(memoryPath) ? readFileSync(memoryPath, "utf8") : ""}${JSON.stringify(record)}\n`, "utf8");
}

function buildEquivalentSet(
  seed: string,
  entries: FailureMemoryEntry[]
): Set<string> {
  const seen = new Set<string>();
  const stack = [seed];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const entry of entries) {
      if (entry.failure_fingerprint === current && entry.equivalent_to && !seen.has(entry.equivalent_to)) {
        stack.push(entry.equivalent_to);
      }
      if (entry.equivalent_to === current && !seen.has(entry.failure_fingerprint)) {
        stack.push(entry.failure_fingerprint);
      }
    }
  }
  return seen;
}

export function isEquivalentFailure(
  fingerprintA: string,
  fingerprintB: string,
  entries: FailureMemoryEntry[]
): boolean {
  if (fingerprintA === fingerprintB) {
    return true;
  }
  return buildEquivalentSet(fingerprintA, entries).has(fingerprintB);
}

export function shouldBlockSubtree(fingerprint: string, entries: FailureMemoryEntry[]): boolean {
  const equivalentSet = buildEquivalentSet(fingerprint, entries);
  return entries.some(
    (entry) =>
      equivalentSet.has(entry.failure_fingerprint) &&
      entry.retry_policy === "block"
  );
}
