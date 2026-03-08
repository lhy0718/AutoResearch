import { describe, expect, it } from "vitest";

import {
  formatCollectActivityLabel,
  shouldClearCollectProgress,
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
    expect(shouldClearCollectProgress("Collected 50 paper(s) so far (50 new) for \"topic\".")).toBe(false);
  });
});
