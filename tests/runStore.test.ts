import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import { appendJsonl, writeRunArtifact } from "../src/core/nodes/helpers.js";
import { RunIndexDatabase } from "../src/core/runs/runIndexDatabase.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { CheckpointStore } from "../src/core/stateGraph/checkpointStore.js";
import { RunStore } from "../src/core/runs/runStore.js";
import { RunRecord } from "../src/types.js";
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

  it("bootstraps the sqlite index from runs.json and fresher run_record snapshots", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runstore-sqlite-bootstrap-"));
    tempDirs.push(cwd);
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);

    const staleUpdatedAt = new Date(Date.now() - 60_000).toISOString();
    const freshUpdatedAt = new Date().toISOString();
    const stale = {
      version: 3,
      workflowVersion: 3,
      id: "bootstrap-run",
      title: "Bootstrap",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric",
      status: "running" as const,
      currentNode: "design_experiments" as const,
      latestSummary: "stale summary",
      nodeThreads: {},
      createdAt: staleUpdatedAt,
      updatedAt: staleUpdatedAt,
      graph: {
        ...createDefaultGraphState(),
        currentNode: "design_experiments" as const,
        nodeStates: {
          ...createDefaultGraphState().nodeStates,
          collect_papers: {
            status: "completed" as const,
            updatedAt: staleUpdatedAt
          },
          analyze_papers: {
            status: "completed" as const,
            updatedAt: staleUpdatedAt
          },
          generate_hypotheses: {
            status: "completed" as const,
            updatedAt: staleUpdatedAt
          },
          design_experiments: {
            status: "running" as const,
            updatedAt: staleUpdatedAt
          }
        }
      },
      memoryRefs: {
        runContextPath: ".autolabos/runs/bootstrap-run/memory/run_context.json",
        longTermPath: ".autolabos/runs/bootstrap-run/memory/long_term.jsonl",
        episodePath: ".autolabos/runs/bootstrap-run/memory/episodes.jsonl"
      }
    } satisfies RunRecord;
    const fresh = {
      ...stale,
      currentNode: "implement_experiments" as const,
      latestSummary: "fresh snapshot",
      updatedAt: freshUpdatedAt,
      graph: {
        ...stale.graph,
        currentNode: "implement_experiments" as const,
        nodeStates: {
          ...stale.graph.nodeStates,
          design_experiments: {
            status: "completed" as const,
            updatedAt: freshUpdatedAt
          },
          implement_experiments: {
            status: "running" as const,
            updatedAt: freshUpdatedAt
          }
        }
      }
    } satisfies RunRecord;

    await writeFile(paths.runsFile, `${JSON.stringify({ version: 3, runs: [stale] }, null, 2)}\n`, "utf8");
    await mkdir(path.join(paths.runsDir, stale.id), { recursive: true });
    await writeFile(path.join(paths.runsDir, stale.id, "run_record.json"), `${JSON.stringify(fresh, null, 2)}\n`, "utf8");

    const store = new RunStore(paths);
    const runs = await store.listRuns();

    expect(runs[0]?.currentNode).toBe("implement_experiments");
    expect(runs[0]?.latestSummary).toBe("fresh snapshot");
    expect(existsSync(paths.runsDbFile)).toBe(true);

    const mirrored = await readJsonFile<{ runs: RunRecord[] }>(paths.runsFile);
    expect(mirrored.runs[0]?.currentNode).toBe("implement_experiments");
  });

  it("reimports newer external runs.json edits into the sqlite-backed index", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runstore-sqlite-import-"));
    tempDirs.push(cwd);
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);

    const store = new RunStore(paths);
    const created = await store.createRun({
      title: "Original Title",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });

    const externalUpdatedAt = new Date(Date.now() + 60_000).toISOString();
    const external = {
      ...created,
      title: "Imported From runs.json",
      status: "paused" as const,
      currentNode: "analyze_results" as const,
      latestSummary: "imported mirror state",
      updatedAt: externalUpdatedAt,
      graph: {
        ...created.graph,
        currentNode: "analyze_results" as const,
        nodeStates: {
          ...created.graph.nodeStates,
          analyze_results: {
            status: "needs_approval" as const,
            updatedAt: externalUpdatedAt,
            note: "imported mirror state"
          }
        }
      }
    } satisfies RunRecord;

    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(paths.runsFile, `${JSON.stringify({ version: 3, runs: [external] }, null, 2)}\n`, "utf8");

    const listed = await store.listRuns();
    expect(listed[0]?.title).toBe("Imported From runs.json");
    expect(listed[0]?.currentNode).toBe("analyze_results");

    const hydrated = await store.getRun(created.id);
    expect(hydrated?.title).toBe("Imported From runs.json");
    expect(hydrated?.latestSummary).toContain("imported mirror state");
  });

  it("keeps runs.json as a projection while persisting the full run record per run", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runstore-projection-"));
    tempDirs.push(cwd);
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);

    const store = new RunStore(paths);
    const run = await store.createRun({
      title: "Projected Index",
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
      reason: "objective fell below baseline",
      confidence: 0.73,
      autoExecutable: true,
      evidence: ["delta < 0"],
      suggestedCommands: ["/approve"],
      generatedAt: new Date().toISOString()
    };
    run.graph.transitionHistory = [
      {
        action: "backtrack_to_design",
        sourceNode: "analyze_results",
        fromNode: "analyze_results",
        toNode: "design_experiments",
        reason: "r1",
        confidence: 0.7,
        autoExecutable: true,
        appliedAt: new Date().toISOString()
      }
    ];
    await store.updateRun(run);

    const runsFile = await readJsonFile<{ runs: RunRecord[] }>(paths.runsFile);
    const indexed = runsFile.runs.find((candidate) => candidate.id === run.id);
    expect(indexed?.graph.pendingTransition?.targetNode).toBe("design_experiments");
    expect(indexed?.graph.transitionHistory).toEqual([]);

    const snapshot = await readJsonFile<RunRecord>(path.join(paths.runsDir, run.id, "run_record.json"));
    expect(snapshot.graph.transitionHistory).toHaveLength(1);
    expect(snapshot.graph.pendingTransition?.targetNode).toBe("design_experiments");

    const hydrated = await store.getRun(run.id);
    expect(hydrated?.graph.transitionHistory).toHaveLength(1);
  });

  it("persists usage, artifact, and checkpoint operational indexes in sqlite", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "autolabos-runstore-operational-indexes-"));
    tempDirs.push(cwd);
    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      const paths = resolveAppPaths(cwd);
      await ensureScaffold(paths);

      const store = new RunStore(paths);
      const checkpointStore = new CheckpointStore(paths);
      const run = await store.createRun({
        title: "Operational Indexes",
        topic: "topic",
        constraints: [],
        objectiveMetric: "metric"
      });

      run.usage = {
        totals: {
          costUsd: 1.5,
          toolCalls: 3,
          inputTokens: 120,
          outputTokens: 45,
          wallTimeMs: 2_300
        },
        byNode: {
          collect_papers: {
            costUsd: 1.5,
            toolCalls: 3,
            inputTokens: 120,
            outputTokens: 45,
            wallTimeMs: 2_300,
            executions: 1,
            lastUpdatedAt: new Date().toISOString()
          }
        },
        lastUpdatedAt: new Date().toISOString()
      };
      await store.updateRun(run);

      await writeRunArtifact(
        run,
        "analysis_manifest.json",
        `${JSON.stringify(
          {
            version: 3,
            updatedAt: new Date().toISOString(),
            request: { selectionMode: "all" },
            selectionFingerprint: "fingerprint",
            totalCandidates: 1,
            candidatePoolSize: 1,
            selectedPaperIds: ["paper-1"],
            rerankedPaperIds: ["paper-1"],
            deterministicRankingPreview: [],
            papers: {
              "paper-1": {
                paper_id: "paper-1",
                title: "Paper 1",
                status: "completed",
                selected: true,
                summary_count: 1,
                evidence_count: 1,
                analysis_attempts: 1,
                updatedAt: new Date().toISOString()
              }
            }
          },
          null,
          2
        )}\n`
      );
      await appendJsonl(run, "paper_summaries.jsonl", [{ paper_id: "paper-1", summary: "summary" }]);
      const checkpoint = await checkpointStore.save(run, "before");

      const index = new RunIndexDatabase(paths.runsDbFile);
      try {
        expect(index.getRunUsageSummary(run.id)?.usage.totals.costUsd).toBe(1.5);
        expect(index.getRunUsageSummary(run.id)?.usage.byNode.collect_papers?.executions).toBe(1);

        const checkpointIndex = index.getLatestCheckpoint(run.id);
        expect(checkpointIndex?.checkpointSeq).toBe(checkpoint.seq);
        expect(checkpointIndex?.phase).toBe("before");

        const artifacts = index.listRunArtifacts(run.id);
        const analysisManifest = artifacts.find((artifact) => artifact.artifactType === "analysis_manifest");
        const paperSummaries = artifacts.find((artifact) => artifact.artifactType === "paper_summaries");
        expect(analysisManifest?.filePath).toContain(path.join(run.id, "analysis_manifest.json"));
        expect(paperSummaries?.filePath).toContain(path.join(run.id, "paper_summaries.jsonl"));
        expect(JSON.parse(paperSummaries?.metadataJson || "{}")).toMatchObject({ lineCount: 1 });
      } finally {
        index.close();
      }
    } finally {
      process.chdir(originalCwd);
    }
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
