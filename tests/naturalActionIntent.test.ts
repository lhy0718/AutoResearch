import { describe, expect, it, vi } from "vitest";

import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { extractStructuredActionPlan, looksLikeStructuredActionRequest } from "../src/core/commands/naturalActionIntent.js";
import { RunRecord } from "../src/types.js";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  const now = new Date().toISOString();
  const graph = overrides.graph ?? createDefaultGraphState();
  const currentNode = overrides.currentNode ?? graph.currentNode;
  return {
    version: 3,
    workflowVersion: 3,
    id: overrides.id ?? "run-1",
    title: overrides.title ?? "Multi-Agent Collaboration",
    topic: overrides.topic ?? "AI agent automation",
    constraints: overrides.constraints ?? [],
    objectiveMetric: overrides.objectiveMetric ?? "accuracy",
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

describe("naturalActionIntent", () => {
  it("detects action-like natural inputs", () => {
    expect(looksLikeStructuredActionRequest("논문 수집을 300건 진행해줘")).toBe(true);
    expect(looksLikeStructuredActionRequest("상위 30편만 분석해줘")).toBe(true);
    expect(looksLikeStructuredActionRequest("가설을 10개 뽑아줘")).toBe(true);
    expect(looksLikeStructuredActionRequest("수집된 논문은 몇 편이야?")).toBe(false);
  });

  it("extracts a structured collect command", async () => {
    const run = makeRun({ id: "run-collect" });
    const runForText = vi.fn().mockResolvedValue(
      JSON.stringify({
        target_run_id: run.id,
        actions: [
          {
            type: "collect",
            limit: 300,
            sort: { field: "relevance", order: "desc" },
            filters: { open_access: true }
          }
        ]
      })
    );
    const result = await extractStructuredActionPlan({
      input: "논문 수집을 300건 진행해줘. pdf 가능한걸로",
      runs: [run],
      activeRunId: run.id,
      llm: { runForText }
    });

    expect(result?.commands).toEqual([`/agent collect --sort relevance --limit 300 --open-access --run ${run.id}`]);
    expect(result?.displayActions).toEqual(["논문 수집 (limit=300, openAccess=true)"]);
    expect(runForText).not.toHaveBeenCalled();
  });

  it("extracts top-n analyze requests into /agent run analyze_papers --top-n", async () => {
    const run = makeRun({ id: "run-analyze" });
    const runForText = vi.fn();
    const result = await extractStructuredActionPlan({
      input: "상위 30편만 분석 진행해줘",
      runs: [run],
      activeRunId: run.id,
      llm: { runForText }
    });

    expect(result?.commands).toEqual([`/agent run analyze_papers ${run.id} --top-n 30`]);
    expect(result?.displayActions).toEqual(["상위 30개 논문 분석"]);
    expect(runForText).not.toHaveBeenCalled();
  });

  it("extracts hypothesis-generation requests into /agent run generate_hypotheses", async () => {
    const run = makeRun({ id: "run-hypotheses" });
    const runForText = vi.fn();
    const result = await extractStructuredActionPlan({
      input: "가설을 10개 뽑아줘",
      runs: [run],
      activeRunId: run.id,
      llm: { runForText }
    });

    expect(result?.commands).toEqual([
      `/agent run generate_hypotheses ${run.id} --top-k 10 --branch-count 10`
    ]);
    expect(result?.displayActions).toEqual(["가설 생성 (topK=10, branchCount=10)"]);
    expect(runForText).not.toHaveBeenCalled();
  });

  it("extracts multi-step clear + collect plans", async () => {
    const run = makeRun({ id: "run-plan", title: "Multi-Agent Collaboration" });
    const result = await extractStructuredActionPlan({
      input: "수집된 논문들을 모두 지우고 title 관련 논문 50개만 다시 모아줘",
      runs: [run],
      activeRunId: run.id,
      llm: {
        runForText: async () =>
          JSON.stringify({
            target_run_id: run.id,
            actions: [
              { type: "clear", node: "collect_papers" },
              {
                type: "collect",
                query: run.title,
                limit: 50,
                sort: { field: "relevance", order: "desc" }
              }
            ]
          })
      }
    });

    expect(result?.commands).toEqual([
      `/agent clear collect_papers ${run.id}`,
      `/agent collect "${run.title}" --sort relevance --limit 50 --run ${run.id}`
    ]);
    expect(result?.displayActions).toEqual([
      "collect_papers 산출물 정리",
      `논문 수집 (query=\"${run.title}\", limit=50)`
    ]);
  });

  it("ignores unsupported or empty plans", async () => {
    const run = makeRun({ id: "run-none" });
    const result = await extractStructuredActionPlan({
      input: "수집된 논문은 몇 편이야?",
      runs: [run],
      activeRunId: run.id,
      llm: {
        runForText: async () =>
          JSON.stringify({
            target_run_id: run.id,
            actions: []
          })
      }
    });

    expect(result).toBeUndefined();
  });
});
