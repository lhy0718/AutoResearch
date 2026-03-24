/**
 * Deterministic minimum gate for paper-quality evaluation (Layer 1).
 *
 * This is a compact, strict, artifact-presence-based gate that answers:
 *   "Is this branch categorically below the minimum evidence bar?"
 *
 * It checks structural prerequisites only — task/dataset grounding,
 * objective metric, baseline/comparator, executed comparison, key artifact
 * parseability, claim→evidence linkage, and smoke/system-only guard.
 *
 * It does NOT assess quality, significance, writing, or venue fit.
 * Those judgments belong to the LLM-based evaluator (Layer 2).
 */

import type { ReviewArtifactPresence } from "../reviewSystem.js";
import type { AnalysisReport } from "../resultAnalysis.js";
import type { BriefEvidenceAssessment, BriefEvidenceCeiling } from "./briefEvidenceValidator.js";

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
  /** Ceiling manuscript type implied by gate failures */
  ceiling_type: MinimumGateCeiling;
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
      ? `Objective: ${input.objectiveMetric.slice(0, 80)}`
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

  // 5. Key result artifacts exist and are parseable
  const hasResultTable = input.presence.resultTablePresent;
  checks.push({
    id: "result_artifacts",
    label: "Key result artifacts present",
    passed: hasResultTable,
    detail: hasResultTable
      ? "result_table.json present"
      : "No result_table.json"
  });

  // 6. Claim→evidence linkage support
  const hasClaimEvidence = input.presence.evidenceStorePresent &&
    (input.report.paper_claims?.length > 0);
  const claimsWithEvidence = input.report.paper_claims?.filter(
    c => c.evidence?.length > 0
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

  // 7. Not merely system/smoke validation
  const hasHypotheses = input.presence.hypothesesPresent;
  const hasMultipleFindings = (input.report.primary_findings?.length ?? 0) >= 1;
  const isSubstantive = hasHypotheses && hasMultipleFindings && hasObjective;
  checks.push({
    id: "not_smoke_only",
    label: "Not merely system/smoke validation",
    passed: isSubstantive,
    detail: isSubstantive
      ? "Hypotheses present, findings generated, objective metric specified"
      : !hasHypotheses
        ? "No hypotheses — may be system-only validation"
        : !hasMultipleFindings
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
  const failCount = blockers.length;

  let ceiling: MinimumGateCeiling;
  if (failCount === 0) {
    ceiling = "unrestricted";
  } else if (!hasObjective || !input.presence.experimentPlanPresent || !isSubstantive) {
    // Missing fundamentals → system validation
    ceiling = failCount >= 4 ? "blocked_for_paper_scale" : "system_validation_note";
  } else if (failCount >= 3) {
    ceiling = "blocked_for_paper_scale";
  } else {
    ceiling = "research_memo";
  }

  if (input.briefEvidenceAssessment?.enabled) {
    ceiling = moreRestrictiveCeiling(ceiling, input.briefEvidenceAssessment.ceiling_type);
  }

  const passed = failCount === 0;
  const summary = passed
    ? "Minimum evidence gate passed — all structural prerequisites met."
    : `Minimum gate: ${failCount} check(s) failed — ceiling: ${ceiling}. ${blockers.join("; ")}.`;

  return {
    passed,
    evaluated_at: new Date().toISOString(),
    checks,
    blockers,
    ceiling_type: ceiling,
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
