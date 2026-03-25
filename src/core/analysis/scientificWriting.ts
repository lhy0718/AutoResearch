import YAML from "yaml";

import type { PaperProfileConfig, ResolvedPaperProfileConfig } from "../../types.js";
import type { ObjectiveMetricEvaluation, ObjectiveMetricProfile } from "../objectiveMetric.js";
import type { ConstraintProfile } from "../runConstraints.js";
import type {
  GateWarningItem,
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

export type NumericFactKind = "metric" | "count";
export type NumericFactSource =
  | "artifact"
  | "abstract"
  | "method"
  | "results"
  | "discussion"
  | "conclusion"
  | "table"
  | "figure"
  | "appendix_section"
  | "appendix_table"
  | "appendix_figure";
export type NumericFactAggregation = "aggregate" | "dataset" | "repeat" | "fold" | "unknown";
export type NumericFactUnit = "score" | "delta" | "ci_lower" | "ci_upper" | "seconds" | "mb" | "count";
export type CountFactKind =
  | "dataset_count"
  | "repeat_count"
  | "outer_fold_count"
  | "inner_fold_count"
  | "run_count"
  | "sample_count";
export type ScientificFindingKind = "contradiction" | "unverifiable" | "repairable" | "informational";
export type GateIssueOutcome = "fail" | "warn" | "auto_repair" | "unverifiable";

export interface NormalizedNumericFact {
  fact_id: string;
  fact_kind: NumericFactKind;
  source: NumericFactSource;
  location: string;
  raw_text: string;
  value: number;
  normalized_value: number;
  metric_key?: string;
  metric_label?: string;
  base_metric_key?: string;
  comparison_target?: string;
  count_kind?: CountFactKind;
  dataset_scope?: string | "aggregate" | "unknown";
  aggregation_level?: NumericFactAggregation;
  unit?: NumericFactUnit;
  source_refs?: PaperSourceRef[];
}

export interface SectionEvidenceDiagnostic {
  section: string;
  thin: boolean;
  missing_evidence_categories: string[];
  expandable_from_existing_evidence: boolean;
  blocked_by_evidence_insufficiency: boolean;
}

export interface EvidenceInsufficiencyReport {
  expandable_from_existing_evidence: boolean;
  missing_evidence_categories: string[];
  thin_sections: string[];
  blocked_by_evidence_insufficiency: boolean;
  section_diagnostics: SectionEvidenceDiagnostic[];
}

export interface ScientificAutoRepairRecheck {
  attempted: boolean;
  page_budget_before: PageBudgetManagerReport["status"];
  page_budget_after: PageBudgetManagerReport["status"];
  resolved_headings: string[];
  unresolved_headings: string[];
}

export interface ManuscriptProvenanceSectionEntry {
  section: string;
  paragraph_anchor_ids: string[];
  claim_anchor_ids: string[];
  numeric_fact_ids: string[];
  source_refs?: PaperSourceRef[];
}

export interface ManuscriptProvenanceParagraphAnchor {
  anchor_id: string;
  section: string;
  paragraph_index: number;
  text_preview: string;
  source_refs?: PaperSourceRef[];
  claim_ids?: string[];
  numeric_fact_ids: string[];
}

export interface ManuscriptProvenanceNumericAnchor {
  anchor_id: string;
  source_anchor_id?: string;
  source: NumericFactSource;
  location: string;
  support_status: "supported" | "appendix_only" | "contradiction" | "unverifiable";
  fact: NormalizedNumericFact;
  supporting_fact_ids: string[];
  source_refs?: PaperSourceRef[];
}

export interface ManuscriptProvenanceVisualEntry {
  anchor_id: string;
  kind: "table" | "figure" | "appendix_table" | "appendix_figure";
  caption: string;
  source_refs?: PaperSourceRef[];
  numeric_fact_ids: string[];
}

export interface ManuscriptProvenanceMap {
  sections: ManuscriptProvenanceSectionEntry[];
  paragraph_anchors: ManuscriptProvenanceParagraphAnchor[];
  numeric_anchors: ManuscriptProvenanceNumericAnchor[];
  visual_anchors: ManuscriptProvenanceVisualEntry[];
}

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
    aggregate_metric_facts: NormalizedNumericFact[];
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
  pairwise_ranking_agreement?: number;
  winner_consistency?: number;
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
  column_count: 1 | 2;
  target_main_pages: number;
  minimum_main_pages: number;
  /** @deprecated Compatibility alias for minimum_main_pages. */
  main_page_limit: number;
  references_counted: boolean;
  appendix_allowed: boolean;
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
    | "numeric_unverifiable"
    | "count_inconsistency"
    | "count_unverifiable"
    | "caption_internal_name"
    | "reproducibility_claim"
    | "unsupported_strong_claim"
    | "appendix_reference_missing"
    | "appendix_only_numeric_reference"
    | "main_logic_thin";
  severity: "warning" | "error";
  message: string;
  finding?: ScientificFindingKind;
  involved_sections?: string[];
  normalized_facts?: NormalizedNumericFact[];
  reason?: string;
  evidence?: string[];
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
  evidence_diagnostics: EvidenceInsufficiencyReport;
  claim_rewrite_report: ClaimStrengthRewriteReport;
  appendix_plan: AppendixPlan;
  auto_repairs: {
    expanded_sections: string[];
    expansion_recheck: ScientificAutoRepairRecheck;
  };
}

export interface ScientificManuscriptResult {
  manuscript: PaperManuscript;
  consistency_lint: ConsistencyLintReport;
  appendix_lint: ConsistencyLintReport;
  provenance_map: ManuscriptProvenanceMap;
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
  finding: ScientificFindingKind;
  message: string;
  details?: string[];
  involved_sections?: string[];
  normalized_facts?: NormalizedNumericFact[];
  reason?: string;
  evidence?: string[];
  expandable_from_existing_evidence?: boolean;
  missing_evidence_categories?: string[];
  thin_sections?: string[];
  blocked_by_evidence_insufficiency?: boolean;
}

export interface ScientificValidationArtifact {
  page_budget: PageBudgetManagerReport;
  method_completeness: CompletenessReport;
  results_richness: CompletenessReport;
  related_work_richness: RelatedWorkRichnessReport;
  discussion_richness: CompletenessReport;
  evidence_diagnostics: EvidenceInsufficiencyReport;
  claim_rewrite_report: ClaimStrengthRewriteReport;
  appendix_plan: AppendixPlan;
  auto_repairs: {
    claim_rewrite_count: number;
    expanded_sections: string[];
    appendix_route_count: number;
    expansion_recheck: ScientificAutoRepairRecheck;
  };
  issues: ScientificValidationIssue[];
}

export interface WritePaperGateDecisionIssue extends ScientificValidationIssue {
  blocking: boolean;
  outcome: GateIssueOutcome;
}

export interface WritePaperGateDecision {
  mode: PaperValidationMode;
  status: "pass" | "warn" | "fail";
  issues: WritePaperGateDecisionIssue[];
  blocking_issue_count: number;
  warning_count: number;
  failure_reasons: string[];
  classification_summary: {
    contradiction_count: number;
    unverifiable_count: number;
    repairable_count: number;
    informational_count: number;
    auto_repair_count: number;
  };
  evidence_summary: {
    thin_sections: string[];
    missing_evidence_categories: string[];
    blocked_by_evidence_insufficiency: boolean;
    expandable_from_existing_evidence: boolean;
  };
  summary: string[];
}

const DEFAULT_PAPER_PROFILE: PaperProfileConfig = {
  venue_style: "acl_long",
  column_count: 2,
  target_main_pages: 8,
  minimum_main_pages: 8,
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
): ResolvedPaperProfileConfig {
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
  const legacyMainPageLimit =
    typeof profile?.main_page_limit === "number" && Number.isFinite(profile.main_page_limit)
      ? Math.max(1, Math.round(profile.main_page_limit))
      : undefined;
  const inferredTargetMainPages =
    typeof profile?.target_main_pages === "number" && Number.isFinite(profile.target_main_pages)
      ? Math.max(1, Math.round(profile.target_main_pages))
      : legacyMainPageLimit
        ?? (/\bshort\b/iu.test(lengthHint) ? 4 : (DEFAULT_PAPER_PROFILE.target_main_pages || 8));
  const inferredMinimumMainPages =
    typeof profile?.minimum_main_pages === "number" && Number.isFinite(profile.minimum_main_pages)
      ? Math.max(1, Math.round(profile.minimum_main_pages))
      : legacyMainPageLimit
        ?? inferredTargetMainPages;

  return {
    venue_style: inferredVenueStyle,
    target_venue_style: cleanString(profile?.target_venue_style) || DEFAULT_PAPER_PROFILE.target_venue_style,
    column_count: profile?.column_count === 1 ? 1 : DEFAULT_PAPER_PROFILE.column_count,
    target_main_pages: inferredTargetMainPages,
    minimum_main_pages: inferredMinimumMainPages,
    main_page_limit: legacyMainPageLimit ?? inferredMinimumMainPages,
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
    aggregate_metric_facts: collectAggregateMetricFacts(resultAnalysis),
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
      label:
        item.delta_value !== undefined
          ? `${item.dataset}: ${item.main_metric_label} ${item.delta_label || "delta"}`
          : `${item.dataset}: ${item.main_metric_label}`,
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
      label:
        item.delta_value !== undefined
          ? `${item.dataset}: ${item.main_metric_label} ${item.delta_label || "delta"}`
          : `${item.dataset}: ${item.main_metric_label}`,
      value: item.delta_value ?? item.main_metric_value
    }))
    .filter((item): item is { label: string; value: number } => typeof item.value === "number");

  if (bars.length === 0) {
    return [];
  }

  const caption = sanitizeVisualCaption(
    context.results.figure_captions[0],
    "Dataset-level outcome summary with uncertainty-aware interpretation retained in the main paper."
  );

  return [{ caption, bars }];
}

function hasInternalCaptionToken(caption: string): boolean {
  return (
    /[a-z0-9]+_[a-z0-9_]+/u.test(caption) ||
    /\.(json|svg|txt|log)\b/iu.test(caption) ||
    /\bstderr\b|\bstdout\b|\bmetric_table\b/iu.test(caption)
  );
}

function sanitizeVisualCaption(caption: string | undefined, fallback: string): string {
  const normalized = cleanString(caption);
  if (!normalized || hasInternalCaptionToken(normalized)) {
    return fallback;
  }
  return normalized;
}

function sanitizeCandidateTables(tables: PaperManuscriptTable[] | undefined): PaperManuscriptTable[] | undefined {
  if (!tables || tables.length === 0) {
    return tables;
  }
  return tables.map((table) => ({
    ...table,
    caption: sanitizeVisualCaption(table.caption, "Main-table summary retained for reproducible reporting.")
  }));
}

function sanitizeCandidateFigures(figures: PaperManuscriptFigure[] | undefined): PaperManuscriptFigure[] | undefined {
  if (!figures || figures.length === 0) {
    return figures;
  }
  return figures.map((figure) => ({
    ...figure,
    caption: sanitizeVisualCaption(
      figure.caption,
      "Dataset-level outcome summary with uncertainty-aware interpretation retained in the main paper."
    )
  }));
}

export function pageBudgetManager(input: {
  draft: Pick<PaperDraft, "sections">;
  profile: PaperProfileConfig;
}): PageBudgetManagerReport {
  const profile = resolvePaperProfile(input.profile);
  const estimatedWordsPerPage = profile.estimated_words_per_page || 420;
  const targetMainWords = profile.target_main_pages * estimatedWordsPerPage;
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
      `Estimated main-body length (${estimatedMainWords} words) is far below the ${profile.target_main_pages}-page target budget.`
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
    column_count: profile.column_count,
    target_main_pages: profile.target_main_pages,
    minimum_main_pages: profile.minimum_main_pages,
    main_page_limit: profile.main_page_limit,
    references_counted: profile.references_counted,
    appendix_allowed: profile.appendix_allowed,
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
          label:
            item.delta_value !== undefined
              ? `${item.dataset}: ${item.main_metric_label} ${item.delta_label || "delta"}`
              : `${item.dataset}: ${item.main_metric_label}`,
          value: item.delta_value ?? item.main_metric_value
        }))
        .filter((item): item is { label: string; value: number } => typeof item.value === "number");
      if (rows.length > 0) {
        tables.push({
          caption: "Extended dataset-level outcomes retained outside the main paper.",
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

  for (const modelName of input.context.method.model_names) {
    if (
      modelName &&
      !includesWord(methodText, modelName) &&
      (includesWord(resultsText, modelName) || includesWord(discussionText, modelName))
    ) {
      issues.push({
        kind: "method_results_mismatch",
        severity: "error",
        finding: "contradiction",
        message: `Results or Discussion mention ${modelName}, but Method does not describe it.`,
        involved_sections: ["Method", includesWord(resultsText, modelName) ? "Results" : "Discussion"],
        reason: "method/results model inventory drift"
      });
    }
  }

  for (const caption of [
    ...(input.manuscript.tables || []).map((item) => item.caption),
    ...(input.manuscript.figures || []).map((item) => item.caption),
    ...((input.manuscript.appendix_tables as PaperManuscriptTable[] | undefined) || []).map((item) => item.caption),
    ...((input.manuscript.appendix_figures as PaperManuscriptFigure[] | undefined) || []).map((item) => item.caption)
  ]) {
    if (hasInternalCaptionToken(caption)) {
      issues.push({
        kind: "caption_internal_name",
        severity: "error",
        finding: "contradiction",
        message: `Caption exposes an internal variable name or artifact token: "${caption}".`,
        reason: "caption leaks internal artifact naming"
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
      finding: "contradiction",
      message: "The manuscript makes a reproducibility-satisfaction claim without supporting artifacts.",
      involved_sections: ["Abstract"],
      reason: "reproducibility claim is not backed by reproducibility artifacts"
    });
  }

  issues.push(
    ...lintCountConsistency({
      manuscript: input.manuscript,
      context: input.context
    })
  );
  issues.push(
    ...lintNumericConsistency({
      manuscript: input.manuscript,
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

function buildEvidenceInsufficiencyReport(input: {
  pageBudget: PageBudgetManagerReport;
  methodReport: CompletenessReport;
  resultsReport: CompletenessReport;
  relatedWorkReport: RelatedWorkRichnessReport;
  discussionReport: CompletenessReport;
}): EvidenceInsufficiencyReport {
  const thinSectionSet = new Set(
    uniqueStrings([
      ...input.pageBudget.sections.filter((section) => section.status !== "ok").map((section) => section.heading),
      ...(input.methodReport.status === "incomplete" ? ["Method"] : []),
      ...(input.resultsReport.status === "incomplete" ? ["Results"] : []),
      ...(input.relatedWorkReport.status === "incomplete" ? ["Related Work"] : []),
      ...(input.discussionReport.status === "incomplete" ? ["Discussion", "Limitations"] : [])
    ])
  );
  const sectionDiagnostics: SectionEvidenceDiagnostic[] = [
    buildSectionEvidenceDiagnostic("Method", thinSectionSet, mapMethodMissingToEvidenceCategories(input.methodReport.missing)),
    buildSectionEvidenceDiagnostic("Results", thinSectionSet, mapResultsMissingToEvidenceCategories(input.resultsReport.missing)),
    buildSectionEvidenceDiagnostic(
      "Related Work",
      thinSectionSet,
      mapRelatedWorkMissingToEvidenceCategories(input.relatedWorkReport.missing)
    ),
    buildSectionEvidenceDiagnostic(
      "Discussion",
      thinSectionSet,
      mapDiscussionMissingToEvidenceCategories(input.discussionReport.missing)
    ),
    buildSectionEvidenceDiagnostic(
      "Limitations",
      thinSectionSet,
      input.discussionReport.status === "incomplete" ? ["error analysis / limitations"] : []
    )
  ];
  const missingEvidenceCategories = uniqueStrings(
    sectionDiagnostics.flatMap((diagnostic) => diagnostic.missing_evidence_categories)
  );
  return {
    expandable_from_existing_evidence: sectionDiagnostics.every(
      (diagnostic) => !diagnostic.thin || diagnostic.expandable_from_existing_evidence
    ),
    missing_evidence_categories: missingEvidenceCategories,
    thin_sections: sectionDiagnostics.filter((diagnostic) => diagnostic.thin).map((diagnostic) => diagnostic.section),
    blocked_by_evidence_insufficiency: sectionDiagnostics.some((diagnostic) => diagnostic.blocked_by_evidence_insufficiency),
    section_diagnostics: sectionDiagnostics.filter(
      (diagnostic) => diagnostic.thin || diagnostic.missing_evidence_categories.length > 0
    )
  };
}

function buildSectionEvidenceDiagnostic(
  section: string,
  thinSectionSet: Set<string>,
  missingEvidenceCategories: string[]
): SectionEvidenceDiagnostic {
  const thin = thinSectionSet.has(section);
  const normalizedMissing = uniqueStrings(missingEvidenceCategories);
  return {
    section,
    thin,
    missing_evidence_categories: normalizedMissing,
    expandable_from_existing_evidence: normalizedMissing.length === 0,
    blocked_by_evidence_insufficiency: thin && normalizedMissing.length > 0
  };
}

function mapMethodMissingToEvidenceCategories(missing: string[]): string[] {
  const categories: string[] = [];
  if (
    missing.some((item) =>
      [
        "dataset names",
        "dataset source",
        "#samples",
        "#features",
        "#classes",
        "imbalance or missingness"
      ].includes(item)
    )
  ) {
    categories.push("dataset/task detail");
  }
  if (missing.some((item) => ["preprocessing steps/order", "fold-internal fit scope"].includes(item))) {
    categories.push("method detail");
  }
  if (
    missing.some((item) =>
      [
        "outer folds",
        "inner folds",
        "repeats",
        "stratification",
        "seeds",
        "hyperparameter search space",
        "selection/reporting metrics"
      ].includes(item)
    )
  ) {
    categories.push("experimental setup");
  }
  if (missing.some((item) => ["runtime measurement", "memory measurement"].includes(item))) {
    categories.push("statistical reporting");
  }
  return categories;
}

function mapResultsMissingToEvidenceCategories(missing: string[]): string[] {
  const categories: string[] = [];
  if (missing.some((item) => ["aggregate summary", "per-dataset results"].includes(item))) {
    categories.push("baseline comparison");
    categories.push("dataset/task detail");
  }
  if (
    missing.some((item) =>
      [
        "dispersion estimates",
        "CI or CI-unavailable rationale",
        "paired/repeated comparison artifact",
        "scientific figure with informative caption"
      ].includes(item)
    )
  ) {
    categories.push("statistical reporting");
  }
  return categories;
}

function mapRelatedWorkMissingToEvidenceCategories(missing: string[]): string[] {
  return missing.length > 0 ? ["related work specificity"] : [];
}

function mapDiscussionMissingToEvidenceCategories(missing: string[]): string[] {
  const categories: string[] = [];
  if (missing.some((item) => ["result interpretation"].includes(item))) {
    categories.push("baseline comparison");
  }
  if (missing.some((item) => ["generalization/evaluation limits", "practical implication"].includes(item))) {
    categories.push("error analysis / limitations");
  }
  return categories;
}

function pushCompletenessIssue(
  issues: ScientificValidationIssue[],
  category: Extract<ScientificValidationCategory, "method_completeness" | "results_richness" | "related_work_richness" | "discussion_richness">,
  code: string,
  report: CompletenessReport,
  fallbackMessage: string,
  diagnostic?: SectionEvidenceDiagnostic
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
    finding: diagnostic?.blocked_by_evidence_insufficiency ? "unverifiable" : "repairable",
    message: details[0] || fallbackMessage,
    details: details.slice(1),
    ...(diagnostic?.missing_evidence_categories.length ? { missing_evidence_categories: diagnostic.missing_evidence_categories } : {}),
    ...(diagnostic?.thin ? { thin_sections: [diagnostic.section] } : {}),
    ...(diagnostic ? { expandable_from_existing_evidence: diagnostic.expandable_from_existing_evidence } : {}),
    ...(diagnostic ? { blocked_by_evidence_insufficiency: diagnostic.blocked_by_evidence_insufficiency } : {})
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
  const blocking = policy === "always_fail" || (policy === "strict_fail" && mode === "strict_paper");
  return {
    code: issue.kind,
    source,
    category: source === "appendix_lint" ? "appendix" : "consistency",
    severity: issue.severity,
    policy,
    finding: issue.finding || (issue.severity === "error" ? "contradiction" : "informational"),
    message: issue.message,
    ...(issue.involved_sections?.length ? { involved_sections: issue.involved_sections } : {}),
    ...(issue.normalized_facts?.length ? { normalized_facts: issue.normalized_facts } : {}),
    ...(issue.reason ? { reason: issue.reason } : {}),
    ...(issue.evidence?.length ? { evidence: issue.evidence } : {}),
    blocking,
    outcome: blocking ? "fail" : (issue.finding || "informational") === "unverifiable" ? "unverifiable" : "warn"
  };
}

function lintCountConsistency(input: {
  manuscript: PaperManuscript;
  context: ExperimentArtifactContext;
}): ConsistencyLintIssue[] {
  const expectedFacts = collectExpectedCountFacts(input.context);
  const observedFacts = collectObservedCountFacts(input.manuscript, input.context);
  const issues: ConsistencyLintIssue[] = [];

  issues.push(...buildObservedFactDriftIssues(observedFacts, "count_inconsistency"));

  for (const observedFact of observedFacts) {
    const comparableFacts = expectedFacts.filter((candidate) => areComparableNumericFacts(observedFact, candidate));
    if (comparableFacts.length === 0) {
      if (shouldWarnOnUnverifiableFact(observedFact.source)) {
        issues.push({
          kind: "count_unverifiable",
          severity: "warning",
          finding: "unverifiable",
          message: `${observedFact.location} cites ${formatNumber(observedFact.value)} as a ${humanizeCountKind(observedFact.count_kind)}, but the current artifacts do not expose a comparable structured count.`,
          involved_sections: [observedFact.location],
          normalized_facts: [observedFact],
          reason: "no comparable structured count fact is available for this count claim"
        });
      }
      continue;
    }
    if (comparableFacts.some((candidate) => areFactValuesEquivalent(observedFact, candidate))) {
      continue;
    }
    issues.push({
      kind: "count_inconsistency",
      severity: "error",
      finding: "contradiction",
      message: `${observedFact.location} reports ${formatNumber(observedFact.value)} ${humanizeCountKind(observedFact.count_kind)}, but upstream artifacts support ${formatNumber(comparableFacts[0]?.value)}.`,
      involved_sections: [observedFact.location],
      normalized_facts: [observedFact, ...comparableFacts.slice(0, 1)],
      reason: "comparable structured count facts disagree with the manuscript claim",
      evidence: comparableFacts.slice(0, 2).map((fact) => `${fact.location}: ${fact.raw_text}`)
    });
  }

  return dedupeConsistencyIssues(issues);
}

function lintNumericConsistency(input: {
  manuscript: PaperManuscript;
  context: ExperimentArtifactContext;
}): ConsistencyLintIssue[] {
  const issues: ConsistencyLintIssue[] = [];
  const expectedFacts = collectExpectedMetricFacts(input.context);
  if (expectedFacts.length === 0) {
    return issues;
  }
  const observedFacts = collectObservedMetricFacts(input.manuscript, input.context);
  const mainFacts = observedFacts.filter((fact) => !isAppendixFactSource(fact.source));
  const appendixFacts = observedFacts.filter((fact) => isAppendixFactSource(fact.source));

  issues.push(...buildObservedFactDriftIssues(mainFacts, "numeric_inconsistency"));

  for (const observedFact of observedFacts) {
    if (isObjectiveThresholdFact(observedFact)) {
      continue;
    }
    const comparableFacts = expectedFacts.filter((candidate) => areComparableNumericFacts(observedFact, candidate));
    if (comparableFacts.length === 0) {
      if (shouldWarnOnUnverifiableFact(observedFact.source)) {
        issues.push({
          kind: "numeric_unverifiable",
          severity: "warning",
          finding: "unverifiable",
          message: `${observedFact.location} cites ${formatNumber(observedFact.value)}, but the current artifacts do not expose a comparable structured numeric fact for ${observedFact.metric_key || "that metric"}.`,
          involved_sections: [observedFact.location],
          normalized_facts: [observedFact],
          reason: "no comparable structured metric fact is available at the same metric/scope/aggregation level"
        });
      }
      continue;
    }
    if (comparableFacts.some((candidate) => areFactValuesEquivalent(observedFact, candidate))) {
      continue;
    }
    const appendixMatch = appendixFacts.find(
      (candidate) =>
        candidate.fact_id !== observedFact.fact_id
        && areComparableNumericFacts(observedFact, candidate)
        && areFactValuesEquivalent(observedFact, candidate)
    );
    if (appendixMatch && allowsAppendixOnlyWarning(observedFact.source)) {
      issues.push({
        kind: "appendix_only_numeric_reference",
        severity: "warning",
        finding: "unverifiable",
        message: `${observedFact.location} cites ${formatNumber(observedFact.value)}, but that comparable value appears only in appendix-level detail rather than the main Results evidence.`,
        involved_sections: [observedFact.location, appendixMatch.location],
        normalized_facts: [observedFact, appendixMatch],
        reason: "the comparable value is only recoverable from appendix-level detail"
      });
      continue;
    }
    // When the observed and expected values are on vastly different scales,
    // it's likely a metric-key misassignment rather than a real contradiction.
    const maxVal = Math.max(Math.abs(observedFact.value), Math.abs(comparableFacts[0]?.value ?? 0));
    const delta = Math.abs(observedFact.value - (comparableFacts[0]?.value ?? 0));
    const largeDelta = maxVal > 0 && (delta / maxVal) > 0.5;
    // Also check if the observed value matches a DIFFERENT metric in the expected
    // facts — if so, the fact extractor likely assigned the wrong metric_key.
    const crossMetricMatch = expectedFacts.some(
      (candidate) =>
        candidate.metric_key !== observedFact.metric_key
        && areFactValuesEquivalent(observedFact, candidate)
    );
    // If the observed value is far from ALL comparable facts (not just the first),
    // it's more likely a scope/key mismatch than a transcription error.
    // A real typo would be close to at least one expected value.
    const minRelDelta = comparableFacts.reduce((best, cf) => {
      const m = Math.max(Math.abs(observedFact.value), Math.abs(cf.value));
      return m > 0 ? Math.min(best, Math.abs(observedFact.value - cf.value) / m) : best;
    }, 1.0);
    const farFromAll = minRelDelta > 0.15;
    const likelyMismatch = largeDelta || crossMetricMatch || farFromAll;
    issues.push({
      kind: "numeric_inconsistency",
      severity: likelyMismatch ? "warning" : "error",
      finding: likelyMismatch ? "unverifiable" : "contradiction",
      message: `${observedFact.location} cites ${formatNumber(observedFact.value)}, but the comparable structured results support ${formatNumber(comparableFacts[0]?.value)} for ${observedFact.metric_key || "that metric"}.`,
      involved_sections: [observedFact.location],
      normalized_facts: [observedFact, ...comparableFacts.slice(0, 2)],
      reason: likelyMismatch
        ? "values differ by more than 50%, suggesting a metric-key mismatch rather than a transcription error"
        : "comparable structured numeric facts disagree with the manuscript claim",
      evidence: comparableFacts.slice(0, 2).map((fact) => `${fact.location}: ${fact.raw_text}`)
    });
  }

  return dedupeConsistencyIssues(issues);
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
        finding: "contradiction",
        message: `${zone.label} uses "state-of-the-art" language without structured support for that positioning.`,
        involved_sections: [zone.label],
        reason: "state-of-the-art framing has no supporting structured evidence"
      });
    }
    if (/\bsignificant(?:ly)? improvement\b/iu.test(zone.text)) {
      issues.push({
        kind: "unsupported_strong_claim",
        severity: "error",
        finding: "contradiction",
        message: `${zone.label} claims significant improvement without an explicit significance-testing artifact in the available results.`,
        involved_sections: [zone.label],
        reason: "significance wording exceeds available statistical evidence"
      });
    } else if (/\bsubstantial improvement\b|\blarge improvement\b/iu.test(zone.text) && maxDelta <= 0.05) {
      issues.push({
        kind: "unsupported_strong_claim",
        severity: "warning",
        finding: "unverifiable",
        message: `${zone.label} uses strong improvement language even though the observed delta remains small.`,
        involved_sections: [zone.label],
        reason: "wording is stronger than the observed effect size"
      });
    }
  }

  if (/\bsignificant(?:ly)? improvement\b|\bsubstantial improvement\b|\bstate-of-the-art\b/iu.test(input.resultsText) && (!hasIntervalSupport || !hasRepeatedArtifact)) {
    issues.push({
      kind: "unsupported_strong_claim",
      severity: "warning",
      finding: "unverifiable",
      message: "Results retain strong improvement language without enough statistical support.",
      involved_sections: ["Results"],
      reason: "statistical support is incomplete for the retained claim wording"
    });
  }

  return issues;
}

function collectExpectedCountFacts(context: ExperimentArtifactContext): NormalizedNumericFact[] {
  const facts: NormalizedNumericFact[] = [];
  const datasetCount =
    uniqueStrings(context.results.dataset_summaries.map((item) => cleanString(item.dataset)).filter(Boolean)).length
    || context.method.dataset_names.length;
  if (datasetCount > 0) {
    facts.push(
      buildStructuredNumericFact({
        factKind: "count",
        source: "artifact",
        location: "artifact.method.dataset_names",
        rawText: `${datasetCount} datasets`,
        value: datasetCount,
        countKind: "dataset_count",
        aggregationLevel: "aggregate",
        unit: "count",
        sourceRefs: buildArtifactSourceRefs(["experiment_plan.selected_design.datasets", "latest_results.protocol.datasets"])
      })
    );
  }
  const repeatCount =
    extractNumericNoteCount(context.method.repeat_notes) || (context.method.seeds.length > 1 ? context.method.seeds.length : undefined);
  if (repeatCount) {
    facts.push(
      buildStructuredNumericFact({
        factKind: "count",
        source: "artifact",
        location: "artifact.method.repeats",
        rawText: `${repeatCount} repeats`,
        value: repeatCount,
        countKind: "repeat_count",
        aggregationLevel: "repeat",
        unit: "count",
        sourceRefs: buildArtifactSourceRefs(["experiment_plan.selected_design.evaluation_steps", "latest_results.protocol.repeats"])
      })
    );
  }
  const outerFoldCount = extractExpectedCountFromNotes(context.method.outer_fold_notes, "outer_fold_count");
  if (outerFoldCount) {
    facts.push(
      buildStructuredNumericFact({
        factKind: "count",
        source: "artifact",
        location: "artifact.method.outer_folds",
        rawText: `${outerFoldCount} outer folds`,
        value: outerFoldCount,
        countKind: "outer_fold_count",
        aggregationLevel: "fold",
        unit: "count",
        sourceRefs: buildArtifactSourceRefs(["experiment_plan.selected_design.evaluation_steps"])
      })
    );
  }
  const innerFoldCount = extractExpectedCountFromNotes(context.method.inner_fold_notes, "inner_fold_count");
  if (innerFoldCount) {
    facts.push(
      buildStructuredNumericFact({
        factKind: "count",
        source: "artifact",
        location: "artifact.method.inner_folds",
        rawText: `${innerFoldCount} inner folds`,
        value: innerFoldCount,
        countKind: "inner_fold_count",
        aggregationLevel: "fold",
        unit: "count",
        sourceRefs: buildArtifactSourceRefs(["experiment_plan.selected_design.evaluation_steps"])
      })
    );
  }
  const sampleCount = extractNumericNoteCount(context.method.sample_size_notes);
  if (sampleCount) {
    facts.push(
      buildStructuredNumericFact({
        factKind: "count",
        source: "artifact",
        location: "artifact.method.samples",
        rawText: `${sampleCount} samples`,
        value: sampleCount,
        countKind: "sample_count",
        aggregationLevel: "aggregate",
        unit: "count",
        sourceRefs: buildArtifactSourceRefs(["experiment_plan.selected_design.implementation_notes", "latest_results.protocol"])
      })
    );
  }
  return facts;
}

function collectObservedCountFacts(
  manuscript: PaperManuscript,
  context: ExperimentArtifactContext
): NormalizedNumericFact[] {
  return dedupeNumericFacts([
    ...extractCountFactsFromText({
      text: manuscript.abstract,
      source: "abstract",
      location: "Abstract",
      sourceRefs: undefined
    }),
    ...manuscript.sections.flatMap((section) =>
      section.paragraphs.flatMap((paragraph) =>
        extractCountFactsFromText({
          text: paragraph,
          source: mapSectionHeadingToNumericFactSource(section.heading),
          location: section.heading,
          sourceRefs: section.source_refs
        })
      )
    ),
    ...((manuscript.appendix_sections || []).flatMap((section) =>
      section.paragraphs.flatMap((paragraph) =>
        extractCountFactsFromText({
          text: paragraph,
          source: "appendix_section",
          location: section.heading,
          sourceRefs: section.source_refs
        })
      )
    ) || [])
  ]);
}

function inferDatasetDeltaMetricKey(
  item: DatasetResultSummary,
  mainMetricKey: string | undefined
): string {
  const explicitLabel = normalizeMetricIdentifier(item.delta_label || "");
  if (explicitLabel && explicitLabel.includes("delta")) {
    return explicitLabel;
  }
  const composedLabel = normalizeMetricIdentifier(`${item.main_metric_label} ${item.delta_label || "delta vs logistic regression"}`);
  if (composedLabel) {
    return composedLabel;
  }
  if (mainMetricKey === "macro_f1") {
    return "macro_f1_delta_vs_logreg";
  }
  return "score_delta_vs_baseline";
}

function collectExpectedMetricFacts(context: ExperimentArtifactContext): NormalizedNumericFact[] {
  return dedupeNumericFacts([
    ...context.results.aggregate_metric_facts,
    ...context.results.dataset_summaries.flatMap((item) => {
      const datasetScope = cleanString(item.dataset) || "unknown";
      const facts: NormalizedNumericFact[] = [];
      const mainMetricKey = normalizeMetricIdentifier(item.main_metric_label);
      const deltaMetricKey = inferDatasetDeltaMetricKey(item, mainMetricKey);
      if (typeof item.main_metric_value === "number" && mainMetricKey) {
        facts.push(
          buildStructuredNumericFact({
            factKind: "metric",
            source: "artifact",
            location: `artifact.dataset.${datasetScope}`,
            rawText: `${item.main_metric_label} ${formatNumber(item.main_metric_value)}`,
            value: item.main_metric_value,
            metricKey: mainMetricKey,
            metricLabel: item.main_metric_label,
            datasetScope,
            aggregationLevel: "dataset",
            unit: "score",
            sourceRefs: buildArtifactSourceRefs(["latest_results.dataset_summaries"])
          })
        );
      }
      if (typeof item.delta_value === "number") {
        facts.push(
          buildStructuredNumericFact({
            factKind: "metric",
            source: "artifact",
            location: `artifact.dataset.${datasetScope}.delta`,
            rawText: `${item.delta_label || "delta"} ${formatNumber(item.delta_value)}`,
            value: item.delta_value,
            metricKey: deltaMetricKey,
            metricLabel: item.delta_label || "delta",
            datasetScope,
            aggregationLevel: "dataset",
            unit: "delta",
            sourceRefs: buildArtifactSourceRefs(["latest_results.dataset_summaries"])
          })
        );
      }
      if (item.ci95) {
        facts.push(
          buildStructuredNumericFact({
            factKind: "metric",
            source: "artifact",
            location: `artifact.dataset.${datasetScope}.ci.lower`,
            rawText: `${item.dataset} CI lower ${formatNumber(item.ci95[0])}`,
            value: item.ci95[0],
            metricKey: deltaMetricKey,
            metricLabel: `${item.delta_label || item.main_metric_label} CI lower`,
            datasetScope,
            aggregationLevel: "dataset",
            unit: "ci_lower",
            sourceRefs: buildArtifactSourceRefs(["latest_results.repeat_records", "result_analysis.statistical_summary.confidence_intervals"])
          }),
          buildStructuredNumericFact({
            factKind: "metric",
            source: "artifact",
            location: `artifact.dataset.${datasetScope}.ci.upper`,
            rawText: `${item.dataset} CI upper ${formatNumber(item.ci95[1])}`,
            value: item.ci95[1],
            metricKey: deltaMetricKey,
            metricLabel: `${item.delta_label || item.main_metric_label} CI upper`,
            datasetScope,
            aggregationLevel: "dataset",
            unit: "ci_upper",
            sourceRefs: buildArtifactSourceRefs(["latest_results.repeat_records", "result_analysis.statistical_summary.confidence_intervals"])
          })
        );
      }
      if (typeof item.pairwise_ranking_agreement === "number") {
        facts.push(
          buildStructuredNumericFact({
            factKind: "metric",
            source: "artifact",
            location: `artifact.dataset.${datasetScope}.pairwise_ranking_agreement`,
            rawText: `${item.dataset} ranking agreement ${formatNumber(item.pairwise_ranking_agreement)}`,
            value: item.pairwise_ranking_agreement,
            metricKey: "pairwise_ranking_agreement",
            metricLabel: "pairwise ranking agreement",
            datasetScope,
            aggregationLevel: "dataset",
            unit: "score",
            sourceRefs: buildArtifactSourceRefs(["latest_results.dataset_summaries"])
          })
        );
      }
      if (typeof item.winner_consistency === "number") {
        facts.push(
          buildStructuredNumericFact({
            factKind: "metric",
            source: "artifact",
            location: `artifact.dataset.${datasetScope}.winner_consistency`,
            rawText: `${item.dataset} winner consistency ${formatNumber(item.winner_consistency)}`,
            value: item.winner_consistency,
            metricKey: "winner_consistency",
            metricLabel: "winner consistency",
            datasetScope,
            aggregationLevel: "dataset",
            unit: "score",
            sourceRefs: buildArtifactSourceRefs(["latest_results.dataset_summaries"])
          })
        );
      }
      if (typeof item.runtime_seconds_mean === "number") {
        facts.push(
          buildStructuredNumericFact({
            factKind: "metric",
            source: "artifact",
            location: `artifact.dataset.${datasetScope}.runtime`,
            rawText: `${item.dataset} runtime ${formatNumber(item.runtime_seconds_mean)}s`,
            value: item.runtime_seconds_mean,
            metricKey: "runtime_seconds",
            metricLabel: "runtime",
            datasetScope,
            aggregationLevel: "dataset",
            unit: "seconds",
            sourceRefs: buildArtifactSourceRefs(["latest_results.dataset_summaries", "result_analysis.metric_table"])
          })
        );
      }
      if (typeof item.peak_memory_mb_mean === "number") {
        facts.push(
          buildStructuredNumericFact({
            factKind: "metric",
            source: "artifact",
            location: `artifact.dataset.${datasetScope}.memory`,
            rawText: `${item.dataset} memory ${formatNumber(item.peak_memory_mb_mean)} MB`,
            value: item.peak_memory_mb_mean,
            metricKey: "peak_memory_mb",
            metricLabel: "peak memory",
            datasetScope,
            aggregationLevel: "dataset",
            unit: "mb",
            sourceRefs: buildArtifactSourceRefs(["latest_results.dataset_summaries", "result_analysis.metric_table"])
          })
        );
      }
      if (item.heterogeneity_notes.length > 0) {
        facts.push(
          ...extractMetricFactsFromText({
            text: `On ${datasetScope}, ${item.heterogeneity_notes.join(" ")}.`,
            source: "artifact",
            location: `artifact.dataset.${datasetScope}.heterogeneity`,
            context,
            sourceRefs: buildArtifactSourceRefs(["latest_results.dataset_summaries"])
          })
        );
        const rankingAgreement = extractFirstMetricValue(
          item.heterogeneity_notes,
          /\branking agreement\s*=\s*(-?\d+(?:\.\d+)?)/iu
        );
        if (typeof rankingAgreement === "number") {
          facts.push(
            buildStructuredNumericFact({
              factKind: "metric",
              source: "artifact",
              location: `artifact.dataset.${datasetScope}.heterogeneity`,
              rawText: `ranking agreement=${formatNumber(rankingAgreement)}`,
              value: rankingAgreement,
              metricKey: "pairwise_ranking_agreement",
              metricLabel: "pairwise ranking agreement",
              datasetScope,
              aggregationLevel: "dataset",
              unit: "score",
              sourceRefs: buildArtifactSourceRefs(["latest_results.dataset_summaries"])
            })
          );
        }
      }
      return facts;
    })
  ]);
}

function collectObservedMetricFacts(
  manuscript: PaperManuscript,
  context: ExperimentArtifactContext
): NormalizedNumericFact[] {
  const sections = manuscript.sections;
  const appendixSections = manuscript.appendix_sections || [];
  return dedupeNumericFacts([
    ...extractMetricFactsFromText({
      text: manuscript.abstract,
      source: "abstract",
      location: "Abstract",
      context,
      sourceRefs: undefined
    }),
    ...sections.flatMap((section) =>
      section.paragraphs.flatMap((paragraph) =>
        extractMetricFactsFromText({
          text: paragraph,
          source: mapSectionHeadingToNumericFactSource(section.heading),
          location: section.heading,
          context,
          sourceRefs: section.source_refs
        })
      )
    ),
    ...(manuscript.tables || []).flatMap((table, index) =>
      extractMetricFactsFromVisual({
        source: "table",
        location: `Table ${index + 1}`,
        caption: table.caption,
        rows: table.rows,
        context,
        sourceRefs: table.source_refs
      })
    ),
    ...(manuscript.figures || []).flatMap((figure, index) =>
      extractMetricFactsFromVisual({
        source: "figure",
        location: `Figure ${index + 1}`,
        caption: figure.caption,
        rows: figure.bars,
        context,
        sourceRefs: figure.source_refs
      })
    ),
    ...appendixSections.flatMap((section) =>
      section.paragraphs.flatMap((paragraph) =>
        extractMetricFactsFromText({
          text: paragraph,
          source: "appendix_section",
          location: section.heading,
          context,
          sourceRefs: section.source_refs
        })
      )
    ),
    ...((manuscript.appendix_tables || []).flatMap((table, index) =>
      extractMetricFactsFromVisual({
        source: "appendix_table",
        location: `Appendix Table ${index + 1}`,
        caption: table.caption,
        rows: table.rows,
        context,
        sourceRefs: table.source_refs
      })
    ) || []),
    ...((manuscript.appendix_figures || []).flatMap((figure, index) =>
      extractMetricFactsFromVisual({
        source: "appendix_figure",
        location: `Appendix Figure ${index + 1}`,
        caption: figure.caption,
        rows: figure.bars,
        context,
        sourceRefs: figure.source_refs
      })
    ) || [])
  ]);
}

function buildObservedFactDriftIssues(
  facts: NormalizedNumericFact[],
  kind: "numeric_inconsistency" | "count_inconsistency"
): ConsistencyLintIssue[] {
  const issues: ConsistencyLintIssue[] = [];
  const groups = new Map<string, NormalizedNumericFact[]>();
  for (const fact of facts) {
    if (fact.fact_kind === "metric" && isObjectiveThresholdFact(fact)) {
      continue;
    }
    // CI bounds are inherently paired (lower ≠ upper); grouping them by a
    // single comparable key produces false contradictions when the same
    // interval is reported consistently across sections.
    if (fact.unit === "ci_lower" || fact.unit === "ci_upper") {
      continue;
    }
    if (!fact.metric_key && !fact.count_kind) {
      continue;
    }
    const key = buildComparableFactKey(fact);
    if (!key) {
      continue;
    }
    const bucket = groups.get(key) || [];
    bucket.push(fact);
    groups.set(key, bucket);
  }
  for (const bucket of groups.values()) {
    const mainSectionFacts = bucket.filter((fact) =>
      ["abstract", "method", "results", "conclusion", "table", "figure"].includes(fact.source)
    );
    const distinctLocations = uniqueStrings(mainSectionFacts.map((fact) => fact.location));
    const distinctValues = mainSectionFacts.reduce<number[]>((values, fact) => {
      if (!values.some((value) => areApproxEqual(value, fact.normalized_value, fact.unit))) {
        values.push(fact.normalized_value);
      }
      return values;
    }, []);
    if (mainSectionFacts.length < 2 || distinctLocations.length < 2 || distinctValues.length < 2) {
      continue;
    }
    // When distinct values span a very wide range, it's likely a scope/key
    // mismatch (e.g. aggregate vs per-condition) rather than a real contradiction.
    const minDV = Math.min(...distinctValues.map(Math.abs));
    const maxDV = Math.max(...distinctValues.map(Math.abs));
    const likelyScopeMismatch = maxDV > 0 && ((maxDV - minDV) / maxDV) > 0.5;
    issues.push({
      kind,
      severity: likelyScopeMismatch ? "warning" : "error",
      finding: likelyScopeMismatch ? "unverifiable" : "contradiction",
      message: `${joinHumanList(uniqueStrings(mainSectionFacts.map((fact) => fact.location)))} report conflicting ${humanizeComparableFactKey(bucket[0])} values.`,
      involved_sections: uniqueStrings(mainSectionFacts.map((fact) => fact.location)),
      normalized_facts: mainSectionFacts.slice(0, 4),
      reason: likelyScopeMismatch
        ? "values span a wide range, suggesting a scope/key mismatch rather than a true contradiction"
        : "comparable normalized facts disagree across main-manuscript sections",
      evidence: mainSectionFacts.slice(0, 4).map((fact) => `${fact.location}: ${fact.raw_text}`)
    });
  }
  return issues;
}

function extractCountFactsFromText(input: {
  text: string;
  source: NumericFactSource;
  location: string;
  sourceRefs?: PaperSourceRef[];
}): NormalizedNumericFact[] {
  const cleaned = cleanString(input.text);
  if (!cleaned) {
    return [];
  }
  const patternEntries: Array<{ kind: CountFactKind; pattern: RegExp }> = [
    { kind: "dataset_count", pattern: /\b(\d+)\s+datasets?\b/giu },
    { kind: "repeat_count", pattern: /\b(\d+)\s+(?:repeats?|repeated evaluations?|seeds?)\b/giu },
    { kind: "run_count", pattern: /\b(\d+)\s+runs?\b/giu },
    { kind: "outer_fold_count", pattern: /\bouter\s+(\d+)[-\s]?fold\b/giu },
    { kind: "outer_fold_count", pattern: /\b(\d+)[-\s]?fold outer\b/giu },
    { kind: "inner_fold_count", pattern: /\binner\s+(\d+)[-\s]?fold\b/giu },
    { kind: "inner_fold_count", pattern: /\b(\d+)[-\s]?fold inner\b/giu },
    { kind: "sample_count", pattern: /\b(\d+)\s+(?:samples?|instances?|rows)\b/giu },
    { kind: "sample_count", pattern: /\bn\s*=\s*(\d+)(?=[^.!?]{0,24}\b(?:samples?|instances?|rows)\b)/giu }
  ];
  return dedupeNumericFacts(
    patternEntries.flatMap(({ kind, pattern }) =>
      [...cleaned.matchAll(pattern)].map((match) =>
        buildStructuredNumericFact({
          factKind: "count",
          source: input.source,
          location: input.location,
          rawText: cleanString(match[0]),
          value: Number(match[1]),
          countKind: kind,
          aggregationLevel:
            kind === "outer_fold_count" || kind === "inner_fold_count"
              ? "fold"
              : kind === "repeat_count" || kind === "run_count"
                ? "repeat"
                : "aggregate",
          unit: "count",
          sourceRefs: input.sourceRefs
        })
      )
    )
  );
}

function extractMetricFactsFromText(input: {
  text: string;
  source: NumericFactSource;
  location: string;
  context: ExperimentArtifactContext;
  sourceRefs?: PaperSourceRef[];
}): NormalizedNumericFact[] {
  const cleaned = cleanString(input.text);
  if (!cleaned) {
    return [];
  }
  const paragraphMetricKey = inferPrimaryMetricKeyFromText(cleaned) || normalizeMetricIdentifier(cleaned);
  const paragraphDatasetScope = inferDatasetScope(cleaned, input.context.method.dataset_names, input.source);
  const fragments = cleaned
    .split(/(?<=[.!?])\s+/u)
    .map((fragment) => cleanString(fragment))
    .filter(Boolean);
  const facts: NormalizedNumericFact[] = [];
  for (const fragment of fragments) {
    if (isObjectiveThresholdFragment(fragment)) {
      continue;
    }
    const fragmentDatasetScope = inferDatasetScope(fragment, input.context.method.dataset_names, input.source);
    const datasetScope =
      paragraphDatasetScope !== "aggregate" && paragraphDatasetScope !== "unknown" && fragmentDatasetScope === "aggregate"
        ? paragraphDatasetScope
        : fragmentDatasetScope === "unknown"
          ? paragraphDatasetScope
          : fragmentDatasetScope;
    const aggregationLevel = inferAggregationLevel(fragment, datasetScope);
    const assignedFacts = extractAssignedMetricFacts({
      fragment,
      source: input.source,
      location: input.location,
      datasetScope,
      aggregationLevel,
      sourceRefs: input.sourceRefs
    });
    if (assignedFacts.length > 0) {
      facts.push(...assignedFacts);
      continue;
    }
    const numberMatches = collectNumericLiteralMatches(fragment);
    const retainedMatches = numberMatches.filter((match) => !shouldSkipMetricToken(fragment, match.raw, match.index));
    if (retainedMatches.length === 0) {
      continue;
    }
    for (let index = 0; index < retainedMatches.length; index += 1) {
      const match = retainedMatches[index];
      const rawValue = match.raw;
      const value = Number(rawValue.replace(/,/g, ""));
      if (!Number.isFinite(value)) {
        continue;
      }
      const metricKey = inferMetricKeyNearNumber(fragment, match.index, paragraphMetricKey);
      const unit = inferMetricUnit(fragment, metricKey, index, retainedMatches.length, match.index);
      if (!unit) {
        continue;
      }
      if (!rawValue.includes(".") && !["seconds", "mb"].includes(unit)) {
        continue;
      }
      const normalizedMetricKey = normalizeMetricKeyForUnit(metricKey || normalizeMetricIdentifierForUnit(unit), unit);
      if (!normalizedMetricKey) {
        continue;
      }
      if (shouldSkipAmbiguousMetricFact(fragment, normalizedMetricKey, datasetScope, input.source)) {
        continue;
      }
      facts.push(
        buildStructuredNumericFact({
          factKind: "metric",
          source: input.source,
          location: input.location,
          rawText: fragment,
          value,
          metricKey: normalizedMetricKey,
          metricLabel: humanizeToken(normalizedMetricKey),
          datasetScope,
          aggregationLevel,
          unit,
          sourceRefs: input.sourceRefs
        })
      );
    }
  }
  return dedupeNumericFacts(facts);
}

function inferVisualMetricKey(text: string): string | undefined {
  const normalized = normalizeMetricIdentifier(text);
  if (normalized) {
    return normalized;
  }
  const cleaned = normalizeMetricText(text);
  if (/\bdeltas?\b.*\blog(?:istic regression|reg)\b/iu.test(cleaned)) {
    if (/\bmacro f1\b/iu.test(cleaned)) {
      return "macro_f1_delta_vs_logreg";
    }
    return "score_delta_vs_baseline";
  }
  return undefined;
}

function inferVisualMetricDescriptor(input: {
  row: { label: string; value: number };
  caption: string;
  datasetScope: string | "aggregate" | "unknown";
  context: ExperimentArtifactContext;
}): {
  metricKey?: string;
  metricLabel?: string;
  unit?: NumericFactUnit;
  aggregationLevel?: NumericFactAggregation;
} {
  const datasetSummary =
    input.datasetScope !== "aggregate" && input.datasetScope !== "unknown"
      ? input.context.results.dataset_summaries.find((item) => cleanString(item.dataset).toLowerCase() === input.datasetScope)
      : undefined;

  if (!datasetSummary) {
    return {};
  }

  if (
    typeof datasetSummary.delta_value === "number"
    && areApproxEqual(input.row.value, datasetSummary.delta_value, "delta")
  ) {
    return {
      metricKey: inferDatasetDeltaMetricKey(datasetSummary, normalizeMetricIdentifier(datasetSummary.main_metric_label)),
      metricLabel: datasetSummary.delta_label || `${datasetSummary.main_metric_label} delta`,
      unit: "delta",
      aggregationLevel: "dataset"
    };
  }

  if (
    typeof datasetSummary.main_metric_value === "number"
    && areApproxEqual(input.row.value, datasetSummary.main_metric_value, "score")
  ) {
    return {
      metricKey: normalizeMetricIdentifier(datasetSummary.main_metric_label),
      metricLabel: datasetSummary.main_metric_label,
      unit: "score",
      aggregationLevel: "dataset"
    };
  }

  if (
    typeof datasetSummary.runtime_seconds_mean === "number"
    && areApproxEqual(input.row.value, datasetSummary.runtime_seconds_mean, "seconds")
  ) {
    return {
      metricKey: "runtime_seconds",
      metricLabel: "runtime",
      unit: "seconds",
      aggregationLevel: "dataset"
    };
  }

  if (
    typeof datasetSummary.peak_memory_mb_mean === "number"
    && areApproxEqual(input.row.value, datasetSummary.peak_memory_mb_mean, "mb")
  ) {
    return {
      metricKey: "peak_memory_mb",
      metricLabel: "peak memory",
      unit: "mb",
      aggregationLevel: "dataset"
    };
  }

  return {};
}

function extractMetricFactsFromVisual(input: {
  source: Extract<NumericFactSource, "table" | "figure" | "appendix_table" | "appendix_figure">;
  location: string;
  caption: string;
  rows: Array<{ label: string; value: number }>;
  context: ExperimentArtifactContext;
  sourceRefs?: PaperSourceRef[];
}): NormalizedNumericFact[] {
  return dedupeNumericFacts(
    input.rows.flatMap((row) => {
      const contextText = `${input.caption} ${row.label}`;
      const datasetScope = inferDatasetScope(contextText, input.context.method.dataset_names, input.source);
      const descriptor = inferVisualMetricDescriptor({
        row,
        caption: input.caption,
        datasetScope,
        context: input.context
      });
      const metricKey = descriptor.metricKey || inferVisualMetricKey(contextText);
      const aggregationLevel = descriptor.aggregationLevel || inferAggregationLevel(contextText, datasetScope);
      const unit = descriptor.unit || inferMetricUnit(contextText, metricKey, 0, 1);
      if (!metricKey || !unit || !Number.isFinite(row.value)) {
        return [];
      }
      return [
        buildStructuredNumericFact({
          factKind: "metric",
          source: input.source,
          location: input.location,
          rawText: `${row.label}: ${formatNumber(row.value)} (${cleanString(input.caption)})`,
          value: row.value,
          metricKey,
          metricLabel: descriptor.metricLabel || row.label,
          datasetScope,
          aggregationLevel,
          unit,
          sourceRefs: input.sourceRefs
        })
      ];
    })
  );
}

function buildStructuredNumericFact(input: {
  factKind: NumericFactKind;
  source: NumericFactSource;
  location: string;
  rawText: string;
  value: number;
  metricKey?: string;
  metricLabel?: string;
  countKind?: CountFactKind;
  datasetScope?: string | "aggregate" | "unknown";
  aggregationLevel?: NumericFactAggregation;
  unit?: NumericFactUnit;
  sourceRefs?: PaperSourceRef[];
}): NormalizedNumericFact {
  const normalizedValue = roundMetric(input.value);
  const metricKey = input.metricKey ? normalizeMetricIdentifier(input.metricKey) || input.metricKey : undefined;
  const semantics = inferMetricSemantics(metricKey);
  const rawText = cleanString(input.rawText);
  const location = cleanString(input.location);
  return {
    fact_id: [
      input.source,
      location || "location",
      input.factKind,
      metricKey || input.countKind || "value",
      cleanString(`${input.datasetScope || "scope"}:${input.aggregationLevel || "agg"}:${normalizedValue}`)
    ]
      .join("|")
      .toLowerCase(),
    fact_kind: input.factKind,
    source: input.source,
    location,
    raw_text: rawText,
    value: input.value,
    normalized_value: normalizedValue,
    ...(metricKey ? { metric_key: metricKey } : {}),
    ...(input.metricLabel ? { metric_label: cleanString(input.metricLabel) } : {}),
    ...(semantics.baseMetricKey ? { base_metric_key: semantics.baseMetricKey } : {}),
    ...(semantics.comparisonTarget ? { comparison_target: semantics.comparisonTarget } : {}),
    ...(input.countKind ? { count_kind: input.countKind } : {}),
    ...(input.datasetScope ? { dataset_scope: input.datasetScope } : {}),
    ...(input.aggregationLevel ? { aggregation_level: input.aggregationLevel } : {}),
    ...(input.unit ? { unit: input.unit } : {}),
    ...(input.sourceRefs?.length ? { source_refs: input.sourceRefs } : {})
  };
}

function buildComparableFactKey(fact: NormalizedNumericFact): string | undefined {
  if (fact.fact_kind === "count") {
    return fact.count_kind ? `count|${fact.count_kind}` : undefined;
  }
  const metricKey = fact.base_metric_key || fact.metric_key;
  if (!metricKey) {
    return undefined;
  }
  return [
    "metric",
    metricKey,
    fact.dataset_scope || "unknown",
    fact.aggregation_level || "unknown",
    fact.unit || "score"
  ].join("|");
}

function humanizeComparableFactKey(fact: NormalizedNumericFact | undefined): string {
  if (!fact) {
    return "numeric facts";
  }
  if (fact.fact_kind === "count") {
    return humanizeCountKind(fact.count_kind);
  }
  const scope =
    fact.dataset_scope && fact.dataset_scope !== "aggregate" && fact.dataset_scope !== "unknown"
      ? `${fact.dataset_scope} `
      : fact.dataset_scope === "aggregate"
        ? "aggregate "
        : "";
  return `${scope}${humanizeToken(fact.metric_key || "metric")}`.trim();
}

function humanizeCountKind(kind: CountFactKind | undefined): string {
  switch (kind) {
    case "dataset_count":
      return "datasets";
    case "repeat_count":
      return "repeats";
    case "outer_fold_count":
      return "outer folds";
    case "inner_fold_count":
      return "inner folds";
    case "run_count":
      return "runs";
    case "sample_count":
      return "samples";
    default:
      return "counts";
  }
}

function areComparableNumericFacts(left: NormalizedNumericFact, right: NormalizedNumericFact): boolean {
  if (left.fact_kind !== right.fact_kind) {
    return false;
  }
  if (left.fact_kind === "count") {
    return Boolean(left.count_kind && left.count_kind === right.count_kind);
  }
  const leftMetricKey = left.base_metric_key || left.metric_key;
  const rightMetricKey = right.base_metric_key || right.metric_key;
  if (!leftMetricKey || !rightMetricKey || leftMetricKey !== rightMetricKey) {
    return false;
  }
  if ((left.unit || "score") !== (right.unit || "score")) {
    return false;
  }
  if ((left.aggregation_level || "unknown") !== (right.aggregation_level || "unknown")) {
    return false;
  }
  if ((left.dataset_scope || "unknown") !== (right.dataset_scope || "unknown")) {
    return false;
  }
  if (!areComparisonTargetsCompatible(left.comparison_target, right.comparison_target, left.unit || "score")) {
    return false;
  }
  return true;
}

function areFactValuesEquivalent(left: NormalizedNumericFact, right: NormalizedNumericFact): boolean {
  return areApproxEqual(left.normalized_value, right.normalized_value, left.unit || right.unit);
}

function areApproxEqual(left: number, right: number, unit: NumericFactUnit | undefined): boolean {
  const tolerance =
    unit === "seconds"
      ? Math.max(0.05, Math.max(Math.abs(left), Math.abs(right)) * 0.01)
      : unit === "mb"
        ? Math.max(0.5, Math.max(Math.abs(left), Math.abs(right)) * 0.01)
        : unit === "count"
          ? 0
          : Math.max(0.0005, Math.max(Math.abs(left), Math.abs(right)) * 0.001);
  return Math.abs(left - right) <= tolerance;
}

function dedupeNumericFacts(facts: NormalizedNumericFact[]): NormalizedNumericFact[] {
  const seen = new Set<string>();
  const unique: NormalizedNumericFact[] = [];
  for (const fact of facts) {
    const key = `${fact.fact_id}|${fact.normalized_value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(fact);
  }
  return unique;
}

function dedupeConsistencyIssues(issues: ConsistencyLintIssue[]): ConsistencyLintIssue[] {
  const seen = new Set<string>();
  const unique: ConsistencyLintIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.kind}|${issue.severity}|${issue.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(issue);
  }
  return unique;
}

function inferDatasetScope(
  text: string,
  datasetNames: string[],
  source: NumericFactSource
): string | "aggregate" | "unknown" {
  const cleaned = cleanString(text).toLowerCase();
  const matchedDataset = datasetNames.find((dataset) => cleaned.includes(cleanString(dataset).toLowerCase()));
  if (matchedDataset) {
    return matchedDataset;
  }
  if (
    source === "table"
    || source === "figure"
    || source === "appendix_table"
    || source === "appendix_figure"
    || /\bacross datasets\b|\baverage across datasets\b|\bmean across datasets\b|\boverall\b|\baggregate\b|\bstrongest workflow\b/iu.test(cleaned)
  ) {
    return "aggregate";
  }
  return ["abstract", "results", "conclusion", "appendix_section"].includes(source) ? "aggregate" : "unknown";
}

function inferAggregationLevel(text: string, datasetScope: string | "aggregate" | "unknown"): NumericFactAggregation {
  const cleaned = cleanString(text).toLowerCase();
  if (datasetScope !== "aggregate" && datasetScope !== "unknown") {
    return "dataset";
  }
  if (/\brepeat|run\b/iu.test(cleaned)) {
    return "repeat";
  }
  if (/\bfold\b/iu.test(cleaned)) {
    return "fold";
  }
  return datasetScope === "aggregate" ? "aggregate" : "unknown";
}

function inferMetricUnit(
  text: string,
  metricKey: string | undefined,
  index: number,
  totalMatches: number,
  rawIndex?: number
): NumericFactUnit | undefined {
  const cleaned = cleanString(text).toLowerCase();
  const normalized = normalizeMetricText(text);
  const searchText = normalizeMetricSearchText(text);
  const memoryDistance = typeof rawIndex === "number" ? nearestKeywordDistance(searchText, rawIndex, ["memory", "mb", "ram", "gib"]) : undefined;
  const runtimeDistance =
    typeof rawIndex === "number" ? nearestKeywordDistance(searchText, rawIndex, ["runtime", "latency", "second", "seconds", "sec"]) : undefined;
  if (typeof memoryDistance === "number" && (typeof runtimeDistance !== "number" || memoryDistance < runtimeDistance)) {
    return "mb";
  }
  if (typeof runtimeDistance === "number" || metricKey === "runtime_seconds") {
    return "seconds";
  }
  if (metricKey === "peak_memory_mb" || /\bmemory\b|\bram\b|\bmb\b|\bgib\b/iu.test(normalized)) {
    return "mb";
  }
  if (/\bci\b|\bconfidence interval\b|\binterval\b.*\bspan/iu.test(normalized) || cleaned.includes("95%")) {
    if (totalMatches >= 2) {
      return index === 0 ? "ci_lower" : "ci_upper";
    }
    return "score";
  }
  if (metricKey?.includes("delta") || /\bdeltas?\b|\bimprov(?:e|ed|es|ement)\b|\bgain\b|\bvs\b|\bby\b/iu.test(normalized)) {
    return "delta";
  }
  return metricKey ? "score" : undefined;
}

function inferMetricKeyNearNumber(
  fragment: string,
  rawIndex: number,
  paragraphMetricKey: string | undefined
): string | undefined {
  const nearestMetricKey = inferMetricKeyByDistance(fragment, rawIndex);
  if (nearestMetricKey) {
    return nearestMetricKey;
  }
  if (/\bmain score\b|\bmain metric\b|\bdeltas?\b|\binterval spans\b|\bconfidence interval\b/iu.test(fragment)) {
    return paragraphMetricKey;
  }
  return undefined;
}

function nearestKeywordDistance(text: string, rawIndex: number, keywords: string[]): number | undefined {
  let best: number | undefined;
  for (const keyword of keywords) {
    const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
    for (const match of text.matchAll(pattern)) {
      const distance = Math.abs((match.index || 0) - rawIndex);
      if (best === undefined || distance < best) {
        best = distance;
      }
    }
  }
  return best;
}

function inferMetricKeyByDistance(text: string, rawIndex: number): string | undefined {
  const cleaned = normalizeMetricSearchText(text);
  const candidates: Array<{ key: string; distance: number }> = [];
  const patternSpecs: Array<{ key: string; patterns: string[] }> = [
    {
      key: "macro_f1_delta_vs_logreg",
      patterns: [
        "macro f1 delta vs logistic regression",
        "macro f1 delta versus logistic regression",
        "macro f1 delta vs logreg"
      ]
    },
    { key: "macro_f1_delta", patterns: ["macro f1 delta", "macro f1 deltas"] },
    { key: "macro_f1", patterns: ["macro f1"] },
    { key: "pairwise_ranking_agreement", patterns: ["pairwise ranking agreement", "ranking agreement"] },
    { key: "winner_consistency", patterns: ["winner consistency"] },
    { key: "runtime_seconds", patterns: ["runtime", "latency", "second", "seconds", "sec"] },
    { key: "peak_memory_mb", patterns: ["peak memory", "memory", "ram", "mb"] },
    { key: "top1_accuracy", patterns: ["top 1 accuracy", "top-1 accuracy"] },
    { key: "accuracy", patterns: ["accuracy"] }
  ];
  for (const spec of patternSpecs) {
    const distance = nearestKeywordDistance(cleaned, rawIndex, spec.patterns);
    if (typeof distance === "number") {
      candidates.push({ key: spec.key, distance });
    }
  }
  return candidates.sort((left, right) => left.distance - right.distance || right.key.length - left.key.length)[0]?.key;
}

function normalizeMetricIdentifier(value: string): string | undefined {
  const cleaned = normalizeMetricText(value);
  if (!cleaned) {
    return undefined;
  }
  if (/\bmacro f1\b.*\bdeltas?\b.*\blogistic regression\b|\bmacro f1 delta vs logreg\b|\bmacro_f1_delta_vs_logreg\b/iu.test(cleaned)) {
    return "macro_f1_delta_vs_logreg";
  }
  if (/\bmacro f1\b.*\bdeltas?\b/iu.test(cleaned)) {
    return "macro_f1_delta";
  }
  if (/\bpairwise ranking agreement\b/iu.test(cleaned)) {
    return "pairwise_ranking_agreement";
  }
  if (/\bwinner consistency\b/iu.test(cleaned)) {
    return "winner_consistency";
  }
  if (/\bruntime\b|\blatency\b/.test(cleaned)) {
    return "runtime_seconds";
  }
  if (/\bpeak memory\b|\bmemory\b|\bram\b/.test(cleaned)) {
    return "peak_memory_mb";
  }
  if (/\btop[- ]?1 accuracy\b/iu.test(cleaned)) {
    return "top1_accuracy";
  }
  if (/\breproducibility(?: score)?\b/iu.test(cleaned)) {
    return "reproducibility";
  }
  if (/\baccuracy\b/iu.test(cleaned)) {
    return "accuracy";
  }
  if (/\bmacro f1\b/iu.test(cleaned)) {
    return "macro_f1";
  }
  if (/\bf1\b/iu.test(cleaned)) {
    return "f1";
  }
  return undefined;
}

function inferPrimaryMetricKeyFromText(value: string): string | undefined {
  const cleaned = normalizeMetricText(value);
  const normalized = normalizeMetricIdentifier(cleaned);
  if (normalized && normalized !== "macro_f1" && normalized !== "accuracy" && normalized !== "f1") {
    return normalized;
  }
  const candidates: Array<{ key: string; index: number }> = [
    { key: "macro_f1_delta_vs_logreg", index: cleaned.search(/\bmacro f1\b.*\bdeltas?\b.*\blog(?:istic regression|reg)\b/u) },
    { key: "macro_f1_delta", index: cleaned.search(/\bmacro f1\b.*\bdeltas?\b/u) },
    { key: "macro_f1", index: cleaned.search(/\bmacro f1\b/u) },
    { key: "top1_accuracy", index: cleaned.search(/\btop[- ]?1 accuracy\b/u) },
    { key: "accuracy", index: cleaned.search(/\baccuracy\b/u) },
    { key: "pairwise_ranking_agreement", index: cleaned.search(/\bpairwise ranking agreement\b/u) },
    { key: "winner_consistency", index: cleaned.search(/\bwinner consistency\b/u) },
    { key: "runtime_seconds", index: cleaned.search(/\bruntime\b|\blatency\b/u) },
    { key: "peak_memory_mb", index: cleaned.search(/\bmemory\b|\bram\b/u) }
  ].filter((candidate) => candidate.index >= 0);
  return candidates.sort((left, right) => left.index - right.index)[0]?.key;
}

function normalizeMetricText(value: string): string {
  return cleanString(value)
    .toLowerCase()
    .replace(/[_./-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeMetricSearchText(value: string): string {
  return cleanString(value)
    .toLowerCase()
    .replace(/[_./-]/gu, " ");
}

function inferMetricSemantics(metricKey: string | undefined): {
  baseMetricKey?: string;
  comparisonTarget?: string;
} {
  if (!metricKey) {
    return {};
  }
  if (metricKey === "macro_f1_delta_vs_logreg") {
    return {
      baseMetricKey: "macro_f1",
      comparisonTarget: "logreg"
    };
  }
  if (metricKey === "macro_f1_delta") {
    return {
      baseMetricKey: "macro_f1"
    };
  }
  if (metricKey === "f1_delta") {
    return {
      baseMetricKey: "f1"
    };
  }
  const baseMetricKey = metricKey.replace(/_delta(?:_vs_[a-z0-9_]+)?$/u, "");
  const comparisonTarget = metricKey.match(/_vs_([a-z0-9_]+)$/u)?.[1];
  return {
    ...(baseMetricKey ? { baseMetricKey } : {}),
    ...(comparisonTarget ? { comparisonTarget } : {})
  };
}

function areComparisonTargetsCompatible(
  left: string | undefined,
  right: string | undefined,
  unit: NumericFactUnit
): boolean {
  if (!["delta", "ci_lower", "ci_upper"].includes(unit)) {
    return true;
  }
  return !left || !right || left === right;
}

function normalizeMetricIdentifierForUnit(unit: NumericFactUnit): string | undefined {
  switch (unit) {
    case "seconds":
      return "runtime_seconds";
    case "mb":
      return "peak_memory_mb";
    default:
      return undefined;
  }
}

function normalizeMetricKeyForUnit(metricKey: string | undefined, unit: NumericFactUnit): string | undefined {
  if (!metricKey || unit !== "delta") {
    return metricKey;
  }
  if (metricKey === "macro_f1") {
    return "macro_f1_delta";
  }
  if (metricKey === "f1") {
    return "f1_delta";
  }
  if (metricKey === "reproducibility" || metricKey === "reproducibility_score") {
    return "reproducibility_delta";
  }
  if (metricKey === "accuracy") {
    return "accuracy_delta";
  }
  if (metricKey === "top1_accuracy") {
    return "top1_accuracy_delta";
  }
  return metricKey;
}

function extractAssignedMetricFacts(input: {
  fragment: string;
  source: NumericFactSource;
  location: string;
  datasetScope: string | "aggregate" | "unknown";
  aggregationLevel: NumericFactAggregation;
  sourceRefs?: PaperSourceRef[];
}): NormalizedNumericFact[] {
  const facts: NormalizedNumericFact[] = [];
  for (const segment of input.fragment.split(/[;,]/u)) {
    const [rawMetricToken, rawAssignedValue] = segment.split("=");
    if (!rawMetricToken || !rawAssignedValue) {
      continue;
    }
    const metricToken = cleanString(rawMetricToken.split(":").at(-1));
    const rawValue = cleanString(rawAssignedValue);
    const value = Number(rawValue);
    if (!metricToken || !Number.isFinite(value)) {
      continue;
    }
    const metricKey = normalizeMetricIdentifier(metricToken);
    const unit = inferMetricUnit(metricToken, metricKey, 0, 1);
    const normalizedMetricKey = normalizeMetricKeyForUnit(
      metricKey || normalizeMetricIdentifierForUnit(unit || "score"),
      unit || "score"
    );
    if (!normalizedMetricKey || !unit) {
      continue;
    }
    facts.push(
      buildStructuredNumericFact({
        factKind: "metric",
        source: input.source,
        location: input.location,
        rawText: `${metricToken}=${rawValue}`,
        value,
        metricKey: normalizedMetricKey,
        metricLabel: metricToken,
        datasetScope: input.datasetScope,
        aggregationLevel: input.aggregationLevel,
        unit,
        sourceRefs: input.sourceRefs
      })
    );
  }
  return dedupeNumericFacts(facts);
}

function shouldSkipMetricToken(fragment: string, rawToken: string, index: number): boolean {
  const nextChar = fragment[index + rawToken.length];
  if (nextChar === "%") {
    return true;
  }
  const window = fragment.slice(Math.max(0, index - 8), Math.min(fragment.length, index + rawToken.length + 12));
  if (/\btop[- ]?1 accuracy\b/iu.test(window) && rawToken === "1") {
    return true;
  }
  const widerWindow = fragment.slice(Math.max(0, index - 20), Math.min(fragment.length, index + rawToken.length + 20));
  if (/(?:>=|<=|>|<)\s*$/.test(fragment.slice(Math.max(0, index - 4), index))) {
    return true;
  }
  if (/\b(?:target|threshold|objective|goal|constraint|minimum|at least|at most)\b/iu.test(widerWindow)) {
    return true;
  }
  return false;
}

function isObjectiveThresholdFragment(fragment: string): boolean {
  const normalized = normalizeMetricText(fragment);
  return (
    /(?:>=|<=|>|<)/u.test(fragment)
    && /\bobjective\b|\bconstraint\b|\btarget\b|\bthreshold\b|\baround\b|\bposition(?:s|ed|ing)?\b|\bscope(?:d)?\b/iu.test(normalized)
  );
}

function isObjectiveThresholdFact(fact: NormalizedNumericFact): boolean {
  return fact.fact_kind === "metric" && isObjectiveThresholdFragment(fact.raw_text);
}

function shouldSkipAmbiguousMetricFact(
  fragment: string,
  metricKey: string,
  datasetScope: string | "aggregate" | "unknown",
  source: NumericFactSource
): boolean {
  if (
    datasetScope === "aggregate"
    && ["discussion", "appendix_section"].includes(source)
    && ["pairwise_ranking_agreement", "winner_consistency"].includes(metricKey)
    && !/\bacross datasets\b|\baggregate\b|\boverall\b|\bmean\b/iu.test(fragment)
  ) {
    return true;
  }
  return false;
}

function shouldWarnOnUnverifiableFact(source: NumericFactSource): boolean {
  return source !== "artifact";
}

function allowsAppendixOnlyWarning(source: NumericFactSource): boolean {
  return source === "abstract" || source === "conclusion";
}

function isAppendixFactSource(source: NumericFactSource): boolean {
  return source === "appendix_section" || source === "appendix_table" || source === "appendix_figure";
}

function extractNumericNoteCount(notes: string[]): number | undefined {
  for (const note of notes) {
    const first = collectNumbersFromMatches(
      note,
      /\b(\d+)(?:[-\s]?fold|\s+repeated|\s+repeats?|\s+seeds?|\s+samples?|\s+instances?|\s+rows?)\b/giu
    )[0];
    if (typeof first === "number") {
      return first;
    }
  }
  return undefined;
}

function extractFirstMetricValue(notes: string[], pattern: RegExp): number | undefined {
  for (const note of notes) {
    const match = cleanString(note).match(pattern);
    if (!match) {
      continue;
    }
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function extractExpectedCountFromNotes(notes: string[], kind: CountFactKind): number | undefined {
  const patterns: Record<CountFactKind, RegExp[]> = {
    dataset_count: [/\b(\d+)\s+datasets?\b/giu],
    repeat_count: [/\b(\d+)\s+(?:repeats?|repeated evaluations?|seeds?)\b/giu],
    run_count: [/\b(\d+)\s+runs?\b/giu],
    outer_fold_count: [/\bouter\s+(\d+)[-\s]?fold\b/giu, /\b(\d+)[-\s]?fold outer\b/giu],
    inner_fold_count: [/\binner\s+(\d+)[-\s]?fold\b/giu, /\b(\d+)[-\s]?fold inner\b/giu],
    sample_count: [/\b(\d+)\s+(?:samples?|instances?|rows)\b/giu]
  };
  for (const note of notes) {
    for (const pattern of patterns[kind]) {
      const first = collectNumbersFromMatches(note, pattern)[0];
      if (typeof first === "number") {
        return first;
      }
    }
  }
  return undefined;
}

function collectNumericLiteralMatches(text: string): Array<{ raw: string; index: number }> {
  const cleaned = cleanString(text);
  const matches: Array<{ raw: string; index: number }> = [];
  // Match comma-separated thousands groups (e.g. "20,789") as well as plain numbers.
  const pattern = /-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gu;
  let match = pattern.exec(cleaned);
  while (match) {
    const raw = match[0] || "";
    const index = match.index || 0;
    const before = cleaned[index - 1] || "";
    if (!/[A-Za-z0-9]/u.test(before) && !/[A-Za-z]/u.test(before)) {
      matches.push({ raw, index });
    }
    match = pattern.exec(cleaned);
  }
  return matches;
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
  const pageBudgetBeforeExpansion = pageBudgetManager({
    draft: upgradedDraft,
    profile
  });
  let pageBudget = pageBudgetBeforeExpansion;
  let expansionRecheck: ScientificAutoRepairRecheck = {
    attempted: false,
    page_budget_before: pageBudgetBeforeExpansion.status,
    page_budget_after: pageBudgetBeforeExpansion.status,
    resolved_headings: [],
    unresolved_headings: pageBudgetBeforeExpansion.auto_expand_headings
  };
  if (pageBudget.auto_expand_headings.length > 0) {
    expandedSections = [...pageBudget.auto_expand_headings];
    upgradedDraft = expandDraftAgainstBudget(upgradedDraft, input.bundle, context, pageBudget.auto_expand_headings);
    pageBudget = pageBudgetManager({
      draft: upgradedDraft,
      profile
    });
    expansionRecheck = {
      attempted: true,
      page_budget_before: pageBudgetBeforeExpansion.status,
      page_budget_after: pageBudget.status,
      resolved_headings: expandedSections.filter(
        (heading) => !pageBudget.auto_expand_headings.some((candidate) => normalizeHeading(candidate) === normalizeHeading(heading))
      ),
      unresolved_headings: pageBudget.auto_expand_headings
    };
  }
  const evidenceDiagnostics = buildEvidenceInsufficiencyReport({
    pageBudget,
    methodReport,
    resultsReport,
    relatedWorkReport,
    discussionReport
  });
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
    evidence_diagnostics: evidenceDiagnostics,
    claim_rewrite_report: rewritten.report,
    appendix_plan: appendixPlan,
    auto_repairs: {
      expanded_sections: expandedSections,
      expansion_recheck: expansionRecheck
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
      finding: input.evidence_diagnostics.blocked_by_evidence_insufficiency ? "unverifiable" : "repairable",
      message:
        input.page_budget.warnings[0]
        || `Main-body length remains below the venue-aware ${input.page_budget.target_main_pages}-page target.`,
      details: input.page_budget.warnings.slice(1),
      thin_sections: input.evidence_diagnostics.thin_sections,
      missing_evidence_categories: input.evidence_diagnostics.missing_evidence_categories,
      expandable_from_existing_evidence: input.evidence_diagnostics.expandable_from_existing_evidence,
      blocked_by_evidence_insufficiency: input.evidence_diagnostics.blocked_by_evidence_insufficiency
    });
  }
  const sectionDiagnostics = new Map(
    input.evidence_diagnostics.section_diagnostics.map((diagnostic) => [normalizeHeading(diagnostic.section), diagnostic] as const)
  );
  pushCompletenessIssue(
    issues,
    "method_completeness",
    "method_completeness_incomplete",
    input.method_completeness,
    "Method remains incomplete for scientific reporting.",
    sectionDiagnostics.get("method")
  );
  pushCompletenessIssue(
    issues,
    "results_richness",
    "results_richness_incomplete",
    input.results_richness,
    "Results remain too thin for a full paper.",
    sectionDiagnostics.get("results")
  );
  pushCompletenessIssue(
    issues,
    "related_work_richness",
    "related_work_richness_incomplete",
    input.related_work_richness,
    "Related Work lacks enough clustering or positioning detail.",
    sectionDiagnostics.get("related work")
  );
  pushCompletenessIssue(
    issues,
    "discussion_richness",
    "discussion_richness_incomplete",
    input.discussion_richness,
    "Discussion or Limitations remain too thin.",
    sectionDiagnostics.get("discussion")
  );

  return {
    page_budget: input.page_budget,
    method_completeness: input.method_completeness,
    results_richness: input.results_richness,
    related_work_richness: input.related_work_richness,
    discussion_richness: input.discussion_richness,
    evidence_diagnostics: input.evidence_diagnostics,
    claim_rewrite_report: input.claim_rewrite_report,
    appendix_plan: input.appendix_plan,
    auto_repairs: {
      claim_rewrite_count: input.claim_rewrite_report.rewrites.length,
      expanded_sections: input.auto_repairs.expanded_sections,
      appendix_route_count: input.appendix_plan.cross_references.length,
      expansion_recheck: input.auto_repairs.expansion_recheck
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
    ...input.scientificValidation.issues.map((issue) => {
      const blocking = issue.policy === "always_fail" || (issue.policy === "strict_fail" && input.mode === "strict_paper");
      const outcome: GateIssueOutcome = blocking ? "fail" : issue.finding === "unverifiable" ? "unverifiable" : "warn";
      return {
        ...issue,
        blocking,
        outcome
      };
    }),
    ...input.consistencyLint.issues.map((issue) => convertLintIssueToGateIssue(issue, "consistency_lint", input.mode)),
    ...input.appendixLint.issues.map((issue) => convertLintIssueToGateIssue(issue, "appendix_lint", input.mode))
  ];
  const blockingIssues = issues.filter((issue) => issue.blocking);
  const warningCount = issues.filter((issue) => !issue.blocking).length;
  const failureReasons = blockingIssues.map((issue) => issue.message);
  const classificationSummary = {
    contradiction_count: issues.filter((issue) => issue.finding === "contradiction").length,
    unverifiable_count: issues.filter((issue) => issue.finding === "unverifiable").length,
    repairable_count: issues.filter((issue) => issue.finding === "repairable").length,
    informational_count: issues.filter((issue) => issue.finding === "informational").length,
    auto_repair_count:
      input.scientificValidation.auto_repairs.claim_rewrite_count
      + input.scientificValidation.auto_repairs.expanded_sections.length
  };
  const evidenceSummary = {
    thin_sections: input.scientificValidation.evidence_diagnostics.thin_sections,
    missing_evidence_categories: input.scientificValidation.evidence_diagnostics.missing_evidence_categories,
    blocked_by_evidence_insufficiency: input.scientificValidation.evidence_diagnostics.blocked_by_evidence_insufficiency,
    expandable_from_existing_evidence: input.scientificValidation.evidence_diagnostics.expandable_from_existing_evidence
  };
  const summary = blockingIssues.length > 0
    ? [
        `write_paper quality gate failed in ${input.mode} mode.`,
        ...failureReasons,
        ...(evidenceSummary.blocked_by_evidence_insufficiency
          ? [
              `Evidence insufficiency blocks recovery for ${joinHumanList(evidenceSummary.thin_sections)} because ${joinHumanList(evidenceSummary.missing_evidence_categories)} remain missing.`
            ]
          : [])
      ]
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
    classification_summary: classificationSummary,
    evidence_summary: evidenceSummary,
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

  const mainTables = datasetResultTableBuilder(context);
  const tables = mainTables.length > 0
    ? mainTables.map((table) => ({
        ...table,
        source_refs: buildArtifactSourceRefs(["result_analysis.metric_table", "latest_results.dataset_summaries"])
      }))
    : sanitizeCandidateTables(input.candidate.tables);
  const mainFigures = figureSelectorAndCaptionWriter(context);
  const figures = mainFigures.length > 0
    ? mainFigures.map((figure) => ({
        ...figure,
        source_refs: buildArtifactSourceRefs(["result_analysis.figure_specs", "latest_results.dataset_summaries"])
      }))
    : sanitizeCandidateFigures(input.candidate.figures);
  const appendixSections = input.appendixPlan.sections.map((section) => ({
    ...section,
    source_refs: buildArtifactSourceRefs([`appendix:${section.heading}`, "latest_results", "result_analysis"])
  }));
  const appendixTables = input.appendixPlan.tables.map((table) => ({
    ...table,
    caption: sanitizeVisualCaption(table.caption, "Extended dataset-level outcomes retained outside the main paper."),
    source_refs: buildArtifactSourceRefs(["appendix:dataset_tables", "latest_results.dataset_summaries"])
  }));
  const appendixFigures = input.appendixPlan.figures.map((figure) => ({
    ...figure,
    caption: sanitizeVisualCaption(
      figure.caption,
      "Extended dataset-level outcomes retained outside the main paper."
    ),
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
  const provenanceMap = buildManuscriptProvenanceMap({
    manuscript,
    draft: input.draft,
    context,
    expectedMetricFacts: collectExpectedMetricFacts(context)
  });

  return {
    manuscript,
    consistency_lint: consistency,
    appendix_lint: appendixLint,
    provenance_map: provenanceMap
  };
}

function buildManuscriptProvenanceMap(input: {
  manuscript: PaperManuscript;
  draft: PaperDraft;
  context: ExperimentArtifactContext;
  expectedMetricFacts: NormalizedNumericFact[];
}): ManuscriptProvenanceMap {
  const sectionClaimIds = new Map<string, string[]>();
  for (const claim of input.draft.claims) {
    const key = normalizeHeading(claim.section_heading || "");
    if (!key) {
      continue;
    }
    sectionClaimIds.set(key, uniqueStrings([...(sectionClaimIds.get(key) || []), claim.claim_id]));
  }

  const allObservedMetricFacts = collectObservedMetricFacts(input.manuscript, input.context);
  const appendixFacts = allObservedMetricFacts.filter((fact) => isAppendixFactSource(fact.source));
  const paragraphAnchors: ManuscriptProvenanceParagraphAnchor[] = [];
  const numericAnchors: ManuscriptProvenanceNumericAnchor[] = [];
  const sections: ManuscriptProvenanceSectionEntry[] = [];

  const abstractAnchorId = buildManuscriptParagraphAnchorId("Abstract", 0);
  const abstractFacts = extractMetricFactsFromText({
    text: input.manuscript.abstract,
    source: "abstract",
    location: "Abstract",
    context: input.context,
    sourceRefs: undefined
  });
  paragraphAnchors.push({
    anchor_id: abstractAnchorId,
    section: "Abstract",
    paragraph_index: 0,
    text_preview: truncatePreview(input.manuscript.abstract),
    numeric_fact_ids: abstractFacts.map((fact) => fact.fact_id)
  });
  numericAnchors.push(
    ...abstractFacts.map((fact) =>
      buildProvenanceNumericAnchor(fact, abstractAnchorId, input.expectedMetricFacts, appendixFacts)
    )
  );
  sections.push({
    section: "Abstract",
    paragraph_anchor_ids: [abstractAnchorId],
    claim_anchor_ids: [],
    numeric_fact_ids: abstractFacts.map((fact) => fact.fact_id)
  });

  for (const section of input.manuscript.sections) {
    const normalizedHeading = normalizeHeading(section.heading);
    const claimIds = sectionClaimIds.get(normalizedHeading) || [];
    const sectionParagraphAnchors: string[] = [];
    const sectionNumericFactIds: string[] = [];

    for (let index = 0; index < section.paragraphs.length; index += 1) {
      const paragraph = section.paragraphs[index] || "";
      const anchorId = buildManuscriptParagraphAnchorId(section.heading, index);
      const facts = extractMetricFactsFromText({
        text: paragraph,
        source: mapSectionHeadingToNumericFactSource(section.heading),
        location: section.heading,
        context: input.context,
        sourceRefs: section.source_refs
      });
      sectionParagraphAnchors.push(anchorId);
      sectionNumericFactIds.push(...facts.map((fact) => fact.fact_id));
      paragraphAnchors.push({
        anchor_id: anchorId,
        section: section.heading,
        paragraph_index: index,
        text_preview: truncatePreview(paragraph),
        ...(section.source_refs?.length ? { source_refs: section.source_refs } : {}),
        ...(claimIds.length ? { claim_ids: claimIds } : {}),
        numeric_fact_ids: facts.map((fact) => fact.fact_id)
      });
      numericAnchors.push(
        ...facts.map((fact) =>
          buildProvenanceNumericAnchor(fact, anchorId, input.expectedMetricFacts, appendixFacts)
        )
      );
    }

    sections.push({
      section: section.heading,
      paragraph_anchor_ids: sectionParagraphAnchors,
      claim_anchor_ids: claimIds.map((claimId) => `claim:${claimId}`),
      numeric_fact_ids: uniqueStrings(sectionNumericFactIds),
      ...(section.source_refs?.length ? { source_refs: section.source_refs } : {})
    });
  }

  const visualAnchors = buildProvenanceVisualEntries(input, numericAnchors);

  return {
    sections,
    paragraph_anchors: paragraphAnchors,
    numeric_anchors: dedupeProvenanceNumericAnchors(numericAnchors),
    visual_anchors: visualAnchors
  };
}

function buildProvenanceVisualEntries(
  input: {
    manuscript: PaperManuscript;
    context: ExperimentArtifactContext;
    expectedMetricFacts: NormalizedNumericFact[];
  },
  numericAnchors: ManuscriptProvenanceNumericAnchor[]
): ManuscriptProvenanceVisualEntry[] {
  const appendixFacts = numericAnchors
    .filter((anchor) => anchor.fact.source === "appendix_section" || anchor.fact.source === "appendix_table" || anchor.fact.source === "appendix_figure")
    .map((anchor) => anchor.fact);
  const entries: ManuscriptProvenanceVisualEntry[] = [];
  const pushEntry = (
    kind: ManuscriptProvenanceVisualEntry["kind"],
    caption: string,
    rows: Array<{ label: string; value: number }>,
    index: number,
    source: Extract<NumericFactSource, "table" | "figure" | "appendix_table" | "appendix_figure">,
    sourceRefs?: PaperSourceRef[]
  ) => {
    const anchorId = `${kind}:${index}`;
    const facts = extractMetricFactsFromVisual({
      source,
      location: anchorId,
      caption,
      rows,
      context: input.context,
      sourceRefs
    });
    numericAnchors.push(
      ...facts.map((fact) =>
        buildProvenanceNumericAnchor(fact, anchorId, input.expectedMetricFacts, appendixFacts)
      )
    );
    entries.push({
      anchor_id: anchorId,
      kind,
      caption,
      ...(sourceRefs?.length ? { source_refs: sourceRefs } : {}),
      numeric_fact_ids: facts.map((fact) => fact.fact_id)
    });
  };

  (input.manuscript.tables || []).forEach((table, index) => {
    pushEntry("table", table.caption, table.rows, index + 1, "table", table.source_refs);
  });
  (input.manuscript.figures || []).forEach((figure, index) => {
    pushEntry("figure", figure.caption, figure.bars, index + 1, "figure", figure.source_refs);
  });
  (input.manuscript.appendix_tables || []).forEach((table, index) => {
    pushEntry("appendix_table", table.caption, table.rows, index + 1, "appendix_table", table.source_refs);
  });
  (input.manuscript.appendix_figures || []).forEach((figure, index) => {
    pushEntry("appendix_figure", figure.caption, figure.bars, index + 1, "appendix_figure", figure.source_refs);
  });

  return entries;
}

function buildProvenanceNumericAnchor(
  fact: NormalizedNumericFact,
  sourceAnchorId: string,
  expectedMetricFacts: NormalizedNumericFact[],
  appendixFacts: NormalizedNumericFact[]
): ManuscriptProvenanceNumericAnchor {
  const comparableExpected = expectedMetricFacts.filter((candidate) => areComparableNumericFacts(fact, candidate));
  const supportedFacts = comparableExpected.filter((candidate) => areFactValuesEquivalent(fact, candidate));
  const appendixOnlyFacts = appendixFacts.filter(
    (candidate) =>
      candidate.fact_id !== fact.fact_id
      && areComparableNumericFacts(fact, candidate)
      && areFactValuesEquivalent(fact, candidate)
  );
  const supportStatus: ManuscriptProvenanceNumericAnchor["support_status"] =
    supportedFacts.length > 0
      ? "supported"
      : appendixOnlyFacts.length > 0 && allowsAppendixOnlyWarning(fact.source)
        ? "appendix_only"
        : comparableExpected.length > 0
          ? "contradiction"
          : "unverifiable";

  return {
    anchor_id: `numeric:${fact.fact_id}`,
    source_anchor_id: sourceAnchorId,
    source: fact.source,
    location: fact.location,
    support_status: supportStatus,
    fact,
    supporting_fact_ids: [...supportedFacts, ...appendixOnlyFacts].map((candidate) => candidate.fact_id),
    ...(fact.source_refs?.length ? { source_refs: fact.source_refs } : {})
  };
}

function dedupeProvenanceNumericAnchors(
  anchors: ManuscriptProvenanceNumericAnchor[]
): ManuscriptProvenanceNumericAnchor[] {
  const seen = new Set<string>();
  const unique: ManuscriptProvenanceNumericAnchor[] = [];
  for (const anchor of anchors) {
    if (seen.has(anchor.anchor_id)) {
      continue;
    }
    seen.add(anchor.anchor_id);
    unique.push(anchor);
  }
  return unique;
}

function buildManuscriptParagraphAnchorId(sectionHeading: string, paragraphIndex: number): string {
  const heading = normalizeHeading(sectionHeading).replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  return `paragraph:${heading || "section"}:${paragraphIndex}`;
}

function mapSectionHeadingToNumericFactSource(heading: string): NumericFactSource {
  switch (normalizeHeading(heading)) {
    case "method":
      return "method";
    case "results":
      return "results";
    case "discussion":
      return "discussion";
    case "conclusion":
      return "conclusion";
    default:
      return "results";
  }
}

function truncatePreview(text: string): string {
  const cleaned = cleanString(text);
  return cleaned.length <= 160 ? cleaned : `${cleaned.slice(0, 157)}...`;
}

function attachAppendixCrossReferences(
  manuscript: PaperManuscript,
  appendixPlan: AppendixPlan
): void {
  if (appendixPlan.cross_references.length === 0) {
    return;
  }
  const preferredTargets: Array<{ heading: string; reference: AppendixReference["label"]; sentence: string }> =
    appendixPlan.cross_references.map((reference) => {
      if (/hyperparameter|protocol|environment|reproducibility/iu.test(reference.reason)) {
        return {
          heading: "Method",
          reference: reference.label || "Appendix",
          sentence: `${cleanString(reference.reason).charAt(0).toUpperCase()}${cleanString(reference.reason).slice(1)} are summarized in ${reference.label || "the appendix"}.`
        };
      }
      if (/repeat-level|per-dataset/iu.test(reference.reason)) {
        return {
          heading: "Results",
          reference: reference.label || "Appendix",
          sentence: `Extended repeat-level and dataset-level slices are reported in ${reference.label || "the appendix"}.`
        };
      }
      return {
        heading: "Limitations",
        reference: reference.label || "Appendix",
        sentence: `Supporting caveats and extended failure analysis appear in ${reference.label || "the appendix"}.`
      };
    });

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

  for (const reference of appendixPlan.cross_references) {
    const heading = inferAppendixReferenceSection(reference.reason, manuscript.sections);
    const section = findSection(manuscript.sections, heading);
    if (!section || section.paragraphs.length === 0) {
      continue;
    }
    const lastIndex = section.paragraphs.length - 1;
    if (
      section.paragraphs[lastIndex]?.includes(reference.label)
      || section.paragraphs[lastIndex]?.includes(reference.target_heading)
    ) {
      continue;
    }
    section.paragraphs[lastIndex] = `${section.paragraphs[lastIndex]} ${buildAppendixReferenceSentence(reference)}`.trim();
  }
}

function inferAppendixReferenceSection(
  reason: string,
  sections: PaperManuscriptSection[]
): string {
  if (/repeat-level|per-dataset/iu.test(reason)) {
    return "Results";
  }
  if (/hyperparameter|reproducibility-oriented environment/iu.test(reason)) {
    return "Method";
  }
  if (/failure analysis|limitation/iu.test(reason)) {
    return findSection(sections, "Limitations") ? "Limitations" : "Discussion";
  }
  return "Results";
}

function buildAppendixReferenceSentence(reference: AppendixReference): string {
  if (/repeat-level|per-dataset/iu.test(reference.reason)) {
    return `Extended dataset slices are cross-referenced in ${reference.label}.`;
  }
  if (/hyperparameter/iu.test(reference.reason)) {
    return `Search-space detail is summarized in ${reference.label}.`;
  }
  if (/reproducibility-oriented environment/iu.test(reference.reason)) {
    return `Environment and reproducibility notes are summarized in ${reference.label}.`;
  }
  if (/failure analysis|limitation/iu.test(reference.reason)) {
    return `Extended caveats and failure cases are summarized in ${reference.label}.`;
  }
  return `Supporting detail is summarized in ${reference.label}.`;
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
            bundle.objectiveMetric ? `The paper is scoped around ${bundle.objectiveMetric}.` : ""
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
            `${bundle.objectiveMetric ? `The present paper positions itself around ${bundle.objectiveMetric}` : "The present paper positions itself around the stated empirical objective"} while keeping claims limited to the available artifacts.`
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
    case "limitations": {
      const baseSentences: string[][] = [
        [
          context.discussion.limitations[0] ||
            "The current paper is limited by the granularity of upstream artifacts and the scope of the available evaluation traces.",
          context.results.ci_unavailable_reason || ""
        ]
      ];

      const gateWarnings = bundle.gateWarnings ?? [];
      if (gateWarnings.length > 0) {
        baseSentences.push(buildGateWarningLimitationSentences(gateWarnings));
      }

      return buildParagraphsFromSentences(
        baseSentences,
        inferSectionEvidenceIds(undefined, bundle),
        inferSectionCitationIds(undefined, bundle)
      );
    }
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

export function buildGateWarningLimitationSentences(gateWarnings: GateWarningItem[]): string[] {
  // Group by category, ordered by severity (error > warning > info)
  const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
  const sorted = [...gateWarnings].sort(
    (a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)
  );

  const warningsByCategory = new Map<string, GateWarningItem[]>();
  for (const w of sorted) {
    const cat = w.category || "general";
    const existing = warningsByCategory.get(cat) ?? [];
    existing.push(w);
    warningsByCategory.set(cat, existing);
  }

  const sentences: string[] = [];
  for (const [category, items] of warningsByCategory) {
    if (items.length === 0) continue;
    const label = category.replace(/_/g, " ");
    const highestSeverity = items[0].severity || "warning";
    const msgSummary = items.map((i) => i.message).filter(Boolean).join("; ");
    if (msgSummary) {
      sentences.push(
        `[${highestSeverity}] ${label}: ${msgSummary}.`
      );
    }
  }
  return sentences.slice(0, 5);
}

export function applyGateWarningsToLimitations(
  draft: PaperDraft,
  gateWarnings: GateWarningItem[]
): PaperDraft {
  if (gateWarnings.length === 0) {
    return draft;
  }
  const sentences = buildGateWarningLimitationSentences(gateWarnings);
  if (sentences.length === 0) {
    return draft;
  }
  const warningParagraph: PaperDraftParagraph = {
    text: cleanString(sentences.join(" ")),
    evidence_ids: [],
    citation_paper_ids: []
  };
  const sections = draft.sections.map((section) => {
    if (normalizeHeading(section.heading) !== "limitations") {
      return section;
    }
    return {
      ...section,
      paragraphs: [...section.paragraphs, warningParagraph]
    };
  });
  return { ...draft, sections };
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
      const pairwiseRankingAgreement = asNumber(bestWorkflow.value.pairwise_ranking_agreement);
      const winnerConsistency = asNumber(bestWorkflow.value.winner_consistency);
      const mainMetricLabel = inferDatasetMainMetricLabel(input.objectiveMetricProfile, bestModel?.value);
      summaries.push({
        dataset: datasetName,
        label: `${datasetName} (${bestWorkflow.name})`,
        main_metric_label: mainMetricLabel,
        main_metric_value: score,
        delta_label: "delta vs logistic regression",
        delta_value: delta,
        ...(ci95 ? { ci95 } : {}),
        ...(typeof runtime === "number" ? { runtime_seconds_mean: runtime } : {}),
        ...(typeof memory === "number" ? { peak_memory_mb_mean: memory } : {}),
        ...(typeof pairwiseRankingAgreement === "number" ? { pairwise_ranking_agreement: pairwiseRankingAgreement } : {}),
        ...(typeof winnerConsistency === "number" ? { winner_consistency: winnerConsistency } : {}),
        heterogeneity_notes: heterogeneityNotes,
        summary: buildDatasetSummaryText({
          dataset: datasetName,
          workflow: bestWorkflow.name,
          mainMetricLabel,
          deltaLabel: "macro-F1 delta versus logistic regression",
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
    const mainMetricLabel = inferDatasetMainMetricLabel(input.objectiveMetricProfile, bestModel.value);
    summaries.push({
      dataset: datasetName,
      label: `${datasetName} (${bestModel.name})`,
      main_metric_label: mainMetricLabel,
      main_metric_value: score,
      delta_label: "delta vs logistic regression",
      delta_value: delta,
      ...(typeof runtime === "number" ? { runtime_seconds_mean: runtime } : {}),
      ...(typeof memory === "number" ? { peak_memory_mb_mean: memory } : {}),
      heterogeneity_notes: [],
      summary: buildDatasetSummaryText({
        dataset: datasetName,
        workflow: bestModel.name,
        mainMetricLabel,
        deltaLabel: "macro-F1 delta versus logistic regression",
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

function inferDatasetMainMetricLabel(
  objectiveMetricProfile: ObjectiveMetricProfile | undefined,
  modelEntry: Record<string, unknown> | undefined
): string {
  const entry = modelEntry || {};
  if (typeof asNumber(entry.mean_test_macro_f1) === "number" || typeof asNumber(entry.test_macro_f1) === "number" || typeof asNumber(entry.macro_f1) === "number") {
    return "macro-F1";
  }
  if (typeof asNumber(entry.top1_accuracy) === "number") {
    return "top-1 accuracy";
  }
  if (typeof asNumber(entry.accuracy) === "number") {
    return "accuracy";
  }
  return humanizeToken(objectiveMetricProfile?.primaryMetric || "main score");
}

function collectAggregateMetricFacts(
  resultAnalysis: ResultAnalysisArtifact | undefined
): NormalizedNumericFact[] {
  return dedupeNumericFacts(
    (resultAnalysis?.metric_table || [])
      .map((entry) => {
        const metricKey = normalizeMetricIdentifier(entry.key);
        if (!metricKey || typeof entry.value !== "number" || !Number.isFinite(entry.value)) {
          return undefined;
        }
        return buildStructuredNumericFact({
          factKind: "metric",
          source: "artifact",
          location: "artifact.result_analysis.metric_table",
          rawText: `${entry.key}=${formatNumber(entry.value)}`,
          value: entry.value,
          metricKey,
          metricLabel: entry.key,
          datasetScope: "aggregate",
          aggregationLevel: "aggregate",
          unit: inferMetricUnit(entry.key, metricKey, 0, 1),
          sourceRefs: buildArtifactSourceRefs(["result_analysis.metric_table"])
        });
      })
      .filter((item): item is NormalizedNumericFact => Boolean(item))
  );
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
    ...datasetSummaries.flatMap((item) =>
      item.heterogeneity_notes.map((note) => `${item.dataset} ${note}`)
    ),
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
  const runScopedNames = uniqueStrings([
    ...asStringArray(selectedDesign.datasets),
    ...asStringArray(protocol.datasets),
    ...asArray(latestResults.dataset_summaries)
      .map((item) => asString(asRecord(item).dataset))
      .filter((item): item is string => Boolean(item))
  ]);
  if (runScopedNames.length > 0) {
    return runScopedNames.slice(0, 10);
  }
  return uniqueStrings([
    ...bundle.evidenceRows.map((item) => item.dataset_slot).filter((item): item is string => Boolean(item)),
    ...bundle.paperSummaries.flatMap((item) => item.datasets || [])
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
  mainMetricLabel: string;
  deltaLabel: string;
  mainScore?: number;
  delta?: number;
  ci95?: [number, number];
  runtime?: number;
  memory?: number;
  heterogeneityNotes: string[];
}): string {
  const parts = [`On ${input.dataset}, ${humanizeToken(input.workflow)} is the strongest reported condition.`];
  if (typeof input.mainScore === "number") {
    parts.push(`The reported ${cleanString(input.mainMetricLabel) || "main metric"} is ${formatNumber(input.mainScore)}.`);
  }
  if (typeof input.delta === "number") {
    parts.push(`${cleanString(input.deltaLabel) || "The delta versus logistic regression"} is ${formatNumber(input.delta)}.`);
  }
  if (input.ci95) {
    parts.push(`A normal-approximation 95% interval for ${cleanString(input.deltaLabel) || "the reported delta"} spans ${formatNumber(input.ci95[0])} to ${formatNumber(input.ci95[1])}.`);
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
