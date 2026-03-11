import path from "node:path";
import { promises as fs } from "node:fs";

import { ensureDir, fileExists } from "../../utils/fs.js";
import { ExtractedRunBrief, parseMarkdownRunBriefSections } from "./runBriefParser.js";

export const RESEARCH_BRIEF_DIR = ".autolabos/briefs";

export interface BriefValidationResult {
  errors: string[];
  warnings: string[];
}

export function buildResearchBriefTemplate(): string {
  return [
    "# Research Brief",
    "",
    "## Topic",
    "",
    "Describe the research question or capability you want to investigate.",
    "",
    "## Objective Metric",
    "",
    "State the primary success metric or threshold.",
    "",
    "## Constraints",
    "",
    "- List practical limits, required datasets, budgets, or tools here.",
    "",
    "## Plan",
    "",
    "Outline the experiment plan, baselines, ablations, and confirmatory runs.",
    "",
    "## Notes",
    "",
    "Optional context, references, or working assumptions.",
    "",
    "## Questions / Risks",
    "",
    "Optional open questions, blockers, or major risks."
  ].join("\n");
}

export async function createResearchBriefFile(workspaceRoot: string, seedTopic?: string): Promise<string> {
  const dirPath = path.join(workspaceRoot, RESEARCH_BRIEF_DIR);
  await ensureDir(dirPath);
  const baseName = `${timestampForFileName(new Date())}-${slugify(seedTopic || "research-brief")}`;
  let filePath = path.join(dirPath, `${baseName}.md`);
  let counter = 2;
  while (await fileExists(filePath)) {
    filePath = path.join(dirPath, `${baseName}-${counter}.md`);
    counter += 1;
  }
  await fs.writeFile(filePath, `${buildResearchBriefTemplate()}\n`, "utf8");
  return filePath;
}

export async function findLatestResearchBrief(workspaceRoot: string): Promise<string | undefined> {
  const dirPath = path.join(workspaceRoot, RESEARCH_BRIEF_DIR);
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const markdownFiles = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left));
    if (markdownFiles.length === 0) {
      return undefined;
    }
    return path.join(dirPath, markdownFiles[0]);
  } catch {
    return undefined;
  }
}

export function resolveResearchBriefPath(workspaceRoot: string, inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  if (!inputPath.includes("/") && !inputPath.includes("\\")) {
    return path.join(workspaceRoot, RESEARCH_BRIEF_DIR, inputPath);
  }
  const workspaceRelative = path.join(workspaceRoot, inputPath);
  if (inputPath.startsWith(".autolabos/") || inputPath.startsWith("briefs/")) {
    return workspaceRelative;
  }
  return path.join(workspaceRoot, inputPath);
}

export async function validateResearchBriefFile(filePath: string): Promise<BriefValidationResult> {
  const raw = await fs.readFile(filePath, "utf8");
  return validateResearchBriefMarkdown(raw);
}

export function validateResearchBriefMarkdown(markdown: string): BriefValidationResult {
  const sections = parseMarkdownRunBriefSections(markdown);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!sections?.title || sections.title.toLowerCase() !== "research brief") {
    warnings.push('Expected the document to start with "# Research Brief".');
  }
  if (!sections?.topic) {
    errors.push('Fill in the "## Topic" section before starting the run.');
  }
  if (!sections?.objectiveMetric) {
    errors.push('Fill in the "## Objective Metric" section before starting the run.');
  }
  if (!sections?.constraints) {
    warnings.push('The "## Constraints" section is empty. The run will continue without explicit constraints.');
  }
  if (!sections?.plan) {
    warnings.push('The "## Plan" section is empty. Consider adding experiment intent before starting.');
  }
  return { errors, warnings };
}

export async function snapshotResearchBriefToRun(workspaceRoot: string, runId: string, sourcePath: string): Promise<string> {
  const destinationPath = path.join(workspaceRoot, ".autolabos", "runs", runId, "brief", "source_brief.md");
  await ensureDir(path.dirname(destinationPath));
  await fs.copyFile(sourcePath, destinationPath);
  return destinationPath;
}

export function summarizeBriefValidation(
  validation: BriefValidationResult,
  extracted?: ExtractedRunBrief
): string[] {
  const lines: string[] = [];
  for (const error of validation.errors) {
    lines.push(`Error: ${error}`);
  }
  for (const warning of validation.warnings) {
    lines.push(`Warning: ${warning}`);
  }
  if (extracted?.topic) {
    lines.push(`Topic: ${extracted.topic}`);
  }
  if (extracted?.objectiveMetric) {
    lines.push(`Objective: ${extracted.objectiveMetric}`);
  }
  return lines;
}

function timestampForFileName(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  const second = String(value.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "research-brief";
}
