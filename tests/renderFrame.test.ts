import { describe, expect, it } from "vitest";

import { buildFrame } from "../src/tui/renderFrame.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord, SuggestionItem } from "../src/types.js";
import { stripAnsi } from "../src/tui/theme.js";

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
      runContextPath: ".autoresearch/runs/run-1/memory/run_context.json",
      longTermPath: ".autoresearch/runs/run-1/memory/long_term.jsonl",
      episodePath: ".autoresearch/runs/run-1/memory/episodes.jsonl"
    }
  };
}

const suggestions: SuggestionItem[] = [
  {
    key: "doctor",
    label: "/doctor",
    description: "Run environment checks",
    applyValue: "/doctor "
  },
  {
    key: "help",
    label: "/help",
    description: "Show command list",
    applyValue: "/help "
  }
];

describe("buildFrame", () => {
  it("applies distinct colors for help sections, warnings, successes, and errors", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: ["Help", "Usage: /run <run>", "Updated title: A -> B", "Error: bad input"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true
    });

    const helpLine = frame.lines.find((line) => stripAnsi(line) === "[INFO] Help") ?? "";
    const usageLine = frame.lines.find((line) => stripAnsi(line) === "[WARN] Usage: /run <run>") ?? "";
    const successLine = frame.lines.find((line) => stripAnsi(line) === "[OK] Updated title: A -> B") ?? "";
    const errorLine = frame.lines.find((line) => stripAnsi(line) === "[ERR] Error: bad input") ?? "";

    expect(helpLine).toMatch(/\x1b\[[0-9;]*96m/);
    expect(usageLine).toMatch(/\x1b\[[0-9;]*93m/);
    expect(successLine).toMatch(/\x1b\[[0-9;]*92m/);
    expect(errorLine).toMatch(/\x1b\[[0-9;]*91m/);
  });

  it("highlights direct answers and numbered titles in white", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: ["현재 수집된 논문은 20편입니다.", "1. First paper title"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true
    });

    const answerLine = frame.lines.find((line) => stripAnsi(line) === "[INFO] 현재 수집된 논문은 20편입니다.") ?? "";
    const titleLine = frame.lines.find((line) => stripAnsi(line) === "[INFO] 1. First paper title") ?? "";

    expect(answerLine).toMatch(/\x1b\[[0-9;]*97m/);
    expect(titleLine).toMatch(/\x1b\[[0-9;]*97m/);
  });

  it("renders compact header with version", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: undefined,
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    expect(stripAnsi(frame.lines[0])).toBe("AutoResearch v1.0.0");
  });

  it("does not render Busy label", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    expect(frame.lines.map((line) => stripAnsi(line))).not.toContain("Busy");
  });

  it("renders collecting status above the input instead of a header activity line", () => {
    const graph = createDefaultGraphState();
    graph.currentNode = "collect_papers";
    graph.nodeStates.collect_papers.status = "running";

    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      activityLabel: "Collecting...",
      thinking: false,
      thinkingFrame: 0,
      run: makeRun({ graph, currentNode: "collect_papers" }),
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain).not.toContain("Activity: Collecting...");
    expect(plain).toContain("Collecting...");
    const promptIndex = frame.inputLineIndex - 1;
    expect(plain[promptIndex]).toBe("> ");
    expect(plain[promptIndex - 1]).toBe("");
    expect(plain[promptIndex - 2]).toBe("Collecting...");
  });

  it("renders collecting progress with ETA above the input", () => {
    const graph = createDefaultGraphState();
    graph.currentNode = "collect_papers";
    graph.nodeStates.collect_papers.status = "running";

    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      activityLabel: "Collecting... 199/300 (ETA ~2m 40s)",
      thinking: false,
      thinkingFrame: 0,
      run: makeRun({ graph, currentNode: "collect_papers" }),
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain).toContain("Collecting... 199/300 (ETA ~2m 40s)");
  });

  it("places suggestions below the input line", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: ["ready"],
      input: "/",
      inputCursor: 1,
      suggestions,
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const inputLine = frame.lines[frame.inputLineIndex - 1];
    expect(stripAnsi(inputLine)).toBe("> /");
    expect(frame.inputLineIndex).toBeLessThan(frame.lines.length);

    const suggestionRows = frame.lines.slice(frame.inputLineIndex + 1).map((line) => stripAnsi(line));
    expect(suggestionRows[0]).toBe("/doctor  Run environment checks");
    expect(suggestionRows.every((row) => !row.includes(" - "))).toBe(true);
  });

  it("renders contextual guidance below the input when provided", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: ["ready"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false,
      guidance: {
        title: "Next actions",
        items: [
          { label: "/new", description: "Create a new run" },
          { label: "what should I do next?", description: "Ask for the recommended next step" }
        ]
      }
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain).toContain("Next actions");
    expect(plain).toContain("  /new  Create a new run");
    expect(plain).toContain("  what should I do next?  Ask for the recommended next step");
  });

  it("prefixes regular log lines with INFO/WARN/OK/ERR tags", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: ["Natural query: test", "Canceled pending command: /approve", "Run completed.", "Error: broken"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain).toContain("[INFO] Natural query: test");
    expect(plain).toContain("[WARN] Canceled pending command: /approve");
    expect(plain).toContain("[OK] Run completed.");
    expect(plain).toContain("[ERR] Error: broken");
  });

  it("keeps automatic replan logs out of error styling", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: [
        "Attempting automatic replan after failed step...",
        "The previous collect step failed. I can retry with a corrected collect command.",
        "Replan matched the failed plan. Not re-arming the same commands.",
        "No revised execution plan was suggested."
      ],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain).toContain("[INFO] Attempting automatic replan after failed step...");
    expect(plain).toContain("[INFO] The previous collect step failed. I can retry with a corrected collect command.");
    expect(plain).toContain("[WARN] Replan matched the failed plan. Not re-arming the same commands.");
    expect(plain).toContain("[WARN] No revised execution plan was suggested.");
  });

  it("computes cursor column at the end of '> input'", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: undefined,
      logs: [],
      input: "abc",
      inputCursor: 3,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    expect(frame.inputColumn).toBe(6);
  });

  it("computes cursor column with wide characters", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: undefined,
      logs: [],
      input: "한글",
      inputCursor: 2,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    expect(frame.inputColumn).toBe(7);
  });

  it("highlights selected suggestion with blue background", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: undefined,
      logs: [],
      input: "/",
      inputCursor: 1,
      suggestions,
      selectedSuggestion: 0,
      colorEnabled: true
    });

    const selectedRow = frame.lines[frame.inputLineIndex + 1];
    expect(selectedRow).toContain("\x1b[");
    expect(selectedRow).toContain("44");
  });

  it("renders selection menu rows when active", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: ["ready"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false,
      selectionMenu: {
        title: "Select model",
        options: [
          {
            value: "gpt-5.3-codex",
            label: "gpt-5.3-codex",
            description: "Primary Codex model."
          },
          {
            value: "gpt-5.2-codex",
            label: "gpt-5.2-codex"
          }
        ],
        selectedIndex: 1
      }
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain.some((line) => line.includes("Select model"))).toBe(true);
    expect(plain.some((line) => line.includes("gpt-5.3-codex  Primary Codex model."))).toBe(true);
    expect(plain.some((line) => line.trim() === "gpt-5.2-codex")).toBe(true);
  });

  it("highlights selected selection menu row", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: ["ready"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true,
      selectionMenu: {
        title: "Select reasoning effort",
        options: [
          { value: "low", label: "low" },
          { value: "medium", label: "medium" },
          { value: "high", label: "high" }
        ],
        selectedIndex: 2
      }
    });

    const selected = frame.lines.find((line) => stripAnsi(line).trim() === "high") || "";
    expect(selected).toContain("\x1b[");
    expect(selected).toContain("44");
  });

  it("renders moving monochrome gradient on Thinking text", () => {
    const a = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      thinking: true,
      thinkingFrame: 1,
      run: undefined,
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true
    });
    const b = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      thinking: true,
      thinkingFrame: 8,
      run: undefined,
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true
    });

    const thinkingA = a.lines.find((line) => stripAnsi(line).includes("Thinking...")) || "";
    const thinkingB = b.lines.find((line) => stripAnsi(line).includes("Thinking...")) || "";
    expect(thinkingA).toContain("\x1b[");
    expect(thinkingA).not.toBe(thinkingB);
    expect(a.thinkingLineIndex).toBeDefined();
  });

  it("animates collecting status text above the input line", () => {
    const a = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      activityLabel: "Collecting...",
      thinking: false,
      thinkingFrame: 1,
      run: makeRun(),
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true
    });
    const b = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      activityLabel: "Collecting...",
      thinking: false,
      thinkingFrame: 8,
      run: makeRun(),
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true
    });

    const statusA = a.lines.find((line) => stripAnsi(line).includes("Collecting...")) || "";
    const statusB = b.lines.find((line) => stripAnsi(line).includes("Collecting...")) || "";
    expect(statusA).toContain("\x1b[");
    expect(statusA).not.toBe(statusB);
    expect(a.thinkingLineIndex).toBeDefined();
  });

  it("wraps long title and log lines to the terminal width instead of letting them overflow", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      terminalWidth: 40,
      run: makeRun({
        title: "Multi-agent collaboration in recent papers: five-year state-of-the-art reproducibility benchmark"
      }),
      logs: [
        "Graph nodes: collect_papers, analyze_papers, generate_hypotheses, design_experiments, implement_experiments, run_experiments, analyze_results, write_paper"
      ],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain.some((line) => line.includes("reproducibility benchmark"))).toBe(true);
    expect(
      plain.filter((line) => line.includes("Graph nodes:") || line.includes("generate_hypotheses") || line.includes("write_paper")).length
    ).toBeGreaterThan(1);
    expect(plain[frame.inputLineIndex - 1]).toBe("> ");
  });
});
