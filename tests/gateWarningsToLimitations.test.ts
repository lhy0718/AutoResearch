import { describe, it, expect } from "vitest";

import {
  buildGateWarningLimitationSentences,
  applyGateWarningsToLimitations
} from "../src/core/analysis/scientificWriting.js";
import type { GateWarningItem } from "../src/core/analysis/paperWriting.js";
import type { PaperDraft } from "../src/core/analysis/paperWriting.js";

function makeDraftWithLimitations(paragraphs: Array<{ text: string }>): PaperDraft {
  return {
    title: "Test Paper",
    sections: [
      {
        heading: "Introduction",
        paragraphs: [{ text: "Intro text.", evidence_ids: [], citation_paper_ids: [] }],
        evidence_ids: [],
        citation_paper_ids: []
      },
      {
        heading: "Limitations",
        paragraphs: paragraphs.map((p) => ({ ...p, evidence_ids: [], citation_paper_ids: [] })),
        evidence_ids: [],
        citation_paper_ids: []
      }
    ],
    claims: [],
    evidence_ids: [],
    citation_paper_ids: []
  };
}

describe("buildGateWarningLimitationSentences", () => {
  it("returns empty array when no warnings provided", () => {
    expect(buildGateWarningLimitationSentences([])).toEqual([]);
  });

  it("groups warnings by category and returns one sentence per category", () => {
    const warnings: GateWarningItem[] = [
      { severity: "warning", category: "method_completeness", message: "Missing hyperparameter details" },
      { severity: "warning", category: "method_completeness", message: "No ablation study" },
      { severity: "warning", category: "results_richness", message: "No confidence intervals reported" }
    ];
    const sentences = buildGateWarningLimitationSentences(warnings);
    expect(sentences).toHaveLength(2);
    expect(sentences[0]).toContain("method completeness");
    expect(sentences[0]).toContain("Missing hyperparameter details");
    expect(sentences[1]).toContain("results richness");
    expect(sentences[1]).toContain("No confidence intervals reported");
  });

  it("caps output at 5 sentences even with many categories", () => {
    const warnings: GateWarningItem[] = [
      { severity: "warning", category: "method_completeness", message: "msg1" },
      { severity: "warning", category: "results_richness", message: "msg2" },
      { severity: "warning", category: "discussion_richness", message: "msg3" },
      { severity: "warning", category: "consistency", message: "msg4" },
      { severity: "warning", category: "appendix", message: "msg5" },
      { severity: "warning", category: "page_budget", message: "msg6" },
      { severity: "warning", category: "evidence_quality", message: "msg7" }
    ];
    const sentences = buildGateWarningLimitationSentences(warnings);
    expect(sentences.length).toBeLessThanOrEqual(5);
  });

  it("uses 'general' label when category is empty", () => {
    const warnings: GateWarningItem[] = [
      { severity: "warning", category: "", message: "Unknown issue" }
    ];
    const sentences = buildGateWarningLimitationSentences(warnings);
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toContain("general");
  });

  it("skips warnings with undefined or empty message", () => {
    const warnings: GateWarningItem[] = [
      { severity: "warning", category: "method_completeness", message: undefined as unknown as string },
      { severity: "warning", category: "method_completeness", message: "Valid concern" },
      { severity: "warning", category: "results_richness", message: "" },
    ];
    const sentences = buildGateWarningLimitationSentences(warnings);
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toContain("Valid concern");
    expect(sentences[0]).not.toContain("undefined");
  });

  it("replaces underscores with spaces in category label", () => {
    const warnings: GateWarningItem[] = [
      { severity: "warning", category: "related_work_richness", message: "Sparse citations" }
    ];
    const sentences = buildGateWarningLimitationSentences(warnings);
    expect(sentences[0]).toContain("related work richness");
    expect(sentences[0]).not.toContain("_");
  });
});

describe("applyGateWarningsToLimitations", () => {
  it("returns draft unchanged when no warnings", () => {
    const draft = makeDraftWithLimitations([{ text: "Base limitation." }]);
    const result = applyGateWarningsToLimitations(draft, []);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[1].paragraphs).toHaveLength(1);
  });

  it("appends a gate-warning paragraph to the limitations section", () => {
    const draft = makeDraftWithLimitations([{ text: "Base limitation." }]);
    const warnings: GateWarningItem[] = [
      { severity: "warning", category: "consistency", message: "Metric mismatch between sections" }
    ];
    const result = applyGateWarningsToLimitations(draft, warnings);
    const limitationsSection = result.sections.find(
      (s) => s.heading.toLowerCase() === "limitations"
    )!;
    expect(limitationsSection.paragraphs).toHaveLength(2);
    expect(limitationsSection.paragraphs[1].text).toContain("consistency");
    expect(limitationsSection.paragraphs[1].text).toContain("Metric mismatch between sections");
  });

  it("does not modify non-limitations sections", () => {
    const draft = makeDraftWithLimitations([{ text: "Base limitation." }]);
    const warnings: GateWarningItem[] = [
      { severity: "warning", category: "method_completeness", message: "Missing info" }
    ];
    const result = applyGateWarningsToLimitations(draft, warnings);
    const introSection = result.sections.find(
      (s) => s.heading.toLowerCase() === "introduction"
    )!;
    expect(introSection.paragraphs).toHaveLength(1);
    expect(introSection.paragraphs[0].text).toBe("Intro text.");
  });

  it("does not mutate the original draft", () => {
    const draft = makeDraftWithLimitations([{ text: "Base limitation." }]);
    const originalParagraphCount = draft.sections[1].paragraphs.length;
    const warnings: GateWarningItem[] = [
      { severity: "warning", category: "page_budget", message: "Under page budget" }
    ];
    applyGateWarningsToLimitations(draft, warnings);
    expect(draft.sections[1].paragraphs).toHaveLength(originalParagraphCount);
  });

  it("handles draft with no limitations section gracefully", () => {
    const draft: PaperDraft = {
      title: "No Limits Paper",
      sections: [
        {
          heading: "Introduction",
          paragraphs: [{ text: "Intro.", evidence_ids: [], citation_paper_ids: [] }],
          evidence_ids: [],
          citation_paper_ids: []
        }
      ],
      claims: [],
      evidence_ids: [],
      citation_paper_ids: []
    };
    const warnings: GateWarningItem[] = [
      { severity: "warning", category: "consistency", message: "Some issue" }
    ];
    const result = applyGateWarningsToLimitations(draft, warnings);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].heading).toBe("Introduction");
  });
});
