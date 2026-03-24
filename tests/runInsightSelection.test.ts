import { describe, expect, it } from "vitest";

import {
  shouldSurfaceAnalyzeResultsInsight,
  shouldSurfaceReviewInsight
} from "../src/core/runInsightSelection.js";

describe("runInsightSelection", () => {
  it("hides analyze-results insight before analyze_results", () => {
    expect(shouldSurfaceAnalyzeResultsInsight("collect_papers")).toBe(false);
    expect(shouldSurfaceAnalyzeResultsInsight("analyze_papers")).toBe(false);
    expect(shouldSurfaceAnalyzeResultsInsight("design_experiments")).toBe(false);
  });

  it("surfaces analyze-results insight at analyze_results and later nodes", () => {
    expect(shouldSurfaceAnalyzeResultsInsight("analyze_results")).toBe(true);
    expect(shouldSurfaceAnalyzeResultsInsight("review")).toBe(true);
    expect(shouldSurfaceAnalyzeResultsInsight("write_paper")).toBe(true);
  });

  it("only surfaces review insight during review and write_paper", () => {
    expect(shouldSurfaceReviewInsight("analyze_results")).toBe(false);
    expect(shouldSurfaceReviewInsight("review")).toBe(true);
    expect(shouldSurfaceReviewInsight("write_paper")).toBe(true);
  });
});
