import { AppConfig } from "../../types.js";
import { EventStream } from "../events.js";
import { LLMClient } from "../llm/client.js";
import { RunStore } from "../runs/runStore.js";
import { AgentComputerInterface } from "../../tools/aci.js";
import { SemanticScholarClient } from "../../tools/semanticScholar.js";
import { GraphNodeHandler, GraphNodeResult } from "../stateGraph/types.js";
import { CodexCliClient } from "../../integrations/codex/codexCliClient.js";
import { ResponsesPdfAnalysisClient } from "../../integrations/openai/responsesPdfAnalysisClient.js";

export interface NodeExecutionDeps {
  config: AppConfig;
  runStore: RunStore;
  eventStream: EventStream;
  llm: LLMClient;
  pdfTextLlm: LLMClient;
  codex: CodexCliClient;
  aci: AgentComputerInterface;
  semanticScholar: SemanticScholarClient;
  responsesPdfAnalysis: ResponsesPdfAnalysisClient;
}

export type NodeFactory = (deps: NodeExecutionDeps) => GraphNodeHandler;

export interface NodeExecutionOutput extends GraphNodeResult {
  artifacts?: string[];
}
