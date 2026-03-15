import { describe, expect, it } from "vitest";

import {
  buildPreDraftCritique,
  buildPostDraftCritique,
  resolveVenueStyle,
  getVenueProfile,
  isUpstreamEvidenceDeficit,
  isLocalStyleIssue,
  classifyIssueBacktrackTarget,
  critiqueDecisionToTransitionAction,
  critiqueDecisionToTargetNode,
  VENUE_PROFILES,
  VENUE_STYLE_IDS,
  DEFAULT_VENUE_STYLE,
  type VenueStyleId,
  type CritiqueIssue,
  type PaperCritique,
  type PreDraftCritiqueInput,
  type PostDraftCritiqueInput
} from "../src/core/paperCritique.js";

import type { ReviewScorecard, ReviewFinding, ReviewDecision, ReviewArtifactPresence } from "../src/core/reviewSystem.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScorecard(overallScore: number, dimensions?: Partial<Record<string, number>>): ReviewScorecard {
  return {
    overall_score_1_to_5: overallScore,
    dimensions: [
      {
        dimension: "claim_verification",
        label: "Claim Verification",
        score_1_to_5: dimensions?.claim_verification ?? overallScore,
        confidence: 0.8,
        summary: "claim verification summary",
        top_finding_ids: []
      },
      {
        dimension: "methodology",
        label: "Methodology",
        score_1_to_5: dimensions?.methodology ?? overallScore,
        confidence: 0.8,
        summary: "methodology summary",
        top_finding_ids: []
      },
      {
        dimension: "statistics",
        label: "Statistics",
        score_1_to_5: dimensions?.statistics ?? overallScore,
        confidence: 0.8,
        summary: "statistics summary",
        top_finding_ids: []
      },
      {
        dimension: "writing_readiness",
        label: "Writing Readiness",
        score_1_to_5: dimensions?.writing_readiness ?? overallScore,
        confidence: 0.8,
        summary: "writing readiness summary",
        top_finding_ids: []
      },
      {
        dimension: "integrity",
        label: "Integrity",
        score_1_to_5: dimensions?.integrity ?? overallScore,
        confidence: 0.8,
        summary: "integrity summary",
        top_finding_ids: []
      }
    ]
  };
}

function makeDecision(outcome: string, transition?: string): ReviewDecision {
  return {
    outcome: outcome as ReviewDecision["outcome"],
    recommended_transition: transition as ReviewDecision["recommended_transition"],
    confidence: 0.8,
    summary: `Decision: ${outcome}`,
    rationale: "test rationale",
    blocking_finding_ids: [],
    required_actions: []
  };
}

function makePresence(overrides?: Partial<ReviewArtifactPresence>): ReviewArtifactPresence {
  return {
    corpusPresent: true,
    paperSummariesPresent: true,
    evidenceStorePresent: true,
    hypothesesPresent: true,
    experimentPlanPresent: true,
    metricsPresent: true,
    figurePresent: true,
    synthesisPresent: true,
    ...overrides
  };
}

function makeFinding(overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    id: "f1",
    reviewer_id: "r1",
    reviewer_label: "Test Reviewer",
    dimension: "claim_verification",
    severity: "high",
    title: "Test finding",
    detail: "Detail of test finding",
    claim_ids: [],
    evidence_paths: [],
    confidence: 0.8,
    ...overrides
  };
}

function makePreDraftInput(overrides?: Partial<PreDraftCritiqueInput>): PreDraftCritiqueInput {
  return {
    venueStyle: "generic_cs_paper",
    scorecard: makeScorecard(4),
    decision: makeDecision("advance"),
    findings: [],
    presence: makePresence(),
    ...overrides
  };
}

function makePostDraftInput(overrides?: Partial<PostDraftCritiqueInput>): PostDraftCritiqueInput {
  return {
    venueStyle: "generic_cs_paper",
    preDraftCritique: null,
    gateDecision: {
      status: "pass",
      blocking_issue_count: 0,
      warning_count: 0,
      failure_reasons: [],
      summary: ["gate passed"]
    },
    scientificValidation: { issues: [] },
    submissionValidation: { ok: true, issues: [] },
    manuscriptSections: ["Introduction", "Related Work", "Method", "Experiments", "Conclusion"],
    validationWarningCount: 0,
    claimRewriteCount: 0,
    evidenceDiagnostics: {
      blocked_by_evidence_insufficiency: false,
      missing_evidence_categories: [],
      thin_sections: []
    },
    pageBudgetStatus: "ok",
    methodStatus: "pass",
    resultsStatus: "pass",
    relatedWorkStatus: "pass",
    discussionStatus: "pass",
    ...overrides
  };
}

// ===========================================================================
// Venue style support
// ===========================================================================

describe("venue style support", () => {
  it("resolveVenueStyle returns known IDs unchanged", () => {
    for (const id of VENUE_STYLE_IDS) {
      expect(resolveVenueStyle(id)).toBe(id);
    }
  });

  it("resolveVenueStyle normalizes dashes and spaces", () => {
    expect(resolveVenueStyle("generic-cs-paper")).toBe("generic_cs_paper");
    expect(resolveVenueStyle("generic cs paper")).toBe("generic_cs_paper");
    expect(resolveVenueStyle("GENERIC_ML_CONFERENCE")).toBe("generic_ml_conference");
  });

  it("resolveVenueStyle returns default for unknown values", () => {
    expect(resolveVenueStyle(undefined)).toBe(DEFAULT_VENUE_STYLE);
    expect(resolveVenueStyle(null)).toBe(DEFAULT_VENUE_STYLE);
    expect(resolveVenueStyle("")).toBe(DEFAULT_VENUE_STYLE);
    expect(resolveVenueStyle("unknown_venue")).toBe(DEFAULT_VENUE_STYLE);
  });

  it("every venue profile has required fields", () => {
    for (const id of VENUE_STYLE_IDS) {
      const profile = getVenueProfile(id);
      expect(profile.id).toBe(id);
      expect(profile.label).toBeTruthy();
      expect(profile.title_style).toBeTruthy();
      expect(profile.abstract_style).toBeTruthy();
      expect(profile.section_emphasis.length).toBeGreaterThan(0);
      expect(profile.tone_claim_discipline).toBeTruthy();
      expect(profile.expected_strengths.length).toBeGreaterThan(0);
    }
  });

  it("venue style persists in critique artifact", () => {
    const critique = buildPreDraftCritique(makePreDraftInput({ venueStyle: "acl" }));
    expect(critique.target_venue_style).toBe("acl");
  });

  it("post-draft critique records venue style", () => {
    const critique = buildPostDraftCritique(makePostDraftInput({ venueStyle: "neurips" }));
    expect(critique.target_venue_style).toBe("neurips");
  });
});

// ===========================================================================
// Issue classification
// ===========================================================================

describe("issue classification", () => {
  it("upstream evidence deficit for methodology issues", () => {
    const issue: CritiqueIssue = {
      issue_id: "test_1",
      severity: "blocking",
      category: "methodological_completeness",
      summary: "Missing baseline",
      evidence: "No comparator found",
      recommended_fix: "Add baseline",
      suggested_backtrack_target: null
    };
    expect(isUpstreamEvidenceDeficit(issue)).toBe(true);
    expect(isLocalStyleIssue(issue)).toBe(false);
    expect(classifyIssueBacktrackTarget(issue)).toBe("design_experiments");
  });

  it("local style issue for writing clarity", () => {
    const issue: CritiqueIssue = {
      issue_id: "test_2",
      severity: "medium",
      category: "writing_clarity",
      summary: "Weak abstract",
      evidence: "Abstract is too vague",
      recommended_fix: "Rewrite abstract",
      suggested_backtrack_target: null
    };
    expect(isLocalStyleIssue(issue)).toBe(true);
    expect(isUpstreamEvidenceDeficit(issue)).toBe(false);
    expect(classifyIssueBacktrackTarget(issue)).toBeNull();
  });

  it("venue style fit is a local issue", () => {
    const issue: CritiqueIssue = {
      issue_id: "test_3",
      severity: "medium",
      category: "venue_style_fit",
      summary: "Section ordering mismatch",
      evidence: "Expected different order",
      recommended_fix: "Reorder sections",
      suggested_backtrack_target: null
    };
    expect(isLocalStyleIssue(issue)).toBe(true);
    expect(isUpstreamEvidenceDeficit(issue)).toBe(false);
  });

  it("statistical adequacy maps to implement_experiments backtrack", () => {
    const issue: CritiqueIssue = {
      issue_id: "test_4",
      severity: "blocking",
      category: "statistical_adequacy",
      summary: "Missing confidence intervals",
      evidence: "No CI reported",
      recommended_fix: "Run statistical tests",
      suggested_backtrack_target: null
    };
    expect(classifyIssueBacktrackTarget(issue)).toBe("implement_experiments");
  });

  it("research question clarity maps to generate_hypotheses backtrack", () => {
    const issue: CritiqueIssue = {
      issue_id: "test_5",
      severity: "blocking",
      category: "research_question_clarity",
      summary: "No clear research question",
      evidence: "Question is vague",
      recommended_fix: "Refine hypothesis",
      suggested_backtrack_target: null
    };
    expect(classifyIssueBacktrackTarget(issue)).toBe("generate_hypotheses");
  });

  it("explicit backtrack target is honored", () => {
    const issue: CritiqueIssue = {
      issue_id: "test_6",
      severity: "high",
      category: "writing_clarity",
      summary: "Test",
      evidence: "Test",
      recommended_fix: "Test",
      suggested_backtrack_target: "design_experiments"
    };
    expect(isUpstreamEvidenceDeficit(issue)).toBe(true);
    expect(classifyIssueBacktrackTarget(issue)).toBe("design_experiments");
  });
});

// ===========================================================================
// Transition mapping
// ===========================================================================

describe("transition mapping", () => {
  it("advance maps to advance action", () => {
    expect(critiqueDecisionToTransitionAction("advance")).toBe("advance");
    expect(critiqueDecisionToTargetNode("advance")).toBe("write_paper");
  });

  it("repair_then_retry maps to retry_same", () => {
    expect(critiqueDecisionToTransitionAction("repair_then_retry")).toBe("retry_same");
    expect(critiqueDecisionToTargetNode("repair_then_retry")).toBeUndefined();
  });

  it("backtrack decisions map to correct targets", () => {
    expect(critiqueDecisionToTransitionAction("backtrack_to_implement")).toBe("backtrack_to_implement");
    expect(critiqueDecisionToTargetNode("backtrack_to_implement")).toBe("implement_experiments");

    expect(critiqueDecisionToTransitionAction("backtrack_to_design")).toBe("backtrack_to_design");
    expect(critiqueDecisionToTargetNode("backtrack_to_design")).toBe("design_experiments");

    expect(critiqueDecisionToTransitionAction("backtrack_to_hypotheses")).toBe("backtrack_to_hypotheses");
    expect(critiqueDecisionToTargetNode("backtrack_to_hypotheses")).toBe("generate_hypotheses");
  });

  it("pause_for_human maps correctly", () => {
    expect(critiqueDecisionToTransitionAction("pause_for_human")).toBe("pause_for_human");
    expect(critiqueDecisionToTargetNode("pause_for_human")).toBeUndefined();
  });
});

// ===========================================================================
// Pre-draft critique (review gate)
// ===========================================================================

describe("pre-draft critique", () => {
  it("strong evidence advances to write_paper", () => {
    const critique = buildPreDraftCritique(makePreDraftInput());
    expect(critique.stage).toBe("pre_draft_review");
    expect(critique.overall_decision).toBe("advance");
    expect(critique.manuscript_type).toBe("paper_ready");
    expect(critique.blocking_issues_count).toBe(0);
  });

  it("weak evidence blocks before write_paper", () => {
    const critique = buildPreDraftCritique(makePreDraftInput({
      scorecard: makeScorecard(1),
      decision: makeDecision("backtrack_to_design", "backtrack_to_design"),
      findings: [
        makeFinding({ severity: "high", dimension: "methodology", title: "No baseline" }),
        makeFinding({ id: "f2", severity: "high", dimension: "statistics", title: "No stats" }),
        makeFinding({ id: "f3", severity: "high", dimension: "claim_verification", title: "Weak claims" })
      ],
      presence: makePresence({ metricsPresent: false, experimentPlanPresent: false })
    }));
    expect(critique.stage).toBe("pre_draft_review");
    expect(critique.overall_decision).not.toBe("advance");
    expect(critique.manuscript_type).toBe("system_validation_note");
    expect(critique.blocking_issues_count).toBeGreaterThan(0);
  });

  it("missing metrics and experiment plan classifies as system_validation_note", () => {
    const critique = buildPreDraftCritique(makePreDraftInput({
      presence: makePresence({ metricsPresent: false, experimentPlanPresent: false })
    }));
    expect(critique.manuscript_type).toBe("system_validation_note");
  });

  it("review panel backtrack recommendation is honored", () => {
    const critique = buildPreDraftCritique(makePreDraftInput({
      decision: makeDecision("backtrack_to_hypotheses", "backtrack_to_hypotheses")
    }));
    expect(critique.overall_decision).toBe("backtrack_to_hypotheses");
  });

  it("manual_block from review panel maps to pause_for_human", () => {
    const critique = buildPreDraftCritique(makePreDraftInput({
      decision: makeDecision("manual_block")
    }));
    expect(critique.overall_decision).toBe("pause_for_human");
  });

  it("records venue style notes", () => {
    const critique = buildPreDraftCritique(makePreDraftInput({
      venueStyle: "icml"
    }));
    expect(critique.target_venue_style).toBe("icml");
    expect(critique.venue_style_notes).toBeTruthy();
  });

  it("write_paper completed is not paper_ready when evidence is weak", () => {
    const critique = buildPreDraftCritique(makePreDraftInput({
      scorecard: makeScorecard(2),
      presence: makePresence({ evidenceStorePresent: false })
    }));
    expect(critique.manuscript_type).not.toBe("paper_ready");
  });
});

// ===========================================================================
// Post-draft critique
// ===========================================================================

describe("post-draft critique", () => {
  it("healthy manuscript is paper_ready", () => {
    const critique = buildPostDraftCritique(makePostDraftInput());
    expect(critique.stage).toBe("post_draft_review");
    expect(critique.manuscript_type).toBe("paper_ready");
    expect(critique.overall_decision).toBe("advance");
    expect(critique.blocking_issues_count).toBe(0);
  });

  it("evidence insufficiency triggers backtrack", () => {
    const critique = buildPostDraftCritique(makePostDraftInput({
      evidenceDiagnostics: {
        blocked_by_evidence_insufficiency: true,
        missing_evidence_categories: ["method_results", "ablation"],
        thin_sections: ["Experiments"]
      },
      gateDecision: {
        status: "fail",
        blocking_issue_count: 2,
        warning_count: 0,
        failure_reasons: ["evidence insufficiency"],
        summary: ["evidence insufficient"]
      }
    }));
    expect(critique.overall_decision).not.toBe("advance");
    expect(critique.manuscript_type).not.toBe("paper_ready");
    expect(critique.needs_additional_experiments).toBe(true);
  });

  it("writing/style-only defects trigger repair not backtrack", () => {
    const critique = buildPostDraftCritique(makePostDraftInput({
      submissionValidation: {
        ok: false,
        issues: [{ message: "Title too long" }, { message: "Abstract missing keywords" }]
      }
    }));
    // Style issues should not cause upstream backtrack
    expect(critique.overall_decision).toBe("advance");
    expect(critique.manuscript_type).not.toBe("blocked_for_paper_scale");
  });

  it("gate failure with evidence block triggers backtrack", () => {
    const critique = buildPostDraftCritique(makePostDraftInput({
      gateDecision: {
        status: "fail",
        blocking_issue_count: 1,
        warning_count: 0,
        failure_reasons: ["no result table"],
        summary: ["gate failed"]
      },
      evidenceDiagnostics: {
        blocked_by_evidence_insufficiency: true,
        missing_evidence_categories: ["results"],
        thin_sections: ["Results"]
      }
    }));
    expect(critique.manuscript_type).toBe("blocked_for_paper_scale");
    expect(["backtrack_to_implement", "backtrack_to_design", "backtrack_to_hypotheses"]).toContain(
      critique.overall_decision
    );
  });

  it("missing method triggers design backtrack", () => {
    const critique = buildPostDraftCritique(makePostDraftInput({
      methodStatus: "fail"
    }));
    expect(critique.blocking_issues.some(
      (i) => i.category === "methodological_completeness"
    )).toBe(true);
  });

  it("missing results triggers implement backtrack", () => {
    const critique = buildPostDraftCritique(makePostDraftInput({
      resultsStatus: "fail",
      evidenceDiagnostics: {
        blocked_by_evidence_insufficiency: true,
        missing_evidence_categories: ["results"],
        thin_sections: ["Results"]
      },
      gateDecision: {
        status: "fail",
        blocking_issue_count: 1,
        warning_count: 0,
        failure_reasons: ["results missing"],
        summary: ["no results"]
      }
    }));
    expect(critique.needs_additional_experiments).toBe(true);
    expect(critique.blocking_issues.some(
      (i) => i.category === "statistical_adequacy"
    )).toBe(true);
  });

  it("venue style mismatch is treated as local repair", () => {
    const critique = buildPostDraftCritique(makePostDraftInput({
      venueStyle: "icml",
      manuscriptSections: ["Introduction", "Conclusion"]
    }));
    expect(critique.style_mismatches.length).toBeGreaterThan(0);
    expect(critique.style_repairable_locally).toBe(true);
    // Style mismatch alone should not cause upstream backtrack
    expect(critique.overall_decision).toBe("advance");
  });

  it("records whether draft improved over pre-draft", () => {
    const preDraft = buildPreDraftCritique(makePreDraftInput());
    const postDraft = buildPostDraftCritique(makePostDraftInput({
      preDraftCritique: preDraft
    }));
    expect(postDraft.stage).toBe("post_draft_review");
    // Overall score should be reasonable since both are healthy
    expect(postDraft.overall_score).toBeGreaterThan(0);
  });

  it("strong manuscript still passes without regression", () => {
    const critique = buildPostDraftCritique(makePostDraftInput());
    expect(critique.overall_decision).toBe("advance");
    expect(critique.manuscript_type).toBe("paper_ready");
    expect(critique.blocking_issues_count).toBe(0);
    expect(critique.non_blocking_issues_count).toBe(0);
    expect(critique.needs_additional_experiments).toBe(false);
    expect(critique.needs_additional_statistics).toBe(false);
    expect(critique.needs_design_revision).toBe(false);
  });
});

// ===========================================================================
// TUI surfacing contract
// ===========================================================================

describe("critique TUI surfacing contract", () => {
  it("critique includes all required TUI-surfaceable fields", () => {
    const critique = buildPreDraftCritique(makePreDraftInput());

    // Fields that TUI should surface
    expect(critique.manuscript_type).toBeTruthy();
    expect(critique.target_venue_style).toBeTruthy();
    expect(critique.overall_decision).toBeTruthy();
    expect(typeof critique.blocking_issues_count).toBe("number");
    expect(critique.stage).toBeTruthy();
    expect(critique.paper_readiness_state).toBeTruthy();
  });

  it("blocked state is surfaceable", () => {
    const critique = buildPreDraftCritique(makePreDraftInput({
      scorecard: makeScorecard(1),
      presence: makePresence({ metricsPresent: false, experimentPlanPresent: false })
    }));
    expect(critique.manuscript_type).toBe("system_validation_note");
    expect(critique.paper_readiness_state).toBe("system_validation_note");
  });

  it("venue style is visible in critique", () => {
    for (const venue of ["acl", "neurips", "icml"] as VenueStyleId[]) {
      const critique = buildPreDraftCritique(makePreDraftInput({ venueStyle: venue }));
      expect(critique.target_venue_style).toBe(venue);
    }
  });
});

// ===========================================================================
// Category scores
// ===========================================================================

describe("category scores", () => {
  it("pre-draft critique has all 11 categories", () => {
    const critique = buildPreDraftCritique(makePreDraftInput());
    expect(critique.category_scores.length).toBe(11);
    const categories = critique.category_scores.map((c) => c.category);
    expect(categories).toContain("research_question_clarity");
    expect(categories).toContain("related_work_depth");
    expect(categories).toContain("methodological_completeness");
    expect(categories).toContain("statistical_adequacy");
    expect(categories).toContain("result_table_quality");
    expect(categories).toContain("claim_evidence_linkage");
    expect(categories).toContain("reproducibility");
    expect(categories).toContain("limitations_honesty");
    expect(categories).toContain("writing_clarity");
    expect(categories).toContain("artifact_consistency");
    expect(categories).toContain("venue_style_fit");
  });

  it("post-draft critique has all 11 categories", () => {
    const critique = buildPostDraftCritique(makePostDraftInput());
    expect(critique.category_scores.length).toBe(11);
  });

  it("scores are clamped between 1 and 5", () => {
    const critique = buildPreDraftCritique(makePreDraftInput({
      scorecard: makeScorecard(0)
    }));
    for (const score of critique.category_scores) {
      expect(score.score_1_to_5).toBeGreaterThanOrEqual(1);
      expect(score.score_1_to_5).toBeLessThanOrEqual(5);
    }
  });
});
