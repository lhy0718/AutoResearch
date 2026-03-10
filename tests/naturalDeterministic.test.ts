import { describe, expect, it } from "vitest";

import {
  buildCollectSlashCommand,
  extractCollectRequestFromNatural,
  formatSupportedNaturalInputLines,
  isSupportedNaturalInputsQuery,
  resolveDeterministicPendingCommand
} from "../src/core/commands/naturalDeterministic.js";
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
    title: overrides.title ?? "AI agent automation",
    topic: overrides.topic ?? "AI agent automation",
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

describe("naturalDeterministic", () => {
  it("recognizes supported natural input listing queries", () => {
    expect(isSupportedNaturalInputsQuery("지원되는 자연어 입력을 보여줘")).toBe(true);
    expect(isSupportedNaturalInputsQuery("what natural inputs are supported?")).toBe(true);
  });

  it("formats supported natural input lines", () => {
    const lines = formatSupportedNaturalInputLines("ko");
    expect(lines[0]).toContain("지원되는 자연어 입력");
    expect(lines.some((line) => line.includes("/agent collect"))).toBe(true);
  });

  it("maps run selection requests to /run", () => {
    const run = makeRun({ id: "run-alpha", title: "Alpha study" });
    const result = resolveDeterministicPendingCommand("Alpha study run 열어줘", {
      runs: [run],
      activeRunId: undefined
    });

    expect(result?.pendingCommand).toBe(`/run ${run.id}`);
    expect(result?.targetRunId).toBe(run.id);
  });

  it("maps node count requests to /agent count", () => {
    const run = makeRun({ id: "run-beta" });
    const result = resolveDeterministicPendingCommand("결과분석 단계 산출물 개수 보여줘", {
      runs: [run],
      activeRunId: run.id
    });

    expect(result?.pendingCommand).toBe(`/agent count analyze_results ${run.id}`);
  });

  it("extracts collect requests with filters", () => {
    const request = extractCollectRequestFromNatural("최근 5년 관련도 순으로 AI agent reasoning 100개 수집해줘");
    expect(request).toBeDefined();
    expect(request?.query).toBe("AI agent reasoning");
    expect(request?.limit).toBe(100);
    expect(request?.filters.lastYears).toBe(5);
    expect(request?.sort.field).toBe("relevance");
  });

  it("builds /agent collect commands from natural requests", () => {
    const request = extractCollectRequestFromNatural(
      'Nature와 Science에서 2021 이후 "AI agent reasoning" 논문 50개 수집해줘'
    );
    expect(request).toBeDefined();

    const command = buildCollectSlashCommand(request!, "run-gamma");
    expect(command).toContain('/agent collect "AI agent reasoning"');
    expect(command).toContain("--run run-gamma");
    expect(command).toContain("--limit 50");
    expect(command).toContain("--year 2021-");
    expect(command).toContain('--venue "Nature,Science"');
  });

  it("does not misclassify collected-paper count questions as collect commands", () => {
    const run = makeRun({ id: "run-count" });
    const result = resolveDeterministicPendingCommand("수집된 논문은 몇건이지?", {
      runs: [run],
      activeRunId: run.id
    });

    expect(result).toBeUndefined();
  });

  it("does not directly map collect prompts to pending commands anymore", () => {
    const run = makeRun({
      id: "run-shot",
      title: "Multi-agent collaboration in recent papers",
      topic: "Multi-agent collaboration"
    });

    const result = resolveDeterministicPendingCommand(
      "논문 300개를 pdf 있는 것만 관련도 순으로 최신 5년의 논문으로 조사해줘",
      {
        runs: [run],
        activeRunId: run.id
      }
    );

    expect(result).toBeUndefined();
  });
});
