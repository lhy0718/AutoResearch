import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAppPaths, ensureScaffold } from "../src/config.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { RunStore } from "../src/core/runs/runStore.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { InteractionSession } from "../src/interaction/InteractionSession.js";

describe("run brief start flow", () => {
  let cwd: string;
  let runStore: RunStore;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-run-brief-"));
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);
    runStore = new RunStore(paths);
  });

  it("creates a run from a natural-language brief and auto-starts research", async () => {
    const runCurrentAgentWithOptions = vi.fn(async (runId: string) => {
      const stored = await runStore.getRun(runId);
      if (!stored) {
        throw new Error("expected run to exist");
      }
      stored.status = "running";
      stored.latestSummary = "collect_papers started";
      stored.graph.nodeStates.collect_papers = {
        status: "running",
        updatedAt: new Date().toISOString(),
        note: "Collecting papers."
      };
      await runStore.updateRun(stored);
      return {
        run: stored,
        result: {
          status: "success" as const,
          summary: "collect_papers started"
        }
      };
    });

    const session = new InteractionSession({
      workspaceRoot: cwd,
      config: {
        research: {
          default_topic: "default topic",
          default_constraints: ["recent papers"],
          default_objective_metric: "default metric"
        },
        providers: {
          llm_mode: "codex_chatgpt_only",
          codex: {
            model: "gpt-5.3-codex",
            chat_model: "gpt-5.3-codex",
            reasoning_effort: "medium",
            chat_reasoning_effort: "medium",
            fast_mode: false,
            chat_fast_mode: false
          },
          openai: {
            model: "gpt-5.4",
            reasoning_effort: "medium"
          }
        },
        analysis: {
          responses_model: "gpt-5.4"
        },
        papers: { max_results: 100 }
      } as any,
      runStore,
      titleGenerator: {
        generateTitle: vi.fn().mockResolvedValue("Natural brief run")
      } as any,
      codex: {
        runTurnStream: vi.fn(async () => {
          throw new Error("llm unavailable");
        })
      } as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {
        runCurrentAgentWithOptions
      } as any,
      semanticScholarApiKeyConfigured: true
    });
    await session.start();

    const result = await session.submitInput([
      "새 연구를 시작해줘",
      "주제: SWE-bench에서 멀티에이전트 수정 전략 비교",
      "목표: pass@1 improvement over baseline",
      "제약: 최근 3년 논문, 오픈소스 데이터셋, 6시간 제한",
      "계획: baseline, ablation, confirmatory run까지 자동으로 진행"
    ].join("\n"));

    const runs = await runStore.listRuns();
    expect(runs).toHaveLength(1);
    const run = runs[0];
    expect(run.title).toBe("Natural brief run");
    expect(run.topic).toBe("SWE-bench에서 멀티에이전트 수정 전략 비교");
    expect(run.objectiveMetric).toBe("pass@1 improvement over baseline");
    expect(run.constraints).toEqual(["최근 3년 논문", "오픈소스 데이터셋", "6시간 제한"]);
    expect(runCurrentAgentWithOptions).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) })
    );

    const runContext = new RunContextMemory(path.join(cwd, run.memoryRefs.runContextPath));
    expect(await runContext.get("run_brief.raw")).toContain("새 연구를 시작해줘");
    expect(await runContext.get("run_brief.plan_summary")).toBe("baseline, ablation, confirmatory run까지 자동으로 진행");
    expect(await runContext.get("run_brief.extracted")).toEqual(
      expect.objectContaining({
        topic: "SWE-bench에서 멀티에이전트 수정 전략 비교",
        objectiveMetric: "pass@1 improvement over baseline"
      })
    );

    expect(result.activeRunId).toBe(run.id);
    expect(result.logs.some((line) => line.includes(`Created run ${run.id}`))).toBe(true);
    expect(result.logs.some((line) => line.includes("Auto-starting research"))).toBe(true);
    expect(
      result.logs.some((line) => line.includes("Research start result: collect_papers started"))
    ).toBe(true);
    expect(
      result.logs.some((line) =>
        line.includes(`Created run ${run.id} from the natural-language brief and started research.`)
      )
    ).toBe(true);
  });
});
