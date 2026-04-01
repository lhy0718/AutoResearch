import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { buildRunQueueSnapshot } from "../src/core/runs/jobQueue.js";
import type { RunRecord } from "../src/types.js";

function makeRun(id: string, overrides: Partial<RunRecord> = {}): RunRecord {
  const now = new Date().toISOString();
  const graph = overrides.graph ?? createDefaultGraphState();
  const currentNode = overrides.currentNode ?? graph.currentNode;
  return {
    version: 3,
    workflowVersion: 3,
    id,
    title: overrides.title ?? `Run ${id}`,
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
      runContextPath: `.autolabos/runs/${id}/memory/run_context.json`,
      longTermPath: `.autolabos/runs/${id}/memory/long_term.jsonl`,
      episodePath: `.autolabos/runs/${id}/memory/episodes.jsonl`
    }
  };
}

let workspaceRoot = "";

afterEach(async () => {
  if (workspaceRoot) {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    workspaceRoot = "";
  }
});

describe("jobQueue", () => {
  it("classifies running, waiting, and stalled jobs from run/checkpoint state", async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-job-queue-"));
    const now = new Date("2026-04-01T12:00:00.000Z");

    const stalledRun = makeRun("run-stalled", {
      currentNode: "run_experiments",
      status: "running",
      updatedAt: "2026-04-01T11:20:00.000Z"
    });
    stalledRun.graph.currentNode = "run_experiments";
    stalledRun.graph.nodeStates.run_experiments.status = "running";
    stalledRun.graph.nodeStates.run_experiments.updatedAt = "2026-04-01T11:20:00.000Z";
    stalledRun.graph.retryCounters.run_experiments = 1;

    const runningRun = makeRun("run-running", {
      currentNode: "analyze_results",
      status: "running",
      updatedAt: "2026-04-01T11:55:00.000Z"
    });
    runningRun.graph.currentNode = "analyze_results";
    runningRun.graph.nodeStates.analyze_results.status = "running";
    runningRun.graph.nodeStates.analyze_results.updatedAt = "2026-04-01T11:55:00.000Z";

    const waitingRun = makeRun("run-waiting", {
      currentNode: "review",
      status: "paused",
      updatedAt: "2026-04-01T11:50:00.000Z"
    });
    waitingRun.graph.currentNode = "review";
    waitingRun.graph.nodeStates.review.status = "needs_approval";
    waitingRun.graph.nodeStates.review.updatedAt = "2026-04-01T11:50:00.000Z";

    await writeLatestCheckpoint(workspaceRoot, stalledRun.id, "2026-04-01T11:45:00.000Z");
    await writeLatestCheckpoint(workspaceRoot, runningRun.id, "2026-04-01T11:58:00.000Z");

    const snapshot = await buildRunQueueSnapshot({
      workspaceRoot,
      runs: [stalledRun, runningRun, waitingRun],
      now
    });

    expect(snapshot.running).toHaveLength(1);
    expect(snapshot.running[0]).toMatchObject({
      run_id: "run-running",
      node: "analyze_results",
      status: "running"
    });

    expect(snapshot.waiting).toHaveLength(1);
    expect(snapshot.waiting[0]).toMatchObject({
      run_id: "run-waiting",
      node: "review",
      status: "needs_approval"
    });

    expect(snapshot.stalled).toHaveLength(1);
    expect(snapshot.stalled[0]).toMatchObject({
      run_id: "run-stalled",
      node: "run_experiments",
      status: "running",
      recommended_action: "retry",
      recommendation_line: "Recommended action: retry."
    });
  });

  it("recommends manual review once attempts reach the retry ceiling", async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-job-queue-limit-"));
    const now = new Date("2026-04-01T12:00:00.000Z");

    const run = makeRun("run-manual", {
      currentNode: "implement_experiments",
      status: "running",
      updatedAt: "2026-04-01T11:10:00.000Z"
    });
    run.graph.currentNode = "implement_experiments";
    run.graph.nodeStates.implement_experiments.status = "running";
    run.graph.nodeStates.implement_experiments.updatedAt = "2026-04-01T11:10:00.000Z";
    run.graph.retryPolicy.maxAttemptsPerNode = 2;
    run.graph.retryCounters.implement_experiments = 2;

    await writeLatestCheckpoint(workspaceRoot, run.id, "2026-04-01T11:20:00.000Z");

    const snapshot = await buildRunQueueSnapshot({
      workspaceRoot,
      runs: [run],
      now
    });

    expect(snapshot.stalled).toHaveLength(1);
    expect(snapshot.stalled[0]?.recommended_action).toBe("manual review");
    expect(snapshot.stalled[0]?.recommendation_line).toBe("Recommended action: manual review.");
  });
});

async function writeLatestCheckpoint(workspaceRoot: string, runId: string, createdAt: string): Promise<void> {
  const checkpointsDir = path.join(workspaceRoot, ".autolabos", "runs", runId, "checkpoints");
  await fs.mkdir(checkpointsDir, { recursive: true });
  await fs.writeFile(
    path.join(checkpointsDir, "latest.json"),
    JSON.stringify(
      {
        seq: 1,
        node: "run_experiments",
        phase: "after",
        createdAt,
        file: "0001-run_experiments-after.json"
      },
      null,
      2
    ),
    "utf8"
  );
}
