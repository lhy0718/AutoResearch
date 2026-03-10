export type NodeId =
  | "collect_papers"
  | "analyze_papers"
  | "generate_hypotheses"
  | "design_experiments"
  | "implement_experiments"
  | "run_experiments"
  | "analyze_results"
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
    budget: {
      toolCallsUsed: number;
      wallClockMsUsed: number;
      usdUsed?: number;
      policy: {
        maxToolCalls: number;
        maxWallClockMinutes: number;
        maxUsd: number;
      };
    };
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
  llmMode: "codex_chatgpt_only" | "openai_api";
  pdfMode: "codex_text_image_hybrid" | "responses_api_pdf";
  taskModel: string;
  chatModel: string;
  experimentModel: string;
  pdfModel: string;
  taskReasoning: string;
  chatReasoning: string;
  experimentReasoning: string;
  pdfReasoning: string;
}

export interface WebConfigFormData {
  projectName: string;
  defaultTopic: string;
  defaultConstraints: string;
  defaultObjectiveMetric: string;
  llmMode: "codex_chatgpt_only" | "openai_api";
  pdfAnalysisMode: "codex_text_image_hybrid" | "responses_api_pdf";
  codexChatModelChoice: string;
  codexChatReasoningEffort: string;
  codexTaskModelChoice: string;
  codexTaskReasoningEffort: string;
  codexExperimentModelChoice: string;
  codexExperimentReasoningEffort: string;
  codexPdfModelChoice: string;
  codexPdfReasoningEffort: string;
  openAiChatModel: string;
  openAiChatReasoningEffort: string;
  openAiTaskModel: string;
  openAiReasoningEffort: string;
  openAiExperimentModel: string;
  openAiExperimentReasoningEffort: string;
  openAiPdfModel: string;
  openAiPdfReasoningEffort: string;
  responsesPdfModel: string;
  responsesPdfReasoningEffort: string;
}

export interface WebConfigOptions {
  codexModels: string[];
  codexReasoningByModel: Record<string, string[]>;
  openAiModels: string[];
  openAiReasoningByModel: Record<string, string[]>;
  responsesPdfModels: string[];
  responsesPdfReasoning: string[];
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
