import { describe, expect, it } from "vitest";

import { resolveGovernanceBenchmarkCondition } from "../src/core/benchmark/governanceCondition.js";

describe("governance benchmark condition", () => {
  it("keeps the gated condition fully enforced", () => {
    expect(resolveGovernanceBenchmarkCondition("gated")).toEqual({
      name: "gated",
      mode: "benchmark",
      gates: {
        claim_ceiling: true,
        review_gate: true,
        figure_audit: true
      },
      ablations: []
    });
  });

  it("represents ungated and ablation conditions explicitly", () => {
    expect(resolveGovernanceBenchmarkCondition("ungated").gates).toEqual({
      claim_ceiling: false,
      review_gate: false,
      figure_audit: false
    });
    expect(resolveGovernanceBenchmarkCondition("no_claim_ceiling").ablations).toEqual(["claim_ceiling"]);
    expect(resolveGovernanceBenchmarkCondition("no_review_gate").ablations).toEqual(["review_gate"]);
    expect(resolveGovernanceBenchmarkCondition("no_figure_audit").ablations).toEqual(["figure_audit"]);
  });
});
