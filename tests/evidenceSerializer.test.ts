import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildWriteupInputManifest,
  classifyClaimSource,
  validateWriteupInput
} from "../src/core/exploration/evidenceSerializer.js";
import { addNode, initResearchTree } from "../src/core/exploration/researchTree.js";
import type { ResearchTreeNode } from "../src/core/exploration/types.js";

function makeNode(patch: Partial<ResearchTreeNode> = {}): ResearchTreeNode {
  const now = new Date().toISOString();
  return {
    node_id: patch.node_id ?? "branch-1",
    parent_id: patch.parent_id ?? null,
    root_id: patch.root_id ?? (patch.node_id ?? "branch-1"),
    stage: patch.stage ?? "main_agenda",
    depth: patch.depth ?? 0,
    debug_depth: patch.debug_depth ?? 0,
    branch_kind: patch.branch_kind ?? "main",
    change_set: patch.change_set ?? {},
    hypothesis_link: patch.hypothesis_link ?? null,
    expected_effect: patch.expected_effect ?? "Improve objective.",
    actual_result_summary: patch.actual_result_summary ?? null,
    objective_metrics: patch.objective_metrics ?? {},
    budget_cost: patch.budget_cost ?? 0,
    reproducibility_status: patch.reproducibility_status ?? "reproduced",
    failure_fingerprint: patch.failure_fingerprint ?? null,
    evidence_manifest: patch.evidence_manifest ?? {
      branch_id: patch.node_id ?? "branch-1",
      executed_at: now,
      artifact_paths: ["result_analysis.json"],
      metrics_source: "metrics.json",
      is_executed: true,
      is_reproducible: true,
      reproduction_runs: 2
    },
    promotion_decision: patch.promotion_decision ?? null,
    blocked_reasons: patch.blocked_reasons ?? [],
    status: patch.status ?? "completed",
    created_at: patch.created_at ?? now,
    updated_at: patch.updated_at ?? now
  };
}

describe("evidenceSerializer", () => {
  it("marks unexecuted inputs as forbidden", () => {
    expect(
      classifyClaimSource({
        source_type: "executed_evidence",
        is_executed: false,
        status: "completed"
      })
    ).toBe("forbidden");
  });

  it("marks failed branches as forbidden", () => {
    expect(
      classifyClaimSource({
        source_type: "executed_evidence",
        is_executed: true,
        status: "failed"
      })
    ).toBe("forbidden");
  });

  it("marks proposal sources as forbidden", () => {
    expect(
      classifyClaimSource({
        source_type: "proposal",
        is_executed: true,
        status: "completed"
      })
    ).toBe("forbidden");
  });

  it("puts failed-branch artifacts into the forbidden set and saves the manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-writeup-manifest-"));
    const runDir = path.join(root, ".autolabos", "runs", "run-1");
    const promoted = makeNode({
      node_id: "promoted-1",
      status: "promoted",
      evidence_manifest: {
        branch_id: "promoted-1",
        executed_at: new Date().toISOString(),
        artifact_paths: ["analysis/promoted.json"],
        metrics_source: "metrics.json",
        is_executed: true,
        is_reproducible: true,
        reproduction_runs: 2
      },
      promotion_decision: {
        branch_id: "promoted-1",
        promoted: true,
        is_strongest_defensible: true,
        promotion_score: 8,
        objective_gain: 0.2,
        budget_penalty: 0,
        instability_penalty: 0,
        confound_penalty: 0,
        evidence_completeness: 1,
        blocking_reasons: [],
        decided_at: new Date().toISOString()
      }
    });
    const failed = makeNode({
      node_id: "failed-1",
      status: "failed",
      evidence_manifest: {
        branch_id: "failed-1",
        executed_at: new Date().toISOString(),
        artifact_paths: ["analysis/failed.json"],
        metrics_source: "metrics.json",
        is_executed: false,
        is_reproducible: false,
        reproduction_runs: 0
      }
    });
    const tree = addNode(addNode(initResearchTree("run-1", runDir), promoted), failed);

    const manifest = buildWriteupInputManifest({
      promotedBranchId: "promoted-1",
      runDir,
      tree
    });

    expect(manifest.allowed_artifacts).toContain("analysis/promoted.json");
    expect(manifest.forbidden_artifacts).toContain("analysis/failed.json");
    const saved = JSON.parse(
      await readFile(path.join(runDir, "experiment_tree", "writeup_input_manifest.json"), "utf8")
    ) as typeof manifest;
    expect(saved.promoted_branch_id).toBe("promoted-1");
  });

  it("rejects writeup inputs that include forbidden artifacts", () => {
    const validation = validateWriteupInput(
      {
        promoted_branch_id: "branch-1",
        allowed_artifacts: ["analysis/promoted.json"],
        forbidden_artifacts: ["analysis/failed.json"],
        claim_source_map: {
          "analysis/promoted.json": "executed_evidence",
          "analysis/failed.json": "forbidden"
        },
        built_at: new Date().toISOString()
      },
      ["analysis/promoted.json", "analysis/failed.json"]
    );

    expect(validation.valid).toBe(false);
    expect(validation.forbidden_included).toEqual(["analysis/failed.json"]);
  });
});
