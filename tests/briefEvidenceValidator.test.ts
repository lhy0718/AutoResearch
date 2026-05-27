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
      },
      {
        id: "comparison_2",
        label: "candidate vs second baseline",
        source: "metrics.condition_metrics",
        metrics: [],
        hypothesis_supported: true,
        summary: "Candidate also outperformed the second baseline."
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
        condition_comparisons: [
          {
            id: "comparison_1",
            label: "candidate vs baseline",
            source: "metrics.condition_metrics",
            metrics: [],
            hypothesis_supported: true,
            summary: "Only one executed baseline comparison is available."
          }
        ] as AnalysisReport["condition_comparisons"],
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

  it("does not fail the brief gate solely for documented low-severity scope limitations", () => {
    const assessment = evaluateBriefEvidenceAgainstResults({
      briefSections: makeBriefSections(),
      report: makeReport({
        failure_taxonomy: [
          {
            id: "scope_limit",
            category: "scope_limit",
            severity: "low",
            status: "risk",
            summary: "Scope limitation: optional decomposed adapter variant was documented but not required.",
            evidence: ["plan_context.selected_design.risks"],
            recommended_action: "Document the limitation explicitly."
          }
        ] as AnalysisReport["failure_taxonomy"]
      })
    });

    expect(assessment.enabled).toBe(true);
    expect(assessment.status).toBe("pass");
    expect(assessment.actual.scope_limit_count).toBe(0);
    expect(assessment.failures).toHaveLength(0);
  });

  it("fails when the brief requires all planned conditions but execution covers only a subset", () => {
    const assessment = evaluateBriefEvidenceAgainstResults({
      briefSections: makeBriefSections({
        minimumAcceptableEvidence:
          "All planned conditions must execute successfully and report bootstrap confidence intervals.",
        minimumExperimentPlan:
          "Execute one named tuned baseline run and three alternative recipe conditions."
      }),
      report: makeReport({
        plan_context: {
          selected_design: {
            baselines: ["locked_adapter"],
            implementation_notes: [
              "Planned tuned conditions: locked Standard adapter; adapter all-linear; adapter q_k_v_o; rank-stabilized adapter q_v."
            ],
            evaluation_steps: [],
            metrics: [],
            resource_notes: [],
            risks: []
          }
        } as AnalysisReport["plan_context"],
        metrics: {
          conditions: [
            { name: "base_unmodified" },
            { name: "adapter_r8" },
            { name: "adapter_r16" }
          ]
        }
      })
    });

    expect(assessment.enabled).toBe(true);
    expect(assessment.status).toBe("fail");
    expect(assessment.requirements.minimum_condition_count).toBe(4);
    expect(assessment.actual.executed_condition_count).toBe(2);
    expect(assessment.failures).toContain("Executed evidence covers all planned conditions");
  });
});
