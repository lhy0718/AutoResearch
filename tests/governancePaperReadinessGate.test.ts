import { describe, expect, it } from "vitest";

import { evaluateMinimumGate, type MinimumGateInput } from "../src/core/analysis/paperMinimumGate.js";
import type { AnalysisReport } from "../src/core/resultAnalysis.js";
import type { ReviewArtifactPresence } from "../src/core/reviewSystem.js";

function completePresence(overrides: Partial<ReviewArtifactPresence> = {}): ReviewArtifactPresence {
  return {
    corpusPresent: true,
    paperSummariesPresent: true,
    evidenceStorePresent: true,
    hypothesesPresent: true,
    experimentPlanPresent: true,
    metricsPresent: true,
    figurePresent: true,
    synthesisPresent: true,
    baselineSummaryPresent: true,
    resultTablePresent: true,
    richnessSummaryPresent: true,
    richnessReadiness: "adequate",
    ...overrides
  };
}

function completeReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    overview: {
      objective_status: "met",
      objective_summary: "Objective met on the benchmark task.",
      execution_runs: 3
    },
    condition_comparisons: [
      {
        id: "baseline-vs-method",
        label: "baseline vs method",
        source: "metrics.comparison",
        metrics: [],
        hypothesis_supported: true,
        summary: "Method compared against baseline."
      }
    ],
    primary_findings: [
      {
        id: "finding-1",
        title: "Measured comparison",
        finding: "The method has measured task results.",
        confidence: 0.8,
        source: "result_analysis"
      }
    ],
    paper_claims: [
      {
        claim: "The method improves the objective metric on the task.",
        evidence: [{ type: "metric", reference: "result_table.json", detail: "delta reported" }]
      }
    ],
    results_table: [
      {
        metric: "accuracy",
        baseline: 0.7,
        comparator: 0.75,
        delta: 0.05,
        direction: "higher_better"
      }
    ],
    limitations: [],
    warnings: [],
    statistical_summary: {
      total_trials: 3,
      executed_trials: 3,
      cached_trials: 0,
      confidence_intervals: [],
      stability_metrics: [],
      effect_estimates: [],
      notes: []
    },
    shortlisted_designs: [],
    recommendations: [],
    ...overrides
  } as AnalysisReport;
}

function inputFor(overrides: Partial<MinimumGateInput> = {}): MinimumGateInput {
  return {
    presence: completePresence(),
    report: completeReport(),
    topic: "Governance paper-readiness gate fixture",
    objectiveMetric: "accuracy",
    ...overrides
  };
}

describe("governance paper-readiness gate", () => {
  it.each([
    {
      taskId: "AGB-001",
      input: inputFor({
        presence: completePresence({ baselineSummaryPresent: false }),
        report: completeReport({ condition_comparisons: [] })
      }),
      failedCheck: "baseline_or_comparator"
    },
    {
      taskId: "AGB-002",
      input: inputFor({
        presence: completePresence({ evidenceStorePresent: false })
      }),
      failedCheck: "claim_evidence_linkage"
    },
    {
      taskId: "AGB-003",
      input: inputFor({
        report: completeReport({
          results_table: [
            {
              metric: "accuracy",
              baseline: null,
              comparator: 0.75,
              delta: null,
              direction: "higher_better"
            }
          ]
        })
      }),
      failedCheck: "results_table_schema"
    },
    {
      taskId: "AGB-009",
      input: inputFor({
        presence: completePresence({ metricsPresent: false })
      }),
      failedCheck: "executed_result"
    },
    {
      taskId: "AGB-010",
      input: inputFor({
        presence: completePresence({ hypothesesPresent: false }),
        report: completeReport({ primary_findings: [] })
      }),
      failedCheck: "not_smoke_only"
    }
  ])("$taskId cannot pass as paper-ready while its intended evidence gap remains", ({ input, failedCheck }) => {
    const result = evaluateMinimumGate(input);

    expect(result.passed).toBe(false);
    expect(result.ceiling_type).not.toBe("unrestricted");
    expect(result.failed_checks).toContain(failedCheck);
  });
});
