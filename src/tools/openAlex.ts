import {
  PaperSearchCandidate,
  PaperSearchFilterApplication,
  PaperSearchProviderDiagnostics
} from "../core/collection/types.js";
import { SemanticScholarSearchRequest } from "./semanticScholar.js";
import {
  buildSearchQueryPlan,
  cleanDoi,
  dedupePaperSearchCandidates,
  filterCandidatesByExcludedQueryTerms,
  filterPaperSearchCandidates,
  parseYear,
  resolveDateBounds,
  resolvePerQueryLimit
} from "./paperSearchCommon.js";

interface OpenAlexLocation {
  landing_page_url?: string | null;
  pdf_url?: string | null;
  source?: {
    display_name?: string | null;
  } | null;
}

interface OpenAlexAuthorship {
  author?: {
    display_name?: string | null;
  } | null;
}

interface OpenAlexConcept {
  display_name?: string | null;
}

interface OpenAlexWork {
  id?: string;
  display_name?: string | null;
  title?: string | null;
  abstract_inverted_index?: Record<string, number[]>;
  publication_year?: number | null;
  publication_date?: string | null;
  doi?: string | null;
  cited_by_count?: number | null;
  type?: string | null;
  authorships?: OpenAlexAuthorship[] | null;
  concepts?: OpenAlexConcept[] | null;
  primary_location?: OpenAlexLocation | null;
  best_oa_location?: OpenAlexLocation | null;
  locations?: OpenAlexLocation[] | null;
  open_access?: {
    oa_url?: string | null;
  } | null;
}

interface OpenAlexResponse {
  results?: OpenAlexWork[];
}

const OPENALEX_MAX_RESULTS = 50;

export class OpenAlexClient {
  readonly provider = "openalex";
  private lastSearchDiagnostics: PaperSearchProviderDiagnostics = emptyDiagnostics("");

  async searchPapers(
    request: SemanticScholarSearchRequest,
    abortSignal?: AbortSignal
  ): Promise<PaperSearchCandidate[]> {
    const queryPlan = buildSearchQueryPlan(request.query);
    const queryVariants = queryPlan.variantClauses.map((clause) => clause.text).filter(Boolean);
    const filterApplications = buildOpenAlexFilterApplications(request);
    const filterValues = buildOpenAlexFilterValues(request, filterApplications);
    const providerLimit = resolvePerQueryLimit(request.limit, OPENALEX_MAX_RESULTS, queryVariants.length);

    this.lastSearchDiagnostics = {
      ...emptyDiagnostics(queryVariants[0] || request.query),
      originalQuery: request.query,
      query: queryVariants.join(" OR ") || request.query,
      providerLimit: OPENALEX_MAX_RESULTS,
      queryTransformation: {
        original: request.query,
        transformed: queryVariants.join(" OR ") || request.query,
        strategy: describeVariantStrategy(request.query, queryVariants, queryPlan.excludedTerms),
        variants: queryVariants
      },
      filterApplications
    };

    if (queryVariants.length === 0) {
      return [];
    }

    const candidates: PaperSearchCandidate[] = [];
    let firstError: string | undefined;

    for (const queryVariant of queryVariants) {
      const endpoint = buildOpenAlexEndpoint(request, queryVariant, providerLimit, filterValues);
      const attempt = this.lastSearchDiagnostics.attempts.length + 1;

      try {
        const response = await fetch(endpoint, {
          headers: {
            Accept: "application/json",
            "User-Agent": "AutoLabOS/1.0.0"
          },
          signal: abortSignal
        });
        this.lastSearchDiagnostics.attempts.push({
          provider: "openalex",
          attempt,
          ok: response.ok,
          status: response.status,
          endpoint: endpoint.toString()
        });
        this.lastSearchDiagnostics.attemptCount = attempt;
        this.lastSearchDiagnostics.lastStatus = response.status;
        if (!response.ok) {
          firstError ||= `OpenAlex search failed with status ${response.status}`;
          continue;
        }
        const raw = (await response.json()) as OpenAlexResponse;
        candidates.push(
          ...(raw.results ?? [])
            .map((work) => normalizeOpenAlexWork(work))
            .filter((candidate): candidate is PaperSearchCandidate => Boolean(candidate))
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastSearchDiagnostics.attempts.push({
          provider: "openalex",
          attempt,
          ok: false,
          endpoint: endpoint.toString(),
          errorMessage: message
        });
        this.lastSearchDiagnostics.attemptCount = attempt;
        firstError ||= message;
      }
    }

    const filtered = filterPaperSearchCandidates(
      request,
      filterCandidatesByExcludedQueryTerms(request.query, dedupePaperSearchCandidates(candidates))
    );
    this.lastSearchDiagnostics.fetched = filtered.length;
    if (filtered.length === 0 && firstError) {
      this.lastSearchDiagnostics.error = firstError;
    }
    return filtered;
  }

  getLastSearchDiagnostics(): PaperSearchProviderDiagnostics {
    return {
      ...this.lastSearchDiagnostics,
      attempts: this.lastSearchDiagnostics.attempts.map((attempt) => ({ ...attempt }))
    };
  }
}

function normalizeOpenAlexWork(work: OpenAlexWork): PaperSearchCandidate | undefined {
  const title = work.display_name || work.title || undefined;
  if (!title?.trim()) {
    return undefined;
  }

  const locations = [work.primary_location, work.best_oa_location, ...(work.locations ?? [])].filter(
    (value): value is OpenAlexLocation => Boolean(value)
  );
  const landingUrl = firstString(locations.map((location) => location.landing_page_url)) || cleanDoiUrl(work.doi);
  const openAccessPdfUrl = firstPdfLikeUrl([
    ...locations.map((location) => location.pdf_url),
    work.open_access?.oa_url
  ]);

  return {
    provider: "openalex",
    providerId: work.id || undefined,
    title: title.trim(),
    abstract: decodeAbstract(work.abstract_inverted_index),
    year: typeof work.publication_year === "number" ? work.publication_year : parseYear(work.publication_date),
    venue: firstString(locations.map((location) => location.source?.display_name)),
    url: landingUrl,
    landingUrl,
    openAccessPdfUrl,
    authors: (work.authorships ?? [])
      .map((authorship) => authorship.author?.display_name?.trim())
      .filter((value): value is string => Boolean(value)),
    doi: cleanDoi(work.doi || undefined),
    citationCount: typeof work.cited_by_count === "number" ? work.cited_by_count : undefined,
    publicationDate: work.publication_date || undefined,
    publicationTypes: work.type ? [work.type] : undefined,
    fieldsOfStudy: (work.concepts ?? [])
      .map((concept) => concept.display_name?.trim())
      .filter((value): value is string => Boolean(value))
      .slice(0, 8)
  };
}

function decodeAbstract(index: Record<string, number[]> | undefined): string | undefined {
  if (!index || typeof index !== "object") {
    return undefined;
  }
  const positions: Array<[number, string]> = [];
  for (const [token, tokenPositions] of Object.entries(index)) {
    for (const position of tokenPositions) {
      positions.push([position, token]);
    }
  }
  if (positions.length === 0) {
    return undefined;
  }
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, token]) => token).join(" ");
}

function cleanDoiUrl(doi: string | null | undefined): string | undefined {
  const normalized = cleanDoi(doi || undefined);
  return normalized ? `https://doi.org/${normalized}` : undefined;
}

function firstString(values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstPdfLikeUrl(values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    if (looksLikePdfUrl(value)) {
      return value.trim();
    }
  }
  return undefined;
}

function looksLikePdfUrl(url: string): boolean {
  return /\.pdf($|[?#])/i.test(url) || /\/pdf($|[/?#])/i.test(url);
}

function emptyDiagnostics(query: string): PaperSearchProviderDiagnostics {
  return {
    provider: "openalex",
    query,
    fetched: 0,
    attemptCount: 0,
    attempts: []
  };
}

function buildOpenAlexEndpoint(
  request: SemanticScholarSearchRequest,
  query: string,
  limit: number,
  filterValues: string[]
): URL {
  const endpoint = new URL("https://api.openalex.org/works");
  endpoint.searchParams.set("search", query);
  endpoint.searchParams.set("per-page", String(limit));
  endpoint.searchParams.set(
    "select",
    [
      "id",
      "display_name",
      "title",
      "abstract_inverted_index",
      "publication_year",
      "publication_date",
      "doi",
      "cited_by_count",
      "type",
      "authorships",
      "concepts",
      "primary_location",
      "best_oa_location",
      "locations",
      "open_access"
    ].join(",")
  );
  if (filterValues.length > 0) {
    endpoint.searchParams.set("filter", filterValues.join(","));
  }

  switch (request.sort?.field) {
    case "citationCount":
      endpoint.searchParams.set("sort", `cited_by_count:${request.sort.order ?? "desc"}`);
      break;
    case "publicationDate":
      endpoint.searchParams.set("sort", `publication_date:${request.sort.order ?? "desc"}`);
      break;
    default:
      break;
  }

  return endpoint;
}

function buildOpenAlexFilterValues(
  request: SemanticScholarSearchRequest,
  applications: PaperSearchFilterApplication[]
): string[] {
  const values: string[] = [];
  const bounds = resolveDateBounds(request.filters);
  if (bounds.startDate) {
    values.push(`from_publication_date:${bounds.startDate}`);
  }
  if (bounds.endDate) {
    values.push(`to_publication_date:${bounds.endDate}`);
  }
  if (request.filters?.openAccessPdf) {
    values.push("is_oa:true");
  }
  if (typeof request.filters?.minCitationCount === "number" && Number.isFinite(request.filters.minCitationCount)) {
    values.push(`cited_by_count:>${Math.max(0, Math.floor(request.filters.minCitationCount))}`);
  }

  for (const application of applications) {
    if (application.appliedAt === "query" && application.nativeParameter === "sort" && typeof application.value === "string") {
      values.push(application.value);
    }
  }

  return values;
}

function buildOpenAlexFilterApplications(request: SemanticScholarSearchRequest): PaperSearchFilterApplication[] {
  const applications: PaperSearchFilterApplication[] = [];
  const filters = request.filters;
  const bounds = resolveDateBounds(filters);

  if (filters?.year) {
    applications.push({
      filter: "year",
      value: filters.year,
      supported: true,
      appliedAt: "query",
      nativeParameter: "filter=from_publication_date/to_publication_date"
    });
  } else if (filters?.publicationDateOrYear) {
    applications.push({
      filter: "publicationDateOrYear",
      value: filters.publicationDateOrYear,
      supported: true,
      appliedAt: "query",
      nativeParameter: "filter=from_publication_date/to_publication_date"
    });
  }

  if ((bounds.startDate || bounds.endDate) && applications.length === 0) {
    applications.push({
      filter: "publicationDateOrYear",
      value: [bounds.startDate, bounds.endDate].filter((value): value is string => Boolean(value)),
      supported: true,
      appliedAt: "query",
      nativeParameter: "filter=from_publication_date/to_publication_date"
    });
  }

  if (filters?.openAccessPdf) {
    applications.push({
      filter: "openAccessPdf",
      value: true,
      supported: true,
      appliedAt: "query",
      nativeParameter: "filter=is_oa"
    });
  }

  if (typeof filters?.minCitationCount === "number" && Number.isFinite(filters.minCitationCount)) {
    applications.push({
      filter: "minCitationCount",
      value: filters.minCitationCount,
      supported: true,
      appliedAt: "query",
      nativeParameter: "filter=cited_by_count"
    });
  }

  if (filters?.venue?.length) {
    applications.push({
      filter: "venue",
      value: filters.venue,
      supported: false,
      appliedAt: "post_fetch"
    });
  }

  if (filters?.fieldsOfStudy?.length) {
    applications.push({
      filter: "fieldsOfStudy",
      value: filters.fieldsOfStudy,
      supported: false,
      appliedAt: "post_fetch"
    });
  }

  if (filters?.publicationTypes?.length) {
    applications.push({
      filter: "publicationTypes",
      value: filters.publicationTypes,
      supported: false,
      appliedAt: "post_fetch"
    });
  }

  return applications;
}

function describeVariantStrategy(originalQuery: string, queryVariants: string[], excludedTerms: string[]): string {
  if (queryVariants.length > 1) {
    return excludedTerms.length > 0 ? "split_or_and_exclude_terms" : "split_or_clauses";
  }
  if (excludedTerms.length > 0) {
    return "exclude_negative_terms";
  }
  return queryVariants[0]?.trim() === originalQuery.trim() ? "passthrough" : "plain_text_normalized";
}
