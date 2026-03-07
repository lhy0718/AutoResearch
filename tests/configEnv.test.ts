import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  ensureScaffold,
  hasSemanticScholarApiKey,
  loadConfig,
  resolveAppPaths,
  resolveSemanticScholarApiKey,
  saveConfig,
  upsertEnvVar
} from "../src/config.js";
import { AppConfig } from "../src/types.js";

const ORIGINAL_SEMANTIC_SCHOLAR_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY;

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
      }
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
});
