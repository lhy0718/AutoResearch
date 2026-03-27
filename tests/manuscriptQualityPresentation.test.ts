import { describe, expect, it } from "vitest";

import { buildManuscriptQualityInsightCard } from "../src/core/manuscriptQualityPresentation.js";

describe("manuscriptQualityPresentation", () => {
  it("builds a structured manuscript-quality insight with separated issue groups", () => {
    const decision = {
      action: "stop",
      pass_index: 1,
      triggered_by: ["appendix_hygiene"],
      allowed_max_passes: 2,
      remaining_allowed_repairs: 0,
      issues_before: [
        {
          source: "review",
          code: "appendix_hygiene",
          severity: "fail",
          section: "Appendix",
          repairable: true,
          message: "Appendix still includes internal workflow residue."
        }
      ],
      issues_after: [
        {
          source: "review",
          code: "appendix_hygiene",
          severity: "fail",
          section: "Appendix",
          repairable: true,
          message: "Appendix still includes internal workflow residue."
        }
      ],
      improvement_detected: false,
      stop_or_continue_reason: "Appendix contamination remained after the first repair.",
      decision_digest: {
        stage: "post_repair_1",
        action: "stop",
        review_reliability: "grounded",
        issue_counts_before: {
          total: 1,
          fail: 1,
          warning: 0
        },
        issue_counts_after: {
          total: 1,
          fail: 1,
          warning: 0
        },
        improvement_detected: false,
        allowed_max_passes: 2,
        remaining_allowed_repairs: 0,
        triggered_by: ["appendix_hygiene"],
        stop_reason_category: "policy_hard_stop"
      },
      summary_lines: [
        "Action: stop.",
        "Decision reason: Appendix contamination remained after the first repair."
      ]
    } as const;

    const card = buildManuscriptQualityInsightCard({
      decision,
      failure: {
        reason: "Appendix contamination remained after the first repair.",
        decision_digest: decision.decision_digest,
        summary_lines: decision.summary_lines,
        triggered_by: ["appendix_hygiene"],
        review_reliability: "grounded",
        final_issues: [...decision.issues_after],
        reviewer_missed_policy_findings: [
          {
            code: "appendix_internal_text",
            section: "Appendix",
            severity: "fail"
          }
        ],
        reviewer_covered_backstop_findings: [
          {
            code: "duplicate_sentence_pattern",
            section: "Discussion",
            severity: "warning",
            gate_role: "backstop_only",
            covered_by_review_issue_code: "paragraph_redundancy"
          }
        ]
      },
      styleLint: {
        mode: "hard_policy_only",
        checked_rules: ["appendix_hygiene"],
        ok: false,
        issues: [
          {
            severity: "fail",
            code: "appendix_internal_text",
            section: "Appendix",
            message: "Appendix includes internal workflow text.",
            fix_recommendation: "Remove internal instructions from the appendix.",
            gate_role: "hard_stop"
          }
        ],
        summary: ["1 appendix hard-stop finding remains."]
      },
      readinessRisks: {
        paper_ready: false,
        readiness_state: "paper_scale_candidate",
        risk_count: 1,
        blocked_count: 0,
        warning_count: 1,
        summary_lines: ["Readiness risks: blocked=0, warning=1, readiness_state=paper_scale_candidate."],
        risks: [
          {
            risk_code: "paper_scale_paper_scale_candidate",
            severity: "warning",
            category: "paper_scale",
            status: "unverified",
            message: "The post-draft critique still classifies the run as paper_scale_candidate, not paper_ready.",
            triggered_by: ["paper_critique"],
            affected_claim_ids: [],
            affected_citation_ids: []
          }
        ]
      },
      scientificValidation: {
        issues: [
          {
            code: "missing_baseline",
            severity: "error",
            message: "Baseline comparison is still missing.",
            involved_sections: ["Results"]
          }
        ]
      } as any,
      submissionValidation: {
        ok: false,
        citedPaperIds: [],
        unresolvedCitationPaperIds: ["p1"],
        issues: [
          {
            kind: "citation",
            location: "Conclusion",
            message: "A comparative claim in the conclusion is uncited."
          }
        ]
      },
      artifactPresence: {
        failure: true,
        review: true,
        reviewValidation: true,
        reviewAudit: true,
        styleLint: true,
        readinessRisks: true,
        scientificValidation: true,
        submissionValidation: true,
        latestRepairVerificationPath: "paper/manuscript_repair_verification_1.json"
      }
    });

    expect(card.title).toBe("Manuscript quality");
    expect(card.manuscriptQuality?.status).toBe("stopped");
    expect(card.manuscriptQuality?.reasonCategory).toBe("upstream_scientific_or_submission_failure");
    expect(card.manuscriptQuality?.issueGroups.manuscript).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "appendix_hygiene",
          section: "Appendix",
          source: "review"
        })
      ])
    );
    expect(card.manuscriptQuality?.issueGroups.hardStopPolicy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "appendix_internal_text",
          source: "style_lint"
        })
      ])
    );
    expect(card.manuscriptQuality?.issueGroups.scientific).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_baseline",
          source: "scientific_validation"
        })
      ])
    );
    expect(card.manuscriptQuality?.issueGroups.submission).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "citation",
          source: "submission_validation"
        })
      ])
    );
    expect(card.manuscriptQuality?.issueGroups.readiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "paper_scale_paper_scale_candidate",
          source: "paper_readiness"
        })
      ])
    );
    expect(card.manuscriptQuality?.issueCounts.readinessRisks).toBe(1);
    expect(card.manuscriptQuality?.artifactRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Manuscript quality gate", path: "paper/manuscript_quality_gate.json" }),
        expect.objectContaining({ label: "Manuscript quality failure", path: "paper/manuscript_quality_failure.json" }),
        expect.objectContaining({ label: "Readiness risks", path: "paper/readiness_risks.json" }),
        expect.objectContaining({ label: "Repair verification 1", path: "paper/manuscript_repair_verification_1.json" })
      ])
    );
  });
});
