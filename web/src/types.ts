export type NodeId =
  | "collect_papers"
  | "analyze_papers"
  | "generate_hypotheses"
  | "design_experiments"
  | "implement_experiments"
  | "run_experiments"
  | "analyze_results"
  | "review"
  | "write_paper";

export type ExecutionProfile = "local" | "docker" | "remote" | "plan_only";

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
    displayReasonLabel?: string;
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

export type RunLifecycleStatus = "pending" | "running" | "paused" | "completed" | "failed" | "needs_approval";
export type RunRecommendedNextAction =
  | "inspect_blocker"
  | "resume_review"
  | "rerun_after_fix"
  | "waiting_for_input"
  | "completed";
export type RunValidationScope = "full_run" | "live_fixture";
export type RunNetworkDependencySeverity = "info" | "warning" | "attention" | "blocking";

export interface RunStatusFailureSeed {
  key: string;
  summary: string;
  remediation: string;
}

export interface RunOperatorStatusArtifact {
  version: 1;
  generated_at: string;
  run_id: string;
  title: string;
  current_node: NodeId;
  lifecycle_status: RunLifecycleStatus;
  approval_mode: "manual" | "minimal" | "hybrid";
  last_event_at: string;
  analysis_ready: boolean;
  review_ready: boolean;
  paper_ready: boolean;
  recommended_next_action: RunRecommendedNextAction;
  blocker_summary?: string;
  blocking_reasons: string[];
  warning_reasons: string[];
  dominant_failure?: RunStatusFailureSeed;
  review_gate: {
    status?: "missing" | "ready" | "warning" | "blocking";
    decision_outcome?: string;
    recommended_transition?: string;
    score_overall?: number;
    operator_label?: string;
  };
  paper_gate: {
    status?: "missing" | "passed" | "warning" | "blocking";
    readiness_state?: string;
    reason?: string;
    operator_label?: string;
  };
  network_dependency: {
    enabled: boolean;
    policy?: "blocked" | "declared" | "required";
    purpose?: "logging" | "artifact_upload" | "model_download" | "dataset_fetch" | "remote_inference" | "other";
    severity: RunNetworkDependencySeverity;
    operator_label: string;
  };
  validation_scope: RunValidationScope;
}

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
  current_node: NodeId;
  lifecycle_status: RunLifecycleStatus;
  approval_mode: "manual" | "minimal" | "hybrid";
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
  review_gate_label?: string;
  paper_gate_label?: string;
  blocking_reasons?: string[];
  warning_reasons?: string[];
  network_dependency?: RunOperatorStatusArtifact["network_dependency"];
  validation_scope?: RunValidationScope;
}

export interface RunJobsSnapshot {
  generated_at: string;
  runs: RunJobProjection[];
  top_failures: RunJobFailureAggregate[];
}

export interface RunQueueJobSummary {
  run_id: string;
  node: NodeId;
  status: string;
  started_at: string;
  elapsed_seconds: number;
  recommended_action?: "retry" | "manual review";
  recommendation_line?: string;
  source?: "run" | "collect_background_job";
}

export interface RunQueueSnapshot {
  running: RunQueueJobSummary[];
  waiting: RunQueueJobSummary[];
  stalled: RunQueueJobSummary[];
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

export interface RunRecord {
  id: string;
  title: string;
  topic: string;
  constraints: string[];
  objectiveMetric: string;
  status: string;
  currentNode: NodeId;
  latestSummary?: string;
  updatedAt: string;
  graph: {
    currentNode: NodeId;
    checkpointSeq: number;
    retryCounters: Partial<Record<NodeId, number>>;
    rollbackCounters: Partial<Record<NodeId, number>>;
    nodeStates: Record<
      NodeId,
      {
        status: string;
        updatedAt: string;
        note?: string;
        lastError?: string;
      }
    >;
    pendingTransition?: {
      action: string;
      targetNode?: NodeId;
      reason: string;
      confidence: number;
      autoExecutable: boolean;
      evidence: string[];
      suggestedCommands: string[];
      generatedAt: string;
    };
  };
}

export interface ConfigSummary {
  projectName: string;
  workflowMode: "agent_approval";
  approvalMode: "manual" | "minimal" | "hybrid";
  executionApprovalMode?: "manual" | "risk_ack" | "full_auto";
  llmMode: "codex_chatgpt_only" | "openai_api" | "ollama";
  pdfMode: "codex_text_image_hybrid" | "responses_api_pdf" | "ollama_vision";
  researchBackendModel: string;
  chatModel: string;
  experimentModel: string;
  researchBackendReasoning: string | undefined;
  chatReasoning: string | undefined;
  experimentReasoning: string | undefined;
  networkPolicy?: "blocked" | "declared" | "required";
  networkPurpose?: "logging" | "artifact_upload" | "model_download" | "dataset_fetch" | "remote_inference" | "other";
}

export interface WebConfigFormData {
  projectName: string;
  defaultTopic: string;
  defaultConstraints: string;
  defaultObjectiveMetric: string;
  llmMode: "codex_chatgpt_only" | "openai_api" | "ollama";
  codexChatModelChoice: string;
  codexChatReasoningEffort: string;
  codexResearchBackendModelChoice: string;
  codexResearchBackendReasoningEffort: string;
  codexExperimentModelChoice: string;
  codexExperimentReasoningEffort: string;
  openAiChatModel: string;
  openAiChatReasoningEffort: string;
  openAiResearchBackendModel: string;
  openAiResearchBackendReasoningEffort: string;
  openAiExperimentModel: string;
  openAiExperimentReasoningEffort: string;
  ollamaBaseUrl: string;
  ollamaChatModel: string;
  ollamaResearchModel: string;
  ollamaExperimentModel: string;
  ollamaVisionModel: string;
  networkPolicy: "blocked" | "declared" | "required";
  networkPurpose: "" | "logging" | "artifact_upload" | "model_download" | "dataset_fetch" | "remote_inference" | "other";
}

export interface WebConfigOptions {
  codexModels: string[];
  codexReasoningByModel: Record<string, string[]>;
  openAiModels: string[];
  openAiReasoningByModel: Record<string, string[]>;
  ollamaChatModels: string[];
  ollamaResearchModels: string[];
  ollamaExperimentModels: string[];
  ollamaVisionModels: string[];
}

export interface ArtifactEntry {
  path: string;
  kind: "directory" | "text" | "json" | "image" | "pdf" | "download";
  size: number;
  modifiedAt: string;
  previewable: boolean;
}

export interface CheckpointEntry {
  seq: number;
  node: NodeId;
  phase: string;
  createdAt: string;
  reason?: string;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  status?: "ok" | "warn" | "warning" | "fail";
  detail: string;
  check?: string;
  message?: string;
}

export type HarnessIssueKind =
  | "missing_artifact"
  | "malformed_issue"
  | "broken_evidence_link"
  | "status_artifact_mismatch"
  | "paper_result_mismatch";

export type HarnessValidationScope = "issue_log" | "workspace" | "test_records";

export interface HarnessValidationFinding {
  code: string;
  message: string;
  filePath?: string;
  runId?: string;
  kind: HarnessIssueKind;
  remediation: string;
  scope: HarnessValidationScope;
  runStorePath?: string;
}

export interface HarnessValidationTargetSummary {
  scope: "workspace" | "test_records";
  runStoreCount: number;
  runCount: number;
  findingCount: number;
}

export interface HarnessValidationReport {
  generatedAt: string;
  workspaceRoot: string;
  issueLogPath: string;
  issueEntryCount: number;
  runStoresChecked: number;
  runsChecked: number;
  findings: HarnessValidationFinding[];
  countsByKind: Record<HarnessIssueKind, number>;
  targets: HarnessValidationTargetSummary[];
  status: "ok" | "fail";
}

export interface DoctorResponse {
  configured: boolean;
  status: "ok" | "warn" | "fail";
  checks: DoctorCheck[];
  harness?: HarnessValidationReport;
  readiness?: {
    blocked: boolean;
    llmMode?: "codex_chatgpt_only" | "openai_api" | "ollama";
    pdfAnalysisMode?: "codex_text_image_hybrid" | "responses_api_pdf" | "ollama_vision";
    approvalMode: "manual" | "minimal" | "hybrid";
    executionApprovalMode: "manual" | "risk_ack" | "full_auto";
    dependencyMode: "local" | "docker" | "remote_gpu" | "plan_only";
    sessionMode: "fresh" | "existing";
    candidateIsolation?: "attempt_snapshot_restore" | "attempt_worktree";
    networkPolicy?: "blocked" | "declared" | "required";
    networkPurpose?: "logging" | "artifact_upload" | "model_download" | "dataset_fetch" | "remote_inference" | "other";
    networkDeclarationPresent: boolean;
    networkApprovalSatisfied: boolean;
    warningChecks: string[];
    failedChecks: string[];
  };
}

export interface RepositoryKnowledgeSectionEntry {
  name: string;
  generated_files: string[];
  updated_at: string;
}

export interface RepositoryKnowledgeEntry {
  run_id: string;
  title: string;
  topic: string;
  topic_slug?: string;
  objective_metric: string;
  latest_summary?: string;
  latest_published_section: string;
  updated_at: string;
  public_output_root: string;
  public_manifest: string;
  knowledge_note: string;
  entry_kind?: "published_outputs" | "completed_run";
  final_node?: string;
  final_status?: string;
  paper_ready?: boolean;
  review_decision?: string;
  key_metrics?: string[];
  research_question?: string;
  analysis_summary?: string;
  manuscript_type?: string;
  sections: RepositoryKnowledgeSectionEntry[];
}

export interface KnowledgeResponse {
  version: 1;
  updated_at: string;
  entries: RepositoryKnowledgeEntry[];
}

export interface KnowledgeFileResponse {
  path: string;
  content: string;
}

export interface RunLiteratureIndex {
  version: 1;
  run_id: string;
  updated_at: string;
  corpus: {
    paper_count: number;
    papers_with_pdf: number;
    missing_pdf_count: number;
    papers_with_bibtex: number;
    enriched_bibtex_count: number;
    top_venues: string[];
    year_range?: {
      min: number;
      max: number;
    };
  };
  citations: {
    total: number;
    average: number;
    top_paper?: {
      title: string;
      citation_count: number;
    };
  };
  enrichment: {
    bibtex_mode?: string;
    pdf_recovered: number;
    bibtex_enriched: number;
    status?: string;
    last_error?: string;
  };
  analysis: {
    summary_count: number;
    evidence_count: number;
    covered_paper_count: number;
    full_text_summary_count: number;
    abstract_summary_count: number;
  };
  artifacts: {
    literature_index_path: string;
    corpus_path: string;
    bibtex_path: string;
    collect_result_path: string;
    summaries_path: string;
    evidence_path: string;
  };
  warnings: string[];
}

export interface LiteratureResponse {
  literature: RunLiteratureIndex;
}

export interface BootstrapResponse {
  configured: boolean;
  execution_profile?: ExecutionProfile;
  setupDefaults: {
    projectName: string;
    defaultTopic: string;
    defaultConstraints: string[];
    defaultObjectiveMetric: string;
  };
  session: WebSessionState;
  runs: RunRecord[];
  jobs?: RunJobsSnapshot;
  jobQueue?: RunQueueSnapshot;
  activeRunId?: string;
  configSummary?: ConfigSummary;
  configForm?: WebConfigFormData;
  configOptions?: WebConfigOptions;
}
