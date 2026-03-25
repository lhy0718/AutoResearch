import { describe, expect, it } from "vitest";

import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";
import { buildContextualGuidance, detectGuidanceLanguageFromText } from "../src/tui/contextualGuidance.js";

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

describe("buildContextualGuidance", () => {
  it("shows the minimal Research Brief entry flow when no run exists", () => {
    const guidance = buildContextualGuidance({});

    expect(guidance?.title).toBe("Research brief");
    expect(guidance?.items).toEqual([
      {
        label: "new brief",
        description: "Create or open workspace Brief.md.",
        applyValue: "/new"
      },
      {
        label: "start latest brief",
        description: "Start workspace Brief.md or the latest legacy brief.",
        applyValue: "/brief start --latest"
      }
    ]);
  });

  it("shows only run and steering for an active run", () => {
    const run = makeRun({
      id: "run-active",
      currentNode: "analyze_papers",
      status: "running"
    });
    run.graph.currentNode = "analyze_papers";
    run.graph.nodeStates.analyze_papers.status = "running";

    const guidance = buildContextualGuidance({ run });

    expect(guidance?.title).toBe("Next step");
    expect(guidance?.items[0]).toEqual({
      label: "run",
      description: "Continue analyze_papers.",
      applyValue: "/agent run analyze_papers run-active"
    });
    expect(guidance?.items[1]?.label).toBe("steering");
    expect(guidance?.items).toHaveLength(2);
  });

  it("switches guidance to the running recovery node instead of the stale failed node", () => {
    const run = makeRun({
      id: "run-recovery",
      currentNode: "generate_hypotheses",
      status: "failed"
    });
    run.graph.currentNode = "generate_hypotheses";
    run.graph.nodeStates.generate_hypotheses.status = "failed";
    run.graph.nodeStates.generate_hypotheses.updatedAt = "2026-03-12T06:59:13.286Z";
    run.graph.nodeStates.analyze_papers.status = "running";
    run.graph.nodeStates.analyze_papers.updatedAt = "2026-03-12T06:59:20.000Z";

    const guidance = buildContextualGuidance({ run });

    expect(guidance?.items[0]?.applyValue).toBe("/agent run analyze_papers run-recovery");
  });

  it("prefers checkpoint-backed node guidance when the run index lags behind", () => {
    const run = makeRun({
      id: "run-checkpoint",
      currentNode: "design_experiments",
      status: "running",
      updatedAt: "2026-03-12T10:11:12.151Z"
    });
    run.graph.currentNode = "design_experiments";
    run.graph.checkpointSeq = 15;
    run.graph.nodeStates.design_experiments.status = "running";
    run.graph.nodeStates.design_experiments.updatedAt = "2026-03-12T10:11:12.151Z";

    const checkpointSnapshot = makeRun({
      id: "run-checkpoint",
      currentNode: "implement_experiments",
      status: "running",
      updatedAt: "2026-03-12T10:12:37.354Z"
    });
    checkpointSnapshot.graph.currentNode = "implement_experiments";
    checkpointSnapshot.graph.checkpointSeq = 17;
    checkpointSnapshot.graph.nodeStates.design_experiments.status = "completed";
    checkpointSnapshot.graph.nodeStates.implement_experiments.status = "running";
    checkpointSnapshot.graph.nodeStates.implement_experiments.updatedAt = "2026-03-12T10:12:37.354Z";

    const guidance = buildContextualGuidance({
      run,
      projectionHints: {
        checkpoint: {
          seq: 17,
          phase: "before",
          createdAt: "2026-03-12T10:12:37.354Z",
          snapshot: checkpointSnapshot
        }
      }
    });

    expect(guidance?.items[0]?.applyValue).toBe("/agent run implement_experiments run-checkpoint");
  });

  it("shows approve first when the projected node needs approval", () => {
    const run = makeRun({
      id: "run-rollback",
      currentNode: "implement_experiments",
      status: "failed",
      updatedAt: "2026-03-12T10:22:48.582Z"
    });
    run.graph.currentNode = "implement_experiments";
    run.graph.checkpointSeq = 17;
    run.graph.nodeStates.design_experiments.status = "completed";
    run.graph.nodeStates.implement_experiments.status = "failed";

    const checkpointSnapshot = makeRun({
      id: "run-rollback",
      currentNode: "design_experiments",
      status: "paused",
      updatedAt: "2026-03-12T10:24:11.005Z"
    });
    checkpointSnapshot.graph.currentNode = "design_experiments";
    checkpointSnapshot.graph.checkpointSeq = 19;
    checkpointSnapshot.graph.nodeStates.design_experiments.status = "needs_approval";
    checkpointSnapshot.graph.nodeStates.implement_experiments.status = "failed";

    const guidance = buildContextualGuidance({
      run,
      projectionHints: {
        checkpoint: {
          seq: 19,
          phase: "after",
          createdAt: "2026-03-12T10:24:11.005Z",
          snapshot: checkpointSnapshot
        }
      }
    });

    expect(guidance?.title).toBe("Approval");
    expect(guidance?.items[0]).toEqual({
      label: "approve",
      description: "Approve design_experiments and continue the workflow.",
      applyValue: "/approve"
    });
    expect(guidance?.items[1]?.label).toBe("run");
  });

  it("keeps usage-limit guidance on run while mentioning /model in the description", () => {
    const run = makeRun({
      id: "run-usage-limit",
      currentNode: "analyze_papers",
      status: "paused",
      latestSummary: 'Semantic Scholar stored 200 papers for "topic". Deferred enrichment continues for 173 paper(s).'
    });
    run.graph.currentNode = "analyze_papers";
    run.graph.retryCounters.analyze_papers = 1;
    run.graph.nodeStates.analyze_papers.status = "pending";
    run.graph.nodeStates.analyze_papers.note = "Canceled by user";
    run.graph.nodeStates.analyze_papers.lastError = "Analysis incomplete: 1 paper(s) failed validation or LLM extraction.";

    const guidance = buildContextualGuidance({
      run,
      projectionHints: {
        collect: { enrichmentStatus: "completed" },
        analyze: {
          selectedCount: 1,
          totalCandidates: 200,
          summaryCount: 0,
          evidenceCount: 0,
          rerankApplied: false,
          rerankFallbackReason: "You've hit your usage limit for GPT-5.3-Codex-Spark.",
          selectedPaperLastError: "You've hit your usage limit for GPT-5.3-Codex-Spark."
        }
      }
    });

    expect(guidance?.items[0]?.label).toBe("run");
    expect(guidance?.items[0]?.applyValue).toBe("/agent retry analyze_papers run-usage-limit");
    expect(guidance?.items[0]?.description).toContain("/model");
  });

  it("targets the upstream node when a downstream step is blocked by missing evidence", () => {
    const run = makeRun({
      id: "run-blocked",
      currentNode: "generate_hypotheses",
      status: "failed"
    });
    run.graph.currentNode = "generate_hypotheses";
    run.graph.nodeStates.analyze_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.lastError = "Analysis incomplete: 19 paper(s) failed validation or LLM extraction.";
    run.graph.nodeStates.generate_hypotheses.status = "failed";
    run.graph.nodeStates.generate_hypotheses.lastError =
      "generate_hypotheses requires at least one evidence item from analyze_papers.";

    const guidance = buildContextualGuidance({
      run,
      projectionHints: {
        analyze: {
          selectedCount: 0,
          totalCandidates: 0,
          summaryCount: 0,
          evidenceCount: 0
        }
      }
    });

    expect(guidance?.items[0]?.applyValue).toBe("/agent retry analyze_papers run-blocked");
  });

  it("shows run/cancel only for pending plans while keeping the preview in the description", () => {
    const guidance = buildContextualGuidance({
      pendingPlan: {
        command: "/agent run analyze_papers run-1 --top-n 30",
        commands: ["/agent run analyze_papers run-1 --top-n 30"],
        displayCommands: ["Analyze top 30 papers"],
        stepIndex: 0,
        totalSteps: 1
      }
    });

    expect(guidance?.title).toBe("Command ready");
    expect(guidance?.items).toEqual([
      {
        label: "run",
        description: "Run step 1/1: Analyze top 30 papers",
        applyValue: "y"
      },
      {
        label: "cancel",
        description: "Cancel this pending command.",
        applyValue: "n"
      }
    ]);
  });

  it("keeps guidance in English even after Hangul input", () => {
    expect(detectGuidanceLanguageFromText("현재 상태 보여줘")).toBe("en");
    expect(detectGuidanceLanguageFromText("show current status")).toBe("en");
  });
});
