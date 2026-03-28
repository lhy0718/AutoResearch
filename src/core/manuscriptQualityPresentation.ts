import path from "node:path";

import { RunInsightCard } from "../types.js";
import { formatReadinessRiskSection, type ReadinessRiskArtifact } from "./readinessRisks.js";
import { PaperSubmissionValidationReport } from "./analysis/paperManuscript.js";
import {
  ManuscriptRepairDecision,
  ManuscriptReviewArtifact,
  ManuscriptStyleLintArtifact
} from "./analysis/manuscriptQuality.js";
import { ScientificValidationArtifact } from "./analysis/scientificWriting.js";

type InsightStatus = NonNullable<RunInsightCard["manuscriptQuality"]>["status"];
type InsightStage = NonNullable<RunInsightCard["manuscriptQuality"]>["stage"];
type InsightReasonCategory = NonNullable<RunInsightCard["manuscriptQuality"]>["reasonCategory"];
type InsightPayload = NonNullable<RunInsightCard["manuscriptQuality"]>;

interface ManuscriptQualityFailureArtifact {
  reason: string;
  decision_digest: ManuscriptRepairDecision["decision_digest"];
  summary_lines: string[];
  triggered_by: string[];
  review_reliability: InsightPayload["reviewReliability"];
  final_issues: ManuscriptRepairDecision["issues_before"];
  reviewer_missed_policy_findings: Array<{
    code: string;
    section: string;
    severity: "warning" | "fail";
    gate_role?: "hard_stop";
    location_keys?: string[];
  }>;
  reviewer_covered_backstop_findings: Array<{
    code: string;
    section: string;
    severity: "warning" | "fail";
    gate_role?: "backstop_only";
    covered_by_review_issue_code?: string;
    location_keys?: string[];
  }>;
}

interface ManuscriptQualityArtifactPresence {
  failure: boolean;
  review: boolean;
  reviewValidation: boolean;
  reviewAudit: boolean;
  styleLint: boolean;
  readinessRisks: boolean;
  scientificValidation: boolean;
  submissionValidation: boolean;
  latestRepairVerificationPath?: string;
}

interface ManuscriptQualityInsightInput {
  decision: ManuscriptRepairDecision;
  failure?: ManuscriptQualityFailureArtifact;
  review?: ManuscriptReviewArtifact;
  styleLint?: ManuscriptStyleLintArtifact;
  readinessRisks?: ReadinessRiskArtifact;
  scientificValidation?: ScientificValidationArtifact;
  submissionValidation?: PaperSubmissionValidationReport;
  artifactPresence: ManuscriptQualityArtifactPresence;
}

export async function loadManuscriptQualityInsightCard(input: {
  runDir: string;
  readText: (filePath: string) => Promise<string>;
}): Promise<RunInsightCard | undefined> {
  const gatePath = path.join(input.runDir, "paper", "manuscript_quality_gate.json");
  const gateRaw = await input.readText(gatePath);
  const decision = parseJsonArtifact<ManuscriptRepairDecision>(gateRaw);
  if (!decision) {
    return undefined;
  }

  const failureRaw = await input.readText(path.join(input.runDir, "paper", "manuscript_quality_failure.json"));
  const reviewRaw = await input.readText(path.join(input.runDir, "paper", "manuscript_review.json"));
  const reviewValidationRaw = await input.readText(
    path.join(input.runDir, "paper", "manuscript_review_validation.json")
  );
  const reviewAuditRaw = await input.readText(path.join(input.runDir, "paper", "manuscript_review_audit.json"));
  const styleLintRaw = await input.readText(path.join(input.runDir, "paper", "manuscript_style_lint.json"));
  const readinessRisksRaw = await input.readText(path.join(input.runDir, "paper", "readiness_risks.json"));
  const scientificValidationRaw = await input.readText(path.join(input.runDir, "paper", "scientific_validation.json"));
  const submissionValidationRaw = await input.readText(path.join(input.runDir, "paper", "submission_validation.json"));

  const latestRepairVerificationPath =
    decision.pass_index > 0
      ? path.join(input.runDir, "paper", `manuscript_repair_verification_${Math.min(decision.pass_index, 2)}.json`)
      : undefined;
  const latestRepairVerificationRaw = latestRepairVerificationPath
    ? await input.readText(latestRepairVerificationPath)
    : "";

  return buildManuscriptQualityInsightCard({
    decision,
    failure: parseJsonArtifact<ManuscriptQualityFailureArtifact>(failureRaw),
    review: parseJsonArtifact<ManuscriptReviewArtifact>(reviewRaw),
    styleLint: parseJsonArtifact<ManuscriptStyleLintArtifact>(styleLintRaw),
    readinessRisks: parseJsonArtifact<ReadinessRiskArtifact>(readinessRisksRaw),
    scientificValidation: parseJsonArtifact<ScientificValidationArtifact>(scientificValidationRaw),
    submissionValidation: parseJsonArtifact<PaperSubmissionValidationReport>(submissionValidationRaw),
    artifactPresence: {
      failure: hasArtifact(failureRaw),
      review: hasArtifact(reviewRaw),
      reviewValidation: hasArtifact(reviewValidationRaw),
      reviewAudit: hasArtifact(reviewAuditRaw),
      styleLint: hasArtifact(styleLintRaw),
      readinessRisks: hasArtifact(readinessRisksRaw),
      scientificValidation: hasArtifact(scientificValidationRaw),
      submissionValidation: hasArtifact(submissionValidationRaw),
      latestRepairVerificationPath:
        latestRepairVerificationPath && hasArtifact(latestRepairVerificationRaw)
          ? path.relative(input.runDir, latestRepairVerificationPath).replace(/\\/g, "/")
          : undefined
    }
  });
}

export function buildManuscriptQualityInsightCard(input: ManuscriptQualityInsightInput): RunInsightCard {
  const decisionDigest = input.failure?.decision_digest || input.decision.decision_digest;
  const reviewReliability = input.failure?.review_reliability || decisionDigest.review_reliability;
  const repairableIssues = resolveDisplayedIssues(input).filter((issue) => issue.repairable);
  const hardStopPolicyFindings = resolveHardStopPolicyFindings(input);
  const backstopOnlyFindings = resolveBackstopOnlyFindings(input);
  const readinessRisks = resolveReadinessRisks(input.readinessRisks);
  const scientificBlockers = resolveScientificBlockers(input.scientificValidation);
  const submissionBlockers = resolveSubmissionBlockers(input.submissionValidation);
  const status = resolveInsightStatus({
    decision: input.decision,
    failure: input.failure,
    scientificBlockerCount: scientificBlockers.length,
    submissionBlockerCount: submissionBlockers.length
  });
  const reasonCategory = resolveInsightReasonCategory({
    decision: input.decision,
    scientificBlockerCount: scientificBlockers.length,
    submissionBlockerCount: submissionBlockers.length
  });
  const displayReasonLabel = resolveDisplayReasonLabel({
    status,
    reasonCategory,
    readinessRiskCount: readinessRisks.length,
    scientificBlockerCount: scientificBlockers.length,
    submissionBlockerCount: submissionBlockers.length,
    hardStopPolicyCount: hardStopPolicyFindings.length
  });
  const stage = decisionDigest.stage as InsightStage;
  const lines = buildInsightLines({
    status,
    reasonCategory,
    displayReasonLabel,
    reviewReliability,
    decision: input.decision,
    failure: input.failure,
    readinessRisks,
    scientificBlockers,
    submissionBlockers
  });

  return {
    title: "Manuscript quality",
    lines,
    manuscriptQuality: {
      status,
      stage,
      reasonCategory,
      displayReasonLabel,
      reviewReliability,
      triggeredBy: [...input.decision.triggered_by],
      repairAttempts: {
        attempted: input.decision.pass_index,
        allowedMax: input.decision.allowed_max_passes,
        remaining: input.decision.remaining_allowed_repairs,
        improvementDetected: input.decision.improvement_detected
      },
      issueCounts: {
        manuscript: repairableIssues.length,
        hardStopPolicy: hardStopPolicyFindings.length,
        backstopOnly: backstopOnlyFindings.length,
        readinessRisks: readinessRisks.length,
        scientificBlockers: scientificBlockers.length,
        submissionBlockers: submissionBlockers.length,
        reviewerMissedPolicy: input.failure?.reviewer_missed_policy_findings.length || 0,
        reviewerCoveredBackstop: input.failure?.reviewer_covered_backstop_findings.length || 0
      },
      issueGroups: {
        manuscript: repairableIssues.map((issue) => ({
          code: issue.code,
          section: issue.section,
          severity: issue.severity,
          message: issue.message,
          source: issue.source
        })),
        hardStopPolicy: hardStopPolicyFindings,
        backstopOnly: backstopOnlyFindings,
        readiness: readinessRisks,
        scientific: scientificBlockers,
        submission: submissionBlockers
      },
      artifactRefs: buildArtifactRefs(input)
    }
  };
}

function resolveDisplayedIssues(
  input: ManuscriptQualityInsightInput
): NonNullable<ManuscriptQualityFailureArtifact["final_issues"]> {
  if (input.failure?.final_issues?.length) {
    return input.failure.final_issues;
  }
  if (input.decision.issues_after?.length) {
    return input.decision.issues_after;
  }
  return input.decision.issues_before;
}

function resolveHardStopPolicyFindings(
  input: ManuscriptQualityInsightInput
): InsightPayload["issueGroups"]["hardStopPolicy"] {
  if (input.failure?.reviewer_missed_policy_findings?.length) {
    return input.failure.reviewer_missed_policy_findings.map((issue) => ({
      code: issue.code,
      section: issue.section,
      severity: issue.severity,
      message: `Deterministic hard-stop policy finding remained uncovered in ${issue.section}.`,
      source: "style_lint" as const
    }));
  }
  const issues = input.styleLint?.issues.filter((issue) => issue.gate_role === "hard_stop") || [];
  return issues.map((issue) => ({
    code: issue.code,
    section: issue.section,
    severity: issue.severity,
    message: issue.message,
    source: "style_lint" as const
  }));
}

function resolveBackstopOnlyFindings(
  input: ManuscriptQualityInsightInput
): InsightPayload["issueGroups"]["backstopOnly"] {
  if (input.failure?.reviewer_covered_backstop_findings?.length) {
    return input.failure.reviewer_covered_backstop_findings.map((issue) => ({
      code: issue.code,
      section: issue.section,
      severity: issue.severity,
      message: `Deterministic backstop finding remains recorded for ${issue.section}.`,
      source: "style_lint" as const
    }));
  }
  const issues =
    input.styleLint?.issues.filter(
      (issue) => issue.gate_role === "backstop_only" || issue.coverage_status === "backstop_only"
    ) || [];
  return issues.map((issue) => ({
    code: issue.code,
    section: issue.section,
    severity: issue.severity,
    message: issue.message,
    source: "style_lint" as const
  }));
}

function resolveReadinessRisks(
  readinessRisks?: ReadinessRiskArtifact
): NonNullable<InsightPayload["issueGroups"]["readiness"]> {
  return (
    readinessRisks?.risks.map((risk) => ({
      code: risk.risk_code,
      section: formatReadinessRiskSection(risk.category),
      severity: risk.severity === "blocked" ? ("fail" as const) : ("warning" as const),
      message: risk.message,
      source: "paper_readiness" as const
    })) || []
  );
}

function resolveScientificBlockers(
  scientificValidation?: ScientificValidationArtifact
): InsightPayload["issueGroups"]["scientific"] {
  const issues = scientificValidation?.issues.filter((issue) => issue.severity === "error") || [];
  return issues.slice(0, 6).map((issue) => ({
    code: issue.code,
    section: issue.involved_sections?.[0] || "Scientific validation",
    severity: "fail" as const,
    message: issue.message,
    source: "scientific_validation" as const
  }));
}

function resolveSubmissionBlockers(
  submissionValidation?: PaperSubmissionValidationReport
): InsightPayload["issueGroups"]["submission"] {
  if (!submissionValidation || submissionValidation.ok) {
    return [];
  }
  return submissionValidation.issues.slice(0, 6).map((issue) => ({
    code: issue.kind,
    section: issue.location || "Submission validation",
    severity: "fail" as const,
    message: issue.message,
    source: "submission_validation" as const
  }));
}

function resolveInsightStatus(input: {
  decision: ManuscriptRepairDecision;
  failure?: ManuscriptQualityFailureArtifact;
  scientificBlockerCount: number;
  submissionBlockerCount: number;
}): InsightStatus {
  if (input.decision.action === "repair") {
    return "repairing";
  }
  if (
    input.failure ||
    input.decision.action === "stop" ||
    input.scientificBlockerCount > 0 ||
    input.submissionBlockerCount > 0
  ) {
    return "stopped";
  }
  return "pass";
}

function resolveInsightReasonCategory(input: {
  decision: ManuscriptRepairDecision;
  scientificBlockerCount: number;
  submissionBlockerCount: number;
}): InsightReasonCategory {
  if (input.scientificBlockerCount > 0 || input.submissionBlockerCount > 0) {
    return "upstream_scientific_or_submission_failure";
  }
  return input.decision.decision_digest.stop_reason_category;
}

function buildInsightLines(input: {
  status: InsightStatus;
  reasonCategory: InsightReasonCategory;
  displayReasonLabel: string;
  reviewReliability: InsightPayload["reviewReliability"];
  decision: ManuscriptRepairDecision;
  failure?: ManuscriptQualityFailureArtifact;
  readinessRisks: NonNullable<InsightPayload["issueGroups"]["readiness"]>;
  scientificBlockers: InsightPayload["issueGroups"]["scientific"];
  submissionBlockers: InsightPayload["issueGroups"]["submission"];
}): string[] {
  const leadSummaryLines =
    input.failure?.summary_lines?.filter((line) => line.trim().length > 0) ||
    input.decision.summary_lines.filter((line) => line.trim().length > 0);
  const lines = [
    `Status: ${formatInsightStatus(input.status)}.`,
    `Reason: ${input.displayReasonLabel}.`,
    `Review reliability: ${input.reviewReliability}.`
  ];
  if (input.decision.triggered_by.length > 0) {
    lines.push(`Triggered by: ${input.decision.triggered_by.join(", ")}.`);
  }
  if (input.scientificBlockers[0]) {
    lines.push(`Scientific blocker: ${truncateOneLine(input.scientificBlockers[0].message, 170)}`);
  } else if (input.submissionBlockers[0]) {
    lines.push(`Submission blocker: ${truncateOneLine(input.submissionBlockers[0].message, 170)}`);
  } else if (input.readinessRisks[0]) {
    lines.push(`Readiness risk: ${truncateOneLine(input.readinessRisks[0].message, 170)}`);
  }
  for (const line of leadSummaryLines) {
    if (lines.length >= 6) {
      break;
    }
    if (!lines.includes(line)) {
      lines.push(truncateOneLine(line, 180));
    }
  }
  return lines.slice(0, 6);
}

function resolveDisplayReasonLabel(input: {
  status: InsightStatus;
  reasonCategory: InsightReasonCategory;
  readinessRiskCount: number;
  scientificBlockerCount: number;
  submissionBlockerCount: number;
  hardStopPolicyCount: number;
}): string {
  if (input.status === "pass") {
    return "Passed";
  }
  if (input.status === "repairing") {
    return "Repair required";
  }
  if (input.hardStopPolicyCount > 0 || input.reasonCategory === "policy_hard_stop") {
    return "Policy hard stop";
  }
  if (input.readinessRiskCount > 0 || input.scientificBlockerCount > 0 || input.submissionBlockerCount > 0) {
    return "Paper-readiness stop";
  }
  if (input.reasonCategory === "review_reliability") {
    return "Review reliability stop";
  }
  if (input.reasonCategory === "visual_overclaim") {
    return "Visual overclaim stop";
  }
  if (input.reasonCategory === "locality_violation") {
    return "Locality violation";
  }
  if (input.reasonCategory === "repeated_issue") {
    return "Repeated issue";
  }
  if (input.reasonCategory === "scope_too_broad") {
    return "Scope too broad";
  }
  return "Stopped after review";
}

function buildArtifactRefs(input: ManuscriptQualityInsightInput): InsightPayload["artifactRefs"] {
  const refs: InsightPayload["artifactRefs"] = [
    {
      label: "Manuscript quality gate",
      path: "paper/manuscript_quality_gate.json"
    }
  ];
  if (input.artifactPresence.failure) {
    refs.push({
      label: "Manuscript quality failure",
      path: "paper/manuscript_quality_failure.json"
    });
  }
  if (input.artifactPresence.review) {
    refs.push({
      label: "Manuscript review",
      path: "paper/manuscript_review.json"
    });
  }
  if (input.artifactPresence.reviewValidation) {
    refs.push({
      label: "Review validation",
      path: "paper/manuscript_review_validation.json"
    });
  }
  if (input.artifactPresence.reviewAudit) {
    refs.push({
      label: "Review audit",
      path: "paper/manuscript_review_audit.json"
    });
  }
  if (input.artifactPresence.styleLint) {
    refs.push({
      label: "Style lint",
      path: "paper/manuscript_style_lint.json"
    });
  }
  if (input.artifactPresence.readinessRisks) {
    refs.push({
      label: "Readiness risks",
      path: "paper/readiness_risks.json"
    });
  }
  if (input.artifactPresence.latestRepairVerificationPath) {
    refs.push({
      label: `Repair verification ${input.decision.pass_index}`,
      path: input.artifactPresence.latestRepairVerificationPath
    });
  }
  if (input.artifactPresence.scientificValidation) {
    refs.push({
      label: "Scientific validation",
      path: "paper/scientific_validation.json"
    });
  }
  if (input.artifactPresence.submissionValidation) {
    refs.push({
      label: "Submission validation",
      path: "paper/submission_validation.json"
    });
  }
  return refs;
}

function parseJsonArtifact<T>(raw: string): T | undefined {
  if (!hasArtifact(raw)) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function hasArtifact(raw: string | undefined): boolean {
  return Boolean(raw && raw.trim().length > 0);
}

function truncateOneLine(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 3)}...`;
}

function formatInsightStatus(status: InsightStatus): string {
  switch (status) {
    case "pass":
      return "Pass";
    case "repairing":
      return "Repairing";
    case "stopped":
      return "Stopped";
  }
}

function formatReasonCategory(value: InsightReasonCategory): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
