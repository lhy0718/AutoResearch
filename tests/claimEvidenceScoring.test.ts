import { describe, expect, it } from "vitest";

import {
  buildGovernanceTaskScoreInputFromClaimEvidence,
  scoreClaimEvidenceArtifacts
} from "../src/core/benchmark/claimEvidenceScoring.js";
import { scoreGovernanceTask } from "../src/core/benchmark/governanceScorer.js";

describe("claim evidence scoring", () => {
  it("computes coverage and unsupported claim count from paper claim artifacts", () => {
    const score = scoreClaimEvidenceArtifacts({
      claimEvidenceTableArtifact: {
        claims: [
          {
            claim_id: "c1",
            artifact_refs: ["result_table.json"],
            citation_refs: ["paper_1"],
            strength: "high"
          },
          {
            claim_id: "c2",
            artifact_refs: [],
            citation_refs: [],
            strength: "low"
          }
        ]
      },
      claimStatusTableArtifact: {
        claims: [
          {
            claim_id: "c1",
            status: "verified",
            artifact_refs: ["result_table.json"],
            citation_refs: ["paper_1"],
            reproduction_trace_present: true
          },
          {
            claim_id: "c2",
            status: "blocked",
            artifact_refs: [],
            citation_refs: [],
            reproduction_trace_present: false
          }
        ]
      }
    });

    expect(score).toMatchObject({
      measured: true,
      major_claim_count: 2,
      supported_claim_count: 1,
      unsupported_claim_count: 1,
      claim_to_evidence_coverage: 0.5
    });
    expect(score.issues).toEqual([
      expect.objectContaining({
        code: "claim_evidence_blocked",
        claim_id: "c2"
      })
    ]);
  });

  it("uses evidence links when claim evidence table rows omit direct refs", () => {
    const score = scoreClaimEvidenceArtifacts({
      claimEvidenceTableArtifact: {
        claims: [
          {
            claim_id: "c1",
            artifact_refs: [],
            citation_refs: []
          }
        ]
      },
      evidenceLinksArtifact: {
        claims: [
          {
            claim_id: "c1",
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1"]
          }
        ]
      }
    });

    expect(score.supported_claim_count).toBe(1);
    expect(score.unsupported_claim_count).toBe(0);
    expect(score.claim_to_evidence_coverage).toBe(1);
  });

  it("feeds governance scorer metrics without reporting unmeasured placeholders", () => {
    const score = scoreClaimEvidenceArtifacts({});
    const taskInput = buildGovernanceTaskScoreInputFromClaimEvidence({
      taskId: "AGB-002",
      paperReady: false,
      expectedPaperReady: false,
      claimEvidenceScore: score
    });
    const taskScore = scoreGovernanceTask(taskInput);

    expect(taskInput.placeholder).toBe(true);
    expect(taskScore.measured).toBe(false);
    expect(taskScore.metrics).toBeNull();
  });
});
