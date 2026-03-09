import { describe, expect, it } from "vitest";

import { buildSuggestions } from "../src/tui/commandPalette/suggest.js";

const runs = [
  {
    id: "run-alpha-123",
    title: "Agentic Retrieval Benchmark Run",
    currentNode: "implement_experiments" as const,
    status: "running" as const,
    updatedAt: new Date().toISOString()
  },
  {
    id: "run-beta-456",
    title: "Long Context Planning Study",
    currentNode: "analyze_papers" as const,
    status: "paused" as const,
    updatedAt: new Date().toISOString()
  }
];

describe("buildSuggestions", () => {
  it("shows command suggestions on '/'", () => {
    const suggestions = buildSuggestions({ input: "/", runs, activeRunId: "run-alpha-123" });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].applyValue.startsWith("/")).toBe(true);
  });

  it("filters commands fuzzily", () => {
    const suggestions = buildSuggestions({ input: "/res", runs, activeRunId: "run-alpha-123" });
    expect(suggestions.some((s) => s.applyValue.startsWith("/resume"))).toBe(true);
  });

  it("suggests run ids for /run", () => {
    const suggestions = buildSuggestions({ input: "/run alp", runs, activeRunId: "run-alpha-123" });
    expect(suggestions.some((s) => s.applyValue === "/run run-alpha-123")).toBe(true);
  });

  it("suggests node ids for /agent run", () => {
    const suggestions = buildSuggestions({ input: "/agent run imp", runs, activeRunId: "run-alpha-123" });
    expect(suggestions.some((s) => s.applyValue === "/agent run implement_experiments ")).toBe(true);
  });

  it("suggests --top-n flow for /agent run analyze_papers", () => {
    const optionSuggestions = buildSuggestions({
      input: "/agent run analyze_papers --top",
      runs,
      activeRunId: "run-alpha-123"
    });
    expect(optionSuggestions.some((s) => s.applyValue === "/agent run analyze_papers --top-n ")).toBe(true);

    const countSuggestions = buildSuggestions({
      input: "/agent run analyze_papers --top-n ",
      runs,
      activeRunId: "run-alpha-123"
    });
    expect(countSuggestions.some((s) => s.applyValue === "/agent run analyze_papers --top-n 50 ")).toBe(true);
  });

  it("suggests --top-k and --branch-count flow for /agent run generate_hypotheses", () => {
    const optionSuggestions = buildSuggestions({
      input: "/agent run generate_hypotheses --top",
      runs,
      activeRunId: "run-alpha-123"
    });
    expect(optionSuggestions.some((s) => s.applyValue === "/agent run generate_hypotheses --top-k ")).toBe(true);

    const topKSuggestions = buildSuggestions({
      input: "/agent run generate_hypotheses --top-k ",
      runs,
      activeRunId: "run-alpha-123"
    });
    expect(topKSuggestions.some((s) => s.applyValue === "/agent run generate_hypotheses --top-k 3 ")).toBe(true);

    const branchSuggestions = buildSuggestions({
      input: "/agent run generate_hypotheses --branch-count ",
      runs,
      activeRunId: "run-alpha-123"
    });
    expect(branchSuggestions.some((s) => s.applyValue === "/agent run generate_hypotheses --branch-count 6 ")).toBe(true);
  });

  it("suggests run ids for /agent jump <node>", () => {
    const suggestions = buildSuggestions({ input: "/agent jump implement_experiments run-", runs, activeRunId: "run-alpha-123" });
    expect(suggestions.some((s) => s.applyValue === "/agent jump implement_experiments run-alpha-123")).toBe(
      true
    );
  });

  it("suggests presets and runs for /agent recollect", () => {
    const presets = buildSuggestions({ input: "/agent recollect 2", runs, activeRunId: "run-alpha-123" });
    expect(presets.some((s) => s.applyValue === "/agent recollect 20 ")).toBe(true);

    const runHints = buildSuggestions({ input: "/agent recollect 200 run-", runs, activeRunId: "run-alpha-123" });
    expect(runHints.some((s) => s.applyValue === "/agent recollect 200 run-alpha-123")).toBe(true);
  });

  it("suggests collect options and enums", () => {
    const optionSuggestions = buildSuggestions({ input: "/agent collect --s", runs, activeRunId: "run-alpha-123" });
    expect(optionSuggestions.some((s) => s.applyValue.startsWith("/agent collect --sort"))).toBe(true);

    const enumSuggestions = buildSuggestions({ input: "/agent collect --sort c", runs, activeRunId: "run-alpha-123" });
    expect(enumSuggestions.some((s) => s.applyValue === "/agent collect --sort citationCount ")).toBe(true);
  });

  it("suggests /model command only", () => {
    const rootSuggestions = buildSuggestions({ input: "/mod", runs, activeRunId: "run-alpha-123" });
    expect(rootSuggestions.some((s) => s.applyValue.startsWith("/model"))).toBe(true);

    const selectorSuggestions = buildSuggestions({ input: "/model effort x", runs, activeRunId: "run-alpha-123" });
    expect(selectorSuggestions.some((s) => s.applyValue === "/model ")).toBe(true);
    expect(selectorSuggestions.some((s) => s.applyValue.includes("effort"))).toBe(false);
  });

  it("shows current run title in /title suggestions", () => {
    const rootSuggestions = buildSuggestions({ input: "/tit", runs, activeRunId: "run-alpha-123" });
    expect(rootSuggestions.some((s) => s.applyValue === "/title " && s.description.includes("Agentic Retrieval Benchmark Run"))).toBe(true);

    const titleSuggestions = buildSuggestions({ input: "/title ", runs, activeRunId: "run-alpha-123" });
    expect(titleSuggestions.some((s) => s.applyValue === "/title " && s.description.includes("Agentic Retrieval Benchmark Run"))).toBe(true);
  });

  it("suggests runs for /agent collect --run", () => {
    const suggestions = buildSuggestions({ input: "/agent collect ai --run run-", runs, activeRunId: "run-alpha-123" });
    expect(suggestions.some((s) => s.applyValue.endsWith("run-alpha-123"))).toBe(true);
  });

  it("suggests runs for /agent clear_papers", () => {
    const suggestions = buildSuggestions({ input: "/agent clear_papers run-", runs, activeRunId: "run-alpha-123" });
    expect(suggestions.some((s) => s.applyValue === "/agent clear_papers run-alpha-123")).toBe(true);
  });

  it("suggests nodes for /agent clear and /agent count", () => {
    const clearNodeSuggestions = buildSuggestions({ input: "/agent clear col", runs, activeRunId: "run-alpha-123" });
    expect(clearNodeSuggestions.some((s) => s.applyValue === "/agent clear collect_papers ")).toBe(true);

    const countNodeSuggestions = buildSuggestions({ input: "/agent count ana", runs, activeRunId: "run-alpha-123" });
    expect(countNodeSuggestions.some((s) => s.applyValue === "/agent count analyze_papers ")).toBe(true);
  });

  it("suggests runs for /agent clear <node> and /agent count <node>", () => {
    const clearRunSuggestions = buildSuggestions({ input: "/agent clear collect_papers run-", runs, activeRunId: "run-alpha-123" });
    expect(clearRunSuggestions.some((s) => s.applyValue === "/agent clear collect_papers run-alpha-123")).toBe(
      true
    );

    const countRunSuggestions = buildSuggestions({ input: "/agent count analyze_papers run-", runs, activeRunId: "run-alpha-123" });
    expect(countRunSuggestions.some((s) => s.applyValue === "/agent count analyze_papers run-alpha-123")).toBe(
      true
    );
  });

  it("suggests run ids for /agent status", () => {
    const suggestions = buildSuggestions({ input: "/agent status run-", runs, activeRunId: "run-alpha-123" });
    expect(suggestions.some((s) => s.applyValue === "/agent status run-alpha-123")).toBe(true);
  });
});
