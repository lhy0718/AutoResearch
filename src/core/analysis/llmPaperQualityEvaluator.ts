/**
 * LLM-based paper-quality evaluator (Layer 2).
 *
 * Runs above the deterministic minimum gate. Produces a structured,
 * inspectable, reusable evaluation artifact covering:
 *   - branch assessment (strongest branch, trajectory)
 *   - paper-quality scorecard (significance, writing, evidence, structure)
 *   - evidence-gap analysis
 *   - upgrade priority list
 *   - critique summary
 *   - recommended next action
 *
 * Deterministic minimum gate results are passed in so the LLM knows
 * about hard blocks, but the LLM cannot override them.
 */

import type { LLMClient, LLMCompletionUsage } from "../llm/client.js";
import type { ReviewArtifactPresence } from "../reviewSystem.js";
import type { AnalysisReport } from "../resultAnalysis.js";
import type { MinimumGateResult } from "./paperMinimumGate.js";
import { parseStructuredModelJsonObject } from "./modelJson.js";
import { GATE_THRESHOLDS } from "./paperGateThresholds.js";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface PaperQualityDimension {
  dimension: string;
  score_1_to_5: number;
  assessment: string;
}

export interface EvidenceGap {
  gap: string;
  severity: "critical" | "important" | "minor";
  suggested_action: string;
}

export interface UpgradeAction {
  priority: number;
  action: string;
  rationale: string;
  target_node: string;
}

export interface PaperQualityEvaluation {
  evaluated_at: string;
  /** Did the LLM evaluator run, or is this a fallback? */
  llm_evaluated: boolean;

  // Branch assessment
  branch_hypothesis: string;
  branch_trajectory: "improving" | "stagnant" | "declining" | "insufficient_data";
  paper_worthiness: "paper_ready" | "paper_scale_candidate" | "research_memo" | "not_ready";

  // Scorecard
  overall_score_1_to_10: number;
  dimensions: PaperQualityDimension[];

  // Evidence gap analysis
  evidence_gaps: EvidenceGap[];

  // Upgrade priorities
  upgrade_actions: UpgradeAction[];

  // Critique summary
  strengths: string[];
  weaknesses: string[];
  critique_summary: string;

  // Recommended action
  recommended_action: "advance_to_draft" | "consolidate_evidence" | "backtrack_to_experiments" | "backtrack_to_design" | "backtrack_to_hypotheses" | "continue_exploration";
  action_rationale: string;

  // Negative result handling
  negative_result_detected: boolean;
  negative_result_framing: string;

  // Minimum gate context (carried through, not LLM-decided)
  minimum_gate_passed: boolean;
  minimum_gate_ceiling: string;
}

// ---------------------------------------------------------------------------
// LLM prompt construction
// ---------------------------------------------------------------------------

function buildEvaluatorSystemPrompt(): string {
  return [
    "You are the AutoLabOS paper-quality evaluator.",
    "Your job is to assess the quality, significance, and paper-readiness of a research branch.",
    "Return one JSON object. Use only facts explicitly present in the payload.",
    "Be conservative: if evidence is incomplete, downgrade rather than assume.",
    "Negative results are acceptable if honestly framed.",
    "Do NOT inflate scores to be encouraging — accuracy matters."
  ].join("\n");
}

function buildEvaluatorPrompt(input: LLMEvaluatorInput): string {
  const payload = {
    run: {
      topic: input.topic,
      objective_metric: input.objectiveMetric,
      hypothesis: input.hypothesis
    },
    analysis_overview: input.report ? {
      objective_status: input.report.overview.objective_status,
      objective_summary: input.report.overview.objective_summary,
      execution_runs: input.report.overview.execution_runs,
      primary_findings: input.report.primary_findings?.slice(0, GATE_THRESHOLDS.llmPromptMaxPrimaryFindings),
      limitations: input.report.limitations?.slice(0, GATE_THRESHOLDS.llmPromptMaxComparisons),
      warnings: input.report.warnings?.slice(0, GATE_THRESHOLDS.llmPromptMaxComparisons),
      condition_comparisons: input.report.condition_comparisons?.slice(0, GATE_THRESHOLDS.llmPromptMaxComparisons).map(c => ({
        label: c.label,
        summary: c.summary,
        hypothesis_supported: c.hypothesis_supported
      })),
      paper_claims: input.report.paper_claims?.slice(0, GATE_THRESHOLDS.llmPromptMaxClaims).map(c => ({
        claim: c.claim,
        evidence_count: c.evidence?.length ?? 0
      })),
      statistical_summary: input.report.statistical_summary ? {
        total_trials: input.report.statistical_summary.total_trials,
        effect_estimates_count: input.report.statistical_summary.effect_estimates?.length ?? 0
      } : undefined
    } : null,
    artifact_presence: input.presence,
    minimum_gate: {
      passed: input.minimumGate.passed,
      ceiling_type: input.minimumGate.ceiling_type,
      blockers: input.minimumGate.blockers
    },
    // Existing review panel scores (if available)
    review_scorecard: input.reviewScorecard ?? null
  };

  return [
    "Evaluate this research branch for paper quality. Return one JSON object:",
    "{",
    '  "branch_hypothesis": string,        // 1-2 sentence summary of the research hypothesis',
    '  "branch_trajectory": "improving" | "stagnant" | "declining" | "insufficient_data",',
    '  "paper_worthiness": "paper_ready" | "paper_scale_candidate" | "research_memo" | "not_ready",',
    '  "overall_score_1_to_10": number,    // 1=not viable, 10=submission-ready',
    `  "dimensions": [                     // exactly ${GATE_THRESHOLDS.llmExpectedDimensionCount} dimensions`,
    '    { "dimension": "result_significance", "score_1_to_5": n, "assessment": string },',
    '    { "dimension": "methodology_rigor", "score_1_to_5": n, "assessment": string },',
    '    { "dimension": "evidence_strength", "score_1_to_5": n, "assessment": string },',
    '    { "dimension": "writing_structure", "score_1_to_5": n, "assessment": string },',
    '    { "dimension": "claim_support", "score_1_to_5": n, "assessment": string },',
    '    { "dimension": "citation_coverage", "score_1_to_5": n, "assessment": string },',
    '    { "dimension": "limitations_honesty", "score_1_to_5": n, "assessment": string }',
    "  ],",
    '  "evidence_gaps": [{ "gap": string, "severity": "critical"|"important"|"minor", "suggested_action": string }],',
    '  "upgrade_actions": [{ "priority": number, "action": string, "rationale": string, "target_node": string }],',
    `  "strengths": string[],              // up to ${GATE_THRESHOLDS.llmPromptMaxStrengthWeaknessItems} strengths`,
    `  "weaknesses": string[],             // up to ${GATE_THRESHOLDS.llmPromptMaxStrengthWeaknessItems} weaknesses`,
    '  "critique_summary": string,         // 2-3 sentence overall assessment',
    '  "recommended_action": "advance_to_draft" | "consolidate_evidence" | "backtrack_to_experiments" | "backtrack_to_design" | "backtrack_to_hypotheses" | "continue_exploration",',
    '  "action_rationale": string,',
    '  "negative_result_detected": boolean,',
    '  "negative_result_framing": string   // how to honestly frame negative results (empty if not negative)',
    "}",
    "",
    "Rules:",
    "- If minimum_gate.passed is false, paper_worthiness must be 'not_ready' or 'research_memo'.",
    `- If no executed result exists, overall_score must be ≤ ${GATE_THRESHOLDS.llmNoExecutedResultScoreCeiling}.`,
    "- Negative results are fine if framed honestly. Do not hide them.",
    `- evidence_gaps: list only gaps actually observed, max ${GATE_THRESHOLDS.llmMaxEvidenceGaps}.`,
    `- upgrade_actions: ordered by priority (${GATE_THRESHOLDS.llmHighestPriorityActionRank} = highest), max ${GATE_THRESHOLDS.llmMaxUpgradeActions}.`,
    "- target_node must be one of: generate_hypotheses, design_experiments, implement_experiments, run_experiments, analyze_results, review.",
    "",
    JSON.stringify(payload, null, 2)
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export interface LLMEvaluatorInput {
  topic: string;
  objectiveMetric: string;
  hypothesis: string;
  report: AnalysisReport | undefined;
  presence: ReviewArtifactPresence;
  minimumGate: MinimumGateResult;
  reviewScorecard?: { overall_score_1_to_5: number; dimensions: Record<string, number> };
}

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

export async function runLLMPaperQualityEvaluation(
  input: LLMEvaluatorInput,
  llm: LLMClient,
  opts?: { abortSignal?: AbortSignal; timeoutMs?: number }
): Promise<{ evaluation: PaperQualityEvaluation; llmUsed: boolean; costUsd?: number; usage?: LLMCompletionUsage }> {
  const timeoutMs = opts?.timeoutMs ?? GATE_THRESHOLDS.llmEvaluationTimeoutMs;

  try {
    const completion = await Promise.race([
      llm.complete(buildEvaluatorPrompt(input), {
        systemPrompt: buildEvaluatorSystemPrompt(),
        abortSignal: opts?.abortSignal
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LLM evaluator timeout")), timeoutMs)
      )
    ]);

    const parsed = parseStructuredModelJsonObject<RawLLMEvaluation>(completion.text, {
      emptyError: "Paper quality evaluator returned empty response.",
      notFoundError: "Paper quality evaluator returned no JSON.",
      incompleteError: "Paper quality evaluator JSON truncated.",
      invalidError: "Paper quality evaluator JSON invalid."
    });

    if (!parsed.value) {
      return { evaluation: buildFallbackEvaluation(input), llmUsed: false };
    }

    const raw = parsed.value;

    // Enforce deterministic gate override
    const evaluation = enforceMinimumGateOverride(raw, input.minimumGate);

    return {
      evaluation: {
        evaluated_at: new Date().toISOString(),
        llm_evaluated: true,
        branch_hypothesis:
          raw.branch_hypothesis ||
          input.hypothesis?.slice(0, GATE_THRESHOLDS.llmBranchHypothesisPreviewLength) ||
          input.topic,
        branch_trajectory: validateTrajectory(raw.branch_trajectory),
        paper_worthiness: evaluation.paper_worthiness,
        overall_score_1_to_10: clamp(
          evaluation.overall_score,
          GATE_THRESHOLDS.llmOverallScoreMin,
          GATE_THRESHOLDS.llmOverallScoreMax
        ),
        dimensions: normalizeDimensions(raw.dimensions),
        evidence_gaps: normalizeGaps(raw.evidence_gaps),
        upgrade_actions: normalizeActions(raw.upgrade_actions),
        strengths: (raw.strengths || []).slice(0, GATE_THRESHOLDS.llmMaxStrengths),
        weaknesses: (raw.weaknesses || []).slice(0, GATE_THRESHOLDS.llmMaxWeaknesses),
        critique_summary: raw.critique_summary || "No critique provided.",
        recommended_action: evaluation.recommended_action,
        action_rationale: raw.action_rationale || "",
        negative_result_detected: Boolean(raw.negative_result_detected),
        negative_result_framing: raw.negative_result_framing || "",
        minimum_gate_passed: input.minimumGate.passed,
        minimum_gate_ceiling: input.minimumGate.ceiling_type
      },
      llmUsed: true,
      costUsd: completion.usage?.costUsd,
      usage: completion.usage
    };
  } catch {
    return { evaluation: buildFallbackEvaluation(input), llmUsed: false };
  }
}

// ---------------------------------------------------------------------------
// Deterministic override — LLM cannot bypass minimum gate
// ---------------------------------------------------------------------------

interface GateOverrideResult {
  paper_worthiness: PaperQualityEvaluation["paper_worthiness"];
  overall_score: number;
  recommended_action: PaperQualityEvaluation["recommended_action"];
}

export function enforceMinimumGateOverride(
  raw: RawLLMEvaluation,
  gate: MinimumGateResult
): GateOverrideResult {
  let worthiness = validateWorthiness(raw.paper_worthiness);
  let score = clamp(
    raw.overall_score_1_to_10 ?? GATE_THRESHOLDS.llmBlockedForPaperScaleThreshold,
    GATE_THRESHOLDS.llmOverallScoreMin,
    GATE_THRESHOLDS.llmOverallScoreMax
  );
  let action = validateAction(raw.recommended_action);

  if (!gate.passed) {
    // Ceiling enforcement
    if (gate.ceiling_type === "blocked_for_paper_scale" || gate.ceiling_type === "system_validation_note") {
      if (worthiness === "paper_ready" || worthiness === "paper_scale_candidate") {
        worthiness = "not_ready";
      }
      score = Math.min(score, GATE_THRESHOLDS.llmBlockedForPaperScaleThreshold);
      if (action === "advance_to_draft") {
        action = "consolidate_evidence";
      }
    } else if (gate.ceiling_type === "research_memo") {
      if (worthiness === "paper_ready") {
        worthiness = "research_memo";
      }
      score = Math.min(score, GATE_THRESHOLDS.llmResearchMemoThreshold);
      if (action === "advance_to_draft") {
        action = "consolidate_evidence";
      }
    }
  }

  return { paper_worthiness: worthiness, overall_score: score, recommended_action: action };
}

// ---------------------------------------------------------------------------
// Fallback (used when LLM fails or times out)
// ---------------------------------------------------------------------------

export function buildFallbackEvaluation(input: LLMEvaluatorInput): PaperQualityEvaluation {
  const gate = input.minimumGate;
  const hasResults = input.presence.metricsPresent;
  const hasBaseline = input.presence.baselineSummaryPresent;

  let worthiness: PaperQualityEvaluation["paper_worthiness"] = "not_ready";
  if (gate.passed && hasResults && hasBaseline) {
    worthiness = "paper_scale_candidate";
  } else if (gate.passed) {
    worthiness = "research_memo";
  }

  return {
    evaluated_at: new Date().toISOString(),
    llm_evaluated: false,
    branch_hypothesis: input.hypothesis?.slice(0, GATE_THRESHOLDS.llmBranchHypothesisPreviewLength) || input.topic,
    branch_trajectory: "insufficient_data",
    paper_worthiness: worthiness,
    overall_score_1_to_10: gate.passed
      ? GATE_THRESHOLDS.llmFallbackPassedOverallScore
      : GATE_THRESHOLDS.llmFallbackBlockedOverallScore,
    dimensions: [
      {
        dimension: "result_significance",
        score_1_to_5: hasResults ? GATE_THRESHOLDS.llmFallbackSupportedDimensionScore : GATE_THRESHOLDS.llmFallbackWeakDimensionScore,
        assessment: "Fallback: LLM unavailable."
      },
      {
        dimension: "methodology_rigor",
        score_1_to_5: input.presence.experimentPlanPresent
          ? GATE_THRESHOLDS.llmFallbackSupportedDimensionScore
          : GATE_THRESHOLDS.llmFallbackWeakDimensionScore,
        assessment: "Fallback."
      },
      {
        dimension: "evidence_strength",
        score_1_to_5: hasBaseline ? GATE_THRESHOLDS.llmFallbackSupportedDimensionScore : GATE_THRESHOLDS.llmFallbackWeakDimensionScore,
        assessment: "Fallback."
      },
      { dimension: "writing_structure", score_1_to_5: GATE_THRESHOLDS.llmFallbackNeutralDimensionScore, assessment: "Fallback." },
      {
        dimension: "claim_support",
        score_1_to_5: input.presence.evidenceStorePresent
          ? GATE_THRESHOLDS.llmFallbackSupportedDimensionScore
          : GATE_THRESHOLDS.llmFallbackWeakDimensionScore,
        assessment: "Fallback."
      },
      {
        dimension: "citation_coverage",
        score_1_to_5: input.presence.paperSummariesPresent
          ? GATE_THRESHOLDS.llmFallbackSupportedDimensionScore
          : GATE_THRESHOLDS.llmFallbackWeakDimensionScore,
        assessment: "Fallback."
      },
      { dimension: "limitations_honesty", score_1_to_5: GATE_THRESHOLDS.llmFallbackNeutralDimensionScore, assessment: "Fallback." }
    ],
    evidence_gaps: gate.blockers.map(b => ({
      gap: b, severity: "critical" as const, suggested_action: "Address minimum gate requirement"
    })),
    upgrade_actions: gate.blockers.length > 0 ? [{
      priority: GATE_THRESHOLDS.llmHighestPriorityActionRank,
      action: "Address minimum gate blockers first",
      rationale: gate.summary,
      target_node: "design_experiments"
    }] : [],
    strengths: [],
    weaknesses: gate.blockers.length > 0 ? ["Minimum gate not passed"] : [],
    critique_summary: `LLM evaluation unavailable. Fallback: ${gate.summary}`,
    recommended_action: gate.passed ? "consolidate_evidence" : "backtrack_to_experiments",
    action_rationale: "Fallback evaluation — LLM was unavailable or timed out.",
    negative_result_detected: false,
    negative_result_framing: "",
    minimum_gate_passed: gate.passed,
    minimum_gate_ceiling: gate.ceiling_type
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

interface RawLLMEvaluation {
  branch_hypothesis?: string;
  branch_trajectory?: string;
  paper_worthiness?: string;
  overall_score_1_to_10?: number;
  dimensions?: Array<{ dimension?: string; score_1_to_5?: number; assessment?: string }>;
  evidence_gaps?: Array<{ gap?: string; severity?: string; suggested_action?: string }>;
  upgrade_actions?: Array<{ priority?: number; action?: string; rationale?: string; target_node?: string }>;
  strengths?: string[];
  weaknesses?: string[];
  critique_summary?: string;
  recommended_action?: string;
  action_rationale?: string;
  negative_result_detected?: boolean;
  negative_result_framing?: string;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const VALID_TRAJECTORIES = new Set(["improving", "stagnant", "declining", "insufficient_data"]);
function validateTrajectory(v?: string): PaperQualityEvaluation["branch_trajectory"] {
  return VALID_TRAJECTORIES.has(v as string) ? v as PaperQualityEvaluation["branch_trajectory"] : "insufficient_data";
}

const VALID_WORTHINESS = new Set(["paper_ready", "paper_scale_candidate", "research_memo", "not_ready"]);
function validateWorthiness(v?: string): PaperQualityEvaluation["paper_worthiness"] {
  return VALID_WORTHINESS.has(v as string) ? v as PaperQualityEvaluation["paper_worthiness"] : "not_ready";
}

const VALID_ACTIONS = new Set([
  "advance_to_draft", "consolidate_evidence", "backtrack_to_experiments",
  "backtrack_to_design", "backtrack_to_hypotheses", "continue_exploration"
]);
function validateAction(v?: string): PaperQualityEvaluation["recommended_action"] {
  return VALID_ACTIONS.has(v as string) ? v as PaperQualityEvaluation["recommended_action"] : "consolidate_evidence";
}

const EXPECTED_DIMENSIONS = [
  "result_significance", "methodology_rigor", "evidence_strength",
  "writing_structure", "claim_support", "citation_coverage", "limitations_honesty"
];

function normalizeDimensions(raw?: Array<{ dimension?: string; score_1_to_5?: number; assessment?: string }>): PaperQualityDimension[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return EXPECTED_DIMENSIONS.map((d) => ({
      dimension: d,
      score_1_to_5: GATE_THRESHOLDS.llmFallbackNeutralDimensionScore,
      assessment: "Not evaluated."
    }));
  }
  const byDim = new Map(raw.map(r => [r.dimension, r]));
  return EXPECTED_DIMENSIONS.map(d => {
    const match = byDim.get(d);
    return {
      dimension: d,
      score_1_to_5: clamp(
        match?.score_1_to_5 ?? GATE_THRESHOLDS.llmFallbackNeutralDimensionScore,
        GATE_THRESHOLDS.llmDimensionScoreMin,
        GATE_THRESHOLDS.llmDimensionScoreMax
      ),
      assessment: match?.assessment || "Not evaluated."
    };
  });
}

const VALID_SEVERITIES = new Set(["critical", "important", "minor"]);
function normalizeGaps(raw?: Array<{ gap?: string; severity?: string; suggested_action?: string }>): EvidenceGap[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, GATE_THRESHOLDS.llmMaxEvidenceGaps).filter(g => g.gap).map(g => ({
    gap: g.gap!,
    severity: VALID_SEVERITIES.has(g.severity as string) ? g.severity as EvidenceGap["severity"] : "important",
    suggested_action: g.suggested_action || ""
  }));
}

const VALID_TARGET_NODES = new Set([
  "generate_hypotheses", "design_experiments", "implement_experiments",
  "run_experiments", "analyze_results", "review"
]);
function normalizeActions(raw?: Array<{ priority?: number; action?: string; rationale?: string; target_node?: string }>): UpgradeAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, GATE_THRESHOLDS.llmMaxUpgradeActions).filter(a => a.action).map((a, i) => ({
    priority: a.priority ?? i + 1,
    action: a.action!,
    rationale: a.rationale || "",
    target_node: VALID_TARGET_NODES.has(a.target_node as string) ? a.target_node! : "design_experiments"
  }));
}
