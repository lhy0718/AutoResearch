import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { buildAuditTimeline } from "../src/core/audit/auditTimeline.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("audit timeline", () => {
  it("reconstructs durable event, checkpoint, artifact, and audit timeline entries", async () => {
    const runRoot = await mkdtemp(path.join(os.tmpdir(), "autolabos-audit-timeline-"));
    tempDirs.push(runRoot);
    await mkdir(path.join(runRoot, "checkpoints"), { recursive: true });
    await writeFile(
      path.join(runRoot, "events.jsonl"),
      [
        JSON.stringify({ id: "evt-1", type: "NODE_STARTED", timestamp: "2026-05-05T00:00:00.000Z", runId: "run-1", node: "analyze_results", payload: {} }),
        JSON.stringify({ id: "evt-2", type: "NODE_COMPLETED", timestamp: "2026-05-05T00:01:00.000Z", runId: "run-1", node: "review", payload: {} })
      ].join("\n") + "\n",
      "utf8"
    );
    await writeFile(
      path.join(runRoot, "checkpoints", "0001-review-before.json"),
      JSON.stringify({ seq: 1, runId: "run-1", node: "review", phase: "before", createdAt: "2026-05-05T00:00:30.000Z" }),
      "utf8"
    );

    const timeline = await buildAuditTimeline({
      runRoot,
      resultTableMeasured: true,
      resultTableCompleteRows: 1,
      figureAuditStatus: "pass",
      reviewDecision: "blocked_for_paper_scale",
      claimCeilingAllowedLevel: "research_memo",
      paperReadinessVerdict: "blocked",
      paperReady: false,
      blockers: [{ code: "result_table_missing", severity: "blocker", message: "missing", source: "test" }]
    });

    expect(timeline.status).toBe("available");
    expect(timeline.event_count).toBe(2);
    expect(timeline.checkpoint_count).toBe(1);
    expect(timeline.entries.map((entry) => entry.kind)).toContain("paper_readiness_verdict");
    expect(timeline.entries.map((entry) => entry.kind)).toContain("blocker_detected");
  });

  it("does not fabricate chronology when durable events are missing", async () => {
    const runRoot = await mkdtemp(path.join(os.tmpdir(), "autolabos-audit-timeline-empty-"));
    tempDirs.push(runRoot);

    const timeline = await buildAuditTimeline({
      runRoot,
      resultTableMeasured: false,
      resultTableCompleteRows: 0,
      figureAuditStatus: "unmeasured",
      claimCeilingAllowedLevel: "research_memo",
      paperReadinessVerdict: "needs-review",
      paperReady: false,
      blockers: []
    });

    expect(timeline.status).toBe("timeline_incomplete");
    expect(timeline.measured).toBe(false);
    expect(timeline.entries.some((entry) => entry.source === "artifact")).toBe(true);
  });
});
