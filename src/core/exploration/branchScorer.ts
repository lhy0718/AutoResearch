import type { ExplorationConfig } from "./explorationConfig.js";
import type { ResearchTreeNode } from "./types.js";

export interface BranchScore {
  composite_score: number;
  objective_gain: number;
  budget_penalty: number;
  instability_penalty: number;
  confound_penalty: number;
  evidence_completeness: number;
  is_defensible: boolean;
}

function countChangedDimensions(node: ResearchTreeNode): number {
  return Object.values(node.change_set).filter((value) => typeof value === "string" && value.trim().length > 0).length;
}

function computeObjectiveGain(metrics: Record<string, number | null>): number {
  const numericEntries = Object.entries(metrics).filter(([, value]) => typeof value === "number" && Number.isFinite(value));
  if (numericEntries.length === 0) {
    return 0;
  }

  const baselineEntry = numericEntries.find(([key]) => /baseline/i.test(key));
  if (!baselineEntry) {
    const maxValue = Math.max(...numericEntries.map(([, value]) => value as number));
    return Math.max(0, Math.min(1, maxValue));
  }

  const baselineValue = baselineEntry[1] as number;
  const comparisonValues = numericEntries
    .filter(([key]) => key !== baselineEntry[0])
    .map(([, value]) => value as number);
  if (comparisonValues.length === 0) {
    return 0;
  }

  const bestComparison = Math.max(...comparisonValues);
  if (baselineValue === 0) {
    return bestComparison > 0 ? 1 : 0;
  }
  return Math.max(0, Math.min(1, (bestComparison - baselineValue) / Math.abs(baselineValue)));
}

export function scoreBranch(node: ResearchTreeNode, config: ExplorationConfig): BranchScore {
  const objective_gain = computeObjectiveGain(node.objective_metrics);
  const budget_penalty = Math.max(0, Math.min(1, node.budget_cost / config.per_node_token_budget));
  const instability_penalty = node.reproducibility_status === "flaky" ? 0.3 : 0.0;
  const confound_penalty = countChangedDimensions(node) > 1 ? 0.5 : 0.0;
  const evidence_completeness = node.evidence_manifest?.is_executed === true ? 1.0 : 0.0;
  const composite_score = Math.max(
    0,
    (objective_gain - budget_penalty - instability_penalty - confound_penalty) * evidence_completeness * 10
  );

  const is_defensible =
    node.evidence_manifest !== null &&
    node.evidence_manifest?.is_executed === true &&
    node.reproducibility_status !== "failed" &&
    confound_penalty < config.promotion_thresholds.max_confound_penalty &&
    evidence_completeness >= config.promotion_thresholds.min_evidence_completeness;

  return {
    composite_score,
    objective_gain,
    budget_penalty,
    instability_penalty,
    confound_penalty,
    evidence_completeness,
    is_defensible
  };
}
