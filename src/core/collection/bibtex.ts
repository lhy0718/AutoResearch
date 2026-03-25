import { SemanticScholarPaper } from "../../tools/semanticScholar.js";
import { StoredBibtexSource, StoredCorpusRow } from "./types.js";

export type BibtexMode = "generated" | "s2" | "hybrid";

export interface BibtexCandidate {
  source: StoredBibtexSource;
  entry: string;
  richness: number;
}

interface BibtexFieldBag {
  paperId?: string;
  title: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
  arxivId?: string;
}

const RICHNESS_FIELD_WEIGHTS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /\bdoi\s*=/i, score: 2 },
  { pattern: /\burl\s*=/i, score: 1 },
  { pattern: /\bjournal\s*=/i, score: 2 },
  { pattern: /\bbooktitle\s*=/i, score: 2 },
  { pattern: /\bpublisher\s*=/i, score: 1 },
  { pattern: /\bvolume\s*=/i, score: 1 },
  { pattern: /\bnumber\s*=/i, score: 1 },
  { pattern: /\bpages\s*=/i, score: 1 },
  { pattern: /\beprint\s*=/i, score: 1 },
  { pattern: /\barchiveprefix\s*=/i, score: 1 },
  { pattern: /\beditor\s*=/i, score: 1 },
  { pattern: /\baddress\s*=/i, score: 1 },
  { pattern: /\bmonth\s*=/i, score: 1 },
  { pattern: /\bauthor\s*=/i, score: 1 },
  { pattern: /\byear\s*=/i, score: 1 },
  { pattern: /\btitle\s*=/i, score: 1 }
];

export function buildBibtexFile(
  papers: Array<SemanticScholarPaper | StoredCorpusRow>,
  mode: BibtexMode = "generated"
): string {
  const entries = papers
    .map((paper) => buildBibtexEntry(paper, mode))
    .filter(Boolean);
  return entries.join("\n\n");
}

export function buildBibtexEntry(
  paper: SemanticScholarPaper | StoredCorpusRow,
  mode: BibtexMode = "generated"
): string {
  if (mode === "s2") {
    return normalizeS2Bibtex(resolveSemanticScholarBibtex(paper)) ?? "";
  }

  if (mode === "hybrid") {
    const enriched = normalizeS2Bibtex(resolveStoredBibtex(paper));
    if (enriched) {
      return enriched;
    }
  }

  const generated = buildGeneratedBibtexEntry({
    paperId: resolvePaperId(paper),
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    venue: paper.venue,
    doi: resolveDoi(paper),
    url: resolveUrl(paper),
    arxivId: resolveArxivId(paper)
  });
  return generated;
}

export function buildGeneratedBibtexEntry(fields: BibtexFieldBag): string {
  const key = buildBibtexKey(fields);
  const lines: string[] = [`@article{${key},`];

  const authors = (fields.authors ?? [])
    .map((author) => sanitizeBibValue(author))
    .filter(Boolean)
    .join(" and ");
  if (authors) {
    lines.push(`  author = {${authors}},`);
  }

  lines.push(`  title = {${sanitizeBibValue(fields.title)}},`);

  if (typeof fields.year === "number" && Number.isFinite(fields.year)) {
    lines.push(`  year = {${Math.floor(fields.year)}},`);
  }

  if (fields.venue) {
    lines.push(`  journal = {${sanitizeBibValue(fields.venue)}},`);
  }

  if (fields.doi) {
    lines.push(`  doi = {${sanitizeBibValue(fields.doi)}},`);
  }

  if (fields.url) {
    lines.push(`  url = {${sanitizeBibValue(fields.url)}},`);
  }

  if (fields.arxivId) {
    lines.push(`  eprint = {${sanitizeBibValue(fields.arxivId)}},`);
    lines.push("  archivePrefix = {arXiv},");
  }

  lines.push("}");
  return lines.join("\n");
}

export function selectPreferredBibtex(
  mode: BibtexMode,
  candidates: BibtexCandidate[],
  semanticScholarBibtex?: string
): BibtexCandidate | undefined {
  if (mode === "generated") {
    return undefined;
  }

  const normalizedCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      entry: candidate.entry.trim()
    }))
    .filter((candidate) => candidate.entry.startsWith("@"));

  if (mode === "s2") {
    const s2 = normalizeS2Bibtex(semanticScholarBibtex);
    return s2
      ? {
          source: "semantic_scholar",
          entry: s2,
          richness: scoreBibtexRichness(s2)
        }
      : undefined;
  }

  const s2 = normalizeS2Bibtex(semanticScholarBibtex);
  if (s2) {
    normalizedCandidates.push({
      source: "semantic_scholar",
      entry: s2,
      richness: scoreBibtexRichness(s2)
    });
  }

  normalizedCandidates.sort((a, b) => {
    const sourceCmp = compareBibtexSourcePriority(a.source, b.source);
    if (sourceCmp !== 0) {
      return sourceCmp;
    }
    return b.richness - a.richness;
  });

  return normalizedCandidates[0];
}

export function scoreBibtexRichness(entry: string): number {
  const normalized = entry.trim();
  if (!normalized.startsWith("@")) {
    return 0;
  }

  const fields = new Set(
    Array.from(normalized.matchAll(/\n\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*=/g)).map((match) =>
      match[1].toLowerCase()
    )
  );
  let score = fields.size;
  for (const weight of RICHNESS_FIELD_WEIGHTS) {
    if (weight.pattern.test(normalized)) {
      score += weight.score;
    }
  }
  return score;
}

export function normalizeS2Bibtex(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed.startsWith("@")) {
    return undefined;
  }
  return trimmed;
}

function resolveSemanticScholarBibtex(paper: SemanticScholarPaper | StoredCorpusRow): string | undefined {
  if ("citationStylesBibtex" in paper && typeof paper.citationStylesBibtex === "string") {
    return paper.citationStylesBibtex;
  }
  if ("semantic_scholar_bibtex" in paper && typeof paper.semantic_scholar_bibtex === "string") {
    return paper.semantic_scholar_bibtex;
  }
  return undefined;
}

function resolveStoredBibtex(paper: SemanticScholarPaper | StoredCorpusRow): string | undefined {
  if ("bibtex" in paper && typeof paper.bibtex === "string" && paper.bibtex.trim()) {
    return paper.bibtex;
  }
  return resolveSemanticScholarBibtex(paper);
}

function resolvePaperId(paper: SemanticScholarPaper | StoredCorpusRow): string | undefined {
  return "paperId" in paper ? paper.paperId : paper.paper_id;
}

function resolveDoi(paper: SemanticScholarPaper | StoredCorpusRow): string | undefined {
  return "doi" in paper ? paper.doi : undefined;
}

function resolveArxivId(paper: SemanticScholarPaper | StoredCorpusRow): string | undefined {
  if ("arxivId" in paper) {
    return paper.arxivId;
  }
  if ("arxiv_id" in paper && typeof paper.arxiv_id === "string") {
    return paper.arxiv_id;
  }
  return undefined;
}

function resolveUrl(paper: SemanticScholarPaper | StoredCorpusRow): string | undefined {
  if ("landing_url" in paper && typeof paper.landing_url === "string" && paper.landing_url.trim()) {
    return paper.landing_url;
  }
  return paper.url;
}

function buildBibtexKey(fields: BibtexFieldBag): string {
  const base = fields.doi || fields.paperId || "paper";
  const key = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key || "paper";
}

function sanitizeBibValue(text: string): string {
  return text
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareBibtexSourcePriority(a: StoredBibtexSource, b: StoredBibtexSource): number {
  return bibtexSourcePriority(a) - bibtexSourcePriority(b);
}

function bibtexSourcePriority(source: StoredBibtexSource): number {
  switch (source) {
    case "acl_anthology":
      return 0;
    case "doi_content_negotiation":
      return 1;
    case "crossref_generated":
      return 2;
    case "openreview_generated":
    case "pmlr_generated":
      return 3;
    case "arxiv_generated":
      return 4;
    case "semantic_scholar":
      return 5;
    case "local_generated":
      return 6;
    default:
      return 99;
  }
}
