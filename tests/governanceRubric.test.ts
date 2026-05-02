import { describe, expect, it } from "vitest";

import { GOVERNANCE_RUBRIC } from "../src/core/benchmark/governanceRubric.js";

describe("governance rubric", () => {
  it("defines a 10-point rubric across the required governance dimensions", () => {
    expect(GOVERNANCE_RUBRIC.total_points).toBe(10);
    expect(GOVERNANCE_RUBRIC.items.reduce((sum, item) => sum + item.max_points, 0)).toBe(10);
    expect(GOVERNANCE_RUBRIC.items.map((item) => item.dimension)).toEqual([
      "evidence_linkage",
      "claim_discipline",
      "gate_correctness",
      "artifact_completeness",
      "repairability"
    ]);
  });
});
