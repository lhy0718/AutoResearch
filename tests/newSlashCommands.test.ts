import { describe, expect, it, vi } from "vitest";

import { buildSuggestions } from "../src/tui/commandPalette/suggest.js";
import { SLASH_COMMANDS, needsArg } from "../src/tui/commandPalette/commands.js";
import { TerminalApp } from "../src/tui/TerminalApp.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";

const runs = [
  {
    id: "run-1",
    title: "Test Run",
    currentNode: "collect_papers" as const,
    status: "running" as const,
    updatedAt: new Date().toISOString()
  }
];

describe("new slash commands", () => {
  it("includes /clear in suggestions when typing /cl", () => {
    const suggestions = buildSuggestions({ input: "/cl", runs, activeRunId: "run-1" });
    expect(suggestions.some((s) => s.applyValue === "/clear ")).toBe(true);
  });

  it("includes /queue in suggestions when typing /qu", () => {
    const suggestions = buildSuggestions({ input: "/qu", runs, activeRunId: "run-1" });
    expect(suggestions.some((s) => s.applyValue === "/queue ")).toBe(true);
  });

  it("includes /inspect in suggestions when typing /ins", () => {
    const suggestions = buildSuggestions({ input: "/ins", runs, activeRunId: "run-1" });
    expect(suggestions.some((s) => s.applyValue === "/inspect ")).toBe(true);
  });

  it("shows all new visible commands in root suggestions", () => {
    const suggestions = buildSuggestions({ input: "/", runs, activeRunId: "run-1" });
    expect(suggestions.some((s) => s.key === "cmd:clear")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:queue")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:inspect")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:session")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:stats")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:terminal-setup")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:theme")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:model")).toBe(true);
  });

  it("resolves /terminal-setup alias ts", () => {
    const tsSetup = SLASH_COMMANDS.find((c) => c.name === "terminal-setup");
    expect(tsSetup).toBeTruthy();
    expect(tsSetup!.aliases).toContain("ts");
  });

  it("identifies commands needing args", () => {
    expect(needsArg(SLASH_COMMANDS.find((c) => c.name === "run")!)).toBe(true);
    expect(needsArg(SLASH_COMMANDS.find((c) => c.name === "clear")!)).toBe(false);
    expect(needsArg(SLASH_COMMANDS.find((c) => c.name === "brief")!)).toBe(true);
  });

  it("marks preserveDraftOnRun commands correctly", () => {
    const clearCmd = SLASH_COMMANDS.find((c) => c.name === "clear");
    expect(clearCmd?.preserveDraftOnRun).toBe(true);

    const inspectCmd = SLASH_COMMANDS.find((c) => c.name === "inspect");
    expect(inspectCmd?.preserveDraftOnRun).toBe(true);

    const helpCmd = SLASH_COMMANDS.find((c) => c.name === "help");
    expect(helpCmd?.preserveDraftOnRun).toBeFalsy();
  });

  it("has category for all commands", () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.category).toBeTruthy();
    }
  });

  it("backward-compatible: existing visible commands still appear", () => {
    const suggestions = buildSuggestions({ input: "/", runs, activeRunId: "run-1" });
    expect(suggestions.some((s) => s.key === "cmd:help")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:new")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:approve")).toBe(true);
  });

  it("keeps doctor hidden in root suggestions", () => {
    const suggestions = buildSuggestions({ input: "/", runs, activeRunId: "run-1" });
    expect(suggestions.some((s) => s.key === "cmd:doctor")).toBe(false);
  });
});

function makeApp(): any {
  const app = new TerminalApp({
    config: {
      papers: { max_results: 100 },
      providers: {
        llm_mode: "codex_chatgpt_only",
        codex: { model: "gpt-5.3-codex", reasoning_effort: "xhigh", fast_mode: false },
        openai: { model: "gpt-5.4", reasoning_effort: "medium" }
      }
    } as any,
    runStore: {} as any,
    titleGenerator: {} as any,
    codex: {} as any,
    eventStream: { subscribe: () => () => {} } as any,
    orchestrator: {} as any,
    semanticScholarApiKeyConfigured: false,
    onQuit: () => {},
    saveConfig: async () => {}
  });

  app.render = () => {};
  app.updateSuggestions = () => {};
  app.drainQueuedInputs = async () => {};
  app.interactiveSupervisor = {
    getActiveRequest: vi.fn().mockResolvedValue(undefined)
  };
  return app;
}

describe("diagnostic command transient logs", () => {
  it("handleInspect uses transient logs not permanent logs", () => {
    const app = makeApp();
    app.handleInspect();
    expect(app.transientLogs.length).toBeGreaterThan(0);
    expect(app.transientLogs.some((l: string) => l.includes("Session diagnostics"))).toBe(true);
    expect(app.logs.length).toBe(0);
  });

  it("handleStats uses transient logs not permanent logs", () => {
    const app = makeApp();
    app.handleStats();
    expect(app.transientLogs.length).toBeGreaterThan(0);
    expect(app.transientLogs.some((l: string) => l.includes("Local session metrics"))).toBe(true);
    expect(app.logs.length).toBe(0);
  });

  it("handleTerminalSetup uses transient logs not permanent logs", () => {
    const app = makeApp();
    app.handleTerminalSetup();
    expect(app.transientLogs.length).toBeGreaterThan(0);
    expect(app.transientLogs.some((l: string) => l.includes("Terminal setup"))).toBe(true);
    expect(app.logs.length).toBe(0);
  });

  it("clearTransientLogs removes all transient entries", () => {
    const app = makeApp();
    app.handleInspect();
    expect(app.transientLogs.length).toBeGreaterThan(0);
    app.clearTransientLogs();
    expect(app.transientLogs.length).toBe(0);
  });

  it("getRenderableLogs includes transient logs in output", () => {
    const app = makeApp();
    app.handleInspect();
    const logs = app.getRenderableLogs();
    expect(logs.some((l: string) => l.includes("Session diagnostics"))).toBe(true);
  });

  it("getRenderableLogs shows empty after clearing transient logs", () => {
    const app = makeApp();
    app.handleInspect();
    app.clearTransientLogs();
    expect(app.getRenderableLogs()).toEqual([]);
  });
});

describe("mouse event suppression", () => {
  it("sets suppressMouseKeypresses when SGR mouse data is received", () => {
    const app = makeApp();
    // SGR scroll up event: button 64, col 10, row 5, press
    const scrollUp = Buffer.from("\x1b[<64;10;5M");
    app.handleRawKeyboardData(scrollUp);
    expect(app.suppressMouseKeypresses).toBe(true);
  });

  it("sets suppressMouseKeypresses for click events too", () => {
    const app = makeApp();
    // SGR left click: button 0, col 20, row 10, press
    const click = Buffer.from("\x1b[<0;20;10M");
    app.handleRawKeyboardData(click);
    expect(app.suppressMouseKeypresses).toBe(true);
  });

  it("does not set suppressMouseKeypresses for normal keyboard input", () => {
    const app = makeApp();
    app.handleRawKeyboardData(Buffer.from("hello"));
    expect(app.suppressMouseKeypresses).toBe(false);
  });

  it("scrolls transcript on scroll up event", () => {
    const app = makeApp();
    app.lastRenderedFrame = { maxTranscriptScrollOffset: 100 } as any;
    app.handleRawKeyboardData(Buffer.from("\x1b[<64;10;5M"));
    expect(app.transcriptScrollOffset).toBe(3);
  });

  it("scrolls transcript on scroll down event", () => {
    const app = makeApp();
    app.transcriptScrollOffset = 10;
    app.lastRenderedFrame = { maxTranscriptScrollOffset: 100 } as any;
    app.handleRawKeyboardData(Buffer.from("\x1b[<65;10;5M"));
    expect(app.transcriptScrollOffset).toBe(7);
  });

  it("disables mouse tracking under tmux-style terminals", () => {
    const previousTmux = process.env.TMUX;
    const previousTerm = process.env.TERM;
    process.env.TMUX = "/tmp/tmux-1000/default,123,0";
    process.env.TERM = "screen-256color";

    try {
      const app = makeApp();
      expect((app as any).shouldEnableMouseTracking()).toBe(false);
    } finally {
      if (previousTmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = previousTmux;
      if (previousTerm === undefined) delete process.env.TERM;
      else process.env.TERM = previousTerm;
    }
  });
});
