import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { evaluateAction, evaluateActionDetailed } from "../src/governance/policyEngine.js";
import { loadGovernancePolicy } from "../src/governance/policyLoader.js";

const ORIGINAL_CWD = process.cwd();
const tempDirs: string[] = [];

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("policyEngine", () => {
  it("allows read_only actions", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "policy-engine-"));
    tempDirs.push(cwd);
    process.chdir(cwd);
    const policy = loadGovernancePolicy();
    expect(
      evaluateAction(
        { type: "file_read", target: ".autolabos/runs/abc/result.json", context: "review" },
        policy,
        "run-1",
        "review"
      )
    ).toBe("allow");
  });

  it("requires review for local_mutation_high actions", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "policy-engine-"));
    tempDirs.push(cwd);
    process.chdir(cwd);
    const policy = loadGovernancePolicy();
    expect(
      evaluateAction(
        { type: "file_write", target: "src/core/nodes/foo.ts", context: "meta-harness" },
        policy,
        "run-1",
        "review"
      )
    ).toBe("require_review");
  });

  it("hard stops external side effects", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "policy-engine-"));
    tempDirs.push(cwd);
    process.chdir(cwd);
    const policy = loadGovernancePolicy();
    expect(
      evaluateAction(
        { type: "shell_exec", target: "git push origin main", context: "publish" },
        policy,
        "run-1",
        "write_paper"
      )
    ).toBe("hard_stop");
  });

  it("uses slot overrides before default decisions", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "policy-engine-"));
    tempDirs.push(cwd);
    process.chdir(cwd);
    const policy = loadGovernancePolicy();
    policy.slots = [
      {
        id: "override-run-write",
        description: "Force review for result analysis output",
        matchPattern: ".autolabos/runs/**/result_analysis.json",
        tier: "local_mutation_low",
        decision: "require_review"
      }
    ];

    const result = evaluateActionDetailed(
      { type: "file_write", target: ".autolabos/runs/run-1/result_analysis.json", context: "analyze_results" },
      policy,
      "run-1",
      "analyze_results"
    );
    expect(result.decision).toBe("require_review");
    expect(result.matchedSlotId).toBe("override-run-write");
  });
});
