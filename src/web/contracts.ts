import { DoctorCheck, PendingPlan, RunRecord, WebSessionState } from "../types.js";

export interface ConfigSummary {
  projectName: string;
  workflowMode: "agent_approval";
  approvalMode: "manual" | "minimal";
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

export interface DoctorResponse {
  configured: boolean;
  checks: DoctorCheck[];
}

export interface SessionInputResponse {
  session: WebSessionState;
  activeRunId?: string;
  pendingPlan?: PendingPlan;
}
