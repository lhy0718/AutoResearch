import { RunInsightCard } from "../types.js";
import { AnalysisFailureCategory, AnalysisReport } from "./resultAnalysis.js";

export type ReviewCheckStatus = "ready" | "warning" | "blocking" | "manual";
export type ReviewReadinessStatus = "ready" | "warning" | "blocking";

export interface ReviewPacketCheck {
  id: string;
  label: string;
  status: ReviewCheckStatus;
  detail: string;
}

export interface ReviewPacketRecommendation {
  action: string;
  target?: string;
  confidence_pct: number;
  reason: string;
  evidence: string[];
}

export interface ReviewPacketReviewerSummary {
  reviewer_id: string;
  reviewer_label: string;
  score_1_to_5: number;
  recommendation: string;
  summary: string;
  high_findings: number;
}

export interface ReviewPacketDecision {
  outcome: string;
  recommended_transition?: string;
  confidence_pct: number;
  summary: string;
  rationale: string;
  required_actions: string[];
}

export interface ReviewPacketConsistency {
  panel_agreement: string;
  conflict_count: number;
  bias_flag_count: number;
  summary: string;
}

export interface ReviewPacket {
  generated_at: string;
  readiness: {
    status: ReviewReadinessStatus;
    ready_checks: number;
    warning_checks: number;
    blocking_checks: number;
    manual_checks: number;
  };
  objective_status: string;
  objective_summary: string;
  recommendation?: ReviewPacketRecommendation;
  checks: ReviewPacketCheck[];
  suggested_actions: string[];
  panel?: {
    reviewer_count: number;
    findings_count: number;
    reviewers: ReviewPacketReviewerSummary[];
  };
  consistency?: ReviewPacketConsistency;
  decision?: ReviewPacketDecision;
}

export interface ReviewPacketBuildInput {
  corpusPresent: boolean;
  paperSummariesPresent: boolean;
  evidenceStorePresent: boolean;
  hypothesesPresent: boolean;
  experimentPlanPresent: boolean;
  metricsPresent: boolean;
  figurePresent: boolean;
  synthesisPresent: boolean;
}

export interface ReviewPacketPanelInput {
  reviewers: Array<{
    reviewer_id: string;
    reviewer_label: string;
    score_1_to_5: number;
    recommendation: string;
    summary: string;
    findings: Array<{ severity: "low" | "medium" | "high" }>;
  }>;
  findings: Array<{ title: string; severity: "low" | "medium" | "high" }>;
  consistency: {
    panel_agreement: string;
    conflicts: string[];
    summary: string;
  };
  bias: {
    flags: Array<{ severity: "low" | "medium" | "high"; detail: string }>;
    summary: string;
  };
  decision: {
    outcome: string;
    recommended_transition?: string;
    confidence: number;
    summary: string;
    rationale: string;
    required_actions: string[];
  };
}

export function buildReviewPacket(
  report: AnalysisReport,
  input: ReviewPacketBuildInput,
  panel?: ReviewPacketPanelInput
): ReviewPacket {
  const objectiveStatus = report.overview?.objective_status || "unknown";
  const objectiveSummary =
    report.overview?.objective_summary ||
    report.primary_findings?.[0] ||
    "No structured objective summary was available.";
  const transition = report.transition_recommendation;
  const recommendation = buildRecommendation(transition, panel);

  const checks: ReviewPacketCheck[] = [
    {
      id: "objective_outcome",
      label: "Objective outcome",
      status: objectiveStatus === "met" ? "ready" : "warning",
      detail: objectiveSummary
    },
    buildTransitionCheck(transition, panel),
    buildEvidenceBundleCheck(input),
    buildLiteratureTraceCheck(input),
    buildExecutionRecordCheck(report, input),
    buildFailureReviewCheck(report.failure_taxonomy || []),
    buildNarrativeCheck(report, input),
    {
      id: "primary_figure",
      label: "Primary figure",
      status: input.figurePresent ? "ready" : "warning",
      detail: input.figurePresent
        ? "A primary performance figure is available for human review."
        : "No primary performance figure was generated; inspect result_analysis.json directly."
    }
  ];

  if (panel) {
    checks.push(buildPanelCoverageCheck(panel));
    checks.push(buildPanelConsistencyCheck(panel));
    checks.push(buildBiasGuardCheck(panel));
    checks.push(buildRevisionPlanCheck(panel));
  }

  checks.push({
    id: "human_signoff",
    label: "Human sign-off",
    status: "manual",
    detail: "Confirm the claims, evidence quality, and next action before approving write_paper."
  });

  return {
    generated_at: new Date().toISOString(),
    readiness: summarizeReviewReadiness(checks),
    objective_status: objectiveStatus,
    objective_summary: objectiveSummary,
    recommendation,
    checks,
    suggested_actions: buildSuggestedActions(recommendation, panel, checks),
    panel: panel
      ? {
          reviewer_count: panel.reviewers.length,
          findings_count: panel.findings.length,
          reviewers: panel.reviewers.map((reviewer) => ({
            reviewer_id: reviewer.reviewer_id,
            reviewer_label: reviewer.reviewer_label,
            score_1_to_5: reviewer.score_1_to_5,
            recommendation: reviewer.recommendation,
            summary: reviewer.summary,
            high_findings: reviewer.findings.filter((item) => item.severity === "high").length
          }))
        }
      : undefined,
    consistency: panel
      ? {
          panel_agreement: panel.consistency.panel_agreement,
          conflict_count: panel.consistency.conflicts.length,
          bias_flag_count: panel.bias.flags.length,
          summary: panel.consistency.summary
        }
      : undefined,
    decision: panel
      ? {
          outcome: panel.decision.outcome,
          recommended_transition: panel.decision.recommended_transition,
          confidence_pct: Math.round(panel.decision.confidence * 100),
          summary: panel.decision.summary,
          rationale: panel.decision.rationale,
          required_actions: panel.decision.required_actions.slice(0, 4)
        }
      : undefined
  };
}

export function parseReviewPacket(raw: string): ReviewPacket | undefined {
  if (!raw.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  return normalizeReviewPacket(parsed);
}

export function normalizeReviewPacket(value: unknown): ReviewPacket | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const checks = Array.isArray(record.checks)
    ? record.checks
        .map((item, index) => normalizeReviewCheck(item, index))
        .filter((item): item is ReviewPacketCheck => Boolean(item))
    : [];
  const readiness = summarizeReviewReadiness(checks);
  const recommendation = normalizeRecommendation(record.recommendation);
  const suggestedActions = Array.isArray(record.suggested_actions)
    ? record.suggested_actions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : buildSuggestedActions(recommendation, undefined, checks);

  return {
    generated_at: asString(record.generated_at) || "",
    readiness: normalizeReadiness(record.readiness, readiness),
    objective_status: asString(record.objective_status) || "unknown",
    objective_summary:
      asString(record.objective_summary) || "No structured objective summary was available.",
    recommendation,
    checks,
    suggested_actions: suggestedActions,
    panel: normalizePanel(record.panel),
    consistency: normalizeConsistency(record.consistency),
    decision: normalizeDecision(record.decision)
  };
}

export function summarizeReviewReadiness(
  checks: Pick<ReviewPacketCheck, "status">[]
): ReviewPacket["readiness"] {
  let ready = 0;
  let warning = 0;
  let blocking = 0;
  let manual = 0;

  for (const check of checks) {
    switch (check.status) {
      case "ready":
        ready += 1;
        break;
      case "warning":
        warning += 1;
        break;
      case "blocking":
        blocking += 1;
        break;
      case "manual":
        manual += 1;
        break;
    }
  }

  return {
    status: blocking > 0 ? "blocking" : warning > 0 ? "warning" : "ready",
    ready_checks: ready,
    warning_checks: warning,
    blocking_checks: blocking,
    manual_checks: manual
  };
}

export function formatReviewPacketLines(packet: ReviewPacket): string[] {
  const lines = [
    `Review readiness: ${packet.readiness.status} (${packet.readiness.ready_checks} ready, ${packet.readiness.warning_checks} warning, ${packet.readiness.blocking_checks} blocking, ${packet.readiness.manual_checks} manual)`,
    `Objective: ${packet.objective_status} - ${packet.objective_summary}`
  ];

  if (packet.decision) {
    lines.push(
      `Decision: ${packet.decision.outcome}${packet.decision.recommended_transition ? ` -> ${packet.decision.recommended_transition}` : ""} (${packet.decision.confidence_pct}%)`
    );
    lines.push(`Decision summary: ${packet.decision.summary}`);
  } else if (packet.recommendation) {
    lines.push(
      `Recommendation: ${packet.recommendation.action}${packet.recommendation.target ? ` -> ${packet.recommendation.target}` : ""} (${packet.recommendation.confidence_pct}%)`
    );
  }

  if (packet.panel) {
    lines.push(`Panel: ${packet.panel.reviewer_count} reviewers, ${packet.panel.findings_count} findings`);
  }
  if (packet.consistency) {
    lines.push(`Consensus: ${packet.consistency.panel_agreement} (${packet.consistency.conflict_count} conflicts, ${packet.consistency.bias_flag_count} bias flags)`);
  }

  const blocking = packet.checks.find((item) => item.status === "blocking");
  if (blocking) {
    lines.push(`Blocking: ${blocking.label} - ${blocking.detail}`);
  }

  const warning = packet.checks.find((item) => item.status === "warning");
  if (warning) {
    lines.push(`Warning: ${warning.label} - ${warning.detail}`);
  }

  const manual = packet.checks.find((item) => item.status === "manual");
  if (manual) {
    lines.push(`Manual: ${manual.label} - ${manual.detail}`);
  }

  if (packet.suggested_actions.length > 0) {
    lines.push(`Suggested: ${packet.suggested_actions.slice(0, 3).join(" | ")}`);
  }

  return lines;
}

export function buildReviewInsightCard(packet: ReviewPacket): RunInsightCard {
  return {
    title: "Review packet",
    lines: formatReviewPacketLines(packet),
    actions: packet.suggested_actions.slice(0, 3).map((command) => ({
      label: labelReviewAction(command),
      command
    }))
  };
}

function buildRecommendation(
  transition: AnalysisReport["transition_recommendation"],
  panel?: ReviewPacketPanelInput
): ReviewPacketRecommendation | undefined {
  if (panel?.decision) {
    return {
      action: panel.decision.outcome,
      target: mapDecisionTransitionToNode(panel.decision.recommended_transition),
      confidence_pct: Math.round(panel.decision.confidence * 100),
      reason: panel.decision.summary,
      evidence: panel.findings.slice(0, 3).map((item) => item.title)
    };
  }

  return transition && transition.reason
    ? {
        action: transition.action,
        target: transition.targetNode,
        confidence_pct: Math.round(transition.confidence * 100),
        reason: transition.reason,
        evidence: transition.evidence.slice(0, 3)
      }
    : undefined;
}

function buildTransitionCheck(
  transition: AnalysisReport["transition_recommendation"],
  panel?: ReviewPacketPanelInput
): ReviewPacketCheck {
  if (panel?.decision) {
    return {
      id: "review_decision",
      label: "Review decision",
      status:
        panel.decision.outcome === "advance"
          ? "ready"
          : panel.decision.outcome === "revise_in_place"
            ? "warning"
            : "blocking",
      detail: `${panel.decision.outcome}${panel.decision.recommended_transition ? ` -> ${panel.decision.recommended_transition}` : ""}: ${panel.decision.summary}`
    };
  }

  if (!transition) {
    return {
      id: "transition_recommendation",
      label: "Transition recommendation",
      status: "manual",
      detail: "No explicit transition recommendation was recorded."
    };
  }

  const ready = transition.action === "advance" && transition.targetNode === "review";
  return {
    id: "transition_recommendation",
    label: "Transition recommendation",
    status: ready ? "ready" : "warning",
    detail: `${transition.action}${transition.targetNode ? ` -> ${transition.targetNode}` : ""}: ${transition.reason}`
  };
}

function buildEvidenceBundleCheck(input: ReviewPacketBuildInput): ReviewPacketCheck {
  const missing: string[] = [];
  if (!input.evidenceStorePresent) {
    missing.push("evidence_store.jsonl");
  }
  if (!input.experimentPlanPresent) {
    missing.push("experiment_plan.yaml");
  }

  return {
    id: "evidence_bundle",
    label: "Evidence bundle",
    status: missing.length > 0 ? "blocking" : "ready",
    detail:
      missing.length > 0
        ? `Missing required paper inputs: ${missing.join(", ")}.`
        : "Evidence store and experiment plan are available for paper drafting."
  };
}

function buildLiteratureTraceCheck(input: ReviewPacketBuildInput): ReviewPacketCheck {
  const missing: string[] = [];
  if (!input.corpusPresent) {
    missing.push("corpus.jsonl");
  }
  if (!input.paperSummariesPresent) {
    missing.push("paper_summaries.jsonl");
  }
  if (!input.hypothesesPresent) {
    missing.push("hypotheses.jsonl");
  }

  return {
    id: "literature_traceability",
    label: "Literature traceability",
    status: missing.length > 0 ? "warning" : "ready",
    detail:
      missing.length > 0
        ? `Missing upstream literature artifacts: ${missing.join(", ")}.`
        : "Corpus, paper summaries, and hypotheses are present for reviewer traceability."
  };
}

function buildExecutionRecordCheck(
  report: AnalysisReport,
  input: ReviewPacketBuildInput
): ReviewPacketCheck {
  const executedTrials =
    report.statistical_summary?.executed_trials ??
    report.execution_summary?.observation_count ??
    0;
  const totalTrials = report.statistical_summary?.total_trials ?? executedTrials;

  if (executedTrials <= 0) {
    return {
      id: "execution_record",
      label: "Execution record",
      status: "blocking",
      detail: "No executed trials were recorded in result_analysis.json."
    };
  }

  if (!input.metricsPresent) {
    return {
      id: "execution_record",
      label: "Execution record",
      status: "warning",
      detail: `Executed ${executedTrials}/${totalTrials} trial(s), but metrics.json is missing.`
    };
  }

  return {
    id: "execution_record",
    label: "Execution record",
    status: "ready",
    detail: `Executed ${executedTrials}/${totalTrials} trial(s) with metrics.json available.`
  };
}

function buildFailureReviewCheck(failures: AnalysisFailureCategory[]): ReviewPacketCheck {
  const observedHigh = failures.filter((item) => item.status === "observed" && item.severity === "high");
  const observedMedium = failures.filter((item) => item.status === "observed" && item.severity === "medium");
  const highRisk = failures.filter((item) => item.status === "risk" && item.severity === "high");
  const topIssue = observedHigh[0] || observedMedium[0] || highRisk[0];

  if (observedHigh.length > 0) {
    return {
      id: "failure_review",
      label: "Observed failures",
      status: "blocking",
      detail: summarizeFailureDetail(topIssue, `${observedHigh.length} high-severity observed issue(s) remain unresolved.`)
    };
  }

  if (observedMedium.length > 0 || highRisk.length > 0) {
    return {
      id: "failure_review",
      label: "Observed failures",
      status: "warning",
      detail: summarizeFailureDetail(
        topIssue,
        `${observedMedium.length} medium observed and ${highRisk.length} high-risk issue(s) need human review.`
      )
    };
  }

  return {
    id: "failure_review",
    label: "Observed failures",
    status: "ready",
    detail: "No high-severity observed failures or high-risk gaps were reported."
  };
}

function buildNarrativeCheck(
  report: AnalysisReport,
  input: ReviewPacketBuildInput
): ReviewPacketCheck {
  const claimCount = report.paper_claims?.length || 0;
  const synthesisReady = input.synthesisPresent && Boolean(report.synthesis?.confidence_statement);
  const ready = synthesisReady && claimCount > 0;

  return {
    id: "paper_narrative",
    label: "Paper narrative inputs",
    status: ready ? "ready" : "warning",
    detail: ready
      ? `Synthesis and ${claimCount} grounded paper claim(s) are ready for drafting.`
      : `Synthesis or grounded paper claims are incomplete (claims=${claimCount}, synthesis=${synthesisReady ? "present" : "missing"}).`
  };
}

function buildPanelCoverageCheck(panel: ReviewPacketPanelInput): ReviewPacketCheck {
  const blockingFindings = panel.findings.filter((item) => item.severity === "high").length;
  return {
    id: "specialist_panel",
    label: "Specialist panel coverage",
    status: blockingFindings > 0 ? "blocking" : panel.findings.length > 0 ? "warning" : "ready",
    detail:
      blockingFindings > 0
        ? `${panel.reviewers.length} specialist reviewers found ${blockingFindings} blocking issue(s).`
        : panel.findings.length > 0
          ? `${panel.reviewers.length} specialist reviewers found ${panel.findings.length} actionable issue(s).`
          : `${panel.reviewers.length} specialist reviewers found no actionable issue.`
  };
}

function buildPanelConsistencyCheck(panel: ReviewPacketPanelInput): ReviewPacketCheck {
  return {
    id: "panel_consistency",
    label: "Panel consistency",
    status:
      panel.consistency.panel_agreement === "low"
        ? "warning"
        : panel.consistency.panel_agreement === "medium"
          ? "warning"
          : "ready",
    detail: panel.consistency.summary
  };
}

function buildBiasGuardCheck(panel: ReviewPacketPanelInput): ReviewPacketCheck {
  const highBias = panel.bias.flags.find((item) => item.severity === "high");
  if (highBias) {
    return {
      id: "bias_guard",
      label: "Bias guard",
      status: "blocking",
      detail: highBias.detail
    };
  }
  if (panel.bias.flags[0]) {
    return {
      id: "bias_guard",
      label: "Bias guard",
      status: "warning",
      detail: panel.bias.summary
    };
  }
  return {
    id: "bias_guard",
    label: "Bias guard",
    status: "ready",
    detail: "No major panel-level bias flag was detected."
  };
}

function buildRevisionPlanCheck(panel: ReviewPacketPanelInput): ReviewPacketCheck {
  return {
    id: "revision_plan",
    label: "Revision plan",
    status: panel.decision.outcome === "advance" ? "ready" : "warning",
    detail:
      panel.decision.required_actions.length > 0
        ? panel.decision.required_actions.slice(0, 2).join(" ")
        : "No additional revision action was attached to the final review decision."
  };
}

function buildSuggestedActions(
  recommendation: ReviewPacketRecommendation | undefined,
  panel: ReviewPacketPanelInput | undefined,
  checks: Pick<ReviewPacketCheck, "status">[]
): string[] {
  const readiness = summarizeReviewReadiness(checks);
  const decisionOutcome = panel?.decision.outcome;
  const transition = panel?.decision.recommended_transition;

  if (decisionOutcome === "backtrack_to_hypotheses") {
    return ["/agent jump generate_hypotheses --force", "/agent transition", "/agent review"];
  }
  if (decisionOutcome === "backtrack_to_implement") {
    return ["/agent jump implement_experiments --force", "/agent transition", "/agent review"];
  }
  if (decisionOutcome === "backtrack_to_design") {
    return ["/agent jump design_experiments --force", "/agent transition", "/agent review"];
  }
  if (decisionOutcome === "manual_block") {
    return ["/agent jump design_experiments --force", "/agent transition", "/agent review"];
  }
  if (decisionOutcome === "revise_in_place") {
    return ["/agent run write_paper", "/agent review", "/agent transition"];
  }

  if (transition === "advance" || recommendation?.action === "advance") {
    return ["/agent run write_paper", "/agent review"];
  }

  if (readiness.blocking_checks > 0) {
    return ["/agent transition", "/agent review", "/agent jump analyze_results --force"];
  }
  return ["/agent transition", "/agent review"];
}

function normalizeReviewCheck(value: unknown, index: number): ReviewPacketCheck | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const status = normalizeCheckStatus(record.status);
  return {
    id: asString(record.id) || `check_${index + 1}`,
    label: asString(record.label) || `Check ${index + 1}`,
    status,
    detail: asString(record.detail) || ""
  };
}

function normalizeRecommendation(value: unknown): ReviewPacketRecommendation | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const action = asString(record.action);
  const reason = asString(record.reason);
  if (!action || !reason) {
    return undefined;
  }

  return {
    action,
    target: asString(record.target),
    confidence_pct: asNumber(record.confidence_pct) ?? 0,
    reason,
    evidence: Array.isArray(record.evidence)
      ? record.evidence.filter((item): item is string => typeof item === "string").slice(0, 3)
      : []
  };
}

function normalizeReadiness(
  value: unknown,
  fallback: ReviewPacket["readiness"]
): ReviewPacket["readiness"] {
  const record = asRecord(value);
  if (!record) {
    return fallback;
  }

  const status = asString(record.status);
  return {
    status: status === "ready" || status === "warning" || status === "blocking" ? status : fallback.status,
    ready_checks: asNumber(record.ready_checks) ?? fallback.ready_checks,
    warning_checks: asNumber(record.warning_checks) ?? fallback.warning_checks,
    blocking_checks: asNumber(record.blocking_checks) ?? fallback.blocking_checks,
    manual_checks: asNumber(record.manual_checks) ?? fallback.manual_checks
  };
}

function normalizePanel(value: unknown): ReviewPacket["panel"] | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const reviewers = Array.isArray(record.reviewers)
    ? record.reviewers
        .map((item) => {
          const reviewer = asRecord(item);
          if (!reviewer) {
            return undefined;
          }
          const reviewerId = asString(reviewer.reviewer_id);
          const reviewerLabel = asString(reviewer.reviewer_label);
          if (!reviewerId || !reviewerLabel) {
            return undefined;
          }
          return {
            reviewer_id: reviewerId,
            reviewer_label: reviewerLabel,
            score_1_to_5: asNumber(reviewer.score_1_to_5) ?? 0,
            recommendation: asString(reviewer.recommendation) || "advance",
            summary: asString(reviewer.summary) || "",
            high_findings: asNumber(reviewer.high_findings) ?? 0
          };
        })
        .filter((item): item is ReviewPacketReviewerSummary => Boolean(item))
    : [];

  return {
    reviewer_count: asNumber(record.reviewer_count) ?? reviewers.length,
    findings_count: asNumber(record.findings_count) ?? 0,
    reviewers
  };
}

function normalizeConsistency(value: unknown): ReviewPacket["consistency"] | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    panel_agreement: asString(record.panel_agreement) || "unknown",
    conflict_count: asNumber(record.conflict_count) ?? 0,
    bias_flag_count: asNumber(record.bias_flag_count) ?? 0,
    summary: asString(record.summary) || ""
  };
}

function normalizeDecision(value: unknown): ReviewPacket["decision"] | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const outcome = asString(record.outcome);
  const summary = asString(record.summary);
  const rationale = asString(record.rationale);
  if (!outcome || !summary || !rationale) {
    return undefined;
  }
  return {
    outcome,
    recommended_transition: asString(record.recommended_transition),
    confidence_pct: asNumber(record.confidence_pct) ?? 0,
    summary,
    rationale,
    required_actions: Array.isArray(record.required_actions)
      ? record.required_actions.filter((item): item is string => typeof item === "string").slice(0, 4)
      : []
  };
}

function labelReviewAction(command: string): string {
  switch (command) {
    case "/approve":
      return "Approve review";
    case "/agent run write_paper":
      return "Run write_paper";
    case "/agent review":
      return "Refresh review";
    case "/agent apply":
      return "Apply transition";
    case "/agent transition":
      return "Show transition";
    case "/agent jump analyze_results":
    case "/agent jump analyze_results --force":
      return "Jump analyze_results";
    case "/agent jump generate_hypotheses --force":
      return "Jump generate_hypotheses";
    case "/agent jump design_experiments --force":
      return "Jump design_experiments";
    case "/agent jump implement_experiments --force":
      return "Jump implement_experiments";
    default:
      return command.replace(/^\//, "");
  }
}

function summarizeFailureDetail(
  issue: AnalysisFailureCategory | undefined,
  fallback: string
): string {
  if (!issue) {
    return fallback;
  }
  const action = issue.recommended_action ? ` Next: ${issue.recommended_action}` : "";
  return `${issue.summary}${action}`;
}

function mapDecisionTransitionToNode(value: string | undefined): string | undefined {
  switch (value) {
    case "advance":
      return "write_paper";
    case "backtrack_to_hypotheses":
      return "generate_hypotheses";
    case "backtrack_to_design":
      return "design_experiments";
    case "backtrack_to_implement":
      return "implement_experiments";
    default:
      return undefined;
  }
}

function normalizeCheckStatus(value: unknown): ReviewCheckStatus {
  switch (value) {
    case "ready":
    case "warning":
    case "blocking":
    case "manual":
      return value;
    default:
      return "manual";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
