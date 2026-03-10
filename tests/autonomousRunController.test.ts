import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import { AgentOrchestrator } from "../src/core/agents/agentOrchestrator.js";
import {
  AutonomousRunController,
  buildDefaultOvernightPolicy
} from "../src/core/agents/autonomousRunController.js";
import { InMemoryEventStream } from "../src/core/events.js";
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

async function setup(registry: GraphNodeRegistry): Promise<{
  store: RunStore;
  controller: AutonomousRunController;
}> {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "autoresearch-autonomy-"));
  tempDirs.push(cwd);

  const paths = resolveAppPaths(cwd);
  await ensureScaffold(paths);

  const store = new RunStore(paths);
  const checkpointStore = new CheckpointStore(paths);
  const eventStream = new InMemoryEventStream();
  const runtime = new StateGraphRuntime(store, registry, checkpointStore, eventStream);
  const orchestrator = new AgentOrchestrator(store, runtime, checkpointStore);
  const controller = new AutonomousRunController(store, orchestrator, eventStream);
  return { store, controller };
}

describe("AutonomousRunController", () => {
  it("applies a pending design backtrack before stopping for manual review", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "analyze_results";
    run.graph.currentNode = "analyze_results";
    run.status = "paused";
    run.graph.nodeStates.analyze_results.status = "needs_approval";
    run.graph.pendingTransition = {
      action: "backtrack_to_design",
      sourceNode: "analyze_results",
      targetNode: "design_experiments",
      reason: "Revise the design before rerunning.",
      confidence: 0.84,
      autoExecutable: true,
      evidence: ["Objective not met."],
      suggestedCommands: ["/agent jump design_experiments", "/agent run design_experiments"],
      generatedAt: new Date().toISOString()
    };
    await store.updateRun(run);

    const policy = {
      ...buildDefaultOvernightPolicy(),
      autoApproveNodes: [] as GraphNodeId[]
    };
    const result = await controller.runOvernight(run.id, policy);

    expect(result.status).toBe("stopped");
    expect(result.reason).toContain("design_experiments");
    expect(result.transitionsApplied).toBe(1);

    const latest = await store.getRun(run.id);
    expect(latest?.currentNode).toBe("design_experiments");
    expect(latest?.graph.transitionHistory.at(-1)?.action).toBe("backtrack_to_design");
  });

  it("allows one high-confidence hypothesis backtrack under the default overnight policy", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "analyze_results";
    run.graph.currentNode = "analyze_results";
    run.status = "paused";
    run.graph.nodeStates.analyze_results.status = "needs_approval";
    run.graph.pendingTransition = {
      action: "backtrack_to_hypotheses",
      sourceNode: "analyze_results",
      targetNode: "generate_hypotheses",
      reason: "The shortlisted hypothesis is not supported, so the idea set should be revisited.",
      confidence: 0.93,
      autoExecutable: true,
      evidence: ["Current experiment outcomes do not support the shortlisted hypothesis."],
      suggestedCommands: ["/agent jump generate_hypotheses", "/agent run generate_hypotheses"],
      generatedAt: new Date().toISOString()
    };
    await store.updateRun(run);

    const policy = {
      ...buildDefaultOvernightPolicy(),
      autoApproveNodes: [] as GraphNodeId[]
    };
    const result = await controller.runOvernight(run.id, policy);

    expect(result.status).toBe("stopped");
    expect(result.transitionsApplied).toBe(1);

    const latest = await store.getRun(run.id);
    expect(latest?.currentNode).toBe("generate_hypotheses");
    expect(latest?.graph.transitionHistory.at(-1)?.toNode).toBe("generate_hypotheses");
  });
});
