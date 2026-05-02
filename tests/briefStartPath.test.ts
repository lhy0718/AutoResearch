import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAppPaths, ensureScaffold } from "../src/config.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { buildGuidedResearchBriefMarkdown } from "../src/core/runs/researchBriefFiles.js";
import { RunStore } from "../src/core/runs/runStore.js";
import { TerminalApp } from "../src/tui/TerminalApp.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("/brief start path handling", () => {
  it("starts from an absolute brief path outside the workspace without modifying the source", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "autolabos-brief-start-workspace-"));
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), "autolabos-brief-start-external-"));
    tempDirs.push(workspace, externalRoot);
    const originalCwd = process.cwd();
    process.chdir(workspace);

    try {
      const paths = resolveAppPaths(workspace);
      await ensureScaffold(paths);
      const runStore = new RunStore(paths);
      const externalBriefPath = path.join(externalRoot, "AGB-001-brief.md");
      const briefMarkdown = buildCompleteBriefMarkdown();
      await mkdir(path.dirname(externalBriefPath), { recursive: true });
      await writeFile(externalBriefPath, briefMarkdown, "utf8");

      const app = new TerminalApp({
        config: {
          papers: { max_results: 100 },
          providers: {
            llm_mode: "codex_chatgpt_only",
            codex: {
              model: "gpt-5.3-codex",
              chat_model: "gpt-5.3-codex",
              reasoning_effort: "medium",
              chat_reasoning_effort: "medium",
              fast_mode: false,
              chat_fast_mode: false
            },
            openai: { model: "gpt-5.4", reasoning_effort: "medium" }
          },
          analysis: {
            responses_model: "gpt-5.4"
          },
          research: {
            default_topic: "default topic",
            default_constraints: ["recent papers"],
            default_objective_metric: "default metric"
          }
        } as any,
        runStore,
        titleGenerator: {
          generateTitle: vi.fn().mockResolvedValue("External brief run")
        } as any,
        codex: {
          runTurnStream: vi.fn(async () => {
            throw new Error("llm unavailable");
          })
        } as any,
        eventStream: { subscribe: () => () => {} } as any,
        orchestrator: {
          runCurrentAgentWithOptions: vi.fn()
        } as any,
        semanticScholarApiKeyConfigured: false,
        onQuit: () => {},
        saveConfig: async () => {}
      }) as any;
      app.render = () => {};
      app.updateSuggestions = () => {};
      app.drainQueuedInputs = async () => {};
      app.startRun = vi.fn(async (runId: string) => (await runStore.getRun(runId))!);

      await app.handleBriefCommand(["start", externalBriefPath]);

      const runs = await runStore.listRuns();
      expect(runs).toHaveLength(1);
      const run = runs[0];
      expect(run.title).toBe("External brief run");
      expect(app.startRun).toHaveBeenCalledWith(run.id, undefined);
      expect(await readFile(externalBriefPath, "utf8")).toBe(briefMarkdown);

      const snapshot = await readFile(
        path.join(workspace, ".autolabos", "runs", run.id, "brief", "source_brief.md"),
        "utf8"
      );
      expect(snapshot).toBe(briefMarkdown);

      const runContext = new RunContextMemory(path.join(workspace, run.memoryRefs.runContextPath));
      expect(await runContext.get("run_brief.source_path")).toBe(externalBriefPath);
      expect(await runContext.get("run_brief.snapshot_path")).toBe(
        `.autolabos/runs/${run.id}/brief/source_brief.md`
      );
    } finally {
      process.chdir(originalCwd);
    }
  });
});

function buildCompleteBriefMarkdown(): string {
  return buildGuidedResearchBriefMarkdown({
    topic: "A small governed benchmark task for brief path handling.",
    primaryMetric: "macro F1",
    secondaryMetrics: "runtime",
    meaningfulImprovement: "At least two macro-F1 points over baseline.",
    constraints: "Use a small public dataset; keep seed fixed; no network-only artifacts.",
    researchQuestion: "Does the proposed condition improve macro F1 over a named baseline?",
    whySmallExperiment: "The dataset is small, the baseline is simple, and the metric is objective.",
    baselineComparator: "Baseline: bag-of-words logistic regression.",
    datasetTaskBench: "Dataset: small public text classification task.",
    targetComparison: "Compare baseline against proposed preprocessing on macro F1.",
    minimumAcceptableEvidence: "One executed baseline and one executed comparator with numeric macro F1.",
    disallowedShortcuts: "No fabricated metrics; no missing baseline; no smoke-only evidence.",
    allowedBudgetedPasses: "One implementation repair pass and one analysis repair pass.",
    paperCeiling: "research_memo unless all evidence requirements are met.",
    minimumExperimentPlan: "Train baseline; train comparator; evaluate; write result table.",
    failureConditions: "Missing baseline; missing metric; failed execution; unsupported claim.",
    notes: "External source fixture for path handling.",
    questionsRisks: "Small sample size may limit generality."
  });
}
