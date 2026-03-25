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

interface CrossrefMessageItem {
  DOI?: string;
  title?: string[];
  abstract?: string;
  URL?: string;
  author?: Array<{ given?: string; family?: string; name?: string }>;
  issued?: { "date-parts"?: number[][] };
  published?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  type?: string;
  link?: Array<{ URL?: string; "content-type"?: string }>;
  publisher?: string;
  "is-referenced-by-count"?: number;
}

interface CrossrefResponse {
  message?: {
    items?: CrossrefMessageItem[];
  };
}

const CROSSREF_MAX_RESULTS = 50;

export class CrossrefClient {
  readonly provider = "crossref";
  private lastSearchDiagnostics: PaperSearchProviderDiagnostics = emptyDiagnostics("");

  async searchPapers(
    request: SemanticScholarSearchRequest,
    abortSignal?: AbortSignal
  ): Promise<PaperSearchCandidate[]> {
    const queryPlan = buildSearchQueryPlan(request.query);
    const queryVariants = queryPlan.variantClauses.map((clause) => clause.text).filter(Boolean);
    const filterApplications = buildCrossrefFilterApplications(request);
    const perQueryLimit = resolvePerQueryLimit(request.limit, CROSSREF_MAX_RESULTS, queryVariants.length);

    this.lastSearchDiagnostics = {
      ...emptyDiagnostics(queryVariants[0] || request.query),
      originalQuery: request.query,
      query: queryVariants.join(" OR ") || request.query,
      providerLimit: CROSSREF_MAX_RESULTS,
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
      const endpoint = buildCrossrefEndpoint(request, queryVariant, perQueryLimit);
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
          provider: "crossref",
          attempt,
          ok: response.ok,
          status: response.status,
          endpoint: endpoint.toString()
        });
        this.lastSearchDiagnostics.attemptCount = attempt;
        this.lastSearchDiagnostics.lastStatus = response.status;
        if (!response.ok) {
          firstError ||= `Crossref search failed with status ${response.status}`;
          continue;
        }
        const raw = (await response.json()) as CrossrefResponse;
        candidates.push(
          ...(raw.message?.items ?? [])
            .map((item) => normalizeCrossrefItem(item))
            .filter((candidate): candidate is PaperSearchCandidate => Boolean(candidate))
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastSearchDiagnostics.attempts.push({
          provider: "crossref",
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

function normalizeCrossrefItem(item: CrossrefMessageItem): PaperSearchCandidate | undefined {
  const title = item.title?.[0]?.trim();
  if (!title) {
    return undefined;
  }

  const doi = cleanDoi(item.DOI);
  const url = item.URL?.trim() || (doi ? `https://doi.org/${doi}` : undefined);
  const pdfLink = item.link?.find((link) =>
    typeof link.URL === "string" && (
      link["content-type"] === "application/pdf" || /\.pdf($|[?#])/i.test(link.URL)
    )
  )?.URL;

  return {
    provider: "crossref",
    providerId: doi || url,
    title,
    abstract: stripJats(item.abstract),
    year: extractCrossrefYear(item),
    venue: item["container-title"]?.[0]?.trim() || item.publisher?.trim() || undefined,
    url,
    landingUrl: url,
    openAccessPdfUrl: typeof pdfLink === "string" && pdfLink.trim() ? pdfLink.trim() : undefined,
    authors: (item.author ?? [])
      .map((author) => author.name || [author.given, author.family].filter(Boolean).join(" ").trim())
      .filter((value): value is string => Boolean(value)),
    doi,
    citationCount: typeof item["is-referenced-by-count"] === "number" ? item["is-referenced-by-count"] : undefined,
    publicationDate: extractPublicationDate(item),
    publicationTypes: item.type ? [item.type] : undefined
  };
}

function stripJats(value: string | undefined): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCrossrefYear(item: CrossrefMessageItem): number | undefined {
  return (
    parseYear(item.issued?.["date-parts"]?.[0]?.[0])
    ?? parseYear(item.published?.["date-parts"]?.[0]?.[0])
  );
}

function extractPublicationDate(item: CrossrefMessageItem): string | undefined {
  const parts = item.issued?.["date-parts"]?.[0] ?? item.published?.["date-parts"]?.[0];
  if (!Array.isArray(parts) || parts.length === 0) {
    return undefined;
  }
  const [year, month, day] = parts;
  const safeYear = parseYear(year);
  if (!safeYear) {
    return undefined;
  }
  const safeMonth = typeof month === "number" && month >= 1 ? String(month).padStart(2, "0") : "01";
  const safeDay = typeof day === "number" && day >= 1 ? String(day).padStart(2, "0") : "01";
  return `${safeYear}-${safeMonth}-${safeDay}`;
}

function emptyDiagnostics(query: string): PaperSearchProviderDiagnostics {
  return {
    provider: "crossref",
    query,
    fetched: 0,
    attemptCount: 0,
    attempts: []
  };
}

function buildCrossrefEndpoint(
  request: SemanticScholarSearchRequest,
  query: string,
  limit: number
): URL {
  const endpoint = new URL("https://api.crossref.org/works");
  endpoint.searchParams.set("query.bibliographic", query);
  endpoint.searchParams.set("rows", String(limit));

  const venueFilters = request.filters?.venue?.filter(Boolean) ?? [];
  if (venueFilters.length === 1) {
    endpoint.searchParams.set("query.container-title", venueFilters[0]);
  }

  const filterValues = buildCrossrefFilterValues(request);
  if (filterValues.length > 0) {
    endpoint.searchParams.set("filter", filterValues.join(","));
  }
  return endpoint;
}

function buildCrossrefFilterValues(request: SemanticScholarSearchRequest): string[] {
  const filters: string[] = [];
  const bounds = resolveDateBounds(request.filters);
  if (bounds.startDate) {
    filters.push(`from-pub-date:${bounds.startDate}`);
  }
  if (bounds.endDate) {
    filters.push(`until-pub-date:${bounds.endDate}`);
  }

  const publicationTypes = request.filters?.publicationTypes
    ?.map((value) => normalizeCrossrefTypeFilter(value))
    .filter((value): value is string => Boolean(value));
  if (publicationTypes && publicationTypes.length === 1) {
    filters.push(`type:${publicationTypes[0]}`);
  }

  return filters;
}

function buildCrossrefFilterApplications(request: SemanticScholarSearchRequest): PaperSearchFilterApplication[] {
  const applications: PaperSearchFilterApplication[] = [];
  const filters = request.filters;

  if (filters?.year) {
    applications.push({
      filter: "year",
      value: filters.year,
      supported: true,
      appliedAt: "query",
      nativeParameter: "filter=from-pub-date/until-pub-date"
    });
  } else if (filters?.publicationDateOrYear) {
    applications.push({
      filter: "publicationDateOrYear",
      value: filters.publicationDateOrYear,
      supported: true,
      appliedAt: "query",
      nativeParameter: "filter=from-pub-date/until-pub-date"
    });
  }

  if (filters?.venue?.length === 1) {
    applications.push({
      filter: "venue",
      value: filters.venue,
      supported: true,
      appliedAt: "query",
      nativeParameter: "query.container-title"
    });
  } else if (filters?.venue?.length) {
    applications.push({
      filter: "venue",
      value: filters.venue,
      supported: false,
      appliedAt: "post_fetch"
    });
  }

  const mappedTypes = filters?.publicationTypes
    ?.map((value) => normalizeCrossrefTypeFilter(value))
    .filter((value): value is string => Boolean(value));
  if (mappedTypes && mappedTypes.length === 1) {
    applications.push({
      filter: "publicationTypes",
      value: filters?.publicationTypes,
      supported: true,
      appliedAt: "query",
      nativeParameter: "filter=type"
    });
  } else if (filters?.publicationTypes?.length) {
    applications.push({
      filter: "publicationTypes",
      value: filters.publicationTypes,
      supported: false,
      appliedAt: "post_fetch"
    });
  }

  if (filters?.openAccessPdf) {
    applications.push({
      filter: "openAccessPdf",
      value: true,
      supported: false,
      appliedAt: "post_fetch"
    });
  }

  if (typeof filters?.minCitationCount === "number" && Number.isFinite(filters.minCitationCount)) {
    applications.push({
      filter: "minCitationCount",
      value: filters.minCitationCount,
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

  return applications;
}

function normalizeCrossrefTypeFilter(value: string | undefined): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

  const allowed = new Set([
    "journal-article",
    "book-chapter",
    "book",
    "book-part",
    "book-section",
    "book-series",
    "proceedings-article",
    "proceedings",
    "posted-content",
    "preprint",
    "dataset",
    "report",
    "report-component",
    "standard",
    "dissertation",
    "peer-review",
    "reference-entry",
    "reference-book",
    "monograph",
    "edited-book"
  ]);
  return allowed.has(normalized) ? normalized : undefined;
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
