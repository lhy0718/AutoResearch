import { safeRead, writeRunArtifact } from "./nodes/helpers.js";
import {
  PaperWritingBundle,
  parseCorpusRows,
  RelatedWorkScoutArtifact,
  RelatedWorkScoutPaperArtifact
} from "./analysis/paperWriting.js";
import { buildBibtexFile, normalizeS2Bibtex } from "./collection/bibtex.js";
import { StoredCorpusRow } from "./collection/types.js";
import { ConstraintProfile, mergeCollectConstraintDefaults } from "./runConstraints.js";
import {
  SemanticScholarPaper,
  SemanticScholarSearchFilters,
  SemanticScholarSearchRequest
} from "../tools/semanticScholar.js";
import { RunRecord } from "../types.js";

const RELATED_WORK_SUMMARY_MIN = 6;
const RELATED_WORK_CORPUS_MIN = 10;
const RELATED_WORK_SCOUT_MAX_RESULTS = 6;
const RELATED_WORK_QUERY_PLAN_MAX = 3;
const RELATED_WORK_PER_QUERY_LIMIT = 4;

const QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "using",
  "with"
]);

interface RelatedWorkScoutPlannedQuery {
  id: string;
  query: string;
  rationale: string;
}

interface RelatedWorkScoutExecutedQuery {
  id: string;
  query: string;
  rationale: string;
  fetched_count: number;
  new_papers: number;
  duplicate_count: number;
}

interface RelatedWorkScoutCoverageSnapshot {
  analyzed_paper_count: number;
  corpus_count: number;
  unique_venue_count: number;
  recent_paper_count: number;
  citation_gap_detected: boolean;
  target_additional_papers: number;
}

interface RelatedWorkScoutCoverageAudit {
  status: "skipped" | "sufficient" | "partial" | "failed";
  reason: string;
  before: RelatedWorkScoutCoverageSnapshot;
  after: {
    additional_papers: number;
    total_corpus_count: number;
    unique_added_venues: number;
    recent_added_papers: number;
    executed_query_count: number;
  };
  executed_queries: RelatedWorkScoutExecutedQuery[];
  stop_reason: string;
}

interface RelatedWorkScoutPlanArtifact {
  trigger_reason: string;
  primary_query: string;
  rationale: string;
  target_additional_papers: number;
  per_query_limit: number;
  planned_queries: RelatedWorkScoutPlannedQuery[];
  filters: SemanticScholarSearchFilters;
}

interface RelatedWorkScoutRequestArtifact {
  query: string;
  limit: number;
  per_query_limit: number;
  rationale: string;
  filters: SemanticScholarSearchFilters;
  target_additional_papers: number;
  planned_queries: RelatedWorkScoutPlannedQuery[];
}

interface RelatedWorkScoutPersistedResult {
  status: "skipped" | "collected" | "reused" | "failed";
  reason?: string;
  query?: string;
  rationale?: string;
  requested_limit: number;
  paper_count: number;
  papers: RelatedWorkScoutPaperArtifact[];
  reused_from_cache?: boolean;
  error?: string;
}

export interface RelatedWorkScoutResult {
  status: "skipped" | "collected" | "reused" | "failed";
  reason?: string;
  query?: string;
  rationale?: string;
  requested_limit: number;
  papers: RelatedWorkScoutPaperArtifact[];
  corpusRows: StoredCorpusRow[];
  scout?: RelatedWorkScoutArtifact;
  queryPlan?: RelatedWorkScoutPlanArtifact;
  coverageAudit?: RelatedWorkScoutCoverageAudit;
}

interface RelatedWorkScoutInput {
  run: RunRecord;
  bundle: PaperWritingBundle;
  constraintProfile: ConstraintProfile;
  semanticScholar?: {
    searchPapers?: (
      request: SemanticScholarSearchRequest,
      abortSignal?: AbortSignal
    ) => Promise<SemanticScholarPaper[]>;
  };
  abortSignal?: AbortSignal;
  emitLog?: (text: string) => void;
}

export async function maybeRunRelatedWorkScout(
  input: RelatedWorkScoutInput
): Promise<RelatedWorkScoutResult> {
  const trigger = evaluateScoutNeed(input.bundle);
  const plan = buildScoutPlan(input.bundle, input.constraintProfile, trigger);
  const request: RelatedWorkScoutRequestArtifact = {
    query: plan.primary_query,
    limit: plan.target_additional_papers,
    per_query_limit: plan.per_query_limit,
    rationale: plan.rationale,
    filters: plan.filters,
    target_additional_papers: plan.target_additional_papers,
    planned_queries: plan.planned_queries
  };

  const cached = await loadCachedScout(input.run, request);
  if (cached) {
    input.emitLog?.(
      `Reusing related-work scout for "${cached.query}" with ${cached.papers.length} paper(s) across ${cached.coverageAudit.executed_queries.length} query step(s).`
    );
    return {
      status: "reused",
      query: cached.query,
      rationale: cached.rationale,
      requested_limit: request.limit,
      papers: cached.papers,
      corpusRows: cached.corpusRows,
      scout: {
        query: cached.query,
        rationale: cached.rationale,
        papers: cached.papers
      },
      queryPlan: cached.queryPlan,
      coverageAudit: cached.coverageAudit
    };
  }

  if (!trigger.enabled) {
    const skippedAudit = buildCoverageAudit({
      before: buildCoverageSnapshot(input.bundle, 0),
      addedRows: [],
      executedQueries: [],
      status: "skipped",
      reason: trigger.reason,
      stopReason: "coverage already sufficient before scouting"
    });
    const skipped: RelatedWorkScoutResult = {
      status: "skipped",
      reason: trigger.reason,
      query: request.query,
      rationale: request.rationale,
      requested_limit: request.limit,
      papers: [],
      corpusRows: [],
      queryPlan: plan,
      coverageAudit: skippedAudit
    };
    await persistScoutResult(input.run, request, skipped);
    input.emitLog?.(`Skipping related-work scout: ${trigger.reason}.`);
    return skipped;
  }

  if (typeof input.semanticScholar?.searchPapers !== "function") {
    const skippedAudit = buildCoverageAudit({
      before: buildCoverageSnapshot(input.bundle, request.target_additional_papers),
      addedRows: [],
      executedQueries: [],
      status: "skipped",
      reason: "semantic scholar client is unavailable in this execution context",
      stopReason: "semantic scholar unavailable"
    });
    const skipped: RelatedWorkScoutResult = {
      status: "skipped",
      reason: "semantic scholar client is unavailable in this execution context",
      query: request.query,
      rationale: request.rationale,
      requested_limit: request.limit,
      papers: [],
      corpusRows: [],
      queryPlan: plan,
      coverageAudit: skippedAudit
    };
    await persistScoutResult(input.run, request, skipped);
    input.emitLog?.("Skipping related-work scout because Semantic Scholar is unavailable.");
    return skipped;
  }

  input.emitLog?.(
    `Launching related-work scout with ${plan.planned_queries.length} planned query step(s).`
  );

  const existingPaperIds = new Set(input.bundle.corpus.map((item) => item.paper_id));
  const addedRows: StoredCorpusRow[] = [];
  const executedQueries: RelatedWorkScoutExecutedQuery[] = [];
  const before = buildCoverageSnapshot(input.bundle, request.target_additional_papers);
  let lastStopReason = "query budget exhausted before coverage target was reached";

  try {
    for (const plannedQuery of plan.planned_queries) {
      input.emitLog?.(
        `Related-work scout query ${executedQueries.length + 1}/${plan.planned_queries.length}: "${plannedQuery.query}".`
      );
      const fetched = await input.semanticScholar.searchPapers(
        {
          query: plannedQuery.query,
          limit: request.per_query_limit,
          filters: request.filters,
          sort: { field: "relevance", order: "desc" }
        },
        input.abortSignal
      );

      let newPapers = 0;
      let duplicateCount = 0;
      for (const row of fetched.map(normalizeScoutCorpusRow).filter(Boolean)) {
        if (existingPaperIds.has(row.paper_id)) {
          duplicateCount += 1;
          continue;
        }
        existingPaperIds.add(row.paper_id);
        addedRows.push(row);
        newPapers += 1;
      }

      executedQueries.push({
        id: plannedQuery.id,
        query: plannedQuery.query,
        rationale: plannedQuery.rationale,
        fetched_count: fetched.length,
        new_papers: newPapers,
        duplicate_count: duplicateCount
      });

      const progressAudit = buildCoverageAudit({
        before,
        addedRows,
        executedQueries,
        status: "partial",
        reason: "collecting additional related-work candidates",
        stopReason: "coverage still below the bounded target"
      });
      if (hasSufficientCoverage(progressAudit)) {
        lastStopReason = resolveCoverageStopReason(progressAudit);
        input.emitLog?.(`Related-work scout reached coverage target: ${lastStopReason}.`);
        break;
      }
    }

    const finalAudit = buildCoverageAudit({
      before,
      addedRows,
      executedQueries,
      status: hasSufficientCoverage(
        buildCoverageAudit({
          before,
          addedRows,
          executedQueries,
          status: "partial",
          reason: "coverage check",
          stopReason: lastStopReason
        })
      )
        ? "sufficient"
        : "partial",
      reason:
        addedRows.length > 0
          ? "related-work scout completed within its bounded query budget"
          : "semantic scholar returned no novel related-work candidates beyond the existing corpus",
      stopReason: hasSufficientCoverage(
        buildCoverageAudit({
          before,
          addedRows,
          executedQueries,
          status: "partial",
          reason: "coverage check",
          stopReason: lastStopReason
        })
      )
        ? lastStopReason
        : "query budget exhausted before the coverage target was met"
    });
    const papers = addedRows.map(buildScoutPaperArtifact);
    const result: RelatedWorkScoutResult = {
      status: "collected",
      reason:
        papers.length > 0
          ? undefined
          : "semantic scholar returned no novel related-work candidates beyond the existing corpus",
      query: request.query,
      rationale: request.rationale,
      requested_limit: request.limit,
      papers,
      corpusRows: addedRows,
      scout: {
        query: request.query,
        rationale: request.rationale,
        papers
      },
      queryPlan: plan,
      coverageAudit: finalAudit
    };
    await persistScoutResult(input.run, request, result);
    input.emitLog?.(
      papers.length > 0
        ? `Related-work scout collected ${papers.length} citation candidate(s) across ${executedQueries.length} query step(s).`
        : "Related-work scout found no additional citation candidates beyond the existing corpus."
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedAudit = buildCoverageAudit({
      before,
      addedRows,
      executedQueries,
      status: "failed",
      reason: message,
      stopReason: "search failed before coverage target was reached"
    });
    const failed: RelatedWorkScoutResult = {
      status: "failed",
      reason: message,
      query: request.query,
      rationale: request.rationale,
      requested_limit: request.limit,
      papers: addedRows.map(buildScoutPaperArtifact),
      corpusRows: addedRows,
      queryPlan: plan,
      coverageAudit: failedAudit
    };
    await persistScoutResult(input.run, request, failed);
    input.emitLog?.(`Related-work scout failed: ${message}`);
    return failed;
  }
}

function evaluateScoutNeed(bundle: PaperWritingBundle): {
  enabled: boolean;
  reason: string;
  requestedLimit: number;
} {
  const citationGap = hasCitationGap(bundle);
  const summaryGap = bundle.paperSummaries.length < RELATED_WORK_SUMMARY_MIN;
  const corpusGap = bundle.corpus.length < RELATED_WORK_CORPUS_MIN;
  const enabled = citationGap || summaryGap || corpusGap;
  if (!enabled) {
    return {
      enabled: false,
      reason: "existing literature coverage is already sufficient for related-work drafting",
      requestedLimit: 0
    };
  }
  return {
    enabled: true,
    reason: citationGap
      ? "review context indicates missing citations or thin related-work coverage"
      : "literature coverage is still thin for paper drafting",
    requestedLimit: resolveRequestedLimit(bundle, citationGap)
  };
}

function resolveRequestedLimit(bundle: PaperWritingBundle, citationGap: boolean): number {
  if (citationGap || bundle.paperSummaries.length <= 2 || bundle.corpus.length <= 3) {
    return RELATED_WORK_SCOUT_MAX_RESULTS;
  }
  if (bundle.paperSummaries.length <= 4 || bundle.corpus.length <= 6) {
    return 5;
  }
  return 4;
}

function buildScoutPlan(
  bundle: PaperWritingBundle,
  constraintProfile: ConstraintProfile,
  trigger: { reason: string; requestedLimit: number }
): RelatedWorkScoutPlanArtifact {
  const selectedDesignTitle =
    bundle.experimentPlan?.selectedTitle || bundle.resultAnalysis?.overview?.selected_design_title || "";
  const objectiveSummary = bundle.resultAnalysis?.overview?.objective_summary || "";
  const hypothesisKeywords = extractKeywords([
    ...bundle.hypotheses.slice(0, 2).map((item) => item.text),
    ...bundle.hypotheses.slice(0, 2).map((item) => item.measurement_hint || "")
  ]);
  const evidenceKeywords = extractKeywords([
    ...bundle.evidenceRows.slice(0, 3).map((item) => item.metric_slot),
    ...bundle.evidenceRows.slice(0, 3).map((item) => item.result_slot)
  ]);
  const literatureKeywords = extractKeywords([
    ...bundle.paperSummaries.slice(0, 3).map((item) => item.title),
    ...bundle.paperSummaries.slice(0, 3).map((item) => item.novelty),
    objectiveSummary
  ]);

  const primaryQuery = joinQueryParts([bundle.topic, selectedDesignTitle, bundle.objectiveMetric]);
  const plannedQueries = uniquePlannedQueries(
    [
      {
        id: "topic_design_anchor",
        query: primaryQuery,
        rationale: "Anchor the scout on the run topic plus the selected design title."
      },
      {
        id: "hypothesis_metric_bridge",
        query: joinQueryParts([bundle.topic, hypothesisKeywords.join(" "), evidenceKeywords.join(" ")]),
        rationale: "Widen coverage with hypothesis and metric terms that are underrepresented in the current draft bundle."
      },
      {
        id: "literature_context_backfill",
        query: joinQueryParts([bundle.topic, literatureKeywords.join(" ")]),
        rationale: "Backfill broader related-work framing terms drawn from analyzed-paper novelty and objective summaries."
      }
    ],
    bundle.topic
  ).slice(0, RELATED_WORK_QUERY_PLAN_MAX);

  const primary = plannedQueries[0] || {
    id: "topic_anchor",
    query: bundle.topic.trim() || "related work",
    rationale: "Fallback scout query anchored on the run topic."
  };

  return {
    trigger_reason: trigger.reason,
    primary_query: primary.query,
    rationale: selectedDesignTitle
      ? "Use the run topic plus design, hypothesis, and literature context to scout additional related-work citations during drafting."
      : "Use the run topic plus hypothesis and literature context to scout additional related-work citations during drafting.",
    target_additional_papers: Math.max(1, trigger.requestedLimit || 4),
    per_query_limit: Math.min(Math.max(2, trigger.requestedLimit || 4), RELATED_WORK_PER_QUERY_LIMIT),
    planned_queries: plannedQueries.length > 0 ? plannedQueries : [primary],
    filters: buildSemanticScholarFilters(
      mergeCollectConstraintDefaults(undefined, constraintProfile.collect)
    )
  };
}

function buildCoverageSnapshot(
  bundle: PaperWritingBundle,
  targetAdditionalPapers: number
): RelatedWorkScoutCoverageSnapshot {
  const currentYear = new Date().getFullYear();
  return {
    analyzed_paper_count: bundle.paperSummaries.length,
    corpus_count: bundle.corpus.length,
    unique_venue_count: new Set(bundle.corpus.map((item) => (item.venue || "").trim()).filter(Boolean)).size,
    recent_paper_count: bundle.corpus.filter(
      (item) => typeof item.year === "number" && item.year >= currentYear - 2
    ).length,
    citation_gap_detected: hasCitationGap(bundle),
    target_additional_papers: Math.max(0, targetAdditionalPapers)
  };
}

function buildCoverageAudit(input: {
  before: RelatedWorkScoutCoverageSnapshot;
  addedRows: StoredCorpusRow[];
  executedQueries: RelatedWorkScoutExecutedQuery[];
  status: RelatedWorkScoutCoverageAudit["status"];
  reason: string;
  stopReason: string;
}): RelatedWorkScoutCoverageAudit {
  const currentYear = new Date().getFullYear();
  return {
    status: input.status,
    reason: input.reason,
    before: input.before,
    after: {
      additional_papers: input.addedRows.length,
      total_corpus_count: input.before.corpus_count + input.addedRows.length,
      unique_added_venues: new Set(input.addedRows.map((item) => (item.venue || "").trim()).filter(Boolean)).size,
      recent_added_papers: input.addedRows.filter(
        (item) => typeof item.year === "number" && item.year >= currentYear - 2
      ).length,
      executed_query_count: input.executedQueries.length
    },
    executed_queries: input.executedQueries,
    stop_reason: input.stopReason
  };
}

function hasSufficientCoverage(audit: RelatedWorkScoutCoverageAudit): boolean {
  if (audit.after.additional_papers >= audit.before.target_additional_papers) {
    return true;
  }
  if (audit.after.additional_papers >= 2 && audit.after.unique_added_venues >= 2) {
    return true;
  }
  if (audit.before.citation_gap_detected && audit.after.additional_papers >= 2) {
    return true;
  }
  if (audit.before.recent_paper_count === 0 && audit.after.recent_added_papers >= 1 && audit.after.additional_papers >= 2) {
    return true;
  }
  return false;
}

function resolveCoverageStopReason(audit: RelatedWorkScoutCoverageAudit): string {
  if (audit.after.additional_papers >= audit.before.target_additional_papers) {
    return "target additional paper count reached";
  }
  if (audit.after.additional_papers >= 2 && audit.after.unique_added_venues >= 2) {
    return "enough venue diversity was added for related-work framing";
  }
  if (audit.before.citation_gap_detected && audit.after.additional_papers >= 2) {
    return "citation gap was reduced with multiple new related-work candidates";
  }
  if (audit.before.recent_paper_count === 0 && audit.after.recent_added_papers >= 1 && audit.after.additional_papers >= 2) {
    return "recent related-work coverage was backfilled";
  }
  return "bounded coverage target reached";
}

function hasCitationGap(bundle: PaperWritingBundle): boolean {
  const text = [
    bundle.reviewContext?.summary || "",
    ...(bundle.reviewContext?.requiredActions || []),
    ...(bundle.reviewContext?.topFindings || [])
  ]
    .join(" ")
    .toLowerCase();
  return /\bcitation\b|\brelated work\b|\bliterature\b/.test(text);
}

async function loadCachedScout(
  run: RunRecord,
  request: RelatedWorkScoutRequestArtifact
): Promise<{
  query: string;
  rationale: string;
  papers: RelatedWorkScoutPaperArtifact[];
  corpusRows: StoredCorpusRow[];
  queryPlan: RelatedWorkScoutPlanArtifact;
  coverageAudit: RelatedWorkScoutCoverageAudit;
} | null> {
  const requestRaw = await safeRead(`.autolabos/runs/${run.id}/paper/related_work_scout/request.json`);
  const resultRaw = await safeRead(`.autolabos/runs/${run.id}/paper/related_work_scout/result.json`);
  const corpusRaw = await safeRead(`.autolabos/runs/${run.id}/paper/related_work_scout/corpus.jsonl`);
  const planRaw = await safeRead(`.autolabos/runs/${run.id}/paper/related_work_scout/plan.json`);
  const coverageRaw = await safeRead(`.autolabos/runs/${run.id}/paper/related_work_scout/coverage_audit.json`);
  if (!requestRaw || !resultRaw || !corpusRaw || !planRaw || !coverageRaw) {
    return null;
  }

  try {
    const cachedRequest = JSON.parse(requestRaw) as RelatedWorkScoutRequestArtifact;
    const cachedResult = JSON.parse(resultRaw) as RelatedWorkScoutPersistedResult;
    const cachedPlan = JSON.parse(planRaw) as RelatedWorkScoutPlanArtifact;
    const coverageAudit = JSON.parse(coverageRaw) as RelatedWorkScoutCoverageAudit;
    if (
      (cachedResult.status !== "collected" && cachedResult.status !== "reused") ||
      cachedResult.paper_count <= 0 ||
      cachedRequest.query !== request.query ||
      cachedRequest.limit !== request.limit ||
      cachedRequest.per_query_limit !== request.per_query_limit ||
      cachedRequest.target_additional_papers !== request.target_additional_papers ||
      JSON.stringify(cachedRequest.filters || {}) !== JSON.stringify(request.filters || {}) ||
      JSON.stringify(cachedRequest.planned_queries || []) !== JSON.stringify(request.planned_queries || [])
    ) {
      return null;
    }
    const corpusRows = parseCorpusRows(corpusRaw);
    if (corpusRows.length === 0) {
      return null;
    }
    const papers = Array.isArray(cachedResult.papers) ? cachedResult.papers : [];
    return {
      query: cachedRequest.query,
      rationale: cachedRequest.rationale,
      papers,
      corpusRows,
      queryPlan: cachedPlan,
      coverageAudit
    };
  } catch {
    return null;
  }
}

async function persistScoutResult(
  run: RunRecord,
  request: RelatedWorkScoutRequestArtifact,
  result: RelatedWorkScoutResult
): Promise<void> {
  await writeRunArtifact(
    run,
    "paper/related_work_scout/request.json",
    `${JSON.stringify(request, null, 2)}\n`
  );
  if (result.queryPlan) {
    await writeRunArtifact(
      run,
      "paper/related_work_scout/plan.json",
      `${JSON.stringify(result.queryPlan, null, 2)}\n`
    );
  }
  if (result.coverageAudit) {
    await writeRunArtifact(
      run,
      "paper/related_work_scout/coverage_audit.json",
      `${JSON.stringify(result.coverageAudit, null, 2)}\n`
    );
  }
  const persisted: RelatedWorkScoutPersistedResult = {
    status: result.status,
    reason: result.reason,
    query: result.query,
    rationale: result.rationale,
    requested_limit: result.requested_limit,
    paper_count: result.papers.length,
    papers: result.papers,
    reused_from_cache: result.status === "reused",
    error: result.status === "failed" ? result.reason : undefined
  };
  await writeRunArtifact(
    run,
    "paper/related_work_scout/result.json",
    `${JSON.stringify(persisted, null, 2)}\n`
  );
  const corpusJsonl =
    result.corpusRows.length > 0 ? `${result.corpusRows.map((item) => JSON.stringify(item)).join("\n")}\n` : "";
  await writeRunArtifact(run, "paper/related_work_scout/corpus.jsonl", corpusJsonl);
  await writeRunArtifact(
    run,
    "paper/related_work_scout/bibtex.bib",
    result.corpusRows.length > 0 ? `${buildBibtexFile(result.corpusRows, "hybrid")}\n` : ""
  );
}

function normalizeScoutCorpusRow(paper: SemanticScholarPaper): StoredCorpusRow {
  return {
    paper_id: cleanText(paper.paperId) || paper.paperId,
    title: cleanText(paper.title),
    abstract: (typeof paper.abstract === "string" ? paper.abstract.trim() : "") || "",
    year: paper.year,
    venue: typeof paper.venue === "string" ? paper.venue.trim() : undefined,
    url: paper.url,
    landing_url: isSemanticScholarUrl(paper.url) ? undefined : paper.url,
    pdf_url: paper.openAccessPdfUrl,
    pdf_url_source: paper.openAccessPdfUrl ? "semantic_scholar" : undefined,
    authors: Array.isArray(paper.authors) ? paper.authors.filter(Boolean) : [],
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

function buildScoutPaperArtifact(row: StoredCorpusRow): RelatedWorkScoutPaperArtifact {
  const venueLabel = [row.venue, typeof row.year === "number" ? String(row.year) : ""]
    .filter(Boolean)
    .join(" ");
  const citationLabel =
    typeof row.citation_count === "number" ? `Citations: ${row.citation_count}.` : "";
  const baseSummary = row.abstract.trim()
    ? truncateText(row.abstract.trim(), 260)
    : truncateText(`${row.title}. ${venueLabel}`.trim(), 200);
  const summary = [venueLabel ? `${venueLabel}.` : "", baseSummary, citationLabel]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    paper_id: row.paper_id,
    title: row.title,
    summary,
    source_type: "semantic_scholar_scout",
    year: row.year,
    venue: row.venue,
    citation_count: row.citation_count
  };
}

function buildSemanticScholarFilters(
  filters: ConstraintProfile["collect"] | undefined
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

function resolvePublicationDateOrYear(
  filters: ConstraintProfile["collect"] | undefined
): string | undefined {
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

function uniquePlannedQueries(
  queries: RelatedWorkScoutPlannedQuery[],
  fallbackTopic: string
): RelatedWorkScoutPlannedQuery[] {
  const seen = new Set<string>();
  const result: RelatedWorkScoutPlannedQuery[] = [];
  for (const query of queries) {
    const normalized = joinQueryParts([query.query]) || fallbackTopic.trim() || "related work";
    if (!normalized || seen.has(normalized.toLowerCase())) {
      continue;
    }
    seen.add(normalized.toLowerCase());
    result.push({
      ...query,
      query: normalized
    });
  }
  return result;
}

function joinQueryParts(parts: Array<string | undefined>): string {
  return uniqueStrings(parts.map((item) => cleanText(item))).join(" ").trim();
}

function extractKeywords(segments: string[], maxKeywords = 4): string[] {
  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const tokens = cleanText(segment)
      .toLowerCase()
      .split(/[^a-z0-9-]+/u)
      .map((token) => token.trim())
      .filter(Boolean);
    for (const token of tokens) {
      if (seen.has(token) || QUERY_STOPWORDS.has(token) || token.length < 4) {
        continue;
      }
      seen.add(token);
      keywords.push(token);
      if (keywords.length >= maxKeywords) {
        return keywords;
      }
    }
  }
  return keywords;
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = typeof value === "string" ? value.trim() : "";
    if (!cleaned || seen.has(cleaned.toLowerCase())) {
      continue;
    }
    seen.add(cleaned.toLowerCase());
    result.push(cleaned);
  }
  return result;
}

function cleanText(value: string | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function isSemanticScholarUrl(url: string | undefined): boolean {
  return typeof url === "string" && /semanticscholar\.org/i.test(url);
}
