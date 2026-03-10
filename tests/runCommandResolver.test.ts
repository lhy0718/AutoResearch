import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { RunStore } from "../src/core/runs/runStore.js";
import { resolveRunCommand } from "../src/core/nodes/runCommandResolver.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("resolveRunCommand", () => {
  it("prefers explicit run command stored in run context", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-run-command-"));
    tempDirs.push(workspace);
    const paths = resolveAppPaths(workspace);
    await ensureScaffold(paths);

    const runStore = new RunStore(paths);
    const run = await runStore.createRun({
      title: "Runner Run",
      topic: "runner",
      constraints: [],
      objectiveMetric: "loss"
    });

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    await memory.put("implement_experiments.run_command", "python3 demo.py --epochs 1");
    await memory.put("implement_experiments.cwd", ".");
    await memory.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);
    await memory.put("implement_experiments.test_command", "python3 -m py_compile demo.py");

    const resolved = await resolveRunCommand(run, workspace);
    expect(resolved.command).toBe("python3 demo.py --epochs 1");
    expect(resolved.cwd).toBe(workspace);
    expect(resolved.testCommand).toBe("python3 -m py_compile demo.py");
    expect(resolved.metricsPath).toContain(`${run.id}/metrics.json`);
  });

  it("falls back to run-local experiment script when no explicit command exists", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-run-script-"));
    tempDirs.push(workspace);
    const paths = resolveAppPaths(workspace);
    await ensureScaffold(paths);

    const runStore = new RunStore(paths);
    const run = await runStore.createRun({
      title: "Runner Script Run",
      topic: "runner",
      constraints: [],
      objectiveMetric: "loss"
    });

    const runDir = path.join(workspace, ".autolabos", "runs", run.id);
    mkdirSync(runDir, { recursive: true });
    const scriptPath = path.join(runDir, "experiment.py");
    writeFileSync(scriptPath, "print('hi')\n", "utf8");

    const resolved = await resolveRunCommand(run, workspace);
    expect(resolved.command).toContain(scriptPath);
    expect(resolved.source).toBe("run_dir.experiment.py");
    expect(resolved.metricsPath).toBe(path.join(runDir, "metrics.json"));
  });

  it("prefers public experiment artifacts when available", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-run-public-script-"));
    tempDirs.push(workspace);
    const paths = resolveAppPaths(workspace);
    await ensureScaffold(paths);

    const runStore = new RunStore(paths);
    const run = await runStore.createRun({
      title: "Runner Public Script Run",
      topic: "runner",
      constraints: [],
      objectiveMetric: "loss"
    });

    const publicDir = path.join(workspace, "outputs", "runner-public-script-run-" + run.id.slice(0, 8), "experiment");
    mkdirSync(publicDir, { recursive: true });
    const publicScriptPath = path.join(publicDir, "experiment.py");
    writeFileSync(publicScriptPath, "print('hi')\n", "utf8");

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    await memory.put("implement_experiments.public_dir", publicDir);
    await memory.put("implement_experiments.cwd", publicDir);

    const resolved = await resolveRunCommand(run, workspace);
    expect(resolved.command).toContain(publicScriptPath);
    expect(resolved.cwd).toBe(publicDir);
    expect(resolved.source).toBe("public_dir.experiment.py");
  });
});
