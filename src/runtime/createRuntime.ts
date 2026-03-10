import {
  AppPaths,
  configExists,
  ensureScaffold,
  hasSemanticScholarApiKey,
  loadConfig,
  resolveOpenAiApiKey,
  resolveSemanticScholarApiKey,
  resolveAppPaths,
  runSetupWizard,
  saveConfig
} from "../config.js";
import { AppConfig } from "../types.js";
import { RunStore } from "../core/runs/runStore.js";
import { TitleGenerator } from "../core/runs/titleGenerator.js";
import { CodexCliClient } from "../integrations/codex/codexCliClient.js";
import { InMemoryEventStream } from "../core/events.js";
import { CodexLLMClient, OpenAiResponsesLLMClient, RoutedLLMClient } from "../core/llm/client.js";
import { LocalAciAdapter } from "../tools/aciLocalAdapter.js";
import { SemanticScholarClient } from "../tools/semanticScholar.js";
import { DefaultNodeRegistry } from "../core/stateGraph/nodeRegistry.js";
import { CheckpointStore } from "../core/stateGraph/checkpointStore.js";
import { StateGraphRuntime } from "../core/stateGraph/runtime.js";
import { AgentOrchestrator } from "../core/agents/agentOrchestrator.js";
import { ResponsesPdfAnalysisClient } from "../integrations/openai/responsesPdfAnalysisClient.js";
import { OpenAiResponsesTextClient } from "../integrations/openai/responsesTextClient.js";

export interface AutoresearchRuntime {
  paths: AppPaths;
  config: AppConfig;
  runStore: RunStore;
  titleGenerator: TitleGenerator;
  codex: CodexCliClient;
  openAiTextClient: OpenAiResponsesTextClient;
  eventStream: InMemoryEventStream;
  checkpointStore: CheckpointStore;
  orchestrator: AgentOrchestrator;
  semanticScholarApiKeyConfigured: boolean;
  saveConfig: (nextConfig: AppConfig) => Promise<void>;
}

export interface RuntimeBootstrap {
  configured: boolean;
  firstRunSetup: boolean;
  paths: AppPaths;
  config?: AppConfig;
  runtime?: AutoresearchRuntime;
}

export async function bootstrapAutoresearchRuntime(opts?: {
  cwd?: string;
  allowInteractiveSetup?: boolean;
}): Promise<RuntimeBootstrap> {
  const paths = resolveAppPaths(opts?.cwd || process.cwd());
  const firstRunSetup = !(await configExists(paths));

  if (firstRunSetup && !opts?.allowInteractiveSetup) {
    return {
      configured: false,
      firstRunSetup,
      paths
    };
  }

  const config = firstRunSetup ? await runSetupWizard(paths) : await loadConfig(paths);
  await ensureScaffold(paths);

  return {
    configured: true,
    firstRunSetup,
    paths,
    config,
    runtime: await createAutoresearchRuntime(paths, config)
  };
}

export async function createAutoresearchRuntime(
  paths: AppPaths,
  config: AppConfig
): Promise<AutoresearchRuntime> {
  const runStore = new RunStore(paths);
  const codex = new CodexCliClient(paths.cwd, {
    model: config.providers.codex.model || "gpt-5.3-codex",
    reasoningEffort: config.providers.codex.reasoning_effort || "xhigh",
    fastMode: config.providers.codex.fast_mode === true
  });
  const openAiText = new OpenAiResponsesTextClient(() => resolveOpenAiApiKey(paths.cwd));
  const codexTaskLlm = new CodexLLMClient(codex, {
    model: config.providers.codex.model,
    reasoningEffort: config.providers.codex.reasoning_effort,
    fastMode: config.providers.codex.fast_mode
  });
  const codexPdfLlm = new CodexLLMClient(codex, {
    model: config.providers.codex.pdf_model || config.providers.codex.model,
    reasoningEffort: config.providers.codex.pdf_reasoning_effort || config.providers.codex.reasoning_effort,
    fastMode: config.providers.codex.pdf_fast_mode
  });
  const openAiTaskLlm = new OpenAiResponsesLLMClient(openAiText, {
    model: config.providers.openai.model,
    reasoningEffort: config.providers.openai.reasoning_effort
  });
  const openAiPdfLlm = new OpenAiResponsesLLMClient(openAiText, {
    model: config.providers.openai.pdf_model || config.providers.openai.model,
    reasoningEffort: config.providers.openai.pdf_reasoning_effort || config.providers.openai.reasoning_effort
  });
  const titleGenerator = new TitleGenerator(() => {
    if (config.providers.llm_mode === "openai_api") {
      return {
        runForText: ({ prompt, systemPrompt, abortSignal }) =>
          openAiText.runForText({
            prompt,
            systemPrompt,
            abortSignal,
            model: config.providers.openai.chat_model || config.providers.openai.model,
            reasoningEffort:
              config.providers.openai.chat_reasoning_effort ||
              config.providers.openai.command_reasoning_effort
          })
      };
    }
    return {
      runForText: async ({ prompt, sandboxMode, approvalPolicy, systemPrompt, abortSignal }) =>
        (
          await codex.runTurnStream({
            prompt,
            sandboxMode: (sandboxMode || "read-only") as
              | "read-only"
              | "workspace-write"
              | "danger-full-access",
            approvalPolicy: (approvalPolicy || "never") as
              | "never"
              | "on-request"
              | "on-failure"
              | "untrusted",
            systemPrompt,
            abortSignal,
            model: config.providers.codex.chat_model || config.providers.codex.model,
            reasoningEffort:
              (config.providers.codex.chat_reasoning_effort ||
                config.providers.codex.command_reasoning_effort) as never,
            fastMode: config.providers.codex.chat_fast_mode
          })
        ).finalText
    };
  });

  const eventStream = new InMemoryEventStream();
  const llm = new RoutedLLMClient(() =>
    config.providers.llm_mode === "openai_api" ? openAiTaskLlm : codexTaskLlm
  );
  const pdfTextLlm = new RoutedLLMClient(() =>
    config.providers.llm_mode === "openai_api" ? openAiPdfLlm : codexPdfLlm
  );
  const aci = new LocalAciAdapter();
  const semanticScholarApiKey = await resolveSemanticScholarApiKey(paths.cwd);
  const semanticScholar = new SemanticScholarClient({
    apiKey: semanticScholarApiKey,
    perSecondLimit: config.papers.per_second_limit,
    maxRetries: 3
  });
  const responsesPdfAnalysis = new ResponsesPdfAnalysisClient(() => resolveOpenAiApiKey(paths.cwd));

  const nodeRegistry = new DefaultNodeRegistry({
    config,
    runStore,
    eventStream,
    llm,
    pdfTextLlm,
    codex,
    aci,
    semanticScholar,
    responsesPdfAnalysis
  });

  const checkpointStore = new CheckpointStore(paths);
  const runtime = new StateGraphRuntime(runStore, nodeRegistry, checkpointStore, eventStream);
  const orchestrator = new AgentOrchestrator(runStore, runtime, checkpointStore);

  return {
    paths,
    config,
    runStore,
    titleGenerator,
    codex,
    openAiTextClient: openAiText,
    eventStream,
    checkpointStore,
    orchestrator,
    semanticScholarApiKeyConfigured: await hasSemanticScholarApiKey(paths.cwd),
    saveConfig: async (nextConfig) => {
      await saveConfig(paths, nextConfig);
    }
  };
}
