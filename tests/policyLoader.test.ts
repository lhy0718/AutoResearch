import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadGovernancePolicy, validateGovernancePolicy } from "../src/governance/policyLoader.js";

describe("governance policy loader", () => {
  it("loads the default governance policy", () => {
    const policy = loadGovernancePolicy();
    expect(policy.version).toBe("1.0");
    expect(policy.claimCeilingRef).toBe("src/core/analysis/paperMinimumGate.ts");
    expect(policy.slots.length).toBeGreaterThan(0);
  });

  it("validates the default governance policy", () => {
    const policy = loadGovernancePolicy();
    expect(validateGovernancePolicy(policy)).toEqual({
      valid: true,
      errors: []
    });
  });

  it("rejects a policy with an invalid slot tier", () => {
    const policy = loadGovernancePolicy();
    policy.slots[0] = {
      ...policy.slots[0],
      tier: "totally_invalid" as never
    };

    const result = validateGovernancePolicy(policy);
    expect(result.valid).toBe(false);
    expect(result.errors).not.toHaveLength(0);
    expect(result.errors[0]).toContain("unsupported tier");
  });

  it("throws when the yaml path does not exist", () => {
    expect(() => loadGovernancePolicy("/definitely/missing/governance.yaml")).toThrow();
  });

  it("loads an explicit yaml path", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "autolabos-governance-policy-"));
    const filePath = path.join(dir, "governance.yaml");
    writeFileSync(
      filePath,
      [
        'version: "1.0"',
        "trustedSources: []",
        "allowedWritePaths: []",
        "reviewRequiredPaths: []",
        "forbiddenExternalActions: []",
        'claimCeilingRef: "src/core/analysis/paperMinimumGate.ts"',
        "slots: []"
      ].join("\n"),
      "utf8"
    );

    const policy = loadGovernancePolicy(filePath);
    expect(policy.version).toBe("1.0");
    expect(policy.slots).toEqual([]);
  });
});
