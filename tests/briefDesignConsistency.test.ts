import { describe, expect, it } from "vitest";

import { checkBriefDesignConsistency } from "../src/core/experiments/briefDesignConsistency.js";
import {
  detectConfoundingHints,
  ExperimentContract
} from "../src/core/experiments/experimentContract.js";
import { MarkdownRunBriefSections } from "../src/core/runs/runBriefParser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContract(overrides: Partial<ExperimentContract> = {}): ExperimentContract {
  return {
    version: 1,
    run_id: "test",
    created_at: new Date().toISOString(),
    hypothesis: "Test hypothesis",
    causal_mechanism: "Test mechanism",
    single_change: "Replace free-form chat with shared_state_schema",
    confounded: false,
    expected_metric_effect: "Improve macro-F1 by +0.5",
    abort_condition: "Abort if metric drops",
    keep_or_discard_rule: "Keep if improved",
    ...overrides
  };
}

function makeBriefSections(overrides: Partial<MarkdownRunBriefSections> = {}): MarkdownRunBriefSections {
  return {
    title: "Research Brief",
    topic: "Calibration on tabular tasks",
    objectiveMetric: "macro-F1",
    constraints: "- Laptop only",
    plan: "Run experiments",
    targetComparison: "Proposed vs baseline on macro-F1",
    minimumAcceptableEvidence: "At least 3 folds",
    disallowedShortcuts: "- Do not cherry-pick datasets.",
    allowedBudgetedPasses: "One reranking pass",
    paperCeiling: "Cap at research_memo if weak",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// briefDesignConsistency
// ---------------------------------------------------------------------------
describe("checkBriefDesignConsistency", () => {
  it("returns no errors for fully consistent brief and design", () => {
    const result = checkBriefDesignConsistency({
      briefSections: makeBriefSections(),
      experimentContract: makeContract(),
      designBaselines: ["free_form_chat"],
      designMetrics: ["macro-F1", "runtime"]
    });
    const errors = result.warnings.filter((w) => w.severity === "error");
    expect(errors).toHaveLength(0);
    expect(result.paper_scale_blocked).toBe(false);
  });

  it("errors when no target comparison and no baselines", () => {
    const result = checkBriefDesignConsistency({
      briefSections: makeBriefSections({ targetComparison: undefined }),
      experimentContract: makeContract(),
      designBaselines: []
    });
    const errors = result.warnings.filter((w) => w.code === "MISSING_TARGET_COMPARISON" && w.severity === "error");
    expect(errors).toHaveLength(1);
    expect(result.paper_scale_blocked).toBe(true);
  });

  it("warns (not errors) when no target comparison but baselines exist in design", () => {
    const result = checkBriefDesignConsistency({
      briefSections: makeBriefSections({ targetComparison: undefined }),
      experimentContract: makeContract(),
      designBaselines: ["baseline_A"]
    });
    const warnings = result.warnings.filter((w) => w.code === "MISSING_TARGET_COMPARISON");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("warning");
    expect(result.paper_scale_blocked).toBe(false);
  });

  it("warns about missing evidence plan", () => {
    const result = checkBriefDesignConsistency({
      briefSections: makeBriefSections({ minimumAcceptableEvidence: undefined }),
      experimentContract: makeContract()
    });
    expect(result.warnings.some((w) => w.code === "MISSING_EVIDENCE_PLAN")).toBe(true);
  });

  it("warns about confounded design", () => {
    const contract = makeContract({
      confounded: true,
      additional_changes: ["Change B"]
    });
    const result = checkBriefDesignConsistency({
      briefSections: makeBriefSections(),
      experimentContract: contract
    });
    expect(result.warnings.some((w) => w.code === "CONFOUNDED_DESIGN")).toBe(true);
  });

  it("detects disallowed smoke test shortcut", () => {
    const contract = makeContract({
      single_change: "Run smoke test to validate pipeline"
    });
    const result = checkBriefDesignConsistency({
      briefSections: makeBriefSections({
        disallowedShortcuts: "- Do not use workflow smoke artifacts as experimental evidence."
      }),
      experimentContract: contract
    });
    expect(result.warnings.some((w) => w.code === "DISALLOWED_SHORTCUT_DETECTED")).toBe(true);
    expect(result.paper_scale_blocked).toBe(true);
  });

  it("handles gracefully when brief sections are undefined", () => {
    const result = checkBriefDesignConsistency({
      experimentContract: makeContract()
    });
    // Should still return valid result with warnings
    expect(result.generated_at).toBeDefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Enhanced confounding detection (Target 3)
// ---------------------------------------------------------------------------
describe("detectConfoundingHints", () => {
  it("returns empty for a clean single-change contract", () => {
    const contract = makeContract({
      single_change: "Replace free-form chat with shared_state_schema"
    });
    const hints = detectConfoundingHints(contract);
    expect(hints).toHaveLength(0);
  });

  it("detects conjunction-split confounding", () => {
    const contract = makeContract({
      single_change: "Add batch normalization and switch optimizer from SGD to Adam"
    });
    const hints = detectConfoundingHints(contract);
    expect(hints.length).toBeGreaterThanOrEqual(1);
    expect(hints[0]).toContain("conjunction-separated");
  });

  it("detects list-form confounding", () => {
    const contract = makeContract({
      single_change: "1. Add dropout layer\n2. Increase learning rate\n3. Switch to AdamW"
    });
    const hints = detectConfoundingHints(contract);
    expect(hints.some((h) => h.includes("list of multiple changes"))).toBe(true);
  });

  it("does not flag already-confounded contracts", () => {
    const contract = makeContract({
      confounded: true,
      single_change: "Add dropout and increase learning rate"
    });
    const hints = detectConfoundingHints(contract);
    expect(hints).toHaveLength(0);
  });

  it("does not false-positive on compound descriptions of one change", () => {
    // "X and its Y" is one conceptual change
    const contract = makeContract({
      single_change: "Replace the chat protocol and its message format with shared state schema"
    });
    const hints = detectConfoundingHints(contract);
    // This should ideally return empty or at most a mild warning
    // The key test is that it doesn't confuse rephrasing with multiple interventions
    // Due to shared tokens ("shared", "state", "schema", "protocol", "format"),
    // the overlap should prevent a false positive
    expect(hints.filter((h) => h.includes("distinct interventions"))).toHaveLength(0);
  });

  it("handles edge case of very short single_change", () => {
    const contract = makeContract({
      single_change: "Use Adam"
    });
    const hints = detectConfoundingHints(contract);
    expect(hints).toHaveLength(0);
  });
});
