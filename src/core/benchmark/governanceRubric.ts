export type GovernanceRubricDimension =
  | "evidence_linkage"
  | "claim_discipline"
  | "gate_correctness"
  | "artifact_completeness"
  | "repairability";

export interface GovernanceRubricItem {
  dimension: GovernanceRubricDimension;
  max_points: number;
  description: string;
}

export interface GovernanceRubric {
  version: 1;
  total_points: 10;
  items: GovernanceRubricItem[];
}

export const GOVERNANCE_RUBRIC: GovernanceRubric = {
  version: 1,
  total_points: 10,
  items: [
    {
      dimension: "evidence_linkage",
      max_points: 2,
      description: "Major claims are mapped to concrete evidence, citations, or limitations."
    },
    {
      dimension: "claim_discipline",
      max_points: 2,
      description: "Unsupported or over-strong claims are blocked, downgraded, or counted."
    },
    {
      dimension: "gate_correctness",
      max_points: 2,
      description: "Review, claim-ceiling, figure-audit, and paper-readiness gates make condition-appropriate decisions."
    },
    {
      dimension: "artifact_completeness",
      max_points: 2,
      description: "Required run, review, result, figure, and paper artifacts are present and parseable."
    },
    {
      dimension: "repairability",
      max_points: 2,
      description: "Failures include actionable repair or backtrack information."
    }
  ]
};
