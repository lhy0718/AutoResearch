import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ImplementationLocalizer } from "../src/core/agents/implementationLocalizer.js";
import { LocalAciAdapter } from "../src/tools/aciLocalAdapter.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("ImplementationLocalizer", () => {
  it("ranks the most relevant experiment file from search evidence", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-localizer-"));
    tempDirs.push(workspace);
    mkdirSync(path.join(workspace, "src"), { recursive: true });
    mkdirSync(path.join(workspace, "docs"), { recursive: true });

    writeFileSync(
      path.join(workspace, "src", "runner.py"),
      [
        "def run_experiment():",
        "    metrics = {'accuracy': 0.0}",
        "    return metrics"
      ].join("\n"),
      "utf8"
    );
    writeFileSync(path.join(workspace, "src", "reader.ts"), "export const readCorpus = () => [];\n", "utf8");
    writeFileSync(path.join(workspace, "docs", "notes.md"), "general notes about papers and references\n", "utf8");

    const localizer = new ImplementationLocalizer(new LocalAciAdapter());
    const result = await localizer.localize({
      workspaceRoot: workspace,
      goal: "Implement a runnable experiment and produce accuracy metrics.",
      topic: "experiment runner",
      objectiveMetric: "accuracy",
      constraints: ["recent"],
      planExcerpt: "Create a run_experiment baseline and write metrics output.",
      hypothesesExcerpt: "A lightweight runner should report accuracy.",
      existingChangedFiles: []
    });

    expect(result.selected_files[0]).toBe(path.join(workspace, "src", "runner.py"));
    expect(result.candidates.some((candidate) => candidate.path.endsWith("runner.py"))).toBe(true);
    expect(result.search_queries?.some((query) => query.includes("accuracy"))).toBe(true);
    expect(result.hits?.some((hit) => hit.path.endsWith("runner.py"))).toBe(true);
  });

  it("uses previous failure context to recover the likely broken file", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-localizer-failure-"));
    tempDirs.push(workspace);
    mkdirSync(path.join(workspace, "src"), { recursive: true });

    writeFileSync(
      path.join(workspace, "src", "broken_experiment.py"),
      "def broken_experiment():\n    print('oops'\n",
      "utf8"
    );
    writeFileSync(path.join(workspace, "src", "healthy_experiment.py"), "def healthy_experiment():\n    return 1\n", "utf8");

    const localizer = new ImplementationLocalizer(new LocalAciAdapter());
    const result = await localizer.localize({
      workspaceRoot: workspace,
      goal: "Repair the runnable experiment after local verification failed.",
      topic: "experiment repair",
      objectiveMetric: "accuracy",
      constraints: [],
      planExcerpt: "Focus on the broken experiment entry point.",
      hypothesesExcerpt: "The syntax error is localized to the main script.",
      previousFailureSummary: "Local verification failed via python3 -m py_compile broken_experiment.py",
      existingChangedFiles: []
    });

    expect(result.selected_files).toContain(path.join(workspace, "src", "broken_experiment.py"));
    expect(result.candidates[0]?.path).toBe(path.join(workspace, "src", "broken_experiment.py"));
  });

  it("falls back to filesystem localization when ripgrep is unavailable", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-localizer-no-rg-"));
    tempDirs.push(workspace);
    mkdirSync(path.join(workspace, "src"), { recursive: true });

    writeFileSync(
      path.join(workspace, "src", "accuracy_runner.py"),
      [
        "def run_experiment():",
        "    return {'accuracy': 0.91}"
      ].join("\n"),
      "utf8"
    );

    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const localizer = new ImplementationLocalizer(new LocalAciAdapter());
      const result = await localizer.localize({
        workspaceRoot: workspace,
        goal: "Implement a runnable experiment and produce accuracy metrics.",
        topic: "experiment runner",
        objectiveMetric: "accuracy",
        constraints: [],
        planExcerpt: "Focus on the runner implementation.",
        hypothesesExcerpt: "The runner should return accuracy.",
        existingChangedFiles: []
      });

      expect(result.selected_files[0]).toBe(path.join(workspace, "src", "accuracy_runner.py"));
      expect(result.hits?.some((hit) => hit.path.endsWith("accuracy_runner.py"))).toBe(true);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
