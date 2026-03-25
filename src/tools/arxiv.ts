import { load } from "cheerio";

import {
  PaperSearchCandidate,
  PaperSearchFilterApplication,
  PaperSearchProviderDiagnostics
} from "../core/collection/types.js";
import { SemanticScholarSearchRequest } from "./semanticScholar.js";
import {
  buildSearchQueryPlan,
  dedupePaperSearchCandidates,
  filterCandidatesByExcludedQueryTerms,
  filterPaperSearchCandidates,
  parseYear,
  resolveDateBounds,
  resolvePerQueryLimit
} from "./paperSearchCommon.js";

const ARXIV_MAX_RESULTS = 25;

export class ArxivClient {
  readonly provider = "arxiv";
  private lastSearchDiagnostics: PaperSearchProviderDiagnostics = emptyDiagnostics("");

  async searchPapers(
    request: SemanticScholarSearchRequest,
    abortSignal?: AbortSignal
  ): Promise<PaperSearchCandidate[]> {
    const queryPlan = buildSearchQueryPlan(request.query);
    const queryVariants = queryPlan.variantClauses
      .map((clause) => buildArxivClauseQuery(clause))
      .filter((value): value is string => Boolean(value));
    const filterApplications = buildArxivFilterApplications(request);
    const perQueryLimit = resolvePerQueryLimit(request.limit, ARXIV_MAX_RESULTS, queryVariants.length);

    this.lastSearchDiagnostics = {
      ...emptyDiagnostics(queryVariants[0] || request.query),
      originalQuery: request.query,
      query: queryVariants.join(" OR ") || request.query,
      providerLimit: ARXIV_MAX_RESULTS,
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
      const endpoint = buildArxivEndpoint(request, queryVariant, perQueryLimit);
      const attempt = this.lastSearchDiagnostics.attempts.length + 1;

      try {
        const response = await fetch(endpoint, {
          headers: {
            Accept: "application/atom+xml",
            "User-Agent": "AutoLabOS/1.0.0"
          },
          signal: abortSignal
        });
        this.lastSearchDiagnostics.attempts.push({
          provider: "arxiv",
          attempt,
          ok: response.ok,
          status: response.status,
          endpoint: endpoint.toString()
        });
        this.lastSearchDiagnostics.attemptCount = attempt;
        this.lastSearchDiagnostics.lastStatus = response.status;
        if (!response.ok) {
          firstError ||= `arXiv search failed with status ${response.status}`;
          continue;
        }
        const raw = await response.text();
        candidates.push(...parseArxivFeed(raw));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastSearchDiagnostics.attempts.push({
          provider: "arxiv",
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

function parseArxivFeed(raw: string): PaperSearchCandidate[] {
  const $ = load(raw, { xmlMode: true });
  const candidates: PaperSearchCandidate[] = [];

  $("entry").each((_, entry) => {
    const idText = $(entry).find("id").first().text().trim();
    const title = $(entry).find("title").first().text().replace(/\s+/g, " ").trim();
    if (!title) {
      return;
    }
    const normalizedId = normalizeArxivId(idText);
    const absUrl = normalizedId ? `https://arxiv.org/abs/${normalizedId}` : undefined;
    const pdfUrl = normalizedId ? `https://arxiv.org/pdf/${normalizedId}.pdf` : undefined;
    const summary = $(entry).find("summary").first().text().replace(/\s+/g, " ").trim();
    const published = $(entry).find("published").first().text().trim();
    const authors = $(entry)
      .find("author > name")
      .toArray()
      .map((node) => $(node).text().trim())
      .filter(Boolean);
    const doi = $(entry).find("arxiv\\:doi, doi").first().text().trim() || undefined;
    const journalRef = $(entry).find("arxiv\\:journal_ref, journal_ref").first().text().trim() || undefined;

    candidates.push({
      provider: "arxiv",
      providerId: normalizedId,
      title,
      abstract: summary || undefined,
      year: parseYear(published),
      venue: journalRef,
      url: absUrl,
      landingUrl: absUrl,
      openAccessPdfUrl: pdfUrl,
      authors,
      doi: doi || undefined,
      arxivId: normalizedId,
      publicationDate: published || undefined,
      publicationTypes: ["preprint"]
    });
  });

  return candidates;
}

function normalizeArxivId(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = trimmed.match(/(?:abs|pdf)\/([^/?#]+?)(?:\.pdf)?$/i);
  const raw = match?.[1] || trimmed;
  return raw.replace(/v\d+$/i, "").trim() || undefined;
}

function emptyDiagnostics(query: string): PaperSearchProviderDiagnostics {
  return {
    provider: "arxiv",
    query,
    fetched: 0,
    attemptCount: 0,
    attempts: []
  };
}

function buildArxivEndpoint(
  request: SemanticScholarSearchRequest,
  query: string,
  limit: number
): URL {
  const endpoint = new URL("https://export.arxiv.org/api/query");
  endpoint.searchParams.set("search_query", query);
  endpoint.searchParams.set("start", "0");
  endpoint.searchParams.set("max_results", String(limit));

  if (request.sort?.field === "publicationDate") {
    endpoint.searchParams.set("sortBy", "submittedDate");
    endpoint.searchParams.set("sortOrder", request.sort.order === "asc" ? "ascending" : "descending");
  } else {
    endpoint.searchParams.set("sortBy", "relevance");
    endpoint.searchParams.set("sortOrder", request.sort?.order === "asc" ? "ascending" : "descending");
  }

  return endpoint;
}

function buildArxivClauseQuery(clause: { phrases: string[]; terms: string[] }): string | undefined {
  const tokens = [
    ...clause.phrases.map((phrase) => `all:${quoteArxivTerm(phrase)}`),
    ...clause.terms.map((term) => `all:${quoteArxivTerm(term)}`)
  ];
  if (tokens.length === 0) {
    return undefined;
  }
  return tokens.join(" AND ");
}

function quoteArxivTerm(query: string): string {
  const escaped = query.replace(/"/g, " ").trim();
  if (!escaped) {
    return '""';
  }
  if (/\s/.test(escaped)) {
    return `"${escaped}"`;
  }
  return escaped;
}

function buildArxivFilterApplications(request: SemanticScholarSearchRequest): PaperSearchFilterApplication[] {
  const applications: PaperSearchFilterApplication[] = [];
  const filters = request.filters;
  const bounds = resolveDateBounds(filters);

  if (filters?.year) {
    applications.push({
      filter: "year",
      value: filters.year,
      supported: false,
      appliedAt: "post_fetch"
    });
  } else if (filters?.publicationDateOrYear) {
    applications.push({
      filter: "publicationDateOrYear",
      value: filters.publicationDateOrYear,
      supported: false,
      appliedAt: "post_fetch"
    });
  } else if (bounds.startDate || bounds.endDate) {
    applications.push({
      filter: "publicationDateOrYear",
      value: [bounds.startDate, bounds.endDate].filter((value): value is string => Boolean(value)),
      supported: false,
      appliedAt: "post_fetch"
    });
  }

  if (filters?.openAccessPdf) {
    applications.push({
      filter: "openAccessPdf",
      value: true,
      supported: true,
      appliedAt: "query",
      nativeParameter: "implicit_arxiv_pdf"
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
    return excludedTerms.length > 0 ? "field_query_union_and_exclude_terms" : "field_query_union";
  }
  if (excludedTerms.length > 0) {
    return "field_query_and_exclude_terms";
  }
  return queryVariants[0]?.trim() === originalQuery.trim() ? "passthrough" : "field_query_normalized";
}
