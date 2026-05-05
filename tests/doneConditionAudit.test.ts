import { describe, expect, it } from "vitest";

import { evaluateDoneConditionAudit } from "../src/core/audit/doneConditionAudit.js";

describe("done-condition audit", () => {
  it("allows explicit weak output states without treating write_paper as paper-ready", () => {
    const audit = evaluateDoneConditionAudit({
      governanceCondition: {
        expected_paper_ready: false,
        allowed_weak_output_states: ["paper_ready=false", "research_memo"]
      },
      paperReady: false,
      writePaperCompleted: true,
      missingBaselineOrComparator: true,
      resultTableReady: false,
      fallbackOnlyEvidence: true,
      failedRunHidden: false,
      unsupportedClaimCount: 1,
      citationSupportIssueCount: 1,
      figureMismatchPresent: false
    });

    expect(audit.status).toBe("pass");
    expect(audit.allowed_weak_output_states).toContain("paper_ready=false");
    expect(audit.checks.find((check) => check.id === "write_paper_not_paper_ready")?.passed).toBe(true);
  });

  it("fails when paper_ready=true hides known evidence blockers", () => {
    const audit = evaluateDoneConditionAudit({
      governanceCondition: { expected_paper_ready: true },
      paperReady: true,
      writePaperCompleted: true,
      missingBaselineOrComparator: true,
      resultTableReady: false,
      fallbackOnlyEvidence: true,
      failedRunHidden: true,
      unsupportedClaimCount: 1,
      citationSupportIssueCount: 1,
      figureMismatchPresent: true
    });

    expect(audit.status).toBe("fail");
    expect(audit.failures).toContain("Paper-ready comparative claims require baseline/comparator evidence");
    expect(audit.failures).toContain("Paper-ready status requires a complete result table");
    expect(audit.failures).toContain("Fallback-only evidence cannot satisfy quantitative paper-ready completion");
    expect(audit.failures).toContain("Failed run visibility is required");
  });
});
