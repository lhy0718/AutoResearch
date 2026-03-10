import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  ensureScaffold,
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
import { DEFAULT_RESPONSES_PDF_MODEL } from "../src/integrations/openai/pdfModelCatalog.js";
import { AppConfig } from "../src/types.js";

const ORIGINAL_SEMANTIC_SCHOLAR_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY;
const ORIGINAL_OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
        pdf_reasoning_effort: "xhigh",
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
        pdf_reasoning_effort: "medium",
        command_reasoning_effort: "low",
        api_key_required: true
      }
    },
    analysis: {
      pdf_mode: "codex_text_image_hybrid",
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
  it("uses SEMANTIC_SCHOLAR_API_KEY from .env when config.yaml is empty", async () => {
    delete process.env.SEMANTIC_SCHOLAR_API_KEY;
    const { cwd, paths } = await createWorkspace();
    await fs.writeFile(path.join(cwd, ".env"), 'SEMANTIC_SCHOLAR_API_KEY="env-test-key"\n', "utf8");

    const config = await loadConfig(paths);

    expect("semantic_scholar_api_key" in config.papers).toBe(false);
    await expect(resolveSemanticScholarApiKey(cwd)).resolves.toBe("env-test-key");
    await expect(hasSemanticScholarApiKey(cwd)).resolves.toBe(true);
  });

  it("prefers process.env over .env for Semantic Scholar API key", async () => {
    process.env.SEMANTIC_SCHOLAR_API_KEY = "process-env-key";
    const { cwd, paths } = await createWorkspace();
    await fs.writeFile(path.join(cwd, ".env"), "SEMANTIC_SCHOLAR_API_KEY=file-env-key\n", "utf8");

    const config = await loadConfig(paths);

    expect("semantic_scholar_api_key" in config.papers).toBe(false);
    await expect(resolveSemanticScholarApiKey(cwd)).resolves.toBe("process-env-key");
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

  it("requires a Semantic Scholar API key during first-run setup", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-setup-required-key-"));
    const paths = resolveAppPaths(cwd);
    const answers = [
      "project",
      "Multi-agent collaboration",
      "recent papers,last 5 years",
      "reproducibility",
      "codex",
      "gpt-5.3-codex",
      "low",
      "gpt-5.3-codex",
      "xhigh",
      "codex",
      "gpt-5.3-codex",
      "xhigh",
      "   ",
      "required-key"
    ];

    const config = await runSetupWizard(paths, makePromptReaderFromAnswers(answers));

    expect(config.project_name).toBe("project");
    await expect(resolveSemanticScholarApiKey(cwd)).resolves.toBe("required-key");
    await expect(fs.readFile(paths.configFile, "utf8")).resolves.toContain("project_name: project");
  });

  it("uses OPENAI_API_KEY from .env when Responses PDF mode is enabled", async () => {
    delete process.env.OPENAI_API_KEY;
    const { cwd } = await createWorkspace();
    await fs.writeFile(path.join(cwd, ".env"), 'OPENAI_API_KEY="openai-env-key"\n', "utf8");

    await expect(resolveOpenAiApiKey(cwd)).resolves.toBe("openai-env-key");
    await expect(hasOpenAiApiKey(cwd)).resolves.toBe(true);
  });

  it("writes OPENAI_API_KEY during setup when Responses PDF mode is selected", async () => {
    delete process.env.OPENAI_API_KEY;
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-setup-openai-key-"));
    const paths = resolveAppPaths(cwd);
    const config = await runSetupWizard(
      paths,
      makePromptReaderFromQuestionMap({
        "Project name": "project",
        "Default research topic": "Multi-agent collaboration",
        "Default constraints (comma-separated)": "recent papers,last 5 years",
        "Default objective metric": "reproducibility",
        "Primary LLM provider (codex/api)": "codex",
        "General chat model": "gpt-5.3-codex",
        "General chat reasoning effort": "low",
        "Analysis/hypothesis model": "gpt-5.3-codex",
        "Analysis/hypothesis reasoning effort": "xhigh",
        "PDF analysis mode (codex/api)": "api",
        "Responses API PDF model": "gpt-4o",
        "Semantic Scholar API key": "semantic-key",
        "OpenAI API key": "openai-key"
      })
    );

    expect(config.analysis.pdf_mode).toBe("responses_api_pdf");
    expect(config.analysis.responses_model).toBe("gpt-4o");
    await expect(resolveOpenAiApiKey(cwd)).resolves.toBe("openai-key");
    await expect(fs.readFile(path.join(cwd, ".env"), "utf8")).resolves.toContain('OPENAI_API_KEY="openai-key"');
  });

  it("supports non-interactive setup for the web onboarding flow", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-web-setup-"));
    const paths = resolveAppPaths(cwd);

    const config = await runNonInteractiveSetup(paths, {
      projectName: "web-project",
      defaultTopic: "Agent planning",
      defaultConstraints: ["recent papers", "benchmarks"],
      defaultObjectiveMetric: "sample efficiency",
      llmMode: "openai_api",
      pdfAnalysisMode: "responses_api_pdf",
      semanticScholarApiKey: "semantic-key",
      openAiApiKey: "openai-key"
    });

    expect(config.project_name).toBe("web-project");
    expect(config.providers.llm_mode).toBe("openai_api");
    expect(config.analysis.pdf_mode).toBe("responses_api_pdf");
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
      pdfAnalysisMode: "codex_text_image_hybrid",
      semanticScholarApiKey: "semantic-key",
      codexTaskModelChoice: "gpt-5.3-codex",
      codexTaskReasoningEffort: "high",
      codexExperimentModelChoice: "gpt-5.4 (fast)",
      codexExperimentReasoningEffort: "xhigh"
    });

    expect(config.providers.codex.model).toBe("gpt-5.3-codex");
    expect(config.providers.codex.experiment_model).toBe("gpt-5.4");
    expect(config.providers.codex.experiment_fast_mode).toBe(true);
    expect(config.providers.codex.experiment_reasoning_effort).toBe("xhigh");
  });

  it("still asks for API keys during setup even when existing .env keys are present", async () => {
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
        "Project name": "project",
        "Default research topic": "Multi-agent collaboration",
        "Default constraints (comma-separated)": "recent papers,last 5 years",
        "Default objective metric": "reproducibility",
        "Primary LLM provider (codex/api)": "api",
        "OpenAI API general chat model": "gpt-5.4",
        "General chat reasoning effort": "low",
        "OpenAI API analysis/hypothesis model": "gpt-5-mini",
        "Analysis/hypothesis reasoning effort": "high",
        "PDF analysis mode (codex/api)": "api",
        "Responses API PDF model": "gpt-4o",
        "Semantic Scholar API key": "",
        "OpenAI API key": ""
      })(question, defaultValue);
    });

    expect(config.providers.llm_mode).toBe("openai_api");
    expect(config.providers.openai.command_reasoning_effort).toBe("low");
    expect(config.providers.openai.reasoning_effort).toBe("high");
    expect(config.analysis.pdf_mode).toBe("responses_api_pdf");
    expect(asked).toContain("Semantic Scholar API key (press Enter to keep existing)");
    expect(asked).toContain("OpenAI API key (press Enter to keep existing)");
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
        "Project name": "project",
        "Default research topic": "Multi-agent collaboration",
        "Default constraints (comma-separated)": "recent papers,last 5 years",
        "Default objective metric": "reproducibility",
        "Primary LLM provider (codex/api)": "api",
        "OpenAI API general chat model": "gpt-5-mini",
        "General chat reasoning effort": "low",
        "OpenAI API analysis/hypothesis model": "gpt-5-mini",
        "Analysis/hypothesis reasoning effort": "xhigh",
        "PDF analysis mode (codex/api)": "codex",
        "OpenAI API PDF text-analysis model": "gpt-5-mini",
        "PDF analysis reasoning effort": "xhigh",
        "Semantic Scholar API key": "semantic-key",
        "OpenAI API key": "openai-key"
      })
    );

    expect(config.providers.llm_mode).toBe("openai_api");
    expect(config.providers.openai.model).toBe("gpt-5-mini");
    expect(config.providers.openai.command_reasoning_effort).toBe("low");
    expect(config.providers.openai.reasoning_effort).toBe("xhigh");
    await expect(resolveOpenAiApiKey(cwd)).resolves.toBe("openai-key");
  });

  it("normalizes unsupported Responses API PDF models to the default", async () => {
    const { paths } = await createWorkspace();
    const config = makeConfig();
    config.analysis.pdf_mode = "responses_api_pdf";
    config.analysis.responses_model = "unsupported-model";
    await saveConfig(paths, config);

    const loaded = await loadConfig(paths);

    expect(loaded.analysis.responses_model).toBe(DEFAULT_RESPONSES_PDF_MODEL);
    expect(loaded.providers.openai.model).toBe("gpt-5.4");
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
