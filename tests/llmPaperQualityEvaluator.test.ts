import { describe, it, expect } from "vitest";
import {
  enforceMinimumGateOverride,
  buildFallbackEvaluation,
  type LLMEvaluatorInput
} from "../src/core/analysis/llmPaperQualityEvaluator.js";
import type { MinimumGateResult } from "../src/core/analysis/paperMinimumGate.js";
import type { ReviewArtifactPresence } from "../src/core/reviewSystem.js";
import type { AnalysisReport } from "../src/core/resultAnalysis.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGate(overrides: Partial<MinimumGateResult> = {}): MinimumGateResult {
  return {
    passed: true,
    evaluated_at: new Date().toISOString(),
    checks: [],
    blockers: [],
    failed_checks: [],
    ceiling_type: "unrestricted",
    summary: "All checks passed.",
    ...overrides
  };
}

function fullPresence(): ReviewArtifactPresence {
  return {
    corpusPresent: true,
    paperSummariesPresent: true,
    evidenceStorePresent: true,
    hypothesesPresent: true,
    experimentPlanPresent: true,
    metricsPresent: true,
    figurePresent: true,
    synthesisPresent: true,
    baselineSummaryPresent: true,
    resultTablePresent: true,
    richnessSummaryPresent: true,
    richnessReadiness: true
  };
}

function makeFallbackInput(overrides: Partial<LLMEvaluatorInput> = {}): LLMEvaluatorInput {
  return {
    topic: "Test Topic",
    objectiveMetric: "accuracy",
    hypothesis: "Our method improves accuracy",
    report: undefined,
    presence: fullPresence(),
    minimumGate: makeGate(),
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// enforceMinimumGateOverride tests
// ---------------------------------------------------------------------------

describe("enforceMinimumGateOverride", () => {
  it("passes through LLM judgments when gate is passed", () => {
    const raw = {
      paper_worthiness: "paper_ready",
      overall_score_1_to_10: 8,
      recommended_action: "advance_to_draft"
    };
    const gate = makeGate({ passed: true, ceiling_type: "unrestricted" });

    const result = enforceMinimumGateOverride(raw, gate);

    expect(result.paper_worthiness).toBe("paper_ready");
    expect(result.overall_score).toBe(8);
    expect(result.recommended_action).toBe("advance_to_draft");
  });

  it("caps worthiness to not_ready when gate blocked_for_paper_scale", () => {
    const raw = {
      paper_worthiness: "paper_ready",
      overall_score_1_to_10: 9,
      recommended_action: "advance_to_draft"
    };
    const gate = makeGate({
      passed: false,
      ceiling_type: "blocked_for_paper_scale",
      blockers: ["No baseline"]
    });

    const result = enforceMinimumGateOverride(raw, gate);

    expect(result.paper_worthiness).toBe("not_ready");
    expect(result.overall_score).toBeLessThanOrEqual(3);
    expect(result.recommended_action).not.toBe("advance_to_draft");
  });

  it("caps worthiness to not_ready when gate system_validation_note", () => {
    const raw = {
      paper_worthiness: "paper_scale_candidate",
      overall_score_1_to_10: 7,
      recommended_action: "advance_to_draft"
    };
    const gate = makeGate({
      passed: false,
      ceiling_type: "system_validation_note",
      blockers: ["No experiment plan"]
    });

    const result = enforceMinimumGateOverride(raw, gate);

    expect(result.paper_worthiness).toBe("not_ready");
    expect(result.overall_score).toBeLessThanOrEqual(3);
    expect(result.recommended_action).toBe("consolidate_evidence");
  });

  it("caps worthiness to research_memo when gate is research_memo ceiling", () => {
    const raw = {
      paper_worthiness: "paper_ready",
      overall_score_1_to_10: 8,
      recommended_action: "advance_to_draft"
    };
    const gate = makeGate({
      passed: false,
      ceiling_type: "research_memo",
      blockers: ["No result table"]
    });

    const result = enforceMinimumGateOverride(raw, gate);

    expect(result.paper_worthiness).toBe("research_memo");
    expect(result.overall_score).toBeLessThanOrEqual(5);
    expect(result.recommended_action).toBe("consolidate_evidence");
  });

  it("allows research_memo through when ceiling is research_memo", () => {
    const raw = {
      paper_worthiness: "research_memo",
      overall_score_1_to_10: 4,
      recommended_action: "consolidate_evidence"
    };
    const gate = makeGate({
      passed: false,
      ceiling_type: "research_memo",
      blockers: ["No result table"]
    });

    const result = enforceMinimumGateOverride(raw, gate);

    expect(result.paper_worthiness).toBe("research_memo");
    expect(result.overall_score).toBe(4);
    expect(result.recommended_action).toBe("consolidate_evidence");
  });

  it("handles missing/invalid paper_worthiness from LLM", () => {
    const raw = {
      paper_worthiness: "super_awesome_paper",
      overall_score_1_to_10: 11,
      recommended_action: "do_nothing"
    };
    const gate = makeGate({ passed: true });

    const result = enforceMinimumGateOverride(raw, gate);

    // Invalid worthiness defaults to not_ready
    expect(result.paper_worthiness).toBe("not_ready");
    // Invalid action defaults to consolidate_evidence
    expect(result.recommended_action).toBe("consolidate_evidence");
  });
});

// ---------------------------------------------------------------------------
// buildFallbackEvaluation tests
// ---------------------------------------------------------------------------

describe("buildFallbackEvaluation", () => {
  it("produces a valid evaluation when gate passed", () => {
    const input = makeFallbackInput();
    const result = buildFallbackEvaluation(input);

    expect(result.llm_evaluated).toBe(false);
    expect(result.minimum_gate_passed).toBe(true);
    expect(result.paper_worthiness).toBe("paper_scale_candidate");
    expect(result.overall_score_1_to_10).toBeGreaterThanOrEqual(3);
    expect(result.dimensions).toHaveLength(7);
    expect(result.evidence_gaps).toHaveLength(0);
  });

  it("produces not_ready when gate blocked", () => {
    const input = makeFallbackInput({
      minimumGate: makeGate({
        passed: false,
        ceiling_type: "blocked_for_paper_scale",
        blockers: ["No baseline", "No metrics"],
        summary: "2 checks failed"
      }),
      presence: {
        ...fullPresence(),
        metricsPresent: false,
        baselineSummaryPresent: false
      }
    });

    const result = buildFallbackEvaluation(input);

    expect(result.llm_evaluated).toBe(false);
    expect(result.minimum_gate_passed).toBe(false);
    expect(result.paper_worthiness).toBe("not_ready");
    expect(result.overall_score_1_to_10).toBeLessThanOrEqual(3);
    expect(result.evidence_gaps.length).toBeGreaterThan(0);
    expect(result.recommended_action).toBe("backtrack_to_experiments");
  });

  it("includes ISO timestamp", () => {
    const result = buildFallbackEvaluation(makeFallbackInput());
    expect(result.evaluated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("includes 7 dimensions even without LLM", () => {
    const result = buildFallbackEvaluation(makeFallbackInput());
    const dims = result.dimensions.map(d => d.dimension);
    expect(dims).toContain("result_significance");
    expect(dims).toContain("methodology_rigor");
    expect(dims).toContain("evidence_strength");
    expect(dims).toContain("writing_structure");
    expect(dims).toContain("claim_support");
    expect(dims).toContain("citation_coverage");
    expect(dims).toContain("limitations_honesty");
  });

  it("gives research_memo when gate passed but no baseline", () => {
    const input = makeFallbackInput({
      presence: { ...fullPresence(), baselineSummaryPresent: false }
    });

    const result = buildFallbackEvaluation(input);
    expect(result.paper_worthiness).toBe("research_memo");
  });
});
