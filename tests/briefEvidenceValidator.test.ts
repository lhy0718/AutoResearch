import { describe, expect, it } from "vitest";

import { evaluateBriefEvidenceAgainstResults } from "../src/core/analysis/briefEvidenceValidator.js";
import type { AnalysisReport } from "../src/core/resultAnalysis.js";
import type { MarkdownRunBriefSections } from "../src/core/runs/runBriefParser.js";

function makeReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    overview: {
      objective_status: "met",
      objective_summary: "Objective met",
      execution_runs: 3
    },
    plan_context: {
      selected_design: {
        baselines: ["baseline_a", "baseline_b"]
      }
    },
    condition_comparisons: [
      {
        id: "comparison_1",
        label: "candidate vs baseline",
        source: "metrics.condition_metrics",
        metrics: [],
        hypothesis_supported: true,
        summary: "Candidate outperformed the baseline."
      }
    ],
    failure_taxonomy: [],
    statistical_summary: {
      total_trials: 3,
      executed_trials: 3,
      cached_trials: 0,
      confidence_intervals: [
        {
          metric_key: "accuracy",
          label: "Accuracy 95% CI",
          lower: 0.89,
          upper: 0.93,
          level: 0.95,
          sample_size: 3,
          source: "metrics",
          summary: "Accuracy remained above the threshold."
        }
      ],
      stability_metrics: [],
      effect_estimates: [],
      notes: ["95% CI reported for the primary metric."]
    },
    ...overrides
  } as unknown as AnalysisReport;
}

function makeBriefSections(
  overrides: Partial<MarkdownRunBriefSections> = {}
): MarkdownRunBriefSections {
  return {
    title: "Research Brief",
    baselineComparator: "Compare against two baselines.",
    targetComparison: "Evaluate the proposal against two baselines on accuracy.",
    minimumAcceptableEvidence: "Run at least 3 trials and report confidence intervals.",
    minimumExperimentPlan: "Execute 3 trials for the proposed method and each baseline.",
    paperWorthinessGate: "Only advance with confidence intervals and matched-baseline coverage.",
    paperCeiling: "Cap weak evidence at research_memo.",
    ...overrides
  };
}

describe("briefEvidenceValidator", () => {
  it("skips validation when no brief governance is present", () => {
    const assessment = evaluateBriefEvidenceAgainstResults({
      briefSections: undefined,
      report: makeReport()
    });

    expect(assessment.enabled).toBe(false);
    expect(assessment.status).toBe("not_applicable");
    expect(assessment.checks).toHaveLength(0);
  });

  it("fails when executed evidence falls below the brief floor", () => {
    const assessment = evaluateBriefEvidenceAgainstResults({
      briefSections: makeBriefSections(),
      report: makeReport({
        plan_context: {
          selected_design: {
            baselines: ["baseline_a"]
          }
        } as AnalysisReport["plan_context"]["selected_design"],
        failure_taxonomy: [
          {
            id: "gap_1",
            category: "evidence_gap",
            status: "fail",
            summary: "Only one run completed."
          }
        ] as AnalysisReport["failure_taxonomy"],
        statistical_summary: {
          total_trials: 1,
          executed_trials: 1,
          cached_trials: 0,
          confidence_intervals: [],
          stability_metrics: [],
          effect_estimates: [],
          notes: []
        } as AnalysisReport["statistical_summary"]
      })
    });

    expect(assessment.enabled).toBe(true);
    expect(assessment.status).toBe("fail");
    expect(assessment.recommended_action).toBe("backtrack_to_design");
    expect(assessment.failures).toContain("Executed evidence includes the required baseline coverage");
    expect(assessment.failures).toContain("Executed evidence meets the brief run/fold floor");
    expect(assessment.failures).toContain(
      "Confidence intervals are present when the brief asks for statistical support"
    );
  });

  it("passes when results satisfy the brief contract", () => {
    const assessment = evaluateBriefEvidenceAgainstResults({
      briefSections: makeBriefSections(),
      report: makeReport()
    });

    expect(assessment.enabled).toBe(true);
    expect(assessment.status).toBe("pass");
    expect(assessment.failures).toHaveLength(0);
    expect(assessment.requirements.minimum_baseline_count).toBe(2);
    expect(assessment.requirements.minimum_runs_or_folds).toBe(3);
  });
});
