import { describe, expect, it } from "vitest";

import { classifyAction } from "../src/governance/actionRiskClassifier.js";
import { loadGovernancePolicy } from "../src/governance/policyLoader.js";

const policy = loadGovernancePolicy();

describe("actionRiskClassifier", () => {
  it("classifies file reads as read_only", () => {
    expect(
      classifyAction(
        { type: "file_read", target: ".autolabos/runs/abc/result.json", context: "review" },
        policy
      )
    ).toBe("read_only");
  });

  it("classifies run artifact writes as local_mutation_low", () => {
    expect(
      classifyAction(
        { type: "file_write", target: ".autolabos/runs/abc/result.json", context: "analyze_results" },
        policy
      )
    ).toBe("local_mutation_low");
  });

  it("classifies source edits as local_mutation_high", () => {
    expect(
      classifyAction(
        { type: "file_write", target: "src/core/nodes/foo.ts", context: "meta-harness" },
        policy
      )
    ).toBe("local_mutation_high");
  });

  it("classifies git push as external_side_effect", () => {
    expect(
      classifyAction(
        { type: "shell_exec", target: "git push origin main", context: "publish" },
        policy
      )
    ).toBe("external_side_effect");
  });

  it("classifies trusted external requests as execution_low", () => {
    expect(
      classifyAction(
        { type: "external_request", target: "https://arxiv.org/abs/1234.5678", context: "collect_papers" },
        policy
      )
    ).toBe("execution_low");
  });

  it("classifies untrusted external requests as execution_high", () => {
    expect(
      classifyAction(
        { type: "external_request", target: "https://unknown-domain.com/data", context: "collect_papers" },
        policy
      )
    ).toBe("execution_high");
  });
});
