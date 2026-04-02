import { promises as fs } from "node:fs";
import path from "node:path";

import { buildWorkspaceRunRoot } from "../core/runs/runPaths.js";
import { appendGovernanceTrace } from "./governanceTrace.js";
import { matchesPolicyPattern } from "./actionRiskClassifier.js";
import { loadGovernancePolicy } from "./policyLoader.js";
import { DelegationContract, GovernancePolicy } from "./policyTypes.js";

export function validateDelegationContract(
  contract: DelegationContract,
  policy = loadGovernancePolicy()
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const objective = contract.objective?.trim() || "";
  if (!objective) {
    errors.push("Delegation objective must not be empty.");
  }

  const invalidScopes = (contract.allowedWriteScope || []).filter(
    (scope) => !policy.allowedWritePaths.some((allowed) => matchesPolicyPattern(scope, allowed) || matchesPolicyPattern(allowed, scope))
  );
  if (invalidScopes.length > 0) {
    errors.push(`Delegation allowedWriteScope exceeds policy: ${invalidScopes.join(", ")}`);
  }

  const missingForbidden = (policy.forbiddenExternalActions || []).filter(
    (action) => !(contract.forbiddenActions || []).includes(action)
  );
  if (missingForbidden.length > 0) {
    errors.push(`Delegation contract must include forbidden actions: ${missingForbidden.join(", ")}`);
  }

  if (!["paper_scale", "research_memo", "system_validation_note"].includes(contract.claimCeilingLimit)) {
    errors.push(`Unsupported claimCeilingLimit: ${String(contract.claimCeilingLimit)}`);
  }

  if (
    contract.maxRuntimeMs != null &&
    (!Number.isInteger(contract.maxRuntimeMs) || contract.maxRuntimeMs <= 0)
  ) {
    errors.push("maxRuntimeMs must be null or a positive integer.");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function buildDelegationContract(
  options: Partial<DelegationContract>,
  policy = loadGovernancePolicy()
): DelegationContract {
  return {
    subagentId: options.subagentId || "overnight-controller",
    objective: options.objective || "",
    allowedTools: options.allowedTools || [],
    allowedWriteScope: options.allowedWriteScope || [".autolabos/runs/**"],
    forbiddenActions: options.forbiddenActions || [...policy.forbiddenExternalActions],
    claimCeilingLimit: options.claimCeilingLimit || "research_memo",
    maxRuntimeMs: options.maxRuntimeMs === undefined ? 3_600_000 : options.maxRuntimeMs,
    returnSchema: options.returnSchema || ".autolabos/runs/<run-id>/delegation_contract.json"
  };
}

export async function persistDelegationContract(
  workspaceRoot: string,
  runId: string,
  contract: DelegationContract
): Promise<string> {
  const runRoot = buildWorkspaceRunRoot(workspaceRoot, runId);
  await fs.mkdir(runRoot, { recursive: true });
  const target = path.join(runRoot, "delegation_contract.json");
  await fs.writeFile(target, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  return target;
}

export function appendDelegationTrace(entry: {
  workspaceRoot: string;
  runId: string;
  node: string | null;
  detail: string;
  decision: "allow_with_trace" | "require_review" | "hard_stop";
}): void {
  const traceDir = path.join(entry.workspaceRoot, ".autolabos", "governance", "traces");
  appendGovernanceTrace({
    timestamp: new Date().toISOString(),
    runId: entry.runId,
    node: entry.node,
    inputSummary: "delegation contract".slice(0, 100),
    screeningResult: null,
    triggeredRules: [],
    decision: entry.decision,
    matchedSlotId: null,
    detail: entry.detail
  }, traceDir);
}

export async function prepareDelegationContractForRun(options: {
  workspaceRoot: string;
  runId: string;
  node: string | null;
  contract: Partial<DelegationContract>;
  policy?: GovernancePolicy;
}): Promise<
  | { valid: true; contract: DelegationContract; path: string }
  | { valid: false; errors: string[] }
> {
  const policy = options.policy || loadGovernancePolicy();
  const contract = buildDelegationContract(options.contract, policy);
  const validation = validateDelegationContract(contract, policy);
  if (!validation.valid) {
    appendDelegationTrace({
      workspaceRoot: options.workspaceRoot,
      runId: options.runId,
      node: options.node,
      decision: "require_review",
      detail: `Delegation blocked: ${validation.errors.join(" ")}`
    });
    return {
      valid: false,
      errors: validation.errors
    };
  }

  const targetPath = await persistDelegationContract(options.workspaceRoot, options.runId, contract);
  appendDelegationTrace({
    workspaceRoot: options.workspaceRoot,
    runId: options.runId,
    node: options.node,
    decision: "allow_with_trace",
    detail: `Delegation contract prepared at ${targetPath}.`
  });
  return {
    valid: true,
    contract,
    path: targetPath
  };
}
