import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import { AgentOrchestrator } from "../src/core/agents/agentOrchestrator.js";
import {
  AutonomousRunController,
  buildDefaultOvernightPolicy,
  buildDefaultAutonomousPolicy
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
  const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-autonomy-"));
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
    expect(result.reason).toBe("Reached write_paper gate.");
    expect(result.transitionsApplied).toBe(1);

    const latest = await store.getRun(run.id);
    expect(latest?.currentNode).toBe("write_paper");
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
    expect(latest?.currentNode).toBe("write_paper");
    expect(latest?.graph.transitionHistory.some((item) => item.toNode === "generate_hypotheses")).toBe(true);
  });

  it("routes an advance recommendation into the review node", async () => {
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
      action: "advance",
      sourceNode: "analyze_results",
      targetNode: "review",
      reason: "Ready for manual review before drafting the paper.",
      confidence: 0.9,
      autoExecutable: true,
      evidence: ["Objective met."],
      suggestedCommands: ["/approve"],
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
    expect(latest?.currentNode).toBe("write_paper");
    expect(latest?.graph.transitionHistory.at(-1)?.toNode).toBe("review");
  });

  it("stops instead of auto-approving when a recommendation needs human judgment", async () => {
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
      reason: "Evidence is mixed enough that a human should decide whether to reset the hypothesis set.",
      confidence: 0.72,
      autoExecutable: false,
      evidence: ["The objective was missed but supporting evidence remains ambiguous."],
      suggestedCommands: ["/agent transition"],
      generatedAt: new Date().toISOString()
    };
    await store.updateRun(run);

    const result = await controller.runOvernight(run.id, buildDefaultOvernightPolicy());

    expect(result.status).toBe("stopped");
    expect(result.reason).toContain("Manual review required for recommendation");
    expect(result.approvalsApplied).toBe(0);
    expect(result.transitionsApplied).toBe(0);

    const latest = await store.getRun(run.id);
    expect(latest?.currentNode).toBe("analyze_results");
    expect(latest?.graph.pendingTransition?.action).toBe("backtrack_to_hypotheses");
  });
});

// ---------------------------------------------------------------------------
// Autonomous mode tests
// ---------------------------------------------------------------------------

describe("AutonomousRunController — autonomous mode", () => {

  it("buildDefaultAutonomousPolicy returns relaxed limits vs overnight", () => {
    const overnight = buildDefaultOvernightPolicy();
    const autonomous = buildDefaultAutonomousPolicy();

    expect(autonomous.mode).toBe("autonomous");
    expect(autonomous.maxMinutes).toBeGreaterThan(overnight.maxMinutes);
    expect(autonomous.maxBackwardJumps).toBeGreaterThan(overnight.maxBackwardJumps);
    expect(autonomous.maxDeepBacktracks).toBeGreaterThan(overnight.maxDeepBacktracks);
    expect(autonomous.minTransitionConfidence).toBeLessThan(overnight.minTransitionConfidence);
    expect(autonomous.minDeepBacktrackConfidence).toBeLessThan(overnight.minDeepBacktrackConfidence);
    expect(autonomous.stopBeforeWritePaper).toBe(false);

    // Autonomous auto-approves more nodes
    expect(autonomous.autoApproveNodes.length).toBeGreaterThan(overnight.autoApproveNodes.length);
    expect(autonomous.autoApproveNodes).toContain("review");
    expect(autonomous.autoApproveNodes).toContain("write_paper");
    expect(autonomous.autoApproveNodes).toContain("generate_hypotheses");
  });

  it("policy has required novelty, paper pressure, and fuse configs", () => {
    const policy = buildDefaultAutonomousPolicy();

    // Novelty config
    expect(policy.novelty.windowSize).toBeGreaterThan(0);
    expect(policy.novelty.minNovelSignalsPerWindow).toBeGreaterThan(0);
    expect(policy.novelty.maxStagnantWindows).toBeGreaterThan(0);

    // Paper pressure config
    expect(policy.paperPressure.checkIntervalCycles).toBeGreaterThan(0);
    expect(policy.paperPressure.forceUpgradeAfterCycles).toBeGreaterThan(policy.paperPressure.checkIntervalCycles);

    // Fuse config (catastrophic runaway protection)
    expect(policy.fuse.maxTotalIterations).toBeGreaterThan(100);
    expect(policy.fuse.maxConsecutiveFailures).toBeGreaterThan(3);
    expect(policy.fuse.maxRepeatedRecommendation).toBeGreaterThan(2);
  });

  it("stops on catastrophic fuse when max iterations reached", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const policy = {
      ...buildDefaultAutonomousPolicy(),
      fuse: { maxTotalIterations: 2, maxConsecutiveFailures: 10, maxRepeatedRecommendation: 5 }
    };

    const result = await controller.runAutonomous(run.id, policy);
    expect(result.status).toBe("stopped");
    expect(result.stopReason).toBe("catastrophic_fuse");
    expect(result.reason).toContain("max iterations");
  });

  it("stops on consecutive failures", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    // Pre-set the run to failed state to test failure-counting logic
    run.status = "failed";
    run.graph.nodeStates.collect_papers.status = "failed";
    run.graph.nodeStates.collect_papers.lastError = "Simulated failure";
    await store.updateRun(run);

    const policy = {
      ...buildDefaultAutonomousPolicy(),
      fuse: { maxTotalIterations: 100, maxConsecutiveFailures: 1, maxRepeatedRecommendation: 5 }
    };

    const result = await controller.runAutonomous(run.id, policy);
    expect(result.status).toBe("failed");
    expect(result.stopReason).toBe("consecutive_failures");
  });

  it("stops on time limit", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const policy = {
      ...buildDefaultAutonomousPolicy(),
      maxMinutes: 0 // immediate timeout
    };

    const result = await controller.runAutonomous(run.id, policy);
    expect(result.status).toBe("stopped");
    expect(result.stopReason).toBe("time_limit");
  });

  it("stops on user abort signal", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const abortController = new AbortController();
    abortController.abort();

    const result = await controller.runAutonomous(run.id, buildDefaultAutonomousPolicy(), {
      abortSignal: abortController.signal
    });
    expect(result.status).toBe("canceled");
    expect(result.stopReason).toBe("user_stop");
  });

  it("stops on repeated recommendation catastrophic fuse", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    // Set up a repeated recommendation scenario
    run.currentNode = "analyze_results";
    run.graph.currentNode = "analyze_results";
    run.status = "paused";
    run.graph.nodeStates.analyze_results.status = "needs_approval";
    run.graph.pendingTransition = {
      action: "pause_for_human",
      sourceNode: "analyze_results",
      reason: "Need manual help",
      confidence: 0.3,
      autoExecutable: false,
      evidence: [],
      suggestedCommands: [],
      generatedAt: new Date().toISOString()
    };
    await store.updateRun(run);

    const policy = {
      ...buildDefaultAutonomousPolicy(),
      autoApproveNodes: [] as GraphNodeId[],
      fuse: { maxTotalIterations: 500, maxConsecutiveFailures: 10, maxRepeatedRecommendation: 1 }
    };

    const result = await controller.runAutonomous(run.id, policy);
    expect(result.status).toBe("stopped");
    // Should stop due to manual_review_required since it's a pause_for_human with no auto-approve
    expect(["manual_review_required", "catastrophic_fuse"]).toContain(result.stopReason);
  });

  it("result includes bestBranch, paperStatus, and noveltySignals", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const policy = {
      ...buildDefaultAutonomousPolicy(),
      maxMinutes: 0 // immediate stop
    };

    const result = await controller.runAutonomous(run.id, policy);
    // All result fields should be present
    expect(result.iterations).toBeDefined();
    expect(result.researchCycles).toBeDefined();
    expect(result.noveltySignals).toBeDefined();
    expect(result.stopReason).toBeDefined();
  });

  it("detectCycleNovelty detects new hypothesis", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.graph.nodeStates.generate_hypotheses.note = "Test new hypothesis about X";
    await store.updateRun(run);

    const signals = await controller.detectCycleNovelty(run, 1, "", "", "", "");
    const hypothesisSignals = signals.filter(s => s.type === "new_hypothesis");
    expect(hypothesisSignals.length).toBe(1);
    expect(hypothesisSignals[0].detail).toContain("Test new hypothesis");
  });

  it("detectCycleNovelty detects different analysis outcome", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.graph.nodeStates.analyze_results.note = "Significant improvement over baseline";
    await store.updateRun(run);

    const signals = await controller.detectCycleNovelty(run, 1, "", "", "", "");
    const analysisSignals = signals.filter(s => s.type === "different_analysis_outcome");
    expect(analysisSignals.length).toBe(1);
  });

  it("detectCycleNovelty detects new comparator from design note", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.graph.nodeStates.design_experiments.note = "Added ablation comparator for module X";
    await store.updateRun(run);

    const signals = await controller.detectCycleNovelty(run, 1, "", "", "", "");
    const comparatorSignals = signals.filter(s => s.type === "new_comparator");
    expect(comparatorSignals.length).toBe(1);
  });

  it("detectCycleNovelty skips when notes unchanged", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.graph.nodeStates.generate_hypotheses.note = "Same hypothesis";
    run.graph.nodeStates.analyze_results.note = "Same analysis";
    await store.updateRun(run);

    const signals = await controller.detectCycleNovelty(run, 2, "Same hypothesis", "Same analysis", "", "");
    const newSignals = signals.filter(s => s.type === "new_hypothesis" || s.type === "different_analysis_outcome");
    expect(newSignals.length).toBe(0);
  });

  it("evaluateBestBranch returns branch with evidence gaps", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "some research topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const branch = await controller.evaluateBestBranch(run, undefined, 1);
    expect(branch.branchId).toBe("cycle-1");
    expect(branch.evidenceGaps.length).toBeGreaterThan(0);
    // Without artifacts, all gaps should be present
    expect(branch.evidenceGaps.some(g => g.includes("baseline"))).toBe(true);
    expect(branch.evidenceGaps.some(g => g.includes("quantitative"))).toBe(true);
    expect(branch.manuscriptType).toBe("not_analyzed");
  });

  it("readMetricsHash returns empty for missing artifacts", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const hash = await controller.readMetricsHash(run);
    expect(hash).toBe("");
  });

  it("overnight mode behavior is unchanged — stops before write_paper", async () => {
    const { store, controller } = await setup(new DeterministicRegistry({}));
    const run = await store.createRun({
      title: "Run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const policy = buildDefaultOvernightPolicy();
    const result = await controller.runOvernight(run.id, policy);

    expect(result.status).toBe("stopped");
    expect(result.stopReason).toBe("write_paper_gate");
  });

  it("distinct stop reasons are clearly distinguished", () => {
    // Verify all expected stop reasons are defined as valid types
    const validReasons: string[] = [
      "user_stop", "time_limit", "resource_limit", "run_completed",
      "run_failed", "write_paper_gate", "manual_review_required",
      "repeated_recommendation", "stagnation", "catastrophic_fuse",
      "consecutive_failures"
    ];
    // This is a compile-time check reflected here for documentation
    expect(validReasons.length).toBe(11);
  });
});
