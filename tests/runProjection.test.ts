import { describe, expect, it } from "vitest";

import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { AutoLabOSEvent } from "../src/core/events.js";
import { RunRecord } from "../src/types.js";
import {
  applyEventToRunProjection,
  mergeProjectedRunState,
  normalizeRunForDisplay,
  projectRunForDisplay,
  resolveFailedNode
} from "../src/tui/runProjection.js";

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

  it("preserves a newer projected recovery state when the refreshed run index is stale", () => {
    const stale = makeRun({
      status: "failed",
      currentNode: "generate_hypotheses",
      updatedAt: "2026-03-12T06:59:13.286Z"
    });
    stale.graph.currentNode = "generate_hypotheses";
    stale.graph.checkpointSeq = 31;
    stale.graph.nodeStates.generate_hypotheses.status = "failed";
    stale.graph.nodeStates.generate_hypotheses.updatedAt = "2026-03-12T06:59:13.286Z";

    const projected = applyEventToRunProjection(
      stale,
      makeEvent({
        type: "NODE_RETRY",
        node: "collect_papers",
        timestamp: "2026-03-12T07:00:01.000Z",
        payload: { attempt: 2 }
      })
    );

    const merged = mergeProjectedRunState(stale, projected);
    expect(merged.currentNode).toBe("collect_papers");
    expect(merged.status).toBe("running");
    expect(merged.graph.nodeStates.collect_papers.status).toBe("running");
    expect(merged.graph.retryCounters.collect_papers).toBe(2);
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

  it("prefers a newer checkpoint snapshot when runs.json lags behind a node transition", () => {
    const stale = makeRun({
      status: "running",
      currentNode: "design_experiments",
      updatedAt: "2026-03-12T10:11:12.151Z"
    });
    stale.graph.currentNode = "design_experiments";
    stale.graph.checkpointSeq = 15;
    stale.graph.nodeStates.design_experiments.status = "running";
    stale.graph.nodeStates.design_experiments.updatedAt = "2026-03-12T10:11:12.151Z";

    const checkpointSnapshot = makeRun({
      status: "running",
      currentNode: "implement_experiments",
      updatedAt: "2026-03-12T10:12:37.354Z"
    });
    checkpointSnapshot.graph.currentNode = "implement_experiments";
    checkpointSnapshot.graph.checkpointSeq = 17;
    checkpointSnapshot.graph.nodeStates.design_experiments.status = "completed";
    checkpointSnapshot.graph.nodeStates.design_experiments.updatedAt = "2026-03-12T10:12:30.000Z";
    checkpointSnapshot.graph.nodeStates.implement_experiments.status = "running";
    checkpointSnapshot.graph.nodeStates.implement_experiments.updatedAt = "2026-03-12T10:12:37.354Z";

    const normalized = normalizeRunForDisplay(stale, {
      checkpoint: {
        seq: 17,
        phase: "before",
        createdAt: "2026-03-12T10:12:37.354Z",
        snapshot: checkpointSnapshot
      }
    });

    expect(normalized.currentNode).toBe("implement_experiments");
    expect(normalized.graph.currentNode).toBe("implement_experiments");
    expect(normalized.status).toBe("running");
  });

  it("does not treat rollback recovery notes as upstream blockers", () => {
    const run = makeRun({
      status: "running",
      currentNode: "design_experiments"
    });
    run.graph.currentNode = "design_experiments";
    run.graph.nodeStates.design_experiments.status = "running";
    run.graph.nodeStates.design_experiments.note =
      "Auto rollback from implement_experiments after 4/3 retries (rollback 2/2).";
    run.graph.nodeStates.implement_experiments.status = "failed";
    run.graph.nodeStates.implement_experiments.updatedAt = "2026-03-12T10:22:48.582Z";
    run.graph.nodeStates.implement_experiments.lastError =
      "Local verification failed via python -m py_compile outputs/example/experiment/run.py (environment): [Errno 2] No such file or directory.";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.note =
      "Analyzed top 30/200 ranked papers into 119 evidence item(s); 5 full-text and 25 abstract fallback.";

    const projection = projectRunForDisplay(run, {
      analyze: {
        selectedCount: 30,
        totalCandidates: 200,
        summaryCount: 30,
        evidenceCount: 119
      }
    });

    expect(projection.actionableNode).toBe("design_experiments");
    expect(projection.blockedByUpstream).toBe(false);
    expect(projection.headline).toBe("Auto rollback from implement_experiments after 4/3 retries (rollback 2/2).");
    expect(projection.detail).toBeUndefined();
  });

  it("prefers a newer checkpoint snapshot when implement_experiments rolls back to design_experiments", () => {
    const stale = makeRun({
      status: "failed",
      currentNode: "implement_experiments",
      updatedAt: "2026-03-12T10:22:48.582Z"
    });
    stale.graph.currentNode = "implement_experiments";
    stale.graph.checkpointSeq = 17;
    stale.graph.nodeStates.design_experiments.status = "completed";
    stale.graph.nodeStates.implement_experiments.status = "failed";
    stale.graph.nodeStates.implement_experiments.updatedAt = "2026-03-12T10:22:48.582Z";
    stale.graph.nodeStates.implement_experiments.lastError =
      "Local verification failed via python -m py_compile outputs/example/experiment/run.py (environment): [Errno 2] No such file or directory.";

    const checkpointSnapshot = makeRun({
      status: "paused",
      currentNode: "design_experiments",
      updatedAt: "2026-03-12T10:24:11.005Z"
    });
    checkpointSnapshot.graph.currentNode = "design_experiments";
    checkpointSnapshot.graph.checkpointSeq = 19;
    checkpointSnapshot.graph.nodeStates.design_experiments.status = "needs_approval";
    checkpointSnapshot.graph.nodeStates.design_experiments.updatedAt = "2026-03-12T10:24:11.005Z";
    checkpointSnapshot.graph.nodeStates.design_experiments.note =
      "Three executable CPU-only experiment designs compare lightweight tabular classification baselines against unmodified logistic regression.";
    checkpointSnapshot.graph.nodeStates.implement_experiments.status = "failed";
    checkpointSnapshot.graph.nodeStates.implement_experiments.updatedAt = "2026-03-12T10:22:48.582Z";
    checkpointSnapshot.graph.nodeStates.implement_experiments.lastError =
      "Local verification failed via python -m py_compile outputs/example/experiment/run.py (environment): [Errno 2] No such file or directory.";

    const projection = projectRunForDisplay(stale, {
      checkpoint: {
        seq: 19,
        phase: "after",
        createdAt: "2026-03-12T10:24:11.005Z",
        snapshot: checkpointSnapshot
      }
    });

    expect(projection.run.currentNode).toBe("design_experiments");
    expect(projection.run.graph.currentNode).toBe("design_experiments");
    expect(projection.run.status).toBe("paused");
    expect(projection.actionableNode).toBe("design_experiments");
    expect(projection.blockedByUpstream).toBe(false);
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

  it("prefers the current failed downstream node over an older upstream failure", () => {
    const run = makeRun({
      status: "failed",
      currentNode: "generate_hypotheses"
    });
    run.graph.currentNode = "generate_hypotheses";
    run.graph.nodeStates.analyze_papers.status = "failed";
    run.graph.nodeStates.analyze_papers.updatedAt = "2026-03-12T07:00:30.000Z";
    run.graph.nodeStates.generate_hypotheses.status = "failed";
    run.graph.nodeStates.generate_hypotheses.updatedAt = "2026-03-12T07:00:10.000Z";
    run.graph.nodeStates.generate_hypotheses.lastError =
      "generate_hypotheses requires at least one evidence item from analyze_papers.";

    expect(resolveFailedNode(run)).toBe("generate_hypotheses");
  });

  it("prefers paused analyze failure details over a stale collect summary", () => {
    const run = makeRun({
      status: "paused",
      currentNode: "analyze_papers",
      latestSummary: 'Semantic Scholar stored 200 papers for "topic". Deferred enrichment continues for 173 paper(s).'
    });
    run.graph.currentNode = "analyze_papers";
    run.graph.retryCounters.analyze_papers = 1;
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "pending";
    run.graph.nodeStates.analyze_papers.note = "Canceled by user";
    run.graph.nodeStates.analyze_papers.lastError = "Analysis incomplete: 1 paper(s) failed validation or LLM extraction.";

    const projection = projectRunForDisplay(run, {
      collect: {
        enrichmentStatus: "completed"
      },
      analyze: {
        selectedCount: 1,
        totalCandidates: 200,
        summaryCount: 0,
        evidenceCount: 0,
        rerankApplied: false,
        rerankFallbackReason: "You've hit your usage limit for GPT-5.3-Codex-Spark.",
        selectedPaperLastError: "You've hit your usage limit for GPT-5.3-Codex-Spark."
      }
    });

    expect(projection.staleLatestSummary).toBe(true);
    expect(projection.usageLimitBlocked).toBe(true);
    expect(projection.noArtifactProgress).toBe(true);
    expect(projection.headline).toContain("paused after retry 1/3");
    expect(projection.detail).toContain("LLM rerank fell back to deterministic order");
  });

  it("redirects actionable recovery to the upstream node when a downstream step lacks evidence", () => {
    const run = makeRun({
      status: "failed",
      currentNode: "generate_hypotheses"
    });
    run.graph.currentNode = "generate_hypotheses";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.lastError = "Analysis incomplete: 19 paper(s) failed validation or LLM extraction.";
    run.graph.nodeStates.generate_hypotheses.status = "failed";
    run.graph.nodeStates.generate_hypotheses.lastError =
      "generate_hypotheses requires at least one evidence item from analyze_papers.";

    const projection = projectRunForDisplay(run, {
      analyze: {
        selectedCount: 0,
        totalCandidates: 0,
        summaryCount: 0,
        evidenceCount: 0
      }
    });

    expect(projection.actionableNode).toBe("analyze_papers");
    expect(projection.blockedByUpstream).toBe(true);
    expect(projection.headline).toContain("generate_hypotheses is blocked because analyze_papers has 0 evidence item(s)");
  });
});
