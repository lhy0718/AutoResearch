import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildDelegationContract,
  prepareDelegationContractForRun,
  validateDelegationContract
} from "../src/governance/delegationContract.js";
import { loadGovernancePolicy } from "../src/governance/policyLoader.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("delegationContract", () => {
  it("rejects write scopes wider than the policy", () => {
    const policy = loadGovernancePolicy();
    const contract = buildDelegationContract({
      objective: "test",
      allowedWriteScope: ["src/**"],
      forbiddenActions: [...policy.forbiddenExternalActions]
    }, policy);

    const result = validateDelegationContract(contract, policy);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("allowedWriteScope");
  });

  it("rejects contracts missing parent forbidden actions", () => {
    const policy = loadGovernancePolicy();
    const contract = buildDelegationContract({
      objective: "test",
      forbiddenActions: ["git push"]
    }, policy);

    const result = validateDelegationContract(contract, policy);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("forbidden actions");
  });

  it("accepts a valid contract", () => {
    const policy = loadGovernancePolicy();
    const contract = buildDelegationContract({
      objective: "overnight governed execution"
    }, policy);

    expect(validateDelegationContract(contract, policy)).toEqual({
      valid: true,
      errors: []
    });
  });

  it("persists delegation_contract.json for valid delegation setup", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "delegation-contract-"));
    tempDirs.push(workspaceRoot);

    const result = await prepareDelegationContractForRun({
      workspaceRoot,
      runId: "run-1",
      node: "review",
      contract: {
        subagentId: "overnight",
        objective: "overnight governed execution"
      }
    });

    expect(result.valid).toBe(true);
    const filePath = path.join(workspaceRoot, ".autolabos", "runs", "run-1", "delegation_contract.json");
    const written = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(written.subagentId).toBe("overnight");
  });

  it("does not persist delegation_contract.json for invalid delegation setup", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "delegation-contract-"));
    tempDirs.push(workspaceRoot);

    const result = await prepareDelegationContractForRun({
      workspaceRoot,
      runId: "run-2",
      node: "review",
      contract: {
        objective: "bad delegation",
        allowedWriteScope: ["src/**"],
        forbiddenActions: ["git push"]
      }
    });

    expect(result.valid).toBe(false);
    const filePath = path.join(workspaceRoot, ".autolabos", "runs", "run-2", "delegation_contract.json");
    await expect(fs.readFile(filePath, "utf8")).rejects.toThrow();
  });
});
