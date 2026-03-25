import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { CheckpointStore } from "../src/core/stateGraph/checkpointStore.js";
import { RunStore } from "../src/core/runs/runStore.js";
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

describe("RunStore", () => {
  it("creates v3 run with graph defaults", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runstore-"));
    tempDirs.push(cwd);
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);

    const store = new RunStore(paths);
    const run = await store.createRun({
      title: "Test Run Title",
      topic: "ai agent",
      constraints: ["recent"],
      objectiveMetric: "accuracy"
    });

    expect(run.title).toBe("Test Run Title");
    expect(run.version).toBe(3);
    expect(run.workflowVersion).toBe(3);
    expect(run.currentNode).toBe("collect_papers");
    expect(run.graph.nodeStates.collect_papers.status).toBe("pending");
    expect(run.memoryRefs.runContextPath).toContain(run.id);

    const fetched = await store.getRun(run.id);
    expect(fetched?.title).toBe("Test Run Title");
  });

  it("searches runs by id and title", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runsearch-"));
    tempDirs.push(cwd);
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);

    const store = new RunStore(paths);
    const run = await store.createRun({
      title: "Planning Benchmark",
      topic: "planning",
      constraints: [],
      objectiveMetric: "f1"
    });

    const byId = await store.searchRuns(run.id.slice(0, 8));
    expect(byId.length).toBe(1);

    const byTitle = await store.searchRuns("benchmark");
    expect(byTitle.length).toBe(1);
  });

  it("normalizes existing v3 runs to include review state and review-target transitions", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runnormalize-"));
    tempDirs.push(cwd);
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);

    const graph = createDefaultGraphState();
    delete (graph.nodeStates as Partial<typeof graph.nodeStates>).review;
    graph.currentNode = "analyze_results";
    graph.nodeStates.analyze_results.status = "needs_approval";
    graph.pendingTransition = {
      action: "advance",
      sourceNode: "analyze_results",
      targetNode: "write_paper",
      reason: "legacy target",
      confidence: 0.88,
      autoExecutable: true,
      evidence: ["ok"],
      suggestedCommands: ["/approve"],
      generatedAt: new Date().toISOString()
    };

    await writeFile(
      paths.runsFile,
      `${JSON.stringify({
        version: 3,
        runs: [
          {
            version: 3,
            workflowVersion: 3,
            id: "legacy-run",
            title: "Legacy",
            topic: "topic",
            constraints: [],
            objectiveMetric: "acc",
            status: "paused",
            currentNode: "analyze_results",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            nodeThreads: {},
            graph,
            memoryRefs: {
              runContextPath: ".autolabos/runs/legacy-run/memory/run_context.json",
              longTermPath: ".autolabos/runs/legacy-run/memory/long_term.jsonl",
              episodePath: ".autolabos/runs/legacy-run/memory/episodes.jsonl"
            }
          }
        ]
      }, null, 2)}\n`,
      "utf8"
    );

    const store = new RunStore(paths);
    const run = await store.getRun("legacy-run");

    expect(run?.graph.nodeStates.review.status).toBe("pending");
    expect(run?.graph.pendingTransition?.targetNode).toBe("review");
  });

  it("reconciles stale runs.json pointers from the latest checkpoint snapshot", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runcheckpoint-reconcile-"));
    tempDirs.push(cwd);
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);

    const store = new RunStore(paths);
    const checkpointStore = new CheckpointStore(paths);
    const run = await store.createRun({
      title: "Checkpoint Reconcile",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "implement_experiments";
    run.graph.currentNode = "implement_experiments";
    run.status = "running";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "completed";
    run.graph.nodeStates.implement_experiments.status = "running";
    const checkpoint = await checkpointStore.save(run, "before");

    const stale = structuredClone(run);
    stale.currentNode = "design_experiments";
    stale.graph.currentNode = "design_experiments";
    stale.graph.checkpointSeq = checkpoint.seq - 1;
    stale.graph.nodeStates.design_experiments = {
      ...stale.graph.nodeStates.design_experiments,
      status: "running",
      updatedAt: new Date(Date.now() - 60_000).toISOString()
    };
    stale.graph.nodeStates.implement_experiments = {
      ...stale.graph.nodeStates.implement_experiments,
      status: "pending",
      updatedAt: new Date(Date.now() - 60_000).toISOString()
    };
    stale.updatedAt = new Date(Date.now() - 60_000).toISOString();

    await writeFile(
      paths.runsFile,
      `${JSON.stringify({ version: 3, runs: [stale] }, null, 2)}\n`,
      "utf8"
    );

    const reconciled = await store.getRun(run.id);
    expect(reconciled?.currentNode).toBe("implement_experiments");
    expect(reconciled?.graph.currentNode).toBe("implement_experiments");
    expect(reconciled?.graph.checkpointSeq).toBe(checkpoint.seq);

    const runsFile = await readJsonFile<{ runs: Array<{ currentNode: string; graph: { checkpointSeq: number } }> }>(
      paths.runsFile
    );
    expect(runsFile.runs[0]?.currentNode).toBe("implement_experiments");
    expect(runsFile.runs[0]?.graph.checkpointSeq).toBe(checkpoint.seq);
  });

  it("prefers the highest checkpoint seq even when latest.json points at an older snapshot", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runcheckpoint-latest-regression-"));
    tempDirs.push(cwd);
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);

    const store = new RunStore(paths);
    const checkpointStore = new CheckpointStore(paths);
    const run = await store.createRun({
      title: "Latest Pointer Regression",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "design_experiments";
    run.graph.currentNode = "design_experiments";
    run.status = "running";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    const first = await checkpointStore.save(run, "before");

    run.currentNode = "implement_experiments";
    run.graph.currentNode = "implement_experiments";
    run.graph.nodeStates.design_experiments.status = "completed";
    run.graph.nodeStates.implement_experiments.status = "running";
    const second = await checkpointStore.save(run, "before");

    await writeFile(
      path.join(paths.runsDir, run.id, "checkpoints", "latest.json"),
      `${JSON.stringify(
        {
          seq: first.seq,
          node: first.node,
          phase: first.phase,
          createdAt: first.createdAt,
          file: `${String(first.seq).padStart(4, "0")}-${first.node}-${first.phase}.json`
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const stale = structuredClone(run);
    stale.currentNode = "design_experiments";
    stale.graph.currentNode = "design_experiments";
    stale.graph.checkpointSeq = first.seq;
    stale.graph.nodeStates.design_experiments = {
      ...stale.graph.nodeStates.design_experiments,
      status: "running",
      updatedAt: new Date(Date.now() - 60_000).toISOString()
    };
    stale.graph.nodeStates.implement_experiments = {
      ...stale.graph.nodeStates.implement_experiments,
      status: "pending",
      updatedAt: new Date(Date.now() - 60_000).toISOString()
    };
    stale.updatedAt = new Date(Date.now() - 60_000).toISOString();

    await writeFile(
      paths.runsFile,
      `${JSON.stringify({ version: 3, runs: [stale] }, null, 2)}\n`,
      "utf8"
    );

    const reconciled = await store.getRun(run.id);
    expect(reconciled?.currentNode).toBe("implement_experiments");
    expect(reconciled?.graph.currentNode).toBe("implement_experiments");
    expect(reconciled?.graph.checkpointSeq).toBe(second.seq);
  });

  it("ignores stale updateRun snapshots when a newer checkpointed state already exists", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runcheckpoint-monotonic-"));
    tempDirs.push(cwd);
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);

    const store = new RunStore(paths);
    const checkpointStore = new CheckpointStore(paths);
    const run = await store.createRun({
      title: "Monotonic Update",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    const stale = structuredClone(run);

    run.currentNode = "analyze_papers";
    run.graph.currentNode = "analyze_papers";
    run.status = "running";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "running";
    await checkpointStore.save(run, "jump", "manual recovery");
    await store.updateRun(run);

    await store.updateRun(stale);

    const latest = await store.getRun(run.id);
    expect(latest?.currentNode).toBe("analyze_papers");
    expect(latest?.graph.currentNode).toBe("analyze_papers");
    expect(latest?.graph.checkpointSeq).toBeGreaterThan(stale.graph.checkpointSeq);
    expect(latest?.graph.nodeStates.collect_papers.status).toBe("completed");
  });

  it("hydrates a missing pendingTransition from transition_recommendation.json", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runstore-transition-"));
    tempDirs.push(cwd);
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);

    const store = new RunStore(paths);
    const run = await store.createRun({
      title: "Transition Recovery",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "run_experiments";
    run.graph.currentNode = "run_experiments";
    run.status = "failed";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "completed";
    run.graph.nodeStates.implement_experiments.status = "completed";
    run.graph.nodeStates.run_experiments.status = "failed";
    run.graph.pendingTransition = undefined;
    await store.updateRun(run);

    await writeFile(
      path.join(paths.runsDir, run.id, "transition_recommendation.json"),
      `${JSON.stringify(
        {
          action: "backtrack_to_design",
          sourceNode: "analyze_results",
          targetNode: "design_experiments",
          reason: "Objective not met",
          confidence: 0.64,
          autoExecutable: true,
          evidence: ["accuracy_delta_vs_baseline < 0"],
          suggestedCommands: ["/agent jump design_experiments", "/agent run design_experiments"],
          generatedAt: new Date().toISOString()
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const hydrated = await store.getRun(run.id);
    expect(hydrated?.graph.pendingTransition?.action).toBe("backtrack_to_design");
    expect(hydrated?.graph.pendingTransition?.targetNode).toBe("design_experiments");
  });

  it("does not rehydrate transition_recommendation.json once the run has already re-entered a non-failed node", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runstore-transition-running-"));
    tempDirs.push(cwd);
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);

    const store = new RunStore(paths);
    const run = await store.createRun({
      title: "Transition Recovery Narrowing",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "design_experiments";
    run.graph.currentNode = "design_experiments";
    run.status = "running";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "running";
    run.graph.pendingTransition = undefined;
    await store.updateRun(run);

    await writeFile(
      path.join(paths.runsDir, run.id, "transition_recommendation.json"),
      `${JSON.stringify(
        {
          action: "backtrack_to_design",
          sourceNode: "analyze_results",
          targetNode: "design_experiments",
          reason: "Objective not met",
          confidence: 0.64,
          autoExecutable: true,
          evidence: ["accuracy_delta_vs_baseline < 0"],
          suggestedCommands: ["/agent jump design_experiments", "/agent run design_experiments"],
          generatedAt: new Date().toISOString()
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const hydrated = await store.getRun(run.id);
    expect(hydrated?.graph.pendingTransition).toBeUndefined();
    expect(hydrated?.currentNode).toBe("design_experiments");
  });

  it("clears a stale pendingTransition after the run has already moved into a non-failed node", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runstore-transition-clear-"));
    tempDirs.push(cwd);
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);

    const store = new RunStore(paths);
    const run = await store.createRun({
      title: "Transition Recovery Cleanup",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    run.currentNode = "design_experiments";
    run.graph.currentNode = "design_experiments";
    run.status = "running";
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.generate_hypotheses.status = "completed";
    run.graph.nodeStates.design_experiments.status = "running";
    run.graph.pendingTransition = {
      action: "backtrack_to_design",
      sourceNode: "analyze_results",
      targetNode: "design_experiments",
      reason: "Objective not met",
      confidence: 0.64,
      autoExecutable: true,
      evidence: ["accuracy_delta_vs_baseline < 0"],
      suggestedCommands: ["/agent jump design_experiments", "/agent run design_experiments"],
      generatedAt: new Date().toISOString()
    };
    await store.updateRun(run);

    const hydrated = await store.getRun(run.id);
    expect(hydrated?.graph.pendingTransition).toBeUndefined();
    expect(hydrated?.status).toBe("running");
    expect(hydrated?.currentNode).toBe("design_experiments");
  });

  it("normalizes persisted usage summaries without forcing usage onto untouched runs", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-run-usage-normalize-"));
    tempDirs.push(cwd);
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);

    await writeFile(
      paths.runsFile,
      `${JSON.stringify({
        version: 3,
        runs: [
          {
            version: 3,
            workflowVersion: 3,
            id: "usage-run",
            title: "Usage",
            topic: "topic",
            constraints: [],
            objectiveMetric: "metric",
            status: "paused",
            currentNode: "collect_papers",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            usage: {
              totals: {
                toolCalls: 5
              },
              byNode: {
                collect_papers: {
                  toolCalls: 2,
                  executions: 1
                }
              }
            },
            nodeThreads: {},
            graph: createDefaultGraphState(),
            memoryRefs: {
              runContextPath: ".autolabos/runs/usage-run/memory/run_context.json",
              longTermPath: ".autolabos/runs/usage-run/memory/long_term.jsonl",
              episodePath: ".autolabos/runs/usage-run/memory/episodes.jsonl"
            }
          },
          {
            version: 3,
            workflowVersion: 3,
            id: "plain-run",
            title: "Plain",
            topic: "topic",
            constraints: [],
            objectiveMetric: "metric",
            status: "pending",
            currentNode: "collect_papers",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            nodeThreads: {},
            graph: createDefaultGraphState(),
            memoryRefs: {
              runContextPath: ".autolabos/runs/plain-run/memory/run_context.json",
              longTermPath: ".autolabos/runs/plain-run/memory/long_term.jsonl",
              episodePath: ".autolabos/runs/plain-run/memory/episodes.jsonl"
            }
          }
        ]
      }, null, 2)}\n`,
      "utf8"
    );

    const store = new RunStore(paths);
    const usageRun = await store.getRun("usage-run");
    const plainRun = await store.getRun("plain-run");

    expect(usageRun?.usage?.totals).toMatchObject({
      costUsd: 0,
      toolCalls: 5,
      inputTokens: 0,
      outputTokens: 0,
      wallTimeMs: 0
    });
    expect(usageRun?.usage?.byNode.collect_papers).toMatchObject({
      costUsd: 0,
      toolCalls: 2,
      inputTokens: 0,
      outputTokens: 0,
      wallTimeMs: 0,
      executions: 1
    });
    expect(plainRun?.usage).toBeUndefined();
  });
});
