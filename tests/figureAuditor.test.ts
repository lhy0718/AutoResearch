import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkCaptionConsistency,
  critiqueFiguresVision,
  lintFigures,
  runAllGates,
  type FigureAuditInput
} from "../src/core/analysis/figureAuditor.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function makeInput(setup?: {
  files?: Array<{ relativePath: string; content: string }>;
  tex?: string | null;
}): Promise<FigureAuditInput> {
  const root = await mkdtemp(path.join(tmpdir(), "autolabos-figure-auditor-"));
  const runDir = path.join(root, ".autolabos", "runs", "run-figure-auditor");
  const figureDir = path.join(runDir, "paper", "figures");
  await mkdir(figureDir, { recursive: true });
  await mkdir(path.join(runDir, "paper"), { recursive: true });
  if (setup?.files) {
    for (const file of setup.files) {
      const target = path.join(figureDir, file.relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
  }
  if (setup?.tex !== undefined) {
    await writeFile(path.join(runDir, "paper", "main.tex"), setup.tex || "", "utf8");
  }
  return {
    run_dir: runDir,
    figure_dir: null,
    paper_tex_content: setup?.tex ?? null,
    result_analysis_path: null
  };
}

describe("figureAuditor", () => {
  it("lintFigures emits a warning when no figure files exist", async () => {
    const input = await makeInput({ tex: null });
    const issues = await lintFigures(input);

    expect(issues.some((issue) => issue.issue_type === "figure_directory_empty")).toBe(true);
  });

  it("lintFigures warns on duplicate basenames across nested directories", async () => {
    const input = await makeInput({
      files: [
        { relativePath: "main/plot.svg", content: "<svg><text>a</text></svg>" },
        { relativePath: "appendix/plot.svg", content: "<svg><text>b</text></svg>" }
      ],
      tex: "\\includegraphics{figures/main/plot.svg}"
    });

    const issues = await lintFigures(input);

    expect(issues.some((issue) => issue.issue_type === "duplicate_figure_filename")).toBe(true);
  });

  it("checkCaptionConsistency marks TODO captions as severe", async () => {
    const tex = `
\\begin{figure}
\\includegraphics{figures/plot.svg}
\\caption{TODO}
\\end{figure}
`;
    const input = await makeInput({
      files: [{ relativePath: "plot.svg", content: "<svg><text>plot</text></svg>" }],
      tex
    });

    const issues = await checkCaptionConsistency(input);

    expect(issues.some((issue) => issue.issue_type === "figure_caption_incomplete" && issue.severity === "severe")).toBe(true);
  });

  it("checkCaptionConsistency marks dangling Figure references as severe", async () => {
    const tex = "As shown in Figure 1, the effect is clear.";
    const input = await makeInput({ tex });

    const issues = await checkCaptionConsistency(input);

    expect(issues.some((issue) => issue.issue_type === "dangling_figure_reference" && issue.severity === "severe")).toBe(true);
  });

  it("runAllGates sets review_block_required when severe issues exist", async () => {
    const tex = `
\\begin{figure}
\\includegraphics{figures/plot.svg}
\\caption{TODO}
\\end{figure}
`;
    const input = await makeInput({
      files: [{ relativePath: "plot.svg", content: "<svg><text>plot</text></svg>" }],
      tex
    });

    const summary = await runAllGates(input);

    expect(summary.review_block_required).toBe(true);
    expect(summary.severe_mismatch_count).toBeGreaterThan(0);
  });

  it("critiqueFiguresVision returns no issues when the vision gate is disabled", async () => {
    delete process.env.FIGURE_AUDITOR_VISION_ENABLED;
    const input = await makeInput({
      files: [{ relativePath: "plot.svg", content: "<svg><text>plot</text></svg>" }],
      tex: "\\includegraphics{figures/plot.svg}"
    });

    const issues = await critiqueFiguresVision(input, []);

    expect(issues).toEqual([]);
  });

  it("keeps empirical validity and publication readiness as per-issue fields", async () => {
    const tex = `
\\begin{figure}
\\includegraphics{figures/plot.svg}
\\caption{TODO}
\\end{figure}
`;
    const input = await makeInput({
      files: [{ relativePath: "plot.svg", content: "<svg><text>plot</text></svg>" }],
      tex
    });

    const summary = await runAllGates(input);
    const issue = summary.issues.find((item) => item.issue_type === "figure_caption_incomplete");

    expect(issue?.empirical_validity_impact).toBe("major");
    expect(issue?.publication_readiness).toBe("not_ready");
  });
});
