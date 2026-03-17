import path from "node:path";
import { promises as fs } from "node:fs";
import { stdout as output } from "node:process";
import YAML from "yaml";

import { AppConfig, RunsFile, WorkflowApprovalMode } from "./types.js";
import {
  buildCodexModelSelectionChoices,
  DEFAULT_CODEX_MODEL,
  getCodexModelSelectionDescription,
  getCurrentCodexModelSelectionValue,
  getReasoningEffortChoicesForModel,
  normalizeReasoningEffortForModel,
  RECOMMENDED_CODEX_MODEL,
  resolveCodexModelSelection
} from "./integrations/codex/modelCatalog.js";
import { CodexCliClient } from "./integrations/codex/codexCliClient.js";
import {
  DEFAULT_RESPONSES_PDF_MODEL,
  RESPONSES_PDF_MODEL_OPTIONS,
  buildResponsesPdfModelChoices,
  normalizeResponsesPdfModel
} from "./integrations/openai/pdfModelCatalog.js";
import {
  DEFAULT_OPENAI_RESPONSES_MODEL,
  DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT,
  OPENAI_RESPONSES_MODEL_OPTIONS,
  buildOpenAiResponsesModelChoices,
  buildOpenAiResponsesReasoningChoices,
  getOpenAiResponsesReasoningOptions,
  normalizeOpenAiResponsesModel,
  normalizeOpenAiResponsesReasoningEffort,
  supportsOpenAiResponsesReasoning
} from "./integrations/openai/modelCatalog.js";
import { ensureDir, fileExists, writeJsonFile } from "./utils/fs.js";
import { askChoice, askLine, askRequiredLine, PromptReader } from "./utils/prompt.js";
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_CHAT_MODEL,
  DEFAULT_OLLAMA_RESEARCH_MODEL,
  DEFAULT_OLLAMA_EXPERIMENT_MODEL,
  DEFAULT_OLLAMA_VISION_MODEL,
  OLLAMA_CHAT_MODEL_OPTIONS,
  OLLAMA_RESEARCH_MODEL_OPTIONS,
  OLLAMA_EXPERIMENT_MODEL_OPTIONS,
  OLLAMA_VISION_MODEL_OPTIONS,
  buildOllamaChatModelChoices,
  buildOllamaResearchModelChoices,
  buildOllamaExperimentModelChoices,
  buildOllamaVisionModelChoices
} from "./integrations/ollama/modelCatalog.js";

export const DEFAULT_PRIMARY_LLM_MODE = "codex_chatgpt_only" as const;
export const DEFAULT_PDF_ANALYSIS_MODE = "codex_text_image_hybrid" as const;
export const DEFAULT_CODEX_CHAT_SETUP_MODEL = "gpt-5.3-codex-spark" as const;
export const DEFAULT_CODEX_CHAT_SETUP_REASONING_EFFORT = "medium" as const;
export const DEFAULT_RESEARCH_TOPIC = "Multi-agent collaboration" as const;
export const DEFAULT_RESEARCH_CONSTRAINTS = ["recent papers", "last 5 years"] as const;
export const DEFAULT_RESEARCH_OBJECTIVE_METRIC = "state-of-the-art reproducibility" as const;

export function getDefaultPdfAnalysisModeForLlmMode(
  llmMode: "codex_chatgpt_only" | "openai_api" | "ollama"
): "codex_text_image_hybrid" | "responses_api_pdf" | "ollama_vision" {
  if (llmMode === "openai_api") return "responses_api_pdf";
  if (llmMode === "ollama") return "ollama_vision";
  return DEFAULT_PDF_ANALYSIS_MODE;
}

export interface AppPaths {
  cwd: string;
  rootDir: string;
  configFile: string;
  runsDir: string;
  runsFile: string;
  logsDir: string;
  outputsDir: string;
}

export interface NonInteractiveSetupInput {
  projectName?: string;
  defaultTopic?: string;
  defaultConstraints?: string[];
  defaultObjectiveMetric?: string;
  llmMode?: "codex_chatgpt_only" | "openai_api" | "ollama";
  pdfAnalysisMode?: "codex_text_image_hybrid" | "responses_api_pdf" | "ollama_vision";
  semanticScholarApiKey: string;
  openAiApiKey?: string;
  codexChatModelChoice?: string;
  codexChatReasoningEffort?: AppConfig["providers"]["codex"]["reasoning_effort"];
  codexTaskModelChoice?: string;
  codexTaskReasoningEffort?: AppConfig["providers"]["codex"]["reasoning_effort"];
  codexExperimentModelChoice?: string;
  codexExperimentReasoningEffort?: AppConfig["providers"]["codex"]["reasoning_effort"];
  codexPdfModelChoice?: string;
  codexPdfReasoningEffort?: AppConfig["providers"]["codex"]["reasoning_effort"];
  openAiChatModel?: string;
  openAiChatReasoningEffort?: AppConfig["providers"]["openai"]["reasoning_effort"];
  openAiTaskModel?: string;
  openAiReasoningEffort?: AppConfig["providers"]["openai"]["reasoning_effort"];
  openAiExperimentModel?: string;
  openAiExperimentReasoningEffort?: AppConfig["providers"]["openai"]["reasoning_effort"];
  openAiPdfModel?: string;
  openAiPdfReasoningEffort?: AppConfig["providers"]["openai"]["reasoning_effort"];
  responsesPdfModel?: string;
  responsesPdfReasoningEffort?: AppConfig["analysis"]["responses_reasoning_effort"];
  ollamaBaseUrl?: string;
  ollamaChatModel?: string;
  ollamaResearchModel?: string;
  ollamaExperimentModel?: string;
  ollamaVisionModel?: string;
}

export interface SetupWizardOptions {
  codexCli?: Pick<CodexCliClient, "checkCliAvailable" | "checkLoginStatus">;
  outputWriter?: Pick<typeof output, "write">;
}

export function resolveAppPaths(cwd = process.cwd()): AppPaths {
  const rootDir = path.join(cwd, ".autolabos");
  const runsDir = path.join(rootDir, "runs");
  const logsDir = path.join(rootDir, "logs");
  const outputsDir = path.join(cwd, "outputs");
  return {
    cwd,
    rootDir,
    configFile: path.join(rootDir, "config.yaml"),
    runsDir,
    runsFile: path.join(runsDir, "runs.json"),
    logsDir,
    outputsDir
  };
}

export async function configExists(paths: AppPaths): Promise<boolean> {
  return fileExists(paths.configFile);
}

export async function loadConfig(paths: AppPaths): Promise<AppConfig> {
  const raw = await fs.readFile(paths.configFile, "utf8");
  return normalizeLoadedConfig(YAML.parse(raw) as AppConfig);
}

export async function saveConfig(paths: AppPaths, config: AppConfig): Promise<void> {
  await ensureDir(paths.rootDir);
  await fs.writeFile(paths.configFile, YAML.stringify(config), "utf8");
}

function buildConfigFromWizardAnswers(answers: {
  projectName: string;
  defaultTopic: string;
  defaultConstraints: string[];
  defaultObjectiveMetric: string;
  llmMode: "codex_chatgpt_only" | "openai_api" | "ollama";
  codexChatModelChoice: string;
  codexChatReasoningEffort: AppConfig["providers"]["codex"]["reasoning_effort"];
  codexTaskModelChoice: string;
  codexTaskReasoningEffort: AppConfig["providers"]["codex"]["reasoning_effort"];
  codexExperimentModelChoice: string;
  codexExperimentReasoningEffort: AppConfig["providers"]["codex"]["reasoning_effort"];
  codexPdfModelChoice: string;
  codexPdfReasoningEffort: AppConfig["providers"]["codex"]["reasoning_effort"];
  openAiChatModel: string;
  openAiChatReasoningEffort: AppConfig["providers"]["openai"]["reasoning_effort"];
  openAiTaskModel: string;
  openAiReasoningEffort: AppConfig["providers"]["openai"]["reasoning_effort"];
  openAiExperimentModel: string;
  openAiExperimentReasoningEffort: AppConfig["providers"]["openai"]["reasoning_effort"];
  openAiPdfModel: string;
  openAiPdfReasoningEffort: AppConfig["providers"]["openai"]["reasoning_effort"];
  pdfAnalysisMode: "codex_text_image_hybrid" | "responses_api_pdf" | "ollama_vision";
  responsesPdfModel: string;
  responsesPdfReasoningEffort: AppConfig["analysis"]["responses_reasoning_effort"];
  ollamaBaseUrl?: string;
  ollamaChatModel?: string;
  ollamaResearchModel?: string;
  ollamaExperimentModel?: string;
  ollamaVisionModel?: string;
}): AppConfig {
  const codexChatSelection = resolveCodexModelSelection(answers.codexChatModelChoice);
  const codexTaskSelection = resolveCodexModelSelection(answers.codexTaskModelChoice);
  const codexExperimentSelection = resolveCodexModelSelection(answers.codexExperimentModelChoice);
  return {
    version: 1,
    project_name: answers.projectName,
    providers: {
      llm_mode: answers.llmMode,
      codex: {
        model: codexTaskSelection.model,
        chat_model: codexChatSelection.model,
        experiment_model: codexExperimentSelection.model,
        pdf_model: resolveCodexModelSelection(answers.codexPdfModelChoice).model,
        reasoning_effort: answers.codexTaskReasoningEffort,
        chat_reasoning_effort: answers.codexChatReasoningEffort,
        experiment_reasoning_effort: answers.codexExperimentReasoningEffort,
        pdf_reasoning_effort: answers.codexPdfReasoningEffort,
        command_reasoning_effort: answers.codexChatReasoningEffort,
        fast_mode: codexTaskSelection.fastMode,
        chat_fast_mode: codexChatSelection.fastMode,
        experiment_fast_mode: codexExperimentSelection.fastMode,
        pdf_fast_mode: resolveCodexModelSelection(answers.codexPdfModelChoice).fastMode,
        auth_required: true
      },
      openai: {
        model: answers.openAiTaskModel,
        chat_model: answers.openAiChatModel,
        experiment_model: answers.openAiExperimentModel,
        pdf_model: answers.openAiPdfModel,
        reasoning_effort: answers.openAiReasoningEffort,
        chat_reasoning_effort: answers.openAiChatReasoningEffort,
        experiment_reasoning_effort: answers.openAiExperimentReasoningEffort,
        pdf_reasoning_effort: answers.openAiPdfReasoningEffort,
        command_reasoning_effort: answers.openAiChatReasoningEffort,
        api_key_required: true
      },
      ...(answers.llmMode === "ollama"
        ? {
            ollama: {
              base_url: answers.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL,
              chat_model: answers.ollamaChatModel || DEFAULT_OLLAMA_CHAT_MODEL,
              research_model: answers.ollamaResearchModel || DEFAULT_OLLAMA_RESEARCH_MODEL,
              experiment_model: answers.ollamaExperimentModel || DEFAULT_OLLAMA_EXPERIMENT_MODEL,
              vision_model: answers.ollamaVisionModel || DEFAULT_OLLAMA_VISION_MODEL
            }
          }
        : {})
    },
    analysis: {
      pdf_mode: answers.pdfAnalysisMode,
      responses_model: answers.responsesPdfModel,
      responses_reasoning_effort: answers.responsesPdfReasoningEffort
    },
    papers: {
      max_results: 200,
      per_second_limit: 1
    },
    research: {
      default_topic: answers.defaultTopic,
      default_constraints: answers.defaultConstraints,
      default_objective_metric: answers.defaultObjectiveMetric
    },
    workflow: {
      mode: "agent_approval",
      wizard_enabled: true,
      approval_mode: "minimal"
    },
    experiments: {
      runner: "local_python",
      timeout_sec: 3600,
      allow_network: false,
      candidate_isolation: "attempt_snapshot_restore"
    },
    paper: {
      template: "acl",
      build_pdf: true,
      latex_engine: "auto_install",
      validation_mode: "default"
    },
    paper_profile: {
      venue_style: "acl_long",
      target_venue_style: "generic_cs_paper",
      column_count: 2,
      main_page_limit: 8,
      references_counted: false,
      appendix_allowed: true,
      appendix_format: "double_column",
      prefer_appendix_for: [
        "hyperparameter_grids",
        "per_fold_results",
        "prompt_templates",
        "environment_dump",
        "extended_error_analysis"
      ],
      estimated_words_per_page: 420
    },
    paths: {
      runs_dir: ".autolabos/runs",
      logs_dir: ".autolabos/logs"
    }
  };
}

export async function runSetupWizard(
  paths: AppPaths,
  promptReader: PromptReader = askLine,
  opts: SetupWizardOptions = {}
): Promise<AppConfig> {
  const defaultProjectName = path.basename(paths.cwd);
  const projectName = defaultProjectName;
  const defaultTopic = DEFAULT_RESEARCH_TOPIC;
  const defaultConstraints = [...DEFAULT_RESEARCH_CONSTRAINTS];
  const defaultObjectiveMetric = DEFAULT_RESEARCH_OBJECTIVE_METRIC;
  const llmMode = await askPrimaryLlmMode(promptReader);
  await maybeNotifyCodexLoginStatus(paths, llmMode, promptReader, opts);

  // Ollama-specific setup
  let ollamaBaseUrl: string | undefined;
  let ollamaChatModel: string | undefined;
  let ollamaResearchModel: string | undefined;
  let ollamaExperimentModel: string | undefined;
  let ollamaVisionModel: string | undefined;
  if (llmMode === "ollama") {
    ollamaBaseUrl = await askOllamaBaseUrl(promptReader);
    ollamaChatModel = await askOllamaModel("Chat model", OLLAMA_CHAT_MODEL_OPTIONS, DEFAULT_OLLAMA_CHAT_MODEL, promptReader);
    ollamaResearchModel = await askOllamaModel("Research model", OLLAMA_RESEARCH_MODEL_OPTIONS, DEFAULT_OLLAMA_RESEARCH_MODEL, promptReader);
    ollamaExperimentModel = await askOllamaModel("Experiment/code model", OLLAMA_EXPERIMENT_MODEL_OPTIONS, DEFAULT_OLLAMA_EXPERIMENT_MODEL, promptReader);
    ollamaVisionModel = await askOllamaModel("Vision/PDF model", OLLAMA_VISION_MODEL_OPTIONS, DEFAULT_OLLAMA_VISION_MODEL, promptReader);
  }

  const defaultCodexChatSetupModel = DEFAULT_CODEX_CHAT_SETUP_MODEL;
  const defaultCodexBackendSetupModel = RECOMMENDED_CODEX_MODEL;
  const codexChatModelChoice =
    llmMode === "codex_chatgpt_only"
      ? await askCodexModel(
          "General chat model",
          defaultCodexChatSetupModel,
          promptReader,
          DEFAULT_CODEX_CHAT_SETUP_MODEL
        )
      : DEFAULT_CODEX_MODEL;
  const codexChatReasoningEffort =
    llmMode !== "ollama"
      ? await askCodexReasoningEffort(
          "General chat reasoning effort",
          resolveCodexModelSelection(codexChatModelChoice).model,
          DEFAULT_CODEX_CHAT_SETUP_REASONING_EFFORT,
          DEFAULT_CODEX_CHAT_SETUP_REASONING_EFFORT,
          promptReader
        )
      : DEFAULT_CODEX_CHAT_SETUP_REASONING_EFFORT;
  const researchBackendModelChoice =
    llmMode === "codex_chatgpt_only"
      ? await askCodexModel(
          "Research backend selection",
          defaultCodexBackendSetupModel,
          promptReader,
          RECOMMENDED_CODEX_MODEL
        )
      : llmMode === "openai_api"
        ? await askOpenAiResponsesModel("Research backend selection", DEFAULT_OPENAI_RESPONSES_MODEL, promptReader)
        : DEFAULT_CODEX_MODEL;
  const codexTaskModelChoice =
    llmMode === "codex_chatgpt_only"
      ? researchBackendModelChoice
      : DEFAULT_CODEX_MODEL;
  const codexTaskReasoningEffort =
    llmMode !== "ollama"
      ? await askCodexReasoningEffort(
          "Research backend reasoning effort",
          resolveCodexModelSelection(codexTaskModelChoice).model,
          "xhigh",
          "xhigh",
          promptReader
        )
      : ("xhigh" as AppConfig["providers"]["codex"]["reasoning_effort"]);
  const codexExperimentModelChoice = codexTaskModelChoice;
  const codexExperimentReasoningEffort = codexTaskReasoningEffort;
  const openAiChatModel =
    llmMode === "openai_api"
      ? await askOpenAiResponsesModel(
          "OpenAI API general chat model",
          DEFAULT_OPENAI_RESPONSES_MODEL,
          promptReader
        )
      : DEFAULT_OPENAI_RESPONSES_MODEL;
  const openAiChatReasoningEffort =
    llmMode === "openai_api"
      ? await askOpenAiResponsesReasoningEffort(
          "General chat reasoning effort",
          openAiChatModel,
          "low",
          "low",
          promptReader
        )
      : ("low" as AppConfig["providers"]["openai"]["reasoning_effort"]);
  const openAiTaskModel =
    llmMode === "openai_api"
      ? researchBackendModelChoice
      : DEFAULT_OPENAI_RESPONSES_MODEL;
  const openAiReasoningEffort =
    llmMode === "openai_api"
      ? await askOpenAiResponsesReasoningEffort(
          "Research backend reasoning effort",
          openAiTaskModel,
          "xhigh",
          "xhigh",
          promptReader
        )
      : (DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as AppConfig["providers"]["openai"]["reasoning_effort"]);
  const openAiExperimentModel = openAiTaskModel;
  const openAiExperimentReasoningEffort = openAiReasoningEffort;
  const pdfAnalysisMode = getDefaultPdfAnalysisModeForLlmMode(llmMode);
  const codexPdfModelChoice = codexTaskModelChoice;
  const codexPdfReasoningEffort = codexTaskReasoningEffort;
  const openAiPdfModel = openAiTaskModel;
  const openAiPdfReasoningEffort = openAiReasoningEffort;
  const responsesPdfModel =
    pdfAnalysisMode === "responses_api_pdf"
      ? await askResponsesPdfModel(promptReader, "Research backend Responses API PDF model")
      : DEFAULT_RESPONSES_PDF_MODEL;
  const responsesPdfReasoningEffort =
    pdfAnalysisMode === "responses_api_pdf"
      ? await askOpenAiResponsesReasoningEffort(
          "Research backend PDF reasoning effort",
          responsesPdfModel,
          "xhigh",
          "xhigh",
          promptReader
        )
      : ("xhigh" as AppConfig["analysis"]["responses_reasoning_effort"]);
  const existingOpenAiApiKey = await resolveOpenAiApiKey(paths.cwd);
  const openAiApiKey =
    llmMode === "openai_api" || pdfAnalysisMode === "responses_api_pdf"
      ? await askApiKey("OpenAI API key", existingOpenAiApiKey, promptReader)
      : undefined;

  const config = buildConfigFromWizardAnswers({
    projectName,
    defaultTopic,
    defaultConstraints,
    defaultObjectiveMetric,
    llmMode,
    codexChatModelChoice,
    codexChatReasoningEffort,
    codexTaskModelChoice,
    codexTaskReasoningEffort,
    codexExperimentModelChoice,
    codexExperimentReasoningEffort,
    codexPdfModelChoice,
    codexPdfReasoningEffort,
    openAiChatModel,
    openAiChatReasoningEffort,
    openAiTaskModel,
    openAiReasoningEffort,
    openAiExperimentModel,
    openAiExperimentReasoningEffort,
    openAiPdfModel,
    openAiPdfReasoningEffort,
    pdfAnalysisMode,
    responsesPdfModel,
    responsesPdfReasoningEffort,
    ollamaBaseUrl,
    ollamaChatModel,
    ollamaResearchModel,
    ollamaExperimentModel,
    ollamaVisionModel
  });

  await saveConfig(paths, config);
  if (openAiApiKey?.trim()) {
    await upsertEnvVar(path.join(paths.cwd, ".env"), "OPENAI_API_KEY", openAiApiKey.trim());
  }
  return config;
}

export async function runNonInteractiveSetup(
  paths: AppPaths,
  input: NonInteractiveSetupInput
): Promise<AppConfig> {
  const llmMode = input.llmMode || DEFAULT_PRIMARY_LLM_MODE;
  const pdfAnalysisMode = input.pdfAnalysisMode || getDefaultPdfAnalysisModeForLlmMode(llmMode);
  const defaultConstraints = (input.defaultConstraints || ["recent papers", "last 5 years"])
    .map((item) => item.trim())
    .filter(Boolean);

  const config = buildConfigFromWizardAnswers({
    projectName: (input.projectName || path.basename(paths.cwd)).trim() || path.basename(paths.cwd),
    defaultTopic: (input.defaultTopic || "Multi-agent collaboration").trim(),
    defaultConstraints,
    defaultObjectiveMetric: (input.defaultObjectiveMetric || "state-of-the-art reproducibility").trim(),
    llmMode,
    codexChatModelChoice: input.codexChatModelChoice || DEFAULT_CODEX_CHAT_SETUP_MODEL,
    codexChatReasoningEffort: input.codexChatReasoningEffort || DEFAULT_CODEX_CHAT_SETUP_REASONING_EFFORT,
    codexTaskModelChoice: input.codexTaskModelChoice || DEFAULT_CODEX_MODEL,
    codexTaskReasoningEffort: input.codexTaskReasoningEffort || "xhigh",
    codexExperimentModelChoice:
      input.codexExperimentModelChoice || input.codexTaskModelChoice || DEFAULT_CODEX_MODEL,
    codexExperimentReasoningEffort:
      input.codexExperimentReasoningEffort || input.codexTaskReasoningEffort || "xhigh",
    codexPdfModelChoice: input.codexPdfModelChoice || input.codexTaskModelChoice || DEFAULT_CODEX_MODEL,
    codexPdfReasoningEffort: input.codexPdfReasoningEffort || input.codexTaskReasoningEffort || "xhigh",
    openAiChatModel: input.openAiChatModel || DEFAULT_OPENAI_RESPONSES_MODEL,
    openAiChatReasoningEffort: input.openAiChatReasoningEffort || "low",
    openAiTaskModel: input.openAiTaskModel || DEFAULT_OPENAI_RESPONSES_MODEL,
    openAiReasoningEffort:
      input.openAiReasoningEffort ||
      (DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as AppConfig["providers"]["openai"]["reasoning_effort"]),
    openAiExperimentModel: input.openAiExperimentModel || input.openAiTaskModel || DEFAULT_OPENAI_RESPONSES_MODEL,
    openAiExperimentReasoningEffort:
      input.openAiExperimentReasoningEffort ||
      input.openAiReasoningEffort ||
      (DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as AppConfig["providers"]["openai"]["reasoning_effort"]),
    openAiPdfModel: input.openAiPdfModel || input.openAiTaskModel || DEFAULT_OPENAI_RESPONSES_MODEL,
    openAiPdfReasoningEffort:
      input.openAiPdfReasoningEffort ||
      input.openAiReasoningEffort ||
      (DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as AppConfig["providers"]["openai"]["reasoning_effort"]),
    pdfAnalysisMode,
    responsesPdfModel: input.responsesPdfModel || DEFAULT_RESPONSES_PDF_MODEL,
    responsesPdfReasoningEffort: input.responsesPdfReasoningEffort || "xhigh",
    ollamaBaseUrl: input.ollamaBaseUrl,
    ollamaChatModel: input.ollamaChatModel,
    ollamaResearchModel: input.ollamaResearchModel,
    ollamaExperimentModel: input.ollamaExperimentModel,
    ollamaVisionModel: input.ollamaVisionModel
  });

  await saveConfig(paths, config);
  await upsertEnvVar(
    path.join(paths.cwd, ".env"),
    "SEMANTIC_SCHOLAR_API_KEY",
    input.semanticScholarApiKey.trim()
  );
  if (input.openAiApiKey?.trim()) {
    await upsertEnvVar(path.join(paths.cwd, ".env"), "OPENAI_API_KEY", input.openAiApiKey.trim());
  }
  return config;
}

async function askApiKey(
  question: string,
  existingValue: string | undefined,
  promptReader: PromptReader
): Promise<string> {
  if (existingValue?.trim()) {
    const answer = (await promptReader(`${question} (press Enter to keep existing)`)).trim();
    return answer || existingValue.trim();
  }
  return askRequiredLine(question, promptReader);
}

export async function ensureScaffold(paths: AppPaths): Promise<void> {
  await ensureDir(paths.rootDir);
  await ensureDir(paths.runsDir);
  await ensureDir(paths.logsDir);
  await ensureDir(paths.outputsDir);

  if (!(await fileExists(paths.runsFile))) {
    const runs: RunsFile = { version: 3, runs: [] };
    await writeJsonFile(paths.runsFile, runs);
  }
}

function normalizeLoadedConfig(config: AppConfig): AppConfig {
  if (!config.providers) {
    throw new Error("Invalid config: providers is missing");
  }
  if (!config.providers.codex) {
    config.providers.codex = {
      model: DEFAULT_CODEX_MODEL,
      reasoning_effort: "xhigh",
      fast_mode: false,
      auth_required: true
    };
  }
  if (!config.providers.openai) {
    config.providers.openai = {
      model: DEFAULT_OPENAI_RESPONSES_MODEL,
      chat_model: DEFAULT_OPENAI_RESPONSES_MODEL,
      experiment_model: DEFAULT_OPENAI_RESPONSES_MODEL,
      pdf_model: DEFAULT_OPENAI_RESPONSES_MODEL,
      reasoning_effort: DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as AppConfig["providers"]["openai"]["reasoning_effort"],
      chat_reasoning_effort: "low",
      experiment_reasoning_effort:
        DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as AppConfig["providers"]["openai"]["reasoning_effort"],
      pdf_reasoning_effort: DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as AppConfig["providers"]["openai"]["reasoning_effort"],
      command_reasoning_effort: "low",
      api_key_required: true
    };
  }
  if (config.providers.llm_mode === "ollama" && !config.providers.ollama) {
    config.providers.ollama = {
      base_url: DEFAULT_OLLAMA_BASE_URL,
      chat_model: DEFAULT_OLLAMA_CHAT_MODEL,
      research_model: DEFAULT_OLLAMA_RESEARCH_MODEL,
      experiment_model: DEFAULT_OLLAMA_EXPERIMENT_MODEL,
      vision_model: DEFAULT_OLLAMA_VISION_MODEL
    };
  }
  if (config.providers.ollama) {
    const ollama = config.providers.ollama;
    ollama.base_url = ollama.base_url?.trim() || DEFAULT_OLLAMA_BASE_URL;
    ollama.chat_model = ollama.chat_model?.trim() || DEFAULT_OLLAMA_CHAT_MODEL;
    ollama.research_model = ollama.research_model?.trim() || DEFAULT_OLLAMA_RESEARCH_MODEL;
    ollama.experiment_model = ollama.experiment_model?.trim() || ollama.research_model;
    ollama.vision_model = ollama.vision_model?.trim() || DEFAULT_OLLAMA_VISION_MODEL;
  }
  if (!config.papers) {
    throw new Error("Invalid config: papers is missing");
  }
  if (!config.analysis) {
    config.analysis = {
      pdf_mode: DEFAULT_PDF_ANALYSIS_MODE,
      responses_model: DEFAULT_RESPONSES_PDF_MODEL,
      responses_reasoning_effort: "xhigh"
    };
  }
  if (!config.workflow) {
    config.workflow = {
      mode: "agent_approval",
      wizard_enabled: true,
      approval_mode: "minimal"
    };
  }

  const codex = config.providers.codex;
  const openai = config.providers.openai;
  const analysis = config.analysis;
  const papers = config.papers;
  config.providers.llm_mode = normalizePrimaryLlmMode(config.providers.llm_mode);
  if (!codex.model) {
    codex.model = DEFAULT_CODEX_MODEL;
  }
  codex.chat_model = codex.chat_model?.trim() || codex.model;
  codex.experiment_model = codex.experiment_model?.trim() || codex.model;
  codex.pdf_model = codex.pdf_model?.trim() || codex.model;
  if (!codex.reasoning_effort) {
    codex.reasoning_effort = "xhigh";
  }
  codex.chat_reasoning_effort =
    normalizeReasoningEffortForModel(
      codex.chat_model,
      codex.chat_reasoning_effort || codex.command_reasoning_effort || "low"
    );
  codex.experiment_reasoning_effort =
    normalizeReasoningEffortForModel(
      codex.experiment_model,
      codex.experiment_reasoning_effort || codex.reasoning_effort
    );
  codex.pdf_reasoning_effort =
    normalizeReasoningEffortForModel(codex.pdf_model, codex.pdf_reasoning_effort || codex.reasoning_effort);
  if (!codex.command_reasoning_effort) {
    codex.command_reasoning_effort = "low";
  }
  if (typeof codex.fast_mode !== "boolean") {
    codex.fast_mode = false;
  }
  if (typeof codex.chat_fast_mode !== "boolean") {
    codex.chat_fast_mode = false;
  }
  if (typeof codex.experiment_fast_mode !== "boolean") {
    codex.experiment_fast_mode = false;
  }
  if (typeof codex.pdf_fast_mode !== "boolean") {
    codex.pdf_fast_mode = false;
  }
  if (codex.model !== "gpt-5.4") {
    codex.fast_mode = false;
  }
  if (codex.chat_model !== "gpt-5.4") {
    codex.chat_fast_mode = false;
  }
  if (codex.experiment_model !== "gpt-5.4") {
    codex.experiment_fast_mode = false;
  }
  if (codex.pdf_model !== "gpt-5.4") {
    codex.pdf_fast_mode = false;
  }
  codex.reasoning_effort = normalizeReasoningEffortForModel(codex.model, codex.reasoning_effort);
  codex.command_reasoning_effort = normalizeReasoningEffortForModel(codex.model, codex.command_reasoning_effort);
  codex.chat_reasoning_effort = normalizeReasoningEffortForModel(codex.chat_model, codex.chat_reasoning_effort);
  codex.experiment_reasoning_effort = normalizeReasoningEffortForModel(
    codex.experiment_model,
    codex.experiment_reasoning_effort
  );
  codex.pdf_reasoning_effort = normalizeReasoningEffortForModel(codex.pdf_model, codex.pdf_reasoning_effort);
  codex.command_reasoning_effort = codex.chat_reasoning_effort;
  openai.model = normalizeOpenAiResponsesModel(openai.model);
  openai.chat_model = normalizeOpenAiResponsesModel(openai.chat_model || openai.model);
  openai.experiment_model = normalizeOpenAiResponsesModel(openai.experiment_model || openai.model);
  openai.pdf_model = normalizeOpenAiResponsesModel(openai.pdf_model || openai.model);
  openai.reasoning_effort = normalizeOpenAiResponsesReasoningEffort(
    openai.model,
    openai.reasoning_effort
  ) as AppConfig["providers"]["openai"]["reasoning_effort"];
  openai.chat_reasoning_effort = normalizeOpenAiResponsesReasoningEffort(
    openai.chat_model,
    openai.chat_reasoning_effort || openai.command_reasoning_effort || "low"
  ) as AppConfig["providers"]["openai"]["reasoning_effort"];
  openai.experiment_reasoning_effort = normalizeOpenAiResponsesReasoningEffort(
    openai.experiment_model,
    openai.experiment_reasoning_effort || openai.reasoning_effort
  ) as AppConfig["providers"]["openai"]["reasoning_effort"];
  openai.pdf_reasoning_effort = normalizeOpenAiResponsesReasoningEffort(
    openai.pdf_model,
    openai.pdf_reasoning_effort || openai.reasoning_effort
  ) as AppConfig["providers"]["openai"]["reasoning_effort"];
  openai.command_reasoning_effort = normalizeOpenAiResponsesReasoningEffort(
    openai.chat_model,
    openai.command_reasoning_effort || openai.chat_reasoning_effort || "low"
  ) as AppConfig["providers"]["openai"]["reasoning_effort"];
  openai.command_reasoning_effort = openai.chat_reasoning_effort;
  openai.api_key_required = true;
  config.papers = {
    max_results: Math.max(1, papers.max_results || 200),
    per_second_limit: Math.max(1, papers.per_second_limit || 1)
  };
  config.analysis = {
    pdf_mode: normalizePdfAnalysisMode(analysis.pdf_mode),
    responses_model: normalizeResponsesPdfModel(analysis.responses_model),
    responses_reasoning_effort: normalizeOpenAiResponsesReasoningEffort(
      analysis.responses_model,
      analysis.responses_reasoning_effort || "xhigh"
    ) as AppConfig["analysis"]["responses_reasoning_effort"]
  };
  config.workflow = {
    mode: "agent_approval",
    wizard_enabled: true,
    approval_mode: normalizeWorkflowApprovalMode(config.workflow.approval_mode)
  };
  config.experiments = {
    runner: "local_python",
    timeout_sec: Math.max(1, config.experiments?.timeout_sec || 3600),
    allow_network: config.experiments?.allow_network === true,
    candidate_isolation:
      config.experiments?.candidate_isolation === "attempt_worktree"
        ? "attempt_worktree"
        : "attempt_snapshot_restore"
  };
  config.paper_profile = normalizePaperProfileConfig(config.paper_profile);
  return config;
}

export async function resolveSemanticScholarApiKey(cwd: string): Promise<string | undefined> {
  const fileEnv = await readDotEnvFile(path.join(cwd, ".env"));
  const semanticScholarApiKey =
    process.env.SEMANTIC_SCHOLAR_API_KEY ||
    fileEnv.SEMANTIC_SCHOLAR_API_KEY;
  const normalized = semanticScholarApiKey?.trim();
  return normalized ? normalized : undefined;
}

export async function hasSemanticScholarApiKey(cwd: string): Promise<boolean> {
  return Boolean(await resolveSemanticScholarApiKey(cwd));
}

export async function resolveOpenAiApiKey(cwd: string): Promise<string | undefined> {
  const fileEnv = await readDotEnvFile(path.join(cwd, ".env"));
  const openAiApiKey =
    process.env.OPENAI_API_KEY ||
    fileEnv.OPENAI_API_KEY;
  const normalized = openAiApiKey?.trim();
  return normalized ? normalized : undefined;
}

export async function hasOpenAiApiKey(cwd: string): Promise<boolean> {
  return Boolean(await resolveOpenAiApiKey(cwd));
}

async function readDotEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return parseDotEnv(raw);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function parseDotEnv(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, originalValue] = match;
    let value = originalValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export async function upsertEnvVar(filePath: string, key: string, value: string): Promise<void> {
  const escapedValue = quoteEnvValue(value);
  let existing = "";
  try {
    existing = await fs.readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  const lines = existing ? existing.split(/\r?\n/) : [];
  let updated = false;
  const nextLines = lines.map((line) => {
    if (line.trim().match(new RegExp(`^${escapeRegExp(key)}\\s*=`))) {
      updated = true;
      return `${key}=${escapedValue}`;
    }
    return line;
  });

  if (!updated) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push(`${key}=${escapedValue}`);
  }

  const normalized = nextLines.join("\n").replace(/\n+$/u, "\n");
  await fs.writeFile(filePath, normalized || `${key}=${escapedValue}\n`, "utf8");
}

function quoteEnvValue(value: string): string {
  return JSON.stringify(value);
}

function normalizePdfAnalysisMode(
  value: unknown
): "codex_text_image_hybrid" | "responses_api_pdf" | "ollama_vision" {
  if (value === "responses_api_pdf" || value === "ollama_vision") return value;
  return DEFAULT_PDF_ANALYSIS_MODE;
}

function normalizePrimaryLlmMode(
  value: unknown
): "codex_chatgpt_only" | "openai_api" | "ollama" {
  if (value === "openai_api" || value === "ollama") return value;
  return DEFAULT_PRIMARY_LLM_MODE;
}

function normalizeWorkflowApprovalMode(value: unknown): WorkflowApprovalMode {
  return value === "manual" ? "manual" : "minimal";
}

function normalizePaperProfileConfig(value: AppConfig["paper_profile"] | undefined): AppConfig["paper_profile"] {
  const preferAppendixFor = Array.isArray(value?.prefer_appendix_for)
    ? value?.prefer_appendix_for
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
  const estimatedWordsPerPage =
    typeof value?.estimated_words_per_page === "number" && Number.isFinite(value.estimated_words_per_page)
      ? Math.max(250, Math.round(value.estimated_words_per_page))
      : 420;

  return {
    venue_style: value?.venue_style?.trim() || "acl_long",
    target_venue_style: value?.target_venue_style?.trim() || undefined,
    column_count: value?.column_count === 1 ? 1 : 2,
    main_page_limit:
      typeof value?.main_page_limit === "number" && Number.isFinite(value.main_page_limit)
        ? Math.max(1, Math.round(value.main_page_limit))
        : 8,
    references_counted: Boolean(value?.references_counted),
    appendix_allowed: value?.appendix_allowed !== false,
    appendix_format: value?.appendix_format === "single_column" ? "single_column" : "double_column",
    prefer_appendix_for:
      preferAppendixFor.length > 0
        ? preferAppendixFor
        : [
            "hyperparameter_grids",
            "per_fold_results",
            "prompt_templates",
            "environment_dump",
            "extended_error_analysis"
          ],
    estimated_words_per_page: estimatedWordsPerPage
  };
}

async function askPrimaryLlmMode(
  promptReader: PromptReader = askLine
): Promise<"codex_chatgpt_only" | "openai_api" | "ollama"> {
  if (promptReader === askLine) {
    const answer = await askChoice(
      "Primary LLM provider",
      [
        {
          label: "codex",
          value: "codex_chatgpt_only",
          description: "(Codex CLI backend, ChatGPT sign-in)"
        },
        {
          label: "api",
          value: "openai_api",
          description: "(OpenAI API backend, OPENAI_API_KEY required)"
        },
        {
          label: "ollama",
          value: "ollama",
          description: "(Local Ollama backend, no API key needed)"
        }
      ],
      "codex_chatgpt_only"
    );
    if (answer === "openai_api") return "openai_api";
    if (answer === "ollama") return "ollama";
    return "codex_chatgpt_only";
  }

  while (true) {
    const answer = (await promptReader("Primary LLM provider (codex/api/ollama)", "codex")).trim().toLowerCase();
    if (!answer || answer === "codex" || answer === "chatgpt" || answer === "codex_chatgpt_only") {
      return "codex_chatgpt_only";
    }
    if (answer === "api" || answer === "openai" || answer === "openai_api") {
      return "openai_api";
    }
    if (answer === "ollama" || answer === "local") {
      return "ollama";
    }
    output.write("Primary LLM provider must be 'codex', 'api', or 'ollama'.\n");
  }
}

async function askOllamaBaseUrl(
  promptReader: PromptReader = askLine
): Promise<string> {
  const answer = (
    await promptReader(`Ollama base URL (${DEFAULT_OLLAMA_BASE_URL})`, DEFAULT_OLLAMA_BASE_URL)
  ).trim();
  return answer || DEFAULT_OLLAMA_BASE_URL;
}

async function askOllamaModel(
  label: string,
  options: Array<{ value: string; label: string; description: string }>,
  defaultValue: string,
  promptReader: PromptReader = askLine
): Promise<string> {
  if (promptReader === askLine) {
    return askChoice(
      label,
      options.map((o) => ({ label: o.label, value: o.value, description: o.description })),
      defaultValue
    );
  }

  const optionValues = options.map((o) => o.value);
  const answer = (await promptReader(`${label} (${defaultValue})`, defaultValue)).trim();
  if (!answer) return defaultValue;
  // Accept exact match or custom model name
  return optionValues.includes(answer) ? answer : answer;
}

async function askOpenAiResponsesModel(
  label: string,
  defaultValue: string,
  promptReader: PromptReader = askLine
): Promise<string> {
  if (promptReader === askLine) {
    return askChoice(
      label,
      OPENAI_RESPONSES_MODEL_OPTIONS.map((option) => ({
        label: option.label,
        value: option.value,
        description:
          option.value === "gpt-5.4"
            ? "(highest quality)"
            : option.value === "gpt-5"
              ? "(balanced)"
              : option.value === "gpt-5-mini"
                ? "(fastest GPT-5)"
                : option.value === "gpt-4.1"
                  ? "(structured extraction)"
                  : option.value === "gpt-4o"
                    ? "(multimodal)"
                    : "(fast, low-cost)"
      })),
      defaultValue
    );
  }

  const choices = buildOpenAiResponsesModelChoices();
  const display = choices.join(", ");
  while (true) {
    const answer = (await promptReader(label, defaultValue)).trim();
    if (!answer) {
      return defaultValue;
    }
    if (choices.includes(answer)) {
      return answer;
    }
    output.write(`OpenAI API model must be one of: ${display}.\n`);
  }
}

async function askCodexModel(
  label: string,
  defaultValue: string,
  promptReader: PromptReader = askLine,
  recommendedSelection = RECOMMENDED_CODEX_MODEL
): Promise<string> {
  if (promptReader === askLine) {
    return askChoice(
      label,
      buildCodexModelSelectionChoices(defaultValue).map((choice) => ({
        label: choice,
        value: choice,
        description: buildCodexModelPromptDescription(choice, recommendedSelection)
      })),
      getCurrentCodexModelSelectionValue(resolveCodexModelSelection(defaultValue).model, false)
    );
  }

  const choices = buildCodexModelSelectionChoices(defaultValue);
  const display = choices.join(", ");
  while (true) {
    const answer = (await promptReader(label, defaultValue)).trim();
    if (!answer) {
      return defaultValue;
    }
    if (choices.includes(answer)) {
      return answer;
    }
    output.write(`Codex model must be one of: ${display}.\n`);
  }
}

async function askOpenAiResponsesReasoningEffort(
  label: string,
  model: string,
  defaultValue: AppConfig["providers"]["openai"]["reasoning_effort"],
  recommendedValue: AppConfig["providers"]["openai"]["reasoning_effort"],
  promptReader: PromptReader = askLine
): Promise<AppConfig["providers"]["openai"]["reasoning_effort"]> {
  if (!supportsOpenAiResponsesReasoning(model)) {
    return DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as AppConfig["providers"]["openai"]["reasoning_effort"];
  }

  if (promptReader === askLine) {
    return askChoice(
      label,
      getOpenAiResponsesReasoningOptions(model).map((option) => ({
        label: option.label,
        value: option.value,
        description: buildReasoningDescription(option.value, recommendedValue)
      })),
      defaultValue
    ) as Promise<AppConfig["providers"]["openai"]["reasoning_effort"]>;
  }

  const choices = buildOpenAiResponsesReasoningChoices(model);
  const display = choices.join(", ");
  while (true) {
    const answer = (
      await promptReader(
        label,
        defaultValue
      )
    )
      .trim()
      .toLowerCase();
    if (!answer) {
      return defaultValue as AppConfig["providers"]["openai"]["reasoning_effort"];
    }
    if (choices.includes(answer)) {
      return answer as AppConfig["providers"]["openai"]["reasoning_effort"];
    }
    output.write(`OpenAI API reasoning effort must be one of: ${display}.\n`);
  }
}

async function askCodexReasoningEffort(
  label: string,
  model: string,
  defaultValue: AppConfig["providers"]["codex"]["reasoning_effort"],
  recommendedValue: AppConfig["providers"]["codex"]["reasoning_effort"],
  promptReader: PromptReader = askLine
): Promise<AppConfig["providers"]["codex"]["reasoning_effort"]> {
  const choices = [...getReasoningEffortChoicesForModel(model)] as const;
  const normalizedDefault = normalizeReasoningEffortForModel(model, defaultValue);
  if (promptReader === askLine) {
    return askChoice(
      label,
      choices.map((value) => ({
        label: value,
        value,
        description: buildReasoningDescription(value, recommendedValue)
      })),
      normalizedDefault
    ) as Promise<AppConfig["providers"]["codex"]["reasoning_effort"]>;
  }
  const display = choices.join(", ");
  while (true) {
    const answer = (await promptReader(label, normalizedDefault)).trim().toLowerCase();
    if (!answer) {
      return normalizedDefault;
    }
    if (choices.includes(answer as (typeof choices)[number])) {
      return answer as AppConfig["providers"]["codex"]["reasoning_effort"];
    }
    output.write(`Codex reasoning effort must be one of: ${display}.\n`);
  }
}

function buildReasoningDescription(
  value: string,
  recommendedValue: string
): string {
  const base =
    value === "minimal"
      ? "(fastest)"
      : value === "low"
        ? "(fast)"
        : value === "medium"
          ? "(balanced)"
          : value === "high"
            ? "(deeper reasoning)"
            : "(maximum reasoning)";
  if (value === recommendedValue) {
    return `${base} [recommended]`;
  }
  return base;
}

function buildCodexModelPromptDescription(choice: string, recommendedSelection: string): string | undefined {
  const base = getCodexModelSelectionDescription(choice);
  return buildRecommendedPromptDescription(base, choice === recommendedSelection);
}

function buildRecommendedPromptDescription(base: string | undefined, recommended: boolean): string | undefined {
  if (!base) {
    return recommended ? "([recommended])" : undefined;
  }
  if (recommended) {
    return `(${base} [recommended])`;
  }
  return `(${base})`;
}

async function maybeNotifyCodexLoginStatus(
  paths: AppPaths,
  llmMode: "codex_chatgpt_only" | "openai_api" | "ollama",
  promptReader: PromptReader,
  opts: SetupWizardOptions
): Promise<void> {
  if (llmMode !== "codex_chatgpt_only") {
    return;
  }

  const writer = opts.outputWriter || output;
  const codexCli = opts.codexCli || (promptReader === askLine ? new CodexCliClient(paths.cwd) : undefined);
  if (!codexCli) {
    return;
  }

  try {
    const cliCheck = await codexCli.checkCliAvailable();
    if (!cliCheck.ok) {
      writer.write(
        "Codex CLI was not detected right now. You can finish setup now and sign in later with `codex login`, then verify with `/doctor`.\n"
      );
      return;
    }

    const loginCheck = await codexCli.checkLoginStatus();
    if (!loginCheck.ok) {
      writer.write(
        "Codex CLI login was not detected. You can finish setup now and sign in later with `codex login`, then verify with `/doctor`.\n"
      );
    }
  } catch {
    writer.write(
      "Codex CLI login could not be verified right now. You can finish setup now and sign in later with `codex login`, then verify with `/doctor`.\n"
    );
  }
}

async function askResponsesPdfModel(
  promptReader: PromptReader = askLine,
  label = "Responses API PDF model"
): Promise<string> {
  if (promptReader === askLine) {
    return askChoice(
      label,
      RESPONSES_PDF_MODEL_OPTIONS.map((option) => ({
        label: option.label,
        value: option.value,
        description:
          option.value === "gpt-5.4"
            ? "(best quality)"
            : option.value === "gpt-5"
              ? "(balanced)"
              : option.value === "gpt-5-mini"
                ? "(fastest GPT-5)"
                : option.value === "gpt-4.1"
                  ? "(document OCR)"
                  : option.value === "gpt-4o"
                    ? "(strong multimodal)"
                    : "(fast, low-cost)"
      })),
      DEFAULT_RESPONSES_PDF_MODEL
    );
  }

  const choices = buildResponsesPdfModelChoices();
  const display = choices.join(", ");
  while (true) {
    const answer = (await promptReader(label, DEFAULT_RESPONSES_PDF_MODEL)).trim();
    if (!answer) {
      return DEFAULT_RESPONSES_PDF_MODEL;
    }
    if (choices.includes(answer)) {
      return answer;
    }
    output.write(`${label} must be one of: ${display}.\n`);
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
