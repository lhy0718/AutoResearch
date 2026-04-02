import path from "node:path";
import { promises as fs } from "node:fs";

import type { FigureAuditIssue, FigureAuditSummary } from "../exploration/types.js";

export interface FigureAuditInput {
  run_dir: string;
  figure_dir: string | null;
  paper_tex_content: string | null;
  result_analysis_path: string | null;
}

export async function lintFigures(input: FigureAuditInput): Promise<FigureAuditIssue[]> {
  const figureDir = resolveFigureDir(input);
  const figureFiles = await listFigureFiles(figureDir);
  const paperContent = input.paper_tex_content || "";
  const referencedFigures = extractReferencedFigureNames(paperContent);
  const issues: FigureAuditIssue[] = [];

  if (figureFiles.length === 0) {
    issues.push(
      createIssue({
        figureId: "all",
        issueType: "figure_directory_empty",
        severity: "warning",
        description: "No PNG/PDF/SVG figures were found in the figure directory.",
        recommendedAction: "Generate or copy the required figure files before paper submission checks.",
        evidenceAlignmentStatus: "not_checked",
        empiricalValidityImpact: "minor",
        publicationReadiness: "needs_revision",
        manuscriptPlacementRecommendation: "appendix"
      })
    );
    return issues;
  }

  const duplicateNames = findDuplicateBasenames(figureFiles.map((file) => file.basename));
  for (const duplicateName of duplicateNames) {
    issues.push(
      createIssue({
        figureId: stripFigureExtension(duplicateName),
        issueType: "duplicate_figure_filename",
        severity: "warning",
        description: `Duplicate figure filename detected: ${duplicateName}.`,
        recommendedAction: "Rename duplicate figures so references remain unambiguous.",
        evidenceAlignmentStatus: "not_checked",
        empiricalValidityImpact: "minor",
        publicationReadiness: "needs_revision",
        manuscriptPlacementRecommendation: "appendix"
      })
    );
  }

  for (const file of figureFiles) {
    if (file.size === 0) {
      issues.push(
        createIssue({
          figureId: stripFigureExtension(file.basename),
          issueType: "empty_figure_file",
          severity: "severe",
          description: `Figure file ${file.basename} is empty (0 bytes).`,
          recommendedAction: "Rebuild the figure output before using it in the manuscript.",
          evidenceAlignmentStatus: "misaligned",
          empiricalValidityImpact: "major",
          publicationReadiness: "not_ready",
          manuscriptPlacementRecommendation: "remove"
        })
      );
    }

    const normalizedBase = stripFigureExtension(file.basename).toLowerCase();
    if (!referencedFigures.has(normalizedBase) && !referencedFigures.has(file.basename.toLowerCase())) {
      issues.push(
        createIssue({
          figureId: normalizedBase,
          issueType: "unreferenced_figure_file",
          severity: "warning",
          description: `Figure file ${file.basename} exists but is not referenced from paper/main.tex.`,
          recommendedAction: "Reference the figure in the manuscript or remove it from the figure directory.",
          evidenceAlignmentStatus: "not_checked",
          empiricalValidityImpact: "minor",
          publicationReadiness: "needs_revision",
          manuscriptPlacementRecommendation: "appendix"
        })
      );
    }
  }

  return issues;
}

export async function checkCaptionConsistency(input: FigureAuditInput): Promise<FigureAuditIssue[]> {
  const paperContent = input.paper_tex_content || "";
  if (!paperContent.trim()) {
    return [];
  }

  const figureBlocks = extractFigureBlocks(paperContent);
  const issues: FigureAuditIssue[] = [];

  for (const block of figureBlocks) {
    const caption = extractCaption(block.content);
    const captionMissing = caption == null;
    const captionEmpty = typeof caption === "string" && caption.trim().length === 0;
    const captionTodo = typeof caption === "string" && /todo/iu.test(caption);

    if (captionMissing) {
      issues.push(
        createIssue({
          figureId: block.figureIds[0] || `figure_${block.index}`,
          issueType: "figure_block_missing_caption",
          severity: "warning",
          description: `Figure block ${block.index} does not contain a caption.`,
          recommendedAction: "Add a descriptive caption that states what evidence the figure provides.",
          evidenceAlignmentStatus: "misaligned",
          empiricalValidityImpact: "minor",
          publicationReadiness: "needs_revision",
          manuscriptPlacementRecommendation: "appendix"
        })
      );
    }

    if (block.figureIds.length === 0) {
      continue;
    }

    for (const figureId of block.figureIds) {
      if (captionMissing || captionEmpty || captionTodo) {
        issues.push(
          createIssue({
            figureId,
            issueType: "figure_caption_incomplete",
            severity: "severe",
            description:
              captionMissing
                ? `Figure ${figureId} is included without a corresponding caption.`
                : captionEmpty
                  ? `Figure ${figureId} has an empty caption.`
                  : `Figure ${figureId} has a TODO caption placeholder.`,
            recommendedAction: "Replace placeholder or empty captions with evidence-grounded captions before review.",
            evidenceAlignmentStatus: "misaligned",
            empiricalValidityImpact: "major",
            publicationReadiness: "not_ready",
            manuscriptPlacementRecommendation: "remove"
          })
        );
      }
    }
  }

  const figureCount = figureBlocks.length;
  const tableCount = countLatexBlocks(paperContent, "table");
  const textualRefs = extractTextualReferences(paperContent);
  for (const ref of textualRefs) {
    const available = ref.kind === "table" ? tableCount : figureCount;
    if (ref.number > available) {
      issues.push(
        createIssue({
          figureId: `${ref.kind}_${ref.number}`,
          issueType: "dangling_figure_reference",
          severity: "severe",
          description: `${ref.label} is referenced in the manuscript, but no corresponding ${ref.kind} exists.`,
          recommendedAction: `Add the missing ${ref.kind} or remove the dangling reference from the manuscript text.`,
          evidenceAlignmentStatus: "misaligned",
          empiricalValidityImpact: "major",
          publicationReadiness: "not_ready",
          manuscriptPlacementRecommendation: "remove"
        })
      );
    }
  }

  return issues;
}

export async function critiqueFiguresVision(
  input: FigureAuditInput,
  priorIssues: FigureAuditIssue[]
): Promise<FigureAuditIssue[]> {
  if (process.env.FIGURE_AUDITOR_VISION_ENABLED !== "true") {
    return [];
  }

  const figureDir = resolveFigureDir(input);
  const figureFiles = await listFigureFiles(figureDir);
  const figureSpecs = await loadResultAnalysisFigureSpecs(input.result_analysis_path);
  const priorByFigure = new Map<string, FigureAuditIssue[]>();
  for (const issue of priorIssues) {
    const key = issue.figure_id.toLowerCase();
    priorByFigure.set(key, [...(priorByFigure.get(key) || []), issue]);
  }

  const issues: FigureAuditIssue[] = [];
  for (const file of figureFiles) {
    const result = await runVisionCritiqueWithTimeout({
      file,
      figureSpecs,
      priorIssues: priorByFigure.get(stripFigureExtension(file.basename).toLowerCase()) || []
    });
    issues.push(...result);
  }
  return issues;
}

export async function runAllGates(input: FigureAuditInput): Promise<FigureAuditSummary> {
  const gate1 = await lintFigures(input);
  const gate2 = await checkCaptionConsistency(input);
  const gate3 = await critiqueFiguresVision(input, [...gate1, ...gate2]);
  const issues = [...gate1, ...gate2, ...gate3];
  const severeMismatchCount = issues.filter((issue) => issue.severity === "severe").length;
  const figureCount = (await listFigureFiles(resolveFigureDir(input))).length;

  return {
    audited_at: new Date().toISOString(),
    figure_count: figureCount,
    issues,
    severe_mismatch_count: severeMismatchCount,
    review_block_required: severeMismatchCount > 0
  };
}

interface FigureFileRecord {
  absolutePath: string;
  relativePath: string;
  basename: string;
  size: number;
}

interface ParsedFigureBlock {
  index: number;
  content: string;
  figureIds: string[];
}

interface TextualReference {
  kind: "figure" | "table";
  number: number;
  label: string;
}

async function listFigureFiles(figureDir: string): Promise<FigureFileRecord[]> {
  try {
    const entries = await fs.readdir(figureDir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(figureDir, entry.name);
        if (entry.isDirectory()) {
          const nested = await listFigureFiles(absolutePath);
          return nested.map((item) => ({
            ...item,
            relativePath: path.join(entry.name, item.relativePath)
          }));
        }
        if (!entry.isFile() || !/\.(png|pdf|svg)$/iu.test(entry.name)) {
          return [];
        }
        const stat = await fs.stat(absolutePath);
        return [
          {
            absolutePath,
            relativePath: entry.name,
            basename: entry.name,
            size: stat.size
          }
        ];
      })
    );
    return files.flat();
  } catch {
    return [];
  }
}

function resolveFigureDir(input: FigureAuditInput): string {
  return input.figure_dir ? path.resolve(input.figure_dir) : path.join(input.run_dir, "paper", "figures");
}

function extractReferencedFigureNames(paperContent: string): Set<string> {
  const refs = new Set<string>();
  for (const match of paperContent.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/gu)) {
    const raw = (match[1] || "").trim();
    if (!raw) {
      continue;
    }
    const base = path.basename(raw);
    refs.add(base.toLowerCase());
    refs.add(stripFigureExtension(base).toLowerCase());
  }
  return refs;
}

function findDuplicateBasenames(basenames: string[]): string[] {
  const counts = new Map<string, number>();
  for (const basename of basenames) {
    counts.set(basename, (counts.get(basename) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([basename]) => basename);
}

function extractFigureBlocks(paperContent: string): ParsedFigureBlock[] {
  const blocks: ParsedFigureBlock[] = [];
  const regex = /\\begin\{figure\*?\}([\s\S]*?)\\end\{figure\*?\}/gu;
  let index = 0;
  for (const match of paperContent.matchAll(regex)) {
    index += 1;
    const content = match[1] || "";
    const figureIds = [...content.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/gu)]
      .map((graphicMatch) => stripFigureExtension(path.basename((graphicMatch[1] || "").trim())))
      .filter(Boolean);
    blocks.push({ index, content, figureIds });
  }
  return blocks;
}

function extractCaption(blockContent: string): string | null {
  const match = blockContent.match(/\\caption(?:\[[^\]]*\])?\{([\s\S]*?)\}/u);
  return match?.[1] ?? null;
}

function countLatexBlocks(paperContent: string, kind: "table" | "figure"): number {
  const regex = kind === "table" ? /\\begin\{table\*?\}/gu : /\\begin\{figure\*?\}/gu;
  return [...paperContent.matchAll(regex)].length;
}

function extractTextualReferences(paperContent: string): TextualReference[] {
  const refs: TextualReference[] = [];
  for (const match of paperContent.matchAll(/\b(Figure|Fig\.|Table)\s+(\d+)\b/giu)) {
    const kindLabel = (match[1] || "").toLowerCase();
    refs.push({
      kind: kindLabel.startsWith("table") ? "table" : "figure",
      number: Number(match[2] || "0"),
      label: match[0] || kindLabel
    });
  }
  return refs.filter((ref) => Number.isFinite(ref.number) && ref.number > 0);
}

async function loadResultAnalysisFigureSpecs(resultAnalysisPath: string | null): Promise<Set<string>> {
  if (!resultAnalysisPath) {
    return new Set();
  }
  try {
    const raw = await fs.readFile(resultAnalysisPath, "utf8");
    const parsed = JSON.parse(raw) as { figure_specs?: Array<{ path?: string }> };
    const specs = new Set<string>();
    for (const item of parsed.figure_specs || []) {
      if (typeof item?.path === "string" && item.path.trim()) {
        const base = path.basename(item.path.trim());
        specs.add(base.toLowerCase());
        specs.add(stripFigureExtension(base).toLowerCase());
      }
    }
    return specs;
  } catch {
    return new Set();
  }
}

async function runVisionCritiqueWithTimeout(input: {
  file: FigureFileRecord;
  figureSpecs: Set<string>;
  priorIssues: FigureAuditIssue[];
}): Promise<FigureAuditIssue[]> {
  return await Promise.race([
    critiqueSingleFigureHeuristically(input),
    new Promise<FigureAuditIssue[]>((resolve) => {
      setTimeout(() => resolve([]), 60_000);
    })
  ]);
}

async function critiqueSingleFigureHeuristically(input: {
  file: FigureFileRecord;
  figureSpecs: Set<string>;
  priorIssues: FigureAuditIssue[];
}): Promise<FigureAuditIssue[]> {
  const figureId = stripFigureExtension(input.file.basename);
  const normalizedId = figureId.toLowerCase();
  const issues: FigureAuditIssue[] = [];

  const hasFigureSpec = input.figureSpecs.size === 0 || input.figureSpecs.has(normalizedId) || input.figureSpecs.has(input.file.basename.toLowerCase());
  if (!hasFigureSpec) {
    issues.push(
      createIssue({
        figureId,
        issueType: "vision_claim_support_gap",
        severity: "severe",
        description: `Figure ${input.file.basename} is not linked to any result-analysis figure specification and may not substantiate a reviewable claim.`,
        recommendedAction: "Align the figure with a concrete result-analysis figure spec or remove it from the main manuscript.",
        evidenceAlignmentStatus: "misaligned",
        empiricalValidityImpact: "major",
        publicationReadiness: "not_ready",
        manuscriptPlacementRecommendation: "remove"
      })
    );
  }

  if (input.file.size > 0 && input.file.size < 1024) {
    issues.push(
      createIssue({
        figureId,
        issueType: "vision_low_information_density",
        severity: "warning",
        description: `Figure ${input.file.basename} is unusually small and may have low information content.`,
        recommendedAction: "Verify that axes, units, legend, and labels are visible, or move the figure to the appendix.",
        evidenceAlignmentStatus: "not_checked",
        empiricalValidityImpact: "minor",
        publicationReadiness: "needs_revision",
        manuscriptPlacementRecommendation: "appendix"
      })
    );
  }

  if (input.priorIssues.some((issue) => issue.issue_type === "unreferenced_figure_file")) {
    issues.push(
      createIssue({
        figureId,
        issueType: "vision_appendix_recommended",
        severity: "warning",
        description: `Figure ${input.file.basename} is not referenced in the manuscript body and is better suited for the appendix.`,
        recommendedAction: "Move the figure to the appendix or add a text reference that explains its evidentiary role.",
        evidenceAlignmentStatus: "not_checked",
        empiricalValidityImpact: "minor",
        publicationReadiness: "needs_revision",
        manuscriptPlacementRecommendation: "appendix"
      })
    );
  }

  return issues;
}

function stripFigureExtension(value: string): string {
  return value.replace(/\.(png|pdf|svg)$/iu, "");
}

function createIssue(input: {
  figureId: string;
  issueType: string;
  severity: "info" | "warning" | "severe";
  description: string;
  recommendedAction: string;
  evidenceAlignmentStatus: "aligned" | "misaligned" | "not_checked";
  empiricalValidityImpact: "none" | "minor" | "major";
  publicationReadiness: "ready" | "needs_revision" | "not_ready";
  manuscriptPlacementRecommendation: "main" | "appendix" | "remove";
}): FigureAuditIssue {
  return {
    figure_id: input.figureId,
    issue_type: input.issueType,
    severity: input.severity,
    description: input.description,
    recommended_action: input.recommendedAction,
    evidence_alignment_status: input.evidenceAlignmentStatus,
    empirical_validity_impact: input.empiricalValidityImpact,
    publication_readiness: input.publicationReadiness,
    manuscript_placement_recommendation: input.manuscriptPlacementRecommendation
  };
}
