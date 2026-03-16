/**
 * Structured paper critique artifact, venue-style profiles,
 * and builder logic for pre-draft and post-draft manuscript gating.
 */

import type { ReviewFinding, ReviewScorecard, ReviewDecision, ReviewArtifactPresence } from "./reviewSystem.js";
import type { TransitionAction, GraphNodeId } from "../types.js";

// ---------------------------------------------------------------------------
// Venue style types
// ---------------------------------------------------------------------------

export type VenueStyleId =
  | "acl"
  | "aaai"
  | "icml"
  | "neurips"
  | "iclr"
  | "generic_nlp_conference"
  | "generic_ml_conference"
  | "generic_cs_paper";

export const VENUE_STYLE_IDS: readonly VenueStyleId[] = [
  "acl",
  "aaai",
  "icml",
  "neurips",
  "iclr",
  "generic_nlp_conference",
  "generic_ml_conference",
  "generic_cs_paper"
] as const;

export const DEFAULT_VENUE_STYLE: VenueStyleId = "generic_cs_paper";

export interface VenueStyleProfile {
  id: VenueStyleId;
  label: string;
  title_style: string;
  abstract_style: string;
  intro_framing: string;
  section_emphasis: string[];
  related_work_placement: string;
  experiment_presentation: string;
  discussion_limitations_emphasis: string;
  appendix_policy: string;
  tone_claim_discipline: string;
  expected_strengths: string[];
}

export const VENUE_PROFILES: Readonly<Record<VenueStyleId, VenueStyleProfile>> = {
  acl: {
    id: "acl",
    label: "ACL / *ACL Venue",
    title_style: "Concise, task-focused title. Name the task and approach clearly.",
    abstract_style: "Structured: problem → approach → key result → takeaway. 150-250 words.",
    intro_framing: "Motivate from a concrete NLP/CL task. Position contribution clearly within 1-2 paragraphs.",
    section_emphasis: ["introduction", "related_work", "method", "experiments", "analysis", "limitations"],
    related_work_placement: "Dedicated Related Work section, typically after Introduction. Deep positioning against task-specific prior work.",
    experiment_presentation: "Task-oriented evaluation with dataset/metric tables. Error analysis and ablation expected.",
    discussion_limitations_emphasis: "Explicit Limitations section required. Discuss scope, data bias, generalization limits.",
    appendix_policy: "Appendix allowed and encouraged for supplementary experiments, prompts, dataset details.",
    tone_claim_discipline: "Moderate claim strength. Prefer 'our approach achieves/shows' over 'we prove/demonstrate superiority'.",
    expected_strengths: ["task motivation", "error analysis", "linguistic insight", "reproducibility details", "limitation honesty"]
  },
  aaai: {
    id: "aaai",
    label: "AAAI Conference",
    title_style: "Clear, broad-audience title. Accessible to general AI researchers.",
    abstract_style: "Concise problem statement, method summary, key quantitative result. 150-200 words.",
    intro_framing: "Broad AI motivation narrowing to specific contribution. Crisp contribution list.",
    section_emphasis: ["introduction", "related_work", "method", "experiments", "conclusion"],
    related_work_placement: "Typically after Introduction or before Conclusion. Balanced breadth.",
    experiment_presentation: "Balanced method description and empirical evaluation. Clear baselines.",
    discussion_limitations_emphasis: "Brief discussion expected. Limitations can be in Conclusion or separate section.",
    appendix_policy: "Appendix allowed but space-constrained. Prioritize main-body clarity.",
    tone_claim_discipline: "Clear, measured claims. Avoid superlatives without strong evidence.",
    expected_strengths: ["broad accessibility", "crisp contributions", "balanced method+empirics", "clear baselines"]
  },
  icml: {
    id: "icml",
    label: "ICML Conference",
    title_style: "Method-focused title. Can be technical. Name the algorithm/framework.",
    abstract_style: "Problem → method → theoretical/empirical contribution. Concise, ~200 words.",
    intro_framing: "Methodological motivation. What gap does this method fill? Formal problem statement welcome.",
    section_emphasis: ["introduction", "method", "theoretical_analysis", "experiments", "related_work", "conclusion"],
    related_work_placement: "Often after experiments or before conclusion. Concise but thorough on methodological lineage.",
    experiment_presentation: "Rigorous experimental protocol. Multiple datasets, ablations, statistical significance, hyperparameter sensitivity.",
    discussion_limitations_emphasis: "Discussion of method limitations expected. Broader impact statement may be required.",
    appendix_policy: "Extended appendix common for proofs, additional experiments, implementation details.",
    tone_claim_discipline: "Precise technical claims. Support with theory or comprehensive experiments.",
    expected_strengths: ["methodological rigor", "ablations", "statistical clarity", "theoretical grounding"]
  },
  neurips: {
    id: "neurips",
    label: "NeurIPS Conference",
    title_style: "Can be creative or technical. Should convey the core idea succinctly.",
    abstract_style: "Clear problem setup, approach, and key finding. 200-250 words.",
    intro_framing: "Motivate from ML perspective. Can start with broader scientific question. Position clearly.",
    section_emphasis: ["introduction", "method", "experiments", "analysis", "broader_impact", "conclusion"],
    related_work_placement: "Flexible placement. Can be integrated into introduction or standalone. Thorough positioning expected.",
    experiment_presentation: "Comprehensive evaluation. Multiple baselines, ablation studies, computational cost analysis. Reproducibility checklist.",
    discussion_limitations_emphasis: "Broader Impact section expected. Limitations discussion valued highly.",
    appendix_policy: "Supplementary material expected for additional experiments, proofs, reproducibility details.",
    tone_claim_discipline: "Precise and measured. Clearly distinguish main claims from observations.",
    expected_strengths: ["experimental thoroughness", "reproducibility", "broader impact awareness", "ablation depth"]
  },
  iclr: {
    id: "iclr",
    label: "ICLR Conference",
    title_style: "Clear and informative. Should convey the learning-related contribution.",
    abstract_style: "Problem framing, approach, key empirical/theoretical results. ~200 words.",
    intro_framing: "Representation-learning or generalization perspective. Clear research question.",
    section_emphasis: ["introduction", "method", "experiments", "analysis", "related_work", "conclusion"],
    related_work_placement: "Typically after introduction or before conclusion. Positioning against representation-learning literature.",
    experiment_presentation: "Strong empirical evaluation. Multiple tasks/domains, ablation, analysis of learned representations.",
    discussion_limitations_emphasis: "Limitations expected. Societal impact discussion may be required.",
    appendix_policy: "Supplementary material common. Additional experiments and implementation details.",
    tone_claim_discipline: "Evidence-based claims. Avoid unfounded generalization beyond evaluated settings.",
    expected_strengths: ["empirical rigor", "representation analysis", "cross-domain evaluation", "clear research question"]
  },
  generic_nlp_conference: {
    id: "generic_nlp_conference",
    label: "Generic NLP Conference",
    title_style: "Task-focused. Name the NLP task and approach.",
    abstract_style: "Problem → approach → key metric improvement → brief takeaway. 150-250 words.",
    intro_framing: "NLP task motivation. Concrete examples when possible.",
    section_emphasis: ["introduction", "related_work", "method", "experiments", "analysis", "limitations"],
    related_work_placement: "Dedicated section after introduction. Task-specific positioning.",
    experiment_presentation: "Standard NLP evaluation: dataset, metric, baseline comparison, error analysis.",
    discussion_limitations_emphasis: "Limitations section expected. Discuss data/task scope limits.",
    appendix_policy: "Appendix for additional results, examples, dataset details.",
    tone_claim_discipline: "Moderate claims grounded in experimental results.",
    expected_strengths: ["task relevance", "error analysis", "baseline comparison", "data transparency"]
  },
  generic_ml_conference: {
    id: "generic_ml_conference",
    label: "Generic ML Conference",
    title_style: "Method or contribution-focused. Technical audience.",
    abstract_style: "Problem statement, method, key result. ~200 words.",
    intro_framing: "ML problem framing. Clear gap identification.",
    section_emphasis: ["introduction", "method", "experiments", "analysis", "related_work", "conclusion"],
    related_work_placement: "Flexible. Can be early or late. Cover methodological ancestors.",
    experiment_presentation: "Multiple baselines, ablation studies, statistical reporting.",
    discussion_limitations_emphasis: "Limitations and future work expected.",
    appendix_policy: "Supplementary material for additional experiments and proofs.",
    tone_claim_discipline: "Precise claims backed by experiments. Distinguish contributions from observations.",
    expected_strengths: ["methodological clarity", "ablations", "statistical rigor", "reproducibility"]
  },
  generic_cs_paper: {
    id: "generic_cs_paper",
    label: "Generic CS Paper",
    title_style: "Clear and descriptive. Accessible to broad CS audience.",
    abstract_style: "Problem, approach, result. 150-250 words.",
    intro_framing: "Motivate from a practical or theoretical CS problem.",
    section_emphasis: ["introduction", "related_work", "method", "evaluation", "conclusion"],
    related_work_placement: "Dedicated section, typically after introduction.",
    experiment_presentation: "Clear evaluation with appropriate baselines and metrics.",
    discussion_limitations_emphasis: "Discuss limitations and future directions.",
    appendix_policy: "Optional appendix for supplementary material.",
    tone_claim_discipline: "Balanced claims. Do not overstate beyond demonstrated results.",
    expected_strengths: ["clarity", "sound evaluation", "practical relevance", "honest limitations"]
  }
};

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
  | "artifact_consistency"
  | "venue_style_fit";

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
  target_venue_style: VenueStyleId;

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

  venue_style_notes: string;
  style_mismatches: string[];
  style_repairable_locally: boolean;
}

// ---------------------------------------------------------------------------
// Venue style resolution
// ---------------------------------------------------------------------------

export function resolveVenueStyle(value: string | undefined | null): VenueStyleId {
  if (!value) return DEFAULT_VENUE_STYLE;
  const normalized = value.toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (VENUE_STYLE_IDS.includes(normalized as VenueStyleId)) {
    return normalized as VenueStyleId;
  }
  return DEFAULT_VENUE_STYLE;
}

export function getVenueProfile(style: VenueStyleId): VenueStyleProfile {
  return VENUE_PROFILES[style] ?? VENUE_PROFILES[DEFAULT_VENUE_STYLE];
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
  "writing_clarity",
  "venue_style_fit"
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
  venueStyle: VenueStyleId;
  scorecard: ReviewScorecard;
  decision: ReviewDecision;
  findings: ReviewFinding[];
  presence: ReviewArtifactPresence;
}

export function buildPreDraftCritique(input: PreDraftCritiqueInput): PaperCritique {
  const venueProfile = getVenueProfile(input.venueStyle);
  const categoryScores = buildCategoryScoresFromReview(input.scorecard, input.findings, input.presence);
  const issues = buildIssuesFromFindings(input.findings, "pre_draft_review");
  const blockingIssues = issues.filter((i) => i.severity === "blocking" || i.severity === "high");
  const nonBlockingIssues = issues.filter((i) => i.severity !== "blocking" && i.severity !== "high");

  // Style fit assessment
  const styleMismatches = assessPreDraftStyleFit(input, venueProfile);
  const styleNotes = styleMismatches.length > 0
    ? `${styleMismatches.length} venue-style concern(s) identified for ${venueProfile.label}.`
    : `Evidence package appears compatible with ${venueProfile.label} style.`;

  // Manuscript type classification
  const manuscriptType = classifyManuscriptType(categoryScores, blockingIssues, input.presence);

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
    target_venue_style: input.venueStyle,
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
      ? `Evidence package classified as ${manuscriptType}.`
      : null,
    manuscript_claim_risk_summary: claimRisk,
    needs_additional_experiments: needsExperiments,
    needs_additional_statistics: needsStatistics,
    needs_additional_related_work: needsRelatedWork < 2,
    needs_design_revision: needsDesign,
    venue_style_notes: styleNotes,
    style_mismatches: styleMismatches,
    style_repairable_locally: true
  };
}

// ---------------------------------------------------------------------------
// Post-draft critique builder
// ---------------------------------------------------------------------------

export interface PostDraftCritiqueInput {
  venueStyle: VenueStyleId;
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
  const venueProfile = getVenueProfile(input.venueStyle);
  const categoryScores = buildCategoryScoresFromPostDraft(input);
  const issues = buildIssuesFromPostDraft(input);
  const blockingIssues = issues.filter((i) => i.severity === "blocking" || i.severity === "high");
  const nonBlockingIssues = issues.filter((i) => i.severity !== "blocking" && i.severity !== "high");

  // Style fit assessment
  const styleMismatches = assessPostDraftStyleFit(input, venueProfile);
  const styleNotes = styleMismatches.length > 0
    ? `${styleMismatches.length} style mismatch(es) for ${venueProfile.label}. ${styleMismatches.length <= 3 ? "Repairable locally." : "Consider restructuring."}`
    : `Manuscript structure appears compatible with ${venueProfile.label} style.`;
  const styleRepairable = styleMismatches.length <= 3;

  // Manuscript type
  const manuscriptType = classifyPostDraftManuscriptType(input, blockingIssues);

  // Upstream deficit flags
  const needsExperiments = input.evidenceDiagnostics.blocked_by_evidence_insufficiency
    || blockingIssues.some((i) => i.category === "result_table_quality");
  const needsStatistics = blockingIssues.some((i) => i.category === "statistical_adequacy");
  const needsRelatedWork = input.relatedWorkStatus === "fail" || input.relatedWorkStatus === "missing";
  const needsDesign = blockingIssues.some((i) => i.category === "methodological_completeness");

  // Compare with pre-draft
  const improved = input.preDraftCritique
    ? computeOverallScore(categoryScores) >= input.preDraftCritique.overall_score
    : true;

  // Overall decision
  const overallDecision = computePostDraftDecision(input, blockingIssues, manuscriptType, improved, styleRepairable);
  const overallScore = computeOverallScore(categoryScores);
  const confidence = computePostDraftConfidence(input, blockingIssues);

  // Claim risk
  const claimRisk = buildPostDraftClaimRiskSummary(input, blockingIssues);

  return {
    stage: "post_draft_review",
    generated_at: new Date().toISOString(),
    target_venue_style: input.venueStyle,
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
    needs_design_revision: needsDesign,
    venue_style_notes: styleNotes,
    style_mismatches: styleMismatches,
    style_repairable_locally: styleRepairable
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
    },
    {
      category: "venue_style_fit",
      score_1_to_5: 3,
      rationale: "Venue style fit is assessed during post-draft review."
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

function assessPreDraftStyleFit(input: PreDraftCritiqueInput, profile: VenueStyleProfile): string[] {
  const mismatches: string[] = [];

  // Check if critical venue-expected sections have adequate evidence
  if (profile.section_emphasis.includes("analysis") && !input.presence.metricsPresent) {
    mismatches.push(`${profile.label} expects analysis/ablation but metrics artifacts are missing.`);
  }
  if (profile.section_emphasis.includes("limitations") &&
      (input.scorecard.dimensions.find((d) => d.dimension === "integrity")?.score_1_to_5 ?? 3) < 2) {
    mismatches.push(`${profile.label} expects explicit limitations but integrity score is low.`);
  }
  return mismatches;
}

function assessPostDraftStyleFit(input: PostDraftCritiqueInput, profile: VenueStyleProfile): string[] {
  const mismatches: string[] = [];
  const sections = new Set(input.manuscriptSections.map((s) => s.toLowerCase()));

  // Check section emphasis
  for (const expected of profile.section_emphasis) {
    const normalized = expected.toLowerCase().replace(/_/g, " ");
    const found = [...sections].some(
      (s) => s.includes(normalized) || normalized.includes(s)
    );
    if (!found && expected !== "broader_impact" && expected !== "theoretical_analysis") {
      mismatches.push(`${profile.label} expects a '${expected}' section but none was found.`);
    }
  }

  // Check evidence richness for venues that emphasize rigor
  if (
    (profile.id === "icml" || profile.id === "neurips" || profile.id === "iclr") &&
    input.evidenceDiagnostics.thin_sections.length > 0
  ) {
    mismatches.push(`${profile.label} expects strong empirical depth but ${input.evidenceDiagnostics.thin_sections.length} section(s) are thin on evidence.`);
  }

  return mismatches;
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
  blockingIssues: CritiqueIssue[],
  manuscriptType: ManuscriptType,
  improved: boolean,
  styleRepairable: boolean
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

  // Style-only problems → local repair
  const allBlockersAreStyle = blockingIssues.length > 0 &&
    blockingIssues.every(isLocalStyleIssue);
  if (allBlockersAreStyle && styleRepairable) {
    return "repair_then_retry";
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
    },
    {
      category: "venue_style_fit",
      score_1_to_5: 3,
      rationale: "Assessed via style mismatch analysis."
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
