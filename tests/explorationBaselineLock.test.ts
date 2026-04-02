import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createBaselineLock,
  loadBaselineLock,
  saveBaselineLock,
  validateBranchAgainstLock
} from "../src/core/exploration/baselineLock.js";
import {
  checkSingleChange,
  INTERVENTION_DIMENSION_COUNT_LIMIT,
  saveBlockedBranchRecord
} from "../src/core/exploration/singleChangeEnforcer.js";
import type { BaselineLock } from "../src/core/exploration/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function makeTempRunDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "autolabos-baseline-lock-"));
  tempDirs.push(dir);
  return dir;
}

function makeLock(): BaselineLock {
  return {
    locked_at: new Date().toISOString(),
    run_id: "run-1",
    baseline_hash: "baseline",
    dataset_slice_hash: "dataset",
    evaluator_hash: "eval",
    seed_policy: "seed=0",
    environment_fingerprint: "node|linux|ts",
    allowed_intervention_dimensions: ["model", "dataset"],
    forbidden_concurrent_changes: [["model", "dataset"]]
  };
}

describe("baselineLock and singleChangeEnforcer", () => {
  it("allows a single changed dimension", () => {
    const result = checkSingleChange({ model: "gpt-5.4" }, null);

    expect(result.allowed).toBe(true);
    expect(result.changed_dimensions).toEqual(["model"]);
    expect(result.dimension_count).toBe(1);
  });

  it("blocks when more than one intervention dimension changes", () => {
    const result = checkSingleChange({ model: "gpt-5.4", dataset: "slice-b" }, null);

    expect(result.allowed).toBe(false);
    expect(result.dimension_count).toBe(2);
    expect(result.blocked_reasons.join(" ")).toContain(String(INTERVENTION_DIMENSION_COUNT_LIMIT));
  });

  it("fails validation when forbidden concurrent changes are present", () => {
    const validation = validateBranchAgainstLock(
      { model: "gpt-5.4", dataset: "slice-b" },
      makeLock()
    );

    expect(validation.valid).toBe(false);
    expect(validation.violations.join(" ")).toContain("cannot be changed together");
  });

  it("fails validation when a dimension exceeds the lock allowlist", () => {
    const validation = validateBranchAgainstLock(
      { hyperparameter: "lr=1e-4" },
      makeLock()
    );

    expect(validation.valid).toBe(false);
    expect(validation.violations.join(" ")).toContain("outside the baseline lock allowlist");
  });

  it("creates, saves, and loads a baseline lock artifact", async () => {
    const runDir = makeTempRunDir();
    await fs.writeFile(path.join(runDir, "experiment_portfolio.json"), '{"baseline":"a"}', "utf8");
    await fs.writeFile(path.join(runDir, "trial_group_matrix.json"), '{"slice":"b"}', "utf8");
    await fs.writeFile(path.join(runDir, "objective_evaluation.json"), '{"metric":"c"}', "utf8");
    await fs.writeFile(path.join(runDir, "run_manifest.json"), '{"seed_policy":"fixed-seed"}', "utf8");

    const lock = await createBaselineLock({
      runId: "run-2",
      runDir,
      allowedDimensions: ["model"],
      forbiddenConcurrent: [["model", "dataset"]]
    });
    saveBaselineLock(runDir, lock);
    const loaded = loadBaselineLock(runDir);

    expect(loaded?.run_id).toBe("run-2");
    expect(loaded?.seed_policy).toBe("fixed-seed");
    expect(loaded?.baseline_hash).not.toBe("missing");
    expect(loaded?.dataset_slice_hash).not.toBe("missing");
    expect(loaded?.evaluator_hash).not.toBe("missing");
  });

  it("writes blocked_reasons.json for rejected branches", async () => {
    const runDir = makeTempRunDir();
    const result = checkSingleChange({ model: "gpt-5.4", dataset: "slice-b" }, null);

    saveBlockedBranchRecord(runDir, result);
    const written = JSON.parse(await fs.readFile(path.join(runDir, "blocked_reasons.json"), "utf8")) as {
      allowed: boolean;
      blocked_reasons: string[];
    };

    expect(written.allowed).toBe(false);
    expect(written.blocked_reasons.length).toBeGreaterThan(0);
  });
});
