export type GraphNodeId =
  | "collect_papers"
  | "analyze_papers"
  | "generate_hypotheses"
  | "design_experiments"
  | "implement_experiments"
  | "run_experiments"
  | "analyze_results"
  | "review"
  | "write_paper";

export const GRAPH_NODE_ORDER: GraphNodeId[] = [
  "collect_papers",
  "analyze_papers",
  "generate_hypotheses",
  "design_experiments",
  "implement_experiments",
  "run_experiments",
  "analyze_results",
  "review",
  "write_paper"
];

// Backward-compatible alias for previously shipped command/UI logic.
export type AgentId = GraphNodeId;
export const AGENT_ORDER: AgentId[] = [...GRAPH_NODE_ORDER];

export type AgentRoleId =
  | "collector_curator"
  | "reader_evidence_extractor"
  | "hypothesis_agent"
  | "experiment_designer"
  | "implementer"
  | "runner"
  | "analyst_statistician"
  | "paper_writer"
  | "reviewer";

export const AGENT_ROLE_ORDER: AgentRoleId[] = [
  "collector_curator",
  "reader_evidence_extractor",
  "hypothesis_agent",
  "experiment_designer",
  "implementer",
  "runner",
  "analyst_statistician",
  "paper_writer",
  "reviewer"
];

export type NodeStatus = "pending" | "running" | "needs_approval" | "completed" | "failed" | "skipped";
export type AgentStatus = NodeStatus;
export type WorkflowApprovalMode = "manual" | "minimal";
export type ExecutionApprovalMode = "manual" | "risk_ack" | "full_auto";
export type ExperimentNetworkPolicy = "blocked" | "declared" | "required";
export type ExperimentNetworkPurpose =
  | "logging"
  | "artifact_upload"
  | "model_download"
  | "dataset_fetch"
  | "remote_inference"
  | "other";
export type DoctorCheckStatus = "ok" | "warning" | "fail";

export type TransitionAction =
  | "advance"
  | "retry_same"
  | "backtrack_to_implement"
  | "backtrack_to_design"
  | "backtrack_to_hypotheses"
  | "pause_for_human";

export interface TransitionRecommendation {
  action: TransitionAction;
  sourceNode: GraphNodeId;
  targetNode?: GraphNodeId;
  reason: string;
  confidence: number;
  autoExecutable: boolean;
  evidence: string[];
  suggestedCommands: string[];
  generatedAt: string;
}

export interface TransitionHistoryEntry {
  action: TransitionAction;
  sourceNode: GraphNodeId;
  fromNode: GraphNodeId;
  toNode?: GraphNodeId;
  reason: string;
  confidence: number;
  autoExecutable: boolean;
  appliedAt: string;
}

export interface NodeState {
  status: NodeStatus;
  updatedAt: string;
  note?: string;
  lastError?: string;
}

export interface RetryPolicy {
  maxAttemptsPerNode: number;
  maxAutoRollbacksPerNode: number;
  /** Maximum backward jumps the minimal-approval runtime may auto-apply before pausing for human review. */
  maxAutoBackwardJumps?: number;
}

export interface RunGraphState {
  currentNode: GraphNodeId;
  nodeStates: Record<GraphNodeId, NodeState>;
  retryCounters: Partial<Record<GraphNodeId, number>>;
  rollbackCounters: Partial<Record<GraphNodeId, number>>;
  researchCycle: number;
  pendingTransition?: TransitionRecommendation;
  transitionHistory: TransitionHistoryEntry[];
  checkpointSeq: number;
  retryPolicy: RetryPolicy;
}

export type RunStatus = "pending" | "running" | "paused" | "completed" | "failed";

export interface RunUsageTotals {
  costUsd: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  wallTimeMs: number;
}

export interface NodeUsageSummary extends RunUsageTotals {
  executions: number;
  lastUpdatedAt?: string;
}

export interface RunUsageSummary {
  totals: RunUsageTotals;
  byNode: Partial<Record<GraphNodeId, NodeUsageSummary>>;
  lastUpdatedAt?: string;
}

export interface PaperProfileConfig {
  venue_style: string;
  /** Manuscript rhetoric/style target (e.g. "acl", "neurips", "generic_cs_paper"). */
  target_venue_style?: string;
  /** Number of columns for the main body (1 or 2). Default: 2. */
  column_count: 1 | 2;
  /** Nominal page-count target used to size word budgets and section allocations. */
  target_main_pages?: number;
  /** Minimum compiled main-body pages accepted by the page-budget validator. Defaults to target_main_pages. */
  minimum_main_pages?: number;
  /**
   * @deprecated Compatibility alias. When explicit fields are absent, this seeds both
   * target_main_pages and minimum_main_pages. Prefer the explicit fields for new configs.
   */
  main_page_limit?: number;
  references_counted: boolean;
  appendix_allowed: boolean;
  appendix_format: "double_column" | "single_column";
  prefer_appendix_for: string[];
  estimated_words_per_page?: number;
}

export interface ResolvedPaperProfileConfig extends Omit<PaperProfileConfig, "target_main_pages" | "minimum_main_pages"> {
  target_main_pages: number;
  minimum_main_pages: number;
  /**
   * @deprecated Compatibility alias for minimum_main_pages, retained so older run artifacts
   * and tests can still be interpreted during the migration.
   */
  main_page_limit: number;
}

/** Manuscript format constraints that can be specified in a research brief. */
export interface ManuscriptFormatTarget {
  /** Number of columns (1 or 2). */
  columns: 1 | 2;
  /** Target page count for the main paper body. This seeds minimum_main_pages unless overridden elsewhere. */
  main_body_pages: number;
  /** Whether the reference list is excluded from the page count. */
  references_excluded_from_page_limit: boolean;
  /** Whether appendices are excluded from the page count. */
  appendices_excluded_from_page_limit: boolean;
}

export interface RunRecord {
  version: 3;
  workflowVersion: 3;
  id: string;
  title: string;
  topic: string;
  constraints: string[];
  objectiveMetric: string;
  status: RunStatus;
  currentNode: GraphNodeId;
  latestSummary?: string;
  nodeThreads: Partial<Record<GraphNodeId, string>>;
  createdAt: string;
  updatedAt: string;
  usage?: RunUsageSummary;
  graph: RunGraphState;
  memoryRefs: {
    runContextPath: string;
    longTermPath: string;
    episodePath: string;
  };
}

export interface RunsFile {
  version: 3;
  runs: RunRecord[];
}

export interface AppConfig {
  version: 1;
  project_name: string;
  providers: {
    llm_mode: "codex_chatgpt_only" | "openai_api" | "ollama";
    codex: {
      model: string;
      chat_model?: string;
      experiment_model?: string;
      reasoning_effort: "minimal" | "low" | "medium" | "high" | "xhigh";
      chat_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      experiment_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      command_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      fast_mode: boolean;
      chat_fast_mode?: boolean;
      experiment_fast_mode?: boolean;
      auth_required: true;
    };
    openai: {
      model: string;
      chat_model?: string;
      experiment_model?: string;
      reasoning_effort: "minimal" | "low" | "medium" | "high" | "xhigh";
      chat_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      experiment_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      command_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      api_key_required: true;
    };
    ollama?: {
      base_url: string;
      chat_model: string;
      research_model: string;
      experiment_model?: string;
      vision_model?: string;
      chat_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      research_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
    };
  };
  papers: {
    max_results: number;
    per_second_limit: number;
  };
  research: {
    default_topic: string;
    default_constraints: string[];
    default_objective_metric: string;
  };
  workflow: {
    mode: "agent_approval";
    wizard_enabled: true;
    approval_mode?: WorkflowApprovalMode;
    execution_approval_mode?: ExecutionApprovalMode;
    budget_guard_usd?: number;
  };
  experiments: {
    runner: "local_python";
    timeout_sec: number;
    allow_network: boolean;
    network_policy?: ExperimentNetworkPolicy;
    network_purpose?: ExperimentNetworkPurpose;
    candidate_isolation?: "attempt_snapshot_restore" | "attempt_worktree";
  };
  paper: {
    template: "acl";
    build_pdf: boolean;
    latex_engine: "auto_install";
    validation_mode?: "default" | "strict_paper";
  };
  paper_profile: PaperProfileConfig;
  paths: {
    runs_dir: string;
    logs_dir: string;
  };
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  status?: DoctorCheckStatus;
  detail: string;
}

export interface SuggestionItem {
  key: string;
  label: string;
  description: string;
  applyValue: string;
}

export interface SlashContextRun {
  id: string;
  title: string;
  currentNode: GraphNodeId;
  status: RunStatus;
  updatedAt: string;
}

export interface PendingPlan {
  sourceInput: string;
  displayCommands: string[];
  stepIndex: number;
  totalSteps: number;
}

export interface RunInsightCard {
  title: string;
  lines: string[];
  readinessRisks?: {
    stage: "review" | "paper";
    readinessState: string;
    paperReady: boolean;
    riskCounts: {
      total: number;
      blocked: number;
      warning: number;
    };
    risks: Array<{
      code: string;
      section: string;
      severity: "warning" | "fail";
      message: string;
      source: "review_readiness" | "paper_readiness";
    }>;
    artifactRefs: Array<{
      label: string;
      path: string;
    }>;
  };
  manuscriptQuality?: {
    status: "pass" | "repairing" | "stopped";
    stage: "initial_gate" | "post_repair_1" | "post_repair_2";
    reasonCategory:
      | "review_reliability"
      | "policy_hard_stop"
      | "locality_violation"
      | "visual_overclaim"
      | "repeated_issue"
      | "no_improvement"
      | "scope_too_broad"
      | "upstream_scientific_or_submission_failure"
      | "clean_pass"
      | "repairable_manuscript_issue";
    reviewReliability: "grounded" | "partially_grounded" | "degraded";
    triggeredBy: string[];
    repairAttempts: {
      attempted: number;
      allowedMax: number;
      remaining: number;
      improvementDetected?: boolean;
    };
    issueCounts: {
      manuscript: number;
      hardStopPolicy: number;
      backstopOnly: number;
      readinessRisks?: number;
      scientificBlockers: number;
      submissionBlockers: number;
      reviewerMissedPolicy: number;
      reviewerCoveredBackstop: number;
    };
    issueGroups: {
      manuscript: Array<{
        code: string;
        section: string;
        severity: "warning" | "fail";
        message: string;
        source: "review" | "style_lint";
      }>;
      hardStopPolicy: Array<{
        code: string;
        section: string;
        severity: "warning" | "fail";
        message: string;
        source: "style_lint";
      }>;
      backstopOnly: Array<{
        code: string;
        section: string;
        severity: "warning" | "fail";
        message: string;
        source: "style_lint";
      }>;
      readiness?: Array<{
        code: string;
        section: string;
        severity: "warning" | "fail";
        message: string;
        source: "paper_readiness";
      }>;
      scientific: Array<{
        code: string;
        section: string;
        severity: "warning" | "fail";
        message: string;
        source: "scientific_validation";
      }>;
      submission: Array<{
        code: string;
        section: string;
        severity: "warning" | "fail";
        message: string;
        source: "submission_validation";
      }>;
    };
    artifactRefs: Array<{
      label: string;
      path: string;
    }>;
  };
  actions?: Array<{
    label: string;
    command: string;
  }>;
  references?: Array<{
    kind: "figure" | "comparison" | "statistics" | "transition" | "report" | "metrics";
    label: string;
    path: string;
    summary: string;
    facts?: Array<{
      label: string;
      value: string;
    }>;
    details?: string[];
  }>;
}

export type RunLifecycleStatus = RunStatus | "needs_approval";
export type RunRecommendedNextAction =
  | "inspect_blocker"
  | "resume_review"
  | "rerun_after_fix"
  | "waiting_for_input"
  | "completed";

export interface RunJobFailureAggregate {
  key: string;
  reason: string;
  occurrence_count: number;
  recurrence_probability: number;
  remediation: string;
}

export interface RunJobProjection {
  run_id: string;
  title: string;
  current_node: GraphNodeId;
  lifecycle_status: RunLifecycleStatus;
  approval_mode: WorkflowApprovalMode;
  last_event_at: string;
  recommended_next_action: RunRecommendedNextAction;
  analysis_ready: boolean;
  review_ready: boolean;
  paper_ready: boolean;
  review_gate_status?: "missing" | "ready" | "warning" | "blocking";
  review_decision_outcome?: string;
  review_recommended_transition?: string;
  review_score_overall?: number;
  paper_readiness_state?: string;
  paper_readiness_reason?: string;
  blocker_summary?: string;
}

export interface RunJobsSnapshot {
  generated_at: string;
  runs: RunJobProjection[];
  top_failures: RunJobFailureAggregate[];
}

export interface WebSessionState {
  activeRunId?: string;
  busy: boolean;
  busyLabel?: string;
  pendingPlan?: PendingPlan;
  logs: string[];
  canCancel: boolean;
  activeRunInsight?: RunInsightCard;
}

export interface ArtifactEntry {
  path: string;
  kind: "directory" | "text" | "json" | "image" | "pdf" | "download";
  size: number;
  modifiedAt: string;
  previewable: boolean;
}
