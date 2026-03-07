import { GraphNodeHandler } from "../stateGraph/types.js";
import { appendJsonl, writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { LongTermStore } from "../memory/longTermStore.js";
import {
  SemanticScholarPaper,
  SemanticScholarSearchFilters,
  SemanticScholarSearchRequest
} from "../../tools/semanticScholar.js";
import { BibtexMode } from "../commands/collectOptions.js";

interface CollectPapersNodeRequest {
  query?: string;
  limit?: number;
  additional?: number;
  sort?: {
    field?: "relevance" | "citationCount" | "publicationDate" | "paperId";
    order?: "asc" | "desc";
  };
  filters?: {
    dateRange?: string;
    year?: string;
    lastYears?: number;
    fieldsOfStudy?: string[];
    venues?: string[];
    publicationTypes?: string[];
    minCitationCount?: number;
    openAccessPdf?: boolean;
  };
  bibtexMode?: BibtexMode;
}

interface CollectResultMeta {
  query: string;
  limit: number;
  fetched: number;
  source: "semantic_scholar";
  fetchError?: string;
  sort: {
    field: "relevance" | "citationCount" | "publicationDate" | "paperId";
    order: "asc" | "desc";
  };
  filters: SemanticScholarSearchFilters;
  bibtexMode: BibtexMode;
  timestamp: string;
}

export function createCollectPapersNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "collect_papers",
    async execute({ run, graph, abortSignal }) {
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      const longTermStore = new LongTermStore(run.memoryRefs.longTermPath);
      const requestFromContext = await runContextMemory.get<CollectPapersNodeRequest>("collect_papers.request");
      const overrideLimit = await runContextMemory.get<number>("collect_papers.requested_limit");
      const normalizedRequest = normalizeCollectRequest({
        request: requestFromContext,
        topic: run.topic,
        configuredLimit: deps.config.papers.max_results,
        overrideLimit
      });

      let papers: Awaited<ReturnType<typeof deps.semanticScholar.searchPapers>> = [];
      let fetchError: string | undefined;
      try {
        papers = await deps.semanticScholar.searchPapers(normalizedRequest, abortSignal);
        await runContextMemory.put("collect_papers.requested_limit", null);
        await runContextMemory.put("collect_papers.request", null);
      } catch (error) {
        fetchError = error instanceof Error ? error.message : String(error);
      }

      const corpus = papers.map((paper) => ({
        paper_id: paper.paperId,
        title: paper.title,
        abstract: paper.abstract || "",
        year: paper.year,
        venue: paper.venue,
        url: paper.url,
        pdf_url: paper.openAccessPdfUrl,
        authors: paper.authors,
        citation_count: paper.citationCount,
        influential_citation_count: paper.influentialCitationCount,
        publication_date: paper.publicationDate,
        publication_types: paper.publicationTypes,
        fields_of_study: paper.fieldsOfStudy
      }));

      const bibtexMode = normalizeBibtexMode(requestFromContext?.bibtexMode);
      const bibtex = buildBibtexFile(papers, bibtexMode);
      const resultMeta: CollectResultMeta = {
        query: normalizedRequest.query,
        limit: normalizedRequest.limit,
        fetched: corpus.length,
        source: "semantic_scholar",
        fetchError,
        sort: {
          field: normalizedRequest.sort?.field ?? "relevance",
          order: normalizedRequest.sort?.order ?? "desc"
        },
        filters: normalizedRequest.filters || {},
        bibtexMode,
        timestamp: new Date().toISOString()
      };

      await writeRunArtifact(run, "collect_request.json", JSON.stringify(normalizedRequest, null, 2));
      await writeRunArtifact(run, "collect_result.json", JSON.stringify(resultMeta, null, 2));
      await runContextMemory.put("collect_papers.last_request", normalizedRequest);
      await runContextMemory.put("collect_papers.last_result", resultMeta);
      if (fetchError) {
        await runContextMemory.put("collect_papers.last_error", fetchError);
      } else {
        await runContextMemory.put("collect_papers.last_error", null);
        await appendJsonl(run, "corpus.jsonl", corpus);
        await writeRunArtifact(run, "bibtex.bib", bibtex);
        await runContextMemory.put("collect_papers.count", corpus.length);
        await runContextMemory.put("collect_papers.source", "semantic_scholar");
        await longTermStore.append({
          runId: run.id,
          category: "papers",
          text: `Collected ${corpus.length} papers for ${normalizedRequest.query}`,
          tags: ["collect_papers", normalizedRequest.query]
        });
      }

      deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "collect_papers",
        payload: {
          source: "semantic_scholar",
          papers: corpus.length,
          query: normalizedRequest.query,
          requested_limit: normalizedRequest.limit,
          fetch_error: fetchError
        }
      });

      if (fetchError) {
        const failureMessage = buildCollectFailureMessage(normalizedRequest, fetchError);
        return {
          status: "failure",
          error: failureMessage,
          summary: failureMessage,
          toolCallsUsed: 1
        };
      }

      return {
        status: "success",
        summary: `Semantic Scholar fetched ${corpus.length} papers for "${normalizedRequest.query}".`,
        needsApproval: true,
        toolCallsUsed: 1
      };
    }
  };
}

export function buildBibtexFile(papers: SemanticScholarPaper[], mode: BibtexMode = "generated"): string {
  const entries = papers
    .map((paper) => buildBibtexEntry(paper, mode))
    .filter(Boolean);
  return entries.join("\n\n");
}

export function buildBibtexEntry(paper: SemanticScholarPaper, mode: BibtexMode = "generated"): string {
  if (mode !== "generated") {
    const s2Bibtex = normalizeS2Bibtex(paper.citationStylesBibtex);
    if (s2Bibtex) {
      return s2Bibtex;
    }
    if (mode === "s2") {
      return "";
    }
  }

  const key = buildBibtexKey(paper);
  const lines: string[] = [`@article{${key},`];

  const authors = paper.authors
    .map((author) => sanitizeBibValue(author))
    .filter(Boolean)
    .join(" and ");
  if (authors) {
    lines.push(`  author = {${authors}},`);
  }

  lines.push(`  title = {${sanitizeBibValue(paper.title)}},`);

  if (typeof paper.year === "number" && Number.isFinite(paper.year)) {
    lines.push(`  year = {${Math.floor(paper.year)}},`);
  }

  if (paper.venue) {
    lines.push(`  journal = {${sanitizeBibValue(paper.venue)}},`);
  }

  if (paper.doi) {
    lines.push(`  doi = {${sanitizeBibValue(paper.doi)}},`);
  }

  if (paper.url) {
    lines.push(`  url = {${sanitizeBibValue(paper.url)}},`);
  }

  if (paper.arxivId) {
    lines.push(`  note = {arXiv:${sanitizeBibValue(paper.arxivId)}},`);
  }

  lines.push("}");
  return lines.join("\n");
}

function normalizeCollectRequest(input: {
  request?: CollectPapersNodeRequest;
  topic: string;
  configuredLimit: number;
  overrideLimit?: number;
}): SemanticScholarSearchRequest {
  const configuredLimit = Math.max(1, input.configuredLimit);
  const request = input.request;
  const requestedLimitFromCommand =
    typeof request?.limit === "number" && Number.isFinite(request.limit) && request.limit > 0
      ? Math.floor(request.limit)
      : undefined;
  const requestedLimitFromLegacy =
    typeof input.overrideLimit === "number" && Number.isFinite(input.overrideLimit) && input.overrideLimit > 0
      ? Math.floor(input.overrideLimit)
      : undefined;

  const limit = requestedLimitFromCommand ?? requestedLimitFromLegacy ?? configuredLimit;
  const query = (request?.query || input.topic).trim();
  const sortField = request?.sort?.field ?? "relevance";
  const sortOrder = request?.sort?.order ?? (sortField === "paperId" ? "asc" : "desc");

  return {
    query,
    limit,
    sort: {
      field: sortField,
      order: sortOrder
    },
    filters: buildSemanticScholarFilters(request?.filters)
  };
}

function buildSemanticScholarFilters(
  filters: CollectPapersNodeRequest["filters"] | undefined
): SemanticScholarSearchFilters {
  if (!filters) {
    return {};
  }

  const publicationDateOrYear = resolvePublicationDateOrYear(filters);
  return {
    publicationTypes: filters.publicationTypes?.filter(Boolean),
    openAccessPdf: filters.openAccessPdf === true,
    minCitationCount: filters.minCitationCount,
    publicationDateOrYear,
    year: publicationDateOrYear ? undefined : filters.year,
    venue: filters.venues?.filter(Boolean),
    fieldsOfStudy: filters.fieldsOfStudy?.filter(Boolean)
  };
}

function resolvePublicationDateOrYear(filters: CollectPapersNodeRequest["filters"]): string | undefined {
  if (!filters) {
    return undefined;
  }
  if (filters.dateRange) {
    return filters.dateRange;
  }
  if (filters.year) {
    return undefined;
  }
  if (typeof filters.lastYears === "number" && Number.isFinite(filters.lastYears) && filters.lastYears > 0) {
    const nowYear = new Date().getFullYear();
    const startYear = Math.max(1900, nowYear - Math.floor(filters.lastYears) + 1);
    return `${startYear}:`;
  }
  return undefined;
}

function normalizeBibtexMode(mode: unknown): BibtexMode {
  if (mode === "generated" || mode === "s2" || mode === "hybrid") {
    return mode;
  }
  return "hybrid";
}

function buildCollectFailureMessage(
  request: SemanticScholarSearchRequest,
  fetchError: string
): string {
  if (/\b429\b/.test(fetchError)) {
    const chunkNote = usesConservativeChunking(request)
      ? " AutoResearch already switched this request to smaller Semantic Scholar chunks."
      : "";
    return `Semantic Scholar rate limited "${request.query}": ${fetchError}.${chunkNote} Wait a bit and retry, or lower --limit to 50-100 / collect in smaller batches.`;
  }
  return `Semantic Scholar fetch failed for "${request.query}" (${fetchError})`;
}

function usesConservativeChunking(request: SemanticScholarSearchRequest): boolean {
  return (
    request.limit >= 200 ||
    request.filters?.openAccessPdf === true ||
    (request.filters?.publicationTypes?.length ?? 0) > 0 ||
    (request.filters?.fieldsOfStudy?.length ?? 0) > 0 ||
    (request.filters?.venue?.length ?? 0) > 0 ||
    typeof request.filters?.minCitationCount === "number"
  );
}

function buildBibtexKey(paper: SemanticScholarPaper): string {
  const base = paper.doi || paper.paperId || "paper";
  const key = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (key) {
    return key;
  }
  return "paper";
}

function sanitizeBibValue(text: string): string {
  return text
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeS2Bibtex(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed.startsWith("@")) {
    return undefined;
  }
  return trimmed;
}
