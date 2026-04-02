import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ResearchTreeNodeStatus } from "./types.js";
import type { ResearchTree } from "./researchTree.js";

export const FORBIDDEN_CLAIM_SOURCE_PATTERNS = [
  "speculative",
  "unexecuted",
  "TODO",
  "proposal",
  "draft",
  "commented_out",
  "failed_branch",
  "planner_text"
] as const;

export type ClaimSourceType =
  | "executed_evidence"
  | "review_approved"
  | "claim_ceiling_passed"
  | "figure_audit_result"
  | "forbidden";

export interface WriteupInputManifest {
  promoted_branch_id: string;
  allowed_artifacts: string[];
  forbidden_artifacts: string[];
  claim_source_map: Record<string, ClaimSourceType>;
  built_at: string;
}

function buildWriteupManifestPath(runDir: string): string {
  return path.join(runDir, "experiment_tree", "writeup_input_manifest.json");
}

function matchesForbiddenSourcePattern(sourceType: string): boolean {
  const normalized = sourceType.toLowerCase();
  return FORBIDDEN_CLAIM_SOURCE_PATTERNS.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

export function classifyClaimSource(entry: {
  source_type: string;
  is_executed: boolean;
  status: ResearchTreeNodeStatus;
}): ClaimSourceType {
  if (!entry.is_executed) {
    return "forbidden";
  }
  if (entry.status === "failed" || entry.status === "blocked") {
    return "forbidden";
  }
  if (matchesForbiddenSourcePattern(entry.source_type)) {
    return "forbidden";
  }
  return "executed_evidence";
}

export function buildWriteupInputManifest(options: {
  promotedBranchId: string;
  runDir: string;
  tree: ResearchTree;
}): WriteupInputManifest {
  const allowedArtifacts: string[] = [];
  const forbiddenArtifacts: string[] = [];
  const claimSourceMap: Record<string, ClaimSourceType> = {};

  for (const node of Object.values(options.tree.nodes)) {
    const artifactPaths = node.evidence_manifest?.artifact_paths ?? [];
    const sourceType = node.branch_kind;
    const claimSource = classifyClaimSource({
      source_type: sourceType,
      is_executed: node.evidence_manifest?.is_executed === true,
      status: node.status
    });
    const isPromotedNode =
      node.node_id === options.promotedBranchId &&
      (node.status === "promoted" || node.promotion_decision?.promoted === true) &&
      node.evidence_manifest?.is_executed === true;

    for (const artifactPath of artifactPaths) {
      claimSourceMap[artifactPath] = isPromotedNode ? claimSource : "forbidden";
      if (isPromotedNode && claimSource !== "forbidden") {
        allowedArtifacts.push(artifactPath);
      } else {
        forbiddenArtifacts.push(artifactPath);
      }
    }
  }

  const manifest: WriteupInputManifest = {
    promoted_branch_id: options.promotedBranchId,
    allowed_artifacts: [...new Set(allowedArtifacts)],
    forbidden_artifacts: [...new Set(forbiddenArtifacts)],
    claim_source_map: claimSourceMap,
    built_at: new Date().toISOString()
  };

  const targetPath = buildWriteupManifestPath(options.runDir);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function validateWriteupInput(
  manifest: WriteupInputManifest,
  inputFiles: string[]
): {
  valid: boolean;
  forbidden_included: string[];
} {
  const forbidden_included = inputFiles.filter((file) => manifest.forbidden_artifacts.includes(file));
  return {
    valid: forbidden_included.length === 0,
    forbidden_included
  };
}
