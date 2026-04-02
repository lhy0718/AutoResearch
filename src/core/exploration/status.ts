import path from "node:path";
import { promises as fs } from "node:fs";

import { loadBaselineLock } from "./baselineLock.js";
import { resolveExplorationConfig } from "./explorationConfig.js";
import { loadResearchTree, type ResearchTree } from "./researchTree.js";
import type { ExplorationStage, FigureAuditSummary, ResearchTreeNode } from "./types.js";
import type { AppConfig } from "../../types.js";

export interface ExplorationStatusSnapshot {
  enabled: boolean;
  current_stage: ExplorationStage | null;
  node_counts: {
    explored: number;
    promoted: number;
    blocked: number;
  } | null;
  hypothesis_usage: Record<string, { total: number; promoted: number }> | null;
  best_defensible_branch_id: string | null;
  rollback_reason: string | null;
  baseline_lock_status: "locked" | "not_locked" | "not_applicable";
  evidence_completeness: number | null;
  figure_audit_warnings: number | null;
  severe_figure_mismatch: boolean | null;
}

interface ManagerStateSnapshot {
  current_stage?: ExplorationStage;
  best_defensible_branch_id?: string | null;
  pending_rollback_reason?: string | null;
}

function buildRunDir(workspaceRoot: string, runId: string): string {
  return path.join(workspaceRoot, ".autolabos", "runs", runId);
}

function buildManagerStatePath(runDir: string): string {
  return path.join(runDir, "experiment_tree", "manager_state.json");
}

function buildFigureAuditSummaryPath(runDir: string): string {
  return path.join(runDir, "figure_audit", "figure_audit_summary.json");
}

function emptyEnabledSnapshot(): ExplorationStatusSnapshot {
  return {
    enabled: true,
    current_stage: null,
    node_counts: {
      explored: 0,
      promoted: 0,
      blocked: 0
    },
    hypothesis_usage: {},
    best_defensible_branch_id: null,
    rollback_reason: null,
    baseline_lock_status: "not_locked",
    evidence_completeness: 0,
    figure_audit_warnings: 0,
    severe_figure_mismatch: false
  };
}

export function disabledExplorationStatusSnapshot(): ExplorationStatusSnapshot {
  return {
    enabled: false,
    current_stage: null,
    node_counts: null,
    hypothesis_usage: null,
    best_defensible_branch_id: null,
    rollback_reason: null,
    baseline_lock_status: "not_applicable",
    evidence_completeness: null,
    figure_audit_warnings: null,
    severe_figure_mismatch: null
  };
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function countPromotedNodes(tree: ResearchTree): number {
  return Object.values(tree.nodes).filter(
    (node) => node.status === "promoted" || node.promotion_decision?.promoted === true
  ).length;
}

function countBlockedNodes(tree: ResearchTree): number {
  return Object.values(tree.nodes).filter(
    (node) => node.status === "blocked" || node.status === "failed" || node.status === "rolled_back"
  ).length;
}

function collectHypothesisUsage(tree: ResearchTree): Record<string, { total: number; promoted: number }> {
  const usage: Record<string, { total: number; promoted: number }> = {};
  for (const node of Object.values(tree.nodes)) {
    const hypothesisId = node.hypothesis_link?.trim();
    if (!hypothesisId) {
      continue;
    }
    if (!usage[hypothesisId]) {
      usage[hypothesisId] = { total: 0, promoted: 0 };
    }
    usage[hypothesisId].total += 1;
    if (node.status === "promoted" || node.promotion_decision?.promoted === true) {
      usage[hypothesisId].promoted += 1;
    }
  }
  return usage;
}

function deriveEvidenceCompleteness(
  tree: ResearchTree,
  bestBranchId: string | null
): number {
  const bestNode = bestBranchId ? tree.nodes[bestBranchId] : null;
  if (bestNode) {
    return evidenceCompletenessForNode(bestNode);
  }

  let best = 0;
  for (const node of Object.values(tree.nodes)) {
    best = Math.max(best, evidenceCompletenessForNode(node));
  }
  return best;
}

function evidenceCompletenessForNode(node: ResearchTreeNode): number {
  if (typeof node.promotion_decision?.evidence_completeness === "number") {
    return node.promotion_decision.evidence_completeness;
  }
  return node.evidence_manifest?.is_executed === true ? 1 : 0;
}

export async function buildExplorationStatusSnapshot(options: {
  workspaceRoot: string;
  runId?: string | null;
  appConfig?: Partial<AppConfig> | null;
}): Promise<ExplorationStatusSnapshot> {
  const config = resolveExplorationConfig({
    workspaceRoot: options.workspaceRoot,
    appConfig: options.appConfig
  });
  if (!config.enabled) {
    return disabledExplorationStatusSnapshot();
  }

  const runId = options.runId?.trim();
  if (!runId) {
    return emptyEnabledSnapshot();
  }

  const runDir = buildRunDir(options.workspaceRoot, runId);
  const tree = loadResearchTree(runDir);
  const managerState = await readJsonIfExists<ManagerStateSnapshot>(buildManagerStatePath(runDir));
  const figureAuditSummary = await readJsonIfExists<FigureAuditSummary>(buildFigureAuditSummaryPath(runDir));
  const baselineLock = loadBaselineLock(runDir);

  if (!tree) {
    return {
      ...emptyEnabledSnapshot(),
      baseline_lock_status: baselineLock ? "locked" : "not_locked",
      current_stage: managerState?.current_stage ?? null,
      best_defensible_branch_id: managerState?.best_defensible_branch_id ?? null,
      rollback_reason: managerState?.pending_rollback_reason ?? null,
      figure_audit_warnings: figureAuditSummary
        ? figureAuditSummary.issues.filter((issue) => issue.severity === "warning").length
        : 0,
      severe_figure_mismatch: figureAuditSummary ? figureAuditSummary.severe_mismatch_count > 0 : false
    };
  }

  return {
    enabled: true,
    current_stage: managerState?.current_stage ?? null,
    node_counts: {
      explored: Object.keys(tree.nodes).length,
      promoted: countPromotedNodes(tree),
      blocked: countBlockedNodes(tree)
    },
    hypothesis_usage: collectHypothesisUsage(tree),
    best_defensible_branch_id: managerState?.best_defensible_branch_id ?? null,
    rollback_reason: managerState?.pending_rollback_reason ?? null,
    baseline_lock_status: baselineLock ? "locked" : "not_locked",
    evidence_completeness: deriveEvidenceCompleteness(
      tree,
      managerState?.best_defensible_branch_id ?? null
    ),
    figure_audit_warnings: figureAuditSummary
      ? figureAuditSummary.issues.filter((issue) => issue.severity === "warning").length
      : 0,
    severe_figure_mismatch: figureAuditSummary ? figureAuditSummary.severe_mismatch_count > 0 : false
  };
}

export function formatExplorationStatusLines(snapshot: ExplorationStatusSnapshot): string[] {
  const lines = ["=== Exploration Engine Status ==="];
  lines.push(`Enabled:          ${snapshot.enabled ? "true" : "false"}`);
  lines.push(`Current Stage:    ${snapshot.current_stage ?? "n/a"}`);
  if (snapshot.node_counts) {
    lines.push(
      `Nodes:            ${snapshot.node_counts.explored} explored / ${snapshot.node_counts.promoted} promoted / ${snapshot.node_counts.blocked} blocked`
    );
  } else {
    lines.push("Nodes:            n/a");
  }
  lines.push(`Best Defensible:  ${snapshot.best_defensible_branch_id ?? "n/a"}`);
  lines.push(`Baseline Lock:    ${snapshot.baseline_lock_status}`);
  lines.push(`Evidence:         ${snapshot.evidence_completeness ?? "n/a"}`);
  if (snapshot.figure_audit_warnings == null || snapshot.severe_figure_mismatch == null) {
    lines.push("Fig Audit Warns:  n/a");
  } else {
    lines.push(
      `Fig Audit Warns:  ${snapshot.figure_audit_warnings} (${snapshot.severe_figure_mismatch ? 1 : 0} severe flag)`
    );
  }
  if (snapshot.rollback_reason) {
    lines.push(`Rollback reason:  ${snapshot.rollback_reason}`);
  }
  if (snapshot.hypothesis_usage && Object.keys(snapshot.hypothesis_usage).length > 0) {
    lines.push("Hypotheses:");
    for (const [hypothesisId, usage] of Object.entries(snapshot.hypothesis_usage)) {
      lines.push(`  ${hypothesisId}: ${usage.total} total / ${usage.promoted} promoted`);
    }
  }
  return lines;
}
