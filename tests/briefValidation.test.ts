import { describe, expect, it } from "vitest";

import {
  validateResearchBriefMarkdown,
  buildBriefCompletenessArtifact,
  type BriefCompletenessArtifact
} from "../src/core/runs/researchBriefFiles.js";
import { parseMarkdownRunBriefSections } from "../src/core/runs/runBriefParser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fullBrief(): string {
  return [
    "# Research Brief",
    "",
    "## Topic",
    "Improve calibration or macro-F1 on small tabular classification tasks.",
    "",
    "## Objective Metric",
    "Primary metric: macro-F1. Meaningful improvement: at least +0.5 macro-F1 points.",
    "",
    "## Constraints",
    "- Keep experiments runnable on a local laptop.",
    "- Prefer public datasets.",
    "",
    "## Plan",
    "1. Collect papers. 2. Form hypothesis. 3. Run experiment.",
    "",
    "## Target Comparison",
    "- Proposed: shared_state_schema condition",
    "- Comparator: free_form_chat baseline",
    "- Dimension: macro-F1",
    "- Expected: +0.5 macro-F1 over baseline",
    "",
    "## Minimum Acceptable Evidence",
    "- At least 3 outer folds with consistent direction",
    "- At least +0.3 macro-F1 improvement to claim meaningful gain",
    "",
    "## Disallowed Shortcuts",
    "- Do not use workflow smoke artifacts as experimental evidence.",
    "- Do not cherry-pick a single favorable dataset.",
    "",
    "## Allowed Budgeted Passes",
    "- One optional second-stage judging/reranking pass using a stronger model.",
    "",
    "## Paper Ceiling If Evidence Remains Weak",
    "If macro-F1 improvement is below +0.3, cap output at research_memo."
  ].join("\n");
}

function minimalBrief(): string {
  return [
    "# Research Brief",
    "",
    "## Topic",
    "Some research topic here.",
    "",
    "## Objective Metric",
    "macro-F1"
  ].join("\n");
}

function malformedBrief(): string {
  return "This is just plain text with no headings at all.";
}

// ---------------------------------------------------------------------------
// Brief validation
// ---------------------------------------------------------------------------
describe("validateResearchBriefMarkdown", () => {
  it("validates a full brief with no errors", () => {
    const result = validateResearchBriefMarkdown(fullBrief());
    expect(result.errors).toHaveLength(0);
    // All sections present, no section-missing warnings
    const sectionWarnings = result.warnings.filter((w) => w.includes("missing"));
    expect(sectionWarnings).toHaveLength(0);
  });

  it("produces warnings for minimal brief missing new sections", () => {
    const result = validateResearchBriefMarkdown(minimalBrief());
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("Target Comparison"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("Minimum Acceptable Evidence"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("Disallowed Shortcuts"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("Allowed Budgeted Passes"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("Paper Ceiling"))).toBe(true);
  });

  it("produces errors for malformed brief", () => {
    const result = validateResearchBriefMarkdown(malformedBrief());
    expect(result.errors.length).toBeGreaterThanOrEqual(2); // missing Topic + Objective Metric
  });

  it("accepts heading variations", () => {
    const brief = [
      "# Research Brief",
      "",
      "## Topic",
      "A topic.",
      "",
      "## Objective",
      "macro-F1",
      "",
      "## Forbidden Shortcuts",
      "- No cherry-picking.",
      "",
      "## Paper Ceiling",
      "Cap at research_memo.",
      "",
      "## Minimum Evidence",
      "3 folds minimum.",
      "",
      "## Budgeted Passes",
      "One reranking pass.",
      "",
      "## Comparison",
      "Baseline vs proposed."
    ].join("\n");

    const result = validateResearchBriefMarkdown(brief);
    expect(result.errors).toHaveLength(0);
    // Should NOT warn for sections that are present under variant headings
    expect(result.warnings.some((w) => w.includes("Target Comparison") && w.includes("missing"))).toBe(false);
    expect(result.warnings.some((w) => w.includes("Disallowed Shortcuts") && w.includes("missing"))).toBe(false);
    expect(result.warnings.some((w) => w.includes("Paper Ceiling") && w.includes("missing"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseMarkdownRunBriefSections — new fields
// ---------------------------------------------------------------------------
describe("parseMarkdownRunBriefSections — new fields", () => {
  it("parses all new sections from full brief", () => {
    const sections = parseMarkdownRunBriefSections(fullBrief());
    expect(sections).toBeDefined();
    expect(sections!.targetComparison).toContain("shared_state_schema");
    expect(sections!.minimumAcceptableEvidence).toContain("3 outer folds");
    expect(sections!.disallowedShortcuts).toContain("cherry-pick");
    expect(sections!.allowedBudgetedPasses).toContain("reranking");
    expect(sections!.paperCeiling).toContain("research_memo");
  });

  it("returns undefined for missing new sections in minimal brief", () => {
    const sections = parseMarkdownRunBriefSections(minimalBrief());
    expect(sections).toBeDefined();
    expect(sections!.targetComparison).toBeUndefined();
    expect(sections!.minimumAcceptableEvidence).toBeUndefined();
    expect(sections!.disallowedShortcuts).toBeUndefined();
    expect(sections!.allowedBudgetedPasses).toBeUndefined();
    expect(sections!.paperCeiling).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Brief completeness artifact
// ---------------------------------------------------------------------------
describe("buildBriefCompletenessArtifact", () => {
  it("grades a complete brief as 'complete'", () => {
    const artifact = buildBriefCompletenessArtifact(fullBrief());
    expect(artifact.grade).toBe("complete");
    expect(artifact.paper_scale_ready).toBe(true);
    expect(artifact.missing_sections).toHaveLength(0);
    expect(artifact.sections.topic.present).toBe(true);
    expect(artifact.sections.topic.substantive).toBe(true);
    expect(artifact.sections.targetComparison.present).toBe(true);
  });

  it("grades a minimal brief as 'minimal'", () => {
    const artifact = buildBriefCompletenessArtifact(minimalBrief());
    expect(artifact.grade).toBe("minimal");
    expect(artifact.paper_scale_ready).toBe(false);
    expect(artifact.missing_sections.length).toBeGreaterThanOrEqual(3);
  });

  it("grades a partial brief correctly", () => {
    const partial = [
      "# Research Brief",
      "",
      "## Topic",
      "Calibration on tabular tasks.",
      "",
      "## Objective Metric",
      "macro-F1 improvement.",
      "",
      "## Target Comparison",
      "Proposed vs baseline on macro-F1.",
      "",
      "## Minimum Acceptable Evidence",
      "At least 3 folds."
    ].join("\n");

    const artifact = buildBriefCompletenessArtifact(partial);
    expect(artifact.grade).toBe("partial");
    expect(artifact.paper_scale_ready).toBe(false);
    expect(artifact.sections.targetComparison.present).toBe(true);
    expect(artifact.sections.targetComparison.substantive).toBe(true);
    expect(artifact.sections.disallowedShortcuts.present).toBe(false);
  });

  it("treats boilerplate content as non-substantive", () => {
    const boilerplate = [
      "# Research Brief",
      "",
      "## Topic",
      "TBD",
      "",
      "## Objective Metric",
      "(not specified)"
    ].join("\n");

    const artifact = buildBriefCompletenessArtifact(boilerplate);
    expect(artifact.sections.topic.present).toBe(true);
    expect(artifact.sections.topic.substantive).toBe(false);
    expect(artifact.sections.objectiveMetric.present).toBe(true);
    expect(artifact.sections.objectiveMetric.substantive).toBe(false);
    expect(artifact.grade).toBe("minimal");
  });

  it("handles malformed input gracefully", () => {
    const artifact = buildBriefCompletenessArtifact(malformedBrief());
    expect(artifact.grade).toBe("minimal");
    expect(artifact.paper_scale_ready).toBe(false);
    expect(artifact.missing_sections.length).toBeGreaterThanOrEqual(5);
  });
});
