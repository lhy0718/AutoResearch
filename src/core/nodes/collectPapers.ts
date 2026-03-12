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
import {
  buildLiteratureQueryCandidates,
  extractResearchBriefTopic,
  LiteratureQueryCandidate,
  mergeCollectConstraintDefaults
} from "../runConstraints.js";
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
  requestedQuery?: string;
  queryAttempts: CollectQueryAttemptMeta[];
  enrichment: CollectEnrichmentMeta;
  timestamp: string;
}

interface CollectQueryAttemptMeta {
  query: string;
  reason: LiteratureQueryCandidate["reason"];
  filtersRelaxed: boolean;
  fetched: number;
  attemptCount: number;
  lastStatus?: number;
  retryAfterMs?: number;
}

interface CollectEnrichmentMeta {
  blocking: false;
  status: "not_needed" | "pending" | "completed" | "failed";
  targetCount: number;
  processedCount: number;
  lastError?: string;
}

interface PlannedCollectSearch {
  request: SemanticScholarSearchRequest;
  reason: LiteratureQueryCandidate["reason"];
  filtersRelaxed: boolean;
}

interface PreparedCollectRequestPlan {
  primaryRequest: SemanticScholarSearchRequest;
  searchPlan: PlannedCollectSearch[];
  requestedQuery?: string;
}

const activeCollectEnrichmentJobs = new Map<string, Promise<void>>();

interface CollectRunRef {
  id: string;
  memoryRefs: {
    runContextPath: string;
  };
}

export async function waitForCollectEnrichmentJob(runId: string): Promise<void> {
  await activeCollectEnrichmentJobs.get(runId);
}

export async function waitForAllCollectEnrichmentJobs(): Promise<void> {
  await Promise.all(Array.from(activeCollectEnrichmentJobs.values()));
}

export function createCollectPapersNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "collect_papers",
    async execute({ run, abortSignal }) {
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
      const rawBrief = await runContextMemory.get<string>("run_brief.raw");
      const normalizedRequest = normalizeCollectRequest({
        request: requestFromContext,
        topic: run.topic,
        rawBrief,
        constraintProfile,
        configuredLimit: deps.config.papers.max_results
      });
      const mode: "replace" | "additional" =
        typeof requestFromContext?.additional === "number" && requestFromContext.additional > 0
          ? "additional"
          : "replace";
      const additionalLimit =
        mode === "additional" && typeof requestFromContext?.additional === "number" && requestFromContext.additional > 0
          ? Math.floor(requestFromContext.additional)
          : undefined;
      const existingCorpus = mode === "additional" ? await readExistingCorpus(run) : [];
      const existingEnrichmentLogs = mode === "additional" ? await readExistingEnrichmentLogs(run) : [];
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
      const currentEnrichmentLogs = new Map<string, CollectEnrichmentLogEntry>();
      const persistedEnrichmentLogs = new Map<string, CollectEnrichmentLogEntry>(
        existingEnrichmentLogs.map((entry) => [entry.paper_id, entry])
      );
      let diagnostics: SemanticScholarSearchDiagnostics = emptyCollectDiagnostics();
      const queryAttempts: CollectQueryAttemptMeta[] = [];
      let effectiveRequest = normalizedRequest.primaryRequest;

      let fetchError: string | undefined;
      for (let searchIndex = 0; searchIndex < normalizedRequest.searchPlan.length; searchIndex += 1) {
        const plannedSearch = normalizedRequest.searchPlan[searchIndex];
        effectiveRequest = plannedSearch.request;
        let searchDiagnostics = emptyCollectDiagnostics();
        let searchFetched = 0;

        try {
          const estimatedTotalBatches = Math.max(1, Math.ceil(effectiveRequest.limit / 50));
          deps.eventStream.emit({
            type: "OBS_RECEIVED",
            runId: run.id,
            node: "collect_papers",
            payload: {
              text:
                searchIndex === 0
                  ? `Searching Semantic Scholar for "${effectiveRequest.query}" (${plannedSearch.reason}).`
                  : `No papers found yet; retrying with broader query "${effectiveRequest.query}"${plannedSearch.filtersRelaxed ? " and relaxed filters" : ""}.`
            }
          });
          deps.eventStream.emit({
            type: "OBS_RECEIVED",
            runId: run.id,
            node: "collect_papers",
            payload: {
              text: `Requesting Semantic Scholar batch 1/${estimatedTotalBatches}.`
            }
          });

          let batchIndex = 0;
          for await (const batch of deps.semanticScholar.streamSearchPapers(effectiveRequest, abortSignal)) {
            batchIndex += 1;
            searchDiagnostics = deps.semanticScholar.getLastSearchDiagnostics?.() ?? searchDiagnostics;
            fetchedPapers.push(...batch);
            searchFetched += batch.length;
            let changed = false;
            for (const paper of batch) {
              const currentRow = storedRows.get(paper.paperId);
              if (!currentRow && additionalLimit !== undefined && newPaperIds.size >= additionalLimit) {
                continue;
              }
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
                request: effectiveRequest,
                resultMeta: buildCollectResultMeta({
                  request: effectiveRequest,
                  fetched: fetchedPapers.length,
                  stored: storedCount,
                  added: newPaperIds.size,
                  baseCount,
                  mode,
                  diagnostics: mergeCollectDiagnostics(diagnostics, searchDiagnostics),
                  filters: effectiveRequest.filters || {},
                  bibtexMode: normalizeBibtexMode(requestFromContext?.bibtexMode),
                  completed: false,
                  pdfRecovered,
                  bibtexEnriched,
                  enrichmentAttempts: countEnrichmentAttempts(currentEnrichmentLogs),
                  fallbackSources: Array.from(fallbackSources),
                  requestedQuery: normalizedRequest.requestedQuery,
                  queryAttempts,
                  enrichment: {
                    blocking: false,
                    status: "not_needed",
                    targetCount: 0,
                    processedCount: 0
                  }
                }),
                enrichmentLogs: Array.from(persistedEnrichmentLogs.values()),
                bibtexMode: normalizeBibtexMode(requestFromContext?.bibtexMode)
              });
              deps.eventStream.emit({
                type: "OBS_RECEIVED",
                runId: run.id,
                node: "collect_papers",
                payload: {
                  text: `Collected ${storedCount} paper(s) so far (${newPaperIds.size} new) for "${effectiveRequest.query}".`
                }
              });
            }

            deps.eventStream.emit({
              type: "OBS_RECEIVED",
              runId: run.id,
              node: "collect_papers",
              payload: {
                text: `Fetched Semantic Scholar batch ${Math.min(batchIndex, estimatedTotalBatches)}/${estimatedTotalBatches} (${batch.length} paper(s)).`
              }
            });
            if (additionalLimit !== undefined && newPaperIds.size >= additionalLimit) {
              break;
            }
            if (searchFetched < effectiveRequest.limit) {
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

          searchDiagnostics = deps.semanticScholar.getLastSearchDiagnostics?.() ?? searchDiagnostics;
          diagnostics = mergeCollectDiagnostics(diagnostics, searchDiagnostics);
          queryAttempts.push({
            query: effectiveRequest.query,
            reason: plannedSearch.reason,
            filtersRelaxed: plannedSearch.filtersRelaxed,
            fetched: searchFetched,
            attemptCount: searchDiagnostics.attemptCount,
            lastStatus: searchDiagnostics.lastStatus,
            retryAfterMs: searchDiagnostics.retryAfterMs
          });

          if (searchFetched > 0) {
            break;
          }
        } catch (error) {
          fetchError = error instanceof Error ? error.message : String(error);
          searchDiagnostics = deps.semanticScholar.getLastSearchDiagnostics?.() ?? searchDiagnostics;
          diagnostics = mergeCollectDiagnostics(diagnostics, searchDiagnostics);
          queryAttempts.push({
            query: effectiveRequest.query,
            reason: plannedSearch.reason,
            filtersRelaxed: plannedSearch.filtersRelaxed,
            fetched: searchFetched,
            attemptCount: searchDiagnostics.attemptCount,
            lastStatus: searchDiagnostics.lastStatus,
            retryAfterMs: searchDiagnostics.retryAfterMs
          });
          break;
        }
      }

      if (!fetchError) {
        await runContextMemory.put("collect_papers.requested_limit", null);
        await runContextMemory.put("collect_papers.request", null);
      }

      const bibtexMode = normalizeBibtexMode(requestFromContext?.bibtexMode);
      const zeroResultFailure =
        !fetchError && mode === "replace" && storedRows.size === 0
          ? buildCollectZeroResultsMessage(queryAttempts, normalizedRequest.requestedQuery)
          : undefined;
      const papersToEnrich = zeroResultFailure
        ? []
        : fetchedPapers.filter((paper) =>
            shouldEnrichStoredRow(storedRows.get(paper.paperId), bibtexMode)
          );

      storedCount = storedRows.size;
      const resultMeta = buildCollectResultMeta({
        request: effectiveRequest,
        fetched: fetchedPapers.length,
        stored: storedCount,
        added: newPaperIds.size,
        baseCount,
        mode,
        diagnostics,
        filters: effectiveRequest.filters || {},
        bibtexMode,
        completed: !fetchError && !zeroResultFailure,
        fetchError: fetchError || zeroResultFailure,
        pdfRecovered,
        bibtexEnriched,
        enrichmentAttempts: countEnrichmentAttempts(currentEnrichmentLogs),
        fallbackSources: Array.from(fallbackSources),
        requestedQuery: normalizedRequest.requestedQuery,
        queryAttempts,
        enrichment:
          papersToEnrich.length > 0
            ? {
                blocking: false,
                status: "pending",
                targetCount: papersToEnrich.length,
                processedCount: 0
              }
            : {
                blocking: false,
                status: "not_needed",
                targetCount: 0,
                processedCount: 0
              }
      });

      await persistCollectSnapshot({
        run,
        rows: Array.from(storedRows.values()),
        mode,
        request: effectiveRequest,
        resultMeta,
        enrichmentLogs: Array.from(persistedEnrichmentLogs.values()),
        bibtexMode
      });

      await syncCollectRunContext({
        runContextMemory,
        request: effectiveRequest,
        resultMeta,
        diagnostics
      });
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
      if (fetchError || zeroResultFailure) {
        // syncCollectRunContext already persisted the fetch/zero-result error.
      } else {
        await longTermStore.append({
          runId: run.id,
          category: "papers",
          text: `Collected ${storedCount} papers for ${effectiveRequest.query}`,
          tags: ["collect_papers", effectiveRequest.query]
        });
      }

      deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "collect_papers",
        payload: {
          source: "semantic_scholar",
          papers: storedCount,
          query: effectiveRequest.query,
          requested_limit: effectiveRequest.limit,
          fetch_error: fetchError || zeroResultFailure
        }
      });

      if (fetchError) {
        const failureMessage = buildCollectFailureMessage(effectiveRequest, fetchError);
        return {
          status: "failure",
          error: failureMessage,
          summary: failureMessage,
          toolCallsUsed: 1
        };
      }

      if (zeroResultFailure) {
        return {
          status: "failure",
          error: zeroResultFailure,
          summary: zeroResultFailure,
          toolCallsUsed: 1
        };
      }

      if (papersToEnrich.length > 0) {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "collect_papers",
          payload: {
            text: `Corpus saved with ${storedCount} paper(s). Deferred enrichment is scheduled in the background for ${papersToEnrich.length} paper(s).`
          }
        });

        startDetachedEnrichment({
          deps,
          run,
          request: effectiveRequest,
          mode,
          baseCount,
          bibtexMode,
          papers: papersToEnrich,
          fetchedCount: fetchedPapers.length,
          diagnostics,
          storedRows,
          pdfRecovered,
          bibtexEnriched,
          fallbackSources,
          currentEnrichmentLogs,
          persistedEnrichmentLogs,
          storedCount,
          newPaperIds,
          pendingSummary: buildCollectSummary(resultMeta),
          requestedQuery: normalizedRequest.requestedQuery,
          queryAttempts
        });
      }

      return {
        status: "success",
        summary: buildCollectSummary(resultMeta),
        needsApproval: true,
        toolCallsUsed: 1
      };
    }
  };
}

function normalizeCollectRequest(input: {
  request?: CollectPapersNodeRequest;
  topic: string;
  rawBrief?: string;
  constraintProfile: { collect: CollectPapersNodeRequest["filters"] };
  configuredLimit: number;
}): PreparedCollectRequestPlan {
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
  const sortField = request?.sort?.field ?? "relevance";
  const sortOrder = request?.sort?.order ?? (sortField === "paperId" ? "asc" : "desc");
  const requestedQuery = request?.query?.trim() || undefined;
  const briefTopic = extractResearchBriefTopic(input.rawBrief);
  const queryCandidates = buildLiteratureQueryCandidates({
    requestedQuery,
    runTopic: input.topic,
    briefTopic
  });
  const mergedFilters = buildSemanticScholarFilters(
    mergeCollectConstraintDefaults(request?.filters, input.constraintProfile.collect)
  );
  const explicitFilters = buildSemanticScholarFilters(request?.filters);
  const sort = {
    field: sortField,
    order: sortOrder
  } as const;
  const searchPlan: PlannedCollectSearch[] = [];
  const seen = new Set<string>();
  const pushSearch = (
    query: string,
    reason: LiteratureQueryCandidate["reason"],
    filters: SemanticScholarSearchFilters,
    filtersRelaxed: boolean
  ) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return;
    }
    const candidateRequest: SemanticScholarSearchRequest = {
      query: normalizedQuery,
      limit,
      sort,
      filters
    };
    const key = `${normalizedQuery.toLowerCase()}::${serializeSearchFilters(filters)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    searchPlan.push({
      request: candidateRequest,
      reason,
      filtersRelaxed
    });
  };

  for (const candidate of queryCandidates) {
    pushSearch(candidate.query, candidate.reason, mergedFilters, false);
  }
  if (!sameSearchFilters(mergedFilters, explicitFilters)) {
    for (const candidate of queryCandidates) {
      pushSearch(candidate.query, candidate.reason, explicitFilters, true);
    }
  }
  if (searchPlan.length === 0) {
    pushSearch(input.topic.trim(), "run_topic", mergedFilters, false);
  }

  return {
    primaryRequest: searchPlan[0].request,
    searchPlan: searchPlan.slice(0, 8),
    requestedQuery
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

function buildCollectSummary(resultMeta: CollectResultMeta): string {
  const storedSummary =
    resultMeta.mode === "additional"
      ? `Semantic Scholar stored ${resultMeta.stored} total papers for "${resultMeta.query}" (${resultMeta.added} newly added).`
      : `Semantic Scholar stored ${resultMeta.stored} papers for "${resultMeta.query}".`;

  switch (resultMeta.enrichment.status) {
    case "pending":
      return resultMeta.enrichment.processedCount > 0
        ? `${storedSummary} Deferred enrichment continues in background for ${resultMeta.enrichment.targetCount} paper(s) (${Math.min(
            resultMeta.enrichment.processedCount,
            resultMeta.enrichment.targetCount
          )}/${resultMeta.enrichment.targetCount} processed).`
        : `${storedSummary} Deferred enrichment scheduled in background for ${resultMeta.enrichment.targetCount} paper(s).`;
    case "completed":
      return `${storedSummary} Deferred enrichment finished for ${resultMeta.enrichment.targetCount} paper(s). PDF recovered ${resultMeta.pdfRecovered}; BibTeX enriched ${resultMeta.bibtexEnriched}.`;
    case "failed":
      return `${storedSummary} Deferred enrichment failed after ${Math.min(
        resultMeta.enrichment.processedCount,
        resultMeta.enrichment.targetCount
      )}/${resultMeta.enrichment.targetCount} paper(s): ${resultMeta.enrichment.lastError || "unknown error"}. Stored corpus remains available.`;
    case "not_needed":
    default:
      return storedSummary;
  }
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
  run: CollectRunRef;
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
  currentEnrichmentLogs: Map<string, CollectEnrichmentLogEntry>;
  persistedEnrichmentLogs: Map<string, CollectEnrichmentLogEntry>;
  storedCount: number;
  newPaperIds: Set<string>;
  requestedQuery?: string;
  queryAttempts: CollectQueryAttemptMeta[];
  writeCorpusArtifactsOnProgress: boolean;
  runContextMemory: RunContextMemory;
}): Promise<{
  pdfRecovered: number;
  bibtexEnriched: number;
  storedCount: number;
  processedCount: number;
}> {
  let processed = 0;
  let changedSinceLastPersist = false;

  const persistProgress = async () => {
    if (!changedSinceLastPersist) {
      return;
    }
    const progressMeta = buildCollectResultMeta({
      request: input.request,
      fetched: input.fetchedCount,
      stored: input.storedCount,
      added: input.newPaperIds.size,
      baseCount: input.baseCount,
      mode: input.mode,
      diagnostics: input.diagnostics,
      filters: input.request.filters || {},
      bibtexMode: input.bibtexMode,
      completed: true,
      pdfRecovered: input.pdfRecovered,
      bibtexEnriched: input.bibtexEnriched,
      enrichmentAttempts: countEnrichmentAttempts(input.currentEnrichmentLogs),
      fallbackSources: Array.from(input.fallbackSources),
      requestedQuery: input.requestedQuery,
      queryAttempts: input.queryAttempts,
      enrichment: {
        blocking: false,
        status: "pending",
        targetCount: input.papers.length,
        processedCount: processed
      }
    });
    await persistCollectSnapshot({
      run: input.run,
      rows: Array.from(input.storedRows.values()),
      mode: input.mode,
      request: input.request,
      resultMeta: progressMeta,
      enrichmentLogs: Array.from(input.persistedEnrichmentLogs.values()),
      bibtexMode: input.bibtexMode,
      writeCorpusArtifacts: input.writeCorpusArtifactsOnProgress
    });
    await syncCollectRunContext({
      runContextMemory: input.runContextMemory,
      request: input.request,
      resultMeta: progressMeta,
      diagnostics: input.diagnostics
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
      input.currentEnrichmentLogs.set(paper.paperId, enriched.log);
      input.persistedEnrichmentLogs.set(paper.paperId, enriched.log);
      enrichedRow = mergeStoredCorpusRows(currentRow, enriched.row);
    } catch (error) {
      const failedLog = {
        paper_id: paper.paperId,
        attempts: [],
        errors: [error instanceof Error ? error.message : String(error)]
      };
      input.currentEnrichmentLogs.set(paper.paperId, failedLog);
      input.persistedEnrichmentLogs.set(paper.paperId, failedLog);
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
    storedCount: input.storedCount,
    processedCount: processed
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

async function readExistingEnrichmentLogs(run: { id: string }): Promise<CollectEnrichmentLogEntry[]> {
  const raw = await safeRead(`.autolabos/runs/${run.id}/collect_enrichment.jsonl`);
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as CollectEnrichmentLogEntry;
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is CollectEnrichmentLogEntry => Boolean(entry?.paper_id));
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
  enrichmentAttempts: number;
  fallbackSources: string[];
  requestedQuery?: string;
  queryAttempts: CollectQueryAttemptMeta[];
  enrichment: CollectEnrichmentMeta;
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
    fallbackAttempts: input.enrichmentAttempts,
    fallbackSources: input.fallbackSources,
    requestedQuery: input.requestedQuery,
    queryAttempts: input.queryAttempts,
    enrichment: input.enrichment,
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
  writeCorpusArtifacts?: boolean;
}): Promise<void> {
  await writeRunArtifact(input.run as any, "collect_request.json", JSON.stringify(input.request, null, 2));
  await writeRunArtifact(input.run as any, "collect_result.json", JSON.stringify(input.resultMeta, null, 2));
  await appendJsonl(input.run as any, "collect_enrichment.jsonl", input.enrichmentLogs);
  if (input.writeCorpusArtifacts === false) {
    return;
  }
  const shouldWriteArtifacts =
    input.resultMeta.completed || input.mode === "additional" || input.rows.length > 0;
  if (!shouldWriteArtifacts) {
    return;
  }

  await appendJsonl(input.run as any, "corpus.jsonl", input.rows);
  const bibtex = buildBibtexFile(input.rows, input.bibtexMode).trim();
  await writeRunArtifact(input.run as any, "bibtex.bib", bibtex ? `${bibtex}\n` : "");
}

async function syncCollectRunContext(input: {
  runContextMemory: RunContextMemory;
  request: SemanticScholarSearchRequest;
  resultMeta: CollectResultMeta;
  diagnostics: SemanticScholarSearchDiagnostics;
}): Promise<void> {
  await input.runContextMemory.put("collect_papers.last_request", input.request);
  await input.runContextMemory.put("collect_papers.last_result", input.resultMeta);
  await input.runContextMemory.put("collect_papers.last_attempt_count", input.diagnostics.attemptCount);
  await input.runContextMemory.put("collect_papers.count", input.resultMeta.stored);
  await input.runContextMemory.put("collect_papers.source", "semantic_scholar");
  await input.runContextMemory.put("collect_papers.last_error", deriveCollectRunContextError(input.resultMeta));
  await input.runContextMemory.put(
    "collect_papers.enrichment_last_error",
    input.resultMeta.enrichment.status === "failed" ? input.resultMeta.enrichment.lastError || null : null
  );
}

function deriveCollectRunContextError(resultMeta: CollectResultMeta): string | null {
  return resultMeta.fetchError || null;
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

function countEnrichmentAttempts(entries: Map<string, CollectEnrichmentLogEntry>): number {
  let count = 0;
  for (const entry of entries.values()) {
    count += entry.attempts.length;
  }
  return count;
}

function mergeCollectDiagnostics(
  previous: SemanticScholarSearchDiagnostics,
  next: SemanticScholarSearchDiagnostics
): SemanticScholarSearchDiagnostics {
  return {
    attemptCount: previous.attempts.length + next.attempts.length,
    lastStatus: next.lastStatus ?? previous.lastStatus,
    retryAfterMs: next.retryAfterMs ?? previous.retryAfterMs,
    attempts: [...previous.attempts.map((attempt) => ({ ...attempt })), ...next.attempts.map((attempt) => ({ ...attempt }))]
  };
}

function serializeSearchFilters(filters: SemanticScholarSearchFilters | undefined): string {
  return JSON.stringify({
    publicationTypes: [...(filters?.publicationTypes || [])],
    openAccessPdf: filters?.openAccessPdf === true,
    minCitationCount: filters?.minCitationCount,
    publicationDateOrYear: filters?.publicationDateOrYear,
    year: filters?.year,
    venue: [...(filters?.venue || [])],
    fieldsOfStudy: [...(filters?.fieldsOfStudy || [])]
  });
}

function sameSearchFilters(a: SemanticScholarSearchFilters | undefined, b: SemanticScholarSearchFilters | undefined): boolean {
  return serializeSearchFilters(a) === serializeSearchFilters(b);
}

function buildCollectZeroResultsMessage(
  queryAttempts: CollectQueryAttemptMeta[],
  requestedQuery?: string
): string {
  const attempted = queryAttempts
    .map((attempt) => `"${attempt.query}"${attempt.filtersRelaxed ? " (relaxed filters)" : ""}`)
    .join(", ");
  const requested = requestedQuery ? ` Requested query was "${requestedQuery}".` : "";
  const queries = attempted ? ` Tried ${queryAttempts.length} query variant(s): ${attempted}.` : "";
  return `Semantic Scholar returned 0 papers after automatic fallback broadening.${requested}${queries}`;
}

function startDetachedEnrichment(input: {
  deps: NodeExecutionDeps;
  run: CollectRunRef;
  request: SemanticScholarSearchRequest;
  mode: "replace" | "additional";
  baseCount: number;
  bibtexMode: BibtexMode;
  papers: SemanticScholarPaper[];
  fetchedCount: number;
  diagnostics: SemanticScholarSearchDiagnostics;
  storedRows: Map<string, StoredCorpusRow>;
  pdfRecovered: number;
  bibtexEnriched: number;
  fallbackSources: Set<string>;
  currentEnrichmentLogs: Map<string, CollectEnrichmentLogEntry>;
  persistedEnrichmentLogs: Map<string, CollectEnrichmentLogEntry>;
  storedCount: number;
  newPaperIds: Set<string>;
  pendingSummary: string;
  requestedQuery?: string;
  queryAttempts: CollectQueryAttemptMeta[];
}): void {
  if (input.papers.length === 0) {
    return;
  }
  if (activeCollectEnrichmentJobs.has(input.run.id)) {
    input.deps.eventStream.emit({
      type: "OBS_RECEIVED",
      runId: input.run.id,
      node: "collect_papers",
      payload: {
        text: "Deferred enrichment is already running for this run."
      }
    });
    return;
  }

  const runContextMemory = new RunContextMemory(input.run.memoryRefs.runContextPath);
  input.deps.eventStream.emit({
    type: "OBS_RECEIVED",
    runId: input.run.id,
    node: "collect_papers",
    payload: {
      text: `Starting deferred enrichment for ${input.papers.length} paper(s) with concurrency ${Math.min(
        ENRICHMENT_CONCURRENCY,
        input.papers.length
      )}.`
    }
  });

  const job = (async () => {
    try {
      const enrichmentState = await runEnrichmentPass({
        papers: input.papers,
        storedRows: input.storedRows,
        run: input.run,
        request: input.request,
        fetchedCount: input.fetchedCount,
        mode: input.mode,
        baseCount: input.baseCount,
        diagnostics: input.diagnostics,
        bibtexMode: input.bibtexMode,
        requireOpenAccessPdf: input.request.filters?.openAccessPdf === true,
        eventStream: input.deps.eventStream,
        pdfRecovered: input.pdfRecovered,
        bibtexEnriched: input.bibtexEnriched,
        fallbackSources: input.fallbackSources,
        currentEnrichmentLogs: input.currentEnrichmentLogs,
        persistedEnrichmentLogs: input.persistedEnrichmentLogs,
        storedCount: input.storedCount,
        newPaperIds: input.newPaperIds,
        requestedQuery: input.requestedQuery,
        queryAttempts: input.queryAttempts,
        writeCorpusArtifactsOnProgress: false,
        runContextMemory
      });

      const completionMeta = buildCollectResultMeta({
        request: input.request,
        fetched: input.fetchedCount,
        stored: enrichmentState.storedCount,
        added: input.newPaperIds.size,
        baseCount: input.baseCount,
        mode: input.mode,
        diagnostics: input.diagnostics,
        filters: input.request.filters || {},
        bibtexMode: input.bibtexMode,
        completed: true,
        pdfRecovered: enrichmentState.pdfRecovered,
        bibtexEnriched: enrichmentState.bibtexEnriched,
        enrichmentAttempts: countEnrichmentAttempts(input.currentEnrichmentLogs),
        fallbackSources: Array.from(input.fallbackSources),
        requestedQuery: input.requestedQuery,
        queryAttempts: input.queryAttempts,
        enrichment: {
          blocking: false,
          status: "completed",
          targetCount: input.papers.length,
          processedCount: enrichmentState.processedCount
        }
      });

      await persistCollectSnapshot({
        run: input.run,
        rows: Array.from(input.storedRows.values()),
        mode: input.mode,
        request: input.request,
        resultMeta: completionMeta,
        enrichmentLogs: Array.from(input.persistedEnrichmentLogs.values()),
        bibtexMode: input.bibtexMode
      });
      await syncCollectRunContext({
        runContextMemory,
        request: input.request,
        resultMeta: completionMeta,
        diagnostics: input.diagnostics
      });
      await syncCollectRunRecord({
        runStore: input.deps.runStore,
        runId: input.run.id,
        summary: buildCollectSummary(completionMeta),
        replaceLatestSummaryIf: input.pendingSummary
      });

      input.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: input.run.id,
        node: "collect_papers",
        payload: {
          text: `Deferred enrichment finished for ${input.papers.length} paper(s). PDF recovered ${enrichmentState.pdfRecovered}; BibTeX enriched ${enrichmentState.bibtexEnriched}.`
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureMeta = buildCollectResultMeta({
        request: input.request,
        fetched: input.fetchedCount,
        stored: input.storedCount,
        added: input.newPaperIds.size,
        baseCount: input.baseCount,
        mode: input.mode,
        diagnostics: input.diagnostics,
        filters: input.request.filters || {},
        bibtexMode: input.bibtexMode,
        completed: true,
        pdfRecovered: input.pdfRecovered,
        bibtexEnriched: input.bibtexEnriched,
        enrichmentAttempts: countEnrichmentAttempts(input.currentEnrichmentLogs),
        fallbackSources: Array.from(input.fallbackSources),
        requestedQuery: input.requestedQuery,
        queryAttempts: input.queryAttempts,
        enrichment: {
          blocking: false,
          status: "failed",
          targetCount: input.papers.length,
          processedCount: input.currentEnrichmentLogs.size,
          lastError: message
        }
      });

      await persistCollectSnapshot({
        run: input.run,
        rows: Array.from(input.storedRows.values()),
        mode: input.mode,
        request: input.request,
        resultMeta: failureMeta,
        enrichmentLogs: Array.from(input.persistedEnrichmentLogs.values()),
        bibtexMode: input.bibtexMode,
        writeCorpusArtifacts: false
      });
      await syncCollectRunContext({
        runContextMemory,
        request: input.request,
        resultMeta: failureMeta,
        diagnostics: input.diagnostics
      });
      await syncCollectRunRecord({
        runStore: input.deps.runStore,
        runId: input.run.id,
        summary: buildCollectSummary(failureMeta),
        replaceLatestSummaryIf: input.pendingSummary
      });

      input.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: input.run.id,
        node: "collect_papers",
        payload: {
          text: `Deferred enrichment failed: ${message}`
        }
      });
    } finally {
      activeCollectEnrichmentJobs.delete(input.run.id);
    }
  })();

  activeCollectEnrichmentJobs.set(input.run.id, job);
}

async function syncCollectRunRecord(input: {
  runStore: Pick<NodeExecutionDeps["runStore"], "getRun" | "updateRun"> | undefined;
  runId: string;
  summary: string;
  replaceLatestSummaryIf?: string;
}): Promise<void> {
  if (
    !input.runStore ||
    typeof input.runStore.getRun !== "function" ||
    typeof input.runStore.updateRun !== "function"
  ) {
    return;
  }

  const run = await input.runStore.getRun(input.runId);
  if (!run) {
    return;
  }

  run.graph.nodeStates.collect_papers = {
    ...run.graph.nodeStates.collect_papers,
    updatedAt: new Date().toISOString(),
    note: input.summary
  };

  if (
    run.currentNode === "collect_papers" ||
    !run.latestSummary ||
    run.latestSummary === input.replaceLatestSummaryIf
  ) {
    run.latestSummary = input.summary;
  }

  await input.runStore.updateRun(run);
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
