import type { FigureAuditSummary } from "../exploration/types.js";
import type { GovernanceBenchmarkConditionName } from "./governanceCondition.js";

export interface FigureAuditScore {
  measured: boolean;
  audit_status: "pass" | "warn" | "fail" | "ablated" | "missing";
  figure_count: number;
  issue_count: number;
  severe_mismatch_count: number;
  review_block_required: boolean;
  figure_result_mismatch_rate: number | null;
  skipped_reason?: string;
}

export function scoreFigureAudit(input: {
  summary?: FigureAuditSummary | null;
  condition?: GovernanceBenchmarkConditionName;
}): FigureAuditScore {
  if (input.condition === "no_figure_audit" && !input.summary) {
    return {
      measured: false,
      audit_status: "ablated",
      figure_count: 0,
      issue_count: 0,
      severe_mismatch_count: 0,
      review_block_required: false,
      figure_result_mismatch_rate: null,
      skipped_reason: "figure_audit_ablated"
    };
  }

  if (!isFigureAuditSummary(input.summary)) {
    return {
      measured: false,
      audit_status: "missing",
      figure_count: 0,
      issue_count: 0,
      severe_mismatch_count: 0,
      review_block_required: false,
      figure_result_mismatch_rate: null,
      skipped_reason: "figure_audit_summary_missing_or_malformed"
    };
  }

  const severeMismatchCount = Math.max(0, input.summary.severe_mismatch_count);
  const issueCount = input.summary.issues.length;
  const auditStatus =
    severeMismatchCount > 0 || input.summary.review_block_required
      ? "fail"
      : issueCount > 0
        ? "warn"
        : "pass";

  return {
    measured: true,
    audit_status: auditStatus,
    figure_count: input.summary.figure_count,
    issue_count: issueCount,
    severe_mismatch_count: severeMismatchCount,
    review_block_required: input.summary.review_block_required,
    figure_result_mismatch_rate:
      input.summary.figure_count > 0 ? round2(severeMismatchCount / input.summary.figure_count) : null
  };
}

function isFigureAuditSummary(value: unknown): value is FigureAuditSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<FigureAuditSummary>;
  return typeof candidate.audited_at === "string"
    && typeof candidate.figure_count === "number"
    && Array.isArray(candidate.issues)
    && typeof candidate.severe_mismatch_count === "number"
    && typeof candidate.review_block_required === "boolean";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
