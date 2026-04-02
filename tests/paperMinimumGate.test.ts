import { describe, it, expect } from "vitest";
import {
  evaluateMinimumGate,
  type MinimumGateInput
} from "../src/core/analysis/paperMinimumGate.js";
import type { ReviewArtifactPresence } from "../src/core/reviewSystem.js";
import type { AnalysisReport } from "../src/core/resultAnalysis.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fullPresence(): ReviewArtifactPresence {
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
    richnessReadiness: true
  };
}

function minimalReport(): AnalysisReport {
  return {
    overview: {
      objective_status: "met",
      objective_summary: "Test objective met",
      execution_runs: 3
    },
    condition_comparisons: [
      {
        id: "c1",
        label: "baseline vs proposed",
        source: "metrics.comparison",
        metrics: [],
        hypothesis_supported: true,
        summary: "Proposed outperformed baseline"
      }
    ],
    primary_findings: [
      {
        id: "f1",
        title: "Main finding",
        finding: "Proposed method is better",
        confidence: 0.9,
        source: "analysis"
      }
    ],
    paper_claims: [
      {
        claim: "Our method improves accuracy",
        evidence: [{ type: "metric", reference: "accuracy", detail: "+5%" }]
      }
    ],
    results_table: [
      {
        metric: "accuracy",
        baseline: 0.82,
        comparator: 0.87,
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
    recommendations: []
  } as unknown as AnalysisReport;
}

function fullInput(): MinimumGateInput {
  return {
    presence: fullPresence(),
    report: minimalReport(),
    topic: "Test topic",
    objectiveMetric: "accuracy"
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("paperMinimumGate", () => {
  it("passes when all structural prerequisites are met", () => {
    const result = evaluateMinimumGate(fullInput());

    expect(result.passed).toBe(true);
    expect(result.ceiling_type).toBe("unrestricted");
    expect(result.blockers).toHaveLength(0);
    expect(result.checks.every(c => c.passed)).toBe(true);
    expect(result.summary).toContain("passed");
  });

  it("has exactly 9 checks", () => {
    const result = evaluateMinimumGate(fullInput());
    expect(result.checks).toHaveLength(10);
    const checkIds = result.checks.map(c => c.id);
    expect(checkIds).toContain("objective_metric");
    expect(checkIds).toContain("experiment_plan");
    expect(checkIds).toContain("baseline_or_comparator");
    expect(checkIds).toContain("executed_result");
    expect(checkIds).toContain("evidence_depth");
    expect(checkIds).toContain("result_artifacts");
    expect(checkIds).toContain("claim_evidence_linkage");
    expect(checkIds).toContain("claim_evidence_missing");
    expect(checkIds).toContain("results_table_schema");
    expect(checkIds).toContain("not_smoke_only");
  });

  it("blocks when objective metric is missing", () => {
    const input = fullInput();
    input.objectiveMetric = "";
    const result = evaluateMinimumGate(input);

    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("Objective metric identified");
    // Missing objective + not_smoke_only (needs objective) => system_validation_note ceiling
    expect(["system_validation_note", "blocked_for_paper_scale"]).toContain(result.ceiling_type);
  });

  it("blocks when no experiment plan exists", () => {
    const input = fullInput();
    input.presence.experimentPlanPresent = false;
    const result = evaluateMinimumGate(input);

    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("Experiment plan exists (task/dataset grounding)");
  });

  it("blocks when no baseline/comparator exists", () => {
    const input = fullInput();
    input.presence.baselineSummaryPresent = false;
    (input.report as AnalysisReport).condition_comparisons = [];
    const result = evaluateMinimumGate(input);

    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("Baseline or comparator is explicit");
  });

  it("blocks when no executed result (metrics) exists", () => {
    const input = fullInput();
    input.presence.metricsPresent = false;
    const result = evaluateMinimumGate(input);

    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("Executed comparison result exists");
  });

  it("blocks when no result table exists", () => {
    const input = fullInput();
    input.presence.resultTablePresent = false;
    const result = evaluateMinimumGate(input);

    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("Key result artifacts present");
    expect(result.ceiling_type).toBe("research_memo");
  });

  it("blocks when no claim-evidence linkage exists", () => {
    const input = fullInput();
    input.presence.evidenceStorePresent = false;
    const result = evaluateMinimumGate(input);

    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("Claim→evidence linkage present");
  });

  it("passes the new claim-evidence artifact check when paper artifacts are grounded", () => {
    const input = fullInput();
    input.evidenceLinksArtifact = {
      claims: [
        {
          claim_id: "c1",
          statement: "Our method improves accuracy",
          evidence_ids: ["ev_1"],
          citation_paper_ids: ["paper_1"]
        }
      ]
    };
    input.claimEvidenceTableArtifact = {
      claims: [
        {
          claim_id: "c1",
          artifact_refs: ["ev_1"],
          citation_refs: ["paper_1"]
        }
      ]
    };

    const result = evaluateMinimumGate(input);

    expect(result.passed).toBe(true);
    expect(result.failed_checks).toEqual([]);
    expect(result.checks.find((check) => check.id === "claim_evidence_missing")?.passed).toBe(true);
  });

  it("fails the new claim-evidence artifact check when claim evidence arrays are empty", () => {
    const input = fullInput();
    input.evidenceLinksArtifact = {
      claims: [
        {
          claim_id: "c1",
          statement: "Our method improves accuracy",
          evidence_ids: ["ev_1"]
        }
      ]
    };
    input.claimEvidenceTableArtifact = {
      claims: [
        {
          claim_id: "c1",
          artifact_refs: [],
          citation_refs: []
        }
      ]
    };

    const result = evaluateMinimumGate(input);

    expect(result.passed).toBe(false);
    expect(result.failed_checks).toContain("claim_evidence_missing");
    expect(result.checks.find((check) => check.id === "claim_evidence_missing")?.passed).toBe(false);
  });

  it("fails when no results_table row includes both baseline and comparator values", () => {
    const input = fullInput();
    input.report.results_table = [
      {
        metric: "accuracy",
        baseline: null,
        comparator: 0.87,
        delta: null,
        direction: "higher_better"
      }
    ];

    const result = evaluateMinimumGate(input);

    expect(result.passed).toBe(false);
    expect(result.failed_checks).toContain("results_table_schema");
  });

  it("assigns blocked_for_paper_scale when many checks fail", () => {
    const input: MinimumGateInput = {
      presence: {
        corpusPresent: false,
        paperSummariesPresent: false,
        evidenceStorePresent: false,
        hypothesesPresent: false,
        experimentPlanPresent: false,
        metricsPresent: false,
        figurePresent: false,
        synthesisPresent: false,
        baselineSummaryPresent: false,
        resultTablePresent: false,
        richnessSummaryPresent: false,
        richnessReadiness: false
      },
      report: {
        overview: { objective_status: "not_met", objective_summary: "", execution_runs: 0 },
        condition_comparisons: [],
        primary_findings: [],
        paper_claims: [],
        limitations: [],
        warnings: [],
        shortlisted_designs: [],
        recommendations: []
      } as unknown as AnalysisReport,
      topic: "Test",
      objectiveMetric: ""
    };

    const result = evaluateMinimumGate(input);
    expect(result.passed).toBe(false);
    expect(result.ceiling_type).toBe("blocked_for_paper_scale");
    expect(result.blockers.length).toBeGreaterThanOrEqual(4);
  });

  it("assigns research_memo when minor gaps exist", () => {
    const input = fullInput();
    // Remove result table only — everything else passes
    input.presence.resultTablePresent = false;
    const result = evaluateMinimumGate(input);

    expect(result.passed).toBe(false);
    expect(result.ceiling_type).toBe("research_memo");
  });

  it("assigns research_memo when evidence stays at a single thin run without robustness support", () => {
    const input = fullInput();
    (input.report as AnalysisReport).overview.execution_runs = 1;
    (input.report as AnalysisReport).statistical_summary = {
      total_trials: 1,
      executed_trials: 1,
      cached_trials: 0,
      confidence_intervals: [],
      stability_metrics: [],
      effect_estimates: [],
      notes: []
    } as AnalysisReport["statistical_summary"];

    const result = evaluateMinimumGate(input);

    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("Evidence goes beyond a single thin run");
    expect(result.ceiling_type).toBe("research_memo");
  });

  it("includes ISO timestamp in evaluated_at", () => {
    const result = evaluateMinimumGate(fullInput());
    expect(result.evaluated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("accepts condition comparisons as baseline substitute", () => {
    const input = fullInput();
    input.presence.baselineSummaryPresent = false;
    // Still has condition_comparisons from report
    const result = evaluateMinimumGate(input);
    const baselineCheck = result.checks.find(c => c.id === "baseline_or_comparator");
    expect(baselineCheck?.passed).toBe(true);
  });
});
