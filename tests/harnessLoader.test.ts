import { describe, expect, it } from "vitest";

import { BASE_HARNESS, BUILTIN_HARNESS_PRESETS } from "../src/core/metaHarness/presets.js";
import {
  listHarnessCandidates,
  loadHarnessCandidate,
  validateHarnessCandidate
} from "../src/core/metaHarness/harnessLoader.js";
import type { HarnessCandidate } from "../src/core/metaHarness/types.js";

describe("meta-harness loader", () => {
  it("loads the base harness candidate", () => {
    expect(loadHarnessCandidate("base")).toEqual(BASE_HARNESS);
  });

  it("throws for an unknown harness candidate id", () => {
    expect(() => loadHarnessCandidate("없는id")).toThrow("Unknown harness candidate");
  });

  it("validates the base harness candidate", () => {
    expect(validateHarnessCandidate(BASE_HARNESS)).toEqual({
      valid: true,
      errors: []
    });
  });

  it("rejects unsupported target nodes", () => {
    const invalidCandidate: HarnessCandidate = {
      ...BASE_HARNESS,
      id: "invalid-node",
      targetNodes: ["analyze_papers", "nonexistent_node" as never]
    };
    expect(validateHarnessCandidate(invalidCandidate)).toEqual({
      valid: false,
      errors: ["Harness candidate contains unsupported target node: nonexistent_node"]
    });
  });

  it("validates all built-in presets", () => {
    for (const preset of BUILTIN_HARNESS_PRESETS) {
      expect(validateHarnessCandidate(preset)).toEqual({
        valid: true,
        errors: []
      });
    }
  });

  it("lists all built-in presets", () => {
    expect(listHarnessCandidates()).toEqual(BUILTIN_HARNESS_PRESETS);
  });
});
