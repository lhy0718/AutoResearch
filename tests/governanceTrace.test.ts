import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { appendGovernanceTrace, readGovernanceTrace } from "../src/governance/governanceTrace.js";

describe("governance trace", () => {
  it("appends and reads a trace entry", () => {
    const traceDir = mkdtempSync(path.join(os.tmpdir(), "autolabos-governance-trace-"));
    const entry = {
      timestamp: "2026-04-02T00:00:00.000Z",
      runId: "run-1",
      node: "collect_papers",
      inputSummary: "summary",
      screeningResult: "blocked" as const,
      triggeredRules: ["prompt_injection"],
      decision: "hard_stop" as const,
      matchedSlotId: "evidence_intake",
      detail: "blocked for prompt injection"
    };

    appendGovernanceTrace(entry, traceDir);
    expect(readGovernanceTrace(traceDir, "2026-04-02")).toEqual([entry]);
  });

  it("returns an empty array when the date file is missing", () => {
    const traceDir = mkdtempSync(path.join(os.tmpdir(), "autolabos-governance-trace-missing-"));
    expect(readGovernanceTrace(traceDir, "2026-04-03")).toEqual([]);
  });

  it("preserves multiple appended entries", () => {
    const traceDir = mkdtempSync(path.join(os.tmpdir(), "autolabos-governance-trace-multi-"));
    appendGovernanceTrace(
      {
        timestamp: "2026-04-02T00:00:00.000Z",
        runId: "run-1",
        node: "collect_papers",
        inputSummary: "one",
        screeningResult: "suspicious_but_usable",
        triggeredRules: ["untrusted_source"],
        decision: "allow_with_trace",
        matchedSlotId: "evidence_intake",
        detail: "warn"
      },
      traceDir
    );
    appendGovernanceTrace(
      {
        timestamp: "2026-04-02T00:01:00.000Z",
        runId: "run-1",
        node: "collect_papers",
        inputSummary: "two",
        screeningResult: "blocked",
        triggeredRules: ["prompt_injection"],
        decision: "hard_stop",
        matchedSlotId: "evidence_intake",
        detail: "blocked"
      },
      traceDir
    );

    const entries = readGovernanceTrace(traceDir, "2026-04-02");
    expect(entries).toHaveLength(2);
    expect(entries[0].inputSummary).toBe("one");
    expect(entries[1].inputSummary).toBe("two");
  });
});
