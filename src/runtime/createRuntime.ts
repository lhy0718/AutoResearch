import {
  AppPaths,
  configExists,
  ensureScaffold,
  hydrateProcessEnvFromWorkspace,
  hasSemanticScholarApiKey,
  loadConfig,
  resolveOpenAiApiKey,
  resolveSemanticScholarApiKey,
  resolveAppPaths,
  runSetupWizard,
  saveConfig
} from "../config.js";
import { AppConfig, ExecutionProfile, NodeOptionPackageName } from "../types.js";
import { RunStore } from "../core/runs/runStore.js";
import { TitleGenerator } from "../core/runs/titleGenerator.js";
import { CodexNativeClient } from "../integrations/codex/codexCliClient.js";
import { resolveCodexOAuthCredentials } from "../integrations/codex/oauthAuth.js";
import { EventStream, PersistedEventStream } from "../core/events.js";
import {
  CodexOAuthResponsesLLMClient,
  OllamaLLMClient,
  OpenAiResponsesLLMClient,
  RoutedLLMClient
} from "../core/llm/client.js";
import { LocalAciAdapter } from "../tools/aciLocalAdapter.js";
import { SemanticScholarClient } from "../tools/semanticScholar.js";
import { OpenAlexClient } from "../tools/openAlex.js";
import { CrossrefClient } from "../tools/crossref.js";
import { ArxivClient } from "../tools/arxiv.js";
import { DefaultNodeRegistry } from "../core/stateGraph/nodeRegistry.js";
import { CheckpointStore } from "../core/stateGraph/checkpointStore.js";
import { StateGraphRuntime } from "../core/stateGraph/runtime.js";
import { AgentOrchestrator } from "../core/agents/agentOrchestrator.js";
import { ResponsesPdfAnalysisClient } from "../integrations/openai/responsesPdfAnalysisClient.js";
import { OpenAiResponsesTextClient } from "../integrations/openai/responsesTextClient.js";
import { CodexOAuthResponsesTextClient } from "../integrations/codex/oauthResponsesTextClient.js";
import { OllamaClient } from "../integrations/ollama/ollamaClient.js";
import { OllamaPdfAnalysisClient } from "../integrations/ollama/ollamaPdfAnalysisClient.js";
import { DEFAULT_OLLAMA_BASE_URL } from "../integrations/ollama/modelCatalog.js";
import { recoverCollectEnrichmentJobs } from "../core/nodes/collectPapers.js";
import { detectExecutionProfile } from "./executionProfile.js";
import { resolveNodeOptionsForPackage } from "../core/stateGraph/defaults.js";
import { loadExplorationConfig } from "../core/exploration/explorationConfig.js";
import { assertNotProjectRootWorkspace } from "../workspaceGuard.js";

export interface AutoLabOSRuntime {
  paths: AppPaths;
  config: AppConfig;
  executionProfile: ExecutionProfile;
  runStore: RunStore;
  titleGenerator: TitleGenerator;
  codex: CodexNativeClient;
  openAiTextClient: OpenAiResponsesTextClient;
  eventStream: EventStream;
  checkpointStore: CheckpointStore;
  orchestrator: AgentOrchestrator;
  semanticScholarApiKeyConfigured: boolean;
  saveConfig: (nextConfig: AppConfig) => Promise<void>;
}

export interface RuntimeBootstrap {
  configured: boolean;
  firstRunSetup: boolean;
  paths: AppPaths;
  executionProfile?: ExecutionProfile;
  nodeOptionPackageName?: NodeOptionPackageName;
  config?: AppConfig;
  runtime?: AutoLabOSRuntime;
}

export async function bootstrapAutoLabOSRuntime(opts?: {
  cwd?: string;
  allowInteractiveSetup?: boolean;
  nodeOptionPackageName?: NodeOptionPackageName;
}): Promise<RuntimeBootstrap> {
  const cwd = opts?.cwd || process.cwd();
  assertNotProjectRootWorkspace(cwd);
  await hydrateProcessEnvFromWorkspace(cwd);
  const paths = resolveAppPaths(cwd);
  const executionProfile = await detectExecutionProfile();
  const firstRunSetup = !(await configExists(paths));

  if (firstRunSetup && !opts?.allowInteractiveSetup) {
    return {
      configured: false,
      firstRunSetup,
      paths,
      executionProfile
    };
  }

  const config = firstRunSetup ? await runSetupWizard(paths) : await loadConfig(paths);
  await ensureScaffold(paths);
  const runtimeConfig: AppConfig = {
    ...config,
    runtime: {
      ...(config.runtime || {}),
      execution_profile: executionProfile,
      exploration_enabled: config.exploration?.enabled ?? loadExplorationConfig().enabled,
      node_option_package: opts?.nodeOptionPackageName,
      resolved_node_options: resolveNodeOptionsForPackage(opts?.nodeOptionPackageName)
    }
  };

  return {
    configured: true,
    firstRunSetup,
    paths,
    executionProfile,
    nodeOptionPackageName: opts?.nodeOptionPackageName,
    config: runtimeConfig,
    runtime: await createAutoLabOSRuntime(
      paths,
      runtimeConfig,
      executionProfile,
      opts?.nodeOptionPackageName
    )
  };
}

export async function createAutoLabOSRuntime(
  paths: AppPaths,
  config: AppConfig,
  executionProfile?: ExecutionProfile,
  nodeOptionPackageName?: NodeOptionPackageName
): Promise<AutoLabOSRuntime> {
  await hydrateProcessEnvFromWorkspace(paths.cwd);
  const resolvedExecutionProfile = executionProfile || (await detectExecutionProfile());
  const runStore = new RunStore(paths, { nodeOptionPackageName });
  const codex = new CodexNativeClient(paths.cwd, {
    model: config.providers.codex.model || "gpt-5.4",
    reasoningEffort: config.providers.codex.reasoning_effort || "xhigh",
    fastMode: config.providers.codex.fast_mode === true
  });
  const openAiText = new OpenAiResponsesTextClient(() => resolveOpenAiApiKey(paths.cwd));
  const codexOAuthText = new CodexOAuthResponsesTextClient(() => resolveCodexOAuthCredentials(), {
    model: config.providers.codex.model,
    reasoningEffort: config.providers.codex.reasoning_effort
  });
  const codexOAuthTaskLlm = new CodexOAuthResponsesLLMClient(codexOAuthText, {
    model: config.providers.codex.model,
    reasoningEffort: config.providers.codex.reasoning_effort
  });
  const codexOAuthExperimentLlm = new CodexOAuthResponsesLLMClient(codexOAuthText, {
    model: config.providers.codex.experiment_model || config.providers.codex.model,
    reasoningEffort:
      config.providers.codex.experiment_reasoning_effort || config.providers.codex.reasoning_effort
  });
  const codexOAuthChatLlm = new CodexOAuthResponsesLLMClient(codexOAuthText, {
    model: config.providers.codex.chat_model || config.providers.codex.model,
    reasoningEffort:
      config.providers.codex.chat_reasoning_effort ||
      config.providers.codex.command_reasoning_effort ||
      config.providers.codex.reasoning_effort
  });
  const openAiTaskLlm = new OpenAiResponsesLLMClient(openAiText, {
    model: config.providers.openai.model,
    reasoningEffort: config.providers.openai.reasoning_effort
  });
  const openAiExperimentLlm = new OpenAiResponsesLLMClient(openAiText, {
    model: config.providers.openai.experiment_model || config.providers.openai.model,
    reasoningEffort:
      config.providers.openai.experiment_reasoning_effort || config.providers.openai.reasoning_effort,
    background: true
  });
  const openAiPdfLlm = new OpenAiResponsesLLMClient(openAiText, {
    model: config.providers.openai.model,
    reasoningEffort: config.providers.openai.reasoning_effort
  });

  // Ollama clients
  const ollamaConfig = config.providers.ollama;
  const ollamaBaseUrl = ollamaConfig?.base_url || DEFAULT_OLLAMA_BASE_URL;
  const ollamaHttpClient = new OllamaClient(ollamaBaseUrl);
  const ollamaTaskLlm = new OllamaLLMClient(ollamaHttpClient, {
    model: ollamaConfig?.research_model || "qwen3.5:35b-a3b"
  });
  const ollamaChatLlm = new OllamaLLMClient(ollamaHttpClient, {
    model: ollamaConfig?.chat_model || "qwen3.5:27b"
  });
  const ollamaExperimentLlm = new OllamaLLMClient(ollamaHttpClient, {
    model: ollamaConfig?.experiment_model || ollamaConfig?.research_model || "qwen3.5:35b-a3b"
  });
  const ollamaPdfLlm = new OllamaLLMClient(ollamaHttpClient, {
    model: ollamaConfig?.vision_model || "qwen3.5:35b-a3b"
  });
  const ollamaPdfAnalysis = new OllamaPdfAnalysisClient(
    ollamaHttpClient,
    ollamaConfig?.vision_model || "qwen3.5:35b-a3b"
  );

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
    if (config.providers.llm_mode === "ollama") {
      return {
        runForText: async ({ prompt, systemPrompt, abortSignal }) =>
          (await ollamaChatLlm.complete(prompt, { systemPrompt, abortSignal })).text
      };
    }
    return {
      runForText: async ({ prompt, sandboxMode, approvalPolicy, systemPrompt, abortSignal }) =>
        (
          await codexOAuthText.complete({
            prompt,
            systemPrompt,
            abortSignal,
            model: config.providers.codex.chat_model || config.providers.codex.model,
            reasoningEffort:
              config.providers.codex.chat_reasoning_effort ||
              config.providers.codex.command_reasoning_effort
          })
        ).text
    };
  });

  const eventStream = new PersistedEventStream(paths.runsDir);
  const llm = new RoutedLLMClient(() => {
    if (config.providers.llm_mode === "openai_api") return openAiTaskLlm;
    if (config.providers.llm_mode === "ollama") return ollamaTaskLlm;
    return codexOAuthTaskLlm;
  });
  const pdfTextLlm = new RoutedLLMClient(() => {
    if (config.providers.llm_mode === "openai_api") return openAiPdfLlm;
    if (config.providers.llm_mode === "ollama") return ollamaPdfLlm;
    return codexOAuthTaskLlm;
  });
  const experimentLlm = new RoutedLLMClient(() => {
    if (config.providers.llm_mode === "openai_api") return openAiExperimentLlm;
    if (config.providers.llm_mode === "ollama") return ollamaExperimentLlm;
    return codexOAuthExperimentLlm;
  });
  const aci = new LocalAciAdapter({
    allowNetwork: config.experiments.allow_network === true
  });
  const semanticScholarApiKey = await resolveSemanticScholarApiKey(paths.cwd);
  const semanticScholar = new SemanticScholarClient({
    apiKey: semanticScholarApiKey,
    perSecondLimit: config.papers.per_second_limit,
    maxRetries: 3
  });
  const openAlex = new OpenAlexClient();
  const crossref = new CrossrefClient();
  const arxiv = new ArxivClient();
  const responsesPdfAnalysis = new ResponsesPdfAnalysisClient(() => resolveOpenAiApiKey(paths.cwd));

  const nodeRegistry = new DefaultNodeRegistry({
    config,
    executionProfile: resolvedExecutionProfile,
    runStore,
    eventStream,
    llm,
    experimentLlm,
    pdfTextLlm,
    codex,
    aci,
    semanticScholar,
    openAlex,
    crossref,
    arxiv,
    responsesPdfAnalysis,
    ollamaPdfAnalysis
  });

  const checkpointStore = new CheckpointStore(paths);
  const runtime = new StateGraphRuntime(runStore, nodeRegistry, checkpointStore, eventStream, {
    approvalMode: config.workflow?.approval_mode,
    budgetGuardUsd: config.workflow?.budget_guard_usd
  });
  const orchestrator = new AgentOrchestrator(runStore, runtime, checkpointStore);
  await recoverCollectEnrichmentJobs({
    runStore,
    eventStream
  });

  return {
    paths,
    config,
    executionProfile: resolvedExecutionProfile,
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
