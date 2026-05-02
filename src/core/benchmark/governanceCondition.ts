export type GovernanceBenchmarkConditionName =
  | "gated"
  | "ungated"
  | "no_claim_ceiling"
  | "no_review_gate"
  | "no_figure_audit";

export interface GovernanceBenchmarkCondition {
  name: GovernanceBenchmarkConditionName;
  mode: "benchmark";
  gates: {
    claim_ceiling: boolean;
    review_gate: boolean;
    figure_audit: boolean;
  };
  ablations: string[];
}

export function resolveGovernanceBenchmarkCondition(
  name: GovernanceBenchmarkConditionName = "gated"
): GovernanceBenchmarkCondition {
  switch (name) {
    case "gated":
      return buildCondition(name, true, true, true, []);
    case "ungated":
      return buildCondition(name, false, false, false, ["claim_ceiling", "review_gate", "figure_audit"]);
    case "no_claim_ceiling":
      return buildCondition(name, false, true, true, ["claim_ceiling"]);
    case "no_review_gate":
      return buildCondition(name, true, false, true, ["review_gate"]);
    case "no_figure_audit":
      return buildCondition(name, true, true, false, ["figure_audit"]);
  }
}

function buildCondition(
  name: GovernanceBenchmarkConditionName,
  claimCeiling: boolean,
  reviewGate: boolean,
  figureAudit: boolean,
  ablations: string[]
): GovernanceBenchmarkCondition {
  return {
    name,
    mode: "benchmark",
    gates: {
      claim_ceiling: claimCeiling,
      review_gate: reviewGate,
      figure_audit: figureAudit
    },
    ablations
  };
}
