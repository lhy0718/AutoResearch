import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import { RunStore } from "../src/core/runs/runStore.js";

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
});
