import { describe, expect, it } from "vitest";

import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";
import { buildContextualGuidance, detectGuidanceLanguageFromText } from "../src/tui/contextualGuidance.js";

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

describe("buildContextualGuidance", () => {
  it("shows startup actions when no run exists", () => {
    const guidance = buildContextualGuidance({});

    expect(guidance?.title).toBe("Start here");
    expect(guidance?.items.some((item) => item.label === "/new")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "/help")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "what natural inputs are supported?")).toBe(true);
    expect(guidance?.items.length).toBeGreaterThanOrEqual(7);
  });

  it("shows a broad action catalog for an active run", () => {
    const run = makeRun({
      id: "run-active",
      currentNode: "analyze_papers",
      status: "running"
    });
    run.graph.currentNode = "analyze_papers";
    run.graph.nodeStates.analyze_papers.status = "running";

    const guidance = buildContextualGuidance({ run });

    expect(guidance?.title).toBe("Next actions");
    expect(guidance?.items[0]?.label).toBe("/agent run analyze_papers run-active");
    expect(guidance?.items[1]?.label).toBe("/agent status run-active");
    expect(guidance?.items.some((item) => item.label === "/agent graph run-active")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "/agent budget run-active")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "/agent count analyze_papers run-active")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "/agent run analyze_papers run-active --top-n 50")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "analyze the top 50 papers")).toBe(true);
    expect(guidance?.items.length).toBeGreaterThanOrEqual(10);
  });

  it("shows y/a/n controls for pending plans", () => {
    const guidance = buildContextualGuidance({
      pendingPlan: {
        command: "/agent run collect_papers run-1",
        commands: ["/agent run collect_papers run-1", "/agent run analyze_papers run-1"],
        stepIndex: 0,
        totalSteps: 2
      }
    });

    expect(guidance?.title).toBe("Pending plan");
    expect(guidance?.items.some((item) => item.label === "y")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "a")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "n")).toBe(true);
  });

  it("localizes guidance to Korean when requested", () => {
    const guidance = buildContextualGuidance({ language: "ko" });

    expect(guidance?.title).toBe("시작 가이드");
    expect(guidance?.items.some((item) => item.label === "지원되는 자연어 입력을 보여줘")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "/설정" || item.label === "/settings")).toBe(true);
  });

  it("keeps display and apply values separate for pending plans", () => {
    const guidance = buildContextualGuidance({
      language: "ko",
      pendingPlan: {
        command: "/agent run analyze_papers run-1 --top-n 30",
        commands: ["/agent run analyze_papers run-1 --top-n 30"],
        displayCommands: ["상위 30개 논문 분석"],
        stepIndex: 0,
        totalSteps: 1
      }
    });

    expect(guidance?.items[0]?.label).toBe("상위 30개 논문 분석");
    expect(guidance?.items[0]?.applyValue).toBe("/agent run analyze_papers run-1 --top-n 30");
  });

  it("detects guidance language from user text", () => {
    expect(detectGuidanceLanguageFromText("현재 상태 보여줘")).toBe("ko");
    expect(detectGuidanceLanguageFromText("show current status")).toBe("en");
  });
});
