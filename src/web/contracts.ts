import { DoctorCheck, PendingPlan, RunRecord, WebSessionState } from "../types.js";

export interface ConfigSummary {
  projectName: string;
  llmMode: "codex_chatgpt_only" | "openai_api";
  pdfMode: "codex_text_extract" | "responses_api_pdf";
  taskModel: string;
  chatModel: string;
  pdfModel: string;
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
