/**
 * Shared numeric thresholds for deterministic and LLM-backed paper-quality gates.
 *
 * These values control operator-facing paper-quality decisions and should stay
 * aligned with docs/paper-quality-bar.md.
 */

export interface PaperGateThresholds {
  /** docs/paper-quality-bar.md §5, §12 — minimum primary findings required before a branch stops looking smoke-only. */
  minPrimaryFindingCount: number;
  /** docs/paper-quality-bar.md §5(11), §6 — minimum total trials that count as repeated-trial robustness evidence. */
  minRobustnessTotalTrials: number;
  /** docs/paper-quality-bar.md §5(11), §6 — minimum confidence intervals needed to count as robustness support. */
  minRobustnessConfidenceIntervalCount: number;
  /** docs/paper-quality-bar.md §5(11), §6 — minimum stability metrics needed to count as robustness support. */
  minRobustnessStabilityMetricCount: number;
  /** docs/paper-quality-bar.md §5(11), §6 — minimum effect estimates needed to count as robustness support. */
  minRobustnessEffectEstimateCount: number;
  /** docs/paper-quality-bar.md §2, §3, §5, §12 — minimum evidence-link claim entries required once the artifact is emitted. */
  minEvidenceLinksClaimCount: number;
  /** docs/paper-quality-bar.md §2, §3, §5, §12 — minimum claim-evidence rows required once the artifact is emitted. */
  minClaimEvidenceRows: number;
  /** docs/paper-quality-bar.md §2, §3, §5, §12 — minimum concrete evidence or citation refs required per claim row. */
  minClaimEvidenceRefsPerClaim: number;
  /** docs/paper-quality-bar.md §5, §6 — failure count at which missing fundamentals force blocked-for-paper-scale rather than a lighter downgrade. */
  minFundamentalFailuresForBlocked: number;
  /** docs/paper-quality-bar.md §5, §6 — general failure count at which the deterministic minimum gate blocks paper-scale progression. */
  minGeneralFailuresForBlocked: number;
  /** docs/paper-quality-bar.md §3, §5, §6 — default timeout budget for the Layer 2 LLM paper-quality evaluator. */
  llmEvaluationTimeoutMs: number;
  /** docs/paper-quality-bar.md §5, §6, §12 — strongest score the LLM layer may retain when blocked_for_paper_scale or system_validation_note applies. */
  llmBlockedForPaperScaleThreshold: number;
  /** docs/paper-quality-bar.md §5, §6, §12 — strongest score the LLM layer may retain when only research_memo-grade evidence is present. */
  llmResearchMemoThreshold: number;
  /** docs/paper-quality-bar.md §5, §12 — fallback overall score when the deterministic minimum gate passed but Layer 2 is unavailable. */
  llmFallbackPassedOverallScore: number;
  /** docs/paper-quality-bar.md §6, §12 — fallback overall score when the deterministic minimum gate failed and Layer 2 is unavailable. */
  llmFallbackBlockedOverallScore: number;
  /** docs/paper-quality-bar.md §12 — low fallback score used when a dimension is unsupported by artifacts. */
  llmFallbackWeakDimensionScore: number;
  /** docs/paper-quality-bar.md §12 — neutral fallback score used when a dimension cannot be judged confidently. */
  llmFallbackNeutralDimensionScore: number;
  /** docs/paper-quality-bar.md §12 — moderate fallback score used when artifacts provide partial support for a dimension. */
  llmFallbackSupportedDimensionScore: number;
  /** docs/paper-quality-bar.md §12 — minimum valid overall score for Layer 2 paper-quality evaluation. */
  llmOverallScoreMin: number;
  /** docs/paper-quality-bar.md §12 — maximum valid overall score for Layer 2 paper-quality evaluation. */
  llmOverallScoreMax: number;
  /** docs/paper-quality-bar.md §12 — minimum valid per-dimension score for Layer 2 paper-quality evaluation. */
  llmDimensionScoreMin: number;
  /** docs/paper-quality-bar.md §12 — maximum valid per-dimension score for Layer 2 paper-quality evaluation. */
  llmDimensionScoreMax: number;
  /** docs/paper-quality-bar.md §7, §8, §10 — maximum evidence gaps surfaced from the LLM layer to keep operator output actionable. */
  llmMaxEvidenceGaps: number;
  /** docs/paper-quality-bar.md §7, §8, §10 — maximum upgrade actions surfaced from the LLM layer to keep operator output actionable. */
  llmMaxUpgradeActions: number;
  /** docs/paper-quality-bar.md §7, §10 — maximum strengths retained from the LLM layer. */
  llmMaxStrengths: number;
  /** docs/paper-quality-bar.md §7, §10 — maximum weaknesses retained from the LLM layer. */
  llmMaxWeaknesses: number;
  /** docs/paper-quality-bar.md §7, §8, §10 — maximum analysis findings included in the LLM prompt. */
  llmPromptMaxPrimaryFindings: number;
  /** docs/paper-quality-bar.md §8 — maximum condition comparisons included in the LLM prompt. */
  llmPromptMaxComparisons: number;
  /** docs/paper-quality-bar.md §7, §12 — maximum paper claims included in the LLM prompt. */
  llmPromptMaxClaims: number;
  /** docs/paper-quality-bar.md §7, §12 — maximum strengths/weakness strings surfaced from the raw LLM response. */
  llmPromptMaxStrengthWeaknessItems: number;
  /** docs/paper-quality-bar.md §12 — number of expected LLM dimension slots in the paper-quality scorecard. */
  llmExpectedDimensionCount: number;
  /** docs/paper-quality-bar.md §11, §12 — max preview chars used when summarizing the branch hypothesis from available artifacts. */
  llmBranchHypothesisPreviewLength: number;
  /** docs/paper-quality-bar.md §6, §12 — highest fallback score allowed when no executed result exists. */
  llmNoExecutedResultScoreCeiling: number;
  /** docs/paper-quality-bar.md §7, §8, §10 — default highest-priority upgrade action rank. */
  llmHighestPriorityActionRank: number;
  /** docs/paper-quality-bar.md §11, §12 — max preview chars used in deterministic gate detail text to keep summaries inspectable. */
  objectiveMetricPreviewLength: number;
}

export const GATE_THRESHOLDS: PaperGateThresholds = {
  minPrimaryFindingCount: 1,
  minRobustnessTotalTrials: 2,
  minRobustnessConfidenceIntervalCount: 1,
  minRobustnessStabilityMetricCount: 1,
  minRobustnessEffectEstimateCount: 1,
  minEvidenceLinksClaimCount: 1,
  minClaimEvidenceRows: 1,
  minClaimEvidenceRefsPerClaim: 1,
  minFundamentalFailuresForBlocked: 4,
  minGeneralFailuresForBlocked: 3,
  llmEvaluationTimeoutMs: 30_000,
  llmBlockedForPaperScaleThreshold: 3,
  llmResearchMemoThreshold: 5,
  llmFallbackPassedOverallScore: 4,
  llmFallbackBlockedOverallScore: 2,
  llmFallbackWeakDimensionScore: 1,
  llmFallbackNeutralDimensionScore: 2,
  llmFallbackSupportedDimensionScore: 3,
  llmOverallScoreMin: 1,
  llmOverallScoreMax: 10,
  llmDimensionScoreMin: 1,
  llmDimensionScoreMax: 5,
  llmMaxEvidenceGaps: 5,
  llmMaxUpgradeActions: 5,
  llmMaxStrengths: 5,
  llmMaxWeaknesses: 5,
  llmPromptMaxPrimaryFindings: 5,
  llmPromptMaxComparisons: 4,
  llmPromptMaxClaims: 5,
  llmPromptMaxStrengthWeaknessItems: 5,
  llmExpectedDimensionCount: 7,
  llmBranchHypothesisPreviewLength: 120,
  llmNoExecutedResultScoreCeiling: 3,
  llmHighestPriorityActionRank: 1,
  objectiveMetricPreviewLength: 80
};
