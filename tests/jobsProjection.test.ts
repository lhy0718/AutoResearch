import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import {
  buildAnalyzeResultsOperatorSummary,
  buildJobsTemplateLines,
  buildRunJobsSnapshot
} from "../src/core/runs/jobsProjection.js";
import { RunRecord } from "../src/types.js";

function makeRun(id: string, overrides: Partial<RunRecord> = {}): RunRecord {
  const now = new Date().toISOString();
  const graph = overrides.graph ?? createDefaultGraphState();
  const currentNode = overrides.currentNode ?? graph.currentNode;
  return {
    version: 3,
    workflowVersion: 3,
    id,
    title: overrides.title ?? `Run ${id}`,
    topic: overrides.topic ?? "topic",
    constraints: overrides.constraints ?? [],
    objectiveMetric: overrides.objectiveMetric ?? "accuracy",
    status: overrides.status ?? "paused",
    currentNode,
    latestSummary: overrides.latestSummary,
    nodeThreads: overrides.nodeThreads ?? {},
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    usage: overrides.usage,
    graph,
    memoryRefs: overrides.memoryRefs ?? {
      runContextPath: `.autolabos/runs/${id}/memory/run_context.json`,
      longTermPath: `.autolabos/runs/${id}/memory/long_term.jsonl`,
      episodePath: `.autolabos/runs/${id}/memory/episodes.jsonl`
    }
  };
}

let workspaceRoot: string;

afterEach(async () => {
  if (workspaceRoot) {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

describe("jobsProjection", () => {
  it("surfaces review as an independent readiness stage with a resume_review next action", async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-jobs-"));
    const run = makeRun("run-review");
    run.currentNode = "review";
    run.graph.currentNode = "review";
    run.status = "paused";
    run.graph.nodeStates.review.status = "needs_approval";

    const runDir = path.join(workspaceRoot, ".autolabos", "runs", run.id);
    await fs.mkdir(path.join(runDir, "review"), { recursive: true });
    await fs.writeFile(path.join(runDir, "events.jsonl"), `${JSON.stringify({ timestamp: "2026-03-28T12:00:00.000Z" })}\n`);
    await fs.writeFile(
      path.join(runDir, "result_analysis.json"),
      JSON.stringify({ overview: { objective_status: "met", objective_summary: "The target metric was met." } }, null, 2)
    );
    await fs.writeFile(
      path.join(runDir, "transition_recommendation.json"),
      JSON.stringify({ action: "advance", targetNode: "review", reason: "Ready for review." }, null, 2)
    );
    await fs.writeFile(
      path.join(runDir, "review", "review_packet.json"),
      JSON.stringify({ generated_at: "", checks: [], readiness: { status: "ready", ready_checks: 1, warning_checks: 0, blocking_checks: 0, manual_checks: 1 }, objective_status: "met", objective_summary: "The target metric was met.", suggested_actions: [], decision: { outcome: "advance", recommended_transition: "write_paper" } }, null, 2)
    );
    await fs.writeFile(
      path.join(runDir, "review", "scorecard.json"),
      JSON.stringify({ overall_score_1_to_5: 4.2 }, null, 2)
    );
    await fs.writeFile(
      path.join(runDir, "review", "paper_critique.json"),
      JSON.stringify({ blocking_issues_count: 0, paper_readiness_state: "paper_scale_candidate" }, null, 2)
    );
    await fs.writeFile(
      path.join(runDir, "review", "minimum_gate.json"),
      JSON.stringify({ passed: true, ceiling_type: "paper_scale_candidate" }, null, 2)
    );
    await fs.writeFile(
      path.join(runDir, "review", "readiness_risks.json"),
      JSON.stringify({ generated_at: "", paper_ready: false, readiness_state: "blocked_for_paper_scale", risk_count: 1, blocked_count: 1, warning_count: 0, risks: [{ risk_code: "review_blocked", severity: "blocked", category: "paper_scale", status: "blocked", message: "A baseline is still missing before paper drafting.", triggered_by: ["minimum_gate"], affected_claim_ids: [], affected_citation_ids: [], recommended_action: "Collect a baseline.", recheck_condition: "A baseline exists." }], summary_lines: [] }, null, 2)
    );

    const snapshot = await buildRunJobsSnapshot({
      workspaceRoot,
      runs: [run],
      approvalMode: "manual"
    });

    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.runs[0]).toMatchObject({
      run_id: run.id,
      current_node: "review",
      lifecycle_status: "needs_approval",
      analysis_ready: true,
      review_ready: true,
      paper_ready: false,
      review_gate_status: "ready",
      review_decision_outcome: "advance",
      review_recommended_transition: "write_paper",
      review_score_overall: 4.2,
      recommended_next_action: "resume_review",
      blocker_summary: "A baseline is still missing before paper drafting."
    });
    expect(snapshot.top_failures[0]?.reason).toContain("baseline");
  });

  it("derives analyze-results operator guidance from existing artifacts without creating a new workflow node", async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-analyze-operator-"));
    const run = makeRun("run-analyze", { currentNode: "analyze_results", status: "paused" });
    run.graph.currentNode = "analyze_results";
    run.graph.nodeStates.analyze_results.status = "completed";

    const runDir = path.join(workspaceRoot, ".autolabos", "runs", run.id);
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(
      path.join(runDir, "result_analysis.json"),
      JSON.stringify(
        {
          mean_score: 8.1,
          overview: {
            objective_status: "met",
            objective_summary: "Accuracy surpassed the baseline target."
          },
          failure_taxonomy: [],
          synthesis: {
            follow_up_actions: ["Enter review and confirm the claim-evidence mapping."]
          },
          transition_recommendation: {
            action: "advance",
            targetNode: "review",
            reason: "The analysis artifacts are ready for the review gate."
          }
        },
        null,
        2
      )
    );
    await fs.writeFile(
      path.join(runDir, "transition_recommendation.json"),
      JSON.stringify({ action: "advance", targetNode: "review", reason: "The analysis artifacts are ready for the review gate." }, null, 2)
    );

    const summary = await buildAnalyzeResultsOperatorSummary({
      workspaceRoot,
      run,
      approvalMode: "minimal"
    });

    expect(summary.analysis_ready).toBe(true);
    expect(summary.review_ready).toBe(false);
    expect(summary.recommended_next_action).toBe("resume_review");
    expect(summary.lines.some((line) => line.includes("Transition: advance -> review"))).toBe(true);
    expect(summary.lines).toContain("Review gate: not started yet or still missing one of the required review artifacts.");
    expect(summary.artifact_refs.map((item) => item.path)).toContain("result_analysis.json");
    expect(summary.artifact_refs.map((item) => item.path)).toContain("transition_recommendation.json");
  });

  it("renders 3-day and 7-day template helpers from the jobs snapshot", async () => {
    const lines = buildJobsTemplateLines({
      snapshot: {
        generated_at: "2026-03-28T00:00:00.000Z",
        runs: [],
        top_failures: []
      },
      window: "3d"
    });
    expect(lines[0]).toContain("3-day operator check-in template");
    expect(lines[2]).toContain("Review-adjacent runs");
  });
});
