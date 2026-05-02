import { describe, expect, it } from "vitest";

import { scoreFigureAudit } from "../src/core/benchmark/figureAuditScoring.js";
import type { FigureAuditSummary } from "../src/core/exploration/types.js";

function summary(overrides: Partial<FigureAuditSummary> = {}): FigureAuditSummary {
  return {
    audited_at: "2026-05-02T00:00:00.000Z",
    figure_count: 2,
    issues: [],
    severe_mismatch_count: 0,
    review_block_required: false,
    ...overrides
  };
}

describe("figure audit scoring", () => {
  it("passes a clean measured figure audit", () => {
    const score = scoreFigureAudit({ summary: summary() });

    expect(score).toMatchObject({
      measured: true,
      audit_status: "pass",
      figure_count: 2,
      issue_count: 0,
      severe_mismatch_count: 0,
      review_block_required: false,
      figure_result_mismatch_rate: 0
    });
  });

  it("fails severe mismatches and requires review blocking", () => {
    const score = scoreFigureAudit({
      summary: summary({
        issues: [
          {
            figure_id: "fig1",
            issue_type: "figure_caption_incomplete",
            severity: "severe",
            description: "Figure caption overclaims.",
            recommended_action: "Rewrite or remove the figure.",
            evidence_alignment_status: "misaligned",
            empirical_validity_impact: "major",
            publication_readiness: "not_ready",
            manuscript_placement_recommendation: "remove"
          }
        ],
        severe_mismatch_count: 1,
        review_block_required: true
      })
    });

    expect(score.audit_status).toBe("fail");
    expect(score.review_block_required).toBe(true);
    expect(score.figure_result_mismatch_rate).toBe(0.5);
  });

  it("distinguishes no_figure_audit ablation from a clean pass", () => {
    const score = scoreFigureAudit({ condition: "no_figure_audit", summary: null });

    expect(score).toMatchObject({
      measured: false,
      audit_status: "ablated",
      skipped_reason: "figure_audit_ablated"
    });
  });
});
