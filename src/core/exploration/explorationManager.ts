import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  BranchKind,
  EvidenceManifest,
  ExplorationStage,
  InterventionDimension,
  ManagerState,
  ResearchTreeNode,
  StageDecisionEntry
} from "./types.js";
import type { ExplorationConfig } from "./explorationConfig.js";
import { loadBaselineLock } from "./baselineLock.js";
import { loadExplorationFailureEntries, shouldBlockSubtree } from "./failureMemoryIntegration.js";
import { checkSingleChange } from "./singleChangeEnforcer.js";
import { checkStageTransition } from "./stagePolicies.js";
import {
  ResearchTree,
  addNode,
  getChildren,
  getDepth,
  initResearchTree,
  loadResearchTree,
  saveResearchTree,
  updateNode
} from "./researchTree.js";

const EXPERIMENT_TREE_DIR = "experiment_tree";
const MANAGER_STATE_FILE = "manager_state.json";
const FAILURE_MEMORY_FILE = "failure_memory.jsonl";

function buildManagerStatePath(runDir: string): string {
  return path.join(runDir, EXPERIMENT_TREE_DIR, MANAGER_STATE_FILE);
}

function buildFailureMemoryPath(runDir: string): string {
  return path.join(runDir, FAILURE_MEMORY_FILE);
}

function createInitialManagerState(runId: string): ManagerState {
  return {
    run_id: runId,
    current_stage: "baseline_hardening",
    stage_decision_history: [],
    best_defensible_branch_id: null,
    pending_rollback_reason: null,
    promotion_history: [],
    blocked_claim_fingerprints: [],
    figure_audit_summary: null,
    updated_at: new Date().toISOString()
  };
}

function loadManagerState(runDir: string): ManagerState | null {
  const targetPath = buildManagerStatePath(runDir);
  if (!existsSync(targetPath)) {
    return null;
  }
  return JSON.parse(readFileSync(targetPath, "utf8")) as ManagerState;
}

function computeNodeCountForStage(tree: ResearchTree, stage: ExplorationStage): number {
  return Object.values(tree.nodes).filter((node) => node.stage === stage).length;
}

function getStageNodeBudget(config: ExplorationConfig, stage: ExplorationStage): number {
  return Math.min(config.max_nodes_per_stage, config.stage_budgets[stage].max_nodes);
}

export class ExplorationManager {
  private tree: ResearchTree | null = null;
  private managerState: ManagerState | null = null;

  constructor(
    private readonly runId: string,
    private readonly runDir: string,
    private readonly config: ExplorationConfig
  ) {}

  async initialize(): Promise<void> {
    this.tree = loadResearchTree(this.runDir) ?? initResearchTree(this.runId, this.runDir);
    this.managerState = loadManagerState(this.runDir) ?? createInitialManagerState(this.runId);
    saveResearchTree(this.runDir, this.tree);
    this.saveManagerState();
  }

  getCurrentStage(): ExplorationStage {
    return this.getManagerState().current_stage;
  }

  getBestDefensibleBranchId(): string | null {
    return this.getManagerState().best_defensible_branch_id;
  }

  getManagerState(): ManagerState {
    if (!this.managerState) {
      this.managerState = createInitialManagerState(this.runId);
    }
    return this.managerState;
  }

  saveManagerState(): void {
    const state = this.getManagerState();
    const targetPath = buildManagerStatePath(this.runDir);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    state.updated_at = new Date().toISOString();
    writeFileSync(targetPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  shouldProceedToStage(_nextStage: ExplorationStage): boolean {
    const state = this.getManagerState();
    const transition = checkStageTransition(state.current_stage, state, this.getTree(), this.config);
    if (transition.shouldRollback) {
      state.pending_rollback_reason = transition.reason;
      this.saveManagerState();
    }
    if (transition.shouldStop) {
      state.stage_decision_history = [
        ...state.stage_decision_history,
        {
          stage: state.current_stage,
          decision: "stop",
          reason: transition.reason,
          decided_at: new Date().toISOString()
        }
      ];
      this.saveManagerState();
    }
    return transition.shouldTransition && transition.nextStage === _nextStage;
  }

  recordStageDecision(decision: StageDecisionEntry): void {
    const state = this.getManagerState();
    state.stage_decision_history = [...state.stage_decision_history, decision];
    state.current_stage = decision.stage;
    this.saveManagerState();
  }

  private getTree(): ResearchTree {
    if (!this.tree) {
      this.tree = loadResearchTree(this.runDir) ?? initResearchTree(this.runId, this.runDir);
    }
    return this.tree;
  }

  private saveTree(): void {
    saveResearchTree(this.runDir, this.getTree());
  }

  private canAddNodeForStage(parentId: string | null, stage: ExplorationStage): boolean {
    const tree = this.getTree();

    if (parentId !== null) {
      const childCount = getChildren(tree, parentId).length;
      if (childCount >= this.config.max_children_per_node) {
        return false;
      }
    }

    if (computeNodeCountForStage(tree, stage) >= getStageNodeBudget(this.config, stage)) {
      return false;
    }

    const nextDepth = parentId ? getDepth(tree, parentId) + 1 : 0;
    if (nextDepth > this.config.max_tree_depth) {
      return false;
    }

    return true;
  }

  canAddNode(parentId: string | null): boolean {
    return this.canAddNodeForStage(parentId, this.getCurrentStage());
  }

  proposeNode(options: {
    parentId: string | null;
    stage: ExplorationStage;
    branchKind: BranchKind;
    changeSet: Partial<Record<InterventionDimension, string>>;
    hypothesisLink: string | null;
    expectedEffect: string;
  }): ResearchTreeNode | null {
    if (!this.canAddNodeForStage(options.parentId, options.stage)) {
      return null;
    }

    const tree = this.getTree();
    const parent = options.parentId ? tree.nodes[options.parentId] : null;
    const failureEntries = loadExplorationFailureEntries(buildFailureMemoryPath(this.runDir));
    if (parent?.failure_fingerprint && shouldBlockSubtree(parent.failure_fingerprint, failureEntries)) {
      return null;
    }

    const singleChange = checkSingleChange(options.changeSet, loadBaselineLock(this.runDir));
    if (!singleChange.allowed) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const nodeId = `branch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const depth = parent ? getDepth(tree, parent.node_id) + 1 : 0;
    const debugDepth = options.branchKind === "debug"
      ? (parent?.debug_depth ?? 0) + 1
      : (parent?.debug_depth ?? 0);
    const node: ResearchTreeNode = {
      node_id: nodeId,
      parent_id: options.parentId,
      root_id: parent ? parent.root_id : nodeId,
      stage: options.stage,
      depth,
      debug_depth: debugDepth,
      branch_kind: options.branchKind,
      change_set: options.changeSet,
      hypothesis_link: options.hypothesisLink,
      expected_effect: options.expectedEffect,
      actual_result_summary: null,
      objective_metrics: {},
      budget_cost: 0,
      reproducibility_status: "not_tested",
      failure_fingerprint: null,
      evidence_manifest: null,
      promotion_decision: null,
      blocked_reasons: [],
      status: "pending",
      created_at: timestamp,
      updated_at: timestamp
    };

    this.tree = addNode(tree, node);
    this.saveTree();
    return node;
  }

  completeNode(nodeId: string, result: {
    actualResultSummary: string;
    objectiveMetrics: Record<string, number | null>;
    evidenceManifest: EvidenceManifest | null;
    failureFingerprint: string | null;
  }): void {
    const existing = this.getTree().nodes[nodeId];
    if (!existing) {
      return;
    }

    this.tree = updateNode(this.getTree(), nodeId, {
      actual_result_summary: result.actualResultSummary,
      objective_metrics: result.objectiveMetrics,
      evidence_manifest: result.evidenceManifest,
      failure_fingerprint: result.failureFingerprint,
      reproducibility_status: result.evidenceManifest?.is_reproducible ? "reproduced" : existing.reproducibility_status,
      status: "completed"
    });

    const state = this.getManagerState();
    if (!state.best_defensible_branch_id && result.evidenceManifest?.is_executed) {
      state.best_defensible_branch_id = nodeId;
      this.saveManagerState();
    }

    this.saveTree();
  }

  resumeContext(): {
    currentStage: ExplorationStage;
    bestDefensibleBranchId: string | null;
    stageDecisionHistory: StageDecisionEntry[];
    pendingRollbackReason: string | null;
  } {
    const state = this.getManagerState();
    return {
      currentStage: state.current_stage,
      bestDefensibleBranchId: state.best_defensible_branch_id,
      stageDecisionHistory: [...state.stage_decision_history],
      pendingRollbackReason: state.pending_rollback_reason
    };
  }
}
