import path from "node:path";
import { promises as fs } from "node:fs";

import type { GraphNodeId, RunRecord, RunStatus } from "../types.js";
import { ensureDir, fileExists, normalizeFsPath, readJsonFile, writeJsonFile } from "../utils/fs.js";
import { RunContextMemory } from "./memory/runContextMemory.js";
import type { PublicRunManifest } from "./publicOutputPublisher.js";
import { buildPublicRunManifestPath, sanitizeSlug } from "./publicArtifacts.js";

export interface RepositoryKnowledgeSectionEntry {
  name: string;
  generated_files: string[];
  updated_at: string;
}

export interface RepositoryKnowledgeEntry {
  run_id: string;
  title: string;
  topic: string;
  topic_slug?: string;
  objective_metric: string;
  latest_summary?: string;
  latest_published_section: string;
  updated_at: string;
  public_output_root: string;
  public_manifest: string;
  knowledge_note: string;
  entry_kind?: "published_outputs" | "completed_run";
  final_node?: GraphNodeId;
  final_status?: RunStatus;
  paper_ready?: boolean;
  review_decision?: string;
  key_metrics?: string[];
  research_question?: string;
  analysis_summary?: string;
  manuscript_type?: string;
  sections: RepositoryKnowledgeSectionEntry[];
}

export interface RepositoryKnowledgeIndex {
  version: 1;
  updated_at: string;
  entries: RepositoryKnowledgeEntry[];
}

type KnowledgeRunLike = Pick<RunRecord, "id" | "title" | "topic" | "objectiveMetric" | "latestSummary">;
type CompletedKnowledgeRunLike = Pick<
  RunRecord,
  "id" | "title" | "topic" | "objectiveMetric" | "latestSummary" | "currentNode" | "status" | "updatedAt"
>;

export async function updateRepositoryKnowledgeIndex(input: {
  workspaceRoot: string;
  run: KnowledgeRunLike;
  manifest: PublicRunManifest;
  runContext?: RunContextMemory;
}): Promise<{ indexPath: string; notePath: string; entry: RepositoryKnowledgeEntry }> {
  const knowledgeRoot = buildRepositoryKnowledgeRoot(input.workspaceRoot);
  const indexPath = buildRepositoryKnowledgeIndexPath(input.workspaceRoot);
  const notePath = buildRepositoryKnowledgeNotePath(input.workspaceRoot, input.run.id);
  const contextEntries = input.runContext ? await input.runContext.entries() : [];
  const contextMap = new Map(contextEntries.map((item) => [item.key, item.value]));

  const entry = buildKnowledgeEntry({
    workspaceRoot: input.workspaceRoot,
    run: input.run,
    manifest: input.manifest,
    notePath,
    contextMap
  });

  await ensureDir(path.dirname(notePath));
  await fs.writeFile(normalizeFsPath(notePath), renderKnowledgeNote(entry), "utf8");

  const index = await loadKnowledgeIndex(indexPath);
  const nextEntries = index.entries.filter((existing) => existing.run_id !== entry.run_id);
  nextEntries.push(entry);
  nextEntries.sort((left, right) => {
    if (left.updated_at === right.updated_at) {
      return left.run_id.localeCompare(right.run_id);
    }
    return right.updated_at.localeCompare(left.updated_at);
  });

  await writeJsonFile(indexPath, {
    version: 1,
    updated_at: entry.updated_at,
    entries: nextEntries
  } satisfies RepositoryKnowledgeIndex);

  return { indexPath, notePath, entry };
}

export function buildRepositoryKnowledgeRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".autolabos", "knowledge");
}

export function buildRepositoryKnowledgeIndexPath(workspaceRoot: string): string {
  return path.join(buildRepositoryKnowledgeRoot(workspaceRoot), "index.json");
}

export function buildRepositoryKnowledgeNotePath(workspaceRoot: string, runId: string): string {
  return path.join(buildRepositoryKnowledgeRoot(workspaceRoot), "runs", `${runId}.md`);
}

export async function readRepositoryKnowledgeIndex(workspaceRoot: string): Promise<RepositoryKnowledgeIndex> {
  return loadKnowledgeIndex(buildRepositoryKnowledgeIndexPath(workspaceRoot));
}

export async function indexRunKnowledge(input: {
  workspaceRoot: string;
  run: CompletedKnowledgeRunLike;
}): Promise<{ indexPath: string; notePath: string; entry: RepositoryKnowledgeEntry | undefined }> {
  const indexPath = buildRepositoryKnowledgeIndexPath(input.workspaceRoot);
  const notePath = buildRepositoryKnowledgeNotePath(input.workspaceRoot, input.run.id);
  const index = await loadKnowledgeIndex(indexPath);
  const existing = index.entries.find((entry) => entry.run_id === input.run.id);
  if (existing) {
    return { indexPath, notePath, entry: existing };
  }

  const runRoot = path.join(input.workspaceRoot, ".autolabos", "runs", input.run.id);
  const [resultAnalysis, reviewDecision, paperReadiness, publicManifest] = await Promise.all([
    readOptionalJson<Record<string, unknown>>(path.join(runRoot, "result_analysis.json")),
    readOptionalJson<Record<string, unknown>>(path.join(runRoot, "review", "decision.json")),
    readOptionalJson<Record<string, unknown>>(path.join(runRoot, "paper", "paper_readiness.json")),
    readOptionalJson<PublicRunManifest>(buildPublicRunManifestPath(input.workspaceRoot, input.run))
  ]);

  const entry = buildCompletedRunKnowledgeEntry({
    workspaceRoot: input.workspaceRoot,
    run: input.run,
    notePath,
    resultAnalysis,
    reviewDecision,
    paperReadiness,
    publicManifest
  });

  await ensureDir(path.dirname(notePath));
  await fs.writeFile(normalizeFsPath(notePath), renderKnowledgeNote(entry), "utf8");

  const nextEntries = [...index.entries, entry].sort((left, right) => {
    if (left.updated_at === right.updated_at) {
      return left.run_id.localeCompare(right.run_id);
    }
    return right.updated_at.localeCompare(left.updated_at);
  });

  await writeJsonFile(indexPath, {
    version: 1,
    updated_at: entry.updated_at,
    entries: nextEntries
  } satisfies RepositoryKnowledgeIndex);

  return { indexPath, notePath, entry };
}

export function buildRepositoryKnowledgeEntryLines(entry: RepositoryKnowledgeEntry): string[] {
  const lines = [
    `Knowledge entry: ${entry.run_id} | ${entry.title}`,
    `Topic: ${entry.topic || "unknown"}`,
    `Objective metric: ${entry.objective_metric || "unknown"}`,
    `Latest published section: ${entry.latest_published_section}`,
    `Updated at: ${entry.updated_at}`
  ];

  if (entry.research_question) {
    lines.push(`Research question: ${entry.research_question}`);
  }
  if (entry.analysis_summary) {
    lines.push(`Analysis summary: ${entry.analysis_summary}`);
  }
  if (entry.latest_summary) {
    lines.push(`Latest summary: ${entry.latest_summary}`);
  }
  if (entry.final_node) {
    lines.push(`Final node: ${entry.final_node}`);
  }
  if (typeof entry.paper_ready === "boolean") {
    lines.push(`Paper ready: ${entry.paper_ready ? "yes" : "no"}`);
  }
  if (entry.review_decision) {
    lines.push(`Review decision: ${entry.review_decision}`);
  }
  if (entry.key_metrics?.length) {
    lines.push(`Key metrics: ${entry.key_metrics.join(" | ")}`);
  }
  if (entry.manuscript_type) {
    lines.push(`Manuscript state: ${entry.manuscript_type}`);
  }
  if (entry.sections.length > 0) {
    lines.push(`Published sections: ${entry.sections.map((section) => section.name).join(", ")}`);
  }
  lines.push(`Knowledge note: ${entry.knowledge_note}`);
  lines.push(`Public manifest: ${entry.public_manifest}`);
  return lines;
}

export function buildRepositoryKnowledgeOverviewLines(
  entries: RepositoryKnowledgeEntry[],
  limit = 5
): string[] {
  if (entries.length === 0) {
    return ["No repository knowledge has been published yet."];
  }

  const lines = [`Repository knowledge entries: ${entries.length}`];
  for (const entry of entries.slice(0, limit)) {
    lines.push(
      `- ${entry.run_id} | ${entry.title} | ${entry.latest_published_section} | ${entry.updated_at}`
    );
  }
  if (entries.length > limit) {
    lines.push(`... ${entries.length - limit} more entr${entries.length - limit === 1 ? "y" : "ies"}`);
  }
  return lines;
}

async function loadKnowledgeIndex(indexPath: string): Promise<RepositoryKnowledgeIndex> {
  try {
    const parsed = await readJsonFile<RepositoryKnowledgeIndex>(indexPath);
    if (parsed.version === 1 && Array.isArray(parsed.entries)) {
      return parsed;
    }
  } catch {
    // ignore missing or invalid index
  }

  return {
    version: 1,
    updated_at: new Date(0).toISOString(),
    entries: []
  };
}

function buildKnowledgeEntry(input: {
  workspaceRoot: string;
  run: KnowledgeRunLike;
  manifest: PublicRunManifest;
  notePath: string;
  contextMap: Map<string, unknown>;
}): RepositoryKnowledgeEntry {
  const sections = Object.entries(input.manifest.sections)
    .flatMap(([name, section]) =>
      section
        ? [
            {
              name,
              generated_files: [...section.generated_files],
              updated_at: section.updated_at
            }
          ]
        : []
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  const brief = getRecord(input.contextMap.get("run_brief.extracted"));
  const analysis = getRecord(input.contextMap.get("analyze_results.last_summary"));
  const manuscriptType =
    getString(input.contextMap.get("write_paper.manuscript_type")) ||
    getString(input.contextMap.get("review.manuscript_type"));

  let latestPublishedSection = "unknown";
  let latestPublishedAt = "";
  for (const section of sections) {
    if (!latestPublishedAt || section.updated_at > latestPublishedAt) {
      latestPublishedAt = section.updated_at;
      latestPublishedSection = section.name;
    }
  }

  return {
    run_id: input.run.id,
    title: input.run.title,
    topic: getString(brief?.topic) || input.run.topic,
    topic_slug: sanitizeSlug(getString(brief?.topic) || input.run.topic),
    objective_metric: input.run.objectiveMetric,
    latest_summary: input.run.latestSummary,
    latest_published_section: latestPublishedSection,
    updated_at: input.manifest.updated_at,
    public_output_root: input.manifest.output_root,
    public_manifest: normalizeRelativePath(path.relative(input.workspaceRoot, path.join(input.workspaceRoot, input.manifest.output_root, "manifest.json"))),
    knowledge_note: normalizeRelativePath(path.relative(input.workspaceRoot, input.notePath)),
    entry_kind: "published_outputs",
    research_question:
      getString(brief?.researchQuestion) ||
      getString(brief?.research_question) ||
      getString(brief?.question),
    analysis_summary:
      getString(analysis?.overview?.objective_summary) ||
      getString(analysis?.objective_summary) ||
      getString(analysis?.summary),
    manuscript_type: manuscriptType,
    sections
  };
}

function renderKnowledgeNote(entry: RepositoryKnowledgeEntry): string {
  const lines = [
    `# ${entry.title || "Research Run"}`,
    "",
    `- Run ID: ${entry.run_id}`,
    `- Topic: ${entry.topic || "unknown"}`,
    `- Topic slug: ${entry.topic_slug || "unknown"}`,
    `- Objective metric: ${entry.objective_metric || "unknown"}`,
    `- Latest published section: ${entry.latest_published_section}`,
    `- Updated at: ${entry.updated_at}`,
    `- Public outputs: ${entry.public_output_root || "not published"}`,
    `- Manifest: ${entry.public_manifest || "not published"}`,
    ""
  ];

  if (entry.research_question) {
    lines.push("## Research Question", "", entry.research_question, "");
  }
  if (entry.latest_summary) {
    lines.push("## Latest Summary", "", entry.latest_summary, "");
  }
  if (entry.analysis_summary) {
    lines.push("## Analysis Summary", "", entry.analysis_summary, "");
  }
  if (entry.manuscript_type) {
    lines.push("## Manuscript State", "", `- ${entry.manuscript_type}`, "");
  }
  if (entry.final_node || typeof entry.paper_ready === "boolean" || entry.review_decision) {
    lines.push("## Run Outcome", "");
    if (entry.final_node) {
      lines.push(`- Last node: ${entry.final_node}`);
    }
    if (entry.final_status) {
      lines.push(`- Final status: ${entry.final_status}`);
    }
    if (typeof entry.paper_ready === "boolean") {
      lines.push(`- Paper ready: ${entry.paper_ready ? "yes" : "no"}`);
    }
    if (entry.review_decision) {
      lines.push(`- Review decision: ${entry.review_decision}`);
    }
    lines.push("");
  }
  if (entry.key_metrics?.length) {
    lines.push("## Key Metrics", "");
    for (const metric of entry.key_metrics) {
      lines.push(`- ${metric}`);
    }
    lines.push("");
  }

  lines.push("## Published Sections", "");
  if (entry.sections.length === 0) {
    lines.push("- No published sections yet.");
  } else {
    for (const section of entry.sections) {
      lines.push(`### ${section.name}`);
      lines.push("");
      lines.push(`- Updated at: ${section.updated_at}`);
      if (section.generated_files.length === 0) {
        lines.push("- Generated files: none");
      } else {
        lines.push("- Generated files:");
        for (const filePath of section.generated_files) {
          lines.push(`  - ${filePath}`);
        }
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function getRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : undefined;
}

function getString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/");
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  if (!(await fileExists(filePath))) {
    return undefined;
  }
  try {
    return await readJsonFile<T>(filePath);
  } catch {
    return undefined;
  }
}

function buildCompletedRunKnowledgeEntry(input: {
  workspaceRoot: string;
  run: CompletedKnowledgeRunLike;
  notePath: string;
  resultAnalysis?: Record<string, unknown>;
  reviewDecision?: Record<string, unknown>;
  paperReadiness?: Record<string, unknown>;
  publicManifest?: PublicRunManifest;
}): RepositoryKnowledgeEntry {
  return {
    run_id: input.run.id,
    title: input.run.title,
    topic: input.run.topic,
    topic_slug: sanitizeSlug(input.run.topic),
    objective_metric: input.run.objectiveMetric,
    latest_summary: input.run.latestSummary,
    latest_published_section: input.publicManifest ? latestPublishedSectionFromManifest(input.publicManifest) : "run_summary",
    updated_at: input.run.updatedAt,
    public_output_root: input.publicManifest?.output_root || "",
    public_manifest: input.publicManifest
      ? normalizeRelativePath(
          path.relative(
            input.workspaceRoot,
            path.join(input.workspaceRoot, input.publicManifest.output_root, "manifest.json")
          )
        )
      : "",
    knowledge_note: normalizeRelativePath(path.relative(input.workspaceRoot, input.notePath)),
    entry_kind: "completed_run",
    final_node: input.run.currentNode,
    final_status: input.run.status,
    paper_ready: extractBoolean(input.paperReadiness?.paper_ready),
    review_decision: extractReviewDecision(input.reviewDecision),
    key_metrics: extractKeyMetrics(input.resultAnalysis),
    analysis_summary: extractAnalysisSummary(input.resultAnalysis),
    manuscript_type: extractString(input.paperReadiness?.readiness_state),
    sections: buildSectionsFromManifest(input.publicManifest)
  };
}

function latestPublishedSectionFromManifest(manifest: PublicRunManifest): string {
  let latestName = "unknown";
  let latestUpdatedAt = "";
  for (const [name, section] of Object.entries(manifest.sections)) {
    if (!section) {
      continue;
    }
    if (!latestUpdatedAt || section.updated_at > latestUpdatedAt) {
      latestUpdatedAt = section.updated_at;
      latestName = name;
    }
  }
  return latestName;
}

function buildSectionsFromManifest(
  manifest?: PublicRunManifest
): RepositoryKnowledgeSectionEntry[] {
  if (!manifest) {
    return [];
  }
  return Object.entries(manifest.sections)
    .flatMap(([name, section]) =>
      section
        ? [
            {
              name,
              generated_files: [...section.generated_files],
              updated_at: section.updated_at
            }
          ]
        : []
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

function extractReviewDecision(value?: Record<string, unknown>): string | undefined {
  return (
    extractString(value?.outcome) ||
    extractString(value?.decision) ||
    extractString(value?.recommended_transition)
  );
}

function extractAnalysisSummary(value?: Record<string, unknown>): string | undefined {
  const overview = getRecord(value?.overview);
  return extractString(overview?.objective_summary) || extractString(value?.summary);
}

function extractKeyMetrics(value?: Record<string, unknown>): string[] {
  if (!value) {
    return [];
  }
  const lines: string[] = [];
  const overview = getRecord(value.overview);
  const objectiveStatus = extractString(overview?.objective_status);
  if (objectiveStatus) {
    lines.push(`objective_status: ${objectiveStatus}`);
  }
  const objectiveSummary = extractString(overview?.objective_summary);
  if (objectiveSummary) {
    lines.push(`objective_summary: ${objectiveSummary}`);
  }
  for (const key of ["mean_score", "median_score", "score", "objective_gap"]) {
    const numeric = extractFiniteNumber(value[key]);
    if (numeric != null) {
      lines.push(`${key}: ${numeric}`);
    }
  }
  return lines;
}

function extractFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function extractString(value: unknown): string | undefined {
  return getString(value);
}
