import { describe, expect, it } from "vitest";

import {
  parseManuscriptFormatFromBrief,
  parseManuscriptTemplateFromBrief
} from "../src/core/runs/researchBriefFiles.js";
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

describe("parseManuscriptTemplateFromBrief", () => {
  it("extracts a template.tex path", () => {
    const brief = [
      "# Research Brief",
      "",
      "## Manuscript Template",
      "template.tex"
    ].join("\n");

    expect(parseManuscriptTemplateFromBrief(brief)).toBe("template.tex");
  });

  it("returns undefined when the section is absent", () => {
    const brief = [
      "# Research Brief",
      "",
      "## Topic",
      "Test topic"
    ].join("\n");

    expect(parseManuscriptTemplateFromBrief(brief)).toBeUndefined();
  });

  it("returns undefined for paths with disallowed characters", () => {
    const brief = [
      "# Research Brief",
      "",
      "## Manuscript Template",
      "templates/$bad.tex"
    ].join("\n");

    expect(parseManuscriptTemplateFromBrief(brief)).toBeUndefined();
  });
});

describe("runBriefParser manuscriptTemplate field", () => {
  it("parses manuscript template heading into manuscriptTemplate field", () => {
    const brief = [
      "# Research Brief",
      "",
      "## Topic",
      "Some topic",
      "",
      "## Manuscript Template",
      "templates/submission.tex"
    ].join("\n");

    const sections = parseMarkdownRunBriefSections(brief);
    expect(sections.manuscriptTemplate).toBe("templates/submission.tex");
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

// ---------------------------------------------------------------------------
// renderSubmissionPaperTex column_count
// ---------------------------------------------------------------------------
import { renderSubmissionPaperTex } from "../src/core/analysis/paperManuscript.js";
import type { PaperManuscript, PaperTraceabilityReport } from "../src/core/analysis/paperWriting.js";
import type { ParsedLatexTemplate } from "../src/core/latex/latexTemplateLoader.js";

function makeMinimalManuscript(): PaperManuscript {
  return {
    title: "Test Paper",
    abstract: "An abstract.",
    keywords: ["test"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["This is the introduction."]
      },
      {
        heading: "Conclusion",
        paragraphs: ["This is the conclusion."]
      }
    ],
    visuals: [],
    appendices: []
  };
}

function makeMinimalTraceability(): PaperTraceabilityReport {
  return {
    paragraphs: [],
    sections: [],
    unmapped_evidence_ids: [],
    unmapped_citation_paper_ids: [],
    total_paragraph_count: 2,
    mapped_paragraph_count: 0
  };
}

describe("renderSubmissionPaperTex column_count", () => {
  it("renders twocolumn documentclass when column_count is 2", () => {
    const tex = renderSubmissionPaperTex({
      manuscript: makeMinimalManuscript(),
      traceability: makeMinimalTraceability(),
      citationKeysByPaperId: new Map(),
      paperProfile: { column_count: 2 } as any
    });
    expect(tex).toContain("\\documentclass[twocolumn]{article}");
    expect(tex).toContain("margin=0.75in");
  });

  it("renders single-column documentclass when column_count is 1", () => {
    const tex = renderSubmissionPaperTex({
      manuscript: makeMinimalManuscript(),
      traceability: makeMinimalTraceability(),
      citationKeysByPaperId: new Map(),
      paperProfile: { column_count: 1 } as any
    });
    expect(tex).toContain("\\documentclass{article}");
    expect(tex).not.toContain("twocolumn");
    expect(tex).toContain("margin=1in");
  });

  it("defaults to twocolumn when no paperProfile is provided", () => {
    const tex = renderSubmissionPaperTex({
      manuscript: makeMinimalManuscript(),
      traceability: makeMinimalTraceability(),
      citationKeysByPaperId: new Map()
    });
    expect(tex).toContain("\\documentclass[twocolumn]{article}");
  });

  it("produces valid TeX structure", () => {
    const tex = renderSubmissionPaperTex({
      manuscript: makeMinimalManuscript(),
      traceability: makeMinimalTraceability(),
      citationKeysByPaperId: new Map(),
      paperProfile: { column_count: 2 } as any
    });
    expect(tex).toContain("\\begin{document}");
    expect(tex).toContain("\\end{document}");
    expect(tex).toContain("\\begin{abstract}");
    expect(tex).toContain("\\end{abstract}");
    expect(tex).toContain("\\maketitle");
    expect(tex).toContain("\\section{Introduction}");
    expect(tex).toContain("\\section{Conclusion}");
  });

  it("uses a parsed LaTeX template preamble when provided", () => {
    const parsedTemplate: ParsedLatexTemplate = {
      sourcePath: "/tmp/template.tex",
      documentClass: "\\documentclass[twocolumn]{article}",
      preamble: [
        "\\usepackage{amsmath}",
        "\\newcommand{\\eg}{\\textit{e.g.,}}"
      ].join("\n"),
      columnLayout: 2,
      packages: ["\\usepackage{amsmath}"],
      sectionOrder: ["Introduction", "Method", "Results"],
      customCommands: ["\\newcommand{\\eg}{\\textit{e.g.,}}"],
      bibliographyStyle: null
    };

    const tex = renderSubmissionPaperTex({
      manuscript: makeMinimalManuscript(),
      traceability: makeMinimalTraceability(),
      citationKeysByPaperId: new Map(),
      paperProfile: { column_count: 1 } as any,
      parsedTemplate
    });

    expect(tex).toContain("\\documentclass[twocolumn]{article}");
    expect(tex).toContain("\\usepackage{amsmath}");
    expect(tex).toContain("\\newcommand{\\eg}{\\textit{e.g.,}}");
    expect(tex).not.toContain("\\usepackage[margin=0.75in]{geometry}");
    expect(tex).not.toContain("\\usepackage[margin=1in]{geometry}");
  });
});

// ---------------------------------------------------------------------------
// End-to-end TeX→PDF compilation
// ---------------------------------------------------------------------------
import { execSync } from "child_process";
import { writeFileSync, existsSync, mkdirSync, statSync, rmSync } from "fs";
import path from "path";
import os from "os";

describe("TeX→PDF compilation (real pdflatex)", () => {
  const hasPdflatex = (() => {
    try {
      execSync("pdflatex --version", { stdio: "pipe" });
      return true;
    } catch { return false; }
  })();

  it.skipIf(!hasPdflatex)("compiles twocolumn TeX to PDF successfully", () => {
    const tex = renderSubmissionPaperTex({
      manuscript: makeMinimalManuscript(),
      traceability: makeMinimalTraceability(),
      citationKeysByPaperId: new Map(),
      paperProfile: { column_count: 2 } as any
    });

    const tmpDir = path.join(os.tmpdir(), `autolabos-tex-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      writeFileSync(path.join(tmpDir, "main.tex"), tex);
      // Create empty references.bib so \bibliography doesn't fail
      writeFileSync(path.join(tmpDir, "references.bib"), "");

      execSync(
        "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
        { cwd: tmpDir, stdio: "pipe", timeout: 30000 }
      );

      const pdfPath = path.join(tmpDir, "main.pdf");
      expect(existsSync(pdfPath)).toBe(true);
      const pdfSize = statSync(pdfPath).size;
      expect(pdfSize).toBeGreaterThan(1000); // real PDF, not stub
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasPdflatex)("compiles single-column TeX to PDF successfully", () => {
    const tex = renderSubmissionPaperTex({
      manuscript: makeMinimalManuscript(),
      traceability: makeMinimalTraceability(),
      citationKeysByPaperId: new Map(),
      paperProfile: { column_count: 1 } as any
    });

    const tmpDir = path.join(os.tmpdir(), `autolabos-tex-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      writeFileSync(path.join(tmpDir, "main.tex"), tex);
      writeFileSync(path.join(tmpDir, "references.bib"), "");

      execSync(
        "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
        { cwd: tmpDir, stdio: "pipe", timeout: 30000 }
      );

      const pdfPath = path.join(tmpDir, "main.pdf");
      expect(existsSync(pdfPath)).toBe(true);
      expect(statSync(pdfPath).size).toBeGreaterThan(1000);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
