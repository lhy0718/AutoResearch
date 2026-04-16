import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { buildNaturalAssistantResponseWithLlm } from "../src/core/commands/naturalLlmAssistant.js";
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

describe("buildNaturalAssistantResponseWithLlm", () => {
  it("uses model JSON response when valid", async () => {
    const run = makeRun({ id: "run-123", status: "running" });
    const response = await buildNaturalAssistantResponseWithLlm({
      input: "실행해줘",
      runs: [run],
      activeRunId: run.id,
      logs: [],
      llm: {
        runForText: async () =>
          JSON.stringify({
            reply_lines: ["지금 현재 노드를 실행할 수 있습니다."],
            target_run_id: run.id,
            recommended_command: `/agent run ${run.currentNode} ${run.id}`,
            should_offer_execute: true
          })
      }
    });

    expect(response.lines).toEqual(["지금 현재 노드를 실행할 수 있습니다."]);
    expect(response.targetRunId).toBe(run.id);
    expect(response.pendingCommand).toBe(`/agent run ${run.currentNode} ${run.id}`);
  });

  it("uses freeform LLM text when JSON parsing fails", async () => {
    const run = makeRun({ id: "run-freeform", status: "running" });
    const response = await buildNaturalAssistantResponseWithLlm({
      input: "논문을 더 수집할 수 있을까?",
      runs: [run],
      activeRunId: run.id,
      logs: [],
      llm: {
        runForText: async () => "가능합니다. /agent run collect_papers run-freeform 를 실행하세요."
      }
    });

    expect(response.lines[0]).toContain("가능합니다.");
    expect(response.targetRunId).toBe(run.id);
    expect(response.pendingCommand).toBeUndefined();
  });

  it("returns unavailable message when model call fails", async () => {
    const run = makeRun({ id: "run-error", status: "running" });
    const response = await buildNaturalAssistantResponseWithLlm({
      input: "무슨 문제가 있어?",
      runs: [run],
      activeRunId: run.id,
      logs: [],
      llm: {
        runForText: async () => {
          throw new Error("model offline");
        }
      }
    });

    expect(response.lines[0]).toContain("model response");
    expect(response.targetRunId).toBe(run.id);
  });

  it("rejects unsafe recommended command", async () => {
    const run = makeRun({ id: "run-safe", status: "running" });
    const response = await buildNaturalAssistantResponseWithLlm({
      input: "execute",
      runs: [run],
      activeRunId: run.id,
      logs: [],
      llm: {
        runForText: async () =>
          JSON.stringify({
            reply_lines: ["unsafe command suggested"],
            target_run_id: run.id,
            recommended_command: "rm -rf /",
            should_offer_execute: true
          })
      }
    });

    expect(response.pendingCommand).toBeUndefined();
  });

  it("falls back target run when model returns unknown run id", async () => {
    const run = makeRun({ id: "run-main", status: "running" });
    const response = await buildNaturalAssistantResponseWithLlm({
      input: "status",
      runs: [run],
      activeRunId: run.id,
      logs: [],
      llm: {
        runForText: async () =>
          JSON.stringify({
            reply_lines: ["Here is the current run status."],
            target_run_id: "not-found",
            recommended_command: "",
            should_offer_execute: false
          })
      }
    });

    expect(response.targetRunId).toBe(run.id);
  });

  it("accepts /agent recollect command recommendation", async () => {
    const run = makeRun({ id: "run-recollect", status: "paused" });
    const response = await buildNaturalAssistantResponseWithLlm({
      input: "논문 200개 더 수집해줘",
      runs: [run],
      activeRunId: run.id,
      logs: [],
      llm: {
        runForText: async () =>
          JSON.stringify({
            reply_lines: ["수집 노드로 돌아가 200편을 추가 수집할게요."],
            target_run_id: run.id,
            recommended_command: `/agent recollect 200 ${run.id}`,
            should_offer_execute: true
          })
      }
    });

    expect(response.pendingCommand).toBe(`/agent recollect 200 ${run.id}`);
  });

  it("accepts /agent collect command recommendation", async () => {
    const run = makeRun({ id: "run-collect", status: "paused" });
    const response = await buildNaturalAssistantResponseWithLlm({
      input: "최근 5년 논문 100개 수집해줘",
      runs: [run],
      activeRunId: run.id,
      logs: [],
      llm: {
        runForText: async () =>
          JSON.stringify({
            reply_lines: ["최근 5년 필터로 100편 수집을 제안합니다."],
            target_run_id: run.id,
            recommended_command: `/agent collect --last-years 5 --limit 100 --run ${run.id}`,
            should_offer_execute: true
          })
      }
    });

    expect(response.pendingCommand).toBe(`/agent collect --last-years 5 --limit 100 --run ${run.id}`);
  });

  it("accepts /agent clear_papers command recommendation", async () => {
    const run = makeRun({ id: "run-clear", status: "paused" });
    const response = await buildNaturalAssistantResponseWithLlm({
      input: "현재 조사한 모든 논문을 제거해줘",
      runs: [run],
      activeRunId: run.id,
      logs: [],
      llm: {
        runForText: async () =>
          JSON.stringify({
            reply_lines: ["현재 run의 논문 산출물을 정리할게요."],
            target_run_id: run.id,
            recommended_command: `/agent clear_papers ${run.id}`,
            should_offer_execute: true
          })
      }
    });

    expect(response.pendingCommand).toBe(`/agent clear_papers ${run.id}`);
  });

  it("accepts multi-step recommended_commands plans", async () => {
    const run = makeRun({ id: "run-plan", status: "paused" });
    const response = await buildNaturalAssistantResponseWithLlm({
      input: "논문을 지우고 최근 5년 논문을 다시 모아줘",
      runs: [run],
      activeRunId: run.id,
      logs: [],
      llm: {
        runForText: async () =>
          JSON.stringify({
            reply_lines: ["정리 후 다시 수집하는 2단계 계획입니다."],
            target_run_id: run.id,
            recommended_commands: [
              `/agent clear_papers ${run.id}`,
              `/agent collect --last-years 5 --sort relevance --run ${run.id}`
            ],
            should_offer_execute: true
          })
      }
    });

    expect(response.pendingCommands).toEqual([
      `/agent clear_papers ${run.id}`,
      `/agent collect --last-years 5 --sort relevance --run ${run.id}`
    ]);
    expect(response.pendingCommand).toBeUndefined();
  });

  it("includes workspace and run facts in prompt", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-natural-prompt-"));
    try {
      const run = makeRun({ id: "run-prompt", status: "paused" });
      const runRoot = path.join(workspace, ".autolabos", "runs", run.id);
      mkdirSync(path.join(runRoot, "memory"), { recursive: true });
      writeFileSync(
        path.join(runRoot, "corpus.jsonl"),
        [
          JSON.stringify({ title: "Paper A: Agent Planning" }),
          JSON.stringify({ title: "Paper B: Tool Use" })
        ].join("\n") + "\n",
        "utf8"
      );
      writeFileSync(
        path.join(runRoot, "hypotheses.jsonl"),
        [
          JSON.stringify({ hypothesis_id: "h_1", text: "Hypothesis 1" }),
          JSON.stringify({ hypothesis_id: "h_2", text: "Hypothesis 2" }),
          JSON.stringify({ hypothesis_id: "h_3", text: "Hypothesis 3" })
        ].join("\n") + "\n",
        "utf8"
      );
      writeFileSync(
        path.join(runRoot, "memory", "run_context.json"),
        JSON.stringify(
          {
            version: 1,
            items: [
              {
                key: "collect_papers.count",
                value: 2,
                updatedAt: new Date().toISOString()
              },
              {
                key: "generate_hypotheses.top_k",
                value: 3,
                updatedAt: new Date().toISOString()
              },
              {
                key: "generate_hypotheses.candidate_count",
                value: 6,
                updatedAt: new Date().toISOString()
              },
              {
                key: "generate_hypotheses.summary",
                value: "Generated 6 hypothesis candidate(s).",
                updatedAt: new Date().toISOString()
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );
      run.memoryRefs.runContextPath = `.autolabos/runs/${run.id}/memory/run_context.json`;

      let capturedPrompt = "";
      const response = await buildNaturalAssistantResponseWithLlm({
        input: "논문 제목 하나 알려줘",
        runs: [run],
        activeRunId: run.id,
        logs: [],
        workspaceRoot: workspace,
        llm: {
          runForText: async ({ prompt }) => {
            capturedPrompt = prompt;
            return JSON.stringify({
              reply_lines: ["1. Paper A: Agent Planning"],
              target_run_id: run.id,
              recommended_command: "",
              should_offer_execute: false
            });
          }
        }
      });

      expect(capturedPrompt).toContain("Workspace root:");
      expect(capturedPrompt).toContain("\"collectPapersCount\":2");
      expect(capturedPrompt).toContain("\"hypothesisStoredCount\":3");
      expect(capturedPrompt).toContain("\"hypothesisCandidateCount\":6");
      expect(capturedPrompt).toContain("hypothesisStoredCount is the canonical saved count");
      expect(capturedPrompt).toContain("Paper A: Agent Planning");
      expect(response.lines[0]).toContain("Paper A");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("retries with plain-text prompt when first model output is empty", async () => {
    const run = makeRun({ id: "run-retry", status: "running" });
    let calls = 0;

    const response = await buildNaturalAssistantResponseWithLlm({
      input: "논문 몇개 모았어?",
      runs: [run],
      activeRunId: run.id,
      logs: [],
      llm: {
        runForText: async () => {
          calls += 1;
          if (calls === 1) {
            return "   ";
          }
          return "현재 run에서 수집된 논문은 20편입니다.";
        }
      }
    });

    expect(calls).toBe(2);
    expect(response.lines[0]).toContain("20편");
  });

  it("returns the streamed text client output without requiring a legacy runTurnStream path", async () => {
    const run = makeRun({ id: "run-stream", status: "running" });
    const progress: string[] = [];

    const response = await buildNaturalAssistantResponseWithLlm({
      input: "논문 현황 알려줘",
      runs: [run],
      activeRunId: run.id,
      logs: [],
      llm: {
        runForText: async () =>
          JSON.stringify({
            reply_lines: ["현재 논문은 20편입니다."],
            target_run_id: run.id,
            recommended_command: "",
            should_offer_execute: false
          })
      },
      onProgress: (line) => {
        progress.push(line);
      }
    });

    expect(response.lines[0]).toContain("20편");
    expect(progress).toEqual([]);
  });
});
