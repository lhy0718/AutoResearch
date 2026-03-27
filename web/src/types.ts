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

export interface PendingPlan {
  sourceInput: string;
  displayCommands: string[];
  stepIndex: number;
  totalSteps: number;
}

export interface RunInsightCard {
  title: string;
  lines: string[];
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
  approvalMode: "manual" | "minimal";
  llmMode: "codex_chatgpt_only" | "openai_api" | "ollama";
  pdfMode: "codex_text_image_hybrid" | "responses_api_pdf" | "ollama_vision";
  researchBackendModel: string;
  chatModel: string;
  experimentModel: string;
  researchBackendReasoning: string | undefined;
  chatReasoning: string | undefined;
  experimentReasoning: string | undefined;
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
  detail: string;
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
  checks: DoctorCheck[];
  harness?: HarnessValidationReport;
  readiness?: {
    blocked: boolean;
    approvalMode: "manual" | "minimal";
    executionApprovalMode: "manual" | "risk_ack" | "full_auto";
    dependencyMode: "local" | "docker" | "remote_gpu" | "plan_only";
    sessionMode: "fresh" | "existing";
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
  objective_metric: string;
  latest_summary?: string;
  latest_published_section: string;
  updated_at: string;
  public_output_root: string;
  public_manifest: string;
  knowledge_note: string;
  research_question?: string;
  analysis_summary?: string;
  manuscript_type?: string;
  sections: RepositoryKnowledgeSectionEntry[];
}

export interface KnowledgeResponse {
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
  setupDefaults: {
    projectName: string;
    defaultTopic: string;
    defaultConstraints: string[];
    defaultObjectiveMetric: string;
  };
  session: WebSessionState;
  runs: RunRecord[];
  activeRunId?: string;
  configSummary?: ConfigSummary;
  configForm?: WebConfigFormData;
  configOptions?: WebConfigOptions;
}
