import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { BaselineLock, InterventionDimension } from "./types.js";
import { validateBranchAgainstLock } from "./baselineLock.js";

export const INTERVENTION_DIMENSION_COUNT_LIMIT = 1;

export interface SingleChangeResult {
  allowed: boolean;
  changed_dimensions: InterventionDimension[];
  dimension_count: number;
  blocked_reasons: string[];
}

function extractChangedDimensions(
  branchChangeSet: Partial<Record<InterventionDimension, string>>
): InterventionDimension[] {
  return (Object.entries(branchChangeSet) as Array<[InterventionDimension, string | undefined]>)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([dimension]) => dimension);
}

export function checkSingleChange(
  branchChangeSet: Partial<Record<InterventionDimension, string>>,
  lock: BaselineLock | null
): SingleChangeResult {
  const changedDimensions = extractChangedDimensions(branchChangeSet);
  const blockedReasons: string[] = [];

  if (changedDimensions.length > INTERVENTION_DIMENSION_COUNT_LIMIT) {
    blockedReasons.push(
      `Single-change policy allows at most ${INTERVENTION_DIMENSION_COUNT_LIMIT} dimension change(s), received ${changedDimensions.length}.`
    );
  }

  if (lock) {
    const validation = validateBranchAgainstLock(branchChangeSet, lock);
    blockedReasons.push(...validation.violations);
  }

  return {
    allowed: blockedReasons.length === 0,
    changed_dimensions: changedDimensions,
    dimension_count: changedDimensions.length,
    blocked_reasons: blockedReasons
  };
}

export function saveBlockedBranchRecord(nodeDir: string, result: SingleChangeResult): void {
  mkdirSync(nodeDir, { recursive: true });
  const targetPath = path.join(nodeDir, "blocked_reasons.json");
  writeFileSync(targetPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
