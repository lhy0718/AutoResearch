import type { ExplorationConfig } from "./explorationConfig.js";
import type { BaselineLockValidation } from "./baselineLock.js";
import { validateBranchAgainstLock } from "./baselineLock.js";
import { scoreBranch } from "./branchScorer.js";
import type { BaselineLock, BranchPromotionDecision, FailureMemoryEntry, ResearchTreeNode } from "./types.js";

function buildBlockingReasonsFromLock(lockValidation: BaselineLockValidation | null): string[] {
  if (!lockValidation || lockValidation.valid) {
    return [];
  }
  return [...lockValidation.violations];
}

export function evaluatePromotion(
  node: ResearchTreeNode,
  lock: BaselineLock | null,
  failureMemory: FailureMemoryEntry[],
  config: ExplorationConfig
): BranchPromotionDecision {
  const blocking_reasons: string[] = [];
  const score = scoreBranch(node, config);
  const lockValidation = lock ? validateBranchAgainstLock(node.change_set, lock) : null;
  const matchingFailure = node.failure_fingerprint
    ? failureMemory.find(
        (entry) => entry.failure_fingerprint === node.failure_fingerprint && entry.retry_policy === "block"
      )
    : null;

  if (node.status !== "completed") {
    blocking_reasons.push("Branch must be completed before promotion.");
  }
  if (!node.evidence_manifest) {
    blocking_reasons.push("Evidence manifest is missing.");
  }
  if (node.evidence_manifest?.is_executed !== true) {
    blocking_reasons.push("Evidence manifest does not confirm executed evidence.");
  }
  blocking_reasons.push(...buildBlockingReasonsFromLock(lockValidation));
  if (node.reproducibility_status !== "reproduced") {
    blocking_reasons.push("Branch has not reached reproduced reproducibility status.");
  }
  if ((node.evidence_manifest?.reproduction_runs ?? 0) < config.reproducibility_minimums.for_promotion) {
    blocking_reasons.push(
      `Branch requires at least ${config.reproducibility_minimums.for_promotion} reproduction run(s) for promotion.`
    );
  }
  if (matchingFailure) {
    blocking_reasons.push(
      `Failure fingerprint ${matchingFailure.failure_fingerprint} is blocked by failure memory policy.`
    );
  }
  if (!score.is_defensible) {
    blocking_reasons.push("Branch score is not defensible under the configured promotion thresholds.");
  }

  const promoted = blocking_reasons.length === 0;

  return {
    branch_id: node.node_id,
    promoted,
    is_strongest_defensible: promoted,
    promotion_score: score.composite_score,
    objective_gain: score.objective_gain,
    budget_penalty: score.budget_penalty,
    instability_penalty: score.instability_penalty,
    confound_penalty: score.confound_penalty,
    evidence_completeness: score.evidence_completeness,
    blocking_reasons,
    decided_at: new Date().toISOString()
  };
}

export function selectStrongestDefensible(
  candidates: ResearchTreeNode[],
  lock: BaselineLock | null,
  failureMemory: FailureMemoryEntry[],
  config: ExplorationConfig
): ResearchTreeNode | null {
  let best: { node: ResearchTreeNode; score: number } | null = null;
  for (const candidate of candidates) {
    const decision = evaluatePromotion(candidate, lock, failureMemory, config);
    if (!decision.promoted) {
      continue;
    }
    if (!best || decision.promotion_score > best.score) {
      best = { node: candidate, score: decision.promotion_score };
    }
  }
  return best?.node ?? null;
}
