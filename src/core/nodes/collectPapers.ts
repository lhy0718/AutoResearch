import { GraphNodeHandler } from "../stateGraph/types.js";
import { appendJsonl, safeRead, writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { resolveGeneratedLiteratureQueries } from "../literatureQueryGeneration.js";
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
  hasSemanticScholarSpecialSyntax,
  LiteratureQueryCandidate,
  mergeCollectConstraintDefaults
} from "../runConstraints.js";
import { resolveConstraintProfile } from "../constraintProfile.js";
export { buildBibtexEntry, buildBibtexFile } from "../collection/bibtex.js";
import { buildBibtexFile, scoreBibtexRichness } from "../collection/bibtex.js";
import { enrichCollectedPaper, mergeStoredCorpusRows } from "../collection/enrichment.js";
import {
  AggregatedSearchPaper,
  CollectEnrichmentLogEntry,
  PaperSearchAggregationReport,
  PaperSearchProvider,
  PaperSearchProviderDiagnostics,
  StoredCorpusRow
} from "../collection/types.js";
import {
  AggregatedSearchRecord,
  createSemanticScholarSearchProvider,
  runAggregatedPaperSearch,
  SearchProviderClient
} from "../collection/searchAggregation.js";
import { loadGovernancePolicy } from "../../governance/policyLoader.js";
import { ScreeningReport, screenEvidence } from "../../governance/evidenceIntakeFilter.js";
import { appendGovernanceTrace } from "../../governance/governanceTrace.js";

const ENRICHMENT_CONCURRENCY = 6;
const ENRICHMENT_PROGRESS_INTERVAL = 10;
const LIGHTWEIGHT_TAIL_MIN_ROWS = 6;
const LIGHTWEIGHT_TAIL_MAX_ROWS = 12;
const LOW_YIELD_QUERY_MIN_RESULTS = 3;

const COLLECT_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "based",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "study",
  "the",
  "to",
  "using",
  "with"
]);

const LIGHTWEIGHT_TABULAR_SCOPE_TOKENS = new Set([
  "baseline",
  "baselines",
  "benchmark",
  "benchmarks",
  "classification",
  "classifier",
  "classifiers",
  "cpu",
  "dataset",
  "datasets",
  "lightweight",
  "logistic",
  "public",
  "regression",
  "resource",
  "small"
]);

const LIGHTWEIGHT_TABULAR_REQUIRED_TOKENS = new Set(["tabular", "structured"]);
const LIGHTWEIGHT_TABULAR_SUPPORT_TOKENS = new Set([
  "baseline",
  "baselines",
  "benchmark",
  "benchmarks",
  "classification",
  "classifier",
  "classifiers",
  "dataset",
  "datasets",
  "forest",
  "forests",
  "gradient",
  "lightgbm",
  "logistic",
  "public",
  "random",
  "regression",
  "small",
  "structured",
  "svm",
  "tabular",
  "tree",
  "trees",
  "xgboost"
]);

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
  source: "semantic_scholar" | "aggregated";
  providers?: PaperSearchProvider[];
  rawCandidateCount?: number;
  canonicalCount?: number;
  providerDiagnostics?: PaperSearchProviderDiagnostics[];
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
  governance_warnings?: CollectGovernanceWarning[];
  timestamp: string;
}

interface CollectGovernanceWarning {
  paper_id: string;
  source: string;
  triggeredRules: string[];
  excerpt: string | null;
  recommendation: string;
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
  attemptedCount?: number;
  updatedCount?: number;
  lastError?: string;
}

interface PlannedCollectSearch {
  request: SemanticScholarSearchRequest;
  reason: LiteratureQueryCandidate["reason"];
  filtersRelaxed: boolean;
}

interface PreparedCollectRequestPlan {
  primaryRequest?: SemanticScholarSearchRequest;
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

interface CollectBackgroundJobRecord {
  version: 1;
  kind: "collect_deferred_enrichment";
  status: "running" | "completed" | "failed";
  runId: string;
  request: SemanticScholarSearchRequest;
  mode: "replace" | "additional";
  baseCount: number;
  bibtexMode: BibtexMode;
  paperIds: string[];
  fetchedCount: number;
  diagnostics: SemanticScholarSearchDiagnostics;
  newPaperIds: string[];
  pendingSummary: string;
  requestedQuery?: string;
  queryAttempts: CollectQueryAttemptMeta[];
  scheduledAt: string;
  updatedAt: string;
  recoveryCount: number;
  lastRecoveredAt?: string;
  lastError?: string;
}

const COLLECT_BACKGROUND_JOB_FILE = "collect_background_job.json";

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
      const extractedBrief = await runContextMemory.get<{ topic?: string }>("run_brief.extracted");
      const generatedQueries =
        requestFromContext?.query
          ? undefined
          : await resolveGeneratedLiteratureQueries({
              run,
              rawBrief,
              extractedBriefTopic: extractedBrief?.topic,
              runContextMemory,
              llm: deps.llm,
              eventStream: deps.eventStream,
              node: "collect_papers",
              abortSignal
            });
      const normalizedRequest = normalizeCollectRequest({
        request: requestFromContext,
        topic: run.topic,
        rawBrief,
        extractedBriefTopic: extractedBrief?.topic,
        llmGeneratedQueries: generatedQueries?.queries,
        constraintProfile,
        configuredLimit: deps.config.papers.max_results
      });
      if (!normalizedRequest.primaryRequest || normalizedRequest.searchPlan.length === 0) {
        const queryPlanningFailure = buildCollectQueryPlanningFailureMessage(requestFromContext?.query);
        await runContextMemory.put("collect_papers.last_request", null);
        await runContextMemory.put("collect_papers.last_result", null);
        await runContextMemory.put("collect_papers.last_attempt_count", 0);
        await runContextMemory.put("collect_papers.count", 0);
        await runContextMemory.put("collect_papers.source", "semantic_scholar");
        await runContextMemory.put("collect_papers.last_error", queryPlanningFailure);
        await runContextMemory.put("collect_papers.enrichment_last_error", null);
        return {
          status: "failure",
          error: queryPlanningFailure,
          summary: queryPlanningFailure,
          toolCallsUsed: 0
        };
      }
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
      const fetchedPapers = new Map<string, AggregatedSearchPaper>();
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
      const governancePolicy = loadGovernancePolicy();
      const governanceWarnings: CollectGovernanceWarning[] = [];
      let diagnostics: SemanticScholarSearchDiagnostics = emptyCollectDiagnostics();
      let aggregationReport: PaperSearchAggregationReport | undefined;
      const queryAttempts: CollectQueryAttemptMeta[] = [];
      let effectiveRequest = normalizedRequest.primaryRequest;
      const searchProviders = buildSearchProviders(deps);
      await syncCollectRunContext({
        runContextMemory,
        request: effectiveRequest,
        resultMeta: buildCollectResultMeta({
          request: effectiveRequest,
          fetched: 0,
          stored: storedCount,
          added: newPaperIds.size,
          baseCount,
          mode,
          diagnostics,
          filters: effectiveRequest.filters || {},
          bibtexMode: normalizeBibtexMode(requestFromContext?.bibtexMode),
          completed: false,
          pdfRecovered,
          bibtexEnriched,
          aggregationReport,
          enrichmentAttempts: 0,
          fallbackSources: [],
          requestedQuery: normalizedRequest.requestedQuery,
          queryAttempts,
          enrichment: {
            blocking: false,
            status: "not_needed",
            targetCount: 0,
            processedCount: 0,
            attemptedCount: 0,
            updatedCount: 0
          },
          governanceWarnings
        }),
        diagnostics
      });

      let fetchError: string | undefined;
      for (let searchIndex = 0; searchIndex < normalizedRequest.searchPlan.length; searchIndex += 1) {
        const plannedSearch = normalizedRequest.searchPlan[searchIndex];
        effectiveRequest = plannedSearch.request;
        let searchDiagnostics = emptyCollectDiagnostics();
        let searchFetched = 0;
        let currentAggregation: PaperSearchAggregationReport | undefined;

        try {
          const providerLabel = formatProviderList(searchProviders.map((provider) => provider.provider));
          const semanticScholarOnly = isSemanticScholarOnlyProviders(searchProviders);
          deps.eventStream.emit({
            type: "OBS_RECEIVED",
            runId: run.id,
            node: "collect_papers",
            payload: {
              text:
                searchIndex === 0
                  ? `Searching ${providerLabel} for "${effectiveRequest.query}" (${plannedSearch.reason}).`
                  : `No papers found yet; retrying with broader query "${effectiveRequest.query}" across ${providerLabel}${plannedSearch.filtersRelaxed ? " and relaxed filters" : ""}.`
            }
          });
          if (semanticScholarOnly) {
            deps.eventStream.emit({
              type: "OBS_RECEIVED",
              runId: run.id,
              node: "collect_papers",
              payload: {
                text: "Requesting Semantic Scholar batch 1/1."
              }
            });
          }
          const aggregated = await runAggregatedPaperSearch({
            request: effectiveRequest,
            providers: searchProviders,
            abortSignal
          });
          currentAggregation = aggregated.report;
          aggregationReport = aggregated.report;
          searchDiagnostics = deps.semanticScholar.getLastSearchDiagnostics?.() ?? searchDiagnostics;
          diagnostics = mergeCollectDiagnostics(diagnostics, searchDiagnostics);
          searchFetched = aggregated.records.length;

          let changed = false;
          for (const record of aggregated.records) {
            const screening = screenCollectedPaper(record, governancePolicy);
            if (screening.result === "blocked") {
              appendGovernanceTrace({
                timestamp: new Date().toISOString(),
                runId: run.id,
                node: "collect_papers",
                inputSummary: screeningInputSummary(record),
                screeningResult: screening.result,
                triggeredRules: screening.triggeredRules,
                decision: "hard_stop",
                matchedSlotId: "evidence_intake",
                detail: screening.recommendation
              });
              deps.eventStream.emit({
                type: "OBS_RECEIVED",
                runId: run.id,
                node: "collect_papers",
                payload: {
                  text: `Governance blocked collected paper "${record.paper.title}" and excluded it from the corpus.`
                }
              });
              continue;
            }
            if (screening.result === "suspicious_but_usable") {
              governanceWarnings.push({
                paper_id: record.paper.paperId,
                source: resolveGovernanceSource(record),
                triggeredRules: screening.triggeredRules,
                excerpt: screening.excerpt,
                recommendation: screening.recommendation
              });
              appendGovernanceTrace({
                timestamp: new Date().toISOString(),
                runId: run.id,
                node: "collect_papers",
                inputSummary: screeningInputSummary(record),
                screeningResult: screening.result,
                triggeredRules: screening.triggeredRules,
                decision: "allow_with_trace",
                matchedSlotId: "evidence_intake",
                detail: screening.recommendation
              });
            }
            fetchedPapers.set(record.paper.paperId, record.paper);
            const currentRow = storedRows.get(record.paper.paperId);
            if (!currentRow && additionalLimit !== undefined && newPaperIds.size >= additionalLimit) {
              continue;
            }
            const mergedRow = mergeStoredCorpusRows(currentRow, record.row);
            const prevSerialized = currentRow ? JSON.stringify(currentRow) : undefined;
            const nextSerialized = JSON.stringify(mergedRow);
            if (!currentRow) {
              newPaperIds.add(record.paper.paperId);
              changed = true;
            } else if (prevSerialized !== nextSerialized) {
              changed = true;
            }
            storedRows.set(record.paper.paperId, mergedRow);
          }

          for (const providerDiagnostic of aggregated.report.providerDiagnostics) {
            deps.eventStream.emit({
              type: "OBS_RECEIVED",
              runId: run.id,
              node: "collect_papers",
              payload: {
                text: providerDiagnostic.error
                  ? `${formatProviderName(providerDiagnostic.provider)} returned no usable results (${providerDiagnostic.error}).`
                  : `${formatProviderName(providerDiagnostic.provider)} returned ${providerDiagnostic.fetched} candidate(s).`
              }
            });
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
                fetched: fetchedPapers.size,
                stored: storedCount,
                added: newPaperIds.size,
                baseCount,
                mode,
                diagnostics,
                filters: effectiveRequest.filters || {},
                bibtexMode: normalizeBibtexMode(requestFromContext?.bibtexMode),
                completed: false,
                pdfRecovered,
                bibtexEnriched,
                aggregationReport,
                enrichmentAttempts: countEnrichmentAttempts(currentEnrichmentLogs),
                fallbackSources: Array.from(fallbackSources),
                requestedQuery: normalizedRequest.requestedQuery,
                queryAttempts,
                governanceWarnings,
                enrichment: {
                  blocking: false,
                  status: "not_needed",
                  targetCount: 0,
                  processedCount: 0,
                  attemptedCount: 0,
                  updatedCount: 0
                }
              }),
              enrichmentLogs: Array.from(persistedEnrichmentLogs.values()),
              bibtexMode: normalizeBibtexMode(requestFromContext?.bibtexMode),
              aggregationReport
            });
            deps.eventStream.emit({
              type: "OBS_RECEIVED",
              runId: run.id,
              node: "collect_papers",
              payload: {
                text:
                  currentAggregation?.source === "aggregated"
                    ? `Aggregated search stored ${storedCount} paper(s) so far (${newPaperIds.size} new) from ${currentAggregation.rawCandidateCount} candidate(s).`
                    : `Collected ${storedCount} paper(s) so far (${newPaperIds.size} new) for "${effectiveRequest.query}".`
              }
            });
          }

          deps.eventStream.emit({
            type: "OBS_RECEIVED",
            runId: run.id,
            node: "collect_papers",
            payload: {
              text:
                currentAggregation?.source === "aggregated"
                  ? `Canonicalized ${currentAggregation.canonicalCount} paper(s) from ${currentAggregation.rawCandidateCount} cross-provider candidate(s).`
                  : `Fetched ${searchFetched} paper(s) from Semantic Scholar.`
            }
          });
          if (semanticScholarOnly) {
            deps.eventStream.emit({
              type: "OBS_RECEIVED",
              runId: run.id,
              node: "collect_papers",
              payload: {
                text: `Fetched Semantic Scholar batch 1/1 (${searchFetched} paper(s)).`
              }
            });
          }

          queryAttempts.push({
            query: effectiveRequest.query,
            reason: plannedSearch.reason,
            filtersRelaxed: plannedSearch.filtersRelaxed,
            fetched: searchFetched,
            attemptCount: searchDiagnostics.attemptCount,
            lastStatus: searchDiagnostics.lastStatus,
            retryAfterMs: searchDiagnostics.retryAfterMs
          });

          const providerFailure = buildProviderFailureMessage(effectiveRequest.query, currentAggregation?.providerDiagnostics || []);
          if (providerFailure && semanticScholarOnly) {
            fetchError = providerFailure;
            break;
          }
          if (searchFetched === 0 && providerFailure) {
            fetchError = providerFailure;
            break;
          }

          if (shouldRetryBroaderAfterLowYieldCollect({
            fetched: searchFetched,
            candidate: { query: plannedSearch.request.query, reason: plannedSearch.reason },
            requestedQuery: normalizedRequest.requestedQuery,
            hasMoreCandidates: searchIndex < normalizedRequest.searchPlan.length - 1
          })) {
            deps.eventStream.emit({
              type: "OBS_RECEIVED",
              runId: run.id,
              node: "collect_papers",
              payload: {
                text:
                  `Only ${searchFetched} paper(s) matched the strict query "${effectiveRequest.query}". ` +
                  `Trying the next broader literature query candidate.`
              }
            });
            continue;
          }

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

      const removedTailPaperIds = pruneLightweightOffTopicTail({
        runTopic: run.topic,
        requestedQuery: normalizedRequest.requestedQuery,
        effectiveQuery: effectiveRequest.query,
        sortField: effectiveRequest.sort?.field,
        mode,
        storedRows
      });
      if (removedTailPaperIds.length > 0) {
        for (const paperId of removedTailPaperIds) {
          newPaperIds.delete(paperId);
        }
        storedCount = storedRows.size;
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "collect_papers",
          payload: {
            text: `Lightweight corpus quality guard removed ${removedTailPaperIds.length} off-topic tail paper(s) before selection.`
          }
        });
      }

      const bibtexMode = normalizeBibtexMode(requestFromContext?.bibtexMode);
      const zeroResultFailure =
        !fetchError && mode === "replace" && storedRows.size === 0
          ? buildCollectZeroResultsMessage(
              queryAttempts,
              normalizedRequest.requestedQuery,
              aggregationReport?.source ?? "semantic_scholar"
            )
          : undefined;
      const papersToEnrich = zeroResultFailure
        ? []
        : Array.from(fetchedPapers.values()).filter((paper) =>
            shouldEnrichStoredRow(storedRows.get(paper.paperId), bibtexMode)
          );

      storedCount = storedRows.size;
      const resultMeta = buildCollectResultMeta({
        request: effectiveRequest,
        fetched: fetchedPapers.size,
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
        aggregationReport,
        enrichmentAttempts: countEnrichmentAttempts(currentEnrichmentLogs),
        fallbackSources: Array.from(fallbackSources),
        requestedQuery: normalizedRequest.requestedQuery,
        queryAttempts,
        governanceWarnings,
        enrichment:
          papersToEnrich.length > 0
            ? {
                blocking: false,
                status: "pending",
                targetCount: papersToEnrich.length,
                processedCount: 0,
                attemptedCount: 0,
                updatedCount: 0
              }
            : {
                blocking: false,
                status: "not_needed",
                targetCount: 0,
                processedCount: 0,
                attemptedCount: 0,
                updatedCount: 0
              }
      });

      await persistCollectSnapshot({
        run,
        rows: Array.from(storedRows.values()),
        mode,
        request: effectiveRequest,
        resultMeta,
        enrichmentLogs: Array.from(persistedEnrichmentLogs.values()),
        bibtexMode,
        aggregationReport
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
          source: resultMeta.source,
          papers: storedCount,
          query: effectiveRequest.query,
          requested_limit: effectiveRequest.limit,
          fetch_error: fetchError || zeroResultFailure
        }
      });

      if (fetchError) {
        const failureMessage = buildCollectFailureMessage(
          effectiveRequest,
          fetchError,
          aggregationReport?.source ?? "semantic_scholar"
        );
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

        await startDetachedEnrichment({
          deps,
          run,
          request: effectiveRequest,
          mode,
          baseCount,
          bibtexMode,
          papers: papersToEnrich,
          fetchedCount: fetchedPapers.size,
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
          aggregationReport,
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
  extractedBriefTopic?: string;
  llmGeneratedQueries?: string[];
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
  const queryCandidates = buildLiteratureQueryCandidates({
    requestedQuery,
    runTopic: input.topic,
    llmGeneratedQueries: input.llmGeneratedQueries,
    extractedBriefTopic: input.extractedBriefTopic,
    briefTopic: extractResearchBriefTopic(input.rawBrief)
  });
  const mergedFilters = buildSemanticScholarFilters(
    mergeCollectConstraintDefaults(request?.filters, input.constraintProfile.collect)
  );
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

  return {
    primaryRequest: searchPlan[0]?.request,
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
  fetchError: string,
  source: CollectResultMeta["source"] = "semantic_scholar"
): string {
  if (source === "aggregated") {
    return `Multi-provider literature search failed for "${request.query}" (${fetchError})`;
  }
  if (/\b429\b/.test(fetchError)) {
    const chunkNote = usesConservativeChunking(request)
      ? " AutoLabOS already switched this request to smaller Semantic Scholar chunks."
      : "";
    return `Semantic Scholar rate limited "${request.query}": ${fetchError}.${chunkNote} Wait a bit and retry, or lower --limit to 50-100 / collect in smaller batches.`;
  }
  return `Semantic Scholar fetch failed for "${request.query}" (${fetchError})`;
}

function buildCollectSummary(resultMeta: CollectResultMeta): string {
  const sourceLabel = resultMeta.source === "aggregated" ? "Aggregated search" : "Semantic Scholar";
  const storedSummary =
    resultMeta.mode === "additional"
      ? `${sourceLabel} stored ${resultMeta.stored} total papers for "${resultMeta.query}" (${resultMeta.added} newly added).`
      : `${sourceLabel} stored ${resultMeta.stored} papers for "${resultMeta.query}".`;

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

function buildSearchProviders(deps: NodeExecutionDeps): SearchProviderClient[] {
  const semanticScholarProvider = createSemanticScholarSearchProvider(deps.semanticScholar);
  if (isFakeSemanticScholarFixtureActive()) {
    return [semanticScholarProvider];
  }
  const providers: SearchProviderClient[] = [semanticScholarProvider];
  if (deps.openAlex) {
    providers.push(deps.openAlex);
  }
  if (deps.crossref) {
    providers.push(deps.crossref);
  }
  if (deps.arxiv) {
    providers.push(deps.arxiv);
  }
  return providers;
}

function isFakeSemanticScholarFixtureActive(): boolean {
  const fakeResponse = process.env.AUTOLABOS_FAKE_SEMANTIC_SCHOLAR_RESPONSE;
  return typeof fakeResponse === "string" && fakeResponse.trim().length > 0;
}

function formatProviderName(provider: PaperSearchProvider): string {
  switch (provider) {
    case "semantic_scholar":
      return "Semantic Scholar";
    case "openalex":
      return "OpenAlex";
    case "crossref":
      return "Crossref";
    case "arxiv":
      return "arXiv";
  }
}

function formatProviderList(providers: PaperSearchProvider[]): string {
  return providers.map((provider) => formatProviderName(provider)).join(", ");
}

function isSemanticScholarOnlyProviders(providers: SearchProviderClient[]): boolean {
  return providers.length === 1 && providers[0]?.provider === "semantic_scholar";
}

function buildProviderFailureMessage(
  query: string,
  diagnostics: PaperSearchProviderDiagnostics[]
): string | undefined {
  const failedProviders = diagnostics.filter((diagnostic) => diagnostic.error);
  if (diagnostics.length === 1 && diagnostics[0]?.provider === "semantic_scholar") {
    return diagnostics[0].error;
  }
  if (failedProviders.length === 0 || failedProviders.length !== diagnostics.length) {
    return undefined;
  }
  return failedProviders
    .map((diagnostic) => `${formatProviderName(diagnostic.provider)}: ${diagnostic.error}`)
    .join("; ")
    .replace(/^/, `all providers failed for "${query}" (`)
    .concat(")");
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

function pruneLightweightOffTopicTail(input: {
  runTopic: string;
  requestedQuery?: string;
  effectiveQuery: string;
  sortField?: "relevance" | "citationCount" | "publicationDate" | "paperId";
  mode: "replace" | "additional";
  storedRows: Map<string, StoredCorpusRow>;
}): string[] {
  if (input.mode !== "replace" || input.sortField !== "relevance") {
    return [];
  }

  const rows = Array.from(input.storedRows.values());
  if (rows.length < LIGHTWEIGHT_TAIL_MIN_ROWS || rows.length > LIGHTWEIGHT_TAIL_MAX_ROWS) {
    return [];
  }

  if (!isLightweightTabularCollectTopic([input.runTopic, input.requestedQuery, input.effectiveQuery].filter(Boolean).join(" "))) {
    return [];
  }

  const keptRows = rows.filter((row) => isStrongLightweightTabularMatch(row));
  if (keptRows.length < 3 || keptRows.length === rows.length) {
    return [];
  }

  const keptIds = new Set(keptRows.map((row) => row.paper_id));
  const removedPaperIds: string[] = [];
  for (const row of rows) {
    if (keptIds.has(row.paper_id)) {
      continue;
    }
    input.storedRows.delete(row.paper_id);
    removedPaperIds.push(row.paper_id);
  }
  return removedPaperIds;
}

function isLightweightTabularCollectTopic(text: string): boolean {
  const tokenSet = new Set(tokenizeCollectText(text));
  if (!hasAnyToken(tokenSet, LIGHTWEIGHT_TABULAR_REQUIRED_TOKENS)) {
    return false;
  }
  return hasAnyToken(tokenSet, LIGHTWEIGHT_TABULAR_SCOPE_TOKENS);
}

function isStrongLightweightTabularMatch(row: StoredCorpusRow): boolean {
  const tokenSet = new Set(tokenizeCollectText(`${row.title} ${row.abstract || ""}`));
  const hasRequiredAnchor = hasAnyToken(tokenSet, LIGHTWEIGHT_TABULAR_REQUIRED_TOKENS);
  const hasSupportAnchor = hasAnyToken(tokenSet, LIGHTWEIGHT_TABULAR_SUPPORT_TOKENS);
  return hasRequiredAnchor && hasSupportAnchor;
}

function hasAnyToken(tokenSet: Set<string>, candidates: Set<string>): boolean {
  for (const token of candidates) {
    if (tokenSet.has(token)) {
      return true;
    }
  }
  return false;
}

function tokenizeCollectText(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g);
  if (!matches) {
    return [];
  }
  return matches.filter((token) => token.length > 1 && !COLLECT_STOPWORDS.has(token));
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
  aggregationReport?: PaperSearchAggregationReport;
  requestedQuery?: string;
  queryAttempts: CollectQueryAttemptMeta[];
  writeCorpusArtifactsOnProgress: boolean;
  runContextMemory: RunContextMemory;
  targetCount?: number;
  processedOffset?: number;
  updatedOffset?: number;
}): Promise<{
  pdfRecovered: number;
  bibtexEnriched: number;
  storedCount: number;
  processedCount: number;
  updatedCount: number;
}> {
  let processed = 0;
  let updated = 0;
  let changedSinceLastPersist = false;
  const targetCount = input.targetCount ?? input.papers.length;
  const processedOffset = Math.max(0, input.processedOffset ?? 0);
  const updatedOffset = Math.max(0, input.updatedOffset ?? 0);

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
      aggregationReport: input.aggregationReport,
      enrichmentAttempts: countEnrichmentAttempts(input.currentEnrichmentLogs),
      fallbackSources: Array.from(input.fallbackSources),
      requestedQuery: input.requestedQuery,
      queryAttempts: input.queryAttempts,
        enrichment: {
          blocking: false,
          status: "pending",
          targetCount,
          processedCount: Math.min(targetCount, processedOffset + processed),
          attemptedCount: Math.min(targetCount, processedOffset + processed),
          updatedCount: Math.min(targetCount, updatedOffset + updated)
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
      aggregationReport: input.aggregationReport,
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
      updated += 1;
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
          text: `Collect enrichment progress: processed ${Math.min(processedOffset + processed, targetCount)}/${targetCount}, stored ${input.storedCount}/${input.request.limit}.`
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
    processedCount: processed,
    updatedCount: updated
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

async function readCollectResultMeta(run: { id: string }): Promise<CollectResultMeta | undefined> {
  const raw = await safeRead(`.autolabos/runs/${run.id}/collect_result.json`);
  if (!raw.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as CollectResultMeta;
    return typeof parsed?.query === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function readCollectBackgroundJob(run: { id: string }): Promise<CollectBackgroundJobRecord | undefined> {
  const raw = await safeRead(`.autolabos/runs/${run.id}/${COLLECT_BACKGROUND_JOB_FILE}`);
  if (!raw.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as CollectBackgroundJobRecord;
    return isCollectBackgroundJobRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function writeCollectBackgroundJob(
  run: CollectRunRef,
  record: CollectBackgroundJobRecord
): Promise<void> {
  await writeRunArtifact(run as any, COLLECT_BACKGROUND_JOB_FILE, JSON.stringify(record, null, 2));
}

function buildCollectBackgroundJobRecord(input: {
  runId: string;
  request: SemanticScholarSearchRequest;
  mode: "replace" | "additional";
  baseCount: number;
  bibtexMode: BibtexMode;
  paperIds: string[];
  fetchedCount: number;
  diagnostics: SemanticScholarSearchDiagnostics;
  newPaperIds: string[];
  pendingSummary: string;
  requestedQuery?: string;
  queryAttempts: CollectQueryAttemptMeta[];
  status: "running" | "completed" | "failed";
  scheduledAt?: string;
  recoveryCount?: number;
  lastRecoveredAt?: string;
  lastError?: string;
}): CollectBackgroundJobRecord {
  const now = new Date().toISOString();
  return {
    version: 1,
    kind: "collect_deferred_enrichment",
    status: input.status,
    runId: input.runId,
    request: input.request,
    mode: input.mode,
    baseCount: input.baseCount,
    bibtexMode: input.bibtexMode,
    paperIds: input.paperIds,
    fetchedCount: input.fetchedCount,
    diagnostics: input.diagnostics,
    newPaperIds: input.newPaperIds,
    pendingSummary: input.pendingSummary,
    requestedQuery: input.requestedQuery,
    queryAttempts: input.queryAttempts,
    scheduledAt: input.scheduledAt ?? now,
    updatedAt: now,
    recoveryCount: input.recoveryCount ?? 0,
    lastRecoveredAt: input.lastRecoveredAt,
    lastError: input.lastError
  };
}

function reconstructPaperFromStoredRow(row: StoredCorpusRow): SemanticScholarPaper {
  return {
    paperId: row.paper_id,
    title: row.title,
    abstract: row.abstract || undefined,
    year: row.year,
    venue: row.venue,
    url: row.url || row.landing_url,
    openAccessPdfUrl: row.pdf_url,
    authors: row.authors,
    doi: row.doi,
    arxivId: row.arxiv_id,
    citationCount: row.citation_count,
    influentialCitationCount: row.influential_citation_count,
    publicationDate: row.publication_date,
    publicationTypes: row.publication_types,
    fieldsOfStudy: row.fields_of_study,
    citationStylesBibtex: row.semantic_scholar_bibtex
  };
}

function isCollectBackgroundJobRecord(value: unknown): value is CollectBackgroundJobRecord {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as CollectBackgroundJobRecord).version === 1 &&
      (value as CollectBackgroundJobRecord).kind === "collect_deferred_enrichment" &&
      typeof (value as CollectBackgroundJobRecord).runId === "string" &&
      typeof (value as CollectBackgroundJobRecord).status === "string" &&
      Array.isArray((value as CollectBackgroundJobRecord).paperIds) &&
      Array.isArray((value as CollectBackgroundJobRecord).newPaperIds)
  );
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
  aggregationReport?: PaperSearchAggregationReport;
  enrichmentAttempts: number;
  fallbackSources: string[];
  requestedQuery?: string;
  queryAttempts: CollectQueryAttemptMeta[];
  enrichment: CollectEnrichmentMeta;
  governanceWarnings?: CollectGovernanceWarning[];
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
    source: input.aggregationReport?.source ?? "semantic_scholar",
    providers: input.aggregationReport?.providers,
    rawCandidateCount: input.aggregationReport?.rawCandidateCount,
    canonicalCount: input.aggregationReport?.canonicalCount,
    providerDiagnostics: input.aggregationReport?.providerDiagnostics,
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
    governance_warnings: input.governanceWarnings ?? [],
    timestamp: new Date().toISOString()
  };
}

function screenCollectedPaper(
  record: AggregatedSearchRecord,
  policy: ReturnType<typeof loadGovernancePolicy>
): ScreeningReport {
  return screenEvidence(
    {
      text: `${record.paper.title}\n${record.paper.abstract ?? ""}`.trim(),
      source: resolveGovernanceSource(record),
      context: "collect_papers"
    },
    policy
  );
}

function resolveGovernanceSource(record: AggregatedSearchRecord): string {
  return (
    record.row.landing_url ||
    record.row.url ||
    record.row.pdf_url ||
    record.paper.landingUrl ||
    record.paper.url ||
    record.paper.openAccessPdfUrl ||
    `provider:${record.paper.canonicalSource}`
  );
}

function screeningInputSummary(record: AggregatedSearchRecord): string {
  return `${record.paper.title} ${record.paper.abstract ?? ""}`
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 100);
}

async function persistCollectSnapshot(input: {
  run: { id: string };
  rows: StoredCorpusRow[];
  mode: "replace" | "additional";
  request: SemanticScholarSearchRequest;
  resultMeta: CollectResultMeta;
  enrichmentLogs: CollectEnrichmentLogEntry[];
  bibtexMode: BibtexMode;
  aggregationReport?: PaperSearchAggregationReport;
  writeCorpusArtifacts?: boolean;
}): Promise<void> {
  await writeRunArtifact(input.run as any, "collect_request.json", JSON.stringify(input.request, null, 2));
  await writeRunArtifact(input.run as any, "collect_result.json", JSON.stringify(input.resultMeta, null, 2));
  if (input.aggregationReport) {
    await writeRunArtifact(
      input.run as any,
      "collect_search_aggregation.json",
      JSON.stringify(input.aggregationReport, null, 2)
    );
  }
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
  await input.runContextMemory.put("collect_papers.source", input.resultMeta.source);
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

function shouldRetryBroaderAfterLowYieldCollect(input: {
  fetched: number;
  candidate: { query: string; reason: LiteratureQueryCandidate["reason"] };
  requestedQuery?: string;
  hasMoreCandidates: boolean;
}): boolean {
  if (input.fetched >= LOW_YIELD_QUERY_MIN_RESULTS || input.fetched <= 0) {
    return false;
  }
  if (input.requestedQuery?.trim()) {
    return false;
  }
  if (!input.hasMoreCandidates) {
    return false;
  }
  return input.candidate.reason === "llm_generated" && hasSemanticScholarSpecialSyntax(input.candidate.query);
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

function extractAggregationReport(resultMeta: CollectResultMeta | undefined): PaperSearchAggregationReport | undefined {
  if (!resultMeta) {
    return undefined;
  }
  return {
    source: resultMeta.source,
    rawCandidateCount: resultMeta.rawCandidateCount ?? resultMeta.fetched,
    canonicalCount: resultMeta.canonicalCount ?? resultMeta.stored,
    providers: resultMeta.providers ?? (resultMeta.source === "semantic_scholar" ? ["semantic_scholar"] : []),
    providerDiagnostics: resultMeta.providerDiagnostics ?? [],
    clusters: []
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

function buildCollectZeroResultsMessage(
  queryAttempts: CollectQueryAttemptMeta[],
  requestedQuery?: string,
  source: CollectResultMeta["source"] = "semantic_scholar"
): string {
  const attempted = queryAttempts
    .map((attempt) => `"${attempt.query}"${attempt.filtersRelaxed ? " (relaxed filters)" : ""}`)
    .join(", ");
  const requested = requestedQuery ? ` Requested query was "${requestedQuery}".` : "";
  const queries = attempted ? ` Tried ${queryAttempts.length} query variant(s): ${attempted}.` : "";
  const prefix =
    source === "semantic_scholar"
      ? "Semantic Scholar returned 0 papers for the configured query plan."
      : "Literature search returned 0 papers for the configured query plan.";
  return `${prefix}${requested}${queries}`;
}

function buildCollectQueryPlanningFailureMessage(requestedQuery?: string): string {
  if (requestedQuery?.trim()) {
    return `collect_papers could not build a Semantic Scholar query plan from the explicit query "${requestedQuery}".`;
  }
  return "collect_papers could not build a Semantic Scholar query plan. Automatic topic fallback is disabled, so provide an explicit query or ensure LLM query generation succeeds.";
}

async function startDetachedEnrichment(input: {
  deps: Pick<NodeExecutionDeps, "eventStream" | "runStore">;
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
  aggregationReport?: PaperSearchAggregationReport;
  requestedQuery?: string;
  queryAttempts: CollectQueryAttemptMeta[];
  targetCount?: number;
  processedOffset?: number;
  updatedOffset?: number;
  recoveredFromCrash?: boolean;
  recoveryCount?: number;
}): Promise<void> {
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
  const targetCount = input.targetCount ?? input.papers.length;
  const processedOffset = Math.max(0, input.processedOffset ?? 0);
  const updatedOffset = Math.max(0, input.updatedOffset ?? 0);
  const paperIds = input.papers.map((paper) => paper.paperId);
  const lastRecoveredAt = input.recoveredFromCrash ? new Date().toISOString() : undefined;
  const scheduledAt = (await readCollectBackgroundJob(input.run))?.scheduledAt ?? new Date().toISOString();
  await writeCollectBackgroundJob(
    input.run,
    buildCollectBackgroundJobRecord({
      runId: input.run.id,
      request: input.request,
      mode: input.mode,
      baseCount: input.baseCount,
      bibtexMode: input.bibtexMode,
      paperIds,
      fetchedCount: input.fetchedCount,
      diagnostics: input.diagnostics,
      newPaperIds: Array.from(input.newPaperIds),
      pendingSummary: input.pendingSummary,
      requestedQuery: input.requestedQuery,
      queryAttempts: input.queryAttempts,
      status: "running",
      scheduledAt,
      recoveryCount: input.recoveryCount,
      lastRecoveredAt
    })
  );
  if (input.recoveredFromCrash) {
    input.deps.eventStream.emit({
      type: "OBS_RECEIVED",
      runId: input.run.id,
      node: "collect_papers",
      payload: {
        text: `Recovered deferred enrichment background task after restart; resuming ${input.papers.length}/${targetCount} remaining paper(s).`
      }
    });
  }
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
        aggregationReport: input.aggregationReport,
        requestedQuery: input.requestedQuery,
        queryAttempts: input.queryAttempts,
        writeCorpusArtifactsOnProgress: true,
        runContextMemory,
        targetCount,
        processedOffset,
        updatedOffset
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
        aggregationReport: input.aggregationReport,
        enrichmentAttempts: countEnrichmentAttempts(input.currentEnrichmentLogs),
        fallbackSources: Array.from(input.fallbackSources),
        requestedQuery: input.requestedQuery,
        queryAttempts: input.queryAttempts,
        enrichment: {
          blocking: false,
          status: "completed",
          targetCount,
          processedCount: Math.min(targetCount, processedOffset + enrichmentState.processedCount),
          attemptedCount: Math.min(targetCount, processedOffset + enrichmentState.processedCount),
          updatedCount: Math.min(targetCount, updatedOffset + enrichmentState.updatedCount)
        }
      });

      await persistCollectSnapshot({
        run: input.run,
        rows: Array.from(input.storedRows.values()),
        mode: input.mode,
        request: input.request,
        resultMeta: completionMeta,
        enrichmentLogs: Array.from(input.persistedEnrichmentLogs.values()),
        bibtexMode: input.bibtexMode,
        aggregationReport: input.aggregationReport
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
      await writeCollectBackgroundJob(
        input.run,
        buildCollectBackgroundJobRecord({
          runId: input.run.id,
          request: input.request,
          mode: input.mode,
          baseCount: input.baseCount,
          bibtexMode: input.bibtexMode,
          paperIds,
          fetchedCount: input.fetchedCount,
          diagnostics: input.diagnostics,
          newPaperIds: Array.from(input.newPaperIds),
          pendingSummary: input.pendingSummary,
          requestedQuery: input.requestedQuery,
          queryAttempts: input.queryAttempts,
          status: "completed",
          scheduledAt,
          recoveryCount: input.recoveryCount,
          lastRecoveredAt
        })
      );

      input.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: input.run.id,
        node: "collect_papers",
        payload: {
          text: `Deferred enrichment finished for ${targetCount} paper(s). PDF recovered ${enrichmentState.pdfRecovered}; BibTeX enriched ${enrichmentState.bibtexEnriched}.`
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
        aggregationReport: input.aggregationReport,
        enrichmentAttempts: countEnrichmentAttempts(input.currentEnrichmentLogs),
        fallbackSources: Array.from(input.fallbackSources),
        requestedQuery: input.requestedQuery,
        queryAttempts: input.queryAttempts,
        enrichment: {
          blocking: false,
          status: "failed",
          targetCount,
          processedCount: Math.min(targetCount, processedOffset + input.currentEnrichmentLogs.size),
          attemptedCount: Math.min(targetCount, processedOffset + input.currentEnrichmentLogs.size),
          updatedCount: Math.min(targetCount, updatedOffset),
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
        aggregationReport: input.aggregationReport,
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
      await writeCollectBackgroundJob(
        input.run,
        buildCollectBackgroundJobRecord({
          runId: input.run.id,
          request: input.request,
          mode: input.mode,
          baseCount: input.baseCount,
          bibtexMode: input.bibtexMode,
          paperIds,
          fetchedCount: input.fetchedCount,
          diagnostics: input.diagnostics,
          newPaperIds: Array.from(input.newPaperIds),
          pendingSummary: input.pendingSummary,
          requestedQuery: input.requestedQuery,
          queryAttempts: input.queryAttempts,
          status: "failed",
          scheduledAt,
          recoveryCount: input.recoveryCount,
          lastRecoveredAt,
          lastError: message
        })
      );

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

export async function recoverCollectEnrichmentJobs(input: {
  eventStream: Pick<NodeExecutionDeps, "eventStream">["eventStream"];
  runStore: Pick<NodeExecutionDeps, "runStore">["runStore"];
}): Promise<void> {
  const runs = await input.runStore.listRuns();
  for (const run of runs) {
    const job = await readCollectBackgroundJob(run);
    if (!job || job.status !== "running" || activeCollectEnrichmentJobs.has(run.id)) {
      continue;
    }

    const runRef: CollectRunRef = {
      id: run.id,
      memoryRefs: {
        runContextPath: run.memoryRefs.runContextPath
      }
    };
    const storedRows = new Map<string, StoredCorpusRow>(
      (await readExistingCorpus(run)).map((row) => [row.paper_id, row])
    );
    const persistedEnrichmentLogs = new Map<string, CollectEnrichmentLogEntry>(
      (await readExistingEnrichmentLogs(run)).map((entry) => [entry.paper_id, entry])
    );
    const currentEnrichmentLogs = new Map<string, CollectEnrichmentLogEntry>(persistedEnrichmentLogs);
    const resultMeta = await readCollectResultMeta(run);
    const fallbackSources = new Set(resultMeta?.fallbackSources ?? []);
    const newPaperIds = new Set(job.newPaperIds);
    const processedOffset = Math.max(
      persistedEnrichmentLogs.size,
      Math.min(job.paperIds.length, resultMeta?.enrichment?.processedCount ?? 0)
    );
    const updatedOffset = Math.max(0, resultMeta?.enrichment?.updatedCount ?? 0);
    const pendingPaperIds = job.paperIds.filter((paperId) => !persistedEnrichmentLogs.has(paperId));

    if (resultMeta?.enrichment.status === "completed") {
      await writeCollectBackgroundJob(
        runRef,
        buildCollectBackgroundJobRecord({
          runId: run.id,
          request: job.request,
          mode: job.mode,
          baseCount: job.baseCount,
          bibtexMode: job.bibtexMode,
          paperIds: job.paperIds,
          fetchedCount: job.fetchedCount,
          diagnostics: job.diagnostics,
          newPaperIds: job.newPaperIds,
          pendingSummary: job.pendingSummary,
          requestedQuery: job.requestedQuery,
          queryAttempts: job.queryAttempts,
          status: "completed",
          scheduledAt: job.scheduledAt,
          recoveryCount: job.recoveryCount,
          lastRecoveredAt: job.lastRecoveredAt
        })
      );
      continue;
    }

    if (resultMeta?.enrichment.status === "failed") {
      await writeCollectBackgroundJob(
        runRef,
        buildCollectBackgroundJobRecord({
          runId: run.id,
          request: job.request,
          mode: job.mode,
          baseCount: job.baseCount,
          bibtexMode: job.bibtexMode,
          paperIds: job.paperIds,
          fetchedCount: job.fetchedCount,
          diagnostics: job.diagnostics,
          newPaperIds: job.newPaperIds,
          pendingSummary: job.pendingSummary,
          requestedQuery: job.requestedQuery,
          queryAttempts: job.queryAttempts,
          status: "failed",
          scheduledAt: job.scheduledAt,
          recoveryCount: job.recoveryCount,
          lastRecoveredAt: job.lastRecoveredAt,
          lastError: resultMeta.enrichment.lastError
        })
      );
      continue;
    }

    if (pendingPaperIds.length === 0) {
      const completionMeta = buildCollectResultMeta({
        request: job.request,
        fetched: job.fetchedCount,
        stored: storedRows.size,
        added: newPaperIds.size,
        baseCount: job.baseCount,
        mode: job.mode,
        diagnostics: job.diagnostics,
        filters: job.request.filters || {},
        bibtexMode: job.bibtexMode,
        completed: true,
        pdfRecovered: resultMeta?.pdfRecovered ?? 0,
        bibtexEnriched: resultMeta?.bibtexEnriched ?? 0,
        aggregationReport: extractAggregationReport(resultMeta),
        enrichmentAttempts: countEnrichmentAttempts(currentEnrichmentLogs),
        fallbackSources: Array.from(fallbackSources),
        requestedQuery: job.requestedQuery,
        queryAttempts: job.queryAttempts,
        enrichment: {
          blocking: false,
          status: "completed",
          targetCount: job.paperIds.length,
          processedCount: processedOffset,
          attemptedCount: processedOffset,
          updatedCount: updatedOffset
        }
      });
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      await persistCollectSnapshot({
        run: runRef,
        rows: Array.from(storedRows.values()),
        mode: job.mode,
        request: job.request,
        resultMeta: completionMeta,
        enrichmentLogs: Array.from(persistedEnrichmentLogs.values()),
        bibtexMode: job.bibtexMode,
        aggregationReport: extractAggregationReport(resultMeta)
      });
      await syncCollectRunContext({
        runContextMemory,
        request: job.request,
        resultMeta: completionMeta,
        diagnostics: job.diagnostics
      });
      await syncCollectRunRecord({
        runStore: input.runStore,
        runId: run.id,
        summary: buildCollectSummary(completionMeta),
        replaceLatestSummaryIf: job.pendingSummary
      });
      await writeCollectBackgroundJob(
        runRef,
        buildCollectBackgroundJobRecord({
          runId: run.id,
          request: job.request,
          mode: job.mode,
          baseCount: job.baseCount,
          bibtexMode: job.bibtexMode,
          paperIds: job.paperIds,
          fetchedCount: job.fetchedCount,
          diagnostics: job.diagnostics,
          newPaperIds: job.newPaperIds,
          pendingSummary: job.pendingSummary,
          requestedQuery: job.requestedQuery,
          queryAttempts: job.queryAttempts,
          status: "completed",
          scheduledAt: job.scheduledAt,
          recoveryCount: job.recoveryCount,
          lastRecoveredAt: job.lastRecoveredAt
        })
      );
      input.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "collect_papers",
        payload: {
          text: `Recovered deferred enrichment state after restart; all ${job.paperIds.length} paper(s) were already complete.`
        }
      });
      continue;
    }

    const missingPaperIds = pendingPaperIds.filter((paperId) => !storedRows.has(paperId));
    if (missingPaperIds.length > 0) {
      const message = `Deferred enrichment recovery could not reconstruct ${missingPaperIds.length} queued paper(s): ${missingPaperIds.join(", ")}`;
      const failureMeta = buildCollectResultMeta({
        request: job.request,
        fetched: job.fetchedCount,
        stored: storedRows.size,
        added: newPaperIds.size,
        baseCount: job.baseCount,
        mode: job.mode,
        diagnostics: job.diagnostics,
        filters: job.request.filters || {},
        bibtexMode: job.bibtexMode,
        completed: true,
        pdfRecovered: resultMeta?.pdfRecovered ?? 0,
        bibtexEnriched: resultMeta?.bibtexEnriched ?? 0,
        aggregationReport: extractAggregationReport(resultMeta),
        enrichmentAttempts: countEnrichmentAttempts(currentEnrichmentLogs),
        fallbackSources: Array.from(fallbackSources),
        requestedQuery: job.requestedQuery,
        queryAttempts: job.queryAttempts,
        enrichment: {
          blocking: false,
          status: "failed",
          targetCount: job.paperIds.length,
          processedCount: processedOffset,
          attemptedCount: processedOffset,
          updatedCount: updatedOffset,
          lastError: message
        }
      });
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      await persistCollectSnapshot({
        run: runRef,
        rows: Array.from(storedRows.values()),
        mode: job.mode,
        request: job.request,
        resultMeta: failureMeta,
        enrichmentLogs: Array.from(persistedEnrichmentLogs.values()),
        bibtexMode: job.bibtexMode,
        aggregationReport: extractAggregationReport(resultMeta),
        writeCorpusArtifacts: false
      });
      await syncCollectRunContext({
        runContextMemory,
        request: job.request,
        resultMeta: failureMeta,
        diagnostics: job.diagnostics
      });
      await syncCollectRunRecord({
        runStore: input.runStore,
        runId: run.id,
        summary: buildCollectSummary(failureMeta),
        replaceLatestSummaryIf: job.pendingSummary
      });
      await writeCollectBackgroundJob(
        runRef,
        buildCollectBackgroundJobRecord({
          runId: run.id,
          request: job.request,
          mode: job.mode,
          baseCount: job.baseCount,
          bibtexMode: job.bibtexMode,
          paperIds: job.paperIds,
          fetchedCount: job.fetchedCount,
          diagnostics: job.diagnostics,
          newPaperIds: job.newPaperIds,
          pendingSummary: job.pendingSummary,
          requestedQuery: job.requestedQuery,
          queryAttempts: job.queryAttempts,
          status: "failed",
          scheduledAt: job.scheduledAt,
          recoveryCount: job.recoveryCount,
          lastRecoveredAt: job.lastRecoveredAt,
          lastError: message
        })
      );
      input.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "collect_papers",
        payload: {
          text: `Deferred enrichment recovery failed: ${message}`
        }
      });
      continue;
    }

    await startDetachedEnrichment({
      deps: input,
      run: runRef,
      request: job.request,
      mode: job.mode,
      baseCount: job.baseCount,
      bibtexMode: job.bibtexMode,
      papers: pendingPaperIds.map((paperId) => reconstructPaperFromStoredRow(storedRows.get(paperId)!)),
      fetchedCount: job.fetchedCount,
      diagnostics: job.diagnostics,
      storedRows,
      pdfRecovered: resultMeta?.pdfRecovered ?? 0,
      bibtexEnriched: resultMeta?.bibtexEnriched ?? 0,
      fallbackSources,
      currentEnrichmentLogs,
      persistedEnrichmentLogs,
      storedCount: storedRows.size,
      newPaperIds,
      pendingSummary: job.pendingSummary,
      aggregationReport: extractAggregationReport(resultMeta),
      requestedQuery: job.requestedQuery,
      queryAttempts: job.queryAttempts,
      targetCount: job.paperIds.length,
      processedOffset,
      updatedOffset,
      recoveredFromCrash: true,
      recoveryCount: job.recoveryCount + 1
    });
  }
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
