import {
  DoctorCheck,
  ExecutionProfile,
  PendingPlan,
  RunJobsSnapshot,
  RunQueueSnapshot,
  RunRecord,
  WebSessionState
} from "../types.js";
import type { RunLiteratureIndex } from "../core/literatureIndex.js";
import type { HarnessValidationReport } from "../core/validation/harnessValidationService.js";
import type { RepositoryKnowledgeEntry, RepositoryKnowledgeIndex } from "../core/repositoryKnowledge.js";
import type { EvalHarnessHistoryEntry } from "../core/evaluation/evalHarness.js";
import type { ExplorationStatusSnapshot } from "../core/exploration/status.js";

export interface ConfigSummary {
  projectName: string;
  workflowMode: "agent_approval";
  approvalMode: "manual" | "minimal" | "hybrid";
  executionApprovalMode?: "manual" | "risk_ack" | "full_auto";
  llmMode: "codex" | "codex_chatgpt_only" | "openai_api" | "ollama";
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
  llmMode: "codex" | "codex_chatgpt_only" | "openai_api" | "ollama";
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

export interface JobsResponse extends RunQueueSnapshot {}

export interface DoctorResponse {
  configured: boolean;
  status: "ok" | "warn" | "fail";
  checks: DoctorCheck[];
  harness?: HarnessValidationReport;
  readiness?: {
    blocked: boolean;
    llmMode?: "codex" | "codex_chatgpt_only" | "openai_api" | "ollama";
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

export interface KnowledgeResponse extends RepositoryKnowledgeIndex {
  entries: RepositoryKnowledgeEntry[];
}

export interface KnowledgeFileResponse {
  path: string;
  content: string;
}

export interface LiteratureResponse {
  literature: RunLiteratureIndex;
}

export interface SessionInputResponse {
  session: WebSessionState;
  activeRunId?: string;
  pendingPlan?: PendingPlan;
}

export type EvalHarnessHistoryResponse = EvalHarnessHistoryEntry[];

export type ExplorationStatusResponse = ExplorationStatusSnapshot;
