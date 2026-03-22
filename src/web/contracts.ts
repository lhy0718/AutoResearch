import { DoctorCheck, PendingPlan, RunRecord, WebSessionState } from "../types.js";
import type { HarnessValidationReport } from "../core/validation/harnessValidationService.js";

export interface ConfigSummary {
  projectName: string;
  workflowMode: "agent_approval";
  approvalMode: "manual" | "minimal";
  llmMode: "codex_chatgpt_only" | "openai_api" | "ollama";
  pdfMode: "codex_text_image_hybrid" | "responses_api_pdf" | "ollama_vision";
  taskModel: string;
  chatModel: string;
  experimentModel: string;
  taskReasoning: string | undefined;
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
  codexTaskModelChoice: string;
  codexTaskReasoningEffort: string;
  codexExperimentModelChoice: string;
  codexExperimentReasoningEffort: string;
  openAiChatModel: string;
  openAiChatReasoningEffort: string;
  openAiTaskModel: string;
  openAiReasoningEffort: string;
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
  harness?: HarnessValidationReport;
}

export interface SessionInputResponse {
  session: WebSessionState;
  activeRunId?: string;
  pendingPlan?: PendingPlan;
}
