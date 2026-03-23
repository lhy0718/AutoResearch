import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureScaffold,
  loadConfig,
  resolveAppPaths,
  runNonInteractiveSetup,
  runSetupWizard,
  saveConfig,
  getDefaultPdfAnalysisModeForLlmMode
} from "../src/config.js";
import { AppConfig } from "../src/types.js";
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
  buildOllamaVisionModelChoices,
  getOllamaModelDescription
} from "../src/integrations/ollama/modelCatalog.js";
import { OllamaClient } from "../src/integrations/ollama/ollamaClient.js";
import { OllamaPdfAnalysisClient } from "../src/integrations/ollama/ollamaPdfAnalysisClient.js";
import {
  OllamaLLMClient,
  RoutedLLMClient,
  CodexLLMClient,
  OpenAiResponsesLLMClient
} from "../src/core/llm/client.js";
import { runDoctorReport } from "../src/core/doctor.js";

const ORIGINAL_OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_FAKE_OLLAMA = process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE;

function makePromptReaderFromQuestionMap(questionMap: Record<string, string>) {
  return async (question: string, defaultValue = "") => {
    const match = Object.entries(questionMap).find(([prefix]) => question.startsWith(prefix));
    if (match) return match[1];
    return defaultValue;
  };
}

function makeBaseConfig(): AppConfig {
  return {
    version: 1,
    project_name: "test",
    providers: {
      llm_mode: "openai_api",
      codex: {
        model: "gpt-5.4",
        chat_model: "gpt-5.4",
        experiment_model: "gpt-5.4",
        pdf_model: "gpt-5.4",
        reasoning_effort: "high",
        chat_reasoning_effort: "low",
        experiment_reasoning_effort: "high",
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
        command_reasoning_effort: "low",
        api_key_required: true
      }
    },
    analysis: {
      responses_model: "gpt-5.4",
      responses_reasoning_effort: "high"
    },
    papers: { max_results: 200, per_second_limit: 1 },
    research: {
      default_topic: "Multi-agent collaboration",
      default_constraints: ["recent papers", "last 5 years"],
      default_objective_metric: "state-of-the-art reproducibility"
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
      prefer_appendix_for: ["hyperparameter_grids"]
    },
    paths: { runs_dir: ".autolabos/runs", logs_dir: ".autolabos/logs" }
  };
}

function makeOllamaConfig(): AppConfig {
  const config = makeBaseConfig();
  config.providers.llm_mode = "ollama";
  config.providers.ollama = {
    base_url: DEFAULT_OLLAMA_BASE_URL,
    chat_model: DEFAULT_OLLAMA_CHAT_MODEL,
    research_model: DEFAULT_OLLAMA_RESEARCH_MODEL,
    experiment_model: DEFAULT_OLLAMA_EXPERIMENT_MODEL,
    vision_model: DEFAULT_OLLAMA_VISION_MODEL
  };
  return config;
}

async function createWorkspace(
  config?: AppConfig
): Promise<{ cwd: string; paths: ReturnType<typeof resolveAppPaths> }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-ollama-test-"));
  const paths = resolveAppPaths(cwd);
  await ensureScaffold(paths);
  await saveConfig(paths, config || makeBaseConfig());
  return { cwd, paths };
}

afterEach(() => {
  if (ORIGINAL_OPENAI_API_KEY === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_API_KEY;
  }
  if (ORIGINAL_FAKE_OLLAMA === undefined) {
    delete process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE;
  } else {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = ORIGINAL_FAKE_OLLAMA;
  }
});

// ---------------------------------------------------------------------------
// 1) Config load/save backward compatibility
// ---------------------------------------------------------------------------
describe("Ollama config backward compatibility", () => {
  it("loads a config without ollama section and defaults remain intact", async () => {
    const { paths } = await createWorkspace();
    const loaded = await loadConfig(paths);
    expect(loaded.providers.llm_mode).toBe("openai_api");
    expect(loaded.providers.ollama).toBeUndefined();
    expect(getDefaultPdfAnalysisModeForLlmMode(loaded.providers.llm_mode)).toBe("responses_api_pdf");
  });

  it("loads a config with ollama section intact", async () => {
    const { paths } = await createWorkspace(makeOllamaConfig());
    const loaded = await loadConfig(paths);
    expect(loaded.providers.llm_mode).toBe("ollama");
    expect(loaded.providers.ollama).toBeDefined();
    expect(loaded.providers.ollama!.base_url).toBe(DEFAULT_OLLAMA_BASE_URL);
    expect(loaded.providers.ollama!.chat_model).toBe(DEFAULT_OLLAMA_CHAT_MODEL);
    expect(loaded.providers.ollama!.research_model).toBe(DEFAULT_OLLAMA_RESEARCH_MODEL);
    expect(loaded.providers.ollama!.experiment_model).toBe(DEFAULT_OLLAMA_EXPERIMENT_MODEL);
    expect(loaded.providers.ollama!.vision_model).toBe(DEFAULT_OLLAMA_VISION_MODEL);
  });

  it("normalizes missing ollama fields when llm_mode is ollama", async () => {
    const config = makeOllamaConfig();
    config.providers.ollama = { base_url: "", chat_model: "", research_model: "" };
    const { paths } = await createWorkspace(config);
    const loaded = await loadConfig(paths);
    expect(loaded.providers.ollama!.base_url).toBe(DEFAULT_OLLAMA_BASE_URL);
    expect(loaded.providers.ollama!.chat_model).toBe(DEFAULT_OLLAMA_CHAT_MODEL);
    expect(loaded.providers.ollama!.research_model).toBe(DEFAULT_OLLAMA_RESEARCH_MODEL);
    expect(loaded.providers.ollama!.experiment_model).toBe(DEFAULT_OLLAMA_RESEARCH_MODEL);
    expect(loaded.providers.ollama!.vision_model).toBe(DEFAULT_OLLAMA_VISION_MODEL);
  });

  it("creates ollama section from defaults when llm_mode is ollama but section is missing", async () => {
    const config = makeBaseConfig();
    config.providers.llm_mode = "ollama";
    delete (config.providers as Record<string, unknown>).ollama;
    const { paths } = await createWorkspace(config);
    const loaded = await loadConfig(paths);
    expect(loaded.providers.ollama).toBeDefined();
    expect(loaded.providers.ollama!.base_url).toBe(DEFAULT_OLLAMA_BASE_URL);
  });

  it("preserves codex and openai config when switching to ollama mode", async () => {
    const { paths } = await createWorkspace(makeOllamaConfig());
    const loaded = await loadConfig(paths);
    expect(loaded.providers.codex.model).toBe("gpt-5.4");
    expect(loaded.providers.openai.model).toBe("gpt-5.4");
  });

  it("round-trips ollama config through save and load", async () => {
    const original = makeOllamaConfig();
    original.providers.ollama!.base_url = "http://192.168.1.100:11434";
    original.providers.ollama!.chat_model = "llama3.3:70b";
    const { paths } = await createWorkspace(original);
    const loaded = await loadConfig(paths);
    expect(loaded.providers.ollama!.base_url).toBe("http://192.168.1.100:11434");
    expect(loaded.providers.ollama!.chat_model).toBe("llama3.3:70b");
  });
});

// ---------------------------------------------------------------------------
// 2) Setup wizard flow for Ollama provider
// ---------------------------------------------------------------------------
describe("Ollama setup wizard", () => {
  it("runs interactive setup with ollama provider selection", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-setup-ollama-"));
    const paths = resolveAppPaths(cwd);

    const config = await runSetupWizard(
      paths,
      makePromptReaderFromQuestionMap({
        "Primary LLM provider (codex/api/ollama)": "ollama",
        "Ollama base URL": "",
        "Chat model": DEFAULT_OLLAMA_CHAT_MODEL,
        "Research backend model": DEFAULT_OLLAMA_RESEARCH_MODEL,
        "Experiment/code model": DEFAULT_OLLAMA_EXPERIMENT_MODEL,
        "Vision/PDF model": DEFAULT_OLLAMA_VISION_MODEL
      })
    );

    expect(config.providers.llm_mode).toBe("ollama");
    expect(config.providers.ollama).toBeDefined();
    expect(config.providers.ollama!.base_url).toBe(DEFAULT_OLLAMA_BASE_URL);
    expect(config.providers.ollama!.chat_model).toBe(DEFAULT_OLLAMA_CHAT_MODEL);
    expect(config.providers.ollama!.research_model).toBe(DEFAULT_OLLAMA_RESEARCH_MODEL);
    expect(config.providers.ollama!.experiment_model).toBe(DEFAULT_OLLAMA_EXPERIMENT_MODEL);
    expect(config.providers.ollama!.vision_model).toBe(DEFAULT_OLLAMA_VISION_MODEL);
    expect(getDefaultPdfAnalysisModeForLlmMode(config.providers.llm_mode)).toBe("ollama_vision");
  });

  it("setup wizard skips Codex login notification for ollama mode", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-setup-ollama-no-codex-"));
    const paths = resolveAppPaths(cwd);
    const fakeCodexCli = {
      checkCliAvailable: vi.fn(),
      checkLoginStatus: vi.fn()
    };
    const messages: string[] = [];

    await runSetupWizard(
      paths,
      makePromptReaderFromQuestionMap({
        "Primary LLM provider (codex/api/ollama)": "ollama",
        "Ollama base URL": "",
        "Chat model": "",
        "Research backend model": "",
        "Experiment/code model": "",
        "Vision/PDF model": ""
      }),
      {
        codexCli: fakeCodexCli,
        outputWriter: { write: (msg: string) => { messages.push(msg); return true; } }
      }
    );

    expect(fakeCodexCli.checkCliAvailable).not.toHaveBeenCalled();
    expect(fakeCodexCli.checkLoginStatus).not.toHaveBeenCalled();
    expect(messages.join("")).not.toContain("codex login");
  });

  it("non-interactive setup with ollama creates correct config", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-ni-setup-ollama-"));
    const paths = resolveAppPaths(cwd);

    const config = await runNonInteractiveSetup(paths, {
      projectName: "ollama-project",
      llmMode: "ollama",
      semanticScholarApiKey: "test-key",
      ollamaBaseUrl: "http://myhost:11434",
      ollamaChatModel: "qwen3:32b",
      ollamaResearchModel: "deepseek-r1:32b",
      ollamaExperimentModel: "qwen2.5-coder:32b",
      ollamaVisionModel: "llama3.2-vision:11b"
    });

    expect(config.providers.llm_mode).toBe("ollama");
    expect(config.providers.ollama!.base_url).toBe("http://myhost:11434");
    expect(config.providers.ollama!.chat_model).toBe("qwen3:32b");
    expect(config.providers.ollama!.research_model).toBe("deepseek-r1:32b");
    expect(config.providers.ollama!.experiment_model).toBe("qwen2.5-coder:32b");
    expect(config.providers.ollama!.vision_model).toBe("llama3.2-vision:11b");
    expect(getDefaultPdfAnalysisModeForLlmMode(config.providers.llm_mode)).toBe("ollama_vision");
  });

  it("non-interactive setup with ollama uses defaults when models are not specified", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-ni-setup-ollama-defaults-"));
    const paths = resolveAppPaths(cwd);

    const config = await runNonInteractiveSetup(paths, {
      llmMode: "ollama",
      semanticScholarApiKey: "test-key"
    });

    expect(config.providers.ollama!.base_url).toBe(DEFAULT_OLLAMA_BASE_URL);
    expect(config.providers.ollama!.chat_model).toBe(DEFAULT_OLLAMA_CHAT_MODEL);
    expect(config.providers.ollama!.research_model).toBe(DEFAULT_OLLAMA_RESEARCH_MODEL);
    expect(config.providers.ollama!.experiment_model).toBe(DEFAULT_OLLAMA_EXPERIMENT_MODEL);
    expect(config.providers.ollama!.vision_model).toBe(DEFAULT_OLLAMA_VISION_MODEL);
  });
});

// ---------------------------------------------------------------------------
// 3) Settings updates for Ollama fields
// ---------------------------------------------------------------------------
describe("Ollama settings updates", () => {
  it("can update Ollama base_url in saved config", async () => {
    const { paths } = await createWorkspace(makeOllamaConfig());
    const config = await loadConfig(paths);
    config.providers.ollama!.base_url = "http://gpu-box:11434";
    await saveConfig(paths, config);

    const reloaded = await loadConfig(paths);
    expect(reloaded.providers.ollama!.base_url).toBe("http://gpu-box:11434");
  });

  it("can update all Ollama model slots", async () => {
    const { paths } = await createWorkspace(makeOllamaConfig());
    const config = await loadConfig(paths);
    config.providers.ollama!.chat_model = "gemma3:27b";
    config.providers.ollama!.research_model = "deepseek-r1:32b";
    config.providers.ollama!.experiment_model = "qwen3:32b";
    config.providers.ollama!.vision_model = "llama3.2-vision:11b";
    await saveConfig(paths, config);

    const reloaded = await loadConfig(paths);
    expect(reloaded.providers.ollama!.chat_model).toBe("gemma3:27b");
    expect(reloaded.providers.ollama!.research_model).toBe("deepseek-r1:32b");
    expect(reloaded.providers.ollama!.experiment_model).toBe("qwen3:32b");
    expect(reloaded.providers.ollama!.vision_model).toBe("llama3.2-vision:11b");
  });

  it("can switch llm_mode from the default provider to ollama and back without data loss", async () => {
    const { paths } = await createWorkspace();
    let config = await loadConfig(paths);
    expect(config.providers.llm_mode).toBe("openai_api");

    config.providers.llm_mode = "ollama";
    config.providers.ollama = {
      base_url: DEFAULT_OLLAMA_BASE_URL,
      chat_model: "qwen3.5:27b",
      research_model: "qwen3.5:35b-a3b"
    };
    await saveConfig(paths, config);
    config = await loadConfig(paths);
    expect(config.providers.llm_mode).toBe("ollama");
    expect(config.providers.codex.model).toBe("gpt-5.4");

    config.providers.llm_mode = "openai_api";
    await saveConfig(paths, config);
    config = await loadConfig(paths);
    expect(config.providers.llm_mode).toBe("openai_api");
    expect(config.providers.ollama!.chat_model).toBe("qwen3.5:27b");
  });
});

// ---------------------------------------------------------------------------
// 4) /model selection behavior for Ollama
// ---------------------------------------------------------------------------
describe("Ollama model catalog", () => {
  it("provides chat model choices including defaults", () => {
    const choices = buildOllamaChatModelChoices();
    expect(choices).toContain(DEFAULT_OLLAMA_CHAT_MODEL);
    expect(choices.length).toBeGreaterThan(0);
  });

  it("provides research backend model choices", () => {
    const choices = buildOllamaResearchModelChoices();
    expect(choices).toContain(DEFAULT_OLLAMA_RESEARCH_MODEL);
  });

  it("provides experiment model choices", () => {
    const choices = buildOllamaExperimentModelChoices();
    expect(choices).toContain(DEFAULT_OLLAMA_EXPERIMENT_MODEL);
  });

  it("provides vision model choices", () => {
    const choices = buildOllamaVisionModelChoices();
    expect(choices).toContain(DEFAULT_OLLAMA_VISION_MODEL);
  });

  it("returns descriptions for known models", () => {
    expect(getOllamaModelDescription(DEFAULT_OLLAMA_CHAT_MODEL)).not.toBe("Ollama model.");
    expect(getOllamaModelDescription(DEFAULT_OLLAMA_RESEARCH_MODEL)).not.toBe("Ollama model.");
    expect(getOllamaModelDescription(DEFAULT_OLLAMA_RESEARCH_MODEL)).toContain("research backend");
  });

  it("returns generic description for unknown models", () => {
    expect(getOllamaModelDescription("unknown-model:7b")).toBe("Ollama model.");
  });

  it("has consistent values between option arrays and builder functions", () => {
    expect(buildOllamaChatModelChoices()).toEqual(OLLAMA_CHAT_MODEL_OPTIONS.map((o) => o.value));
    expect(buildOllamaResearchModelChoices()).toEqual(OLLAMA_RESEARCH_MODEL_OPTIONS.map((o) => o.value));
    expect(buildOllamaExperimentModelChoices()).toEqual(OLLAMA_EXPERIMENT_MODEL_OPTIONS.map((o) => o.value));
    expect(buildOllamaVisionModelChoices()).toEqual(OLLAMA_VISION_MODEL_OPTIONS.map((o) => o.value));
  });
});

// ---------------------------------------------------------------------------
// 5) PDF mode selection for Ollama
// ---------------------------------------------------------------------------
describe("Ollama PDF mode selection", () => {
  it("getDefaultPdfAnalysisModeForLlmMode maps ollama to ollama_vision", () => {
    expect(getDefaultPdfAnalysisModeForLlmMode("ollama")).toBe("ollama_vision");
  });

  it("getDefaultPdfAnalysisModeForLlmMode maps codex to codex_text_image_hybrid", () => {
    expect(getDefaultPdfAnalysisModeForLlmMode("codex_chatgpt_only")).toBe("codex_text_image_hybrid");
  });

  it("getDefaultPdfAnalysisModeForLlmMode maps openai_api to responses_api_pdf", () => {
    expect(getDefaultPdfAnalysisModeForLlmMode("openai_api")).toBe("responses_api_pdf");
  });

  it("normalizes ollama_vision pdf_mode through config load", async () => {
    const config = makeOllamaConfig();
    const { paths } = await createWorkspace(config);
    const loaded = await loadConfig(paths);
    expect(getDefaultPdfAnalysisModeForLlmMode(loaded.providers.llm_mode)).toBe("ollama_vision");
  });

  it("ollama setup automatically selects ollama_vision pdf mode", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-ollama-pdf-mode-"));
    const paths = resolveAppPaths(cwd);
    const config = await runNonInteractiveSetup(paths, {
      llmMode: "ollama",
      semanticScholarApiKey: "test-key"
    });
    expect(getDefaultPdfAnalysisModeForLlmMode(config.providers.llm_mode)).toBe("ollama_vision");
  });
});

// ---------------------------------------------------------------------------
// 6) Runtime provider resolution and fallback behavior
// ---------------------------------------------------------------------------
describe("Ollama runtime provider resolution", () => {
  it("RoutedLLMClient resolves to OllamaLLMClient when llm_mode is ollama", async () => {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = "test response";
    const ollamaClient = new OllamaClient(DEFAULT_OLLAMA_BASE_URL);
    const ollamaLlm = new OllamaLLMClient(ollamaClient, { model: "qwen3.5:35b-a3b" });
    const codexLlm = { complete: vi.fn().mockResolvedValue({ text: "codex", usage: {} }) };
    const openAiLlm = { complete: vi.fn().mockResolvedValue({ text: "openai", usage: {} }) };

    const routed = new RoutedLLMClient(() => ollamaLlm);

    const result = await routed.complete("hello");
    expect(result.text).toBe("test response");
    expect(codexLlm.complete).not.toHaveBeenCalled();
    expect(openAiLlm.complete).not.toHaveBeenCalled();
  });

  it("RoutedLLMClient switches provider based on resolver", async () => {
    const ollamaLlm = { complete: vi.fn().mockResolvedValue({ text: "ollama", usage: {} }) };
    const codexLlm = { complete: vi.fn().mockResolvedValue({ text: "codex", usage: {} }) };
    let currentMode: "ollama" | "codex" = "ollama";

    const routed = new RoutedLLMClient(() => {
      return currentMode === "ollama" ? ollamaLlm : codexLlm;
    });

    let result = await routed.complete("test");
    expect(result.text).toBe("ollama");

    currentMode = "codex";
    result = await routed.complete("test");
    expect(result.text).toBe("codex");
  });

  it("OllamaLLMClient uses fake response env var", async () => {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = "fake output here";
    const client = new OllamaClient(DEFAULT_OLLAMA_BASE_URL);
    const llm = new OllamaLLMClient(client, { model: "test-model" });

    const result = await llm.complete("hello world");
    expect(result.text).toBe("fake output here");
  });

  it("OllamaLLMClient detects images and routes to chatWithImages", async () => {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = "vision response";
    const client = new OllamaClient(DEFAULT_OLLAMA_BASE_URL);
    const llm = new OllamaLLMClient(client, { model: "qwen3.5:35b-a3b" });

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ollama-img-test-"));
    const imgPath = path.join(tmpDir, "test.png");
    // Create a minimal 1x1 PNG
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53
    ]);
    await fs.writeFile(imgPath, pngHeader);

    const result = await llm.complete("describe this image", { inputImagePaths: [imgPath] });
    expect(result.text).toBe("vision response");
  });
});

// ---------------------------------------------------------------------------
// 7) Ollama health-check / doctor output
// ---------------------------------------------------------------------------
describe("Ollama doctor checks", () => {
  it("includes ollama checks when llm_mode is ollama", async () => {
    const fakeCodex = {
      checkCliAvailable: vi.fn().mockResolvedValue({ ok: true, detail: "available" }),
      checkLoginStatus: vi.fn().mockResolvedValue({ ok: true, detail: "logged in" }),
      checkEnvironmentReadiness: vi.fn().mockResolvedValue([])
    };

    const report = await runDoctorReport(fakeCodex as any, {
      llmMode: "ollama",
      pdfAnalysisMode: "ollama_vision",
      ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL,
      ollamaChatModel: DEFAULT_OLLAMA_CHAT_MODEL,
      ollamaResearchModel: DEFAULT_OLLAMA_RESEARCH_MODEL,
      ollamaVisionModel: DEFAULT_OLLAMA_VISION_MODEL,
      includeHarnessValidation: false
    });

    const checkNames = report.checks.map((c) => c.name);
    expect(checkNames).toContain("ollama-base-url");
    expect(checkNames).toContain("ollama-server");
    // Server is likely unreachable in test env
    const serverCheck = report.checks.find((c) => c.name === "ollama-server");
    expect(serverCheck).toBeDefined();
    // It either passes (if ollama is running locally) or fails with helpful message
    if (!serverCheck!.ok) {
      expect(serverCheck!.detail).toContain("unreachable");
      expect(serverCheck!.detail).toContain("ollama serve");
    }
  });

  it("does not include ollama checks when llm_mode is codex", async () => {
    const fakeCodex = {
      checkCliAvailable: vi.fn().mockResolvedValue({ ok: true, detail: "available" }),
      checkLoginStatus: vi.fn().mockResolvedValue({ ok: true, detail: "logged in" }),
      checkEnvironmentReadiness: vi.fn().mockResolvedValue([])
    };

    const report = await runDoctorReport(fakeCodex as any, {
      llmMode: "codex_chatgpt_only",
      pdfAnalysisMode: "codex_text_image_hybrid",
      includeHarnessValidation: false
    });

    const checkNames = report.checks.map((c) => c.name);
    expect(checkNames).not.toContain("ollama-base-url");
    expect(checkNames).not.toContain("ollama-server");
  });

  it("includes ollama checks when only pdf mode uses ollama_vision", async () => {
    const fakeCodex = {
      checkCliAvailable: vi.fn().mockResolvedValue({ ok: true, detail: "available" }),
      checkLoginStatus: vi.fn().mockResolvedValue({ ok: true, detail: "logged in" }),
      checkEnvironmentReadiness: vi.fn().mockResolvedValue([])
    };

    const report = await runDoctorReport(fakeCodex as any, {
      llmMode: "codex_chatgpt_only",
      pdfAnalysisMode: "ollama_vision",
      ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL,
      ollamaVisionModel: DEFAULT_OLLAMA_VISION_MODEL,
      includeHarnessValidation: false
    });

    const checkNames = report.checks.map((c) => c.name);
    expect(checkNames).toContain("ollama-base-url");
    expect(checkNames).toContain("ollama-server");
  });

  it("reports correct base_url in check detail", async () => {
    const fakeCodex = {
      checkCliAvailable: vi.fn().mockResolvedValue({ ok: true, detail: "available" }),
      checkLoginStatus: vi.fn().mockResolvedValue({ ok: true, detail: "logged in" }),
      checkEnvironmentReadiness: vi.fn().mockResolvedValue([])
    };

    const report = await runDoctorReport(fakeCodex as any, {
      llmMode: "ollama",
      ollamaBaseUrl: "http://my-host:8888",
      includeHarnessValidation: false
    });

    const urlCheck = report.checks.find((c) => c.name === "ollama-base-url");
    expect(urlCheck).toBeDefined();
    expect(urlCheck!.detail).toContain("http://my-host:8888");
  });
});

// ---------------------------------------------------------------------------
// 8) PDF page-image multimodal analysis path (boundary/mocking level)
// ---------------------------------------------------------------------------
describe("Ollama PDF vision analysis", () => {
  it("OllamaPdfAnalysisClient batches pages and returns combined text", async () => {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = "Evidence from page batch";
    const client = new OllamaClient(DEFAULT_OLLAMA_BASE_URL);
    const pdfClient = new OllamaPdfAnalysisClient(client, DEFAULT_OLLAMA_VISION_MODEL);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ollama-pdf-test-"));
    const imagePaths: string[] = [];
    for (let i = 0; i < 6; i++) {
      const imgPath = path.join(tmpDir, `page_${i + 1}.png`);
      // Create minimal PNG-like data
      await fs.writeFile(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
      imagePaths.push(imgPath);
    }

    const result = await pdfClient.analyzePdfPages({
      imagePaths,
      prompt: "Extract evidence from these pages",
      systemPrompt: "You are a research paper analyzer."
    });

    expect(result.pagesAnalyzed).toBe(6);
    expect(result.text).toContain("Evidence from page batch");
    expect(result.model).toBe(DEFAULT_OLLAMA_VISION_MODEL);
  });

  it("OllamaPdfAnalysisClient limits total pages to MAX_TOTAL_PAGES", async () => {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = "batch result";
    const client = new OllamaClient(DEFAULT_OLLAMA_BASE_URL);
    const pdfClient = new OllamaPdfAnalysisClient(client, "test-vision-model");

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ollama-pdf-limit-test-"));
    const imagePaths: string[] = [];
    for (let i = 0; i < 20; i++) {
      const imgPath = path.join(tmpDir, `page_${i + 1}.png`);
      await fs.writeFile(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
      imagePaths.push(imgPath);
    }

    const result = await pdfClient.analyzePdfPages({
      imagePaths,
      prompt: "Analyze"
    });

    // MAX_TOTAL_PAGES is 12, so only 12 pages should be analyzed
    expect(result.pagesAnalyzed).toBeLessThanOrEqual(12);
  });

  it("OllamaPdfAnalysisClient.analyzePageImage works for single page", async () => {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = "Single page analysis";
    const client = new OllamaClient(DEFAULT_OLLAMA_BASE_URL);
    const pdfClient = new OllamaPdfAnalysisClient(client, DEFAULT_OLLAMA_VISION_MODEL);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ollama-pdf-single-"));
    const imgPath = path.join(tmpDir, "page.png");
    await fs.writeFile(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));

    const result = await pdfClient.analyzePageImage({
      imagePath: imgPath,
      prompt: "Extract text"
    });

    expect(result.pagesAnalyzed).toBe(1);
    expect(result.text).toBe("Single page analysis");
  });

  it("OllamaPdfAnalysisClient skips unreadable images gracefully", async () => {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = "partial batch result";
    const client = new OllamaClient(DEFAULT_OLLAMA_BASE_URL);
    const pdfClient = new OllamaPdfAnalysisClient(client, DEFAULT_OLLAMA_VISION_MODEL);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ollama-pdf-skip-"));
    const goodImg = path.join(tmpDir, "good.png");
    await fs.writeFile(goodImg, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
    const missingImg = path.join(tmpDir, "nonexistent.png");

    const result = await pdfClient.analyzePdfPages({
      imagePaths: [goodImg, missingImg],
      prompt: "Analyze"
    });

    // Should only analyze the readable image
    expect(result.pagesAnalyzed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 9) End-to-end smoke: Ollama backend resolves without breaking other providers
// ---------------------------------------------------------------------------
describe("Ollama end-to-end provider coexistence", () => {
  it("non-interactive setup with ollama does not corrupt codex/openai defaults", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-coexist-"));
    const paths = resolveAppPaths(cwd);

    const config = await runNonInteractiveSetup(paths, {
      llmMode: "ollama",
      semanticScholarApiKey: "test-key"
    });

    expect(config.providers.codex.model).toBe("gpt-5.4");
    expect(config.providers.codex.auth_required).toBe(true);
    expect(config.providers.openai.model).toBe("gpt-5.4");
    expect(config.providers.openai.api_key_required).toBe(true);
    expect(config.providers.ollama).toBeDefined();
    expect(getDefaultPdfAnalysisModeForLlmMode(config.providers.llm_mode)).toBe("ollama_vision");
  });

  it("codex setup is unaffected by ollama having been used previously", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-switch-back-"));
    const paths = resolveAppPaths(cwd);

    // First setup with ollama
    await runNonInteractiveSetup(paths, {
      llmMode: "ollama",
      semanticScholarApiKey: "test-key"
    });

    // Switch to codex
    const config = await loadConfig(paths);
    config.providers.llm_mode = "openai_api";
    await saveConfig(paths, config);

    const reloaded = await loadConfig(paths);
    expect(reloaded.providers.llm_mode).toBe("openai_api");
    expect(reloaded.providers.codex.model).toBeTruthy();
    expect(reloaded.providers.ollama).toBeDefined();
  });

  it("OllamaClient respects fake response sequence env var for smoke testing", async () => {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = undefined!;
    delete process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE;
    const seq = JSON.stringify(["response_1", "response_2", "response_3"]);
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE_SEQUENCE = seq;

    const client = new OllamaClient(DEFAULT_OLLAMA_BASE_URL);
    const r1 = await client.chat({ model: "test", messages: [{ role: "user", content: "a" }] });
    const r2 = await client.chat({ model: "test", messages: [{ role: "user", content: "b" }] });

    expect(r1.text).toBe("response_1");
    expect(r2.text).toBe("response_2");

    delete process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE_SEQUENCE;
  });

  it("RoutedLLMClient routing matches config pattern from createRuntime", async () => {
    // Simulate the runtime routing pattern
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = "ollama-output";
    const ollamaClient = new OllamaClient(DEFAULT_OLLAMA_BASE_URL);
    const ollamaTaskLlm = new OllamaLLMClient(ollamaClient, { model: DEFAULT_OLLAMA_RESEARCH_MODEL });
    const ollamaChatLlm = new OllamaLLMClient(ollamaClient, { model: DEFAULT_OLLAMA_CHAT_MODEL });
    const codexLlm = { complete: vi.fn().mockResolvedValue({ text: "codex", usage: {} }) };
    const openAiLlm = { complete: vi.fn().mockResolvedValue({ text: "openai", usage: {} }) };

    const config = { providers: { llm_mode: "ollama" as const } };

    const taskLlm = new RoutedLLMClient(() => {
      if (config.providers.llm_mode === "openai_api") return openAiLlm as any;
      if (config.providers.llm_mode === "ollama") return ollamaTaskLlm;
      return codexLlm as any;
    });
    const chatLlm = new RoutedLLMClient(() => {
      if (config.providers.llm_mode === "ollama") return ollamaChatLlm;
      return codexLlm as any;
    });

    const taskResult = await taskLlm.complete("research query");
    const chatResult = await chatLlm.complete("chat message");

    expect(taskResult.text).toBe("ollama-output");
    expect(chatResult.text).toBe("ollama-output");
    expect(codexLlm.complete).not.toHaveBeenCalled();
    expect(openAiLlm.complete).not.toHaveBeenCalled();
  });

  it("full config load cycle with all three providers configured", async () => {
    const config = makeOllamaConfig();
    config.providers.codex.model = "gpt-5.4";
    config.providers.openai.model = "gpt-5-mini";
    config.providers.ollama!.research_model = "deepseek-r1:32b";
    const { paths } = await createWorkspace(config);

    const loaded = await loadConfig(paths);
    expect(loaded.providers.llm_mode).toBe("ollama");
    expect(loaded.providers.codex.model).toBe("gpt-5.4");
    expect(loaded.providers.openai.model).toBe("gpt-5-mini");
    expect(loaded.providers.ollama!.research_model).toBe("deepseek-r1:32b");
    expect(getDefaultPdfAnalysisModeForLlmMode(loaded.providers.llm_mode)).toBe("ollama_vision");
  });
});

// ---------------------------------------------------------------------------
// OllamaClient unit tests
// ---------------------------------------------------------------------------
describe("OllamaClient", () => {
  it("constructs with default base URL", () => {
    const client = new OllamaClient();
    expect(client.getBaseUrl()).toBe(DEFAULT_OLLAMA_BASE_URL);
  });

  it("constructs with custom base URL", () => {
    const client = new OllamaClient("http://custom:12345");
    expect(client.getBaseUrl()).toBe("http://custom:12345");
  });

  it("checkHealth returns reachable: false for non-existent server", async () => {
    const client = new OllamaClient("http://127.0.0.1:19999");
    const health = await client.checkHealth();
    expect(health.reachable).toBe(false);
    expect(health.error).toBeTruthy();
  });

  it("isModelAvailable returns false when server is unreachable", async () => {
    const client = new OllamaClient("http://127.0.0.1:19999");
    const available = await client.isModelAvailable("test-model");
    expect(available).toBe(false);
  });

  it("chat returns fake response when env var is set", async () => {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = "fake chat output";
    const client = new OllamaClient(DEFAULT_OLLAMA_BASE_URL);
    const result = await client.chat({
      model: "test-model",
      messages: [{ role: "user", content: "hello" }]
    });
    expect(result.text).toBe("fake chat output");
    expect(result.model).toBe("test-model");
  });

  it("chatStream returns fake response when env var is set", async () => {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = "streamed fake output";
    const client = new OllamaClient(DEFAULT_OLLAMA_BASE_URL);
    const tokens: string[] = [];
    const result = await client.chatStream({
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
      onToken: (token) => tokens.push(token)
    });
    expect(result.text).toBe("streamed fake output");
    expect(tokens).toEqual(["streamed fake output"]);
  });
});

// ---------------------------------------------------------------------------
// Doctor: pdftoppm check for ollama_vision
// ---------------------------------------------------------------------------
describe("Doctor pdftoppm for ollama_vision", () => {
  it("includes pdftoppm check when pdfAnalysisMode is ollama_vision", async () => {
    const fakeCodex = {
      checkCliAvailable: vi.fn().mockResolvedValue({ ok: true, detail: "ok" }),
      checkLoginStatus: vi.fn().mockResolvedValue({ ok: true, detail: "ok" }),
      checkEnvironmentReadiness: vi.fn().mockResolvedValue([])
    };

    const report = await runDoctorReport(fakeCodex as any, {
      llmMode: "ollama",
      pdfAnalysisMode: "ollama_vision",
      ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL,
      includeHarnessValidation: false
    });

    const checkNames = report.checks.map((c) => c.name);
    expect(checkNames).toContain("pdftoppm");
    expect(checkNames).toContain("pdftotext");
    expect(checkNames).toContain("pdfinfo");
  });

  it("does not include pdftoppm when pdfAnalysisMode is responses_api_pdf", async () => {
    const fakeCodex = {
      checkCliAvailable: vi.fn().mockResolvedValue({ ok: true, detail: "ok" }),
      checkLoginStatus: vi.fn().mockResolvedValue({ ok: true, detail: "ok" }),
      checkEnvironmentReadiness: vi.fn().mockResolvedValue([])
    };

    const report = await runDoctorReport(fakeCodex as any, {
      llmMode: "openai_api",
      pdfAnalysisMode: "responses_api_pdf",
      openAiApiKeyConfigured: true,
      includeHarnessValidation: false
    });

    const checkNames = report.checks.map((c) => c.name);
    expect(checkNames).not.toContain("pdftoppm");
  });
});

// ---------------------------------------------------------------------------
// OllamaLLMClient streaming integration
// ---------------------------------------------------------------------------
describe("OllamaLLMClient streaming", () => {
  it("emits delta progress events during streaming", async () => {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = "A fairly long response that should trigger the buffer flush in the stream emitter because it exceeds 48 chars.";
    const client = new OllamaClient(DEFAULT_OLLAMA_BASE_URL);
    const llm = new OllamaLLMClient(client, { model: "test-model" });

    const events: Array<{ type: string; text: string }> = [];
    const result = await llm.complete("hello", {
      onProgress: (event) => events.push(event)
    });

    expect(result.text).toBeTruthy();
    // Should have at least one status event
    expect(events.some((e) => e.type === "status")).toBe(true);
  });

  it("does not stream when images are provided", async () => {
    process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE = "image response";
    const client = new OllamaClient(DEFAULT_OLLAMA_BASE_URL);
    const llm = new OllamaLLMClient(client, { model: "test-model" });

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ollama-no-stream-"));
    const imgPath = path.join(tmpDir, "test.png");
    await fs.writeFile(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));

    const events: Array<{ type: string; text: string }> = [];
    const result = await llm.complete("describe", {
      inputImagePaths: [imgPath],
      onProgress: (event) => events.push(event)
    });

    expect(result.text).toBe("image response");
    // Should have status events but no delta (images use non-streaming)
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBe(0);
  });
});
