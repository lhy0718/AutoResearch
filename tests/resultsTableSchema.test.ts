import { describe, expect, it } from "vitest";

import { buildResultsTableSchema } from "../src/core/analysis/resultsTableSchema.js";

describe("resultsTableSchema", () => {
  it("marks audit defect metrics as lower-better while preserving objective metric direction", () => {
    const rows = buildResultsTableSchema(
      [
        "Primary audit metric: claim-table mismatch rate",
        "Incorrect positive claim count and rate",
        "Hidden failed-or-incomplete-condition count and rate",
        "Downgrade correctness count and rate",
        "accuracy_delta_vs_baseline"
      ],
      "higher_better"
    );

    expect(rows).toEqual([
      expect.objectContaining({ metric: "Incorrect positive claim count and rate", direction: "lower_better" }),
      expect.objectContaining({ metric: "Hidden failed-or-incomplete-condition count and rate", direction: "lower_better" }),
      expect.objectContaining({ metric: "Downgrade correctness count and rate", direction: "higher_better" }),
      expect.objectContaining({ metric: "accuracy_delta_vs_baseline", direction: "higher_better" })
    ]);
    expect(rows.map((row) => row.metric)).not.toContain("Primary audit metric: claim-table mismatch rate");
  });

  it("excludes prose metric descriptions that cannot be populated as result-table keys", () => {
    const rows = buildResultsTableSchema(
      [
        "Primary metric within each model: avg_accuracy and delta_avg_accuracy_vs_model_baseline_pp",
        "Per-task accuracy with raw correct/total counts for ARC-Challenge and HellaSwag",
        "accuracy_delta_vs_baseline",
        "average_accuracy"
      ],
      "higher_better"
    );

    expect(rows.map((row) => row.metric)).toEqual([
      "accuracy_delta_vs_baseline",
      "average_accuracy"
    ]);
  });
});
