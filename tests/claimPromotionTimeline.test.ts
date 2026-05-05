import { describe, expect, it } from "vitest";

import { buildClaimPromotionTimeline } from "../src/core/audit/claimPromotionTimeline.js";

describe("claim promotion timeline", () => {
  it("derives claim events and blocked-claim events without inventing support", () => {
    const { timeline, blockedClaimEvents } = buildClaimPromotionTimeline({
      claimEvidenceExport: {
        version: 1,
        generated_at: "2026-05-05T00:00:00.000Z",
        measured: true,
        summary: {
          major_claim_count: 2,
          supported_claim_count: 1,
          unsupported_claim_count: 1,
          claim_to_evidence_coverage: 0.5
        },
        claims: [
          {
            claim_id: "claim_supported",
            statement: "Metric improved.",
            status: "supported",
            artifact_refs: ["result_table.json"],
            citation_refs: [],
            evidence_ids: ["ev_metric"],
            support_level: "artifact_or_citation_linked",
            issue_codes: []
          },
          {
            claim_id: "claim_blocked",
            statement: "Unsupported broad claim.",
            status: "blocked",
            artifact_refs: [],
            citation_refs: [],
            evidence_ids: [],
            support_level: "blocked",
            issue_codes: ["claim_evidence_missing"]
          }
        ],
        policy_note: "does not create evidence"
      },
      blockers: [{ code: "fallback_only_evidence", severity: "blocker", message: "fallback", source: "liveValidationScoring" }],
      unsupportedClaims: [{ claim_id: "claim_blocked", message: "missing evidence", statement: "Unsupported broad claim." }],
      citationSupportIssues: [],
      allowedClaimLevel: "system_validation_note_only"
    });

    expect(timeline.entries.find((entry) => entry.claim_id === "claim_supported")?.event).toBe("supported");
    expect(timeline.entries.find((entry) => entry.claim_id === "claim_blocked")?.event).toBe("blocked");
    expect(timeline.entries.find((entry) => entry.claim_id === "claim_blocked")?.evidence_refs).toEqual([]);
    expect(blockedClaimEvents.events.map((event) => event.code)).toContain("unsupported_claim");
    expect(blockedClaimEvents.events.map((event) => event.code)).toContain("fallback_only_evidence");
  });
});
