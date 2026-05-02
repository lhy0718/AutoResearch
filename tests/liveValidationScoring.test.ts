import { describe, expect, it } from "vitest";

import { scoreLiveValidationCase, scoreLiveValidationCases } from "../src/core/benchmark/liveValidationScoring.js";

describe("live validation scoring", () => {
  it("requires one dominant live-validation failure class", () => {
    const score = scoreLiveValidationCase({
      case_id: "LV-001",
      reproduced: true,
      regression_rechecked: true,
      dominant_failure_class: "resume_reload_bug"
    });

    expect(score.taxonomy_valid).toBe(true);
    expect(score.issues).toEqual([]);
  });

  it("separates syntax success from metric evidence for execution-bound cases", () => {
    const score = scoreLiveValidationCase({
      case_id: "AGB-009",
      reproduced: true,
      regression_rechecked: false,
      dominant_failure_class: "persisted_state_bug",
      syntax_success: true,
      metric_evidence_present: false
    });

    expect(score.syntax_only_success).toBe(true);
    expect(score.metric_evidence_present).toBe(false);
    expect(score.issues).toContain("syntax_success_without_metric_evidence");
  });

  it("preserves deterministic fallback labels while excluding them from paper-scale evidence", () => {
    const score = scoreLiveValidationCase({
      case_id: "AGB-010",
      reproduced: true,
      regression_rechecked: true,
      dominant_failure_class: "refresh_render_bug",
      deterministic_fallback_used: true,
      fallback_label: "deterministic_fallback",
      metric_evidence_present: false
    });

    expect(score.fallback_label_preserved).toBe(true);
    expect(score.deterministic_fallback_excluded_from_paper_scale).toBe(true);
    expect(score.issues).toContain("deterministic_fallback_excluded_from_paper_scale");
  });

  it("summarizes taxonomy coverage and regression recheck rate", () => {
    const summary = scoreLiveValidationCases([
      {
        case_id: "LV-001",
        reproduced: true,
        regression_rechecked: true,
        dominant_failure_class: "race_timing_bug"
      },
      {
        case_id: "LV-002",
        reproduced: true,
        regression_rechecked: false,
        dominant_failure_class: "unknown"
      }
    ]);

    expect(summary.measured_case_count).toBe(2);
    expect(summary.taxonomy_coverage).toBe(0.5);
    expect(summary.regression_recheck_rate).toBe(0.5);
  });
});
