import { describe, expect, it } from "vitest";

import { scoreResultTableArtifact } from "../src/core/benchmark/resultTableScoring.js";

describe("result table scoring", () => {
  it("scores complete baseline/comparator rows as claim-supporting evidence", () => {
    const score = scoreResultTableArtifact([
      {
        metric: "accuracy",
        baseline: 0.7,
        comparator: 0.75,
        delta: 0.05,
        direction: "higher_better"
      }
    ]);

    expect(score).toMatchObject({
      measured: true,
      valid_schema: true,
      row_count: 1,
      complete_row_count: 1,
      comparator_coverage: 1,
      superiority_claim_supported: true
    });
    expect(score.issues).toEqual([]);
  });

  it("keeps missing comparator and metric values explicit", () => {
    const score = scoreResultTableArtifact([
      {
        metric: "accuracy",
        baseline: 0.7,
        comparator: null,
        delta: null,
        direction: "higher_better"
      },
      {
        metric: "",
        baseline: null,
        comparator: 0.4,
        delta: null,
        direction: "lower_better"
      }
    ]);

    expect(score.valid_schema).toBe(false);
    expect(score.complete_row_count).toBe(0);
    expect(score.missing_metric_count).toBe(1);
    expect(score.missing_baseline_count).toBe(1);
    expect(score.missing_comparator_count).toBe(1);
    expect(score.missing_delta_count).toBe(2);
    expect(score.superiority_claim_supported).toBe(false);
    expect(score.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "result_table_metric_missing",
        "result_table_baseline_missing",
        "result_table_comparator_missing",
        "result_table_delta_missing"
      ])
    );
  });

  it("does not treat malformed non-array artifacts as measured results", () => {
    const score = scoreResultTableArtifact({ rows: [] });

    expect(score.measured).toBe(false);
    expect(score.valid_schema).toBe(false);
    expect(score.comparator_coverage).toBeNull();
    expect(score.superiority_claim_supported).toBe(false);
  });

  it("scores runtime comparison-summary artifacts as measured but incomplete", () => {
    const score = scoreResultTableArtifact({
      conditions: [
        {
          name: "rank_32_dropout_0_05_vs_rank_8_dropout_0_0",
          metrics: {
            accuracy_delta_vs_baseline_mean: 0.066667
          }
        }
      ],
      comparisons: [
        {
          primary: "rank_32_dropout_0_05_vs_rank_8_dropout_0_0",
          baseline: "metrics.condition_summaries",
          metric: "accuracy_delta_vs_baseline_mean",
          delta: 0.066667,
          hypothesis_supported: true
        }
      ],
      primary_metric: "accuracy_delta_vs_baseline"
    });

    expect(score.measured).toBe(true);
    expect(score.valid_schema).toBe(false);
    expect(score.row_count).toBe(1);
    expect(score.complete_row_count).toBe(0);
    expect(score.missing_baseline_count).toBe(1);
    expect(score.missing_comparator_count).toBe(1);
    expect(score.missing_delta_count).toBe(0);
    expect(score.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "result_table_schema_noncanonical",
        "result_table_baseline_missing",
        "result_table_comparator_missing"
      ])
    );
  });
});
