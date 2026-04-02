import { appendGovernanceTrace } from "./governanceTrace.js";
import { classifyAction, ClassifiableAction, matchesPolicyPattern } from "./actionRiskClassifier.js";
import { ActionRiskTier, GovernanceDecision, GovernancePolicy, PolicySlot } from "./policyTypes.js";

export interface PolicyEvaluationResult {
  tier: ActionRiskTier;
  decision: GovernanceDecision;
  matchedSlotId: string | null;
  detail: string;
}

function defaultDecisionForTier(tier: ActionRiskTier): GovernanceDecision {
  switch (tier) {
    case "read_only":
      return "allow";
    case "local_mutation_low":
      return "allow_with_trace";
    case "local_mutation_high":
      return "require_review";
    case "execution_low":
      return "allow_with_trace";
    case "execution_high":
      return "require_review";
    case "publication_risk":
      return "require_review";
    case "external_side_effect":
      return "hard_stop";
  }
}

function findMatchingSlot(target: string, slots: PolicySlot[]): PolicySlot | null {
  for (const slot of slots) {
    if (matchesPolicyPattern(target, slot.matchPattern)) {
      return slot;
    }
  }
  return null;
}

export function evaluateActionDetailed(
  action: ClassifiableAction,
  policy: GovernancePolicy,
  runId: string | null,
  node: string | null
): PolicyEvaluationResult {
  const tier = classifyAction(action, policy);
  const slot = action.type === "file_read" ? null : findMatchingSlot(action.target, policy.slots || []);
  const decision = slot?.decision || defaultDecisionForTier(tier);
  const detail = slot
    ? `Governance ${decision}: matched slot ${slot.id} (${slot.description}) for ${action.type} ${action.target}.`
    : `Governance ${decision}: classified ${action.type} ${action.target} as ${tier}.`;

  if (!(decision === "allow" && tier === "read_only")) {
    appendGovernanceTrace({
      timestamp: new Date().toISOString(),
      runId,
      node,
      inputSummary: `${action.type}: ${action.target}`.slice(0, 100),
      screeningResult: null,
      triggeredRules: [],
      decision,
      matchedSlotId: slot?.id || null,
      detail
    });
  }

  return {
    tier,
    decision,
    matchedSlotId: slot?.id || null,
    detail
  };
}

export function evaluateAction(
  action: ClassifiableAction,
  policy: GovernancePolicy,
  runId: string | null,
  node: string | null
): GovernanceDecision {
  return evaluateActionDetailed(action, policy, runId, node).decision;
}
