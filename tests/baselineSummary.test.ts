import { describe, it, expect } from "vitest";

describe("buildBaselineSummary", () => {
  it("extracts baselines from selected design", async () => {
    const mod = await import("../src/core/nodes/designExperiments.js");
    const result = mod.buildBaselineSummary({
      selected: {
        id: "d1",
        title: "Adaptive TTC",
        hypothesis_ids: ["h1"],
        baselines: ["single-pass", "fixed-extended"],
        plan_summary: "Test adaptive allocation",
        metrics: ["accuracy"],
        datasets: [],
        implementation_notes: [],
        evaluation_steps: [],
        risks: [],
        resource_notes: []
      },
      comparisonContract: {} as any,
      experimentContract: {
        expected_metric_effect: "Improve accuracy over baselines"
      } as any,
      objectiveMetric: "accuracy"
    });

    expect(result.baseline_conditions).toHaveLength(2);
    expect(result.baseline_conditions[0].name).toBe("single-pass");
    expect(result.baseline_conditions[1].name).toBe("fixed-extended");
    expect(result.treatment_conditions).toHaveLength(1);
    expect(result.treatment_conditions[0].name).toBe("Adaptive TTC");
    expect(result.comparison_metric).toBe("accuracy");
    expect(result.justification).toBe("Improve accuracy over baselines");
  });

  it("handles missing baselines gracefully", async () => {
    const mod = await import("../src/core/nodes/designExperiments.js");
    const result = mod.buildBaselineSummary({
      selected: {
        id: "d2",
        title: "Some Design",
        hypothesis_ids: ["h2"],
        baselines: [],
        plan_summary: "Test something",
        metrics: ["f1"],
        datasets: [],
        implementation_notes: [],
        evaluation_steps: [],
        risks: [],
        resource_notes: []
      },
      comparisonContract: {} as any,
      experimentContract: {} as any,
      objectiveMetric: "f1_score"
    });

    expect(result.baseline_conditions).toHaveLength(1);
    expect(result.baseline_conditions[0].name).toBe("(no explicit baseline)");
    expect(result.comparison_metric).toBe("f1_score");
    expect(result.justification).toContain("f1_score");
  });
});
