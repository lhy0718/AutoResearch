import {
  AggregatedSearchPaper,
  PaperSearchAggregationReport,
  PaperSearchCandidate,
  PaperSearchCandidateProvenance,
  PaperSearchClusterSummary,
  PaperSearchProvider,
  PaperSearchProviderDiagnostics,
  StoredCorpusRow
} from "./types.js";
import { normalizeS2Bibtex } from "./bibtex.js";
import { mergeStoredCorpusRows } from "./enrichment.js";
import {
  SemanticScholarAttemptRecord,
  SemanticScholarPaper,
  SemanticScholarSearchDiagnostics,
  SemanticScholarSearchRequest
} from "../../tools/semanticScholar.js";
import { cleanDoi, parseYear } from "../../tools/paperSearchCommon.js";

export interface SearchProviderClient {
  provider: PaperSearchProvider;
  searchPapers(request: SemanticScholarSearchRequest, abortSignal?: AbortSignal): Promise<PaperSearchCandidate[]>;
  getLastSearchDiagnostics?(): PaperSearchProviderDiagnostics;
}

export interface AggregatedSearchRecord {
  paper: AggregatedSearchPaper;
  row: StoredCorpusRow;
}

export interface AggregatedPaperSearchResult {
  records: AggregatedSearchRecord[];
  report: PaperSearchAggregationReport;
}

interface CandidateCluster {
  candidates: PaperSearchCandidate[];
  dois: Set<string>;
  arxivIds: Set<string>;
  fingerprints: Set<string>;
}

export function createSemanticScholarSearchProvider(
  client: Pick<{
    streamSearchPapers(request: SemanticScholarSearchRequest, abortSignal?: AbortSignal): AsyncGenerator<SemanticScholarPaper[], void, void>;
    getLastSearchDiagnostics?(): SemanticScholarSearchDiagnostics;
  }, "streamSearchPapers" | "getLastSearchDiagnostics">
): SearchProviderClient {
  let lastErrorMessage: string | undefined;
  return {
    provider: "semantic_scholar",
    async searchPapers(request, abortSignal) {
      lastErrorMessage = undefined;
      const candidates: PaperSearchCandidate[] = [];
      try {
        for await (const batch of client.streamSearchPapers(request, abortSignal)) {
          candidates.push(...batch.map((paper) => normalizeSemanticScholarPaper(paper)));
        }
      } catch (error) {
        if (abortSignal?.aborted) {
          throw error;
        }
        lastErrorMessage = error instanceof Error ? error.message : String(error);
      }
      return candidates;
    },
    getLastSearchDiagnostics() {
      const diagnostics = normalizeSemanticScholarDiagnostics(client.getLastSearchDiagnostics?.());
      return {
        ...diagnostics,
        error: lastErrorMessage
      };
    }
  };
}

export async function runAggregatedPaperSearch(input: {
  request: SemanticScholarSearchRequest;
  providers: SearchProviderClient[];
  abortSignal?: AbortSignal;
}): Promise<AggregatedPaperSearchResult> {
  const rawCandidates: PaperSearchCandidate[] = [];
  const providerDiagnostics: PaperSearchProviderDiagnostics[] = [];

  for (const provider of input.providers) {
    try {
      const candidates = await provider.searchPapers(input.request, input.abortSignal);
      rawCandidates.push(...candidates);
      const diagnostics = provider.getLastSearchDiagnostics?.() || emptyProviderDiagnostics(provider.provider, input.request.query);
      providerDiagnostics.push({
        ...diagnostics,
        provider: provider.provider,
        query: diagnostics.query || input.request.query,
        fetched: candidates.length,
        attempts: diagnostics.attempts.map((attempt) => ({ ...attempt, provider: provider.provider }))
      });
    } catch (error) {
      const diagnostics = provider.getLastSearchDiagnostics?.() || emptyProviderDiagnostics(provider.provider, input.request.query);
      providerDiagnostics.push({
        ...diagnostics,
        provider: provider.provider,
        query: diagnostics.query || input.request.query,
        fetched: diagnostics.fetched ?? 0,
        error: error instanceof Error ? error.message : String(error),
        attempts: diagnostics.attempts.map((attempt) => ({ ...attempt, provider: provider.provider }))
      });
    }
  }

  const clusters = clusterCandidates(rawCandidates);
  const records = clusters
    .map((cluster) => buildAggregatedRecord(cluster))
    .filter((record): record is AggregatedSearchRecord => Boolean(record));
  const providers = Array.from(new Set(providerDiagnostics.map((diagnostic) => diagnostic.provider)));
  const source = providers.length === 1 && providers[0] === "semantic_scholar" ? "semantic_scholar" : "aggregated";

  return {
    records,
    report: {
      source,
      rawCandidateCount: rawCandidates.length,
      canonicalCount: records.length,
      providers,
      providerDiagnostics,
      clusters: records.map((record) => buildClusterSummary(record))
    }
  };
}

function clusterCandidates(candidates: PaperSearchCandidate[]): CandidateCluster[] {
  const clusters: CandidateCluster[] = [];

  for (const candidate of candidates) {
    const identifiers = resolveCandidateIdentifiers(candidate);
    const matchedIndexes: number[] = [];
    for (let index = 0; index < clusters.length; index += 1) {
      if (clusterMatchesCandidate(clusters[index], identifiers)) {
        matchedIndexes.push(index);
      }
    }

    if (matchedIndexes.length === 0) {
      clusters.push(createCluster(candidate, identifiers));
      continue;
    }

    const primaryIndex = matchedIndexes[0];
    const primary = clusters[primaryIndex];
    appendCandidateToCluster(primary, candidate, identifiers);
    for (let index = matchedIndexes.length - 1; index >= 1; index -= 1) {
      const mergeIndex = matchedIndexes[index];
      mergeClusters(primary, clusters[mergeIndex]);
      clusters.splice(mergeIndex, 1);
    }
  }

  return clusters;
}

function buildAggregatedRecord(cluster: CandidateCluster): AggregatedSearchRecord | undefined {
  const ranked = [...cluster.candidates].sort(compareCandidatePriority);
  let mergedRow: StoredCorpusRow | undefined;
  for (const candidate of ranked) {
    mergedRow = mergeStoredCorpusRows(mergedRow, candidateToStoredRow(candidate));
  }
  if (!mergedRow) {
    return undefined;
  }

  const paperId = resolveAggregatedPaperId(ranked, mergedRow);
  const canonical = ranked[0];
  const searchProviders = Array.from(new Set(ranked.map((candidate) => candidate.provider)));
  const provenance = ranked.map((candidate) => buildProvenance(candidate));
  const row: StoredCorpusRow = {
    ...mergedRow,
    paper_id: paperId
  };

  return {
    row,
    paper: {
      paperId,
      title: row.title,
      abstract: row.abstract,
      year: row.year,
      venue: row.venue,
      url: row.url,
      landingUrl: row.landing_url,
      openAccessPdfUrl: row.pdf_url,
      authors: row.authors,
      doi: row.doi,
      arxivId: row.arxiv_id,
      citationCount: row.citation_count,
      influentialCitationCount: row.influential_citation_count,
      publicationDate: row.publication_date,
      publicationTypes: row.publication_types,
      fieldsOfStudy: row.fields_of_study,
      citationStylesBibtex: row.semantic_scholar_bibtex,
      canonicalSource: canonical.provider,
      searchProviders,
      provenance
    }
  };
}

function buildClusterSummary(record: AggregatedSearchRecord): PaperSearchClusterSummary {
  return {
    paperId: record.paper.paperId,
    title: record.paper.title,
    canonicalSource: record.paper.canonicalSource,
    candidateCount: record.paper.provenance.length,
    providers: record.paper.searchProviders,
    doi: record.paper.doi,
    arxivId: record.paper.arxivId,
    selectionReasons: resolveSelectionReasons(record.paper)
  };
}

function createCluster(candidate: PaperSearchCandidate, identifiers: ReturnType<typeof resolveCandidateIdentifiers>): CandidateCluster {
  return {
    candidates: [candidate],
    dois: new Set(identifiers.dois),
    arxivIds: new Set(identifiers.arxivIds),
    fingerprints: new Set(identifiers.fingerprints)
  };
}

function appendCandidateToCluster(
  cluster: CandidateCluster,
  candidate: PaperSearchCandidate,
  identifiers: ReturnType<typeof resolveCandidateIdentifiers>
): void {
  cluster.candidates.push(candidate);
  for (const doi of identifiers.dois) {
    cluster.dois.add(doi);
  }
  for (const arxivId of identifiers.arxivIds) {
    cluster.arxivIds.add(arxivId);
  }
  for (const fingerprint of identifiers.fingerprints) {
    cluster.fingerprints.add(fingerprint);
  }
}

function mergeClusters(target: CandidateCluster, source: CandidateCluster): void {
  target.candidates.push(...source.candidates);
  for (const doi of source.dois) {
    target.dois.add(doi);
  }
  for (const arxivId of source.arxivIds) {
    target.arxivIds.add(arxivId);
  }
  for (const fingerprint of source.fingerprints) {
    target.fingerprints.add(fingerprint);
  }
}

function clusterMatchesCandidate(
  cluster: CandidateCluster,
  identifiers: ReturnType<typeof resolveCandidateIdentifiers>
): boolean {
  return (
    identifiers.dois.some((doi) => cluster.dois.has(doi))
    || identifiers.arxivIds.some((arxivId) => cluster.arxivIds.has(arxivId))
    || identifiers.fingerprints.some((fingerprint) => cluster.fingerprints.has(fingerprint))
  );
}

function resolveCandidateIdentifiers(candidate: PaperSearchCandidate): {
  dois: string[];
  arxivIds: string[];
  fingerprints: string[];
} {
  const doi = cleanDoi(candidate.doi);
  const arxivId = normalizeArxivId(candidate.arxivId);
  const fingerprints = new Set<string>();
  const title = normalizeSearchText(candidate.title);
  const firstAuthor = normalizeSearchText(candidate.authors[0] || "");
  const year = candidate.year ?? parseYear(candidate.publicationDate);
  if (title) {
    if (firstAuthor && typeof year === "number") {
      fingerprints.add(`${title}::${firstAuthor}::${year}`);
    }
    if (typeof year === "number") {
      fingerprints.add(`${title}::${year}`);
    }
    if (title.length >= 24) {
      fingerprints.add(title);
    }
  }

  return {
    dois: doi ? [doi] : [],
    arxivIds: arxivId ? [arxivId] : [],
    fingerprints: Array.from(fingerprints)
  };
}

function resolveAggregatedPaperId(candidates: PaperSearchCandidate[], row: StoredCorpusRow): string {
  const semanticScholarPaperId = candidates.find(
    (candidate) => candidate.provider === "semantic_scholar" && typeof candidate.paperId === "string" && candidate.paperId.trim()
  )?.paperId;
  if (semanticScholarPaperId) {
    return semanticScholarPaperId;
  }
  if (row.doi) {
    return `doi:${row.doi}`;
  }
  if (row.arxiv_id) {
    return `arxiv:${row.arxiv_id}`;
  }
  return buildTitleFingerprint(row.title, row.authors, row.year);
}

function compareCandidatePriority(a: PaperSearchCandidate, b: PaperSearchCandidate): number {
  const priorityDiff = candidatePriority(b) - candidatePriority(a);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  const citationDiff = (b.citationCount ?? -1) - (a.citationCount ?? -1);
  if (citationDiff !== 0) {
    return citationDiff;
  }
  const yearDiff = (b.year ?? -1) - (a.year ?? -1);
  if (yearDiff !== 0) {
    return yearDiff;
  }
  return a.title.localeCompare(b.title);
}

function candidatePriority(candidate: PaperSearchCandidate): number {
  let score = 0;
  switch (candidate.provider) {
    case "crossref":
      score += 40;
      break;
    case "openalex":
      score += 35;
      break;
    case "semantic_scholar":
      score += 10;
      break;
    case "arxiv":
      score += 5;
      break;
  }
  if (cleanDoi(candidate.doi)) {
    score += 25;
  }
  if (hasPublishedVenue(candidate.venue)) {
    score += 20;
  }
  if (candidate.landingUrl && !isArxivUrl(candidate.landingUrl) && !isSemanticScholarUrl(candidate.landingUrl)) {
    score += 15;
  }
  if (candidate.url && !isArxivUrl(candidate.url) && !isSemanticScholarUrl(candidate.url)) {
    score += 10;
  }
  if (candidate.openAccessPdfUrl && !isArxivUrl(candidate.openAccessPdfUrl)) {
    score += 5;
  }
  if (candidate.arxivId) {
    score -= 5;
  }
  if (isArxivVenue(candidate.venue)) {
    score -= 10;
  }
  return score;
}

function candidateToStoredRow(candidate: PaperSearchCandidate): StoredCorpusRow {
  const paperId = candidate.paperId || candidate.providerId || buildTitleFingerprint(candidate.title, candidate.authors, candidate.year);
  const landingUrl = candidate.landingUrl || (isSemanticScholarUrl(candidate.url) ? undefined : candidate.url);
  return {
    paper_id: paperId,
    title: candidate.title,
    abstract: candidate.abstract || "",
    year: candidate.year,
    venue: candidate.venue,
    url: candidate.url,
    landing_url: landingUrl,
    pdf_url: candidate.openAccessPdfUrl,
    pdf_url_source: candidate.openAccessPdfUrl ? candidate.provider : undefined,
    authors: candidate.authors,
    citation_count: candidate.citationCount,
    influential_citation_count: candidate.influentialCitationCount,
    publication_date: candidate.publicationDate,
    publication_types: candidate.publicationTypes,
    fields_of_study: candidate.fieldsOfStudy,
    doi: cleanDoi(candidate.doi),
    arxiv_id: normalizeArxivId(candidate.arxivId),
    semantic_scholar_bibtex:
      candidate.provider === "semantic_scholar"
        ? normalizeS2Bibtex(candidate.citationStylesBibtex)
        : undefined
  };
}

function buildProvenance(candidate: PaperSearchCandidate): PaperSearchCandidateProvenance {
  return {
    provider: candidate.provider,
    providerId: candidate.providerId,
    paperId: candidate.paperId,
    title: candidate.title,
    year: candidate.year,
    venue: candidate.venue,
    doi: cleanDoi(candidate.doi),
    arxivId: normalizeArxivId(candidate.arxivId),
    url: candidate.url,
    landingUrl: candidate.landingUrl,
    openAccessPdfUrl: candidate.openAccessPdfUrl
  };
}

function resolveSelectionReasons(paper: AggregatedSearchPaper): string[] {
  const reasons: string[] = [`canonical_source:${paper.canonicalSource}`];
  if (paper.doi) {
    reasons.push("doi");
  }
  if (hasPublishedVenue(paper.venue)) {
    reasons.push("published_venue");
  }
  if (paper.searchProviders.includes("arxiv") && paper.canonicalSource !== "arxiv") {
    reasons.push("arxiv_deprioritized");
  }
  if (paper.searchProviders.length > 1) {
    reasons.push("multi_provider_merge");
  }
  return reasons;
}

function normalizeSemanticScholarPaper(paper: SemanticScholarPaper): PaperSearchCandidate {
  return {
    provider: "semantic_scholar",
    providerId: paper.paperId,
    paperId: paper.paperId,
    title: paper.title,
    abstract: paper.abstract,
    year: paper.year,
    venue: paper.venue,
    url: paper.url,
    landingUrl: isSemanticScholarUrl(paper.url) ? undefined : paper.url,
    openAccessPdfUrl: paper.openAccessPdfUrl,
    authors: paper.authors,
    doi: cleanDoi(paper.doi),
    arxivId: normalizeArxivId(paper.arxivId),
    citationCount: paper.citationCount,
    influentialCitationCount: paper.influentialCitationCount,
    publicationDate: paper.publicationDate,
    publicationTypes: paper.publicationTypes,
    fieldsOfStudy: paper.fieldsOfStudy,
    citationStylesBibtex: paper.citationStylesBibtex
  };
}

function normalizeSemanticScholarDiagnostics(
  diagnostics: SemanticScholarSearchDiagnostics | undefined
): PaperSearchProviderDiagnostics {
  return {
    provider: "semantic_scholar",
    query: "",
    fetched: 0,
    attemptCount: diagnostics?.attemptCount ?? 0,
    lastStatus: diagnostics?.lastStatus,
    retryAfterMs: diagnostics?.retryAfterMs,
    attempts: (diagnostics?.attempts ?? []).map((attempt) => normalizeSemanticScholarAttempt(attempt))
  };
}

function normalizeSemanticScholarAttempt(attempt: SemanticScholarAttemptRecord) {
  return {
    provider: "semantic_scholar" as const,
    attempt: attempt.attempt,
    ok: attempt.ok,
    status: attempt.status,
    retryAfterMs: attempt.retryAfterMs,
    endpoint: attempt.endpoint,
    errorMessage: attempt.errorMessage
  };
}

function emptyProviderDiagnostics(
  provider: PaperSearchProvider,
  query: string
): PaperSearchProviderDiagnostics {
  return {
    provider,
    query,
    fetched: 0,
    attemptCount: 0,
    attempts: []
  };
}

function normalizeArxivId(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.replace(/^arxiv:/i, "").replace(/v\d+$/i, "").trim() || undefined;
}

function buildTitleFingerprint(title: string, authors: string[], year: number | undefined): string {
  const titlePart = normalizeSearchText(title).replace(/\s+/g, "-").slice(0, 80) || "paper";
  const authorPart = normalizeSearchText(authors[0] || "").replace(/\s+/g, "-").slice(0, 24);
  const yearPart = typeof year === "number" ? String(year) : "unknown";
  return `title:${titlePart}:${authorPart || "anon"}:${yearPart}`;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeHost(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isSemanticScholarUrl(url: string | undefined): boolean {
  const host = safeHost(url);
  return Boolean(host && host.endsWith("semanticscholar.org"));
}

function isArxivUrl(url: string | undefined): boolean {
  return safeHost(url) === "arxiv.org";
}

function isArxivVenue(venue: string | undefined): boolean {
  const normalized = normalizeSearchText(venue || "");
  return normalized.includes("arxiv") || normalized === "corr" || normalized.includes("computing research repository");
}

function hasPublishedVenue(venue: string | undefined): boolean {
  return Boolean(venue && !isArxivVenue(venue));
}
