import type { ExplorationConfig } from "./explorationConfig.js";
import type { ExplorationStage, InterventionDimension, ManagerState } from "./types.js";
import type { ResearchTree } from "./researchTree.js";

export interface StagePolicy {
  purpose: string;
  allowedChanges: InterventionDimension[];
  forbiddenChanges: string[];
  promotionConditions: string[];
  rollbackConditions: string[];
  terminationConditions: string[];
  budgetCeiling: string;
  reproducibilityMinimum: number;
}

export const STAGE_POLICY: Record<ExplorationStage, StagePolicy> = {
  feasibility: {
    purpose: "실험 가능성 검증, baseline 후보 확인",
    allowedChanges: ["runtime_config", "hyperparameter"],
    forbiddenChanges: ["model", "dataset", "evaluator 변경 금지"],
    promotionConditions: ["최소 1회 실행 성공"],
    rollbackConditions: ["structural failure 3회 연속"],
    terminationConditions: ["baseline 후보 확보 또는 max_nodes 초과"],
    budgetCeiling: "stage_budgets.feasibility.max_nodes / max_time",
    reproducibilityMinimum: 1
  },
  baseline_hardening: {
    purpose: "baseline 안정화 및 lock artifact 생성",
    allowedChanges: ["hyperparameter", "runtime_config"],
    forbiddenChanges: ["model과 dataset 동시 변경 금지"],
    promotionConditions: ["재현 성공 2회 이상"],
    rollbackConditions: ["baseline_drift 발생 또는 flaky 3회"],
    terminationConditions: ["baseline lock 생성 완료"],
    budgetCeiling: "stage_budgets.baseline_hardening.max_nodes / max_time",
    reproducibilityMinimum: 2
  },
  main_agenda: {
    purpose: "핵심 연구 가설 검증",
    allowedChanges: [
      "model",
      "dataset",
      "evaluator",
      "runtime_config",
      "preprocessing",
      "metric_policy",
      "hyperparameter",
      "architecture"
    ],
    forbiddenChanges: ["동시 2개 이상 dimension 변경 금지"],
    promotionConditions: ["objective_gain >= threshold", "evidence_completeness >= threshold"],
    rollbackConditions: ["repeated_equivalent_failure", "confound 초과"],
    terminationConditions: ["strongest_defensible_branch 확보 또는 budget 초과"],
    budgetCeiling: "stage_budgets.main_agenda.max_nodes / max_time",
    reproducibilityMinimum: 2
  },
  ablation: {
    purpose: "핵심 구성요소 기여도 분리 검증",
    allowedChanges: ["hyperparameter", "architecture"],
    forbiddenChanges: ["dataset", "evaluator 변경 금지"],
    promotionConditions: ["ablation_delta 명확", "evidence 존재"],
    rollbackConditions: ["main 결과와 모순"],
    terminationConditions: ["모든 핵심 구성요소 검사 완료 또는 budget 초과"],
    budgetCeiling: "stage_budgets.ablation.max_nodes / max_time",
    reproducibilityMinimum: 2
  }
};

export interface StageTransitionResult {
  shouldTransition: boolean;
  nextStage: ExplorationStage | null;
  reason: string;
  shouldRollback: boolean;
  shouldStop: boolean;
}

function getStageNodes(tree: ResearchTree, stage: ExplorationStage) {
  return Object.values(tree.nodes).filter((node) => node.stage === stage);
}

function countConsecutiveFailures(tree: ResearchTree, stage: ExplorationStage): number {
  const nodes = getStageNodes(tree, stage)
    .slice()
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  let count = 0;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const status = nodes[i]?.status;
    if (status === "failed" || status === "blocked") {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

function hasBudgetStop(tree: ResearchTree, stage: ExplorationStage, config: ExplorationConfig): boolean {
  return getStageNodes(tree, stage).length >= Math.min(config.max_nodes_per_stage, config.stage_budgets[stage].max_nodes);
}

export function checkStageTransition(
  currentStage: ExplorationStage,
  managerState: ManagerState,
  tree: ResearchTree,
  config: ExplorationConfig
): StageTransitionResult {
  const stageNodes = getStageNodes(tree, currentStage);

  if (hasBudgetStop(tree, currentStage, config)) {
    return {
      shouldTransition: false,
      nextStage: null,
      reason: `${currentStage} exceeded the configured stage budget ceiling.`,
      shouldRollback: false,
      shouldStop: true
    };
  }

  switch (currentStage) {
    case "feasibility": {
      const executedSuccess = stageNodes.some(
        (node) => node.status === "completed" && node.evidence_manifest?.is_executed === true
      );
      if (executedSuccess) {
        return {
          shouldTransition: true,
          nextStage: "baseline_hardening",
          reason: "Feasibility stage produced at least one executed candidate.",
          shouldRollback: false,
          shouldStop: false
        };
      }
      if (countConsecutiveFailures(tree, currentStage) >= 3) {
        return {
          shouldTransition: false,
          nextStage: null,
          reason: "Feasibility stage hit three consecutive structural failures.",
          shouldRollback: true,
          shouldStop: false
        };
      }
      return {
        shouldTransition: false,
        nextStage: null,
        reason: "Feasibility stage should continue collecting executed evidence.",
        shouldRollback: false,
        shouldStop: false
      };
    }
    case "baseline_hardening": {
      const reproduced = stageNodes.filter(
        (node) =>
          node.status === "completed" &&
          node.reproducibility_status === "reproduced" &&
          (node.evidence_manifest?.reproduction_runs ?? 0) >= STAGE_POLICY.baseline_hardening.reproducibilityMinimum
      );
      if (reproduced.length > 0) {
        return {
          shouldTransition: true,
          nextStage: "main_agenda",
          reason: "Baseline hardening reached the minimum reproducibility floor.",
          shouldRollback: false,
          shouldStop: false
        };
      }
      const flakyCount = stageNodes.filter((node) => node.reproducibility_status === "flaky").length;
      if (flakyCount >= 3) {
        return {
          shouldTransition: false,
          nextStage: null,
          reason: "Baseline hardening became flaky three times.",
          shouldRollback: true,
          shouldStop: false
        };
      }
      return {
        shouldTransition: false,
        nextStage: null,
        reason: "Baseline hardening should continue until reproducibility is demonstrated.",
        shouldRollback: false,
        shouldStop: false
      };
    }
    case "main_agenda": {
      const hasBestDefensible = Boolean(managerState.best_defensible_branch_id);
      if (hasBestDefensible) {
        return {
          shouldTransition: true,
          nextStage: "ablation",
          reason: "A strongest defensible branch is available for ablation work.",
          shouldRollback: false,
          shouldStop: false
        };
      }
      const confounded = stageNodes.some(
        (node) => Object.values(node.change_set).filter((value) => typeof value === "string" && value.trim().length > 0).length > 1
      );
      if (confounded) {
        return {
          shouldTransition: false,
          nextStage: null,
          reason: "Main agenda branch exceeded the single-change confound limit.",
          shouldRollback: true,
          shouldStop: false
        };
      }
      return {
        shouldTransition: false,
        nextStage: null,
        reason: "Main agenda should continue until a strongest defensible branch is selected.",
        shouldRollback: false,
        shouldStop: false
      };
    }
    case "ablation": {
      const completedAblations = stageNodes.filter(
        (node) => node.status === "completed" && node.evidence_manifest?.is_executed === true
      );
      if (completedAblations.length >= 1) {
        return {
          shouldTransition: false,
          nextStage: null,
          reason: "Ablation stage has completed its first executed comparison.",
          shouldRollback: false,
          shouldStop: true
        };
      }
      return {
        shouldTransition: false,
        nextStage: null,
        reason: "Ablation stage should continue until at least one executed ablation exists.",
        shouldRollback: false,
        shouldStop: false
      };
    }
    default:
      return {
        shouldTransition: false,
        nextStage: null,
        reason: "No stage transition policy matched the current exploration stage.",
        shouldRollback: false,
        shouldStop: false
      };
  }
}
