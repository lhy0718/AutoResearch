import { describe, expect, it } from "vitest";

import { checkReviewDecision } from "../src/core/analysis/reviewDecision.js";
import type { ReviewPacket } from "../src/core/reviewPacket.js";

function makeReviewPacket(overrides?: Partial<ReviewPacket>): ReviewPacket {
  return {
    generated_at: "2026-04-02T00:00:00.000Z",
    readiness: {
      status: "ready",
      ready_checks: 5,
      warning_checks: 0,
      blocking_checks: 0,
      manual_checks: 0
    },
    objective_status: "met",
    objective_summary: "Objective met.",
    checks: [],
    suggested_actions: [],
    panel: {
      reviewer_count: 5,
      findings_count: 0,
      reviewers: [
        {
          reviewer_id: "claim_verifier",
          reviewer_label: "Claim verifier",
          score_1_to_5: 5,
          recommendation: "advance",
          summary: "Strong.",
          high_findings: 0
        },
        {
          reviewer_id: "methodology_reviewer",
          reviewer_label: "Methodology reviewer",
          score_1_to_5: 4,
          recommendation: "advance",
          summary: "Strong.",
          high_findings: 0
        },
        {
          reviewer_id: "statistics_reviewer",
          reviewer_label: "Statistics reviewer",
          score_1_to_5: 4,
          recommendation: "advance",
          summary: "Strong.",
          high_findings: 0
        }
      ]
    },
    decision: {
      outcome: "advance",
      recommended_transition: "advance",
      confidence_pct: 85,
      summary: "Advance.",
      rationale: "All checks passed.",
      required_actions: []
    },
    ...overrides
  };
}

describe("checkReviewDecision", () => {
  it("accepts when all specialist scores are high and no blocking checks remain", () => {
    const decision = checkReviewDecision(makeReviewPacket());
    expect(decision.verdict).toBe("accept");
  });

  it("requests revision when one specialist score falls below the threshold", () => {
    const packet = makeReviewPacket({
      panel: {
        reviewer_count: 3,
        findings_count: 1,
        reviewers: [
          {
            reviewer_id: "claim_verifier",
            reviewer_label: "Claim verifier",
            score_1_to_5: 5,
            recommendation: "advance",
            summary: "Strong.",
            high_findings: 0
          },
          {
            reviewer_id: "methodology_reviewer",
            reviewer_label: "Methodology reviewer",
            score_1_to_5: 3,
            recommendation: "revise_in_place",
            summary: "Needs work.",
            high_findings: 0
          }
        ]
      }
    });

    const decision = checkReviewDecision(packet);
    expect(decision.verdict).toBe("revise");
  });

  it("rejects when multiple critical failures remain", () => {
    const packet = makeReviewPacket({
      readiness: {
        status: "blocking",
        ready_checks: 2,
        warning_checks: 1,
        blocking_checks: 2,
        manual_checks: 0
      },
      panel: {
        reviewer_count: 2,
        findings_count: 2,
        reviewers: [
          {
            reviewer_id: "statistics_reviewer",
            reviewer_label: "Statistics reviewer",
            score_1_to_5: 2,
            recommendation: "backtrack_to_design",
            summary: "Critical gaps.",
            high_findings: 1
          },
          {
            reviewer_id: "integrity_reviewer",
            reviewer_label: "Integrity reviewer",
            score_1_to_5: 2,
            recommendation: "backtrack_to_hypotheses",
            summary: "Critical gaps.",
            high_findings: 1
          }
        ]
      },
      decision: {
        outcome: "backtrack_to_design",
        recommended_transition: "backtrack_to_design",
        confidence_pct: 92,
        summary: "Backtrack.",
        rationale: "Critical failures remain.",
        required_actions: ["Repair methodology"]
      }
    });

    const decision = checkReviewDecision(packet);
    expect(decision.verdict).toBe("reject");
  });
});
