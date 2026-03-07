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
      runContextPath: ".autoresearch/runs/run-1/memory/run_context.json",
      longTermPath: ".autoresearch/runs/run-1/memory/long_term.jsonl",
      episodePath: ".autoresearch/runs/run-1/memory/episodes.jsonl"
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

  it("maps collect requests to pending /agent collect commands", () => {
    const run = makeRun({ id: "run-delta" });
    const result = resolveDeterministicPendingCommand("논문 200개 더 수집해줘", {
      runs: [run],
      activeRunId: run.id
    });

    expect(result?.pendingCommand).toBe(`/agent collect --sort relevance --additional 200 --run ${run.id}`);
  });

  it("simulates 20 collection-like natural queries and maps them correctly", () => {
    const run = makeRun({
      id: "run-sim",
      title: "Multi-Agent Collaboration",
      topic: "AI agent automation"
    });

    const cases: Array<{ input: string; expected: string }> = [
      {
        input: "title과 관련한 논문들을 관련도 순으로 300개, 최근 5년, pdf 링크가 있는 것으로 모아줘",
        expected:
          '/agent collect "Multi-Agent Collaboration" --last-years 5 --sort relevance --limit 300 --open-access --run run-sim'
      },
      {
        input: "제목 관련 논문 50개 최근 3년 pdf 링크 있는 것만 수집해줘",
        expected:
          '/agent collect "Multi-Agent Collaboration" --last-years 3 --sort relevance --limit 50 --open-access --run run-sim'
      },
      {
        input: "run title 관련 논문 25개 가져와줘",
        expected: '/agent collect "Multi-Agent Collaboration" --sort relevance --limit 25 --run run-sim'
      },
      {
        input: "현재 title과 관련한 최근 2년 논문 10개 가져와줘",
        expected:
          '/agent collect "Multi-Agent Collaboration" --last-years 2 --sort relevance --limit 10 --run run-sim'
      },
      {
        input: "주제와 관련한 논문 30개 수집해줘",
        expected: '/agent collect "AI agent automation" --sort relevance --limit 30 --run run-sim'
      },
      {
        input: "현재 주제 관련 논문 15개 모아줘",
        expected: '/agent collect "AI agent automation" --sort relevance --limit 15 --run run-sim'
      },
      {
        input: "AI agent reasoning 논문 300편 pdf 링크가 있는 것으로 모아줘",
        expected: '/agent collect "AI agent reasoning" --sort relevance --limit 300 --open-access --run run-sim'
      },
      {
        input: "AI agent reasoning 관련 논문 300개, 최근 5년, pdf 링크 있는 것만 가져와줘",
        expected:
          '/agent collect "AI agent reasoning" --last-years 5 --sort relevance --limit 300 --open-access --run run-sim'
      },
      {
        input: "최근 5년 AI agent reasoning 논문 100개 수집해줘",
        expected: '/agent collect "AI agent reasoning" --last-years 5 --sort relevance --limit 100 --run run-sim'
      },
      {
        input: "AI agent reasoning 논문 100개 최근 5년 관련도 순으로 수집해줘",
        expected: '/agent collect "AI agent reasoning" --last-years 5 --sort relevance --limit 100 --run run-sim'
      },
      {
        input: '"AI agent reasoning" 논문 100개 최근 5년 관련도 순으로 수집해줘',
        expected: '/agent collect "AI agent reasoning" --last-years 5 --sort relevance --limit 100 --run run-sim'
      },
      {
        input: 'open access review papers only, top citations, 50 papers on "agent memory"',
        expected:
          '/agent collect "agent memory" --sort citationCount --order desc --limit 50 --type Review --open-access --run run-sim'
      },
      {
        input: 'collect 40 papers on "agent memory" from the last 3 years with pdf link',
        expected: '/agent collect "agent memory" --last-years 3 --sort relevance --limit 40 --open-access --run run-sim'
      },
      {
        input: 'gather 25 papers about "browser agents" with pdf available',
        expected: '/agent collect "browser agents" --sort relevance --limit 25 --open-access --run run-sim'
      },
      {
        input: 'fetch 60 papers on "tool use" with minimum citations 100',
        expected: '/agent collect "tool use" --sort relevance --limit 60 --min-citations 100 --run run-sim'
      },
      {
        input: 'search 80 papers on "planning agents" from 2021-2024',
        expected: '/agent collect "planning agents" --year 2021-2024 --sort relevance --limit 80 --run run-sim'
      },
      {
        input: "최근 5년동안의 멀티 에이전트 협업 관련 논문 20개 모아줘",
        expected: '/agent collect "멀티 에이전트 협업" --last-years 5 --sort relevance --limit 20 --run run-sim'
      },
      {
        input: "멀티 에이전트 협업과 관련한 논문 20편 pdf 링크가 있는 것으로 찾아줘",
        expected: '/agent collect "멀티 에이전트 협업" --sort relevance --limit 20 --open-access --run run-sim'
      },
      {
        input: '2021 이후 "AI agent reasoning" 논문 50개 오픈액세스만 수집해줘',
        expected:
          '/agent collect "AI agent reasoning" --year 2021- --sort relevance --limit 50 --open-access --run run-sim'
      },
      {
        input: 'Nature와 Science에서 "AI agent reasoning" 논문 50개 수집해줘',
        expected:
          '/agent collect "AI agent reasoning" --sort relevance --limit 50 --venue "Nature,Science" --run run-sim'
      }
    ];

    for (const entry of cases) {
      const result = resolveDeterministicPendingCommand(entry.input, {
        runs: [run],
        activeRunId: run.id
      });
      expect(result?.pendingCommand, entry.input).toBe(entry.expected);
    }
  });
});
