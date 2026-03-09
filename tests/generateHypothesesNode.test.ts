import { describe, expect, it } from "vitest";

import { normalizeGenerateHypothesesRequest } from "../src/core/nodes/generateHypotheses.js";

describe("normalizeGenerateHypothesesRequest", () => {
  it("uses defaults when values are missing", () => {
    expect(normalizeGenerateHypothesesRequest(undefined)).toEqual({
      topK: 2,
      branchCount: 6
    });
  });

  it("ensures branch-count is at least top-k", () => {
    expect(normalizeGenerateHypothesesRequest({ topK: 5, branchCount: 3 })).toEqual({
      topK: 5,
      branchCount: 5
    });
  });
});
