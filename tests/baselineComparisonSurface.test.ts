import { describe, expect, it } from "vitest";

import { buildBaselineComparisonSurface } from "../src/core/baselineComparisonSurface.js";
import { buildAnalysisReport } from "../src/core/resultAnalysis.js";
import type { BaselineLock } from "../src/core/exploration/types.js";

function makeReport() {
  return buildAnalysisReport({
    run: {
      objectiveMetric: "Improve mean zero-shot accuracy over the locked adapter baseline."
    },
    metrics: {
      result_rows: [
        {
          condition_id: "locked_adapter_baseline_r8",
          recipe_type: "locked_baseline",
          is_locked_adapter_baseline: true,
          mean_zero_shot_accuracy: 0.3044
        },
        {
          condition_id: "adapter_r16_attention_mlp",
          recipe_type: "candidate",
          mean_zero_shot_accuracy: 0.3135
        }
      ]
    },
    objectiveProfile: {
      source: "llm",
      raw: "Improve mean zero-shot accuracy over the locked adapter baseline.",
      primaryMetric: "mean_zero_shot_accuracy",
      preferredMetricKeys: ["mean_zero_shot_accuracy"],
      comparator: ">=",
      targetValue: 0.01,
      targetDescription: "Accuracy should improve by at least one point.",
      analysisFocus: [],
      paperEmphasis: [],
      assumptions: []
    },
    objectiveEvaluation: {
      rawObjectiveMetric: "Improve mean zero-shot accuracy over the locked adapter baseline.",
      profileSource: "llm",
      primaryMetric: "mean_zero_shot_accuracy",
      preferredMetricKeys: ["mean_zero_shot_accuracy"],
      matchedMetricKey: "mean_zero_shot_accuracy",
      comparator: ">=",
      targetValue: 0.01,
      observedValue: 0.3135,
      status: "not_met",
      summary: "Objective metric not met."
    }
  });
}

function makeLock(): BaselineLock {
  return {
    locked_at: "2026-04-07T00:00:00.000Z",
    run_id: "run-1",
    baseline_hash: "baseline-hash",
    dataset_slice_hash: "dataset-hash",
    evaluator_hash: "evaluator-hash",
    seed_policy: "fixed-seed",
    environment_fingerprint: "node|linux|timestamp",
    allowed_intervention_dimensions: ["model"],
    forbidden_concurrent_changes: [["model", "dataset"]]
  };
}

describe("baselineComparisonSurface", () => {
  it("projects analysis condition comparisons into a distinct baseline comparison surface", () => {
    const surface = buildBaselineComparisonSurface({
      runId: "run-1",
      report: makeReport(),
      baselineLock: makeLock(),
      generatedAt: "2026-04-07T00:00:00.000Z"
    });

    expect(surface.status).toBe("available");
    expect(surface.primary_comparison).toMatchObject({
      id: "adapter_r16_attention_mlp_vs_locked_adapter_baseline_r8",
      source: "metrics.result_rows"
    });
    expect(surface.primary_comparison?.metrics).toEqual([
      {
        metric: "mean_zero_shot_accuracy",
        baseline_value: 0.3044,
        comparator_value: 0.3135,
        delta: 0.0091,
        direction: "higher_better"
      }
    ]);
    expect(surface.enforcement).toMatchObject({
      baseline_lock_present: true,
      single_change_dimension_limit: 1,
      allowed_intervention_dimensions: ["model"],
      forbidden_concurrent_changes: [["model", "dataset"]],
      lock_fingerprints: {
        baseline_hash: "baseline-hash",
        dataset_slice_hash: "dataset-hash",
        evaluator_hash: "evaluator-hash",
        seed_policy: "fixed-seed"
      }
    });
    expect(surface.warnings).toEqual([]);
  });

  it("reports a missing surface without inventing baseline evidence", () => {
    const report = makeReport();
    report.condition_comparisons = [];

    const surface = buildBaselineComparisonSurface({
      runId: "run-2",
      report,
      baselineLock: null
    });

    expect(surface.status).toBe("missing");
    expect(surface.primary_comparison).toBeNull();
    expect(surface.comparisons).toEqual([]);
    expect(surface.enforcement.baseline_lock_present).toBe(false);
    expect(surface.warnings.join(" ")).toContain("No baseline/comparator comparison");
    expect(surface.warnings.join(" ")).toContain("No BaselineLock artifact");
  });
});
