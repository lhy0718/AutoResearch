export type EvidenceScreeningResult =
  | "clean"
  | "suspicious_but_usable"
  | "blocked";

export type ActionRiskTier =
  | "read_only"
  | "local_mutation_low"
  | "local_mutation_high"
  | "execution_low"
  | "execution_high"
  | "publication_risk"
  | "external_side_effect";

export type GovernanceDecision =
  | "allow"
  | "allow_with_trace"
  | "require_review"
  | "hard_stop";

export interface PolicySlot {
  id: string;
  description: string;
  matchPattern: string;
  tier: ActionRiskTier;
  decision: GovernanceDecision;
}

export interface GovernancePolicy {
  version: string;
  trustedSources: string[];
  allowedWritePaths: string[];
  reviewRequiredPaths: string[];
  forbiddenExternalActions: string[];
  claimCeilingRef: string;
  slots: PolicySlot[];
}

export interface DelegationContract {
  subagentId: string;
  objective: string;
  allowedTools: string[];
  allowedWriteScope: string[];
  forbiddenActions: string[];
  claimCeilingLimit: "paper_scale" | "research_memo" | "system_validation_note";
  maxRuntimeMs: number | null;
  returnSchema: string;
}
