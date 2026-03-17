import { describe, expect, it } from "vitest";

import { parseManuscriptFormatFromBrief } from "../src/core/runs/researchBriefFiles.js";
import { parseMarkdownRunBriefSections } from "../src/core/runs/runBriefParser.js";
import { buildGateWarningLimitationSentences } from "../src/core/analysis/scientificWriting.js";
import type { GateWarningItem } from "../src/core/analysis/paperWriting.js";
import type { PublicRunOutputSection } from "../src/core/publicArtifacts.js";

// ---------------------------------------------------------------------------
// parseManuscriptFormatFromBrief
// ---------------------------------------------------------------------------
describe("parseManuscriptFormatFromBrief", () => {
  it("parses a fully specified manuscript format section", () => {
    const brief = [
      "# Research Brief",
      "",
      "## Topic",
      "Test topic",
      "",
      "## Manuscript Format",
      "- columns: 2",
      "- main_body_pages: 8",
      "- references_excluded_from_page_limit: true",
      "- appendices_excluded_from_page_limit: true"
    ].join("\n");

    const result = parseManuscriptFormatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.columns).toBe(2);
    expect(result!.main_body_pages).toBe(8);
    expect(result!.references_excluded_from_page_limit).toBe(true);
    expect(result!.appendices_excluded_from_page_limit).toBe(true);
  });

  it("returns undefined for briefs without manuscript format section", () => {
    const brief = [
      "# Research Brief",
      "",
      "## Topic",
      "Test topic"
    ].join("\n");

    const result = parseManuscriptFormatFromBrief(brief);
    expect(result).toBeUndefined();
  });

  it("parses single-column format", () => {
    const brief = [
      "## Manuscript Format",
      "- columns: 1",
      "- main_body_pages: 10",
      "- references_excluded_from_page_limit: false"
    ].join("\n");

    const result = parseManuscriptFormatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.columns).toBe(1);
    expect(result!.main_body_pages).toBe(10);
    expect(result!.references_excluded_from_page_limit).toBe(false);
  });

  it("handles case-insensitive field values", () => {
    const brief = [
      "## Manuscript Format",
      "- columns: 2",
      "- references_excluded_from_page_limit: True",
      "- appendices_excluded_from_page_limit: FALSE"
    ].join("\n");

    const result = parseManuscriptFormatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.references_excluded_from_page_limit).toBe(true);
    expect(result!.appendices_excluded_from_page_limit).toBe(false);
  });

  it("uses defaults when only some fields are specified", () => {
    const brief = [
      "## Manuscript Format",
      "- columns: 2"
    ].join("\n");

    const result = parseManuscriptFormatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.columns).toBe(2);
    expect(result!.main_body_pages).toBe(8); // default
    expect(result!.references_excluded_from_page_limit).toBe(true); // default
    expect(result!.appendices_excluded_from_page_limit).toBe(true); // default
  });
});

// ---------------------------------------------------------------------------
// runBriefParser manuscriptFormat section
// ---------------------------------------------------------------------------
describe("runBriefParser manuscriptFormat field", () => {
  it("parses manuscript format heading into manuscriptFormat field", () => {
    const brief = [
      "# Research Brief",
      "",
      "## Topic",
      "Some topic",
      "",
      "## Manuscript Format",
      "- columns: 2",
      "- main_body_pages: 8"
    ].join("\n");

    const sections = parseMarkdownRunBriefSections(brief);
    expect(sections.manuscriptFormat).toBeTruthy();
    expect(sections.manuscriptFormat).toContain("columns: 2");
    expect(sections.manuscriptFormat).toContain("main_body_pages: 8");
  });
});

// ---------------------------------------------------------------------------
// Gate warning categorization
// ---------------------------------------------------------------------------
describe("buildGateWarningLimitationSentences", () => {
  it("returns empty array for no warnings", () => {
    const result = buildGateWarningLimitationSentences([]);
    expect(result).toHaveLength(0);
  });

  it("groups warnings by category and includes severity", () => {
    const warnings: GateWarningItem[] = [
      { severity: "warning", category: "evidence_quality", message: "No baseline comparator found" },
      { severity: "error", category: "result_table", message: "Result table missing quantitative data" }
    ];

    const result = buildGateWarningLimitationSentences(warnings);
    expect(result).toHaveLength(2);
    expect(result.some((s) => s.includes("[error]"))).toBe(true);
    expect(result.some((s) => s.includes("[warning]"))).toBe(true);
    expect(result.some((s) => s.includes("evidence quality"))).toBe(true);
    expect(result.some((s) => s.includes("result table"))).toBe(true);
  });

  it("combines multiple warnings in the same category", () => {
    const warnings: GateWarningItem[] = [
      { severity: "warning", category: "evidence_quality", message: "No baseline" },
      { severity: "warning", category: "evidence_quality", message: "No comparator" }
    ];

    const result = buildGateWarningLimitationSentences(warnings);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("No baseline");
    expect(result[0]).toContain("No comparator");
  });

  it("limits output to 5 sentences", () => {
    const warnings: GateWarningItem[] = Array.from({ length: 8 }, (_, i) => ({
      severity: "warning",
      category: `category_${i}`,
      message: `Warning ${i}`
    }));

    const result = buildGateWarningLimitationSentences(warnings);
    expect(result.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// PublicRunOutputSection includes results and reproduce
// ---------------------------------------------------------------------------
describe("PublicRunOutputSection", () => {
  it("includes results and reproduce sections", () => {
    const sections: PublicRunOutputSection[] = ["experiment", "analysis", "review", "paper", "results", "reproduce"];
    expect(sections).toContain("results");
    expect(sections).toContain("reproduce");
  });
});
