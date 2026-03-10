import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import { AgentOrchestrator } from "../src/core/agents/agentOrchestrator.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { RunStore } from "../src/core/runs/runStore.js";
import { CheckpointStore } from "../src/core/stateGraph/checkpointStore.js";
import { StateGraphRuntime } from "../src/core/stateGraph/runtime.js";
import { GraphNodeHandler, GraphNodeRegistry } from "../src/core/stateGraph/types.js";
import { GRAPH_NODE_ORDER, GraphNodeId } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

class DeterministicRegistry implements GraphNodeRegistry {
  constructor(private readonly handlers: Partial<Record<GraphNodeId, GraphNodeHandler>>) {}

  get(nodeId: GraphNodeId): GraphNodeHandler {
    const explicit = this.handlers[nodeId];
    if (explicit) {
      return explicit;
    }

    return {
      id: nodeId,
      execute: async () => ({
        status: "success",
        summary: `${nodeId} ok`,
        needsApproval: true,
        toolCallsUsed: 1
      })
    };
  }

  list(): GraphNodeHandler[] {
    return GRAPH_NODE_ORDER.map((node) => this.get(node));
  }
}

function failingNode(id: GraphNodeId, message: string): GraphNodeHandler {
  return {
    id,
    execute: async () => ({
      status: "failure",
      error: message,
      toolCallsUsed: 1
    })
  };
}

function cancellableSlowNode(id: GraphNodeId, delayMs: number): GraphNodeHandler {
  return {
    id,
    execute: async (ctx) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          resolve();
        }, delayMs);
        const cleanup = () => {
          clearTimeout(timer);
          ctx.abortSignal?.removeEventListener("abort", onAbort);
        };
        const onAbort = () => {
          cleanup();
          reject(new Error("Operation aborted by user"));
        };
        if (ctx.abortSignal) {
          if (ctx.abortSignal.aborted) {
            onAbort();
          } else {
            ctx.abortSignal.addEventListener("abort", onAbort, { once: true });
          }
        }
      });

      return {
        status: "success",
        summary: `${id} done`,
        needsApproval: true,
        toolCallsUsed: 1
      };
    }
  };
}

async function setup(registry: GraphNodeRegistry): Promise<{
  store: RunStore;
  orchestrator: AgentOrchestrator;
  checkpointStore: CheckpointStore;
}> {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "autoresearch-orchestrator-"));
  tempDirs.push(cwd);

  const paths = resolveAppPaths(cwd);
  await ensureScaffold(paths);

  const store = new RunStore(paths);
  const checkpointStore = new CheckpointStore(paths);
  const runtime = new StateGraphRuntime(store, registry, checkpointStore, new InMemoryEventStream());
  const orchestrator = new AgentOrchestrator(store, runtime, checkpointStore);
  return { store, orchestrator, checkpointStore };
}

describe("AgentOrchestrator (state graph)", () => {
  it("runs node and pauses on approval gate", async () => {
    const { store, orchestrator } = await setup(new DeterministicRegistry({}));

    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const result = await orchestrator.runAgent(run.id, "collect_papers");
    expect(result.result.status).toBe("success");

    const latest = await store.getRun(run.id);
    expect(latest?.currentNode).toBe("collect_papers");
    expect(latest?.graph.nodeStates.collect_papers.status).toBe("needs_approval");

    const approved = await orchestrator.approveCurrent(run.id);
    expect(approved.currentNode).toBe("analyze_papers");
  });

  it("auto advances from implement_experiments to run_experiments when approval is not required", async () => {
    const registry = new DeterministicRegistry({
      implement_experiments: {
        id: "implement_experiments",
        execute: async () => ({
          status: "success",
          summary: "Implementation verified locally and handed off to run_experiments.",
          needsApproval: false,
          toolCallsUsed: 2
        })
      }
    });
    const { store, orchestrator } = await setup(registry);

    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const result = await orchestrator.runAgent(run.id, "implement_experiments");
    expect(result.result.status).toBe("success");

    const latest = await store.getRun(run.id);
    expect(latest?.currentNode).toBe("run_experiments");
    expect(latest?.graph.nodeStates.implement_experiments.status).toBe("completed");
    expect(latest?.graph.nodeStates.run_experiments.status).toBe("needs_approval");
  });

  it("feeds run_experiments failure context back into implement_experiments after rollback", async () => {
    let implementCalls = 0;
    const seenFeedback: string[] = [];
    const registry = new DeterministicRegistry({
      implement_experiments: {
        id: "implement_experiments",
        execute: async ({ run }) => {
          implementCalls += 1;
          const memory = new RunContextMemory(run.memoryRefs.runContextPath);
          const feedback = await memory.get<{ summary?: string }>("implement_experiments.runner_feedback");
          seenFeedback.push(feedback?.summary || "");
          return {
            status: "success",
            summary:
              implementCalls === 1
                ? "Initial implementation handed off to the runner."
                : "Repair implementation informed by runner feedback.",
            needsApproval: implementCalls >= 2,
            toolCallsUsed: 1
          };
        }
      },
      run_experiments: {
        id: "run_experiments",
        execute: async ({ run }) => {
          const memory = new RunContextMemory(run.memoryRefs.runContextPath);
          await memory.put("implement_experiments.runner_feedback", {
            source: "run_experiments",
            status: "fail",
            trigger: "auto_handoff",
            stage: "metrics",
            summary: "Experiment finished without metrics output at metrics_runner.py",
            suggested_next_action: "Ensure the experiment writes JSON metrics to the required metrics path before finishing.",
            recorded_at: new Date().toISOString()
          });
          return {
            status: "failure",
            error: "Experiment finished without metrics output",
            toolCallsUsed: 1
          };
        }
      }
    });
    const { store, orchestrator } = await setup(registry);

    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const result = await orchestrator.runAgent(run.id, "implement_experiments");
    expect(result.result.status).toBe("success");

    const latest = await store.getRun(run.id);
    expect(implementCalls).toBe(2);
    expect(seenFeedback[0]).toBe("");
    expect(seenFeedback[1]).toContain("metrics output");
    expect(latest?.currentNode).toBe("implement_experiments");
    expect(latest?.graph.nodeStates.implement_experiments.status).toBe("needs_approval");
    expect((latest?.graph.retryCounters.run_experiments ?? 0)).toBeGreaterThanOrEqual(3);
  });

  it("auto retries then rolls back when failure persists", async () => {
    const registry = new DeterministicRegistry({
      generate_hypotheses: failingNode("generate_hypotheses", "hypothesis failed")
    });
    const { store, orchestrator } = await setup(registry);

    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const outcome = await orchestrator.runAgent(run.id, "generate_hypotheses");
    expect(outcome.result.status).toBe("success");

    const latest = await store.getRun(run.id);
    expect(latest?.currentNode).toBe("analyze_papers");
    expect(latest?.graph.rollbackCounters.generate_hypotheses).toBe(1);
    expect((latest?.graph.retryCounters.generate_hypotheses ?? 0)).toBeGreaterThanOrEqual(3);
  });

  it("supports force jump and marks skipped nodes", async () => {
    const { store, orchestrator } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const jumped = await orchestrator.jumpToNode(run.id, "run_experiments", "force", "skip ahead");
    expect(jumped.currentNode).toBe("run_experiments");
    expect(jumped.graph.nodeStates.collect_papers.status).toBe("skipped");
    expect(jumped.graph.nodeStates.design_experiments.status).toBe("skipped");
  });

  it("applies a pending transition recommendation from analyze_results", async () => {
    const registry = new DeterministicRegistry({
      analyze_results: {
        id: "analyze_results",
        execute: async () => ({
          status: "success",
          summary: "Objective missed; revise the design.",
          needsApproval: true,
          toolCallsUsed: 1,
          transitionRecommendation: {
            action: "backtrack_to_design",
            sourceNode: "analyze_results",
            targetNode: "design_experiments",
            reason: "The current design needs revision.",
            confidence: 0.82,
            autoExecutable: true,
            evidence: ["Objective metric not met."],
            suggestedCommands: ["/agent jump design_experiments", "/agent run design_experiments"],
            generatedAt: new Date().toISOString()
          }
        })
      }
    });
    const { store, orchestrator } = await setup(registry);
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    await orchestrator.runAgent(run.id, "analyze_results");
    const applied = await orchestrator.applyPendingTransition(run.id);

    expect(applied.currentNode).toBe("design_experiments");
    expect(applied.graph.pendingTransition).toBeUndefined();
    expect(applied.graph.researchCycle).toBe(1);
    expect(applied.graph.transitionHistory.at(-1)?.action).toBe("backtrack_to_design");
  });

  it("fails with failed_budget when budget is exceeded", async () => {
    const { store, orchestrator } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.graph.budget.policy.maxToolCalls = 0;
    await store.updateRun(run);

    const outcome = await orchestrator.runAgent(run.id, "collect_papers");
    expect(outcome.result.status).toBe("failure");

    const latest = await store.getRun(run.id);
    expect(latest?.status).toBe("failed_budget");
  });

  it("can resume from saved checkpoints", async () => {
    const { store, orchestrator } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    await orchestrator.runAgent(run.id, "collect_papers");
    const points = await orchestrator.listCheckpoints(run.id);
    expect(points.length).toBeGreaterThan(0);

    const target = points[Math.max(0, points.length - 1)];
    const resumed = await orchestrator.resumeRun(run.id, target);
    expect(resumed.id).toBe(run.id);
  });

  it("cancels a running agent task with abort signal", async () => {
    const registry = new DeterministicRegistry({
      collect_papers: cancellableSlowNode("collect_papers", 1000)
    });
    const { store, orchestrator } = await setup(registry);
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const controller = new AbortController();
    const pending = orchestrator.runAgentWithOptions(run.id, "collect_papers", {
      abortSignal: controller.signal
    });

    setTimeout(() => {
      controller.abort();
    }, 40);

    const result = await pending;
    expect(result.run.status).toBe("paused");
    expect(result.run.graph.nodeStates.collect_papers.status).toBe("pending");
  });
});
