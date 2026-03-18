import { setTimeout as delay } from "node:timers/promises";
import { hasSemanticScholarSpecialSyntax } from "../core/runConstraints.js";

export type SemanticScholarSortField = "relevance" | "citationCount" | "publicationDate" | "paperId";
export type SemanticScholarSortOrder = "asc" | "desc";

export interface SemanticScholarSearchFilters {
  publicationTypes?: string[];
  openAccessPdf?: boolean;
  minCitationCount?: number;
  publicationDateOrYear?: string;
  year?: string;
  venue?: string[];
  fieldsOfStudy?: string[];
}

export interface SemanticScholarSearchRequest {
  query: string;
  limit: number;
  sort?: {
    field: SemanticScholarSortField;
    order?: SemanticScholarSortOrder;
  };
  filters?: SemanticScholarSearchFilters;
}

export interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract?: string;
  year?: number;
  venue?: string;
  url?: string;
  openAccessPdfUrl?: string;
  authors: string[];
  doi?: string;
  arxivId?: string;
  citationCount?: number;
  influentialCitationCount?: number;
  publicationDate?: string;
  publicationTypes?: string[];
  fieldsOfStudy?: string[];
  citationStylesBibtex?: string;
}

export interface SemanticScholarClientOptions {
  apiKey?: string;
  perSecondLimit: number;
  maxRetries?: number;
}

export interface SemanticScholarAttemptRecord {
  attempt: number;
  ok: boolean;
  status?: number;
  retryAfterMs?: number;
  endpoint: string;
  errorMessage?: string;
}

export interface SemanticScholarSearchDiagnostics {
  attemptCount: number;
  lastStatus?: number;
  retryAfterMs?: number;
  attempts: SemanticScholarAttemptRecord[];
}

interface SearchResponse {
  data?: Array<Record<string, unknown>>;
  token?: string;
}

const PAPER_FIELDS = [
  "title",
  "abstract",
  "year",
  "venue",
  "url",
  "authors",
  "externalIds",
  "openAccessPdf",
  "citationCount",
  "influentialCitationCount",
  "publicationDate",
  "publicationTypes",
  "fieldsOfStudy",
  "citationStyles"
].join(",");

export class SemanticScholarClient {
  private readonly apiKey?: string;
  private readonly perSecondLimit: number;
  private readonly maxRetries: number;
  private nextRequestAtMs = 0;
  private throttleQueue: Promise<void> = Promise.resolve();
  private lastSearchDiagnostics: SemanticScholarSearchDiagnostics = emptyDiagnostics();

  constructor(opts: SemanticScholarClientOptions) {
    this.apiKey = opts.apiKey;
    this.perSecondLimit = Math.max(1, opts.perSecondLimit);
    this.maxRetries = Math.max(1, opts.maxRetries ?? 3);
  }

  async searchPapers(
    request: SemanticScholarSearchRequest,
    abortSignal?: AbortSignal
  ): Promise<SemanticScholarPaper[]>;
  async searchPapers(
    query: string,
    limit: number,
    abortSignal?: AbortSignal
  ): Promise<SemanticScholarPaper[]>;
  async searchPapers(
    requestOrQuery: SemanticScholarSearchRequest | string,
    limitOrSignal?: number | AbortSignal,
    maybeSignal?: AbortSignal
  ): Promise<SemanticScholarPaper[]> {
    const fakeResponse = process.env.AUTOLABOS_FAKE_SEMANTIC_SCHOLAR_RESPONSE;
    if (typeof fakeResponse === "string" && fakeResponse.trim()) {
      return parseFakeSemanticScholarResponse(fakeResponse);
    }

    const request = this.normalizeRequest(requestOrQuery, limitOrSignal);
    const abortSignal = this.resolveAbortSignal(requestOrQuery, limitOrSignal, maybeSignal);
    this.lastSearchDiagnostics = emptyDiagnostics();

    if (!request.query.trim()) {
      return [];
    }

    const papers: SemanticScholarPaper[] = [];
    for await (const batch of this.streamSearchPapers(request, abortSignal)) {
      papers.push(...batch);
    }
    return papers;
  }

  async *streamSearchPapers(
    request: SemanticScholarSearchRequest,
    abortSignal?: AbortSignal
  ): AsyncGenerator<SemanticScholarPaper[], void, void> {
    this.lastSearchDiagnostics = emptyDiagnostics();

    const fakeResponse = process.env.AUTOLABOS_FAKE_SEMANTIC_SCHOLAR_RESPONSE;
    if (typeof fakeResponse === "string" && fakeResponse.trim()) {
      const papers = parseFakeSemanticScholarResponse(fakeResponse).slice(
        0,
        Math.max(1, this.normalizeRequest(request).limit)
      );
      if (papers.length > 0) {
        yield papers;
      }
      return;
    }

    const normalized = this.normalizeRequest(request);
    if (!normalized.query.trim()) {
      return;
    }

    const targetLimit = Math.max(1, normalized.limit);
    const sortField = normalized.sort?.field ?? "relevance";
    if (sortField === "relevance" && !hasSemanticScholarSpecialSyntax(normalized.query)) {
      yield* this.streamByRelevance(normalized, targetLimit, abortSignal);
      return;
    }
    yield* this.streamByBulk(normalized, targetLimit, abortSignal);
  }

  getLastSearchDiagnostics(): SemanticScholarSearchDiagnostics {
    return {
      attemptCount: this.lastSearchDiagnostics.attemptCount,
      lastStatus: this.lastSearchDiagnostics.lastStatus,
      retryAfterMs: this.lastSearchDiagnostics.retryAfterMs,
      attempts: this.lastSearchDiagnostics.attempts.map((attempt) => ({ ...attempt }))
    };
  }

  private normalizeRequest(
    requestOrQuery: SemanticScholarSearchRequest | string,
    limitOrSignal?: number | AbortSignal
  ): SemanticScholarSearchRequest {
    if (typeof requestOrQuery === "string") {
      const rawLimit = typeof limitOrSignal === "number" ? limitOrSignal : 100;
      return {
        query: requestOrQuery,
        limit: Math.max(1, rawLimit),
        sort: { field: "relevance" }
      };
    }
    return {
      query: requestOrQuery.query || "",
      limit: Math.max(1, requestOrQuery.limit || 1),
      sort: {
        field: requestOrQuery.sort?.field ?? "relevance",
        order: requestOrQuery.sort?.order
      },
      filters: requestOrQuery.filters
    };
  }

  private resolveAbortSignal(
    requestOrQuery: SemanticScholarSearchRequest | string,
    limitOrSignal?: number | AbortSignal,
    maybeSignal?: AbortSignal
  ): AbortSignal | undefined {
    if (typeof requestOrQuery === "string") {
      return limitOrSignal instanceof AbortSignal ? limitOrSignal : maybeSignal;
    }
    return limitOrSignal instanceof AbortSignal ? limitOrSignal : maybeSignal;
  }

  private async *streamByRelevance(
    request: SemanticScholarSearchRequest,
    targetLimit: number,
    abortSignal?: AbortSignal
  ): AsyncGenerator<SemanticScholarPaper[], void, void> {
    const seen = new Set<string>();
    let offset = 0;
    let yieldedCount = 0;
    const pageSize = resolveRelevancePageSize(request, targetLimit, Boolean(this.apiKey));
    const interRequestDelayMs = resolveInterRequestDelayMs(request, targetLimit, this.perSecondLimit, Boolean(this.apiKey));

    while (yieldedCount < targetLimit) {
      throwIfAborted(abortSignal);
      const batch = Math.min(pageSize, targetLimit - yieldedCount);

      const params = this.buildSearchParams(request, {
        includeOffsetLimit: true,
        limit: batch,
        offset
      });
      const endpoint = `https://api.semanticscholar.org/graph/v1/paper/search?${params.toString()}`;

      const body = await this.fetchJson(endpoint, abortSignal);
      const items = normalizeSearchResponse(body);
      if (items.length === 0) {
        break;
      }

      const nextBatch: SemanticScholarPaper[] = [];
      for (const paper of items) {
        if (seen.has(paper.paperId)) {
          continue;
        }
        seen.add(paper.paperId);
        nextBatch.push(paper);
        yieldedCount += 1;
        if (yieldedCount >= targetLimit) {
          break;
        }
      }

      if (nextBatch.length > 0) {
        yield nextBatch;
      }
      if (items.length < batch) {
        break;
      }
      offset += items.length;
      await delay(interRequestDelayMs);
    }
  }

  private async *streamByBulk(
    request: SemanticScholarSearchRequest,
    targetLimit: number,
    abortSignal?: AbortSignal
  ): AsyncGenerator<SemanticScholarPaper[], void, void> {
    const seen = new Set<string>();
    let token: string | undefined;
    let yieldedCount = 0;
    const interRequestDelayMs = resolveInterRequestDelayMs(request, targetLimit, this.perSecondLimit, Boolean(this.apiKey));

    while (yieldedCount < targetLimit) {
      throwIfAborted(abortSignal);
      const params = this.buildSearchParams(request, {
        includeOffsetLimit: false,
        token
      });
      const endpoint = `https://api.semanticscholar.org/graph/v1/paper/search/bulk?${params.toString()}`;

      const body = await this.fetchJson(endpoint, abortSignal);
      const parsed = body as SearchResponse;
      const items = normalizeSearchResponse(parsed);
      if (items.length === 0) {
        break;
      }

      const nextBatch: SemanticScholarPaper[] = [];
      for (const paper of items) {
        if (seen.has(paper.paperId)) {
          continue;
        }
        seen.add(paper.paperId);
        nextBatch.push(paper);
        yieldedCount += 1;
        if (yieldedCount >= targetLimit) {
          break;
        }
      }

      if (nextBatch.length > 0) {
        yield nextBatch;
      }
      token = typeof parsed.token === "string" && parsed.token.trim() ? parsed.token : undefined;
      if (!token) {
        break;
      }
      await delay(interRequestDelayMs);
    }
  }

  private buildSearchParams(
    request: SemanticScholarSearchRequest,
    opts: {
      includeOffsetLimit: boolean;
      limit?: number;
      offset?: number;
      token?: string;
    }
  ): URLSearchParams {
    const params = new URLSearchParams();
    params.set("query", request.query);
    params.set("fields", PAPER_FIELDS);

    if (opts.includeOffsetLimit) {
      params.set("limit", String(Math.max(1, opts.limit ?? request.limit)));
      params.set("offset", String(Math.max(0, opts.offset ?? 0)));
    } else if (opts.token) {
      params.set("token", opts.token);
    }

    const sortField = request.sort?.field ?? "relevance";
    const sortOrder = request.sort?.order ?? defaultSortOrder(sortField);
    if (sortField !== "relevance") {
      params.set("sort", `${sortField}:${sortOrder}`);
    }

    const filters = request.filters;
    if (!filters) {
      return params;
    }

    if (filters.publicationTypes && filters.publicationTypes.length > 0) {
      params.set("publicationTypes", filters.publicationTypes.join(","));
    }
    if (filters.openAccessPdf) {
      params.set("openAccessPdf", "");
    }
    if (typeof filters.minCitationCount === "number" && Number.isFinite(filters.minCitationCount)) {
      params.set("minCitationCount", String(Math.max(0, Math.floor(filters.minCitationCount))));
    }
    if (filters.publicationDateOrYear) {
      params.set("publicationDateOrYear", filters.publicationDateOrYear);
    }
    if (filters.year) {
      params.set("year", filters.year);
    }
    if (filters.venue && filters.venue.length > 0) {
      params.set("venue", filters.venue.join(","));
    }
    if (filters.fieldsOfStudy && filters.fieldsOfStudy.length > 0) {
      params.set("fieldsOfStudy", filters.fieldsOfStudy.join(","));
    }

    return params;
  }

  private async fetchJson(endpoint: string, abortSignal?: AbortSignal): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      throwIfAborted(abortSignal);
      let recorded = false;
      try {
        await this.waitForRateLimitSlot(abortSignal);
        const response = await fetch(endpoint, {
          headers: {
            ...(this.apiKey ? { "x-api-key": this.apiKey } : {})
          },
          signal: abortSignal
        });

        if (!response.ok) {
          const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
          this.recordAttempt({
            attempt,
            ok: false,
            status: response.status,
            retryAfterMs,
            endpoint
          });
          recorded = true;
          throw new SemanticScholarHttpError(
            response.status,
            retryAfterMs
          );
        }

        this.recordAttempt({
          attempt,
          ok: true,
          status: response.status,
          endpoint
        });
        recorded = true;
        return await response.json();
      } catch (error) {
        if (isAbortError(error)) {
          throw new Error("Operation aborted by user");
        }
        if (!recorded) {
          this.recordAttempt({
            attempt,
            ok: false,
            endpoint,
            errorMessage: error instanceof Error ? error.message : String(error)
          });
        }
        lastError = error;
        if (attempt < this.maxRetries) {
          await delay(resolveRetryDelayMs(error, attempt, this.perSecondLimit));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Semantic Scholar request failed");
  }

  private recordAttempt(attempt: SemanticScholarAttemptRecord): void {
    this.lastSearchDiagnostics.attempts.push(attempt);
    this.lastSearchDiagnostics.attemptCount = this.lastSearchDiagnostics.attempts.length;
    this.lastSearchDiagnostics.lastStatus = attempt.status;
    this.lastSearchDiagnostics.retryAfterMs = attempt.retryAfterMs;
  }

  private async waitForRateLimitSlot(abortSignal?: AbortSignal): Promise<void> {
    const ticket = this.throttleQueue.then(async () => {
      throwIfAborted(abortSignal);
      const waitMs = Math.max(0, this.nextRequestAtMs - Date.now());
      if (waitMs > 0) {
        await delay(waitMs, undefined, { signal: abortSignal });
      }
      this.nextRequestAtMs = Date.now() + resolveMinimumRequestIntervalMs(this.perSecondLimit);
    });

    this.throttleQueue = ticket.catch(() => undefined);
    await ticket;
  }
}

function emptyDiagnostics(): SemanticScholarSearchDiagnostics {
  return {
    attemptCount: 0,
    attempts: []
  };
}

class SemanticScholarHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs?: number
  ) {
    super(buildSemanticScholarHttpErrorMessage(status, retryAfterMs));
    this.name = "SemanticScholarHttpError";
  }
}

function normalizeSearchResponse(data: unknown): SemanticScholarPaper[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const rows = (data as SearchResponse).data;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((item) => normalizePaper(item)).filter((x): x is SemanticScholarPaper => Boolean(x));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Operation aborted by user");
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const msg = error.message.toLowerCase();
  return msg.includes("aborted") || msg.includes("abort");
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}

function resolveRetryDelayMs(error: unknown, attempt: number, perSecondLimit: number): number {
  const baseDelay = resolveMinimumRequestIntervalMs(perSecondLimit);
  const backoff = Math.min(baseDelay * 2 ** (attempt - 1), 30_000);
  if (error instanceof SemanticScholarHttpError) {
    return Math.max(error.retryAfterMs ?? 0, backoff);
  }
  return backoff;
}

function buildSemanticScholarHttpErrorMessage(status: number, retryAfterMs?: number): string {
  if (status === 429) {
    const retryHint = retryAfterMs ? `; retry after ${formatRetryAfterMs(retryAfterMs)}` : "";
    return `Semantic Scholar request failed: 429 (rate limited${retryHint})`;
  }
  return `Semantic Scholar request failed: ${status}`;
}

function formatRetryAfterMs(retryAfterMs: number): string {
  if (retryAfterMs >= 60_000) {
    return `${Math.ceil(retryAfterMs / 60_000)}m`;
  }
  return `${Math.max(1, Math.ceil(retryAfterMs / 1000))}s`;
}

function resolveRelevancePageSize(
  request: SemanticScholarSearchRequest,
  targetLimit: number,
  hasApiKey: boolean
): number {
  let size = 100;
  if (targetLimit >= 200) {
    size = 50;
  }
  if (!hasApiKey) {
    size = Math.min(size, 50);
  }
  if (request.filters?.openAccessPdf) {
    size = Math.min(size, 50);
  }
  if (
    (request.filters?.publicationTypes && request.filters.publicationTypes.length > 0) ||
    (request.filters?.fieldsOfStudy && request.filters.fieldsOfStudy.length > 0) ||
    (request.filters?.venue && request.filters.venue.length > 0) ||
    typeof request.filters?.minCitationCount === "number"
  ) {
    size = Math.min(size, 50);
  }
  return Math.max(25, size);
}

function resolveInterRequestDelayMs(
  request: SemanticScholarSearchRequest,
  targetLimit: number,
  perSecondLimit: number,
  hasApiKey: boolean
): number {
  let delayMs = resolveMinimumRequestIntervalMs(perSecondLimit);
  if (targetLimit >= 200) {
    delayMs = Math.max(delayMs, 1500);
  }
  if (!hasApiKey) {
    delayMs = Math.max(delayMs, 2000);
  }
  if (request.filters?.openAccessPdf) {
    delayMs = Math.max(delayMs, 2000);
  }
  return delayMs;
}

function resolveMinimumRequestIntervalMs(perSecondLimit: number): number {
  const baseIntervalMs = Math.ceil(1000 / Math.max(1, perSecondLimit));
  if (perSecondLimit <= 1) {
    return Math.max(baseIntervalMs, 1100);
  }
  return baseIntervalMs;
}

function normalizePaper(item: Record<string, unknown>): SemanticScholarPaper | undefined {
  const paperId = typeof item.paperId === "string" ? item.paperId : undefined;
  const title = typeof item.title === "string" ? item.title : undefined;
  if (!paperId || !title) {
    return undefined;
  }

  const authors = Array.isArray(item.authors)
    ? item.authors
        .map((author) =>
          typeof author === "object" &&
          author &&
          typeof (author as { name?: unknown }).name === "string"
            ? (author as { name: string }).name
            : undefined
        )
        .filter((x): x is string => Boolean(x))
    : [];

  const citationStyles =
    item.citationStyles && typeof item.citationStyles === "object"
      ? (item.citationStyles as Record<string, unknown>)
      : undefined;
  const citationStylesBibtex =
    citationStyles && typeof citationStyles.bibtex === "string"
      ? citationStyles.bibtex.trim() || undefined
      : undefined;

  return {
    paperId,
    title,
    abstract: typeof item.abstract === "string" ? item.abstract : undefined,
    year: readNumber(item.year),
    venue: typeof item.venue === "string" ? item.venue : undefined,
    url: typeof item.url === "string" ? item.url : undefined,
    openAccessPdfUrl: readOpenAccessPdfUrl(item.openAccessPdf),
    authors,
    doi: extractExternalId(item.externalIds, "doi"),
    arxivId: extractExternalId(item.externalIds, "arxiv"),
    citationCount: readNumber(item.citationCount),
    influentialCitationCount: readNumber(item.influentialCitationCount),
    publicationDate: typeof item.publicationDate === "string" ? item.publicationDate : undefined,
    publicationTypes: readStringArray(item.publicationTypes),
    fieldsOfStudy: readStringArray(item.fieldsOfStudy),
    citationStylesBibtex
  };
}

function extractExternalId(externalIds: unknown, key: string): string | undefined {
  if (!externalIds || typeof externalIds !== "object") {
    return undefined;
  }

  const record = externalIds as Record<string, unknown>;
  const desired = key.toLowerCase();
  for (const [k, value] of Object.entries(record)) {
    if (k.toLowerCase() !== desired) {
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function readOpenAccessPdfUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.url === "string" && record.url.trim()) {
    return record.url.trim();
  }
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function defaultSortOrder(field: SemanticScholarSortField): SemanticScholarSortOrder {
  if (field === "paperId") {
    return "asc";
  }
  return "desc";
}

function parseFakeSemanticScholarResponse(raw: string): SemanticScholarPaper[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => (item && typeof item === "object" ? normalizePaper(item as Record<string, unknown>) : undefined))
      .filter((x): x is SemanticScholarPaper => Boolean(x));
  } catch {
    return [];
  }
}
