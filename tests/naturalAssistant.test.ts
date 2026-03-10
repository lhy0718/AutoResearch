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

  it("explains workflow and next step when no runs exist", () => {
    const response = buildNaturalAssistantResponse({
      input: "파이프라인 구조 알려줘",
      runs: [],
      activeRunId: undefined
    });

    expect(response.lines.some((line) => line.includes("워크플로:"))).toBe(true);
    expect(response.lines).toContain("다음 단계: /new");
  });

  it("recommends /approve when current node needs approval", () => {
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
    expect(response.lines).toContain("다음 단계: /approve");
    expect(response.pendingCommand).toBeUndefined();
  });

  it("recommends running current node when run is active", () => {
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

    expect(response.lines).toContain(`Next step: /agent run ${run.currentNode} ${run.id}`);
    expect(response.pendingCommand).toBeUndefined();
  });

  it("recommends budget inspection for failed_budget runs", () => {
    const run = makeRun({
      id: "run-budget",
      status: "failed_budget",
      currentNode: "analyze_results"
    });
    run.graph.currentNode = "analyze_results";
    run.graph.nodeStates.analyze_results.status = "failed";

    const response = buildNaturalAssistantResponse({
      input: "status and next",
      runs: [run],
      activeRunId: run.id
    });

    expect(response.lines).toContain(`Next step: /agent budget ${run.id}`);
    expect(response.lines).toContain(`Then retry: /agent retry ${run.currentNode} ${run.id}`);
    expect(response.pendingCommand).toBeUndefined();
  });

  it("returns pending command when execution intent is present", () => {
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

  it("returns /new as pending command when execution intent has no run", () => {
    const response = buildNaturalAssistantResponse({
      input: "시작해줘",
      runs: [],
      activeRunId: undefined
    });

    expect(response.pendingCommand).toBe("/new");
  });
});
