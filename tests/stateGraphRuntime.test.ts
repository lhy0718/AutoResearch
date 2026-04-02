import { mkdtempSync, rmSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { RunStore } from "../src/core/runs/runStore.js";
import { CheckpointStore } from "../src/core/stateGraph/checkpointStore.js";
import { StateGraphRuntime } from "../src/core/stateGraph/runtime.js";
import { GraphNodeHandler, GraphNodeRegistry } from "../src/core/stateGraph/types.js";
import { FailureMemory, buildErrorFingerprint } from "../src/core/experiments/failureMemory.js";
import { GRAPH_NODE_ORDER, GraphNodeId, RunRecord } from "../src/types.js";
import { readJsonFile } from "../src/utils/fs.js";
import { GovernancePolicy } from "../src/governance/policyTypes.js";

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

class Registry implements GraphNodeRegistry {
  constructor(private readonly handlers: Partial<Record<GraphNodeId, GraphNodeHandler>>) {}

  get(nodeId: GraphNodeId): GraphNodeHandler {
    const handler = this.handlers[nodeId];
    if (handler) {
      return handler;
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

async function setup(registry: GraphNodeRegistry) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runtime-"));
  tempDirs.push(cwd);
  process.chdir(cwd);

  const paths = resolveAppPaths(cwd);
  await ensureScaffold(paths);

  const store = new RunStore(paths);
  const checkpointStore = new CheckpointStore(paths);
  const runtime = new StateGraphRuntime(store, registry, checkpointStore, new InMemoryEventStream());
  return { paths, store, checkpointStore, runtime };
}

async function setupWithOptions(
  registry: GraphNodeRegistry,
  options?: {
    approvalMode?: "manual" | "minimal" | "hybrid";
    budgetGuardUsd?: number;
    governancePolicy?: GovernancePolicy;
    evaluateGovernanceAction?: any;
  }
) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runtime-"));
  tempDirs.push(cwd);
  process.chdir(cwd);

  const paths = resolveAppPaths(cwd);
  await ensureScaffold(paths);

  const store = new RunStore(paths);
  const checkpointStore = new CheckpointStore(paths);
  const runtime = new StateGraphRuntime(store, registry, checkpointStore, new InMemoryEventStream(), options);
  return { paths, store, checkpointStore, runtime };
}

describe("StateGraphRuntime", () => {
  it("keeps runs.json aligned with before/after checkpoints across a node transition", async () => {
    const registry = new Registry({
      collect_papers: {
        id: "collect_papers",
        execute: async () => ({
          status: "success",
          summary: "collect complete",
          needsApproval: false,
          toolCallsUsed: 1
        })
      }
    });
    const { paths, store, checkpointStore, runtime } = await setup(registry);

    const run = await store.createRun({
      title: "Runtime",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const updated = await runtime.step(run.id);
    expect(updated.currentNode).toBe("analyze_papers");

    const checkpoints = await checkpointStore.list(run.id);
    expect(checkpoints.map((item) => item.seq)).toEqual([1, 2]);
    expect(checkpoints.map((item) => `${item.node}:${item.phase}`)).toEqual([
      "collect_papers:before",
      "collect_papers:after"
    ]);

    const runsFile = await readJsonFile<{
      runs: Array<{
        id: string;
        currentNode: string;
        graph: { checkpointSeq: number; currentNode: string };
      }>;
    }>(paths.runsFile);
    const persisted = runsFile.runs.find((item) => item.id === run.id);
    expect(persisted?.currentNode).toBe("analyze_papers");
    expect(persisted?.graph.currentNode).toBe("analyze_papers");
    expect(persisted?.graph.checkpointSeq).toBe(2);
  });

  it("pauses for governance review before executing a node when policy requires it", async () => {
    const execute = vi.fn().mockResolvedValue({
      status: "success",
      summary: "should not execute",
      needsApproval: false,
      toolCallsUsed: 1
    });
    const policy: GovernancePolicy = {
      version: "1.0",
      trustedSources: [],
      allowedWritePaths: [".autolabos/runs/**"],
      reviewRequiredPaths: ["src/**"],
      forbiddenExternalActions: ["git push"],
      claimCeilingRef: "src/core/analysis/paperMinimumGate.ts",
      slots: [
        {
          id: "gate-collect",
          description: "force review",
          matchPattern: ".autolabos/runs/**/corpus.jsonl",
          tier: "local_mutation_high",
          decision: "require_review"
        }
      ]
    };
    const registry = new Registry({
      collect_papers: {
        id: "collect_papers",
        execute
      }
    });
    const { store, runtime } = await setupWithOptions(registry, { governancePolicy: policy });
    const run = await store.createRun({
      title: "Governance review",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const updated = await runtime.step(run.id);

    expect(execute).not.toHaveBeenCalled();
    expect(updated.status).toBe("paused");
    expect(updated.graph.nodeStates.collect_papers.status).toBe("needs_approval");
    expect(updated.graph.pendingTransition?.reason).toContain("governance:");
  });

  it("hard stops before node execution when governance blocks the action", async () => {
    const execute = vi.fn().mockResolvedValue({
      status: "success",
      summary: "should not execute",
      needsApproval: false,
      toolCallsUsed: 1
    });
    const policy: GovernancePolicy = {
      version: "1.0",
      trustedSources: [],
      allowedWritePaths: [".autolabos/runs/**"],
      reviewRequiredPaths: ["src/**"],
      forbiddenExternalActions: ["git push"],
      claimCeilingRef: "src/core/analysis/paperMinimumGate.ts",
      slots: [
        {
          id: "stop-collect",
          description: "force stop",
          matchPattern: ".autolabos/runs/**/corpus.jsonl",
          tier: "external_side_effect",
          decision: "hard_stop"
        }
      ]
    };
    const registry = new Registry({
      collect_papers: {
        id: "collect_papers",
        execute
      }
    });
    const { store, runtime } = await setupWithOptions(registry, { governancePolicy: policy });
    const run = await store.createRun({
      title: "Governance hard stop",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const updated = await runtime.step(run.id);

    expect(execute).not.toHaveBeenCalled();
    expect(updated.status).toBe("failed");
    expect(updated.graph.nodeStates.collect_papers.status).toBe("failed");
    expect(updated.graph.nodeStates.collect_papers.lastError).toContain("Governance hard_stop");
  });

  it("continues normally when governance allows execution and still writes checkpoints", async () => {
    const execute = vi.fn().mockResolvedValue({
      status: "success",
      summary: "collect complete",
      needsApproval: false,
      toolCallsUsed: 1
    });
    const registry = new Registry({
      collect_papers: {
        id: "collect_papers",
        execute
      }
    });
    const { store, runtime, checkpointStore } = await setupWithOptions(registry, {
      evaluateGovernanceAction: () => ({
        tier: "read_only",
        decision: "allow",
        matchedSlotId: null,
        detail: "Governance allow for benchmark."
      })
    });
    const run = await store.createRun({
      title: "Governance allow",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const updated = await runtime.step(run.id);

    expect(execute).toHaveBeenCalled();
    expect(updated.currentNode).toBe("analyze_papers");
    const checkpoints = await checkpointStore.list(run.id);
    expect(checkpoints.map((item) => `${item.node}:${item.phase}`)).toEqual([
      "collect_papers:before",
      "collect_papers:after"
    ]);
  });

  it("accumulates successful node usage into the run record and persists it", async () => {
    const registry = new Registry({
      collect_papers: {
        id: "collect_papers",
        execute: async () => ({
          status: "success",
          summary: "collect complete",
          needsApproval: false,
          toolCallsUsed: 3,
          costUsd: 1.25,
          usage: {
            inputTokens: 120,
            outputTokens: 45
          }
        })
      }
    });
    const { store, runtime } = await setup(registry);

    const run = await store.createRun({
      title: "Usage success",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const updated = await runtime.step(run.id);

    expect(updated.usage?.totals.toolCalls).toBe(3);
    expect(updated.usage?.totals.costUsd).toBe(1.25);
    expect(updated.usage?.totals.inputTokens).toBe(120);
    expect(updated.usage?.totals.outputTokens).toBe(45);
    expect(updated.usage?.totals.wallTimeMs ?? -1).toBeGreaterThanOrEqual(0);
    expect(updated.usage?.byNode.collect_papers).toMatchObject({
      toolCalls: 3,
      costUsd: 1.25,
      inputTokens: 120,
      outputTokens: 45,
      executions: 1
    });

    const persisted = await store.getRun(run.id);
    expect(persisted?.usage?.totals.toolCalls).toBe(3);
    expect(persisted?.usage?.byNode.collect_papers?.executions).toBe(1);
  });


  it("keeps the completed node summary when advancing into a pending next node with a stale reset note", async () => {
    const registry = new Registry({
      run_experiments: {
        id: "run_experiments",
        execute: async () => ({
          status: "success",
          summary: "run_experiments completed with pilot_size=10 and objective not met",
          needsApproval: false,
          toolCallsUsed: 1
        })
      }
    });
    const { store, runtime, checkpointStore } = await setup(registry);

    const run = await store.createRun({
      title: "Latest summary alignment",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "run_experiments";
    run.graph.currentNode = "run_experiments";
    run.status = "running";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "completed";
    run.graph.nodeStates.implement_experiments.status = "completed";
    run.graph.nodeStates.analyze_results.status = "pending";
    run.graph.nodeStates.analyze_results.note = "Reset by backward jump (cycle 4)";
    run.graph.nodeStates.analyze_results.updatedAt = "2026-03-20T00:33:33.470Z";
    await store.updateRun(run);

    const updated = await runtime.step(run.id);
    expect(updated.currentNode).toBe("analyze_results");
    expect(updated.graph.nodeStates.run_experiments.status).toBe("completed");
    expect(updated.latestSummary).toBe("run_experiments completed with pilot_size=10 and objective not met");

    const persisted = await store.getRun(run.id);
    expect(persisted?.currentNode).toBe("analyze_results");
    expect(persisted?.latestSummary).toBe("run_experiments completed with pilot_size=10 and objective not met");

    const latestCheckpoint = await checkpointStore.latest(run.id);
    expect(latestCheckpoint?.node).toBe("run_experiments");
    expect(latestCheckpoint?.phase).toBe("after");
  });

  it("keeps rollback note, latestSummary, currentNode, and counters aligned on implement_experiments rollback", async () => {
    const registry = new Registry({
      implement_experiments: {
        id: "implement_experiments",
        execute: async () => ({
          status: "failure",
          error: "verification failed",
          toolCallsUsed: 1
        })
      }
    });
    const { store, checkpointStore, runtime } = await setup(registry);

    const run = await store.createRun({
      title: "Rollback Alignment",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "implement_experiments";
    run.graph.currentNode = "implement_experiments";
    run.status = "running";
    run.graph.retryPolicy.maxAttemptsPerNode = 1;
    run.graph.retryPolicy.maxAutoRollbacksPerNode = 2;
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "completed";
    run.graph.nodeStates.implement_experiments.status = "pending";
    await store.updateRun(run);

    const updated = await runtime.step(run.id);
    const rollbackNote = updated.graph.nodeStates.design_experiments.note;

    expect(updated.currentNode).toBe("design_experiments");
    expect(updated.graph.currentNode).toBe("design_experiments");
    expect(updated.latestSummary).toBe(rollbackNote);
    expect(rollbackNote).toContain("Auto rollback from implement_experiments after 1/1 failed attempts");
    expect(updated.graph.retryCounters.implement_experiments).toBe(0);
    expect(updated.graph.rollbackCounters.implement_experiments).toBe(1);

    const latestCheckpoint = await checkpointStore.latest(run.id);
    expect(latestCheckpoint?.phase).toBe("jump");
    expect(latestCheckpoint?.runSnapshot.currentNode).toBe("design_experiments");
    expect(latestCheckpoint?.runSnapshot.latestSummary).toBe(rollbackNote);
  });

  it("records usage for failed nodes before rolling back", async () => {
    const registry = new Registry({
      implement_experiments: {
        id: "implement_experiments",
        execute: async () => ({
          status: "failure",
          error: "verification failed",
          toolCallsUsed: 2,
          costUsd: 0.4,
          usage: {
            inputTokens: 18,
            outputTokens: 9
          }
        })
      }
    });
    const { store, runtime } = await setup(registry);

    const run = await store.createRun({
      title: "Usage failure",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "implement_experiments";
    run.graph.currentNode = "implement_experiments";
    run.status = "running";
    run.graph.retryPolicy.maxAttemptsPerNode = 1;
    run.graph.retryPolicy.maxAutoRollbacksPerNode = 1;
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "completed";
    await store.updateRun(run);

    const updated = await runtime.step(run.id);

    expect(updated.currentNode).toBe("design_experiments");
    expect(updated.usage?.totals.toolCalls).toBe(2);
    expect(updated.usage?.totals.costUsd).toBe(0.4);
    expect(updated.usage?.byNode.implement_experiments).toMatchObject({
      toolCalls: 2,
      costUsd: 0.4,
      inputTokens: 18,
      outputTokens: 9,
      executions: 1
    });
  });

  it("fails analyze_papers in place for Responses API PDF config errors instead of rerunning collect_papers", async () => {
    let collectExecutions = 0;
    let analyzeExecutions = 0;
    const registry = new Registry({
      collect_papers: {
        id: "collect_papers",
        execute: async () => {
          collectExecutions += 1;
          return {
            status: "success",
            summary: "collect complete",
            needsApproval: false,
            toolCallsUsed: 1
          };
        }
      },
      analyze_papers: {
        id: "analyze_papers",
        execute: async () => {
          analyzeExecutions += 1;
          return {
            status: "failure",
            summary: "Responses API PDF analysis is selected, but OPENAI_API_KEY is not configured.",
            error: "OPENAI_API_KEY is required when PDF analysis mode is set to Responses API.",
            toolCallsUsed: 0
          };
        }
      }
    });
    const { store, runtime } = await setup(registry);

    const run = await store.createRun({
      title: "Collect rollback guard",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.graph.retryPolicy.maxAttemptsPerNode = 3;
    run.graph.retryPolicy.maxAutoRollbacksPerNode = 2;
    await store.updateRun(run);

    const updated = await runtime.runUntilPause(run.id);

    expect(collectExecutions).toBe(1);
    expect(analyzeExecutions).toBe(1);
    expect(updated.status).toBe("failed");
    expect(updated.currentNode).toBe("analyze_papers");
    expect(updated.graph.nodeStates.collect_papers.status).toBe("completed");
    expect(updated.graph.nodeStates.analyze_papers.status).toBe("failed");
    expect(updated.graph.nodeStates.analyze_papers.lastError).toBe(
      "OPENAI_API_KEY is required when PDF analysis mode is set to Responses API."
    );
    expect(updated.graph.retryCounters.analyze_papers).toBe(3);
    expect(updated.graph.rollbackCounters.analyze_papers ?? 0).toBe(0);
    expect(updated.usage?.byNode.collect_papers?.executions).toBe(1);
    expect(updated.usage?.byNode.analyze_papers?.executions).toBe(1);

    const persisted = await store.getRun(run.id);
    expect(persisted?.status).toBe("failed");
    expect(persisted?.currentNode).toBe("analyze_papers");
    expect(persisted?.usage?.byNode.collect_papers?.executions).toBe(1);
    expect(persisted?.usage?.byNode.analyze_papers?.executions).toBe(1);
  });

  it("pauses before starting another node when cumulative spend already exceeds the configured budget", async () => {
    let executions = 0;
    const registry = new Registry({
      collect_papers: {
        id: "collect_papers",
        execute: async () => {
          executions += 1;
          return {
            status: "success",
            summary: "collect complete",
            needsApproval: false,
            toolCallsUsed: 1
          };
        }
      }
    });
    const { store, runtime } = await setupWithOptions(registry, {
      budgetGuardUsd: 1
    });

    const run = await store.createRun({
      title: "Budget pause before step",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.usage = {
      totals: {
        costUsd: 1.25,
        toolCalls: 1,
        inputTokens: 10,
        outputTokens: 5,
        wallTimeMs: 100
      },
      byNode: {}
    };
    await store.updateRun(run);

    const updated = await runtime.step(run.id);

    expect(executions).toBe(0);
    expect(updated.status).toBe("paused");
    expect(updated.currentNode).toBe("collect_papers");
    expect(updated.graph.nodeStates.collect_papers.note).toContain("Budget guard paused further execution");
  });

  it("pauses after a successful node when the node pushes cumulative spend above the budget", async () => {
    const registry = new Registry({
      collect_papers: {
        id: "collect_papers",
        execute: async () => ({
          status: "success",
          summary: "collect complete",
          needsApproval: false,
          toolCallsUsed: 2,
          costUsd: 1.25
        })
      }
    });
    const { store, runtime } = await setupWithOptions(registry, {
      budgetGuardUsd: 1
    });

    const run = await store.createRun({
      title: "Budget pause after success",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const updated = await runtime.step(run.id);

    expect(updated.status).toBe("paused");
    expect(updated.currentNode).toBe("analyze_papers");
    expect(updated.graph.nodeStates.collect_papers.status).toBe("completed");
    expect(updated.graph.nodeStates.analyze_papers.status).toBe("pending");
    expect(updated.graph.nodeStates.analyze_papers.note).toContain("Budget guard paused further execution at analyze_papers");
    expect(updated.usage?.totals.costUsd).toBe(1.25);
  });

  it("blocks minimal approval auto-advance when cumulative spend exceeds the budget", async () => {
    const registry = new Registry({
      generate_hypotheses: {
        id: "generate_hypotheses",
        execute: async () => ({
          status: "success",
          summary: "hypotheses ready",
          needsApproval: true,
          toolCallsUsed: 1,
          costUsd: 0.6
        })
      }
    });
    const { store, runtime } = await setupWithOptions(registry, {
      approvalMode: "minimal",
      budgetGuardUsd: 0.5
    });

    const run = await store.createRun({
      title: "Budget blocks auto approval",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.currentNode = "generate_hypotheses";
    run.graph.currentNode = "generate_hypotheses";
    run.status = "running";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    await store.updateRun(run);

    const updated = await runtime.runUntilPause(run.id);

    expect(updated.status).toBe("paused");
    expect(updated.currentNode).toBe("generate_hypotheses");
    expect(updated.graph.nodeStates.generate_hypotheses.status).toBe("needs_approval");
    expect(updated.graph.nodeStates.generate_hypotheses.note).toContain("Budget guard paused further execution");
  });

  it("pauses instead of auto-retrying when a failed node pushes cumulative spend above the budget", async () => {
    const registry = new Registry({
      implement_experiments: {
        id: "implement_experiments",
        execute: async () => ({
          status: "failure",
          error: "verification failed",
          toolCallsUsed: 2,
          costUsd: 0.4
        })
      }
    });
    const { store, runtime } = await setupWithOptions(registry, {
      budgetGuardUsd: 0.2
    });

    const run = await store.createRun({
      title: "Budget blocks auto retry",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.currentNode = "implement_experiments";
    run.graph.currentNode = "implement_experiments";
    run.status = "running";
    run.graph.retryPolicy.maxAttemptsPerNode = 2;
    run.graph.retryPolicy.maxAutoRollbacksPerNode = 1;
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "completed";
    await store.updateRun(run);

    const updated = await runtime.step(run.id);

    expect(updated.status).toBe("paused");
    expect(updated.currentNode).toBe("implement_experiments");
    expect(updated.graph.nodeStates.implement_experiments.status).toBe("pending");
    expect(updated.graph.nodeStates.implement_experiments.note).toContain("Budget guard paused further execution");
    expect(updated.usage?.totals.costUsd).toBe(0.4);
  });

  it("uses the highest on-disk checkpoint seq before saving implement_experiments failure checkpoints", async () => {
    const { store, checkpointStore, runtime } = await setup(new Registry({}));

    const run = await store.createRun({
      title: "Stale Failure",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "implement_experiments";
    run.graph.currentNode = "implement_experiments";
    run.status = "running";
    run.graph.retryPolicy.maxAttemptsPerNode = 1;
    run.graph.retryPolicy.maxAutoRollbacksPerNode = 1;
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "completed";

    const stale = structuredClone(run);

    await checkpointStore.save(run, "before");
    await store.updateRun(run);
    await checkpointStore.save(run, "retry", "auto retry");
    await store.updateRun(run);

    const failureRuntime = runtime as unknown as {
      handleFailure(runRecord: RunRecord, node: GraphNodeId, message: string): Promise<RunRecord>;
    };
    const updated = await failureRuntime.handleFailure(stale, "implement_experiments", "verification failed");

    expect(updated.currentNode).toBe("design_experiments");
    expect(updated.graph.checkpointSeq).toBe(4);
    expect(updated.latestSummary).toContain("Auto rollback from implement_experiments after 1/1 failed attempts");

    const checkpoints = await checkpointStore.list(run.id);
    expect(checkpoints.map((item) => item.seq)).toEqual([1, 2, 3, 4]);

    const latestCheckpoint = await checkpointStore.latest(run.id);
    expect(latestCheckpoint?.seq).toBe(4);
    expect(latestCheckpoint?.runSnapshot.currentNode).toBe("design_experiments");
  });

  it("rolls back generate_hypotheses immediately when low-quality fallback evidence cannot support another identical retry", async () => {
    const registry = new Registry({
      generate_hypotheses: {
        id: "generate_hypotheses",
        execute: async () => ({
          status: "failure",
          error:
            "Hypothesis generation blocked: the selected fallback hypotheses are supported by a single low-confidence, caveated paper. Strengthen analyze_papers before designing experiments.",
          toolCallsUsed: 1
        })
      }
    });
    const { store, runtime } = await setup(registry);

    const run = await store.createRun({
      title: "Hypothesis rollback",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "generate_hypotheses";
    run.graph.currentNode = "generate_hypotheses";
    run.status = "running";
    run.graph.retryPolicy.maxAttemptsPerNode = 3;
    run.graph.retryPolicy.maxAutoRollbacksPerNode = 2;
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    await store.updateRun(run);

    const updated = await runtime.step(run.id);

    expect(updated.currentNode).toBe("analyze_papers");
    expect(updated.status).toBe("running");
    expect(updated.graph.retryCounters.generate_hypotheses).toBe(0);
    expect(updated.graph.rollbackCounters.generate_hypotheses).toBe(1);
    expect(updated.graph.nodeStates.analyze_papers.status).toBe("running");
    expect(updated.graph.nodeStates.analyze_papers.note).toContain(
      "Auto rollback from generate_hypotheses after 3/3 failed attempts"
    );
    expect(updated.latestSummary).toContain(
      "Auto rollback from generate_hypotheses after 3/3 failed attempts"
    );
  });

  it("rolls back implement_experiments immediately when staged LLM execution never produces a runnable artifact", async () => {
    const registry = new Registry({
      implement_experiments: {
        id: "implement_experiments",
        execute: async () => ({
          status: "failure",
          error:
            "Implementation execution failed before any runnable implementation was produced: implement_experiments staged_llm request timed out after 600000ms",
          toolCallsUsed: 1
        })
      }
    });
    const { store, runtime } = await setup(registry);

    const run = await store.createRun({
      title: "Implement timeout rollback",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "implement_experiments";
    run.graph.currentNode = "implement_experiments";
    run.status = "running";
    run.graph.retryPolicy.maxAttemptsPerNode = 3;
    run.graph.retryPolicy.maxAutoRollbacksPerNode = 2;
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "completed";
    await store.updateRun(run);

    const updated = await runtime.step(run.id);

    expect(updated.currentNode).toBe("design_experiments");
    expect(updated.status).toBe("running");
    expect(updated.graph.retryCounters.implement_experiments).toBe(0);
    expect(updated.graph.rollbackCounters.implement_experiments).toBe(1);
    expect(updated.graph.nodeStates.design_experiments.status).toBe("running");
    expect(updated.graph.nodeStates.design_experiments.note).toContain(
      "Auto rollback from implement_experiments after 3/3 failed attempts"
    );
  });


  it("preserves a successful generate_hypotheses result when abort arrives after artifacts are written", async () => {
    const controller = new AbortController();
    let pathsRef!: ReturnType<typeof resolveAppPaths>;
    const registry = new Registry({
      generate_hypotheses: {
        id: "generate_hypotheses",
        execute: async ({ run }) => {
          const runRoot = path.join(pathsRef.runsDir, run.id);
          await fs.mkdir(path.join(runRoot, "hypothesis_generation"), { recursive: true });
          await fs.mkdir(path.join(runRoot, "drafts"), { recursive: true });
          await fs.mkdir(path.join(runRoot, "reviews"), { recursive: true });
          await fs.mkdir(path.join(runRoot, "evidence_axes"), { recursive: true });
          await fs.writeFile(
            path.join(runRoot, "hypotheses.jsonl"),
            `${JSON.stringify({ hypothesis: "Use gradient-boosted trees on tabular baselines." })}\n`,
            "utf8"
          );
          await fs.writeFile(
            path.join(runRoot, "hypothesis_generation", "status.json"),
            `${JSON.stringify({ status: "completed" })}\n`,
            "utf8"
          );
          controller.abort();
          return {
            status: "success",
            summary: "Generated hypotheses from the analyzed evidence.",
            needsApproval: true,
            toolCallsUsed: 1
          };
        }
      }
    });
    const { paths, store, checkpointStore, runtime } = await setup(registry);
    pathsRef = paths;

    const run = await store.createRun({
      title: "Hypotheses Abort Ordering",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "generate_hypotheses";
    run.graph.currentNode = "generate_hypotheses";
    run.status = "running";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    await store.updateRun(run);

    const updated = await runtime.step(run.id, controller.signal);

    expect(updated.currentNode).toBe("generate_hypotheses");
    expect(updated.status).toBe("paused");
    expect(updated.graph.nodeStates.generate_hypotheses.status).toBe("needs_approval");
    expect(updated.graph.nodeStates.generate_hypotheses.note).toBe(
      "Generated hypotheses from the analyzed evidence."
    );
    expect(updated.latestSummary).toBe("Generated hypotheses from the analyzed evidence.");

    const persisted = await store.getRun(run.id);
    expect(persisted?.graph.nodeStates.generate_hypotheses.status).toBe("needs_approval");
    expect(persisted?.graph.nodeStates.generate_hypotheses.note).toBe(
      "Generated hypotheses from the analyzed evidence."
    );

    await expect(fs.readFile(path.join(paths.runsDir, run.id, "hypotheses.jsonl"), "utf8")).resolves.toContain(
      "gradient-boosted trees"
    );
    await expect(
      readJsonFile<{ status?: string }>(path.join(paths.runsDir, run.id, "hypothesis_generation", "status.json"))
    ).resolves.toMatchObject({ status: "completed" });

    const latestCheckpoint = await checkpointStore.latest(run.id);
    expect(latestCheckpoint?.phase).toBe("after");
    expect(latestCheckpoint?.runSnapshot.graph.nodeStates.generate_hypotheses.status).toBe("needs_approval");
  });

  it("pauses at generate_hypotheses approval instead of auto-advancing when abort arrives after node success", async () => {
    const controller = new AbortController();
    const registry = new Registry({
      generate_hypotheses: {
        id: "generate_hypotheses",
        execute: async () => {
          controller.abort();
          return {
            status: "success",
            summary: "Generated hypotheses from the analyzed evidence.",
            needsApproval: true,
            toolCallsUsed: 1
          };
        }
      }
    });
    const { store, runtime } = await setup(registry);

    const run = await store.createRun({
      title: "Abort Before Auto Approval",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "generate_hypotheses";
    run.graph.currentNode = "generate_hypotheses";
    run.status = "running";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    await store.updateRun(run);

    const updated = await runtime.runUntilPause(run.id, { abortSignal: controller.signal });

    expect(updated.currentNode).toBe("generate_hypotheses");
    expect(updated.status).toBe("paused");
    expect(updated.graph.nodeStates.generate_hypotheses.status).toBe("needs_approval");
    expect(updated.graph.nodeStates.design_experiments.status).toBe("pending");

    const persisted = await store.getRun(run.id);
    expect(persisted?.currentNode).toBe("generate_hypotheses");
    expect(persisted?.status).toBe("paused");
    expect(persisted?.graph.nodeStates.generate_hypotheses.status).toBe("needs_approval");
    expect(persisted?.graph.nodeStates.design_experiments.status).toBe("pending");
  });

  it("auto-advances a review approval boundary in hybrid mode when scores are strong", async () => {
    const registry = new Registry({
      review: {
        id: "review",
        execute: async () => ({
          status: "success",
          summary: "review accepted",
          needsApproval: true,
          toolCallsUsed: 1,
          approvalSignal: {
            source: "review",
            overall_score: 8,
            specialist_scores: [4, 4, 5],
            summary: "Strong review confidence"
          },
          transitionRecommendation: {
            action: "advance",
            sourceNode: "review",
            targetNode: "write_paper",
            reason: "ready for drafting",
            confidence: 0.9,
            autoExecutable: true,
            evidence: [],
            suggestedCommands: [],
            generatedAt: new Date().toISOString()
          }
        })
      }
    });
    const { store, runtime } = await setupWithOptions(registry, { approvalMode: "hybrid" });

    const run = await store.createRun({
      title: "Hybrid auto advance",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.currentNode = "review";
    run.graph.currentNode = "review";
    run.status = "running";
    for (const node of ["collect_papers", "analyze_papers", "generate_hypotheses", "design_experiments", "implement_experiments", "run_experiments", "analyze_results"] as const) {
      run.graph.nodeStates[node].status = "completed";
    }
    await store.updateRun(run);

    const updated = await runtime.runUntilPause(run.id, {
      stopAfterApprovalBoundary: true,
      floorNode: "review"
    });

    expect(updated.currentNode).toBe("write_paper");
    expect(updated.status).toBe("running");
    expect(updated.graph.nodeStates.review.status).toBe("completed");
  });

  it("pauses a hybrid review approval boundary when the overall score is below threshold", async () => {
    const registry = new Registry({
      review: {
        id: "review",
        execute: async () => ({
          status: "success",
          summary: "review needs work",
          needsApproval: true,
          toolCallsUsed: 1,
          approvalSignal: {
            source: "review",
            overall_score: 6,
            specialist_scores: [4, 4, 5],
            summary: "Borderline review confidence"
          },
          transitionRecommendation: {
            action: "advance",
            sourceNode: "review",
            targetNode: "write_paper",
            reason: "ready for drafting",
            confidence: 0.9,
            autoExecutable: true,
            evidence: [],
            suggestedCommands: [],
            generatedAt: new Date().toISOString()
          }
        })
      }
    });
    const { store, runtime } = await setupWithOptions(registry, { approvalMode: "hybrid" });

    const run = await store.createRun({
      title: "Hybrid pause low score",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.currentNode = "review";
    run.graph.currentNode = "review";
    run.status = "running";
    for (const node of ["collect_papers", "analyze_papers", "generate_hypotheses", "design_experiments", "implement_experiments", "run_experiments", "analyze_results"] as const) {
      run.graph.nodeStates[node].status = "completed";
    }
    await store.updateRun(run);

    const updated = await runtime.runUntilPause(run.id, {
      stopAfterApprovalBoundary: true,
      floorNode: "review"
    });

    expect(updated.currentNode).toBe("review");
    expect(updated.status).toBe("paused");
    expect(updated.graph.nodeStates.review.status).toBe("needs_approval");
    expect(updated.graph.nodeStates.review.approvalSignal?.overall_score).toBe(6);
  });

  it("pauses a hybrid review approval boundary when any specialist score is below threshold", async () => {
    const registry = new Registry({
      review: {
        id: "review",
        execute: async () => ({
          status: "success",
          summary: "review needs specialist follow-up",
          needsApproval: true,
          toolCallsUsed: 1,
          approvalSignal: {
            source: "review",
            overall_score: 8,
            specialist_scores: [4, 3, 5],
            summary: "One reviewer remains unconvinced"
          },
          transitionRecommendation: {
            action: "advance",
            sourceNode: "review",
            targetNode: "write_paper",
            reason: "ready for drafting",
            confidence: 0.9,
            autoExecutable: true,
            evidence: [],
            suggestedCommands: [],
            generatedAt: new Date().toISOString()
          }
        })
      }
    });
    const { store, runtime } = await setupWithOptions(registry, { approvalMode: "hybrid" });

    const run = await store.createRun({
      title: "Hybrid pause specialist score",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.currentNode = "review";
    run.graph.currentNode = "review";
    run.status = "running";
    for (const node of ["collect_papers", "analyze_papers", "generate_hypotheses", "design_experiments", "implement_experiments", "run_experiments", "analyze_results"] as const) {
      run.graph.nodeStates[node].status = "completed";
    }
    await store.updateRun(run);

    const updated = await runtime.runUntilPause(run.id, {
      stopAfterApprovalBoundary: true,
      floorNode: "review"
    });

    expect(updated.currentNode).toBe("review");
    expect(updated.status).toBe("paused");
    expect(updated.graph.nodeStates.review.status).toBe("needs_approval");
    expect(updated.graph.nodeStates.review.approvalSignal?.specialist_scores).toEqual([4, 3, 5]);
  });

  it("clears stale lastError when a node later succeeds", async () => {
    const registry = new Registry({
      generate_hypotheses: {
        id: "generate_hypotheses",
        execute: async () => ({
          status: "success",
          summary: "Generated hypotheses from the analyzed evidence.",
          needsApproval: true,
          toolCallsUsed: 1
        })
      }
    });
    const { store, runtime } = await setup(registry);

    const run = await store.createRun({
      title: "Clear Success Error",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "generate_hypotheses";
    run.graph.currentNode = "generate_hypotheses";
    run.status = "running";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "running";
    run.graph.nodeStates.generate_hypotheses.lastError = "Unexpected end of JSON input";
    await store.updateRun(run);

    const updated = await runtime.step(run.id);
    expect(updated.graph.nodeStates.generate_hypotheses.lastError).toBeUndefined();

    const persisted = await store.getRun(run.id);
    expect(persisted?.graph.nodeStates.generate_hypotheses.lastError).toBeUndefined();
  });

  it("clears downstream stale lastError values when backward jump resets later nodes", async () => {
    const { store, runtime } = await setup(new Registry({}));

    const run = await store.createRun({
      title: "Clear Jump Errors",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "review";
    run.graph.currentNode = "review";
    run.status = "paused";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "completed";
    run.graph.nodeStates.implement_experiments.status = "completed";
    run.graph.nodeStates.implement_experiments.lastError = "Policy blocked command";
    run.graph.nodeStates.run_experiments.status = "needs_approval";
    run.graph.nodeStates.run_experiments.lastError = "Policy blocked command";
    run.graph.nodeStates.analyze_results.status = "completed";
    run.graph.nodeStates.analyze_results.lastError = "invalid metrics";
    await store.updateRun(run);

    const jumped = await runtime.jumpToNode(run.id, "design_experiments", "force", "manual backtrack");
    expect(jumped.graph.nodeStates.implement_experiments.lastError).toBeUndefined();
    expect(jumped.graph.nodeStates.run_experiments.lastError).toBeUndefined();
    expect(jumped.graph.nodeStates.analyze_results.lastError).toBeUndefined();

    const persisted = await store.getRun(run.id);
    expect(persisted?.graph.nodeStates.implement_experiments.lastError).toBeUndefined();
    expect(persisted?.graph.nodeStates.run_experiments.lastError).toBeUndefined();
    expect(persisted?.graph.nodeStates.analyze_results.lastError).toBeUndefined();
  });

  it("backward jump resets the target node itself to pending (LV-019)", async () => {
    const { store, runtime } = await setup(new Registry({}));

    const run = await store.createRun({
      title: "LV-019 backward jump target reset",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "analyze_results";
    run.graph.currentNode = "analyze_results";
    run.status = "paused";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "skipped";
    run.graph.nodeStates.implement_experiments.status = "completed";
    run.graph.nodeStates.run_experiments.status = "completed";
    run.graph.nodeStates.analyze_results.status = "completed";
    await store.updateRun(run);

    const jumped = await runtime.jumpToNode(run.id, "design_experiments", "force", "objective not met");
    // Target node itself must be reset to pending, not stay as skipped
    expect(jumped.graph.nodeStates.design_experiments.status).toBe("pending");
    expect(jumped.graph.nodeStates.implement_experiments.status).toBe("pending");
    expect(jumped.graph.nodeStates.run_experiments.status).toBe("pending");
    expect(jumped.graph.nodeStates.analyze_results.status).toBe("pending");

    const persisted = await store.getRun(run.id);
    expect(persisted?.graph.nodeStates.design_experiments.status).toBe("pending");
  });

  it("runUntilPause returns immediately when run status is already failed", async () => {
    const registry = new Registry({
      implement_experiments: {
        id: "implement_experiments",
        execute: async () => ({
          status: "success",
          summary: "Implemented.",
          needsApproval: false,
          toolCallsUsed: 1
        })
      }
    });
    const { store, runtime } = await setup(registry);

    const run = await store.createRun({
      title: "Exhausted Retries",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "implement_experiments";
    run.graph.currentNode = "implement_experiments";
    run.status = "failed";
    run.graph.retryCounters.implement_experiments = 3;
    run.graph.rollbackCounters.implement_experiments = 2;
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "completed";
    await store.updateRun(run);

    const updated = await runtime.runUntilPause(run.id);
    expect(updated.status).toBe("failed");

    const persisted = await store.getRun(run.id);
    expect(persisted?.status).toBe("failed");
  });

  it("uses the latest persisted retry state when a stale run_experiments failure arrives", async () => {
    const { store, runtime } = await setup(new Registry({}));

    const run = await store.createRun({
      title: "Stale Run Failure",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "run_experiments";
    run.graph.currentNode = "run_experiments";
    run.status = "running";
    run.graph.retryPolicy.maxAttemptsPerNode = 3;
    run.graph.retryPolicy.maxAutoRollbacksPerNode = 2;
    run.graph.retryCounters.run_experiments = 3;
    run.graph.rollbackCounters.run_experiments = 2;
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "completed";
    run.graph.nodeStates.implement_experiments.status = "completed";
    run.graph.nodeStates.run_experiments.status = "running";
    run.graph.nodeStates.run_experiments.note = "old fatal error";
    await store.updateRun(run);

    const stale = structuredClone(run);
    stale.graph.retryCounters.run_experiments = 0;
    stale.graph.rollbackCounters.run_experiments = 0;

    const failureRuntime = runtime as unknown as {
      handleFailure(runRecord: RunRecord, node: GraphNodeId, message: string): Promise<RunRecord>;
    };
    const updated = await failureRuntime.handleFailure(
      stale,
      "run_experiments",
      "fatal: bounded retry scope did not exceed previous local scope"
    );

    expect(updated.currentNode).toBe("run_experiments");
    expect(updated.status).toBe("failed");
    expect(updated.graph.nodeStates.run_experiments.status).toBe("failed");
    expect(updated.graph.retryCounters.run_experiments).toBe(3);
    expect(updated.graph.rollbackCounters.run_experiments).toBe(2);
  });

  it("does not schedule an auto retry after equivalent failures exhaust retries early", async () => {
    const { store, runtime } = await setup(new Registry({}));

    const run = await store.createRun({
      title: "Equivalent Failure Stop",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "run_experiments";
    run.graph.currentNode = "run_experiments";
    run.status = "running";
    run.graph.retryPolicy.maxAttemptsPerNode = 3;
    run.graph.retryPolicy.maxAutoRollbacksPerNode = 0;
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "completed";
    run.graph.nodeStates.implement_experiments.status = "completed";
    run.graph.nodeStates.run_experiments.status = "running";
    await store.updateRun(run);

    const errorMessage = "Experiment finished without metrics output at /tmp/metrics.json";
    const failureMemory = FailureMemory.forRun(run.id);
    const fingerprint = buildErrorFingerprint(errorMessage);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await failureMemory.append({
        run_id: run.id,
        node_id: "run_experiments",
        attempt,
        failure_class: "equivalent",
        error_fingerprint: fingerprint,
        error_message: errorMessage,
        do_not_retry: true,
        do_not_retry_reason: "Repeated without improvement."
      });
    }

    const failureRuntime = runtime as unknown as {
      handleFailure(runRecord: RunRecord, node: GraphNodeId, message: string): Promise<RunRecord>;
    };
    const updated = await failureRuntime.handleFailure(run, "run_experiments", errorMessage);

    expect(updated.status).toBe("failed");
    expect(updated.graph.retryCounters.run_experiments).toBe(3);
    expect(updated.graph.nodeStates.run_experiments.status).toBe("failed");
    expect(updated.graph.nodeStates.run_experiments.note).toContain("without metrics output");
  });

  it("pauses instead of auto-applying backward jump when maxAutoBackwardJumps is reached (LV-015)", async () => {
    // Node that emits a backward-jump recommendation on analyze_results
    const registry = new Registry({
      analyze_results: {
        id: "analyze_results",
        execute: async () => ({
          status: "success",
          summary: "Analyzed results.",
          needsApproval: true,
          toolCallsUsed: 1,
          transitionRecommendation: {
            action: "backtrack_to_design",
            targetNode: "design_experiments" as GraphNodeId,
            reason: "Objective not met.",
            confidence: 0.7,
            autoExecutable: true
          }
        })
      }
    });

    const { store, runtime } = await setup(registry);
    const run = await store.createRun({
      title: "Backward Jump Limit",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    // Set up: run is at analyze_results, earlier nodes completed
    run.currentNode = "analyze_results";
    run.graph.currentNode = "analyze_results";
    run.status = "running";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "completed";
    run.graph.nodeStates.implement_experiments.status = "completed";
    run.graph.nodeStates.run_experiments.status = "completed";
    run.graph.retryPolicy.maxAutoBackwardJumps = 2;

    // Simulate 2 prior backward jumps in transition history
    run.graph.transitionHistory = [
      { action: "backtrack_to_design", fromNode: "analyze_results", toNode: "design_experiments", reason: "r1", confidence: 0.7, autoExecutable: true, appliedAt: new Date().toISOString() },
      { action: "backtrack_to_design", fromNode: "analyze_results", toNode: "design_experiments", reason: "r2", confidence: 0.7, autoExecutable: true, appliedAt: new Date().toISOString() }
    ];
    await store.updateRun(run);

    // Run should pause because we've hit the backward jump limit
    const updated = await runtime.runUntilPause(run.id);

    // Should be paused with the pending transition, NOT auto-applied
    expect(updated.status).toBe("paused");
    expect(updated.graph.pendingTransition).toBeDefined();
    expect(updated.graph.pendingTransition?.targetNode).toBe("design_experiments");
    // Should NOT have moved backward
    expect(updated.currentNode).toBe("analyze_results");
  });
});
