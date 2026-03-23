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
import { GRAPH_NODE_ORDER, GraphNodeId, WorkflowApprovalMode } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();
const tempDirs: string[] = [];

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
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

async function setup(
  registry: GraphNodeRegistry,
  runtimeOptions?: { approvalMode?: WorkflowApprovalMode }
): Promise<{
  store: RunStore;
  orchestrator: AgentOrchestrator;
  checkpointStore: CheckpointStore;
}> {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-orchestrator-"));
  tempDirs.push(cwd);
  process.chdir(cwd);

  const paths = resolveAppPaths(cwd);
  await ensureScaffold(paths);

  const store = new RunStore(paths);
  const checkpointStore = new CheckpointStore(paths);
  const runtime = new StateGraphRuntime(store, registry, checkpointStore, new InMemoryEventStream(), runtimeOptions);
  const orchestrator = new AgentOrchestrator(store, runtime, checkpointStore);
  return { store, orchestrator, checkpointStore };
}

describe("AgentOrchestrator (state graph)", () => {
  it("auto-approves standard node gates under the default minimal approval mode", async () => {
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
    expect(latest?.currentNode).toBe("analyze_papers");
    expect(latest?.graph.nodeStates.collect_papers.status).toBe("completed");
  });

  it("still supports explicit manual approval mode", async () => {
    const { store, orchestrator } = await setup(new DeterministicRegistry({}), {
      approvalMode: "manual"
    });

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
    expect(approved.graph.nodeStates.collect_papers.status).toBe("completed");
    expect(approved.graph.nodeStates.analyze_papers.status).toBe("needs_approval");
    expect(approved.graph.nodeStates.analyze_papers.note).toBe("analyze_papers ok");
  });

  it("continues into generate_hypotheses after approving analyze_papers in manual mode", async () => {
    const { store, orchestrator } = await setup(new DeterministicRegistry({}), {
      approvalMode: "manual"
    });

    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "analyze_papers";
    run.graph.currentNode = "analyze_papers";
    run.status = "paused";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "needs_approval";
    run.graph.nodeStates.analyze_papers.note = "analysis ready for approval";
    await store.updateRun(run);

    const approved = await orchestrator.approveCurrent(run.id);

    expect(approved.graph.nodeStates.analyze_papers.status).toBe("completed");
    expect(approved.currentNode).toBe("generate_hypotheses");
    expect(approved.graph.nodeStates.generate_hypotheses.status).toBe("needs_approval");
    expect(approved.graph.nodeStates.generate_hypotheses.note).toBe("generate_hypotheses ok");
  });

  it("preserves partial analyze provenance when a suggested manual run advances to generate_hypotheses", async () => {
    const { store, orchestrator } = await setup(new DeterministicRegistry({}), {
      approvalMode: "manual"
    });

    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "analyze_papers";
    run.graph.currentNode = "analyze_papers";
    run.status = "paused";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "needs_approval";
    run.graph.nodeStates.analyze_papers.note = "Preserved partial analysis (1 summaries, 4 evidence item(s)) after 4 paper(s) failed.";
    run.graph.pendingTransition = {
      action: "pause_for_human",
      sourceNode: "analyze_papers",
      targetNode: "generate_hypotheses",
      reason: "analyze_papers preserved a usable evidence set and is waiting for operator confirmation before synthesis.",
      confidence: 0.92,
      autoExecutable: false,
      evidence: ["1 summary row and 4 evidence rows are already persisted."],
      suggestedCommands: [`/agent run generate_hypotheses ${run.id}`],
      generatedAt: new Date().toISOString()
    };
    await store.updateRun(run);

    const result = await orchestrator.runAgentWithOptions(run.id, "generate_hypotheses");

    expect(result.result.status).toBe("success");

    const latest = await store.getRun(run.id);
    expect(latest?.currentNode).toBe("generate_hypotheses");
    expect(latest?.graph.nodeStates.analyze_papers.status).toBe("completed");
    expect(latest?.graph.nodeStates.analyze_papers.note).toBe(
      "Preserved partial analysis (1 summaries, 4 evidence item(s)) after 4 paper(s) failed."
    );
    expect(latest?.graph.nodeStates.generate_hypotheses.status).toBe("needs_approval");
    expect(latest?.latestSummary).not.toContain("Skipped by jump");
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
    expect(latest?.currentNode).toBe("analyze_results");
    expect(latest?.graph.nodeStates.implement_experiments.status).toBe("completed");
    expect(latest?.graph.nodeStates.run_experiments.status).toBe("completed");
  });

  it("applies a review backtrack when the review approval is accepted", async () => {
    const { store, orchestrator } = await setup(new DeterministicRegistry({}));

    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "review";
    run.graph.currentNode = "review";
    run.status = "paused";
    run.graph.nodeStates.review.status = "needs_approval";
    run.graph.pendingTransition = {
      action: "backtrack_to_design",
      sourceNode: "review",
      targetNode: "design_experiments",
      reason: "Methodological blockers remain after review.",
      confidence: 0.84,
      autoExecutable: true,
      evidence: ["The specialist review found unresolved methodological blockers."],
      suggestedCommands: ["/approve", "/agent jump design_experiments --force"],
      generatedAt: new Date().toISOString()
    };
    await store.updateRun(run);

    const updated = await orchestrator.approveCurrent(run.id);
    expect(updated.currentNode).toBe("design_experiments");
    expect(updated.graph.transitionHistory.at(-1)).toMatchObject({
      action: "backtrack_to_design",
      fromNode: "review",
      toNode: "design_experiments"
    });
  });

  it("auto-applies review backtracks under the default minimal approval mode", async () => {
    const registry = new DeterministicRegistry({
      review: {
        id: "review",
        execute: async () => ({
          status: "success",
          summary: "Review found methodological blockers and will backtrack to design.",
          needsApproval: true,
          toolCallsUsed: 1,
          transitionRecommendation: {
            action: "backtrack_to_design",
            sourceNode: "review",
            targetNode: "design_experiments",
            reason: "Methodological blockers remain after review.",
            confidence: 0.84,
            autoExecutable: true,
            evidence: ["The specialist review found unresolved methodological blockers."],
            suggestedCommands: ["/agent jump design_experiments --force"],
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

    run.currentNode = "review";
    run.graph.currentNode = "review";
    await store.updateRun(run);

    const result = await orchestrator.runAgent(run.id, "review");
    expect(result.result.status).toBe("success");

    const latest = await store.getRun(run.id);
    expect(latest?.currentNode).toBe("design_experiments");
    expect(latest?.graph.transitionHistory.at(-1)).toMatchObject({
      action: "backtrack_to_design",
      fromNode: "review",
      toNode: "design_experiments"
    });
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
    expect(latest?.currentNode).toBe("run_experiments");
    expect(latest?.graph.nodeStates.implement_experiments.status).toBe("completed");
    expect(latest?.graph.rollbackCounters.run_experiments).toBe(1);
    expect(latest?.graph.retryCounters.run_experiments ?? 0).toBe(0);
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
    expect(latest?.status).toBe("paused");
    expect(latest?.graph.nodeStates.analyze_papers.status).toBe("pending");
    expect(latest?.graph.rollbackCounters.generate_hypotheses).toBe(1);
    expect(latest?.graph.retryCounters.generate_hypotheses ?? 0).toBe(0);
  });

  it("restores the last successful collect request before pausing a rollback below the requested node", async () => {
    const registry = new DeterministicRegistry({
      analyze_papers: failingNode("analyze_papers", "analysis failed")
    });
    const { store, orchestrator } = await setup(registry);

    const run = await store.createRun({
      title: "Run",
      topic: "resource-aware baselines for tabular classification on small public datasets",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "analyze_papers";
    run.graph.currentNode = "analyze_papers";
    run.status = "running";
    run.graph.nodeStates.collect_papers = {
      status: "completed",
      updatedAt: new Date().toISOString(),
      note: "Recovered collect stored 100 papers."
    };
    run.graph.nodeStates.analyze_papers = {
      status: "pending",
      updatedAt: new Date().toISOString()
    };
    await store.updateRun(run);

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    await memory.put("collect_papers.last_request", {
      query: "classical machine learning baselines for tabular classification",
      limit: 100,
      sort: { field: "relevance", order: "desc" },
      filters: {}
    });
    await memory.put("collect_papers.last_result", {
      query: "classical machine learning baselines for tabular classification",
      stored: 100,
      completed: true
    });

    const outcome = await orchestrator.runCurrentAgentWithOptions(run.id);
    expect(outcome.result.status).toBe("success");

    const latest = await store.getRun(run.id);
    expect(latest?.currentNode).toBe("collect_papers");
    expect(latest?.status).toBe("paused");
    expect(latest?.graph.nodeStates.collect_papers.status).toBe("pending");
    expect(latest?.graph.nodeStates.collect_papers.note).toContain("reusing collect query");
    expect(latest?.graph.nodeStates.collect_papers.note).toContain("Paused before rerunning collect_papers");

    const restoredRequest = await memory.get<{ query?: string; limit?: number }>("collect_papers.request");
    expect(restoredRequest).toMatchObject({
      query: "classical machine learning baselines for tabular classification",
      limit: 100
    });
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

  it("writes a new latest checkpoint when explicitly resuming an older checkpoint", async () => {
    const { store, orchestrator } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    await orchestrator.runAgent(run.id, "collect_papers");
    const pointsBefore = await orchestrator.listCheckpoints(run.id);
    const target = pointsBefore[0];
    expect(target).toBeDefined();

    const resumed = await orchestrator.resumeRun(run.id, target);
    expect(resumed.currentNode).toBe("collect_papers");

    const pointsAfter = await orchestrator.listCheckpoints(run.id);
    expect(pointsAfter.at(-1)).toBeGreaterThan(pointsBefore.at(-1) ?? 0);
  });

  it("keeps the newer run state when /resume would otherwise restore a stale latest checkpoint", async () => {
    const { store, orchestrator } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    await orchestrator.runAgent(run.id, "collect_papers");

    const updated = await store.getRun(run.id);
    expect(updated).toBeTruthy();
    if (!updated) {
      throw new Error("Run missing after collect_papers execution");
    }

    updated.currentNode = "generate_hypotheses";
    updated.graph.currentNode = "generate_hypotheses";
    updated.status = "paused";
    updated.graph.nodeStates.generate_hypotheses = {
      ...updated.graph.nodeStates.generate_hypotheses,
      status: "pending",
      updatedAt: new Date().toISOString(),
      note: "Recovered manually after the last checkpoint."
    };
    await store.updateRun(updated);

    const resumed = await orchestrator.resumeRun(run.id);
    expect(resumed.currentNode).toBe("generate_hypotheses");
    expect(resumed.graph.currentNode).toBe("generate_hypotheses");
    expect(resumed.graph.nodeStates.generate_hypotheses.note).toContain("Recovered manually");
  });

  it("continues into analyze_papers after collect recovery when later nodes were already visited", async () => {
    let analyzeCalls = 0;
    const registry = new DeterministicRegistry({
      collect_papers: {
        id: "collect_papers",
        execute: async () => ({
          status: "success",
          summary: "Recovered collect completed.",
          needsApproval: true,
          toolCallsUsed: 1
        })
      },
      analyze_papers: {
        id: "analyze_papers",
        execute: async () => {
          analyzeCalls += 1;
          return {
            status: "success",
            summary: "Recovered analysis resumed.",
            needsApproval: true,
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

    run.currentNode = "analyze_papers";
    run.graph.currentNode = "analyze_papers";
    run.status = "paused";
    run.graph.nodeStates.collect_papers = {
      status: "completed",
      updatedAt: new Date().toISOString(),
      note: "Collected before recovery."
    };
    run.graph.nodeStates.analyze_papers = {
      status: "failed",
      updatedAt: new Date().toISOString(),
      note: "Need broader collection."
    };
    await store.updateRun(run);

    const result = await orchestrator.runAgentWithOptions(run.id, "collect_papers");
    expect(result.result.status).toBe("success");
    expect(analyzeCalls).toBe(1);

    const latest = await store.getRun(run.id);
    expect(latest?.currentNode).toBe("generate_hypotheses");
    expect(latest?.graph.nodeStates.collect_papers.status).toBe("completed");
    expect(latest?.graph.nodeStates.analyze_papers.status).toBe("completed");
  });

  it("recovers a stale running node via retryCurrent (LV-029)", async () => {
    const { store, orchestrator } = await setup(new DeterministicRegistry({}));

    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    // Execute collect_papers to create checkpoints and advance state
    await orchestrator.runAgent(run.id, "collect_papers");

    // Simulate stale state: TUI was killed while node was running
    const stale = await store.getRun(run.id);
    expect(stale).toBeTruthy();
    if (!stale) throw new Error("Run missing");

    stale.currentNode = "analyze_papers";
    stale.graph.currentNode = "analyze_papers";
    stale.graph.nodeStates.analyze_papers = {
      ...stale.graph.nodeStates.analyze_papers,
      status: "running",
      updatedAt: new Date().toISOString(),
      note: "in progress before kill"
    };
    stale.status = "running";
    await store.updateRun(stale);

    // Recovery: this is what recoverStaleRunningNode calls
    const recovered = await orchestrator.retryCurrent(run.id, "analyze_papers");

    expect(recovered.graph.nodeStates.analyze_papers.status).toBe("running");
    expect(recovered.graph.nodeStates.analyze_papers.note).toBe("manual retry");
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
