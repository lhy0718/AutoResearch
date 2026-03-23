import path from "node:path";
import { promises as fs } from "node:fs";

import type { PaperEvidenceRow, PaperSummaryRow } from "./analysis/paperAnalyzer.js";
import type { StoredCorpusRow } from "./collection/types.js";
import { ensureDir, normalizeFsPath } from "../utils/fs.js";

export interface RunLiteratureIndex {
  version: 1;
  run_id: string;
  updated_at: string;
  corpus: {
    paper_count: number;
    papers_with_pdf: number;
    missing_pdf_count: number;
    papers_with_bibtex: number;
    enriched_bibtex_count: number;
    top_venues: string[];
    year_range?: {
      min: number;
      max: number;
    };
  };
  citations: {
    total: number;
    average: number;
    top_paper?: {
      title: string;
      citation_count: number;
    };
  };
  enrichment: {
    bibtex_mode?: string;
    pdf_recovered: number;
    bibtex_enriched: number;
    status?: string;
    last_error?: string;
  };
  analysis: {
    summary_count: number;
    evidence_count: number;
    covered_paper_count: number;
    full_text_summary_count: number;
    abstract_summary_count: number;
  };
  artifacts: {
    literature_index_path: string;
    corpus_path: string;
    bibtex_path: string;
    collect_result_path: string;
    summaries_path: string;
    evidence_path: string;
  };
  warnings: string[];
}

interface CollectResultShape {
  bibtexMode?: string;
  pdfRecovered?: number;
  bibtexEnriched?: number;
  enrichment?: {
    status?: string;
    lastError?: string;
  };
}

export function buildRunLiteratureIndexPath(workspaceRoot: string, runId: string): string {
  return path.join(workspaceRoot, ".autolabos", "runs", runId, "literature_index.json");
}

export async function buildRunLiteratureIndex(workspaceRoot: string, runId: string): Promise<RunLiteratureIndex> {
  const runRoot = path.join(workspaceRoot, ".autolabos", "runs", runId);
  const corpusPath = path.join(runRoot, "corpus.jsonl");
  const bibtexPath = path.join(runRoot, "bibtex.bib");
  const collectResultPath = path.join(runRoot, "collect_result.json");
  const summariesPath = path.join(runRoot, "paper_summaries.jsonl");
  const evidencePath = path.join(runRoot, "evidence_store.jsonl");
  const indexPath = buildRunLiteratureIndexPath(workspaceRoot, runId);

  const corpusRows = await readJsonlFile<StoredCorpusRow>(corpusPath);
  const summaryRows = await readJsonlFile<PaperSummaryRow>(summariesPath);
  const evidenceRows = await readJsonlFile<PaperEvidenceRow>(evidencePath);
  const collectResult = await readJsonFile<CollectResultShape>(collectResultPath);

  const papersWithPdf = corpusRows.filter((row) => Boolean(row.pdf_url?.trim())).length;
  const papersWithBibtex = corpusRows.filter(
    (row) => Boolean(row.bibtex?.trim()) || Boolean(row.semantic_scholar_bibtex?.trim())
  ).length;
  const enrichedBibtexCount = corpusRows.filter(
    (row) => Boolean(row.bibtex?.trim()) && row.bibtex_source && row.bibtex_source !== "semantic_scholar"
  ).length;
  const citationPairs = corpusRows
    .map((row) => ({ title: row.title, citation_count: row.citation_count ?? 0 }))
    .filter((row) => row.citation_count > 0)
    .sort((left, right) => right.citation_count - left.citation_count);
  const citationTotal = citationPairs.reduce((sum, row) => sum + row.citation_count, 0);
  const venueCounts = new Map<string, number>();
  const years = corpusRows.map((row) => row.year).filter((year): year is number => typeof year === "number");
  for (const row of corpusRows) {
    const venue = row.venue?.trim();
    if (!venue) {
      continue;
    }
    venueCounts.set(venue, (venueCounts.get(venue) || 0) + 1);
  }
  const topVenues = [...venueCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([venue, count]) => `${venue} (${count})`);

  const fullTextSummaryCount = summaryRows.filter((row) => row.source_type === "full_text").length;
  const abstractSummaryCount = summaryRows.filter((row) => row.source_type === "abstract").length;
  const coveredPaperCount = new Set(summaryRows.map((row) => row.paper_id)).size;

  const warnings: string[] = [];
  if (corpusRows.length === 0) {
    warnings.push("No collected corpus rows are available yet.");
  }
  if (corpusRows.length > 0 && papersWithPdf < corpusRows.length) {
    warnings.push(`${corpusRows.length - papersWithPdf} collected paper(s) are still missing PDF links.`);
  }
  if (corpusRows.length > 0 && papersWithBibtex === 0) {
    warnings.push("No BibTeX entries are available for the collected corpus.");
  }
  if (corpusRows.length > 0 && summaryRows.length === 0) {
    warnings.push("Collected papers exist, but no analyzed summaries have been persisted yet.");
  }

  return {
    version: 1,
    run_id: runId,
    updated_at: new Date().toISOString(),
    corpus: {
      paper_count: corpusRows.length,
      papers_with_pdf: papersWithPdf,
      missing_pdf_count: Math.max(0, corpusRows.length - papersWithPdf),
      papers_with_bibtex: papersWithBibtex,
      enriched_bibtex_count: enrichedBibtexCount,
      top_venues: topVenues,
      year_range: years.length > 0 ? { min: Math.min(...years), max: Math.max(...years) } : undefined
    },
    citations: {
      total: citationTotal,
      average: corpusRows.length > 0 ? Number((citationTotal / corpusRows.length).toFixed(2)) : 0,
      top_paper: citationPairs[0]
    },
    enrichment: {
      bibtex_mode: collectResult?.bibtexMode,
      pdf_recovered: collectResult?.pdfRecovered ?? 0,
      bibtex_enriched: collectResult?.bibtexEnriched ?? 0,
      status: collectResult?.enrichment?.status,
      last_error: collectResult?.enrichment?.lastError
    },
    analysis: {
      summary_count: summaryRows.length,
      evidence_count: evidenceRows.length,
      covered_paper_count: coveredPaperCount,
      full_text_summary_count: fullTextSummaryCount,
      abstract_summary_count: abstractSummaryCount
    },
    artifacts: {
      literature_index_path: relativeToWorkspace(workspaceRoot, indexPath),
      corpus_path: relativeToWorkspace(workspaceRoot, corpusPath),
      bibtex_path: relativeToWorkspace(workspaceRoot, bibtexPath),
      collect_result_path: relativeToWorkspace(workspaceRoot, collectResultPath),
      summaries_path: relativeToWorkspace(workspaceRoot, summariesPath),
      evidence_path: relativeToWorkspace(workspaceRoot, evidencePath)
    },
    warnings
  };
}

export async function writeRunLiteratureIndex(workspaceRoot: string, runId: string): Promise<RunLiteratureIndex> {
  const index = await buildRunLiteratureIndex(workspaceRoot, runId);
  const outputPath = normalizeFsPath(buildRunLiteratureIndexPath(workspaceRoot, runId));
  await ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

export function buildRunLiteratureIndexLines(index: RunLiteratureIndex): string[] {
  const lines = [
    `Literature corpus: ${index.corpus.paper_count} paper(s), ${index.corpus.papers_with_pdf} with PDF, ${index.corpus.papers_with_bibtex} with BibTeX`,
    `Citation coverage: total ${index.citations.total}, average ${index.citations.average}`,
    `Analysis coverage: ${index.analysis.summary_count} summaries, ${index.analysis.evidence_count} evidence rows (${index.analysis.full_text_summary_count} full text, ${index.analysis.abstract_summary_count} abstract)`
  ];

  if (index.citations.top_paper) {
    lines.push(`Top cited paper: ${index.citations.top_paper.title} (${index.citations.top_paper.citation_count})`);
  }
  if (index.enrichment.bibtex_mode || index.enrichment.pdf_recovered > 0 || index.enrichment.bibtex_enriched > 0) {
    lines.push(
      `Enrichment: mode=${index.enrichment.bibtex_mode || "unknown"}, PDF recovered ${index.enrichment.pdf_recovered}, BibTeX enriched ${index.enrichment.bibtex_enriched}`
    );
  }
  if (index.corpus.top_venues.length > 0) {
    lines.push(`Top venues: ${index.corpus.top_venues.join(", ")}`);
  }
  lines.push(`Literature index: ${index.artifacts.literature_index_path}`);
  for (const warning of index.warnings.slice(0, 3)) {
    lines.push(`Literature warning: ${warning}`);
  }
  return lines;
}

async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(normalizeFsPath(filePath), "utf8");
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(normalizeFsPath(filePath), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function relativeToWorkspace(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
}