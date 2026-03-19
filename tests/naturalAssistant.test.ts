import { describe, expect, it } from "vitest";

import { buildNaturalAssistantResponse, matchesNaturalAssistantIntent } from "../src/core/commands/naturalAssistant.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

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

describe("buildNaturalAssistantResponse", () => {
  it("detects status and next-step intents locally", () => {
    expect(matchesNaturalAssistantIntent("what should I do next?")).toBe(true);
    expect(matchesNaturalAssistantIntent("현재 상태 보여줘")).toBe(true);
    expect(matchesNaturalAssistantIntent("논문 제목 하나 알려줘")).toBe(false);
  });

  it("explains the workflow and brief-first flow when no runs exist", () => {
    const response = buildNaturalAssistantResponse({
      input: "파이프라인 구조 알려줘",
      runs: [],
      activeRunId: undefined
    });

    expect(response.lines.some((line) => line.includes("Workflow:"))).toBe(true);
    expect(response.lines).toContain("Next action: new brief");
    expect(response.lines).toContain("Create a Research Brief with /new and start it with /brief start --latest.");
  });

  it("recommends approve when the current node needs approval", () => {
    const run = makeRun({
      id: "run-approve",
      status: "paused"
    });
    run.graph.nodeStates[run.currentNode].status = "needs_approval";

    const response = buildNaturalAssistantResponse({
      input: "다음에 뭐 해야 해?",
      runs: [run],
      activeRunId: run.id
    });

    expect(response.targetRunId).toBe(run.id);
    expect(response.lines).toContain("Next action: approve");
    expect(response.pendingCommand).toBeUndefined();
  });

  it("recommends run when the current node is active", () => {
    const run = makeRun({
      id: "run-exec",
      status: "running"
    });
    run.graph.nodeStates[run.currentNode].status = "running";

    const response = buildNaturalAssistantResponse({
      input: "what should I do next",
      runs: [run],
      activeRunId: run.id
    });

    expect(response.lines).toContain("Next action: run");
    expect(response.lines).toContain(`This continues ${run.currentNode}.`);
    expect(response.pendingCommand).toBeUndefined();
  });

  it("keeps failed guidance on run while pointing to the retry behavior", () => {
    const run = makeRun({
      id: "run-failed",
      status: "failed",
      currentNode: "analyze_results"
    });
    run.graph.currentNode = "analyze_results";
    run.graph.nodeStates.analyze_results.status = "failed";

    const response = buildNaturalAssistantResponse({
      input: "status and next",
      runs: [run],
      activeRunId: run.id
    });

    expect(response.lines).toContain("Next action: run");
    expect(response.lines).toContain("This retries analyze_results.");
    expect(response.pendingCommand).toBeUndefined();
  });

  it("prefers an apply-transition recommendation for failed runs when a pending transition exists", () => {
    const run = makeRun({
      id: "run-failed-transition",
      status: "failed",
      currentNode: "run_experiments"
    });
    run.graph.currentNode = "run_experiments";
    run.graph.nodeStates.run_experiments.status = "failed";
    run.graph.pendingTransition = {
      action: "backtrack_to_design",
      sourceNode: "analyze_results",
      targetNode: "design_experiments",
      reason: "Objective not met",
      confidence: 0.64,
      autoExecutable: true,
      evidence: ["accuracy_delta_vs_baseline < 0"],
      suggestedCommands: ["/agent jump design_experiments", "/agent run design_experiments"],
      generatedAt: new Date().toISOString()
    };

    const response = buildNaturalAssistantResponse({
      input: "what should I do next",
      runs: [run],
      activeRunId: run.id
    });

    expect(response.lines).toContain("Next action: apply transition");
    expect(response.lines).toContain("Apply the recorded transition to design_experiments.");
    expect(response.pendingCommand).toBeUndefined();
  });

  it("returns the underlying run command when execution intent is present", () => {
    const run = makeRun({
      id: "run-execute",
      status: "running"
    });
    run.graph.nodeStates[run.currentNode].status = "running";

    const response = buildNaturalAssistantResponse({
      input: "run it now",
      runs: [run],
      activeRunId: run.id
    });

    expect(response.pendingCommand).toBe(`/agent run ${run.currentNode} ${run.id}`);
  });

  it("returns /new as the pending command when execution intent has no run", () => {
    const response = buildNaturalAssistantResponse({
      input: "시작해줘",
      runs: [],
      activeRunId: undefined
    });

    expect(response.pendingCommand).toBe("/new");
  });
});
