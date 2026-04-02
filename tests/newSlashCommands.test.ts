import { describe, expect, it, vi } from "vitest";

import { buildSuggestions } from "../src/tui/commandPalette/suggest.js";
import { SLASH_COMMANDS, needsArg } from "../src/tui/commandPalette/commands.js";
import { TerminalApp } from "../src/tui/TerminalApp.js";
import { InMemoryEventStream } from "../src/core/events.js";
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

  it("includes /knowledge in suggestions when typing /kn", () => {
    const suggestions = buildSuggestions({ input: "/kn", runs, activeRunId: "run-1" });
    expect(suggestions.some((s) => s.applyValue === "/knowledge ")).toBe(true);
  });

  it("includes /artifact in suggestions when typing /ar", () => {
    const suggestions = buildSuggestions({ input: "/ar", runs, activeRunId: "run-1" });
    expect(suggestions.some((s) => s.applyValue === "/artifact ")).toBe(true);
  });

  it("includes /jobs in suggestions when typing /jo", () => {
    const suggestions = buildSuggestions({ input: "/jo", runs, activeRunId: "run-1" });
    expect(suggestions.some((s) => s.applyValue === "/jobs ")).toBe(true);
  });

  it("includes /watch in suggestions when typing /wa", () => {
    const suggestions = buildSuggestions({ input: "/wa", runs, activeRunId: "run-1" });
    expect(suggestions.some((s) => s.applyValue === "/watch ")).toBe(true);
  });

  it("includes /analyze-results in suggestions when typing /an", () => {
    const suggestions = buildSuggestions({ input: "/an", runs, activeRunId: "run-1" });
    expect(suggestions.some((s) => s.applyValue === "/analyze-results ")).toBe(true);
  });

  it("includes /agent tune-node node suggestions", () => {
    const suggestions = buildSuggestions({ input: "/agent tune-node ge", runs, activeRunId: "run-1" });
    expect(suggestions.some((s) => s.applyValue === "/agent tune-node generate_hypotheses ")).toBe(true);
  });

  it("shows all new visible commands in root suggestions", () => {
    const suggestions = buildSuggestions({ input: "/", runs, activeRunId: "run-1" });
    expect(suggestions.some((s) => s.key === "cmd:clear")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:queue")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:inspect")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:session")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:knowledge")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:artifact")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:jobs")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:watch")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:analyze-results")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:stats")).toBe(true);
    expect(suggestions.some((s) => s.key === "cmd:terminal-setup")).toBe(true);
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

    const knowledgeCmd = SLASH_COMMANDS.find((c) => c.name === "knowledge");
    expect(knowledgeCmd?.preserveDraftOnRun).toBe(true);

    const helpCmd = SLASH_COMMANDS.find((c) => c.name === "help");
    expect(helpCmd?.preserveDraftOnRun).toBeFalsy();
  });

  it("has category for all commands", () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.category).toBeTruthy();
    }
  });

  it("includes /watch in help output", () => {
    const app = makeApp();
    app.printHelp();
    expect(app.logs).toContain("/watch");
  });

  it("prints tune-node comparison reports through /agent", async () => {
    const app = makeApp({
      tuneNodeRunner: {
        run: vi.fn().mockResolvedValue({
          lines: [
            "ORIGINAL score: 0.60",
            "MUTANT score: 0.74",
            "DELTA: +0.14",
            "RECOMMENDATION: keep"
          ]
        })
      }
    });
    app.resolveTargetRun = vi.fn().mockResolvedValue({
      id: "run-1",
      title: "Test Run",
      topic: "topic",
      objectiveMetric: "metric",
      constraints: []
    });
    app.setActiveRunId = vi.fn().mockResolvedValue(undefined);

    const result = await app.handleAgent(["tune-node", "generate_hypotheses"]);

    expect(result.ok).toBe(true);
    expect(app.logs).toContain("ORIGINAL score: 0.60");
    expect(app.logs).toContain("MUTANT score: 0.74");
    expect(app.logs).toContain("RECOMMENDATION: keep");
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

function makeApp(overrides: Record<string, unknown> = {}): any {
  const eventStream = new InMemoryEventStream();
  const app = new TerminalApp({
    config: {
      papers: { max_results: 100 },
      providers: {
        llm_mode: "codex_chatgpt_only",
        codex: { model: "gpt-5.3-codex", reasoning_effort: "xhigh", fast_mode: false },
        openai: { model: "gpt-5.4", reasoning_effort: "medium" }
      }
    } as any,
    runStore: {
      listRuns: vi.fn().mockResolvedValue([]),
      getRun: vi.fn().mockResolvedValue(undefined)
    } as any,
    titleGenerator: {} as any,
    codex: {} as any,
    eventStream,
    orchestrator: {} as any,
    semanticScholarApiKeyConfigured: false,
    onQuit: () => {},
    saveConfig: async () => {},
    ...(overrides as any)
  });

  app.render = () => {};
  app.updateSuggestions = () => {};
  app.drainQueuedInputs = async () => {};
  app.interactiveSupervisor = {
    getActiveRequest: vi.fn().mockResolvedValue(undefined)
  };
  app.__eventStream = eventStream;
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

  it("lists manuscript-quality artifact shortcuts in the TUI artifact command", async () => {
    const app = makeApp();
    app.resolveTargetRun = vi.fn().mockResolvedValue({
      id: "run-1",
      title: "Test Run",
      currentNode: "write_paper",
      status: "paused"
    });
    app.setActiveRunId = vi.fn().mockImplementation(async () => {
      app.activeRunInsight = {
        title: "Manuscript quality",
        lines: [],
        manuscriptQuality: {
          status: "stopped",
          stage: "post_repair_1",
          reasonCategory: "policy_hard_stop",
          reviewReliability: "grounded",
          triggeredBy: ["appendix_hygiene"],
          repairAttempts: {
            attempted: 1,
            allowedMax: 2,
            remaining: 0
          },
          issueCounts: {
            manuscript: 1,
            hardStopPolicy: 1,
            backstopOnly: 0,
            scientificBlockers: 0,
            submissionBlockers: 0,
            reviewerMissedPolicy: 1,
            reviewerCoveredBackstop: 0
          },
          issueGroups: {
            manuscript: [],
            hardStopPolicy: [],
            backstopOnly: [],
            scientific: [],
            submission: []
          },
          artifactRefs: [
            {
              label: "Manuscript quality gate",
              path: "paper/manuscript_quality_gate.json"
            }
          ]
        }
      };
    });

    const result = await app.handleArtifact([]);

    expect(result.ok).toBe(true);
    expect(app.logs).toContain("Artifact shortcuts for run-1:");
    expect(app.logs).toContain("- Manuscript quality gate: /artifact paper/manuscript_quality_gate.json");
  });

  it("lists review readiness-risk artifact shortcuts in the TUI artifact command", async () => {
    const app = makeApp();
    app.resolveTargetRun = vi.fn().mockResolvedValue({
      id: "run-1",
      title: "Test Run",
      currentNode: "review",
      status: "paused"
    });
    app.setActiveRunId = vi.fn().mockImplementation(async () => {
      app.activeRunInsight = {
        title: "Review packet",
        lines: [],
        readinessRisks: {
          stage: "review",
          readinessState: "blocked_for_paper_scale",
          paperReady: false,
          riskCounts: {
            total: 1,
            blocked: 1,
            warning: 0
          },
          risks: [
            {
              code: "review_minimum_gate_blocked_for_paper_scale",
              section: "Paper scale",
              severity: "fail",
              message: "Minimum gate: 3 check(s) failed — ceiling: blocked_for_paper_scale.",
              source: "review_readiness"
            }
          ],
          artifactRefs: [
            {
              label: "Review readiness risks",
              path: "review/readiness_risks.json"
            }
          ]
        }
      };
    });

    const result = await app.handleArtifact([]);

    expect(result.ok).toBe(true);
    expect(app.logs).toContain("Artifact shortcuts for run-1:");
    expect(app.logs).toContain("- Review readiness risks: /artifact review/readiness_risks.json");
  });

  it("starts /watch and updates rows when a mock event arrives", async () => {
    const app = makeApp();
    const now = new Date().toISOString();
    const graph = createDefaultGraphState();
    graph.currentNode = "analyze_results";
    graph.nodeStates.analyze_results.status = "running";
    graph.nodeStates.analyze_results.updatedAt = now;
    const run = {
      version: 3,
      workflowVersion: 3,
      id: "12345678-run-watch",
      title: "Watch Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric",
      status: "running",
      currentNode: "analyze_results",
      nodeThreads: {},
      createdAt: now,
      updatedAt: now,
      graph,
      memoryRefs: {
        runContextPath: ".autolabos/runs/12345678-run-watch/memory/run_context.json",
        longTermPath: ".autolabos/runs/12345678-run-watch/memory/long_term.jsonl",
        episodePath: ".autolabos/runs/12345678-run-watch/memory/episodes.jsonl"
      }
    };
    app.runStore.listRuns = vi.fn().mockResolvedValue([]);
    app.runStore.getRun = vi.fn().mockResolvedValue(run);

    await app.handleWatch();
    expect(app.getRenderableLogs().some((line: string) => line.includes("Watch: live run and background job view"))).toBe(true);

    const event = app.__eventStream.emit({
      type: "NODE_STARTED",
      runId: run.id,
      node: "analyze_results",
      payload: {}
    });
    await app.handleStreamEvent(event);

    const logs = app.getRenderableLogs();
    expect(logs.some((line: string) => line.includes("12345678"))).toBe(true);
    expect(logs.some((line: string) => line.includes("analyze_results"))).toBe(true);
    expect(logs.some((line: string) => line.includes("running"))).toBe(true);

    await app.handleKeypress("q", { name: "q" });
    expect(app.watchModeActive).toBe(false);
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
