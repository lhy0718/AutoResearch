import { mkdtempSync, rmSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { RunStore } from "../src/core/runs/runStore.js";
import { CheckpointStore } from "../src/core/stateGraph/checkpointStore.js";
import { StateGraphRuntime } from "../src/core/stateGraph/runtime.js";
import { GraphNodeHandler, GraphNodeRegistry } from "../src/core/stateGraph/types.js";
import { FailureMemory, buildErrorFingerprint } from "../src/core/experiments/failureMemory.js";
import { GRAPH_NODE_ORDER, GraphNodeId, RunRecord } from "../src/types.js";
import { readJsonFile } from "../src/utils/fs.js";

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
