import { describe, expect, it } from "vitest";

import { GATE_THRESHOLDS } from "../src/core/analysis/paperGateThresholds.js";

describe("paper gate thresholds", () => {
  it("exports only finite positive numeric thresholds", () => {
    for (const [key, value] of Object.entries(GATE_THRESHOLDS)) {
      expect(Number.isFinite(value), `${key} should be finite`).toBe(true);
      expect(value, `${key} should be > 0`).toBeGreaterThan(0);
    }
  });
});
