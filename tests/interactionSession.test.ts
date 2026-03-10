import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAppPaths, ensureScaffold } from "../src/config.js";
import { InteractionSession } from "../src/interaction/InteractionSession.js";
import { RunStore } from "../src/core/runs/runStore.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

function makeRun(id: string): RunRecord {
  const now = new Date().toISOString();
  const graph = createDefaultGraphState();
  return {
    version: 3,
    workflowVersion: 3,
    id,
    title: `Run ${id}`,
    topic: "topic",
    constraints: ["recent papers"],
    objectiveMetric: "metric",
    status: "pending",
    currentNode: graph.currentNode,
    latestSummary: undefined,
    nodeThreads: {},
    createdAt: now,
    updatedAt: now,
    graph,
    memoryRefs: {
      runContextPath: `.autoresearch/runs/${id}/memory/run_context.json`,
      longTermPath: `.autoresearch/runs/${id}/memory/long_term.jsonl`,
      episodePath: `.autoresearch/runs/${id}/memory/episodes.jsonl`
    }
  };
}

describe("InteractionSession", () => {
  let cwd: string;
  let runStore: RunStore;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autoresearch-session-"));
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);
    runStore = new RunStore(paths);
  });

  it("creates runs through the shared session and selects the new run", async () => {
    const session = new InteractionSession({
      workspaceRoot: cwd,
      config: {
        research: {
          defaultTopic: "topic",
          defaultConstraints: ["recent papers"],
          default_objective_metric: "metric"
        }
      } as any,
      runStore,
      titleGenerator: {
        generateTitle: vi.fn().mockResolvedValue("Generated title")
      } as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: true
    });
    await session.start();

    const run = await session.createRun({
      topic: "Agent planning",
      constraints: ["recent papers"],
      objectiveMetric: "sample efficiency"
    });

    expect(run.title).toBe("Generated title");
    expect(session.snapshot().activeRunId).toBe(run.id);
    expect(session.snapshot().logs.some((line) => line.includes(`Created run ${run.id}`))).toBe(true);
  });

  it("cancels a pending plan without executing any step", async () => {
    const session = new InteractionSession({
      workspaceRoot: cwd,
      config: {
        research: {
          defaultTopic: "topic",
          defaultConstraints: ["recent papers"],
          default_objective_metric: "metric"
        },
        providers: {
          llm_mode: "codex_chatgpt_only",
          codex: { model: "gpt-5.3-codex", reasoning_effort: "xhigh", fast_mode: false },
          openai: { model: "gpt-5.4", reasoning_effort: "medium" }
        },
        analysis: {
          pdf_mode: "codex_text_extract",
          responses_model: "gpt-5.4"
        },
        papers: { max_results: 100 }
      } as any,
      runStore,
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: true
    }) as any;
    await session.start();
    session.pendingNaturalCommand = {
      command: "/help",
      commands: ["/help"],
      sourceInput: "test",
      createdAt: new Date().toISOString(),
      stepIndex: 0,
      totalSteps: 1
    };

    const result = await session.respondToPending("cancel");

    expect(result.pendingPlan).toBeUndefined();
    expect(result.logs.some((line) => line.includes("Canceled pending command"))).toBe(true);
  });

  it("answers direct paper-count questions from stored artifacts", async () => {
    const run = await runStore.createRun({
      title: "Count run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    const runDir = path.join(cwd, ".autoresearch", "runs", run.id);
    await fs.writeFile(
      path.join(runDir, "corpus.jsonl"),
      ['{"title":"Paper A"}', '{"title":"Paper B"}', '{"title":"Paper C"}'].join("\n"),
      "utf8"
    );
    const session = new InteractionSession({
      workspaceRoot: cwd,
      config: {
        research: {
          defaultTopic: "topic",
          defaultConstraints: ["recent papers"],
          default_objective_metric: "metric"
        },
        providers: {
          llm_mode: "codex_chatgpt_only",
          codex: { model: "gpt-5.3-codex", reasoning_effort: "xhigh", fast_mode: false },
          openai: { model: "gpt-5.4", reasoning_effort: "medium" }
        },
        analysis: {
          pdf_mode: "codex_text_extract",
          responses_model: "gpt-5.4"
        },
        papers: { max_results: 100 }
      } as any,
      runStore,
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: true
    });
    await session.start();
    await session.selectRun(run.id);

    const result = await session.submitInput("수집된 논문은 몇건이지?");

    expect(result.logs.some((line) => line.includes("현재 수집된 논문은 3편입니다."))).toBe(true);
  });
});
