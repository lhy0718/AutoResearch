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

export interface PaperProfileConfig {
  venue_style: string;
  /** Manuscript rhetoric/style target (e.g. "acl", "neurips", "generic_cs_paper"). */
  target_venue_style?: string;
  main_page_limit: number;
  references_counted: boolean;
  appendix_allowed: boolean;
  appendix_format: "double_column" | "single_column";
  prefer_appendix_for: string[];
  estimated_words_per_page?: number;
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
    llm_mode: "codex_chatgpt_only" | "openai_api";
    codex: {
      model: string;
      chat_model?: string;
      experiment_model?: string;
      pdf_model?: string;
      reasoning_effort: "minimal" | "low" | "medium" | "high" | "xhigh";
      chat_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      experiment_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      pdf_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      command_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      fast_mode: boolean;
      chat_fast_mode?: boolean;
      experiment_fast_mode?: boolean;
      pdf_fast_mode?: boolean;
      auth_required: true;
    };
    openai: {
      model: string;
      chat_model?: string;
      experiment_model?: string;
      pdf_model?: string;
      reasoning_effort: "minimal" | "low" | "medium" | "high" | "xhigh";
      chat_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      experiment_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      pdf_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      command_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      api_key_required: true;
    };
  };
  analysis: {
    pdf_mode: "codex_text_image_hybrid" | "responses_api_pdf";
    responses_model: string;
    responses_reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
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
  };
  experiments: {
    runner: "local_python";
    timeout_sec: number;
    allow_network: boolean;
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

export interface ArtifactEntry {
  path: string;
  kind: "directory" | "text" | "json" | "image" | "pdf" | "download";
  size: number;
  modifiedAt: string;
  previewable: boolean;
}
