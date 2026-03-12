import { describe, expect, it } from "vitest";

import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { AutoLabOSEvent } from "../src/core/events.js";
import { RunRecord } from "../src/types.js";
import { applyEventToRunProjection, normalizeRunForDisplay, resolveFailedNode } from "../src/tui/runProjection.js";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  const now = new Date().toISOString();
  const graph = overrides.graph ?? createDefaultGraphState();
  const currentNode = overrides.currentNode ?? graph.currentNode;
  return {
    version: 3,
    workflowVersion: 3,
    id: overrides.id ?? "run-1",
    title: overrides.title ?? "Test run",
    topic: overrides.topic ?? "topic",
    constraints: overrides.constraints ?? [],
    objectiveMetric: overrides.objectiveMetric ?? "metric",
    status: overrides.status ?? "pending",
    currentNode,
    latestSummary: overrides.latestSummary,
    nodeThreads: overrides.nodeThreads ?? {},
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    graph,
    memoryRefs: overrides.memoryRefs ?? {
      runContextPath: ".autolabos/runs/run-1/memory/run_context.json",
      longTermPath: ".autolabos/runs/run-1/memory/long_term.jsonl",
      episodePath: ".autolabos/runs/run-1/memory/episodes.jsonl"
    }
  };
}

function makeEvent(overrides: Partial<AutoLabOSEvent>): AutoLabOSEvent {
  return {
    id: overrides.id ?? "evt-1",
    type: overrides.type ?? "NODE_STARTED",
    timestamp: overrides.timestamp ?? "2026-03-12T07:00:00.000Z",
    runId: overrides.runId ?? "run-1",
    node: overrides.node,
    agentRole: overrides.agentRole,
    payload: overrides.payload ?? {}
  };
}

describe("runProjection", () => {
  it("projects jump and start events onto the current run immediately", () => {
    const run = makeRun({
      status: "failed",
      currentNode: "generate_hypotheses"
    });
    run.graph.currentNode = "generate_hypotheses";
    run.graph.nodeStates.generate_hypotheses.status = "failed";
    run.graph.nodeStates.generate_hypotheses.updatedAt = "2026-03-12T06:59:13.286Z";

    const jumped = applyEventToRunProjection(
      run,
      makeEvent({
        type: "NODE_JUMP",
        node: "collect_papers",
        payload: { mode: "safe", reason: "collect command" }
      })
    );
    expect(jumped.currentNode).toBe("collect_papers");
    expect(jumped.graph.currentNode).toBe("collect_papers");
    expect(jumped.status).toBe("paused");
    expect(jumped.graph.nodeStates.collect_papers.status).toBe("pending");

    const started = applyEventToRunProjection(
      jumped,
      makeEvent({
        type: "NODE_STARTED",
        node: "collect_papers",
        timestamp: "2026-03-12T07:00:01.000Z"
      })
    );
    expect(started.currentNode).toBe("collect_papers");
    expect(started.status).toBe("running");
    expect(started.graph.nodeStates.collect_papers.status).toBe("running");
  });

  it("normalizes stale failed snapshots to the latest running recovery node", () => {
    const run = makeRun({
      status: "failed",
      currentNode: "generate_hypotheses"
    });
    run.graph.currentNode = "generate_hypotheses";
    run.graph.nodeStates.generate_hypotheses.status = "failed";
    run.graph.nodeStates.generate_hypotheses.updatedAt = "2026-03-12T06:59:13.286Z";
    run.graph.nodeStates.analyze_papers.status = "running";
    run.graph.nodeStates.analyze_papers.updatedAt = "2026-03-12T06:59:20.000Z";

    const normalized = normalizeRunForDisplay(run);
    expect(normalized.currentNode).toBe("analyze_papers");
    expect(normalized.graph.currentNode).toBe("analyze_papers");
    expect(normalized.status).toBe("running");
  });

  it("resolves the actual failed node from the latest failed state", () => {
    const run = makeRun({
      status: "failed",
      currentNode: "analyze_papers"
    });
    run.graph.nodeStates.analyze_papers.status = "running";
    run.graph.nodeStates.analyze_papers.updatedAt = "2026-03-12T07:00:30.000Z";
    run.graph.nodeStates.generate_hypotheses.status = "failed";
    run.graph.nodeStates.generate_hypotheses.updatedAt = "2026-03-12T07:00:10.000Z";

    expect(resolveFailedNode(run)).toBe("generate_hypotheses");
  });
});
