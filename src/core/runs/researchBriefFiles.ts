import path from "node:path";
import { promises as fs } from "node:fs";

import { ensureDir, fileExists } from "../../utils/fs.js";
import { ExtractedRunBrief, MarkdownRunBriefSections, parseMarkdownRunBriefSections } from "./runBriefParser.js";

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
    "- List practical limits, required datasets, costs, or tools here.",
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
  if (!sections?.targetComparison) {
    warnings.push('The "## Target Comparison" section is missing. Paper-scale claims require an explicit comparison.');
  }
  if (!sections?.minimumAcceptableEvidence) {
    warnings.push('The "## Minimum Acceptable Evidence" section is missing. Review will apply default thresholds.');
  }
  if (!sections?.disallowedShortcuts) {
    warnings.push('The "## Disallowed Shortcuts" section is missing. No shortcut guardrails will be enforced.');
  }
  if (!sections?.allowedBudgetedPasses) {
    warnings.push('The "## Allowed Budgeted Passes" section is missing. Budget enforcement will use defaults.');
  }
  if (!sections?.paperCeiling) {
    warnings.push('The "## Paper Ceiling If Evidence Remains Weak" section is missing. Claim ceiling will be inferred at review time.');
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Brief completeness artifact
// ---------------------------------------------------------------------------

export type BriefCompletenessGrade = "complete" | "partial" | "minimal";

export interface BriefSectionStatus {
  present: boolean;
  substantive: boolean;
}

export interface BriefCompletenessArtifact {
  generated_at: string;
  grade: BriefCompletenessGrade;
  sections: {
    topic: BriefSectionStatus;
    objectiveMetric: BriefSectionStatus;
    constraints: BriefSectionStatus;
    plan: BriefSectionStatus;
    targetComparison: BriefSectionStatus;
    minimumAcceptableEvidence: BriefSectionStatus;
    disallowedShortcuts: BriefSectionStatus;
    allowedBudgetedPasses: BriefSectionStatus;
    paperCeiling: BriefSectionStatus;
  };
  missing_sections: string[];
  paper_scale_ready: boolean;
}

function sectionStatus(content: string | undefined): BriefSectionStatus {
  if (!content) return { present: false, substantive: false };
  const trimmed = content.trim();
  if (!trimmed) return { present: false, substantive: false };
  // A section is substantive if it has at least 10 characters of non-boilerplate content
  const stripped = trimmed
    .replace(/\(not specified\)/gi, "")
    .replace(/TBD/gi, "")
    .replace(/TODO/gi, "")
    .replace(/N\/A/gi, "")
    .trim();
  return { present: true, substantive: stripped.length >= 10 };
}

export function buildBriefCompletenessArtifact(markdown: string): BriefCompletenessArtifact {
  const sections = parseMarkdownRunBriefSections(markdown);

  const sectionMap = {
    topic: sectionStatus(sections?.topic),
    objectiveMetric: sectionStatus(sections?.objectiveMetric),
    constraints: sectionStatus(sections?.constraints),
    plan: sectionStatus(sections?.plan),
    targetComparison: sectionStatus(sections?.targetComparison),
    minimumAcceptableEvidence: sectionStatus(sections?.minimumAcceptableEvidence),
    disallowedShortcuts: sectionStatus(sections?.disallowedShortcuts),
    allowedBudgetedPasses: sectionStatus(sections?.allowedBudgetedPasses),
    paperCeiling: sectionStatus(sections?.paperCeiling)
  };

  const SECTION_LABELS: Record<string, string> = {
    topic: "Topic",
    objectiveMetric: "Objective Metric",
    constraints: "Constraints",
    plan: "Plan",
    targetComparison: "Target Comparison",
    minimumAcceptableEvidence: "Minimum Acceptable Evidence",
    disallowedShortcuts: "Disallowed Shortcuts",
    allowedBudgetedPasses: "Allowed Budgeted Passes",
    paperCeiling: "Paper Ceiling If Evidence Remains Weak"
  };

  const missing: string[] = [];
  for (const [key, status] of Object.entries(sectionMap)) {
    if (!status.present) {
      missing.push(SECTION_LABELS[key] ?? key);
    }
  }

  const coreSections = [sectionMap.topic, sectionMap.objectiveMetric];
  const extendedSections = [
    sectionMap.targetComparison,
    sectionMap.minimumAcceptableEvidence,
    sectionMap.disallowedShortcuts,
    sectionMap.allowedBudgetedPasses,
    sectionMap.paperCeiling
  ];

  const coreComplete = coreSections.every((s) => s.present && s.substantive);
  const extendedPresent = extendedSections.filter((s) => s.present).length;
  const extendedSubstantive = extendedSections.filter((s) => s.substantive).length;

  let grade: BriefCompletenessGrade;
  if (coreComplete && extendedSubstantive >= 4) {
    grade = "complete";
  } else if (coreComplete && extendedPresent >= 2) {
    grade = "partial";
  } else {
    grade = "minimal";
  }

  return {
    generated_at: new Date().toISOString(),
    grade,
    sections: sectionMap,
    missing_sections: missing,
    paper_scale_ready: grade === "complete"
  };
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
