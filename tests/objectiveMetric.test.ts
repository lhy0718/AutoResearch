import { describe, expect, it } from "vitest";

import {
  buildHeuristicObjectiveMetricProfile,
  evaluateObjectiveMetric,
  normalizeObjectiveMetricProfile,
  synthesizeRelativeMetrics
} from "../src/core/objectiveMetric.js";

describe("objectiveMetric", () => {
  it("derives thresholded accuracy objectives heuristically", () => {
    const profile = buildHeuristicObjectiveMetricProfile("accuracy at least 0.9");

    expect(profile.primaryMetric).toBe("accuracy");
    expect(profile.preferredMetricKeys).toContain("accuracy");
    expect(profile.direction).toBe("maximize");
    expect(profile.comparator).toBe(">=");
    expect(profile.targetValue).toBe(0.9);
  });

  it("evaluates observed metrics against the resolved profile", () => {
    const profile = buildHeuristicObjectiveMetricProfile("latency under 200");
    const evaluation = evaluateObjectiveMetric(
      {
        latency_ms: 180,
        accuracy: 0.92
      },
      profile,
      "latency under 200"
    );

    expect(evaluation.status).toBe("met");
    expect(evaluation.matchedMetricKey).toBe("latency_ms");
    expect(evaluation.summary).toContain("latency_ms=180");
    expect(evaluation.summary).toContain("< 200");
  });

  it("reports missing metrics when the preferred key is absent", () => {
    const profile = buildHeuristicObjectiveMetricProfile("f1 at least 0.8");
    const evaluation = evaluateObjectiveMetric(
      {
        accuracy: 0.91
      },
      profile,
      "f1 at least 0.8"
    );

    expect(evaluation.status).toBe("missing");
    expect(evaluation.summary).toContain("was not found");
  });

  it("infers the sole numeric metric when the objective is otherwise generic", () => {
    const profile = buildHeuristicObjectiveMetricProfile("overall improvement");
    const evaluation = evaluateObjectiveMetric(
      {
        accuracy: 0.91
      },
      profile,
      "overall improvement"
    );

    expect(evaluation.status).toBe("observed");
    expect(evaluation.matchedMetricKey).toBe("accuracy");
    expect(evaluation.summary).toContain('sole numeric metric "accuracy"');
  });

  it("treats baseline-improvement objectives as met when the delta is positive", () => {
    const profile = buildHeuristicObjectiveMetricProfile(
      "Improve macro-F1 over a logistic regression baseline while preserving reproducible CPU-only local execution."
    );
    const evaluation = evaluateObjectiveMetric(
      {
        macro_f1_delta_vs_logreg: 0.0123,
        best_mean_test_macro_f1: 0.94,
        reproducible: true,
        cpu_only: true
      },
      profile,
      "Improve macro-F1 over a logistic regression baseline while preserving reproducible CPU-only local execution."
    );

    expect(profile.preferredMetricKeys).toContain("macro_f1_delta_vs_logreg");
    expect(profile.comparator).toBe(">");
    expect(profile.targetValue).toBe(0);
    expect(evaluation.status).toBe("met");
    expect(evaluation.matchedMetricKey).toBe("macro_f1_delta_vs_logreg");
    expect(evaluation.summary).toContain("macro_f1_delta_vs_logreg=0.0123");
    expect(evaluation.summary).toContain("> 0");
    expect(evaluation.summary).toContain("CPU-only requirement satisfied");
    expect(evaluation.summary).toContain("Reproducibility requirement satisfied");
  });

  it("keeps baseline-delta semantics even when an llm profile proposes the raw metric first", () => {
    const profile = normalizeObjectiveMetricProfile(
      {
        source: "llm",
        primaryMetric: "macro_f1",
        preferredMetricKeys: ["macro_f1", "test_macro_f1"],
        direction: "maximize",
        comparator: ">",
        targetValue: 0,
        targetDescription: "> 0"
      },
      "Improve macro-F1 over a logistic regression baseline while preserving reproducible CPU-only local execution."
    );

    expect(profile.primaryMetric).toBe("macro_f1_delta_vs_logreg");
    expect(profile.preferredMetricKeys[0]).toBe("macro_f1_delta_vs_logreg");
    expect(profile.comparator).toBe(">");
    expect(profile.targetValue).toBe(0);
    expect(profile.targetDescription).toContain("logistic regression baseline");
  });

  // ---------- LV-014 regression tests ----------

  it("parses accuracy-points-over-baseline as a relative delta target (LV-014)", () => {
    const objective =
      "Primary metric: accuracy (pass@1). Meaningful improvement: at least +1.5 accuracy points over single-pass baseline.";
    const profile = buildHeuristicObjectiveMetricProfile(objective);

    expect(profile.primaryMetric).toBe("accuracy_delta_vs_baseline");
    expect(profile.preferredMetricKeys).toContain("accuracy_delta_vs_baseline");
    expect(profile.preferredMetricKeys).toContain("accuracy_pass_at_1_delta_vs_baseline");
    expect(profile.direction).toBe("maximize");
    expect(profile.comparator).toBe(">=");
    expect(profile.targetValue).toBe(0.015);
  });

  it("evaluates relative accuracy delta from conditions array (LV-014)", () => {
    const objective =
      "at least +1.5 accuracy points over single-pass baseline";
    const profile = buildHeuristicObjectiveMetricProfile(objective);
    const evaluation = evaluateObjectiveMetric(
      {
        primary_metric: "accuracy_pass_at_1",
        conditions: [
          { name: "single_pass_baseline", accuracy_pass_at_1: 0.22 },
          { name: "always_two_pass_baseline", accuracy_pass_at_1: 0.01 },
          { name: "uncertainty_gated@0.10", accuracy_pass_at_1: 0.25 }
        ],
        best_condition: { accuracy_pass_at_1: 0.25 }
      },
      profile,
      objective
    );

    expect(evaluation.status).toBe("met");
    expect(evaluation.matchedMetricKey).toBe("accuracy_pass_at_1_delta_vs_baseline");
    expect(evaluation.observedValue).toBe(0.03);
    expect(evaluation.targetValue).toBe(0.015);
    expect(evaluation.summary).toContain("met");
  });

  it("reports not_met when delta is below threshold (LV-014)", () => {
    const objective =
      "at least +5 accuracy points over single-pass baseline";
    const profile = buildHeuristicObjectiveMetricProfile(objective);
    const evaluation = evaluateObjectiveMetric(
      {
        conditions: [
          { name: "single_pass_baseline", accuracy_pass_at_1: 0.22 },
          { name: "adaptive", accuracy_pass_at_1: 0.24 }
        ]
      },
      profile,
      objective
    );

    expect(evaluation.status).toBe("not_met");
    expect(evaluation.observedValue).toBeCloseTo(0.02, 10);
    expect(evaluation.targetValue).toBe(0.05);
  });

  it("synthesizes delta metrics from conditions array", () => {
    const enriched = synthesizeRelativeMetrics({
      conditions: [
        { name: "single_pass_baseline", accuracy_pass_at_1: 0.22, f1: 0.30 },
        { name: "adaptive", accuracy_pass_at_1: 0.25, f1: 0.35 }
      ]
    });

    expect(enriched.accuracy_pass_at_1_delta_vs_baseline).toBe(0.03);
    expect(enriched.accuracy_pass_at_1_improvement_over_baseline).toBe(0.03);
    expect(enriched.f1_delta_vs_baseline).toBeCloseTo(0.05, 10);
  });

  it("applies plausibility guard for impossible absolute targets (LV-014 defense-in-depth)", () => {
    const profile = normalizeObjectiveMetricProfile(
      {
        source: "llm",
        primaryMetric: "accuracy_pass_at_1",
        preferredMetricKeys: ["accuracy_pass_at_1"],
        direction: "maximize",
        comparator: ">=",
        targetValue: 1.5
      },
      "accuracy at least 1.5 over baseline"
    );
    const evaluation = evaluateObjectiveMetric(
      { accuracy_pass_at_1: 0.22 },
      profile,
      "accuracy at least 1.5 over baseline"
    );

    expect(evaluation.targetValue).toBe(0.015);
    expect(evaluation.status).toBe("met");
  });

  it("handles general accuracy + baseline without logistic regression", () => {
    const objective = "Improve accuracy over baseline by a significant margin";
    const profile = buildHeuristicObjectiveMetricProfile(objective);

    expect(profile.primaryMetric).toBe("accuracy_delta_vs_baseline");
    expect(profile.direction).toBe("maximize");
    expect(profile.comparator).toBe(">");
    expect(profile.targetValue).toBe(0);
  });

  it("overrides LLM profile with relative-baseline semantics when applicable (LV-014)", () => {
    const objective =
      "at least +1.5 accuracy points over single-pass baseline";
    const profile = normalizeObjectiveMetricProfile(
      {
        source: "llm",
        primaryMetric: "accuracy_pass_at_1",
        preferredMetricKeys: ["accuracy_pass_at_1", "acc"],
        direction: "maximize",
        comparator: ">=",
        targetValue: 1.5
      },
      objective
    );

    expect(profile.primaryMetric).toBe("accuracy_delta_vs_baseline");
    expect(profile.comparator).toBe(">=");
    expect(profile.targetValue).toBe(0.015);
    expect(profile.preferredMetricKeys).toContain("accuracy_delta_vs_baseline");
  });

  // ---------- LV-018 regression tests ----------

  it("matches primary_metric nested object instead of unrelated secondary metric (LV-018)", () => {
    const objective =
      "Primary metric: accuracy (or pass@1) on reasoning benchmarks. Meaningful improvement: at least +2 accuracy points over the strongest fixed-budget baseline.";
    const profile = buildHeuristicObjectiveMetricProfile(objective);

    // Simulate the real metrics.json structure from the experiment
    const evaluation = evaluateObjectiveMetric(
      {
        primary_metric: {
          met: false,
          name: "accuracy_delta_vs_baseline",
          target: 0.02,
          value: -0.24305555555555555
        },
        baseline_metrics: { accuracy: 0.4375, mean_generated_tokens: 221.0, mean_latency_ms: 2296 },
        routed_metrics: { accuracy: 0.1944, mean_generated_tokens: 339.0, mean_latency_ms: 3518 },
        secondary_metrics: {
          budget_normalized_accuracy_delta: -0.0014,
          latency_delta_ms: 1222.23,
          mean_generated_tokens_delta_vs_baseline: 117.53
        }
      },
      profile,
      objective
    );

    // Must match accuracy_delta_vs_baseline (from primary_metric.value), NOT the token delta
    expect(evaluation.matchedMetricKey).toBe("accuracy_delta_vs_baseline");
    expect(evaluation.observedValue).toBeCloseTo(-0.243, 2);
    expect(evaluation.status).toBe("not_met");
    expect(evaluation.summary).toContain("not met");
  });

  it("synthesizes delta from baseline_metrics + routed_metrics structure", () => {
    const enriched = synthesizeRelativeMetrics({
      baseline_metrics: { accuracy: 0.4375, f1: 0.50 },
      routed_metrics: { accuracy: 0.1944, f1: 0.30 }
    });

    expect(enriched.accuracy_delta_vs_baseline).toBeCloseTo(0.1944 - 0.4375, 10);
    expect(enriched.f1_delta_vs_baseline).toBeCloseTo(0.30 - 0.50, 10);
  });
});
