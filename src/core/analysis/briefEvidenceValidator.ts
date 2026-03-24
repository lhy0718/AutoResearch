import type { AnalysisReport } from "../resultAnalysis.js";
import type { MarkdownRunBriefSections } from "../runs/runBriefParser.js";

export type BriefEvidenceStatus = "not_applicable" | "pass" | "warn" | "fail";
export type BriefEvidenceCeiling =
  | "unrestricted"
  | "research_memo"
  | "system_validation_note"
  | "blocked_for_paper_scale";

export interface BriefEvidenceCheck {
  id: string;
  label: string;
  severity: "error" | "warning";
  passed: boolean;
  detail: string;
}

export interface BriefEvidenceAssessment {
  generated_at: string;
  enabled: boolean;
  status: BriefEvidenceStatus;
  summary: string;
  ceiling_type: BriefEvidenceCeiling;
  recommended_action?: "backtrack_to_design";
  requirements: {
    minimum_runs_or_folds?: number;
    minimum_baseline_count: number;
    requires_confidence_intervals: boolean;
    paper_ceiling?: string;
    raw_minimum_evidence?: string;
  };
  actual: {
    executed_trials?: number;
    baseline_count: number;
    confidence_interval_count: number;
    evidence_gap_count: number;
    scope_limit_count: number;
  };
  checks: BriefEvidenceCheck[];
  failures: string[];
  warnings: string[];
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5
};

export function parseBriefPaperCeiling(text?: string): BriefEvidenceCeiling | undefined {
  if (!text) {
    return undefined;
  }
  const normalized = text.toLowerCase();
  if (normalized.includes("blocked_for_paper_scale")) {
    return "blocked_for_paper_scale";
  }
  if (normalized.includes("system_validation_note")) {
    return "system_validation_note";
  }
  if (normalized.includes("research_memo")) {
    return "research_memo";
  }
  return undefined;
}

export function evaluateBriefEvidenceAgainstResults(input: {
  briefSections?: MarkdownRunBriefSections;
  report: AnalysisReport;
}): BriefEvidenceAssessment {
  const briefSections = input.briefSections;
  const hasBriefGovernance = Boolean(
    briefSections?.minimumAcceptableEvidence ||
      briefSections?.baselineComparator ||
      briefSections?.targetComparison ||
      briefSections?.paperCeiling
  );
  const executedTrials =
    input.report.statistical_summary.executed_trials ??
    input.report.statistical_summary.total_trials ??
    input.report.overview.execution_runs;
  const baselineCount = deriveActualBaselineCount(input.report);
  const confidenceIntervalCount = input.report.statistical_summary.confidence_intervals.length;
  const evidenceGapCount = countFailureCategory(input.report, "evidence_gap");
  const scopeLimitCount = countFailureCategory(input.report, "scope_limit");

  if (!hasBriefGovernance) {
    return {
      generated_at: new Date().toISOString(),
      enabled: false,
      status: "not_applicable",
      summary: "No structured brief governance was available, so brief-specific evidence validation was skipped.",
      ceiling_type: "unrestricted",
      requirements: {
        minimum_baseline_count: 0,
        requires_confidence_intervals: false
      },
      actual: {
        executed_trials: executedTrials,
        baseline_count: baselineCount,
        confidence_interval_count: confidenceIntervalCount,
        evidence_gap_count: evidenceGapCount,
        scope_limit_count: scopeLimitCount
      },
      checks: [],
      failures: [],
      warnings: []
    };
  }

  const minimumEvidenceText = briefSections?.minimumAcceptableEvidence?.trim();
  const baselineText = [briefSections?.baselineComparator, briefSections?.targetComparison]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
  const requiredRuns = parseRequiredRunCount([
    briefSections?.minimumAcceptableEvidence,
    briefSections?.minimumExperimentPlan
  ]);
  const requiredBaselineCount = parseRequiredBaselineCount(baselineText);
  const requiresConfidenceIntervals = detectConfidenceIntervalRequirement([
    briefSections?.minimumAcceptableEvidence,
    briefSections?.paperWorthinessGate
  ]);

  const checks: BriefEvidenceCheck[] = [
    {
      id: "minimum_acceptable_evidence_declared",
      label: "Brief declares minimum acceptable evidence",
      severity: "error",
      passed: Boolean(minimumEvidenceText),
      detail: minimumEvidenceText
        ? `Minimum evidence clause present: ${minimumEvidenceText.slice(0, 160)}`
        : "Missing Minimum Acceptable Evidence section content."
    },
    {
      id: "baseline_requirement_declared",
      label: "Brief declares a baseline/comparator",
      severity: "error",
      passed: Boolean(baselineText.trim()),
      detail: baselineText.trim()
        ? `Baseline clause present: ${baselineText.replace(/\s+/gu, " ").slice(0, 160)}`
        : "Missing Baseline / Comparator or Target Comparison details."
    },
    {
      id: "baseline_requirement_met",
      label: "Executed evidence includes the required baseline coverage",
      severity: "error",
      passed: baselineCount >= requiredBaselineCount,
      detail: `Observed ${baselineCount} baseline/comparator track(s); required at least ${requiredBaselineCount}.`
    },
    {
      id: "minimum_runs_met",
      label: "Executed evidence meets the brief run/fold floor",
      severity: "error",
      passed:
        typeof requiredRuns !== "number" || (typeof executedTrials === "number" && executedTrials >= requiredRuns),
      detail:
        typeof requiredRuns === "number"
          ? `Observed executed_trials=${executedTrials ?? "unknown"}; required at least ${requiredRuns}.`
          : "No explicit run/fold count could be inferred from the brief."
    },
    {
      id: "confidence_intervals_present",
      label: "Confidence intervals are present when the brief asks for statistical support",
      severity: requiresConfidenceIntervals ? "error" : "warning",
      passed: !requiresConfidenceIntervals || confidenceIntervalCount > 0,
      detail: requiresConfidenceIntervals
        ? `Observed ${confidenceIntervalCount} confidence interval artifact(s).`
        : `Observed ${confidenceIntervalCount} confidence interval artifact(s); the brief did not explicitly require them.`
    },
    {
      id: "analysis_evidence_gaps_clear",
      label: "Analyze-results did not flag unresolved evidence-scale or scope gaps",
      severity: "error",
      passed: evidenceGapCount === 0 && scopeLimitCount === 0,
      detail: `Observed evidence_gap=${evidenceGapCount}, scope_limit=${scopeLimitCount}.`
    }
  ];

  const failures = checks.filter((check) => check.severity === "error" && !check.passed).map((check) => check.label);
  const warnings = checks
    .filter((check) => check.severity === "warning" && !check.passed)
    .map((check) => check.label);
  const status: BriefEvidenceStatus =
    failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  const ceiling_type =
    status !== "fail"
      ? "unrestricted"
      : !minimumEvidenceText || !baselineText.trim() || baselineCount === 0
        ? "blocked_for_paper_scale"
        : "research_memo";
  const summary =
    status === "pass"
      ? "Brief evidence gate passed — executed evidence matches the brief's minimum paper-scale requirements."
      : status === "warn"
        ? `Brief evidence gate produced warning(s): ${warnings.join("; ")}.`
        : `Brief evidence gate failed — ${failures.join("; ")}.`;

  return {
    generated_at: new Date().toISOString(),
    enabled: true,
    status,
    summary,
    ceiling_type,
    recommended_action: status === "fail" ? "backtrack_to_design" : undefined,
    requirements: {
      minimum_runs_or_folds: requiredRuns,
      minimum_baseline_count: requiredBaselineCount,
      requires_confidence_intervals: requiresConfidenceIntervals,
      paper_ceiling: briefSections?.paperCeiling?.trim() || undefined,
      raw_minimum_evidence: minimumEvidenceText || undefined
    },
    actual: {
      executed_trials: executedTrials,
      baseline_count: baselineCount,
      confidence_interval_count: confidenceIntervalCount,
      evidence_gap_count: evidenceGapCount,
      scope_limit_count: scopeLimitCount
    },
    checks,
    failures,
    warnings
  };
}

function deriveActualBaselineCount(report: AnalysisReport): number {
  const explicitBaselines = report.plan_context.selected_design?.baselines?.length ?? 0;
  const comparisons = report.condition_comparisons.length > 0 ? 1 : 0;
  return Math.max(explicitBaselines, comparisons);
}

function parseRequiredBaselineCount(text: string): number {
  if (!text.trim()) {
    return 0;
  }
  const numericMatches = [...text.matchAll(/\b(\d+)\s+(?:explicit\s+)?(?:baselines?|comparators?)\b/giu)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (numericMatches.length > 0) {
    return Math.max(...numericMatches);
  }
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b[\\s\\S]{0,24}\\b(?:baselines?|comparators?)\\b`, "iu").test(text)) {
      return value;
    }
  }
  return 1;
}

function parseRequiredRunCount(chunks: Array<string | undefined>): number | undefined {
  const text = chunks.filter((value): value is string => Boolean(value?.trim())).join("\n");
  if (!text.trim()) {
    return undefined;
  }

  const numericMatches = [...text.matchAll(/\b(\d+)\s+(?:runs?|folds?|trials?|seeds?|replications?)\b/giu)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (numericMatches.length > 0) {
    return Math.max(...numericMatches);
  }

  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b[\\s\\S]{0,24}\\b(?:runs?|folds?|trials?|seeds?|replications?)\\b`, "iu").test(text)) {
      return value;
    }
  }

  if (/\b(?:repeat|rerun|replicate|replication|second pass|full slice if promising)\b/iu.test(text)) {
    return 2;
  }

  return undefined;
}

function detectConfidenceIntervalRequirement(chunks: Array<string | undefined>): boolean {
  const text = chunks.filter((value): value is string => Boolean(value?.trim())).join("\n");
  if (!text.trim()) {
    return false;
  }
  return /\bconfidence intervals?\b|\b95%\s*ci\b|\bbootstrap\b|\bvariance\b|\bstatistical significance\b|\buncertainty\b/iu.test(
    text
  );
}

function countFailureCategory(report: AnalysisReport, category: "evidence_gap" | "scope_limit"): number {
  return report.failure_taxonomy.filter((failure) => failure.category === category).length;
}
