import { describe, expect, it } from "vitest";

import { loadExplorationConfig } from "../src/core/exploration/explorationConfig.js";
import { checkBudget } from "../src/core/exploration/budgetPolicy.js";
import { evaluatePromotion, selectStrongestDefensible } from "../src/core/exploration/promotionGate.js";
import { scoreBranch } from "../src/core/exploration/branchScorer.js";
import { STAGE_POLICY } from "../src/core/exploration/stagePolicies.js";
import type { FailureMemoryEntry, ResearchTreeNode } from "../src/core/exploration/types.js";

function makeNode(patch: Partial<ResearchTreeNode> = {}): ResearchTreeNode {
  const now = new Date().toISOString();
  const evidenceManifest = Object.prototype.hasOwnProperty.call(patch, "evidence_manifest")
    ? patch.evidence_manifest ?? null
    : {
        branch_id: patch.node_id ?? "branch-1",
        executed_at: now,
        artifact_paths: ["metrics.json"],
        metrics_source: "metrics.json",
        is_executed: true,
        is_reproducible: true,
        reproduction_runs: 2
      };
  return {
    node_id: patch.node_id ?? "branch-1",
    parent_id: patch.parent_id ?? null,
    root_id: patch.root_id ?? (patch.node_id ?? "branch-1"),
    stage: patch.stage ?? "main_agenda",
    depth: patch.depth ?? 0,
    debug_depth: patch.debug_depth ?? 0,
    branch_kind: patch.branch_kind ?? "main",
    change_set: patch.change_set ?? { model: "model-a" },
    hypothesis_link: patch.hypothesis_link ?? null,
    expected_effect: patch.expected_effect ?? "Improve score.",
    actual_result_summary: patch.actual_result_summary ?? null,
    objective_metrics: patch.objective_metrics ?? { baseline: 1, treatment: 1.2 },
    budget_cost: patch.budget_cost ?? 1000,
    reproducibility_status: patch.reproducibility_status ?? "reproduced",
    failure_fingerprint: patch.failure_fingerprint ?? null,
    evidence_manifest: evidenceManifest,
    promotion_decision: patch.promotion_decision ?? null,
    blocked_reasons: patch.blocked_reasons ?? [],
    status: patch.status ?? "completed",
    created_at: patch.created_at ?? now,
    updated_at: patch.updated_at ?? now
  };
}

describe("exploration policies", () => {
  it("marks model changes as outside feasibility allowed changes", () => {
    expect(STAGE_POLICY.feasibility.allowedChanges).not.toContain("model");
  });

  it("returns zero composite score when evidence manifest is missing", () => {
    const config = loadExplorationConfig();
    const score = scoreBranch(
      makeNode({
        evidence_manifest: null
      }),
      config
    );

    expect(score.evidence_completeness).toBe(0);
    expect(score.composite_score).toBe(0);
  });

  it("applies instability penalty for flaky branches", () => {
    const config = loadExplorationConfig();
    const score = scoreBranch(
      makeNode({
        reproducibility_status: "flaky"
      }),
      config
    );

    expect(score.instability_penalty).toBe(0.3);
  });

  it("blocks promotion when evidence was not executed", () => {
    const config = loadExplorationConfig();
    const decision = evaluatePromotion(
      makeNode({
        evidence_manifest: {
          branch_id: "branch-1",
          executed_at: new Date().toISOString(),
          artifact_paths: [],
          metrics_source: "metrics.json",
          is_executed: false,
          is_reproducible: false,
          reproduction_runs: 0
        }
      }),
      null,
      [],
      config
    );

    expect(decision.promoted).toBe(false);
    expect(decision.blocking_reasons.length).toBeGreaterThan(0);
  });

  it("blocks promotion when failure memory blocks the same fingerprint", () => {
    const config = loadExplorationConfig();
    const failureMemory: FailureMemoryEntry[] = [
      {
        failure_fingerprint: "fp-1",
        failure_class: "evaluation",
        retry_policy: "block",
        equivalent_to: null,
        affects_stage: ["main_agenda"],
        first_seen_at: new Date().toISOString(),
        occurrence_count: 2
      }
    ];

    const decision = evaluatePromotion(
      makeNode({
        failure_fingerprint: "fp-1"
      }),
      null,
      failureMemory,
      config
    );

    expect(decision.promoted).toBe(false);
    expect(decision.blocking_reasons.some((reason) => reason.includes("fp-1"))).toBe(true);
  });

  it("selects the strongest defensible candidate by composite score", () => {
    const config = loadExplorationConfig();
    const weaker = makeNode({
      node_id: "weaker",
      objective_metrics: { baseline: 1, treatment: 1.05 },
      budget_cost: 1000
    });
    const stronger = makeNode({
      node_id: "stronger",
      objective_metrics: { baseline: 1, treatment: 1.3 },
      budget_cost: 500
    });

    const selected = selectStrongestDefensible([weaker, stronger], null, [], config);

    expect(selected?.node_id).toBe("stronger");
  });

  it("hard-stops when the stage node budget is exceeded", () => {
    const config = loadExplorationConfig();
    const result = checkBudget({
      stage: "feasibility",
      nodeCount: config.max_nodes_per_stage + 1,
      elapsedMs: 1000,
      tokenCount: 100,
      config
    });

    expect(result.within_budget).toBe(false);
    expect(result.recommendation).toBe("hard_stop");
  });
});
