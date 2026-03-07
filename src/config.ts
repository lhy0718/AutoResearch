import path from "node:path";
import { promises as fs } from "node:fs";
import YAML from "yaml";

import { AppConfig, RunsFile } from "./types.js";
import { normalizeReasoningEffortForModel } from "./integrations/codex/modelCatalog.js";
import { ensureDir, fileExists, writeJsonFile } from "./utils/fs.js";
import { askLine } from "./utils/prompt.js";

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
}): AppConfig {
  return {
    version: 1,
    project_name: answers.projectName,
    providers: {
      llm_mode: "codex_chatgpt_only",
      codex: {
        model: "gpt-5.3-codex",
        reasoning_effort: "xhigh",
        fast_mode: false,
        auth_required: true
      }
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

export async function runSetupWizard(paths: AppPaths): Promise<AppConfig> {
  const defaultProjectName = path.basename(paths.cwd);
  const projectName = await askLine("Project name", defaultProjectName);
  const defaultTopic = await askLine("Default research topic", "Multi-agent collaboration");
  const constraintsRaw = await askLine(
    "Default constraints (comma-separated)",
    "recent papers,last 5 years"
  );
  const defaultObjectiveMetric = await askLine(
    "Default objective metric",
    "state-of-the-art reproducibility"
  );
  const semanticScholarApiKey = await askLine("Semantic Scholar API key (optional)", "");

  const defaultConstraints = constraintsRaw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const config = buildConfigFromWizardAnswers({
    projectName,
    defaultTopic,
    defaultConstraints,
    defaultObjectiveMetric
  });

  await saveConfig(paths, config);
  if (semanticScholarApiKey.trim()) {
    await upsertEnvVar(path.join(paths.cwd, ".env"), "SEMANTIC_SCHOLAR_API_KEY", semanticScholarApiKey.trim());
  }
  await ensureScaffold(paths);
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
  if (!config.papers) {
    throw new Error("Invalid config: papers is missing");
  }

  const codex = config.providers.codex;
  const papers = config.papers;
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
  config.papers = {
    max_results: Math.max(1, papers.max_results || 200),
    per_second_limit: Math.max(1, papers.per_second_limit || 1)
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
