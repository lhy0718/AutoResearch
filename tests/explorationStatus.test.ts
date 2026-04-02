import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { saveBaselineLock } from "../src/core/exploration/baselineLock.js";
import { loadExplorationConfig } from "../src/core/exploration/explorationConfig.js";
import {
  buildExplorationStatusSnapshot,
  disabledExplorationStatusSnapshot,
  formatExplorationStatusLines
} from "../src/core/exploration/status.js";
import { addNode, initResearchTree, saveResearchTree } from "../src/core/exploration/researchTree.js";
import type { ResearchTreeNode } from "../src/core/exploration/types.js";
import * as explorationConfigModule from "../src/core/exploration/explorationConfig.js";

function makeTreeNode(patch: Partial<ResearchTreeNode> = {}): ResearchTreeNode {
  const now = new Date().toISOString();
  return {
    node_id: patch.node_id ?? "branch-1",
    parent_id: patch.parent_id ?? null,
    root_id: patch.root_id ?? (patch.node_id ?? "branch-1"),
    stage: patch.stage ?? "main_agenda",
    depth: patch.depth ?? 0,
    debug_depth: patch.debug_depth ?? 0,
    branch_kind: patch.branch_kind ?? "main",
    change_set: patch.change_set ?? { model: "candidate-a" },
    hypothesis_link: patch.hypothesis_link ?? "hypothesis-1",
    expected_effect: patch.expected_effect ?? "Improve the objective metric.",
    actual_result_summary: patch.actual_result_summary ?? "Improved score.",
    objective_metrics: patch.objective_metrics ?? { accuracy: 0.92 },
    budget_cost: patch.budget_cost ?? 1200,
    reproducibility_status: patch.reproducibility_status ?? "reproduced",
    failure_fingerprint: patch.failure_fingerprint ?? null,
    evidence_manifest:
      "evidence_manifest" in patch
        ? (patch.evidence_manifest ?? null)
        : {
            branch_id: patch.node_id ?? "branch-1",
            executed_at: now,
            artifact_paths: ["analysis/report.json"],
            metrics_source: "metrics.json",
            is_executed: true,
            is_reproducible: true,
            reproduction_runs: 2
          },
    promotion_decision:
      "promotion_decision" in patch
        ? (patch.promotion_decision ?? null)
        : {
            branch_id: patch.node_id ?? "branch-1",
            promoted: true,
            is_strongest_defensible: true,
            promotion_score: 7.4,
            objective_gain: 0.2,
            budget_penalty: 0.02,
            instability_penalty: 0,
            confound_penalty: 0,
            evidence_completeness: 1,
            blocking_reasons: [],
            decided_at: now
          },
    blocked_reasons: patch.blocked_reasons ?? [],
    status: patch.status ?? "promoted",
    created_at: patch.created_at ?? now,
    updated_at: patch.updated_at ?? now
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exploration status snapshot", () => {
  it("returns the disabled contract when exploration is off", async () => {
    const baseConfig = loadExplorationConfig();
    vi.spyOn(explorationConfigModule, "loadExplorationConfig").mockReturnValue({
      ...baseConfig,
      enabled: false
    });

    const snapshot = await buildExplorationStatusSnapshot({
      workspaceRoot: "/tmp/does-not-matter",
      runId: "run-disabled"
    });

    expect(snapshot).toEqual(disabledExplorationStatusSnapshot());
  });

  it("builds counts, baseline lock, evidence completeness, and figure audit status from persisted artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-exploration-status-"));
    const runId = "run-exploration-status";
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "experiment_tree"), { recursive: true });
    await mkdir(path.join(runDir, "figure_audit"), { recursive: true });
    await mkdir(path.join(root, ".autolabos"), { recursive: true });
    await writeFile(
      path.join(root, ".autolabos", "config.yaml"),
      "exploration:\n  enabled: true\n",
      "utf8"
    );

    const tree = addNode(
      addNode(initResearchTree(runId, runDir), makeTreeNode()),
      makeTreeNode({
        node_id: "branch-2",
        root_id: "branch-1",
        parent_id: "branch-1",
        status: "blocked",
        branch_kind: "debug",
        change_set: { runtime_config: "smaller-batch" },
        hypothesis_link: "hypothesis-1",
        promotion_decision: null,
        evidence_manifest: {
          branch_id: "branch-2",
          executed_at: new Date().toISOString(),
          artifact_paths: ["analysis/debug.json"],
          metrics_source: "metrics.json",
          is_executed: false,
          is_reproducible: false,
          reproduction_runs: 0
        }
      })
    );
    saveResearchTree(runDir, tree);
    await writeFile(
      path.join(runDir, "experiment_tree", "manager_state.json"),
      JSON.stringify(
        {
          run_id: runId,
          current_stage: "main_agenda",
          stage_decision_history: [],
          best_defensible_branch_id: "branch-1",
          pending_rollback_reason: "Need cleaner ablation evidence.",
          promotion_history: [],
          blocked_claim_fingerprints: [],
          figure_audit_summary: null,
          updated_at: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );
    saveBaselineLock(runDir, {
      locked_at: new Date().toISOString(),
      run_id: runId,
      baseline_hash: "baseline",
      dataset_slice_hash: "dataset",
      evaluator_hash: "evaluator",
      seed_policy: "fixed",
      environment_fingerprint: "node|linux|time",
      allowed_intervention_dimensions: ["model"],
      forbidden_concurrent_changes: [["model", "dataset"]]
    });
    await writeFile(
      path.join(runDir, "figure_audit", "figure_audit_summary.json"),
      JSON.stringify(
        {
          audited_at: new Date().toISOString(),
          figure_count: 2,
          issues: [
            {
              figure_id: "fig-1",
              issue_type: "caption_weak",
              severity: "warning",
              description: "Caption is weak.",
              recommended_action: "Tighten the caption.",
              evidence_alignment_status: "aligned",
              empirical_validity_impact: "minor",
              publication_readiness: "needs_revision",
              manuscript_placement_recommendation: "appendix"
            },
            {
              figure_id: "fig-2",
              issue_type: "reference_gap",
              severity: "severe",
              description: "Figure is not supported by the text.",
              recommended_action: "Repair or remove it.",
              evidence_alignment_status: "misaligned",
              empirical_validity_impact: "major",
              publication_readiness: "not_ready",
              manuscript_placement_recommendation: "remove"
            }
          ],
          severe_mismatch_count: 1,
          review_block_required: true
        },
        null,
        2
      ),
      "utf8"
    );

    const snapshot = await buildExplorationStatusSnapshot({
      workspaceRoot: root,
      runId
    });

    expect(snapshot.enabled).toBe(true);
    expect(snapshot.current_stage).toBe("main_agenda");
    expect(snapshot.node_counts).toEqual({
      explored: 2,
      promoted: 1,
      blocked: 1
    });
    expect(snapshot.hypothesis_usage).toEqual({
      "hypothesis-1": { total: 2, promoted: 1 }
    });
    expect(snapshot.best_defensible_branch_id).toBe("branch-1");
    expect(snapshot.rollback_reason).toBe("Need cleaner ablation evidence.");
    expect(snapshot.baseline_lock_status).toBe("locked");
    expect(snapshot.evidence_completeness).toBe(1);
    expect(snapshot.figure_audit_warnings).toBe(1);
    expect(snapshot.severe_figure_mismatch).toBe(true);

    const lines = formatExplorationStatusLines(snapshot);
    expect(lines.some((line) => line.includes("main_agenda"))).toBe(true);
    expect(lines.some((line) => line.includes("2 explored / 1 promoted / 1 blocked"))).toBe(true);
    expect(lines.some((line) => line.includes("branch-1"))).toBe(true);
  });
});
