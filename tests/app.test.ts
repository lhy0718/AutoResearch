import { beforeEach, describe, expect, it, vi } from "vitest";

const bootstrapAutoLabOSRuntime = vi.fn();
const launchTerminalApp = vi.fn();
const configExists = vi.fn();
const resolveAppPaths = vi.fn();
const resolveOpenAiApiKey = vi.fn();
const resolveSemanticScholarApiKey = vi.fn();
const runNonInteractiveSetup = vi.fn();

vi.mock("../src/runtime/createRuntime.js", () => ({
  bootstrapAutoLabOSRuntime
}));

vi.mock("../src/tui/TerminalApp.js", () => ({
  launchTerminalApp
}));

vi.mock("../src/config.js", () => ({
  configExists,
  resolveAppPaths,
  resolveOpenAiApiKey,
  resolveSemanticScholarApiKey,
  runNonInteractiveSetup
}));

describe("runAutoLabOSApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("requests interactive setup on first TUI startup instead of prewriting config", async () => {
    const runtime = makeRuntime();
    bootstrapAutoLabOSRuntime.mockResolvedValue({
      configured: true,
      firstRunSetup: true,
      paths: { cwd: process.cwd() },
      config: runtime.config,
      runtime
    });

    const { runAutoLabOSApp } = await import("../src/app.js");
    await runAutoLabOSApp();

    expect(bootstrapAutoLabOSRuntime).toHaveBeenCalledWith({
      cwd: process.cwd(),
      allowInteractiveSetup: true,
      nodeOptionPackageName: undefined
    });
    expect(runNonInteractiveSetup).not.toHaveBeenCalled();
    expect(configExists).not.toHaveBeenCalled();
    expect(launchTerminalApp).toHaveBeenCalledTimes(1);
  });

  it("launches the terminal app with the bootstrapped runtime", async () => {
    const runtime = makeRuntime();
    bootstrapAutoLabOSRuntime.mockResolvedValue({
      configured: true,
      firstRunSetup: false,
      paths: { cwd: process.cwd() },
      config: runtime.config,
      runtime
    });

    const { runAutoLabOSApp } = await import("../src/app.js");
    await runAutoLabOSApp();

    expect(launchTerminalApp).toHaveBeenCalledWith(
      expect.objectContaining({
        config: runtime.config,
        runStore: runtime.runStore,
        titleGenerator: runtime.titleGenerator,
        codex: runtime.codex,
        openAiTextClient: runtime.openAiTextClient,
        eventStream: runtime.eventStream,
        orchestrator: runtime.orchestrator,
        semanticScholarApiKeyConfigured: runtime.semanticScholarApiKeyConfigured,
        saveConfig: runtime.saveConfig,
        initialRunId: undefined,
        onQuit: expect.any(Function)
      })
    );
  });

  it("forwards the selected node option package into runtime bootstrap", async () => {
    const runtime = makeRuntime();
    bootstrapAutoLabOSRuntime.mockResolvedValue({
      configured: true,
      firstRunSetup: false,
      paths: { cwd: process.cwd() },
      config: runtime.config,
      runtime
    });

    const { runAutoLabOSApp } = await import("../src/app.js");
    await runAutoLabOSApp({ packageName: "fast" });

    expect(bootstrapAutoLabOSRuntime).toHaveBeenCalledWith({
      cwd: process.cwd(),
      allowInteractiveSetup: true,
      nodeOptionPackageName: "fast"
    });
  });
});

function makeRuntime() {
  return {
    config: { project_name: "demo" },
    runStore: {},
    titleGenerator: {},
    codex: {},
    openAiTextClient: {},
    eventStream: {},
    orchestrator: {},
    semanticScholarApiKeyConfigured: false,
    saveConfig: vi.fn()
  };
}
