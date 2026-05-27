import { describe, expect, it } from "vitest";

import { runDesignExperimentsPanel } from "../src/core/designExperimentsPanel.js";
import type { ExperimentDesignCandidate } from "../src/core/analysis/researchPlanning.js";
import type { ObjectiveMetricProfile } from "../src/core/objectiveMetric.js";

function candidate(overrides: Partial<ExperimentDesignCandidate>): ExperimentDesignCandidate {
  return {
    id: "candidate",
    title: "Candidate",
    hypothesis_ids: ["h1"],
    plan_summary: "Compare the intervention against a baseline.",
    datasets: ["benchmark_task_a"],
    metrics: ["accuracy_delta_vs_baseline"],
    baselines: ["baseline_condition"],
    implementation_notes: ["Run the planned experiment."],
    evaluation_steps: ["Report the objective metric with uncertainty."],
    risks: ["Small local budget."],
    resource_notes: ["Bounded local execution."],
    ...overrides
  };
}

const accuracyObjective: ObjectiveMetricProfile = {
  source: "heuristic_fallback",
  raw: "accuracy_delta_vs_baseline >= 0.01",
  primaryMetric: "accuracy_delta_vs_baseline",
  preferredMetricKeys: ["accuracy_delta_vs_baseline"],
  direction: "maximize",
  analysisFocus: [],
  paperEmphasis: [],
  assumptions: []
};

describe("designExperimentsPanel", () => {
  it("blocks reporting-integrity audits that drift away from a model-quality objective", () => {
    const modelQuality = candidate({
      id: "model_quality",
      title: "Staged full factorial condition-parameter experiment",
      metrics: ["accuracy_delta_vs_baseline", "avg_accuracy_ci_low", "avg_accuracy_ci_high"]
    });
    const reportingAudit = candidate({
      id: "reporting_audit",
      title: "Ungated-vs-gated reporting integrity audit",
      plan_summary: "Freeze training outputs and audit report gating, claim downgrades, and mismatch visibility.",
      metrics: [
        "Primary audit metric: claim-table mismatch rate",
        "Incorrect positive claim count and rate",
        "accuracy_delta_vs_baseline"
      ]
    });

    const result = runDesignExperimentsPanel({
      candidates: [reportingAudit, modelQuality],
      objectiveProfile: accuracyObjective,
      managedBundleSupported: false
    });

    expect(result.selected.id).toBe("model_quality");
    const auditScore = result.selection.scores.find((score) => score.candidate_id === "reporting_audit");
    expect(auditScore?.blocked_by).toContain("statistical_reviewer");
    expect(
      result.reviews.find(
        (review) => review.candidate_id === "reporting_audit" && review.reviewer_id === "statistical_reviewer"
      )?.summary
    ).toContain("drifts from the objective");
  });

  it("blocks report-gating audits that explicitly say they are not model-quality experiments", () => {
    const modelQuality = candidate({
      id: "model_quality",
      title: "Adaptive two-stage condition-parameter confirmation",
      plan_summary: "Screen the full condition-parameter grid and confirm top cells with held-out seeds.",
      metrics: ["accuracy_delta_vs_baseline", "average_accuracy", "avg_accuracy_ci_low"]
    });
    const reportGateAudit = candidate({
      id: "report_gate_audit",
      title: "Paired report-gating audit on identical run outputs",
      plan_summary:
        "This is a reporting-quality experiment, not a model-quality experiment, and it targets claim mismatches and downgrade correctness.",
      metrics: [
        "Primary integrity metric: claim_table_mismatch_count",
        "False-positive metric: incorrect_positive_claim_count",
        "accuracy_delta_vs_baseline"
      ],
      evaluation_steps: [
        "Compare gated and ungated reports on identical artifacts.",
        "This design does not answer the model-quality hypothesis."
      ]
    });

    const result = runDesignExperimentsPanel({
      candidates: [reportGateAudit, modelQuality],
      objectiveProfile: accuracyObjective,
      managedBundleSupported: false
    });

    expect(result.selected.id).toBe("model_quality");
    expect(
      result.selection.scores.find((score) => score.candidate_id === "report_gate_audit")?.blocked_by
    ).toContain("statistical_reviewer");
  });

  it("blocks report-gating audits even when they consume condition-parameter training outputs", () => {
    const audit = candidate({
      id: "audit",
      title: "A/B audit of result-gating on identical run outputs",
      plan_summary:
        "Test whether a pre-registered claim gate improves report integrity without changing model outcomes.",
      metrics: [
        "claim_table_mismatch_count and mismatch_rate",
        "unsupported_positive_claim_count",
        "hidden_failed_or_incomplete_condition_count",
        "accuracy_delta_vs_baseline"
      ],
      evaluation_steps: [
        "Produce at least one completed source training batch covering the 8 rank x dropout conditions with real metrics.",
        "Construct audit packets from those outputs without inventing new accuracy values."
      ]
    });
    const factorial = candidate({
      id: "factorial",
      title: "Staged full 4x2 factorial with promotion gate to paper-ready evidence",
      plan_summary: "Run the complete rank x dropout design under a staged evidence plan.",
      metrics: ["Primary: avg_accuracy and delta_avg_accuracy_vs_baseline_pp", "benchmark_task_a_accuracy"]
    });

    const result = runDesignExperimentsPanel({
      candidates: [audit, factorial],
      objectiveProfile: accuracyObjective,
      managedBundleSupported: false
    });

    expect(result.selected.id).toBe("factorial");
    expect(result.selection.scores.find((score) => score.candidate_id === "audit")?.blocked_by).toContain(
      "statistical_reviewer"
    );
  });
});
