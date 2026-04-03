import path from "node:path";
import { promises as fs } from "node:fs";

export type ParsedLatexTemplate = {
  sourcePath: string;
  preamble: string;
  documentClass: string;
  columnLayout: 1 | 2 | null;
  packages: string[];
  sectionOrder: string[];
  customCommands: string[];
  bibliographyStyle: string | null;
};

function normalizeLineEndings(value: string): string {
  return value.replace(/\r/g, "");
}

function removeCommandBlock(source: string, commandName: "title" | "author" | "date"): string {
  const marker = `\\${commandName}`;
  let cursor = 0;
  let result = "";

  while (cursor < source.length) {
    const start = source.indexOf(marker, cursor);
    if (start === -1) {
      result += source.slice(cursor);
      break;
    }

    result += source.slice(cursor, start);
    let scan = start + marker.length;
    while (scan < source.length && /\s/.test(source[scan])) {
      scan += 1;
    }

    while (scan < source.length && source[scan] === "[") {
      let depth = 1;
      scan += 1;
      while (scan < source.length && depth > 0) {
        if (source[scan] === "[") depth += 1;
        if (source[scan] === "]") depth -= 1;
        scan += 1;
      }
      while (scan < source.length && /\s/.test(source[scan])) {
        scan += 1;
      }
    }

    if (scan >= source.length || source[scan] !== "{") {
      result += marker;
      cursor = start + marker.length;
      continue;
    }

    let braceDepth = 1;
    scan += 1;
    while (scan < source.length && braceDepth > 0) {
      if (source[scan] === "{") braceDepth += 1;
      if (source[scan] === "}") braceDepth -= 1;
      scan += 1;
    }

    while (scan < source.length && /[ \t]/.test(source[scan])) {
      scan += 1;
    }
    if (source[scan] === "\n") {
      scan += 1;
    }
    cursor = scan;
  }

  return result;
}

function extractDocumentClass(raw: string): string {
  const match = raw.match(/^[ \t]*\\documentclass(?:\[[^\]]*\])?\{[^}]+\}[^\n]*$/m);
  return match?.[0]?.trim() ?? "";
}

function detectColumnLayout(documentClass: string): 1 | 2 | null {
  if (!documentClass) {
    return null;
  }
  const options = documentClass.match(/\\documentclass\[([^\]]+)\]/)?.[1] ?? "";
  if (/\btwocolumn\b/.test(options)) {
    return 2;
  }
  if (/\bonecolumn\b/.test(options)) {
    return 1;
  }
  return options ? null : 1;
}

function extractPackages(preamble: string): string[] {
  return Array.from(
    preamble.matchAll(/^[ \t]*\\usepackage(?:\[[^\]]*\])?\{[^}]+\}[^\n]*$/gm),
    (match) => match[0].trim()
  );
}

function extractSectionOrder(raw: string): string[] {
  const beginDocument = raw.match(/\\begin\{document\}/);
  const body = beginDocument ? raw.slice(beginDocument.index! + beginDocument[0].length) : raw;
  return Array.from(body.matchAll(/\\section(?:\[[^\]]*\])?\{([^}]*)\}/g), (match) => match[1].trim()).filter(Boolean);
}

function extractCustomCommands(preamble: string): string[] {
  return Array.from(
    preamble.matchAll(/^[ \t]*\\(?:newcommand|renewcommand|DeclareMathOperator)(?:\*?)\s*(?:\[[^\]]*\])?\s*(?:\{[^}]+\}|\\[A-Za-z@]+)[^\n]*$/gm),
    (match) => match[0].trim()
  );
}

function extractBibliographyStyle(raw: string): string | null {
  return raw.match(/\\bibliographystyle\{([^}]+)\}/)?.[1]?.trim() ?? null;
}

function extractPreamble(raw: string, documentClass: string): string {
  const beginDocument = raw.match(/\\begin\{document\}/);
  const boundary = beginDocument?.index ?? raw.length;
  const docClassIndex = documentClass ? raw.indexOf(documentClass) : -1;
  const start = docClassIndex >= 0 ? docClassIndex + documentClass.length : 0;
  let preamble = raw.slice(start, boundary);
  preamble = removeCommandBlock(preamble, "title");
  preamble = removeCommandBlock(preamble, "author");
  preamble = removeCommandBlock(preamble, "date");
  return preamble.trim();
}

export async function loadLatexTemplate(templatePath: string): Promise<ParsedLatexTemplate> {
  const sourcePath = path.resolve(templatePath);
  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error(`LaTeX template not found: ${templatePath}`);
  }

  const raw = normalizeLineEndings(await fs.readFile(sourcePath, "utf8"));
  const documentClass = extractDocumentClass(raw);
  const preamble = extractPreamble(raw, documentClass);

  return {
    sourcePath,
    preamble,
    documentClass,
    columnLayout: detectColumnLayout(documentClass),
    packages: extractPackages(preamble),
    sectionOrder: extractSectionOrder(raw),
    customCommands: extractCustomCommands(preamble),
    bibliographyStyle: extractBibliographyStyle(raw)
  };
}

function isInsideWorkspace(workspaceRoot: string, candidatePath: string): boolean {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(candidatePath);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

export async function resolveLatexTemplatePath(
  workspaceRoot: string,
  briefRelativePath: string | null | undefined
): Promise<string | null> {
  const root = path.resolve(workspaceRoot);

  if (briefRelativePath?.trim()) {
    const candidate = path.resolve(root, briefRelativePath.trim());
    if (!isInsideWorkspace(root, candidate)) {
      return null;
    }
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      return null;
    }
  }

  const defaultTemplate = path.join(root, "template.tex");
  try {
    await fs.access(defaultTemplate);
    return defaultTemplate;
  } catch {
    return null;
  }
}
