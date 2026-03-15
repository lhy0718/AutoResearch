import { describe, it, expect } from "vitest";
import { deriveConditionMetricsFromAOCS, parseOuterFoldProtocol } from "../src/core/nodes/analyzeResults.js";
import { evaluateObjectiveMetric } from "../src/core/objectiveMetric.js";

describe("deriveConditionMetricsFromAOCS", () => {
  it("converts aggregate_overall_condition_summary to condition_metrics", () => {
    const aocs = [
      {
        model_family: "xgboost",
        calibration: "raw",
        macro_f1_mean: 0.72,
        brier_score_mean: 0.08,
        ece_adaptive_mean: 0.06,
        outer_fold_count: 24
      },
      {
        model_family: "logistic_regression",
        calibration: "raw",
        macro_f1_mean: 0.65,
        brier_score_mean: 0.12,
        ece_adaptive_mean: 0.14,
        outer_fold_count: 24
      },
      {
        model_family: "rbf_svm",
        calibration: "isotonic",
        macro_f1_mean: 0.66,
        brier_score_mean: 0.08,
        ece_adaptive_mean: 0.03,
        outer_fold_count: 24
      }
    ];

    const result = deriveConditionMetricsFromAOCS(aocs);

    // Should produce 3 condition entries
    expect(Object.keys(result.conditionMetrics)).toHaveLength(3);
    expect(result.conditionMetrics).toHaveProperty("xgboost_raw");
    expect(result.conditionMetrics).toHaveProperty("logistic_regression_raw");
    expect(result.conditionMetrics).toHaveProperty("rbf_svm_isotonic");

    // _mean suffix should be stripped
    expect(result.conditionMetrics["xgboost_raw"]).toHaveProperty("macro_f1", 0.72);
    expect(result.conditionMetrics["xgboost_raw"]).toHaveProperty("brier_score", 0.08);

    // outer_fold_count should be excluded
    expect(result.conditionMetrics["xgboost_raw"]).not.toHaveProperty("outer_fold_count");

    // Primary should be best macro_f1, baseline should be worst
    expect(result.primaryCondition).toBe("xgboost_raw");
    expect(result.baselineCondition).toBe("logistic_regression_raw");
  });

  it("returns empty when aocs is empty", () => {
    const result = deriveConditionMetricsFromAOCS([]);
    expect(Object.keys(result.conditionMetrics)).toHaveLength(0);
    expect(result.primaryCondition).toBeUndefined();
  });

  it("handles entries without calibration field", () => {
    const aocs = [
      { model_family: "xgboost", macro_f1_mean: 0.8 },
      { model_family: "logreg", macro_f1_mean: 0.6 }
    ];
    const result = deriveConditionMetricsFromAOCS(aocs);
    expect(Object.keys(result.conditionMetrics)).toHaveLength(2);
    expect(result.conditionMetrics).toHaveProperty("xgboost");
    expect(result.conditionMetrics).toHaveProperty("logreg");
  });
});

describe("AOCS top-level metric surfacing for objective evaluation", () => {
  it("evaluateObjectiveMetric finds macro_f1 when AOCS-derived top-level exists", () => {
    // Simulate metrics AFTER deriveConditionMetricsFromAOCSIfNeeded:
    // - rank_reversal_count exists as top-level
    // - macro_f1 is surfaced from primary condition
    const metrics: Record<string, unknown> = {
      rank_reversal_count: 2,
      beneficial_count: 4,
      macro_f1: 0.7179,  // surfaced from AOCS primary condition
      brier_score: 0.0817,
      condition_metrics: {
        xgboost_raw: { macro_f1: 0.7179, brier_score: 0.0817 },
        logistic_regression_raw: { macro_f1: 0.65, brier_score: 0.12 }
      }
    };

    const profile = {
      source: "llm" as const,
      raw: "macro-F1",
      primaryMetric: "macro-F1",
      preferredMetricKeys: ["macro_f1", "brier_score", "rank_reversal_count"],
      direction: "maximize" as const,
      assumptions: []
    };

    const result = evaluateObjectiveMetric(metrics, profile, "macro-F1");

    // Should match macro_f1 (index 0 in preferredKeys), NOT rank_reversal_count (index 2)
    expect(result.matchedMetricKey).toBe("macro_f1");
    expect(result.observedValue).toBe(0.7179);
    expect(result.status).toBe("observed");
  });

  it("falls back to rank_reversal_count when no macro_f1 top-level exists", () => {
    const metrics: Record<string, unknown> = {
      rank_reversal_count: 2,
      beneficial_count: 4
    };

    const profile = {
      source: "llm" as const,
      raw: "macro-F1",
      primaryMetric: "macro-F1",
      preferredMetricKeys: ["macro_f1", "rank_reversal_count"],
      direction: "maximize" as const,
      assumptions: []
    };

    const result = evaluateObjectiveMetric(metrics, profile, "macro-F1");

    // Without top-level macro_f1, should fall back to rank_reversal_count
    expect(result.matchedMetricKey).toBe("rank_reversal_count");
  });
});

describe("parseDatasetSummaryCsv", () => {
  // Import must be after the module is loaded since it lives in the same file
  let parseDatasetSummaryCsv: typeof import("../src/core/nodes/analyzeResults.js")["parseDatasetSummaryCsv"];

  it("loads the exported function", async () => {
    const mod = await import("../src/core/nodes/analyzeResults.js");
    parseDatasetSummaryCsv = mod.parseDatasetSummaryCsv;
    expect(typeof parseDatasetSummaryCsv).toBe("function");
  });

  it("parses a minimal 2-dataset CSV into per-dataset model summaries", async () => {
    const mod = await import("../src/core/nodes/analyzeResults.js");
    parseDatasetSummaryCsv = mod.parseDatasetSummaryCsv;

    const csv = [
      "dataset,model_family,calibration,macro_f1_mean,macro_f1_std,brier_score_mean,runtime_seconds_mean,peak_memory_mb_mean",
      "kc1,logistic_regression,raw,0.634,0.024,0.178,0.034,173.6",
      "kc1,xgboost,raw,0.648,0.035,0.133,0.280,189.4",
      "kc1,xgboost,isotonic,0.617,0.044,0.108,0.280,189.4",
      "oil_spill,logistic_regression,raw,0.712,0.055,0.041,0.036,173.5",
      "oil_spill,xgboost,raw,0.715,0.044,0.032,0.313,186.6"
    ].join("\n");

    const result = parseDatasetSummaryCsv(csv);
    expect(result).toBeDefined();
    expect(result!.length).toBe(2);

    const kc1 = result!.find((d) => d.dataset === "kc1") as Record<string, unknown>;
    expect(kc1).toBeDefined();
    const kc1Models = kc1.models as Record<string, Record<string, number>>;
    expect(Object.keys(kc1Models)).toEqual(
      expect.arrayContaining(["logistic_regression_raw", "xgboost_raw", "xgboost_isotonic"])
    );

    // Check aliases are created
    expect(kc1Models.xgboost_raw.macro_f1).toBe(0.648);
    expect(kc1Models.xgboost_raw.runtime_seconds).toBe(0.28);
    expect(kc1Models.xgboost_raw.peak_memory_mb).toBe(189.4);
    expect(kc1Models.xgboost_raw.brier_score).toBe(0.133);

    // Check delta vs logistic_regression_raw
    expect(kc1Models.logistic_regression_raw.macro_f1_delta_vs_logreg).toBeCloseTo(0, 5);
    expect(kc1Models.xgboost_raw.macro_f1_delta_vs_logreg).toBeCloseTo(0.014, 3);
  });

  it("returns undefined for empty CSV", async () => {
    const mod = await import("../src/core/nodes/analyzeResults.js");
    const result = mod.parseDatasetSummaryCsv("dataset,model_family,calibration\n");
    expect(result).toBeUndefined();
  });

  it("returns undefined for header-only CSV", async () => {
    const mod = await import("../src/core/nodes/analyzeResults.js");
    const result = mod.parseDatasetSummaryCsv("dataset,model_family,calibration");
    expect(result).toBeUndefined();
  });

  it("handles 'model' column name and threshold_protocol", async () => {
    const mod = await import("../src/core/nodes/analyzeResults.js");

    const csv = [
      "dataset,model,calibration,threshold_protocol,macro_f1_mean,brier_score_mean",
      "blood,logistic_regression,raw,fixed,0.615,0.156",
      "blood,logistic_regression,raw,tuned,0.655,0.156",
      "blood,rbf_svm,sigmoid,fixed,0.700,0.120",
    ].join("\n");

    const result = mod.parseDatasetSummaryCsv(csv);
    expect(result).toBeDefined();
    expect(result!.length).toBe(1);

    const blood = result![0] as Record<string, unknown>;
    const models = blood.models as Record<string, Record<string, number>>;
    expect(Object.keys(models)).toEqual(
      expect.arrayContaining([
        "logistic_regression_raw_fixed",
        "logistic_regression_raw_tuned",
        "rbf_svm_sigmoid_fixed"
      ])
    );
    expect(models.logistic_regression_raw_fixed.macro_f1).toBe(0.615);
    expect(models.rbf_svm_sigmoid_fixed.macro_f1).toBe(0.700);
    // Delta vs baseline: logistic_regression_raw_fixed is selected as baseline
    expect(models.rbf_svm_sigmoid_fixed.macro_f1_delta_vs_logreg).toBeCloseTo(0.085, 3);
  });
});

describe("parseOuterFoldProtocol", () => {
  it("derives repeats, folds, seeds, datasets, and models from outer-fold CSV", () => {
    const csv = [
      "dataset,repeat_index,outer_fold,outer_seed,model,calibration,macro_f1",
      "iris,1,1,11,logistic_regression,raw,0.85",
      "iris,1,2,11,logistic_regression,raw,0.82",
      "iris,2,1,22,logistic_regression,raw,0.84",
      "iris,2,2,22,logistic_regression,raw,0.81",
      "iris,3,1,33,logistic_regression,raw,0.83",
      "iris,3,2,33,logistic_regression,raw,0.80",
      "wine,1,1,11,rbf_svm,sigmoid,0.75",
      "wine,2,1,22,rbf_svm,sigmoid,0.77",
      "wine,3,1,33,rbf_svm,sigmoid,0.76"
    ].join("\n");

    const protocol = parseOuterFoldProtocol(csv);
    expect(protocol).toBeDefined();
    expect(protocol!.repeats).toBe(3);
    expect(protocol!.outer_folds).toBe(2);
    expect(protocol!.seed_schedule).toEqual([11, 22, 33]);
    expect(protocol!.datasets).toEqual(["iris", "wine"]);
    expect(protocol!.models).toEqual(["logistic_regression", "rbf_svm"]);
  });

  it("returns undefined for CSV without repeat_index or outer_fold columns", () => {
    const csv = "dataset,model,macro_f1\niris,lr,0.85";
    expect(parseOuterFoldProtocol(csv)).toBeUndefined();
  });

  it("returns undefined for empty CSV", () => {
    expect(parseOuterFoldProtocol("")).toBeUndefined();
    expect(parseOuterFoldProtocol("dataset,repeat_index\n")).toBeUndefined();
  });
});
