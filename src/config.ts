import path from "node:path";
import { promises as fs } from "node:fs";
import { stdout as output } from "node:process";
import YAML from "yaml";

import { AppConfig, RunsFile } from "./types.js";
import {
  buildCodexModelSelectionChoices,
  getCodexModelSelectionDescription,
  getCurrentCodexModelSelectionValue,
  getReasoningEffortChoicesForModel,
  normalizeReasoningEffortForModel,
  resolveCodexModelSelection
} from "./integrations/codex/modelCatalog.js";
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

export interface AppPaths {
  cwd: string;
  rootDir: string;
  configFile: string;
  runsDir: string;
  runsFile: string;
  logsDir: string;
}

export interface NonInteractiveSetupInput {
  projectName?: string;
  defaultTopic?: string;
  defaultConstraints?: string[];
  defaultObjectiveMetric?: string;
  llmMode?: "codex_chatgpt_only" | "openai_api";
  pdfAnalysisMode?: "codex_text_extract" | "responses_api_pdf";
  semanticScholarApiKey: string;
  openAiApiKey?: string;
  codexChatModelChoice?: string;
  codexChatReasoningEffort?: AppConfig["providers"]["codex"]["reasoning_effort"];
  codexTaskModelChoice?: string;
  codexTaskReasoningEffort?: AppConfig["providers"]["codex"]["reasoning_effort"];
  codexPdfModelChoice?: string;
  codexPdfReasoningEffort?: AppConfig["providers"]["codex"]["reasoning_effort"];
  openAiChatModel?: string;
  openAiChatReasoningEffort?: AppConfig["providers"]["openai"]["reasoning_effort"];
  openAiTaskModel?: string;
  openAiReasoningEffort?: AppConfig["providers"]["openai"]["reasoning_effort"];
  openAiPdfModel?: string;
  openAiPdfReasoningEffort?: AppConfig["providers"]["openai"]["reasoning_effort"];
  responsesPdfModel?: string;
  responsesPdfReasoningEffort?: AppConfig["analysis"]["responses_reasoning_effort"];
}

export function resolveAppPaths(cwd = process.cwd()): AppPaths {
  const rootDir = path.join(cwd, ".autoresearch");
  const runsDir = path.join(rootDir, "runs");
  const logsDir = path.join(rootDir, "logs");
  return {
    cwd,
    rootDir,
    configFile: path.join(rootDir, "config.yaml"),
    runsDir,
    runsFile: path.join(runsDir, "runs.json"),
    logsDir
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
  llmMode: "codex_chatgpt_only" | "openai_api";
  codexChatModelChoice: string;
  codexChatReasoningEffort: AppConfig["providers"]["codex"]["reasoning_effort"];
  codexTaskModelChoice: string;
  codexTaskReasoningEffort: AppConfig["providers"]["codex"]["reasoning_effort"];
  codexPdfModelChoice: string;
  codexPdfReasoningEffort: AppConfig["providers"]["codex"]["reasoning_effort"];
  openAiChatModel: string;
  openAiChatReasoningEffort: AppConfig["providers"]["openai"]["reasoning_effort"];
  openAiTaskModel: string;
  openAiReasoningEffort: AppConfig["providers"]["openai"]["reasoning_effort"];
  openAiPdfModel: string;
  openAiPdfReasoningEffort: AppConfig["providers"]["openai"]["reasoning_effort"];
  pdfAnalysisMode: "codex_text_extract" | "responses_api_pdf";
  responsesPdfModel: string;
  responsesPdfReasoningEffort: AppConfig["analysis"]["responses_reasoning_effort"];
}): AppConfig {
  const codexChatSelection = resolveCodexModelSelection(answers.codexChatModelChoice);
  const codexTaskSelection = resolveCodexModelSelection(answers.codexTaskModelChoice);
  return {
    version: 1,
    project_name: answers.projectName,
    providers: {
      llm_mode: answers.llmMode,
      codex: {
        model: codexTaskSelection.model,
        chat_model: codexChatSelection.model,
        pdf_model: resolveCodexModelSelection(answers.codexPdfModelChoice).model,
        reasoning_effort: answers.codexTaskReasoningEffort,
        chat_reasoning_effort: answers.codexChatReasoningEffort,
        pdf_reasoning_effort: answers.codexPdfReasoningEffort,
        command_reasoning_effort: answers.codexChatReasoningEffort,
        fast_mode: codexTaskSelection.fastMode,
        chat_fast_mode: codexChatSelection.fastMode,
        pdf_fast_mode: resolveCodexModelSelection(answers.codexPdfModelChoice).fastMode,
        auth_required: true
      },
      openai: {
        model: answers.openAiTaskModel,
        chat_model: answers.openAiChatModel,
        pdf_model: answers.openAiPdfModel,
        reasoning_effort: answers.openAiReasoningEffort,
        chat_reasoning_effort: answers.openAiChatReasoningEffort,
        pdf_reasoning_effort: answers.openAiPdfReasoningEffort,
        command_reasoning_effort: answers.openAiChatReasoningEffort,
        api_key_required: true
      }
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
      wizard_enabled: true
    },
    experiments: {
      runner: "local_python",
      timeout_sec: 3600,
      allow_network: false
    },
    paper: {
      template: "acl",
      build_pdf: true,
      latex_engine: "auto_install"
    },
    paths: {
      runs_dir: ".autoresearch/runs",
      logs_dir: ".autoresearch/logs"
    }
  };
}

export async function runSetupWizard(
  paths: AppPaths,
  promptReader: PromptReader = askLine
): Promise<AppConfig> {
  const defaultProjectName = path.basename(paths.cwd);
  const projectName = await promptReader("Project name", defaultProjectName);
  const defaultTopic = await promptReader("Default research topic", "Multi-agent collaboration");
  const constraintsRaw = await promptReader(
    "Default constraints (comma-separated)",
    "recent papers,last 5 years"
  );
  const defaultObjectiveMetric = await promptReader(
    "Default objective metric",
    "state-of-the-art reproducibility"
  );
  const llmMode = await askPrimaryLlmMode(promptReader);
  const codexChatModelChoice =
    llmMode === "codex_chatgpt_only"
      ? await askCodexModel("General chat model", "gpt-5.3-codex", promptReader)
      : "gpt-5.3-codex";
  const codexChatReasoningEffort = await askCodexReasoningEffort(
    "General chat reasoning effort",
    resolveCodexModelSelection(codexChatModelChoice).model,
    "low",
    "low",
    promptReader
  );
  const codexTaskModelChoice =
    llmMode === "codex_chatgpt_only"
      ? await askCodexModel("Analysis/hypothesis model", "gpt-5.3-codex", promptReader)
      : "gpt-5.3-codex";
  const codexTaskReasoningEffort = await askCodexReasoningEffort(
    "Analysis/hypothesis reasoning effort",
    resolveCodexModelSelection(codexTaskModelChoice).model,
    "xhigh",
    "xhigh",
    promptReader
  );
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
      ? await askOpenAiResponsesModel(
          "OpenAI API analysis/hypothesis model",
          DEFAULT_OPENAI_RESPONSES_MODEL,
          promptReader
        )
      : DEFAULT_OPENAI_RESPONSES_MODEL;
  const openAiReasoningEffort =
    llmMode === "openai_api"
      ? await askOpenAiResponsesReasoningEffort(
          "Analysis/hypothesis reasoning effort",
          openAiTaskModel,
          "xhigh",
          "xhigh",
          promptReader
        )
      : (DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as AppConfig["providers"]["openai"]["reasoning_effort"]);
  const pdfAnalysisMode = await askPdfAnalysisMode(promptReader);
  const codexPdfModelChoice =
    llmMode === "codex_chatgpt_only" && pdfAnalysisMode === "codex_text_extract"
      ? await askCodexModel("PDF analysis model", codexTaskModelChoice, promptReader)
      : codexTaskModelChoice;
  const codexPdfReasoningEffort =
    llmMode === "codex_chatgpt_only" && pdfAnalysisMode === "codex_text_extract"
      ? await askCodexReasoningEffort(
          "PDF analysis reasoning effort",
          resolveCodexModelSelection(codexPdfModelChoice).model,
          codexTaskReasoningEffort,
          "xhigh",
          promptReader
        )
      : codexTaskReasoningEffort;
  const openAiPdfModel =
    llmMode === "openai_api" && pdfAnalysisMode === "codex_text_extract"
      ? await askOpenAiResponsesModel(
          "OpenAI API PDF text-analysis model",
          openAiTaskModel,
          promptReader
        )
      : openAiTaskModel;
  const openAiPdfReasoningEffort =
    llmMode === "openai_api" && pdfAnalysisMode === "codex_text_extract"
      ? await askOpenAiResponsesReasoningEffort(
          "PDF analysis reasoning effort",
          openAiPdfModel,
          openAiReasoningEffort,
          "xhigh",
          promptReader
        )
      : openAiReasoningEffort;
  const responsesPdfModel =
    pdfAnalysisMode === "responses_api_pdf"
      ? await askResponsesPdfModel(promptReader)
      : DEFAULT_RESPONSES_PDF_MODEL;
  const responsesPdfReasoningEffort =
    pdfAnalysisMode === "responses_api_pdf"
      ? await askOpenAiResponsesReasoningEffort(
          "PDF analysis reasoning effort",
          responsesPdfModel,
          "xhigh",
          "xhigh",
          promptReader
        )
      : ("xhigh" as AppConfig["analysis"]["responses_reasoning_effort"]);
  const existingApiKey = await resolveSemanticScholarApiKey(paths.cwd);
  const semanticScholarApiKey = await askApiKey(
    "Semantic Scholar API key",
    existingApiKey,
    promptReader
  );
  const existingOpenAiApiKey = await resolveOpenAiApiKey(paths.cwd);
  const openAiApiKey =
    llmMode === "openai_api" || pdfAnalysisMode === "responses_api_pdf"
      ? await askApiKey("OpenAI API key", existingOpenAiApiKey, promptReader)
      : undefined;

  const defaultConstraints = constraintsRaw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

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
    codexPdfModelChoice,
    codexPdfReasoningEffort,
    openAiChatModel,
    openAiChatReasoningEffort,
    openAiTaskModel,
    openAiReasoningEffort,
    openAiPdfModel,
    openAiPdfReasoningEffort,
    pdfAnalysisMode,
    responsesPdfModel,
    responsesPdfReasoningEffort
  });

  await saveConfig(paths, config);
  await upsertEnvVar(path.join(paths.cwd, ".env"), "SEMANTIC_SCHOLAR_API_KEY", semanticScholarApiKey.trim());
  if (openAiApiKey?.trim()) {
    await upsertEnvVar(path.join(paths.cwd, ".env"), "OPENAI_API_KEY", openAiApiKey.trim());
  }
  return config;
}

export async function runNonInteractiveSetup(
  paths: AppPaths,
  input: NonInteractiveSetupInput
): Promise<AppConfig> {
  const llmMode = input.llmMode || "codex_chatgpt_only";
  const pdfAnalysisMode = input.pdfAnalysisMode || "codex_text_extract";
  const defaultConstraints = (input.defaultConstraints || ["recent papers", "last 5 years"])
    .map((item) => item.trim())
    .filter(Boolean);

  const config = buildConfigFromWizardAnswers({
    projectName: (input.projectName || path.basename(paths.cwd)).trim() || path.basename(paths.cwd),
    defaultTopic: (input.defaultTopic || "Multi-agent collaboration").trim(),
    defaultConstraints,
    defaultObjectiveMetric: (input.defaultObjectiveMetric || "state-of-the-art reproducibility").trim(),
    llmMode,
    codexChatModelChoice: input.codexChatModelChoice || "gpt-5.3-codex",
    codexChatReasoningEffort: input.codexChatReasoningEffort || "low",
    codexTaskModelChoice: input.codexTaskModelChoice || "gpt-5.3-codex",
    codexTaskReasoningEffort: input.codexTaskReasoningEffort || "xhigh",
    codexPdfModelChoice: input.codexPdfModelChoice || input.codexTaskModelChoice || "gpt-5.3-codex",
    codexPdfReasoningEffort: input.codexPdfReasoningEffort || input.codexTaskReasoningEffort || "xhigh",
    openAiChatModel: input.openAiChatModel || DEFAULT_OPENAI_RESPONSES_MODEL,
    openAiChatReasoningEffort: input.openAiChatReasoningEffort || "low",
    openAiTaskModel: input.openAiTaskModel || DEFAULT_OPENAI_RESPONSES_MODEL,
    openAiReasoningEffort:
      input.openAiReasoningEffort ||
      (DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as AppConfig["providers"]["openai"]["reasoning_effort"]),
    openAiPdfModel: input.openAiPdfModel || input.openAiTaskModel || DEFAULT_OPENAI_RESPONSES_MODEL,
    openAiPdfReasoningEffort:
      input.openAiPdfReasoningEffort ||
      input.openAiReasoningEffort ||
      (DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as AppConfig["providers"]["openai"]["reasoning_effort"]),
    pdfAnalysisMode,
    responsesPdfModel: input.responsesPdfModel || DEFAULT_RESPONSES_PDF_MODEL,
    responsesPdfReasoningEffort: input.responsesPdfReasoningEffort || "xhigh"
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
    throw new Error("Invalid config: providers.codex is missing");
  }
  if (!config.providers.openai) {
    config.providers.openai = {
      model: DEFAULT_OPENAI_RESPONSES_MODEL,
      chat_model: DEFAULT_OPENAI_RESPONSES_MODEL,
      pdf_model: DEFAULT_OPENAI_RESPONSES_MODEL,
      reasoning_effort: DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as AppConfig["providers"]["openai"]["reasoning_effort"],
      chat_reasoning_effort: "low",
      pdf_reasoning_effort: DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as AppConfig["providers"]["openai"]["reasoning_effort"],
      command_reasoning_effort: "low",
      api_key_required: true
    };
  }
  if (!config.papers) {
    throw new Error("Invalid config: papers is missing");
  }
  if (!config.analysis) {
    config.analysis = {
      pdf_mode: "codex_text_extract",
      responses_model: DEFAULT_RESPONSES_PDF_MODEL,
      responses_reasoning_effort: "xhigh"
    };
  }

  const codex = config.providers.codex;
  const openai = config.providers.openai;
  const analysis = config.analysis;
  const papers = config.papers;
  config.providers.llm_mode = normalizePrimaryLlmMode(config.providers.llm_mode);
  if (!codex.model) {
    codex.model = "gpt-5.3-codex";
  }
  codex.chat_model = codex.chat_model?.trim() || codex.model;
  codex.pdf_model = codex.pdf_model?.trim() || codex.model;
  if (!codex.reasoning_effort) {
    codex.reasoning_effort = "xhigh";
  }
  codex.chat_reasoning_effort =
    normalizeReasoningEffortForModel(
      codex.chat_model,
      codex.chat_reasoning_effort || codex.command_reasoning_effort || "low"
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
  if (typeof codex.pdf_fast_mode !== "boolean") {
    codex.pdf_fast_mode = false;
  }
  if (codex.model !== "gpt-5.4") {
    codex.fast_mode = false;
  }
  if (codex.chat_model !== "gpt-5.4") {
    codex.chat_fast_mode = false;
  }
  if (codex.pdf_model !== "gpt-5.4") {
    codex.pdf_fast_mode = false;
  }
  codex.reasoning_effort = normalizeReasoningEffortForModel(codex.model, codex.reasoning_effort);
  codex.command_reasoning_effort = normalizeReasoningEffortForModel(codex.model, codex.command_reasoning_effort);
  codex.chat_reasoning_effort = normalizeReasoningEffortForModel(codex.chat_model, codex.chat_reasoning_effort);
  codex.pdf_reasoning_effort = normalizeReasoningEffortForModel(codex.pdf_model, codex.pdf_reasoning_effort);
  codex.command_reasoning_effort = codex.chat_reasoning_effort;
  openai.model = normalizeOpenAiResponsesModel(openai.model);
  openai.chat_model = normalizeOpenAiResponsesModel(openai.chat_model || openai.model);
  openai.pdf_model = normalizeOpenAiResponsesModel(openai.pdf_model || openai.model);
  openai.reasoning_effort = normalizeOpenAiResponsesReasoningEffort(
    openai.model,
    openai.reasoning_effort
  ) as AppConfig["providers"]["openai"]["reasoning_effort"];
  openai.chat_reasoning_effort = normalizeOpenAiResponsesReasoningEffort(
    openai.chat_model,
    openai.chat_reasoning_effort || openai.command_reasoning_effort || "low"
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

function normalizePdfAnalysisMode(value: unknown): "codex_text_extract" | "responses_api_pdf" {
  return value === "responses_api_pdf" ? value : "codex_text_extract";
}

function normalizePrimaryLlmMode(value: unknown): "codex_chatgpt_only" | "openai_api" {
  return value === "openai_api" ? value : "codex_chatgpt_only";
}

async function askPrimaryLlmMode(
  promptReader: PromptReader = askLine
): Promise<"codex_chatgpt_only" | "openai_api"> {
  if (promptReader === askLine) {
    const answer = await askChoice(
      "Primary LLM provider",
      [
        {
          label: "codex",
          value: "codex_chatgpt_only",
          description: "(ChatGPT sign-in)"
        },
        {
          label: "api",
          value: "openai_api",
          description: "(OPENAI_API_KEY required)"
        }
      ],
      "codex_chatgpt_only"
    );
    return answer === "openai_api" ? "openai_api" : "codex_chatgpt_only";
  }

  while (true) {
    const answer = (await promptReader("Primary LLM provider (codex/api)", "codex")).trim().toLowerCase();
    if (!answer || answer === "codex" || answer === "chatgpt" || answer === "codex_chatgpt_only") {
      return "codex_chatgpt_only";
    }
    if (answer === "api" || answer === "openai" || answer === "openai_api") {
      return "openai_api";
    }
    output.write("Primary LLM provider must be 'codex' or 'api'.\n");
  }
}

async function askPdfAnalysisMode(
  promptReader: PromptReader = askLine
): Promise<"codex_text_extract" | "responses_api_pdf"> {
  if (promptReader === askLine) {
    const answer = await askChoice(
      "PDF analysis mode",
      [
        {
          label: "codex",
          value: "codex_text_extract",
          description: "(local text extraction)"
        },
        {
          label: "api",
          value: "responses_api_pdf",
          description: "(Responses API PDF)"
        }
      ],
      "codex_text_extract"
    );
    return answer === "responses_api_pdf" ? "responses_api_pdf" : "codex_text_extract";
  }

  while (true) {
    const answer = (await promptReader("PDF analysis mode (codex/api)", "codex")).trim().toLowerCase();
    if (!answer || answer === "codex") {
      return "codex_text_extract";
    }
    if (answer === "api" || answer === "responses" || answer === "responses_api_pdf") {
      return "responses_api_pdf";
    }
    output.write("PDF analysis mode must be 'codex' or 'api'.\n");
  }
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
  promptReader: PromptReader = askLine
): Promise<string> {
  if (promptReader === askLine) {
    return askChoice(
      label,
      buildCodexModelSelectionChoices(defaultValue).map((choice) => ({
        label: choice,
        value: choice,
        description: getCodexModelSelectionDescription(choice)
          ? `(${getCodexModelSelectionDescription(choice)})`
          : undefined
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

async function askResponsesPdfModel(
  promptReader: PromptReader = askLine
): Promise<string> {
  if (promptReader === askLine) {
    return askChoice(
      "Responses API PDF model",
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
    const answer = (await promptReader("Responses API PDF model", DEFAULT_RESPONSES_PDF_MODEL)).trim();
    if (!answer) {
      return DEFAULT_RESPONSES_PDF_MODEL;
    }
    if (choices.includes(answer)) {
      return answer;
    }
    output.write(`Responses API PDF model must be one of: ${display}.\n`);
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
