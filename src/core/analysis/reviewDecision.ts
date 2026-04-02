import type { ReviewPacket } from "../reviewPacket.js";

export interface ReviewDecision {
  verdict: "accept" | "revise" | "reject";
  rationale: string;
  critical_failures: number;
  low_score_reviewers: number;
}

const REVIEW_ACCEPT_MIN_SCORE = 4;
const REVIEW_REJECT_CRITICAL_FAILURES = 2;

export function checkReviewDecision(reviewPacket: ReviewPacket): ReviewDecision {
  const reviewers = reviewPacket.panel?.reviewers ?? [];
  const lowScoreReviewers = reviewers.filter((reviewer) => reviewer.score_1_to_5 < REVIEW_ACCEPT_MIN_SCORE).length;
  const totalHighFindings = reviewers.reduce((sum, reviewer) => sum + reviewer.high_findings, 0);
  const blockingChecks = reviewPacket.readiness.blocking_checks;
  const criticalFailures = Math.max(totalHighFindings, blockingChecks);
  const outcome = reviewPacket.decision?.outcome;

  if (
    outcome === "manual_block"
    || criticalFailures >= REVIEW_REJECT_CRITICAL_FAILURES
    || ((outcome?.startsWith("backtrack_to_") ?? false) && criticalFailures > 0)
  ) {
    return {
      verdict: "reject",
      rationale: `Review rejected because ${criticalFailures} critical failure(s) remain or the panel recommended a blocking transition.`,
      critical_failures: criticalFailures,
      low_score_reviewers: lowScoreReviewers
    };
  }

  if (
    lowScoreReviewers > 0
    || reviewPacket.readiness.warning_checks > 0
    || reviewPacket.readiness.manual_checks > 0
    || outcome === "revise_in_place"
  ) {
    return {
      verdict: "revise",
      rationale: `Review requires revision because ${lowScoreReviewers} reviewer(s) scored below ${REVIEW_ACCEPT_MIN_SCORE}/5 or warnings/manual checks remain.`,
      critical_failures: criticalFailures,
      low_score_reviewers: lowScoreReviewers
    };
  }

  return {
    verdict: "accept",
    rationale: "Review accepted because specialist scores are consistently high and no blocking or warning checks remain.",
    critical_failures: criticalFailures,
    low_score_reviewers: lowScoreReviewers
  };
}
