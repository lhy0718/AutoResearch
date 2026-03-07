import path from "node:path";

import { promises as fs } from "node:fs";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { LongTermStore } from "../memory/longTermStore.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import {
  evaluateObjectiveMetric,
  ObjectiveMetricEvaluation,
  resolveObjectiveMetricProfile
} from "../objectiveMetric.js";

export function createAnalyzeResultsNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "analyze_results",
    async execute({ run, graph }) {
      const longTermStore = new LongTermStore(run.memoryRefs.longTermPath);
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      const metricsPath = path.join(".autoresearch", "runs", run.id, "metrics.json");
      let metrics: Record<string, unknown> = {};
      try {
        const raw = await fs.readFile(metricsPath, "utf8");
        metrics = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        metrics = { accuracy: 0, f1: 0, loss: 1 };
      }

      const objectiveProfile = await resolveObjectiveMetricProfile({
        run,
        runContextMemory,
        llm: deps.llm,
        eventStream: deps.eventStream,
        node: "analyze_results"
      });
      const cachedEvaluation =
        await runContextMemory.get<ObjectiveMetricEvaluation>("objective_metric.last_evaluation");
      const objectiveEvaluation =
        cachedEvaluation || evaluateObjectiveMetric(metrics, objectiveProfile, run.objectiveMetric);

      const summary = {
        mean_score: computeMeanNumericMetric(metrics),
        metrics,
        objective_metric: {
          raw: run.objectiveMetric,
          evaluation: objectiveEvaluation
        }
      };

      await writeRunArtifact(run, "result_analysis.json", JSON.stringify(summary, null, 2));
      await writeRunArtifact(run, "figures/performance.png", "placeholder_png_binary");
      await runContextMemory.put("analyze_results.last_summary", summary);
      await longTermStore.append({
        runId: run.id,
        category: "results",
        text: `Result summary: ${JSON.stringify(summary)}`,
        tags: ["analyze_results"]
      });

      return {
        status: "success",
        summary: `Result analysis complete. mean_score=${summary.mean_score}. ${objectiveEvaluation.summary}`,
        needsApproval: true,
        toolCallsUsed: 1
      };
    }
  };
}

function computeMeanNumericMetric(metrics: Record<string, unknown>): number {
  const values = Object.values(metrics).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(mean.toFixed(4));
}
