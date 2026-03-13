import { describe, expect, it } from "vitest";

import { buildAnalysisReport } from "../src/core/resultAnalysis.js";

describe("resultAnalysis", () => {
  it("extracts a preset runtime guardrail from the experiment plan and removes the stale threshold warning", () => {
    const report = buildAnalysisReport({
      run: {
        objectiveMetric: "Improve macro-F1 over a logistic regression baseline."
      },
      metrics: {
        value: 0.02,
        condition_metrics: {
          nested: {
            macro_f1_delta_vs_logreg: 0.02,
            runtime_seconds_mean: 11.0
          },
          non_nested: {
            macro_f1_delta_vs_logreg: 0.01,
            runtime_seconds_mean: 10.0
          }
        }
      },
      objectiveProfile: {
        source: "heuristic_fallback",
        raw: "Improve macro-F1 over a logistic regression baseline.",
        primaryMetric: "macro_f1_delta_vs_logreg",
        preferredMetricKeys: ["macro_f1_delta_vs_logreg", "value"],
        comparator: ">",
        targetValue: 0,
        targetDescription: "Macro-F1 should improve over logistic regression.",
        analysisFocus: [],
        paperEmphasis: [],
        assumptions: []
      },
      objectiveEvaluation: {
        rawObjectiveMetric: "Improve macro-F1 over a logistic regression baseline.",
        profileSource: "heuristic_fallback",
        primaryMetric: "macro_f1_delta_vs_logreg",
        preferredMetricKeys: ["macro_f1_delta_vs_logreg", "value"],
        matchedMetricKey: "value",
        comparator: ">",
        targetValue: 0,
        observedValue: 0.02,
        status: "met",
        summary: "Objective metric met: value=0.02 > 0."
      },
      experimentPlanRaw: `
selected_design:
  title: "Variance Reduction"
  evaluation_steps:
    - "Declare support only if median runtime does not increase beyond a predefined practical threshold such as 25 percent."
  risks:
    - "A practical threshold on runtime increase must be specified before analysis to avoid post hoc interpretation."
`
    });

    expect(report.plan_context.selected_design?.runtime_guardrail_pct).toBe(25);
    expect(
      report.limitations.some((line) => /must be specified before analysis/u.test(line))
    ).toBe(false);
    expect(
      report.primary_findings.some((line) => line.includes("runtime-increase guardrail of 25"))
    ).toBe(true);
  });
});
