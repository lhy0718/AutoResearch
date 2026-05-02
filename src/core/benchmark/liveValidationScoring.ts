export type LiveValidationFailureClass =
  | "persisted_state_bug"
  | "in_memory_projection_bug"
  | "refresh_render_bug"
  | "resume_reload_bug"
  | "race_timing_bug";

export interface LiveValidationCaseInput {
  case_id: string;
  reproduced: boolean;
  regression_rechecked: boolean;
  dominant_failure_class?: string;
  syntax_success?: boolean;
  metric_evidence_present?: boolean;
  fallback_label?: string;
  deterministic_fallback_used?: boolean;
}

export interface LiveValidationCaseScore {
  case_id: string;
  measured: boolean;
  taxonomy_valid: boolean;
  reproduced: boolean;
  regression_rechecked: boolean;
  syntax_only_success: boolean;
  metric_evidence_present: boolean;
  fallback_label_preserved: boolean;
  deterministic_fallback_excluded_from_paper_scale: boolean;
  issues: string[];
}

export interface LiveValidationScoreSummary {
  measured_case_count: number;
  taxonomy_coverage: number | null;
  regression_recheck_rate: number | null;
  syntax_only_success_count: number;
  deterministic_fallback_count: number;
  cases: LiveValidationCaseScore[];
}

const FAILURE_CLASSES = new Set<string>([
  "persisted_state_bug",
  "in_memory_projection_bug",
  "refresh_render_bug",
  "resume_reload_bug",
  "race_timing_bug"
]);

export function scoreLiveValidationCases(inputs: LiveValidationCaseInput[]): LiveValidationScoreSummary {
  const cases = inputs.map(scoreLiveValidationCase);
  const measured = cases.filter((item) => item.measured);
  const taxonomyValid = measured.filter((item) => item.taxonomy_valid).length;
  const regressionRechecked = measured.filter((item) => item.regression_rechecked).length;

  return {
    measured_case_count: measured.length,
    taxonomy_coverage: measured.length > 0 ? round2(taxonomyValid / measured.length) : null,
    regression_recheck_rate: measured.length > 0 ? round2(regressionRechecked / measured.length) : null,
    syntax_only_success_count: measured.filter((item) => item.syntax_only_success).length,
    deterministic_fallback_count: measured.filter((item) => item.deterministic_fallback_excluded_from_paper_scale).length,
    cases
  };
}

export function scoreLiveValidationCase(input: LiveValidationCaseInput): LiveValidationCaseScore {
  const taxonomyValid = Boolean(input.dominant_failure_class && FAILURE_CLASSES.has(input.dominant_failure_class));
  const syntaxOnlySuccess = input.syntax_success === true && input.metric_evidence_present !== true;
  const fallbackLabelPreserved =
    input.deterministic_fallback_used === true
      ? typeof input.fallback_label === "string" && input.fallback_label.trim().length > 0
      : true;
  const deterministicFallbackExcluded =
    input.deterministic_fallback_used === true
      ? input.metric_evidence_present !== true
      : false;
  const issues: string[] = [];

  if (!taxonomyValid) {
    issues.push("missing_or_invalid_dominant_failure_class");
  }
  if (!input.reproduced) {
    issues.push("not_reproduced");
  }
  if (!input.regression_rechecked) {
    issues.push("regression_not_rechecked");
  }
  if (syntaxOnlySuccess) {
    issues.push("syntax_success_without_metric_evidence");
  }
  if (!fallbackLabelPreserved) {
    issues.push("fallback_label_missing");
  }
  if (deterministicFallbackExcluded) {
    issues.push("deterministic_fallback_excluded_from_paper_scale");
  }

  return {
    case_id: input.case_id,
    measured: input.reproduced || taxonomyValid || input.syntax_success === true || input.deterministic_fallback_used === true,
    taxonomy_valid: taxonomyValid,
    reproduced: input.reproduced,
    regression_rechecked: input.regression_rechecked,
    syntax_only_success: syntaxOnlySuccess,
    metric_evidence_present: input.metric_evidence_present === true,
    fallback_label_preserved: fallbackLabelPreserved,
    deterministic_fallback_excluded_from_paper_scale: deterministicFallbackExcluded,
    issues
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
