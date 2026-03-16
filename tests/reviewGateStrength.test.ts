import { describe, it, expect } from "vitest";
import { buildPreDraftCritique } from "../src/core/paperCritique.js";
import type { ReviewArtifactPresence, ReviewScorecard, ReviewDecision, ReviewFinding } from "../src/core/reviewSystem.js";

function makePresence(overrides: Partial<ReviewArtifactPresence> = {}): ReviewArtifactPresence {
  return {
    corpusPresent: true,
    paperSummariesPresent: true,
    evidenceStorePresent: true,
    hypothesesPresent: true,
    experimentPlanPresent: true,
    metricsPresent: true,
    figurePresent: false,
    synthesisPresent: true,
    baselineSummaryPresent: true,
    resultTablePresent: true,
    richnessSummaryPresent: true,
    richnessReadiness: "adequate",
    ...overrides
  };
}

function makeScorecard(overall = 3.5): ReviewScorecard {
  return {
    overall_score_1_to_5: overall,
    dimensions: [
      { dimension: "claim_verification", label: "Claim Verification", score_1_to_5: overall, confidence: 0.8, summary: "ok", top_finding_ids: [] },
      { dimension: "methodology", label: "Methodology", score_1_to_5: overall, confidence: 0.8, summary: "ok", top_finding_ids: [] },
      { dimension: "statistics", label: "Statistics", score_1_to_5: overall, confidence: 0.8, summary: "ok", top_finding_ids: [] },
      { dimension: "writing_readiness", label: "Writing Readiness", score_1_to_5: overall, confidence: 0.8, summary: "ok", top_finding_ids: [] },
      { dimension: "integrity", label: "Integrity", score_1_to_5: overall + 0.5, confidence: 0.8, summary: "ok", top_finding_ids: [] }
    ]
  };
}

function makeDecision(): ReviewDecision {
  return {
    outcome: "advance",
    recommended_transition: "advance",
    confidence: 0.8,
    summary: "Ready to write",
    rationale: "test rationale",
    blocking_finding_ids: [],
    required_actions: []
  };
}

describe("review gate with new artifacts", () => {
  it("all 3 artifacts missing → blocked_for_paper_scale", () => {
    const presence = makePresence({
      baselineSummaryPresent: false,
      resultTablePresent: false,
      richnessSummaryPresent: false,
      richnessReadiness: "unknown"
    });
    const critique = buildPreDraftCritique({
      venueStyle: "generic_cs_paper",
      scorecard: makeScorecard(),
      decision: makeDecision(),
      findings: [],
      presence
    });
    expect(critique.manuscript_type).toBe("blocked_for_paper_scale");
  });

  it("richness insufficient → research_memo at most", () => {
    const presence = makePresence({
      richnessReadiness: "insufficient"
    });
    const critique = buildPreDraftCritique({
      venueStyle: "generic_cs_paper",
      scorecard: makeScorecard(),
      decision: makeDecision(),
      findings: [],
      presence
    });
    expect(["research_memo", "system_validation_note"]).toContain(critique.manuscript_type);
  });

  it("all present + adequate → can reach paper_ready or paper_scale_candidate", () => {
    const presence = makePresence();
    const critique = buildPreDraftCritique({
      venueStyle: "generic_cs_paper",
      scorecard: makeScorecard(),
      decision: makeDecision(),
      findings: [],
      presence
    });
    expect(["paper_ready", "paper_scale_candidate"]).toContain(critique.manuscript_type);
  });

  it("2 of 3 missing with high scores → capped at research_memo", () => {
    const presence = makePresence({
      baselineSummaryPresent: false,
      resultTablePresent: false,
      richnessSummaryPresent: true,
      richnessReadiness: "adequate"
    });
    const critique = buildPreDraftCritique({
      venueStyle: "generic_cs_paper",
      scorecard: makeScorecard(3.5),
      decision: makeDecision(),
      findings: [],
      presence
    });
    expect(critique.manuscript_type).toBe("research_memo");
  });
});
