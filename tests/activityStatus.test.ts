import { describe, expect, it } from "vitest";

import {
  formatAnalyzeProgressLogLine,
  formatCollectActivityLabel,
  isAnalyzeProgressLog,
  isCollectProgressLog,
  shouldClearAnalyzeProgress,
  shouldClearCollectProgress,
  updateAnalyzeProgressFromLog,
  updateCollectProgressFromLog
} from "../src/tui/activityStatus.js";

describe("activityStatus", () => {
  it("tracks collect target and formats ETA after progress samples", () => {
    let state = updateCollectProgressFromLog(undefined, "Moving to collect_papers with target total 300.", 0);
    state = updateCollectProgressFromLog(state, 'Collected 50 paper(s) so far (50 new) for "topic".', 60_000);
    state = updateCollectProgressFromLog(state, 'Collected 100 paper(s) so far (100 new) for "topic".', 120_000);

    expect(formatCollectActivityLabel(state, 120_000)).toBe("Collecting... 100/300 (ETA ~4m)");
  });

  it("falls back to basic collecting label when progress is unknown", () => {
    expect(formatCollectActivityLabel(undefined)).toBe("Collecting...");
  });

  it("clears collect progress on completion and failure lines", () => {
    expect(shouldClearCollectProgress('Semantic Scholar stored 300 papers for "topic".')).toBe(true);
    expect(shouldClearCollectProgress("collect_papers failed: rate limited")).toBe(true);
    expect(shouldClearCollectProgress("Jumped to collect_papers (safe).")).toBe(true);
    expect(shouldClearCollectProgress("Rolled back to collect_papers from analyze_papers.")).toBe(true);
    expect(shouldClearCollectProgress("Collected 50 paper(s) so far (50 new) for \"topic\".")).toBe(false);
  });

  it("recognizes collect progress log lines", () => {
    expect(isCollectProgressLog("Moving to collect_papers with target total 300.")).toBe(true);
    expect(isCollectProgressLog("Requesting Semantic Scholar batch 1/6.")).toBe(true);
    expect(isCollectProgressLog("Collect batch progress: batch 1/6, processed 10/50, stored 0/300.")).toBe(true);
    expect(isCollectProgressLog("Starting deferred enrichment for 80 paper(s) with concurrency 6.")).toBe(true);
    expect(isCollectProgressLog("Collect enrichment progress: processed 10/80, stored 50/300.")).toBe(true);
    expect(isCollectProgressLog('Collected 50 paper(s) so far (50 new) for "topic".')).toBe(true);
    expect(isCollectProgressLog("Large or filtered collect request detected.")).toBe(false);
  });

  it("shows requested Semantic Scholar batch progress before the first batch resolves", () => {
    let state = updateCollectProgressFromLog(undefined, "Moving to collect_papers with target total 300.", 0);
    state = updateCollectProgressFromLog(state, "Requesting Semantic Scholar batch 1/6.", 5_000);

    expect(formatCollectActivityLabel(state, 5_000)).toBe("Collecting... 0/300 (request 1/6)");
  });

  it("shows in-batch collect progress before the first persisted batch completes", () => {
    let state = updateCollectProgressFromLog(undefined, "Moving to collect_papers with target total 300.", 0);
    state = updateCollectProgressFromLog(state, "Collect batch progress: batch 1/6, processed 10/50, stored 0/300.", 60_000);

    expect(formatCollectActivityLabel(state, 60_000)).toBe("Collecting... 10/300 (batch 10/50, ETA ~29m)");
  });

  it("shows deferred enrichment progress in the collect activity label", () => {
    let state = updateCollectProgressFromLog(undefined, "Moving to collect_papers with target total 300.", 0);
    state = updateCollectProgressFromLog(state, 'Collected 50 paper(s) so far (50 new) for "topic".', 60_000);
    state = updateCollectProgressFromLog(state, "Starting deferred enrichment for 80 paper(s) with concurrency 6.", 61_000);
    expect(formatCollectActivityLabel(state, 61_000)).toBe("Collecting... 50/300 (enrich 0/80, ETA ~5m 5s)");
    state = updateCollectProgressFromLog(state, "Collect enrichment progress: processed 10/80, stored 50/300.", 120_000);

    expect(formatCollectActivityLabel(state, 120_000)).toBe("Collecting... 50/300 (enrich 10/80, ETA ~10m)");
  });

  it("tracks analyze progress and formats ETA after multiple papers", () => {
    let state = updateAnalyzeProgressFromLog(undefined, "Ranking 300 papers and selecting the top 30 for analysis.", 0);
    state = updateAnalyzeProgressFromLog(state, "Preparing LLM rerank for 150 candidate(s) to choose top 30.", 5_000);
    state = updateAnalyzeProgressFromLog(state, 'Analyzing paper 1/30: "Paper 1".', 60_000);
    state = updateAnalyzeProgressFromLog(state, 'Analyzing paper 2/30: "Paper 2".', 120_000);

    expect(formatAnalyzeProgressLogLine(state, 120_000)).toBe("Analyzing... 2/30 (ETA ~28m)");
  });

  it("formats analyze ranking and rerank phases without ETA", () => {
    let state = updateAnalyzeProgressFromLog(undefined, "Ranking 300 papers and selecting the top 30 for analysis.", 0);
    expect(formatAnalyzeProgressLogLine(state, 0)).toBe("Analyzing... ranking candidates for top 30");

    state = updateAnalyzeProgressFromLog(state, "Preparing LLM rerank for 150 candidate(s) to choose top 30.", 5_000);
    expect(formatAnalyzeProgressLogLine(state, 5_000)).toBe("Analyzing... reranking 150 candidates for top 30");
  });

  it("shows staged rerank progress when detailed rerank logs are present", () => {
    let state = updateAnalyzeProgressFromLog(undefined, "Ranking 300 papers and selecting the top 30 for analysis.", 0);
    state = updateAnalyzeProgressFromLog(state, "Preparing LLM rerank for 90 candidate(s) to choose top 30.", 5_000);
    state = updateAnalyzeProgressFromLog(state, "Rerank progress: 2/4 (50%) waiting for model response.", 10_000);

    expect(formatAnalyzeProgressLogLine(state, 10_000)).toBe(
      "Analyzing... reranking 90 candidates for top 30 (50%, waiting for model response)"
    );
    expect(isAnalyzeProgressLog("Rerank progress: 3/4 (75%) parsing model ordering.")).toBe(true);
  });

  it("recognizes and clears analyze progress log lines", () => {
    expect(isAnalyzeProgressLog("Deterministic pre-rank started for 300 paper(s) using title/topic similarity, citation count, and recency.")).toBe(true);
    expect(isAnalyzeProgressLog('Analyzing paper 5/30: "Paper".')).toBe(true);
    expect(isAnalyzeProgressLog("Persisted analysis outputs for \"Paper\" (1 summary row, 4 evidence row(s)).")).toBe(false);

    expect(shouldClearAnalyzeProgress("Analysis totals: summaries=30, evidence=120, full_text=30, abstract_fallback=0.")).toBe(true);
    expect(shouldClearAnalyzeProgress("Node analyze_papers failed: timeout")).toBe(true);
    expect(shouldClearAnalyzeProgress("Jumped to analyze_papers (force).")).toBe(true);
    expect(shouldClearAnalyzeProgress("Rolled back to analyze_papers from generate_hypotheses.")).toBe(true);
    expect(shouldClearAnalyzeProgress('Analyzing paper 5/30: "Paper".')).toBe(false);
  });
});
