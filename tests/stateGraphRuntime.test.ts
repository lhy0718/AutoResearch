import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { RunStore } from "../src/core/runs/runStore.js";
import { CheckpointStore } from "../src/core/stateGraph/checkpointStore.js";
import { StateGraphRuntime } from "../src/core/stateGraph/runtime.js";
import { GraphNodeHandler, GraphNodeRegistry } from "../src/core/stateGraph/types.js";
import { GRAPH_NODE_ORDER, GraphNodeId, RunRecord } from "../src/types.js";
import { readJsonFile } from "../src/utils/fs.js";

const tempDirs: string[] = [];

afterEach(() => {
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
});
