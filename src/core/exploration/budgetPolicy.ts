import type { ExplorationConfig } from "./explorationConfig.js";
import type { ExplorationStage } from "./types.js";

export interface BudgetCheckResult {
  within_budget: boolean;
  violations: string[];
  recommendation: "continue" | "warn" | "hard_stop";
}

export function checkBudget(options: {
  stage: ExplorationStage;
  nodeCount: number;
  elapsedMs: number;
  tokenCount: number;
  config: ExplorationConfig;
}): BudgetCheckResult {
  const violations: string[] = [];
  let recommendation: BudgetCheckResult["recommendation"] = "continue";

  const stageBudget = options.config.stage_budgets[options.stage];
  const nodeCeiling = Math.min(options.config.max_nodes_per_stage, stageBudget.max_nodes);
  if (options.nodeCount > nodeCeiling) {
    violations.push(
      `${options.stage} node count ${options.nodeCount} exceeded stage ceiling ${nodeCeiling}.`
    );
    recommendation = "hard_stop";
  }

  if (options.elapsedMs > options.config.per_node_time_budget * 1000) {
    violations.push(
      `${options.stage} elapsed time ${options.elapsedMs}ms exceeded per-node time budget ${options.config.per_node_time_budget * 1000}ms.`
    );
    recommendation = "hard_stop";
  }

  if (recommendation !== "hard_stop" && options.tokenCount > options.config.per_node_token_budget) {
    violations.push(
      `${options.stage} token count ${options.tokenCount} exceeded soft token budget ${options.config.per_node_token_budget}.`
    );
    recommendation = "warn";
  }

  return {
    within_budget: recommendation !== "hard_stop",
    violations,
    recommendation
  };
}
