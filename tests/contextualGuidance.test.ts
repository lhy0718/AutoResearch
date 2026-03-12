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
  it("shows startup actions when no run exists", () => {
    const guidance = buildContextualGuidance({});

    expect(guidance?.title).toBe("Start here");
    expect(guidance?.items.some((item) => item.label === "/new")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "/help")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "what natural inputs are supported?")).toBe(true);
    expect(guidance?.items.length).toBeGreaterThanOrEqual(7);
  });

  it("shows a broad action catalog for an active run", () => {
    const run = makeRun({
      id: "run-active",
      currentNode: "analyze_papers",
      status: "running"
    });
    run.graph.currentNode = "analyze_papers";
    run.graph.nodeStates.analyze_papers.status = "running";

    const guidance = buildContextualGuidance({ run });

    expect(guidance?.title).toBe("Next actions");
    expect(guidance?.items[0]?.label).toBe("/agent run analyze_papers run-active");
    expect(guidance?.items[1]?.label).toBe("/agent status run-active");
    expect(guidance?.items.some((item) => item.label === "/agent graph run-active")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "/agent budget run-active")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "/agent count analyze_papers run-active")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "/agent run analyze_papers run-active --top-n 50")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "analyze the top 50 papers")).toBe(true);
    expect(guidance?.items.length).toBeGreaterThanOrEqual(10);
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

    expect(guidance?.items[0]?.label).toBe("/agent run analyze_papers run-recovery");
    expect(guidance?.items.some((item) => item.label === "/agent retry generate_hypotheses run-recovery")).toBe(false);
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

    expect(guidance?.items[0]?.label).toBe("/agent run implement_experiments run-checkpoint");
    expect(guidance?.items.some((item) => item.label === "/agent run design_experiments run-checkpoint")).toBe(false);
  });

  it("keeps rollback guidance on the design recovery target after implement_experiments fails", () => {
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
    run.graph.nodeStates.implement_experiments.updatedAt = "2026-03-12T10:22:48.582Z";
    run.graph.nodeStates.implement_experiments.lastError =
      "Local verification failed via python -m py_compile outputs/example/experiment/run.py (environment): [Errno 2] No such file or directory.";

    const checkpointSnapshot = makeRun({
      id: "run-rollback",
      currentNode: "design_experiments",
      status: "paused",
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

    expect(guidance?.items[0]?.label).toBe("/approve");
    expect(guidance?.items.some((item) => item.label === "/agent retry design_experiments run-rollback")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "/agent retry implement_experiments run-rollback")).toBe(false);

    const countItem = guidance?.items.find((item) => item.label === "/agent count design_experiments run-rollback");
    expect(countItem?.description).toContain("experiment designs");
    expect(countItem?.description).not.toContain("evidence");
  });

  it("surfaces model-switch guidance when analyze_papers is blocked by a usage limit", () => {
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

    expect(guidance?.items[0]?.label).toBe("/model");
    expect(guidance?.items.some((item) => item.label === "/agent retry analyze_papers run-usage-limit")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "/agent count analyze_papers run-usage-limit")).toBe(true);
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

    expect(guidance?.items[0]?.label).toBe("/agent retry analyze_papers run-blocked");
    expect(guidance?.items.some((item) => item.label === "/agent retry generate_hypotheses run-blocked")).toBe(false);
  });

  it("shows y/a/n controls for pending plans", () => {
    const guidance = buildContextualGuidance({
      pendingPlan: {
        command: "/agent run collect_papers run-1",
        commands: ["/agent run collect_papers run-1", "/agent run analyze_papers run-1"],
        stepIndex: 0,
        totalSteps: 2
      }
    });

    expect(guidance?.title).toBe("Pending plan");
    expect(guidance?.items.some((item) => item.label === "y")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "a")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "n")).toBe(true);
  });

  it("localizes guidance to Korean when requested", () => {
    const guidance = buildContextualGuidance({ language: "ko" });

    expect(guidance?.title).toBe("시작 가이드");
    expect(guidance?.items.some((item) => item.label === "지원되는 자연어 입력을 보여줘")).toBe(true);
    expect(guidance?.items.some((item) => item.label === "/설정" || item.label === "/settings")).toBe(true);
  });

  it("keeps display and apply values separate for pending plans", () => {
    const guidance = buildContextualGuidance({
      language: "ko",
      pendingPlan: {
        command: "/agent run analyze_papers run-1 --top-n 30",
        commands: ["/agent run analyze_papers run-1 --top-n 30"],
        displayCommands: ["상위 30개 논문 분석"],
        stepIndex: 0,
        totalSteps: 1
      }
    });

    expect(guidance?.items[0]?.label).toBe("상위 30개 논문 분석");
    expect(guidance?.items[0]?.applyValue).toBe("/agent run analyze_papers run-1 --top-n 30");
  });

  it("detects guidance language from user text", () => {
    expect(detectGuidanceLanguageFromText("현재 상태 보여줘")).toBe("ko");
    expect(detectGuidanceLanguageFromText("show current status")).toBe("en");
  });
});
