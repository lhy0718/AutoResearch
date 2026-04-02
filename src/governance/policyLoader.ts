import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

import type {
  ActionRiskTier,
  GovernanceDecision,
  GovernancePolicy
} from "./policyTypes.js";

const ALLOWED_TIERS: ActionRiskTier[] = [
  "read_only",
  "local_mutation_low",
  "local_mutation_high",
  "execution_low",
  "execution_high",
  "publication_risk",
  "external_side_effect"
];

const ALLOWED_DECISIONS: GovernanceDecision[] = [
  "allow",
  "allow_with_trace",
  "require_review",
  "hard_stop"
];

const GOVERNANCE_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const GOVERNANCE_REPO_ROOT = path.resolve(GOVERNANCE_MODULE_DIR, "..", "..");
const DEFAULT_GOVERNANCE_POLICY_PATH = path.join(
  GOVERNANCE_REPO_ROOT,
  "src",
  "config",
  "governance.default.yaml"
);

export function loadGovernancePolicy(configPath?: string): GovernancePolicy {
  const resolvedPath = configPath ? path.resolve(configPath) : DEFAULT_GOVERNANCE_POLICY_PATH;

  const raw = readFileSync(resolvedPath, "utf8");
  const parsed = YAML.parse(raw) as GovernancePolicy;
  return parsed;
}

export function validateGovernancePolicy(policy: GovernancePolicy): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!policy.version?.trim()) {
    errors.push("Governance policy version must be provided.");
  }

  for (const slot of policy.slots ?? []) {
    if (!ALLOWED_TIERS.includes(slot.tier)) {
      errors.push(`Policy slot ${slot.id} has unsupported tier: ${String(slot.tier)}`);
    }
    if (!ALLOWED_DECISIONS.includes(slot.decision)) {
      errors.push(`Policy slot ${slot.id} has unsupported decision: ${String(slot.decision)}`);
    }
  }

  const claimCeilingPath = path.resolve(GOVERNANCE_REPO_ROOT, policy.claimCeilingRef ?? "");
  if (!policy.claimCeilingRef?.trim() || !existsSync(claimCeilingPath)) {
    errors.push(`claimCeilingRef does not exist: ${policy.claimCeilingRef ?? ""}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
