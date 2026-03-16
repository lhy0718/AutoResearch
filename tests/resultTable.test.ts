import { describe, it, expect } from "vitest";
import type { AnalysisReport } from "../src/core/resultAnalysis.js";

describe("buildResultTable", () => {
  it("extracts conditions and comparisons from AnalysisReport", async () => {
    const mod = await import("../src/core/nodes/analyzeResults.js");

    const report: Partial<AnalysisReport> = {
      condition_comparisons: [
        {
          id: "adaptive",
          label: "Adaptive TTC",
          source: "metrics.comparison",
          metrics: [
            { key: "accuracy", value: 0.16, primary_value: 0.16, baseline_value: 0.22 }
          ],
          hypothesis_supported: false,
          summary: "Adaptive worse than baseline"
        }
      ],
      metric_table: [{ key: "accuracy", value: 0.22 }],
      overview: {
        objective_status: "not_met",
        objective_summary: "Accuracy did not improve",
        matched_metric_key: "accuracy",
        execution_runs: 1
      }
    };

    const result = mod.buildResultTable(report as AnalysisReport);

    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0].name).toBe("adaptive");
    expect(result.conditions[0].metrics["accuracy"]).toBe(0.16);
    expect(result.comparisons).toHaveLength(1);
    expect(result.comparisons[0].primary).toBe("adaptive");
    expect(result.comparisons[0].baseline).toBe("metrics.comparison");
    expect(result.comparisons[0].metric).toBe("accuracy");
    expect(result.comparisons[0].delta).toBeCloseTo(-0.06);
    expect(result.comparisons[0].hypothesis_supported).toBe(false);
    expect(result.primary_metric).toBe("accuracy");
    expect(result.summary).toBe("Accuracy did not improve");
  });

  it("falls back to metric_table when no condition_comparisons", async () => {
    const mod = await import("../src/core/nodes/analyzeResults.js");

    const report: Partial<AnalysisReport> = {
      condition_comparisons: [],
      metric_table: [
        { key: "f1", value: 0.75 },
        { key: "precision", value: 0.80 }
      ],
      overview: {
        objective_status: "met",
        objective_summary: "F1 above threshold",
        matched_metric_key: "f1",
        execution_runs: 2
      }
    };

    const result = mod.buildResultTable(report as AnalysisReport);

    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0].name).toBe("primary");
    expect(result.conditions[0].metrics["f1"]).toBe(0.75);
    expect(result.conditions[0].metrics["precision"]).toBe(0.80);
    expect(result.comparisons).toHaveLength(0);
    expect(result.primary_metric).toBe("f1");
  });

  it("handles empty report gracefully", async () => {
    const mod = await import("../src/core/nodes/analyzeResults.js");

    const report: Partial<AnalysisReport> = {
      condition_comparisons: [],
      metric_table: [],
      overview: {
        objective_status: "missing",
        objective_summary: "",
        execution_runs: 0
      }
    };

    const result = mod.buildResultTable(report as AnalysisReport);

    expect(result.conditions).toHaveLength(0);
    expect(result.comparisons).toHaveLength(0);
    expect(result.primary_metric).toBe("");
    expect(result.summary).toBe("");
  });
});
