import { afterEach, describe, expect, it } from "vitest";

import { buildFrame, RenderFrameInput } from "../src/tui/renderFrame.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord, SuggestionItem } from "../src/types.js";
import { applyCodexSurfaceTheme, stripAnsi } from "../src/tui/theme.js";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  const now = new Date().toISOString();
  const graph = overrides.graph ?? createDefaultGraphState();
  const currentNode = overrides.currentNode ?? graph.currentNode;
  return {
    version: 3,
    workflowVersion: 3,
    id: overrides.id ?? "run-1",
    title: overrides.title ?? "Test run",
    topic: overrides.topic ?? "topic",
    constraints: overrides.constraints ?? [],
    objectiveMetric: overrides.objectiveMetric ?? "metric",
    status: overrides.status ?? "pending",
    currentNode,
    latestSummary: overrides.latestSummary,
    nodeThreads: overrides.nodeThreads ?? {},
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    graph,
    memoryRefs: overrides.memoryRefs ?? {
      runContextPath: ".autolabos/runs/run-1/memory/run_context.json",
      longTermPath: ".autolabos/runs/run-1/memory/long_term.jsonl",
      episodePath: ".autolabos/runs/run-1/memory/episodes.jsonl"
    }
  };
}

function makeInput(overrides: Partial<RenderFrameInput> = {}): RenderFrameInput {
  return {
    appVersion: "1.0.0",
    busy: false,
    thinking: false,
    thinkingFrame: 0,
    logs: [],
    input: "",
    inputCursor: 0,
    suggestions: [],
    selectedSuggestion: 0,
    colorEnabled: false,
    terminalWidth: 120,
    terminalHeight: 40,
    ...overrides
  };
}

describe("composer surface v2", () => {
  afterEach(() => {
    applyCodexSurfaceTheme(undefined);
  });

  it("renders top and bottom padding lines around the composer", () => {
    const frame = buildFrame(makeInput());
    const plain = frame.lines.map((l) => stripAnsi(l));
    const promptIdx = frame.inputLineIndex - 1;
    expect(plain[promptIdx]).toContain("›");
    // Line above prompt should be the top spacer (empty/space-only)
    const topSpacer = plain[promptIdx - 1];
    expect(topSpacer?.trim()).toBe("");
    // Line below prompt should be the bottom spacer
    const bottomSpacer = plain[promptIdx + 1];
    expect(bottomSpacer?.trim()).toBe("");
  });

  it("shows placeholder text when composer is empty", () => {
    const frame = buildFrame(makeInput());
    const plain = frame.lines.map((l) => stripAnsi(l));
    const promptLine = plain[frame.inputLineIndex - 1];
    expect(promptLine).toContain("›");
    expect(promptLine).toContain("Start with /new");
  });

  it("shows busy placeholder when busy", () => {
    const frame = buildFrame(makeInput({
      busy: true,
      activityLabel: "Starting research...",
      run: undefined
    }));
    const plain = frame.lines.map((l) => stripAnsi(l));
    const promptLine = plain[frame.inputLineIndex - 1];
    expect(promptLine).toContain("Creating a new research run");
  });

  it("shows contextual placeholder for active run", () => {
    const frame = buildFrame(makeInput({
      run: makeRun()
    }));
    const plain = frame.lines.map((l) => stripAnsi(l));
    const promptLine = plain[frame.inputLineIndex - 1];
    expect(promptLine).toContain("Add steering");
  });

  it("renders typed input on the composer surface", () => {
    const frame = buildFrame(makeInput({
      input: "hello world",
      inputCursor: 11
    }));
    const plain = frame.lines.map((l) => stripAnsi(l));
    const promptLine = plain[frame.inputLineIndex - 1];
    expect(promptLine).toContain("› hello world");
  });

  it("aligns continuation lines to text column, not prompt column", () => {
    const frame = buildFrame(makeInput({
      input: "first line\nsecond line",
      inputCursor: 22
    }));
    const plain = frame.lines.map((l) => stripAnsi(l));
    const promptIdx = frame.inputLineIndex - 1;
    // First line has the prompt
    const firstLine = plain.find((l) => l.includes("› first line"));
    expect(firstLine).toBeTruthy();
    // Second line should NOT have the prompt glyph but should be indented
    const secondLine = plain.find((l) => l.includes("second line") && !l.includes("›"));
    expect(secondLine).toBeTruthy();
  });

  it("limits visible lines to max height and keeps cursor visible", () => {
    const longInput = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const frame = buildFrame(makeInput({
      input: longInput,
      inputCursor: longInput.length,
      terminalHeight: 40
    }));
    const plain = frame.lines.map((l) => stripAnsi(l));
    // The composer body should not have all 20 lines visible
    const composerLines = plain.filter((l) => l.includes("line "));
    expect(composerLines.length).toBeLessThanOrEqual(8); // max 6 + tolerance for spacer
  });

  it("works at narrow terminal width", () => {
    const frame = buildFrame(makeInput({
      input: "short",
      inputCursor: 5,
      terminalWidth: 30
    }));
    const plain = frame.lines.map((l) => stripAnsi(l));
    const promptLine = plain[frame.inputLineIndex - 1];
    expect(promptLine).toContain("› short");
  });

  it("places cursor correctly for wrapped text", () => {
    const longText = "a".repeat(200);
    const frame = buildFrame(makeInput({
      input: longText,
      inputCursor: 150,
      terminalWidth: 80
    }));
    expect(frame.inputColumn).toBeGreaterThan(0);
    expect(frame.inputLineIndex).toBeGreaterThan(0);
  });

  it("handles wide characters (Korean) in cursor positioning", () => {
    const koreanText = "논문 제목을 입력하세요";
    const frame = buildFrame(makeInput({
      input: koreanText,
      inputCursor: Array.from(koreanText).length
    }));
    expect(frame.inputColumn).toBeGreaterThan(2);
    const plain = frame.lines.map((l) => stripAnsi(l));
    expect(plain[frame.inputLineIndex - 1]).toContain("›");
  });

  it("maintains structure with color disabled", () => {
    const frame = buildFrame(makeInput({
      input: "test input",
      inputCursor: 10,
      colorEnabled: false
    }));
    const promptLine = frame.lines[frame.inputLineIndex - 1];
    expect(promptLine).toContain("› test input");
  });
});

describe("footer status line v2", () => {
  afterEach(() => {
    applyCodexSurfaceTheme(undefined);
  });

  it("shows queue count in footer when non-zero", () => {
    const frame = buildFrame(makeInput({
      queueLength: 3,
      footerItems: ["idle"]
    }));
    const plain = frame.lines.map((l) => stripAnsi(l));
    const footerLine = plain.find((l) => l.includes("queue:3"));
    expect(footerLine).toBeTruthy();
  });

  it("does not show queue count when zero", () => {
    const frame = buildFrame(makeInput({
      queueLength: 0,
      footerItems: ["idle"]
    }));
    const plain = frame.lines.map((l) => stripAnsi(l));
    expect(plain.some((l) => l.includes("queue:"))).toBe(false);
  });

  it("shows workspace basename in footer", () => {
    const frame = buildFrame(makeInput({
      workspaceLabel: "/Users/test/my-project",
      footerItems: ["idle"]
    }));
    const plain = frame.lines.map((l) => stripAnsi(l));
    expect(plain.some((l) => l.includes("my-project"))).toBe(true);
  });

  it("truncates footer gracefully at narrow width", () => {
    const frame = buildFrame(makeInput({
      terminalWidth: 40,
      footerItems: ["collect_papers running"],
      modelLabel: "gpt-4o-mini",
      workspaceLabel: "/very/long/path/to/some/workspace"
    }));
    // Should not throw and should produce output
    expect(frame.lines.length).toBeGreaterThan(0);
  });

  it("shows interaction state in footer items", () => {
    const frame = buildFrame(makeInput({
      footerItems: ["thinking", "collect_papers running"]
    }));
    const plain = frame.lines.map((l) => stripAnsi(l));
    expect(plain.some((l) => l.includes("thinking"))).toBe(true);
  });
});

describe("suggestion popup placement", () => {
  afterEach(() => {
    applyCodexSurfaceTheme(undefined);
  });

  const suggestions: SuggestionItem[] = [
    { key: "cmd:help", label: "/help", description: "Show help", applyValue: "/help " },
    { key: "cmd:new", label: "/new", description: "Create brief", applyValue: "/new " }
  ];

  it("renders suggestions below the composer input line", () => {
    const frame = buildFrame(makeInput({
      input: "/",
      inputCursor: 1,
      suggestions,
      selectedSuggestion: 0
    }));
    const plain = frame.lines.map((l) => stripAnsi(l));
    const inputIdx = frame.inputLineIndex - 1;
    // Suggestions should be below the composer input line
    const belowInput = plain.slice(inputIdx + 1);
    expect(belowInput.some((l) => l.includes("/help"))).toBe(true);
  });

  it("does not shift input line when suggestions appear", () => {
    const frameNoSuggestions = buildFrame(makeInput({ input: "" }));
    const frameWithSuggestions = buildFrame(makeInput({
      input: "/",
      inputCursor: 1,
      suggestions,
      selectedSuggestion: 0
    }));
    // inputLineIndex should remain the same regardless of suggestion panel
    expect(frameWithSuggestions.inputLineIndex).toBe(frameNoSuggestions.inputLineIndex);
  });
});
