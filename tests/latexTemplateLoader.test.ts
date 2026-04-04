import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  deriveLatexTemplatePolicy,
  loadLatexTemplate,
  resolveLatexTemplatePath
} from "../src/core/latex/latexTemplateLoader.js";

describe("latexTemplateLoader", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  async function createWorkspace(): Promise<string> {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "autolabos-latex-template-"));
    workspaces.push(workspace);
    return workspace;
  }

  it("returns null when template.tex is missing", async () => {
    const workspace = await createWorkspace();

    await expect(resolveLatexTemplatePath(workspace, undefined)).resolves.toBeNull();
  });

  it("resolves workspaceRoot/template.tex when present", async () => {
    const workspace = await createWorkspace();
    const templatePath = path.join(workspace, "template.tex");
    await writeFile(templatePath, "\\documentclass{article}\n\\begin{document}\n\\end{document}\n", "utf8");

    await expect(resolveLatexTemplatePath(workspace, undefined)).resolves.toBe(templatePath);
  });

  it("resolves an existing briefRelativePath", async () => {
    const workspace = await createWorkspace();
    const templatesDir = path.join(workspace, "templates");
    await mkdir(templatesDir, { recursive: true });
    const templatePath = path.join(templatesDir, "submission.tex");
    await writeFile(templatePath, "\\documentclass{article}\n\\begin{document}\n\\end{document}\n", "utf8");

    await expect(resolveLatexTemplatePath(workspace, "templates/submission.tex")).resolves.toBe(templatePath);
  });

  it("returns null when briefRelativePath escapes the workspace root", async () => {
    const workspace = await createWorkspace();

    await expect(resolveLatexTemplatePath(workspace, "../outside.tex")).resolves.toBeNull();
  });

  it("loads a template and removes title, author, and date from the preamble", async () => {
    const workspace = await createWorkspace();
    const templatePath = path.join(workspace, "template.tex");
    await writeFile(
      templatePath,
      [
        "\\documentclass[twocolumn]{article}",
        "\\usepackage{graphicx}",
        "\\usepackage[sort&compress]{natbib}",
        "\\newcommand{\\vect}[1]{\\mathbf{#1}}",
        "\\title{",
        "A Multi-line Title",
        "}",
        "\\author{AutoLabOS}",
        "\\date{2026-04-03}",
        "\\begin{document}",
        "\\maketitle",
        "\\section{Introduction}",
        "\\section[Method Summary]{Method}",
        "\\bibliographystyle{plainnat}",
        "\\end{document}"
      ].join("\n"),
      "utf8"
    );

    const parsed = await loadLatexTemplate(templatePath);

    expect(parsed.sourcePath).toBe(templatePath);
    expect(parsed.documentClass).toBe("\\documentclass[twocolumn]{article}");
    expect(parsed.columnLayout).toBe(2);
    expect(parsed.preamble).toContain("\\usepackage{graphicx}");
    expect(parsed.preamble).not.toContain("\\title{");
    expect(parsed.preamble).not.toContain("\\author{");
    expect(parsed.preamble).not.toContain("\\date{");
    expect(parsed.packages).toEqual([
      "\\usepackage{graphicx}",
      "\\usepackage[sort&compress]{natbib}"
    ]);
    expect(parsed.customCommands).toEqual(["\\newcommand{\\vect}[1]{\\mathbf{#1}}"]);
    expect(parsed.sectionOrder).toEqual(["Introduction", "Method"]);
    expect(parsed.bibliographyStyle).toBe("plainnat");

    const policy = deriveLatexTemplatePolicy(parsed);
    expect(policy.appendixFormat).toBe("double_column");
    expect(policy.estimatedWordsPerPage).toBe(420);
  });

  it("derives layout policy from a recognizable two-column template class", async () => {
    const workspace = await createWorkspace();
    const templatePath = path.join(workspace, "templates", "neurips_2025.tex");
    await mkdir(path.dirname(templatePath), { recursive: true });
    await writeFile(
      templatePath,
      [
        "\\documentclass[final]{neurips_2025}",
        "\\begin{document}",
        "\\section{Introduction}",
        "\\end{document}"
      ].join("\n"),
      "utf8"
    );

    const parsed = await loadLatexTemplate(templatePath);
    const policy = deriveLatexTemplatePolicy(parsed);

    expect(policy.appendixFormat).toBe("double_column");
    expect(policy.estimatedWordsPerPage).toBe(420);
  });

  it("throws when the template file does not exist", async () => {
    const workspace = await createWorkspace();
    const templatePath = path.join(workspace, "missing.tex");

    await expect(loadLatexTemplate(templatePath)).rejects.toThrow(
      `LaTeX template not found: ${templatePath}`
    );
  });
});
