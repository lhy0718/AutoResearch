import path from "node:path";
import { promises as fs } from "node:fs";

import { ensureDir, fileExists } from "../../utils/fs.js";
import { ExtractedRunBrief, MarkdownRunBriefSections, parseMarkdownRunBriefSections } from "./runBriefParser.js";
import type { ManuscriptFormatTarget } from "../../types.js";

export const RESEARCH_BRIEF_DIR = ".autolabos/briefs";
export const WORKSPACE_RESEARCH_BRIEF_FILENAME = "Brief.md";

export interface BriefValidationResult {
  errors: string[];
  warnings: string[];
}

type ResearchBriefSectionKey =
  | "topic"
  | "objectiveMetric"
  | "constraints"
  | "plan"
  | "researchQuestion"
  | "whySmallExperiment"
  | "baselineComparator"
  | "datasetTaskBench"
  | "targetComparison"
  | "minimumAcceptableEvidence"
  | "disallowedShortcuts"
  | "allowedBudgetedPasses"
  | "paperCeiling"
  | "minimumExperimentPlan"
  | "paperWorthinessGate"
  | "failureConditions"
  | "manuscriptFormat"
  | "manuscriptTemplate"
  | "appendixPreferences"
  | "notes"
  | "questionsRisks";

export interface ParsedAppendixPreferences {
  preferAppendixFor: string[];
  keepInMainBody: string[];
}

export interface GuidedResearchBriefAnswers {
  topic: string;
  primaryMetric: string;
  secondaryMetrics?: string;
  meaningfulImprovement: string;
  constraints: string;
  researchQuestion: string;
  whySmallExperiment: string;
  baselineComparator: string;
  datasetTaskBench: string;
  targetComparison: string;
  minimumAcceptableEvidence: string;
  disallowedShortcuts: string;
  allowedBudgetedPasses: string;
  paperCeiling: string;
  minimumExperimentPlan: string;
  failureConditions: string;
  manuscriptTemplate?: string;
  appendixPrefer?: string;
  appendixKeepMain?: string;
  notes?: string;
  questionsRisks?: string;
}

type RequiredResearchBriefSectionKey = Exclude<
  ResearchBriefSectionKey,
  "manuscriptFormat" | "manuscriptTemplate" | "appendixPreferences" | "notes" | "questionsRisks"
>;

const RESEARCH_BRIEF_SECTION_SPECS: Array<{
  key: ResearchBriefSectionKey;
  heading: string;
  lines: string[];
  required: boolean;
}> = [
  {
    key: "topic",
    heading: "Topic",
    required: true,
    lines: ["State the research area and the concrete problem in 1-3 sentences."]
  },
  {
    key: "objectiveMetric",
    heading: "Objective Metric",
    required: true,
    lines: [
      "- Primary metric:",
      "- Secondary metrics (if any):",
      "- What counts as meaningful improvement:"
    ]
  },
  {
    key: "constraints",
    heading: "Constraints",
    required: true,
    lines: [
      "- compute/time budget:",
      "- dataset or environment limits:",
      "- provider/tooling constraints:",
      "- reproducibility constraints:",
      "- forbidden shortcuts:"
    ]
  },
  {
    key: "plan",
    heading: "Plan",
    required: true,
    lines: [
      "1. collect paper-scale related work",
      "2. identify comparator family",
      "3. form a falsifiable hypothesis",
      "4. design a small but real experiment",
      "5. implement and run baseline + proposed condition",
      "6. analyze results",
      "7. draft only after evidence is sufficient"
    ]
  },
  {
    key: "researchQuestion",
    heading: "Research Question",
    required: true,
    lines: ["Write one clear research question that could be answered by a small real experiment."]
  },
  {
    key: "whySmallExperiment",
    heading: "Why This Can Be Tested With A Small Real Experiment",
    required: true,
    lines: [
      "- accessible dataset/task:",
      "- feasible implementation scope:",
      "- feasible baseline:",
      "- realistic run budget:",
      "- expected signal size or decision rule:"
    ]
  },
  {
    key: "baselineComparator",
    heading: "Baseline / Comparator",
    required: true,
    lines: [
      "- baseline name:",
      "- why it is relevant:",
      "- expected comparison dimension:"
    ]
  },
  {
    key: "datasetTaskBench",
    heading: "Dataset / Task / Bench",
    required: true,
    lines: [
      "- dataset(s):",
      "- task type:",
      "- train/eval protocol:",
      "- split or validation discipline:",
      "- known limitations:"
    ]
  },
  {
    key: "targetComparison",
    heading: "Target Comparison",
    required: true,
    lines: [
      "- proposed method or condition:",
      "- comparator or baseline:",
      "- comparison dimension:",
      "- direction of expected improvement:"
    ]
  },
  {
    key: "minimumAcceptableEvidence",
    heading: "Minimum Acceptable Evidence",
    required: true,
    lines: [
      "- minimum effect size or decision boundary:",
      "- minimum number of runs or folds:",
      "- what counts as no signal vs weak signal:"
    ]
  },
  {
    key: "disallowedShortcuts",
    heading: "Disallowed Shortcuts",
    required: true,
    lines: [
      "- Do not use workflow smoke artifacts as experimental evidence.",
      "- Do not cherry-pick a single favorable dataset and omit others.",
      "- Do not fabricate or interpolate missing metric values.",
      "- Do not claim statistical significance without running the test."
    ]
  },
  {
    key: "allowedBudgetedPasses",
    heading: "Allowed Budgeted Passes",
    required: true,
    lines: [
      "- permitted extra pass(es) within budget:",
      "- total budget guardrail:"
    ]
  },
  {
    key: "paperCeiling",
    heading: "Paper Ceiling If Evidence Remains Weak",
    required: true,
    lines: [
      "State the maximum paper classification if the evidence stays weak.",
      "Choose one of: system_validation_note | research_memo | blocked_for_paper_scale."
    ]
  },
  {
    key: "minimumExperimentPlan",
    heading: "Minimum Experiment Plan",
    required: true,
    lines: [
      "- one baseline run",
      "- one proposed or alternative condition",
      "- one result table",
      "- one limitation note",
      "- one claim->evidence mapping"
    ]
  },
  {
    key: "paperWorthinessGate",
    heading: "Paper-worthiness Gate",
    required: true,
    lines: [
      "- Is the research question explicit?",
      "- Is the related work sufficient to position the study?",
      "- Is there at least one explicit baseline?",
      "- Is there at least one real executed experiment?",
      "- Is there at least one quantitative comparison?",
      "- Can major claims be traced to evidence?",
      "- Are limitations stated?"
    ]
  },
  {
    key: "failureConditions",
    heading: "Failure Conditions",
    required: true,
    lines: [
      "- No usable dataset can be identified.",
      "- No meaningful baseline can be implemented.",
      "- The experiment only proves the pipeline runs.",
      "- Results are too weak to support the intended claim."
    ]
  },
  {
    key: "manuscriptFormat",
    heading: "Manuscript Format",
    required: false,
    lines: [
      "- Columns: 2",
      "- Main body pages: 8",
      "- References excluded from page limit: yes",
      "- Appendices excluded from page limit: yes"
    ]
  },
  {
    key: "manuscriptTemplate",
    heading: "Manuscript Template",
    required: false,
    lines: [
      "Optional. Relative path to a .tex template file from the workspace root.",
      "If provided, write_paper uses the file's preamble",
      "(\\documentclass through \\begin{document}) and any detected section order.",
      "Leave blank to use the built-in preamble generator.",
      "Example: template.tex"
    ]
  },
  {
    key: "appendixPreferences",
    heading: "Appendix Preferences",
    required: false,
    lines: [
      "Optional. Use these subsections when the manuscript should route detail deliberately.",
      "Prefer appendix for:",
      "- hyperparameter_grids",
      "- per_fold_results",
      "- prompt_templates",
      "- environment_dump",
      "- extended_error_analysis",
      "Keep in main body:",
      "- main_result_tables",
      "- primary_ablation"
    ]
  },
  {
    key: "notes",
    heading: "Notes",
    required: false,
    lines: ["Optional context, references, or working assumptions."]
  },
  {
    key: "questionsRisks",
    heading: "Questions / Risks",
    required: false,
    lines: ["Optional open questions, blockers, or major risks."]
  }
];

const REQUIRED_RESEARCH_BRIEF_SECTION_KEYS = RESEARCH_BRIEF_SECTION_SPECS
  .filter((spec) => spec.required)
  .map((spec) => spec.key) as RequiredResearchBriefSectionKey[];

const PARTIAL_RESEARCH_BRIEF_SECTION_KEYS: RequiredResearchBriefSectionKey[] = [
  "topic",
  "objectiveMetric",
  "constraints",
  "plan",
  "researchQuestion",
  "baselineComparator",
  "datasetTaskBench",
  "targetComparison"
];

const RESEARCH_BRIEF_SECTION_LABELS = Object.fromEntries(
  RESEARCH_BRIEF_SECTION_SPECS.map((spec) => [spec.key, spec.heading])
) as Record<ResearchBriefSectionKey, string>;

const RESEARCH_BRIEF_SECTION_PLACEHOLDERS = Object.fromEntries(
  RESEARCH_BRIEF_SECTION_SPECS.map((spec) => [spec.key, spec.lines.join("\n")])
) as Record<ResearchBriefSectionKey, string>;

export function buildResearchBriefTemplate(): string {
  return [
    "# Research Brief",
    "",
    ...RESEARCH_BRIEF_SECTION_SPECS.flatMap((spec) => [
      `## ${spec.heading}`,
      "",
      ...spec.lines,
      ""
    ])
  ].join("\n");
}

function splitStructuredLines(text: string): string[] {
  return text
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function toBulletSection(text: string): string[] {
  const lines = splitStructuredLines(text);
  return lines.length > 0 ? lines.map((line) => `- ${line}`) : ["-"];
}

function sanitizeScalar(text: string | undefined): string {
  return text?.trim() || "-";
}

export function buildGuidedResearchBriefMarkdown(input: GuidedResearchBriefAnswers): string {
  const appendixPrefer = splitStructuredLines(input.appendixPrefer ?? "");
  const appendixKeepMain = splitStructuredLines(input.appendixKeepMain ?? "");
  const manuscriptTemplate = input.manuscriptTemplate?.trim();
  const sections: string[] = [
    "# Research Brief",
    "",
    "## Topic",
    sanitizeScalar(input.topic),
    "",
    "## Objective Metric",
    `- Primary metric: ${sanitizeScalar(input.primaryMetric)}`,
    `- Secondary metrics (if any): ${sanitizeScalar(input.secondaryMetrics)}`,
    `- What counts as meaningful improvement: ${sanitizeScalar(input.meaningfulImprovement)}`,
    "",
    "## Constraints",
    ...toBulletSection(input.constraints),
    "",
    "## Plan",
    "1. collect paper-scale related work",
    "2. identify the comparator family and lock a named baseline",
    "3. form a falsifiable hypothesis",
    "4. design a small but real experiment",
    "5. implement and run the baseline plus alternative condition(s)",
    "6. analyze results with explicit quantitative comparison",
    "7. draft only after the evidence gate is met",
    "",
    "## Manuscript Format",
    "- Columns: 2",
    "- Main body pages: 8",
    "- References excluded from page limit: yes",
    "- Appendices excluded from page limit: yes",
    "",
    "## Manuscript Template",
    manuscriptTemplate || "",
    "",
    "## Appendix Preferences",
    "Prefer appendix for:",
    ...(appendixPrefer.length > 0 ? appendixPrefer.map((line) => `- ${line}`) : ["- hyperparameter_grids"]),
    "",
    "Keep in main body:",
    ...(appendixKeepMain.length > 0 ? appendixKeepMain.map((line) => `- ${line}`) : ["- main_result_tables"]),
    "",
    "## Research Question",
    sanitizeScalar(input.researchQuestion),
    "",
    "## Why This Can Be Tested With A Small Real Experiment",
    ...toBulletSection(input.whySmallExperiment),
    "",
    "## Baseline / Comparator",
    ...toBulletSection(input.baselineComparator),
    "",
    "## Dataset / Task / Bench",
    ...toBulletSection(input.datasetTaskBench),
    "",
    "## Target Comparison",
    ...toBulletSection(input.targetComparison),
    "",
    "## Minimum Acceptable Evidence",
    ...toBulletSection(input.minimumAcceptableEvidence),
    "",
    "## Disallowed Shortcuts",
    ...toBulletSection(input.disallowedShortcuts),
    "",
    "## Allowed Budgeted Passes",
    ...toBulletSection(input.allowedBudgetedPasses),
    "",
    "## Paper Ceiling If Evidence Remains Weak",
    sanitizeScalar(input.paperCeiling),
    "",
    "## Minimum Experiment Plan",
    ...toBulletSection(input.minimumExperimentPlan),
    "",
    "## Paper-worthiness Gate",
    "- Is the research question explicit? must be verified during the run.",
    "- Is the related work sufficient to position the study? must be verified during the run.",
    "- Is there at least one explicit baseline? required.",
    "- Is there at least one real executed experiment? required.",
    "- Is there at least one quantitative comparison? required.",
    "- Can major claims be traced to evidence? required.",
    "- Are limitations stated? required.",
    "",
    "## Failure Conditions",
    ...toBulletSection(input.failureConditions),
    "",
    "## Notes",
    sanitizeScalar(input.notes),
    "",
    "## Questions / Risks",
    sanitizeScalar(input.questionsRisks),
    ""
  ];
  return sections.join("\n");
}

export function getWorkspaceResearchBriefPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, WORKSPACE_RESEARCH_BRIEF_FILENAME);
}

export async function createResearchBriefFile(workspaceRoot: string, _seedTopic?: string): Promise<string> {
  const filePath = getWorkspaceResearchBriefPath(workspaceRoot);
  if (!(await fileExists(filePath))) {
    await fs.writeFile(filePath, `${buildResearchBriefTemplate()}\n`, "utf8");
  }
  return filePath;
}

export async function findLatestResearchBrief(workspaceRoot: string): Promise<string | undefined> {
  const workspaceBriefPath = getWorkspaceResearchBriefPath(workspaceRoot);
  if (await fileExists(workspaceBriefPath)) {
    return workspaceBriefPath;
  }

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
    if (inputPath.toLowerCase() === WORKSPACE_RESEARCH_BRIEF_FILENAME.toLowerCase()) {
      return getWorkspaceResearchBriefPath(workspaceRoot);
    }
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

export function validateResearchBriefDraftMarkdown(markdown: string): BriefValidationResult {
  const sections = parseMarkdownRunBriefSections(markdown);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!sections?.title || sections.title.toLowerCase() !== "research brief") {
    warnings.push('Expected the document to start with "# Research Brief".');
  }

  const topicStatus = sectionStatus("topic", sections?.topic);
  if (!topicStatus.present) {
    errors.push('Fill in the "## Topic" section before using the brief as a working draft.');
  } else if (!topicStatus.substantive) {
    errors.push('Replace the placeholder text in "## Topic" before using the brief as a working draft.');
  }

  return { errors, warnings };
}

export function validateResearchBriefMarkdown(markdown: string): BriefValidationResult {
  const sections = parseMarkdownRunBriefSections(markdown);
  const completeness = buildBriefCompletenessArtifact(markdown);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!sections?.title || sections.title.toLowerCase() !== "research brief") {
    warnings.push('Expected the document to start with "# Research Brief".');
  }

  for (const key of REQUIRED_RESEARCH_BRIEF_SECTION_KEYS) {
    const status = completeness.sections[key];
    const heading = RESEARCH_BRIEF_SECTION_LABELS[key];
    if (!status.present) {
      errors.push(`Fill in the "## ${heading}" section before starting the run.`);
      continue;
    }
    if (!status.substantive) {
      errors.push(`Replace the placeholder text in "## ${heading}" before starting the run.`);
    }
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
    researchQuestion: BriefSectionStatus;
    whySmallExperiment: BriefSectionStatus;
    baselineComparator: BriefSectionStatus;
    datasetTaskBench: BriefSectionStatus;
    targetComparison: BriefSectionStatus;
    minimumAcceptableEvidence: BriefSectionStatus;
    disallowedShortcuts: BriefSectionStatus;
    allowedBudgetedPasses: BriefSectionStatus;
    paperCeiling: BriefSectionStatus;
    minimumExperimentPlan: BriefSectionStatus;
    paperWorthinessGate: BriefSectionStatus;
    failureConditions: BriefSectionStatus;
  };
  missing_sections: string[];
  paper_scale_ready: boolean;
  contract_missing_sections: string[];
  contract_ready: boolean;
}

function normalizeBriefSectionText(content: string): string {
  return content.replace(/\s+/g, " ").trim().toLowerCase();
}

function sectionStatus(
  key: RequiredResearchBriefSectionKey,
  content: string | undefined
): BriefSectionStatus {
  if (!content) return { present: false, substantive: false };
  const trimmed = content.trim();
  if (!trimmed) return { present: false, substantive: false };
  if (
    normalizeBriefSectionText(trimmed) ===
    normalizeBriefSectionText(RESEARCH_BRIEF_SECTION_PLACEHOLDERS[key])
  ) {
    return { present: true, substantive: false };
  }
  const stripped = trimmed
    .replace(/\(not specified\)/gi, "")
    .replace(/\bTBD\b/gi, "")
    .replace(/\bTODO\b/gi, "")
    .replace(/\bN\/A\b/gi, "")
    .replace(/^\s*-\s*[^:\n]+:\s*$/gmu, "")
    .trim();
  return {
    present: true,
    substantive: normalizeBriefSectionText(stripped).length >= 10
  };
}

export function buildBriefCompletenessArtifact(markdown: string): BriefCompletenessArtifact {
  const sections = parseMarkdownRunBriefSections(markdown);

  const sectionMap = {
    topic: sectionStatus("topic", sections?.topic),
    objectiveMetric: sectionStatus("objectiveMetric", sections?.objectiveMetric),
    constraints: sectionStatus("constraints", sections?.constraints),
    plan: sectionStatus("plan", sections?.plan),
    researchQuestion: sectionStatus("researchQuestion", sections?.researchQuestion),
    whySmallExperiment: sectionStatus("whySmallExperiment", sections?.whySmallExperiment),
    baselineComparator: sectionStatus("baselineComparator", sections?.baselineComparator),
    datasetTaskBench: sectionStatus("datasetTaskBench", sections?.datasetTaskBench),
    targetComparison: sectionStatus("targetComparison", sections?.targetComparison),
    minimumAcceptableEvidence: sectionStatus("minimumAcceptableEvidence", sections?.minimumAcceptableEvidence),
    disallowedShortcuts: sectionStatus("disallowedShortcuts", sections?.disallowedShortcuts),
    allowedBudgetedPasses: sectionStatus("allowedBudgetedPasses", sections?.allowedBudgetedPasses),
    paperCeiling: sectionStatus("paperCeiling", sections?.paperCeiling),
    minimumExperimentPlan: sectionStatus("minimumExperimentPlan", sections?.minimumExperimentPlan),
    paperWorthinessGate: sectionStatus("paperWorthinessGate", sections?.paperWorthinessGate),
    failureConditions: sectionStatus("failureConditions", sections?.failureConditions)
  };

  const missing: string[] = [];
  for (const key of REQUIRED_RESEARCH_BRIEF_SECTION_KEYS) {
    const status = sectionMap[key];
    if (!status.present || !status.substantive) {
      missing.push(RESEARCH_BRIEF_SECTION_LABELS[key]);
    }
  }

  const substantiveRequiredCount = REQUIRED_RESEARCH_BRIEF_SECTION_KEYS.filter(
    (key) => sectionMap[key].substantive
  ).length;
  const partialCoreComplete = PARTIAL_RESEARCH_BRIEF_SECTION_KEYS.every(
    (key) => sectionMap[key].substantive
  );

  let grade: BriefCompletenessGrade;
  if (substantiveRequiredCount === REQUIRED_RESEARCH_BRIEF_SECTION_KEYS.length) {
    grade = "complete";
  } else if (partialCoreComplete && substantiveRequiredCount >= 10) {
    grade = "partial";
  } else {
    grade = "minimal";
  }

  const contractCriticalSectionKeys: RequiredResearchBriefSectionKey[] = [
    "baselineComparator",
    "targetComparison",
    "minimumAcceptableEvidence",
    "disallowedShortcuts",
    "allowedBudgetedPasses",
    "paperCeiling",
    "minimumExperimentPlan",
    "paperWorthinessGate",
    "failureConditions"
  ];
  const contractMissing = contractCriticalSectionKeys
    .filter((key) => !sectionMap[key].substantive)
    .map((key) => RESEARCH_BRIEF_SECTION_LABELS[key]);

  return {
    generated_at: new Date().toISOString(),
    grade,
    sections: sectionMap,
    missing_sections: missing,
    paper_scale_ready: grade === "complete",
    contract_missing_sections: contractMissing,
    contract_ready: contractMissing.length === 0
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

/**
 * Parse the "## Manuscript Format" section of a brief into a ManuscriptFormatTarget.
 * Returns undefined if the section is absent or unparseable.
 *
 * Expected format (case-insensitive, flexible):
 *   - Columns: 2
 *   - Main body pages: 8
 *   - References excluded from page limit: yes
 *   - Appendices excluded from page limit: yes
 */
export function parseManuscriptFormatFromBrief(markdown: string): ManuscriptFormatTarget | undefined {
  const sections = parseMarkdownRunBriefSections(markdown);
  if (!sections?.manuscriptFormat) return undefined;
  const text = sections.manuscriptFormat;

  const columnsMatch = text.match(/columns?\s*:\s*(\d+)/i);
  const pagesMatch = text.match(/main[\s_]*(?:body[\s_]*)?pages?\s*:\s*(\d+)/i);
  const refsMatch = text.match(/references?[\s_]+excluded[\s_]+from[\s_]+page[\s_]+limit\s*:\s*(yes|no|true|false)/i);
  const appendixMatch = text.match(/appendi(?:ces|x)[\s_]+excluded[\s_]+from[\s_]+page[\s_]+limit\s*:\s*(yes|no|true|false)/i);

  if (!columnsMatch && !pagesMatch) return undefined;

  const columns = columnsMatch ? (parseInt(columnsMatch[1], 10) === 1 ? 1 : 2) as 1 | 2 : 2;
  const mainBodyPages = pagesMatch ? Math.max(1, parseInt(pagesMatch[1], 10)) : 8;
  const refsExcluded = refsMatch ? /^(yes|true)$/i.test(refsMatch[1]) : true;
  const appendixExcluded = appendixMatch ? /^(yes|true)$/i.test(appendixMatch[1]) : true;

  return {
    columns,
    main_body_pages: mainBodyPages,
    references_excluded_from_page_limit: refsExcluded,
    appendices_excluded_from_page_limit: appendixExcluded
  };
}

export function parseManuscriptTemplateFromBrief(markdown: string): string | undefined {
  const sections = parseMarkdownRunBriefSections(markdown);
  if (!sections?.manuscriptTemplate) return undefined;
  const text = sections.manuscriptTemplate.trim();
  const pathMatch = text.match(/(?:^|[\s\-*])([^\s#*`\[\]\n][^\s\n]*\.tex)/m);
  const candidate = pathMatch?.[1]?.trim();
  if (!candidate) return undefined;
  if (!/^[a-zA-Z0-9._/\\-]+$/.test(candidate)) return undefined;
  return candidate;
}

function normalizeAppendixPreferenceToken(token: string): string | undefined {
  const normalized = token
    .replace(/^[\s\-*]+/, "")
    .trim()
    .toLowerCase()
    .replace(/[^\w-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return /^[a-z][a-z0-9_-]*$/.test(normalized) ? normalized : undefined;
}

export function parseAppendixPreferencesFromBrief(
  markdown: string
): ParsedAppendixPreferences | undefined {
  const sections = parseMarkdownRunBriefSections(markdown);
  if (!sections?.appendixPreferences) {
    return undefined;
  }

  const preferAppendixFor: string[] = [];
  const keepInMainBody: string[] = [];
  let mode: "prefer" | "keep" | null = null;

  for (const rawLine of sections.appendixPreferences.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (/^prefer appendix for\b[:\s-]*/iu.test(line)) {
      mode = "prefer";
      const trailing = line.replace(/^prefer appendix for\b[:\s-]*/iu, "");
      for (const token of trailing.split(",")) {
        const normalized = normalizeAppendixPreferenceToken(token);
        if (normalized) preferAppendixFor.push(normalized);
      }
      continue;
    }

    if (/^keep in main body\b[:\s-]*/iu.test(line)) {
      mode = "keep";
      const trailing = line.replace(/^keep in main body\b[:\s-]*/iu, "");
      for (const token of trailing.split(",")) {
        const normalized = normalizeAppendixPreferenceToken(token);
        if (normalized) keepInMainBody.push(normalized);
      }
      continue;
    }

    for (const token of line.split(",")) {
      const normalized = normalizeAppendixPreferenceToken(token);
      if (!normalized) continue;
      if (mode === "keep") {
        keepInMainBody.push(normalized);
      } else {
        preferAppendixFor.push(normalized);
      }
    }
  }

  const uniquePrefer = Array.from(new Set(preferAppendixFor));
  const uniqueKeep = Array.from(new Set(keepInMainBody));
  if (uniquePrefer.length === 0 && uniqueKeep.length === 0) {
    return undefined;
  }

  return {
    preferAppendixFor: uniquePrefer,
    keepInMainBody: uniqueKeep
  };
}
