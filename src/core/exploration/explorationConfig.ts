import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

export interface ExplorationStageBudgetConfig {
  max_nodes: number;
  max_time: number;
}

export interface ExplorationPromotionThresholdsConfig {
  min_objective_gain: number;
  max_instability_penalty: number;
  max_confound_penalty: number;
  min_evidence_completeness: number;
  min_reproduction_runs: number;
}

export interface ExplorationReproducibilityMinimumsConfig {
  before_ablation: number;
  for_promotion: number;
}

export interface ExplorationBaselineLockConfig {
  required: boolean;
  strict_hash_match: boolean;
}

export interface ExplorationFigureAuditorConfig {
  enabled: boolean;
  block_on_severe_mismatch: boolean;
  require_caption_alignment: boolean;
  require_reference_alignment: boolean;
}

export interface ExplorationConfig {
  enabled: boolean;
  num_parallel_workers: number;
  max_nodes_per_stage: number;
  max_nodes_per_hypothesis: number;
  max_children_per_node: number;
  max_tree_depth: number;
  max_debug_depth: number;
  debug_probability: number;
  per_node_time_budget: number;
  per_node_token_budget: number;
  per_node_compute_budget: number | null;
  stage_budgets: {
    feasibility: ExplorationStageBudgetConfig;
    baseline_hardening: ExplorationStageBudgetConfig;
    main_agenda: ExplorationStageBudgetConfig;
    ablation: ExplorationStageBudgetConfig;
  };
  promotion_thresholds: ExplorationPromotionThresholdsConfig;
  reproducibility_minimums: ExplorationReproducibilityMinimumsConfig;
  baseline_lock: ExplorationBaselineLockConfig;
  strongest_defensible_only: boolean;
  figure_auditor: ExplorationFigureAuditorConfig;
}

const EXPLORATION_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXPLORATION_REPO_ROOT = path.resolve(EXPLORATION_MODULE_DIR, "..", "..", "..");
const DEFAULT_EXPLORATION_CONFIG_PATH = path.join(
  EXPLORATION_REPO_ROOT,
  "src",
  "config",
  "exploration.default.yaml"
);

export function loadExplorationConfig(configPath?: string): ExplorationConfig {
  const resolvedPath = configPath ? path.resolve(configPath) : DEFAULT_EXPLORATION_CONFIG_PATH;
  const raw = readFileSync(resolvedPath, "utf8");
  return YAML.parse(raw) as ExplorationConfig;
}
