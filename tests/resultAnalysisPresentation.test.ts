import { describe, expect, it } from "vitest";

import { buildAnalyzeResultsInsightCard } from "../src/core/resultAnalysisPresentation.js";

describe("resultAnalysisPresentation", () => {
  it("surfaces recommendation explanation and automation actions", () => {
    const card = buildAnalyzeResultsInsightCard({
      overview: {
        objective_status: "not_met",
        objective_summary: "Objective metric not met under the current setup."
      },
      failure_taxonomy: [
        {
          id: "objective_not_met",
          category: "objective_gap",
          severity: "high",
          status: "observed",
          summary: "The primary target was missed.",
          evidence: ["objective_metric.evaluation.summary"]
        }
      ],
      transition_recommendation: {
        action: "backtrack_to_hypotheses",
        sourceNode: "analyze_results",
        targetNode: "generate_hypotheses",
        reason: "The shortlisted hypothesis is not supported, so the idea set should be revisited.",
        confidence: 0.91,
        autoExecutable: true,
        evidence: ["Current experiment outcomes do not support the shortlisted hypothesis."],
        suggestedCommands: ["/agent jump generate_hypotheses", "/agent run generate_hypotheses"],
        generatedAt: new Date().toISOString()
      },
      synthesis: {
        source: "llm",
        discussion_points: ["The current setup fails to support the intended claim."],
        failure_analysis: ["Objective not met."],
        follow_up_actions: ["Revisit the hypothesis set before designing the next experiment."],
        confidence_statement: "Confidence is moderate because the hypothesis is directly contradicted by the reported comparison."
      },
      condition_comparisons: [
        {
          id: "treatment_vs_baseline",
          label: "Treatment vs baseline",
          source: "metrics.comparison",
          hypothesis_supported: false,
          summary: "The treatment underperformed the baseline on accuracy.",
          metrics: [
            {
              key: "accuracy",
              value: -0.03,
              primary_value: 0.74,
              baseline_value: 0.77
            }
          ]
        }
      ],
      statistical_summary: {
        total_trials: 3,
        executed_trials: 3,
        cached_trials: 0,
        confidence_intervals: [
          {
            metric_key: "accuracy",
            label: "Accuracy 95% CI",
            lower: 0.71,
            upper: 0.76,
            level: 0.95,
            source: "metrics",
            summary: "The 95% confidence interval remained below the target threshold."
          }
        ],
        stability_metrics: [],
        effect_estimates: [
          {
            comparison_id: "treatment_vs_baseline",
            metric_key: "accuracy",
            delta: -0.03,
            direction: "negative",
            summary: "The treatment lost 0.03 accuracy versus baseline."
          }
        ],
        notes: ["Variance was low, so the negative delta appears stable."]
      },
      figure_specs: [
        {
          id: "performance_overview",
          title: "Performance overview",
          path: "figures/performance.svg",
          metric_keys: ["accuracy", "f1"],
          summary: "Accuracy dropped in the treatment condition."
        }
      ],
      primary_findings: ["The treatment underperformed on the primary objective metric."],
      limitations: ["Only one confirmatory configuration was executed."],
      warnings: [],
      mean_score: 0.74
    } as any);

    expect(card.lines.some((line) => line.includes("Recommendation: backtrack_to_hypotheses"))).toBe(true);
    expect(card.lines.some((line) => line.startsWith("Why:"))).toBe(true);
    expect(card.lines.some((line) => line.startsWith("Evidence:"))).toBe(true);
    expect(card.actions?.map((item) => item.command)).toEqual(["/agent apply", "/agent overnight"]);
    expect(card.references?.find((item) => item.kind === "comparison")?.details).toEqual(
      expect.arrayContaining([
        "Hypothesis support: not supported by this comparison.",
        "accuracy: primary 0.74 vs baseline 0.77 (-0.03)."
      ])
    );
    expect(card.references?.find((item) => item.kind === "statistics")?.details).toEqual(
      expect.arrayContaining([
        "Effect direction: negative for accuracy.",
        "The 95% confidence interval remained below the target threshold."
      ])
    );
  });

  it("falls back safely for partial legacy analysis reports", () => {
    const card = buildAnalyzeResultsInsightCard({
      primary_findings: ["Legacy analysis artifact without overview fields."]
    } as any);

    expect(card.title).toBe("Result analysis");
    expect(card.lines[0]).toContain("Objective: unknown");
    expect(card.lines[0]).toContain("Legacy analysis artifact without overview fields.");
  });
});
