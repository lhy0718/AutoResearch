import { ExperimentDesignCandidate } from "../analysis/researchPlanning.js";
import { ObjectiveMetricEvaluation } from "../objectiveMetric.js";

export type ExperimentPortfolioExecutionModel = "single_run" | "managed_bundle" | "legacy_python_runner";
export type ExperimentPortfolioTrialGroupKind = "aggregate" | "matrix_slice";

export interface ExperimentPortfolioTrialGroup {
  id: string;
  label: string;
  role: "primary" | "supplemental";
  profile?: string;
  group_kind?: ExperimentPortfolioTrialGroupKind;
  source_trial_group_id?: string;
  matrix_axes?: Record<string, string>;
  expected_trials?: number;
  dataset_scope: string[];
  metrics: string[];
  baselines: string[];
  notes: string[];
}

export interface ExperimentPortfolio {
  version: 1;
  run_id: string;
  created_at: string;
  execution_model: ExperimentPortfolioExecutionModel;
  comparison_axes: string[];
  primary_trial_group_id: string;
  total_expected_trials?: number;
  trial_groups: ExperimentPortfolioTrialGroup[];
}

export interface ExperimentPortfolioSamplingProfile {
  name?: string;
  total_trials?: number;
  executed_trials?: number;
  cached_trials?: number;
}

export interface ExperimentRunManifestTrialGroup extends ExperimentPortfolioTrialGroup {
  status: "pass" | "fail" | "skipped";
  command?: string;
  cwd?: string;
  metrics_path?: string;
  summary: string;
  objective_evaluation?: ObjectiveMetricEvaluation;
  sampling_profile?: ExperimentPortfolioSamplingProfile;
}

export interface ExperimentRunManifest {
  version: 1;
  run_id: string;
  generated_at: string;
  execution_model: ExperimentPortfolioExecutionModel;
  primary_command: string;
  primary_cwd?: string;
  primary_metrics_path: string;
  comparison_mode?: "baseline_first_locked" | "objective_only";
  total_expected_trials?: number;
  executed_trials?: number;
  cached_trials?: number;
  portfolio: ExperimentPortfolio;
  trial_groups: ExperimentRunManifestTrialGroup[];
}

export interface ManagedExperimentPortfolioConfig {
  comparison_axes?: string[];
  primary: Omit<ExperimentPortfolioTrialGroup, "role">;
  supplemental?: Array<Omit<ExperimentPortfolioTrialGroup, "role">>;
}

export interface BuildExperimentRunManifestSupplementalRun {
  profile: string;
  status: "pass" | "fail" | "skipped";
  command?: string;
  cwd?: string;
  metrics_path: string;
  summary: string;
  objective_evaluation?: ObjectiveMetricEvaluation;
  sampling_profile?: ExperimentPortfolioSamplingProfile;
}

export interface BuildExperimentRunManifestTrialGroupExecution {
  id: string;
  status: "pass" | "fail" | "skipped";
  command?: string;
  cwd?: string;
  metrics_path?: string;
  summary: string;
  objective_evaluation?: ObjectiveMetricEvaluation;
  sampling_profile?: ExperimentPortfolioSamplingProfile;
}

const DEFAULT_MANAGED_BUNDLE_DATASETS = [
  "hotpotqa_mini",
  "gsm8k_mini",
  "humaneval_mini"
] as const;

export function buildExperimentPortfolioFromDesign(input: {
  runId: string;
  selectedDesign: ExperimentDesignCandidate;
  managedConfig?: ManagedExperimentPortfolioConfig;
}): ExperimentPortfolio {
  const createdAt = new Date().toISOString();
  if (input.managedConfig) {
    const comparisonAxes = uniqueStrings(
      input.managedConfig.comparison_axes || ["runner_profile", "dataset", "repeat", "prompt_variant", "baseline"]
    );
    const primaryGroup = normalizeTrialGroup({
      ...input.managedConfig.primary,
      role: "primary"
    });
    const supplementalGroups = (input.managedConfig.supplemental || []).map((group) =>
      normalizeTrialGroup({
        ...group,
        role: "supplemental"
      })
    );
    const aggregateTrialGroups = [primaryGroup, ...supplementalGroups];
    const trialGroups = [
      ...aggregateTrialGroups,
      ...buildManagedMatrixSliceGroups(aggregateTrialGroups, comparisonAxes)
    ];
    return {
      version: 1,
      run_id: input.runId,
      created_at: createdAt,
      execution_model: "managed_bundle",
      comparison_axes: comparisonAxes,
      primary_trial_group_id: primaryGroup.id,
      total_expected_trials: sumNumbers(aggregateTrialGroups.map((group) => group.expected_trials)),
      trial_groups: trialGroups
    };
  }

  const primaryGroup = normalizeTrialGroup({
    id: "primary",
    label: "Primary experiment run",
    role: "primary",
    dataset_scope: uniqueStrings(input.selectedDesign.datasets),
    metrics: uniqueStrings(input.selectedDesign.metrics),
    baselines: uniqueStrings(input.selectedDesign.baselines),
    notes: uniqueStrings([
      input.selectedDesign.plan_summary,
      ...input.selectedDesign.evaluation_steps,
      ...input.selectedDesign.implementation_notes,
      ...input.selectedDesign.resource_notes
    ])
  });

  return {
    version: 1,
    run_id: input.runId,
    created_at: createdAt,
    execution_model: "single_run",
    comparison_axes: ["dataset", "baseline", "metric"],
    primary_trial_group_id: primaryGroup.id,
    total_expected_trials: primaryGroup.expected_trials,
    trial_groups: [primaryGroup]
  };
}

export function buildFallbackExperimentPortfolio(input: {
  runId: string;
  executionModel: ExperimentPortfolioExecutionModel;
  supplementalProfiles?: Array<{
    profile: string;
  }>;
}): ExperimentPortfolio {
  const primaryExpectedTrials = input.executionModel === "managed_bundle" ? 48 : undefined;
  const comparisonAxes =
    input.executionModel === "single_run"
      ? ["metric"]
      : ["runner_profile", "dataset", "repeat", "prompt_variant"];
  const primaryGroup = normalizeTrialGroup({
    id: input.executionModel === "single_run" ? "primary" : "primary_standard",
    label: input.executionModel === "single_run" ? "Primary experiment run" : "Primary standard run",
    role: "primary",
    profile: input.executionModel === "single_run" ? undefined : "standard",
    expected_trials: primaryExpectedTrials,
    dataset_scope:
      input.executionModel === "managed_bundle" ? [...DEFAULT_MANAGED_BUNDLE_DATASETS] : [],
    metrics: [],
    baselines: [],
    notes: [
      "Auto-generated fallback portfolio because experiment_portfolio.json was unavailable at execution time."
    ]
  });
  const supplementalGroups = (input.supplementalProfiles || []).map((profile) =>
    normalizeTrialGroup({
      id: profile.profile,
      label: humanizeProfileLabel(profile.profile),
      role: "supplemental",
      profile: profile.profile,
      expected_trials:
        input.executionModel === "managed_bundle"
          ? profile.profile === "quick_check"
            ? 6
            : profile.profile === "confirmatory"
              ? 72
              : undefined
          : undefined,
       dataset_scope:
         input.executionModel === "managed_bundle" ? [...DEFAULT_MANAGED_BUNDLE_DATASETS] : [],
       metrics: [],
       baselines: [],
       notes: [
         "Auto-generated fallback supplemental group because experiment_portfolio.json was unavailable at execution time."
       ]
     })
  );
  const aggregateTrialGroups = [primaryGroup, ...supplementalGroups];
  const trialGroups =
    input.executionModel === "managed_bundle"
      ? [...aggregateTrialGroups, ...buildManagedMatrixSliceGroups(aggregateTrialGroups, comparisonAxes)]
      : aggregateTrialGroups;

  return {
    version: 1,
    run_id: input.runId,
    created_at: new Date().toISOString(),
    execution_model: input.executionModel,
    comparison_axes: comparisonAxes,
    primary_trial_group_id: primaryGroup.id,
    total_expected_trials:
      input.executionModel === "managed_bundle"
        ? sumNumbers([primaryExpectedTrials, ...supplementalGroups.map((group) => group.expected_trials)])
        : undefined,
    trial_groups: trialGroups
  };
}

export function buildExperimentRunManifest(input: {
  runId: string;
  portfolio: ExperimentPortfolio;
  executionModel?: ExperimentPortfolioExecutionModel;
  primaryCommand: string;
  primaryCwd?: string;
  primaryMetricsPath: string;
  primaryMetrics: Record<string, unknown>;
  objectiveEvaluation: ObjectiveMetricEvaluation;
  comparisonMode?: "baseline_first_locked" | "objective_only";
  supplementalRuns?: BuildExperimentRunManifestSupplementalRun[];
  executedTrialGroups?: BuildExperimentRunManifestTrialGroupExecution[];
}): ExperimentRunManifest {
  const executionModel = input.executionModel || input.portfolio.execution_model;
  const portfolio =
    executionModel === input.portfolio.execution_model
      ? input.portfolio
      : {
          ...input.portfolio,
          execution_model: executionModel
        };
  const supplementalByProfile = new Map(
    (input.supplementalRuns || []).map((record) => [record.profile, record])
  );
  const executedTrialGroupsById = new Map(
    (input.executedTrialGroups || []).map((record) => [record.id, record])
  );
  const primarySampling = extractSamplingProfile(input.primaryMetrics);

  const trialGroups = portfolio.trial_groups.map((group) => {
    const explicitExecution = executedTrialGroupsById.get(group.id);
    if (explicitExecution) {
      return {
        ...group,
        status: explicitExecution.status,
        command: explicitExecution.command,
        cwd: explicitExecution.cwd,
        metrics_path: explicitExecution.metrics_path,
        summary: explicitExecution.summary,
        objective_evaluation: explicitExecution.objective_evaluation,
        sampling_profile: explicitExecution.sampling_profile
      };
    }

    if (group.id === portfolio.primary_trial_group_id || (group.role === "primary" && group.group_kind !== "matrix_slice")) {
      return {
        ...group,
        status: "pass" as const,
        command: input.primaryCommand,
        cwd: input.primaryCwd,
        metrics_path: input.primaryMetricsPath,
        summary: input.objectiveEvaluation.summary,
        objective_evaluation: input.objectiveEvaluation,
        sampling_profile: primarySampling
      };
    }

    const supplemental =
      group.group_kind === "matrix_slice" || !group.profile
        ? undefined
        : supplementalByProfile.get(group.profile);
    return {
      ...group,
      status: supplemental?.status || "skipped",
      command: supplemental?.command,
      cwd: supplemental?.cwd,
      metrics_path: supplemental?.metrics_path,
      summary: supplemental?.summary || `${group.label} did not execute.`,
      objective_evaluation: supplemental?.objective_evaluation,
        sampling_profile: supplemental?.sampling_profile
    };
  });
  const countingTrialGroups = trialGroups.filter((group) => group.group_kind !== "matrix_slice");

  return {
    version: 1,
    run_id: input.runId,
    generated_at: new Date().toISOString(),
    execution_model: executionModel,
    primary_command: input.primaryCommand,
    primary_cwd: input.primaryCwd,
    primary_metrics_path: input.primaryMetricsPath,
    comparison_mode: input.comparisonMode,
    total_expected_trials:
      portfolio.total_expected_trials ?? sumNumbers(countingTrialGroups.map((group) => group.expected_trials)),
    executed_trials: sumNumbers(
      countingTrialGroups.map((group) => group.sampling_profile?.executed_trials)
    ),
    cached_trials: sumNumbers(
      countingTrialGroups.map((group) => group.sampling_profile?.cached_trials)
    ),
    portfolio,
    trial_groups: trialGroups
  };
}

function normalizeTrialGroup(group: ExperimentPortfolioTrialGroup): ExperimentPortfolioTrialGroup {
  return {
    id: group.id,
    label: group.label,
    role: group.role,
    profile: group.profile,
    group_kind: group.group_kind || "aggregate",
    source_trial_group_id: group.source_trial_group_id,
    matrix_axes: normalizeMatrixAxes(group.matrix_axes),
    expected_trials: group.expected_trials,
    dataset_scope: uniqueStrings(group.dataset_scope),
    metrics: uniqueStrings(group.metrics),
    baselines: uniqueStrings(group.baselines),
    notes: uniqueStrings(group.notes)
  };
}

function extractSamplingProfile(metrics: Record<string, unknown>): ExperimentPortfolioSamplingProfile | undefined {
  const sampling = recordValue(metrics.sampling_profile);
  const profile = compactSamplingProfile({
    name: stringValue(sampling.name),
    total_trials: numberValue(sampling.total_trials),
    executed_trials: numberValue(sampling.executed_trials),
    cached_trials: numberValue(sampling.cached_trials)
  });
  return profile && Object.keys(profile).length > 0 ? profile : undefined;
}

function compactSamplingProfile(
  value: ExperimentPortfolioSamplingProfile
): ExperimentPortfolioSamplingProfile | undefined {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null)
  ) as ExperimentPortfolioSamplingProfile;
}

function sumNumbers(values: Array<number | undefined>): number | undefined {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finiteValues.length === 0) {
    return undefined;
  }
  return finiteValues.reduce((sum, value) => sum + value, 0);
}

function buildManagedMatrixSliceGroups(
  groups: ExperimentPortfolioTrialGroup[],
  comparisonAxes: string[]
): ExperimentPortfolioTrialGroup[] {
  if (!comparisonAxes.includes("dataset")) {
    return [];
  }

  return groups.flatMap((group) => {
    const profile = group.profile;
    if (!profile || group.dataset_scope.length <= 1) {
      return [];
    }
    const expectedTrialsPerDataset = divideEvenly(group.expected_trials, group.dataset_scope.length);
    return group.dataset_scope.map((dataset) =>
      normalizeTrialGroup({
        id: `${group.id}__${sanitizeTrialGroupToken(dataset)}`,
        label: `${group.label} / ${dataset}`,
        role: "supplemental",
        profile,
        group_kind: "matrix_slice",
        source_trial_group_id: group.id,
        matrix_axes: {
          runner_profile: profile,
          dataset
        },
        expected_trials: expectedTrialsPerDataset,
        dataset_scope: [dataset],
        metrics: group.metrics,
        baselines: group.baselines,
        notes: uniqueStrings([
          `Matrix slice for dataset ${dataset}.`,
          ...group.notes
        ])
      })
    );
  });
}

function divideEvenly(value: number | undefined, divisor: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || divisor <= 0) {
    return undefined;
  }
  const quotient = value / divisor;
  return Number.isInteger(quotient) ? quotient : undefined;
}

function sanitizeTrialGroupToken(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/gu, "_");
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function uniqueStrings(items: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const item of items) {
    const trimmed = item?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    results.push(trimmed);
  }
  return results;
}

function normalizeMatrixAxes(
  value: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }
  const entries = Object.entries(value)
    .map(([key, entry]) => [key.trim(), entry.trim()] as const)
    .filter(([key, entry]) => key.length > 0 && entry.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function humanizeProfileLabel(profile: string): string {
  if (profile === "quick_check") {
    return "Quick-check supplemental run";
  }
  if (profile === "confirmatory") {
    return "Confirmatory supplemental run";
  }
  return `${profile.replace(/_/gu, " ")} supplemental run`;
}
