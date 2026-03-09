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
  runSetupWizard,
  saveConfig,
  upsertEnvVar
} from "../src/config.js";
import { DEFAULT_RESPONSES_PDF_MODEL } from "../src/integrations/openai/pdfModelCatalog.js";
import { AppConfig } from "../src/types.js";

const ORIGINAL_SEMANTIC_SCHOLAR_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY;
const ORIGINAL_OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function makeConfig(): AppConfig {
  return {
    version: 1,
    project_name: "test",
    providers: {
      llm_mode: "codex_chatgpt_only",
      codex: {
        model: "gpt-5.3-codex",
        reasoning_effort: "xhigh",
        fast_mode: false,
        auth_required: true
      },
      openai: {
        model: "gpt-5.4",
        reasoning_effort: "medium",
        command_reasoning_effort: "low",
        api_key_required: true
      }
    },
    analysis: {
      pdf_mode: "codex_text_extract",
      responses_model: "gpt-5.4"
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
      runs_dir: ".autoresearch/runs",
      logs_dir: ".autoresearch/logs"
    }
  };
}

async function createWorkspace(): Promise<{ cwd: string; paths: ReturnType<typeof resolveAppPaths> }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autoresearch-config-env-"));
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
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autoresearch-setup-required-key-"));
    const paths = resolveAppPaths(cwd);
    const answers = [
      "project",
      "Multi-agent collaboration",
      "recent papers,last 5 years",
      "reproducibility",
      "codex",
      "low",
      "xhigh",
      "codex",
      "   ",
      "required-key"
    ];

    const config = await runSetupWizard(paths, async (_question, defaultValue = "") => {
      const answer = answers.shift();
      return answer !== undefined ? answer : defaultValue;
    });

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
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autoresearch-setup-openai-key-"));
    const paths = resolveAppPaths(cwd);
    const answers = [
      "project",
      "Multi-agent collaboration",
      "recent papers,last 5 years",
      "reproducibility",
      "codex",
      "low",
      "xhigh",
      "api",
      "gpt-4o",
      "semantic-key",
      "openai-key"
    ];

    const config = await runSetupWizard(paths, async (_question, defaultValue = "") => {
      const answer = answers.shift();
      return answer !== undefined ? answer : defaultValue;
    });

    expect(config.analysis.pdf_mode).toBe("responses_api_pdf");
    expect(config.analysis.responses_model).toBe("gpt-4o");
    await expect(resolveOpenAiApiKey(cwd)).resolves.toBe("openai-key");
    await expect(fs.readFile(path.join(cwd, ".env"), "utf8")).resolves.toContain('OPENAI_API_KEY="openai-key"');
  });

  it("still asks for API keys during setup even when existing .env keys are present", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autoresearch-setup-existing-keys-"));
    const paths = resolveAppPaths(cwd);
    await fs.writeFile(
      path.join(cwd, ".env"),
      'SEMANTIC_SCHOLAR_API_KEY="existing-semantic"\nOPENAI_API_KEY="existing-openai"\n',
      "utf8"
    );

    const asked: string[] = [];
    const answers = [
      "project",
      "Multi-agent collaboration",
      "recent papers,last 5 years",
      "reproducibility",
      "api",
      "low",
      "xhigh",
      "gpt-5-mini",
      "low",
      "high",
      "api",
      "gpt-4o",
      "",
      ""
    ];

    const config = await runSetupWizard(paths, async (question, defaultValue = "") => {
      asked.push(question);
      const answer = answers.shift();
      return answer !== undefined ? answer : defaultValue;
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
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autoresearch-setup-openai-provider-"));
    const paths = resolveAppPaths(cwd);
    const answers = [
      "project",
      "Multi-agent collaboration",
      "recent papers,last 5 years",
      "reproducibility",
      "api",
      "low",
      "xhigh",
      "gpt-5-mini",
      "low",
      "xhigh",
      "codex",
      "semantic-key",
      "openai-key"
    ];

    const config = await runSetupWizard(paths, async (_question, defaultValue = "") => {
      const answer = answers.shift();
      return answer !== undefined ? answer : defaultValue;
    });

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

  it("does not create .autoresearch if first-run setup aborts before completion", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autoresearch-setup-abort-"));
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
