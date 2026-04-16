import { AppConfig, ExecutionProfile } from "../../types.js";
import { EventStream } from "../events.js";
import { LLMClient } from "../llm/client.js";
import { RunStore } from "../runs/runStore.js";
import { AgentComputerInterface } from "../../tools/aci.js";
import { SemanticScholarClient } from "../../tools/semanticScholar.js";
import { OpenAlexClient } from "../../tools/openAlex.js";
import { CrossrefClient } from "../../tools/crossref.js";
import { ArxivClient } from "../../tools/arxiv.js";
import { GraphNodeHandler, GraphNodeResult } from "../stateGraph/types.js";
import { CodexNativeClient } from "../../integrations/codex/codexCliClient.js";
import { ResponsesPdfAnalysisClient } from "../../integrations/openai/responsesPdfAnalysisClient.js";
import { OllamaPdfAnalysisClient } from "../../integrations/ollama/ollamaPdfAnalysisClient.js";

export interface NodeExecutionDeps {
  config: AppConfig;
  executionProfile?: ExecutionProfile;
  runStore: RunStore;
  eventStream: EventStream;
  llm: LLMClient;
  experimentLlm: LLMClient;
  pdfTextLlm: LLMClient;
  codex: CodexNativeClient;
  aci: AgentComputerInterface;
  semanticScholar: SemanticScholarClient;
  openAlex?: OpenAlexClient;
  crossref?: CrossrefClient;
  arxiv?: ArxivClient;
  responsesPdfAnalysis: ResponsesPdfAnalysisClient;
  ollamaPdfAnalysis?: OllamaPdfAnalysisClient;
}

export type NodeFactory = (deps: NodeExecutionDeps) => GraphNodeHandler;

export interface NodeExecutionOutput extends GraphNodeResult {
  artifacts?: string[];
}
