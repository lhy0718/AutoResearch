import { ExperimentDesignCandidate } from "./analysis/researchPlanning.js";
import { ObjectiveMetricProfile } from "./objectiveMetric.js";

export type DesignExperimentsPanelReviewerId =
  | "designer"
  | "feasibility_reviewer"
  | "statistical_reviewer"
  | "ops_capacity_planner";

export interface DesignExperimentsPanelReview {
  reviewer_id: DesignExperimentsPanelReviewerId;
  reviewer_label: string;
  candidate_id: string;
  score_1_to_5: number;
  hard_block: boolean;
  summary: string;
  findings: string[];
}

export interface DesignExperimentsPanelCandidateScore {
  candidate_id: string;
  blocked_by: DesignExperimentsPanelReviewerId[];
  feasibility_score: number;
  statistical_score: number;
  ops_fit_score: number;
  total_score: number;
}

export interface DesignExperimentsPanelSelection {
  selected_candidate_id: string;
  mode: "best_non_blocked" | "all_blocked_fallback";
  rejected_candidate_ids: string[];
  rationale: string[];
  scores: DesignExperimentsPanelCandidateScore[];
}

export interface DesignExperimentsPanelResult {
  reviews: DesignExperimentsPanelReview[];
  selection: DesignExperimentsPanelSelection;
  selected: ExperimentDesignCandidate;
}

export function runDesignExperimentsPanel(input: {
  candidates: ExperimentDesignCandidate[];
  objectiveProfile: ObjectiveMetricProfile;
  managedBundleSupported: boolean;
}): DesignExperimentsPanelResult {
  const reviews: DesignExperimentsPanelReview[] = [];

  for (const candidate of input.candidates) {
    reviews.push(buildDesignerReview(candidate));
    reviews.push(buildFeasibilityReview(candidate));
    reviews.push(buildStatisticalReview(candidate, input.objectiveProfile));
    reviews.push(buildOpsCapacityReview(candidate, input.managedBundleSupported));
  }

  const scores = input.candidates.map((candidate) =>
    buildCandidateScore(candidate, reviews)
  );
  const nonBlocked = scores.filter((item) => item.blocked_by.length === 0);
  const selectionPool = nonBlocked.length > 0 ? nonBlocked : scores;
  const chosenScore = [...selectionPool].sort(compareScores)[0] || scores[0];
  const selected = input.candidates.find((candidate) => candidate.id === chosenScore?.candidate_id) || input.candidates[0];
  const mode = nonBlocked.length > 0 ? "best_non_blocked" : "all_blocked_fallback";

  return {
    reviews,
    selection: {
      selected_candidate_id: selected.id,
      mode,
      rejected_candidate_ids: scores
        .filter((item) => item.candidate_id !== selected.id)
        .map((item) => item.candidate_id),
      rationale: buildSelectionRationale(selected, chosenScore, mode),
      scores
    },
    selected
  };
}

function buildDesignerReview(candidate: ExperimentDesignCandidate): DesignExperimentsPanelReview {
  const completeness =
    (candidate.datasets.length > 0 ? 1 : 0) +
    (candidate.metrics.length > 0 ? 1 : 0) +
    (candidate.baselines.length > 0 ? 1 : 0) +
    (candidate.implementation_notes.length > 0 ? 1 : 0) +
    (candidate.evaluation_steps.length > 0 ? 1 : 0);
  return {
    reviewer_id: "designer",
    reviewer_label: "Designer",
    candidate_id: candidate.id,
    score_1_to_5: Math.max(1, Math.min(5, completeness)),
    hard_block: false,
    summary:
      completeness >= 4
        ? "The plan is structurally complete enough for panel review."
        : "The plan is underspecified and will likely need reviewer corrections.",
    findings: uniqueStrings([
      candidate.plan_summary,
      candidate.datasets.length > 0
        ? `${candidate.datasets.length} dataset(s) were specified.`
        : "No datasets were specified.",
      candidate.metrics.length > 0
        ? `${candidate.metrics.length} metric(s) were specified.`
        : "No metrics were specified."
    ]).slice(0, 3)
  };
}

function buildFeasibilityReview(candidate: ExperimentDesignCandidate): DesignExperimentsPanelReview {
  const missingDatasets = candidate.datasets.length === 0;
  const missingImplementation = candidate.implementation_notes.length === 0;
  const missingEvaluation = candidate.evaluation_steps.length === 0;
  const hardBlock = missingDatasets || missingImplementation || missingEvaluation;
  const rawScore =
    5 -
    (missingDatasets ? 2 : 0) -
    (missingImplementation ? 2 : 0) -
    (missingEvaluation ? 1 : 0) -
    (candidate.risks.length > 4 ? 1 : 0);
  return {
    reviewer_id: "feasibility_reviewer",
    reviewer_label: "Feasibility reviewer",
    candidate_id: candidate.id,
    score_1_to_5: clampScore(rawScore),
    hard_block: hardBlock,
    summary: hardBlock
      ? "The plan is not implementation-ready because essential execution details are missing."
      : "The plan looks feasible enough to hand off for implementation.",
    findings: uniqueStrings([
      missingDatasets ? "Datasets are missing." : "",
      missingImplementation ? "Implementation notes are missing." : "",
      missingEvaluation ? "Evaluation steps are missing." : "",
      candidate.risks[0] || ""
    ]).slice(0, 4)
  };
}

function buildStatisticalReview(
  candidate: ExperimentDesignCandidate,
  objectiveProfile: ObjectiveMetricProfile
): DesignExperimentsPanelReview {
  const preferredMetrics = uniqueStrings([
    objectiveProfile.primaryMetric || "",
    ...(objectiveProfile.preferredMetricKeys || [])
  ]).map((item) => item.toLowerCase());
  const metricMatch = candidate.metrics.some((metric) => preferredMetrics.includes(metric.toLowerCase()));
  const primaryMetricMatch = candidate.metrics
    .slice(0, 2)
    .some((metric) => preferredMetrics.includes(metric.toLowerCase()));
  const objectiveDrift = isLikelyObjectiveDrift(candidate, objectiveProfile, preferredMetrics, primaryMetricMatch);
  const hardBlock =
    candidate.metrics.length === 0 ||
    candidate.baselines.length === 0 ||
    candidate.evaluation_steps.length === 0 ||
    objectiveDrift;
  const rawScore =
    2 +
    (candidate.metrics.length > 0 ? 1 : 0) +
    (candidate.baselines.length > 0 ? 1 : 0) +
    (candidate.evaluation_steps.length > 0 ? 1 : 0) +
    (metricMatch ? 1 : 0) -
    (objectiveDrift ? 2 : 0);
  return {
    reviewer_id: "statistical_reviewer",
    reviewer_label: "Statistical reviewer",
    candidate_id: candidate.id,
    score_1_to_5: clampScore(rawScore),
    hard_block: hardBlock,
    summary: hardBlock
      ? objectiveDrift
        ? "The plan drifts from the objective into a reporting-integrity audit and cannot support the requested model-quality comparison."
        : "The plan cannot support a reliable comparison because metrics, baselines, or evaluation steps are incomplete."
      : metricMatch
        ? "The plan is statistically aligned with the objective metric and comparison requirements."
        : "The plan is viable, but the metric set is only loosely aligned with the objective profile.",
    findings: uniqueStrings([
      objectiveDrift
        ? "The primary metric surface is report-gating or claim-integrity focused while the objective is a model-quality metric."
        : "",
      metricMatch
        ? `Objective-aligned metric found: ${candidate.metrics.find((metric) => preferredMetrics.includes(metric.toLowerCase()))}.`
        : "No explicit objective-aligned metric was found.",
      candidate.baselines.length > 0
        ? `${candidate.baselines.length} baseline(s) were specified.`
        : "No baselines were specified.",
      candidate.evaluation_steps[0] || ""
    ]).slice(0, 3)
  };
}

function isLikelyObjectiveDrift(
  candidate: ExperimentDesignCandidate,
  objectiveProfile: ObjectiveMetricProfile,
  preferredMetrics: string[],
  primaryMetricMatch: boolean
): boolean {
  const objectiveText = uniqueStrings([
    objectiveProfile.primaryMetric || "",
    objectiveProfile.raw || "",
    ...preferredMetrics
  ]).join(" ").toLowerCase().replace(/[_-]+/g, " ");
  const candidateText = [
    candidate.title,
    candidate.plan_summary,
    candidate.metrics.slice(0, 3).join(" "),
    candidate.evaluation_steps.slice(0, 2).join(" ")
  ].join(" ").toLowerCase();
  const titleSummaryText = [candidate.title, candidate.plan_summary].join(" ").toLowerCase();
  const modelQualityObjective =
    /\b(accuracy|pass@?1|f1|auc|rouge|bleu|mmlu|hellaswag|arc|gsm8k|benchmark|score|quality)\b/u.test(objectiveText);
  const reportingAuditSurface =
    /\b(report|reporting|renderer|rendering|claim|claims|gating|gate|integrity|mismatch|downgrade|visibility|audit)\b/u.test(candidateText);
  const explicitlyNotModelQuality =
    /\bnot\s+a\s+model[- ]quality\s+experiment\b/u.test(candidateText) ||
    /\bdoes\s+not\s+answer\s+the\s+model[- ]quality\s+hypothesis\b/u.test(candidateText);
  const modelExperimentSurface =
    /\b(lora|rank|dropout|factorial|adapter|arc|hellaswag|training condition|train\/eval)\b/u.test(candidateText);
  const primaryQualityMetric = candidate.metrics
    .slice(0, 2)
    .some((metric) => /\b(avg accuracy|mean accuracy|accuracy|f1|auc|rouge|bleu|pass@?1|delta.*baseline)\b/u.test(metric.toLowerCase().replace(/[_-]+/g, " ")));
  const primaryAuditFraming =
    /\b(report|reporting|claim|gating|gate|integrity|mismatch|downgrade|audit)\b/u.test(titleSummaryText) &&
    !primaryQualityMetric;

  return (
    modelQualityObjective &&
    reportingAuditSurface &&
    (explicitlyNotModelQuality ||
      primaryAuditFraming ||
      (!modelExperimentSurface && !primaryQualityMetric && !primaryMetricMatch))
  );
}

function buildOpsCapacityReview(
  candidate: ExperimentDesignCandidate,
  managedBundleSupported: boolean
): DesignExperimentsPanelReview {
  const datasetLoad = candidate.datasets.length;
  const implementationLoad = candidate.implementation_notes.length;
  const resourceNotesPresent = candidate.resource_notes.length > 0;
  const hardBlock = datasetLoad > 6 || (!resourceNotesPresent && datasetLoad > 3);
  const rawScore =
    5 -
    (datasetLoad > 4 ? 1 : 0) -
    (datasetLoad > 6 ? 2 : 0) -
    (implementationLoad > 6 ? 1 : 0) -
    (!resourceNotesPresent ? 1 : 0) +
    (managedBundleSupported ? 1 : 0);
  return {
    reviewer_id: "ops_capacity_planner",
    reviewer_label: "Ops-capacity planner",
    candidate_id: candidate.id,
    score_1_to_5: clampScore(rawScore),
    hard_block: hardBlock,
    summary: hardBlock
      ? "The plan is oversized for the current execution capacity."
      : managedBundleSupported
        ? "The plan fits the current execution model and can be scheduled within the managed execution envelope."
        : "The plan is operationally acceptable, but it will rely on plain execution rather than the managed bundle.",
    findings: uniqueStrings([
      resourceNotesPresent ? candidate.resource_notes[0] || "" : "No resource notes were specified.",
      managedBundleSupported ? "Managed real_execution bundle support is available." : "Managed real_execution bundle support is unavailable.",
      datasetLoad > 0 ? `${datasetLoad} dataset(s) are in scope.` : "No datasets are in scope."
    ]).slice(0, 3)
  };
}

function buildCandidateScore(
  candidate: ExperimentDesignCandidate,
  reviews: DesignExperimentsPanelReview[]
): DesignExperimentsPanelCandidateScore {
  const candidateReviews = reviews.filter((review) => review.candidate_id === candidate.id);
  const feasibilityScore = candidateReviews.find((review) => review.reviewer_id === "feasibility_reviewer")?.score_1_to_5 || 0;
  const statisticalScore = candidateReviews.find((review) => review.reviewer_id === "statistical_reviewer")?.score_1_to_5 || 0;
  const opsFitScore = candidateReviews.find((review) => review.reviewer_id === "ops_capacity_planner")?.score_1_to_5 || 0;
  const blockedBy = candidateReviews
    .filter((review) => review.hard_block)
    .map((review) => review.reviewer_id);

  return {
    candidate_id: candidate.id,
    blocked_by: blockedBy,
    feasibility_score: feasibilityScore,
    statistical_score: statisticalScore,
    ops_fit_score: opsFitScore,
    total_score: Number((feasibilityScore * 0.4 + statisticalScore * 0.4 + opsFitScore * 0.2).toFixed(2))
  };
}

function buildSelectionRationale(
  candidate: ExperimentDesignCandidate,
  score: DesignExperimentsPanelCandidateScore | undefined,
  mode: DesignExperimentsPanelSelection["mode"]
): string[] {
  return uniqueStrings([
    mode === "all_blocked_fallback"
      ? "All candidates were hard-blocked, so the panel selected the least-bad option to preserve a valid plan output."
      : "The panel selected the highest-scoring non-blocked candidate.",
    score
      ? `Scores - feasibility ${score.feasibility_score}, statistics ${score.statistical_score}, ops ${score.ops_fit_score}.`
      : "",
    `Selected design: ${candidate.title}.`
  ]).slice(0, 3);
}

function compareScores(
  left: DesignExperimentsPanelCandidateScore,
  right: DesignExperimentsPanelCandidateScore
): number {
  return (
    right.total_score - left.total_score ||
    left.blocked_by.length - right.blocked_by.length ||
    right.statistical_score - left.statistical_score ||
    left.candidate_id.localeCompare(right.candidate_id)
  );
}

function clampScore(value: number): number {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
