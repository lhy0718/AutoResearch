import { GraphNodeHandler } from "../stateGraph/types.js";
import { appendJsonl, safeRead, writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { LongTermStore } from "../memory/longTermStore.js";
import {
  SemanticScholarAttemptRecord,
  SemanticScholarPaper,
  SemanticScholarSearchFilters,
  SemanticScholarSearchDiagnostics,
  SemanticScholarSearchRequest
} from "../../tools/semanticScholar.js";
import { BibtexMode } from "../commands/collectOptions.js";
import { mergeCollectConstraintDefaults } from "../runConstraints.js";
import { resolveConstraintProfile } from "../constraintProfile.js";
export { buildBibtexEntry, buildBibtexFile } from "../collection/bibtex.js";
import { buildBibtexFile, normalizeS2Bibtex, scoreBibtexRichness } from "../collection/bibtex.js";
import { enrichCollectedPaper, mergeStoredCorpusRows } from "../collection/enrichment.js";
import { CollectEnrichmentLogEntry, StoredCorpusRow } from "../collection/types.js";

const ENRICHMENT_CONCURRENCY = 6;
const ENRICHMENT_PROGRESS_INTERVAL = 10;

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
  stored: number;
  added: number;
  baseCount: number;
  completed: boolean;
  mode: "replace" | "additional";
  source: "semantic_scholar";
  fetchError?: string;
  attemptCount: number;
  lastStatus?: number;
  retryAfterMs?: number;
  attempts: SemanticScholarAttemptRecord[];
  sort: {
    field: "relevance" | "citationCount" | "publicationDate" | "paperId";
    order: "asc" | "desc";
  };
  filters: SemanticScholarSearchFilters;
  bibtexMode: BibtexMode;
  pdfRecovered: number;
  bibtexEnriched: number;
  fallbackAttempts: number;
  fallbackSources: string[];
  timestamp: string;
}

export function createCollectPapersNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "collect_papers",
    async execute({ run, graph, abortSignal }) {
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      const longTermStore = new LongTermStore(run.memoryRefs.longTermPath);
      const constraintProfile = await resolveConstraintProfile({
        run,
        runContextMemory,
        llm: deps.llm,
        eventStream: deps.eventStream,
        node: "collect_papers"
      });
      const requestFromContext = await runContextMemory.get<CollectPapersNodeRequest>("collect_papers.request");
      const normalizedRequest = normalizeCollectRequest({
        request: requestFromContext,
        topic: run.topic,
        constraintProfile,
        configuredLimit: deps.config.papers.max_results
      });
      const mode: "replace" | "additional" =
        typeof requestFromContext?.additional === "number" && requestFromContext.additional > 0
          ? "additional"
          : "replace";
      const existingCorpus = mode === "additional" ? await readExistingCorpus(run) : [];
      const storedRows = new Map<string, StoredCorpusRow>(
        existingCorpus.map((row) => [row.paper_id, row])
      );
      const fetchedPapers: SemanticScholarPaper[] = [];
      const newPaperIds = new Set<string>();
      const baseCount = storedRows.size;
      let storedCount = storedRows.size;
      let pdfRecovered = 0;
      let bibtexEnriched = 0;
      const fallbackSources = new Set<string>();
      const enrichmentLogs = new Map<string, CollectEnrichmentLogEntry>();
      let diagnostics: SemanticScholarSearchDiagnostics =
        deps.semanticScholar.getLastSearchDiagnostics?.() ?? emptyCollectDiagnostics();

      let fetchError: string | undefined;
      try {
        let batchIndex = 0;
        const estimatedTotalBatches = Math.max(1, Math.ceil(normalizedRequest.limit / 50));
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "collect_papers",
          payload: {
            text: `Requesting Semantic Scholar batch 1/${estimatedTotalBatches}.`
          }
        });
        for await (const batch of deps.semanticScholar.streamSearchPapers(normalizedRequest, abortSignal)) {
          batchIndex += 1;
          fetchedPapers.push(...batch);
          let changed = false;
          for (const paper of batch) {
            const currentRow = storedRows.get(paper.paperId);
            const mergedRow = mergeStoredCorpusRows(currentRow, normalizeCorpusRow(paper));
            const prevSerialized = currentRow ? JSON.stringify(currentRow) : undefined;
            const nextSerialized = JSON.stringify(mergedRow);
            if (!currentRow) {
              newPaperIds.add(paper.paperId);
              changed = true;
            } else if (prevSerialized !== nextSerialized) {
              changed = true;
            }
            storedRows.set(paper.paperId, mergedRow);
          }

          if (changed) {
            storedCount = storedRows.size;
            await persistCollectSnapshot({
              run,
              rows: Array.from(storedRows.values()),
              mode,
              request: normalizedRequest,
              resultMeta: buildCollectResultMeta({
                request: normalizedRequest,
                fetched: fetchedPapers.length,
                stored: storedCount,
                added: newPaperIds.size,
                baseCount,
                mode,
                diagnostics,
                filters: normalizedRequest.filters || {},
                bibtexMode: normalizeBibtexMode(requestFromContext?.bibtexMode),
                completed: false,
                pdfRecovered,
                bibtexEnriched,
                fallbackAttempts: countFallbackAttempts(enrichmentLogs),
                fallbackSources: Array.from(fallbackSources)
              }),
              enrichmentLogs: Array.from(enrichmentLogs.values()),
              bibtexMode: normalizeBibtexMode(requestFromContext?.bibtexMode)
            });
            deps.eventStream.emit({
              type: "OBS_RECEIVED",
              runId: run.id,
              node: "collect_papers",
              payload: {
                text: `Collected ${storedCount} paper(s) so far (${newPaperIds.size} new) for "${normalizedRequest.query}".`
              }
            });
          }

          deps.eventStream.emit({
            type: "OBS_RECEIVED",
            runId: run.id,
            node: "collect_papers",
            payload: {
              text: `Fetched Semantic Scholar batch ${Math.min(batchIndex, estimatedTotalBatches)}/${estimatedTotalBatches} (${batch.length} paper(s)). Deferred enrichment will run after fetch completes.`
            }
          });
          if (fetchedPapers.length < normalizedRequest.limit) {
            deps.eventStream.emit({
              type: "OBS_RECEIVED",
              runId: run.id,
              node: "collect_papers",
              payload: {
                text: `Requesting Semantic Scholar batch ${Math.min(batchIndex + 1, estimatedTotalBatches)}/${estimatedTotalBatches}.`
              }
            });
          }
        }
        diagnostics = deps.semanticScholar.getLastSearchDiagnostics?.() ?? diagnostics;
        await runContextMemory.put("collect_papers.requested_limit", null);
        await runContextMemory.put("collect_papers.request", null);
      } catch (error) {
        fetchError = error instanceof Error ? error.message : String(error);
        diagnostics = deps.semanticScholar.getLastSearchDiagnostics?.() ?? diagnostics;
      }

      const bibtexMode = normalizeBibtexMode(requestFromContext?.bibtexMode);
      const papersToEnrich = fetchedPapers.filter((paper) =>
        shouldEnrichStoredRow(storedRows.get(paper.paperId), bibtexMode)
      );
      if (papersToEnrich.length > 0) {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "collect_papers",
          payload: {
            text: `Starting deferred enrichment for ${papersToEnrich.length} paper(s) with concurrency ${Math.min(
              ENRICHMENT_CONCURRENCY,
              papersToEnrich.length
            )}.`
          }
        });

        const enrichmentState = await runEnrichmentPass({
          papers: papersToEnrich,
          storedRows,
          run,
          request: normalizedRequest,
          fetchedCount: fetchedPapers.length,
          mode,
          baseCount,
          diagnostics,
          bibtexMode,
          requireOpenAccessPdf: normalizedRequest.filters?.openAccessPdf === true,
          abortSignal,
          eventStream: deps.eventStream,
          pdfRecovered,
          bibtexEnriched,
          fallbackSources,
          enrichmentLogs,
          storedCount,
          newPaperIds
        });
        pdfRecovered = enrichmentState.pdfRecovered;
        bibtexEnriched = enrichmentState.bibtexEnriched;
        storedCount = enrichmentState.storedCount;
      }

      storedCount = storedRows.size;
      const resultMeta = buildCollectResultMeta({
        request: normalizedRequest,
        fetched: fetchedPapers.length,
        stored: storedCount,
        added: newPaperIds.size,
        baseCount,
        mode,
        diagnostics,
        filters: normalizedRequest.filters || {},
        bibtexMode,
        completed: !fetchError,
        fetchError,
        pdfRecovered,
        bibtexEnriched,
        fallbackAttempts: countFallbackAttempts(enrichmentLogs),
        fallbackSources: Array.from(fallbackSources)
      });

      await persistCollectSnapshot({
        run,
        rows: Array.from(storedRows.values()),
        mode,
        request: normalizedRequest,
        resultMeta,
        enrichmentLogs: Array.from(enrichmentLogs.values()),
        bibtexMode
      });

      await runContextMemory.put("collect_papers.last_request", normalizedRequest);
      await runContextMemory.put("collect_papers.last_result", resultMeta);
      await runContextMemory.put("collect_papers.last_attempt_count", diagnostics.attemptCount);
      await runContextMemory.put("collect_papers.count", storedCount);
      await runContextMemory.put("collect_papers.source", "semantic_scholar");
      if (diagnostics.attemptCount > 0) {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "collect_papers",
          payload: {
            text: `Semantic Scholar attempts: ${formatAttemptSummary(diagnostics)}`
          }
        });
      }
      if (fetchError) {
        await runContextMemory.put("collect_papers.last_error", fetchError);
      } else {
        await runContextMemory.put("collect_papers.last_error", null);
        await longTermStore.append({
          runId: run.id,
          category: "papers",
          text: `Collected ${storedCount} papers for ${normalizedRequest.query}`,
          tags: ["collect_papers", normalizedRequest.query]
        });
      }

      deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "collect_papers",
        payload: {
          source: "semantic_scholar",
          papers: storedCount,
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
        summary:
          mode === "additional"
            ? `Semantic Scholar stored ${storedCount} total papers for "${normalizedRequest.query}" (${newPaperIds.size} newly added). PDF recovered ${pdfRecovered}; BibTeX enriched ${bibtexEnriched}.`
            : `Semantic Scholar stored ${storedCount} papers for "${normalizedRequest.query}". PDF recovered ${pdfRecovered}; BibTeX enriched ${bibtexEnriched}.`,
        needsApproval: true,
        toolCallsUsed: 1
      };
    }
  };
}

function normalizeCollectRequest(input: {
  request?: CollectPapersNodeRequest;
  topic: string;
  constraintProfile: { collect: CollectPapersNodeRequest["filters"] };
  configuredLimit: number;
}): SemanticScholarSearchRequest {
  const configuredLimit = Math.max(1, input.configuredLimit);
  const request = input.request;
  const requestedLimitFromCommand =
    typeof request?.limit === "number" && Number.isFinite(request.limit) && request.limit > 0
      ? Math.floor(request.limit)
      : undefined;
  const requestedAdditional =
    typeof request?.additional === "number" && Number.isFinite(request.additional) && request.additional > 0
      ? Math.floor(request.additional)
      : undefined;

  const limit = requestedLimitFromCommand ?? requestedAdditional ?? configuredLimit;
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
    filters: buildSemanticScholarFilters(
      mergeCollectConstraintDefaults(request?.filters, input.constraintProfile.collect)
    )
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
    publicationTypes: sanitizePublicationTypes(filters.publicationTypes),
    openAccessPdf: filters.openAccessPdf === true,
    minCitationCount: filters.minCitationCount,
    publicationDateOrYear,
    year: publicationDateOrYear ? undefined : filters.year,
    venue: filters.venues?.filter(Boolean),
    fieldsOfStudy: filters.fieldsOfStudy?.filter(Boolean)
  };
}

function sanitizePublicationTypes(types: string[] | undefined): string[] | undefined {
  const normalized = types
    ?.map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !["paper", "papers", "article", "articles"].includes(value.toLowerCase()));
  return normalized && normalized.length > 0 ? normalized : undefined;
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
      ? " AutoLabOS already switched this request to smaller Semantic Scholar chunks."
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

function normalizeCorpusRow(paper: SemanticScholarPaper): StoredCorpusRow {
  return {
    paper_id: paper.paperId,
    title: paper.title,
    abstract: paper.abstract || "",
    year: paper.year,
    venue: paper.venue,
    url: paper.url,
    landing_url: isSemanticScholarUrl(paper.url) ? undefined : paper.url,
    pdf_url: paper.openAccessPdfUrl,
    pdf_url_source: paper.openAccessPdfUrl ? "semantic_scholar" : undefined,
    authors: paper.authors,
    citation_count: paper.citationCount,
    influential_citation_count: paper.influentialCitationCount,
    publication_date: paper.publicationDate,
    publication_types: paper.publicationTypes,
    fields_of_study: paper.fieldsOfStudy,
    doi: paper.doi,
    arxiv_id: paper.arxivId,
    semantic_scholar_bibtex: normalizeS2Bibtex(paper.citationStylesBibtex)
  };
}

function shouldEnrichStoredRow(row: StoredCorpusRow | undefined, bibtexMode: BibtexMode): boolean {
  if (!row) {
    return false;
  }
  if (!row.pdf_url) {
    return true;
  }
  if (bibtexMode !== "hybrid") {
    return false;
  }
  const currentBibtex = row.bibtex || row.semantic_scholar_bibtex;
  if (!currentBibtex) {
    return true;
  }
  return scoreBibtexRichness(currentBibtex) < 10 && Boolean(row.doi || row.arxiv_id || row.landing_url);
}

async function runEnrichmentPass(input: {
  papers: SemanticScholarPaper[];
  storedRows: Map<string, StoredCorpusRow>;
  run: { id: string };
  request: SemanticScholarSearchRequest;
  fetchedCount: number;
  mode: "replace" | "additional";
  baseCount: number;
  diagnostics: SemanticScholarSearchDiagnostics;
  bibtexMode: BibtexMode;
  requireOpenAccessPdf: boolean;
  abortSignal?: AbortSignal;
  eventStream: NodeExecutionDeps["eventStream"];
  pdfRecovered: number;
  bibtexEnriched: number;
  fallbackSources: Set<string>;
  enrichmentLogs: Map<string, CollectEnrichmentLogEntry>;
  storedCount: number;
  newPaperIds: Set<string>;
}): Promise<{
  pdfRecovered: number;
  bibtexEnriched: number;
  storedCount: number;
}> {
  let processed = 0;
  let changedSinceLastPersist = false;

  const persistProgress = async () => {
    if (!changedSinceLastPersist) {
      return;
    }
    await persistCollectSnapshot({
      run: input.run,
      rows: Array.from(input.storedRows.values()),
      mode: input.mode,
      request: input.request,
        resultMeta: buildCollectResultMeta({
          request: input.request,
          fetched: input.fetchedCount,
        stored: input.storedCount,
        added: input.newPaperIds.size,
        baseCount: input.baseCount,
        mode: input.mode,
        diagnostics: input.diagnostics,
        filters: input.request.filters || {},
        bibtexMode: input.bibtexMode,
        completed: false,
        pdfRecovered: input.pdfRecovered,
        bibtexEnriched: input.bibtexEnriched,
        fallbackAttempts: countFallbackAttempts(input.enrichmentLogs),
        fallbackSources: Array.from(input.fallbackSources)
      }),
      enrichmentLogs: Array.from(input.enrichmentLogs.values()),
      bibtexMode: input.bibtexMode
    });
    changedSinceLastPersist = false;
  };

  await runWithConcurrency(input.papers, ENRICHMENT_CONCURRENCY, async (paper) => {
    if (input.abortSignal?.aborted) {
      return;
    }
    const currentRow = input.storedRows.get(paper.paperId);
    if (!currentRow) {
      return;
    }

    let enrichedRow = currentRow;
    try {
      const enriched = await enrichCollectedPaper({
        paper,
        row: currentRow,
        bibtexMode: input.bibtexMode,
        requireOpenAccessPdf: input.requireOpenAccessPdf,
        abortSignal: input.abortSignal,
        onProgress: (message) =>
          input.eventStream.emit({
            type: "OBS_RECEIVED",
            runId: input.run.id,
            node: "collect_papers",
            payload: {
              text: `[${paper.paperId}] ${message}`
            }
          })
      });

      if (enriched.pdfRecovered) {
        input.pdfRecovered += 1;
      }
      if (enriched.bibtexEnriched) {
        input.bibtexEnriched += 1;
      }
      for (const source of enriched.fallbackSources) {
        input.fallbackSources.add(source);
      }
      input.enrichmentLogs.set(paper.paperId, enriched.log);
      enrichedRow = mergeStoredCorpusRows(currentRow, enriched.row);
    } catch (error) {
      input.enrichmentLogs.set(paper.paperId, {
        paper_id: paper.paperId,
        attempts: [],
        errors: [error instanceof Error ? error.message : String(error)]
      });
    }

    const previous = JSON.stringify(currentRow);
    const next = JSON.stringify(enrichedRow);
    if (previous !== next) {
      input.storedRows.set(paper.paperId, enrichedRow);
      input.storedCount = input.storedRows.size;
      changedSinceLastPersist = true;
    }

    processed += 1;
    if (
      processed === 1 ||
      processed === input.papers.length ||
      processed % ENRICHMENT_PROGRESS_INTERVAL === 0
    ) {
      input.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: input.run.id,
        node: "collect_papers",
        payload: {
          text: `Collect enrichment progress: processed ${processed}/${input.papers.length}, stored ${input.storedCount}/${input.request.limit}.`
        }
      });
      await persistProgress();
    }
  });

  await persistProgress();
  return {
    pdfRecovered: input.pdfRecovered,
    bibtexEnriched: input.bibtexEnriched,
    storedCount: input.storedCount
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function readExistingCorpus(run: { id: string }): Promise<StoredCorpusRow[]> {
  const raw = await safeRead(`.autolabos/runs/${run.id}/corpus.jsonl`);
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as StoredCorpusRow;
      } catch {
        return undefined;
      }
    })
    .filter((row): row is StoredCorpusRow => Boolean(row?.paper_id));
}

function buildCollectResultMeta(input: {
  request: SemanticScholarSearchRequest;
  fetched: number;
  stored: number;
  added: number;
  baseCount: number;
  mode: "replace" | "additional";
  diagnostics: SemanticScholarSearchDiagnostics;
  filters: SemanticScholarSearchFilters;
  bibtexMode: BibtexMode;
  completed: boolean;
  fetchError?: string;
  pdfRecovered: number;
  bibtexEnriched: number;
  fallbackAttempts: number;
  fallbackSources: string[];
}): CollectResultMeta {
  return {
    query: input.request.query,
    limit: input.request.limit,
    fetched: input.fetched,
    stored: input.stored,
    added: input.added,
    baseCount: input.baseCount,
    completed: input.completed,
    mode: input.mode,
    source: "semantic_scholar",
    fetchError: input.fetchError,
    attemptCount: input.diagnostics.attemptCount,
    lastStatus: input.diagnostics.lastStatus,
    retryAfterMs: input.diagnostics.retryAfterMs,
    attempts: input.diagnostics.attempts,
    sort: {
      field: input.request.sort?.field ?? "relevance",
      order: input.request.sort?.order ?? "desc"
    },
    filters: input.filters,
    bibtexMode: input.bibtexMode,
    pdfRecovered: input.pdfRecovered,
    bibtexEnriched: input.bibtexEnriched,
    fallbackAttempts: input.fallbackAttempts,
    fallbackSources: input.fallbackSources,
    timestamp: new Date().toISOString()
  };
}

async function persistCollectSnapshot(input: {
  run: { id: string };
  rows: StoredCorpusRow[];
  mode: "replace" | "additional";
  request: SemanticScholarSearchRequest;
  resultMeta: CollectResultMeta;
  enrichmentLogs: CollectEnrichmentLogEntry[];
  bibtexMode: BibtexMode;
}): Promise<void> {
  await writeRunArtifact(input.run as any, "collect_request.json", JSON.stringify(input.request, null, 2));
  await writeRunArtifact(input.run as any, "collect_result.json", JSON.stringify(input.resultMeta, null, 2));
  await appendJsonl(input.run as any, "collect_enrichment.jsonl", input.enrichmentLogs);
  const shouldWriteArtifacts =
    input.resultMeta.completed || input.mode === "additional" || input.rows.length > 0;
  if (!shouldWriteArtifacts) {
    return;
  }

  await appendJsonl(input.run as any, "corpus.jsonl", input.rows);
  const bibtex = buildBibtexFile(input.rows, input.bibtexMode).trim();
  await writeRunArtifact(input.run as any, "bibtex.bib", bibtex ? `${bibtex}\n` : "");
}

function emptyCollectDiagnostics(): SemanticScholarSearchDiagnostics {
  return {
    attemptCount: 0,
    attempts: []
  };
}

function formatAttemptSummary(diagnostics: SemanticScholarSearchDiagnostics): string {
  if (diagnostics.attemptCount === 0) {
    return "0";
  }
  const allFirstAttemptSuccess = diagnostics.attempts.every((attempt) => attempt.attempt === 1 && attempt.ok);
  if (allFirstAttemptSuccess) {
    return `${diagnostics.attempts.length} request(s) succeeded on the first attempt.`;
  }

  return diagnostics.attempts
    .map((attempt, index) => {
      const status = attempt.status ? String(attempt.status) : "network";
      const retry = attempt.retryAfterMs ? ` retry-after=${attempt.retryAfterMs}ms` : "";
      const outcome = attempt.ok ? "ok" : "failed";
      return `req${index + 1} attempt${attempt.attempt}=${status} ${outcome}${retry}`;
    })
    .join(", ");
}

function countFallbackAttempts(entries: Map<string, CollectEnrichmentLogEntry>): number {
  let count = 0;
  for (const entry of entries.values()) {
    count += entry.attempts.length;
  }
  return count;
}

function isSemanticScholarUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  try {
    return new URL(url).hostname.toLowerCase().endsWith("semanticscholar.org");
  } catch {
    return false;
  }
}
