import YAML from "yaml";

import type { PaperProfileConfig } from "../../types.js";
import type { ObjectiveMetricEvaluation, ObjectiveMetricProfile } from "../objectiveMetric.js";
import type { ConstraintProfile } from "../runConstraints.js";
import type {
  PaperDraft,
  PaperDraftClaim,
  PaperDraftParagraph,
  PaperDraftSection,
  PaperWritingBundle,
  ResultAnalysisArtifact
} from "./paperWriting.js";
import type {
  PaperManuscript,
  PaperManuscriptFigure,
  PaperSourceRef,
  PaperManuscriptSection,
  PaperManuscriptTable
} from "./paperManuscript.js";

export interface ExperimentArtifactContext {
  method: {
    dataset_names: string[];
    dataset_sources: string[];
    sample_size_notes: string[];
    feature_notes: string[];
    class_notes: string[];
    imbalance_notes: string[];
    missingness_notes: string[];
    preprocessing_steps: string[];
    fit_scope_notes: string[];
    outer_fold_notes: string[];
    inner_fold_notes: string[];
    repeat_notes: string[];
    stratification_notes: string[];
    seeds: number[];
    hyperparameter_notes: string[];
    selection_metrics: string[];
    reporting_metrics: string[];
    runtime_measurement: boolean;
    memory_measurement: boolean;
    model_names: string[];
  };
  results: {
    aggregate_summary: string[];
    dataset_summaries: DatasetResultSummary[];
    dispersion_notes: string[];
    ci_notes: string[];
    ci_unavailable_reason?: string;
    paired_artifact_available: boolean;
    runtime_notes: string[];
    memory_notes: string[];
    figure_captions: string[];
    effect_notes: string[];
    heterogeneity_notes: string[];
  };
  related_work: {
    clusters: string[];
    closest_titles: string[];
    comparison_axes: string[];
    note_count: number;
    positioning_available: boolean;
  };
  discussion: {
    discussion_points: string[];
    limitations: string[];
    practical_implications: string[];
  };
  reproducibility: {
    has_artifact: boolean;
    artifact_notes: string[];
  };
}

export interface DatasetResultSummary {
  dataset: string;
  label: string;
  main_metric_label: string;
  main_metric_value?: number;
  delta_label?: string;
  delta_value?: number;
  ci95?: [number, number];
  runtime_seconds_mean?: number;
  peak_memory_mb_mean?: number;
  heterogeneity_notes: string[];
  summary: string;
}

export interface SectionBudgetEntry {
  heading: string;
  minimum_words: number;
  target_words: number;
  maximum_words: number;
  hard_minimum: boolean;
  current_words: number;
  status: "ok" | "warn" | "fail";
}

export interface PageBudgetManagerReport {
  venue_style: string;
  main_page_limit: number;
  estimated_words_per_page: number;
  minimum_main_words: number;
  target_main_words: number;
  maximum_main_words: number;
  estimated_main_words: number;
  status: "ok" | "warn" | "fail";
  sections: SectionBudgetEntry[];
  warnings: string[];
  auto_expand_headings: string[];
}

export interface CompletenessReport {
  status: "complete" | "incomplete";
  present: string[];
  missing: string[];
  warnings: string[];
}

export interface RelatedWorkRichnessReport extends CompletenessReport {
  cluster_count: number;
}

export interface ClaimStrengthRewrite {
  category: "performance" | "robustness" | "reproducibility" | "efficiency" | "novelty";
  before: string;
  after: string;
  reason: string;
}

export interface ClaimStrengthRewriteReport {
  rewrites: ClaimStrengthRewrite[];
}

export interface AppendixReference {
  label: string;
  target_heading: string;
  reason: string;
}

export interface AppendixSection extends PaperManuscriptSection {
  appendix_label: string;
}

export interface AppendixPlan {
  sections: AppendixSection[];
  tables: PaperManuscriptTable[];
  figures: PaperManuscriptFigure[];
  cross_references: AppendixReference[];
}

export interface ConsistencyLintIssue {
  kind:
    | "method_results_mismatch"
    | "numeric_inconsistency"
    | "count_inconsistency"
    | "caption_internal_name"
    | "reproducibility_claim"
    | "unsupported_strong_claim"
    | "appendix_reference_missing"
    | "appendix_only_numeric_reference"
    | "main_logic_thin";
  severity: "warning" | "error";
  message: string;
}

export interface ConsistencyLintReport {
  ok: boolean;
  issues: ConsistencyLintIssue[];
}

export interface ScientificDraftResult {
  draft: PaperDraft;
  page_budget: PageBudgetManagerReport;
  method_completeness: CompletenessReport;
  results_richness: CompletenessReport;
  related_work_richness: RelatedWorkRichnessReport;
  discussion_richness: CompletenessReport;
  claim_rewrite_report: ClaimStrengthRewriteReport;
  appendix_plan: AppendixPlan;
  auto_repairs: {
    expanded_sections: string[];
  };
}

export interface ScientificManuscriptResult {
  manuscript: PaperManuscript;
  consistency_lint: ConsistencyLintReport;
  appendix_lint: ConsistencyLintReport;
}

export type PaperValidationMode = "default" | "strict_paper";
export type ScientificValidationCategory =
  | "page_budget"
  | "method_completeness"
  | "results_richness"
  | "related_work_richness"
  | "discussion_richness"
  | "consistency"
  | "appendix";
export type ScientificValidationPolicy = "always_fail" | "strict_fail" | "warn_only";

export interface ScientificValidationIssue {
  code: string;
  source: "scientific_validation" | "consistency_lint" | "appendix_lint";
  category: ScientificValidationCategory;
  severity: "warning" | "error";
  policy: ScientificValidationPolicy;
  message: string;
  details?: string[];
}

export interface ScientificValidationArtifact {
  page_budget: PageBudgetManagerReport;
  method_completeness: CompletenessReport;
  results_richness: CompletenessReport;
  related_work_richness: RelatedWorkRichnessReport;
  discussion_richness: CompletenessReport;
  claim_rewrite_report: ClaimStrengthRewriteReport;
  appendix_plan: AppendixPlan;
  auto_repairs: {
    claim_rewrite_count: number;
    expanded_sections: string[];
    appendix_route_count: number;
  };
  issues: ScientificValidationIssue[];
}

export interface WritePaperGateDecisionIssue extends ScientificValidationIssue {
  blocking: boolean;
}

export interface WritePaperGateDecision {
  mode: PaperValidationMode;
  status: "pass" | "warn" | "fail";
  issues: WritePaperGateDecisionIssue[];
  blocking_issue_count: number;
  warning_count: number;
  failure_reasons: string[];
  summary: string[];
}

const DEFAULT_PAPER_PROFILE: PaperProfileConfig = {
  venue_style: "acl_long",
  main_page_limit: 8,
  references_counted: false,
  appendix_allowed: true,
  appendix_format: "double_column",
  prefer_appendix_for: [
    "hyperparameter_grids",
    "per_fold_results",
    "prompt_templates",
    "environment_dump",
    "extended_error_analysis"
  ],
  estimated_words_per_page: 420
};

export function resolvePaperProfile(
  profile: Partial<PaperProfileConfig> | undefined,
  constraintProfile?: ConstraintProfile
): PaperProfileConfig {
  const preferAppendixFor = Array.isArray(profile?.prefer_appendix_for)
    ? profile?.prefer_appendix_for
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : DEFAULT_PAPER_PROFILE.prefer_appendix_for;
  const targetVenue = cleanString(constraintProfile?.writing?.targetVenue);
  const lengthHint = cleanString(constraintProfile?.writing?.lengthHint);
  const inferredVenueStyle =
    profile?.venue_style?.trim()
    || (/\bacl\b|\bemnlp\b|\bnaacl\b|\beacl\b/iu.test(targetVenue)
      ? /\bshort\b/iu.test(lengthHint)
        ? "acl_short"
        : "acl_long"
      : DEFAULT_PAPER_PROFILE.venue_style);
  const inferredPageLimit =
    typeof profile?.main_page_limit === "number" && Number.isFinite(profile.main_page_limit)
      ? Math.max(1, Math.round(profile.main_page_limit))
      : /\bshort\b/iu.test(lengthHint)
        ? 4
        : DEFAULT_PAPER_PROFILE.main_page_limit;

  return {
    venue_style: inferredVenueStyle,
    main_page_limit: inferredPageLimit,
    references_counted:
      typeof profile?.references_counted === "boolean"
        ? profile.references_counted
        : DEFAULT_PAPER_PROFILE.references_counted,
    appendix_allowed:
      typeof profile?.appendix_allowed === "boolean"
        ? profile.appendix_allowed
        : DEFAULT_PAPER_PROFILE.appendix_allowed,
    appendix_format:
      profile?.appendix_format === "single_column" ? "single_column" : DEFAULT_PAPER_PROFILE.appendix_format,
    prefer_appendix_for: preferAppendixFor.length > 0 ? preferAppendixFor : DEFAULT_PAPER_PROFILE.prefer_appendix_for,
    estimated_words_per_page:
      typeof profile?.estimated_words_per_page === "number" && Number.isFinite(profile.estimated_words_per_page)
        ? Math.max(250, Math.round(profile.estimated_words_per_page))
        : DEFAULT_PAPER_PROFILE.estimated_words_per_page
  };
}

const SECTION_BUDGET_WEIGHTS: Array<{
  heading: string;
  weight: number;
  hardMinimum?: boolean;
}> = [
  { heading: "Introduction", weight: 0.16 },
  { heading: "Related Work", weight: 0.15 },
  { heading: "Method", weight: 0.2, hardMinimum: true },
  { heading: "Results", weight: 0.24, hardMinimum: true },
  { heading: "Discussion", weight: 0.12 },
  { heading: "Limitations", weight: 0.07 },
  { heading: "Conclusion", weight: 0.06 }
];

const SECTION_MIN_PARAGRAPHS: Record<string, number> = {
  introduction: 2,
  "related work": 2,
  method: 3,
  results: 4,
  discussion: 2,
  limitations: 1,
  conclusion: 1
};

const SECTION_MAX_PARAGRAPHS: Record<string, number> = {
  introduction: 3,
  "related work": 2,
  method: 4,
  results: 5,
  discussion: 3,
  limitations: 2,
  conclusion: 2
};

export function experimentArtifactLoader(input: {
  bundle: PaperWritingBundle;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
  objectiveMetricProfile?: ObjectiveMetricProfile;
}): ExperimentArtifactContext {
  const parsedPlan = parsePlanYaml(input.bundle.experimentPlan?.rawText);
  const latestResults = asRecord(input.bundle.latestResults);
  const resultAnalysis = input.bundle.resultAnalysis;
  const method = {
    dataset_names: collectDatasetNames(input.bundle, parsedPlan, latestResults),
    dataset_sources: collectDatasetSourceHints(parsedPlan, latestResults),
    sample_size_notes: collectSampleSizeHints(parsedPlan, latestResults),
    feature_notes: collectFeatureHints(parsedPlan, latestResults),
    class_notes: collectClassHints(parsedPlan, latestResults),
    imbalance_notes: collectKeywordNotes(parsedPlan, ["imbalance", "imbalanced", "class balance", "class prior"]),
    missingness_notes: collectKeywordNotes(parsedPlan, ["missing", "missingness", "imputation"]),
    preprocessing_steps: collectPreprocessingSteps(parsedPlan),
    fit_scope_notes: collectKeywordNotes(parsedPlan, [
      "fit within each fold",
      "within each fold",
      "fit on train fold",
      "inside each fold",
      "no leakage"
    ]),
    outer_fold_notes: collectFoldNotes(parsedPlan, "outer"),
    inner_fold_notes: collectFoldNotes(parsedPlan, "inner"),
    repeat_notes: collectRepeatNotes(parsedPlan, latestResults),
    stratification_notes: collectKeywordNotes(parsedPlan, ["stratified", "stratification"]),
    seeds: collectSeeds(parsedPlan, latestResults),
    hyperparameter_notes: collectHyperparameterNotes(parsedPlan, latestResults),
    selection_metrics: collectSelectionMetrics(parsedPlan, resultAnalysis),
    reporting_metrics: collectReportingMetrics(parsedPlan, resultAnalysis),
    runtime_measurement: hasRuntimeMeasurement(resultAnalysis, latestResults),
    memory_measurement: hasMemoryMeasurement(resultAnalysis, latestResults),
    model_names: collectModelNames(parsedPlan, latestResults)
  };

  const datasetSummaries = collectDatasetResultSummaries({
    latestResults,
    resultAnalysis,
    objectiveMetricProfile: input.objectiveMetricProfile
  });
  const ciNotes = collectCiNotes(resultAnalysis, datasetSummaries);
  const dispersionNotes = collectDispersionNotes(resultAnalysis, datasetSummaries);
  const results = {
    aggregate_summary: collectAggregateResults(
      resultAnalysis,
      input.objectiveEvaluation,
      input.objectiveMetricProfile
    ),
    dataset_summaries: datasetSummaries,
    dispersion_notes: dispersionNotes,
    ci_notes: ciNotes,
    ...(ciNotes.length === 0 ? { ci_unavailable_reason: buildCiUnavailableReason(resultAnalysis, latestResults) } : {}),
    paired_artifact_available: hasPairedArtifact(latestResults),
    runtime_notes: collectRuntimeNotes(datasetSummaries, resultAnalysis),
    memory_notes: collectMemoryNotes(datasetSummaries, resultAnalysis),
    figure_captions: collectFigureCaptions(resultAnalysis, datasetSummaries),
    effect_notes: collectEffectNotes(resultAnalysis, datasetSummaries),
    heterogeneity_notes: collectHeterogeneityNotes(datasetSummaries, resultAnalysis)
  };

  const relatedWorkNotes = input.bundle.relatedWorkNotes || [];
  const comparisonAxes = input.bundle.relatedWorkScout?.papers?.length
    ? uniqueStrings(input.bundle.relatedWorkScout.papers.map((item) => firstSentence(item.summary)).filter(Boolean))
    : [];
  const relatedWork = {
    clusters: uniqueStrings(relatedWorkNotes.map((item) => item.method_family).filter(Boolean)),
    closest_titles: relatedWorkNotes
      .filter((item) => item.comparison_role === "closest")
      .map((item) => item.title)
      .slice(0, 3),
    comparison_axes:
      uniqueStrings([
        ...(input.bundle.relatedWorkNotes || []).map((item) => item.problem_focus),
        ...comparisonAxes
      ]).slice(0, 4),
    note_count: relatedWorkNotes.length,
    positioning_available: relatedWorkNotes.some((item) => item.comparison_role === "closest")
  };

  const discussion = {
    discussion_points: uniqueStrings(resultAnalysis?.synthesis?.discussion_points || []).slice(0, 4),
    limitations: uniqueStrings(resultAnalysis?.limitations || []).slice(0, 6),
    practical_implications: buildPracticalImplications(input.bundle, datasetSummaries)
  };

  const reproducibilityNotes = uniqueStrings([
    ...input.bundle.paperSummaries.flatMap((item) => item.reproducibility_notes || []),
    ...method.repeat_notes,
    method.seeds.length > 0 ? `Seed schedule includes ${method.seeds.length} explicit seed(s).` : "",
    method.runtime_measurement ? "Runtime is measured in the reported evaluation outputs." : "",
    method.memory_measurement ? "Peak memory is measured in the reported evaluation outputs." : ""
  ]).filter(Boolean);

  return {
    method,
    results,
    related_work: relatedWork,
    discussion,
    reproducibility: {
      has_artifact:
        reproducibilityNotes.length > 0 &&
        (hasPairedArtifact(latestResults) || method.seeds.length > 0 || method.runtime_measurement),
      artifact_notes: reproducibilityNotes.slice(0, 6)
    }
  };
}

export function methodCompletenessValidator(context: ExperimentArtifactContext): CompletenessReport {
  const present: string[] = [];
  const missing: string[] = [];

  pushFieldStatus(present, missing, context.method.dataset_names.length > 0, "dataset names");
  pushFieldStatus(present, missing, context.method.dataset_sources.length > 0, "dataset source");
  pushFieldStatus(present, missing, context.method.sample_size_notes.length > 0, "#samples");
  pushFieldStatus(present, missing, context.method.feature_notes.length > 0, "#features");
  pushFieldStatus(present, missing, context.method.class_notes.length > 0, "#classes");
  pushFieldStatus(
    present,
    missing,
    context.method.imbalance_notes.length > 0 || context.method.missingness_notes.length > 0,
    "imbalance or missingness"
  );
  pushFieldStatus(present, missing, context.method.preprocessing_steps.length > 0, "preprocessing steps/order");
  pushFieldStatus(present, missing, context.method.fit_scope_notes.length > 0, "fold-internal fit scope");
  pushFieldStatus(present, missing, context.method.outer_fold_notes.length > 0, "outer folds");
  pushFieldStatus(present, missing, context.method.inner_fold_notes.length > 0, "inner folds");
  pushFieldStatus(present, missing, context.method.repeat_notes.length > 0, "repeats");
  pushFieldStatus(present, missing, context.method.stratification_notes.length > 0, "stratification");
  pushFieldStatus(present, missing, context.method.seeds.length > 0, "seeds");
  pushFieldStatus(present, missing, context.method.hyperparameter_notes.length > 0, "hyperparameter search space");
  pushFieldStatus(present, missing, context.method.selection_metrics.length > 0, "selection/reporting metrics");
  pushFieldStatus(present, missing, context.method.runtime_measurement, "runtime measurement");
  pushFieldStatus(present, missing, context.method.memory_measurement, "memory measurement");

  return {
    status: missing.length === 0 ? "complete" : "incomplete",
    present,
    missing,
    warnings:
      missing.length > 0
        ? [`Method remains incomplete because ${joinHumanList(missing)} are not grounded in current artifacts.`]
        : []
  };
}

export function resultsRichnessValidator(context: ExperimentArtifactContext): CompletenessReport {
  const present: string[] = [];
  const missing: string[] = [];

  pushFieldStatus(present, missing, context.results.aggregate_summary.length > 0, "aggregate summary");
  pushFieldStatus(present, missing, context.results.dataset_summaries.length > 0, "per-dataset results");
  pushFieldStatus(
    present,
    missing,
    context.results.dispersion_notes.length > 0,
    "dispersion estimates"
  );
  pushFieldStatus(
    present,
    missing,
    context.results.ci_notes.length > 0 || Boolean(context.results.ci_unavailable_reason),
    "CI or CI-unavailable rationale"
  );
  pushFieldStatus(
    present,
    missing,
    context.results.paired_artifact_available,
    "paired/repeated comparison artifact"
  );
  pushFieldStatus(
    present,
    missing,
    context.results.figure_captions.length > 0,
    "scientific figure with informative caption"
  );

  return {
    status: missing.length === 0 ? "complete" : "incomplete",
    present,
    missing,
    warnings:
      missing.length > 0
        ? [`Results remain incomplete because ${joinHumanList(missing)} are missing or too weakly grounded.`]
        : []
  };
}

export function relatedWorkRichnessValidator(context: ExperimentArtifactContext): RelatedWorkRichnessReport {
  const present: string[] = [];
  const missing: string[] = [];

  pushFieldStatus(present, missing, context.related_work.clusters.length >= 3, "3-4 work clusters");
  pushFieldStatus(
    present,
    missing,
    context.related_work.closest_titles.length > 0,
    "closest prior work comparison"
  );
  pushFieldStatus(
    present,
    missing,
    context.related_work.positioning_available,
    "explicit positioning/difference statement"
  );

  return {
    status: missing.length === 0 ? "complete" : "incomplete",
    present,
    missing,
    warnings:
      missing.length > 0
        ? [`Related Work remains thin because ${joinHumanList(missing)} are still underspecified.`]
        : [],
    cluster_count: context.related_work.clusters.length
  };
}

export function discussionRichnessValidator(context: ExperimentArtifactContext): CompletenessReport {
  const present: string[] = [];
  const missing: string[] = [];

  pushFieldStatus(present, missing, context.discussion.discussion_points.length > 0, "result interpretation");
  pushFieldStatus(present, missing, context.discussion.limitations.length > 0, "generalization/evaluation limits");
  pushFieldStatus(
    present,
    missing,
    context.discussion.practical_implications.length > 0,
    "practical implication"
  );

  return {
    status: missing.length === 0 ? "complete" : "incomplete",
    present,
    missing,
    warnings:
      missing.length > 0
        ? [`Discussion remains incomplete because ${joinHumanList(missing)} are missing.`]
        : []
  };
}

export function statisticalSummaryBuilder(context: ExperimentArtifactContext): string[] {
  const lines = uniqueStrings([
    ...context.results.effect_notes,
    ...context.results.dispersion_notes,
    ...context.results.ci_notes,
    ...context.results.heterogeneity_notes
  ]).filter(Boolean);
  return lines.slice(0, 6);
}

export function datasetResultTableBuilder(context: ExperimentArtifactContext): PaperManuscriptTable[] {
  if (context.results.dataset_summaries.length === 0) {
    return [];
  }

  const rows = context.results.dataset_summaries
    .slice(0, 6)
    .map((item) => ({
      label: `${item.dataset}: ${item.main_metric_label}`,
      value: item.delta_value ?? item.main_metric_value
    }))
    .filter((item): item is { label: string; value: number } => typeof item.value === "number");

  if (rows.length === 0) {
    return [];
  }

  return [
    {
      caption: "Dataset-level outcomes retained in the main paper to anchor the central empirical story.",
      rows
    }
  ];
}

export function figureSelectorAndCaptionWriter(context: ExperimentArtifactContext): PaperManuscriptFigure[] {
  if (context.results.dataset_summaries.length === 0) {
    return [];
  }
  const bars = context.results.dataset_summaries
    .slice(0, 5)
    .map((item) => ({
      label: item.dataset,
      value: item.delta_value ?? item.main_metric_value
    }))
    .filter((item): item is { label: string; value: number } => typeof item.value === "number");

  if (bars.length === 0) {
    return [];
  }

  const caption =
    context.results.figure_captions[0] ||
    "Dataset-level outcome summary with uncertainty-aware interpretation retained in the main paper.";

  return [{ caption, bars }];
}

export function pageBudgetManager(input: {
  draft: Pick<PaperDraft, "sections">;
  profile: PaperProfileConfig;
}): PageBudgetManagerReport {
  const profile = resolvePaperProfile(input.profile);
  const estimatedWordsPerPage = profile.estimated_words_per_page || 420;
  const targetMainWords = profile.main_page_limit * estimatedWordsPerPage;
  const minimumMainWords = Math.round(targetMainWords * 0.62);
  const maximumMainWords = Math.round(targetMainWords * 1.15);
  const estimatedMainWords = estimateDraftWords(input.draft.sections);
  const sections = SECTION_BUDGET_WEIGHTS.map((spec) => {
    const targetWords = Math.round(targetMainWords * spec.weight);
    const minimumWords = Math.round(targetWords * (spec.hardMinimum ? 0.78 : 0.6));
    const maximumWords = Math.round(targetWords * 1.35);
    const section = findSection(input.draft.sections, spec.heading);
    const currentWords = estimateParagraphWords(section?.paragraphs || []);
    const status: SectionBudgetEntry["status"] =
      currentWords < Math.round(targetWords * 0.5)
        ? "fail"
        : currentWords < minimumWords
          ? "warn"
          : "ok";
    return {
      heading: spec.heading,
      minimum_words: minimumWords,
      target_words: targetWords,
      maximum_words: maximumWords,
      hard_minimum: Boolean(spec.hardMinimum),
      current_words: currentWords,
      status
    };
  });

  const warnings: string[] = [];
  if (estimatedMainWords < Math.round(targetMainWords * 0.55)) {
    warnings.push(
      `Estimated main-body length (${estimatedMainWords} words) is far below the ${profile.main_page_limit}-page target budget.`
    );
  } else if (estimatedMainWords < minimumMainWords) {
    warnings.push(
      `Estimated main-body length (${estimatedMainWords} words) is below the minimum budget floor (${minimumMainWords} words).`
    );
  }
  const failedSections = sections.filter((section) => section.status === "fail");
  if (failedSections.length > 0) {
    warnings.push(
      `Core sections are too short for the venue budget: ${failedSections.map((item) => item.heading).join(", ")}.`
    );
  }

  return {
    venue_style: profile.venue_style,
    main_page_limit: profile.main_page_limit,
    estimated_words_per_page: estimatedWordsPerPage,
    minimum_main_words: minimumMainWords,
    target_main_words: targetMainWords,
    maximum_main_words: maximumMainWords,
    estimated_main_words: estimatedMainWords,
    status:
      warnings.length === 0
        ? "ok"
        : failedSections.length > 0 || estimatedMainWords < Math.round(targetMainWords * 0.55)
          ? "fail"
          : "warn",
    sections,
    warnings,
    auto_expand_headings: sections.filter((section) => section.status !== "ok").map((section) => section.heading)
  };
}

export function appendixRouter(input: {
  context: ExperimentArtifactContext;
  profile: PaperProfileConfig;
}): AppendixReference[] {
  const profile = resolvePaperProfile(input.profile);
  if (!profile.appendix_allowed) {
    return [];
  }
  const references: AppendixReference[] = [];
  const preferred = new Set(profile.prefer_appendix_for);

  if (preferred.has("per_fold_results") && input.context.results.dataset_summaries.length > 0) {
    references.push({
      label: "Appendix A",
      target_heading: "Appendix A. Extended Dataset and Repeat-Level Results",
      reason: "repeat-level or per-dataset detail"
    });
  }
  if (preferred.has("hyperparameter_grids") && input.context.method.hyperparameter_notes.length > 0) {
    references.push({
      label: references.length === 0 ? "Appendix A" : "Appendix B",
      target_heading: `${references.length === 0 ? "Appendix A" : "Appendix B"}. Search Space and Configuration Details`,
      reason: "hyperparameter configuration"
    });
  }
  if (preferred.has("environment_dump") && (input.context.method.runtime_measurement || input.context.method.memory_measurement)) {
    references.push({
      label: references.length === 0 ? "Appendix A" : references.length === 1 ? "Appendix B" : "Appendix C",
      target_heading: `${references.length === 0 ? "Appendix A" : references.length === 1 ? "Appendix B" : "Appendix C"}. Reproducibility and Environment Notes`,
      reason: "reproducibility-oriented environment details"
    });
  }
  if (preferred.has("extended_error_analysis") && input.context.discussion.limitations.length > 0) {
    references.push({
      label:
        references.length === 0
          ? "Appendix A"
          : references.length === 1
            ? "Appendix B"
            : references.length === 2
              ? "Appendix C"
              : "Appendix D",
      target_heading: `${references.length === 0 ? "Appendix A" : references.length === 1 ? "Appendix B" : references.length === 2 ? "Appendix C" : "Appendix D"}. Extended Failure Analysis`,
      reason: "extended limitation and failure analysis"
    });
  }

  return references;
}

export function reproducibilityAppendixBuilder(context: ExperimentArtifactContext): AppendixSection | undefined {
  if (!context.reproducibility.has_artifact) {
    return undefined;
  }
  return {
    appendix_label: "Appendix",
    heading: "Appendix. Reproducibility and Measurement Notes",
    paragraphs: [
      uniqueStrings([
        ...context.reproducibility.artifact_notes,
        context.method.seeds.length > 0
          ? `Explicit seeds: ${context.method.seeds.join(", ")}.`
          : "",
        context.method.runtime_measurement
          ? "Runtime was measured and summarized in the reported evaluation outputs."
          : "",
        context.method.memory_measurement
          ? "Peak memory was measured and summarized in the reported evaluation outputs."
          : ""
      ])
        .filter(Boolean)
        .join(" ")
    ].filter(Boolean)
  };
}

export function appendixBuilder(input: {
  context: ExperimentArtifactContext;
  profile: PaperProfileConfig;
}): AppendixPlan {
  const references = appendixRouter({
    context: input.context,
    profile: resolvePaperProfile(input.profile)
  });
  const sections: AppendixSection[] = [];
  const tables: PaperManuscriptTable[] = [];
  const figures: PaperManuscriptFigure[] = [];

  for (const reference of references) {
    if (/repeat-level|per-dataset/iu.test(reference.reason)) {
      sections.push({
        appendix_label: reference.label,
        heading: reference.target_heading,
        paragraphs: input.context.results.dataset_summaries.map((item) => item.summary).slice(0, 6)
      });
      const rows = input.context.results.dataset_summaries
        .map((item) => ({
          label: `${item.dataset}: ${item.delta_label || item.main_metric_label}`,
          value: item.delta_value ?? item.main_metric_value
        }))
        .filter((item): item is { label: string; value: number } => typeof item.value === "number");
      if (rows.length > 0) {
        tables.push({
          caption: "Extended dataset-level metrics and deltas retained outside the main paper.",
          rows: rows.slice(0, 8)
        });
      }
      continue;
    }
    if (/hyperparameter/iu.test(reference.reason)) {
      sections.push({
        appendix_label: reference.label,
        heading: reference.target_heading,
        paragraphs: [
          input.context.method.hyperparameter_notes.join(" ") ||
            "The current artifacts expose only partial search-space information."
        ]
      });
      continue;
    }
    if (/reproducibility-oriented environment/iu.test(reference.reason)) {
      const reproducibilitySection = reproducibilityAppendixBuilder(input.context);
      if (reproducibilitySection) {
        sections.push({
          ...reproducibilitySection,
          appendix_label: reference.label,
          heading: reference.target_heading
        });
      }
      continue;
    }
    if (/extended limitation|failure analysis/iu.test(reference.reason)) {
      sections.push({
        appendix_label: reference.label,
        heading: reference.target_heading,
        paragraphs: uniqueStrings([
          ...input.context.discussion.limitations,
          ...input.context.results.heterogeneity_notes
        ]).slice(0, 6)
      });
    }
  }

  return {
    sections,
    tables,
    figures,
    cross_references: references
  };
}

export function claimStrengthRewriter(input: {
  draft: PaperDraft;
  context: ExperimentArtifactContext;
}): { draft: PaperDraft; report: ClaimStrengthRewriteReport } {
  const rewrites: ClaimStrengthRewrite[] = [];
  const sections = input.draft.sections.map((section) => ({
    ...section,
    paragraphs: section.paragraphs.map((paragraph) => {
      const rewritten = rewriteTextForClaimStrength(paragraph.text, input.context, rewrites);
      return rewritten === paragraph.text ? paragraph : { ...paragraph, text: rewritten };
    })
  }));
  const claims = input.draft.claims.map((claim) => {
    const rewritten = rewriteTextForClaimStrength(claim.statement, input.context, rewrites);
    return rewritten === claim.statement ? claim : { ...claim, statement: rewritten };
  });
  return {
    draft: {
      ...input.draft,
      sections,
      claims
    },
    report: { rewrites }
  };
}

export function manuscriptConsistencyLinter(input: {
  manuscript: PaperManuscript;
  context: ExperimentArtifactContext;
}): ConsistencyLintReport {
  const issues: ConsistencyLintIssue[] = [];
  const abstractText = cleanString(input.manuscript.abstract);
  const methodText = getSectionText(input.manuscript.sections, "Method");
  const resultsText = getSectionText(input.manuscript.sections, "Results");
  const discussionText = getSectionText(input.manuscript.sections, "Discussion");
  const conclusionText = getSectionText(input.manuscript.sections, "Conclusion");
  const appendixText = (input.manuscript.appendix_sections || []).flatMap((section) => section.paragraphs).join(" ");

  for (const modelName of input.context.method.model_names) {
    if (
      modelName &&
      !includesWord(methodText, modelName) &&
      (includesWord(resultsText, modelName) || includesWord(discussionText, modelName))
    ) {
      issues.push({
        kind: "method_results_mismatch",
        severity: "error",
        message: `Results or Discussion mention ${modelName}, but Method does not describe it.`
      });
    }
  }

  for (const caption of [
    ...(input.manuscript.tables || []).map((item) => item.caption),
    ...(input.manuscript.figures || []).map((item) => item.caption),
    ...((input.manuscript.appendix_tables as PaperManuscriptTable[] | undefined) || []).map((item) => item.caption),
    ...((input.manuscript.appendix_figures as PaperManuscriptFigure[] | undefined) || []).map((item) => item.caption)
  ]) {
    if (/[a-z0-9]+_[a-z0-9_]+/u.test(caption) || /\.(json|svg|txt|log)\b/iu.test(caption) || /\bstderr\b|\bstdout\b|\bmetric_table\b/iu.test(caption)) {
      issues.push({
        kind: "caption_internal_name",
        severity: "error",
        message: `Caption exposes an internal variable name or artifact token: "${caption}".`
      });
    }
  }

  const allText = [
    abstractText,
    ...input.manuscript.sections.flatMap((section) => section.paragraphs)
  ].join(" ");
  if (/\breproducib(?:le|ility requirement satisfied)\b/iu.test(allText) && !input.context.reproducibility.has_artifact) {
    issues.push({
      kind: "reproducibility_claim",
      severity: "error",
      message: "The manuscript makes a reproducibility-satisfaction claim without supporting artifacts."
    });
  }

  issues.push(
    ...lintCountConsistency({
      abstractText,
      resultsText,
      conclusionText,
      context: input.context
    })
  );
  issues.push(
    ...lintNumericConsistency({
      abstractText,
      resultsText,
      conclusionText,
      appendixText,
      context: input.context
    })
  );
  issues.push(
    ...lintStrongClaimWording({
      abstractText,
      resultsText,
      conclusionText,
      context: input.context
    })
  );

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues
  };
}

export function appendixConsistencyLinter(input: {
  manuscript: PaperManuscript;
  appendixPlan: AppendixPlan;
  pageBudget: PageBudgetManagerReport;
}): ConsistencyLintReport {
  const issues: ConsistencyLintIssue[] = [];
  const mainText = input.manuscript.sections.flatMap((section) => section.paragraphs).join(" ");
  const appendixHeadings = new Set((input.manuscript.appendix_sections || []).map((section) => section.heading));

  for (const reference of input.appendixPlan.cross_references) {
    if (!appendixHeadings.has(reference.target_heading)) {
      issues.push({
        kind: "appendix_reference_missing",
        severity: "error",
        message: `Main-body appendix routing points to "${reference.target_heading}", but the appendix section is missing.`
      });
    }
    if (includesWord(mainText, reference.label) || includesWord(mainText, reference.target_heading)) {
      continue;
    }
    issues.push({
      kind: "appendix_reference_missing",
      severity: "warning",
      message: `Appendix content "${reference.target_heading}" exists, but the main paper never references it.`
    });
  }

  const resultsBudget = input.pageBudget.sections.find((section) => normalizeHeading(section.heading) === "results");
  if (resultsBudget && resultsBudget.current_words < Math.round(resultsBudget.target_words * 0.55) && input.appendixPlan.sections.length > 0) {
    issues.push({
      kind: "main_logic_thin",
      severity: "warning",
      message: "Appendix routing is too aggressive: the main Results section remains too short relative to the target budget."
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues
  };
}

function pushCompletenessIssue(
  issues: ScientificValidationIssue[],
  category: Extract<ScientificValidationCategory, "method_completeness" | "results_richness" | "related_work_richness" | "discussion_richness">,
  code: string,
  report: CompletenessReport,
  fallbackMessage: string
): void {
  if (report.status === "complete") {
    return;
  }
  const details = uniqueStrings([...report.missing, ...report.warnings]).slice(0, 8);
  issues.push({
    code,
    source: "scientific_validation",
    category,
    severity: "warning",
    policy: "strict_fail",
    message: details[0] || fallbackMessage,
    details: details.slice(1)
  });
}

function convertLintIssueToGateIssue(
  issue: ConsistencyLintIssue,
  source: "consistency_lint" | "appendix_lint",
  mode: PaperValidationMode
): WritePaperGateDecisionIssue {
  const strictOnly =
    source === "appendix_lint" && (issue.kind === "main_logic_thin" || issue.kind === "appendix_reference_missing");
  const policy: ScientificValidationPolicy =
    issue.severity === "error" ? "always_fail" : strictOnly ? "strict_fail" : "warn_only";
  return {
    code: issue.kind,
    source,
    category: source === "appendix_lint" ? "appendix" : "consistency",
    severity: issue.severity,
    policy,
    message: issue.message,
    blocking: policy === "always_fail" || (policy === "strict_fail" && mode === "strict_paper")
  };
}

function lintCountConsistency(input: {
  abstractText: string;
  resultsText: string;
  conclusionText: string;
  context: ExperimentArtifactContext;
}): ConsistencyLintIssue[] {
  const expectations = collectCountExpectations(input.context);
  const zones = [
    { label: "Abstract", text: input.abstractText },
    { label: "Results", text: input.resultsText },
    { label: "Conclusion", text: input.conclusionText }
  ];
  const issues: ConsistencyLintIssue[] = [];

  for (const expectation of expectations) {
    for (const zone of zones) {
      if (!zone.text) {
        continue;
      }
      const observed = extractCountClaims(zone.text, expectation.kind);
      for (const value of observed) {
        if (value === expectation.expected) {
          continue;
        }
        issues.push({
          kind: "count_inconsistency",
          severity: "error",
          message: `${zone.label} reports ${value} ${expectation.label}, but upstream artifacts support ${expectation.expected}.`
        });
      }
    }
  }

  return issues;
}

function lintNumericConsistency(input: {
  abstractText: string;
  resultsText: string;
  conclusionText: string;
  appendixText: string;
  context: ExperimentArtifactContext;
}): ConsistencyLintIssue[] {
  const issues: ConsistencyLintIssue[] = [];
  const expectedValues = collectExpectedMetricValues(input.context);
  if (expectedValues.length === 0) {
    return issues;
  }
  const resultsValues = uniqueNumbers([
    ...extractDecimalValues(input.resultsText),
    ...expectedValues
  ]);
  const appendixValues = extractDecimalValues(input.appendixText);
  const zones = [
    { label: "Abstract", text: input.abstractText, allowAppendixWarning: true },
    { label: "Results", text: input.resultsText, allowAppendixWarning: false },
    { label: "Conclusion", text: input.conclusionText, allowAppendixWarning: true }
  ];

  for (const zone of zones) {
    const values = extractDecimalValues(zone.text).slice(0, 8);
    for (const value of values) {
      if (matchesAnyExpectedValue(value, resultsValues)) {
        continue;
      }
      if (zone.allowAppendixWarning && matchesAnyExpectedValue(value, appendixValues)) {
        issues.push({
          kind: "appendix_only_numeric_reference",
          severity: "warning",
          message: `${zone.label} cites ${formatNumber(value)}, but that value appears only in appendix-level detail rather than the main Results section.`
        });
        continue;
      }
      issues.push({
        kind: "numeric_inconsistency",
        severity: "error",
        message: `${zone.label} cites ${formatNumber(value)}, but the structured results do not support that numeric claim.`
      });
    }
  }

  return issues;
}

function lintStrongClaimWording(input: {
  abstractText: string;
  resultsText: string;
  conclusionText: string;
  context: ExperimentArtifactContext;
}): ConsistencyLintIssue[] {
  const issues: ConsistencyLintIssue[] = [];
  const maxDelta = Math.max(
    0,
    ...input.context.results.dataset_summaries
      .map((item) => Math.abs(item.delta_value || 0))
      .filter((value) => Number.isFinite(value))
  );
  const hasIntervalSupport = input.context.results.ci_notes.length > 0;
  const hasRepeatedArtifact = input.context.results.paired_artifact_available;
  const highRiskZones = [
    { label: "Abstract", text: input.abstractText },
    { label: "Conclusion", text: input.conclusionText }
  ];

  for (const zone of highRiskZones) {
    if (!zone.text) {
      continue;
    }
    if (/\bstate-of-the-art\b/iu.test(zone.text)) {
      issues.push({
        kind: "unsupported_strong_claim",
        severity: "error",
        message: `${zone.label} uses "state-of-the-art" language without structured support for that positioning.`
      });
    }
    if (/\bsignificant(?:ly)? improvement\b/iu.test(zone.text)) {
      issues.push({
        kind: "unsupported_strong_claim",
        severity: "error",
        message: `${zone.label} claims significant improvement without an explicit significance-testing artifact in the available results.`
      });
    } else if (/\bsubstantial improvement\b|\blarge improvement\b/iu.test(zone.text) && maxDelta <= 0.05) {
      issues.push({
        kind: "unsupported_strong_claim",
        severity: "warning",
        message: `${zone.label} uses strong improvement language even though the observed delta remains small.`
      });
    }
  }

  if (/\bsignificant(?:ly)? improvement\b|\bsubstantial improvement\b|\bstate-of-the-art\b/iu.test(input.resultsText) && (!hasIntervalSupport || !hasRepeatedArtifact)) {
    issues.push({
      kind: "unsupported_strong_claim",
      severity: "warning",
      message: "Results retain strong improvement language without enough statistical support."
    });
  }

  return issues;
}

function collectCountExpectations(context: ExperimentArtifactContext): Array<{
  kind: "dataset_count" | "repeat_count" | "outer_fold_count" | "inner_fold_count";
  expected: number;
  label: string;
}> {
  const expectations: Array<{
    kind: "dataset_count" | "repeat_count" | "outer_fold_count" | "inner_fold_count";
    expected: number;
    label: string;
  }> = [];
  if (context.method.dataset_names.length > 0) {
    expectations.push({
      kind: "dataset_count",
      expected: context.method.dataset_names.length,
      label: "datasets"
    });
  }
  const repeatCount = extractNumericNoteCount(context.method.repeat_notes) || (context.method.seeds.length > 1 ? context.method.seeds.length : undefined);
  if (repeatCount) {
    expectations.push({
      kind: "repeat_count",
      expected: repeatCount,
      label: "repeats"
    });
  }
  const outerFoldCount = extractNumericNoteCount(context.method.outer_fold_notes);
  if (outerFoldCount) {
    expectations.push({
      kind: "outer_fold_count",
      expected: outerFoldCount,
      label: "outer folds"
    });
  }
  const innerFoldCount = extractNumericNoteCount(context.method.inner_fold_notes);
  if (innerFoldCount) {
    expectations.push({
      kind: "inner_fold_count",
      expected: innerFoldCount,
      label: "inner folds"
    });
  }
  return expectations;
}

function extractCountClaims(
  text: string,
  kind: "dataset_count" | "repeat_count" | "outer_fold_count" | "inner_fold_count"
): number[] {
  const patterns: Record<"dataset_count" | "repeat_count" | "outer_fold_count" | "inner_fold_count", RegExp[]> = {
    dataset_count: [/\b(\d+)\s+datasets?\b/giu],
    repeat_count: [/\b(\d+)\s+(?:repeats?|repeated evaluations?|seeds?)\b/giu],
    outer_fold_count: [/\bouter\s+(\d+)[-\s]?fold\b/giu, /\b(\d+)[-\s]?fold outer\b/giu],
    inner_fold_count: [/\binner\s+(\d+)[-\s]?fold\b/giu, /\b(\d+)[-\s]?fold inner\b/giu]
  };
  return patterns[kind].flatMap((pattern) => collectNumbersFromMatches(text, pattern));
}

function collectExpectedMetricValues(context: ExperimentArtifactContext): number[] {
  return uniqueNumbers([
    ...context.results.dataset_summaries.flatMap((item) => [
      item.main_metric_value,
      item.delta_value,
      item.ci95?.[0],
      item.ci95?.[1],
      item.runtime_seconds_mean,
      item.peak_memory_mb_mean
    ]),
    ...context.results.ci_notes.flatMap((note) => collectDecimalValuesFromText(note))
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
}

function extractDecimalValues(text: string): number[] {
  const cleaned = cleanString(text);
  if (!cleaned) {
    return [];
  }
  return collectDecimalValuesFromText(cleaned).slice(0, 12);
}

function collectDecimalValuesFromText(text: string): number[] {
  return [...cleanString(text).matchAll(/(?<![A-Za-z0-9])(-?\d+\.\d+)(?![A-Za-z0-9])/gu)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value))
    .map((value) => roundMetric(value));
}

function matchesAnyExpectedValue(value: number, expected: number[]): boolean {
  return expected.some((candidate) => Math.abs(candidate - value) <= Math.max(0.005, Math.abs(candidate) * 0.03));
}

function extractNumericNoteCount(notes: string[]): number | undefined {
  for (const note of notes) {
    const first = collectNumbersFromMatches(note, /\b(\d+)(?:[-\s]?fold|\s+repeated|\s+repeats?|\s+seeds?)\b/giu)[0];
    if (typeof first === "number") {
      return first;
    }
  }
  return undefined;
}

function collectNumbersFromMatches(text: string, pattern: RegExp): number[] {
  return [...cleanString(text).matchAll(pattern)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
}

export function applyScientificWritingPolicy(input: {
  draft: PaperDraft;
  bundle: PaperWritingBundle;
  profile: PaperProfileConfig;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
  objectiveMetricProfile?: ObjectiveMetricProfile;
}): ScientificDraftResult {
  const profile = resolvePaperProfile(input.profile);
  const context = experimentArtifactLoader({
    bundle: input.bundle,
    objectiveEvaluation: input.objectiveEvaluation,
    objectiveMetricProfile: input.objectiveMetricProfile
  });
  const methodReport = methodCompletenessValidator(context);
  const resultsReport = resultsRichnessValidator(context);
  const relatedWorkReport = relatedWorkRichnessValidator(context);
  const discussionReport = discussionRichnessValidator(context);
  let upgradedDraft = ensureDraftSections(input.draft, input.bundle, context);
  upgradedDraft = ensureMinimumSectionRichness(upgradedDraft, input.bundle, context);
  const rewritten = claimStrengthRewriter({ draft: upgradedDraft, context });
  upgradedDraft = rewritten.draft;
  let expandedSections: string[] = [];
  let pageBudget = pageBudgetManager({
    draft: upgradedDraft,
    profile
  });
  if (pageBudget.auto_expand_headings.length > 0) {
    expandedSections = [...pageBudget.auto_expand_headings];
    upgradedDraft = expandDraftAgainstBudget(upgradedDraft, input.bundle, context, pageBudget.auto_expand_headings);
    pageBudget = pageBudgetManager({
      draft: upgradedDraft,
      profile
    });
  }
  const appendixPlan = appendixBuilder({
    context,
    profile
  });

  return {
    draft: upgradedDraft,
    page_budget: pageBudget,
    method_completeness: methodReport,
    results_richness: resultsReport,
    related_work_richness: relatedWorkReport,
    discussion_richness: discussionReport,
    claim_rewrite_report: rewritten.report,
    appendix_plan: appendixPlan,
    auto_repairs: {
      expanded_sections: expandedSections
    }
  };
}

export function buildScientificValidationArtifact(input: ScientificDraftResult): ScientificValidationArtifact {
  const issues: ScientificValidationIssue[] = [];
  if (input.page_budget.status !== "ok") {
    issues.push({
      code: input.page_budget.status === "fail" ? "page_budget_shortfall" : "page_budget_warning",
      source: "scientific_validation",
      category: "page_budget",
      severity: "warning",
      policy: "strict_fail",
      message:
        input.page_budget.warnings[0]
        || `Main-body length remains below the venue-aware ${input.page_budget.main_page_limit}-page target.`,
      details: input.page_budget.warnings.slice(1)
    });
  }
  pushCompletenessIssue(
    issues,
    "method_completeness",
    "method_completeness_incomplete",
    input.method_completeness,
    "Method remains incomplete for scientific reporting."
  );
  pushCompletenessIssue(
    issues,
    "results_richness",
    "results_richness_incomplete",
    input.results_richness,
    "Results remain too thin for a full paper."
  );
  pushCompletenessIssue(
    issues,
    "related_work_richness",
    "related_work_richness_incomplete",
    input.related_work_richness,
    "Related Work lacks enough clustering or positioning detail."
  );
  pushCompletenessIssue(
    issues,
    "discussion_richness",
    "discussion_richness_incomplete",
    input.discussion_richness,
    "Discussion or Limitations remain too thin."
  );

  return {
    page_budget: input.page_budget,
    method_completeness: input.method_completeness,
    results_richness: input.results_richness,
    related_work_richness: input.related_work_richness,
    discussion_richness: input.discussion_richness,
    claim_rewrite_report: input.claim_rewrite_report,
    appendix_plan: input.appendix_plan,
    auto_repairs: {
      claim_rewrite_count: input.claim_rewrite_report.rewrites.length,
      expanded_sections: input.auto_repairs.expanded_sections,
      appendix_route_count: input.appendix_plan.cross_references.length
    },
    issues
  };
}

export function buildWritePaperGateDecision(input: {
  mode: PaperValidationMode;
  scientificValidation: ScientificValidationArtifact;
  consistencyLint: ConsistencyLintReport;
  appendixLint: ConsistencyLintReport;
}): WritePaperGateDecision {
  const issues: WritePaperGateDecisionIssue[] = [
    ...input.scientificValidation.issues.map((issue) => ({
      ...issue,
      blocking: issue.policy === "always_fail" || (issue.policy === "strict_fail" && input.mode === "strict_paper")
    })),
    ...input.consistencyLint.issues.map((issue) => convertLintIssueToGateIssue(issue, "consistency_lint", input.mode)),
    ...input.appendixLint.issues.map((issue) => convertLintIssueToGateIssue(issue, "appendix_lint", input.mode))
  ];
  const blockingIssues = issues.filter((issue) => issue.blocking);
  const warningCount = issues.filter((issue) => !issue.blocking).length;
  const failureReasons = blockingIssues.map((issue) => issue.message);
  const summary = blockingIssues.length > 0
    ? [`write_paper quality gate failed in ${input.mode} mode.`, ...failureReasons]
    : issues.length > 0
      ? [
          `write_paper quality gate emitted ${issues.length} non-blocking validation issue(s) in ${input.mode} mode.`,
          ...issues.map((issue) => issue.message)
        ]
      : [`write_paper quality gate passed in ${input.mode} mode.`];

  return {
    mode: input.mode,
    status: blockingIssues.length > 0 ? "fail" : issues.length > 0 ? "warn" : "pass",
    issues,
    blocking_issue_count: blockingIssues.length,
    warning_count: warningCount,
    failure_reasons: failureReasons,
    summary
  };
}

export function materializeScientificManuscript(input: {
  candidate: PaperManuscript;
  draft: PaperDraft;
  bundle: PaperWritingBundle;
  profile: PaperProfileConfig;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
  objectiveMetricProfile?: ObjectiveMetricProfile;
  appendixPlan: AppendixPlan;
  pageBudget: PageBudgetManagerReport;
}): ScientificManuscriptResult {
  const context = experimentArtifactLoader({
    bundle: input.bundle,
    objectiveEvaluation: input.objectiveEvaluation,
    objectiveMetricProfile: input.objectiveMetricProfile
  });
  const candidateSectionMap = new Map(
    input.candidate.sections.map((section) => [normalizeHeading(section.heading), section] as const)
  );

  const sections: PaperManuscriptSection[] = input.draft.sections.map((section) => {
    const candidateSection = candidateSectionMap.get(normalizeHeading(section.heading));
    const candidateParagraphs = candidateSection?.paragraphs || [];
    const mergedParagraphs = candidateParagraphs.length >= section.paragraphs.length
      ? candidateParagraphs
      : [
          ...candidateParagraphs,
          ...section.paragraphs.slice(candidateParagraphs.length).map((paragraph) => paragraph.text)
        ];
    return {
      heading: section.heading,
      paragraphs: mergedParagraphs.map((paragraph) =>
        rewriteTextForClaimStrength(paragraph, context, [])
      ),
      source_refs: buildSectionSourceRefs(section, input.draft.claims)
    };
  });

  const tables = datasetResultTableBuilder(context).length > 0
    ? datasetResultTableBuilder(context).map((table) => ({
        ...table,
        source_refs: buildArtifactSourceRefs(["result_analysis.metric_table", "latest_results.dataset_summaries"])
      }))
    : input.candidate.tables;
  const figures = figureSelectorAndCaptionWriter(context).length > 0
    ? figureSelectorAndCaptionWriter(context).map((figure) => ({
        ...figure,
        source_refs: buildArtifactSourceRefs(["result_analysis.figure_specs", "latest_results.dataset_summaries"])
      }))
    : input.candidate.figures;
  const appendixSections = input.appendixPlan.sections.map((section) => ({
    ...section,
    source_refs: buildArtifactSourceRefs([`appendix:${section.heading}`, "latest_results", "result_analysis"])
  }));
  const appendixTables = input.appendixPlan.tables.map((table) => ({
    ...table,
    source_refs: buildArtifactSourceRefs(["appendix:dataset_tables", "latest_results.dataset_summaries"])
  }));
  const appendixFigures = input.appendixPlan.figures.map((figure) => ({
    ...figure,
    source_refs: buildArtifactSourceRefs(["appendix:figures", "result_analysis.figure_specs"])
  }));

  const manuscript: PaperManuscript = {
    ...input.candidate,
    abstract: rewriteTextForClaimStrength(input.candidate.abstract, context, []),
    sections,
    ...(tables ? { tables } : {}),
    ...(figures ? { figures } : {}),
    appendix_sections: appendixSections,
    appendix_tables: appendixTables,
    appendix_figures: appendixFigures
  };
  attachAppendixCrossReferences(manuscript, input.appendixPlan);

  const consistency = manuscriptConsistencyLinter({
    manuscript,
    context
  });
  const appendixLint = appendixConsistencyLinter({
    manuscript,
    appendixPlan: input.appendixPlan,
    pageBudget: input.pageBudget
  });

  return {
    manuscript,
    consistency_lint: consistency,
    appendix_lint: appendixLint
  };
}

function attachAppendixCrossReferences(
  manuscript: PaperManuscript,
  appendixPlan: AppendixPlan
): void {
  if (appendixPlan.cross_references.length === 0) {
    return;
  }
  const preferredTargets: Array<{ heading: string; reference: AppendixReference["label"]; sentence: string }> = [
    {
      heading: "Method",
      reference: appendixPlan.cross_references[0]?.label || "Appendix",
      sentence: `Additional protocol detail is summarized in ${appendixPlan.cross_references[0]?.label || "the appendix"}.`
    },
    {
      heading: "Results",
      reference: appendixPlan.cross_references[0]?.label || "Appendix",
      sentence: `Extended repeat-level and dataset-level slices are reported in ${appendixPlan.cross_references[0]?.label || "the appendix"}.`
    },
    {
      heading: "Limitations",
      reference: appendixPlan.cross_references[appendixPlan.cross_references.length - 1]?.label || "Appendix",
      sentence: `Supporting caveats and extended failure analysis appear in ${appendixPlan.cross_references[appendixPlan.cross_references.length - 1]?.label || "the appendix"}.`
    }
  ];

  for (const target of preferredTargets) {
    const section = findSection(manuscript.sections, target.heading);
    if (!section || section.paragraphs.length === 0) {
      continue;
    }
    const lastIndex = section.paragraphs.length - 1;
    if (section.paragraphs[lastIndex]?.includes(target.reference)) {
      continue;
    }
    section.paragraphs[lastIndex] = `${section.paragraphs[lastIndex]} ${target.sentence}`.trim();
  }
}

function ensureDraftSections(
  draft: PaperDraft,
  bundle: PaperWritingBundle,
  context: ExperimentArtifactContext
): PaperDraft {
  const nextSections = [...draft.sections];
  for (const heading of SECTION_BUDGET_WEIGHTS.map((item) => item.heading)) {
    if (findSection(nextSections, heading)) {
      continue;
    }
    const candidates = buildSectionParagraphCandidates(heading, bundle, context);
    if (candidates.length === 0) {
      continue;
    }
    nextSections.push({
      heading,
      paragraphs: candidates.slice(0, SECTION_MIN_PARAGRAPHS[normalizeHeading(heading)] || 1),
      evidence_ids: inferSectionEvidenceIds(draft, bundle),
      citation_paper_ids: inferSectionCitationIds(draft, bundle)
    });
  }
  return {
    ...draft,
    sections: sortDraftSections(nextSections)
  };
}

function ensureMinimumSectionRichness(
  draft: PaperDraft,
  bundle: PaperWritingBundle,
  context: ExperimentArtifactContext
): PaperDraft {
  const sections = draft.sections.map((section) => {
    const minimumParagraphs = SECTION_MIN_PARAGRAPHS[normalizeHeading(section.heading)] || 1;
    const maximumParagraphs = SECTION_MAX_PARAGRAPHS[normalizeHeading(section.heading)] || 6;
    const candidates = buildSectionParagraphCandidates(section.heading, bundle, context);
    const merged = dedupeParagraphs([...section.paragraphs, ...candidates]);
    return {
      ...section,
      paragraphs: merged.slice(0, Math.max(minimumParagraphs, Math.min(maximumParagraphs, merged.length)))
    };
  });
  return {
    ...draft,
    sections: sortDraftSections(sections)
  };
}

function expandDraftAgainstBudget(
  draft: PaperDraft,
  bundle: PaperWritingBundle,
  context: ExperimentArtifactContext,
  headings: string[]
): PaperDraft {
  const sections = draft.sections.map((section) => {
    if (!headings.some((heading) => normalizeHeading(heading) === normalizeHeading(section.heading))) {
      return section;
    }
    const candidates = buildSectionParagraphCandidates(section.heading, bundle, context, true);
    const maximumParagraphs = SECTION_MAX_PARAGRAPHS[normalizeHeading(section.heading)] || 6;
    return {
      ...section,
      paragraphs: dedupeParagraphs([...section.paragraphs, ...candidates]).slice(0, maximumParagraphs)
    };
  });
  return { ...draft, sections };
}

function buildSectionParagraphCandidates(
  heading: string,
  bundle: PaperWritingBundle,
  context: ExperimentArtifactContext,
  expanded = false
): PaperDraftParagraph[] {
  switch (normalizeHeading(heading)) {
    case "introduction":
      return buildParagraphsFromSentences(
        [
          [
            `This study addresses ${bundle.topic}.`,
            context.results.aggregate_summary[0] || "",
            bundle.objectiveMetric ? `The paper is scoped around ${describeObjectiveMetricForNarrative(bundle.objectiveMetric)}.` : ""
          ],
          [
            `The main gap is that current artifacts often expose headline outcomes without a venue-aware writing structure that separates core claims from supporting detail.`,
            bundle.hypotheses[0]?.text ? `The working hypothesis is that ${lowercaseLeading(bundle.hypotheses[0].text)}.` : "",
            expanded ? `The contribution is therefore to present a denser, evidence-first empirical narrative rather than a short results summary.` : ""
          ]
        ],
        inferSectionEvidenceIds(undefined, bundle),
        inferSectionCitationIds(undefined, bundle)
      );
    case "related work":
      return buildParagraphsFromSentences(
        [
          [
            context.related_work.clusters.length > 0
              ? `Related work clusters around ${joinHumanList(context.related_work.clusters.slice(0, 4))}.`
              : "Related work spans multiple nearby empirical and systems-oriented strands.",
            context.related_work.comparison_axes.length > 0
              ? `The most relevant comparison axes concern ${joinHumanList(context.related_work.comparison_axes.slice(0, 3))}.`
              : ""
          ],
          [
            context.related_work.closest_titles.length > 0
              ? `The closest prior work includes ${joinHumanList(context.related_work.closest_titles)}.`
              : "The closest prior work still leaves open a direct positioning gap for the current study.",
            `${bundle.objectiveMetric ? `The present paper positions itself around ${describeObjectiveMetricForNarrative(bundle.objectiveMetric)}` : "The present paper positions itself around the stated empirical objective"} while keeping claims limited to the available artifacts.`
          ],
          expanded
            ? [
                "This positioning is intentionally narrower than a broad novelty claim: it clarifies where the current study overlaps with prior baselines and where evidence remains thin."
              ]
            : []
        ].filter((item) => item.length > 0),
        inferSectionEvidenceIds(undefined, bundle),
        inferSectionCitationIds(undefined, bundle)
      );
    case "method":
      return buildParagraphsFromSentences(
        [
          [
            context.method.dataset_names.length > 0
              ? `The evaluation spans ${joinHumanList(context.method.dataset_names)}.`
              : "The evaluation dataset scope is not yet fully specified in upstream artifacts.",
            context.method.model_names.length > 0
              ? `Models or conditions include ${joinHumanList(context.method.model_names.slice(0, 4))}.`
              : ""
          ],
          [
            context.method.preprocessing_steps.length > 0
              ? `Preprocessing follows this order: ${joinHumanList(context.method.preprocessing_steps.slice(0, 4))}.`
              : "Preprocessing details remain limited in the current artifacts and should be read conservatively.",
            context.method.selection_metrics.length > 0
              ? `Model selection and reporting focus on ${joinHumanList(context.method.selection_metrics.slice(0, 4))}.`
              : "Model selection and reporting metrics remain partially specified in the current artifacts."
          ],
          [
            context.method.outer_fold_notes.length > 0 || context.method.inner_fold_notes.length > 0 || context.method.repeat_notes.length > 0
              ? `The protocol records ${joinHumanList([
                  ...context.method.outer_fold_notes,
                  ...context.method.inner_fold_notes,
                  ...context.method.repeat_notes
                ].slice(0, 4))}.`
              : "Cross-validation and repetition details remain partially specified in the current artifacts.",
            context.method.runtime_measurement || context.method.memory_measurement
              ? `Runtime${context.method.memory_measurement ? " and memory" : ""} are explicitly measured in the evaluation outputs.`
              : ""
          ],
          expanded
            ? [
                context.method.hyperparameter_notes.length > 0
                  ? `Search-space notes retained for the appendix include ${joinHumanList(context.method.hyperparameter_notes.slice(0, 3))}.`
                  : "Hyperparameter search details remain limited and are surfaced cautiously."
              ]
            : []
        ].filter((item) => item.length > 0),
        inferSectionEvidenceIds(undefined, bundle),
        inferSectionCitationIds(undefined, bundle)
      );
    case "results":
      return buildParagraphsFromSentences(
        [
          [context.results.aggregate_summary[0] || "The main empirical story remains grounded in the reported objective-oriented evaluation."],
          context.results.dataset_summaries[0]
            ? [context.results.dataset_summaries[0].summary]
            : [],
          context.results.dataset_summaries[1]
            ? [context.results.dataset_summaries[1].summary]
            : context.results.heterogeneity_notes[0]
              ? [context.results.heterogeneity_notes[0]]
              : [],
          [
            context.results.dispersion_notes[0] || context.results.ci_notes[0] || context.results.ci_unavailable_reason || "",
            context.results.runtime_notes[0] || "",
            context.results.memory_notes[0] || "",
            expanded && context.results.effect_notes[0] ? context.results.effect_notes[0] : ""
          ]
        ].filter((item) => item.length > 0),
        inferSectionEvidenceIds(undefined, bundle),
        inferSectionCitationIds(undefined, bundle)
      );
    case "discussion":
      return buildParagraphsFromSentences(
        [
          [
            context.discussion.discussion_points[0] ||
              "The reported outcomes should be interpreted as bounded evidence rather than a universal win.",
            context.results.effect_notes[0] || ""
          ],
          [
            context.discussion.practical_implications[0] ||
              "In practical terms, the current evidence is most useful as a benchmark or reproducibility note rather than a broad method claim.",
            expanded && context.results.heterogeneity_notes[0] ? context.results.heterogeneity_notes[0] : ""
          ]
        ],
        inferSectionEvidenceIds(undefined, bundle),
        inferSectionCitationIds(undefined, bundle)
      );
    case "limitations":
      return buildParagraphsFromSentences(
        [
          [
            context.discussion.limitations[0] ||
              "The current paper is limited by the granularity of upstream artifacts and the scope of the available evaluation traces.",
            context.results.ci_unavailable_reason || ""
          ]
        ],
        inferSectionEvidenceIds(undefined, bundle),
        inferSectionCitationIds(undefined, bundle)
      );
    case "conclusion":
      return buildParagraphsFromSentences(
        [
          [
            "The paper therefore reports a dense but cautious empirical narrative grounded in the available artifacts.",
            "Detailed protocol and repeat-level evidence are routed to the appendix so the main paper can retain its central logic."
          ]
        ],
        inferSectionEvidenceIds(undefined, bundle),
        inferSectionCitationIds(undefined, bundle)
      );
    default:
      return [];
  }
}

function buildPracticalImplications(
  bundle: PaperWritingBundle,
  datasetSummaries: DatasetResultSummary[]
): string[] {
  const implications: string[] = [];
  if (datasetSummaries.some((item) => typeof item.delta_value === "number" && item.delta_value > 0)) {
    implications.push(
      `The current evidence is most actionable as a cautious benchmark note for ${bundle.topic}, especially where small positive deltas repeat across datasets.`
    );
  }
  if (datasetSummaries.some((item) => typeof item.runtime_seconds_mean === "number")) {
    implications.push(
      "Practical adoption should weigh any observed quality gain against the accompanying runtime or memory footprint."
    );
  }
  return uniqueStrings(implications).slice(0, 3);
}

function collectDatasetResultSummaries(input: {
  latestResults: Record<string, unknown>;
  resultAnalysis?: ResultAnalysisArtifact;
  objectiveMetricProfile?: ObjectiveMetricProfile;
}): DatasetResultSummary[] {
  const datasetEntries = asArray(input.latestResults.dataset_summaries).map((item) => asRecord(item));
  const repeatRecords = asArray(input.latestResults.repeat_records).map((item) => asRecord(item));
  const summaries: DatasetResultSummary[] = [];

  for (const datasetEntry of datasetEntries) {
    const datasetName = asString(datasetEntry.dataset) || "dataset";
    const workflowMap = asRecord(datasetEntry.workflows);
    if (Object.keys(workflowMap).length > 0) {
      const bestWorkflow = pickBestWorkflowEntry(workflowMap);
      if (!bestWorkflow) {
        continue;
      }
      const ci95 = computeDatasetWorkflowDeltaCi(repeatRecords, datasetName, bestWorkflow.name);
      const heterogeneityNotes = uniqueStrings([
        typeof asNumber(bestWorkflow.value.pairwise_ranking_agreement) === "number"
          ? `ranking agreement=${formatNumber(asNumber(bestWorkflow.value.pairwise_ranking_agreement))}`
          : "",
        typeof asNumber(bestWorkflow.value.winner_consistency) === "number"
          ? `winner consistency=${formatNumber(asNumber(bestWorkflow.value.winner_consistency))}`
          : ""
      ]).filter(Boolean);
      const bestModel = pickBestModelEntry(asRecord(bestWorkflow.value.models));
      const score = asNumber(bestModel?.value.mean_test_macro_f1) ?? asNumber(bestModel?.value.test_macro_f1);
      const delta =
        asNumber(bestModel?.value.mean_delta_vs_logreg) ??
        asNumber(bestModel?.value.macro_f1_delta_vs_logreg) ??
        difference(score, asNumber(asRecord(asRecord(bestWorkflow.value.models).logreg).mean_test_macro_f1));
      const runtime = asNumber(bestWorkflow.value.runtime_seconds_mean);
      const memory = asNumber(bestWorkflow.value.peak_memory_mb_mean);
      summaries.push({
        dataset: datasetName,
        label: `${datasetName} (${bestWorkflow.name})`,
        main_metric_label: humanizeToken(input.objectiveMetricProfile?.primaryMetric || "main score"),
        main_metric_value: score,
        delta_label: "delta vs logistic regression",
        delta_value: delta,
        ...(ci95 ? { ci95 } : {}),
        ...(typeof runtime === "number" ? { runtime_seconds_mean: runtime } : {}),
        ...(typeof memory === "number" ? { peak_memory_mb_mean: memory } : {}),
        heterogeneity_notes: heterogeneityNotes,
        summary: buildDatasetSummaryText({
          dataset: datasetName,
          workflow: bestWorkflow.name,
          mainScore: score,
          delta,
          ci95,
          runtime,
          memory,
          heterogeneityNotes
        })
      });
      continue;
    }

    const modelMap = asRecord(datasetEntry.models);
    if (Object.keys(modelMap).length === 0) {
      continue;
    }
    const bestModel = pickBestModelEntry(modelMap);
    if (!bestModel) {
      continue;
    }
    const score = asNumber(bestModel.value.macro_f1) ?? asNumber(bestModel.value.mean_test_macro_f1);
    const delta = asNumber(bestModel.value.macro_f1_delta_vs_logreg);
    const runtime = asNumber(bestModel.value.runtime_seconds) ?? asNumber(bestModel.value.runtime_seconds_mean);
    const memory = asNumber(bestModel.value.peak_memory_mb) ?? asNumber(bestModel.value.peak_memory_mb_mean);
    summaries.push({
      dataset: datasetName,
      label: `${datasetName} (${bestModel.name})`,
      main_metric_label: humanizeToken(input.objectiveMetricProfile?.primaryMetric || "main score"),
      main_metric_value: score,
      delta_label: "delta vs logistic regression",
      delta_value: delta,
      ...(typeof runtime === "number" ? { runtime_seconds_mean: runtime } : {}),
      ...(typeof memory === "number" ? { peak_memory_mb_mean: memory } : {}),
      heterogeneity_notes: [],
      summary: buildDatasetSummaryText({
        dataset: datasetName,
        workflow: bestModel.name,
        mainScore: score,
        delta,
        runtime,
        memory,
        heterogeneityNotes: []
      })
    });
  }

  return summaries.slice(0, 8);
}

function collectAggregateResults(
  resultAnalysis: ResultAnalysisArtifact | undefined,
  objectiveEvaluation: ObjectiveMetricEvaluation | undefined,
  objectiveMetricProfile: ObjectiveMetricProfile | undefined
): string[] {
  return uniqueStrings([
    cleanString(objectiveEvaluation?.summary),
    cleanString(resultAnalysis?.objective_metric?.evaluation?.summary),
    typeof resultAnalysis?.mean_score === "number"
      ? `The mean reported metric magnitude is ${formatNumber(resultAnalysis.mean_score)}.`
      : "",
    objectiveMetricProfile?.primaryMetric
      ? `The main reported metric remains ${humanizeToken(objectiveMetricProfile.primaryMetric)}.`
      : ""
  ]).filter(Boolean).slice(0, 4);
}

function collectCiNotes(
  resultAnalysis: ResultAnalysisArtifact | undefined,
  datasetSummaries: DatasetResultSummary[]
): string[] {
  const notes = uniqueStrings([
    ...(resultAnalysis?.statistical_summary?.confidence_intervals || []).map((item) => cleanString(item.summary)),
    ...datasetSummaries
      .filter((item) => item.ci95)
      .map((item) => `${item.dataset} 95% CI for the main delta spans ${formatNumber(item.ci95![0])} to ${formatNumber(item.ci95![1])}.`)
  ]).filter(Boolean);
  return notes.slice(0, 4);
}

function collectDispersionNotes(
  resultAnalysis: ResultAnalysisArtifact | undefined,
  datasetSummaries: DatasetResultSummary[]
): string[] {
  const notes = uniqueStrings([
    ...(resultAnalysis?.statistical_summary?.notes || []).filter((item) => /variance|stability|dispersion|heterogeneity|consistency/iu.test(item)),
    ...datasetSummaries.flatMap((item) => item.heterogeneity_notes)
  ]).filter(Boolean);
  return notes.slice(0, 4);
}

function buildCiUnavailableReason(
  resultAnalysis: ResultAnalysisArtifact | undefined,
  latestResults: Record<string, unknown>
): string | undefined {
  if ((resultAnalysis?.statistical_summary?.confidence_intervals || []).length > 0) {
    return undefined;
  }
  if (asArray(latestResults.repeat_records).length < 2) {
    return "Confidence intervals are unavailable because the current artifacts do not expose enough repeated evaluations.";
  }
  return "Confidence intervals are unavailable because the repeated evaluation artifact could not be aligned to a single reported comparison.";
}

function hasPairedArtifact(latestResults: Record<string, unknown>): boolean {
  return asArray(latestResults.repeat_records).length >= 2;
}

function collectRuntimeNotes(
  datasetSummaries: DatasetResultSummary[],
  resultAnalysis: ResultAnalysisArtifact | undefined
): string[] {
  const fromDatasets = datasetSummaries
    .filter((item) => typeof item.runtime_seconds_mean === "number")
    .map((item) => `${item.dataset} mean runtime is ${formatNumber(item.runtime_seconds_mean)}s.`);
  const fromAnalysis = (resultAnalysis?.metric_table || [])
    .filter((item) => /runtime|latency/iu.test(item.key))
    .map((item) => `${humanizeToken(item.key)}=${formatNumber(item.value)}.`);
  return uniqueStrings([...fromDatasets, ...fromAnalysis]).slice(0, 4);
}

function collectMemoryNotes(
  datasetSummaries: DatasetResultSummary[],
  resultAnalysis: ResultAnalysisArtifact | undefined
): string[] {
  const fromDatasets = datasetSummaries
    .filter((item) => typeof item.peak_memory_mb_mean === "number")
    .map((item) => `${item.dataset} mean peak memory is ${formatNumber(item.peak_memory_mb_mean)} MB.`);
  const fromAnalysis = (resultAnalysis?.metric_table || [])
    .filter((item) => /memory|ram/iu.test(item.key))
    .map((item) => `${humanizeToken(item.key)}=${formatNumber(item.value)}.`);
  return uniqueStrings([...fromDatasets, ...fromAnalysis]).slice(0, 4);
}

function collectFigureCaptions(
  resultAnalysis: ResultAnalysisArtifact | undefined,
  datasetSummaries: DatasetResultSummary[]
): string[] {
  const captions = uniqueStrings([
    ...(resultAnalysis?.figure_specs || []).map((item) => cleanString(item.summary)),
    datasetSummaries.length > 0
      ? "Dataset-level outcome deltas with runtime and memory context retained in the main paper."
      : ""
  ]).filter(Boolean);
  return captions.slice(0, 3);
}

function collectEffectNotes(
  resultAnalysis: ResultAnalysisArtifact | undefined,
  datasetSummaries: DatasetResultSummary[]
): string[] {
  const notes = uniqueStrings([
    ...(resultAnalysis?.statistical_summary?.effect_estimates || []).map((item) => cleanString(item.summary)),
    ...datasetSummaries
      .filter((item) => typeof item.delta_value === "number")
      .map((item) => `${item.dataset} shows ${item.delta_value! > 0 ? "a positive" : item.delta_value! < 0 ? "a negative" : "a near-zero"} delta of ${formatNumber(item.delta_value)}.`)
  ]).filter(Boolean);
  return notes.slice(0, 4);
}

function collectHeterogeneityNotes(
  datasetSummaries: DatasetResultSummary[],
  resultAnalysis: ResultAnalysisArtifact | undefined
): string[] {
  const notes = uniqueStrings([
    ...datasetSummaries.flatMap((item) => item.heterogeneity_notes),
    ...(resultAnalysis?.statistical_summary?.notes || []).filter((item) => /heterogeneity|across datasets|across runs|consistency/iu.test(item))
  ]).filter(Boolean);
  return notes.slice(0, 4);
}

function collectSelectionMetrics(
  parsedPlan: Record<string, unknown>,
  resultAnalysis: ResultAnalysisArtifact | undefined
): string[] {
  const selectedDesign = asRecord(parsedPlan.selected_design);
  return uniqueStrings([
    ...asStringArray(selectedDesign.metrics),
    ...((resultAnalysis?.metric_table || []).map((item) => item.key) || [])
  ])
    .filter(isSafeMetricLabel)
    .slice(0, 6);
}

function collectReportingMetrics(
  parsedPlan: Record<string, unknown>,
  resultAnalysis: ResultAnalysisArtifact | undefined
): string[] {
  return uniqueStrings([
    ...collectSelectionMetrics(parsedPlan, resultAnalysis),
    ...(resultAnalysis?.objective_metric?.profile?.preferred_metric_keys || [])
  ])
    .filter(isSafeMetricLabel)
    .slice(0, 8);
}

function collectSeeds(parsedPlan: Record<string, unknown>, latestResults: Record<string, unknown>): number[] {
  const protocol = asRecord(latestResults.protocol);
  return uniqueNumbers([
    ...asNumberArray(protocol.seed_schedule),
    ...collectNumbersFromText(JSON.stringify(parsedPlan), /\bseed(?:_schedule|s|)\D+(\d{1,9})/giu)
  ]);
}

function collectModelNames(parsedPlan: Record<string, unknown>, latestResults: Record<string, unknown>): string[] {
  const selectedDesign = asRecord(parsedPlan.selected_design);
  const protocol = asRecord(latestResults.protocol);
  const datasetSummaries = asArray(latestResults.dataset_summaries).map((item) => asRecord(item));
  return uniqueStrings([
    ...asStringArray(protocol.models),
    ...asStringArray(selectedDesign.baselines),
    ...asStringArray(selectedDesign.metrics).filter((item) => /bert|tree|forest|regression|svm|xgboost|workflow|nested/iu.test(item)),
    ...datasetSummaries.flatMap((item) => Object.keys(asRecord(asRecord(item.workflows).nested).models || {})),
    ...datasetSummaries.flatMap((item) => Object.keys(asRecord(item.models)))
  ]).filter(Boolean).slice(0, 8);
}

function collectDatasetNames(
  bundle: PaperWritingBundle,
  parsedPlan: Record<string, unknown>,
  latestResults: Record<string, unknown>
): string[] {
  const selectedDesign = asRecord(parsedPlan.selected_design);
  const protocol = asRecord(latestResults.protocol);
  return uniqueStrings([
    ...bundle.paperSummaries.flatMap((item) => item.datasets || []),
    ...bundle.evidenceRows.map((item) => item.dataset_slot).filter((item): item is string => Boolean(item)),
    ...asStringArray(selectedDesign.datasets),
    ...asStringArray(protocol.datasets),
    ...asArray(latestResults.dataset_summaries)
      .map((item) => asString(asRecord(item).dataset))
      .filter((item): item is string => Boolean(item))
  ]).slice(0, 10);
}

function collectDatasetSourceHints(parsedPlan: Record<string, unknown>, latestResults: Record<string, unknown>): string[] {
  const protocol = asRecord(latestResults.protocol);
  return uniqueStrings([
    ...collectKeywordNotes(parsedPlan, ["uci", "hugging face", "openml", "public benchmark", "benchmark suite"]),
    asString(protocol.dataset_source) || ""
  ]).filter(Boolean).slice(0, 4);
}

function collectSampleSizeHints(parsedPlan: Record<string, unknown>, latestResults: Record<string, unknown>): string[] {
  return uniqueStrings([
    ...collectKeywordNotes(parsedPlan, ["samples", "instances", "rows"]),
    ...collectNumbersAsNotes(latestResults, ["n_samples", "samples", "row_count"])
  ]).slice(0, 4);
}

function collectFeatureHints(parsedPlan: Record<string, unknown>, latestResults: Record<string, unknown>): string[] {
  return uniqueStrings([
    ...collectKeywordNotes(parsedPlan, ["features", "feature count", "columns"]),
    ...collectNumbersAsNotes(latestResults, ["n_features", "feature_count", "num_features"])
  ]).slice(0, 4);
}

function collectClassHints(parsedPlan: Record<string, unknown>, latestResults: Record<string, unknown>): string[] {
  return uniqueStrings([
    ...collectKeywordNotes(parsedPlan, ["classes", "labels", "class count"]),
    ...collectNumbersAsNotes(latestResults, ["n_classes", "class_count", "num_classes"])
  ]).slice(0, 4);
}

function collectPreprocessingSteps(parsedPlan: Record<string, unknown>): string[] {
  const selectedDesign = asRecord(parsedPlan.selected_design);
  return uniqueStrings([
    ...asStringArray(selectedDesign.implementation_notes).filter((item) => /normalize|standardize|preprocess|tokeniz|imput|scale|encode|clean|dedupe/iu.test(item)),
    ...collectKeywordNotes(parsedPlan, ["normalize", "standardize", "preprocess", "imput", "scale", "encode", "clean"])
  ]).slice(0, 6);
}

function collectFoldNotes(parsedPlan: Record<string, unknown>, kind: "outer" | "inner"): string[] {
  const selectedDesign = asRecord(parsedPlan.selected_design);
  return uniqueStrings([
    ...asStringArray(selectedDesign.evaluation_steps).filter((item) => new RegExp(`\\b${kind}\\b|${kind} fold`, "iu").test(item)),
    ...collectKeywordNotes(parsedPlan, [`${kind} fold`, `${kind} cv`, `${kind} loop`])
  ]).slice(0, 4);
}

function collectRepeatNotes(parsedPlan: Record<string, unknown>, latestResults: Record<string, unknown>): string[] {
  const selectedDesign = asRecord(parsedPlan.selected_design);
  const protocol = asRecord(latestResults.protocol);
  return uniqueStrings([
    ...asStringArray(selectedDesign.evaluation_steps).filter((item) => /repeat|seeded runs|rerun|multiple random seeds/iu.test(item)),
    typeof asNumber(protocol.repeats) === "number"
      ? `${formatNumber(asNumber(protocol.repeats))} repeated evaluations are available in the protocol.`
      : ""
  ]).filter(Boolean).slice(0, 4);
}

function collectHyperparameterNotes(parsedPlan: Record<string, unknown>, latestResults: Record<string, unknown>): string[] {
  const selectedDesign = asRecord(parsedPlan.selected_design);
  return uniqueStrings([
    ...asStringArray(selectedDesign.resource_notes).filter((item) => /grid|search|hyperparameter|sweep|tuning/iu.test(item)),
    ...collectKeywordNotes(parsedPlan, ["hyperparameter", "grid search", "random search", "bayesian search", "tuning"]),
    ...collectKeywordNotes(latestResults, ["hyperparameter", "grid", "search space"])
  ]).slice(0, 6);
}

function hasRuntimeMeasurement(
  resultAnalysis: ResultAnalysisArtifact | undefined,
  latestResults: Record<string, unknown>
): boolean {
  return (
    (resultAnalysis?.metric_table || []).some((item) => /runtime|latency/iu.test(item.key))
    || JSON.stringify(latestResults).includes("runtime_seconds_mean")
  );
}

function hasMemoryMeasurement(
  resultAnalysis: ResultAnalysisArtifact | undefined,
  latestResults: Record<string, unknown>
): boolean {
  return (
    (resultAnalysis?.metric_table || []).some((item) => /memory|ram/iu.test(item.key))
    || JSON.stringify(latestResults).includes("peak_memory_mb")
  );
}

function buildDatasetSummaryText(input: {
  dataset: string;
  workflow: string;
  mainScore?: number;
  delta?: number;
  ci95?: [number, number];
  runtime?: number;
  memory?: number;
  heterogeneityNotes: string[];
}): string {
  const parts = [`On ${input.dataset}, ${humanizeToken(input.workflow)} is the strongest reported condition.`];
  if (typeof input.mainScore === "number") {
    parts.push(`The main score is ${formatNumber(input.mainScore)}.`);
  }
  if (typeof input.delta === "number") {
    parts.push(`The delta versus logistic regression is ${formatNumber(input.delta)}.`);
  }
  if (input.ci95) {
    parts.push(`A normal-approximation 95% interval spans ${formatNumber(input.ci95[0])} to ${formatNumber(input.ci95[1])}.`);
  }
  if (typeof input.runtime === "number" || typeof input.memory === "number") {
    parts.push(
      `Resource use is ${typeof input.runtime === "number" ? `${formatNumber(input.runtime)}s runtime` : ""}${typeof input.runtime === "number" && typeof input.memory === "number" ? " and " : ""}${typeof input.memory === "number" ? `${formatNumber(input.memory)} MB peak memory` : ""}.`
    );
  }
  if (input.heterogeneityNotes.length > 0) {
    parts.push(`Heterogeneity cues include ${joinHumanList(input.heterogeneityNotes.slice(0, 2))}.`);
  }
  return parts.join(" ");
}

function rewriteTextForClaimStrength(
  text: string,
  context: ExperimentArtifactContext,
  rewrites: ClaimStrengthRewrite[]
): string {
  let next = cleanString(text);
  if (!next) {
    return text;
  }

  const hasCi = context.results.ci_notes.length > 0;
  const hasReproArtifact = context.reproducibility.has_artifact;
  const hasRuntimeMemory = context.method.runtime_measurement || context.method.memory_measurement;
  const hasNoveltySupport = context.related_work.closest_titles.length > 0;

  const replace = (
    pattern: RegExp,
    replacement: string,
    category: ClaimStrengthRewrite["category"],
    reason: string
  ) => {
    const before = next;
    next = next.replace(pattern, replacement);
    if (next !== before) {
      rewrites.push({ category, before, after: next, reason });
    }
  };

  if (!hasCi) {
    replace(/\bsignificant improvement\b/giu, "a positive delta under this benchmark", "performance", "no interval or inferential support");
    replace(/\bdemonstrates improvement\b/giu, "suggests a positive delta under this benchmark", "performance", "headline improvement exceeds available statistical support");
  }
  if (!hasReproArtifact) {
    replace(/\breproducibility requirement satisfied\b/giu, "some reproducibility-oriented evidence is available, although supporting artifacts remain limited", "reproducibility", "reproducibility claim lacks explicit artifact support");
    replace(/\bfully reproducible\b/giu, "partially documented for reproducibility", "reproducibility", "reproducibility artifact set is incomplete");
  }
  if (!hasRuntimeMemory) {
    replace(/\befficient\b/giu, "computationally practical within the reported setup", "efficiency", "efficiency claim lacks runtime/memory backing");
  }
  if (!hasNoveltySupport) {
    replace(/\bnovel\b/giu, "distinct within the currently analyzed comparison set", "novelty", "novelty claim lacks closest-prior comparison support");
  }
  if (/robust|stable|stability/iu.test(next) && context.results.dispersion_notes.length === 0) {
    replace(/\brobust\b/giu, "reasonably consistent in the available runs", "robustness", "robustness claim lacks explicit dispersion evidence");
    replace(/\bstable\b/giu, "relatively consistent", "robustness", "stability claim lacks explicit dispersion evidence");
  }

  return next;
}

function buildParagraphsFromSentences(
  sentenceGroups: string[][],
  evidenceIds: string[],
  citationPaperIds: string[]
): PaperDraftParagraph[] {
  return sentenceGroups
    .map((sentences) => cleanString(sentences.filter(Boolean).join(" ")))
    .filter(Boolean)
    .map((text) => ({
      text,
      evidence_ids: evidenceIds.slice(0, 4),
      citation_paper_ids: citationPaperIds.slice(0, 4)
    }));
}

function collectKeywordNotes(value: unknown, keywords: string[]): string[] {
  const haystack = JSON.stringify(value);
  return keywords
    .filter((keyword) => new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu").test(haystack))
    .map((keyword) => `Artifact text references ${keyword}.`);
}

function collectNumbersAsNotes(value: unknown, keys: string[]): string[] {
  const notes: string[] = [];
  for (const key of keys) {
    const matches = collectNumbersFromText(JSON.stringify(value), new RegExp(`${key}"?\\s*[:=]\\s*(\\d+(?:\\.\\d+)?)`, "giu"));
    for (const match of matches) {
      notes.push(`${humanizeToken(key)}=${formatNumber(match)}.`);
    }
  }
  return uniqueStrings(notes);
}

function collectNumbersFromText(text: string, pattern: RegExp): number[] {
  const matches: number[] = [];
  let match = pattern.exec(text);
  while (match) {
    const value = Number.parseFloat(match[1] || "");
    if (Number.isFinite(value)) {
      matches.push(value);
    }
    match = pattern.exec(text);
  }
  return matches;
}

function parsePlanYaml(raw: string | undefined): Record<string, unknown> {
  const text = cleanString(raw);
  if (!text) {
    return {};
  }
  try {
    return asRecord(YAML.parse(raw || ""));
  } catch {
    return {};
  }
}

function sortDraftSections(sections: PaperDraftSection[]): PaperDraftSection[] {
  const order = new Map(SECTION_BUDGET_WEIGHTS.map((item, index) => [normalizeHeading(item.heading), index] as const));
  return sections
    .slice()
    .sort((left, right) => (order.get(normalizeHeading(left.heading)) ?? 999) - (order.get(normalizeHeading(right.heading)) ?? 999));
}

function inferSectionEvidenceIds(draft: PaperDraft | undefined, bundle: PaperWritingBundle): string[] {
  return uniqueStrings([
    ...(draft?.sections.flatMap((section) => section.evidence_ids) || []),
    ...bundle.evidenceRows.slice(0, 4).map((item) => item.evidence_id)
  ]).filter(Boolean).slice(0, 4);
}

function inferSectionCitationIds(draft: PaperDraft | undefined, bundle: PaperWritingBundle): string[] {
  return uniqueStrings([
    ...(draft?.sections.flatMap((section) => section.citation_paper_ids) || []),
    ...bundle.paperSummaries.slice(0, 4).map((item) => item.paper_id),
    ...(bundle.relatedWorkNotes || []).slice(0, 4).map((item) => item.paper_id)
  ]).filter(Boolean).slice(0, 4);
}

function dedupeParagraphs(paragraphs: PaperDraftParagraph[]): PaperDraftParagraph[] {
  const seen = new Set<string>();
  const unique: PaperDraftParagraph[] = [];
  for (const paragraph of paragraphs) {
    const key = cleanString(paragraph.text).toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(paragraph);
  }
  return unique;
}

function estimateDraftWords(sections: Pick<PaperDraftSection, "paragraphs">[]): number {
  return sections.reduce((total, section) => total + estimateParagraphWords(section.paragraphs), 0);
}

function estimateParagraphWords(paragraphs: Array<{ text: string }>): number {
  return paragraphs.reduce((total, paragraph) => total + wordCount(paragraph.text), 0);
}

function wordCount(text: string): number {
  return cleanString(text).split(/\s+/u).filter(Boolean).length;
}

function findSection<T extends { heading: string }>(sections: T[], heading: string): T | undefined {
  return sections.find((section) => normalizeHeading(section.heading) === normalizeHeading(heading));
}

function buildSectionSourceRefs(section: PaperDraftSection, claims: PaperDraftClaim[]): PaperSourceRef[] | undefined {
  const refs = [
    ...(section.evidence_ids || []).map((id) => ({ kind: "evidence" as const, id })),
    ...collectClaimIdsForSection(claims, section.heading).map((id) => ({ kind: "claim" as const, id })),
    ...(section.citation_paper_ids || []).map((id) => ({ kind: "citation" as const, id }))
  ];
  return refs.length > 0 ? refs : undefined;
}

function buildArtifactSourceRefs(ids: string[]): PaperSourceRef[] | undefined {
  const refs = uniqueStrings(ids).map((id) => ({ kind: "artifact" as const, id }));
  return refs.length > 0 ? refs : undefined;
}

function collectClaimIdsForSection(claims: PaperDraftClaim[], heading: string | undefined): string[] {
  const normalized = normalizeHeading(heading || "");
  if (!normalized) {
    return [];
  }
  return uniqueStrings(
    claims
      .filter((claim) => normalizeHeading(claim.section_heading) === normalized)
      .map((claim) => claim.claim_id)
  );
}

function getSectionText(sections: PaperManuscriptSection[], heading: string): string {
  return findSection(sections, heading)?.paragraphs.join(" ") || "";
}

function pickBestWorkflowEntry(workflows: Record<string, unknown>): { name: string; value: Record<string, unknown> } | undefined {
  return Object.entries(workflows)
    .map(([name, value]) => ({ name, value: asRecord(value) }))
    .sort((left, right) => {
      const leftBest = bestModelScore(asRecord(left.value.models));
      const rightBest = bestModelScore(asRecord(right.value.models));
      return rightBest - leftBest;
    })[0];
}

function pickBestModelEntry(models: Record<string, unknown>): { name: string; value: Record<string, unknown> } | undefined {
  return Object.entries(models)
    .map(([name, value]) => ({ name, value: asRecord(value) }))
    .sort((left, right) => bestModelScore({ [right.name]: right.value }) - bestModelScore({ [left.name]: left.value }))[0];
}

function bestModelScore(models: Record<string, unknown>): number {
  return Object.values(models)
    .map((value) => {
      const record = asRecord(value);
      return asNumber(record.mean_test_macro_f1) ?? asNumber(record.test_macro_f1) ?? asNumber(record.macro_f1) ?? Number.NEGATIVE_INFINITY;
    })
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left)[0] ?? Number.NEGATIVE_INFINITY;
}

function computeDatasetWorkflowDeltaCi(
  repeatRecords: Array<Record<string, unknown>>,
  dataset: string,
  workflow: string
): [number, number] | undefined {
  const deltas = repeatRecords
    .map((record) => {
      const datasetEntry = asArray(record.datasets)
        .map((item) => asRecord(item))
        .find((item) => asString(item.dataset) === dataset);
      if (!datasetEntry) {
        return undefined;
      }
      const workflowEntry = asRecord(asRecord(datasetEntry.workflows)[workflow]);
      const bestModel = pickBestModelEntry(asRecord(workflowEntry.models));
      const score = asNumber(bestModel?.value.test_macro_f1) ?? asNumber(bestModel?.value.mean_test_macro_f1);
      const baseline = asNumber(asRecord(asRecord(workflowEntry.models).logreg).test_macro_f1)
        ?? asNumber(asRecord(asRecord(workflowEntry.models).logreg).mean_test_macro_f1);
      return difference(score, baseline);
    })
    .filter((value): value is number => typeof value === "number");

  return computeNormalApproxCi95(deltas);
}

function computeNormalApproxCi95(values: number[]): [number, number] | undefined {
  if (values.length < 2) {
    return undefined;
  }
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / Math.max(1, values.length - 1);
  const sd = Math.sqrt(variance);
  const halfWidth = 1.96 * (sd / Math.sqrt(values.length));
  return [roundMetric(avg - halfWidth), roundMetric(avg + halfWidth)];
}

function difference(left: number | undefined, right: number | undefined): number | undefined {
  if (typeof left !== "number" || typeof right !== "number") {
    return undefined;
  }
  return roundMetric(left - right);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function pushFieldStatus(
  present: string[],
  missing: string[],
  condition: boolean,
  label: string
): void {
  if (condition) {
    present.push(label);
    return;
  }
  missing.push(label);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => cleanString(item)).filter(Boolean))];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((item) => Number.isFinite(item)).map((item) => Number(item)))];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).map((item) => asString(item)).filter((item): item is string => Boolean(item));
}

function asNumberArray(value: unknown): number[] {
  return asArray(value)
    .map((item) => asNumber(item))
    .filter((item): item is number => typeof item === "number");
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function describeObjectiveMetricForNarrative(value: unknown): string {
  const cleaned = cleanString(value)
    .replace(/\bstate[- ]of[- ]the[- ]art\b/giu, "")
    .replace(/\bsignificant(?:ly)?\b/giu, "")
    .replace(/\bsubstantial\b/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned || "the stated empirical objective";
}

function isSafeMetricLabel(value: string): boolean {
  const cleaned = cleanString(value);
  return Boolean(cleaned) && !/\.(json|svg|txt|log)\b/iu.test(cleaned) && !/^(metrics|confirmatory_metrics|quick_check_metrics)$/iu.test(cleaned);
}

function firstSentence(value: string | undefined): string {
  const text = cleanString(value);
  if (!text) {
    return "";
  }
  const match = text.match(/^(.+?[.!?])(?:\s|$)/u);
  return match?.[1] || text;
}

function normalizeHeading(value: string): string {
  return cleanString(value).toLowerCase();
}

function joinHumanList(values: string[]): string {
  const cleaned = uniqueStrings(values);
  if (cleaned.length === 0) {
    return "";
  }
  if (cleaned.length === 1) {
    return cleaned[0];
  }
  if (cleaned.length === 2) {
    return `${cleaned[0]} and ${cleaned[1]}`;
  }
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
}

function humanizeToken(value: string): string {
  return cleanString(value)
    .replace(/[_./]+/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/\blogreg\b/giu, "logistic regression")
    .trim();
}

function lowercaseLeading(value: string): string {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return "";
  }
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

function formatNumber(value: number | undefined): string {
  if (typeof value !== "number") {
    return "n/a";
  }
  return Number(value.toFixed(4)).toString();
}

function includesWord(haystack: string, needle: string): boolean {
  const text = cleanString(haystack).toLowerCase();
  const token = cleanString(needle).toLowerCase();
  return token.length > 0 && text.includes(token);
}
