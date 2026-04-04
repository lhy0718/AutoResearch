/**
 * Structured paper critique artifact and builder logic for
 * pre-draft and post-draft manuscript gating.
 */

import type { ReviewFinding, ReviewScorecard, ReviewDecision, ReviewArtifactPresence } from "./reviewSystem.js";
import type { MinimumGateCeiling } from "./analysis/paperMinimumGate.js";
import type { TransitionAction, GraphNodeId } from "../types.js";

// ---------------------------------------------------------------------------
// Manuscript type classification
// ---------------------------------------------------------------------------

export type ManuscriptType =
  | "system_validation_note"
  | "research_memo"
  | "paper_scale_candidate"
  | "paper_ready"
  | "blocked_for_paper_scale";

// ---------------------------------------------------------------------------
// Critique decision
// ---------------------------------------------------------------------------

export type CritiqueDecision =
  | "advance"
  | "repair_then_retry"
  | "backtrack_to_implement"
  | "backtrack_to_design"
  | "backtrack_to_hypotheses"
  | "pause_for_human";

export type CritiqueStage = "pre_draft_review" | "post_draft_review";

// ---------------------------------------------------------------------------
// Critique issue
// ---------------------------------------------------------------------------

export type CritiqueCategory =
  | "research_question_clarity"
  | "related_work_depth"
  | "methodological_completeness"
  | "statistical_adequacy"
  | "result_table_quality"
  | "claim_evidence_linkage"
  | "reproducibility"
  | "limitations_honesty"
  | "writing_clarity"
  | "artifact_consistency";

export type CritiqueSeverity = "low" | "medium" | "high" | "blocking";

export interface CritiqueIssue {
  issue_id: string;
  severity: CritiqueSeverity;
  category: CritiqueCategory;
  summary: string;
  evidence: string;
  recommended_fix: string;
  suggested_backtrack_target: GraphNodeId | null;
}

export interface CritiqueCategoryScore {
  category: CritiqueCategory;
  score_1_to_5: number;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Main critique artifact
// ---------------------------------------------------------------------------

export interface PaperCritique {
  stage: CritiqueStage;
  generated_at: string;

  manuscript_type: ManuscriptType;
  overall_decision: CritiqueDecision;
  overall_score: number;
  confidence: number;

  blocking_issues_count: number;
  non_blocking_issues_count: number;

  category_scores: CritiqueCategoryScore[];

  blocking_issues: CritiqueIssue[];
  non_blocking_issues: CritiqueIssue[];

  transition_recommendation: CritiqueDecision;
  paper_readiness_state: ManuscriptType;
  downgrade_reason: string | null;
  manuscript_claim_risk_summary: string;

  needs_additional_experiments: boolean;
  needs_additional_statistics: boolean;
  needs_additional_related_work: boolean;
  needs_design_revision: boolean;
}

// ---------------------------------------------------------------------------
// Issue classification helpers
// ---------------------------------------------------------------------------

const UPSTREAM_EVIDENCE_CATEGORIES = new Set<CritiqueCategory>([
  "methodological_completeness",
  "statistical_adequacy",
  "result_table_quality",
  "claim_evidence_linkage",
  "reproducibility"
]);

const LOCAL_STYLE_CATEGORIES = new Set<CritiqueCategory>([
  "writing_clarity"
]);

export function isUpstreamEvidenceDeficit(issue: CritiqueIssue): boolean {
  if (UPSTREAM_EVIDENCE_CATEGORIES.has(issue.category)) return true;
  if (issue.suggested_backtrack_target !== null) return true;
  return false;
}

export function isLocalStyleIssue(issue: CritiqueIssue): boolean {
  if (LOCAL_STYLE_CATEGORIES.has(issue.category)) return true;
  return false;
}

export function classifyIssueBacktrackTarget(issue: CritiqueIssue): GraphNodeId | null {
  if (issue.suggested_backtrack_target) return issue.suggested_backtrack_target;

  switch (issue.category) {
    case "statistical_adequacy":
    case "result_table_quality":
      return "implement_experiments";
    case "methodological_completeness":
      return "design_experiments";
    case "claim_evidence_linkage":
      return "implement_experiments";
    case "research_question_clarity":
      return "generate_hypotheses";
    case "reproducibility":
      return "implement_experiments";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Pre-draft critique builder
// ---------------------------------------------------------------------------

export interface PreDraftCritiqueInput {
  scorecard: ReviewScorecard;
  decision: ReviewDecision;
  findings: ReviewFinding[];
  presence: ReviewArtifactPresence;
  minimumGateCeiling?: MinimumGateCeiling;
}

export function buildPreDraftCritique(input: PreDraftCritiqueInput): PaperCritique {
  const categoryScores = buildCategoryScoresFromReview(input.scorecard, input.findings, input.presence);
  const issues = buildIssuesFromFindings(input.findings, "pre_draft_review");
  const blockingIssues = issues.filter((i) => i.severity === "blocking" || i.severity === "high");
  const nonBlockingIssues = issues.filter((i) => i.severity !== "blocking" && i.severity !== "high");

  // Manuscript type classification
  const classifiedManuscriptType = classifyManuscriptType(categoryScores, blockingIssues, input.presence);
  const manuscriptType = applyMinimumGateCeiling(
    classifiedManuscriptType,
    input.minimumGateCeiling
  );

  // Upstream deficit flags
  const needsExperiments = blockingIssues.some(
    (i) => i.category === "result_table_quality" || i.category === "statistical_adequacy"
  );
  const needsStatistics = blockingIssues.some((i) => i.category === "statistical_adequacy");
  const needsRelatedWork = categoryScores.find((c) => c.category === "related_work_depth")?.score_1_to_5 ?? 3;
  const needsDesign = blockingIssues.some((i) => i.category === "methodological_completeness");

  // Overall decision
  const overallDecision = computePreDraftDecision(input.decision, blockingIssues, manuscriptType);
  const overallScore = computeOverallScore(categoryScores);
  const confidence = input.decision.confidence;

  // Claim risk
  const claimRisk = buildClaimRiskSummary(blockingIssues, manuscriptType);

  return {
    stage: "pre_draft_review",
    generated_at: new Date().toISOString(),
    manuscript_type: manuscriptType,
    overall_decision: overallDecision,
    overall_score: overallScore,
    confidence,
    blocking_issues_count: blockingIssues.length,
    non_blocking_issues_count: nonBlockingIssues.length,
    category_scores: categoryScores,
    blocking_issues: blockingIssues,
    non_blocking_issues: nonBlockingIssues,
    transition_recommendation: overallDecision,
    paper_readiness_state: manuscriptType,
    downgrade_reason: buildPreDraftDowngradeReason(
      classifiedManuscriptType,
      manuscriptType,
      input.minimumGateCeiling
    ),
    manuscript_claim_risk_summary: claimRisk,
    needs_additional_experiments: needsExperiments,
    needs_additional_statistics: needsStatistics,
    needs_additional_related_work: needsRelatedWork < 2,
    needs_design_revision: needsDesign
  };
}

// ---------------------------------------------------------------------------
// Post-draft critique builder
// ---------------------------------------------------------------------------

export interface PostDraftCritiqueInput {
  preDraftCritique: PaperCritique | null;
  gateDecision: {
    status: "pass" | "warn" | "fail";
    blocking_issue_count: number;
    warning_count: number;
    failure_reasons: string[];
    summary: string[];
  };
  scientificValidation: {
    issues: Array<{ severity: string; category: string; message: string }>;
  };
  submissionValidation: {
    ok: boolean;
    issues: Array<{ message: string; value?: string }>;
  };
  manuscriptSections: string[];
  validationWarningCount: number;
  claimRewriteCount: number;
  evidenceDiagnostics: {
    blocked_by_evidence_insufficiency: boolean;
    missing_evidence_categories: string[];
    thin_sections: string[];
  };
  pageBudgetStatus: string;
  methodStatus: string;
  resultsStatus: string;
  relatedWorkStatus: string;
  discussionStatus: string;
}

export function buildPostDraftCritique(input: PostDraftCritiqueInput): PaperCritique {
  const categoryScores = buildCategoryScoresFromPostDraft(input);
  const issues = buildIssuesFromPostDraft(input);
  const blockingIssues = issues.filter((i) => i.severity === "blocking" || i.severity === "high");
  const nonBlockingIssues = issues.filter((i) => i.severity !== "blocking" && i.severity !== "high");

  // Manuscript type
  const manuscriptType = classifyPostDraftManuscriptType(input, blockingIssues);

  // Upstream deficit flags
  const needsExperiments = input.evidenceDiagnostics.blocked_by_evidence_insufficiency
    || blockingIssues.some((i) => i.category === "result_table_quality");
  const needsStatistics = blockingIssues.some((i) => i.category === "statistical_adequacy");
  const needsRelatedWork = input.relatedWorkStatus === "fail" || input.relatedWorkStatus === "missing";
  const needsDesign = blockingIssues.some((i) => i.category === "methodological_completeness");

  // Compare with pre-draft
  // Overall decision
  const overallDecision = computePostDraftDecision(input, blockingIssues);
  const overallScore = computeOverallScore(categoryScores);
  const confidence = computePostDraftConfidence(input, blockingIssues);

  // Claim risk
  const claimRisk = buildPostDraftClaimRiskSummary(input, blockingIssues);

  return {
    stage: "post_draft_review",
    generated_at: new Date().toISOString(),
    manuscript_type: manuscriptType,
    overall_decision: overallDecision,
    overall_score: overallScore,
    confidence,
    blocking_issues_count: blockingIssues.length,
    non_blocking_issues_count: nonBlockingIssues.length,
    category_scores: categoryScores,
    blocking_issues: blockingIssues,
    non_blocking_issues: nonBlockingIssues,
    transition_recommendation: overallDecision,
    paper_readiness_state: manuscriptType,
    downgrade_reason: manuscriptType !== "paper_ready" && manuscriptType !== "paper_scale_candidate"
      ? `Post-draft critique classified manuscript as ${manuscriptType}.`
      : null,
    manuscript_claim_risk_summary: claimRisk,
    needs_additional_experiments: needsExperiments,
    needs_additional_statistics: needsStatistics,
    needs_additional_related_work: needsRelatedWork,
    needs_design_revision: needsDesign
  };
}

// ---------------------------------------------------------------------------
// Transition mapping
// ---------------------------------------------------------------------------

export function critiqueDecisionToTransitionAction(decision: CritiqueDecision): TransitionAction {
  switch (decision) {
    case "advance": return "advance";
    case "repair_then_retry": return "retry_same";
    case "backtrack_to_implement": return "backtrack_to_implement";
    case "backtrack_to_design": return "backtrack_to_design";
    case "backtrack_to_hypotheses": return "backtrack_to_hypotheses";
    case "pause_for_human": return "pause_for_human";
  }
}

export function critiqueDecisionToTargetNode(decision: CritiqueDecision): GraphNodeId | undefined {
  switch (decision) {
    case "advance": return "write_paper";
    case "repair_then_retry": return undefined;
    case "backtrack_to_implement": return "implement_experiments";
    case "backtrack_to_design": return "design_experiments";
    case "backtrack_to_hypotheses": return "generate_hypotheses";
    case "pause_for_human": return undefined;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildCategoryScoresFromReview(
  scorecard: ReviewScorecard,
  findings: ReviewFinding[],
  presence: ReviewArtifactPresence
): CritiqueCategoryScore[] {
  const dimensionScores = new Map(scorecard.dimensions.map((d) => [d.dimension, d]));

  const findingsForDimension = (dim: string) =>
    findings.filter((f) => f.dimension === dim);

  const claimScore = dimensionScores.get("claim_verification");
  const methodScore = dimensionScores.get("methodology");
  const statsScore = dimensionScores.get("statistics");
  const writingScore = dimensionScores.get("writing_readiness");
  const integrityScore = dimensionScores.get("integrity");

  return [
    {
      category: "research_question_clarity",
      score_1_to_5: clampScore(claimScore?.score_1_to_5 ?? 3),
      rationale: claimScore?.summary || "No claim verification data available."
    },
    {
      category: "related_work_depth",
      score_1_to_5: clampScore(presence.paperSummariesPresent && presence.corpusPresent ? 3 : 1),
      rationale: presence.paperSummariesPresent
        ? "Paper summaries and corpus are present."
        : "Paper summaries or corpus missing; related work depth is limited."
    },
    {
      category: "methodological_completeness",
      score_1_to_5: clampScore(methodScore?.score_1_to_5 ?? 3),
      rationale: methodScore?.summary || "No methodology review data available."
    },
    {
      category: "statistical_adequacy",
      score_1_to_5: clampScore(statsScore?.score_1_to_5 ?? 3),
      rationale: statsScore?.summary || "No statistics review data available."
    },
    {
      category: "result_table_quality",
      score_1_to_5: clampScore(
        presence.metricsPresent && presence.experimentPlanPresent ? 3 :
        presence.metricsPresent ? 2 : 1
      ),
      rationale: presence.metricsPresent
        ? "Metrics artifacts are present."
        : "Metrics artifacts missing; result tables will be weak."
    },
    {
      category: "claim_evidence_linkage",
      score_1_to_5: clampScore(claimScore?.score_1_to_5 ?? 3),
      rationale: `${findingsForDimension("claim_verification").length} finding(s) from claim verification.`
    },
    {
      category: "reproducibility",
      score_1_to_5: clampScore(
        presence.experimentPlanPresent && presence.metricsPresent ? 3 : 2
      ),
      rationale: presence.experimentPlanPresent
        ? "Experiment plan present for reproducibility."
        : "Missing experiment plan limits reproducibility assessment."
    },
    {
      category: "limitations_honesty",
      score_1_to_5: clampScore(integrityScore?.score_1_to_5 ?? 3),
      rationale: integrityScore?.summary || "No integrity review data."
    },
    {
      category: "writing_clarity",
      score_1_to_5: clampScore(writingScore?.score_1_to_5 ?? 3),
      rationale: writingScore?.summary || "No writing readiness data."
    },
    {
      category: "artifact_consistency",
      score_1_to_5: clampScore(
        presence.evidenceStorePresent && presence.hypothesesPresent ? 3 : 2
      ),
      rationale: "Based on artifact presence check."
    }
  ];
}

function buildIssuesFromFindings(findings: ReviewFinding[], stage: CritiqueStage): CritiqueIssue[] {
  return findings.map((f, idx) => {
    const category = mapReviewDimensionToCategory(f.dimension);
    const severity = mapReviewSeverity(f.severity);
    const backtrackTarget = severity === "blocking" || severity === "high"
      ? classifyIssueBacktrackTarget({ issue_id: "", severity, category, summary: f.title, evidence: f.detail, recommended_fix: f.fix_hint || "", suggested_backtrack_target: null })
      : null;

    return {
      issue_id: `${stage}_${idx}_${f.id}`,
      severity,
      category,
      summary: f.title,
      evidence: f.detail,
      recommended_fix: f.fix_hint || "Address the identified issue before proceeding.",
      suggested_backtrack_target: backtrackTarget
    };
  });
}

function mapReviewDimensionToCategory(dim: string): CritiqueCategory {
  switch (dim) {
    case "claim_verification": return "claim_evidence_linkage";
    case "methodology": return "methodological_completeness";
    case "statistics": return "statistical_adequacy";
    case "writing_readiness": return "writing_clarity";
    case "integrity": return "limitations_honesty";
    default: return "artifact_consistency";
  }
}

function mapReviewSeverity(sev: string): CritiqueSeverity {
  switch (sev) {
    case "high": return "blocking";
    case "medium": return "high";
    case "low": return "medium";
    default: return "low";
  }
}

function classifyManuscriptType(
  scores: CritiqueCategoryScore[],
  blockingIssues: CritiqueIssue[],
  presence: ReviewArtifactPresence
): ManuscriptType {
  const avgScore = computeOverallScore(scores);

  // No metrics or experiment plan = system validation at most
  if (!presence.metricsPresent && !presence.experimentPlanPresent) {
    return "system_validation_note";
  }

  // Count missing key artifacts (baseline, result table, richness summary)
  const artifactGaps = [
    !presence.baselineSummaryPresent,
    !presence.resultTablePresent,
    !presence.richnessSummaryPresent
  ].filter(Boolean).length;

  // All three key artifacts missing → blocked
  if (artifactGaps === 3) {
    return "blocked_for_paper_scale";
  }

  // High severity blockers = blocked
  if (blockingIssues.length >= 3) {
    return "blocked_for_paper_scale";
  }

  // Missing core evidence = research memo at best
  if (!presence.evidenceStorePresent || !presence.hypothesesPresent) {
    return "research_memo";
  }

  // Insufficient richness caps at research_memo
  if (presence.richnessReadiness === "insufficient") {
    return avgScore >= 2.0 ? "research_memo" : "system_validation_note";
  }

  // Two or more artifact gaps reduce effective score ceiling
  if (artifactGaps >= 2 && avgScore >= 2.5) {
    return "research_memo";
  }

  if (avgScore >= 3.5 && blockingIssues.length === 0) {
    return "paper_ready";
  }

  if (avgScore >= 2.5 && blockingIssues.length <= 1) {
    return "paper_scale_candidate";
  }

  if (avgScore >= 2.0) {
    return "research_memo";
  }

  return "system_validation_note";
}

function applyMinimumGateCeiling(
  manuscriptType: ManuscriptType,
  minimumGateCeiling?: MinimumGateCeiling
): ManuscriptType {
  if (!minimumGateCeiling || minimumGateCeiling === "unrestricted") {
    return manuscriptType;
  }

  const gateCap = mapMinimumGateCeilingToManuscriptType(minimumGateCeiling);
  const ranking: Record<ManuscriptType, number> = {
    paper_ready: 0,
    paper_scale_candidate: 1,
    research_memo: 2,
    system_validation_note: 3,
    blocked_for_paper_scale: 4
  };

  return ranking[manuscriptType] >= ranking[gateCap] ? manuscriptType : gateCap;
}

function mapMinimumGateCeilingToManuscriptType(ceiling: MinimumGateCeiling): ManuscriptType {
  switch (ceiling) {
    case "blocked_for_paper_scale":
      return "blocked_for_paper_scale";
    case "system_validation_note":
      return "system_validation_note";
    case "research_memo":
      return "research_memo";
    case "unrestricted":
    default:
      return "paper_ready";
  }
}

function classifyPostDraftManuscriptType(
  input: PostDraftCritiqueInput,
  blockingIssues: CritiqueIssue[]
): ManuscriptType {
  if (input.gateDecision.status === "fail") {
    return "blocked_for_paper_scale";
  }

  if (input.evidenceDiagnostics.blocked_by_evidence_insufficiency) {
    return "research_memo";
  }

  if (blockingIssues.length >= 3) {
    return "blocked_for_paper_scale";
  }

  if (
    input.gateDecision.status === "pass" &&
    blockingIssues.length === 0 &&
    input.submissionValidation.ok
  ) {
    return "paper_ready";
  }

  if (blockingIssues.length <= 1) {
    return "paper_scale_candidate";
  }

  return "research_memo";
}

function buildPreDraftDowngradeReason(
  classifiedManuscriptType: ManuscriptType,
  finalManuscriptType: ManuscriptType,
  minimumGateCeiling?: MinimumGateCeiling
): string | null {
  if (finalManuscriptType === "paper_ready" || finalManuscriptType === "paper_scale_candidate") {
    return null;
  }

  if (
    minimumGateCeiling &&
    minimumGateCeiling !== "unrestricted" &&
    classifiedManuscriptType !== finalManuscriptType
  ) {
    return `Minimum evidence gate capped the manuscript at ${finalManuscriptType} (ceiling: ${minimumGateCeiling}).`;
  }

  return `Evidence package classified as ${finalManuscriptType}.`;
}

function computePreDraftDecision(
  reviewDecision: ReviewDecision,
  blockingIssues: CritiqueIssue[],
  manuscriptType: ManuscriptType
): CritiqueDecision {
  // If the review panel already recommends backtrack, honor it
  if (reviewDecision.recommended_transition === "backtrack_to_hypotheses") {
    return "backtrack_to_hypotheses";
  }
  if (reviewDecision.recommended_transition === "backtrack_to_design") {
    return "backtrack_to_design";
  }
  if (reviewDecision.recommended_transition === "backtrack_to_implement") {
    return "backtrack_to_implement";
  }

  // Blocked manuscript types should not advance
  if (manuscriptType === "blocked_for_paper_scale") {
    // Find dominant backtrack target from blocking issues
    return findDominantBacktrack(blockingIssues);
  }

  // System validation notes need upstream work
  if (manuscriptType === "system_validation_note" && blockingIssues.length > 0) {
    return findDominantBacktrack(blockingIssues);
  }

  // Manual block outcome
  if (reviewDecision.outcome === "manual_block") {
    return "pause_for_human";
  }

  return "advance";
}

function computePostDraftDecision(
  input: PostDraftCritiqueInput,
  blockingIssues: CritiqueIssue[]
): CritiqueDecision {
  // Gate failure means serious problems
  if (input.gateDecision.status === "fail") {
    const evidenceBlocked = input.evidenceDiagnostics.blocked_by_evidence_insufficiency;
    if (evidenceBlocked) {
      return findDominantBacktrack(blockingIssues);
    }
    return "repair_then_retry";
  }

  // Check for upstream evidence deficits among blocking issues
  const upstreamIssues = blockingIssues.filter(isUpstreamEvidenceDeficit);
  if (upstreamIssues.length >= 2) {
    return findDominantBacktrack(upstreamIssues);
  }

  // Single upstream issue that's severe enough
  if (upstreamIssues.length === 1 && upstreamIssues[0].severity === "blocking") {
    return findDominantBacktrack(upstreamIssues);
  }

  // Moderate issues that don't need upstream work
  if (blockingIssues.length > 0 && upstreamIssues.length === 0) {
    return "repair_then_retry";
  }

  return "advance";
}

function findDominantBacktrack(issues: CritiqueIssue[]): CritiqueDecision {
  const targets = issues
    .map((i) => classifyIssueBacktrackTarget(i))
    .filter((t): t is GraphNodeId => t !== null);

  if (targets.length === 0) return "pause_for_human";

  // Count targets
  const counts = new Map<GraphNodeId, number>();
  for (const t of targets) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  // Prefer the most severe/common target
  // Priority: hypotheses < design < implement (prefer fixing closest upstream)
  const priority: GraphNodeId[] = ["implement_experiments", "design_experiments", "generate_hypotheses"];
  for (const node of priority) {
    if (counts.has(node)) {
      switch (node) {
        case "implement_experiments": return "backtrack_to_implement";
        case "design_experiments": return "backtrack_to_design";
        case "generate_hypotheses": return "backtrack_to_hypotheses";
      }
    }
  }

  return "pause_for_human";
}

function computeOverallScore(scores: CritiqueCategoryScore[]): number {
  if (scores.length === 0) return 1;
  const sum = scores.reduce((acc, s) => acc + s.score_1_to_5, 0);
  return Math.round((sum / scores.length) * 100) / 100;
}

function computePostDraftConfidence(input: PostDraftCritiqueInput, blockingIssues: CritiqueIssue[]): number {
  let confidence = 0.5;
  if (input.gateDecision.status === "pass") confidence += 0.2;
  if (input.submissionValidation.ok) confidence += 0.1;
  if (blockingIssues.length === 0) confidence += 0.1;
  if (input.validationWarningCount === 0) confidence += 0.05;
  if (input.evidenceDiagnostics.blocked_by_evidence_insufficiency) confidence -= 0.2;
  return Math.max(0.1, Math.min(1.0, Math.round(confidence * 100) / 100));
}

function buildClaimRiskSummary(blockingIssues: CritiqueIssue[], manuscriptType: ManuscriptType): string {
  if (blockingIssues.length === 0 && manuscriptType === "paper_ready") {
    return "No major claim risks identified.";
  }
  const risks = blockingIssues.slice(0, 3).map((i) => i.summary);
  const prefix = manuscriptType === "blocked_for_paper_scale"
    ? "Evidence package has critical gaps: "
    : manuscriptType === "system_validation_note"
      ? "Evidence is at system-validation level: "
      : "Notable risks: ";
  return `${prefix}${risks.join("; ") || "see non-blocking issues for details"}.`;
}

function buildPostDraftClaimRiskSummary(input: PostDraftCritiqueInput, blockingIssues: CritiqueIssue[]): string {
  const parts: string[] = [];
  if (input.evidenceDiagnostics.blocked_by_evidence_insufficiency) {
    parts.push("evidence insufficiency detected");
  }
  if (input.evidenceDiagnostics.missing_evidence_categories.length > 0) {
    parts.push(`missing evidence in: ${input.evidenceDiagnostics.missing_evidence_categories.join(", ")}`);
  }
  if (input.claimRewriteCount > 0) {
    parts.push(`${input.claimRewriteCount} over-strong claim(s) were softened`);
  }
  if (blockingIssues.length > 0) {
    parts.push(`${blockingIssues.length} blocking issue(s) remain`);
  }
  return parts.length > 0 ? parts.join("; ") + "." : "No major claim risks in the drafted manuscript.";
}

function buildCategoryScoresFromPostDraft(input: PostDraftCritiqueInput): CritiqueCategoryScore[] {
  const statusToScore = (s: string): number => {
    switch (s) {
      case "pass": case "ok": case "rich": return 4;
      case "warn": case "thin": return 2;
      case "fail": case "missing": return 1;
      default: return 3;
    }
  };

  return [
    {
      category: "research_question_clarity",
      score_1_to_5: input.gateDecision.status === "fail" ? 2 : 3,
      rationale: "Inferred from gate decision status."
    },
    {
      category: "related_work_depth",
      score_1_to_5: clampScore(statusToScore(input.relatedWorkStatus)),
      rationale: `Related work status: ${input.relatedWorkStatus}.`
    },
    {
      category: "methodological_completeness",
      score_1_to_5: clampScore(statusToScore(input.methodStatus)),
      rationale: `Method completeness status: ${input.methodStatus}.`
    },
    {
      category: "statistical_adequacy",
      score_1_to_5: clampScore(statusToScore(input.resultsStatus)),
      rationale: `Results richness status: ${input.resultsStatus}.`
    },
    {
      category: "result_table_quality",
      score_1_to_5: clampScore(
        input.evidenceDiagnostics.blocked_by_evidence_insufficiency ? 1 :
        input.evidenceDiagnostics.thin_sections.length > 0 ? 2 : 3
      ),
      rationale: input.evidenceDiagnostics.blocked_by_evidence_insufficiency
        ? "Evidence insufficiency blocks result table quality."
        : `${input.evidenceDiagnostics.thin_sections.length} thin section(s).`
    },
    {
      category: "claim_evidence_linkage",
      score_1_to_5: clampScore(
        input.validationWarningCount === 0 ? 4 :
        input.validationWarningCount <= 2 ? 3 : 2
      ),
      rationale: `${input.validationWarningCount} validation warning(s) for claim-evidence alignment.`
    },
    {
      category: "reproducibility",
      score_1_to_5: 3,
      rationale: "Reproducibility assessed at pre-draft stage; maintained here."
    },
    {
      category: "limitations_honesty",
      score_1_to_5: clampScore(statusToScore(input.discussionStatus)),
      rationale: `Discussion richness status: ${input.discussionStatus}.`
    },
    {
      category: "writing_clarity",
      score_1_to_5: clampScore(
        input.gateDecision.status === "pass" ? 4 :
        input.gateDecision.status === "warn" ? 3 : 2
      ),
      rationale: `Writing clarity inferred from gate decision: ${input.gateDecision.status}.`
    },
    {
      category: "artifact_consistency",
      score_1_to_5: clampScore(
        input.submissionValidation.ok ? 4 : 2
      ),
      rationale: input.submissionValidation.ok
        ? "Submission validation passed."
        : `Submission validation failed with ${input.submissionValidation.issues.length} issue(s).`
    }
  ];
}

function buildIssuesFromPostDraft(input: PostDraftCritiqueInput): CritiqueIssue[] {
  const issues: CritiqueIssue[] = [];
  let idx = 0;

  // Evidence insufficiency → blocking
  if (input.evidenceDiagnostics.blocked_by_evidence_insufficiency) {
    issues.push({
      issue_id: `post_draft_${idx++}`,
      severity: "blocking",
      category: "result_table_quality",
      summary: "Evidence insufficiency blocks manuscript quality.",
      evidence: `Missing evidence categories: ${input.evidenceDiagnostics.missing_evidence_categories.join(", ") || "unspecified"}.`,
      recommended_fix: "Run additional experiments to cover missing evidence categories.",
      suggested_backtrack_target: "implement_experiments"
    });
  }

  // Thin sections
  for (const section of input.evidenceDiagnostics.thin_sections) {
    issues.push({
      issue_id: `post_draft_${idx++}`,
      severity: "high",
      category: "result_table_quality",
      summary: `Section '${section}' is thin on evidence.`,
      evidence: `The '${section}' section lacks sufficient supporting data.`,
      recommended_fix: "Add experimental results or data to strengthen this section.",
      suggested_backtrack_target: "implement_experiments"
    });
  }

  // Gate failure reasons
  for (const reason of input.gateDecision.failure_reasons) {
    issues.push({
      issue_id: `post_draft_${idx++}`,
      severity: "blocking",
      category: "artifact_consistency",
      summary: reason,
      evidence: "Scientific quality gate failure.",
      recommended_fix: "Address the gate failure condition.",
      suggested_backtrack_target: null
    });
  }

  // Scientific validation issues
  for (const item of input.scientificValidation.issues) {
    const category = mapScientificIssueCategoryToCritiqueCategory(item.category);
    const severity: CritiqueSeverity = item.severity === "error" ? "high"
      : item.severity === "warning" ? "medium" : "low";
    issues.push({
      issue_id: `post_draft_${idx++}`,
      severity,
      category,
      summary: item.message,
      evidence: `Scientific validation: ${item.category}.`,
      recommended_fix: "Fix the identified scientific validation issue.",
      suggested_backtrack_target: null
    });
  }

  // Submission validation issues (style/writing)
  if (!input.submissionValidation.ok) {
    for (const item of input.submissionValidation.issues) {
      issues.push({
        issue_id: `post_draft_${idx++}`,
        severity: "medium",
        category: "writing_clarity",
        summary: item.message,
        evidence: item.value || "Submission validation check.",
        recommended_fix: "Fix the submission formatting issue.",
        suggested_backtrack_target: null
      });
    }
  }

  // Method/results status issues
  if (input.methodStatus === "fail" || input.methodStatus === "missing") {
    issues.push({
      issue_id: `post_draft_${idx++}`,
      severity: "blocking",
      category: "methodological_completeness",
      summary: "Method section is incomplete or missing.",
      evidence: `Method status: ${input.methodStatus}.`,
      recommended_fix: "Revise experiment design to produce adequate method content.",
      suggested_backtrack_target: "design_experiments"
    });
  }

  if (input.resultsStatus === "fail" || input.resultsStatus === "missing") {
    issues.push({
      issue_id: `post_draft_${idx++}`,
      severity: "blocking",
      category: "statistical_adequacy",
      summary: "Results section is inadequate.",
      evidence: `Results status: ${input.resultsStatus}.`,
      recommended_fix: "Run additional experiments or statistical analyses.",
      suggested_backtrack_target: "implement_experiments"
    });
  }

  return issues;
}

function mapScientificIssueCategoryToCritiqueCategory(cat: string): CritiqueCategory {
  const lower = cat.toLowerCase();
  if (lower.includes("method")) return "methodological_completeness";
  if (lower.includes("stat") || lower.includes("result")) return "statistical_adequacy";
  if (lower.includes("claim") || lower.includes("evidence")) return "claim_evidence_linkage";
  if (lower.includes("related") || lower.includes("literature")) return "related_work_depth";
  if (lower.includes("reproducib")) return "reproducibility";
  if (lower.includes("limit")) return "limitations_honesty";
  if (lower.includes("writ") || lower.includes("format")) return "writing_clarity";
  return "artifact_consistency";
}

function clampScore(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}
