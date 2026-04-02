export type ExplorationStage =
  | "feasibility"
  | "baseline_hardening"
  | "main_agenda"
  | "ablation";

export type ResearchTreeNodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "promoted"
  | "rolled_back";

export type BranchKind =
  | "baseline"
  | "main"
  | "debug"
  | "ablation"
  | "speculative";

export type FailureClass = "environment" | "design" | "implementation" | "evaluation";
export type RetryPolicy = "block" | "allow_once" | "allow_with_change";

export type InterventionDimension =
  | "model"
  | "dataset"
  | "evaluator"
  | "runtime_config"
  | "preprocessing"
  | "metric_policy"
  | "hyperparameter"
  | "architecture";

export interface FailureMemoryEntry {
  failure_fingerprint: string;
  failure_class: FailureClass;
  retry_policy: RetryPolicy;
  equivalent_to: string | null;
  affects_stage: ExplorationStage[];
  first_seen_at: string;
  occurrence_count: number;
}

export interface EvidenceManifest {
  branch_id: string;
  executed_at: string;
  artifact_paths: string[];
  metrics_source: string;
  is_executed: boolean;
  is_reproducible: boolean;
  reproduction_runs: number;
}

export interface BranchPromotionDecision {
  branch_id: string;
  promoted: boolean;
  is_strongest_defensible: boolean;
  promotion_score: number;
  objective_gain: number;
  budget_penalty: number;
  instability_penalty: number;
  confound_penalty: number;
  evidence_completeness: number;
  blocking_reasons: string[];
  decided_at: string;
}

export interface ResearchTreeNode {
  node_id: string;
  parent_id: string | null;
  root_id: string;
  stage: ExplorationStage;
  depth: number;
  debug_depth: number;
  branch_kind: BranchKind;
  change_set: Partial<Record<InterventionDimension, string>>;
  hypothesis_link: string | null;
  expected_effect: string;
  actual_result_summary: string | null;
  objective_metrics: Record<string, number | null>;
  budget_cost: number;
  reproducibility_status: "not_tested" | "reproduced" | "flaky" | "failed";
  failure_fingerprint: string | null;
  evidence_manifest: EvidenceManifest | null;
  promotion_decision: BranchPromotionDecision | null;
  blocked_reasons: string[];
  status: ResearchTreeNodeStatus;
  created_at: string;
  updated_at: string;
}

export interface StageDecisionEntry {
  stage: ExplorationStage;
  decision: "proceed" | "rollback" | "stop";
  reason: string;
  decided_at: string;
}

export interface BaselineLock {
  locked_at: string;
  run_id: string;
  baseline_hash: string;
  dataset_slice_hash: string;
  evaluator_hash: string;
  seed_policy: string;
  environment_fingerprint: string;
  allowed_intervention_dimensions: InterventionDimension[];
  forbidden_concurrent_changes: InterventionDimension[][];
}

export interface FigureAuditIssue {
  figure_id: string;
  issue_type: string;
  severity: "info" | "warning" | "severe";
  description: string;
  recommended_action: string;
  evidence_alignment_status: "aligned" | "misaligned" | "not_checked";
  empirical_validity_impact: "none" | "minor" | "major";
  publication_readiness: "ready" | "needs_revision" | "not_ready";
  manuscript_placement_recommendation: "main" | "appendix" | "remove";
}

export interface FigureAuditSummary {
  audited_at: string;
  figure_count: number;
  issues: FigureAuditIssue[];
  severe_mismatch_count: number;
  review_block_required: boolean;
}

export interface ManagerState {
  run_id: string;
  current_stage: ExplorationStage;
  stage_decision_history: StageDecisionEntry[];
  best_defensible_branch_id: string | null;
  pending_rollback_reason: string | null;
  promotion_history: BranchPromotionDecision[];
  blocked_claim_fingerprints: string[];
  figure_audit_summary: FigureAuditSummary | null;
  updated_at: string;
}
