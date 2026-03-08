import path from "node:path";
import { promises as fs } from "node:fs";
import { stdout as output } from "node:process";
import YAML from "yaml";

import { AppConfig, RunsFile } from "./types.js";
import { normalizeReasoningEffortForModel } from "./integrations/codex/modelCatalog.js";
import {
  DEFAULT_RESPONSES_PDF_MODEL,
  buildResponsesPdfModelChoices,
  normalizeResponsesPdfModel
} from "./integrations/openai/pdfModelCatalog.js";
import {
  DEFAULT_OPENAI_RESPONSES_MODEL,
  DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT,
  buildOpenAiResponsesModelChoices,
  normalizeOpenAiResponsesModel,
  normalizeOpenAiResponsesReasoningEffort
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
  openAiModel: string;
  pdfAnalysisMode: "codex_text_extract" | "responses_api_pdf";
  responsesPdfModel: string;
}): AppConfig {
  return {
    version: 1,
    project_name: answers.projectName,
    providers: {
      llm_mode: answers.llmMode,
      codex: {
        model: "gpt-5.3-codex",
        reasoning_effort: "xhigh",
        fast_mode: false,
        auth_required: true
      },
      openai: {
        model: answers.openAiModel,
        reasoning_effort: DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as
          AppConfig["providers"]["openai"]["reasoning_effort"],
        api_key_required: true
      }
    },
    analysis: {
      pdf_mode: answers.pdfAnalysisMode,
      responses_model: answers.responsesPdfModel
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
  writePrimaryLlmTradeoffGuidance();
  const llmMode = await askPrimaryLlmMode(promptReader);
  const openAiModel =
    llmMode === "openai_api"
      ? await askOpenAiResponsesModel(promptReader)
      : DEFAULT_OPENAI_RESPONSES_MODEL;
  writePdfAnalysisTradeoffGuidance();
  const pdfAnalysisMode = await askPdfAnalysisMode(promptReader);
  const responsesPdfModel =
    pdfAnalysisMode === "responses_api_pdf"
      ? await askResponsesPdfModel(promptReader)
      : DEFAULT_RESPONSES_PDF_MODEL;
  const existingApiKey = await resolveSemanticScholarApiKey(paths.cwd);
  const semanticScholarApiKey =
    existingApiKey ||
    (await askRequiredLine("Semantic Scholar API key", promptReader));
  const existingOpenAiApiKey = await resolveOpenAiApiKey(paths.cwd);
  const openAiApiKey =
    llmMode === "openai_api" || pdfAnalysisMode === "responses_api_pdf"
      ? existingOpenAiApiKey || (await askRequiredLine("OpenAI API key", promptReader))
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
    openAiModel,
    pdfAnalysisMode,
    responsesPdfModel
  });

  await saveConfig(paths, config);
  await upsertEnvVar(path.join(paths.cwd, ".env"), "SEMANTIC_SCHOLAR_API_KEY", semanticScholarApiKey.trim());
  if (openAiApiKey?.trim()) {
    await upsertEnvVar(path.join(paths.cwd, ".env"), "OPENAI_API_KEY", openAiApiKey.trim());
  }
  return config;
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
      reasoning_effort: DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT as AppConfig["providers"]["openai"]["reasoning_effort"],
      api_key_required: true
    };
  }
  if (!config.papers) {
    throw new Error("Invalid config: papers is missing");
  }
  if (!config.analysis) {
    config.analysis = {
      pdf_mode: "codex_text_extract",
      responses_model: DEFAULT_RESPONSES_PDF_MODEL
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
  if (!codex.reasoning_effort) {
    codex.reasoning_effort = "xhigh";
  }
  if (typeof codex.fast_mode !== "boolean") {
    codex.fast_mode = false;
  }
  if (codex.model !== "gpt-5.4") {
    codex.fast_mode = false;
  }
  codex.reasoning_effort = normalizeReasoningEffortForModel(codex.model, codex.reasoning_effort);
  openai.model = normalizeOpenAiResponsesModel(openai.model);
  openai.reasoning_effort = normalizeOpenAiResponsesReasoningEffort(
    openai.model,
    openai.reasoning_effort
  ) as AppConfig["providers"]["openai"]["reasoning_effort"];
  openai.api_key_required = true;
  config.papers = {
    max_results: Math.max(1, papers.max_results || 200),
    per_second_limit: Math.max(1, papers.per_second_limit || 1)
  };
  config.analysis = {
    pdf_mode: normalizePdfAnalysisMode(analysis.pdf_mode),
    responses_model: normalizeResponsesPdfModel(analysis.responses_model)
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

function writePrimaryLlmTradeoffGuidance(): void {
  output.write(
    [
      "Primary LLM provider trade-off:",
      "- codex: uses Sign in with ChatGPT, no OpenAI API key needed, best fit for interactive coding and implement_experiments.",
      "- api: uses OpenAI API models, requires OPENAI_API_KEY, easier to control model choice and structured API behavior, but API usage is billed separately.",
      ""
    ].join("\n")
  );
}

function writePdfAnalysisTradeoffGuidance(): void {
  output.write(
    [
      "PDF analysis trade-off:",
      "- codex: downloads PDFs locally and extracts text with local tools; cheaper to operate inside the current Codex flow, but extraction quality depends on local tooling.",
      "- api: sends PDFs to the OpenAI Responses API; usually better document understanding, but slower and requires OPENAI_API_KEY.",
      ""
    ].join("\n")
  );
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
          description: "(ChatGPT sign-in, best for interactive coding)"
        },
        {
          label: "api",
          value: "openai_api",
          description: "(OPENAI_API_KEY required, direct API control)"
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
          description: "(local PDF download + text extraction)"
        },
        {
          label: "api",
          value: "responses_api_pdf",
          description: "(Responses API PDF input, richer but slower)"
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
  promptReader: PromptReader = askLine
): Promise<string> {
  const choices = buildOpenAiResponsesModelChoices();
  const display = choices.join(", ");
  while (true) {
    const answer = (await promptReader("OpenAI API model", DEFAULT_OPENAI_RESPONSES_MODEL)).trim();
    if (!answer) {
      return DEFAULT_OPENAI_RESPONSES_MODEL;
    }
    if (choices.includes(answer)) {
      return answer;
    }
    output.write(`OpenAI API model must be one of: ${display}.\n`);
  }
}

async function askResponsesPdfModel(
  promptReader: PromptReader = askLine
): Promise<string> {
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
