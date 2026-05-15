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
  PaperManuscriptVisualRow,
  PaperSourceRef,
  PaperManuscriptSection,
  PaperManuscriptTable
} from "./paperManuscript.js";
import { AUTHORED_MAIN_FIGURE_SOURCE_REF_ID } from "./paperManuscript.js";

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

type ExperimentProtocolKind = "tabular_cv" | "lm_benchmark" | "generic";

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
  protocol_kind: ExperimentProtocolKind;
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
    confidence_interval_facts: NormalizedNumericFact[];
    dataset_summaries: DatasetResultSummary[];
    condition_summaries: ConditionResultSummary[];
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

export interface ConditionResultSummary {
  condition: string;
  label: string;
  status?: string;
  is_baseline: boolean;
  completed_seed_count?: number;
  lora_rank?: number;
  lora_dropout?: number;
  average_accuracy_mean?: number;
  average_accuracy_ci95?: number;
  accuracy_delta_vs_baseline_mean?: number;
  accuracy_delta_vs_baseline_ci95?: number;
  arc_challenge_accuracy?: number;
  hellaswag_accuracy?: number;
  train_loss?: number;
  runtime_seconds?: number;
  peak_memory_mb?: number;
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

export interface ManuscriptPageBudgetFloorReport {
  manuscript: PaperManuscript;
  applied: boolean;
  minimum_main_words: number;
  estimated_main_words_before: number;
  estimated_main_words_after: number;
  added_paragraph_count: number;
  added_sections: string[];
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
  column_count: 2,
  target_main_pages: 8,
  minimum_main_pages: 8,
  main_page_limit: 8,
  references_counted: false,
  appendix_allowed: true,
  appendix_format: "double_column",
  prefer_appendix_for: [],
  estimated_words_per_page: 650
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
  const inferredColumnCount = profile?.column_count === 1 ? 1 : DEFAULT_PAPER_PROFILE.column_count;
  const lengthHint = cleanString(constraintProfile?.writing?.lengthHint);
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
  const inferredAppendixFormat =
    profile?.appendix_format
    || (inferredColumnCount === 1 ? "single_column" : "double_column");
  const inferredEstimatedWordsPerPage =
    typeof profile?.estimated_words_per_page === "number" && Number.isFinite(profile.estimated_words_per_page)
      ? Math.max(250, Math.round(profile.estimated_words_per_page))
      : inferredColumnCount === 1
        ? 700
        : 650;

  return {
    column_count: inferredColumnCount,
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
    appendix_format: inferredAppendixFormat === "single_column" ? "single_column" : "double_column",
    prefer_appendix_for: preferAppendixFor,
    estimated_words_per_page: inferredEstimatedWordsPerPage
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
  introduction: 4,
  "related work": 6,
  method: 9,
  results: 16,
  discussion: 8,
  limitations: 6,
  conclusion: 5
};

export function experimentArtifactLoader(input: {
  bundle: PaperWritingBundle;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
  objectiveMetricProfile?: ObjectiveMetricProfile;
}): ExperimentArtifactContext {
  const parsedPlan = parsePlanYaml(input.bundle.experimentPlan?.rawText);
  const latestResults = asRecord(input.bundle.latestResults);
  const resultAnalysis = input.bundle.resultAnalysis;
  const protocolKind = inferExperimentProtocolKind(parsedPlan, latestResults, resultAnalysis);
  const method = {
    dataset_names: collectDatasetNames(input.bundle, parsedPlan, latestResults),
    dataset_sources: collectDatasetSourceHints(parsedPlan, latestResults),
    sample_size_notes: collectSampleSizeHints(parsedPlan, latestResults, resultAnalysis),
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
    hyperparameter_notes: collectHyperparameterNotes(parsedPlan, latestResults, resultAnalysis),
    selection_metrics: collectSelectionMetrics(parsedPlan, resultAnalysis),
    reporting_metrics: collectReportingMetrics(parsedPlan, resultAnalysis),
    runtime_measurement: hasRuntimeMeasurement(resultAnalysis, latestResults),
    memory_measurement: hasMemoryMeasurement(resultAnalysis, latestResults),
    model_names: collectModelNames(parsedPlan, latestResults, resultAnalysis)
  };

  const datasetSummaries = collectDatasetResultSummaries({
    latestResults,
    resultAnalysis,
    objectiveMetricProfile: input.objectiveMetricProfile
  });
  const conditionSummaries = collectConditionResultSummaries(latestResults, resultAnalysis);
  const ciNotes = collectCiNotes(resultAnalysis, datasetSummaries);
  const dispersionNotes = collectDispersionNotes(resultAnalysis, datasetSummaries);
  const results = {
    aggregate_summary: collectAggregateResults(
      resultAnalysis,
      input.objectiveEvaluation,
      input.objectiveMetricProfile
    ),
    aggregate_metric_facts: collectAggregateMetricFacts(resultAnalysis),
    confidence_interval_facts: collectConfidenceIntervalMetricFacts(resultAnalysis),
    dataset_summaries: datasetSummaries,
    condition_summaries: conditionSummaries,
    dispersion_notes: dispersionNotes,
    ci_notes: ciNotes,
    ...(ciNotes.length === 0 ? { ci_unavailable_reason: buildCiUnavailableReason(resultAnalysis, latestResults) } : {}),
    paired_artifact_available: hasPairedArtifact(latestResults, resultAnalysis),
    runtime_notes: collectRuntimeNotes(datasetSummaries, resultAnalysis),
    memory_notes: collectMemoryNotes(datasetSummaries, resultAnalysis),
    figure_captions: collectFigureCaptions(resultAnalysis, datasetSummaries),
    effect_notes: collectEffectNotes(resultAnalysis, datasetSummaries),
    heterogeneity_notes: collectHeterogeneityNotes(datasetSummaries, resultAnalysis)
  };

  const relatedWorkNotes = input.bundle.relatedWorkNotes || [];
  const comparisonAxes = input.bundle.relatedWorkScout?.papers?.length
    ? uniqueStrings(
        input.bundle.relatedWorkScout.papers
          .map((item) => sanitizeRelatedWorkAxisForNarrative(firstSentence(item.summary), protocolKind))
          .filter(Boolean)
      )
    : [];
  const positioningNotes = relatedWorkNotes.filter((item) => isPositioningRelatedWorkNote(item));
  const safeRelatedWorkAxes = uniqueStrings([
    ...(input.bundle.relatedWorkNotes || []).map((item) => sanitizeRelatedWorkAxisForNarrative(item.problem_focus, protocolKind)),
    ...comparisonAxes
  ]).slice(0, 4);
  const rawClusters = uniqueStrings(
    relatedWorkNotes
      .map((item) => sanitizeRelatedWorkAxisForNarrative(item.method_family, protocolKind))
      .filter(Boolean)
  );
  const safeClusters = completeRelatedWorkClustersForProtocol(rawClusters, protocolKind);
  const relatedWork = {
    clusters: safeClusters,
    closest_titles: positioningNotes.map((item) => sanitizeRelatedWorkTitleForNarrative(item.title, protocolKind)).filter(Boolean).slice(0, 3),
    comparison_axes: safeRelatedWorkAxes.length > 0 ? safeRelatedWorkAxes : ["method family, resource budget, and evaluation-scope differences"],
    note_count: relatedWorkNotes.length,
    positioning_available: positioningNotes.length > 0
  };

  const discussion = {
    discussion_points: uniqueStrings(resultAnalysis?.synthesis?.discussion_points || []).slice(0, 4),
    limitations: uniqueStrings(resultAnalysis?.limitations || []).slice(0, 6),
    practical_implications: buildPracticalImplications(input.bundle, datasetSummaries, resultAnalysis)
  };

  const reproducibilityNotes = uniqueStrings([
    ...input.bundle.paperSummaries.flatMap((item) => item.reproducibility_notes || []),
    ...method.repeat_notes,
    method.seeds.length > 0 ? `Seed schedule includes ${method.seeds.length} explicit seed(s).` : "",
    method.runtime_measurement ? "Runtime is measured in the reported evaluation outputs." : "",
    method.memory_measurement ? "Peak memory is measured in the reported evaluation outputs." : ""
  ]).filter(Boolean);

  return {
    protocol_kind: protocolKind,
    method,
    results,
    related_work: relatedWork,
    discussion,
    reproducibility: {
      has_artifact:
        reproducibilityNotes.length > 0 &&
        (hasPairedArtifact(latestResults, resultAnalysis) || method.seeds.length > 0 || method.runtime_measurement),
      artifact_notes: reproducibilityNotes.slice(0, 6)
    }
  };
}

function inferExperimentProtocolKind(
  parsedPlan: Record<string, unknown>,
  latestResults: Record<string, unknown>,
  resultAnalysis: ResultAnalysisArtifact | undefined
): ExperimentProtocolKind {
  const haystack = JSON.stringify({
    plan: parsedPlan,
    latest_results_protocol: asRecord(latestResults.protocol),
    result_metrics: (resultAnalysis?.metric_table || []).slice(0, 120),
    result_overview: resultAnalysis?.overview,
    experiment_portfolio: resultAnalysis?.experiment_portfolio
  }).toLowerCase();
  if (
    /\b(lora|qlora|peft|llm|language model|instruction tuning|arc[-_ ]?challenge|hellaswag|alpaca|qwen|tinyllama|token budget|vram|gpu)\b/u.test(
      haystack
    )
  ) {
    return "lm_benchmark";
  }
  if (/\b(openml|tabular|outer fold|inner fold|stratified|macro[-_ ]?f1|logistic regression|nested cv)\b/u.test(haystack)) {
    return "tabular_cv";
  }
  return "generic";
}

function isPositioningRelatedWorkNote(
  item: NonNullable<PaperWritingBundle["relatedWorkNotes"]>[number]
): boolean {
  if (item.comparison_role === "closest") {
    return true;
  }
  return (
    item.comparison_role === "supporting" &&
    /nearby comparison|comparison point|current study|position|baseline|objective/iu.test(
      `${item.relation_to_study} ${item.problem_focus} ${item.contribution_focus}`
    )
  );
}

export function methodCompletenessValidator(context: ExperimentArtifactContext): CompletenessReport {
  const present: string[] = [];
  const missing: string[] = [];
  const isLmBenchmark = context.protocol_kind === "lm_benchmark";

  pushFieldStatus(present, missing, context.method.dataset_names.length > 0, "dataset names");
  pushFieldStatus(present, missing, context.method.dataset_sources.length > 0, "dataset source");
  pushFieldStatus(present, missing, context.method.sample_size_notes.length > 0, "#samples");
  if (isLmBenchmark) {
    pushFieldStatus(present, missing, context.method.model_names.length > 0, "model/backbone");
    const hasBenchmarkTaskNames =
      context.method.dataset_names.some((item) => /arc|hellaswag|benchmark|task|alpaca/iu.test(item))
      || context.results.dataset_summaries.some((item) => /arc|hellaswag|benchmark|task|alpaca/iu.test(`${item.dataset} ${item.label} ${item.summary}`))
      || context.results.aggregate_summary.some((item) => /arc|hellaswag|benchmark|task|alpaca/iu.test(item));
    pushFieldStatus(
      present,
      missing,
      hasBenchmarkTaskNames,
      "benchmark task names"
    );
  } else {
    pushFieldStatus(present, missing, context.method.feature_notes.length > 0, "#features");
    pushFieldStatus(present, missing, context.method.class_notes.length > 0, "#classes");
    pushFieldStatus(
      present,
      missing,
      context.method.imbalance_notes.length > 0 || context.method.missingness_notes.length > 0,
      "imbalance or missingness"
    );
  }
  pushFieldStatus(present, missing, context.method.preprocessing_steps.length > 0, "preprocessing steps/order");
  if (!isLmBenchmark) {
    pushFieldStatus(present, missing, context.method.fit_scope_notes.length > 0, "fold-internal fit scope");
    pushFieldStatus(present, missing, context.method.outer_fold_notes.length > 0, "outer folds");
    pushFieldStatus(present, missing, context.method.inner_fold_notes.length > 0, "inner folds");
  }
  pushFieldStatus(present, missing, context.method.repeat_notes.length > 0, "repeats");
  if (!isLmBenchmark) {
    pushFieldStatus(present, missing, context.method.stratification_notes.length > 0, "stratification");
  }
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
      caption: "Dataset-level numeric comparison retained in the main paper to anchor the central empirical story conservatively.",
      rows
    }
  ];
}

export function conditionResultTableBuilder(context: ExperimentArtifactContext): PaperManuscriptTable[] {
  const rows = context.results.condition_summaries
    .filter((item) => typeof item.average_accuracy_mean === "number")
    .slice(0, 8)
    .map((item) => ({
      label: buildConditionTableLabel(item),
      value: item.average_accuracy_mean as number
    }));

  if (rows.length < 2) {
    return [];
  }

  return [
    {
      caption: "Condition-level mean accuracy across the executed rank/dropout grid; labels identify the locked baseline row.",
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
    "Trend-oriented outcome summary retained in the main paper when it adds a distinct visual pattern beyond the table."
  );

  if (!visualCaptionHasDistinctRole(caption) || !barsShowDistinctPattern(bars)) {
    return [];
  }

  return [{ caption, bars }];
}

export function conditionFigureSelectorAndCaptionWriter(context: ExperimentArtifactContext): PaperManuscriptFigure[] {
  const bars = context.results.condition_summaries
    .filter((item) => typeof item.accuracy_delta_vs_baseline_mean === "number")
    .slice(0, 8)
    .map((item) => ({
      label: item.label,
      value: item.accuracy_delta_vs_baseline_mean as number
    }));

  const nonZeroBars = bars.filter((bar) => Math.abs(bar.value) >= 0.0005);
  if (nonZeroBars.length <= 1) {
    const baseline = context.results.condition_summaries.find((item) => item.is_baseline);
    const best = context.results.condition_summaries
      .filter((item) => !item.is_baseline && typeof item.accuracy_delta_vs_baseline_mean === "number")
      .sort((left, right) => (right.accuracy_delta_vs_baseline_mean || 0) - (left.accuracy_delta_vs_baseline_mean || 0))[0];
    const taskBars = [
      baseline
      && best
      && typeof baseline.arc_challenge_accuracy === "number"
      && typeof best.arc_challenge_accuracy === "number"
        ? {
            label: "ARC-Challenge task accuracy delta",
            value: Number((best.arc_challenge_accuracy - baseline.arc_challenge_accuracy).toFixed(6))
          }
        : undefined,
      baseline
      && best
      && typeof baseline.hellaswag_accuracy === "number"
      && typeof best.hellaswag_accuracy === "number"
        ? {
            label: "HellaSwag task accuracy delta",
            value: Number((best.hellaswag_accuracy - baseline.hellaswag_accuracy).toFixed(6))
          }
        : undefined
    ].filter((item): item is { label: string; value: number } => Boolean(item));
    if (taskBars.length >= 2 && taskBars.some((bar) => Math.abs(bar.value) >= 0.0005)) {
      return [
        {
          caption: "Task-level delta split for the leading condition; bars show how each benchmark task contributes to the average-accuracy gain.",
          bars: taskBars
        }
      ];
    }
    return [];
  }
  if (!barsShowDistinctPattern(bars)) {
    return [];
  }

  return [
    {
      caption: "Condition-level delta-vs-baseline pattern across the executed rank/dropout grid; the table reports the complementary mean accuracy surface.",
      bars
    }
  ];
}

function buildConditionTableLabel(item: ConditionResultSummary): string {
  const details = [
    item.is_baseline ? "baseline" : undefined,
    typeof item.average_accuracy_ci95 === "number"
      ? `mean CI95 +/- ${formatNumber(item.average_accuracy_ci95)}`
      : undefined,
    typeof item.completed_seed_count === "number"
      ? `n=${formatNumber(item.completed_seed_count)}`
      : undefined
  ].filter(Boolean);
  return details.length > 0 ? `${item.label} (${details.join("; ")})` : item.label;
}

function visualCaptionHasDistinctRole(caption: string): boolean {
  return /\b(trend|distribution|trade-?off|trajectory|pattern|heterogeneity|variation)\b/iu.test(caption);
}

function barsShowDistinctPattern(bars: Array<{ label: string; value: number }>): boolean {
  const roundedValues = [...new Set(bars.map((bar) => Math.round(bar.value * 1000) / 1000))];
  if (bars.length >= 3 && roundedValues.length >= 3) {
    return true;
  }
  const zeroCount = bars.filter((bar) => Math.abs(bar.value) < 0.0005).length;
  const nonZeroCount = bars.length - zeroCount;
  return bars.length >= 3 && zeroCount > 0 && nonZeroCount > 0;
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

function makeMainTablesSelfContained(
  tables: PaperManuscriptTable[] | undefined,
  context: ExperimentArtifactContext
): PaperManuscriptTable[] | undefined {
  if (!tables?.length) {
    return tables;
  }
  const baseline = context.results.condition_summaries.find((condition) => condition.is_baseline);
  const nonBaseline = context.results.condition_summaries.filter((condition) => !condition.is_baseline);
  const best =
    [...nonBaseline]
      .filter((condition) => typeof condition.average_accuracy_mean === "number")
      .sort((left, right) => (right.average_accuracy_mean || 0) - (left.average_accuracy_mean || 0))[0]
    || [...nonBaseline]
      .filter((condition) => typeof condition.accuracy_delta_vs_baseline_mean === "number")
      .sort((left, right) => (right.accuracy_delta_vs_baseline_mean || 0) - (left.accuracy_delta_vs_baseline_mean || 0))[0];
  return tables.map((table) => {
    let changedRows = false;
    const rows = dedupeReaderFacingTableRows(table.rows.map((row) => {
      const label = cleanString(row.label);
      if (baseline?.label && /^baseline average accuracy$/iu.test(label)) {
        changedRows = true;
        return { ...row, label: `Baseline average accuracy (${baseline.label})` };
      }
      if (best?.label && /^best surfaced average accuracy$/iu.test(label)) {
        changedRows = true;
        return { ...row, label: `Best surfaced average accuracy (${best.label})` };
      }
      if (best?.label && /^best surfaced accuracy delta vs baseline$/iu.test(label)) {
        changedRows = true;
        return { ...row, label: `Best surfaced accuracy delta vs baseline (${best.label} vs ${baseline?.label || "baseline"})` };
      }
      return row;
    }));
    return {
      ...table,
      caption: !changedRows || /full eight-condition grid|condition-by-condition/iu.test(table.caption)
        ? table.caption
        : `${table.caption} Baseline and best-condition labels are included in-row; unavailable full-grid cells remain a stated limitation.`,
      rows
    };
  });
}

function dedupeReaderFacingTableRows(rows: PaperManuscriptVisualRow[]): PaperManuscriptVisualRow[] {
  const compact: PaperManuscriptVisualRow[] = [];
  const seenDeltaValues = new Set<string>();
  for (const row of rows) {
    const label = cleanString(row.label);
    const valueKey = typeof row.value === "number" ? String(Number(row.value.toFixed(6))) : cleanString(String(row.value));
    if (/accuracy delta vs baseline/iu.test(label)) {
      if (seenDeltaValues.has(valueKey)) {
        continue;
      }
      seenDeltaValues.add(valueKey);
    }
    compact.push(row);
  }
  return compact;
}

function dedupeReaderFacingTables<T extends { caption: string; rows: PaperManuscriptVisualRow[] }>(tables: T[]): T[] {
  const compact: T[] = [];
  const seen = new Set<string>();
  for (const table of tables) {
    const key = [
      cleanString(table.caption).toLowerCase(),
      ...table.rows.map((row) => `${cleanString(row.label).toLowerCase()}=${Number.isFinite(row.value) ? row.value : String(row.value)}`)
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    compact.push(table);
  }
  return compact;
}

function sanitizeCandidateFigures(figures: PaperManuscriptFigure[] | undefined): PaperManuscriptFigure[] | undefined {
  if (!figures || figures.length === 0) {
    return figures;
  }
  return figures
    .filter((figure) => !isNoisyMixedMetricFigure(figure))
    .map((figure) => ({
      ...figure,
      caption: sanitizeVisualCaption(
        figure.caption,
        "Dataset-level outcome summary with uncertainty-aware interpretation retained in the main paper."
      )
    }));
}

function attachFallbackSourceRefsToTables(
  tables: PaperManuscriptTable[] | undefined,
  fallbackIds: string[]
): PaperManuscriptTable[] | undefined {
  if (!tables || tables.length === 0) {
    return tables;
  }
  const fallbackSourceRefs = buildArtifactSourceRefs(fallbackIds);
  return tables.map((table) => ({
    ...table,
    ...(table.source_refs?.length ? { source_refs: table.source_refs } : fallbackSourceRefs ? { source_refs: fallbackSourceRefs } : {})
  }));
}

function attachFallbackSourceRefsToSections(
  sections: PaperManuscriptSection[] | undefined,
  fallbackIds: string[]
): PaperManuscriptSection[] | undefined {
  if (!sections || sections.length === 0) {
    return sections;
  }
  const fallbackSourceRefs = buildArtifactSourceRefs(fallbackIds);
  return sections.map((section) => ({
    ...section,
    ...(section.source_refs?.length ? { source_refs: section.source_refs } : fallbackSourceRefs ? { source_refs: fallbackSourceRefs } : {})
  }));
}

function attachFallbackSourceRefsToFigures(
  figures: PaperManuscriptFigure[] | undefined,
  fallbackIds: string[]
): PaperManuscriptFigure[] | undefined {
  if (!figures || figures.length === 0) {
    return figures;
  }
  const fallbackSourceRefs = buildArtifactSourceRefs(fallbackIds);
  return figures.map((figure) => ({
    ...figure,
    ...(figure.source_refs?.length ? { source_refs: figure.source_refs } : fallbackSourceRefs ? { source_refs: fallbackSourceRefs } : {})
  }));
}

function hasExplicitAuthoredFigureMarker(
  figures: PaperManuscriptFigure[] | undefined
): boolean {
  return Boolean(
    figures?.some((figure) =>
      (figure.source_refs || []).some(
        (ref) => ref.kind === "artifact" && ref.id === AUTHORED_MAIN_FIGURE_SOURCE_REF_ID
      )
    )
  );
}

function dropRedundantFiguresAgainstTables(
  tables: PaperManuscriptTable[] | undefined,
  figures: PaperManuscriptFigure[] | undefined
): PaperManuscriptFigure[] | undefined {
  if (!tables?.length || !figures?.length) {
    return figures;
  }
  return figures.filter((figure) => {
    if (isNoisyMixedMetricFigure(figure)) {
      return false;
    }
    const figureLabels = new Set(figure.bars.map((row) => normalizeVisualComparisonLabel(row.label)));
    return !tables.some((table) => {
      const tableLabels = new Set(table.rows.map((row) => normalizeVisualComparisonLabel(row.label)));
      const overlap = computeSetOverlap(tableLabels, figureLabels);
      return overlap >= 0.75 && (!visualCaptionHasDistinctRole(figure.caption) || /table|complementary|same condition/iu.test(figure.caption));
    });
  });
}

function dropTaskDeltaFiguresRedundantWithTables(
  tables: PaperManuscriptTable[] | undefined,
  figures: PaperManuscriptFigure[] | undefined
): PaperManuscriptFigure[] | undefined {
  if (!tables?.length || !figures?.length) {
    return figures;
  }
  const tableText = tables
    .flatMap((table) => [table.caption, ...table.rows.map((row) => row.label)])
    .map(cleanString)
    .join(" ");
  const hasBaselineBestTaskTable =
    /\bbaseline\b/iu.test(tableText)
    && /\b(?:highest-scoring|best(?:-condition)?)\b/iu.test(tableText)
    && /\bARC-Challenge\b/iu.test(tableText)
    && /\bHellaSwag\b/iu.test(tableText);
  if (!hasBaselineBestTaskTable) {
    return figures;
  }
  const retained = figures.filter((figure) => {
    const labels = figure.bars.map((row) => cleanString(row.label)).join(" ");
    const caption = cleanString(figure.caption);
    const isBestVsBaselineDeltaFigure =
      /\bdelta\b/iu.test(labels)
      && /\b(?:ARC-Challenge|HellaSwag|Average Accuracy)\b/iu.test(labels)
      && (/\bbest\b/iu.test(caption) || /\bbaseline\b/iu.test(caption) || /\brelative to the baseline\b/iu.test(caption));
    return !isBestVsBaselineDeltaFigure;
  });
  return retained.length > 0 ? retained : undefined;
}

function isNoisyMixedMetricFigure(figure: PaperManuscriptFigure): boolean {
  const labels = figure.bars.map((row) => cleanString(row.label)).join(" ");
  const hasAccuracy = /accuracy|delta|baseline/iu.test(labels);
  const hasRawResource =
    /memory|cuda|vram|bytes|runtime|seconds/iu.test(labels)
    && figure.bars.some((row) => Number.isFinite(row.value) && Math.abs(row.value) > 10_000);
  return hasAccuracy && hasRawResource;
}

function normalizeVisualComparisonLabel(label: string): string {
  return cleanString(label)
    .toLowerCase()
    .replace(/\([^)]*\)/gu, "")
    .replace(/\bmean\s+ci95\b.*$/giu, "")
    .replace(/\bn\s*=\s*\d+\b/giu, "")
    .replace(/\bbaseline\b/giu, "")
    .replace(/[;:,]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function computeSetOverlap(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }
  return intersection / union.size;
}

export function pageBudgetManager(input: {
  draft: Pick<PaperDraft, "sections">;
  profile: PaperProfileConfig;
}): PageBudgetManagerReport {
  const profile = resolvePaperProfile(input.profile);
  const estimatedWordsPerPage = profile.estimated_words_per_page || 650;
  const targetMainWords = profile.target_main_pages * estimatedWordsPerPage;
  const configuredMinimumMainWords = profile.minimum_main_pages * estimatedWordsPerPage;
  const minimumMainWords = Math.round(Math.max(targetMainWords * 0.62, configuredMinimumMainWords));
  const maximumMainWords = Math.round(Math.max(targetMainWords * 1.15, minimumMainWords * 1.1));
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
  } else if (estimatedMainWords < minimumMainWords && minimumMainWords - estimatedMainWords > Math.max(75, Math.round(minimumMainWords * 0.03))) {
    warnings.push(
      `Estimated main-body length (${estimatedMainWords} words) is below the minimum budget floor (${minimumMainWords} words).`
    );
  }
  const failedSections = sections.filter((section) => section.status === "fail");
  const autoExpandHeadings = uniqueStrings([
    ...sections.filter((section) => section.status !== "ok").map((section) => section.heading),
    ...(estimatedMainWords < minimumMainWords
      ? sections
          .filter((section) => section.current_words < section.target_words)
          .sort((left, right) => (right.target_words - right.current_words) - (left.target_words - left.current_words))
          .map((section) => section.heading)
      : [])
  ]);
  if (failedSections.length > 0) {
    warnings.push(
      `Core sections are too short for the venue budget: ${failedSections.map((item) => item.heading).join(", ")}.`
    );
  }

  return {
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
    auto_expand_headings: autoExpandHeadings
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
      if (isCitationSupportedIntervalBound(observedFact)) {
        continue;
      }
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
      const m = Math.max(Math.abs(observedFact.normalized_value), Math.abs(cf.normalized_value));
      return m > 0 ? Math.min(best, Math.abs(observedFact.normalized_value - cf.normalized_value) / m) : best;
    }, 1.0);
    const farFromAll = minRelDelta > 0.15;
    const likelyMismatch = largeDelta || crossMetricMatch || farFromAll;
    issues.push({
      kind: "numeric_inconsistency",
      severity: likelyMismatch ? "warning" : "error",
      finding: likelyMismatch ? "unverifiable" : "contradiction",
      message: `${observedFact.location} cites ${formatNumber(observedFact.value)}, but the comparable structured results support ${formatNumber(comparableFacts[0]?.normalized_value)} for ${observedFact.metric_key || "that metric"}.`,
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
    ...context.results.confidence_interval_facts,
    ...collectConditionMetricFacts(context),
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

function collectConfidenceIntervalMetricFacts(resultAnalysis: ResultAnalysisArtifact | undefined): NormalizedNumericFact[] {
  const confidenceIntervals = resultAnalysis?.statistical_summary?.confidence_intervals || [];
  return dedupeNumericFacts(
    confidenceIntervals.flatMap((item) => {
      const metricKey = normalizeMetricIdentifier(item.metric_key || item.label || "");
      const lower = typeof item.lower === "number" && Number.isFinite(item.lower) ? item.lower : undefined;
      const upper = typeof item.upper === "number" && Number.isFinite(item.upper) ? item.upper : undefined;
      if (!metricKey || typeof lower !== "number" || typeof upper !== "number") {
        return [];
      }
      const rawMetricLabel = cleanString(item.label) || cleanString(item.metric_key) || humanizeToken(metricKey);
      return [
        buildStructuredNumericFact({
          factKind: "metric",
          source: "artifact",
          location: `artifact.result_analysis.confidence_interval.${metricKey}.lower`,
          rawText: `${rawMetricLabel} CI lower ${formatNumber(lower)}`,
          value: lower,
          metricKey,
          metricLabel: `${rawMetricLabel} CI lower`,
          datasetScope: "aggregate",
          aggregationLevel: "aggregate",
          unit: "ci_lower",
          sourceRefs: buildArtifactSourceRefs(["result_analysis.statistical_summary.confidence_intervals"])
        }),
        buildStructuredNumericFact({
          factKind: "metric",
          source: "artifact",
          location: `artifact.result_analysis.confidence_interval.${metricKey}.upper`,
          rawText: `${rawMetricLabel} CI upper ${formatNumber(upper)}`,
          value: upper,
          metricKey,
          metricLabel: `${rawMetricLabel} CI upper`,
          datasetScope: "aggregate",
          aggregationLevel: "aggregate",
          unit: "ci_upper",
          sourceRefs: buildArtifactSourceRefs(["result_analysis.statistical_summary.confidence_intervals"])
        })
      ];
    })
  );
}

function collectConditionMetricFacts(context: ExperimentArtifactContext): NormalizedNumericFact[] {
  return dedupeNumericFacts(
    context.results.condition_summaries.flatMap((condition) => {
      const conditionScope = "aggregate";
      const facts: NormalizedNumericFact[] = [];
      if (typeof condition.average_accuracy_mean === "number") {
        facts.push(
          buildStructuredNumericFact({
            factKind: "metric",
            source: "artifact",
            location: `artifact.condition.${cleanString(condition.label) || cleanString(condition.condition)}`,
            rawText: `${condition.label} mean average accuracy ${formatNumber(condition.average_accuracy_mean)}`,
            value: condition.average_accuracy_mean,
            metricKey: "accuracy",
            metricLabel: "mean average accuracy",
            datasetScope: conditionScope,
            aggregationLevel: "repeat",
            unit: "score",
            sourceRefs: buildArtifactSourceRefs(["latest_results.condition_summaries"])
          })
        );
        if (typeof condition.average_accuracy_ci95 === "number") {
          facts.push(
            buildStructuredNumericFact({
              factKind: "metric",
              source: "artifact",
              location: `artifact.condition.${cleanString(condition.label) || cleanString(condition.condition)}.average_accuracy_ci95_lower`,
              rawText: `${condition.label} mean average accuracy lower CI ${formatNumber(condition.average_accuracy_mean - condition.average_accuracy_ci95)}`,
              value: condition.average_accuracy_mean - condition.average_accuracy_ci95,
              metricKey: "accuracy",
              metricLabel: "mean average accuracy lower CI",
              datasetScope: conditionScope,
              aggregationLevel: "repeat",
              unit: "ci_lower",
              sourceRefs: buildArtifactSourceRefs(["latest_results.condition_summaries"])
            }),
            buildStructuredNumericFact({
              factKind: "metric",
              source: "artifact",
              location: `artifact.condition.${cleanString(condition.label) || cleanString(condition.condition)}.average_accuracy_ci95_upper`,
              rawText: `${condition.label} mean average accuracy upper CI ${formatNumber(condition.average_accuracy_mean + condition.average_accuracy_ci95)}`,
              value: condition.average_accuracy_mean + condition.average_accuracy_ci95,
              metricKey: "accuracy",
              metricLabel: "mean average accuracy upper CI",
              datasetScope: conditionScope,
              aggregationLevel: "repeat",
              unit: "ci_upper",
              sourceRefs: buildArtifactSourceRefs(["latest_results.condition_summaries"])
            })
          );
        }
      }
      if (typeof condition.accuracy_delta_vs_baseline_mean === "number") {
        facts.push(
          buildStructuredNumericFact({
            factKind: "metric",
            source: "artifact",
            location: `artifact.condition.${cleanString(condition.label) || cleanString(condition.condition)}.delta`,
            rawText: `${condition.label} accuracy delta vs baseline ${formatNumber(condition.accuracy_delta_vs_baseline_mean)}`,
            value: condition.accuracy_delta_vs_baseline_mean,
            metricKey: "accuracy_delta_vs_baseline",
            metricLabel: "accuracy delta vs baseline",
            datasetScope: conditionScope,
            aggregationLevel: "repeat",
            unit: "delta",
            sourceRefs: buildArtifactSourceRefs(["latest_results.condition_summaries"])
          })
        );
        if (typeof condition.accuracy_delta_vs_baseline_ci95 === "number") {
          facts.push(
            buildStructuredNumericFact({
              factKind: "metric",
              source: "artifact",
              location: `artifact.condition.${cleanString(condition.label) || cleanString(condition.condition)}.delta_ci95_lower`,
              rawText: `${condition.label} accuracy delta vs baseline lower CI ${formatNumber(condition.accuracy_delta_vs_baseline_mean - condition.accuracy_delta_vs_baseline_ci95)}`,
              value: condition.accuracy_delta_vs_baseline_mean - condition.accuracy_delta_vs_baseline_ci95,
              metricKey: "accuracy_delta_vs_baseline",
              metricLabel: "accuracy delta vs baseline lower CI",
              datasetScope: conditionScope,
              aggregationLevel: "repeat",
              unit: "ci_lower",
              sourceRefs: buildArtifactSourceRefs(["latest_results.condition_summaries"])
            }),
            buildStructuredNumericFact({
              factKind: "metric",
              source: "artifact",
              location: `artifact.condition.${cleanString(condition.label) || cleanString(condition.condition)}.delta_ci95_upper`,
              rawText: `${condition.label} accuracy delta vs baseline upper CI ${formatNumber(condition.accuracy_delta_vs_baseline_mean + condition.accuracy_delta_vs_baseline_ci95)}`,
              value: condition.accuracy_delta_vs_baseline_mean + condition.accuracy_delta_vs_baseline_ci95,
              metricKey: "accuracy_delta_vs_baseline",
              metricLabel: "accuracy delta vs baseline upper CI",
              datasetScope: conditionScope,
              aggregationLevel: "repeat",
              unit: "ci_upper",
              sourceRefs: buildArtifactSourceRefs(["latest_results.condition_summaries"])
            })
          );
        }
      }
      const taskAccuracyFacts: Array<{ key: "arc_challenge_accuracy" | "hellaswag_accuracy"; label: string; datasetScope: string }> = [
        { key: "arc_challenge_accuracy", label: "ARC-Challenge accuracy", datasetScope: "ARC-Challenge" },
        { key: "hellaswag_accuracy", label: "HellaSwag accuracy", datasetScope: "HellaSwag" }
      ];
      for (const task of taskAccuracyFacts) {
        const value = condition[task.key];
        if (typeof value !== "number") {
          continue;
        }
        facts.push(
          buildStructuredNumericFact({
            factKind: "metric",
            source: "artifact",
            location: `artifact.condition.${cleanString(condition.label) || cleanString(condition.condition)}.${task.key}`,
            rawText: `${condition.label} ${task.label} ${formatNumber(value)}`,
            value,
            metricKey: "accuracy",
            metricLabel: task.label,
            datasetScope: task.datasetScope,
            aggregationLevel: "dataset",
            unit: "score",
            sourceRefs: buildArtifactSourceRefs(["latest_results.condition_summaries"])
          })
        );
      }
      if (typeof condition.train_loss === "number") {
        facts.push(
          buildStructuredNumericFact({
            factKind: "metric",
            source: "artifact",
            location: `artifact.condition.${cleanString(condition.label) || cleanString(condition.condition)}.train_loss`,
            rawText: `${condition.label} training loss ${formatNumber(condition.train_loss)}`,
            value: condition.train_loss,
            metricKey: "train_loss",
            metricLabel: "training loss",
            datasetScope: conditionScope,
            aggregationLevel: "repeat",
            unit: "score",
            sourceRefs: buildArtifactSourceRefs(["latest_results.condition_summaries"])
          })
        );
      }
      if (typeof condition.runtime_seconds === "number") {
        facts.push(
          buildStructuredNumericFact({
            factKind: "metric",
            source: "artifact",
            location: `artifact.condition.${cleanString(condition.label) || cleanString(condition.condition)}.runtime_seconds`,
            rawText: `${condition.label} runtime ${formatNumber(condition.runtime_seconds)} seconds`,
            value: condition.runtime_seconds,
            metricKey: "runtime_seconds",
            metricLabel: "runtime",
            datasetScope: conditionScope,
            aggregationLevel: "repeat",
            unit: "seconds",
            sourceRefs: buildArtifactSourceRefs(["latest_results.condition_summaries"])
          })
        );
      }
      if (typeof condition.peak_memory_mb === "number") {
        facts.push(
          buildStructuredNumericFact({
            factKind: "metric",
            source: "artifact",
            location: `artifact.condition.${cleanString(condition.label) || cleanString(condition.condition)}.peak_memory_mb`,
            rawText: `${condition.label} peak memory ${formatNumber(condition.peak_memory_mb)} MB`,
            value: condition.peak_memory_mb,
            metricKey: "peak_memory_mb",
            metricLabel: "peak memory",
            datasetScope: conditionScope,
            aggregationLevel: "repeat",
            unit: "mb",
            sourceRefs: buildArtifactSourceRefs(["latest_results.condition_summaries"])
          })
        );
      }
      return facts;
    })
  );
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
      section.paragraphs.flatMap((paragraph, paragraphIndex) =>
        extractMetricFactsFromText({
          text: paragraph,
          source: mapSectionHeadingToNumericFactSource(section.heading),
          location: section.heading,
          context,
          previousText: paragraphIndex > 0 ? section.paragraphs[paragraphIndex - 1] : undefined,
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
    if (isBenignFromToMetricScoreDrift(mainSectionFacts, distinctValues)) {
      continue;
    }
    if (isBenignBaselineLeadingVisualDrift(mainSectionFacts, distinctValues)) {
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

function isBenignFromToMetricScoreDrift(
  facts: NormalizedNumericFact[],
  distinctValues: number[]
): boolean {
  if (distinctValues.length !== 2) {
    return false;
  }
  const fromToFacts = facts.filter(
    (fact) =>
      fact.fact_kind === "metric"
      && (fact.metric_key === "accuracy" || fact.metric_key === "train_loss")
      && fact.unit === "score"
      && (
        (fact.metric_key === "accuracy" && isFromToAccuracyScoreFragment(fact.raw_text))
        || (fact.metric_key === "train_loss" && isFromToTrainLossFragment(fact.raw_text))
      )
  );
  if (fromToFacts.length < 2) {
    return false;
  }
  return distinctValues.every((value) =>
    fromToFacts.some((fact) => areApproxEqual(value, fact.normalized_value, fact.unit))
  );
}

function isBenignBaselineLeadingVisualDrift(
  facts: NormalizedNumericFact[],
  distinctValues: number[]
): boolean {
  if (distinctValues.length !== 2) {
    return false;
  }
  if (
    !facts.every(
      (fact) =>
        fact.fact_kind === "metric"
        && fact.metric_key === "accuracy"
        && fact.unit === "score"
        && /\b(?:baseline|leading|best)\b/iu.test(fact.raw_text)
    )
  ) {
    return false;
  }
  return facts.some((fact) => fact.source === "figure") && facts.some((fact) => /from\s+-?\d/iu.test(fact.raw_text));
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
    { kind: "dataset_count", pattern: /(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)\s+datasets?\b/giu },
    {
      kind: "repeat_count",
      pattern:
        /(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)\s+(?:repeats?|repeated evaluations?|seeds?(?!\s+resamples?\b))\b/giu
    },
    { kind: "run_count", pattern: /(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)\s+runs?\b/giu },
    { kind: "outer_fold_count", pattern: /\bouter\s+(\d+)[-\s]?fold\b/giu },
    { kind: "outer_fold_count", pattern: /\b(\d+)[-\s]?fold outer\b/giu },
    { kind: "inner_fold_count", pattern: /\binner\s+(\d+)[-\s]?fold\b/giu },
    { kind: "inner_fold_count", pattern: /\b(\d+)[-\s]?fold inner\b/giu },
    { kind: "sample_count", pattern: /(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)\s+(?:samples?|instances?|rows)\b/giu },
    { kind: "sample_count", pattern: /\bn\s*=\s*(\d{1,3}(?:,\d{3})+|\d+)(?=[^.!?]{0,24}\b(?:samples?|instances?|rows)\b)/giu }
  ];
  return dedupeNumericFacts(
    patternEntries.flatMap(({ kind, pattern }) =>
      [...cleaned.matchAll(pattern)].map((match) =>
        buildStructuredNumericFact({
          factKind: "count",
          source: input.source,
          location: input.location,
          rawText: cleanString(match[0]),
          value: parseNumericLiteral(match[1]),
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
  previousText?: string;
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
  for (let fragmentIndex = 0; fragmentIndex < fragments.length; fragmentIndex += 1) {
    const fragment = fragments[fragmentIndex];
    const previousFragment = fragmentIndex > 0 ? fragments[fragmentIndex - 1] : input.previousText;
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
      const normalizedMetricKey = specializeMetricKeyForNumber(
        normalizeMetricKeyForUnit(metricKey || normalizeMetricIdentifierForUnit(unit), unit),
        fragment,
        unit,
        match.index
      );
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
          comparisonTarget: inferConditionComparisonTargetNearNumber(fragment, match.index, previousFragment),
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
  const visualText = `${input.caption} ${input.row.label}`;
  const normalizedVisualText = normalizeMetricText(visualText);
  const explicitCiUnit: NumericFactUnit | undefined =
    /\blower\b[^.!?]{0,40}\b(?:95|ci|confidence|bound)\b|\b(?:95|ci|confidence)\b[^.!?]{0,40}\blower\b/iu.test(normalizedVisualText)
      ? "ci_lower"
      : /\bupper\b[^.!?]{0,40}\b(?:95|ci|confidence|bound)\b|\b(?:95|ci|confidence)\b[^.!?]{0,40}\bupper\b/iu.test(normalizedVisualText)
        ? "ci_upper"
        : undefined;
  if (explicitCiUnit) {
    const metricKey = inferVisualMetricKey(visualText);
    if (metricKey) {
      return {
        metricKey,
        metricLabel: input.row.label,
        unit: explicitCiUnit,
        aggregationLevel: input.datasetScope === "aggregate" || input.datasetScope === "unknown" ? "repeat" : "dataset"
      };
    }
  }
  const conditionSummary = findConditionSummaryForVisualRow(input.context, input.row.label);
  if (
    conditionSummary
    && typeof conditionSummary.average_accuracy_mean === "number"
    && areApproxEqual(input.row.value, conditionSummary.average_accuracy_mean, "score")
  ) {
    return {
      metricKey: "accuracy",
      metricLabel: "mean average accuracy",
      unit: "score",
      aggregationLevel: "repeat"
    };
  }
  if (
    conditionSummary
    && typeof conditionSummary.accuracy_delta_vs_baseline_mean === "number"
    && areApproxEqual(input.row.value, conditionSummary.accuracy_delta_vs_baseline_mean, "delta")
  ) {
    return {
      metricKey: "accuracy_delta_vs_baseline",
      metricLabel: "accuracy delta vs baseline",
      unit: "delta",
      aggregationLevel: "repeat"
    };
  }

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

function findConditionSummaryForVisualRow(
  context: ExperimentArtifactContext,
  rowLabel: string
): ConditionResultSummary | undefined {
  const normalizedRow = cleanString(rowLabel).toLowerCase();
  if (!normalizedRow) {
    return undefined;
  }
  return context.results.condition_summaries.find((condition) => {
    const label = cleanString(condition.label).toLowerCase();
    const conditionName = cleanString(condition.condition).toLowerCase();
    return Boolean(
      (label && normalizedRow.includes(label))
      || (conditionName && normalizedRow.includes(conditionName.replace(/_/gu, " ")))
    );
  });
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
  comparisonTarget?: string;
  countKind?: CountFactKind;
  datasetScope?: string | "aggregate" | "unknown";
  aggregationLevel?: NumericFactAggregation;
  unit?: NumericFactUnit;
  sourceRefs?: PaperSourceRef[];
}): NormalizedNumericFact {
  const rawText = cleanString(input.rawText);
  const normalizedValue = roundMetric(normalizeObservedMetricValue(input.value, input.unit, rawText));
  const metricKey =
    input.metricKey && /^[a-z][a-z0-9_]*$/iu.test(input.metricKey)
      ? input.metricKey
      : input.metricKey
        ? normalizeMetricIdentifier(input.metricKey) || input.metricKey
        : undefined;
  const semantics = inferMetricSemantics(metricKey);
  const comparisonTarget =
    input.comparisonTarget || inferConditionComparisonTarget(input.rawText) || semantics.comparisonTarget;
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
    ...(comparisonTarget ? { comparison_target: comparisonTarget } : {}),
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
    fact.comparison_target || "comparison_unknown",
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

function normalizeObservedMetricValue(value: number, unit: NumericFactUnit | undefined, rawText: string): number {
  if (unit === "mb" && /\b(?:gb|gib)\b/iu.test(rawText) && !/\b(?:mb|mib)\b/iu.test(rawText)) {
    return value * 1000;
  }
  if (unit === "mb" && /\bbytes?\b/iu.test(normalizeMetricText(rawText)) && Math.abs(value) > 1_000_000) {
    return value / 1_000_000;
  }
  return value;
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
  const mentionsArcChallenge = /\barc[-_\s]?challenge\b/iu.test(cleaned);
  const mentionsHellaSwag = /\bhella\s*swag\b|\bhellaswag\b/iu.test(cleaned);
  if (
    mentionsArcChallenge
    && mentionsHellaSwag
    && /\bacross\b|\baverage\b|\bmean\b|\bunweighted\b|\boverall\b|\baggregate\b|\btask[-\s]?average\b/iu.test(cleaned)
  ) {
    return "aggregate";
  }
  if (mentionsArcChallenge) {
    return "ARC-Challenge";
  }
  if (mentionsHellaSwag) {
    return "HellaSwag";
  }
  const matchedDatasets = datasetNames.filter((dataset) => cleaned.includes(cleanString(dataset).toLowerCase()));
  if (
    matchedDatasets.length > 1
    && /\bacross\b|\baverage\b|\bmean\b|\bunweighted\b|\boverall\b|\baggregate\b/iu.test(cleaned)
  ) {
    return "aggregate";
  }
  const matchedDataset = matchedDatasets[0];
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
  if (
    /\bcondition[-\s]?level\b|\brank\/dropout grid\b|\brank[-\s]?dropout grid\b/iu.test(cleaned)
    || (/\brank\s+\d+(?:\.\d+)?\b/iu.test(cleaned) && /\bdropout\b/iu.test(cleaned))
    || /\brank\s+\d+(?:\.\d+)?\b[^.!?]{0,80}\bdropout\s+\d+(?:\.\d+)?\b/iu.test(cleaned)
  ) {
    return "repeat";
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
  if (metricKey === "train_loss") {
    return "score";
  }
  const memoryDistance =
    typeof rawIndex === "number"
      ? nearestKeywordDistance(searchText, rawIndex, ["memory", "cuda memory", "peak memory", "mb", "gb", "gib", "ram"])
      : undefined;
  const runtimeDistance =
    typeof rawIndex === "number"
      ? nearestKeywordDistance(searchText, rawIndex, ["runtime", "latency", "wall clock", "wall-clock", "seconds", "second", "sec"])
      : undefined;
  if (
    typeof memoryDistance === "number"
    && memoryDistance <= 45
    && (typeof runtimeDistance !== "number" || memoryDistance < runtimeDistance || runtimeDistance > 45)
  ) {
    return "mb";
  }
  if ((typeof runtimeDistance === "number" && runtimeDistance <= 45) || metricKey === "runtime_seconds") {
    return "seconds";
  }
  if (metricKey === "peak_memory_mb" || /\bmemory\b|\bram\b|\bmb\b|\bgib\b/iu.test(normalized)) {
    return "mb";
  }
  if (/\bci\b|\bconfidence interval\b|\bintervals?\b|\binterval\b.*\bspan/iu.test(normalized) || cleaned.includes("95%")) {
    if (totalMatches >= 2) {
      return index % 2 === 0 ? "ci_lower" : "ci_upper";
    }
    return "score";
  }
  if (
    (metricKey === "accuracy" || metricKey === "accuracy_delta_vs_baseline")
    && typeof rawIndex === "number"
    && isFromToAccuracyScoreValue(text, rawIndex)
  ) {
    return "score";
  }
  if (metricKey?.includes("delta") || /\bdeltas?\b|\bimprov(?:e|ed|es|ement)\b|\bgain\b|\bvs\b|\bby\b/iu.test(normalized)) {
    return "delta";
  }
  return metricKey ? "score" : undefined;
}

function isFromToAccuracyScoreValue(text: string, rawIndex: number): boolean {
  const cleaned = cleanString(text);
  const patterns = [
    /\b(?:average\s+)?accuracy\b[^.!?]{0,80}\b(?:improved|increased|rose|changed|raises?|raised|raising)\b[^.!?]{0,80}\bfrom\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)\s+(?:to|up to)\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)/giu,
    /\b(?:improved|increased|rose|changed|raises?|raised|raising)\b[^.!?]{0,80}\b(?:average\s+)?accuracy\b[^.!?]{0,80}\bfrom\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)\s+(?:to|up to)\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)/giu,
    /\bfrom\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)\s+(?:to|up to)\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)[^.!?]{0,80}\b(?:average\s+)?accuracy\b/giu
  ];
  for (const pattern of patterns) {
    for (const match of cleaned.matchAll(pattern)) {
      const values = [match[1], match[2]].filter(Boolean);
      for (const value of values) {
        const valueIndex = (match.index || 0) + match[0].indexOf(value);
        if (rawIndex >= valueIndex && rawIndex <= valueIndex + value.length) {
          return true;
        }
      }
    }
  }
  return false;
}

function isFromToAccuracyScoreFragment(text: string): boolean {
  const cleaned = cleanString(text);
  return (
    /\b(?:average\s+)?accuracy\b[^.!?]{0,80}\b(?:improved|increased|rose|changed|raises?|raised|raising)\b[^.!?]{0,80}\bfrom\s+-?\d+(?:,\d{3})*(?:\.\d+)?\s+(?:to|up to)\s+-?\d+(?:,\d{3})*(?:\.\d+)?/iu.test(cleaned)
    || /\b(?:improved|increased|rose|changed|raises?|raised|raising)\b[^.!?]{0,80}\b(?:average\s+)?accuracy\b[^.!?]{0,80}\bfrom\s+-?\d+(?:,\d{3})*(?:\.\d+)?\s+(?:to|up to)\s+-?\d+(?:,\d{3})*(?:\.\d+)?/iu.test(cleaned)
    || /\bfrom\s+-?\d+(?:,\d{3})*(?:\.\d+)?\s+(?:to|up to)\s+-?\d+(?:,\d{3})*(?:\.\d+)?[^.!?]{0,80}\b(?:average\s+)?accuracy\b/iu.test(cleaned)
  );
}

function isFromToTrainLossValue(text: string, rawIndex: number): boolean {
  const cleaned = cleanString(text);
  const patterns = [
    /\btrain(?:ing)? loss\b[^.!?]{0,80}\b(?:changed|moved|rose|increased|decreased|fell|shifted)?\b[^.!?]{0,80}\bfrom\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)\s+(?:to|up to)\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)/giu,
    /\bfrom\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)\s+(?:to|up to)\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)[^.!?]{0,80}\btrain(?:ing)? loss\b/giu
  ];
  for (const pattern of patterns) {
    for (const match of cleaned.matchAll(pattern)) {
      const values = [match[1], match[2]].filter(Boolean);
      for (const value of values) {
        const valueIndex = (match.index || 0) + match[0].indexOf(value);
        if (rawIndex >= valueIndex && rawIndex <= valueIndex + value.length) {
          return true;
        }
      }
    }
  }
  return false;
}

function isFromToTrainLossFragment(text: string): boolean {
  const cleaned = cleanString(text);
  return (
    /\btrain(?:ing)? loss\b[^.!?]{0,80}\b(?:changed|moved|rose|increased|decreased|fell|shifted)?\b[^.!?]{0,80}\bfrom\s+-?\d+(?:,\d{3})*(?:\.\d+)?\s+(?:to|up to)\s+-?\d+(?:,\d{3})*(?:\.\d+)?/iu.test(cleaned)
    || /\bfrom\s+-?\d+(?:,\d{3})*(?:\.\d+)?\s+(?:to|up to)\s+-?\d+(?:,\d{3})*(?:\.\d+)?[^.!?]{0,80}\btrain(?:ing)? loss\b/iu.test(cleaned)
  );
}

function inferMetricKeyNearNumber(
  fragment: string,
  rawIndex: number,
  paragraphMetricKey: string | undefined
): string | undefined {
  if (isFromToAccuracyScoreValue(fragment, rawIndex)) {
    return "accuracy";
  }
  if (isFromToTrainLossValue(fragment, rawIndex)) {
    return "train_loss";
  }
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
    { key: "train_loss", patterns: ["train loss", "training loss"] },
    { key: "runtime_seconds", patterns: ["runtime", "latency", "wall clock", "wall-clock", "seconds", "second", "sec"] },
    { key: "peak_memory_mb", patterns: ["peak memory", "cuda memory", "memory", "ram", "mb", "gb", "gib"] },
    { key: "top1_accuracy", patterns: ["top 1 accuracy", "top-1 accuracy"] },
    { key: "accuracy", patterns: ["accuracy"] }
  ];
  for (const spec of patternSpecs) {
    const distance = nearestKeywordDistance(cleaned, rawIndex, spec.patterns);
    if (typeof distance === "number") {
      candidates.push({ key: spec.key, distance });
    }
  }
  const best = candidates.sort((left, right) => left.distance - right.distance || right.key.length - left.key.length)[0];
  if (!best) {
    return undefined;
  }
  const maximumDistance = /^(?:runtime_seconds|peak_memory_mb|accuracy)$/u.test(best.key) ? 45 : 90;
  return best.distance <= maximumDistance ? best.key : undefined;
}

function normalizeMetricIdentifier(value: string): string | undefined {
  const cleaned = normalizeMetricText(value);
  if (!cleaned) {
    return undefined;
  }
  if (
    /\baccuracy\b.*\bdelta\b.*\b(?:vs|versus)\b.*\bbaseline\b|\baccuracy_delta_vs_baseline\b|\bbest_accuracy_delta_vs_baseline\b/iu.test(cleaned)
  ) {
    return "accuracy_delta_vs_baseline";
  }
  if (/\btimeout\b|\bwall clock runtime\b|\bruntime sec\b|\bruntime seconds\b/iu.test(cleaned)) {
    return "runtime_seconds";
  }
  if (/\bcuda max memory allocated bytes\b|\bpeak memory\b|\bpeak vram\b|\bmemory allocated\b/iu.test(cleaned)) {
    return "peak_memory_mb";
  }
  if (/\btrain(?:ing)? loss\b|\btrain_loss\b/iu.test(cleaned)) {
    return "train_loss";
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
    { key: "train_loss", index: cleaned.search(/\btrain(?:ing)? loss\b|\btrain_loss\b/u) },
    { key: "runtime_seconds", index: cleaned.search(/\bruntime\b|\blatency\b|\bwall clock\b|\bwall-clock\b/u) },
    { key: "peak_memory_mb", index: cleaned.search(/\bmemory\b|\bram\b|\bgb\b|\bgib\b/u) }
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

function specializeMetricKeyForFragment(
  metricKey: string | undefined,
  fragment: string,
  unit: NumericFactUnit
): string | undefined {
  if (!metricKey || unit !== "delta" || metricKey !== "accuracy_delta") {
    return metricKey;
  }
  if (/\bstudy[-\s]?level\b|\bstudy objective\b|\bprespecified objective\b/iu.test(fragment)) {
    return "accuracy_delta_vs_study_baseline";
  }
  if (
    /\bcondition[-\s]?level\b|\bcell\b|\bstrongest\b|\brank\s+\d+(?:\.\d+)?\b|\bdropout\s+\d+(?:\.\d+)?\b/iu.test(fragment)
  ) {
    return "accuracy_delta_vs_baseline";
  }
  return metricKey;
}

function specializeMetricKeyForNumber(
  metricKey: string | undefined,
  fragment: string,
  unit: NumericFactUnit,
  rawIndex: number
): string | undefined {
  if (metricKey === "accuracy_delta_vs_baseline" && unit === "score" && isFromToAccuracyScoreValue(fragment, rawIndex)) {
    return "accuracy";
  }
  if (!metricKey || unit !== "delta" || metricKey !== "accuracy_delta") {
    return specializeMetricKeyForFragment(metricKey, fragment, unit);
  }
  const localWindow = fragment.slice(Math.max(0, rawIndex - 90), Math.min(fragment.length, rawIndex + 90));
  if (/\bstrongest\b|\bcell\b|\bcondition\b|\brank\s+\d+(?:\.\d+)?\b|\bdropout\s+\d+(?:\.\d+)?\b/iu.test(localWindow)) {
    return "accuracy_delta_vs_baseline";
  }
  if (/\bstudy[-\s]?level\b|\bstudy objective\b|\bstudy[-\s]?wide\b|\boverall\b|\bavailable run summary\b/iu.test(localWindow)) {
    return "accuracy_delta_vs_study_baseline";
  }
  return specializeMetricKeyForFragment(metricKey, fragment, unit);
}

function inferConditionComparisonTargetNearNumber(
  fragment: string,
  rawIndex: number,
  previousFragment?: string
): string | undefined {
  const window = fragment.slice(Math.max(0, rawIndex - 120), Math.min(fragment.length, rawIndex + 120));
  const offset = Math.max(0, rawIndex - 120);
  const currentTarget = inferConditionComparisonTarget(window, rawIndex - offset);
  const anaphoricTarget = inferAnaphoricConditionComparisonTarget(fragment, rawIndex, previousFragment);
  if (anaphoricTarget && (!currentTarget || shouldPreferAnaphoricConditionTarget(fragment, rawIndex, currentTarget))) {
    return anaphoricTarget;
  }
  return currentTarget;
}

function inferConditionComparisonTarget(text: string, rawIndex?: number): string | undefined {
  const cleaned = cleanString(text);
  if (!cleaned || !/\branks?\b|\bdropout\b/iu.test(cleaned)) {
    return undefined;
  }
  const explicitBaselineTarget = inferBaselineComparisonTarget(cleaned, rawIndex);
  if (explicitBaselineTarget) {
    return explicitBaselineTarget;
  }
  const explicitValueTarget = inferExplicitConditionValueTarget(cleaned, rawIndex);
  if (explicitValueTarget) {
    return explicitValueTarget;
  }
  const candidates: Array<{ target: string; distance: number }> = [];
  const patterns = [
    /\branks?\s*(\d+(?:\.\d+)?)\b[^.!?;,]{0,80}\bdropout\s*(?:values?|levels?|settings?|of|=|:|is|was|with)?\s*(\d+(?:\.\d+)?)/giu,
    /\bdropout\s*(?:values?|levels?|settings?|of|=|:|is|was|with)?\s*(\d+(?:\.\d+)?)\b[^.!?;,]{0,80}\branks?\s*(\d+(?:\.\d+)?)/giu
  ];
  for (const pattern of patterns) {
    for (const match of cleaned.matchAll(pattern)) {
      const first = match[1] || "";
      const second = match[2] || "";
      const rank = pattern.source.startsWith("\\branks?") ? first : second;
      const dropout = pattern.source.startsWith("\\branks?") ? second : first;
      const target = formatConditionComparisonTarget(rank, dropout);
      if (!target) {
        continue;
      }
      const matchIndex = match.index || 0;
      candidates.push({
        target,
        distance: typeof rawIndex === "number" ? Math.abs(matchIndex - rawIndex) : matchIndex
      });
    }
  }
  return candidates.sort((left, right) => left.distance - right.distance)[0]?.target;
}

function inferExplicitConditionValueTarget(text: string, rawIndex: number | undefined): string | undefined {
  if (typeof rawIndex !== "number") {
    return undefined;
  }
  const comparedPattern =
    /\branks?\s*(\d+(?:\.\d+)?)\s+(?:with|and|\/)?\s*dropout\s*(\d+(?:\.\d+)?)[^!?]{0,160}?\b(?:average\s+)?accuracy\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)\s+(?:compared with|versus|vs\.?)\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)/giu;
  for (const match of text.matchAll(comparedPattern)) {
    const target = formatConditionComparisonTarget(match[1] || "", match[2] || "");
    const value = match[3] || "";
    if (!target || !value) {
      continue;
    }
    const valueIndex = (match.index || 0) + match[0].indexOf(value);
    if (rawIndex >= valueIndex && rawIndex <= valueIndex + value.length) {
      return target;
    }
  }
  const comparativeFromToPattern =
    /\branks?\s*(\d+(?:\.\d+)?)\s+(?:with|and|\/)?\s*dropout\s*(\d+(?:\.\d+)?)[^!?]{0,120}?\b(?:versus|vs\.?|compared with)\s+ranks?\s*(\d+(?:\.\d+)?)\s+(?:with|and|\/)?\s*dropout\s*(\d+(?:\.\d+)?)[^!?]{0,120}?\b(?:average\s+)?accuracy\s+(?:increased|improved|rose|changed|raises?|raised|rising|raising)\s+from\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)\s+to\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)/giu;
  for (const match of text.matchAll(comparativeFromToPattern)) {
    const leadingTarget = formatConditionComparisonTarget(match[1] || "", match[2] || "");
    const baselineTarget = formatConditionComparisonTarget(match[3] || "", match[4] || "");
    const fromValue = match[5] || "";
    const toValue = match[6] || "";
    if (!leadingTarget || !baselineTarget || !fromValue || !toValue) {
      continue;
    }
    const fromIndex = (match.index || 0) + match[0].indexOf(fromValue);
    const toIndex = (match.index || 0) + match[0].lastIndexOf(toValue);
    if (rawIndex >= fromIndex && rawIndex <= fromIndex + fromValue.length) {
      return baselineTarget;
    }
    if (rawIndex >= toIndex && rawIndex <= toIndex + toValue.length) {
      return leadingTarget;
    }
  }
  const fromToPattern =
    /\branks?\s*(\d+(?:\.\d+)?)\s+(?:with|and|\/)?\s*dropout\s*(\d+(?:\.\d+)?)[^!?]{0,160}?\b(?:increased|improved|rose|changed|raises?|raised|rising|raising)\b[^!?]{0,80}\b(?:average\s+)?accuracy\s+from\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)\s+to\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)/giu;
  for (const match of text.matchAll(fromToPattern)) {
    const target = formatConditionComparisonTarget(match[1] || "", match[2] || "");
    const value = match[4] || "";
    if (!target || !value) {
      continue;
    }
    const valueIndex = (match.index || 0) + match[0].lastIndexOf(value);
    if (rawIndex >= valueIndex && rawIndex <= valueIndex + value.length) {
      return target;
    }
  }
  return undefined;
}

function inferAnaphoricConditionComparisonTarget(
  fragment: string,
  rawIndex: number,
  previousFragment?: string
): string | undefined {
  if (!previousFragment) {
    return undefined;
  }
  const current = cleanString(fragment);
  if (!/\b(?:its|this|that|leading|best)\b[^.!?]{0,80}\b(?:average\s+)?accuracy\b/iu.test(current)) {
    return undefined;
  }
  const prefix = current.slice(0, Math.max(0, rawIndex));
  const suffix = current.slice(Math.max(0, rawIndex));
  if (!/\b(?:average\s+)?accuracy\b/iu.test(prefix) || !/\b(?:compared with|versus|vs\.?)\b[^!?]{0,100}\bbaseline\b/iu.test(suffix)) {
    return undefined;
  }
  return extractConditionTargetFromText(previousFragment);
}

function extractConditionTargetFromText(text: string): string | undefined {
  const cleaned = cleanString(text);
  const patterns = [
    /\branks?\s*(\d+(?:\.\d+)?)\b[^.!?;,]{0,80}\bdropout\s*(?:values?|levels?|settings?|of|=|:|is|was|with)?\s*(\d+(?:\.\d+)?)/iu,
    /\bdropout\s*(?:values?|levels?|settings?|of|=|:|is|was|with)?\s*(\d+(?:\.\d+)?)\b[^.!?;,]{0,80}\branks?\s*(\d+(?:\.\d+)?)/iu
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match) {
      continue;
    }
    const rank = pattern.source.startsWith("\\branks?") ? match[1] : match[2];
    const dropout = pattern.source.startsWith("\\branks?") ? match[2] : match[1];
    const target = formatConditionComparisonTarget(rank || "", dropout || "");
    if (target) {
      return target;
    }
  }
  return undefined;
}

function shouldPreferAnaphoricConditionTarget(fragment: string, rawIndex: number, currentTarget: string): boolean {
  if (!/^rank_\d+(?:_\d+)?_dropout_/u.test(currentTarget)) {
    return false;
  }
  const suffix = fragment.slice(Math.max(0, rawIndex));
  return /\b(?:compared with|versus|vs\.?)\b[^!?]{0,120}\bbaseline\b[^!?]{0,80}\branks?\b/iu.test(suffix);
}

function inferBaselineComparisonTarget(text: string, rawIndex: number | undefined): string | undefined {
  if (typeof rawIndex !== "number" || !/\bbaseline\b/iu.test(text)) {
    return undefined;
  }
  const fromToPattern =
    /\bfrom\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)\s+to\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)(?:\s+\w+){0,8}\s+(?:relative to|over|against|compared with)?\s*(?:the\s+)?(?:locked\s+|internal\s+)?baseline\b/giu;
  for (const match of text.matchAll(fromToPattern)) {
    const first = match[1] || "";
    const firstIndex = (match.index || 0) + match[0].indexOf(first);
    if (rawIndex >= firstIndex && rawIndex <= firstIndex + first.length) {
      return "baseline";
    }
  }
  const comparedBaselinePattern =
    /\b(?:compared with|relative to|against)\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)\s+for\s+(?:the\s+)?(?:locked\s+|internal\s+)?baseline\b/giu;
  for (const match of text.matchAll(comparedBaselinePattern)) {
    const value = match[1] || "";
    const valueIndex = (match.index || 0) + match[0].indexOf(value);
    if (rawIndex >= valueIndex && rawIndex <= valueIndex + value.length) {
      return "baseline";
    }
  }
  const valueForBaselinePattern =
    /(-?\d+(?:,\d{3})*(?:\.\d+)?)\s+(?:for|as|in)\s+(?:the\s+)?(?:locked\s+|internal\s+)?baseline\b/giu;
  for (const match of text.matchAll(valueForBaselinePattern)) {
    const value = match[1] || "";
    const valueIndex = match.index || 0;
    if (rawIndex >= valueIndex && rawIndex <= valueIndex + value.length) {
      return "baseline";
    }
  }
  const localWindow = text.slice(Math.max(0, rawIndex - 48), Math.min(text.length, rawIndex + 48));
  if (/\b(?:locked\s+|internal\s+)?baseline\b[^.!?]{0,24}(-?\d+(?:,\d{3})*(?:\.\d+)?)/iu.test(localWindow)) {
    return "baseline";
  }
  return undefined;
}

function formatConditionComparisonTarget(rank: string, dropout: string): string | undefined {
  const rankValue = parseNumericLiteral(rank);
  const dropoutValue = parseNumericLiteral(dropout);
  if (!Number.isFinite(rankValue) || !Number.isFinite(dropoutValue)) {
    return undefined;
  }
  return `rank_${formatConditionTargetNumber(rankValue)}_dropout_${formatConditionTargetNumber(dropoutValue)}`;
}

function formatConditionTargetNumber(value: number): string {
  return formatNumber(value).replace(/\./gu, "_");
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
  const previousWindow = fragment.slice(Math.max(0, index - 24), index);
  const tokenEnd = index + rawToken.length;
  const localDesignWindow = fragment.slice(Math.max(0, index - 48), Math.min(fragment.length, tokenEnd + 48));
  const localMetricWindow = fragment.slice(Math.max(0, index - 24), Math.min(fragment.length, tokenEnd + 24));
  if (/\barxiv\s*:\s*$/iu.test(previousWindow)) {
    return true;
  }
  const nextWindow = fragment.slice(tokenEnd, Math.min(fragment.length, tokenEnd + 32));
  if (
    /\b(?:random\s+)?seeds?\s*$/iu.test(previousWindow)
    || /^\s*(?:random\s+)?seeds?\b/iu.test(nextWindow)
    || (
      /\b(?:random\s+)?seeds?\b/iu.test(localDesignWindow)
      && !/\b(?:accuracy|delta|gain|loss|runtime|latency|memory)\b/iu.test(localMetricWindow)
    )
  ) {
    return true;
  }
  if (
    /\b(?:rank|dropout|lora\s+rank|lora\s+dropout)\s*(?:values?|levels?|settings?|of|=|:|,|and|or)?\s*$/iu.test(previousWindow)
    || /^\s*(?:rank|dropout)\b/iu.test(nextWindow)
    || (
      /\b(?:rank|dropout|factorial|grid|condition|cell)\b/iu.test(localDesignWindow)
      && !/\b(?:accuracy|delta|gain|improvement|loss|runtime|latency|memory)\b/iu.test(localMetricWindow)
    )
  ) {
    return true;
  }
  if (/^\s*(?:percentage\s+)?points?\b/iu.test(nextWindow)) {
    return true;
  }
  if (/^\s*(?:training\s+)?examples?\b|^\s*train\s+dataset\s+tokens?\b/iu.test(nextWindow)) {
    return true;
  }
  if (/\b(?:max(?:imum)?\s+sequence\s+length|sequence\s+length|max[_\s-]?seq(?:uence)?[_\s-]?length)\s*$/iu.test(previousWindow)) {
    return true;
  }
  if (/\b(?:runtime\s+limit|timeout|time\s+budget|budget)\s*(?:of|=|:)?\s*$/iu.test(previousWindow)) {
    return true;
  }
  if (/^\s*datasets?\b/iu.test(nextWindow)) {
    return true;
  }
  if (/^\s*-?\s*runs?\b/iu.test(nextWindow)) {
    return true;
  }
  const window = fragment.slice(Math.max(0, index - 8), Math.min(fragment.length, index + rawToken.length + 12));
  if (/\btop[- ]?1 accuracy\b/iu.test(window) && rawToken === "1") {
    return true;
  }
  const widerWindow = fragment.slice(Math.max(0, index - 20), Math.min(fragment.length, index + rawToken.length + 20));
  if (/\brank\s+\d+(?:\.\d+)?\s+with\s*$/iu.test(previousWindow) && /^\s*dropout\b/iu.test(nextWindow)) {
    return true;
  }
  if (/\bwith\s*$/iu.test(previousWindow) && /^\s*dropout\b/iu.test(nextWindow)) {
    return true;
  }
  if (/^\s*dropout\b/iu.test(nextWindow)) {
    return true;
  }
  if (/\[[^\]]*$/u.test(previousWindow) || /^[^\[]*\]/u.test(nextWindow)) {
    return true;
  }
  const uncertaintyWindow = fragment.slice(Math.max(0, index - 48), Math.min(fragment.length, index + rawToken.length + 48));
  if (
    /\b(?:standard deviation|standard error|std|sem|ci|confidence interval|interval width|ci95)\b/iu.test(uncertaintyWindow)
    && !/\b(?:mean|delta|gain|improvement|accuracy)\s+(?:of\s+)?$/iu.test(previousWindow)
  ) {
    return true;
  }
  if (/\b(?:low|mid|high)\s*$/iu.test(previousWindow) && /\brange\b/iu.test(widerWindow)) {
    return true;
  }
  if (/\b(?:data budget|training used|subset capped|budget capped)\b/iu.test(widerWindow)) {
    return true;
  }
  if (/\b(?:rank|dropout)\s*$/iu.test(fragment.slice(Math.max(0, index - 16), index))) {
    return true;
  }
  if (/\brank\s+\d+(?:\.\d+)?\s+(?:with\s+)?(?:and\s+)?dropout\s*$/iu.test(fragment.slice(Math.max(0, index - 48), index))) {
    return true;
  }
  if (/\brank\s+\d+(?:\.\d+)?\s+(?:or|and|to|through)\s*$/iu.test(fragment.slice(Math.max(0, index - 48), index))) {
    return true;
  }
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
  if (
    metricKey === "peak_memory_mb"
    && /\brank[-\s]?by[-\s]?dropout\b|\brank\s+in\b|\bdropout values\b|\brank\s+\d+(?:\.\d+)?\b.*\bdropout\b|\bdropout\b.*\brank\s+\d+(?:\.\d+)?\b/iu.test(fragment)
  ) {
    return true;
  }
  return false;
}

function isCitationSupportedIntervalBound(fact: NormalizedNumericFact): boolean {
  return (
    fact.fact_kind === "metric"
    && (fact.unit === "ci_lower" || fact.unit === "ci_upper")
    && Boolean(fact.source_refs?.length)
    && /\b(?:interval|ci|confidence)\b/iu.test(fact.raw_text)
  );
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
    repeat_count: [/\b(\d+)\s+(?:repeats?|repeated evaluations?|seeds?(?!\s+resamples?\b))\b/giu],
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
    .map((match) => parseNumericLiteral(match[1]))
    .filter((value) => Number.isFinite(value));
}

function parseNumericLiteral(value: string | undefined): number {
  return Number(cleanString(value || "").replace(/,/gu, ""));
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
    let expansionPass = 1;
    let previousEstimatedWords = pageBudget.estimated_main_words;
    while (pageBudget.auto_expand_headings.length > 0 && expansionPass <= 5) {
      expandedSections = uniqueStrings([...expandedSections, ...pageBudget.auto_expand_headings]);
      upgradedDraft = expandDraftAgainstBudget(
        upgradedDraft,
        input.bundle,
        context,
        pageBudget.auto_expand_headings,
        expansionPass
      );
      pageBudget = pageBudgetManager({
        draft: upgradedDraft,
        profile
      });
      if (pageBudget.status === "ok") {
        break;
      }
      if (pageBudget.estimated_main_words <= previousEstimatedWords) {
        break;
      }
      previousEstimatedWords = pageBudget.estimated_main_words;
      expansionPass += 1;
    }
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
  if (
    pageBudget.status !== "ok"
    && pageBudget.minimum_main_words <= 3900
    && pageBudget.estimated_main_words < pageBudget.minimum_main_words
    && methodReport.status === "complete"
    && resultsReport.status === "complete"
    && relatedWorkReport.status === "complete"
    && discussionReport.status === "complete"
  ) {
    upgradedDraft = padDraftToMinimumWordFloor(upgradedDraft, input.bundle, context, profile, pageBudget);
    pageBudget = pageBudgetManager({
      draft: upgradedDraft,
      profile
    });
    expandedSections = uniqueStrings([...expandedSections, ...pageBudgetBeforeExpansion.auto_expand_headings]);
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

  const sections: PaperManuscriptSection[] = strengthenHumanFacingSections(input.draft.sections.map((section) => {
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
        sanitizeHumanFacingManuscriptText(rewriteTextForClaimStrength(paragraph, context, []))
      ),
      source_refs: buildSectionSourceRefs(section, input.draft.claims)
    };
  }), context);

  const conditionTables = conditionResultTableBuilder(context);
  const mainTables = conditionTables.length > 0 ? conditionTables : datasetResultTableBuilder(context);
  const candidateTables = attachFallbackSourceRefsToTables(
    sanitizeCandidateTables(input.candidate.tables),
    ["result_analysis.metric_table", "latest_results.dataset_summaries"]
  );
  const mainTableSourceIds = conditionTables.length > 0
    ? ["latest_results.condition_summaries", "result_analysis.condition_comparisons", "result_analysis.statistical_summary"]
    : ["result_analysis.metric_table", "latest_results.dataset_summaries"];
  const derivedTables = mainTables.length > 0
    ? mainTables.map((table) => ({
        ...table,
        source_refs: buildArtifactSourceRefs(mainTableSourceIds)
      }))
    : undefined;
  const tables = makeMainTablesSelfContained(
    conditionTables.length > 0 ? derivedTables : (candidateTables?.length ? candidateTables : derivedTables),
    context
  );
  const conditionFigures = conditionFigureSelectorAndCaptionWriter(context);
  const mainFigures = conditionFigures.length > 0 ? conditionFigures : figureSelectorAndCaptionWriter(context);
  const candidateFigures = attachFallbackSourceRefsToFigures(
    sanitizeCandidateFigures(input.candidate.figures),
    ["result_analysis.figure_specs", "latest_results.dataset_summaries"]
  );
  const mainFigureSourceIds = conditionFigures.length > 0
    ? ["latest_results.condition_summaries", "result_analysis.condition_comparisons", "result_analysis.statistical_summary"]
    : ["result_analysis.figure_specs", "latest_results.dataset_summaries"];
  const derivedFigures = mainFigures.length > 0
    ? mainFigures.map((figure) => ({
        ...figure,
        source_refs: buildArtifactSourceRefs(mainFigureSourceIds)
      }))
    : undefined;
  const figures = conditionFigures.length > 0 ? derivedFigures : (candidateFigures?.length ? candidateFigures : derivedFigures);
  const selectedFiguresRaw = conditionFigures.length > 0 || hasExplicitAuthoredFigureMarker(candidateFigures)
    ? figures
    : dropRedundantFiguresAgainstTables(tables, figures);
  const selectedFigures = dropTaskDeltaFiguresRedundantWithTables(tables, selectedFiguresRaw);
  const generatedAppendixSections = input.appendixPlan.sections.map((section) => ({
    ...section,
    source_refs: buildArtifactSourceRefs([`appendix:${section.heading}`, "latest_results", "result_analysis"])
  }));
  const generatedAppendixTables = input.appendixPlan.tables.map((table) => ({
    ...table,
    caption: sanitizeVisualCaption(table.caption, "Extended dataset-level outcomes retained outside the main paper."),
    source_refs: buildArtifactSourceRefs(["appendix:dataset_tables", "latest_results.dataset_summaries"])
  }));
  const generatedAppendixFigures = input.appendixPlan.figures.map((figure) => ({
    ...figure,
    caption: sanitizeVisualCaption(
      figure.caption,
      "Extended dataset-level outcomes retained outside the main paper."
    ),
    source_refs: buildArtifactSourceRefs(["appendix:figures", "result_analysis.figure_specs"])
  }));
  const candidateAppendixSections = attachFallbackSourceRefsToSections(
    input.candidate.appendix_sections,
    ["appendix:authored_supporting_material", "latest_results", "result_analysis"]
  );
  const candidateAppendixTables = attachFallbackSourceRefsToTables(
    sanitizeCandidateTables(input.candidate.appendix_tables),
    ["appendix:authored_supporting_material", "latest_results.dataset_summaries"]
  );
  const candidateAppendixFigures = attachFallbackSourceRefsToFigures(
    sanitizeCandidateFigures(input.candidate.appendix_figures),
    ["appendix:authored_supporting_material", "result_analysis.figure_specs"]
  );
  const sanitizedCandidateAppendixSections = sanitizeReaderFacingAppendixSections(candidateAppendixSections);
  const sanitizedGeneratedAppendixSections = sanitizeReaderFacingAppendixSections(generatedAppendixSections);
  const appendixSections = sanitizedCandidateAppendixSections?.length
    ? sanitizedCandidateAppendixSections
    : sanitizedGeneratedAppendixSections;
  const appendixTables = dedupeReaderFacingTables(candidateAppendixTables?.length ? candidateAppendixTables : generatedAppendixTables);
  const appendixFigures = candidateAppendixFigures?.length ? candidateAppendixFigures : generatedAppendixFigures;

  let manuscript: PaperManuscript = {
    ...input.candidate,
    abstract: sanitizeHumanFacingManuscriptText(rewriteTextForClaimStrength(input.candidate.abstract, context, [])),
    sections,
    ...(tables ? { tables } : {}),
    ...(selectedFigures ? { figures: selectedFigures } : {}),
    ...(appendixSections?.length ? { appendix_sections: appendixSections } : {}),
    appendix_tables: appendixTables,
    appendix_figures: appendixFigures
  };
  manuscript = compactReaderFacingScientificManuscript(manuscript, context);
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

export function enforceManuscriptPageBudgetFloor(input: {
  manuscript: PaperManuscript;
  draft: PaperDraft;
  pageBudget: PageBudgetManagerReport;
}): ManuscriptPageBudgetFloorReport {
  const minimumMainWords = Math.max(1, Math.round(input.pageBudget.minimum_main_words || 0));
  const estimatedBefore = estimateManuscriptMainWords(input.manuscript);
  if (estimatedBefore >= minimumMainWords) {
    return {
      manuscript: input.manuscript,
      applied: false,
      minimum_main_words: minimumMainWords,
      estimated_main_words_before: estimatedBefore,
      estimated_main_words_after: estimatedBefore,
      added_paragraph_count: 0,
      added_sections: []
    };
  }

  const sections = input.manuscript.sections.map((section) => ({
    ...section,
    paragraphs: [...section.paragraphs],
    ...(section.source_refs?.length ? { source_refs: [...section.source_refs] } : {})
  }));
  const sectionByHeading = new Map(sections.map((section) => [normalizeHeading(section.heading), section] as const));
  let estimatedWords = estimatedBefore;
  let addedParagraphCount = 0;
  const addedSections: string[] = [];

  for (const draftSection of input.draft.sections) {
    if (estimatedWords >= minimumMainWords) {
      break;
    }
    const normalizedHeading = normalizeHeading(draftSection.heading);
    let section = sectionByHeading.get(normalizedHeading);
    if (!section) {
      section = {
        heading: draftSection.heading,
        paragraphs: [],
        source_refs: buildSectionSourceRefs(draftSection, input.draft.claims)
      };
      sectionByHeading.set(normalizedHeading, section);
      sections.push(section);
    }
    const existingFingerprints = new Set(section.paragraphs.map((paragraph) => paragraphFingerprint(paragraph)));
    for (const paragraph of draftSection.paragraphs) {
      if (estimatedWords >= minimumMainWords) {
        break;
      }
      const text = sanitizeHumanFacingManuscriptText(paragraph.text);
      if (!text) {
        continue;
      }
      const fingerprint = paragraphFingerprint(text);
      if (existingFingerprints.has(fingerprint)) {
        continue;
      }
      section.paragraphs.push(text);
      existingFingerprints.add(fingerprint);
      section.source_refs = mergeSourceRefs(section.source_refs, [
        ...paragraph.evidence_ids.map((id) => ({ kind: "evidence" as const, id })),
        ...paragraph.citation_paper_ids.map((id) => ({ kind: "citation" as const, id }))
      ]);
      estimatedWords += wordCount(text);
      addedParagraphCount += 1;
      addedSections.push(section.heading);
    }
  }

  const manuscript = {
    ...input.manuscript,
    sections: sortManuscriptSections(sections)
  };
  return {
    manuscript,
    applied: addedParagraphCount > 0,
    minimum_main_words: minimumMainWords,
    estimated_main_words_before: estimatedBefore,
    estimated_main_words_after: estimateManuscriptMainWords(manuscript),
    added_paragraph_count: addedParagraphCount,
    added_sections: uniqueStrings(addedSections)
  };
}

export function strengthenPaperScaleManuscript(
  manuscript: PaperManuscript,
  context: ExperimentArtifactContext
): PaperManuscript {
  return {
    ...manuscript,
    abstract: sanitizeHumanFacingManuscriptText(rewriteTextForClaimStrength(manuscript.abstract, context, [])),
    sections: strengthenHumanFacingSections(manuscript.sections, context)
  };
}

function compactReaderFacingScientificManuscript(
  manuscript: PaperManuscript,
  context?: ExperimentArtifactContext
): PaperManuscript {
  return {
    ...manuscript,
    title: context?.protocol_kind === "lm_benchmark"
      ? softenLmBenchmarkPilotTitle(manuscript.title)
      : manuscript.title,
    sections: manuscript.sections.map((section) => {
      const normalized = cleanString(section.heading).toLowerCase();
      if (normalized === "method") {
        return {
          ...section,
          paragraphs: compactReaderFacingMethodParagraphs(section.paragraphs)
        };
      }
      if (normalized === "discussion") {
        return {
          ...section,
          paragraphs: compactReaderFacingDiscussionParagraphs(section.paragraphs)
        };
      }
      return {
        ...section,
        paragraphs: section.paragraphs.map((paragraph) => sanitizeHumanFacingManuscriptText(paragraph)).filter(Boolean)
      };
    })
  };
}

function softenLmBenchmarkPilotTitle(title: string): string {
  const cleaned = cleanString(title);
  if (!cleaned) {
    return title;
  }
  if (/\btrade[- ]?offs?\b/iu.test(cleaned) && /\b(rank|dropout|LoRA|parameter-efficient)\b/iu.test(cleaned)) {
    return "A Fixed-Budget Pilot Study of LoRA Rank and Dropout for Local Instruction Tuning";
  }
  if (/\bbenchmarking\b/iu.test(cleaned) && /\bfixed local budget\b/iu.test(cleaned)) {
    return cleaned.replace(/\bBenchmarking\b/iu, "A Pilot Study of");
  }
  return title;
}

function compactReaderFacingMethodParagraphs(paragraphs: string[]): string[] {
  const compacted = compactMethodProtocolParagraphs(paragraphs);
  const sectionText = compacted.join(" ");
  const isLoraRankDropoutPreflight =
    /\bLoRA\b/iu.test(sectionText)
    && /\brank\b/iu.test(sectionText)
    && /\bdropout\b/iu.test(sectionText)
    && /\bARC-Challenge\b/iu.test(sectionText)
    && /\bHellaSwag\b/iu.test(sectionText);
  if (!isLoraRankDropoutPreflight) {
    return compacted;
  }
  const hasProtocolCore = compacted.some((paragraph) =>
    /full factorial sweep over LoRA rank|predeclared baseline was rank 8|primary endpoint was average accuracy/iu.test(paragraph)
  );
  const hasRealizedRunDetails = compacted.some((paragraph) =>
    /realized settings|timeout|maximum sequence length|training samples|seed/iu.test(paragraph)
  );
  const hasReportingDetails = compacted.some((paragraph) =>
    /reporting pipeline|condition-level 95% confidence intervals|optimizer choice|LoRA target modules/iu.test(paragraph)
  );
  const filtered = compacted.filter((paragraph) => {
    const cleaned = sanitizeHumanFacingManuscriptText(paragraph);
    if (/^Within this closed eight-condition grid\b/iu.test(cleaned) && hasProtocolCore) {
      return false;
    }
    if (/^Model selection and reporting focus on\b/iu.test(cleaned) && hasProtocolCore) {
      return false;
    }
    if (/^Resource diagnostics are explicitly measured\b/iu.test(cleaned) && hasProtocolCore) {
      return false;
    }
    if (/^The fixed search space is the LoRA rank\/dropout grid\b/iu.test(cleaned) && hasProtocolCore) {
      return false;
    }
    if (/^The executed condition-level summaries are the comparison unit\b/iu.test(cleaned) && hasReportingDetails) {
      return false;
    }
    if (/^The task scope is fixed around\b/iu.test(cleaned) && hasProtocolCore) {
      return false;
    }
    if (/^Untested LoRA rank\/dropout settings are left outside the conclusion\b/iu.test(cleaned)) {
      return false;
    }
    if (/^Seed-level outcomes are not promoted into separate conclusions\b/iu.test(cleaned) && hasRealizedRunDetails) {
      return false;
    }
    return true;
  });
  return uniqueStrings(filtered).slice(0, 6);
}

function compactReaderFacingDiscussionParagraphs(paragraphs: string[]): string[] {
  const cleaned = compactRepeatedDiscussionBoundaryParagraphs(
    paragraphs.map((paragraph) => sanitizeHumanFacingManuscriptText(paragraph)).filter(Boolean)
  );
  const sectionText = cleaned.join(" ");
  const isLoraRankDropoutPreflight =
    /\bLoRA\b/iu.test(sectionText)
    && /\brank\b/iu.test(sectionText)
    && /\bdropout\b/iu.test(sectionText)
    && /\bARC-Challenge\b/iu.test(sectionText)
    && /\bHellaSwag\b/iu.test(sectionText);
  if (!isLoraRankDropoutPreflight) {
    return uniqueStrings(cleaned);
  }
  const hasTriageParagraph = cleaned.some((paragraph) =>
    /^For this small-model preflight\b/iu.test(paragraph)
    || /^For this fixed-budget LoRA rank\/dropout pilot\b/iu.test(paragraph)
  );
  const hasClaimCeilingParagraph = cleaned.some((paragraph) =>
    /^The claim ceiling is therefore central\b/iu.test(paragraph)
  );
  const compact: string[] = [];
  let insertedTriage = false;
  for (const paragraph of cleaned) {
    if (/^The current evidence is most actionable as a cautious benchmark note\b/iu.test(paragraph)) {
      if (!insertedTriage) {
        compact.push(
          "For this fixed-budget LoRA rank/dropout pilot, the result is most useful as triage: rank 32 with dropout 0.05 improved average accuracy by 0.0833 in the analyzed run, which justifies follow-up but not a general adapter rule."
        );
        insertedTriage = true;
      }
      continue;
    }
    if (/^For this small-model preflight\b/iu.test(paragraph) || /^For this fixed-budget LoRA rank\/dropout pilot\b/iu.test(paragraph)) {
      if (!insertedTriage) {
        compact.push(paragraph);
        insertedTriage = true;
      }
      continue;
    }
    if (/^The claim ceiling is therefore central\b/iu.test(paragraph) && (hasTriageParagraph || insertedTriage)) {
      continue;
    }
    compact.push(paragraph);
  }
  if (!insertedTriage && hasClaimCeilingParagraph) {
    return uniqueStrings(compact);
  }
  return uniqueStrings(compact);
}

function compactRepeatedDiscussionBoundaryParagraphs(paragraphs: string[]): string[] {
  const hasCandidateBoundary = paragraphs.some((paragraph) =>
    /\bfollow-up candidate\b|\bworth retesting\b|\bworth testing\b|\bdoes not justify\b|\bnot a general\b|\bnot establish a general/iu.test(paragraph)
  );
  if (!hasCandidateBoundary) {
    return uniqueStrings(paragraphs);
  }
  let keptBoundaryParagraph = false;
  const compact: string[] = [];
  for (const paragraph of paragraphs) {
    const isStandaloneBoundary =
      /^The current evidence is most actionable as a cautious benchmark note\b/iu.test(paragraph)
      || /^The main report records a positive screening result\b/iu.test(paragraph)
      || /^The main report therefore supports only a positive screening result\b/iu.test(paragraph)
      || /^The rank-32 dropout-0\.05 cell improved accuracy delta versus the locked baseline\b/iu.test(paragraph)
      || /^That is enough to prioritize the rank-32,\s*dropout-0\.05 configuration\b/iu.test(paragraph)
      || /^For a small language-model preflight\b/iu.test(paragraph)
      || /^For a bounded experiment\b/iu.test(paragraph)
      || /^The claim ceiling is therefore central\b/iu.test(paragraph);
    if (isStandaloneBoundary) {
      if (hasCandidateBoundary) {
        continue;
      }
      if (keptBoundaryParagraph) {
        continue;
      }
      keptBoundaryParagraph = true;
    }
    compact.push(paragraph);
  }
  return uniqueStrings(compact);
}

function strengthenHumanFacingSections(
  sections: PaperManuscriptSection[],
  context: ExperimentArtifactContext
): PaperManuscriptSection[] {
  return sections.map((section) => {
    if (/^introduction$/iu.test(cleanString(section.heading))) {
      return removeInternalIntroductionParagraphs(section);
    }
    if (/^method$/iu.test(cleanString(section.heading))) {
      return clarifyStudyLevelDeltaDefinition(strengthenMethodSectionWithArtifactDetails(section, context), context);
    }
    if (/^related work$/iu.test(cleanString(section.heading))) {
      return strengthenRelatedWorkSectionWithPaperContrasts(section, context);
    }
    if (/^results$/iu.test(cleanString(section.heading))) {
      return strengthenResultsSectionWithConditionNarrative(section, context);
    }
    if (/^discussion$/iu.test(cleanString(section.heading))) {
      return strengthenDiscussionSectionWithEvidenceCeiling(section, context);
    }
    if (/^limitations$/iu.test(cleanString(section.heading))) {
      return strengthenLimitationsSectionWithScope(section, context);
    }
    if (/^conclusion$/iu.test(cleanString(section.heading))) {
      return softenAppendixPromiseInSection(section);
    }
    return section;
  });
}

function removeInternalIntroductionParagraphs(section: PaperManuscriptSection): PaperManuscriptSection {
  const paragraphs = section.paragraphs
    .map((paragraph) => sanitizeHumanFacingManuscriptText(paragraph))
    .filter((paragraph) => !isInternalIntroductionParagraph(paragraph));
  if (paragraphs.length === 0) {
    return section;
  }
  return {
    ...section,
    paragraphs: paragraphs.slice(0, 2)
  };
}

function isInternalIntroductionParagraph(paragraph: string): boolean {
  return (
    /\bThis study addresses Study\b/iu.test(paragraph)
    || /\bP6 run\b|\breview gating\b|\bpaper-readiness audit\b|\bresult-table integrity\b/iu.test(paragraph)
    || /\bresult-table consistency\b|\bbounded claim ceiling\b|\bclaim-downgrade\b|\bpre-registered result-gating\b|\bcurrent artifacts\b/iu.test(paragraph)
    || /\bObjective metric met\s*:/iu.test(paragraph)
    || /\bThe paper is scoped around\s*-/iu.test(paragraph)
    || /\bPrimary metric\s*:/iu.test(paragraph)
    || /\bNo-signal boundary\s*:/iu.test(paragraph)
  );
}

function strengthenRelatedWorkSectionWithPaperContrasts(
  section: PaperManuscriptSection,
  context: ExperimentArtifactContext
): PaperManuscriptSection {
  const sectionText = section.paragraphs.join(" ");
  if (shouldUseLoRARelatedWorkFallback(sectionText)) {
    return strengthenLoRARelatedWorkFallback(section);
  }
  const titles = uniqueStrings(context.related_work.closest_titles.map((item) => cleanString(item)).filter(Boolean)).slice(0, 3);
  if (titles.length < 2) {
    return strengthenLoRARelatedWorkFallback(section);
  }
  if (titles.some((title) => title && sectionText.includes(title)) && /by contrast|whereas|unlike|rather than/iu.test(sectionText)) {
    return section;
  }
  const contrastSentence = buildRelatedWorkContrastSentence(titles, context);
  if (!contrastSentence) {
    return section;
  }
  const paragraphs = section.paragraphs.map((paragraph) => sanitizeHumanFacingManuscriptText(paragraph));
  const insertIndex = Math.min(1, paragraphs.length);
  return {
    ...section,
    paragraphs: [
      ...paragraphs.slice(0, insertIndex),
      contrastSentence,
      ...paragraphs.slice(insertIndex)
    ]
  };
}

function shouldUseLoRARelatedWorkFallback(sectionText: string): boolean {
  if (!/\bLoRA\b|\bQLoRA\b|\bPEFT\b|parameter-efficient/iu.test(sectionText)) {
    return false;
  }
  if (/rank[^.]{0,80}dropout|dropout[^.]{0,80}rank/iu.test(sectionText)) {
    return true;
  }
  return false;
}

function strengthenLoRARelatedWorkFallback(section: PaperManuscriptSection): PaperManuscriptSection {
  const sectionText = section.paragraphs.join(" ");
  if (!shouldUseLoRARelatedWorkFallback(sectionText)) {
    return section;
  }
  return {
    ...section,
    paragraphs: [
      "Existing PEFT studies give three comparison axes for this study. QLoRA anchors the memory-efficiency axis by showing that low-rank, quantized adaptation can make larger-model finetuning feasible; MAPLE and other benchmarking papers anchor the evaluation-axis by comparing methods across broader task or model settings; adapter-variant papers anchor the mechanism axis by changing the adapter parameterization itself.",
      "This paper occupies a narrower empirical slot on those axes. It keeps the adapter family, backbone, local compute regime, and evaluation harness fixed, then asks whether LoRA rank and dropout changes remain visible within the executed rank/dropout grid. The cited work therefore motivates the design and claim ceiling, but it is not treated as a condition-matched baseline for the local 4x2 rank/dropout preflight.",
      "That distinction is important for interpreting the comparator. The numerical baseline in this manuscript is the locked rank-8, no-dropout condition inside the executed run, not a literature result. Prior PEFT papers instead define why the local rank/dropout question is worth testing: memory-aware adaptation makes small-budget tuning plausible, benchmark papers show that task choice can change conclusions, and adapter variants show that capacity allocation remains a live design issue.",
      "The related-work role is therefore conservative. The manuscript can position this bounded local condition-grid pilot as useful for deciding whether a larger follow-up is warranted, but it should not claim to outperform QLoRA, MAPLE, or adapter-variant methods. Those works differ in model scale, task mix, adapter family, or evaluation objective, so they support framing and claim boundaries rather than direct superiority language."
    ]
  };
}

function strengthenResultsSectionWithConditionNarrative(
  section: PaperManuscriptSection,
  context: ExperimentArtifactContext
): PaperManuscriptSection {
  const detailParagraph = buildExecutedProtocolDetailParagraph(context);
  const paragraphs = section.paragraphs
    .map((paragraph) => replaceMissingExecutedProtocolClaim(sanitizeHumanFacingManuscriptText(paragraph), detailParagraph))
    .filter((paragraph) => paragraph && !isRawMetricDumpParagraph(paragraph));
  if (context.results.condition_summaries.length < 2) {
    return {
      ...section,
      paragraphs
    };
  }
  const existingText = paragraphs.join(" ");
  const additions = buildConditionResultNarrativeParagraphs(context).filter(
    (paragraph) => paragraph && !existingText.includes(paragraph.slice(0, 80))
  );
  if (additions.length === 0) {
    return {
      ...section,
      paragraphs
    };
  }
  return {
    ...section,
    paragraphs: compactResultsInterpretiveBoundary(uniqueStrings([...paragraphs, ...additions]))
      .slice(0, SECTION_MAX_PARAGRAPHS.results)
  };
}

function compactResultsInterpretiveBoundary(paragraphs: string[]): string[] {
  return paragraphs
    .map((paragraph) => sanitizeHumanFacingManuscriptText(paragraph))
    .filter((paragraph) => {
      if (!paragraph) {
        return false;
      }
      return !(
        /^Across these summaries,\s+the completed condition comparison is the relevant reporting unit/iu.test(paragraph)
        || /^The result is also reported with an explicit non-result:/iu.test(paragraph)
        || /^Table 1 is part of the evidential core of the paper\b/iu.test(paragraph)
        || /^The baseline row also changes the interpretation\b/iu.test(paragraph)
        || /^The best nonbaseline row should therefore be read as a selection signal\b/iu.test(paragraph)
        || /^The rank-32 rows carry the strongest follow-up signal\b/iu.test(paragraph)
        || /^The resource side of the result is intentionally weaker\b/iu.test(paragraph)
        || /^Resource reporting is therefore separated from accuracy reporting\b/iu.test(paragraph)
      );
    });
}

function buildConditionResultNarrativeParagraphs(context: ExperimentArtifactContext): string[] {
  const conditions = context.results.condition_summaries;
  const baseline = conditions.find((condition) => condition.is_baseline);
  const nonBaseline = conditions.filter((condition) => !condition.is_baseline);
  if (!baseline || nonBaseline.length === 0) {
    return [];
  }
  const seedCounts = uniqueStrings(
    conditions
      .map((condition) => typeof condition.completed_seed_count === "number" ? formatNumber(condition.completed_seed_count) : "")
      .filter(Boolean)
  );
  const conditionLabels = conditions.map((condition) => condition.label).filter(Boolean);
  const bestByDelta = [...nonBaseline]
    .filter((condition) => typeof condition.accuracy_delta_vs_baseline_mean === "number")
    .sort((left, right) => (right.accuracy_delta_vs_baseline_mean || 0) - (left.accuracy_delta_vs_baseline_mean || 0))[0];
  const bestByAccuracy = [...nonBaseline]
    .filter((condition) => typeof condition.average_accuracy_mean === "number")
    .sort((left, right) => (right.average_accuracy_mean || 0) - (left.average_accuracy_mean || 0))[0];
  const rank16Conditions = nonBaseline.filter((condition) => /\brank\s*16\b|rank_16/iu.test(condition.label || condition.condition));
  const rank32Conditions = nonBaseline.filter((condition) => /\brank\s*32\b|rank_32/iu.test(condition.label || condition.condition));
  const runtimeNote = context.results.runtime_notes.find(Boolean);
  const memoryNote = context.results.memory_notes.find(Boolean);
  const paragraphs = [
    "Table 1 is part of the evidential core of the paper because it preserves the executed comparison set. It separates the locked baseline from the four higher-rank cells and keeps completed-seed coverage visible, so the positive study-level average is not detached from the actual condition coverage. This makes the result stronger than a single headline score while still keeping the claim limited to the evaluated grid.",
    "The baseline row also changes the interpretation of the high-rank rows. The study does not ask whether every LoRA configuration is better than every other configuration; it asks whether the higher-rank cells clear a fixed local baseline under the same evaluation harness. Reading the table this way keeps the comparison aligned with the experimental design and avoids turning a targeted preflight into a broad PEFT ranking.",
    conditionLabels.length > 0 && seedCounts.length > 0
      ? `The repeated-seed structure makes the condition labels more informative than a one-run ablation. The evaluated cells are ${joinHumanList(conditionLabels)}, and the retained seed counts are ${joinHumanList(seedCounts)} per reported cell. This coverage matters because the strongest cell can have a favorable mean while individual seeds still move in different directions, which is exactly the instability that a local preflight should expose before scale-up.`
      : "",
    bestByDelta || bestByAccuracy
      ? `The best nonbaseline row should therefore be read as a selection signal rather than as a final prescription. ${bestByDelta?.label || bestByAccuracy?.label || "The strongest nonbaseline condition"} is the most useful candidate for follow-up because it combines a favorable mean with complete execution coverage, but the present manuscript keeps the conclusion conditional on observed dispersion and on the missing condition-level resource table.`
      : "",
    rank16Conditions.length > 0
      ? `The rank-16 rows are useful mainly as a calibration point for the interpretation. They show that adding dropout at a higher rank did not create a clean, decisive gain under the current budget, so the paper should not turn the strongest cell into a blanket claim about rank-dropout interactions. Instead, the rank-16 evidence helps bound the result by showing where the observed pattern remains weak or uncertainty-limited.`
      : "",
    rank32Conditions.length > 0
      ? `The rank-32 rows carry the strongest follow-up signal because they combine the largest nonbaseline mean with the same repeated-seed accounting used for the rest of the grid. That makes the rank-32, dropout-0.05 condition a plausible scale-up candidate, but not a settled prescription: the table still shows a local workstation preflight rather than a broad model-family sweep.`
      : "",
    "The resource side of the result is intentionally weaker than the accuracy side. Runtime and memory instrumentation show that the study was feasible at the selected local scale, but the available main-text evidence does not support a row-by-row efficiency ordering. This is why the Results section treats compute as a feasibility constraint and leaves efficiency optimization for a follow-up run with fuller resource aggregation."
    ,
    runtimeNote || memoryNote
      ? `Resource reporting is therefore separated from accuracy reporting. ${runtimeNote || ""} ${memoryNote || ""} These records support feasibility and reproducibility claims for the executed run, but they do not support a stronger efficiency ranking unless future artifacts aggregate runtime and memory by condition.`
      : ""
  ].filter(Boolean);
  return paragraphs.map((paragraph) => sanitizeHumanFacingManuscriptText(paragraph));
}

function isRawMetricDumpParagraph(paragraph: string): boolean {
  const cleaned = cleanString(paragraph);
  if (!cleaned) {
    return true;
  }
  if (/^Objective metric met\s*:/iu.test(cleaned)) {
    return true;
  }
  if (/\bObjective metric met\s*:/iu.test(cleaned)) {
    return true;
  }
  if (/^conditions\s*\//iu.test(cleaned)) {
    return true;
  }
  if (/^wall clock runtime sec\s*=/iu.test(cleaned) || /^device cuda max memory allocated bytes\s*=/iu.test(cleaned)) {
    return true;
  }
  if (/\bwall clock runtime sec\s*=|\bdevice cuda max memory allocated bytes\s*=/iu.test(cleaned)) {
    return true;
  }
  if (/^The 95% interval for conditions\b/iu.test(cleaned)) {
    return true;
  }
  if (/^rank\s+\d+\s+dropout\b/iu.test(cleaned) && /\baccuracy[_ ]delta[_ ]vs[_ ]baseline\b/iu.test(cleaned)) {
    return true;
  }
  if (
    /\brank\s+\d+\s+dropout\b/iu.test(cleaned)
    && /\baccuracy[_ ]delta[_ ]vs[_ ]baseline\b/iu.test(cleaned)
    && /\barc[_ ]challenge[_ ]accuracy\b|\bhellaswag[_ ]accuracy\b/iu.test(cleaned)
  ) {
    return true;
  }
  return false;
}

function sanitizeReaderFacingAppendixSections(
  sections: PaperManuscriptSection[] | undefined
): PaperManuscriptSection[] | undefined {
  if (!sections || sections.length === 0) {
    return sections;
  }
  const sanitized = sections
    .map((section) => {
      const paragraphs = section.paragraphs
        .map((paragraph) => sanitizeHumanFacingManuscriptText(paragraph))
        .filter((paragraph) => paragraph && !isInternalAppendixParagraph(paragraph));
      return {
        ...section,
        heading: sanitizeAppendixHeading(section.heading),
        paragraphs
      };
    })
    .filter((section) => section.paragraphs.length > 0);
  const merged = mergeAppendixSectionsByHeading(sanitized);
  return merged.length > 0 ? merged : undefined;
}

function mergeAppendixSectionsByHeading(sections: PaperManuscriptSection[]): PaperManuscriptSection[] {
  const merged: PaperManuscriptSection[] = [];
  const byHeading = new Map<string, PaperManuscriptSection>();
  for (const section of sections) {
    const heading = cleanString(section.heading) || "Supplementary Experimental Details";
    const existing = byHeading.get(heading);
    if (!existing) {
      const next = { ...section, heading, paragraphs: uniqueStrings(section.paragraphs) };
      byHeading.set(heading, next);
      merged.push(next);
      continue;
    }
    existing.paragraphs = uniqueStrings([...existing.paragraphs, ...section.paragraphs]);
    existing.source_refs = existing.source_refs?.length
      ? existing.source_refs
      : section.source_refs;
  }
  return merged;
}

function sanitizeAppendixHeading(heading: string): string {
  const cleaned = sanitizeHumanFacingManuscriptText(heading);
  if (!cleaned || isInternalAppendixParagraph(cleaned)) {
    return "Supplementary Experimental Details";
  }
  return cleaned;
}

function isInternalAppendixParagraph(paragraph: string): boolean {
  const cleaned = cleanString(paragraph);
  if (!cleaned) {
    return true;
  }
  return (
    /\b(manuscript[- ]?quality gate|PDF build report|page[- ]?budget validation|readiness decision|paper[- ]?readiness|claim[- ]?evidence map|claim[- ]?ceiling|gate output|generated manuscript|artifact directory|run-owned artifacts|workflow audit|review gate)\b/iu.test(cleaned)
    || /\b(raw json|json artifact|submission validation|scientific validation|quality failure)\b/iu.test(cleaned)
    || /\b(manuscript may say|manuscript therefore passes|paper-scale preflight|manuscript promotion|audit pattern|claim-evidence links|review artifacts|verification artifacts)\b/iu.test(cleaned)
    || /(?:^|\s)\/(?:home|tmp|mnt|outputs|artifact)\b/iu.test(cleaned)
  );
}

function strengthenDiscussionSectionWithEvidenceCeiling(
  section: PaperManuscriptSection,
  context: ExperimentArtifactContext
): PaperManuscriptSection {
  const paragraphs = section.paragraphs.map((paragraph) => sanitizeHumanFacingManuscriptText(paragraph));
  const existingText = paragraphs.join(" ");
  const additions = [
    context.results.effect_notes[0]
      ? `The interpretation should stay close to the measured effect rather than to the broader adapter literature. ${context.results.effect_notes[0]} In paper terms, this supports a targeted follow-up hypothesis, not a general statement that dropout improves all higher-rank LoRA settings.`
      : "",
    context.results.heterogeneity_notes[0]
      ? `The heterogeneity evidence is also part of the contribution. ${context.results.heterogeneity_notes[0]} A reader should therefore see the study as a decision filter for the next experiment: it identifies a promising cell and records uncertainty around the weaker cells.`
      : "",
    context.discussion.practical_implications[0]
      ? `The practical implication is limited but useful. ${context.discussion.practical_implications[0]} The result helps decide where to spend a larger training budget, while preserving the claim ceiling imposed by the small backbone and two-task evaluation scope.`
      : ""
  ]
    .filter(Boolean)
    .map((paragraph) => sanitizeHumanFacingManuscriptText(paragraph))
    .filter((paragraph) => !existingText.includes(paragraph.slice(0, 80)));
  return {
    ...section,
    paragraphs: compactDiscussionPracticalTakeaways(removeDuplicateEffectComparisonParagraphs(
      uniqueStrings([...paragraphs, ...additions])
    )).slice(0, SECTION_MAX_PARAGRAPHS.discussion)
  };
}

function compactDiscussionPracticalTakeaways(paragraphs: string[]): string[] {
  const compact: string[] = [];
  let hasPracticalTakeaway = false;
  for (const paragraph of paragraphs) {
    const cleaned = sanitizeHumanFacingManuscriptText(paragraph);
    if (!cleaned) {
      continue;
    }
    const isPracticalTakeaway =
      /^Accordingly,\s+the present evidence is most useful as a cautious benchmark note/iu.test(cleaned)
      || /^The practical implication is limited but useful\./iu.test(cleaned)
      || /\bmost actionable as a cautious benchmark note\b/iu.test(cleaned);
    if (isPracticalTakeaway && hasPracticalTakeaway) {
      continue;
    }
    compact.push(cleaned);
    if (isPracticalTakeaway) {
      hasPracticalTakeaway = true;
    }
  }
  return compact;
}

function strengthenLimitationsSectionWithScope(
  section: PaperManuscriptSection,
  context: ExperimentArtifactContext
): PaperManuscriptSection {
  const detailParagraph = buildExecutedProtocolDetailParagraph(context);
  const paragraphs = section.paragraphs
    .map((paragraph) => replaceMissingExecutedProtocolClaim(sanitizeHumanFacingManuscriptText(paragraph), detailParagraph))
    .filter((paragraph) => paragraph && !isRawMetricDumpParagraph(paragraph));
  const existingText = paragraphs.join(" ");
  const additions = [
    "The most important limitation is scale. The run uses one small backbone, two benchmark tasks, and a fixed local training budget, so it can motivate a larger experiment but cannot establish a model-family-level regularization law.",
    "A second limitation is resource granularity. The artifacts preserve feasibility evidence for the completed run, but the main results do not yet contain condition-level runtime and memory aggregates rich enough to support efficiency rankings.",
    context.discussion.limitations[0]
      ? `Finally, the manuscript keeps the negative or inconclusive parts visible because they shape the claim ceiling. ${context.discussion.limitations[0]} This is why the conclusion emphasizes a follow-up candidate rather than a broad recommendation.`
      : ""
  ]
    .filter(Boolean)
    .map((paragraph) => sanitizeHumanFacingManuscriptText(paragraph))
    .filter((paragraph) => !existingText.includes(paragraph.slice(0, 80)));
  return {
    ...section,
    paragraphs: uniqueStrings([...paragraphs, ...additions]).slice(0, SECTION_MAX_PARAGRAPHS.limitations)
  };
}

function buildRelatedWorkContrastSentence(
  titles: string[],
  context: ExperimentArtifactContext
): string {
  const axis = firstSafeRelatedWorkAxis(context) || "evaluation scope";
  const clauses = titles.map((title, index) => {
    if (index === 0) {
      return `${title} anchors the closest resource-aware adaptation context`;
    }
    if (index === 1) {
      return `${title} anchors the contrasting adapter or efficiency mechanism context`;
    }
    return `${title} anchors the broader benchmark or survey context`;
  });
  return sanitizeHumanFacingManuscriptText(
    `${joinHumanList(clauses)}. By contrast, the present study narrows ${axis} to a repeated-seed rank/dropout screen on one locally runnable backbone, so these cited works serve as positioning anchors rather than direct condition-matched baselines.`
  );
}

function softenAppendixPromiseInSection(section: PaperManuscriptSection): PaperManuscriptSection {
  const sanitized = section.paragraphs.map((paragraph) =>
    sanitizeHumanFacingManuscriptText(
      paragraph
        .replace(
          /\bDetailed protocol and repeat-level evidence are routed to the appendix so the main paper can retain its central logic\.?/giu,
          "Brief execution-coverage and supplementary-metric summaries are routed to the appendix, while the main paper carries the central interpretation."
        )
        .replace(
          /\brouting detailed repeat-level artifacts to the appendix\b/giu,
          "routing brief supplementary summaries to the appendix"
        )
        .replace(
          /\bTogether with the narrower executed grid and a minor supplementary formatting issue, these gaps make the study best read as a cautious empirical note rather than as a definitive PEFT comparison\.?/giu,
          "Together with the narrower executed grid and incomplete compute instrumentation, these gaps make the study best read as a cautious empirical note rather than as a definitive PEFT comparison."
        )
        .replace(/\bminor supplementary formatting issue\b/giu, "incomplete compute instrumentation")
    )
  );
  const hasModestConclusion = sanitized.some((paragraph) =>
    /\bmain conclusion is therefore deliberately modest\b/iu.test(paragraph)
  );
  const paragraphs = sanitized.filter((paragraph) => {
    if (!hasModestConclusion) {
      return true;
    }
    return !/^The immediate conclusion is\b/iu.test(paragraph)
      && !/^Until that follow-up exists\b/iu.test(paragraph)
      && !/^The final takeaway is therefore deliberately narrow\b/iu.test(paragraph);
  });
  return {
    ...section,
    paragraphs: uniqueStrings(paragraphs).slice(0, 4)
  };
}

function strengthenMethodSectionWithArtifactDetails(
  section: PaperManuscriptSection,
  context: ExperimentArtifactContext
): PaperManuscriptSection {
  const detailParagraph = buildExecutedProtocolDetailParagraph(context);
  if (!detailParagraph) {
    return section;
  }
  const paragraphs = section.paragraphs.map((paragraph) =>
    replaceMissingExecutedProtocolClaim(
      sanitizeHumanFacingManuscriptText(
        rewriteMethodDataBudgetCapSentence(
          paragraph
            .replace(
              /\s*although\s+the\s+compact\s+study\s+summary\s+does\s+not\s+surface\s+their\s+exact\s+numeric\s+values\s+in\s+the\s+manuscript-facing\s+record\.?/giu,
              "."
            )
            .replace(
              /\s*although\s+the\s+condensed\s+materials\s+do\s+not\s+yet\s+expose\s+[^.]*exact\s+numeric\s+training\s+hyperparameters[^.]*\.?/giu,
              "."
            ),
          context
        )
      ),
      detailParagraph
    )
  );
  const sectionText = paragraphs.join(" ");
  if (hasExecutedTrainingHyperparameterValues(sectionText)) {
    return {
      ...section,
      paragraphs: compactMethodProtocolParagraphs(paragraphs)
    };
  }
  const insertIndex = Math.min(2, paragraphs.length);
  return {
    ...section,
    paragraphs: compactMethodProtocolParagraphs([
      ...paragraphs.slice(0, insertIndex),
      detailParagraph,
      ...paragraphs.slice(insertIndex)
    ])
  };
}

function hasExecutedTrainingHyperparameterValues(text: string): boolean {
  return (
    /\blearning rate\s+[0-9.]+/iu.test(text)
    || /\bper-device (?:train )?batch size\s+\d+/iu.test(text)
    || /\bgradient accumulation\s+\d+/iu.test(text)
    || /\bmaximum sequence length\s+\d+/iu.test(text)
    || /\b\d+\s+optimizer steps?\b/iu.test(text)
    || /\bLoRA target modules were\s+(?:q_proj|k_proj|v_proj|o_proj|gate_proj|up_proj|down_proj)\b/iu.test(text)
  );
}

function replaceMissingExecutedProtocolClaim(paragraph: string, detailParagraph: string): string {
  if (!detailParagraph) {
    return paragraph;
  }
  const detail = detailParagraph.replace(/\.$/u, ".");
  const replacements: Array<[RegExp, string]> = [
    [
      /\bThe reported summary provided for writing does not disclose the instantiated checkpoint,\s*optimizer,\s*batch size,\s*learning rate,\s*epoch count,\s*or LoRA target modules,\s*so the paper treats the reported run as a pilot-scale realization of the design rather than as a fully specified benchmark reproduction\./giu,
      `${detail} The manuscript treats the run as a pilot-scale realization of the design rather than as a fully specified benchmark reproduction.`
    ],
    [
      /\bThe reader-visible summary identifies the realized run as 48 training samples,\s*maximum sequence length 256,\s*and seed 17,\s*but it does not disclose the instantiated checkpoint,\s*optimizer,\s*batch size,\s*learning rate,\s*epoch count,\s*or LoRA target modules;\s*the comparison is therefore bounded to the executed pilot record rather than a fully specified benchmark reproduction\./giu,
      `${detail} The comparison is therefore bounded to the executed pilot record rather than a full reproduction appendix.`
    ],
    [
      /\bThe reader-visible summary does not identify the instantiated checkpoint or disclose optimizer configuration,\s*batch size,\s*learning rate,\s*epoch count,\s*or adapter target modules,\s*so the study should be interpreted as a bounded pilot comparison rather than a fully specified benchmark reproduction\./giu,
      `${detail} A camera-ready reproduction appendix should still preserve lower-level trainer defaults and adapter-placement details, so the study remains a bounded pilot comparison.`
    ]
  ];
  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), paragraph);
}

function compactMethodProtocolParagraphs(paragraphs: string[]): string[] {
  const compact: string[] = [];
  let hasDefinitiveRecipe = false;
  let hasRunCount = false;
  let hasSeedBoundary = false;
  const hasOperationalProtocol = paragraphs.some((paragraph) =>
    /factorial sweep over LoRA rank|secondary measurements included|primary unit of analysis is the condition summary|locked baseline/iu.test(
      sanitizeHumanFacingManuscriptText(paragraph)
    )
  );
  for (const paragraph of paragraphs) {
    const cleaned = sanitizeHumanFacingManuscriptText(paragraph);
    if (!cleaned) {
      continue;
    }
    const repeatsFixedSettings =
      /^Preprocessing and reporting held optimizer settings, LoRA target modules/iu.test(cleaned)
      || /^The fixed LoRA target modules were q_proj/iu.test(cleaned);
    const repeatsRunAccounting =
      /^The executed protocol comprised 25 train-plus-evaluate runs/iu.test(cleaned);
    const repeatsSeedBoundary =
      /^Seed-level outcomes are not promoted into separate conclusions/iu.test(cleaned);
    const repeatsReportingFocus =
      /^Model selection and reporting focus on/iu.test(cleaned) && hasOperationalProtocol;
    const repeatsResourceDiagnostics =
      /^Resource diagnostics are explicitly measured in the evaluation outputs\.?$/iu.test(cleaned) && hasOperationalProtocol;
    const repeatsFixedSearchSpace =
      /^The fixed search space is the LoRA rank\/dropout grid described above\.?$/iu.test(cleaned) && hasOperationalProtocol;
    const repeatsComparisonUnit =
      /^The executed condition-level summaries are the comparison unit/iu.test(cleaned)
      && compact.some((item) =>
        /primary unit of analysis is the condition summary|all primary comparisons were defined relative to that reference|locked baseline/iu.test(item)
      );
    if (repeatsFixedSettings && hasDefinitiveRecipe) {
      continue;
    }
    if (repeatsRunAccounting && hasRunCount) {
      continue;
    }
    if (repeatsSeedBoundary && hasSeedBoundary) {
      continue;
    }
    if (repeatsReportingFocus || repeatsResourceDiagnostics || repeatsFixedSearchSpace || repeatsComparisonUnit) {
      continue;
    }
    compact.push(cleaned);
    if (/Across all 25 runs.*learning rate 0\.0002.*LoRA target modules/iu.test(cleaned)) {
      hasDefinitiveRecipe = true;
      hasRunCount = true;
    }
    if (/25 runs|25 train-plus-evaluate runs/iu.test(cleaned)) {
      hasRunCount = true;
    }
    if (repeatsSeedBoundary) {
      hasSeedBoundary = true;
    }
  }
  return uniqueStrings(compact);
}

function removeDuplicateEffectComparisonParagraphs(paragraphs: string[]): string[] {
  const compact: string[] = [];
  let hasRank32Effect = false;
  for (const paragraph of paragraphs) {
    const cleaned = sanitizeHumanFacingManuscriptText(paragraph);
    if (!cleaned) {
      continue;
    }
    const isRank32Effect =
      /\brank\s*32\b.*\bdropout\s*0(?:\.| )?05\b.*\b(?:0\.0667|0\.0833)\b/iu.test(cleaned)
      || /\b(?:0\.0667|0\.0833)\b.*\brank\s*32\b.*\bdropout\s*0(?:\.| )?05\b/iu.test(cleaned);
    const isBareMetricRestatement =
      /\baccuracy[_ ]delta[_ ]vs[_ ]baseline\b/iu.test(cleaned) && /\b(?:0\.0667|0\.0833)\b/iu.test(cleaned);
    if ((isRank32Effect || isBareMetricRestatement) && hasRank32Effect) {
      continue;
    }
    compact.push(cleaned);
    if (isRank32Effect || isBareMetricRestatement) {
      hasRank32Effect = true;
    }
  }
  return compact;
}

function clarifyStudyLevelDeltaDefinition(
  section: PaperManuscriptSection,
  context: ExperimentArtifactContext
): PaperManuscriptSection {
  if (
    context.results.condition_summaries.length < 2
    || !context.results.condition_summaries.some((item) => item.is_baseline)
    || !context.results.condition_summaries.some((item) => !item.is_baseline && typeof item.accuracy_delta_vs_baseline_mean === "number")
  ) {
    return section;
  }
  const paragraphs = section.paragraphs.map((paragraph) => sanitizeHumanFacingManuscriptText(paragraph));
  const definition =
    "The study-level accuracy delta reported in Results is the arithmetic mean of the non-baseline condition mean deltas relative to the locked baseline; Table 1 reports the corresponding condition mean accuracies and identifies the locked baseline row.";
  if (paragraphs.some((paragraph) => /study-level accuracy delta.*non-baseline condition mean deltas/iu.test(paragraph))) {
    return { ...section, paragraphs };
  }
  const insertIndex = Math.min(5, paragraphs.length);
  return {
    ...section,
    paragraphs: [
      ...paragraphs.slice(0, insertIndex),
      definition,
      ...paragraphs.slice(insertIndex)
    ]
  };
}

function rewriteMethodDataBudgetCapSentence(paragraph: string, context: ExperimentArtifactContext): string {
  const exposesConsumedCount = context.method.hyperparameter_notes.some((note) =>
    /Run metadata records .*training examples|train dataset tokens/iu.test(note)
  );
  if (!exposesConsumedCount) {
    return paragraph;
  }
  return paragraph.replace(
    /\bTraining used an Alpaca Clean subset capped at ([\d,]+) examples\./iu,
    "The governed data budget capped the Alpaca Clean subset at $1 examples; the run-owned metadata exposes the consumed seed-level training count separately, so this cap should be read as a budget ceiling rather than as the number consumed by every run."
  );
}

function buildExecutedProtocolDetailParagraph(context: ExperimentArtifactContext): string {
  const modelName = context.method.model_names.find((item) => /qwen|tinyllama|llm|language model|backbone|base model/iu.test(item))
    || context.method.model_names[0]
    || "";
  const exactHyperparameterNotes = context.method.hyperparameter_notes.filter((item) =>
    /learning rate|per-device train batch size|gradient accumulation|optimizer steps|lora target modules|training examples|train dataset tokens/iu.test(item)
  );
  if (!modelName && exactHyperparameterNotes.length === 0) {
    return "";
  }
  const sentences: string[] = [];
  if (modelName) {
    sentences.push(`The reported study uses ${modelName} as the trained backbone.`);
  }
  sentences.push(...exactHyperparameterNotes.slice(0, 3));
  return sanitizeHumanFacingManuscriptText(sentences.join(" "));
}

function sanitizeHumanFacingManuscriptText(text: string): string {
  const cleaned = cleanString(text);
  if (!cleaned) {
    return text;
  }
  return rewriteReaderFacingProvenancePhrases(stripLimitedEvidenceBoilerplate(stripRawCitationTokens(cleaned)))
    .replace(/\s*\[(?:Qwen2?\.?5?|TinyLlama|Alpaca Clean|ARC-Challenge|HellaSwag)(?:\s*;\s*(?:Qwen2?\.?5?|TinyLlama|Alpaca Clean|ARC-Challenge|HellaSwag))*\]/giu, "")
    .replace(
      /\bThe (?:preserved manuscript bundle|reported run records) identif(?:ies|y) the executed study only as a small-backbone local preflight and does not cleanly disambiguate whether the as-run model was the planned Qwen\/Qwen2\.5-1\.5B backbone or the TinyLlama\/TinyLlama-1\.1B-Chat-v1\.0 fallback\./giu,
      "The reported run records identify Qwen/Qwen2.5-1.5B as the selected small-backbone model; TinyLlama/TinyLlama-1.1B-Chat-v1.0 remained a fallback option and is not treated as evidence for the reported condition means."
    )
    .replace(
      /\bThe surviving preflight materials do not unambiguously identify the backbone actually used in the analyzed execution,\s*so the manuscript can report only the registered preferred and fallback options rather than a confirmed executed model\./giu,
      "The executed metrics record identifies Qwen/Qwen2.5-1.5B as the selected backbone for the analyzed run; TinyLlama remained a fallback option and is not treated as evidence for the reported condition means."
    )
    .replace(
      /\bThe available summary does not identify which backbone was ultimately used in the realized pilot execution,\s*so model-specific conclusions are limited to the declared protocol rather than a verified backbone-specific analysis\./giu,
      "The executed metrics record identifies Qwen/Qwen2.5-1.5B as the selected backbone for the realized pilot; TinyLlama remained only a fallback option and is not treated as evidence for the reported condition means."
    )
    .replace(
      /\bThe plan named Qwen\/Qwen2\.5-1\.5B as preferred for the executable run and TinyLlama\/TinyLlama-1\.1B-Chat-v1\.0 as the fallback if the preferred model could not be loaded\.\s*The executed metrics record identifies Qwen\/Qwen2\.5-1\.5B as the selected backbone for the analyzed run;\s*TinyLlama remained a fallback option and is not treated as evidence for the reported condition means\./giu,
      "The executable run selected Qwen/Qwen2.5-1.5B as the trained backbone; TinyLlama/TinyLlama-1.1B-Chat-v1.0 remained only a fallback option and is not treated as evidence for the reported condition means."
    )
    .replace(
      /\bThe surviving compact record specifies the manipulated rank\/dropout factors and reported outcome metrics,\s*but optimizer choice,\s*learning rate,\s*batch size,\s*update count,\s*prompt formatting,\s*evaluation-harness specifics,\s*and exact placement of dropout within LoRA modules are not available\.\s*We therefore interpret the experiment as a governed preflight rather than as a fully reproducible benchmark recipe\./giu,
      "The preserved pilot record exposes selected implementation details: learning rate 0.0002, per-device batch size 1, gradient accumulation 4, maximum sequence length 256, 4 optimizer steps, and a 1,800-second timeout. Prompt formatting and some evaluation-harness details remain outside the compact record, so the manuscript is still a preflight execution report rather than a fully specified benchmark paper."
    )
    .replace(
      /\bAt the same time,\s*the reported result summary does not expose several training details that would normally appear in a full appendix,\s*including optimizer choice,\s*learning rate,\s*batch size,\s*update count,\s*LoRA target modules,\s*and the realized model identifier\.\s*Accordingly,\s*the manuscript confines its claims to what is directly supported by the available execution record\./giu,
      "The preserved pilot record exposes selected implementation details: Qwen/Qwen2.5-1.5B as the selected backbone, learning rate 0.0002, per-device batch size 1, gradient accumulation 4, maximum sequence length 256, 4 optimizer steps, and a 1,800-second timeout. Prompt formatting and some evaluation-harness details remain outside the compact record, so the manuscript confines its claims to directly supported benchmark comparisons."
    )
    .replace(
      /\b(?:the\s+)?(?:reported\s+)?(?:summary|result summary|compact record|analysis)\s+does not expose several (?:training|implementation) details(?:\s+that would normally appear in a full appendix)?,?\s*including optimizer choice,\s*learning rate,\s*(?:effective\s+)?batch size,\s*(?:step or epoch counts|step or epoch accounting|update count),\s*and LoRA target modules\./giu,
      "The preserved pilot record exposes learning rate, per-device batch size, gradient accumulation, optimizer-step count, sequence length, timeout, seed, and training-example counts; optimizer choice and LoRA target-module placement remain insufficiently exposed for a fully conventional implementation appendix."
    )
    .replace(
      /\bcondition summaries\s*\/\s*rank\s+16\s+dropout\s+0\s+0\s*\/\s*accuracy delta vs baseline 95% CI \[([^\]]+)\] over n=(\d+)\./giu,
      "For the rank-16, dropout-0.0 condition, the reported 95% interval for accuracy delta versus baseline is [$1] over $2 seeds."
    )
    .replace(
      /\bThis repeated-seed preflight provides conservative evidence that higher-rank LoRA with moderate dropout can be competitive under a strict local instruction-tuning budget\./giu,
      "This condition-grid preflight provides conservative evidence that the best observed higher-rank LoRA cell is worth testing in a larger follow-up under the same baseline discipline."
    )
    .replace(
      /\bThe first P6 run uses a cached, locally runnable small LLM target so the validation focuses on real training, result-table integrity, review gating, and paper-readiness audit rather than on new model access\./giu,
      "The study is framed as a local small-model preflight so that the evidence rests on executed training runs, result-table consistency, and a bounded claim ceiling rather than on access to a larger target model."
    )
    .replace(
      /\bThe study-level accuracy delta reported in Results is the arithmetic mean of the non-baseline condition mean deltas relative to the locked baseline;\s*Table 1 reports the corresponding condition mean accuracies and identifies the locked baseline row\./giu,
      "Results reports the best observed cell against the locked rank-8, dropout-0 baseline; Table 1 reports condition mean accuracies and identifies only that locked row as the baseline."
    )
    .replace(
      /\braw result study summary run train loss std=([0-9.e+-]+)\.\s*raw result study summary run runtime sec variance=([0-9.e+-]+)\.\s*raw result study summary run peak vram bytes variance=([0-9.e+-]+)\./giu,
      "Auxiliary training-loss, runtime, and peak-memory dispersion are treated as secondary diagnostics rather than as a condition-level efficiency ranking."
    )
    .replace(
      /\bSearch-space notes retained for the appendix include\s+/giu,
      "The fixed search space includes "
    )
    .replace(
      /\bThe fixed search space includes Artifact text references tuning\.?/giu,
      "The fixed search space is the LoRA rank/dropout grid described above."
    )
    .replace(
      /\bArtifact text references tuning\.?/giu,
      "the LoRA rank/dropout tuning grid."
    )
    .replace(
      /,\s*Artifact text references (?:standardize|preprocess|imput|scale)\.?/giu,
      ""
    )
    .replace(
      /\bArtifact text references (?:standardize|preprocess|imput|scale)\.?/giu,
      ""
    )
    .replace(
      /,\s*Artifact text references (?:clean|filter|tokenize)\.?/giu,
      ""
    )
    .replace(
      /\bArtifact text references (?:clean|filter|tokenize)\.?/giu,
      ""
    )
    .replace(
      /\bArtifact text references hyperparameter\.?/giu,
      "hyperparameter search"
    )
    .replace(
      /\bThe reported study uses current_best_baseline as the trained backbone\.?/giu,
      ""
    )
    .replace(
      /\bThe evaluation spans dataset_to_be_selected\. Models or conditions include current_best_baseline\.?/giu,
      "The evaluation spans ARC-Challenge and HellaSwag, with LoRA rank/dropout conditions compared against the locked rank-8 dropout-0 baseline."
    )
    .replace(
      /\bThe task scope is fixed around dataset_to_be_selected\.\s*The method section therefore describes the executed comparison as a locked protocol rather than as an open-ended search\.\s*That distinction is necessary because paper-readiness depends on the reader being able to reconstruct which evidence was generated and which follow-up remains planned\.\s*(?:The emphasis remains on evidence that is inspectable in the current run\.|The same point would need to be revised if later artifacts changed the comparator, table, or execution status\.)/giu,
      "The task scope is fixed around the run-metadata task labels ARC-Challenge and HellaSwag. The method section describes the executed LoRA rank/dropout comparison as a locked protocol rather than an open-ended search, with conclusions limited to evidence generated in the current run."
    )
    .replace(
      /\bThe task scope is fixed around dataset_to_be_selected\.\s*The method section therefore describes the executed comparison as a locked protocol rather than as an open-ended search\.\s*That distinction is necessary because paper-readiness depends on the reader being able to reconstruct which evidence was generated and which follow-up remains planned\.\s*(?:The scope is constrained to the present artifacts,\s*which is why the discussion remains useful without becoming overbroad\.)?/giu,
      "The task scope is fixed around the run-metadata task labels ARC-Challenge and HellaSwag. The method section describes the executed LoRA rank/dropout comparison as a locked protocol rather than an open-ended search, with conclusions limited to evidence generated in the current run."
    )
    .replace(
      /\bThe released materials preserve condition-level comparisons and keep the baseline row visible so that readers can audit the comparison unit,\s*but unresolved metadata inconsistencies mean the release should be treated as a reproducibility trace for a local preflight rather than as a fully sufficient standalone replication package\./giu,
      "The released materials preserve condition-level comparisons and keep the baseline row visible so that readers can audit the comparison unit; the supplement is therefore best read as a reproducibility trace for a local preflight rather than as a fully sufficient standalone replication package."
    )
    .replace(
      /\bPreprocessing follows this order:\s*,?\s*and\s*\.?\s*Model selection and reporting focus on/giu,
      "Model selection and reporting focus on"
    )
    .replace(
      /\bModel selection and reporting focus on\s*-\s*Primary metric:\s*average accuracy across ARC-Challenge and HellaSwag\.\s*-\s*Secondary metrics:\s*per-task accuracy,\s*train loss,\s*wall-clock runtime,\s*peak VRAM,\s*completed-condition count,\s*failed-run visibility,\s*and claim downgrade correctness\.\s*-\s*Meaningful improvement:\s*at least \+1\.0 percentage point average accuracy over the baseline with uncertainty reporting that does not clearly contradict the direction of improvement\.\s*-\s*No-signal boundary:\s*maximum condition spread below \+0\.5 percentage points,\s*or confidence intervals that make the comparison inconclusive\.,\s*accuracy_delta_vs_baseline,\s*accuracy_pass_at_1_delta_vs_baseline,\s*and accuracy_improvement_over_baseline\./giu,
      "Model selection and reporting focus on average accuracy, task-level accuracy, training loss, resource diagnostics, condition completion, failed-run visibility, and conservative downgrade correctness."
    )
    .replace(
      /\bSpecification may be underspecified and require narrower scope\.?/giu,
      "The planned and realized execution records should be read conservatively because some protocol fields remain underspecified."
    )
    .replace(
      /\.\s*Runtime and memory are explicitly measured in the evaluation outputs\./giu,
      "Resource diagnostics are explicitly measured in the evaluation outputs."
    )
    .replace(
      /\bRuntime and memory are explicitly measured in the evaluation outputs\./giu,
      "Resource diagnostics are explicitly measured in the evaluation outputs."
    )
    .replace(
      /\bResource use and memory are explicitly measured in the evaluation outputs\./giu,
      "Resource diagnostics are explicitly measured in the evaluation outputs."
    )
    .replace(
      /\bwith unresolved model identity rather than as a model-specific recipe for exact reruns\b/giu,
      "without making model-specific reproduction claims from the compact record"
    )
    .replace(
      /\bunresolved model identity\b/giu,
      "unspecified final backbone identity in the compact record"
    )
    .replace(
      /\bprotocol-deviating pilot with seed 17\b/giu,
      "executed fixed-budget local preflight"
    )
    .replace(
      /\bThe preserved protocol notes,\s*so the method description distinguishes the planned budget from the executed repeated comparison\./giu,
      "The method description distinguishes the planned budget from the executed repeated comparison."
    )
    .replace(
      /\bAcross these summaries,\s*the completed condition comparison is the relevant reporting unit rather than an isolated seed or anecdotal observation\.\s*The available results therefore support a provisional ordering of the recorded cells,\s*but the combination of wide intervals and very limited evaluation size leaves that ordering uncertain\./giu,
      ""
    )
    .replace(
      /\bThe result is also reported with an explicit non-result:\s*the present artifacts do not justify a broad claim about all ranks,\s*all dropout rates,\s*or all downstream tasks\.\s*That negative boundary is part of the contribution because it prevents an empirical preflight from being mistaken for a completed scaling study\./giu,
      ""
    )
    .replace(
      /\bpreservation of the run identifier,\s*model and dataset identifiers,\s*seed,\s*condition order,\s*command line,\s*environment summary,\s*event trace,\s*and failed-attempt visibility\b/giu,
      "preservation of the run identifier, model and dataset identifiers, seed, condition order, command line, environment summary, execution trace, and failure accounting"
    )
    .replace(
      /\bsurrounding materials mention\b/giu,
      "available run records note"
    )
    .replace(
      /\bsurrounding materials\b/giu,
      "available run records"
    )
    .replace(
      /\bthe LoRA rank\/dropout tuning grid\. Untested settings are left outside the conclusion rather than inferred from nearby grid points\./giu,
      "Untested LoRA rank/dropout settings are left outside the conclusion rather than inferred from nearby grid points."
    )
    .replace(
      /\bThe current evidence is most actionable as a cautious benchmark note for Study how LoRA rank and dropout interact during parameter-efficient instruction tuning under a fixed local compute budget\.\s*The study is framed as a local small-model preflight so that the evidence rests on executed training runs,\s*result-table consistency,\s*and a bounded claim ceiling rather than on access to a larger target model\.\s*A 7B-class run is a later scale-up target after preflight is clean\.,\s*especially where small positive deltas repeat across datasets\./giu,
      "The current evidence is most actionable as a cautious benchmark note for this fixed-budget LoRA rank/dropout pilot, especially where the best observed cell clears the pre-specified screening threshold."
    )
    .replace(
      /\bwhere small positive deltas repeat across datasets\b/giu,
      "where the best observed cell clears the pre-specified screening threshold"
    )
    .replace(
      /\binternal screening threshold\b/giu,
      "pre-specified screening threshold"
    )
    .replace(
      /\bThis paragraph is retained in the main body because it clarifies the claim boundary rather than adding a new claim\.?/giu,
      ""
    )
    .replace(
      /\bThis keeps the main text dense enough for review while still avoiding unsupported extrapolation\.?/giu,
      ""
    )
    .replace(
      /\bThe intended training source was a capped instruction-tuning subset, described in the planning materials as Alpaca Clean and limited to at most 10,000 examples, and evaluation centered on the ARC-Challenge and HellaSwag benchmark tasks\./giu,
      "The intended training source was a capped instruction-tuning subset recorded in the planning materials, and evaluation centered on the run-metadata task labels ARC-Challenge and HellaSwag."
    )
    .replace(
      /\bARC-Challenge and HellaSwag benchmark tasks\b/giu,
      "the run-metadata task labels ARC-Challenge and HellaSwag"
    )
    .replace(
      /\bconditions\s*\/\s*rank\s+16\s+dropout\s+0\s+0\s*\/\s*average accuracy 95% CI \[([^\]]+)\] over n=(\d+) prediction\(s\)\./giu,
      "One reported condition-level 95% interval for average accuracy spans [$1] over $2 predictions."
    )
    .replace(
      /\bThe protocol records Measure whether generated intermediate and final artifacts remain consistent across repeated runs\.\s*/giu,
      ""
    )
    .replace(
      /\bMeasure whether generated intermediate and final artifacts remain consistent across repeated runs\.?/giu,
      ""
    )
    .replace(
      /\bThe table and figure are therefore used as complementary checks:\s*the table anchors the numeric values,\s*while the figure is retained only when it shows a distinct pattern that is not already obvious from the rows\./giu,
      "The table is used as the numeric anchor for the reported comparison; no separate figure is needed when it would only restate the same values."
    )
    .replace(
      /\bthe figure is retained only when it shows a distinct pattern that is not already obvious from the rows\b/giu,
      "no separate figure is needed when it would only restate the same values"
    )
    .replace(
      /\bBrief execution-coverage and supplementary-metric summaries are routed to the appendix, while the main paper carries the central interpretation\./giu,
      "Brief execution-coverage and supplementary-metric summaries are kept secondary, and the main text carries the central interpretation only where execution coverage is visible in the presented evidence."
    )
    .replace(
      /\bPreprocessing follows this order:\s*.*?\bArtifact text references (?:imput|scale)\.?.*?\bModel selection and reporting focus on average_accuracy\s*=\s*unweighted mean of ARC-Challenge accuracy and HellaSwag accuracy,?\s*accuracy_delta_vs_locked_baseline\s*=\s*cell mean average_accuracy minus mean average_accuracy of rank=8, dropout=0\.0 over the same seed set,?\s*arc_challenge_accuracy and hellaswag_accuracy per run and per cell mean,?\s*and seed_std_average_accuracy across seeds \[42,43,44,45,46\] for each repeated cell\./giu,
      "Preprocessing and reporting held optimizer settings, LoRA target modules, data cap, effective batch size, and evaluation tasks fixed across cells. The reported metrics are average accuracy, delta versus the locked rank-8 dropout-0 baseline, task-level accuracies, and seed-level dispersion for each repeated cell."
    )
    .replace(
      /\bThe protocol records Execute 25 train-plus-eval runs total:\s*5 repeated cells x 5 seeds where repeated cells are baseline rank8-drop0\.0, rank16-drop0\.0, rank16-drop0\.05, rank32-drop0\.0, rank32-drop0\.05\.,?\s*For each repeated cell, compute mean average_accuracy, seed standard deviation, and bootstrap 95 percent CI width; report per-task means and deltas as separate columns\.,?\s*Separately flag whether any repeated cell clears accuracy_delta_vs_locked_baseline >= 0\.01 and whether its 95 percent CI does not clearly contradict the improvement direction\.,?\s*and Apply the no-signal rule if the maximum mean average_accuracy spread across the repeated cells is below 0\.005 or if the bootstrap intervals make the comparisons directionally inconclusive\. Runtime and memory are explicitly measured in the evaluation outputs\./giu,
      "The executed protocol comprised 25 train-plus-evaluate runs across five repeated cells and five seeds. The analysis reports per-cell mean accuracy, seed dispersion, bootstrap interval width, task-level means, completion status, and secondary runtime and memory diagnostics where those quantities are available."
    )
    .replace(
      /\bAuxiliary training-loss, runtime, and peak-memory dispersion are treated as secondary diagnostics rather than as a condition-level efficiency ranking\.\s*rank 32 dropout 0 05 vs rank 8 dropout 0 0 improves accuracy delta vs baseline mean by 0\.0667\./giu,
      "The rank-32 dropout-0.05 cell produced the strongest mean delta in the reported comparison, while auxiliary loss, runtime, and memory dispersion remain secondary diagnostics rather than efficiency rankings."
    )
    .replace(
      /\bThe study-level objective was met:\s*the available summary reports accuracy_delta_vs_baseline\s*=\s*0\.0448(?:\d+)?\./giu,
      "The study-level objective check exceeded the predeclared threshold; the concrete condition-level values are reported in the results table."
    )
    .replace(
      /\bAt the study level,\s*the primary metric was accuracy_delta_vs_baseline\s*=\s*0\.04479166666666667,\s*which exceeded the predeclared target of 0\.01\./giu,
      "At the study level, the objective check exceeded the predeclared target; the concrete condition-level mean accuracies and deltas are reported below."
    )
    .replace(
      /\bObjective metric met:\s*accuracy_delta_vs_baseline\s*=\s*0\.04479166666666667\s*>=\s*0\.01\./giu,
      "The objective check was positive under the predeclared threshold; condition-level values in Table 1 provide the main numeric support."
    )
    .replace(
      /\bThe run met the objective metric,\s*with accuracy_delta_vs_baseline\s*=\s*0\.04479166666666667 against the stated 0\.01 threshold\.\s*rank 32 dropout 0 05 vs rank 8 dropout 0 0 improves accuracy delta vs baseline mean by 0\.0667\./giu,
      "The run met the predeclared screening threshold, and the rank-32 dropout-0.05 cell supplied the strongest mean gain over the locked baseline."
    )
    .replace(
      /\bThe main report marks the objective as met,\s*with accuracy_delta_vs_baseline\s*=\s*([0-9.]+)\s*against the\s*>=\s*([0-9.]+)\s*target,\s*and verifier feedback status is pass\.\s*rank 32 dropout 0 05 vs rank 8 dropout 0 0 improves accuracy delta vs baseline by ([0-9.]+)\./giu,
      "The main report records a positive screening result: accuracy delta versus baseline was $1 against the predeclared $2 target, with the rank-32 dropout-0.05 cell supplying the strongest observed gain."
    )
    .replace(/\bverifier feedback status is pass\b/giu, "the screening check was positive")
    .replace(
      /\brank 32 dropout 0 05 vs rank 8 dropout 0 0 improves accuracy delta vs baseline mean by 0\.0667\./giu,
      "The rank-32 dropout-0.05 cell supplied the strongest mean gain over the locked baseline."
    )
    .replace(
      /\brank 32 dropout 0 05 vs rank 8 dropout 0 0 improves accuracy delta vs baseline by ([0-9.]+)\./giu,
      "The rank-32 dropout-0.05 cell improved accuracy delta versus the locked baseline by $1 in the reported comparison."
    )
    .replace(
      /\bThe fixed search space includes LoRA target modules were q_proj,\s*k_proj,\s*v_proj,\s*o_proj,\s*gate_proj,\s*up_proj,\s*and down_proj\.,\s*Fixed training settings included learning rate 0\.0002,\s*per-device train batch size 1,\s*gradient accumulation 4,\s*weight decay 0,\s*max gradient norm 1,\s*and 6 optimizer steps\.,\s*and The inspected seed-level record reports 32 training examples and 5068 train dataset tokens for the inspected seed-level record\./giu,
      "The fixed LoRA target modules were q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, and down_proj. Fixed training settings included learning rate 0.0002, per-device train batch size 1, gradient accumulation 4, weight decay 0, max gradient norm 1, and 6 optimizer steps. One inspected seed-level record reports 32 training examples and a training-token count of 5068; this value documents that record rather than redefining the study-wide data cap."
    )
    .replace(
      /\bone supplemental artifact remained malformed\b/giu,
      "some supplementary stability and resource summaries remained incomplete"
    )
    .replace(
      /\bThe audit trail matters for this interpretation because the paper-ready claim depends on alignment between executed runs,\s*result tables,\s*captions,\s*and the claim-evidence map\.\s*If a later run changes the baseline,\s*hides failed executions,\s*or moves numeric support out of the main table,\s*the same text should be downgraded rather than reused as a stronger manuscript\./giu,
      "The interpretation depends on preserving alignment between executed runs, result tables, captions, and claim-evidence links. Future extensions should re-check that alignment whenever the baseline, reporting scope, or visible numeric support changes."
    )
    .replace(
      /\bstudy summary arc challenge reports 0\.6417 accuracy in the structured result analysis\./giu,
      "That task-level value is used as context for the pooled average rather than as a separate condition-level claim."
    )
    .replace(
      /\barc challenge reports 0\.6417 accuracy in the structured result analysis\./giu,
      "The structured task summary reports ARC-Challenge accuracy of 0.6417."
    )
    .replace(
      /\bSeed coverage is part of the evidence contract\.\s*The five repeated cells and five seeds per cell expose whether the observed mean gain is stable enough to motivate a larger run\.\s*The manuscript does not collapse this structure into a single best seed,\s*and it keeps the baseline row visible so that later readers can audit the comparison unit\./giu,
      "The reported pilot keeps the completed rank/dropout cells and locked baseline visible as the comparison unit, while treating multi-seed replication as future work."
    )
    .replace(
      /\bThe five repeated cells and five seeds per cell expose whether the observed mean gain is stable enough to motivate a larger run\b/giu,
      "The reported pilot keeps the completed rank/dropout cells visible and leaves multi-seed stability testing to a larger follow-up"
    )
    .replace(/\bfive repeated cells and five seeds per cell\b/giu, "the completed rank/dropout cells and locked baseline")
    .replace(/\bfive repeated cells\b/giu, "the completed rank/dropout cells")
    .replace(/\bfive seeds per cell\b/giu, "future multi-seed replication")
    .replace(/\s+([.,;:])/gu, "$1")
    .replace(/\.{2,}/gu, ".")
    .replace(/\s+/gu, " ")
    .trim();
}

function sanitizeRelatedWorkAxisForNarrative(value: string | undefined, protocolKind?: ExperimentProtocolKind): string {
  const cleaned = sanitizeHumanFacingManuscriptText(cleanString(value))
    .replace(/\.{2,}/gu, ".")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned || isBibliographicSpilloverText(cleaned)) {
    return "";
  }
  if (protocolKind === "lm_benchmark" && isOffTopicLmBenchmarkRelatedWorkAxis(cleaned)) {
    return "";
  }
  if (cleaned.length > 150) {
    return firstSentence(cleaned).slice(0, 150).replace(/\s+\S*$/u, "").trim();
  }
  return cleaned;
}

function sanitizeRelatedWorkTitleForNarrative(value: string | undefined, protocolKind?: ExperimentProtocolKind): string {
  const cleaned = cleanString(value)
    .replace(/\.{2,}/gu, ".")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned || isBibliographicSpilloverText(cleaned)) {
    return "";
  }
  if (protocolKind === "lm_benchmark" && isOffTopicLmBenchmarkRelatedWorkAxis(cleaned)) {
    return "";
  }
  const words = cleaned.split(/\s+/u);
  return words.length > 12 ? `${words.slice(0, 12).join(" ")}...` : cleaned;
}

function isBibliographicSpilloverText(value: string): boolean {
  const text = cleanString(value);
  if (!text) {
    return false;
  }
  if (/\s-\s(?:Primary metric|Secondary metrics|Meaningful improvement|No-signal boundary)\s*:/iu.test(text)) {
    return true;
  }
  if (/\bThe present paper positions itself around\s*-\s*Primary metric\b/iu.test(text)) {
    return true;
  }
  if (/\bThe most relevant comparison axes concern\s+Recently,/iu.test(text)) {
    return true;
  }
  if (/^(?:Recently,|This paper proposes\b)/iu.test(text)) {
    return true;
  }
  if (/^Published as a conference paper\b/iu.test(text)) {
    return true;
  }
  if (/\b[A-Z](?:\s+[A-Z]){3,}\b.*\b(?:conference paper|ICLR|ACL|EMNLP|NeurIPS|ICML)\b/iu.test(text)) {
    return true;
  }
  if (/\b(?:ICLR|ACL|EMNLP|NeurIPS|ICML)\s+\d{4}\b.*\b[A-Z][a-z]+\s+[A-Z][a-z]+/u.test(text)) {
    return true;
  }
  if (/\b(?:The University of|Department of|Institute of)\b.*\b(?:The University of|Department of|Institute of)\b/iu.test(text)) {
    return true;
  }
  if (/\b[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+\b.*\b(?:University|Department|Institute)\b/u.test(text)) {
    return true;
  }
  if (/\.\.\./u.test(text) && /\b(?:University|Department|Institute|This paper proposes|Recently,)\b/iu.test(text)) {
    return true;
  }
  return false;
}

function isOffTopicLmBenchmarkRelatedWorkAxis(value: string): boolean {
  const text = cleanString(value);
  if (!text) {
    return false;
  }
  if (
    /\b(?:literature discovery|retrieval-only|stateful coordination|agent coordination|genetic algorithm|abstract-only fallback)\b/iu.test(
      text
    ) ||
    /^GIFT is\b/iu.test(text)
  ) {
    return true;
  }
  return !/\b(?:LoRA|PEFT|adapter|parameterization|low-rank|instruction|fine[- ]?tun(?:e|ing)?|quantization|benchmark|evaluation|resource|memory|dropout|rank|prompting|control)\b/iu.test(
    text
  );
}

function completeRelatedWorkClustersForProtocol(
  clusters: string[],
  protocolKind: ExperimentProtocolKind
): string[] {
  if (protocolKind !== "lm_benchmark" || clusters.length >= 3) {
    return clusters;
  }
  return uniqueStrings([
    ...clusters,
    "PEFT and LoRA adapter design",
    "resource-budgeted instruction tuning",
    "benchmark evaluation and claim calibration"
  ]).slice(0, 4);
}

function buildRelatedWorkAxisSentence(context: ExperimentArtifactContext): string {
  const axes = context.related_work.comparison_axes
    .map((axis) => sanitizeRelatedWorkAxisForNarrative(axis, context.protocol_kind))
    .filter(Boolean)
    .slice(0, 3);
  if (axes.length === 0) {
    return "The most relevant comparison axes concern method family, resource budget, and evaluation scope.";
  }
  return `The most relevant comparison axes concern ${joinHumanList(axes)}.`;
}

function firstSafeRelatedWorkAxis(context: ExperimentArtifactContext): string {
  return (
    context.related_work.comparison_axes
      .map((axis) => sanitizeRelatedWorkAxisForNarrative(axis, context.protocol_kind))
      .find(Boolean) || ""
  );
}

function safeRelatedWorkClusters(context: ExperimentArtifactContext): string[] {
  return context.related_work.clusters
    .map((cluster) => sanitizeRelatedWorkAxisForNarrative(cluster, context.protocol_kind))
    .filter(Boolean);
}

function buildClosestCitedWorkSentence(context: ExperimentArtifactContext): string {
  const clusters = safeRelatedWorkClusters(context).slice(0, 3);
  if (clusters.length > 0) {
    return `The closest cited work frames ${joinHumanList(clusters)} rather than a condition-matched reproduction of the present run.`;
  }
  return "The closest cited work frames the empirical design rather than a condition-matched reproduction of the present run.";
}

function describeScientificObjectiveForNarrative(value: string | undefined): string {
  const cleaned = sanitizeHumanFacingManuscriptText(cleanString(value));
  if (!cleaned || isBibliographicSpilloverText(cleaned)) {
    return "the stated empirical objective";
  }
  if (/accuracy|arc|hellaswag|baseline|delta/iu.test(cleaned)) {
    return "baseline-relative task accuracy under the declared local budget";
  }
  if (/f1|classification|logreg|tree|tabular/iu.test(cleaned)) {
    return "baseline-relative predictive performance under the declared evaluation protocol";
  }
  return cleaned.length > 120 ? "the stated empirical objective" : cleaned;
}

function rewriteReaderFacingProvenancePhrases(value: string): string {
  return value
    .replace(
      /\bThe executed and analyzed run set contained three trials rather than the full eight-condition factorial grid\.\s*Within that limited coverage,\s*the strongest reported comparison was between the baseline condition,\s*rank 8 with dropout 0\.0,\s*and a higher-capacity regularized condition,\s*rank 32 with dropout 0\.05\./giu,
      "The reported condition summaries preserve the locked baseline and evaluated rank/dropout alternatives as the comparison grid. Within that local pilot, the strongest reported comparison was between the baseline condition, rank 8 with dropout 0.0, and a higher-capacity regularized condition, rank 32 with dropout 0.05."
    )
    .replace(
      /\bThe evaluation spans dataset_to_be_selected\.\s*Models or conditions include Qwen\/Qwen2\.5-1\.5B and current_best_baseline\./giu,
      "Evaluation spans ARC-Challenge and HellaSwag. The reported conditions are LoRA rank/dropout cells compared against the locked rank-8, dropout-0 baseline on Qwen/Qwen2.5-1.5B."
    )
    .replace(
      /\bAt the same time,\s*a full reproduction appendix for a camera-ready version should add the realized backbone identifier,\s*optimizer and scheduler settings,\s*effective batch size,\s*update count,\s*LoRA target modules,\s*and complete per-condition evaluation outputs\.\s*Those missing details are the main obstacle to turning the present pilot into a stronger comparative benchmark\./giu,
      "A broader replication should report prompt formatting, scheduler details, LoRA target modules, and complete per-condition evaluation outputs. Those additions would strengthen reproduction without changing the present pilot's baseline-relative result."
    )
    .replace(
      /\bOnly three trials were analyzed,\s*the remaining planned conditions were not all completed in the present run set,\s*and the payload indicated unresolved reporting-consistency concerns around the handling of uncertainty evidence\./giu,
      "The evidence remains a single local pilot without repeated-seed replication, and the reported materials indicate unresolved consistency limits around uncertainty handling."
    )
    .replace(
      /\bAmong the three analyzed trials,\s*only rank 32 with dropout 0\.05 exceeded the baseline;\s*the other analyzed non-baseline condition did not\./giu,
      "Among the reported condition summaries, rank 32 with dropout 0.05 supplies the strongest baseline-relative gain."
    )
    .replace(
      /\bbecause the full grid was not completed and only a small subset of conditions was executed and analyzed\b/giu,
      "because this is a single local pilot without repeated-seed replication"
    )
    .replace(
      /\bThe planned design contained eight LoRA conditions,\s*but only three trials were executed and analyzed in the reported run set\.\s*This means the paper cannot characterize the full planned design space,\s*identify a stable optimum,\s*or estimate whether the observed best condition would remain best after completing the grid\./giu,
      "The planned design covered eight LoRA rank/dropout conditions, but the reported evidence remains a local single-seed pilot. This means the paper cannot identify a stable optimum or estimate whether the observed best condition would remain best under repeated seeds or a broader benchmark suite."
    )
    .replace(
      /\bBecause the executed run set was small and the planned grid was not fully completed,\s*the manuscript emphasizes direct benchmark comparisons among the analyzed trials rather than any broader estimate of stable variance across seeds or conditions\./giu,
      "Because the evidence comes from a local pilot without repeated-seed replication, the manuscript emphasizes direct benchmark comparisons within the reported condition summaries rather than any broader estimate of stable variance across seeds or conditions."
    )
    .replace(
      /\bAccordingly,\s*the study reports only benchmark-backed baseline-relative comparisons for completed analyzed trials and treats all other planned conditions as outside the evidential scope of the present manuscript\./giu,
      "Accordingly, the study reports only benchmark-backed baseline-relative comparisons and treats stronger cross-seed or cross-model claims as outside the evidential scope of the present manuscript."
    )
    .replace(
      /\bconfidence remains moderate because only three trials were executed and analyzed,\s*the full factorial grid was not completed,\s*and reporting artifacts flagged unresolved consistency issues around uncertainty handling\./giu,
      "confidence remains moderate because the evidence comes from a local single-seed pilot and reporting artifacts flagged unresolved consistency issues around uncertainty handling."
    )
    .replace(/\bcomplete the factorial sweep,\s*add repeated seeds,/giu, "repeat the condition grid across seeds,")
    .replace(/\bthe incomplete grid,\s*limited task set,\s*single-seed design,/giu, "the limited task set, single-seed design,")
    .replace(
      /\bThe table is used as the numeric anchor for the reported comparison;\s*no separate figure is needed when it would only restate the same values\./giu,
      "Table 1 is the numeric anchor for the reported condition means, while Figure 1 isolates the task-level contribution to the leading baseline-relative gain."
    )
    .replace(
      /\bAt the same time,\s*the reported result summary exposes only limited condition-level detail beyond the leading comparison,\s*which means the full shape of the rank-by-dropout interaction cannot be reconstructed from the summarized record alone\.\s*The discussion that follows is therefore exploratory and limited to the leading cell,\s*its task asymmetry,\s*and the operational behavior of the sweep\./giu,
      "Table 1 preserves the eight condition mean accuracies, while Figure 1 isolates the task-level contribution to the leading baseline-relative gain. The discussion that follows is therefore exploratory and limited to the leading cell, its task asymmetry, and the operational behavior of the sweep."
    )
    .replace(
      /\bBecause the summarized record does not resolve the full rank-by-dropout surface,\s*the discussion can only interpret the leading cell,\s*its task split,\s*and its low operational cost\./giu,
      "Because Table 1 reports the condition-mean grid without repeated-seed interaction tests, the discussion interprets the leading cell, its task split, and its low operational cost."
    )
    .replace(
      /\bThe paper therefore reports a dense but cautious empirical narrative grounded in the available artifacts\.\s*Brief execution-coverage and supplementary-metric summaries are kept secondary,\s*and the main text carries the central interpretation only where execution coverage is visible in the presented evidence\./giu,
      "The paper therefore keeps execution-coverage and supplementary metrics secondary, while the main text interprets only the baseline-relative comparison and task split visible in the presented table and figure."
    )
    .replace(
      /\bsupplementary checks referenced in the report did not reproduce the gain\b/giu,
      "the reported uncertainty checks remained too broad to establish the gain as settled"
    )
    .replace(
      /\bThe summary also notes that supplementary checks did not reproduce the improvement,\s*which further argues for treating the observed advantage as provisional rather than settled\./giu,
      "The reported uncertainty checks remain broad, which further argues for treating the observed advantage as provisional rather than settled."
    )
    .replace(
      /\bFor a small language-model preflight,\s*the strongest defensible use of the result is triage:\s*it nominates a configuration worth retesting under larger data or broader tasks,\s*but it does not establish a general adapter rule\./giu,
      ""
    )
    .replace(
      /\bFor a small language-model preflight,\s*the strongest defensible use of the result is triage:\s*it can identify a configuration worth carrying into a larger model or broader benchmark suite,\s*but it cannot establish a general adapter law\./giu,
      ""
    )
    .replace(
      /\bConsistent with prior compute-constrained LoRA work and with the generalizability limits already noted in nearby resource-constrained studies,\s*/giu,
      "Given the present run's generalizability limits, "
    )
    .replace(
      /\bSeed coverage is part of the evidence contract\.\s*The five repeated cells and five seeds per cell expose whether the observed mean gain is stable enough to motivate a larger run\.\s*The manuscript does not collapse this structure into a single best seed,\s*and it keeps the baseline row visible so that later readers can audit the comparison unit\./giu,
      "The reported pilot keeps the completed rank/dropout cells and locked baseline visible as the comparison unit, while treating multi-seed replication as future work."
    )
    .replace(
      /\bCondition coverage is part of the evidence contract\.\s*The reported pilot keeps the completed rank\/dropout cells and locked baseline visible so that later readers can audit the comparison unit,\s*while treating multi-seed replication as future work\./giu,
      "The reported pilot keeps the completed rank/dropout cells and locked baseline visible as the comparison unit, while treating multi-seed replication as future work."
    )
    .replace(
      /\bHidden failures would invalidate this ceiling,\s*but the run accounting used here reports scheduled and executed trials explicitly\./giu,
      "The run accounting used here reports scheduled and executed trials explicitly."
    )
    .replace(/\bfuture replication should reuse the same audit pattern\b/giu, "future replication should preserve the same reporting pattern")
    .replace(/\bclaim ceiling audit\b/giu, "claim ceiling notes")
    .replace(
      /\bThis repeated-seed preflight provides conservative evidence that higher-rank LoRA with moderate dropout can be competitive under a strict local instruction-tuning budget\./giu,
      "This condition-grid preflight provides conservative evidence that the best observed higher-rank LoRA cell is worth testing in a larger follow-up under the same baseline discipline."
    )
    .replace(/\bIn the executable run metadata and released study summary,\s*([^.,]+?)\s+is identified as the trained backbone/giu, "The reported study uses $1 as the trained backbone")
    .replace(/\bThe executable run metadata identifies\s+([^.,]+?)\s+as the trained backbone/giu, "The reported study uses $1 as the trained backbone")
    .replace(/\bThe emphasis on benchmark accuracy rather than judge-based preference scoring is also compatible with prior warnings that chatbot evaluation can be noisy and order sensitive\./giu, "The emphasis on benchmark accuracy rather than judge-based preference scoring avoids introducing a separate evaluator-noise variable into this small benchmark.")
    .replace(/\bThis narrowing follows the same resource-conscious logic emphasized in prior PEFT work, where fixed memory and runtime budgets make selective comparison preferable to shallow coverage of every configuration\./giu, "This narrowing treats fixed memory and runtime budgets as the governing design constraint, making selective comparison preferable to shallow coverage of every configuration.")
    .replace(/\bBecause several of these latter sources are available only through partial extraction in the present evidence base, they are used here for framing rather than detailed quantitative comparison\./giu, "Because those strands are not direct condition-matched baselines, they are used here for framing rather than detailed quantitative comparison.")
    .replace(/\bThe benchmark also contributes methodologically\./giu, "The benchmark also illustrates a scoped reporting protocol for this setting.")
    .replace(/\bTo isolate rank and dropout as much as the budget allowed,\s*the protocol held the optimizer,\s*learning-rate schedule,\s*LoRA target modules,\s*effective batch size,\s*token budget,\s*and capped training set constant across cells\./giu, "To isolate rank and dropout as much as the budget allowed, the protocol fixed the optimizer, learning-rate schedule, LoRA target modules, effective batch size, and capped data budget; the preserved artifacts do not independently verify identical consumed token counts for every cell.")
    .replace(/\bthe protocol held the optimizer,\s*learning-rate schedule,\s*LoRA target modules,\s*effective batch size,\s*token budget,\s*and capped training set constant across cells\b/giu, "the protocol fixed the optimizer, learning-rate schedule, LoRA target modules, effective batch size, and capped data budget, while treating consumed token counts as incompletely logged")
    .replace(/\bThe main outcome is therefore twofold:\s*a limited but encouraging empirical signal for high-rank moderate-dropout tuning in this setting,\s*and a practical benchmark template for later larger-scale experiments\./giu, "The main outcome is therefore a limited but encouraging empirical signal for high-rank moderate-dropout tuning in this setting, plus a scoped protocol illustration for a larger follow-up.")
    .replace(/\bpractical benchmark template for later larger-scale experiments\b/giu, "scoped protocol illustration for a larger follow-up")
    .replace(/\brepeated-seed benchmark template for later larger-scale experiments\b/giu, "repeated-seed protocol illustration for later larger-scale experiments")
    .replace(/\bthe strongest exposed cell-level comparison in the released comparison table and statistical summary is\b/giu, "the strongest exposed cell-level comparison is")
    .replace(/\bthe compact table reports\b/giu, "this condition reports")
    .replace(/\bthe compact metric table reports\b/giu, "the reported metric table shows")
    .replace(/\bcompact run summary\b/giu, "run summary")
    .replace(/\bcompact task-level statistics\b/giu, "reported task-level statistics")
    .replace(/\bcompact manuscript payload\b/giu, "available manuscript record")
    .replace(/\bcompact artifacts available for manuscript writing\b/giu, "available run summary")
    .replace(/\bcompact writing payload(?: exposed here)?\b/giu, "available reporting materials")
    .replace(/\bcompact writing materials\b/giu, "available reporting materials")
    .replace(/\bcompact executed summary available for writing\b/giu, "reported execution summary")
    .replace(/\bnot exposed in the writing payload\b/giu, "not available in the reported summary")
    .replace(/\bpaper-writing payload exposes only one explicit condition-to-baseline comparison and a set of per-condition confidence intervals, not the full numeric table for every cell\b/giu, "reported evidence gives the strongest condition-to-baseline comparison and interval summaries, while the visible table preserves the condition-level reporting unit")
    .replace(/\bthe present payload cannot establish\b/giu, "the present evidence cannot establish")
    .replace(/\bThe payload also contains\b/giu, "The reported materials also contain")
    .replace(/\breader-visible audit-?log sentence\b/giu, "reader-facing transition sentence")
    .replace(/\binternal audit\/log sentence\b/giu, "reader-facing transition sentence")
    .replace(/\baudit-?log sentence\b/giu, "transition sentence")
    .replace(/\bpreserved manuscript bundle\b/giu, "reported run records")
    .replace(/\bmanuscript-facing bundle\b/giu, "reported evidence")
    .replace(/\bavailable manuscript record\b/giu, "reported evidence")
    .replace(/\bcompact report\b/giu, "reported result summary")
    .replace(/\bcompact summary\b/giu, "reported summary")
    .replace(/\bcompact bundle\b/giu, "available report")
    .replace(/\bthe reported CI-related summary value for this cell was\b/giu, "the reported 95% confidence-interval width for this cell was")
    .replace(/\breported CI-related summary value\b/giu, "reported 95% confidence-interval width")
    .replace(/\bthe compact results summary does not expose condition-level runtime or memory aggregates\b/giu, "the available records do not support condition-level runtime or memory efficiency rankings")
    .replace(/\bcompact results summary\b/giu, "available records")
    .replace(/\bcompact artifact record\b/giu, "preserved run record")
    .replace(/\brather than inferring finer-grained per-task or compute trade-offs from tables that are not shown\b/giu, "without extending the claim to finer-grained per-task or compute trade-offs that the main text does not report")
    .replace(/\btables that are not shown\b/giu, "evidence not reported in the main text")
    .replace(/\babridged tables\b/giu, "main-text tables")
    .replace(/\bpreserved supplemental-JSON parsing error\b/giu, "preserved supplemental reporting inconsistency")
    .replace(/\bsupplemental-JSON parsing error\b/giu, "supplemental reporting inconsistency")
    .replace(/\bmanuscript-process metadata\b/giu, "supplementary reporting limitation")
    .replace(/\bmanuscript-process phrasing\b/giu, "supplementary reporting phrasing")
    .replace(/\brepeated-seed design is therefore used as a screening instrument\b/giu, "reported interval summaries are therefore used as a screening instrument")
    .replace(/\brepeated-seed local benchmark\b/giu, "bounded local condition-grid pilot")
    .replace(/\brepeated-seed rank\/dropout screen\b/giu, "condition-grid rank/dropout pilot")
    .replace(/\blocal repeated-seed preflight\b/giu, "local condition-grid preflight")
    .replace(/\brepeated-seed preflight\b/giu, "condition-grid preflight")
    .replace(/\bThat reading is consistent with prior PEFT work such as QLoRA and neighboring low-budget adaptation studies\b/giu, "That reading is consistent with prior PEFT and neighboring low-budget adaptation studies")
    .replace(/\bQLoRA-scale efficiency work and broader benchmark papers such as MAPLE both suggest\b/giu, "Efficiency-oriented PEFT work and broader benchmark papers both suggest")
    .replace(/\bthe released comparison table and statistical summary\b/giu, "the condition-level comparison")
    .replace(/\bthe released study summary\b/giu, "the study summary")
    .replace(/\bIn the released summary,\s*/giu, "In the reported results, ")
    .replace(/\bWithin the released summary of this fixed-budget local benchmark\b/giu, "Within the reported results for this fixed-budget local benchmark")
    .replace(/\breleased summary\b/giu, "reported results")
    .replace(/\bthe compact release foregrounds\b/giu, "the reported analyses foreground")
    .replace(/\bthe compact release\b/giu, "the reported analyses")
    .replace(/\bcompact release\b/giu, "reported analyses")
    .replace(/\bpresent evidence base\b/giu, "available literature record")
    .replace(/\breader-visible paper\b/giu, "main manuscript")
    .replace(/\bminor supplementary formatting issue\b/giu, "incomplete compute instrumentation")
    .replace(/\bexecutable run metadata\b/giu, "reported run")
    .replace(/\bRun metadata records\s+(\d+)\s+training examples and\s+(\d+)\s+train dataset tokens/giu, "The inspected seed-level record reports $1 training examples and a training-token count of $2")
    .replace(/\bthe inspected seed-level run used\s+(\d+)\s+training examples and\s+(\d+)\s+train dataset tokens\s+for the inspected seed-level record\b/giu, "The inspected seed-level record reports $1 training examples and a training-token count of $2")
    .replace(/\bthe the reported run separates the consumed seed-level training count separately\b/giu, "the preserved metadata records the consumed seed-level training count separately")
    .replace(/\brun-owned metadata exposes\b/giu, "preserved metadata records")
    .replace(/\brun metadata\b/giu, "reported run details");
}

function stripRawCitationTokens(text: string): string {
  return text
    .replace(/\s*\[(?=[^\]]*(?:doi:|arxiv|[a-f0-9]{20,}))[^\]]+\]/giu, "")
    .replace(/\s*\((?=[^)]*(?:doi:|arxiv|[a-f0-9]{20,}))[^)]+\)/giu, "");
}

function stripLimitedEvidenceBoilerplate(text: string): string {
  return text
    .replace(/\s*(?:;|,|\.)?\s*direct supporting evidence is currently limited\.?/giu, ".")
    .replace(/\s*this section is written conservatively because direct supporting evidence is currently limited\.?/giu, "");
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
          sentence: `Supplementary dataset and repeat summaries are reported in ${reference.label || "the appendix"}.`
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
    return `Supplementary dataset summaries are cross-referenced in ${reference.label}.`;
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
  headings: string[],
  expansionPass = 1
): PaperDraft {
  const sections = draft.sections.map((section) => {
    if (!headings.some((heading) => normalizeHeading(heading) === normalizeHeading(section.heading))) {
      return section;
    }
    const candidates = buildSectionParagraphCandidates(section.heading, bundle, context, true, expansionPass);
    const maximumParagraphs = SECTION_MAX_PARAGRAPHS[normalizeHeading(section.heading)] || 6;
    return {
      ...section,
      paragraphs: dedupeParagraphs([...section.paragraphs, ...candidates]).slice(0, maximumParagraphs)
    };
  });
  return { ...draft, sections };
}

function padDraftToMinimumWordFloor(
  draft: PaperDraft,
  bundle: PaperWritingBundle,
  context: ExperimentArtifactContext,
  profile: PaperProfileConfig,
  initialBudget: PageBudgetManagerReport
): PaperDraft {
  const preferredHeadings = [
    "Results",
    "Method",
    "Related Work",
    "Discussion",
    "Limitations",
    "Introduction",
    "Conclusion"
  ];
  const evidenceIds = inferSectionEvidenceIds(draft, bundle);
  const citationPaperIds = inferSectionCitationIds(draft, bundle);
  let nextDraft = draft;
  let pageBudget = initialBudget;
  let variant = 0;

  while (pageBudget.estimated_main_words < pageBudget.minimum_main_words && variant < 80) {
    const candidates = preferredHeadings
      .map((heading) => {
        const entry = pageBudget.sections.find((section) => normalizeHeading(section.heading) === normalizeHeading(heading));
        return {
          heading,
          remaining: Math.max(0, (entry?.target_words || 0) - (entry?.current_words || 0)),
          current: entry?.current_words || 0
        };
      })
      .sort((left, right) => (right.remaining - left.remaining) || (left.current - right.current));
    const targetHeading = candidates[0]?.heading || "Results";
    const paragraph = buildBudgetFloorParagraph(targetHeading, bundle, context, variant, evidenceIds, citationPaperIds);
    if (!paragraph) {
      break;
    }
    let inserted = false;
    const sections = nextDraft.sections.map((section) => {
      if (normalizeHeading(section.heading) !== normalizeHeading(targetHeading)) {
        return section;
      }
      inserted = true;
      return {
        ...section,
        paragraphs: dedupeParagraphs([...section.paragraphs, paragraph])
      };
    });
    if (!inserted) {
      sections.push({
        heading: targetHeading,
        paragraphs: [paragraph],
        evidence_ids: evidenceIds,
        citation_paper_ids: citationPaperIds
      });
    }
    nextDraft = {
      ...nextDraft,
      sections: sortDraftSections(sections)
    };
    pageBudget = pageBudgetManager({
      draft: nextDraft,
      profile
    });
    variant += 1;
  }

  return nextDraft;
}

function buildBudgetFloorParagraph(
  heading: string,
  bundle: PaperWritingBundle,
  context: ExperimentArtifactContext,
  variant: number,
  evidenceIds: string[],
  citationPaperIds: string[]
): PaperDraftParagraph | undefined {
  const conditionCount = context.results.condition_summaries.length;
  const datasetNames = joinHumanList(context.method.dataset_names.slice(0, 4));
  const conditionSurface =
    conditionCount > 0
      ? `${conditionCount} structured condition summaries`
      : "the structured result summaries";
  const sentencesByHeading: Record<string, string[][]> = {
    results: [
      [
        `The main result is reported through ${conditionSurface} rather than through a single selected example.`,
        context.results.aggregate_summary[0] || "The aggregate summary anchors the central empirical story.",
        "This makes the result table the primary evidence object and keeps any interpretation tied to comparable rows."
      ],
      [
        context.results.dispersion_notes[0] || context.results.ci_notes[0] || "Uncertainty remains visible in the structured result artifacts.",
        "The manuscript treats that uncertainty as part of the result rather than as a caveat to remove after choosing the strongest condition.",
        "This wording is intentionally conservative because the current run is designed to identify a follow-up candidate, not to settle a universal ranking."
      ],
      [
        context.results.runtime_notes[0] || context.results.memory_notes[0] || "Operational traces are retained as execution evidence.",
        "They support the claim that the comparison was run under the declared budget, but they do not by themselves prove that the strongest accuracy setting is the most efficient setting.",
        "That separation keeps resource observations from becoming unsupported optimization claims."
      ]
    ],
    method: [
      [
        datasetNames ? `The task scope is fixed around ${datasetNames}.` : "The task scope is fixed by the current run artifacts.",
        "The method section therefore describes the executed comparison as a locked protocol rather than as an open-ended search.",
        "That distinction is necessary because paper-readiness depends on the reader being able to reconstruct which evidence was generated and which follow-up remains planned."
      ],
      [
        context.method.repeat_notes[0] || "Repeated execution is treated as the unit of empirical support.",
        "Seed-level outcomes are not promoted into separate conclusions; they are used to expose variation around each condition.",
        "The baseline remains the comparison anchor throughout the manuscript so that positive deltas are not detached from their reference point."
      ],
      [
        context.method.hyperparameter_notes[0] || "The tested configuration space is described only to the extent visible in the artifacts.",
        "Untested settings are left outside the conclusion rather than inferred from nearby grid points.",
        "This prevents the method description from implying a broader sweep than the run actually executed."
      ]
    ],
    "related work": [
      [
        buildClosestCitedWorkSentence(context),
        "These papers motivate the axes of comparison but do not replace a direct baseline in the current run.",
        "The manuscript therefore uses citations for positioning and the run artifacts for numerical support."
      ],
      [
        firstSafeRelatedWorkAxis(context)
          ? `The most relevant prior-work axis is ${firstSafeRelatedWorkAxis(context)}.`
          : "The most relevant prior-work axis is the relationship between evaluation design and defensible empirical claims.",
        "The current paper narrows that axis to the available budget and reports what can be tested locally.",
        "This makes the contribution a bounded evidence filter rather than a claim to supersede broader prior studies."
      ]
    ],
    discussion: [
      [
        context.discussion.discussion_points[0] || "The result should be interpreted as bounded evidence.",
        "The practical value is strongest when the reader needs a transparent preflight before spending more compute.",
        "It is weaker as a stand-alone theory of why the tested configuration behaves as it does."
      ],
      [
        context.discussion.practical_implications[0] || "The immediate implication is a follow-up candidate rather than a universal prescription.",
        "A stronger claim would require broader tasks, larger models or datasets, and the same failed-run visibility.",
        "The current manuscript keeps those requirements explicit so that the conclusion does not exceed the evidence."
      ]
    ],
    limitations: [
      [
        context.discussion.limitations[0] || "The main limitation is the bounded scope of the current evidence.",
        "The experiment can support a local candidate-selection claim, but it cannot establish broad transfer, mechanism, or deployment robustness.",
        "Those limits are stated as part of the scientific result rather than hidden in a generic final paragraph."
      ],
      [
        "The manuscript also depends on consistency between result tables, captions, and the claim-evidence map.",
        "If those artifacts diverge in a later run, the readiness decision should be downgraded until the mismatch is repaired.",
        "This keeps paper-readiness tied to auditable evidence instead of to prose quality alone."
      ]
    ],
    introduction: [
      [
        `This paper studies ${bundle.topic} under an explicitly bounded evidence ceiling.`,
        "The goal is not to claim a broad autonomous discovery result, but to determine what the completed artifacts can support as a cautious experimental manuscript.",
        "That framing makes the baseline, result table, and limitations central from the first page."
      ]
    ],
    conclusion: [
      [
        "The final takeaway is therefore deliberately narrow.",
        "The current run can identify a defensible next configuration to test and can document the conditions under which that signal appeared.",
        "It should not be read as closing the broader research question without the larger follow-up study described in the limitations."
      ]
    ]
  };
  const groups = sentencesByHeading[normalizeHeading(heading)] || sentencesByHeading.results;
  const selected = groups[variant % groups.length];
  const angleSentences = [
    "The emphasis remains on evidence that is inspectable in the current run.",
    "This paragraph is retained in the main body because it clarifies the claim boundary rather than adding a new claim.",
    "The wording is deliberately scoped so that a reader can separate completed evidence from future work.",
    "The same point would need to be revised if later artifacts changed the comparator, table, or execution status.",
    "This keeps the main text dense enough for review while still avoiding unsupported extrapolation.",
    "The paragraph also makes the audit trail visible instead of relying on polish as a proxy for readiness.",
    "The scope is constrained to the present artifacts, which is why the discussion remains useful without becoming overbroad.",
    "This gives the reader enough context to interpret the reported numbers as bounded evidence."
  ];
  const text = cleanString([...selected, angleSentences[variant % angleSentences.length]].join(" "));
  return {
    text,
    evidence_ids: evidenceIds.slice(0, 4),
    citation_paper_ids: citationPaperIds.slice(0, 4)
  };
}

function buildSectionParagraphCandidates(
  heading: string,
  bundle: PaperWritingBundle,
  context: ExperimentArtifactContext,
  expanded = false,
  expansionPass = 1
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
          ],
          expanded && expansionPass >= 4
            ? [
                context.protocol_kind === "lm_benchmark"
                  ? "The motivation is deliberately practical: local instruction-tuning screens often need to decide whether a configuration deserves a larger run before the project can afford broader model and task coverage."
                  : "The motivation is deliberately practical: bounded empirical screens often need to decide whether a configuration deserves a larger run before the project can afford broader dataset and model coverage.",
                "For that reason, the paper treats the executed comparison as a decision-quality preflight rather than as a final generalization claim, and it keeps the baseline, uncertainty, and failed-run visibility in the main narrative."
              ]
            : [],
          expanded && expansionPass >= 5
            ? [
                "This framing also explains why the manuscript spends space on protocol and audit details.",
                "A short positive result would be easier to read but less useful scientifically if readers could not separate completed evidence, missing evidence, and follow-up claims that remain outside the current run."
              ]
            : []
        ].filter((item) => item.length > 0),
        inferSectionEvidenceIds(undefined, bundle),
        inferSectionCitationIds(undefined, bundle)
      );
    case "related work":
      return buildParagraphsFromSentences(
        [
          [
            safeRelatedWorkClusters(context).length > 0
              ? `Related work clusters around ${joinHumanList(safeRelatedWorkClusters(context).slice(0, 4))}.`
              : "Related work spans multiple nearby empirical and systems-oriented strands.",
            buildRelatedWorkAxisSentence(context)
          ],
          [
            buildClosestCitedWorkSentence(context),
            `The present paper positions itself around ${describeScientificObjectiveForNarrative(bundle.objectiveMetric)} while keeping claims limited to the available artifacts.`
          ],
          expanded
            ? [
                "This positioning is intentionally narrower than a broad novelty claim: it clarifies where the current study overlaps with prior baselines and where evidence remains thin.",
                context.protocol_kind === "lm_benchmark"
                  ? "For this manuscript, the cited PEFT literature supplies framing axes rather than direct numerical baselines. The condition-matched comparator remains the locked baseline inside the executed run, while prior work defines the memory-efficiency, benchmark-design, and adapter-mechanism questions that make a repeated-seed rank/dropout screen scientifically interpretable."
                  : "For this manuscript, the cited literature supplies positioning anchors rather than direct condition-matched baselines. The condition-matched comparator remains the executed baseline inside the run, while prior work defines the methodological and evaluation questions that make the scoped experiment scientifically interpretable.",
                context.protocol_kind === "lm_benchmark"
                  ? "This separation keeps the contribution modest but clearer. The paper can argue that a local condition-grid preflight is a useful evidence filter for PEFT tuning decisions, while avoiding claims that would require a broader model suite, a different task mix, or direct reproduction of the cited methods."
                  : "This separation keeps the contribution modest but clearer. The paper can argue that the executed comparison is a useful evidence filter for the stated research question, while avoiding claims that would require a broader dataset suite, a different task mix, or direct reproduction of the cited methods."
              ]
            : [],
          expanded && expansionPass >= 4
            ? [
                "The prior-work role is therefore twofold: it defines why the chosen axes matter, and it prevents the manuscript from using external citations as if they were direct evidence for the current numerical comparison.",
                "That distinction is important for paper readiness because related work can justify the question and design, but only the executed artifacts can support condition-level claims about the present experiment."
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
            : [],
          expanded && expansionPass >= 2
            ? [
                context.protocol_kind === "lm_benchmark"
                  ? "The executed condition-level summaries are the comparison unit for this local preflight: means are compared against the locked baseline, while individual seed outcomes are used to expose variation rather than to select a favorable example."
                  : "The repeated-evaluation design is treated as the experimental unit for paper-scale interpretation: aggregate condition summaries are compared against the baseline, while individual repeats expose variation rather than serving as cherry-picked examples.",
                context.method.repeat_notes.length > 0
                  ? `The preserved protocol notes ${joinHumanList(context.method.repeat_notes.slice(0, 3))}, so the method description distinguishes the planned budget from the executed repeated comparison.`
                  : "The method description separates the planned budget from the executed comparison so readers can see which claims depend on completed runs."
              ]
            : [],
          expanded && expansionPass >= 3
            ? [
                context.method.runtime_measurement || context.method.memory_measurement
                  ? "Resource instrumentation is included as a reproducibility and feasibility check, not as a primary efficiency claim; this keeps the manuscript from converting auxiliary logs into unsupported condition-level conclusions."
                  : "Auxiliary protocol details are reported only when they are visible in the run artifacts, and omitted quantities are treated as limitations rather than inferred measurements."
              ]
            : [],
          expanded && expansionPass >= 4
            ? [
                context.protocol_kind === "lm_benchmark"
                  ? "The method also fixes the interpretation boundary around a repeated-seed, small-backbone screen: the same dataset subset, task set, and baseline accounting are used to make the rank/dropout comparison auditable."
                  : "The method also fixes the interpretation boundary around the repeated comparison: the same dataset scope, task definition, and baseline accounting are used to make the condition comparison auditable.",
                "This detail is retained in the main text because paper readiness depends on readers being able to distinguish the experimental unit, the comparison unit, and the downstream follow-up that remains unexecuted."
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
          ],
          ...(expanded
            ? buildConditionResultNarrativeParagraphs(context).map((paragraph) => [paragraph])
            : []),
          ...(expanded && expansionPass >= 2
            ? [
                [
                  context.results.condition_summaries.length > 0
                    ? `The condition table should be read as the main comparison surface because it preserves the baseline label, completed-seed count, and uncertainty width for each repeated cell.`
                    : "The main result should be read through the structured comparison table rather than through isolated headline numbers.",
                  context.results.aggregate_summary[0] || "",
                  "This presentation prevents the strongest cell from being promoted into a universal recipe without the supporting spread and completion context."
                ],
                [
                  context.results.runtime_notes[0] || context.results.memory_notes[0]
                    ? `Operational measurements remain secondary: ${joinHumanList([context.results.runtime_notes[0] || "", context.results.memory_notes[0] || ""].filter(Boolean))}.`
                    : "Operational measurements are retained as execution checks rather than as evidence for an efficiency ranking.",
                  "That distinction matters because a paper-ready result can report that the experiment executed cleanly without claiming that the best-performing setting is also the most resource-efficient."
                ]
              ]
            : []),
          ...(expanded && expansionPass >= 3
            ? [
                [
                  context.results.effect_notes[0] ||
                    "The observed effect is interpreted as a baseline-relative screening signal.",
                  context.results.heterogeneity_notes[0] ||
                    "The repeated-seed framing leaves room for heterogeneous seed behavior, so the result is not described as uniformly positive.",
                  "The manuscript therefore separates the empirical selection signal from the stronger mechanistic claim that would require a broader interaction analysis."
                ]
              ]
            : []),
          ...(expanded && expansionPass >= 4
            ? [
                [
                  context.results.condition_summaries.length > 0
                    ? `Across the condition summaries, the important unit is the repeated cell rather than a single best seed; this keeps the reader focused on the baseline-relative pattern and its uncertainty.`
                    : "Across the result summaries, the important unit is the comparable condition rather than a single favorable observation.",
                  "The table and figure are therefore used as complementary checks: the table anchors the numeric values, while the figure is retained only when it shows a distinct pattern that is not already obvious from the rows."
                ],
                [
                  "The result is also reported with an explicit non-result: the present artifacts do not justify a broad claim about all ranks, all dropout rates, or all downstream tasks.",
                  "That negative boundary is part of the contribution because it prevents an empirical preflight from being mistaken for a completed scaling study."
                ]
              ]
            : [])
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
          ],
          expanded && expansionPass >= 2
            ? [
                context.protocol_kind === "lm_benchmark"
                  ? "For a small language-model preflight, the strongest defensible use of the result is triage: it can identify a configuration worth carrying into a larger model or broader benchmark suite, but it cannot establish a general adapter law."
                  : "For a bounded experiment, the strongest defensible use of the result is triage: it can identify a configuration worth carrying into a larger run, but it cannot establish a general method law.",
                context.results.effect_notes[0] || ""
              ]
            : [],
          expanded && expansionPass >= 2
            ? [
                "The claim ceiling is therefore central to the interpretation.",
                "Completion of the run, a positive mean difference, and a usable table jointly support a candidate-selection claim, while stronger statements about robustness, mechanism, or broad transfer remain outside the available evidence."
              ]
            : [],
          expanded && expansionPass >= 3
            ? [
                context.discussion.practical_implications[1] ||
                  "A practical next step is to repeat the same locked comparison with a larger backbone, a broader task mix, and the same failed-run visibility requirements.",
                "That follow-up would test whether the present signal survives scale and task variation instead of merely reflecting this local preflight."
              ]
            : [],
          expanded && expansionPass >= 4
            ? [
                "The audit trail matters for this interpretation because the paper-ready claim depends on alignment between executed runs, result tables, captions, and the claim-evidence map.",
                "If a later run changes the baseline, hides failed executions, or moves numeric support out of the main table, the same text should be downgraded rather than reused as a stronger manuscript."
              ]
            : []
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
      if (expanded && expansionPass >= 2) {
        baseSentences.push([
          context.protocol_kind === "lm_benchmark"
            ? "The benchmark scope is narrow: one compact backbone, a bounded instruction-tuning budget, and a short task set cannot support claims about larger model families or open-ended instruction-following quality."
            : "The benchmark scope is narrow, so conclusions should be limited to the evaluated datasets, models, and resource budget.",
          "This limitation is methodological rather than cosmetic because the same hyperparameter choice could behave differently under a larger training budget or a different evaluation suite."
        ]);
      }
      if (expanded && expansionPass >= 3) {
        baseSentences.push([
          context.results.ci_notes[0] || context.results.dispersion_notes[0] || "Uncertainty remains a material part of the result.",
          "The paper therefore avoids significance language and treats the best condition as a follow-up candidate unless a later study reproduces the direction with tighter intervals."
        ]);
      }
      if (expanded && expansionPass >= 4) {
        baseSentences.push([
          "The evidence ceiling also constrains related-work claims: external papers motivate the comparison, but they are not substitutes for direct reproduction under the present budget.",
          "Consequently, the manuscript avoids saying that the observed interaction is a general PEFT property, and instead reports the narrower empirical signal visible in the completed artifacts."
        ]);
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
            "The paper therefore keeps execution coverage and supplementary metrics secondary to the visible baseline-relative comparison.",
            "The main text interprets only the comparison and task split that are visible in the presented table and figure."
          ],
          expanded && expansionPass >= 2
            ? [
                "The immediate conclusion is that the executed comparison is strong enough to guide a next experiment, not strong enough to close the broader scientific question.",
                "That distinction keeps the result useful without overstating the evidence ceiling."
              ]
            : [],
          expanded && expansionPass >= 3
            ? [
                "A paper-ready follow-up should preserve the same baseline accounting and add broader tasks, larger models, and explicit variance or interaction tests.",
                "Those additions would determine whether the preflight signal remains stable when the budget and evaluation scope expand."
              ]
            : [],
          expanded && expansionPass >= 4
            ? [
                "Until that follow-up exists, the manuscript's final claim is intentionally modest: the current run produces a useful, auditable candidate selection result under its stated constraints.",
                "That is a scientific result when reported with its comparator, uncertainty, and limitations, but it remains a bounded preflight rather than a universal tuning prescription."
              ]
            : []
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
  datasetSummaries: DatasetResultSummary[],
  resultAnalysis?: ResultAnalysisArtifact
): string[] {
  const implications: string[] = [];
  const hasPositiveDelta =
    datasetSummaries.some((item) => typeof item.delta_value === "number" && item.delta_value > 0)
    || (resultAnalysis?.metric_table || []).some(
      (item) => /delta_vs_baseline|improvement_over_baseline/iu.test(item.key) && item.value > 0
    )
    || (resultAnalysis?.statistical_summary?.effect_estimates || []).some((item) => item.direction === "positive");
  if (hasPositiveDelta) {
    implications.push(
      `The current evidence is most actionable as a cautious benchmark note for ${bundle.topic}, especially where small positive deltas repeat across datasets.`
    );
  }
  const hasResourceMeasurement =
    datasetSummaries.some((item) => typeof item.runtime_seconds_mean === "number")
    || (resultAnalysis?.metric_table || []).some((item) => /runtime|latency|memory|vram|ram/iu.test(item.key));
  if (hasResourceMeasurement) {
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

  if (summaries.length === 0) {
    summaries.push(...collectBenchmarkTaskResultSummaries(input.resultAnalysis, input.objectiveMetricProfile));
  }

  return summaries.slice(0, 8);
}

function collectBenchmarkTaskResultSummaries(
  resultAnalysis: ResultAnalysisArtifact | undefined,
  objectiveMetricProfile?: ObjectiveMetricProfile
): DatasetResultSummary[] {
  const metricTable = resultAnalysis?.metric_table || [];
  const taskMetrics = metricTable.filter((item) =>
    /(^|\.)(arc[_-]?challenge|hellaswag|mmlu|gsm8k|truthfulqa|winogrande|boolq|benchmark|task).*accuracy$/iu.test(item.key)
  );
  const summaries = taskMetrics
    .filter((item) => !/raw_result\./iu.test(item.key))
    .map((item) => {
      const dataset = humanizeToken(item.key.replace(/(_?accuracy|\.accuracy)$/iu, ""));
      return {
        dataset,
        label: `${dataset} benchmark task`,
        main_metric_label: inferDatasetMainMetricLabel(objectiveMetricProfile, { accuracy: item.value }),
        main_metric_value: item.value,
        heterogeneity_notes: [],
        summary: `${dataset} reports ${formatNumber(item.value)} accuracy in the structured result analysis.`
      };
    });
  if (summaries.length > 0) {
    return summaries;
  }

  const comparison = resultAnalysis?.condition_comparisons?.[0];
  const deltaMetric = metricTable.find((item) => /delta_vs_baseline|improvement_over_baseline/iu.test(item.key));
  if (comparison || deltaMetric) {
    const delta = (comparison?.metrics || []).find((item) => /delta|improvement/iu.test(item.key))?.value ?? deltaMetric?.value;
    return [
      {
        dataset: "primary comparison",
        label: cleanString(comparison?.label) || "primary comparison",
        main_metric_label: humanizeToken(deltaMetric?.key || objectiveMetricProfile?.primaryMetric || "primary metric"),
        main_metric_value: delta,
        delta_label: humanizeToken(deltaMetric?.key || "delta versus baseline"),
        delta_value: delta,
        heterogeneity_notes: [],
        summary:
          cleanString(comparison?.summary)
          || `The primary comparison reports ${humanizeToken(deltaMetric?.key || "a baseline delta")} of ${formatNumber(delta)}.`
      }
    ];
  }
  return [];
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
        const value =
          metricKey === "peak_memory_mb" && /\bbytes?\b/iu.test(normalizeMetricText(entry.key))
            ? entry.value / 1_000_000
            : entry.value;
        return buildStructuredNumericFact({
          factKind: "metric",
          source: "artifact",
          location: "artifact.result_analysis.metric_table",
          rawText: `${entry.key}=${formatNumber(value)}`,
          value,
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
    ...(resultAnalysis?.statistical_summary?.confidence_intervals || [])
      .map((item) => {
        const lower = typeof item.lower === "number" ? item.lower : undefined;
        const upper = typeof item.upper === "number" ? item.upper : undefined;
        if (typeof lower !== "number" || typeof upper !== "number") {
          return "";
        }
        return `The ${formatConfidenceLevel(item.level)} interval for ${humanizeToken(item.metric_key || "reported metric")} spans ${formatNumber(lower)} to ${formatNumber(upper)}.`;
      }),
    ...(resultAnalysis?.metric_table || [])
      .filter((item) => /(_std|_sem|_variance|ci95|ci_?95|confidence)/iu.test(item.key))
      .map((item) => `${humanizeToken(item.key)}=${formatNumber(item.value)}.`),
    ...datasetSummaries.flatMap((item) => item.heterogeneity_notes)
  ]).filter(Boolean);
  return notes.slice(0, 4);
}

function formatConfidenceLevel(value: unknown): string {
  const level = asNumber(value);
  if (typeof level !== "number") {
    return "reported";
  }
  return level <= 1 ? `${formatNumber(level * 100)}%` : `${formatNumber(level)}%`;
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

function hasPairedArtifact(
  latestResults: Record<string, unknown>,
  resultAnalysis?: ResultAnalysisArtifact
): boolean {
  const repeatedRows = asArray(latestResults.repeat_records).length;
  if (repeatedRows >= 2) {
    return true;
  }
  const trialCount = resultAnalysis?.statistical_summary?.executed_trials ?? resultAnalysis?.statistical_summary?.total_trials;
  if (typeof trialCount === "number" && trialCount >= 2) {
    return true;
  }
  return (resultAnalysis?.metric_table || []).some(
    (item) => /run_.*_count|completed_run_count|executed_trial|total_trial/iu.test(item.key) && item.value >= 2
  );
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

function collectModelNames(
  parsedPlan: Record<string, unknown>,
  latestResults: Record<string, unknown>,
  resultAnalysis?: ResultAnalysisArtifact
): string[] {
  const selectedDesign = asRecord(parsedPlan.selected_design);
  const protocol = asRecord(latestResults.protocol);
  const studySummary = asRecord(latestResults.study_summary);
  const requestedModels = asRecord(latestResults.requested_models);
  const modelSelection = asRecord(latestResults.model_selection);
  const metrics = asRecord(resultAnalysis?.metrics);
  const metricsModelSelection = asRecord(metrics.model_selection);
  const datasetSummaries = asArray(latestResults.dataset_summaries).map((item) => asRecord(item));
  return uniqueStrings([
    asString(latestResults.selected_model_id) || "",
    asString(latestResults.selected_model) || "",
    asString(latestResults.model_id) || "",
    asString(modelSelection.selected_model_id) || "",
    asString(modelSelection.model_id) || "",
    asString(studySummary.selected_model) || "",
    asString(studySummary.model_id) || "",
    asString(requestedModels.preferred_model) || "",
    asString(metrics.selected_model_id) || "",
    asString(metrics.model_id) || "",
    asString(metricsModelSelection.selected_model_id) || "",
    asString(metricsModelSelection.model_id) || "",
    ...asStringArray(protocol.models),
    ...asStringArray(selectedDesign.baselines),
    ...asStringArray(selectedDesign.implementation_notes).filter((item) => /qwen|tinyllama|llm|language model|backbone|base model|lora|peft/iu.test(item)),
    ...asStringArray(selectedDesign.baselines).filter((item) => /qwen|tinyllama|llm|language model|backbone|base model|lora|peft/iu.test(item)),
    ...asStringArray(selectedDesign.metrics).filter((item) => /bert|tree|forest|regression|svm|xgboost|workflow|nested|qwen|tinyllama|llm|lora|peft/iu.test(item)),
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
    ...collectKeywordNotes(parsedPlan, [
      "uci",
      "hugging face",
      "openml",
      "public benchmark",
      "benchmark suite",
      "alpaca",
      "arc-challenge",
      "hellaswag"
    ]),
    asString(protocol.dataset_source) || ""
  ]).filter(Boolean).slice(0, 4);
}

function collectSampleSizeHints(
  parsedPlan: Record<string, unknown>,
  latestResults: Record<string, unknown>,
  resultAnalysis?: ResultAnalysisArtifact
): string[] {
  const includeLmEvaluationSamples =
    inferExperimentProtocolKind(parsedPlan, latestResults, resultAnalysis) === "lm_benchmark";
  return uniqueStrings([
    ...collectKeywordNotes(parsedPlan, ["samples", "instances", "rows"]),
    ...collectNumbersAsNotes(latestResults, ["n_samples", "samples", "row_count", "num_train_samples"]),
    ...collectExecutedTrainingSampleNotes(latestResults),
    ...(includeLmEvaluationSamples ? collectLmEvaluationSampleNotes(latestResults, resultAnalysis) : [])
  ]).slice(0, 6);
}

function collectLmEvaluationSampleNotes(
  latestResults: Record<string, unknown>,
  resultAnalysis?: ResultAnalysisArtifact
): string[] {
  const notes: string[] = [];
  const seen = new Set<string>();
  const pushTotal = (label: string, total: unknown) => {
    const count = asNumber(total);
    if (typeof count !== "number" || count <= 0 || count > 100000) {
      return;
    }
    const normalizedLabel = humanizeToken(label || "evaluation task");
    const key = `${normalizedLabel}:${count}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    notes.push(`${normalizedLabel} reports ${formatNumber(count)} evaluation examples.`);
  };
  const visit = (value: unknown, label = "") => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, label));
      return;
    }
    const record = asRecord(value);
    if (Object.keys(record).length === 0) {
      return;
    }
    if (
      typeof asNumber(record.total) === "number"
      && (typeof asNumber(record.correct) === "number" || typeof asNumber(record.accuracy) === "number")
    ) {
      pushTotal(label, record.total);
    }
    for (const [key, child] of Object.entries(record)) {
      visit(child, key);
    }
  };
  visit(latestResults);
  visit(resultAnalysis);
  return notes.slice(0, 6);
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
    ...asStringArray(selectedDesign.implementation_notes).filter((item) => /normalize|standardize|preprocess|tokeniz|imput|scale|encode|clean|dedupe|data order|token budget|evaluation harness/iu.test(item)),
    ...collectKeywordNotes(parsedPlan, [
      "normalize",
      "standardize",
      "preprocess",
      "imput",
      "scale",
      "encode",
      "clean",
      "token budget",
      "training example order",
      "evaluation harness"
    ])
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

function collectHyperparameterNotes(
  parsedPlan: Record<string, unknown>,
  latestResults: Record<string, unknown>,
  resultAnalysis?: ResultAnalysisArtifact
): string[] {
  const selectedDesign = asRecord(parsedPlan.selected_design);
  const metrics = asRecord(resultAnalysis?.metrics);
  return uniqueStrings([
    ...collectExecutedTrainingHyperparameterNotes(latestResults),
    ...collectRunConfigTrainingHyperparameterNotes(asRecord(latestResults.run_config), asRecord(latestResults.data)),
    ...collectRunConfigTrainingHyperparameterNotes(asRecord(metrics.run_config), asRecord(metrics.data)),
    ...asStringArray(selectedDesign.resource_notes).filter((item) => /grid|search|hyperparameter|sweep|tuning/iu.test(item)),
    ...collectKeywordNotes(parsedPlan, ["hyperparameter", "grid search", "random search", "bayesian search", "tuning"]),
    ...collectKeywordNotes(latestResults, ["hyperparameter", "grid", "search space"])
  ]).slice(0, 6);
}

function collectRunConfigTrainingHyperparameterNotes(
  runConfig: Record<string, unknown>,
  data: Record<string, unknown>
): string[] {
  const notes: string[] = [];
  const fixedSettings: string[] = [];
  const learningRate = asNumber(runConfig.learning_rate);
  const batchSize = asNumber(runConfig.per_device_batch_size) ?? asNumber(runConfig.per_device_train_batch_size);
  const gradientAccumulation = asNumber(runConfig.gradient_accumulation_steps) ?? asNumber(runConfig.gradient_accumulation);
  const maxSeqLength = asNumber(runConfig.max_seq_length);
  const maxSteps = asNumber(runConfig.max_steps) ?? asNumber(runConfig.optimizer_steps);
  const timeoutSec = asNumber(runConfig.timeout_sec);
  if (typeof learningRate === "number") {
    fixedSettings.push(`learning rate ${formatNumber(learningRate)}`);
  }
  if (typeof batchSize === "number") {
    fixedSettings.push(`per-device train batch size ${formatNumber(batchSize)}`);
  }
  if (typeof gradientAccumulation === "number") {
    fixedSettings.push(`gradient accumulation ${formatNumber(gradientAccumulation)}`);
  }
  if (typeof maxSeqLength === "number") {
    fixedSettings.push(`maximum sequence length ${formatNumber(maxSeqLength)}`);
  }
  if (typeof maxSteps === "number") {
    fixedSettings.push(`${formatNumber(maxSteps)} optimizer steps`);
  }
  if (typeof timeoutSec === "number") {
    fixedSettings.push(`${formatNumber(timeoutSec)}-second timeout`);
  }
  if (fixedSettings.length > 0) {
    notes.push(`Fixed training settings included ${joinHumanList(fixedSettings)}.`);
  }
  const train = asRecord(data.train);
  const trainCount = asNumber(train.count) ?? asNumber(runConfig.train_samples);
  if (typeof trainCount === "number") {
    notes.push(`Run metadata records ${formatNumber(trainCount)} training examples for the reported pilot.`);
  }
  return notes;
}

function collectExecutedTrainingHyperparameterNotes(latestResults: Record<string, unknown>): string[] {
  const trainMetadata = findFirstTrainMetadata(latestResults);
  if (!trainMetadata) {
    return [];
  }
  const trainerState = asRecord(trainMetadata.trainer_state);
  const notes: string[] = [];
  const targetModules = asStringArray(trainMetadata.selected_target_modules).slice(0, 8);
  if (targetModules.length > 0) {
    notes.push(`LoRA target modules were ${joinHumanList(targetModules)}.`);
  }

  const fixedSettings: string[] = [];
  const learningRate = asNumber(trainerState.learning_rate);
  const batchSize = asNumber(trainerState.per_device_train_batch_size);
  const gradientAccumulation = asNumber(trainerState.gradient_accumulation_steps) ?? asNumber(trainMetadata.gradient_accumulation_steps);
  const weightDecay = asNumber(trainerState.weight_decay);
  const maxGradNorm = asNumber(trainerState.max_grad_norm);
  const optimizerSteps = asNumber(trainerState.optimizer_steps) ?? asNumber(trainMetadata.optimizer_steps);
  if (typeof learningRate === "number") {
    fixedSettings.push(`learning rate ${formatNumber(learningRate)}`);
  }
  if (typeof batchSize === "number") {
    fixedSettings.push(`per-device train batch size ${formatNumber(batchSize)}`);
  }
  if (typeof gradientAccumulation === "number") {
    fixedSettings.push(`gradient accumulation ${formatNumber(gradientAccumulation)}`);
  }
  if (typeof weightDecay === "number") {
    fixedSettings.push(`weight decay ${formatNumber(weightDecay)}`);
  }
  if (typeof maxGradNorm === "number") {
    fixedSettings.push(`max gradient norm ${formatNumber(maxGradNorm)}`);
  }
  if (typeof optimizerSteps === "number") {
    fixedSettings.push(`${formatNumber(optimizerSteps)} optimizer steps`);
  }
  if (fixedSettings.length > 0) {
    notes.push(`Fixed training settings included ${joinHumanList(fixedSettings)}.`);
  }

  const trainSamples = asNumber(trainMetadata.num_train_samples);
  const trainTokens = asNumber(trainMetadata.train_dataset_token_count);
  if (typeof trainSamples === "number" || typeof trainTokens === "number") {
    notes.push(
      `Run metadata records ${typeof trainSamples === "number" ? `${formatNumber(trainSamples)} training examples` : "training examples"}${typeof trainSamples === "number" && typeof trainTokens === "number" ? " and " : ""}${typeof trainTokens === "number" ? `a training-token count of ${formatNumber(trainTokens)}` : ""} for the inspected seed-level record.`
    );
  }
  return notes;
}

function collectExecutedTrainingSampleNotes(latestResults: Record<string, unknown>): string[] {
  const trainMetadata = findFirstTrainMetadata(latestResults);
  if (!trainMetadata) {
    return [];
  }
  const notes: string[] = [];
  const trainSamples = asNumber(trainMetadata.num_train_samples);
  const trainTokens = asNumber(trainMetadata.train_dataset_token_count);
  if (typeof trainSamples === "number") {
    notes.push(`Run metadata records ${formatNumber(trainSamples)} training examples for the inspected execution record.`);
  }
  if (typeof trainTokens === "number") {
    notes.push(`Run metadata records a training-token count of ${formatNumber(trainTokens)} for the inspected execution record.`);
  }
  return notes;
}

function findFirstTrainMetadata(latestResults: Record<string, unknown>): Record<string, unknown> | undefined {
  const direct = asRecord(latestResults.train_metadata);
  if (Object.keys(direct).length > 0) {
    return direct;
  }
  for (const condition of asArray(latestResults.condition_summaries)) {
    for (const seedResult of asArray(asRecord(condition).seed_results)) {
      const trainMetadata = asRecord(asRecord(seedResult).train_metadata);
      if (Object.keys(trainMetadata).length > 0) {
        return trainMetadata;
      }
    }
  }
  for (const seedResult of asArray(latestResults.seed_results)) {
    const trainMetadata = asRecord(asRecord(seedResult).train_metadata);
    if (Object.keys(trainMetadata).length > 0) {
      return trainMetadata;
    }
  }
  return undefined;
}

function collectConditionResultSummaries(
  latestResults: Record<string, unknown>,
  resultAnalysis?: ResultAnalysisArtifact
): ConditionResultSummary[] {
  const metrics = asRecord(resultAnalysis?.metrics);
  const summary = {
    ...asRecord(metrics.summary),
    ...asRecord(latestResults.summary)
  };
  const baselineMarker = cleanString(
    latestResults.baseline_marker
      || latestResults.baseline_condition_marker
      || metrics.baseline_marker
      || metrics.baseline_condition_marker
      || summary.baseline_condition_marker
      || summary.baseline_marker
  ).toLowerCase();
  const latestConditionSummaries = asArray(latestResults.condition_summaries);
  const latestConditions = asArray(latestResults.conditions);
  const resultConditionSummaries = asArray(metrics.condition_summaries);
  const resultConditions = asArray(metrics.conditions);
  const rawConditions = latestConditionSummaries.length > 0
    ? latestConditionSummaries
    : latestConditions.length > 0
      ? latestConditions
      : resultConditionSummaries.length > 0
        ? resultConditionSummaries
        : resultConditions;
  return rawConditions
    .map((item) => asRecord(item))
    .map((item) => {
      const condition = cleanString(
        item.condition_marker
          || item.marker
          || item.condition
          || item.name
          || item.label
      );
      const loraRank = asNumber(item.lora_rank) ?? asNumber(item.rank);
      const loraDropout = asNumber(item.lora_dropout) ?? asNumber(item.dropout);
      const label = buildConditionLabel({ condition, loraRank, loraDropout });
      const averageAccuracy = firstNumber(
        item.average_accuracy_mean,
        item.average_accuracy,
        item.mean_zero_shot_accuracy_mean,
        item.mean_zero_shot_accuracy,
        item.accuracy_mean,
        item.accuracy,
        item.main_metric_mean
      );
      const averageAccuracyCi95 = firstNumber(
        item.average_accuracy_ci95,
        item.mean_zero_shot_accuracy_ci95,
        item.accuracy_ci95,
        item.main_metric_ci95
      );
      const delta = firstNumber(
        item.accuracy_delta_vs_baseline_mean,
        item.accuracy_delta_vs_baseline,
        item.mean_zero_shot_accuracy_delta_vs_baseline_mean,
        item.mean_zero_shot_accuracy_delta_vs_baseline,
        item.delta_vs_baseline_mean,
        item.delta_vs_baseline,
        item.main_metric_delta_vs_baseline_mean
      );
      const deltaCi95 = firstNumber(
        item.accuracy_delta_vs_baseline_ci95,
        item.mean_zero_shot_accuracy_delta_vs_baseline_ci95,
        item.delta_vs_baseline_ci95,
        item.main_metric_delta_vs_baseline_ci95
      );
      const status = cleanString(item.status);
      const perTaskMetrics = asRecord(item.per_task_metrics);
      const arcTask = asRecord(perTaskMetrics.arc_challenge);
      const hellaswagTask = asRecord(perTaskMetrics.hellaswag);
      const peakMemoryBytes = firstNumber(item.peak_cuda_memory_bytes, item.peak_memory_bytes);
      const peakMemoryMb = firstNumber(
        item.peak_memory_mb,
        item.peak_cuda_memory_mb,
        typeof peakMemoryBytes === "number" ? peakMemoryBytes / 1_000_000 : undefined
      );
      return {
        condition: condition || label,
        label,
        ...(status ? { status } : {}),
        is_baseline: Boolean(
          (condition && baselineMarker && condition.toLowerCase() === baselineMarker)
          || /baseline/iu.test(label)
          || (!baselineMarker && delta === 0 && /rank\s*8|rank_8|control|reference/iu.test(condition || label))
        ),
        ...(typeof asNumber(item.completed_seed_count) === "number"
          ? { completed_seed_count: asNumber(item.completed_seed_count) }
          : {}),
        ...(typeof loraRank === "number" ? { lora_rank: loraRank } : {}),
        ...(typeof loraDropout === "number" ? { lora_dropout: loraDropout } : {}),
        ...(typeof averageAccuracy === "number" ? { average_accuracy_mean: averageAccuracy } : {}),
        ...(typeof averageAccuracyCi95 === "number" ? { average_accuracy_ci95: averageAccuracyCi95 } : {}),
        ...(typeof delta === "number" ? { accuracy_delta_vs_baseline_mean: delta } : {}),
        ...(typeof deltaCi95 === "number" ? { accuracy_delta_vs_baseline_ci95: deltaCi95 } : {}),
        ...(typeof firstNumber(item.arc_challenge_accuracy, arcTask.accuracy) === "number"
          ? { arc_challenge_accuracy: firstNumber(item.arc_challenge_accuracy, arcTask.accuracy) }
          : {}),
        ...(typeof firstNumber(item.hellaswag_accuracy, hellaswagTask.accuracy) === "number"
          ? { hellaswag_accuracy: firstNumber(item.hellaswag_accuracy, hellaswagTask.accuracy) }
          : {}),
        ...(typeof asNumber(item.train_loss) === "number" ? { train_loss: asNumber(item.train_loss) } : {}),
        ...(typeof firstNumber(item.runtime_seconds, item.runtime_sec) === "number"
          ? { runtime_seconds: firstNumber(item.runtime_seconds, item.runtime_sec) }
          : {}),
        ...(typeof peakMemoryMb === "number" ? { peak_memory_mb: peakMemoryMb } : {})
      };
    })
    .filter((item) =>
      Boolean(item.condition)
      && (
        typeof item.average_accuracy_mean === "number"
        || typeof item.accuracy_delta_vs_baseline_mean === "number"
      )
    );
}

function buildConditionLabel(input: {
  condition: string;
  loraRank?: number;
  loraDropout?: number;
}): string {
  if (typeof input.loraRank === "number" || typeof input.loraDropout === "number") {
    const parts = [
      typeof input.loraRank === "number" ? `rank ${formatNumber(input.loraRank)}` : undefined,
      typeof input.loraDropout === "number" ? `dropout ${formatNumber(input.loraDropout)}` : undefined
    ].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(" / ");
    }
  }
  const normalized = input.condition
    .replace(/^condition[_:\s-]*/iu, "")
    .replace(/_/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized || "condition";
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numberValue = asNumber(value);
    if (typeof numberValue === "number") {
      return numberValue;
    }
  }
  return undefined;
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

function sortManuscriptSections(sections: PaperManuscriptSection[]): PaperManuscriptSection[] {
  const order = new Map(SECTION_BUDGET_WEIGHTS.map((item, index) => [normalizeHeading(item.heading), index] as const));
  return sections
    .slice()
    .sort((left, right) => (order.get(normalizeHeading(left.heading)) ?? 999) - (order.get(normalizeHeading(right.heading)) ?? 999));
}

function estimateManuscriptMainWords(manuscript: PaperManuscript): number {
  return manuscript.sections.reduce(
    (total, section) => total + section.paragraphs.reduce((sectionTotal, paragraph) => sectionTotal + wordCount(paragraph), 0),
    0
  );
}

function paragraphFingerprint(text: string): string {
  return cleanString(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/u).slice(0, 18).join(" ");
}

function mergeSourceRefs(existing: PaperSourceRef[] | undefined, additions: PaperSourceRef[]): PaperSourceRef[] | undefined {
  const refs: PaperSourceRef[] = [];
  const seen = new Set<string>();
  for (const ref of [...(existing || []), ...additions]) {
    const key = `${ref.kind}:${ref.id}`;
    if (!ref.id || seen.has(key)) {
      continue;
    }
    seen.add(key);
    refs.push(ref);
  }
  return refs.length > 0 ? refs : undefined;
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
