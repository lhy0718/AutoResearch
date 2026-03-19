import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import { runDoctorReport } from "../src/core/doctor.js";
import { resolveExperimentLlmProfile } from "../src/core/experimentLlmProfile.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { RunStore } from "../src/core/runs/runStore.js";
import { InteractionSession } from "../src/interaction/InteractionSession.js";
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_CHAT_MODEL } from "../src/integrations/ollama/modelCatalog.js";
import { CodexCliClient } from "../src/integrations/codex/codexCliClient.js";
import { TerminalApp } from "../src/tui/TerminalApp.js";
import { AppConfig } from "../src/types.js";

const ORIGINAL_FAKE_OLLAMA = process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE;

afterEach(() => {
  if (ORIGINAL_FAKE_OLLAMA === undefined) {
    delete process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE;
  } else {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = ORIGINAL_FAKE_OLLAMA;
  }
});

function makeOllamaConfig(): AppConfig {
  return {
    version: 1,
    project_name: "provider-routing-test",
    providers: {
      llm_mode: "ollama",
      codex: {
        model: "gpt-5.4",
        chat_model: "gpt-5.4",
        experiment_model: "gpt-5.4",
        pdf_model: "gpt-5.4",
        reasoning_effort: "high",
        chat_reasoning_effort: "low",
        experiment_reasoning_effort: "high",
        pdf_reasoning_effort: "high",
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
        reasoning_effort: "high",
        chat_reasoning_effort: "low",
        experiment_reasoning_effort: "high",
        pdf_reasoning_effort: "high",
        command_reasoning_effort: "low",
        api_key_required: true
      },
      ollama: {
        base_url: DEFAULT_OLLAMA_BASE_URL,
        chat_model: DEFAULT_OLLAMA_CHAT_MODEL,
        research_model: "qwen3.5:35b-a3b",
        experiment_model: "qwen3.5-coder:30b-a3b",
        vision_model: "qwen3.5:35b-a3b"
      }
    },
    analysis: {
      responses_model: "gpt-5.4",
      responses_reasoning_effort: "high"
    },
    papers: { max_results: 100, per_second_limit: 1 },
    research: {
      default_topic: "Efficient Test-Time Reasoning for Small Language Models",
      default_constraints: ["recent papers"],
      default_objective_metric: "accuracy"
    },
    workflow: { mode: "agent_approval", wizard_enabled: true, approval_mode: "minimal" },
    experiments: { runner: "local_python", timeout_sec: 3600, allow_network: false },
    paper: { template: "acl", build_pdf: true, latex_engine: "auto_install" },
    paper_profile: {
      venue_style: "acl_long",
      main_page_limit: 8,
      references_counted: false,
      appendix_allowed: true,
      appendix_format: "double_column",
      prefer_appendix_for: []
    },
    paths: { runs_dir: ".autolabos/runs", logs_dir: ".autolabos/logs" }
  };
}

function makeTerminalApp(config: AppConfig, codex: CodexCliClient): TerminalApp {
  const app = new TerminalApp({
    config,
    runStore: {} as any,
    titleGenerator: {} as any,
    codex,
    eventStream: { subscribe: () => () => {} } as any,
    orchestrator: {} as any,
    semanticScholarApiKeyConfigured: false,
    onQuit: () => {},
    saveConfig: async () => {}
  }) as any;
  app.render = () => {};
  app.updateSuggestions = () => {};
  app.drainQueuedInputs = async () => {};
  app.interactiveSupervisor = {
    getActiveRequest: vi.fn().mockResolvedValue(undefined)
  };
  return app as TerminalApp;
}

describe("provider routing consistency", () => {
  it("resolves the ollama experiment profile from the configured experiment slot", () => {
    const profile = resolveExperimentLlmProfile(makeOllamaConfig());
    expect(profile).toEqual({
      provider: "ollama",
      model: "qwen3.5-coder:30b-a3b",
      reasoningEffort: "medium",
      fastMode: false
    });
  });

  it("skips Codex doctor checks when neither the primary provider nor PDF path uses Codex", async () => {
    const fakeCodex = {
      checkCliAvailable: vi.fn().mockResolvedValue({ ok: true, detail: "available" }),
      checkLoginStatus: vi.fn().mockResolvedValue({ ok: true, detail: "logged in" }),
      checkEnvironmentReadiness: vi.fn().mockResolvedValue([])
    };

    const report = await runDoctorReport(fakeCodex as any, {
      llmMode: "ollama",
      pdfAnalysisMode: "ollama_vision",
      ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL,
      includeHarnessValidation: false
    });

    expect(report.checks.map((check) => check.name)).not.toContain("codex-cli");
    expect(report.checks.map((check) => check.name)).not.toContain("codex-login");
    expect(fakeCodex.checkCliAvailable).not.toHaveBeenCalled();
    expect(fakeCodex.checkLoginStatus).not.toHaveBeenCalled();
    expect(fakeCodex.checkEnvironmentReadiness).not.toHaveBeenCalled();
  });

  it("routes InteractionSession command intent through Ollama without falling back to Codex", async () => {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = "ollama-command-output";
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-provider-routing-session-"));
    const paths = resolveAppPaths(workspace);
    await ensureScaffold(paths);
    const runStore = new RunStore(paths);
    const codex = {
      runTurnStream: vi.fn(async () => {
        throw new Error("Codex should not be used when llm_mode=ollama");
      })
    } as unknown as CodexCliClient;
    const session = new InteractionSession({
      workspaceRoot: workspace,
      config: makeOllamaConfig(),
      runStore,
      titleGenerator: {} as any,
      codex,
      eventStream: new InMemoryEventStream(),
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: true
    });

    const client = (session as any).getCommandIntentClient();
    const text = await client.runForText({ prompt: "help me collect papers" });

    expect(text).toBe("ollama-command-output");
    expect((codex.runTurnStream as any).mock.calls).toHaveLength(0);
  });

  it("routes TerminalApp natural assistant through Ollama without falling back to Codex", async () => {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = "ollama-natural-output";
    const codex = {
      runTurnStream: vi.fn(async () => {
        throw new Error("Codex should not be used when llm_mode=ollama");
      }),
      runForText: vi.fn(async () => {
        throw new Error("Codex should not be used when llm_mode=ollama");
      })
    } as unknown as CodexCliClient;
    const app = makeTerminalApp(makeOllamaConfig(), codex);

    const client = (app as any).getNaturalAssistantClient();
    const text = await client.runForText({ prompt: "what can I do here?" });

    expect(text).toBe("ollama-natural-output");
    expect((codex.runTurnStream as any).mock.calls).toHaveLength(0);
    expect((codex.runForText as any).mock.calls).toHaveLength(0);
  });
});
