import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ensureScaffold,
  getDefaultPdfAnalysisModeForLlmMode,
  hasOpenAiApiKey,
  hasSemanticScholarApiKey,
  loadConfig,
  resolveAppPaths,
  resolveOpenAiApiKey,
  resolveSemanticScholarApiKey,
  runNonInteractiveSetup,
  runSetupWizard,
  saveConfig,
  upsertEnvVar
} from "../src/config.js";
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_CHAT_MODEL,
  DEFAULT_OLLAMA_EXPERIMENT_MODEL,
  DEFAULT_OLLAMA_RESEARCH_MODEL,
  DEFAULT_OLLAMA_VISION_MODEL
} from "../src/integrations/ollama/modelCatalog.js";
import { AppConfig } from "../src/types.js";

const ORIGINAL_SEMANTIC_SCHOLAR_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY;
const ORIGINAL_OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function recordWizardQuestions(
  paths: ReturnType<typeof resolveAppPaths>,
  questionMap: Record<string, string>
): Promise<string[]> {
  const asked: string[] = [];
  await runSetupWizard(paths, async (question, defaultValue = "") => {
    asked.push(question);
    return makePromptReaderFromQuestionMap(questionMap)(question, defaultValue);
  });
  return asked;
}

function findQuestionIndex(asked: string[], prefix: string): number {
  return asked.findIndex((question) => question.startsWith(prefix));
}

function expectPromptOrder(asked: string[], prefixes: string[]): void {
  let previousIndex = -1;
  for (const prefix of prefixes) {
    const index = findQuestionIndex(asked, prefix);
    expect(index).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

function expectPromptAsked(asked: string[], prefix: string): void {
  expect(asked.some((question) => question.startsWith(prefix))).toBe(true);
}

function makePromptReaderFromAnswers(answers: string[]) {
  return async (_question: string, defaultValue = "") => {
    const answer = answers.shift();
    if (answer === undefined) {
      throw new Error(`Test prompt answers exhausted at question: ${_question}`);
    }
    return answer !== undefined ? answer : defaultValue;
  };
}

function makePromptReaderFromQuestionMap(
  questionMap: Record<string, string>
) {
  return async (question: string, defaultValue = "") => {
    const match = Object.entries(questionMap).find(([prefix]) => question.startsWith(prefix));
    if (match) {
      return match[1];
    }
    return defaultValue;
  };
}

function makeConfig(): AppConfig {
  return {
    version: 1,
    project_name: "test",
    providers: {
      llm_mode: "codex_chatgpt_only",
      codex: {
        model: "gpt-5.3-codex",
        chat_model: "gpt-5.3-codex",
        experiment_model: "gpt-5.3-codex",
        pdf_model: "gpt-5.3-codex",
        reasoning_effort: "xhigh",
        chat_reasoning_effort: "low",
        experiment_reasoning_effort: "xhigh",
        command_reasoning_effort: "low",
        fast_mode: false,
        chat_fast_mode: false,
        experiment_fast_mode: false,
        pdf_fast_mode: false,
        auth_required: true
      },
      openai: {
        model: "gpt-5.4",
        chat_model: "gpt-5.4",
        experiment_model: "gpt-5.4",
        pdf_model: "gpt-5.4",
        reasoning_effort: "medium",
        chat_reasoning_effort: "low",
        experiment_reasoning_effort: "medium",
        command_reasoning_effort: "low",
        api_key_required: true
      }
    },
    analysis: {
      responses_model: "gpt-5.4",
      responses_reasoning_effort: "xhigh"
    },
    papers: {
      max_results: 200,
      per_second_limit: 1
    },
    research: {
      default_topic: "Multi-agent collaboration",
      default_constraints: ["recent papers"],
      default_objective_metric: "reproducibility"
    },
    workflow: {
      mode: "agent_approval",
      wizard_enabled: true,
      approval_mode: "minimal"
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
      runs_dir: ".autolabos/runs",
      logs_dir: ".autolabos/logs"
    }
  };
}

async function createWorkspace(): Promise<{ cwd: string; paths: ReturnType<typeof resolveAppPaths> }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-config-env-"));
  const paths = resolveAppPaths(cwd);
  await ensureScaffold(paths);
  await saveConfig(paths, makeConfig());
  return { cwd, paths };
}

afterEach(() => {
  if (ORIGINAL_SEMANTIC_SCHOLAR_API_KEY === undefined) {
    delete process.env.SEMANTIC_SCHOLAR_API_KEY;
  } else {
    process.env.SEMANTIC_SCHOLAR_API_KEY = ORIGINAL_SEMANTIC_SCHOLAR_API_KEY;
  }

  if (ORIGINAL_OPENAI_API_KEY === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_API_KEY;
  }

});

describe("config .env overrides", () => {
  it("defaults workflow approval_mode to minimal when omitted", async () => {
    const { paths } = await createWorkspace();
    const config = makeConfig();
    delete config.workflow.approval_mode;
    await saveConfig(paths, config);

    const loaded = await loadConfig(paths);

    expect(loaded.workflow.approval_mode).toBe("minimal");
  });

  it("uses SEMANTIC_SCHOLAR_API_KEY from .env when config.yaml is empty", async () => {
    delete process.env.SEMANTIC_SCHOLAR_API_KEY;
    const { cwd, paths } = await createWorkspace();
    await fs.writeFile(path.join(cwd, ".env"), 'SEMANTIC_SCHOLAR_API_KEY="env-test-key"\n', "utf8");

    const config = await loadConfig(paths);

    expect("semantic_scholar_api_key" in config.papers).toBe(false);
    await expect(resolveSemanticScholarApiKey(cwd)).resolves.toBe("env-test-key");
    await expect(hasSemanticScholarApiKey(cwd)).resolves.toBe(true);
  });

  it("prefers .env over process.env for Semantic Scholar API key", async () => {
    process.env.SEMANTIC_SCHOLAR_API_KEY = "process-env-key";
    const { cwd, paths } = await createWorkspace();
    await fs.writeFile(path.join(cwd, ".env"), "SEMANTIC_SCHOLAR_API_KEY=file-env-key\n", "utf8");

    const config = await loadConfig(paths);

    expect("semantic_scholar_api_key" in config.papers).toBe(false);
    await expect(resolveSemanticScholarApiKey(cwd)).resolves.toBe("file-env-key");
  });

  it("upserts SEMANTIC_SCHOLAR_API_KEY into .env without removing other entries", async () => {
    const { cwd } = await createWorkspace();
    const envPath = path.join(cwd, ".env");
    await fs.writeFile(envPath, "FOO=bar\n", "utf8");

    await upsertEnvVar(envPath, "SEMANTIC_SCHOLAR_API_KEY", "wizard-key");

    const raw = await fs.readFile(envPath, "utf8");
    expect(raw).toContain("FOO=bar\n");
    expect(raw).toContain('SEMANTIC_SCHOLAR_API_KEY="wizard-key"');
  });

  it("derives the project name from the workspace and does not require a Semantic Scholar API key during first-run setup", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-setup-required-key-"));
    const paths = resolveAppPaths(cwd);
    const config = await runSetupWizard(
      paths,
      makePromptReaderFromQuestionMap({
        "Primary LLM provider (codex/api/ollama)": "codex",
        "General chat model": "gpt-5.3-codex",
        "General chat reasoning effort": "low",
        "Research backend model": "gpt-5.3-codex",
        "Research backend reasoning effort": "xhigh"
      })
    );

    expect(config.project_name).toBe(path.basename(cwd));
    await expect(resolveSemanticScholarApiKey(cwd)).resolves.toBeUndefined();
    await expect(fs.readFile(paths.configFile, "utf8")).resolves.toContain(`project_name: ${path.basename(cwd)}`);
  });

  it("uses OPENAI_API_KEY from .env when Responses PDF mode is enabled", async () => {
    delete process.env.OPENAI_API_KEY;
    const { cwd } = await createWorkspace();
    await fs.writeFile(path.join(cwd, ".env"), 'OPENAI_API_KEY="openai-env-key"\n', "utf8");

    await expect(resolveOpenAiApiKey(cwd)).resolves.toBe("openai-env-key");
    await expect(hasOpenAiApiKey(cwd)).resolves.toBe(true);
  });

  it("prefers .env over process.env for OpenAI API key", async () => {
    process.env.OPENAI_API_KEY = "process-env-openai-key";
    const { cwd } = await createWorkspace();
    await fs.writeFile(path.join(cwd, ".env"), 'OPENAI_API_KEY="file-env-openai-key"\n', "utf8");

    await expect(resolveOpenAiApiKey(cwd)).resolves.toBe("file-env-openai-key");
  });

  it("writes OPENAI_API_KEY during setup when OpenAI API provider implies Responses PDF mode", async () => {
    delete process.env.OPENAI_API_KEY;
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-setup-openai-key-"));
    const paths = resolveAppPaths(cwd);
    const config = await runSetupWizard(
      paths,
      makePromptReaderFromQuestionMap({
        "Primary LLM provider (codex/api/ollama)": "api",
        "OpenAI API general chat model": "gpt-5.4",
        "General chat reasoning effort": "low",
        "Research backend model": "gpt-5-mini",
        "Research backend reasoning effort": "xhigh",
        "OpenAI API key": "openai-key"
      })
    );

    expect(getDefaultPdfAnalysisModeForLlmMode(config.providers.llm_mode)).toBe("responses_api_pdf");
    expect(config.providers.openai.model).toBe("gpt-5-mini");
    expect(config.providers.openai.reasoning_effort).toBe("xhigh");
    await expect(resolveOpenAiApiKey(cwd)).resolves.toBe("openai-key");
    await expect(fs.readFile(path.join(cwd, ".env"), "utf8")).resolves.toContain('OPENAI_API_KEY="openai-key"');
  });

  it("defaults first-run setup to the current openai_api gpt-5.4 low/high configuration", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-setup-codex-defaults-"));
    const paths = resolveAppPaths(cwd);

    const config = await runSetupWizard(
      paths,
      makePromptReaderFromQuestionMap({
        "Primary LLM provider (codex/api/ollama)": "",
        "OpenAI API general chat model": "",
        "General chat reasoning effort": "",
        "Research backend model": "",
        "Research backend reasoning effort": "",
        "OpenAI API key": "openai-key"
      })
    );

    expect(config.providers.llm_mode).toBe("openai_api");
    expect(config.providers.openai.chat_model).toBe("gpt-5.4");
    expect(config.providers.openai.chat_reasoning_effort).toBe("low");
    expect(config.providers.openai.command_reasoning_effort).toBe("low");
    expect(config.providers.openai.model).toBe("gpt-5.4");
    expect(config.providers.openai.reasoning_effort).toBe("high");
    expect(config.providers.openai.experiment_model).toBe("gpt-5.4");
    expect(config.providers.openai.experiment_reasoning_effort).toBe("high");
  });

  it("asks OpenAI setup models before reasoning efforts and only once per slot", async () => {
    delete process.env.OPENAI_API_KEY;
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-setup-openai-order-"));
    const paths = resolveAppPaths(cwd);
    const asked = await recordWizardQuestions(paths, {
        "Primary LLM provider (codex/api/ollama)": "api",
        "OpenAI API general chat model": "gpt-5.4",
        "General chat reasoning effort": "low",
        "Research backend model": "gpt-5-mini",
        "Research backend reasoning effort": "high",
        "OpenAI API key": "openai-key"
      });

    expect(asked.filter((question) => question.startsWith("General chat reasoning effort"))).toHaveLength(1);
    expect(asked.filter((question) => question.startsWith("Research backend reasoning effort"))).toHaveLength(1);
    expectPromptAsked(asked, "OpenAI API general chat model");
    expectPromptAsked(asked, "Research backend model");
    expectPromptAsked(asked, "Research backend reasoning effort");
    expectPromptOrder(asked, [
      "OpenAI API general chat model",
      "General chat reasoning effort",
      "Research backend model",
      "Research backend reasoning effort"
    ]);
    expect(asked).not.toContain("Research backend PDF reasoning effort");
    expect(asked).not.toContain("Research backend Responses API PDF model");
  });

  it("asks Codex setup models before reasoning efforts and keeps research backend after chat", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-setup-codex-order-"));
    const paths = resolveAppPaths(cwd);
    const asked = await recordWizardQuestions(paths, {
        "Primary LLM provider (codex/api/ollama)": "codex",
        "General chat model": "gpt-5.3-codex",
        "General chat reasoning effort": "low",
        "Research backend model": "gpt-5.4",
        "Research backend reasoning effort": "xhigh"
      });

    expect(asked.filter((question) => question.startsWith("General chat model"))).toHaveLength(1);
    expect(asked.filter((question) => question.startsWith("General chat reasoning effort"))).toHaveLength(1);
    expect(asked.filter((question) => question.startsWith("Research backend model"))).toHaveLength(1);
    expect(asked.filter((question) => question.startsWith("Research backend reasoning effort"))).toHaveLength(1);
    expectPromptAsked(asked, "General chat model");
    expectPromptAsked(asked, "Research backend model");
    expectPromptAsked(asked, "Research backend reasoning effort");
    expectPromptOrder(asked, [
      "General chat model",
      "General chat reasoning effort",
      "Research backend model",
      "Research backend reasoning effort"
    ]);
    expect(asked).not.toContain("OpenAI API key");
  });

  it("asks Ollama setup prompts in base-url then chat then research then experiment then vision order", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-setup-ollama-order-"));
    const paths = resolveAppPaths(cwd);
    const asked = await recordWizardQuestions(paths, {
        "Primary LLM provider (codex/api/ollama)": "ollama",
        "Ollama base URL": DEFAULT_OLLAMA_BASE_URL,
        "Chat model": DEFAULT_OLLAMA_CHAT_MODEL,
        "Research backend model": DEFAULT_OLLAMA_RESEARCH_MODEL,
        "Experiment/code model": DEFAULT_OLLAMA_EXPERIMENT_MODEL,
        "Vision/PDF model": DEFAULT_OLLAMA_VISION_MODEL
      });

    expect(asked.filter((question) => question.startsWith("Ollama base URL"))).toHaveLength(1);
    expect(asked.filter((question) => question.startsWith("Chat model"))).toHaveLength(1);
    expect(asked.filter((question) => question.startsWith("Research backend model"))).toHaveLength(1);
    expect(asked.filter((question) => question.startsWith("Experiment/code model"))).toHaveLength(1);
    expect(asked.filter((question) => question.startsWith("Vision/PDF model"))).toHaveLength(1);
    expectPromptAsked(asked, "Research backend model");
    expectPromptOrder(asked, [
      "Ollama base URL",
      "Chat model",
      "Research backend model",
      "Experiment/code model",
      "Vision/PDF model"
    ]);
    expect(asked).not.toContain("General chat reasoning effort");
    expect(asked).not.toContain("Research backend reasoning effort");
  });

  it("guides the user to sign in later when Codex login is missing during setup", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-setup-codex-login-guidance-"));
    const paths = resolveAppPaths(cwd);
    const fakeCodexCli = {
      checkCliAvailable: vi.fn().mockResolvedValue({ ok: true, detail: "codex available" }),
      checkLoginStatus: vi.fn().mockResolvedValue({ ok: false, detail: "not logged in" })
    };
    const messages: string[] = [];

    await runSetupWizard(
      paths,
      makePromptReaderFromQuestionMap({
        "Primary LLM provider (codex/api/ollama)": "codex",
        "General chat model": "gpt-5.3-codex-spark",
        "General chat reasoning effort": "low",
        "Research backend model": "gpt-5.4",
        "Research backend reasoning effort": "xhigh"
      }),
      {
        codexCli: fakeCodexCli,
        outputWriter: {
          write: (message: string) => {
            messages.push(message);
            return true;
          }
        }
      }
    );

    expect(fakeCodexCli.checkCliAvailable).toHaveBeenCalledTimes(1);
    expect(fakeCodexCli.checkLoginStatus).toHaveBeenCalledTimes(1);
    expect(messages.join("")).toContain("sign in later with `codex login`");
    expect(messages.join("")).toContain("`/doctor`");
  });

  it("supports non-interactive setup for the web onboarding flow", async () => {
    delete process.env.OPENAI_API_KEY;
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-web-setup-"));
    const paths = resolveAppPaths(cwd);

    const config = await runNonInteractiveSetup(paths, {
      projectName: "web-project",
      defaultTopic: "Agent planning",
      defaultConstraints: ["recent papers", "benchmarks"],
      defaultObjectiveMetric: "sample efficiency",
      llmMode: "openai_api",
      semanticScholarApiKey: "semantic-key",
      openAiApiKey: "openai-key"
    });

    expect(config.project_name).toBe("web-project");
    expect(config.providers.llm_mode).toBe("openai_api");
    expect(getDefaultPdfAnalysisModeForLlmMode(config.providers.llm_mode)).toBe("responses_api_pdf");
    await expect(resolveSemanticScholarApiKey(cwd)).resolves.toBe("semantic-key");
    await expect(resolveOpenAiApiKey(cwd)).resolves.toBe("openai-key");
  });

  it("stores experiment model overrides during non-interactive setup", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-web-setup-experiment-model-"));
    const paths = resolveAppPaths(cwd);

    const config = await runNonInteractiveSetup(paths, {
      projectName: "web-project",
      defaultTopic: "Agent planning",
      defaultConstraints: ["recent papers"],
      defaultObjectiveMetric: "sample efficiency",
      llmMode: "codex_chatgpt_only",
      semanticScholarApiKey: "semantic-key",
      codexResearchBackendModelChoice: "gpt-5.3-codex",
      codexResearchBackendReasoningEffort: "high",
      codexExperimentModelChoice: "gpt-5.4 (fast)",
      codexExperimentReasoningEffort: "xhigh"
    });

    expect(config.providers.codex.model).toBe("gpt-5.3-codex");
    expect(config.providers.codex.experiment_model).toBe("gpt-5.4");
    expect(config.providers.codex.experiment_fast_mode).toBe(true);
    expect(config.providers.codex.experiment_reasoning_effort).toBe("xhigh");
  });

  it("still asks for API keys during setup even when existing .env keys are present", async () => {
    delete process.env.OPENAI_API_KEY;
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-setup-existing-keys-"));
    const paths = resolveAppPaths(cwd);
    await fs.writeFile(
      path.join(cwd, ".env"),
      'SEMANTIC_SCHOLAR_API_KEY="existing-semantic"\nOPENAI_API_KEY="existing-openai"\n',
      "utf8"
    );

    const asked: string[] = [];
    const config = await runSetupWizard(paths, async (question, defaultValue = "") => {
      asked.push(question);
      return makePromptReaderFromQuestionMap({
        "Primary LLM provider (codex/api/ollama)": "api",
        "OpenAI API general chat model": "gpt-5.4",
        "General chat reasoning effort": "low",
        "Research backend model": "gpt-5-mini",
        "Research backend reasoning effort": "high",
        "OpenAI API key": ""
      })(question, defaultValue);
    });

    expect(config.providers.llm_mode).toBe("openai_api");
    expect(config.providers.openai.command_reasoning_effort).toBe("low");
    expect(config.providers.openai.reasoning_effort).toBe("high");
    expect(getDefaultPdfAnalysisModeForLlmMode(config.providers.llm_mode)).toBe("responses_api_pdf");
    expect(asked).not.toContain("Research backend PDF mode (codex/api)");
    expect(asked).toContain("OpenAI API key (press Enter to keep existing)");
    expect(asked).not.toContain("Project name");
    expect(asked).not.toContain("Default research topic");
    await expect(resolveSemanticScholarApiKey(cwd)).resolves.toBe("existing-semantic");
    await expect(resolveOpenAiApiKey(cwd)).resolves.toBe("existing-openai");
  });

  it("writes OPENAI_API_KEY and OpenAI provider config during setup when API provider is selected", async () => {
    delete process.env.OPENAI_API_KEY;
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-setup-openai-provider-"));
    const paths = resolveAppPaths(cwd);
    const config = await runSetupWizard(
      paths,
      makePromptReaderFromQuestionMap({
        "Primary LLM provider (codex/api/ollama)": "api",
        "OpenAI API general chat model": "gpt-5-mini",
        "General chat reasoning effort": "low",
        "Research backend model": "gpt-5-mini",
        "Research backend reasoning effort": "xhigh",
        "OpenAI API key": "openai-key"
      })
    );

    expect(config.providers.llm_mode).toBe("openai_api");
    expect(config.providers.openai.model).toBe("gpt-5-mini");
    expect(config.providers.openai.command_reasoning_effort).toBe("low");
    expect(config.providers.openai.reasoning_effort).toBe("xhigh");
    await expect(resolveOpenAiApiKey(cwd)).resolves.toBe("openai-key");
  });

  it("normalizes Responses API PDF model to the OpenAI backend model", async () => {
    const { paths } = await createWorkspace();
    const config = makeConfig() as ReturnType<typeof makeConfig> & {
      analysis?: { responses_model?: string };
    };
    config.providers.llm_mode = "openai_api";
    config.providers.openai.model = "gpt-5-mini";
    config.analysis = { responses_model: "unsupported-model" };
    await saveConfig(paths, config as ReturnType<typeof makeConfig>);

    const loaded = await loadConfig(paths);

    expect(loaded.providers.openai.model).toBe("gpt-5-mini");
    expect((loaded as typeof loaded & { analysis?: unknown }).analysis).toBeUndefined();
  });

  it("collapses a separate OpenAI PDF slot back to the backend model when Responses PDF mode is enabled", async () => {
    const { paths } = await createWorkspace();
    const config = makeConfig() as ReturnType<typeof makeConfig> & {
      analysis?: { responses_model?: string; responses_reasoning_effort?: string };
      providers: ReturnType<typeof makeConfig>["providers"] & {
        openai: ReturnType<typeof makeConfig>["providers"]["openai"] & { pdf_model?: string };
      };
    };
    config.providers.llm_mode = "openai_api";
    config.analysis = { responses_model: "gpt-4o", responses_reasoning_effort: "xhigh" };
    config.providers.openai.pdf_model = "gpt-5-mini";
    await saveConfig(paths, config as ReturnType<typeof makeConfig>);

    const loaded = await loadConfig(paths);

    expect(loaded.providers.openai.model).toBe(config.providers.openai.model);
    expect((loaded.providers.openai as typeof loaded.providers.openai & { pdf_model?: unknown }).pdf_model).toBeUndefined();
    expect((loaded as typeof loaded & { analysis?: unknown }).analysis).toBeUndefined();
  });

  it("saves config without persisting a separate provider pdf mode or derived analysis block", async () => {
    const { paths } = await createWorkspace();
    const config = makeConfig();
    config.providers.llm_mode = "openai_api";
    await saveConfig(paths, config);

    const raw = await fs.readFile(paths.configFile, "utf8");
    expect(raw).toContain("providers:");
    expect(raw).not.toContain("\n  pdf:\n");
    expect(raw).not.toContain("\nanalysis:\n");

    const loaded = await loadConfig(paths);
    expect(getDefaultPdfAnalysisModeForLlmMode(loaded.providers.llm_mode)).toBe("responses_api_pdf");
  });

  it("does not create .autolabos if first-run setup aborts before completion", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-setup-abort-"));
    const paths = resolveAppPaths(cwd);
    let callCount = 0;

    await expect(
      runSetupWizard(paths, async (_question, defaultValue = "") => {
        callCount += 1;
        if (callCount === 3) {
          throw new Error("setup aborted");
        }
        return defaultValue || "value";
      })
    ).rejects.toThrow("setup aborted");

    await expect(fs.access(paths.rootDir)).rejects.toThrow();
    await expect(fs.access(path.join(cwd, ".env"))).rejects.toThrow();
  });
});
