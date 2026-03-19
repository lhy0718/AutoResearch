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

  it("prefers the canonical flat outputs bundle when failure context names the current artifact path", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-localizer-flat-"));
    tempDirs.push(workspace);

    const currentOutput = path.join(workspace, "outputs", "experiment");
    const siblingOutput = path.join(workspace, "scratch", "tabular-baselines-b1b6b29d", "experiment");
    mkdirSync(currentOutput, { recursive: true });
    mkdirSync(siblingOutput, { recursive: true });

    writeFileSync(path.join(currentOutput, "experiment_plan.yaml"), "topic: current\n", "utf8");
    writeFileSync(path.join(currentOutput, "run_tabular_baselines.py"), "print('current')\n", "utf8");
    writeFileSync(path.join(siblingOutput, "experiment_plan.yaml"), "topic: sibling\n", "utf8");
    writeFileSync(path.join(siblingOutput, "run_tabular_baselines.py"), "print('sibling')\n", "utf8");

    const localizer = new ImplementationLocalizer(new LocalAciAdapter());
    const result = await localizer.localize({
      workspaceRoot: workspace,
      goal: "Implement a runnable experiment and produce macro-F1 metrics.",
      topic: "Classical machine learning baselines for tabular classification on small public datasets.",
      objectiveMetric: "Improve macro-F1 over a logistic regression baseline while preserving reproducible CPU-only local execution.",
      constraints: [],
      planExcerpt: "run_id: f86bfc2a-475f-4ca0-a340-14a497ab7719",
      hypothesesExcerpt: "Use a lightweight sklearn runner.",
      previousFailureSummary:
        `Local verification could not start because required artifact(s) were not materialized for python3 -m py_compile ` +
        `${path.join(currentOutput, "run_tabular_baselines.py")}: outputs/experiment/run_tabular_baselines.py`,
      existingChangedFiles: []
    });

    expect(result.selected_files).toContain(path.join(currentOutput, "run_tabular_baselines.py"));
    expect(result.candidates[0]?.path).toContain(path.join("outputs", "experiment"));
  });

  it("uses run-id and output hints from the plan excerpt to keep sibling outputs out of the top selection", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-localizer-planhint-"));
    tempDirs.push(workspace);

    const currentOutput = path.join(workspace, "outputs", "cpu-only-classical-tabular-classification-baseli-f86bfc2a");
    const siblingOutput = path.join(workspace, "outputs", "classical-tabular-classification-baselines-on-sm-b1b6b29d");
    mkdirSync(path.join(currentOutput, "experiment"), { recursive: true });
    mkdirSync(path.join(siblingOutput, "experiment"), { recursive: true });

    writeFileSync(path.join(currentOutput, "manifest.json"), "{\"current\":true}\n", "utf8");
    writeFileSync(path.join(currentOutput, "experiment", "experiment_plan.yaml"), "topic: current\n", "utf8");
    writeFileSync(path.join(siblingOutput, "manifest.json"), "{\"sibling\":true}\n", "utf8");
    writeFileSync(path.join(siblingOutput, "experiment", "experiment_plan.yaml"), "topic: sibling\n", "utf8");

    const localizer = new ImplementationLocalizer(new LocalAciAdapter());
    const result = await localizer.localize({
      workspaceRoot: workspace,
      goal: "Implement a runnable experiment.",
      topic: "Classical machine learning baselines for tabular classification on small public datasets.",
      objectiveMetric: "macro-F1",
      constraints: [],
      planExcerpt: [
        "run_id: f86bfc2a-475f-4ca0-a340-14a497ab7719",
        "public_outputs: outputs",
        "selected_design: current"
      ].join("\n"),
      hypothesesExcerpt: "Focus on the selected design only.",
      existingChangedFiles: []
    });

    expect(result.selected_files.some((filePath) => filePath.includes(path.basename(currentOutput)))).toBe(true);
    expect(result.selected_files.some((filePath) => filePath.includes(path.basename(siblingOutput)))).toBe(false);
  });
});
