import { EventStream } from "./events.js";
import type { RiskSignal } from "./analysis/riskSignals.js";
import { parseStructuredModelJsonObject } from "./analysis/modelJson.js";
import { LLMClient, LLMCompletionUsage } from "./llm/client.js";
import { AnalysisFailureCategory, AnalysisPaperClaim, AnalysisReport } from "./resultAnalysis.js";
import { RunRecord, GraphNodeId } from "../types.js";
import { loadReviewPromptSections } from "./nodePrompts.js";

export type ReviewDimension =
  | "claim_verification"
  | "methodology"
  | "statistics"
  | "writing_readiness"
  | "integrity";

export type ReviewSeverity = "low" | "medium" | "high";
export type ReviewRecommendation =
  | "advance"
  | "revise_in_place"
  | "backtrack_to_hypotheses"
  | "backtrack_to_design"
  | "backtrack_to_implement"
  | "manual_block";

export type ReviewAgreement = "high" | "medium" | "low";
export type ReviewBiasKind =
  | "positive_outcome_bias"
  | "verbosity_imbalance"
  | "consensus_gap"
  | "concern_acceptance_conflict";

export interface ReviewArtifactPresence {
  corpusPresent: boolean;
  paperSummariesPresent: boolean;
  evidenceStorePresent: boolean;
  hypothesesPresent: boolean;
  experimentPlanPresent: boolean;
  metricsPresent: boolean;
  figurePresent: boolean;
  synthesisPresent: boolean;
  baselineSummaryPresent: boolean;
  resultTablePresent: boolean;
  richnessSummaryPresent: boolean;
  richnessReadiness: "adequate" | "marginal" | "insufficient" | "unknown";
}

export interface ReviewFinding {
  id: string;
  reviewer_id: string;
  reviewer_label: string;
  dimension: ReviewDimension;
  severity: ReviewSeverity;
  title: string;
  detail: string;
  claim_ids: string[];
  evidence_paths: string[];
  fix_hint?: string;
  confidence: number;
}

export interface SpecialistReviewResult {
  reviewer_id: string;
  reviewer_label: string;
  dimension: ReviewDimension;
  score_1_to_5: number;
  confidence: number;
  recommendation: ReviewRecommendation;
  summary: string;
  findings: ReviewFinding[];
  source: "heuristic" | "llm+heuristic";
}

export interface ReviewScorecardDimension {
  dimension: ReviewDimension;
  label: string;
  score_1_to_5: number;
  confidence: number;
  summary: string;
  top_finding_ids: string[];
}

export interface ReviewScorecard {
  overall_score_1_to_5: number;
  dimensions: ReviewScorecardDimension[];
}

export interface ReviewConsistencyReport {
  panel_agreement: ReviewAgreement;
  pairwise_recommendation_agreement: number;
  score_spread: number;
  recommendation_histogram: Record<string, number>;
  conflicts: string[];
  summary: string;
}

export interface ReviewBiasFlag {
  kind: ReviewBiasKind;
  severity: ReviewSeverity;
  detail: string;
}

export interface ReviewBiasReport {
  flags: ReviewBiasFlag[];
  summary: string;
}

export interface ReviewRevisionPlanItem {
  id: string;
  priority: ReviewSeverity;
  owner: "analysis" | "design" | "implementation" | "writing" | "human_review";
  title: string;
  action: string;
  source_finding_ids: string[];
}

export interface ReviewRevisionPlan {
  items: ReviewRevisionPlanItem[];
  summary: string;
}

export interface ReviewDecision {
  outcome: ReviewRecommendation;
  recommended_transition?: "advance" | "backtrack_to_hypotheses" | "backtrack_to_design" | "backtrack_to_implement";
  confidence: number;
  summary: string;
  rationale: string;
  blocking_finding_ids: string[];
  required_actions: string[];
}

export interface ReviewPanelResult {
  reviewers: SpecialistReviewResult[];
  findings: ReviewFinding[];
  scorecard: ReviewScorecard;
  consistency: ReviewConsistencyReport;
  bias: ReviewBiasReport;
  revision_plan: ReviewRevisionPlan;
  decision: ReviewDecision;
  llm_calls_used: number;
  llm_cost_usd?: number;
  llm_input_tokens?: number;
  llm_output_tokens?: number;
}

interface ReviewPanelArgs {
  run: Pick<RunRecord, "id" | "title" | "topic" | "objectiveMetric" | "constraints">;
  node: GraphNodeId;
  report: AnalysisReport;
  presence: ReviewArtifactPresence;
  orphanCitations?: string[];
  riskSignals?: RiskSignal[];
  llm: LLMClient;
  eventStream?: EventStream;
  abortSignal?: AbortSignal;
}

interface ReviewerSpec {
  reviewer_id: string;
  reviewer_label: string;
  dimension: ReviewDimension;
  buildFallback: (report: AnalysisReport, presence: ReviewArtifactPresence) => SpecialistReviewResult;
}

interface RawReviewerFinding {
  title?: unknown;
  severity?: unknown;
  detail?: unknown;
  evidence_paths?: unknown;
  claim_ids?: unknown;
  fix_hint?: unknown;
  confidence?: unknown;
}

interface RawReviewerResponse {
  summary?: unknown;
  score_1_to_5?: unknown;
  confidence?: unknown;
  recommendation?: unknown;
  findings?: unknown;
}

const REVIEWER_SPECS: ReviewerSpec[] = [
  {
    reviewer_id: "claim_verifier",
    reviewer_label: "Claim verifier",
    dimension: "claim_verification",
    buildFallback: buildClaimVerificationFallback
  },
  {
    reviewer_id: "methodology_reviewer",
    reviewer_label: "Methodology reviewer",
    dimension: "methodology",
    buildFallback: buildMethodologyFallback
  },
  {
    reviewer_id: "statistics_reviewer",
    reviewer_label: "Statistics reviewer",
    dimension: "statistics",
    buildFallback: buildStatisticsFallback
  },
  {
    reviewer_id: "writing_readiness_reviewer",
    reviewer_label: "Writing readiness reviewer",
    dimension: "writing_readiness",
    buildFallback: buildWritingReadinessFallback
  },
  {
    reviewer_id: "integrity_reviewer",
    reviewer_label: "Integrity reviewer",
    dimension: "integrity",
    buildFallback: buildIntegrityFallback
  }
];

const DEFAULT_REVIEW_REFINEMENT_TIMEOUT_MS = 20_000;

export async function runReviewPanel(args: ReviewPanelArgs): Promise<ReviewPanelResult> {
  const reviewers: SpecialistReviewResult[] = [];
  let llmCallsUsed = 0;
  let llmCostUsd = 0;
  let llmInputTokens = 0;
  let llmOutputTokens = 0;

  for (const spec of REVIEWER_SPECS) {
    args.eventStream?.emit({
      type: "OBS_RECEIVED",
      runId: args.run.id,
      node: args.node,
      agentRole: "reviewer",
      payload: {
        text: `Review panel: running ${spec.reviewer_label.toLowerCase()}.`
      }
    });

    const fallback = spec.buildFallback(args.report, args.presence);
    const refined = await refineReviewerWithLlm(args, spec, fallback);
    if (refined.usedLlm) {
      llmCallsUsed += 1;
      llmCostUsd += refined.costUsd ?? 0;
      llmInputTokens += refined.usage?.inputTokens ?? 0;
      llmOutputTokens += refined.usage?.outputTokens ?? 0;
    }
    reviewers.push(refined.result);
  }

  const findings = dedupeFindings(
    reviewers.flatMap((reviewer) => reviewer.findings)
  );
  const scorecard = buildScorecard(reviewers);
  const consistency = buildConsistencyReport(reviewers, findings);
  const bias = buildBiasReport(args.report, reviewers, findings, consistency);
  const revisionPlan = buildRevisionPlan(findings);
  const decision = buildDecision(args.report, reviewers, findings, consistency, bias, revisionPlan);

  return {
    reviewers,
    findings,
    scorecard,
    consistency,
    bias,
    revision_plan: revisionPlan,
    decision,
    llm_calls_used: llmCallsUsed,
    llm_cost_usd: llmCallsUsed > 0 ? roundTwo(llmCostUsd) : undefined,
    llm_input_tokens: llmCallsUsed > 0 ? Math.max(0, Math.round(llmInputTokens)) : undefined,
    llm_output_tokens: llmCallsUsed > 0 ? Math.max(0, Math.round(llmOutputTokens)) : undefined
  };
}

async function refineReviewerWithLlm(
  args: ReviewPanelArgs,
  spec: ReviewerSpec,
  fallback: SpecialistReviewResult
): Promise<{ result: SpecialistReviewResult; usedLlm: boolean; costUsd?: number; usage?: LLMCompletionUsage }> {
  const timeoutMs = resolveReviewRefinementTimeoutMs();
  try {
    const completion = await runWithAbortableTimeout(
      timeoutMs,
      args.abortSignal,
      (abortSignal) =>
        args.llm.complete(buildReviewerPrompt(
          args.run,
          args.report,
          args.presence,
          spec,
          fallback,
          args.orphanCitations,
          args.riskSignals
        ), {
          // The prompt builder reads orphan citations from args to keep specialist context auditably explicit.
          systemPrompt: buildReviewerSystemPrompt(spec),
          abortSignal
        }),
      `review_refinement_timeout_after_${timeoutMs}ms`
    );
    const parsed = parseReviewerResponse(completion.text, spec, fallback);
    if (parsed.repaired) {
      args.eventStream?.emit({
        type: "OBS_RECEIVED",
        runId: args.run.id,
        node: args.node,
        agentRole: "reviewer",
        payload: {
          text: `Review panel repaired truncated JSON for ${spec.reviewer_label.toLowerCase()} before parsing.`
        }
      });
    }
    return {
      result: mergeReviewerResults(fallback, parsed.result),
      usedLlm: true,
      costUsd: completion.usage?.costUsd,
      usage: completion.usage
    };
  } catch (error) {
    const reason = describeReviewRefinementFallbackReason(error);
    args.eventStream?.emit({
      type: "OBS_RECEIVED",
      runId: args.run.id,
      node: args.node,
      agentRole: "reviewer",
      payload: {
        text: `Review panel fallback for ${spec.reviewer_label.toLowerCase()}: ${reason}`
      }
    });
    return {
      result: fallback,
      usedLlm: false
    };
  }
}

function buildReviewerSystemPrompt(spec: ReviewerSpec): string {
  return loadReviewPromptSections()
    .reviewerSystemTemplate
    .replace(/\{\{\s*reviewer_label\s*\}\}/gu, spec.reviewer_label.toLowerCase())
    .trim();
}

function buildReviewerPrompt(
  run: ReviewPanelArgs["run"],
  report: AnalysisReport,
  presence: ReviewArtifactPresence,
  spec: ReviewerSpec,
  fallback: SpecialistReviewResult,
  orphanCitations: string[] = [],
  riskSignals: RiskSignal[] = []
): string {
  const payload = {
    reviewer: {
      id: spec.reviewer_id,
      label: spec.reviewer_label,
      dimension: spec.dimension
    },
    run: {
      topic: run.topic,
      title: run.title,
      objective_metric: run.objectiveMetric,
      constraints: run.constraints
    },
    overview: {
      objective_status: report.overview.objective_status,
      objective_summary: report.overview.objective_summary,
      execution_runs: report.overview.execution_runs
    },
    transition_recommendation: report.transition_recommendation
      ? {
          action: report.transition_recommendation.action,
          targetNode: report.transition_recommendation.targetNode,
          reason: report.transition_recommendation.reason,
          confidence: report.transition_recommendation.confidence
        }
      : undefined,
    artifact_presence: presence,
    primary_findings: report.primary_findings.slice(0, 4),
    limitations: report.limitations.slice(0, 4),
    warnings: report.warnings.slice(0, 4),
    orphan_citations: orphanCitations.slice(0, 12),
    risk_signals: riskSignals.slice(0, 12),
    paper_claims: report.paper_claims.slice(0, 4).map((claim) => ({
      claim: claim.claim,
      evidence_count: claim.evidence.length
    })),
    figure_specs: report.figure_specs.slice(0, 3).map((figure) => ({
      title: figure.title,
      path: figure.path,
      metric_keys: figure.metric_keys
    })),
    selected_design: report.plan_context.selected_design
      ? {
          title: report.plan_context.selected_design.title,
          metrics: report.plan_context.selected_design.metrics,
          baselines: report.plan_context.selected_design.baselines,
          evaluation_steps: report.plan_context.selected_design.evaluation_steps,
          risks: report.plan_context.selected_design.risks
        }
      : undefined,
    statistical_summary: {
      total_trials: report.statistical_summary.total_trials,
      executed_trials: report.statistical_summary.executed_trials,
      confidence_intervals: report.statistical_summary.confidence_intervals.slice(0, 4).map((item) => item.summary),
      effect_estimates: report.statistical_summary.effect_estimates.slice(0, 4).map((item) => item.summary),
      notes: report.statistical_summary.notes.slice(0, 4)
    },
    failure_taxonomy: report.failure_taxonomy.slice(0, 6).map((item) => ({
      category: item.category,
      severity: item.severity,
      status: item.status,
      summary: item.summary,
      recommended_action: item.recommended_action
    })),
    heuristic_baseline: {
      summary: fallback.summary,
      score_1_to_5: fallback.score_1_to_5,
      confidence: fallback.confidence,
      recommendation: fallback.recommendation,
      findings: fallback.findings.map((item) => ({
        title: item.title,
        severity: item.severity,
        detail: item.detail,
        evidence_paths: item.evidence_paths,
        fix_hint: item.fix_hint
      }))
    }
  };

  return [
    "Return one JSON object with this shape:",
    "{",
    '  "summary": string,',
    '  "score_1_to_5": number,',
    '  "confidence": number,',
    '  "recommendation": "advance" | "revise_in_place" | "backtrack_to_hypotheses" | "backtrack_to_design" | "backtrack_to_implement" | "manual_block",',
    '  "findings": [',
    "    {",
    '      "title": string,',
    '      "severity": "low" | "medium" | "high",',
    '      "detail": string,',
    '      "evidence_paths": string[],',
    '      "claim_ids": string[],',
    '      "fix_hint": string,',
    '      "confidence": number',
    "    }",
    "  ]",
    "}",
    "",
    "Rules:",
    "- Keep summary to one or two sentences.",
    "- score_1_to_5: 1 means not ready at all, 5 means publication-ready for this dimension.",
    "- confidence: 0.0 to 1.0.",
    "- findings: up to 4 concrete issues, conservative and evidence-grounded.",
    "- Do not repeat the heuristic baseline verbatim if you disagree, but stay grounded.",
    "",
    JSON.stringify(payload, null, 2)
  ].join("\n");
}

function parseReviewerResponse(
  raw: string,
  spec: ReviewerSpec,
  fallback: SpecialistReviewResult
): { result: SpecialistReviewResult; repaired: boolean } {
  const parsed = parseStructuredModelJsonObject<RawReviewerResponse>(raw, {
    emptyError: "Reviewer LLM returned an empty response.",
    notFoundError: "Reviewer LLM returned no JSON object.",
    incompleteError: "Reviewer JSON object looks truncated.",
    invalidError: "Reviewer JSON must decode to an object."
  });

  const record = parsed.value;
  return {
    repaired: parsed.repaired,
    result: {
      reviewer_id: spec.reviewer_id,
      reviewer_label: spec.reviewer_label,
      dimension: spec.dimension,
      score_1_to_5: clampScore(asNumber(record.score_1_to_5) ?? fallback.score_1_to_5),
      confidence: clampConfidence(asNumber(record.confidence) ?? fallback.confidence),
      recommendation: normalizeRecommendation(record.recommendation) ?? fallback.recommendation,
      summary: cleanString(record.summary) || fallback.summary,
      findings: normalizeReviewerFindings(record.findings, spec, fallback.reviewer_label),
      source: "llm+heuristic"
    }
  };
}

function normalizeReviewerFindings(
  value: unknown,
  spec: ReviewerSpec,
  reviewerLabel: string
): ReviewFinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => normalizeReviewerFinding(item, spec, reviewerLabel, index))
    .filter((item): item is ReviewFinding => Boolean(item))
    .slice(0, 4);
}

function normalizeReviewerFinding(
  value: unknown,
  spec: ReviewerSpec,
  reviewerLabel: string,
  index: number
): ReviewFinding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as RawReviewerFinding;
  const title = cleanString(record.title);
  const detail = cleanString(record.detail);
  if (!title || !detail) {
    return undefined;
  }

  return {
    id: `${spec.reviewer_id}_${index + 1}`,
    reviewer_id: spec.reviewer_id,
    reviewer_label: reviewerLabel,
    dimension: spec.dimension,
    severity: normalizeSeverity(record.severity) ?? "medium",
    title,
    detail,
    claim_ids: normalizeStringArray(record.claim_ids, 6),
    evidence_paths: normalizeStringArray(record.evidence_paths, 6),
    fix_hint: cleanString(record.fix_hint) || undefined,
    confidence: clampConfidence(asNumber(record.confidence) ?? 0.6)
  };
}

function mergeReviewerResults(
  fallback: SpecialistReviewResult,
  refined: SpecialistReviewResult
): SpecialistReviewResult {
  const findings = dedupeFindings([...fallback.findings, ...refined.findings]);
  return {
    ...fallback,
    score_1_to_5: Math.min(fallback.score_1_to_5, refined.score_1_to_5),
    confidence: roundTwo((fallback.confidence + refined.confidence) / 2),
    recommendation: moreConservativeRecommendation(fallback.recommendation, refined.recommendation),
    summary: refined.summary || fallback.summary,
    findings,
    source: "llm+heuristic"
  };
}

function buildClaimVerificationFallback(
  report: AnalysisReport,
  presence: ReviewArtifactPresence
): SpecialistReviewResult {
  const findings: ReviewFinding[] = [];

  if (!presence.evidenceStorePresent) {
    findings.push(
      createFinding("claim_verifier", "Claim verifier", "claim_verification", "high", "Missing evidence store", "Claims cannot be fully audited because evidence_store.jsonl is missing.", ["evidence_store.jsonl"], [], "Recreate evidence_store.jsonl before drafting claims.", 0.94)
    );
  }

  if ((report.paper_claims?.length || 0) === 0) {
    findings.push(
      createFinding("claim_verifier", "Claim verifier", "claim_verification", "medium", "No grounded paper claims", "The analysis does not yet contain structured paper_claims for the reviewer to verify.", ["result_analysis.json"], [], "Generate grounded paper_claims before writing the paper.", 0.82)
    );
  }

  if (report.overview.objective_status !== "met" && report.overview.objective_status !== "observed" && (report.paper_claims?.length || 0) > 0) {
    findings.push(
      createFinding("claim_verifier", "Claim verifier", "claim_verification", "high", "Claims outpace measured outcome", "Paper claims exist even though the configured objective is not met, so stronger success claims would be unsafe.", ["result_analysis.json"], claimIds(report.paper_claims), "Reduce claims or rerun experiments until the objective is met.", 0.86)
    );
  }

  if (report.paper_claims.some((claim) => claim.evidence.length === 0)) {
    findings.push(
      createFinding("claim_verifier", "Claim verifier", "claim_verification", "medium", "Claim without explicit evidence", "At least one paper claim has no attached evidence link in result_analysis.json.", ["result_analysis.json"], claimIds(report.paper_claims.filter((claim) => claim.evidence.length === 0)), "Attach explicit evidence to every paper claim or remove unsupported claims.", 0.79)
    );
  }

  if (report.condition_comparisons.length === 0 && report.paper_claims.length > 0) {
    findings.push(
      createFinding("claim_verifier", "Claim verifier", "claim_verification", "medium", "No primary comparison for drafted claims", "Claims are present but the report does not expose a primary condition comparison to justify them.", ["result_analysis.json"], claimIds(report.paper_claims), "Add a grounded comparison or soften the claims to descriptive statements only.", 0.74)
    );
  }

  return finalizeFallbackReviewer({
    reviewer_id: "claim_verifier",
    reviewer_label: "Claim verifier",
    dimension: "claim_verification",
    findings,
    cleanSummary: "Claims are grounded when explicit evidence links and measured comparisons back each paper-facing statement.",
    issueSummary: findings[0]?.detail || "Claim support is incomplete."
  });
}

function buildMethodologyFallback(
  report: AnalysisReport,
  presence: ReviewArtifactPresence
): SpecialistReviewResult {
  const findings: ReviewFinding[] = [];
  const selectedDesign = report.plan_context.selected_design;

  if (!presence.experimentPlanPresent) {
    findings.push(
      createFinding("methodology_reviewer", "Methodology reviewer", "methodology", "high", "Missing experiment plan", "experiment_plan.yaml is missing, so the reviewer cannot trace the intended baselines and evaluation design.", ["experiment_plan.yaml"], [], "Regenerate experiment_plan.yaml before proceeding.", 0.95)
    );
  }

  if (!selectedDesign) {
    findings.push(
      createFinding("methodology_reviewer", "Methodology reviewer", "methodology", "medium", "No selected design context", "The report does not contain a selected design summary for the review panel.", ["result_analysis.json"], [], "Persist selected_design details into the analysis report.", 0.76)
    );
  } else {
    if ((selectedDesign.baselines?.length || 0) === 0) {
      findings.push(
        createFinding("methodology_reviewer", "Methodology reviewer", "methodology", "medium", "Baselines not explicit", "The selected design does not list explicit baselines, which weakens methodological comparison.", ["experiment_plan.yaml", "result_analysis.json"], [], "Add explicit baselines to the selected design and compare against them.", 0.72)
      );
    }
    if ((selectedDesign.evaluation_steps?.length || 0) === 0) {
      findings.push(
        createFinding("methodology_reviewer", "Methodology reviewer", "methodology", "medium", "Evaluation steps missing", "The selected design does not enumerate evaluation steps, making reproduction and auditing harder.", ["experiment_plan.yaml", "result_analysis.json"], [], "Document the evaluation steps in the experiment plan.", 0.71)
      );
    }
  }

  const scopeIssue = report.failure_taxonomy.find((item) => item.category === "scope_limit");
  if (scopeIssue) {
    findings.push(
      createFinding("methodology_reviewer", "Methodology reviewer", "methodology", scopeIssue.severity === "high" ? "high" : "medium", "Method scope remains narrow", scopeIssue.summary, ["result_analysis.json"], [], scopeIssue.recommended_action || "Widen confirmatory coverage before drafting stronger conclusions.", 0.77)
    );
  }

  if ((report.execution_summary.observation_count || 0) <= 1) {
    findings.push(
      createFinding("methodology_reviewer", "Methodology reviewer", "methodology", "medium", "Single-run methodology coverage", "Only one observed execution was recorded, so methodology robustness is still limited.", ["result_analysis.json"], [], "Run confirmatory variants or multiple seeds to widen methodological coverage.", 0.75)
    );
  }

  return finalizeFallbackReviewer({
    reviewer_id: "methodology_reviewer",
    reviewer_label: "Methodology reviewer",
    dimension: "methodology",
    findings,
    cleanSummary: "Methodology is ready when the design, baselines, and evaluation procedure are explicit and adequately covered by runs.",
    issueSummary: findings[0]?.detail || "Methodology evidence is incomplete."
  });
}

function buildStatisticsFallback(
  report: AnalysisReport,
  presence: ReviewArtifactPresence
): SpecialistReviewResult {
  const findings: ReviewFinding[] = [];
  const executedTrials = report.statistical_summary.executed_trials ?? report.execution_summary.observation_count ?? 0;

  if (executedTrials <= 0) {
    findings.push(
      createFinding("statistics_reviewer", "Statistics reviewer", "statistics", "high", "No executed trials", "No executed trials were recorded, so statistical review cannot support publication claims.", ["result_analysis.json"], [], "Run experiments and persist execution records before review.", 0.97)
    );
  }

  if (!presence.metricsPresent) {
    findings.push(
      createFinding("statistics_reviewer", "Statistics reviewer", "statistics", "high", "Missing metrics snapshot", "metrics.json is missing, so the statistical reviewer cannot verify the numerical snapshot.", ["metrics.json"], [], "Restore metrics.json and rerun analyze_results if needed.", 0.95)
    );
  }

  if (report.statistical_summary.confidence_intervals.length === 0) {
    findings.push(
      createFinding("statistics_reviewer", "Statistics reviewer", "statistics", executedTrials >= 1 ? "medium" : "high", "No confidence intervals", "The report does not provide confidence intervals for the primary metrics.", ["result_analysis.json"], [], "Add repeated-trial confidence intervals before writing stronger results claims.", 0.84)
    );
  }

  if (report.statistical_summary.effect_estimates.length === 0 && report.condition_comparisons.length > 0) {
    findings.push(
      createFinding("statistics_reviewer", "Statistics reviewer", "statistics", "medium", "Missing effect estimate summary", "Condition comparisons exist but no structured effect estimates were emitted.", ["result_analysis.json"], [], "Add effect estimates for the primary comparisons.", 0.73)
    );
  }

  if (report.overview.objective_status === "met" && executedTrials > 0 && executedTrials < 3) {
    findings.push(
      createFinding("statistics_reviewer", "Statistics reviewer", "statistics", "medium", "Small-sample success", "The objective is met, but fewer than three executed trials limit confidence in stability.", ["result_analysis.json"], [], "Add confirmatory or repeated runs before finalizing claims.", 0.78)
    );
  }

  return finalizeFallbackReviewer({
    reviewer_id: "statistics_reviewer",
    reviewer_label: "Statistics reviewer",
    dimension: "statistics",
    findings,
    cleanSummary: "Statistical readiness depends on executed trials, explicit intervals, and effect estimates that support the primary comparisons.",
    issueSummary: findings[0]?.detail || "Statistical support remains incomplete."
  });
}

function buildWritingReadinessFallback(
  report: AnalysisReport,
  presence: ReviewArtifactPresence
): SpecialistReviewResult {
  const findings: ReviewFinding[] = [];

  if (!presence.paperSummariesPresent) {
    findings.push(
      createFinding("writing_readiness_reviewer", "Writing readiness reviewer", "writing_readiness", "medium", "Missing paper summaries", "paper_summaries.jsonl is missing, which weakens literature-grounded drafting.", ["paper_summaries.jsonl"], [], "Regenerate paper_summaries.jsonl before drafting related work.", 0.83)
    );
  }

  if ((report.paper_claims?.length || 0) === 0) {
    findings.push(
      createFinding("writing_readiness_reviewer", "Writing readiness reviewer", "writing_readiness", "medium", "No paper-facing claims", "The report does not expose grounded paper claims for Results/Conclusion drafting.", ["result_analysis.json"], [], "Generate paper_claims from the analysis report.", 0.81)
    );
  }

  if (!presence.figurePresent || report.figure_specs.length === 0) {
    findings.push(
      createFinding("writing_readiness_reviewer", "Writing readiness reviewer", "writing_readiness", "medium", "Primary figure missing", "A primary performance figure is missing, so the draft would lack a clear visual anchor.", ["figures/performance.svg", "result_analysis.json"], [], "Generate at least one primary result figure before writing.", 0.79)
    );
  }

  if (!presence.synthesisPresent || !report.synthesis?.confidence_statement) {
    findings.push(
      createFinding("writing_readiness_reviewer", "Writing readiness reviewer", "writing_readiness", "medium", "Narrative synthesis missing", "A conservative discussion/confidence synthesis is missing, reducing writing readiness.", ["result_analysis_synthesis.json", "result_analysis.json"], [], "Generate structured discussion synthesis before drafting.", 0.8)
    );
  }

  return finalizeFallbackReviewer({
    reviewer_id: "writing_readiness_reviewer",
    reviewer_label: "Writing readiness reviewer",
    dimension: "writing_readiness",
    findings,
    cleanSummary: "Writing readiness requires grounded claims, literature traceability, a primary figure, and a conservative narrative scaffold.",
    issueSummary: findings[0]?.detail || "Writing prerequisites remain incomplete."
  });
}

function buildIntegrityFallback(
  report: AnalysisReport,
  presence: ReviewArtifactPresence
): SpecialistReviewResult {
  const findings: ReviewFinding[] = [];
  const transition = report.transition_recommendation;
  const highObserved = report.failure_taxonomy.filter((item) => item.status === "observed" && item.severity === "high");
  const mediumOrHighConcerns = report.failure_taxonomy.filter(
    (item) => item.severity === "high" || (item.severity === "medium" && item.status === "observed")
  );

  if (transition?.action === "advance" && report.overview.objective_status !== "met" && report.overview.objective_status !== "observed") {
    findings.push(
      createFinding("integrity_reviewer", "Integrity reviewer", "integrity", "high", "Advance recommendation conflicts with unmet objective", "The report recommends advancing even though the configured objective is not met.", ["transition_recommendation.json", "result_analysis.json"], [], "Hold the run for manual review and revisit the transition recommendation.", 0.93)
    );
  }

  if (transition?.action === "advance" && highObserved.length > 0) {
    findings.push(
      createFinding("integrity_reviewer", "Integrity reviewer", "integrity", "high", "Concern-acceptance conflict", "The report still contains high-severity observed issues while recommending an advance to the next stage.", ["transition_recommendation.json", "result_analysis.json"], [], "Resolve the blocking issue or downgrade the recommendation before continuing.", 0.91)
    );
  }

  if (transition?.action === "advance" && mediumOrHighConcerns.length >= 2 && (transition.confidence || 0) >= 0.8) {
    findings.push(
      createFinding("integrity_reviewer", "Integrity reviewer", "integrity", "medium", "Positive outcome bias risk", "The advance recommendation is highly confident despite multiple unresolved concerns.", ["transition_recommendation.json", "result_analysis.json"], [], "Run a more conservative review pass and document the unresolved concerns explicitly.", 0.78)
    );
  }

  if (!presence.evidenceStorePresent && transition?.action === "advance") {
    findings.push(
      createFinding("integrity_reviewer", "Integrity reviewer", "integrity", "high", "Advance recommendation without evidence store", "The run is marked ready to advance even though evidence_store.jsonl is missing.", ["evidence_store.jsonl", "transition_recommendation.json"], [], "Regenerate the evidence store and re-evaluate the transition recommendation.", 0.94)
    );
  }

  if ((report.warnings?.length || 0) >= 3 && transition?.action === "advance") {
    findings.push(
      createFinding("integrity_reviewer", "Integrity reviewer", "integrity", "medium", "Warning-heavy advance", "The analysis carries several warnings but still recommends advancing.", ["result_analysis.json", "transition_recommendation.json"], [], "Review the warnings and justify why they do not block the paper stage.", 0.72)
    );
  }

  return finalizeFallbackReviewer({
    reviewer_id: "integrity_reviewer",
    reviewer_label: "Integrity reviewer",
    dimension: "integrity",
    findings,
    cleanSummary: "Integrity review looks for overclaiming, concern-acceptance conflicts, and overly optimistic transitions.",
    issueSummary: findings[0]?.detail || "Integrity checks are incomplete."
  });
}

function buildScorecard(reviewers: SpecialistReviewResult[]): ReviewScorecard {
  const dimensions = reviewers.map((reviewer) => ({
    dimension: reviewer.dimension,
    label: reviewer.reviewer_label,
    score_1_to_5: reviewer.score_1_to_5,
    confidence: reviewer.confidence,
    summary: reviewer.summary,
    top_finding_ids: reviewer.findings.slice(0, 3).map((item) => item.id)
  }));
  const overall = reviewers.length > 0
    ? roundTwo(reviewers.reduce((sum, reviewer) => sum + reviewer.score_1_to_5, 0) / reviewers.length)
    : 0;

  return {
    overall_score_1_to_5: overall,
    dimensions
  };
}

function buildConsistencyReport(
  reviewers: SpecialistReviewResult[],
  findings: ReviewFinding[]
): ReviewConsistencyReport {
  const histogram: Record<string, number> = {};
  for (const reviewer of reviewers) {
    histogram[reviewer.recommendation] = (histogram[reviewer.recommendation] || 0) + 1;
  }

  const scores = reviewers.map((item) => item.score_1_to_5);
  const scoreSpread = scores.length > 0 ? Math.max(...scores) - Math.min(...scores) : 0;
  const pairwiseAgreement = computePairwiseRecommendationAgreement(reviewers);
  const conflicts: string[] = [];

  const uniqueRecommendations = Object.keys(histogram).length;
  const recommendationDisagreement =
    uniqueRecommendations > 1
      ? `Reviewer recommendations disagree: ${Object.entries(histogram)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")}`
      : undefined;

  const hasBlockingSeverity = findings.some((item) => item.severity === "high");
  const averageScore = scores.length > 0 ? scores.reduce((sum, item) => sum + item, 0) / scores.length : 0;
  if (hasBlockingSeverity && averageScore >= 4) {
    conflicts.push("Panel scores remain high despite at least one high-severity finding.");
  }

  const agreement: ReviewAgreement =
    conflicts.length > 0 || pairwiseAgreement < 0.5 || (uniqueRecommendations >= 3 && scoreSpread >= 2)
      ? "low"
      : scoreSpread > 1 || uniqueRecommendations > 1 || pairwiseAgreement < 0.8
        ? "medium"
        : "high";

  return {
    panel_agreement: agreement,
    pairwise_recommendation_agreement: roundTwo(pairwiseAgreement),
    score_spread: roundTwo(scoreSpread),
    recommendation_histogram: histogram,
    conflicts: recommendationDisagreement ? [recommendationDisagreement, ...conflicts] : conflicts,
    summary:
      conflicts[0] ||
      recommendationDisagreement ||
      (agreement === "high"
        ? "Reviewer recommendations are aligned and score spread is low."
        : agreement === "medium"
          ? "Reviewer recommendations are mostly aligned but still carry some disagreement."
          : "Reviewer recommendations diverge enough to require careful manual review.")
  };
}

function buildBiasReport(
  report: AnalysisReport,
  reviewers: SpecialistReviewResult[],
  findings: ReviewFinding[],
  consistency: ReviewConsistencyReport
): ReviewBiasReport {
  const flags: ReviewBiasFlag[] = [];
  const summaryLengths = reviewers.map((item) => item.summary.length).filter((value) => value > 0);
  if (summaryLengths.length >= 2) {
    const max = Math.max(...summaryLengths);
    const min = Math.min(...summaryLengths);
    if (min > 0 && max / min >= 2.5) {
      flags.push({
        kind: "verbosity_imbalance",
        severity: "low",
        detail: "Reviewer summaries vary sharply in length, which can create verbosity bias in downstream judging."
      });
    }
  }

  const highOrMediumFindings = findings.filter((item) => item.severity !== "low");
  const majorityAdvance = reviewers.filter((item) => item.recommendation === "advance").length >= Math.ceil(reviewers.length / 2);
  if (report.overview.objective_status === "met" && majorityAdvance && highOrMediumFindings.length >= 3) {
    flags.push({
      kind: "positive_outcome_bias",
      severity: "medium",
      detail: "The panel still leans positive even though several unresolved concerns remain after the objective was met."
    });
  }

  if (consistency.panel_agreement === "low") {
    flags.push({
      kind: "consensus_gap",
      severity: "medium",
      detail: "Reviewer disagreement is large enough that consensus itself should be treated cautiously."
    });
  }

  if (findings.some((item) => item.title.toLowerCase().includes("concern-acceptance conflict"))) {
    flags.push({
      kind: "concern_acceptance_conflict",
      severity: "high",
      detail: "A reviewer detected concern-acceptance conflict, where serious issues coexist with an overly positive acceptance signal."
    });
  }

  return {
    flags,
    summary:
      flags[0]?.detail ||
      "No major panel-level bias flag was detected beyond the normal need for human sign-off."
  };
}

function buildRevisionPlan(findings: ReviewFinding[]): ReviewRevisionPlan {
  const items = findings
    .slice()
    .sort(compareFindings)
    .slice(0, 8)
    .map((finding, index) => ({
      id: `revision_${index + 1}`,
      priority: finding.severity,
      owner: ownerForDimension(finding.dimension, finding.title),
      title: finding.title,
      action: finding.fix_hint || finding.detail,
      source_finding_ids: [finding.id]
    }));

  return {
    items,
    summary:
      items.length > 0
        ? `Prepared ${items.length} revision action(s) from the specialist review findings.`
        : "No revision actions were generated because the panel reported no actionable findings."
  };
}

function buildDecision(
  report: AnalysisReport,
  reviewers: SpecialistReviewResult[],
  findings: ReviewFinding[],
  consistency: ReviewConsistencyReport,
  bias: ReviewBiasReport,
  revisionPlan: ReviewRevisionPlan
): ReviewDecision {
  const highFindings = findings.filter((item) => item.severity === "high");
  const blockingIds = highFindings.map((item) => item.id);
  const hasRuntimeFailure =
    report.failure_taxonomy.some((item) => item.category === "runtime_failure" && item.severity === "high") ||
    report.verifier_feedback?.status === "fail";
  const supportedComparison = report.condition_comparisons.some((item) => item.hypothesis_supported === true);
  const unsupportedComparison = report.condition_comparisons.some((item) => item.hypothesis_supported === false);
  const hasClaimBlocker = highFindings.some((item) => item.dimension === "claim_verification");
  const shouldResetHypotheses =
    report.transition_recommendation?.action === "backtrack_to_hypotheses" ||
    (!supportedComparison &&
      unsupportedComparison &&
      (report.overview.objective_status !== "met" || hasClaimBlocker));
  const hasMethodologyBlocker = highFindings.some((item) => item.dimension === "methodology" || item.dimension === "statistics");
  const hasIntegrityBlocker = highFindings.some((item) => item.dimension === "integrity" || item.dimension === "claim_verification");
  const mediumCount = findings.filter((item) => item.severity === "medium").length;

  let outcome: ReviewRecommendation = "advance";
  let recommendedTransition: ReviewDecision["recommended_transition"];
  const shouldCarryRevisionChecklist = mediumCount >= 3 || revisionPlan.items.some((item) => item.owner === "writing");
  if (hasRuntimeFailure) {
    outcome = "backtrack_to_implement";
    recommendedTransition = "backtrack_to_implement";
  } else if (shouldResetHypotheses) {
    outcome = "backtrack_to_hypotheses";
    recommendedTransition = "backtrack_to_hypotheses";
  } else if (hasMethodologyBlocker) {
    outcome = "backtrack_to_design";
    recommendedTransition = "backtrack_to_design";
  } else if (hasIntegrityBlocker || bias.flags.some((item) => item.severity === "high")) {
    if (report.transition_recommendation?.action === "backtrack_to_implement" || revisionPlan.items.some((item) => item.owner === "implementation")) {
      outcome = "backtrack_to_implement";
      recommendedTransition = "backtrack_to_implement";
    } else if (hasClaimBlocker) {
      outcome = "backtrack_to_hypotheses";
      recommendedTransition = "backtrack_to_hypotheses";
    } else {
      outcome = "backtrack_to_design";
      recommendedTransition = "backtrack_to_design";
    }
  } else if (consistency.panel_agreement === "low" && highFindings.length > 0) {
    // Low agreement with high findings: conservative backtrack
    if (report.transition_recommendation?.action === "backtrack_to_implement" || revisionPlan.items.some((item) => item.owner === "implementation")) {
      outcome = "backtrack_to_implement";
      recommendedTransition = "backtrack_to_implement";
    } else if (hasClaimBlocker) {
      outcome = "backtrack_to_hypotheses";
      recommendedTransition = "backtrack_to_hypotheses";
    } else {
      outcome = "backtrack_to_design";
      recommendedTransition = "backtrack_to_design";
    }
  } else {
    outcome = "advance";
    recommendedTransition = "advance";
  }

  const reviewerConfidences = reviewers.map((item) => item.confidence);
  const confidence = reviewerConfidences.length > 0
    ? roundTwo(reviewerConfidences.reduce((sum, item) => sum + item, 0) / reviewerConfidences.length)
    : 0.5;
  const rationale = buildDecisionRationale(outcome, highFindings, findings, consistency, bias);

  return {
    outcome,
    recommended_transition: recommendedTransition,
    confidence,
    summary: summarizeDecision(outcome, highFindings, mediumCount, shouldCarryRevisionChecklist),
    rationale,
    blocking_finding_ids: blockingIds,
    required_actions: revisionPlan.items.slice(0, 4).map((item) => item.action)
  };
}

function buildDecisionRationale(
  outcome: ReviewRecommendation,
  highFindings: ReviewFinding[],
  findings: ReviewFinding[],
  consistency: ReviewConsistencyReport,
  bias: ReviewBiasReport
): string {
  const parts: string[] = [];
  if (highFindings[0]) {
    parts.push(`Top blocking concern: ${highFindings[0].title}.`);
  }
  if (findings.length > 0) {
    parts.push(`Total findings: ${findings.length}.`);
  }
  parts.push(`Panel agreement: ${consistency.panel_agreement}.`);
  if (bias.flags[0]) {
    parts.push(`Bias flag: ${bias.flags[0].kind}.`);
  }
  parts.push(`Final outcome: ${outcome}.`);
  return parts.join(" ");
}

function summarizeDecision(
  outcome: ReviewRecommendation,
  highFindings: ReviewFinding[],
  mediumCount: number,
  carryRevisionChecklist = false
): string {
  if (outcome === "advance" && carryRevisionChecklist) {
    return `Advance with revisions: ${mediumCount} medium-severity issue(s) should be addressed while drafting the paper.`;
  }

  switch (outcome) {
    case "backtrack_to_implement":
      return `Backtrack to implement: runtime or verifier issues still block paper readiness.`;
    case "backtrack_to_hypotheses":
      return `Backtrack to hypotheses: the current claim set is no longer well supported by the reviewed evidence bundle.`;
    case "backtrack_to_design":
      return `Backtrack to design: methodological or statistical blockers remain.`;
    case "manual_block":
      return `Manual block: reviewer integrity concerns require human adjudication before writing.`;
    case "revise_in_place":
      return `Revise in place: ${mediumCount} medium-severity issue(s) should be resolved before paper drafting.`;
    default:
      return highFindings.length > 0
        ? `Advance only after human confirmation: blocking concerns were detected.`
        : "Advance: the panel found no blocking review issues.";
  }
}

function finalizeFallbackReviewer(input: {
  reviewer_id: string;
  reviewer_label: string;
  dimension: ReviewDimension;
  findings: ReviewFinding[];
  cleanSummary: string;
  issueSummary: string;
}): SpecialistReviewResult {
  const highest = input.findings[0];
  const recommendation = recommendFromFindings(input.dimension, input.findings);
  const score = scoreFromFindings(input.findings);
  return {
    reviewer_id: input.reviewer_id,
    reviewer_label: input.reviewer_label,
    dimension: input.dimension,
    score_1_to_5: score,
    confidence: highest ? highest.confidence : 0.68,
    recommendation,
    summary: input.findings.length > 0 ? input.issueSummary : input.cleanSummary,
    findings: input.findings.sort(compareFindings),
    source: "heuristic"
  };
}

function recommendFromFindings(
  dimension: ReviewDimension,
  findings: ReviewFinding[]
): ReviewRecommendation {
  const high = findings.filter((item) => item.severity === "high");
  const medium = findings.filter((item) => item.severity === "medium");
  if (high.length > 0) {
    if (dimension === "methodology" || dimension === "statistics") {
      return "backtrack_to_design";
    }
    if (dimension === "integrity" || dimension === "claim_verification") {
      return "manual_block";
    }
    return "revise_in_place";
  }
  if (medium.length >= 2 && (dimension === "methodology" || dimension === "statistics")) {
    return "backtrack_to_design";
  }
  if (medium.length > 0) {
    return "revise_in_place";
  }
  return "advance";
}

function scoreFromFindings(findings: ReviewFinding[]): number {
  const high = findings.filter((item) => item.severity === "high").length;
  const medium = findings.filter((item) => item.severity === "medium").length;
  if (high > 0) {
    return 2;
  }
  if (medium >= 2) {
    return 3;
  }
  if (medium === 1) {
    return 4;
  }
  return 5;
}

function computePairwiseRecommendationAgreement(reviewers: SpecialistReviewResult[]): number {
  if (reviewers.length <= 1) {
    return 1;
  }
  let pairs = 0;
  let matches = 0;
  for (let i = 0; i < reviewers.length; i += 1) {
    for (let j = i + 1; j < reviewers.length; j += 1) {
      pairs += 1;
      if (reviewers[i].recommendation === reviewers[j].recommendation) {
        matches += 1;
      }
    }
  }
  return pairs > 0 ? matches / pairs : 1;
}

function createFinding(
  reviewerId: string,
  reviewerLabel: string,
  dimension: ReviewDimension,
  severity: ReviewSeverity,
  title: string,
  detail: string,
  evidencePaths: string[],
  claimIds: string[],
  fixHint: string | undefined,
  confidence: number
): ReviewFinding {
  return {
    id: `${reviewerId}_${slugify(title)}`,
    reviewer_id: reviewerId,
    reviewer_label: reviewerLabel,
    dimension,
    severity,
    title,
    detail,
    claim_ids: claimIds,
    evidence_paths: evidencePaths,
    fix_hint: fixHint,
    confidence: clampConfidence(confidence)
  };
}

function dedupeFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const map = new Map<string, ReviewFinding>();
  for (const finding of findings) {
    const key = `${finding.dimension}:${finding.title.toLowerCase()}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, finding);
      continue;
    }
    if (severityRank(finding.severity) > severityRank(existing.severity)) {
      map.set(key, {
        ...finding,
        evidence_paths: uniqueStrings([...existing.evidence_paths, ...finding.evidence_paths]),
        claim_ids: uniqueStrings([...existing.claim_ids, ...finding.claim_ids]),
        confidence: Math.max(existing.confidence, finding.confidence)
      });
      continue;
    }
    map.set(key, {
      ...existing,
      evidence_paths: uniqueStrings([...existing.evidence_paths, ...finding.evidence_paths]),
      claim_ids: uniqueStrings([...existing.claim_ids, ...finding.claim_ids]),
      confidence: Math.max(existing.confidence, finding.confidence)
    });
  }
  return [...map.values()].sort(compareFindings);
}

function compareFindings(left: ReviewFinding, right: ReviewFinding): number {
  return severityRank(right.severity) - severityRank(left.severity) || right.confidence - left.confidence;
}

function ownerForDimension(
  dimension: ReviewDimension,
  title: string
): ReviewRevisionPlanItem["owner"] {
  if (dimension === "methodology" || dimension === "statistics") {
    return "design";
  }
  if (dimension === "writing_readiness") {
    return "writing";
  }
  if (dimension === "integrity" && /runtime|verifier|implement/iu.test(title)) {
    return "implementation";
  }
  if (dimension === "integrity") {
    return "human_review";
  }
  return "analysis";
}

function claimIds(claims: AnalysisPaperClaim[]): string[] {
  return claims.map((claim) => slugify(claim.claim).slice(0, 24)).filter(Boolean);
}

function moreConservativeRecommendation(
  left: ReviewRecommendation,
  right: ReviewRecommendation
): ReviewRecommendation {
  return recommendationRank(left) >= recommendationRank(right) ? left : right;
}

function recommendationRank(value: ReviewRecommendation): number {
  switch (value) {
    case "advance":
      return 0;
    case "revise_in_place":
      return 1;
    case "backtrack_to_implement":
      return 2;
    case "backtrack_to_design":
      return 3;
    case "backtrack_to_hypotheses":
      return 4;
    case "manual_block":
      return 5;
  }
}

function normalizeRecommendation(value: unknown): ReviewRecommendation | undefined {
  switch (value) {
    case "advance":
    case "revise_in_place":
    case "backtrack_to_hypotheses":
    case "backtrack_to_design":
    case "backtrack_to_implement":
    case "manual_block":
      return value;
    default:
      return undefined;
  }
}

function normalizeSeverity(value: unknown): ReviewSeverity | undefined {
  switch (value) {
    case "low":
    case "medium":
    case "high":
      return value;
    default:
      return undefined;
  }
}

function severityRank(value: ReviewSeverity): number {
  switch (value) {
    case "low":
      return 0;
    case "medium":
      return 1;
    case "high":
      return 2;
  }
}

function clampScore(value: number): number {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function clampConfidence(value: number): number {
  return roundTwo(Math.max(0, Math.min(1, value)));
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.map((item) => cleanString(item)).filter(Boolean)).slice(0, limit);
}

function uniqueStrings(items: Array<string | undefined | null>): string[] {
  return [
    ...new Set(
      items
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    )
  ];
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function resolveReviewRefinementTimeoutMs(): number {
  const raw = process.env.AUTOLABOS_REVIEW_REFINEMENT_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_REVIEW_REFINEMENT_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REVIEW_REFINEMENT_TIMEOUT_MS;
}

function describeReviewRefinementFallbackReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const timeoutMs = resolveReviewRefinementTimeoutMs();
  if (message === `review_refinement_timeout_after_${timeoutMs}ms`) {
    return `reviewer exceeded the ${timeoutMs}ms timeout`;
  }
  return message;
}

async function runWithAbortableTimeout<T>(
  timeoutMs: number,
  outerAbortSignal: AbortSignal | undefined,
  operation: (abortSignal: AbortSignal | undefined) => Promise<T>,
  timeoutErrorMessage: string
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return operation(outerAbortSignal);
  }

  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle: NodeJS.Timeout | undefined;

  const abortFromOuterSignal = () => controller.abort();
  if (outerAbortSignal) {
    if (outerAbortSignal.aborted) {
      controller.abort();
    } else {
      outerAbortSignal.addEventListener("abort", abortFromOuterSignal, { once: true });
    }
  }

  timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await operation(controller.signal);
  } catch (error) {
    if (timedOut) {
      throw new Error(timeoutErrorMessage);
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    outerAbortSignal?.removeEventListener("abort", abortFromOuterSignal);
  }
}
