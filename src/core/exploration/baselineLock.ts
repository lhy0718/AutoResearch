import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { BaselineLock, InterventionDimension } from "./types.js";

const EXPERIMENT_TREE_DIR = "experiment_tree";
const BASELINE_LOCK_FILE = "baseline_lock.json";

const BASELINE_SOURCE_FILE = "experiment_portfolio.json";
const DATASET_SLICE_SOURCE_FILE = "trial_group_matrix.json";
const EVALUATOR_SOURCE_FILE = "objective_evaluation.json";
const RUN_MANIFEST_FILE = "run_manifest.json";

function buildExperimentTreeDir(runDir: string): string {
  return path.join(runDir, EXPERIMENT_TREE_DIR);
}

function buildBaselineLockPath(runDir: string): string {
  return path.join(buildExperimentTreeDir(runDir), BASELINE_LOCK_FILE);
}

async function sha256ForFile(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return "missing";
  }
}

async function readSeedPolicy(runDir: string): Promise<string> {
  const manifestPath = path.join(runDir, RUN_MANIFEST_FILE);
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
    const seedPolicy = parsed.seed_policy;
    return typeof seedPolicy === "string" && seedPolicy.trim() ? seedPolicy : "unknown";
  } catch {
    return "unknown";
  }
}

export async function createBaselineLock(options: {
  runId: string;
  runDir: string;
  allowedDimensions: InterventionDimension[];
  forbiddenConcurrent: InterventionDimension[][];
}): Promise<BaselineLock> {
  const collectedAt = new Date().toISOString();
  const [baselineHash, datasetSliceHash, evaluatorHash, seedPolicy] = await Promise.all([
    sha256ForFile(path.join(options.runDir, BASELINE_SOURCE_FILE)),
    sha256ForFile(path.join(options.runDir, DATASET_SLICE_SOURCE_FILE)),
    sha256ForFile(path.join(options.runDir, EVALUATOR_SOURCE_FILE)),
    readSeedPolicy(options.runDir)
  ]);

  return {
    locked_at: collectedAt,
    run_id: options.runId,
    baseline_hash: baselineHash,
    dataset_slice_hash: datasetSliceHash,
    evaluator_hash: evaluatorHash,
    seed_policy: seedPolicy,
    environment_fingerprint: `${process.version}|${os.platform()}|${collectedAt}`,
    allowed_intervention_dimensions: [...options.allowedDimensions],
    forbidden_concurrent_changes: options.forbiddenConcurrent.map((entry) => [...entry])
  };
}

export function saveBaselineLock(runDir: string, lock: BaselineLock): void {
  const targetDir = buildExperimentTreeDir(runDir);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(buildBaselineLockPath(runDir), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

export function loadBaselineLock(runDir: string): BaselineLock | null {
  const targetPath = buildBaselineLockPath(runDir);
  if (!existsSync(targetPath)) {
    return null;
  }
  return JSON.parse(readFileSync(targetPath, "utf8")) as BaselineLock;
}

export interface BaselineLockValidation {
  valid: boolean;
  violations: string[];
  changed_dimensions: InterventionDimension[];
}

export function validateBranchAgainstLock(
  branchChangeSet: Partial<Record<InterventionDimension, string>>,
  lock: BaselineLock
): BaselineLockValidation {
  const changedDimensions = (Object.entries(branchChangeSet) as Array<[InterventionDimension, string | undefined]>)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([dimension]) => dimension);
  const violations: string[] = [];

  for (const dimension of changedDimensions) {
    if (!lock.allowed_intervention_dimensions.includes(dimension)) {
      violations.push(`Changed dimension ${dimension} is outside the baseline lock allowlist.`);
    }
  }

  for (const forbiddenGroup of lock.forbidden_concurrent_changes) {
    const matched = forbiddenGroup.filter((dimension) => changedDimensions.includes(dimension));
    if (matched.length === forbiddenGroup.length && forbiddenGroup.length > 0) {
      violations.push(
        `Concurrent change set violates baseline lock: ${forbiddenGroup.join(" + ")} cannot be changed together.`
      );
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    changed_dimensions: changedDimensions
  };
}
