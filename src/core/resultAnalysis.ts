import YAML from "yaml";

import { evaluateObjectiveMetric, ObjectiveMetricEvaluation, ObjectiveMetricProfile } from "./objectiveMetric.js";
import { ExperimentPortfolio, ExperimentRunManifest } from "./experiments/experimentPortfolio.js";
import { RunVerifierReport } from "./experiments/runVerifierFeedback.js";
import { RunRecord, TransitionRecommendation } from "../types.js";
import type { ResultsTableSchema } from "./analysis/resultsTableSchema.js";

export interface AnalysisMetricEntry {
  key: string;
  value: number;
}

export interface AnalysisComparisonMetric {
  key: string;
  value: number;
  primary_value?: number;
  baseline_value?: number;
}

export interface AnalysisConditionComparison {
  id: string;
  label: string;
  source:
    | "metrics.comparison"
    | "metrics.condition_metrics"
    | "metrics.results"
    | "metrics.result_rows"
    | "metrics.recipes"
    | "metrics.conditions"
    | "metrics.condition_results"
    | "metrics.condition_summaries"
    | "metrics.condition_aggregates"
    | "metrics.per_condition"
    | "metrics.per_condition_average_accuracy";
  metrics: AnalysisComparisonMetric[];
  hypothesis_supported?: boolean;
  summary: string;
}

export interface AnalysisShortlistedDesign {
  id?: string;
  title?: string;
  summary?: string;
}

export interface AnalysisSelectedDesign {
  id?: string;
  title?: string;
  summary?: string;
  selected_hypothesis_ids: string[];
  metrics: string[];
  baselines: string[];
  implementation_notes: string[];
  evaluation_steps: string[];
  risks: string[];
  resource_notes: string[];
  runtime_guardrail_pct?: number;
}

export interface AnalysisPlanContext {
  selected_design?: AnalysisSelectedDesign;
  shortlisted_designs: AnalysisShortlistedDesign[];
  design_notes: string[];
  implementation_notes: string[];
  evaluation_notes: string[];
  assumptions: string[];
}

export interface AnalysisExecutionSummary {
  observation_count: number;
  commands: string[];
  sources: string[];
  latest_log_file?: string;
  stderr_excerpts: string[];
}

export interface AnalysisPaperClaim {
  claim: string;
  evidence: string[];
}

export interface AnalysisFigureSpec {
  id: string;
  title: string;
  path: string;
  metric_keys: string[];
  summary: string;
}

export interface AnalysisSupplementalRun {
  profile: string;
  path?: string;
  mean_score: number;
  objective_evaluation: ObjectiveMetricEvaluation;
  metric_table: AnalysisMetricEntry[];
  sampling_profile?: {
    name?: string;
    total_trials?: number;
    executed_trials?: number;
    cached_trials?: number;
  };
  portfolio?: {
    trial_group_id: string;
    trial_group_label: string;
    execution_model: string;
  };
  summary: string;
}

export interface AnalysisExperimentPortfolioTrialGroup {
  id: string;
  label: string;
  role: "primary" | "supplemental";
  profile?: string;
  group_kind?: "aggregate" | "matrix_slice";
  source_trial_group_id?: string;
  matrix_axes?: Record<string, string>;
  status?: "pass" | "fail" | "skipped";
  expected_trials?: number;
  executed_trials?: number;
  cached_trials?: number;
  metrics_path?: string;
  objective_status?: ObjectiveMetricEvaluation["status"];
  dataset_scope: string[];
  metrics: string[];
  baselines: string[];
  notes: string[];
  summary?: string;
}

export interface AnalysisExperimentPortfolio {
  execution_model: string;
  comparison_axes: string[];
  primary_trial_group_id: string;
  total_expected_trials?: number;
  executed_trials?: number;
  cached_trials?: number;
  trial_groups: AnalysisExperimentPortfolioTrialGroup[];
}

export interface AnalysisExternalComparison {
  id: string;
  label: string;
  summary: string;
  path?: string;
  metrics: AnalysisComparisonMetric[];
}

export interface AnalysisVerifierFeedback {
  status: RunVerifierReport["status"];
  trigger: RunVerifierReport["trigger"];
  stage: RunVerifierReport["stage"];
  summary: string;
  suggested_next_action?: string;
  command?: string;
  metrics_path?: string;
  log_file?: string;
}

export interface AnalysisConfidenceInterval {
  metric_key: string;
  label: string;
  lower: number;
  upper: number;
  level: number;
  sample_size?: number;
  source: "metrics" | "condition_metrics" | "supplemental_runs";
  profile?: string;
  summary: string;
}

export interface AnalysisStatisticalEffect {
  comparison_id: string;
  metric_key: string;
  delta: number;
  direction: "positive" | "negative" | "neutral";
  summary: string;
}

export interface AnalysisStatisticalSummary {
  total_trials?: number;
  executed_trials?: number;
  cached_trials?: number;
  confidence_intervals: AnalysisConfidenceInterval[];
  stability_metrics: AnalysisMetricEntry[];
  effect_estimates: AnalysisStatisticalEffect[];
  notes: string[];
}

export interface AnalysisFailureCategory {
  id: string;
  category: "runtime_failure" | "objective_gap" | "missing_artifact" | "evidence_gap" | "scope_limit";
  severity: "high" | "medium" | "low";
  status: "observed" | "risk";
  summary: string;
  evidence: string[];
  recommended_action?: string;
}

export interface AnalysisSynthesis {
  source: "llm" | "fallback";
  discussion_points: string[];
  failure_analysis: string[];
  follow_up_actions: string[];
  confidence_statement: string;
  fallback_reason?: string;
}

export interface AnalysisReport {
  analysis_version: 1;
  generated_at: string;
  mean_score: number;
  metrics: Record<string, unknown>;
  objective_metric: {
    raw: string;
    evaluation: ObjectiveMetricEvaluation;
    profile: {
      source: ObjectiveMetricProfile["source"];
      primary_metric?: string;
      preferred_metric_keys: string[];
      target_description?: string;
      analysis_focus: string[];
      paper_emphasis: string[];
      assumptions: string[];
    };
  };
  overview: {
    objective_status: ObjectiveMetricEvaluation["status"];
    objective_summary: string;
    matched_metric_key?: string;
    observed_value?: number;
    target_description?: string;
    selected_design_title?: string;
    execution_runs: number;
    top_metric?: AnalysisMetricEntry;
  };
  plan_context: AnalysisPlanContext;
  experiment_portfolio?: AnalysisExperimentPortfolio;
  metric_table: AnalysisMetricEntry[];
  results_table?: ResultsTableSchema;
  condition_comparisons: AnalysisConditionComparison[];
  execution_summary: AnalysisExecutionSummary;
  primary_findings: string[];
  limitations: string[];
  warnings: string[];
  paper_claims: AnalysisPaperClaim[];
  figure_specs: AnalysisFigureSpec[];
  verifier_feedback?: AnalysisVerifierFeedback;
  supplemental_runs: AnalysisSupplementalRun[];
  supplemental_expectation?: {
    applicable: boolean;
    profiles: string[];
    reason?: string;
  };
  external_comparisons: AnalysisExternalComparison[];
  statistical_summary: AnalysisStatisticalSummary;
  failure_taxonomy: AnalysisFailureCategory[];
  synthesis?: AnalysisSynthesis;
  transition_recommendation?: TransitionRecommendation;
}

interface ExecutionObservation {
  command?: string;
  source?: string;
  status?: string;
  stderr?: string;
  log_file?: string;
}

interface BuildAnalysisReportArgs {
  run: Pick<RunRecord, "objectiveMetric">;
  metrics: Record<string, unknown>;
  objectiveProfile: ObjectiveMetricProfile;
  objectiveEvaluation: ObjectiveMetricEvaluation;
  experimentPlanRaw?: string;
  observationsRaw?: string;
  performanceFigurePath?: string;
  inputWarnings?: string[];
  runVerifierReport?: RunVerifierReport;
  experimentPortfolio?: ExperimentPortfolio;
  runManifest?: ExperimentRunManifest;
  supplementalMetrics?: Array<{
    profile: string;
    path?: string;
    metrics: Record<string, unknown>;
  }>;
  supplementalExpectation?: {
    applicable: boolean;
    profiles: string[];
    reason?: string;
  };
  recentPaperComparison?: Record<string, unknown>;
  recentPaperComparisonPath?: string;
}

const DEFAULT_FIGURE_PATH = "figures/performance.svg";

export function buildAnalysisReport(args: BuildAnalysisReportArgs): AnalysisReport {
  const metricTable = sortMetricTable(flattenNumericMetrics(args.metrics), args.objectiveEvaluation.matchedMetricKey);
  const meanScore = computeMeanScore(args.metrics);
  const planContext = parseExperimentPlan(args.experimentPlanRaw || "");
  const executionSummary = summarizeObservations(args.observationsRaw || "");
  const conditionComparisons = buildConditionComparisons(
    args.metrics,
    args.objectiveEvaluation,
    args.objectiveProfile
  );
  const warnings = buildWarnings({
    objectiveEvaluation: args.objectiveEvaluation,
    metricTable,
    executionSummary,
    planContext,
    inputWarnings: args.inputWarnings || [],
    verifierFeedback: args.runVerifierReport,
    supplementalRuns: args.supplementalMetrics || [],
    supplementalExpectation: args.supplementalExpectation
  });
  const limitations = buildLimitations(planContext, warnings);
  const topMetric = metricTable[0];
  const verifierFeedback = normalizeVerifierFeedback(args.runVerifierReport);
  const experimentPortfolio = buildExperimentPortfolioSummary(
    args.experimentPortfolio || args.runManifest?.portfolio,
    args.runManifest
  );
  const supplementalRuns = buildSupplementalRuns({
    runs: args.supplementalMetrics || [],
    runManifest: args.runManifest,
    objectiveProfile: args.objectiveProfile,
    rawObjectiveMetric: args.run.objectiveMetric
  });
  const externalComparisons = buildExternalComparisons({
    metrics: args.metrics,
    recentPaperComparison: args.recentPaperComparison,
    recentPaperComparisonPath: args.recentPaperComparisonPath,
    objectiveEvaluation: args.objectiveEvaluation
  });
  const statisticalSummary = buildStatisticalSummary({
    metrics: args.metrics,
    objectiveEvaluation: args.objectiveEvaluation,
    objectiveProfile: args.objectiveProfile,
    conditionComparisons,
    supplementalMetrics: args.supplementalMetrics || [],
    supplementalExpectation: args.supplementalExpectation
  });
  const executionRuns =
    typeof experimentPortfolio?.executed_trials === "number"
      ? experimentPortfolio.executed_trials
      : typeof statisticalSummary.executed_trials === "number"
      ? statisticalSummary.executed_trials
      : executionSummary.observation_count;
  const failureTaxonomy = buildFailureTaxonomy({
    objectiveEvaluation: args.objectiveEvaluation,
    metricTable,
    planContext,
    warnings,
    verifierFeedback,
    supplementalRuns,
    statisticalSummary,
    supplementalExpectation: args.supplementalExpectation
  });
  const figureSpecs = buildFigureSpecs(
    metricTable,
    args.objectiveEvaluation.matchedMetricKey,
    args.performanceFigurePath || DEFAULT_FIGURE_PATH
  );
  const primaryFindings = buildPrimaryFindings({
    objectiveEvaluation: args.objectiveEvaluation,
    planContext,
    executionSummary,
    topMetric,
    conditionComparisons,
    warnings,
    verifierFeedback,
    supplementalRuns,
    externalComparisons,
    statisticalSummary,
    failureTaxonomy,
    experimentPortfolio
  });
  const paperClaims = buildPaperClaims(primaryFindings, planContext, conditionComparisons, externalComparisons);

  return {
    analysis_version: 1,
    generated_at: new Date().toISOString(),
    mean_score: meanScore,
    metrics: args.metrics,
    objective_metric: {
      raw: args.run.objectiveMetric,
      evaluation: args.objectiveEvaluation,
      profile: {
        source: args.objectiveProfile.source,
        primary_metric: args.objectiveProfile.primaryMetric,
        preferred_metric_keys: args.objectiveProfile.preferredMetricKeys,
        target_description: args.objectiveProfile.targetDescription,
        analysis_focus: args.objectiveProfile.analysisFocus,
        paper_emphasis: args.objectiveProfile.paperEmphasis,
        assumptions: args.objectiveProfile.assumptions
      }
    },
    overview: {
      objective_status: args.objectiveEvaluation.status,
      objective_summary: args.objectiveEvaluation.summary,
      matched_metric_key: args.objectiveEvaluation.matchedMetricKey,
      observed_value: args.objectiveEvaluation.observedValue,
      target_description: args.objectiveProfile.targetDescription,
      selected_design_title: planContext.selected_design?.title,
      execution_runs: executionRuns,
      top_metric: topMetric
    },
    plan_context: planContext,
    experiment_portfolio: experimentPortfolio,
    metric_table: metricTable,
    results_table: [],
    condition_comparisons: conditionComparisons,
    execution_summary: executionSummary,
    primary_findings: primaryFindings,
    limitations,
    warnings,
    paper_claims: paperClaims,
    figure_specs: figureSpecs,
    verifier_feedback: verifierFeedback,
    supplemental_runs: supplementalRuns,
    supplemental_expectation: args.supplementalExpectation,
    external_comparisons: externalComparisons,
    statistical_summary: statisticalSummary,
    failure_taxonomy: failureTaxonomy
  };
}

export function renderPerformanceFigureSvg(report: AnalysisReport): string | undefined {
  const selectedMetrics = pickFigureMetrics(
    report.metric_table,
    report.objective_metric.evaluation.matchedMetricKey
  );
  if (selectedMetrics.length === 0) {
    return undefined;
  }

  const width = 720;
  const height = 160 + selectedMetrics.length * 56;
  const maxValue = Math.max(...selectedMetrics.map((entry) => Math.abs(entry.value)), 1);
  const left = 220;
  const right = 650;
  const barArea = right - left;

  const bars = selectedMetrics
    .map((entry, index) => {
      const y = 88 + index * 56;
      const normalized = Math.max(0, Math.min(1, Math.abs(entry.value) / maxValue));
      const barWidth = Math.max(8, Math.round(barArea * normalized));
      const fill =
        entry.key === report.objective_metric.evaluation.matchedMetricKey ? "#0F766E" : "#2563EB";
      const label = escapeXml(shortenKey(entry.key));
      return [
        `<text x="28" y="${y + 22}" font-size="16" fill="#0F172A">${label}</text>`,
        `<rect x="${left}" y="${y}" width="${barArea}" height="22" rx="8" fill="#E2E8F0" />`,
        `<rect x="${left}" y="${y}" width="${barWidth}" height="22" rx="8" fill="${fill}" />`,
        `<text x="${left + barWidth + 12}" y="${y + 17}" font-size="15" fill="#334155">${formatMetricValue(entry.value)}</text>`
      ].join("");
    })
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#F8FAFC" />',
    '<text x="28" y="40" font-size="26" font-weight="700" fill="#0F172A">Experiment Metric Overview</text>',
    `<text x="28" y="66" font-size="15" fill="#475569">${escapeXml(report.overview.objective_summary)}</text>`,
    bars,
    "</svg>"
  ].join("");
}

export function parseAnalysisReport(raw: string): AnalysisReport | undefined {
  if (!raw.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as AnalysisReport;
  } catch {
    return undefined;
  }
}

function parseExperimentPlan(raw: string): AnalysisPlanContext {
  if (!raw.trim()) {
    return {
      shortlisted_designs: [],
      design_notes: [],
      implementation_notes: [],
      evaluation_notes: [],
      assumptions: []
    };
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch {
    return {
      shortlisted_designs: [],
      design_notes: [],
      implementation_notes: [],
      evaluation_notes: [],
      assumptions: []
    };
  }

  const root = asRecord(parsed);
  const selectedDesignRaw = asRecord(root.selected_design);
  const confirmatory = asRecord(selectedDesignRaw.confirmatory_extension);
  const selectedDesign =
    Object.keys(selectedDesignRaw).length > 0
      ? {
          id: asString(selectedDesignRaw.id),
          title: asString(selectedDesignRaw.title),
          summary: asString(selectedDesignRaw.summary),
          selected_hypothesis_ids: asStringList(root.selected_hypothesis_ids),
          metrics: uniqueStrings([
            ...asStringList(selectedDesignRaw.metrics),
            ...asStringList(confirmatory.additional_metrics_and_protocol)
          ]),
          baselines: uniqueStrings([
            ...asStringList(selectedDesignRaw.baselines),
            ...asStringList(confirmatory.additional_baselines)
          ]),
          implementation_notes: asStringList(selectedDesignRaw.implementation_notes),
          evaluation_steps: uniqueStrings([
            ...asStringList(selectedDesignRaw.evaluation_steps),
            ...asStringList(confirmatory.evaluation_steps)
          ]),
          risks: filterResolvedRuntimeThresholdRisks(
            uniqueStrings([
            ...asStringList(selectedDesignRaw.risks),
            ...asStringList(confirmatory.risks)
            ]),
            extractRuntimeGuardrailPct(selectedDesignRaw, confirmatory)
          ),
          resource_notes: uniqueStrings([
            ...asStringList(selectedDesignRaw.resource_notes),
            ...asStringList(confirmatory.resource_notes)
          ]),
          runtime_guardrail_pct: extractRuntimeGuardrailPct(selectedDesignRaw, confirmatory)
        }
      : undefined;

  return {
    selected_design: selectedDesign,
    shortlisted_designs: asArray(root.shortlisted_designs)
      .map((item) => asRecord(item))
      .map((item) => ({
        id: asString(item.id),
        title: asString(item.title),
        summary: asString(item.summary)
      }))
      .filter((item) => item.id || item.title || item.summary),
    design_notes: asStringList(asRecord(root.constraints).design_notes),
    implementation_notes: asStringList(asRecord(root.constraints).implementation_notes),
    evaluation_notes: asStringList(asRecord(root.constraints).evaluation_notes),
    assumptions: asStringList(asRecord(root.constraints).assumptions)
  };
}

function summarizeObservations(raw: string): AnalysisExecutionSummary {
  const observations = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ExecutionObservation;
      } catch {
        return undefined;
      }
    })
    .filter((item): item is ExecutionObservation => item !== undefined);

  return {
    observation_count: observations.length,
    commands: uniqueStrings(observations.map((item) => item.command).filter((item): item is string => Boolean(item))),
    sources: uniqueStrings(observations.map((item) => item.source).filter((item): item is string => Boolean(item))),
    latest_log_file: observations.map((item) => item.log_file).filter((item): item is string => Boolean(item)).at(-1),
    stderr_excerpts: uniqueStrings(
      observations
        .map((item) => truncateOneLine(item.stderr || "", 160))
        .filter((item) => Boolean(item))
    )
  };
}

function buildConditionComparisons(
  metrics: Record<string, unknown>,
  objectiveEvaluation: ObjectiveMetricEvaluation,
  objectiveProfile: ObjectiveMetricProfile
): AnalysisConditionComparison[] {
  const comparisons: AnalysisConditionComparison[] = [];
  const comparisonRoot = asRecord(metrics.comparison);

  for (const [comparisonId, raw] of Object.entries(comparisonRoot)) {
    const entry = asRecord(raw);
    const metricEntries = flattenNumericMetrics(entry).map((item) => ({
      key: item.key,
      value: item.value
    }));
    if (metricEntries.length === 0) {
      continue;
    }
    const hypothesisSupported =
      typeof entry.hypothesis_supported === "boolean" ? entry.hypothesis_supported : undefined;
    const headline = metricEntries
      .slice(0, 3)
      .map((item) => `${item.key}=${formatMetricValue(item.value)}`)
      .join(", ");
    comparisons.push({
      id: comparisonId,
      label: humanizeComparisonLabel(comparisonId),
      source: "metrics.comparison",
      metrics: metricEntries,
      hypothesis_supported: hypothesisSupported,
      summary: hypothesisSupported === undefined
        ? `${humanizeComparisonLabel(comparisonId)}: ${headline}.`
        : `${humanizeComparisonLabel(comparisonId)}: ${headline}. Hypothesis supported=${hypothesisSupported}.`
    });
  }

  const conditionMetrics = asRecord(metrics.condition_metrics);
  const conditionNames = Object.keys(conditionMetrics);
  if (conditionNames.length >= 2) {
    const preferredKeys = uniqueStrings(
      [
        objectiveEvaluation.matchedMetricKey,
        objectiveProfile.primaryMetric,
        ...objectiveProfile.preferredMetricKeys
      ].filter((item): item is string => Boolean(item))
    );
    const primaryCondition = selectPrimaryCondition({
      metrics,
      conditionMetrics,
      conditionNames,
      preferredKeys,
      direction: objectiveProfile.direction
    });
    const baselineCondition = selectBaselineCondition({
      metrics,
      conditionMetrics,
      conditionNames,
      primaryCondition,
      preferredKeys,
      direction: objectiveProfile.direction
    });

    if (primaryCondition) {
      const orderedComparators = orderComparatorConditions(conditionNames, primaryCondition, baselineCondition);
      for (const comparatorCondition of orderedComparators) {
        const pair = buildConditionMetricPair({
          conditionMetrics,
          primaryCondition,
          comparatorCondition,
          preferredKeys
        });
        if (!pair) {
          continue;
        }
        comparisons.push(pair);
      }
    }
  }

  if (comparisons.length === 0) {
    const resultsComparison = buildResultsArrayConditionComparison({
      metrics,
      objectiveEvaluation,
      objectiveProfile
    });
    if (resultsComparison) {
      comparisons.push(resultsComparison);
    }
  }

  if (comparisons.length === 0) {
    const recipesComparison = buildRecipesConditionComparison({
      metrics,
      objectiveEvaluation,
      objectiveProfile
    });
    if (recipesComparison) {
      comparisons.push(recipesComparison);
    }
  }

  if (comparisons.length === 0) {
    const conditionsComparison = buildConditionsArrayConditionComparison({
      metrics,
      objectiveEvaluation,
      objectiveProfile
    });
    if (conditionsComparison) {
      comparisons.push(conditionsComparison);
    }
  }

  return comparisons;
}

function buildWarnings(args: {
  objectiveEvaluation: ObjectiveMetricEvaluation;
  metricTable: AnalysisMetricEntry[];
  executionSummary: AnalysisExecutionSummary;
  planContext: AnalysisPlanContext;
  inputWarnings: string[];
  verifierFeedback?: RunVerifierReport;
  supplementalRuns: Array<{ profile: string; metrics: Record<string, unknown> }>;
  supplementalExpectation?: {
    applicable: boolean;
    profiles: string[];
    reason?: string;
  };
}): string[] {
  const warnings: string[] = [...args.inputWarnings];
  if (args.metricTable.length === 0) {
    warnings.push("No numeric metrics were available for structured result analysis.");
  }
  if (args.executionSummary.observation_count === 0) {
    warnings.push("No execution observations were available; analysis is based on metrics.json alone.");
  }
  if (!args.planContext.selected_design) {
    warnings.push("Experiment plan context was missing, so design-aware comparisons are limited.");
  }
  if (args.executionSummary.stderr_excerpts.length > 0) {
    warnings.push(`Execution stderr was recorded: ${args.executionSummary.stderr_excerpts[0]}`);
  }
  if (args.objectiveEvaluation.status === "missing" || args.objectiveEvaluation.status === "unknown") {
    warnings.push(args.objectiveEvaluation.summary);
  }
  if (args.verifierFeedback?.status === "fail") {
    warnings.push(`Run verifier reported failure at ${args.verifierFeedback.stage}: ${args.verifierFeedback.summary}`);
  }
  if (args.supplementalRuns.length === 0 && args.supplementalExpectation?.applicable !== false) {
    warnings.push("No supplemental quick_check or confirmatory metrics were available for deeper comparison.");
  }
  return warnings;
}

function buildLimitations(planContext: AnalysisPlanContext, warnings: string[]): string[] {
  const designRisks = planContext.selected_design?.risks || [];
  const resourceNotes = planContext.selected_design?.resource_notes || [];
  return uniqueStrings([
    ...designRisks,
    ...resourceNotes,
    ...planContext.assumptions,
    ...warnings
  ]).slice(0, 6);
}

function buildPrimaryFindings(args: {
  objectiveEvaluation: ObjectiveMetricEvaluation;
  planContext: AnalysisPlanContext;
  executionSummary: AnalysisExecutionSummary;
  topMetric?: AnalysisMetricEntry;
  conditionComparisons: AnalysisConditionComparison[];
  warnings: string[];
  verifierFeedback?: AnalysisVerifierFeedback;
  supplementalRuns: AnalysisSupplementalRun[];
  externalComparisons: AnalysisExternalComparison[];
  statisticalSummary: AnalysisStatisticalSummary;
  failureTaxonomy: AnalysisFailureCategory[];
  experimentPortfolio?: AnalysisExperimentPortfolio;
}): string[] {
  const findings: string[] = [args.objectiveEvaluation.summary];
  const executedTrials = args.statisticalSummary.executed_trials;

  if (args.planContext.selected_design?.title) {
    findings.push(
      `Selected design "${args.planContext.selected_design.title}" was analyzed${
        typeof executedTrials === "number"
          ? executedTrials > 0
            ? ` with ${executedTrials} executed trial(s).`
            : args.executionSummary.observation_count > 0
              ? ` with ${args.executionSummary.observation_count} recorded runner observation(s) and 0 executed trial(s).`
              : "."
          : args.executionSummary.observation_count > 0
            ? ` with ${args.executionSummary.observation_count} recorded runner observation(s).`
            : "."
      }`
    );
  }

  if (typeof args.planContext.selected_design?.runtime_guardrail_pct === "number") {
    findings.push(
      `The selected design preset a practical runtime-increase guardrail of ${formatMetricValue(
        args.planContext.selected_design.runtime_guardrail_pct
      )}% before analysis.`
    );
  }

  if ((args.experimentPortfolio?.trial_groups.length || 0) > 1) {
    findings.push(
      `Execution portfolio (${args.experimentPortfolio?.execution_model}) tracked ${
        args.experimentPortfolio?.trial_groups.length || 0
      } trial group(s): ${args.experimentPortfolio?.trial_groups
        .map((group) => `${group.profile || group.label} ${group.status || "planned"}`)
        .join(", ")}.`
    );
  }

  if (args.conditionComparisons.length > 0) {
    findings.push(args.conditionComparisons[0].summary);
  }

  if (args.supplementalRuns.length > 0) {
    findings.push(args.supplementalRuns[0].summary);
  }

  if (args.externalComparisons.length > 0) {
    findings.push(args.externalComparisons[0].summary);
  }

  if (args.statisticalSummary.notes[0]) {
    findings.push(args.statisticalSummary.notes[0]);
  }

  if (args.failureTaxonomy[0]) {
    findings.push(args.failureTaxonomy[0].summary);
  }

  if (args.topMetric && args.topMetric.key !== args.objectiveEvaluation.matchedMetricKey) {
    findings.push(
      `Additional metric highlight: ${args.topMetric.key}=${formatMetricValue(args.topMetric.value)}.`
    );
  }

  if (findings.length < 3 && args.executionSummary.commands[0]) {
    findings.push(`Primary execution command: ${args.executionSummary.commands[0]}.`);
  }

  if (findings.length < 3 && args.warnings[0]) {
    findings.push(`Analysis warning: ${args.warnings[0]}`);
  }

  if (findings.length < 4 && args.verifierFeedback?.summary) {
    findings.push(`Run verifier: ${args.verifierFeedback.summary}`);
  }

  return uniqueStrings(findings);
}

function buildPaperClaims(
  primaryFindings: string[],
  planContext: AnalysisPlanContext,
  conditionComparisons: AnalysisConditionComparison[],
  externalComparisons: AnalysisExternalComparison[]
): AnalysisPaperClaim[] {
  const claims: AnalysisPaperClaim[] = primaryFindings.slice(0, 2).map((claim, index) => ({
    claim,
    evidence: index === 0
      ? ["objective_metric.evaluation.summary"]
      : ["primary_findings"]
  }));

  if (planContext.selected_design?.summary) {
    claims.push({
      claim: `Experiment design summary: ${planContext.selected_design.summary}`,
      evidence: ["plan_context.selected_design.summary"]
    });
  }

  if (conditionComparisons[0]) {
    claims.push({
      claim: conditionComparisons[0].summary,
      evidence: ["condition_comparisons[0].summary"]
    });
  }

  if (externalComparisons[0]) {
    claims.push({
      claim: externalComparisons[0].summary,
      evidence: ["external_comparisons[0].summary"]
    });
  }

  return claims.slice(0, 4);
}

function buildFigureSpecs(
  metricTable: AnalysisMetricEntry[],
  matchedMetricKey: string | undefined,
  performanceFigurePath: string
): AnalysisFigureSpec[] {
  const selectedMetrics = pickFigureMetrics(metricTable, matchedMetricKey);
  if (selectedMetrics.length === 0) {
    return [];
  }

  return [
    {
      id: "performance_overview",
      title: "Performance overview",
      path: performanceFigurePath,
      metric_keys: selectedMetrics.map((item) => item.key),
      summary: `Visualizes ${selectedMetrics.map((item) => item.key).join(", ")}.`
    }
  ];
}

function pickFigureMetrics(
  metricTable: AnalysisMetricEntry[],
  matchedMetricKey: string | undefined
): AnalysisMetricEntry[] {
  const preferred = metricTable.filter(
    (item) => item.key === matchedMetricKey || isLikelyPerformanceMetric(item.key, item.value)
  );
  const source = preferred.length > 0 ? preferred : metricTable;
  return source
    .filter((item) => Number.isFinite(item.value) && item.value >= 0)
    .slice(0, 5);
}

function sortMetricTable(metricTable: AnalysisMetricEntry[], matchedMetricKey: string | undefined): AnalysisMetricEntry[] {
  return [...metricTable].sort((left, right) => {
    const leftPriority = left.key === matchedMetricKey ? 1 : 0;
    const rightPriority = right.key === matchedMetricKey ? 1 : 0;
    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }
    const leftPerformance = isLikelyPerformanceMetric(left.key, left.value) ? 1 : 0;
    const rightPerformance = isLikelyPerformanceMetric(right.key, right.value) ? 1 : 0;
    if (leftPerformance !== rightPerformance) {
      return rightPerformance - leftPerformance;
    }
    const magnitude = Math.abs(right.value) - Math.abs(left.value);
    if (magnitude !== 0) {
      return magnitude;
    }
    return left.key.localeCompare(right.key);
  });
}

function normalizeVerifierFeedback(report: RunVerifierReport | undefined): AnalysisVerifierFeedback | undefined {
  if (!report) {
    return undefined;
  }
  return {
    status: report.status,
    trigger: report.trigger,
    stage: report.stage,
    summary: report.summary,
    suggested_next_action: report.suggested_next_action,
    command: report.command,
    metrics_path: report.metrics_path,
    log_file: report.log_file
  };
}

function buildSupplementalRuns(args: {
  runs: Array<{ profile: string; path?: string; metrics: Record<string, unknown> }>;
  runManifest?: ExperimentRunManifest;
  objectiveProfile: ObjectiveMetricProfile;
  rawObjectiveMetric: string;
}): AnalysisSupplementalRun[] {
  const portfolioGroupsByProfile = new Map(
    (args.runManifest?.trial_groups || [])
      .filter(
        (group) =>
          group.role === "supplemental"
          && group.group_kind !== "matrix_slice"
          && typeof group.profile === "string"
      )
      .map((group) => [group.profile as string, group])
  );
  return args.runs
    .map((item) => {
      const metricTable = sortMetricTable(
        flattenNumericMetrics(item.metrics),
        findMatchingMetricKey(flattenNumericMetrics(item.metrics), args.objectiveProfile)
      );
      const objectiveEvaluation = evaluateObjectiveMetric(
        item.metrics,
        args.objectiveProfile,
        args.rawObjectiveMetric
      );
      const sampling = asRecord(item.metrics.sampling_profile);
      const portfolioGroup = portfolioGroupsByProfile.get(item.profile);
      return {
        profile: item.profile,
        path: portfolioGroup?.metrics_path || item.path,
        mean_score: computeMeanScore(item.metrics),
        objective_evaluation: objectiveEvaluation,
        metric_table: metricTable.slice(0, 6),
        sampling_profile: {
          name: asString(sampling.name),
          total_trials: asNumber(sampling.total_trials),
          executed_trials: asNumber(sampling.executed_trials),
          cached_trials: asNumber(sampling.cached_trials)
        },
        portfolio: portfolioGroup && args.runManifest
          ? {
              trial_group_id: portfolioGroup.id,
              trial_group_label: portfolioGroup.label,
              execution_model: args.runManifest.execution_model
            }
          : undefined,
        summary: buildSupplementalRunSummary(
          item.profile,
          objectiveEvaluation,
          sampling,
          portfolioGroup?.metrics_path || item.path
        )
      };
    })
    .sort((left, right) => left.profile.localeCompare(right.profile));
}

function buildExperimentPortfolioSummary(
  portfolio: ExperimentPortfolio | undefined,
  runManifest: ExperimentRunManifest | undefined
): AnalysisExperimentPortfolio | undefined {
  if (!portfolio) {
    return undefined;
  }

  const manifestGroups = new Map(
    (runManifest?.trial_groups || []).map((group) => [group.id, group])
  );

  return {
    execution_model: runManifest?.execution_model || portfolio.execution_model,
    comparison_axes: portfolio.comparison_axes,
    primary_trial_group_id: portfolio.primary_trial_group_id,
    total_expected_trials: runManifest?.total_expected_trials ?? portfolio.total_expected_trials,
    executed_trials: runManifest?.executed_trials,
    cached_trials: runManifest?.cached_trials,
    trial_groups: portfolio.trial_groups.map((group) => {
      const execution = manifestGroups.get(group.id);
      return {
        id: group.id,
        label: group.label,
        role: group.role,
        profile: group.profile,
        group_kind: group.group_kind,
        source_trial_group_id: group.source_trial_group_id,
        matrix_axes: group.matrix_axes,
        status: execution?.status,
        expected_trials: execution?.expected_trials ?? group.expected_trials,
        executed_trials: execution?.sampling_profile?.executed_trials,
        cached_trials: execution?.sampling_profile?.cached_trials,
        metrics_path: execution?.metrics_path,
        objective_status: execution?.objective_evaluation?.status,
        dataset_scope: group.dataset_scope,
        metrics: group.metrics,
        baselines: group.baselines,
        notes: group.notes,
        summary: execution?.summary
      };
    })
  };
}

function buildExternalComparisons(args: {
  metrics: Record<string, unknown>;
  recentPaperComparison?: Record<string, unknown>;
  recentPaperComparisonPath?: string;
  objectiveEvaluation: ObjectiveMetricEvaluation;
}): AnalysisExternalComparison[] {
  const comparisons: AnalysisExternalComparison[] = [];
  const recentComparison = args.recentPaperComparison || asRecord(args.metrics.recent_paper_reproducibility);
  if (Object.keys(recentComparison).length === 0) {
    return comparisons;
  }

  const bestRecentScore = asNumber(recentComparison.best_recent_score);
  const comparisonCount = asNumber(recentComparison.comparison_count);
  const paperWindow = asRecord(recentComparison.paper_year_window);
  const windowFrom = asNumber(paperWindow.from);
  const windowTo = asNumber(paperWindow.to);
  const observed = args.objectiveEvaluation.observedValue;
  const gap =
    typeof observed === "number" && typeof bestRecentScore === "number"
      ? Number((observed - bestRecentScore).toFixed(4))
      : asNumber(asRecord(args.metrics.comparison).shared_state_gap_vs_best_recent_paper);

  const metrics: AnalysisComparisonMetric[] = [];
  if (typeof bestRecentScore === "number") {
    metrics.push({ key: "best_recent_score", value: bestRecentScore });
  }
  if (typeof gap === "number") {
    metrics.push({ key: "current_gap", value: gap });
  }
  if (typeof comparisonCount === "number") {
    metrics.push({ key: "comparison_count", value: comparisonCount });
  }

  const windowLabel =
    typeof windowFrom === "number" && typeof windowTo === "number" ? `${windowFrom}-${windowTo}` : "recent years";
  const summaryParts = [
    typeof bestRecentScore === "number"
      ? `Best recent paper score=${formatMetricValue(bestRecentScore)}`
      : undefined,
    typeof gap === "number" ? `current gap=${formatMetricValue(gap)}` : undefined,
    typeof comparisonCount === "number" ? `comparison_count=${comparisonCount}` : undefined
  ].filter((item): item is string => Boolean(item));

  comparisons.push({
    id: "recent_paper_reproducibility",
    label: `Recent paper comparison (${windowLabel})`,
    summary: `Recent paper comparison (${windowLabel}): ${summaryParts.join(", ")}.`,
    path: args.recentPaperComparisonPath,
    metrics
  });

  return comparisons;
}

function buildStatisticalSummary(args: {
  metrics: Record<string, unknown>;
  objectiveEvaluation: ObjectiveMetricEvaluation;
  objectiveProfile: ObjectiveMetricProfile;
  conditionComparisons: AnalysisConditionComparison[];
  supplementalMetrics: Array<{ profile: string; path?: string; metrics: Record<string, unknown> }>;
  supplementalExpectation?: {
    applicable: boolean;
    profiles: string[];
    reason?: string;
  };
}): AnalysisStatisticalSummary {
  const sampling = asRecord(args.metrics.sampling_profile);
  const totalTrials =
    asNumber(sampling.total_trials) ??
    firstNumber(args.metrics, [
      "total_trials",
      "required_run_count",
      "required_trial_count",
      "planned_run_count",
      "planned_trial_count",
      "expected_run_count",
      "expected_trial_count"
    ]);
  const primaryExecutedTrials =
    asNumber(sampling.executed_trials) ??
    firstNumber(args.metrics, [
      "executed_trials",
      "completed_run_count",
      "completed_trial_count",
      "successful_run_count",
      "successful_trial_count"
    ]);
  const supplementalExecutedTrials = args.supplementalMetrics.reduce((total, item) => {
    const supplementalSampling = asRecord(item.metrics.sampling_profile);
    const explicitExecuted = asNumber(supplementalSampling.executed_trials);
    if (typeof explicitExecuted === "number") {
      return total + explicitExecuted;
    }
    const status = asString(item.metrics.status)?.toLowerCase();
    const objectiveStatus = asString(asRecord(item.metrics.objective_evaluation).status)?.toLowerCase();
    const completed =
      !status ||
      /^(ok|success|completed|complete|pass|passed)$/u.test(status) ||
      /^(met|observed|pass|passed)$/u.test(objectiveStatus || "");
    return completed ? total + 1 : total;
  }, 0);
  const executedTrials =
    typeof primaryExecutedTrials === "number"
      ? primaryExecutedTrials + supplementalExecutedTrials
      : supplementalExecutedTrials > 0
        ? 1 + supplementalExecutedTrials
        : undefined;
  const cachedTrials =
    asNumber(sampling.cached_trials) ??
    firstNumber(args.metrics, ["cached_trials", "cached_run_count", "cached_trial_count"]);
  const preferredKeys = uniqueStrings(
    [
      args.objectiveEvaluation.matchedMetricKey,
      args.objectiveProfile.primaryMetric,
      ...args.objectiveProfile.preferredMetricKeys
    ].filter((item): item is string => Boolean(item))
  );

  const confidenceIntervals = sortConfidenceIntervals([
    ...extractConfidenceIntervals({
      value: args.metrics,
      sampleSize: totalTrials
    }),
    ...extractConditionSummaryHalfWidthConfidenceIntervals(args.metrics),
    ...extractPredictionAccuracyConfidenceIntervals(args.metrics),
    ...args.supplementalMetrics.flatMap((item) =>
      extractConfidenceIntervals({
        value: item.metrics,
        sampleSize: asNumber(asRecord(item.metrics.sampling_profile).total_trials),
        source: "supplemental_runs",
        profile: item.profile
      })
    )
  ], preferredKeys).slice(0, 8);

  const stabilityMetrics = pickStabilityMetrics(args.metrics);
  const effectEstimates = buildStatisticalEffects(args.conditionComparisons, args.objectiveProfile);
  const notes = buildStatisticalNotes({
    totalTrials,
    executedTrials,
    cachedTrials,
    confidenceIntervals,
    stabilityMetrics,
    effectEstimates,
    supplementalExpectation: args.supplementalExpectation
  });

  return {
    total_trials: totalTrials,
    executed_trials: executedTrials,
    cached_trials: cachedTrials,
    confidence_intervals: confidenceIntervals,
    stability_metrics: stabilityMetrics,
    effect_estimates: effectEstimates,
    notes
  };
}

function buildFailureTaxonomy(args: {
  objectiveEvaluation: ObjectiveMetricEvaluation;
  metricTable: AnalysisMetricEntry[];
  planContext: AnalysisPlanContext;
  warnings: string[];
  verifierFeedback?: AnalysisVerifierFeedback;
  supplementalRuns: AnalysisSupplementalRun[];
  statisticalSummary: AnalysisStatisticalSummary;
  supplementalExpectation?: {
    applicable: boolean;
    profiles: string[];
    reason?: string;
  };
}): AnalysisFailureCategory[] {
  const categories: AnalysisFailureCategory[] = [];

  if (args.verifierFeedback?.status === "fail") {
    categories.push({
      id: "runtime_failure",
      category: "runtime_failure",
      severity: "high",
      status: "observed",
      summary: `Runtime verification failed at ${args.verifierFeedback.stage}: ${args.verifierFeedback.summary}`,
      evidence: ["verifier_feedback.summary"],
      recommended_action: args.verifierFeedback.suggested_next_action
    });
  }

  if (args.metricTable.length === 0) {
    categories.push({
      id: "missing_numeric_metrics",
      category: "missing_artifact",
      severity: "high",
      status: "observed",
      summary: "Structured analysis could not find usable numeric metrics in the run artifacts.",
      evidence: ["warnings"],
      recommended_action: "Ensure metrics.json contains numeric metrics before running analyze_results."
    });
  }

  if (args.objectiveEvaluation.status === "not_met") {
    categories.push({
      id: "objective_not_met",
      category: "objective_gap",
      severity: "high",
      status: "observed",
      summary: args.objectiveEvaluation.summary,
      evidence: ["objective_metric.evaluation.summary"],
      recommended_action: "Revise the primary condition or experiment setup and rerun until the target metric is satisfied."
    });
  }

  if (args.supplementalRuns.length === 0 && args.supplementalExpectation?.applicable !== false) {
    const hasStructuredRobustness =
      args.statisticalSummary.confidence_intervals.length > 0 ||
      args.statisticalSummary.stability_metrics.length > 0;
    categories.push({
      id: "supplemental_coverage_gap",
      category: "evidence_gap",
      severity: hasStructuredRobustness ? "low" : "medium",
      status: "risk",
      summary: hasStructuredRobustness
        ? "Supplemental confirmatory and quick-check runs are missing, but structured uncertainty or stability evidence is available for bounded claims."
        : "Supplemental confirmatory and quick-check runs are missing, so robustness across sampling profiles is still unverified.",
      evidence: ["warnings"],
      recommended_action: "Run confirmatory and quick-check profiles to validate stability."
    });
  }

  if (args.statisticalSummary.confidence_intervals.length === 0) {
    categories.push({
      id: "missing_confidence_intervals",
      category: "evidence_gap",
      severity: "medium",
      status: "risk",
      summary: "Confidence intervals are missing for the primary metrics, which limits statistical confidence.",
      evidence: ["statistical_summary.notes"],
      recommended_action: "Record repeated-trial confidence intervals for the matched metric."
    });
  }

  const scopeRisk =
    args.planContext.selected_design?.risks[0] ||
    args.planContext.selected_design?.resource_notes[0] ||
    args.planContext.assumptions[0];
  if (scopeRisk) {
    categories.push({
      id: "scope_limit",
      category: "scope_limit",
      severity: "low",
      status: "risk",
      summary: `Scope limitation: ${scopeRisk}`,
      evidence: [
        "plan_context.selected_design.risks",
        "plan_context.selected_design.resource_notes",
        "plan_context.assumptions"
      ],
      recommended_action: "Expand the evaluation scope or document the limitation explicitly in the discussion."
    });
  }

  return categories.slice(0, 6);
}

function extractRuntimeGuardrailPct(
  selectedDesignRaw: Record<string, unknown>,
  confirmatory: Record<string, unknown>
): number | undefined {
  const searchSpace = [
    ...asStringList(selectedDesignRaw.evaluation_steps),
    ...asStringList(selectedDesignRaw.risks),
    ...asStringList(confirmatory.evaluation_steps),
    ...asStringList(confirmatory.risks)
  ];
  for (const line of searchSpace) {
    const match = /(?:threshold|guardrail)[^0-9]{0,40}(\d{1,3})\s*percent/iu.exec(line);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
  }
  return undefined;
}

function filterResolvedRuntimeThresholdRisks(risks: string[], runtimeGuardrailPct?: number): string[] {
  if (typeof runtimeGuardrailPct !== "number") {
    return risks;
  }
  return risks.filter((risk) => !/threshold .*specified before analysis|runtime increase .*specified before analysis/iu.test(risk));
}

function extractConfidenceIntervals(args: {
  value: Record<string, unknown>;
  prefix?: string;
  sampleSize?: number;
  source?: "metrics" | "supplemental_runs";
  profile?: string;
}): AnalysisConfidenceInterval[] {
  const intervals: AnalysisConfidenceInterval[] = [];
  const directInterval = readDirectConfidenceInterval({
    value: args.value,
    prefix: args.prefix,
    sampleSize: args.sampleSize,
    source: args.source,
    profile: args.profile
  });
  if (directInterval) {
    intervals.push(directInterval);
  }

  for (const [key, raw] of Object.entries(args.value)) {
    const nextPrefix = args.prefix ? `${args.prefix}.${key}` : key;
    const match = key.match(/^ci(\d+)_([\w.-]+)$/iu);
    if (match && Array.isArray(raw) && raw.length === 2) {
      const lower = asNumber(raw[0]);
      const upper = asNumber(raw[1]);
      const level = normalizeConfidenceLevel(asNumber(match[1]));
      if (typeof lower === "number" && typeof upper === "number" && typeof level === "number") {
        const metricKey = args.prefix ? `${args.prefix}.${match[2]}` : match[2];
        const source =
          metricKey.startsWith("condition_metrics.") ? "condition_metrics" : args.source || "metrics";
        const label = humanizeMetricLabel(metricKey);
        intervals.push({
          metric_key: metricKey,
          label,
          lower,
          upper,
          level,
          sample_size: args.sampleSize,
          source,
          profile: args.profile,
          summary: `${label} ${formatConfidenceIntervalPercent(level)}% CI [${formatMetricValue(lower)}, ${formatMetricValue(upper)}]${
            typeof args.sampleSize === "number" ? ` over n=${args.sampleSize}` : ""
          }.`
        });
      }
      continue;
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      intervals.push(
        ...extractConfidenceIntervals({
          value: raw as Record<string, unknown>,
          prefix: nextPrefix,
          sampleSize: args.sampleSize,
          source: args.source,
          profile: args.profile
        })
      );
    }
  }

  return intervals;
}

function extractConditionSummaryHalfWidthConfidenceIntervals(
  metrics: Record<string, unknown>
): AnalysisConfidenceInterval[] {
  return asArray(metrics.condition_summaries)
    .map((item) => asRecord(item))
    .flatMap((row) => {
      const conditionName = readConditionName(row);
      return Object.entries(row)
        .map(([key, raw]) => {
          const match = key.match(/^(.+)_ci(\d{2,3})$/iu);
          const halfWidth = asNumber(raw);
          if (!match || typeof halfWidth !== "number") {
            return undefined;
          }
          const metricBase = match[1];
          const mean =
            asNumber(row[`${metricBase}_mean`]) ??
            asNumber(row[metricBase]);
          if (typeof mean !== "number") {
            return undefined;
          }
          const level = normalizeConfidenceLevel(Number(match[2])) ?? 0.95;
          const metricKey = conditionName
            ? `condition_summaries.${conditionName}.${metricBase}`
            : `condition_summaries.${metricBase}`;
          const sampleSize =
            asNumber(row[`${metricBase}_count`]) ??
            asNumber(row.completed_seed_count) ??
            asNumber(row.planned_seed_count);
          const lower = Number((mean - halfWidth).toFixed(6));
          const upper = Number((mean + halfWidth).toFixed(6));
          const label = humanizeMetricLabel(metricKey);
          const interval: AnalysisConfidenceInterval = {
            metric_key: metricKey,
            label,
            lower,
            upper,
            level,
            source: "condition_metrics" as const,
            summary: `${label} ${formatConfidenceIntervalPercent(level)}% CI [${formatMetricValue(lower)}, ${formatMetricValue(upper)}]${
              typeof sampleSize === "number" ? ` over n=${sampleSize}` : ""
            }.`
          };
          if (typeof sampleSize === "number") {
            interval.sample_size = sampleSize;
          }
          return interval;
        })
        .filter((item): item is AnalysisConfidenceInterval => item !== undefined);
    });
}

function extractPredictionAccuracyConfidenceIntervals(
  metrics: Record<string, unknown>
): AnalysisConfidenceInterval[] {
  return [
    ...conditionPredictionRows(metrics, "condition_results"),
    ...conditionPredictionRows(metrics, "conditions")
  ].flatMap(({ collection, conditionName, row }) => {
    if (!isCompletedConditionRow(row)) {
      return [];
    }
    const summaries = collectPredictionCorrectness(row);
    const aggregate = summaries.reduce(
      (acc, item) => ({
        correct: acc.correct + item.correct,
        total: acc.total + item.total
      }),
      { correct: 0, total: 0 }
    );
    if (aggregate.total === 0) {
      return [];
    }
    const interval = wilsonConfidenceInterval(aggregate.correct, aggregate.total);
    const metricKey = `${collection}.${conditionName || "condition"}.average_accuracy`;
    const label = humanizeMetricLabel(metricKey);
    return [{
      metric_key: metricKey,
      label,
      lower: interval.lower,
      upper: interval.upper,
      level: interval.level,
      sample_size: aggregate.total,
      source: "condition_metrics" as const,
      summary: `${label} ${formatConfidenceIntervalPercent(interval.level)}% CI [${formatMetricValue(interval.lower)}, ${formatMetricValue(interval.upper)}] over n=${aggregate.total} prediction(s).`
    }];
  });
}

function conditionPredictionRows(
  metrics: Record<string, unknown>,
  collection: "condition_results" | "conditions"
): Array<{ collection: string; conditionName: string; row: Record<string, unknown> }> {
  const raw = metrics[collection];
  const rows = Array.isArray(raw)
    ? raw.map((item) => asRecord(item))
    : Object.entries(asRecord(raw)).map(([name, value]) => ({
      name,
      ...asRecord(value)
    }));
  return rows
    .filter((row) => Object.keys(row).length > 0)
    .map((row, index) => ({
      collection,
      conditionName: readConditionName(row) || `condition_${index + 1}`,
      row
    }));
}

function collectPredictionCorrectness(
  value: Record<string, unknown>,
  path = ""
): Array<{ path: string; correct: number; total: number }> {
  const predictions = asArray(value.predictions)
    .map((item) => readPredictionCorrect(asRecord(item)))
    .filter((item): item is boolean => typeof item === "boolean");
  const correctCount = asNumber(value.correct);
  const totalCount = asNumber(value.total);
  const currentFromCounts =
    typeof correctCount === "number" &&
    typeof totalCount === "number" &&
    Number.isFinite(correctCount) &&
    Number.isFinite(totalCount) &&
    totalCount > 0 &&
    correctCount >= 0 &&
    correctCount <= totalCount
      ? [{
        path,
        correct: correctCount,
        total: totalCount
      }]
      : [];
  const currentFromPredictions = predictions.length > 0
    ? [{
      path,
      correct: predictions.filter(Boolean).length,
      total: predictions.length
    }]
    : [];
  const current = currentFromCounts.length > 0 ? currentFromCounts : currentFromPredictions;
  const nested = Object.entries(value)
    .filter(([key, raw]) => key !== "predictions" && raw && typeof raw === "object" && !Array.isArray(raw))
    .flatMap(([key, raw]) =>
      collectPredictionCorrectness(
        raw as Record<string, unknown>,
        path ? `${path}.${key}` : key
      )
    );
  return [...current, ...nested];
}

function readPredictionCorrect(row: Record<string, unknown>): boolean | undefined {
  const raw = row.correct;
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw !== 0;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (["true", "1", "correct", "yes", "y"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "incorrect", "no", "n"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function wilsonConfidenceInterval(
  correct: number,
  total: number,
  level = 0.95
): { lower: number; upper: number; level: number } {
  const z = 1.959963984540054;
  const p = correct / total;
  const denominator = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return {
    lower: Number(Math.max(0, (center - margin) / denominator).toFixed(6)),
    upper: Number(Math.min(1, (center + margin) / denominator).toFixed(6)),
    level
  };
}

function readDirectConfidenceInterval(args: {
  value: Record<string, unknown>;
  prefix?: string;
  sampleSize?: number;
  source?: "metrics" | "supplemental_runs";
  profile?: string;
}): AnalysisConfidenceInterval | undefined {
  const lower = firstNumber(args.value, [
    "ci_low",
    "ci95_low",
    "ci_lower",
    "lower",
    "low",
    "bootstrap_ci95_low",
    "lower_bound"
  ]);
  const upper = firstNumber(args.value, [
    "ci_high",
    "ci95_high",
    "ci_upper",
    "upper",
    "high",
    "bootstrap_ci95_high",
    "upper_bound"
  ]);
  if (typeof lower !== "number" || typeof upper !== "number") {
    return undefined;
  }

  const rawLevel =
    firstNumber(args.value, ["confidence_level", "ci_level", "level"]) ??
    inferConfidenceLevel(args.prefix);
  const level = normalizeConfidenceLevel(rawLevel) ?? 0.95;
  const metricKey =
    asString(args.value.metric_key) ||
    asString(args.value.metric) ||
    inferConfidenceIntervalMetricKey(args.prefix);
  const source = metricKey.startsWith("condition_metrics.") ? "condition_metrics" : args.source || "metrics";
  const label = humanizeMetricLabel(metricKey);

  return {
    metric_key: metricKey,
    label,
    lower,
    upper,
    level,
    sample_size: args.sampleSize,
    source,
    profile: args.profile,
    summary: `${label} ${formatConfidenceIntervalPercent(level)}% CI [${formatMetricValue(lower)}, ${formatMetricValue(upper)}]${
      typeof args.sampleSize === "number" ? ` over n=${args.sampleSize}` : ""
    }.`
  };
}

function normalizeConfidenceLevel(level: number | undefined): number | undefined {
  if (typeof level !== "number" || !Number.isFinite(level)) {
    return undefined;
  }
  return level > 1 ? Number((level / 100).toFixed(4)) : level;
}

function formatConfidenceIntervalPercent(level: number): string {
  const percent = level <= 1 ? level * 100 : level;
  return Number(percent.toFixed(2)).toString();
}

function firstNumber(value: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const numberValue = asNumber(value[key]);
    if (typeof numberValue === "number") {
      return numberValue;
    }
  }
  return undefined;
}

function inferConfidenceLevel(prefix: string | undefined): number | undefined {
  const match = prefix?.match(/(?:^|[._-])ci(\d{2,3})(?:[._-]|$)/iu);
  if (!match) {
    return undefined;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferConfidenceIntervalMetricKey(prefix: string | undefined): string {
  if (!prefix) {
    return "metric";
  }
  const parts = prefix.split(".");
  const lastPart = parts.at(-1)?.toLowerCase() ?? "";
  if (/bootstrap.*mean.*ci|mean.*confidence.*interval/u.test(lastPart)) {
    parts.pop();
    const owner = parts.join(".");
    return owner ? `${owner}.mean_zero_shot_accuracy` : "mean_zero_shot_accuracy";
  }
  if (/pooled.*bootstrap|bootstrap.*pooled/u.test(lastPart)) {
    parts.pop();
    const owner = parts.join(".");
    return owner ? `${owner}.mean_zero_shot_accuracy` : "mean_zero_shot_accuracy";
  }
  if (/bootstrap.*ci|confidence.*interval|^ci\d*$/u.test(lastPart)) {
    parts.pop();
    return parts.join(".") || prefix;
  }
  return prefix;
}

function sortConfidenceIntervals(
  intervals: AnalysisConfidenceInterval[],
  preferredKeys: string[]
): AnalysisConfidenceInterval[] {
  return [...intervals].sort((left, right) => {
    const leftPreferred = isPreferredMetricKey(left.metric_key, preferredKeys) ? 1 : 0;
    const rightPreferred = isPreferredMetricKey(right.metric_key, preferredKeys) ? 1 : 0;
    if (leftPreferred !== rightPreferred) {
      return rightPreferred - leftPreferred;
    }
    const leftSource = left.source === "metrics" ? 2 : left.source === "condition_metrics" ? 1 : 0;
    const rightSource = right.source === "metrics" ? 2 : right.source === "condition_metrics" ? 1 : 0;
    if (leftSource !== rightSource) {
      return rightSource - leftSource;
    }
    return left.metric_key.localeCompare(right.metric_key);
  });
}

function pickStabilityMetrics(metrics: Record<string, unknown>): AnalysisMetricEntry[] {
  const orderedKeys = [
    "cross_run_variance",
    "run_to_run_variance",
    "seed_stability",
    "rank_stability",
    "mean_nested_rank_stability",
    "pairwise_ranking_agreement",
    "winner_consistency",
    "sign_consistency_vs_logreg",
    "prompt_paraphrase_sensitivity",
    "paraphrase_stability",
    "replication_success_rate",
    "failure_rate",
    "artifact_consistency_rate"
  ];

  return orderedKeys
    .map((key) => {
      const value = asNumber(metrics[key]);
      return typeof value === "number" ? { key, value } : undefined;
    })
    .filter((item): item is AnalysisMetricEntry => item !== undefined);
}

function buildStatisticalEffects(
  conditionComparisons: AnalysisConditionComparison[],
  objectiveProfile: ObjectiveMetricProfile
): AnalysisStatisticalEffect[] {
  return conditionComparisons
    .map((comparison) => {
      const metric = selectEffectMetric(comparison, objectiveProfile);
      if (!metric) {
        return undefined;
      }
      const direction = classifyEffectDirection(metric.key, metric.value, objectiveProfile.direction);
      const label = humanizeMetricLabel(metric.key);
      const summary =
        direction === "neutral"
          ? `${comparison.label} is neutral on ${label} (delta ${formatMetricValue(metric.value)}).`
          : direction === "positive"
            ? `${comparison.label} improves ${label} by ${formatMetricValue(Math.abs(metric.value))}.`
            : `${comparison.label} trails on ${label} by ${formatMetricValue(Math.abs(metric.value))}.`;
      return {
        comparison_id: comparison.id,
        metric_key: metric.key,
        delta: metric.value,
        direction,
        summary
      };
    })
    .filter((item): item is AnalysisStatisticalEffect => item !== undefined)
    .slice(0, 4);
}

function buildStatisticalNotes(args: {
  totalTrials?: number;
  executedTrials?: number;
  cachedTrials?: number;
  confidenceIntervals: AnalysisConfidenceInterval[];
  stabilityMetrics: AnalysisMetricEntry[];
  effectEstimates: AnalysisStatisticalEffect[];
  supplementalExpectation?: {
    applicable: boolean;
    profiles: string[];
    reason?: string;
  };
}): string[] {
  const notes: string[] = [];

  if (typeof args.totalTrials === "number") {
    notes.push(
      `Sampling profile: total_trials=${args.totalTrials}, executed_trials=${args.executedTrials ?? 0}, cached_trials=${args.cachedTrials ?? 0}.`
    );
  }

  if (args.confidenceIntervals[0]) {
    notes.push(args.confidenceIntervals[0].summary);
  }

  if (args.stabilityMetrics.length > 0) {
    notes.push(
      `Stability signals: ${args.stabilityMetrics
        .slice(0, 3)
        .map((item) => `${item.key}=${formatMetricValue(item.value)}`)
        .join(", ")}.`
    );
  }

  if (args.effectEstimates[0]) {
    notes.push(args.effectEstimates[0].summary);
  }

  if (args.supplementalExpectation?.applicable === false && args.supplementalExpectation.reason) {
    notes.push(args.supplementalExpectation.reason);
  }

  if (args.confidenceIntervals.length === 0 && args.stabilityMetrics.length === 0) {
    notes.push("No variance or confidence-interval statistics were available in the structured metrics.");
  }

  return uniqueStrings(notes).slice(0, 6);
}

function selectPrimaryCondition(args: {
  metrics: Record<string, unknown>;
  conditionMetrics: Record<string, unknown>;
  conditionNames: string[];
  preferredKeys: string[];
  direction?: ObjectiveMetricProfile["direction"];
}): string | undefined {
  const explicit = asString(args.metrics.primary_condition);
  if (explicit && args.conditionNames.includes(explicit)) {
    return explicit;
  }

  const heuristic = args.conditionNames.find(
    (name) => isLikelyPrimaryCondition(name) && !isLikelyBaselineCondition(name)
  );
  if (heuristic) {
    return heuristic;
  }

  const byMetric = selectConditionByMetric({
    conditionMetrics: args.conditionMetrics,
    conditionNames: args.conditionNames,
    preferredKeys: args.preferredKeys,
    direction: args.direction,
    mode: "best"
  });
  return byMetric || args.conditionNames[0];
}

function selectBaselineCondition(args: {
  metrics: Record<string, unknown>;
  conditionMetrics: Record<string, unknown>;
  conditionNames: string[];
  primaryCondition?: string;
  preferredKeys: string[];
  direction?: ObjectiveMetricProfile["direction"];
}): string | undefined {
  const explicit = asString(args.metrics.baseline_condition);
  if (explicit && args.conditionNames.includes(explicit) && explicit !== args.primaryCondition) {
    return explicit;
  }

  const heuristic = args.conditionNames.find(
    (name) => name !== args.primaryCondition && isLikelyBaselineCondition(name)
  );
  if (heuristic) {
    return heuristic;
  }

  const byMetric = selectConditionByMetric({
    conditionMetrics: args.conditionMetrics,
    conditionNames: args.conditionNames.filter((name) => name !== args.primaryCondition),
    preferredKeys: args.preferredKeys,
    direction: args.direction,
    mode: "worst"
  });
  return byMetric || args.conditionNames.find((name) => name !== args.primaryCondition);
}

function orderComparatorConditions(
  conditionNames: string[],
  primaryCondition: string,
  baselineCondition: string | undefined
): string[] {
  return conditionNames
    .filter((name) => name !== primaryCondition)
    .sort((left, right) => {
      const leftBaseline = left === baselineCondition ? 1 : 0;
      const rightBaseline = right === baselineCondition ? 1 : 0;
      if (leftBaseline !== rightBaseline) {
        return rightBaseline - leftBaseline;
      }
      return left.localeCompare(right);
    });
}

function buildConditionMetricPair(args: {
  conditionMetrics: Record<string, unknown>;
  primaryCondition: string;
  comparatorCondition: string;
  preferredKeys: string[];
}): AnalysisConditionComparison | undefined {
  const primaryMetrics = flattenNumericMetrics(asRecord(args.conditionMetrics[args.primaryCondition]));
  const comparatorMetrics = new Map(
    flattenNumericMetrics(asRecord(args.conditionMetrics[args.comparatorCondition])).map((item) => [item.key, item.value])
  );

  const shared = primaryMetrics
    .filter((item) => comparatorMetrics.has(item.key))
    .map((item) => ({
      key: item.key,
      primary_value: item.value,
      baseline_value: comparatorMetrics.get(item.key) as number,
      value: Number((item.value - (comparatorMetrics.get(item.key) as number)).toFixed(4))
    }))
    .sort((left, right) => {
      const leftRank = metricPreferenceRank(left.key, args.preferredKeys);
      const rightRank = metricPreferenceRank(right.key, args.preferredKeys);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      const leftStatisticRank = preferredMetricStatisticRank(left.key, args.preferredKeys);
      const rightStatisticRank = preferredMetricStatisticRank(right.key, args.preferredKeys);
      if (leftStatisticRank !== rightStatisticRank) {
        return leftStatisticRank - rightStatisticRank;
      }
      return Math.abs(right.value) - Math.abs(left.value);
    })
    .slice(0, 4);

  if (shared.length === 0) {
    return undefined;
  }

  const sharedSummary = shared
    .map((item) => `${item.key}: ${formatMetricValue(item.primary_value)} vs ${formatMetricValue(item.baseline_value)} (delta ${formatMetricValue(item.value)})`)
    .join(", ");
  return {
    id: `${args.primaryCondition}_vs_${args.comparatorCondition}`,
    label: `${humanizeConditionLabel(args.primaryCondition)} vs ${humanizeConditionLabel(args.comparatorCondition)}`,
    source: "metrics.condition_metrics",
    metrics: shared,
    summary: `${humanizeConditionLabel(args.primaryCondition)} vs ${humanizeConditionLabel(args.comparatorCondition)}: ${sharedSummary}.`
  };
}

function hasLockedBaselineMarker(row: Record<string, unknown>): boolean {
  if (row.is_locked_baseline === true) {
    return true;
  }
  const lockedBaselineMarker = new RegExp("^is_locked_[a-z0-9]+_baseline$", "iu");
  return Object.entries(row).some(([key, value]) => value === true && lockedBaselineMarker.test(key));
}

function buildResultsArrayConditionComparison(args: {
  metrics: Record<string, unknown>;
  objectiveEvaluation: ObjectiveMetricEvaluation;
  objectiveProfile: ObjectiveMetricProfile;
}): AnalysisConditionComparison | undefined {
  const { source: resultRowsSource, rows: resultRows } = readResultRowsFromMetrics(args.metrics);
  if (resultRows.length < 2) {
    return undefined;
  }

  const baselineRow =
    resultRows.find((row) => hasLockedBaselineMarker(row) || asString(row.recipe_type)?.toLowerCase() === "locked_baseline") ||
    resultRows.find((row) => {
      const recipe = asString(row.recipe)?.toLowerCase();
      const peftType = asString(row.peft_type)?.toLowerCase();
      const conditionId = asString(row.condition_id)?.toLowerCase();
      return (
        recipe === "baseline" ||
        isLikelyBaselineCondition(recipe || "") ||
        peftType === "none" ||
        conditionId === "baseline" ||
        isLikelyBaselineCondition(conditionId || "") ||
        row.is_baseline_reference === true
      );
    });

  if (!baselineRow) {
    return undefined;
  }

  const preferredKeys = buildResultArrayPreferredKeys(args.objectiveEvaluation, args.objectiveProfile);
  const candidates = resultRows.filter((row) => row !== baselineRow);
  const bestRecipe = asString(args.metrics.best_recipe) || asString(args.metrics.best_tuned_condition_id) || asString(args.metrics.best_condition_id);
  const explicitComparator = bestRecipe
    ? candidates.find((row) => asString(row.recipe) === bestRecipe || asString(row.condition_id) === bestRecipe)
    : undefined;
  const comparatorRow =
    explicitComparator ||
    selectConditionRowByMetric({
      rows: candidates,
      preferredKeys,
      direction: args.objectiveProfile.direction
    });
  if (!comparatorRow) {
    return undefined;
  }

  const baselineMetrics = new Map(
    flattenNumericMetrics(baselineRow).map((item) => [item.key, item.value])
  );
  const shared = flattenNumericMetrics(comparatorRow)
    .filter((item) => baselineMetrics.has(item.key))
    .filter((item) => isUsefulResultArrayMetric(item.key, preferredKeys))
    .map((item) => {
      const baselineValue = baselineMetrics.get(item.key) as number;
      return {
        key: item.key,
        primary_value: item.value,
        baseline_value: baselineValue,
        value: Number((item.value - baselineValue).toFixed(4))
      };
    })
    .sort((left, right) => {
      const leftRank = metricPreferenceRank(left.key, preferredKeys);
      const rightRank = metricPreferenceRank(right.key, preferredKeys);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      const leftStatisticRank = preferredMetricStatisticRank(left.key, preferredKeys);
      const rightStatisticRank = preferredMetricStatisticRank(right.key, preferredKeys);
      if (leftStatisticRank !== rightStatisticRank) {
        return leftStatisticRank - rightStatisticRank;
      }
      return Math.abs(right.value) - Math.abs(left.value);
    })
    .slice(0, 6);

  if (shared.length === 0) {
    return undefined;
  }

  const baselineName = asString(baselineRow.recipe) || asString(baselineRow.condition_id) || "baseline";
  const comparatorName = asString(comparatorRow.recipe) || asString(comparatorRow.condition_id) || bestRecipe || "comparator";
  const sharedSummary = shared
    .slice(0, 4)
    .map((item) => `${item.key}: ${formatMetricValue(item.primary_value)} vs ${formatMetricValue(item.baseline_value)} (delta ${formatMetricValue(item.value)})`)
    .join(", ");

  return {
    id: `${comparatorName}_vs_${baselineName}`,
    label: `${humanizeConditionLabel(comparatorName)} vs ${humanizeConditionLabel(baselineName)}`,
    source: resultRowsSource,
    metrics: shared,
    summary: `${humanizeConditionLabel(comparatorName)} vs ${humanizeConditionLabel(baselineName)}: ${sharedSummary}.`
  };
}

function readResultRowsFromMetrics(metrics: Record<string, unknown>): {
  source: "metrics.results" | "metrics.result_rows";
  rows: Array<Record<string, unknown>>;
} {
  const resultsArray = asArray(metrics.results).map((item) => enrichResultRow(asRecord(item)));
  if (resultsArray.length > 0) {
    return { source: "metrics.results", rows: resultsArray };
  }

  const resultsRecord = asRecord(metrics.results);
  const objectRows = Object.entries(resultsRecord)
    .map(([name, value]) => {
      const row = { ...asRecord(value) };
      if (!asString(row.recipe)) {
        row.recipe = name;
      }
      if (!asString(row.condition_id)) {
        row.condition_id = name;
      }
      return enrichResultRow(row);
    })
    .filter((row) => Object.keys(row).length > 0);
  if (objectRows.length > 0) {
    return { source: "metrics.results", rows: objectRows };
  }

  return {
    source: "metrics.result_rows",
    rows: asArray(metrics.result_rows).map((item) => enrichResultRow(asRecord(item)))
  };
}

function enrichResultRow(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row };
  const taskAccuracies = extractTaskAccuracies(next);
  if (taskAccuracies.length >= 2 && next.mean_accuracy === undefined) {
    next.mean_accuracy = meanRounded(taskAccuracies.map((entry) => entry.accuracy));
  }
  if (taskAccuracies.length >= 2 && next.mean_zero_shot_accuracy === undefined) {
    next.mean_zero_shot_accuracy = meanRounded(taskAccuracies.map((entry) => entry.accuracy));
  }
  return next;
}

function extractTaskAccuracies(row: Record<string, unknown>): Array<{ task: string; accuracy: number }> {
  const entries: Array<{ task: string; accuracy: number }> = [];
  const seen = new Set<string>();
  const add = (task: string, value: unknown) => {
    const normalizedTask = task.trim();
    if (!normalizedTask || seen.has(normalizedTask)) {
      return;
    }
    const accuracy = asNumber(value);
    if (accuracy === undefined) {
      return;
    }
    seen.add(normalizedTask);
    entries.push({ task: normalizedTask, accuracy });
  };

  for (const container of [
    asRecord(row.evaluation),
    asRecord(row.task_accuracies),
    asRecord(row.task_reports),
    asRecord(row.tasks)
  ]) {
    for (const [task, value] of Object.entries(container)) {
      const record = asRecord(value);
      if (Object.keys(record).length > 0) {
        add(task, record.accuracy);
      } else if (/accuracy/iu.test(task)) {
        add(task.replace(/_?accuracy$/iu, ""), value);
      }
    }
  }

  return entries;
}

function meanRounded(values: number[]): number {
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function enrichConditionRow(row: Record<string, unknown>): Record<string, unknown> {
  const next = enrichResultRow(row);
  const evaluation = asRecord(next.evaluation);
  const evalMetrics = asRecord(next.eval_metrics);
  const training = asRecord(next.training);
  const parameterReport = asRecord(next.parameter_report);

  const evalMeanAccuracy = asNumber(evalMetrics.mean_accuracy);
  const evalMeanZeroShotAccuracy =
    asNumber(evaluation.mean_zero_shot_accuracy) ||
    asNumber(evalMetrics.mean_zero_shot_accuracy) ||
    asNumber(next.mean_zero_shot_accuracy);
  if (next.mean_accuracy === undefined && typeof evalMeanAccuracy === "number") {
    next.mean_accuracy = evalMeanAccuracy;
  }
  if (next.mean_zero_shot_accuracy === undefined && typeof evalMeanZeroShotAccuracy === "number") {
    next.mean_zero_shot_accuracy = evalMeanZeroShotAccuracy;
  }
  if (next.mean_accuracy === undefined && typeof evalMeanZeroShotAccuracy === "number") {
    next.mean_accuracy = evalMeanZeroShotAccuracy;
  }

  const trainableParams =
    asNumber(next.trainable_params) ||
    asNumber(next.trainable_parameters) ||
    asNumber(training.trainable_params) ||
    asNumber(training.trainable_parameters) ||
    asNumber(parameterReport.trainable_params) ||
    asNumber(parameterReport.trainable_parameters);
  if (next.trainable_params === undefined && typeof trainableParams === "number") {
    next.trainable_params = trainableParams;
  }

  const trainingWallTime =
    asNumber(next.training_wall_time_sec) ||
    asNumber(training.wall_time_sec) ||
    asNumber(training.wall_clock_seconds) ||
    asNumber(training.runtime_seconds);
  if (next.training_wall_time_sec === undefined && typeof trainingWallTime === "number") {
    next.training_wall_time_sec = trainingWallTime;
  }

  return next;
}

function buildResultArrayPreferredKeys(
  objectiveEvaluation: ObjectiveMetricEvaluation,
  objectiveProfile: ObjectiveMetricProfile
): string[] {
  return uniqueStrings([
    objectiveEvaluation.matchedMetricKey,
    objectiveProfile.primaryMetric,
    ...objectiveProfile.preferredMetricKeys,
    "average_accuracy",
    "accuracy_delta_vs_baseline",
    "mean_zero_shot_accuracy",
    "mean_accuracy",
    "trainable_params",
    "training_wall_time_sec",
    "wall_clock_seconds",
    "peak_gpu_memory_allocated_bytes",
    "max_gpu_memory_allocated_bytes"
  ]);
}

function buildRecipesConditionComparison(args: {
  metrics: Record<string, unknown>;
  objectiveEvaluation: ObjectiveMetricEvaluation;
  objectiveProfile: ObjectiveMetricProfile;
}): AnalysisConditionComparison | undefined {
  const recipes = asRecord(args.metrics.recipes);
  const recipeNames = Object.keys(recipes).filter((name) => Object.keys(asRecord(recipes[name])).length > 0);
  if (recipeNames.length < 2) {
    return undefined;
  }

  const baselineName =
    recipeNames.find((name) => isLikelyBaselineCondition(name)) ||
    recipeNames.find((name) => asString(asRecord(recipes[name]).recipe)?.toLowerCase() === "baseline");
  if (!baselineName) {
    return undefined;
  }

  const preferredKeys = buildResultArrayPreferredKeys(args.objectiveEvaluation, args.objectiveProfile);
  const candidateNames = recipeNames.filter((name) => name !== baselineName);
  const bestRecipe = asString(args.metrics.best_recipe);
  const explicitBest =
    bestRecipe && bestRecipe !== baselineName && candidateNames.includes(bestRecipe) ? bestRecipe : undefined;
  const comparatorName =
    explicitBest ||
    selectRecipeConditionByMetric({
      recipes,
      recipeNames: candidateNames,
      preferredKeys,
      direction: args.objectiveProfile.direction
    });
  if (!comparatorName) {
    return undefined;
  }

  const baselineMetrics = new Map(
    flattenNumericMetrics(asRecord(recipes[baselineName])).map((item) => [item.key, item.value])
  );
  const shared = flattenNumericMetrics(asRecord(recipes[comparatorName]))
    .filter((item) => baselineMetrics.has(item.key))
    .filter((item) => isUsefulResultArrayMetric(item.key, preferredKeys))
    .map((item) => {
      const baselineValue = baselineMetrics.get(item.key) as number;
      return {
        key: item.key,
        primary_value: item.value,
        baseline_value: baselineValue,
        value: Number((item.value - baselineValue).toFixed(4))
      };
    })
    .sort((left, right) => {
      const leftRank = metricPreferenceRank(left.key, preferredKeys);
      const rightRank = metricPreferenceRank(right.key, preferredKeys);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      const leftStatisticRank = preferredMetricStatisticRank(left.key, preferredKeys);
      const rightStatisticRank = preferredMetricStatisticRank(right.key, preferredKeys);
      if (leftStatisticRank !== rightStatisticRank) {
        return leftStatisticRank - rightStatisticRank;
      }
      return Math.abs(right.value) - Math.abs(left.value);
    })
    .slice(0, 6);

  if (shared.length === 0) {
    return undefined;
  }

  const sharedSummary = shared
    .slice(0, 4)
    .map((item) => `${item.key}: ${formatMetricValue(item.primary_value)} vs ${formatMetricValue(item.baseline_value)} (delta ${formatMetricValue(item.value)})`)
    .join(", ");

  return {
    id: `${comparatorName}_vs_${baselineName}`,
    label: `${humanizeConditionLabel(comparatorName)} vs ${humanizeConditionLabel(baselineName)}`,
    source: "metrics.recipes",
    metrics: shared,
    summary: `${humanizeConditionLabel(comparatorName)} vs ${humanizeConditionLabel(baselineName)}: ${sharedSummary}.`
  };
}

function buildConditionsArrayConditionComparison(args: {
  metrics: Record<string, unknown>;
  objectiveEvaluation: ObjectiveMetricEvaluation;
  objectiveProfile: ObjectiveMetricProfile;
}): AnalysisConditionComparison | undefined {
  const conditionRowSource = readConditionRowsFromMetrics(args.metrics);
  const conditionRows = conditionRowSource.rows
    .filter((row) => Object.keys(row).length > 0)
    .filter((row) => isCompletedConditionRow(row));
  if (conditionRows.length < 2) {
    return undefined;
  }

  const baselineRow = selectBaselineConditionRow(conditionRows);
  if (!baselineRow) {
    return undefined;
  }

  const candidates = selectEligibleComparatorConditionRows(conditionRows.filter((row) => row !== baselineRow));
  if (candidates.length === 0) {
    return undefined;
  }

  const preferredKeys = buildResultArrayPreferredKeys(args.objectiveEvaluation, args.objectiveProfile);
  const explicitBestCondition = readBestConditionName(args.metrics);
  const explicitComparator = explicitBestCondition
    ? candidates.find((row) => readConditionName(row) === explicitBestCondition)
    : undefined;
  const comparatorRow =
    explicitComparator ||
    selectConditionRowByMetric({
      rows: candidates,
      preferredKeys,
      direction: args.objectiveProfile.direction
    });
  if (!comparatorRow) {
    return undefined;
  }

  const baselineMetrics = new Map(
    flattenNumericMetrics(baselineRow).map((item) => [item.key, item.value])
  );
  const shared = flattenNumericMetrics(comparatorRow)
    .filter((item) => baselineMetrics.has(item.key))
    .filter((item) => isUsefulResultArrayMetric(item.key, preferredKeys))
    .map((item) => {
      const baselineValue = baselineMetrics.get(item.key) as number;
      return {
        key: item.key,
        primary_value: item.value,
        baseline_value: baselineValue,
        value: Number((item.value - baselineValue).toFixed(4))
      };
    })
    .sort((left, right) => {
      const leftRank = metricPreferenceRank(left.key, preferredKeys);
      const rightRank = metricPreferenceRank(right.key, preferredKeys);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      const leftStatisticRank = preferredMetricStatisticRank(left.key, preferredKeys);
      const rightStatisticRank = preferredMetricStatisticRank(right.key, preferredKeys);
      if (leftStatisticRank !== rightStatisticRank) {
        return leftStatisticRank - rightStatisticRank;
      }
      return Math.abs(right.value) - Math.abs(left.value);
    })
    .slice(0, 6);

  if (shared.length === 0) {
    return undefined;
  }

  const baselineName = readConditionName(baselineRow) || "baseline";
  const comparatorName = readConditionName(comparatorRow) || "comparator";
  const headlineMetric = shared[0];
  const hypothesisSupported = headlineMetric
    ? args.objectiveProfile.direction === "minimize"
      ? headlineMetric.value < 0
      : headlineMetric.value > 0
    : undefined;
  const sharedSummary = shared
    .slice(0, 4)
    .map((item) => `${item.key}: ${formatMetricValue(item.primary_value)} vs ${formatMetricValue(item.baseline_value)} (delta ${formatMetricValue(item.value)})`)
    .join(", ");

  return {
    id: `${comparatorName}_vs_${baselineName}`,
    label: `${humanizeConditionLabel(comparatorName)} vs ${humanizeConditionLabel(baselineName)}`,
    source: conditionRowSource.source,
    metrics: shared,
    hypothesis_supported: hypothesisSupported,
    summary: `${humanizeConditionLabel(comparatorName)} vs ${humanizeConditionLabel(baselineName)}: ${sharedSummary}.`
  };
}

function readConditionRowsFromMetrics(metrics: Record<string, unknown>): {
  source:
    | "metrics.conditions"
    | "metrics.condition_results"
    | "metrics.condition_summaries"
    | "metrics.condition_aggregates"
    | "metrics.per_condition"
    | "metrics.per_condition_average_accuracy";
  rows: Array<Record<string, unknown>>;
} {
  const baselineMarkers = readBaselineConditionMarkers(metrics);
  const summaryRows = asArray(metrics.condition_summaries)
    .map((item) => markBaselineConditionRow(enrichConditionRow(asRecord(item)), baselineMarkers))
    .filter((row) => Object.keys(row).length > 0);
  const aggregateRows = asArray(metrics.condition_aggregates)
    .map((item) => markBaselineConditionRow(enrichConditionRow(asRecord(item)), baselineMarkers))
    .filter((row) => Object.keys(row).length > 0);
  const conditionSummaryRows = summaryRows.length > 0 ? summaryRows : aggregateRows;
  const summariesByName = new Map(
    conditionSummaryRows
      .map((row) => [readConditionName(row), row] as const)
      .filter(([name]) => Boolean(name))
  );
  const explicitBaselineRows = readExplicitBaselineConditionRows(metrics, summariesByName);
  const conditionRowsFromArray = mergeConditionRowsByName([
    ...explicitBaselineRows,
    ...asArray(metrics.conditions)
    .map((item) => {
      const row = asRecord(item);
      const name = readConditionName(row);
      const summary = name ? summariesByName.get(name) : undefined;
      return markBaselineConditionRow(enrichConditionRow(summary ? { ...summary, ...row } : row), baselineMarkers);
    })
    .filter((row) => Object.keys(row).length > 0)
  ]);
  const conditionRowsFromRecord = mergeConditionRowsByName([
    ...explicitBaselineRows,
    ...Object.entries(asRecord(metrics.conditions))
    .map(([name, value]) => {
      const row = { ...asRecord(value) };
      if (!asString(row.name)) {
        row.name = name;
      }
      if (!asString(row.condition_id)) {
        row.condition_id = name;
      }
      const rowName = readConditionName(row);
      const summary = rowName ? summariesByName.get(rowName) : undefined;
      return markBaselineConditionRow(enrichConditionRow(summary ? { ...summary, ...row } : row), baselineMarkers);
    })
    .filter((row) => Object.keys(row).length > 0)
  ]);
  const perConditionArrayRows = mergeConditionRowsByName([
    ...explicitBaselineRows,
    ...asArray(metrics.per_condition)
      .map((item) => {
        const row = asRecord(item);
        const name = readConditionName(row);
        const summary = name ? summariesByName.get(name) : undefined;
        return markBaselineConditionRow(enrichConditionRow(summary ? { ...summary, ...row } : row), baselineMarkers);
      })
      .filter((row) => Object.keys(row).length > 0)
  ]);
  const conditionRows = conditionRowsFromArray.length > 0
    ? conditionRowsFromArray
    : conditionRowsFromRecord;
  const conditionResultRows = asArray(metrics.condition_results)
    .map((item) => {
      const row = asRecord(item);
      const name = readConditionName(row);
      const summary = name ? summariesByName.get(name) : undefined;
      return markBaselineConditionRow(enrichConditionRow(summary ? { ...summary, ...row } : row), baselineMarkers);
    })
    .filter((row) => Object.keys(row).length > 0);
  if (conditionRows.length > 0) {
    return { source: "metrics.conditions", rows: conditionRows };
  }
  if (perConditionArrayRows.length > 0) {
    return { source: "metrics.per_condition", rows: perConditionArrayRows };
  }
  if (conditionResultRows.length > 0) {
    return { source: "metrics.condition_results", rows: conditionResultRows };
  }
  const perConditionRows = readPerConditionAverageAccuracyRows(metrics)
    .map((row) => markBaselineConditionRow(enrichConditionRow(row), baselineMarkers))
    .filter((row) => Object.keys(row).length > 0);
  if (perConditionRows.length > 0) {
    return { source: "metrics.per_condition_average_accuracy", rows: perConditionRows };
  }
  if (summaryRows.length > 0) {
    return { source: "metrics.condition_summaries", rows: summaryRows };
  }
  return { source: "metrics.condition_aggregates", rows: aggregateRows };
}

function readPerConditionAverageAccuracyRows(
  metrics: Record<string, unknown>
): Array<Record<string, unknown>> {
  const averages = asRecord(metrics.per_condition_average_accuracy);
  const conditionNames = uniqueStrings([
    ...asArray(metrics.condition_order)
      .map((item) => asString(item))
      .filter((item): item is string => Boolean(item)),
    ...Object.keys(averages)
  ]);
  if (conditionNames.length === 0) {
    return [];
  }

  const statuses = asRecord(metrics.condition_statuses);
  const trainLosses = asRecord(metrics.per_condition_train_loss);
  const perTaskAccuracy = asRecord(metrics.per_task_accuracy);
  const baselineAverage = asNumber(metrics.baseline_average_accuracy);

  return conditionNames
    .map((conditionName) => {
      const averageAccuracy = asNumber(averages[conditionName]);
      if (averageAccuracy === undefined) {
        return undefined;
      }
      const taskAccuracy = asRecord(perTaskAccuracy[conditionName]);
      const row: Record<string, unknown> = {
        condition_name: conditionName,
        condition_marker: conditionName,
        status: asString(statuses[conditionName]) || "completed",
        average_accuracy: averageAccuracy,
        mean_accuracy: averageAccuracy,
        mean_zero_shot_accuracy: averageAccuracy
      };
      const trainLoss = asNumber(trainLosses[conditionName]);
      if (trainLoss !== undefined) {
        row.train_loss = trainLoss;
      }
      if (baselineAverage !== undefined) {
        row.accuracy_delta_vs_baseline = Number((averageAccuracy - baselineAverage).toFixed(6));
      }
      for (const [taskName, value] of Object.entries(taskAccuracy)) {
        const numericValue = asNumber(value);
        if (numericValue === undefined) {
          continue;
        }
        row[`${taskName}_accuracy`] = numericValue;
      }
      return row;
    })
    .filter((row): row is Record<string, unknown> => row !== undefined);
}

function readBaselineConditionMarkers(metrics: Record<string, unknown>): Set<string> {
  const studySummary = asRecord(metrics.study_summary);
  const studyContract = asRecord(metrics.study_contract);
  const summary = asRecord(metrics.summary);
  return new Set(
    [
      asString(metrics.baseline_marker),
      asString(metrics.baseline_condition_marker),
      asString(metrics.baseline_condition),
      asString(metrics.baseline_condition_id),
      asString(studyContract.baseline_marker),
      asString(studyContract.baseline_condition_marker),
      asString(studyContract.baseline_condition),
      asString(studyContract.baseline_condition_id),
      asString(studySummary.baseline_marker),
      asString(studySummary.baseline_condition_marker),
      asString(studySummary.baseline_condition),
      asString(studySummary.baseline_condition_id),
      asString(summary.baseline_marker),
      asString(summary.baseline_condition_marker),
      asString(summary.baseline_condition),
      asString(summary.baseline_condition_id)
    ].filter((item): item is string => Boolean(item))
  );
}

function markBaselineConditionRow(
  row: Record<string, unknown>,
  baselineMarkers: Set<string>
): Record<string, unknown> {
  const name = readConditionName(row);
  if (!name || !baselineMarkers.has(name) || row.is_baseline === true || row.baseline === true) {
    return row;
  }
  return { ...row, is_baseline: true };
}

function readExplicitBaselineConditionRows(
  metrics: Record<string, unknown>,
  summariesByName: Map<string, Record<string, unknown>>
): Array<Record<string, unknown>> {
  const baseline = asRecord(metrics.baseline);
  if (Object.keys(baseline).length === 0) {
    return [];
  }
  const row = { ...baseline };
  if (!asString(row.name) && !asString(row.condition_name) && !asString(row.condition_id)) {
    row.condition_name = "baseline";
  }
  if (row.is_baseline !== false) {
    row.is_baseline = true;
  }
  const name = readConditionName(row);
  const summary = name ? summariesByName.get(name) : undefined;
  return [enrichConditionRow(summary ? { ...summary, ...row } : row)].filter(
    (item) => Object.keys(item).length > 0
  );
}

function mergeConditionRowsByName(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  const anonymous: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const name = readConditionName(row);
    if (!name) {
      anonymous.push(row);
      continue;
    }
    const existing = merged.get(name);
    merged.set(name, existing ? { ...existing, ...row } : row);
  }
  return [...merged.values(), ...anonymous];
}

function isCompletedConditionRow(row: Record<string, unknown>): boolean {
  const status = asString(row.status)?.toLowerCase();
  if (!status) {
    return true;
  }
  return /^(completed|complete|success|succeeded|ok|pass|passed)$/u.test(status);
}

function readConditionName(row: Record<string, unknown>): string {
  const conditionConfig = asRecord(row.condition_config);
  return (
    asString(row.name) ||
    asString(row.condition_name) ||
    asString(row.condition_id) ||
    asString(row.condition_marker) ||
    asString(row.marker) ||
    asString(row.id) ||
    asString(row.recipe) ||
    asString(row.recipe_id) ||
    asString(conditionConfig.name) ||
    asString(conditionConfig.marker) ||
    ""
  );
}

function isBaselineConditionRow(row: Record<string, unknown>): boolean {
  return baselineConditionRowScore(row) > 0;
}

function selectBaselineConditionRow(rows: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
  return rows
    .map((row, index) => ({
      row,
      index,
      score: baselineConditionRowScore(row)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.row;
}

function selectEligibleComparatorConditionRows(
  rows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const nonBaselineRows = rows.filter((row) => !isBaselineConditionRow(row));
  return nonBaselineRows.length > 0 ? nonBaselineRows : rows;
}

function baselineConditionRowScore(row: Record<string, unknown>): number {
  if (row.is_baseline === true || row.baseline === true) {
    return 5;
  }
  const roleText = [
    readConditionName(row),
    asString(row.condition_type),
    asString(row.type),
    asString(row.role),
    asString(row.group_kind)
  ].filter((item): item is string => Boolean(item)).join(" ");
  return baselineConditionTextScore(roleText);
}

function baselineConditionTextScore(text: string): number {
  const lower = text.toLowerCase();
  const referenceBaseline =
    /(?:^|[_\s-])(?:unmodified|pretrained|zero[_\s-]?shot|untuned|no[_\s-]?tuning|base)(?:[_\s-]|$)/u.test(lower);
  const explicitBaseline = /(?:^|[_\s-])baseline(?:[_\s-]|$)/u.test(lower);
  const tunedBaseline =
    /(?:^|[_\s-])(?:lora|peft|adapter|tuned|locked)[\w\s-]*baseline(?:[_\s-]|$)/u.test(lower) ||
    /(?:^|[_\s-])baseline[\w\s-]*(?:lora|peft|adapter|tuned|locked)(?:[_\s-]|$)/u.test(lower);

  if (tunedBaseline && !referenceBaseline) {
    return 4;
  }
  if (explicitBaseline && !referenceBaseline) {
    return 3;
  }
  if (explicitBaseline) {
    return 2;
  }
  return referenceBaseline || isLikelyBaselineCondition(lower) ? 1 : 0;
}

function readBestConditionName(metrics: Record<string, unknown>): string | undefined {
  const primaryMetric = asRecord(metrics.primary_metric);
  const studySummary = asRecord(metrics.study_summary);
  const summary = asRecord(metrics.summary);
  const bestCondition = asRecord(metrics.best_condition);
  const bestTunedCondition = asRecord(metrics.best_tuned_condition);
  return (
    asString(primaryMetric.best_condition) ||
    asString(primaryMetric.best_condition_id) ||
    asString(primaryMetric.best_condition_marker) ||
    asString(primaryMetric.best_nonbaseline_condition) ||
    asString(primaryMetric.best_nonbaseline_condition_id) ||
    asString(primaryMetric.best_nonbaseline_condition_marker) ||
    asString(studySummary.best_condition) ||
    asString(studySummary.best_condition_id) ||
    asString(studySummary.best_condition_marker) ||
    asString(studySummary.best_nonbaseline_condition) ||
    asString(studySummary.best_nonbaseline_condition_id) ||
    asString(studySummary.best_nonbaseline_condition_marker) ||
    asString(summary.best_condition) ||
    asString(summary.best_condition_id) ||
    asString(summary.best_condition_marker) ||
    asString(summary.best_nonbaseline_condition) ||
    asString(summary.best_nonbaseline_condition_id) ||
    asString(summary.best_nonbaseline_condition_marker) ||
    asString(bestCondition.name) ||
    asString(bestCondition.condition_id) ||
    asString(bestCondition.condition_marker) ||
    asString(bestCondition.id) ||
    asString(bestCondition.recipe) ||
    asString(bestTunedCondition.name) ||
    asString(bestTunedCondition.condition_name) ||
    asString(bestTunedCondition.condition_id) ||
    asString(bestTunedCondition.condition_marker) ||
    asString(bestTunedCondition.id) ||
    asString(bestTunedCondition.recipe) ||
    asString(metrics.best_condition) ||
    asString(metrics.best_condition_id) ||
    asString(metrics.best_condition_marker) ||
    asString(metrics.best_nonbaseline_condition) ||
    asString(metrics.best_nonbaseline_condition_id) ||
    asString(metrics.best_nonbaseline_condition_marker) ||
    asString(metrics.best_tuned_condition_id) ||
    asString(metrics.best_recipe)
  );
}

function selectConditionRowByMetric(args: {
  rows: Array<Record<string, unknown>>;
  preferredKeys: string[];
  direction?: ObjectiveMetricProfile["direction"];
}): Record<string, unknown> | undefined {
  const scored = args.rows
    .map((row) => {
      const metric = selectPreferredNumericMetric(flattenNumericMetrics(row), args.preferredKeys);
      return metric ? { row, value: metric.value } : undefined;
    })
    .filter((item): item is { row: Record<string, unknown>; value: number } => item !== undefined);
  if (scored.length === 0) {
    return args.rows[0];
  }

  const direction = args.direction || "maximize";
  const sorted = [...scored].sort((left, right) => {
    if (direction === "minimize") {
      return left.value - right.value;
    }
    return right.value - left.value;
  });
  return sorted[0]?.row;
}

function selectRecipeConditionByMetric(args: {
  recipes: Record<string, unknown>;
  recipeNames: string[];
  preferredKeys: string[];
  direction?: ObjectiveMetricProfile["direction"];
}): string | undefined {
  const scored = args.recipeNames
    .map((name) => {
      const metric = selectPreferredNumericMetric(flattenNumericMetrics(asRecord(args.recipes[name])), args.preferredKeys);
      return metric ? { name, value: metric.value } : undefined;
    })
    .filter((item): item is { name: string; value: number } => item !== undefined);
  if (scored.length === 0) {
    return args.recipeNames[0];
  }

  const direction = args.direction || "maximize";
  const sorted = [...scored].sort((left, right) => {
    if (direction === "minimize") {
      return left.value - right.value;
    }
    return right.value - left.value;
  });
  return sorted[0]?.name;
}

function selectPreferredNumericMetric(
  metrics: Array<{ key: string; value: number }>,
  preferredKeys: string[]
): { key: string; value: number } | undefined {
  if (metrics.length === 0) {
    return undefined;
  }
  return [...metrics].sort((left, right) => {
    const leftRank = metricPreferenceRank(left.key, preferredKeys);
    const rightRank = metricPreferenceRank(right.key, preferredKeys);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    const leftStatisticRank = preferredMetricStatisticRank(left.key, preferredKeys);
    const rightStatisticRank = preferredMetricStatisticRank(right.key, preferredKeys);
    if (leftStatisticRank !== rightStatisticRank) {
      return leftStatisticRank - rightStatisticRank;
    }
    return left.key.localeCompare(right.key);
  })[0];
}

function metricPreferenceRank(key: string, preferredKeys: string[]): number {
  const exact = preferredKeys.indexOf(key);
  if (exact >= 0) {
    return exact;
  }
  const lowerKey = key.toLowerCase();
  const fuzzy = preferredKeys.findIndex((preferred) => {
    const lowerPreferred = preferred.toLowerCase();
    return lowerKey.includes(lowerPreferred) || lowerPreferred.includes(lowerKey);
  });
  return fuzzy >= 0 ? preferredKeys.length + fuzzy : Number.MAX_SAFE_INTEGER;
}

function preferredMetricStatisticRank(key: string, preferredKeys: string[]): number {
  if (preferredKeys.length === 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  const normalizedKey = normalizeMetricStatisticKey(key);
  let best = Number.MAX_SAFE_INTEGER;
  preferredKeys.forEach((preferred, preferredIndex) => {
    const normalizedPreferred = normalizeMetricStatisticKey(preferred);
    const position = normalizedKey.indexOf(normalizedPreferred);
    if (position < 0) {
      return;
    }
    const suffix = normalizedKey.slice(position + normalizedPreferred.length).replace(/^_+/, "");
    const prefixPenalty = position === 0 ? 0 : 20;
    const rank = preferredIndex * 1000 + prefixPenalty + metricStatisticSuffixRank(suffix);
    best = Math.min(best, rank);
  });
  return best;
}

function normalizeMetricStatisticKey(value: string): string {
  return value.toLowerCase().replace(/[.-]+/gu, "_");
}

function metricStatisticSuffixRank(suffix: string): number {
  if (!suffix) {
    return 0;
  }
  if (/^(mean|avg|average)(?:_|$)/u.test(suffix)) {
    return 1;
  }
  if (/^(value|score|observed)(?:_|$)/u.test(suffix)) {
    return 2;
  }
  if (/^median(?:_|$)/u.test(suffix)) {
    return 3;
  }
  if (/^(max|maximum)(?:_|$)/u.test(suffix)) {
    return 10;
  }
  if (/^(min|minimum)(?:_|$)/u.test(suffix)) {
    return 11;
  }
  if (/^ci\d*(?:_|$)/u.test(suffix)) {
    return 40;
  }
  if (/^(sem|std|stdev|variance)(?:_|$)/u.test(suffix)) {
    return 45;
  }
  if (/^(count|n|seed_count|sample_size)(?:_|$)/u.test(suffix)) {
    return 80;
  }
  return 30;
}

function isUsefulResultArrayMetric(key: string, preferredKeys: string[]): boolean {
  if (metricPreferenceRank(key, preferredKeys) !== Number.MAX_SAFE_INTEGER) {
    return true;
  }
  return /(?:^|[._-])(accuracy|acc|score|f1|precision|recall|loss|latency|runtime|memory|seconds|time)(?:[._-]|$)/i.test(key);
}

function selectConditionByMetric(args: {
  conditionMetrics: Record<string, unknown>;
  conditionNames: string[];
  preferredKeys: string[];
  direction?: ObjectiveMetricProfile["direction"];
  mode: "best" | "worst";
}): string | undefined {
  const scored = args.conditionNames
    .map((name) => {
      const metricValue = findPreferredMetricValue(asRecord(args.conditionMetrics[name]), args.preferredKeys);
      return metricValue === undefined ? undefined : { name, value: metricValue };
    })
    .filter((item): item is { name: string; value: number } => item !== undefined);

  if (scored.length === 0) {
    return undefined;
  }

  const direction = args.direction || "maximize";
  const sorted = [...scored].sort((left, right) => {
    if (direction === "minimize") {
      return left.value - right.value;
    }
    return right.value - left.value;
  });

  return args.mode === "best" ? sorted[0]?.name : sorted.at(-1)?.name;
}

function findPreferredMetricValue(metrics: Record<string, unknown>, preferredKeys: string[]): number | undefined {
  const flattened = flattenNumericMetrics(metrics);
  if (preferredKeys.length === 0) {
    return flattened[0]?.value;
  }
  const matched = flattened.find((item) => preferredKeys.includes(item.key));
  return matched?.value;
}

function findMatchingMetricKey(
  metricTable: AnalysisMetricEntry[],
  objectiveProfile: ObjectiveMetricProfile
): string | undefined {
  const preferredKeys = uniqueStrings(
    [objectiveProfile.primaryMetric, ...objectiveProfile.preferredMetricKeys].filter((item): item is string => Boolean(item))
  );
  return metricTable.find((item) => preferredKeys.includes(item.key))?.key;
}

function selectEffectMetric(
  comparison: AnalysisConditionComparison,
  objectiveProfile: ObjectiveMetricProfile
): AnalysisComparisonMetric | undefined {
  const preferredKeys = uniqueStrings(
    [objectiveProfile.primaryMetric, ...objectiveProfile.preferredMetricKeys].filter((item): item is string => Boolean(item))
  );
  return (
    comparison.metrics.find((item) => preferredKeys.includes(item.key)) ||
    comparison.metrics.find((item) => isLikelyPerformanceMetric(item.key, Math.abs(item.value))) ||
    comparison.metrics[0]
  );
}

function classifyEffectDirection(
  metricKey: string,
  delta: number,
  objectiveDirection: ObjectiveMetricProfile["direction"] | undefined
): "positive" | "negative" | "neutral" {
  if (Math.abs(delta) < 0.0001) {
    return "neutral";
  }
  const lowerIsBetter = isLowerBetterMetric(metricKey, objectiveDirection);
  if (lowerIsBetter) {
    return delta < 0 ? "positive" : "negative";
  }
  return delta > 0 ? "positive" : "negative";
}

function isPreferredMetricKey(metricKey: string, preferredKeys: string[]): boolean {
  return preferredKeys.some((key) => metricKey === key || metricKey.endsWith(`.${key}`));
}

function humanizeMetricLabel(metricKey: string): string {
  return metricKey
    .split(".")
    .map((segment) => humanizeComparisonLabel(segment))
    .join(" / ");
}

function buildSupplementalRunSummary(
  profile: string,
  objectiveEvaluation: ObjectiveMetricEvaluation,
  sampling: Record<string, unknown>,
  path: string | undefined
): string {
  const details = [
    objectiveEvaluation.summary,
    typeof asNumber(sampling.total_trials) === "number" ? `total_trials=${asNumber(sampling.total_trials)}` : undefined,
    typeof asNumber(sampling.executed_trials) === "number"
      ? `executed_trials=${asNumber(sampling.executed_trials)}`
      : undefined,
    path ? `path=${path}` : undefined
  ].filter((item): item is string => Boolean(item));
  return `${humanizeConditionLabel(profile)} supplemental run: ${details.join(", ")}.`;
}

function computeMeanScore(metrics: Record<string, unknown>): number {
  const values = flattenNumericMetrics(metrics)
    .filter((entry) => isMeanScoreMetric(entry.key, entry.value))
    .map((entry) => entry.value);
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function isMeanScoreMetric(key: string, value: number): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }
  const normalized = key.toLocaleLowerCase();
  if (
    /(?:^|[._-])(?:memory|bytes|byte|vram|ram|allocated|reserved|runtime|latency|duration|seconds|wall_clock|time|timestamp|started|finished|elapsed|count|total|planned|completed|failed|seed|rank|dropout|example|sample|step|epoch|token|parameter|index|order|trial)(?:[._-]|$)/u.test(
      normalized
    )
  ) {
    return false;
  }
  if (/(?:^|[._-])(?:loss|perplexity)(?:[._-]|$)/u.test(normalized)) {
    return false;
  }
  return /(?:^|[._-])(?:accuracy|acc|f1|precision|recall|bleu|rouge|auc|score|delta|improvement|pass@\d+)(?:[._-]|$)/u.test(
    normalized
  );
}

function flattenNumericMetrics(
  value: Record<string, unknown>,
  prefix = ""
): AnalysisMetricEntry[] {
  const items: AnalysisMetricEntry[] = [];
  for (const [key, raw] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      items.push({ key: nextKey, value: Number(raw.toFixed(6)) });
      continue;
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      items.push(...flattenNumericMetrics(raw as Record<string, unknown>, nextKey));
    }
  }
  return items;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number(value.toFixed(4));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Number(parsed.toFixed(4));
    }
  }
  return undefined;
}

function uniqueStrings(items: Array<string | undefined>): string[] {
  return [...new Set(items.filter((item): item is string => Boolean(item && item.trim())).map((item) => item.trim()))];
}

function humanizeComparisonLabel(id: string): string {
  return id
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeConditionLabel(id: string): string {
  return humanizeComparisonLabel(id);
}

function formatMetricValue(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function shortenKey(key: string): string {
  if (key.length <= 28) {
    return key;
  }
  return `${key.slice(0, 25)}...`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncateOneLine(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 3)}...`;
}

function isLikelyPerformanceMetric(key: string, value: number): boolean {
  const lower = key.toLowerCase();
  if (/count|total_trials|executed_trials|cached_trials|task_count|max_workers|year/u.test(lower)) {
    return false;
  }
  if (value < 0 || value > 1.5) {
    return false;
  }
  return /accuracy|f1|score|precision|recall|reproducibility|success|stability|consistency|availability|variance|loss|latency/u.test(lower);
}

function isLowerBetterMetric(
  key: string,
  objectiveDirection?: ObjectiveMetricProfile["direction"]
): boolean {
  const lower = key.toLowerCase();
  if (/variance|failure|loss|latency|error|distance|gap/u.test(lower)) {
    return true;
  }
  if (/accuracy|f1|score|precision|recall|success|stability|consistency|availability|reproducibility/u.test(lower)) {
    return false;
  }
  return objectiveDirection === "minimize";
}

function isLikelyBaselineCondition(name: string): boolean {
  return /(?:^|[_ -])(baseline|base|control|reference|free[_ -]?form|plain|unstructured|default|unmodified|pretrained|zero[_ -]?shot)(?:[_ -]|$)/u.test(name.toLowerCase());
}

function isLikelyPrimaryCondition(name: string): boolean {
  return /primary|treatment|schema|shared[_ -]?state|experimental|structured/u.test(name.toLowerCase());
}
