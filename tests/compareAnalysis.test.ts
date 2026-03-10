import { describe, expect, it } from "vitest";

import {
  buildMarkdownReport,
  normalizeComparisonEvaluationContext,
  ComparisonArtifactPayload
} from "../src/cli/compareAnalysis.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

describe("compare analysis", () => {
  it("renders eval harness policy context into the markdown report", () => {
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: "run-compare-policy",
      title: "Compare Policy Run",
      topic: "agent safety",
      constraints: ["recent"],
      objectiveMetric: "accuracy >= 0.9",
      status: "running",
      currentNode: "analyze_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      graph: createDefaultGraphState(),
      memoryRefs: {
        runContextPath: ".autolabos/runs/run-compare-policy/memory/run_context.json",
        longTermPath: ".autolabos/runs/run-compare-policy/memory/long_term.jsonl",
        episodePath: ".autolabos/runs/run-compare-policy/memory/episodes.jsonl"
      }
    };

    const evaluationContext = normalizeComparisonEvaluationContext({
      run_id: run.id,
      title: run.title,
      topic: run.topic,
      objective_metric: run.objectiveMetric,
      run_status: run.status,
      current_node: run.currentNode,
      updated_at: run.updatedAt,
      statuses: {
        implement: "fail",
        run_verifier: "fail",
        objective: "missing",
        analysis: "missing",
        paper: "missing"
      },
      metrics: {
        implement_attempt_count: 1,
        branch_count: 1,
        changed_file_count: 1,
        auto_handoff_to_run_experiments: false,
        local_verify_status: "fail",
        implement_failure_type: "policy",
        implement_policy_rule_id: "network_fetch_disabled",
        run_verifier_stage: "policy",
        run_verifier_policy_rule_id: "remote_script_pipe",
        objective_status: "missing",
        artifact_completeness_ratio: 0.5,
        policy_blocked: true
      },
      scores: {
        implementation: 0,
        run_verifier: 0,
        objective: 0,
        artifacts: 0.5,
        overall: 0.05
      },
      missing_artifacts: ["objective_evaluation.json"],
      findings: [
        "Implement verifier blocked by policy (network_fetch_disabled).",
        "Run verifier blocked by policy (remote_script_pipe)."
      ]
    });

    const payload: ComparisonArtifactPayload = {
      version: 1,
      createdAt: "2026-03-10T00:00:00.000Z",
      runId: run.id,
      selection: {
        source: "analysis_manifest",
        requestedLimit: 1,
        comparedPaperIds: ["paper_1"],
        skipped: []
      },
      judge: {
        enabled: false
      },
      aggregate: {
        comparedCount: 1,
        codexSuccessCount: 1,
        apiSuccessCount: 1,
        judgeWins: { codex: 0, api: 0, tie: 0 },
        averageEvidenceCount: { codex: 3, api: 4 },
        averageOverallJudgeScore: { codex: 0, api: 0 }
      },
      evaluation_context: evaluationContext,
      papers: [
        {
          paper_id: "paper_1",
          title: "Safety Paper",
          pdf_url: "https://example.com/paper.pdf",
          codex: { ok: true },
          api: { ok: true }
        }
      ]
    };

    const markdown = buildMarkdownReport(run, payload);

    expect(markdown).toContain("## Evaluation Context");
    expect(markdown).toContain("- Policy blocked: yes");
    expect(markdown).toContain("- Implement policy rule: network_fetch_disabled");
    expect(markdown).toContain("- Run verifier policy rule: remote_script_pipe");
    expect(markdown).toContain("Implement verifier blocked by policy");
  });
});
