/**
 * Deterministic minimum gate for paper-quality evaluation (Layer 1).
 *
 * This is a compact, strict, artifact-presence-based gate that answers:
 *   "Is this branch categorically below the minimum evidence bar?"
 *
 * It checks structural prerequisites only — task/dataset grounding,
 * objective metric, baseline/comparator, executed comparison, minimum
 * robustness depth, key artifact parseability, claim→evidence linkage,
 * and smoke/system-only guard.
 *
 * It does NOT assess quality, significance, writing, or venue fit.
 * Those judgments belong to the LLM-based evaluator (Layer 2).
 */

import type { ReviewArtifactPresence } from "../reviewSystem.js";
import type { AnalysisReport } from "../resultAnalysis.js";
import type { FigureAuditSummary } from "../exploration/types.js";
import type { BriefEvidenceAssessment, BriefEvidenceCeiling } from "./briefEvidenceValidator.js";
import { GATE_THRESHOLDS } from "./paperGateThresholds.js";
import { hasAtLeastOneCompleteResultsTableRow } from "./resultsTableSchema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MinimumGateCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface MinimumGateResult {
  passed: boolean;
  /** ISO timestamp */
  evaluated_at: string;
  checks: MinimumGateCheck[];
  blockers: string[];
  /** Machine-readable failed check ids */
  failed_checks: string[];
  /** Ceiling manuscript type implied by gate failures */
  ceiling_type: MinimumGateCeiling;
  /** Warning-only signal from figure_audit; review decides whether to block. */
  figure_audit_severe_mismatch?: boolean;
  /** Short human-readable summary */
  summary: string;
}

export type MinimumGateCeiling =
  | "unrestricted"           // gate passed — no ceiling imposed
  | "research_memo"          // some evidence but not paper-scale
  | "system_validation_note" // barely above smoke test
  | "blocked_for_paper_scale"; // categorically blocked

export interface MinimumGateInput {
  presence: ReviewArtifactPresence;
  report: AnalysisReport;
  /** Run topic / title for context */
  topic: string;
  objectiveMetric: string;
  briefEvidenceAssessment?: BriefEvidenceAssessment;
  evidenceLinksArtifact?: unknown;
  claimEvidenceTableArtifact?: unknown;
  figureAuditSummaryArtifact?: FigureAuditSummary | unknown;
}

// ---------------------------------------------------------------------------
// Gate implementation
// ---------------------------------------------------------------------------

export function evaluateMinimumGate(input: MinimumGateInput): MinimumGateResult {
  const checks: MinimumGateCheck[] = [];

  // 1. Objective metric is identified
  const hasObjective = Boolean(input.objectiveMetric?.trim());
  checks.push({
    id: "objective_metric",
      label: "Objective metric identified",
      passed: hasObjective,
      detail: hasObjective
      ? `Objective: ${input.objectiveMetric.slice(0, GATE_THRESHOLDS.objectiveMetricPreviewLength)}`
      : "No objective metric specified"
  });

  // 2. Experiment plan exists (task/dataset grounding)
  checks.push({
    id: "experiment_plan",
    label: "Experiment plan exists (task/dataset grounding)",
    passed: input.presence.experimentPlanPresent,
    detail: input.presence.experimentPlanPresent
      ? "experiment_plan.yaml present"
      : "No experiment_plan.yaml — no task/dataset grounding"
  });

  // 3. At least one baseline or comparator is explicit
  const hasBaselineOrComparator = input.presence.baselineSummaryPresent ||
    (input.report.condition_comparisons?.length > 0);
  checks.push({
    id: "baseline_or_comparator",
    label: "Baseline or comparator is explicit",
    passed: hasBaselineOrComparator,
    detail: hasBaselineOrComparator
      ? input.presence.baselineSummaryPresent
        ? "baseline_summary.json present"
        : `${input.report.condition_comparisons.length} condition comparison(s) found`
      : "No baseline_summary.json and no condition comparisons"
  });

  // 4. At least one executed comparison result exists
  const hasExecutedResult = input.presence.metricsPresent;
  checks.push({
    id: "executed_result",
    label: "Executed comparison result exists",
    passed: hasExecutedResult,
    detail: hasExecutedResult
      ? "metrics.json present"
      : "No metrics.json — no executed result evidence"
  });

  // 5. Evidence goes beyond a single thin run
  const evidenceDepth = deriveEvidenceDepth(input.report);
  checks.push({
    id: "evidence_depth",
    label: "Evidence goes beyond a single thin run",
    passed: evidenceDepth.passed,
    detail: evidenceDepth.detail
  });

  // 6. Key result artifacts exist and are parseable
  const hasResultTable = input.presence.resultTablePresent;
  checks.push({
    id: "result_artifacts",
    label: "Key result artifacts present",
    passed: hasResultTable,
    detail: hasResultTable
      ? "result_table.json present"
      : "No result_table.json"
  });

  // 7. Claim→evidence linkage support
  const hasClaimEvidence =
    input.presence.evidenceStorePresent &&
    (input.report.paper_claims?.length ?? 0) >= GATE_THRESHOLDS.minEvidenceLinksClaimCount;
  const claimsWithEvidence = input.report.paper_claims?.filter(
    c => (c.evidence?.length ?? 0) >= GATE_THRESHOLDS.minClaimEvidenceRefsPerClaim
  ).length ?? 0;
  checks.push({
    id: "claim_evidence_linkage",
    label: "Claim→evidence linkage present",
    passed: hasClaimEvidence,
    detail: hasClaimEvidence
      ? `evidence_store.jsonl present, ${claimsWithEvidence}/${input.report.paper_claims?.length ?? 0} claim(s) with evidence`
      : !input.presence.evidenceStorePresent
        ? "No evidence_store.jsonl"
        : "No paper claims generated"
  });

  // 8. Paper claim-evidence artifacts are structurally grounded when emitted
  const artifactClaimEvidence = evaluateClaimEvidenceArtifacts(input);
  checks.push({
    id: "claim_evidence_missing",
    label: "Paper claim-evidence artifacts are grounded",
    passed: artifactClaimEvidence.passed,
    detail: artifactClaimEvidence.detail
  });

  // 9. Results table includes explicit baseline/comparator values
  const hasStructuredResultsTable = hasAtLeastOneCompleteResultsTableRow(input.report.results_table);
  checks.push({
    id: "results_table_schema",
    label: "Results table includes at least one baseline/comparator row",
    passed: hasStructuredResultsTable,
    detail: hasStructuredResultsTable
      ? "result_analysis.results_table contains at least one complete baseline/comparator row."
      : "No result_analysis.results_table row has both baseline and comparator populated."
  });

  // 10. Not merely system/smoke validation
  const hasHypotheses = input.presence.hypothesesPresent;
  const hasEnoughFindings = (input.report.primary_findings?.length ?? 0) >= GATE_THRESHOLDS.minPrimaryFindingCount;
  const isSubstantive = hasHypotheses && hasEnoughFindings && hasObjective;
  checks.push({
    id: "not_smoke_only",
    label: "Not merely system/smoke validation",
      passed: hasHypotheses && hasEnoughFindings && hasObjective,
      detail: isSubstantive
      ? "Hypotheses present, findings generated, objective metric specified"
      : !hasHypotheses
        ? "No hypotheses — may be system-only validation"
        : !hasEnoughFindings
          ? "No primary findings — may be smoke test only"
          : "Missing objective metric"
  });

  if (
    input.briefEvidenceAssessment &&
    input.briefEvidenceAssessment.enabled &&
    input.briefEvidenceAssessment.status !== "not_applicable"
  ) {
    checks.push({
      id: "brief_minimum_evidence",
      label: "Brief minimum evidence requirements satisfied",
      passed: input.briefEvidenceAssessment.status !== "fail",
      detail: input.briefEvidenceAssessment.summary
    });
  }

  // Compute blockers and ceiling
  const blockers = checks.filter(c => !c.passed).map(c => c.label);
  const failedChecks = checks.filter(c => !c.passed).map(c => c.id);
  const failCount = blockers.length;

  let ceiling: MinimumGateCeiling;
  if (failCount === 0) {
    ceiling = "unrestricted";
  } else if (!hasObjective || !input.presence.experimentPlanPresent || !isSubstantive) {
    // Missing fundamentals → system validation
    ceiling = failCount >= GATE_THRESHOLDS.minFundamentalFailuresForBlocked ? "blocked_for_paper_scale" : "system_validation_note";
  } else if (failCount >= GATE_THRESHOLDS.minGeneralFailuresForBlocked) {
    ceiling = "blocked_for_paper_scale";
  } else {
    ceiling = "research_memo";
  }

  if (input.briefEvidenceAssessment?.enabled) {
    ceiling = moreRestrictiveCeiling(ceiling, input.briefEvidenceAssessment.ceiling_type);
  }

  const passed = failCount === 0;
  const figureAuditSevereMismatch =
    isFigureAuditSummary(input.figureAuditSummaryArtifact)
    && input.figureAuditSummaryArtifact.severe_mismatch_count > 0;
  const summary = passed
    ? "Minimum evidence gate passed — all structural prerequisites met."
    : `Minimum gate: ${failCount} check(s) failed — ceiling: ${ceiling}. ${blockers.join("; ")}.`;

  return {
    passed,
    evaluated_at: new Date().toISOString(),
    checks,
    blockers,
    failed_checks: failedChecks,
    ceiling_type: ceiling,
    ...(figureAuditSevereMismatch ? { figure_audit_severe_mismatch: true } : {}),
    summary
  };
}

function moreRestrictiveCeiling(
  left: MinimumGateCeiling,
  right: MinimumGateCeiling | BriefEvidenceCeiling
): MinimumGateCeiling {
  const ranking: Record<MinimumGateCeiling, number> = {
    unrestricted: 0,
    research_memo: 1,
    system_validation_note: 2,
    blocked_for_paper_scale: 3
  };
  return ranking[left] >= ranking[right as MinimumGateCeiling] ? left : (right as MinimumGateCeiling);
}

function deriveEvidenceDepth(report: AnalysisReport): { passed: boolean; detail: string } {
  const totalTrials =
    report.statistical_summary?.total_trials ??
    report.statistical_summary?.executed_trials ??
    report.overview.execution_runs;
  const executedTrials =
    report.statistical_summary?.executed_trials ??
    report.overview.execution_runs;
  const confidenceIntervalCount = report.statistical_summary?.confidence_intervals?.length ?? 0;
  const stabilityMetricCount = report.statistical_summary?.stability_metrics?.length ?? 0;
  const effectEstimateCount = report.statistical_summary?.effect_estimates?.length ?? 0;
  const hasRobustnessEvidence =
    (typeof totalTrials === "number" && totalTrials >= GATE_THRESHOLDS.minRobustnessTotalTrials) ||
    confidenceIntervalCount >= GATE_THRESHOLDS.minRobustnessConfidenceIntervalCount ||
    stabilityMetricCount >= GATE_THRESHOLDS.minRobustnessStabilityMetricCount ||
    effectEstimateCount >= GATE_THRESHOLDS.minRobustnessEffectEstimateCount;

  return {
    passed: hasRobustnessEvidence,
    detail: `Observed total_trials=${totalTrials ?? "unknown"}, executed_trials=${executedTrials ?? "unknown"}, confidence_intervals=${confidenceIntervalCount}, stability_metrics=${stabilityMetricCount}, effect_estimates=${effectEstimateCount}.`
  };
}

function evaluateClaimEvidenceArtifacts(input: MinimumGateInput): { passed: boolean; detail: string } {
  const evidenceLinks = normalizeArtifactClaims(input.evidenceLinksArtifact);
  const claimEvidenceTable = normalizeArtifactClaims(input.claimEvidenceTableArtifact);

  if (!evidenceLinks.present && !claimEvidenceTable.present) {
    return {
      passed: true,
      detail: "paper/evidence_links.json and paper/claim_evidence_table.json not emitted yet; relying on pre-draft claim linkage."
    };
  }

  if (!evidenceLinks.present) {
    return {
      passed: false,
      detail: "paper/evidence_links.json missing or malformed."
    };
  }

  if (evidenceLinks.claims.length < GATE_THRESHOLDS.minEvidenceLinksClaimCount) {
    return {
      passed: false,
      detail: "paper/evidence_links.json must include at least one claim entry."
    };
  }

  if (!claimEvidenceTable.present) {
    return {
      passed: false,
      detail: "paper/claim_evidence_table.json missing or malformed."
    };
  }

  if (claimEvidenceTable.claims.length < GATE_THRESHOLDS.minClaimEvidenceRows) {
    return {
      passed: false,
      detail: "paper/claim_evidence_table.json must include at least one claim entry."
    };
  }

  const emptyEvidenceClaim = claimEvidenceTable.claims.find(
    (claim) => extractClaimEvidenceRefs(claim).length < GATE_THRESHOLDS.minClaimEvidenceRefsPerClaim
  );
  if (emptyEvidenceClaim) {
    return {
      passed: false,
      detail: `Claim ${String((emptyEvidenceClaim as Record<string, unknown>).claim_id || "unknown")} has no evidence/artifact/citation references in paper/claim_evidence_table.json.`
    };
  }

  return {
    passed: true,
    detail: `${evidenceLinks.claims.length} evidence link claim(s) and ${claimEvidenceTable.claims.length} claim-evidence row(s) grounded.`
  };
}

function normalizeArtifactClaims(raw: unknown): { present: boolean; claims: Record<string, unknown>[] } {
  if (!raw || typeof raw !== "object") {
    return { present: false, claims: [] };
  }
  const claims = (raw as { claims?: unknown }).claims;
  if (!Array.isArray(claims)) {
    return { present: false, claims: [] };
  }
  return {
    present: true,
    claims: claims.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
  };
}

function extractClaimEvidenceRefs(claim: Record<string, unknown>): string[] {
  const explicitEvidence = normalizeStringArray(claim.evidence);
  if (explicitEvidence.length > 0) {
    return explicitEvidence;
  }
  return [
    ...normalizeStringArray(claim.artifact_refs),
    ...normalizeStringArray(claim.citation_refs),
    ...normalizeStringArray(claim.evidence_ids)
  ];
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isFigureAuditSummary(value: unknown): value is FigureAuditSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<FigureAuditSummary>;
  return (
    typeof candidate.audited_at === "string"
    && Array.isArray(candidate.issues)
    && typeof candidate.severe_mismatch_count === "number"
    && typeof candidate.review_block_required === "boolean"
  );
}
