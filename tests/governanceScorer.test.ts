import { describe, expect, it } from "vitest";

import { scoreGovernanceTask, scoreGovernanceTasks } from "../src/core/benchmark/governanceScorer.js";

describe("governance scorer", () => {
  it("computes task-level metrics for claim discipline and evidence linkage", () => {
    const score = scoreGovernanceTask({
      task_id: "AGB-001",
      paper_ready: false,
      expected_paper_ready: false,
      unsupported_claim_count: 0,
      major_claim_count: 4,
      supported_claim_count: 3,
      missing_required_artifact_count: 0,
      repair_action_count: 1
    });

    expect(score.measured).toBe(true);
    expect(score.total_score).toBeGreaterThan(0);
    expect(score.metrics).toMatchObject({
      false_paper_ready: false,
      unsupported_claim_count: 0,
      claim_to_evidence_coverage: 0.75
    });
  });

  it("surfaces false paper-ready and missing-baseline pass failures in summary metrics", () => {
    const summary = scoreGovernanceTasks([
      {
        task_id: "AGB-001",
        paper_ready: true,
        expected_paper_ready: false,
        unsupported_claim_count: 2,
        major_claim_count: 2,
        supported_claim_count: 1,
        missing_required_artifact_count: 3,
        missing_baseline_detected: true,
        missing_baseline_passed: true,
        figure_result_mismatch_count: 1
      },
      {
        task_id: "AGB-002",
        paper_ready: false,
        expected_paper_ready: false,
        unsupported_claim_count: 0,
        major_claim_count: 1,
        supported_claim_count: 1,
        missing_required_artifact_count: 0,
        missing_baseline_detected: true,
        missing_baseline_passed: false,
        figure_result_mismatch_count: 0
      }
    ]);

    expect(summary.measured_task_count).toBe(2);
    expect(summary.metrics.false_paper_ready_rate).toBe(0.5);
    expect(summary.metrics.unsupported_claim_count).toBe(2);
    expect(summary.metrics.missing_baseline_pass_rate).toBe(0.5);
    expect(summary.metrics.figure_result_mismatch_rate).toBe(0.5);
  });

  it("does not report placeholder values as measured results", () => {
    const summary = scoreGovernanceTasks([
      {
        task_id: "AGB-placeholder",
        paper_ready: true,
        unsupported_claim_count: 99,
        placeholder: true
      }
    ]);

    expect(summary.measured_task_count).toBe(0);
    expect(summary.skipped_placeholder_count).toBe(1);
    expect(summary.average_score).toBeNull();
    expect(summary.metrics.false_paper_ready_rate).toBeNull();
    expect(summary.metrics.unsupported_claim_count).toBe(0);
    expect(summary.tasks[0]).toMatchObject({
      measured: false,
      total_score: null,
      metrics: null,
      skipped_reason: "placeholder_not_measured"
    });
  });
});
