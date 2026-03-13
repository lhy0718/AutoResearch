import { describe, expect, it } from "vitest";

import {
  buildHeuristicObjectiveMetricProfile,
  evaluateObjectiveMetric,
  normalizeObjectiveMetricProfile
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
});
