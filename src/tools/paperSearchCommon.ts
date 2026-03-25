import { PaperSearchCandidate } from "../core/collection/types.js";
import { SemanticScholarSearchFilters, SemanticScholarSearchRequest } from "./semanticScholar.js";

export function toPlainTextSearchQuery(query: string): string {
  return query
    .replace(/[+|()"]/g, " ")
    .replace(/\b(?:AND|OR|NOT)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SearchQueryClause {
  raw: string;
  phrases: string[];
  terms: string[];
  text: string;
}

export interface SearchQueryPlan {
  originalQuery: string;
  variantClauses: SearchQueryClause[];
  excludedTerms: string[];
}

interface QueryToken {
  type: "term" | "and" | "or" | "lparen" | "rparen";
  value?: string;
}

export function cleanDoi(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .trim()
    .toLowerCase();
}

export function parseYear(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const match = value.match(/\b(19|20)\d{2}\b/);
    if (match) {
      return Number(match[0]);
    }
  }
  return undefined;
}

export function buildSearchQueryPlan(query: string): SearchQueryPlan {
  const originalQuery = query.trim();
  if (!originalQuery) {
    return {
      originalQuery,
      variantClauses: [],
      excludedTerms: []
    };
  }

  const excludedTerms: string[] = [];
  let positiveQuery = extractExcludedTerms(originalQuery, excludedTerms);
  if (!positiveQuery.trim()) {
    positiveQuery = originalQuery;
  }

  const variantClauses: SearchQueryClause[] = [];
  const seen = new Set<string>();
  const rawVariantClauses = parsePositiveQueryVariants(positiveQuery);
  for (const rawClause of rawVariantClauses) {
    const clause = parseSearchQueryClause(rawClause);
    if (!clause) {
      continue;
    }
    const key = clause.text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    variantClauses.push(clause);
  }

  if (variantClauses.length === 0) {
    const fallback = parseSearchQueryClause(positiveQuery) ?? parseSearchQueryClause(toPlainTextSearchQuery(originalQuery));
    if (fallback) {
      variantClauses.push(fallback);
    }
  }

  return {
    originalQuery,
    variantClauses,
    excludedTerms: dedupeStrings(excludedTerms)
  };
}

export function resolveDateBounds(filters: SemanticScholarSearchFilters | undefined): {
  startDate?: string;
  endDate?: string;
} {
  if (!filters) {
    return {};
  }
  if (filters.year) {
    const year = parseYear(filters.year);
    return year
      ? {
          startDate: `${year}-01-01`,
          endDate: `${year}-12-31`
        }
      : {};
  }
  if (!filters.publicationDateOrYear?.trim()) {
    return {};
  }

  const value = filters.publicationDateOrYear.trim();
  const parts = value.split(":");
  if (parts.length === 2) {
    return {
      startDate: normalizeDateBound(parts[0], "start"),
      endDate: normalizeDateBound(parts[1], "end")
    };
  }

  const exactYear = parseYear(value);
  if (exactYear) {
    return {
      startDate: `${exactYear}-01-01`,
      endDate: `${exactYear}-12-31`
    };
  }

  return {
    startDate: normalizeDateBound(value, "start"),
    endDate: normalizeDateBound(value, "end")
  };
}

export function filterPaperSearchCandidates(
  request: SemanticScholarSearchRequest,
  candidates: PaperSearchCandidate[]
): PaperSearchCandidate[] {
  const yearRange = resolveYearRange(request.filters);
  const filtered = candidates.filter((candidate) =>
    matchesCandidateFilters(candidate, request.filters, yearRange.startYear, yearRange.endYear)
  );

  filtered.sort((a, b) => {
    const citationCmp = (b.citationCount ?? -1) - (a.citationCount ?? -1);
    if (citationCmp !== 0) {
      return citationCmp;
    }
    const relevanceCmp = (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
    if (relevanceCmp !== 0) {
      return relevanceCmp;
    }
    const yearCmp = (b.year ?? -1) - (a.year ?? -1);
    if (yearCmp !== 0) {
      return yearCmp;
    }
    return a.title.localeCompare(b.title);
  });

  return filtered.slice(0, Math.max(1, request.limit));
}

export function filterCandidatesByExcludedQueryTerms(
  query: string,
  candidates: PaperSearchCandidate[]
): PaperSearchCandidate[] {
  const { excludedTerms } = buildSearchQueryPlan(query);
  if (excludedTerms.length === 0) {
    return candidates;
  }

  const normalizedExcludedTerms = excludedTerms
    .map((term) => normalizeSearchText(term))
    .filter((term) => term.length >= 3);
  if (normalizedExcludedTerms.length === 0) {
    return candidates;
  }

  return candidates.filter((candidate) => {
    const searchableText = normalizeSearchText(
      [
        candidate.title,
        candidate.abstract,
        candidate.venue,
        candidate.publicationDate,
        candidate.doi,
        candidate.arxivId,
        ...candidate.authors,
        ...(candidate.fieldsOfStudy ?? []),
        ...(candidate.publicationTypes ?? [])
      ]
        .filter(Boolean)
        .join(" ")
    );
    return normalizedExcludedTerms.every((term) => !searchableText.includes(term));
  });
}

export function dedupePaperSearchCandidates(candidates: PaperSearchCandidate[]): PaperSearchCandidate[] {
  const deduped: PaperSearchCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const key = buildCandidateDedupKey(candidate);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

export function resolvePerQueryLimit(requestLimit: number, providerCap: number, variantCount: number): number {
  const safeVariantCount = Math.max(1, variantCount);
  const safeRequested = Math.max(1, Math.floor(requestLimit || 1));
  const baseline = Math.ceil(safeRequested / safeVariantCount);
  return Math.max(1, Math.min(providerCap, baseline));
}

function matchesCandidateFilters(
  candidate: PaperSearchCandidate,
  filters: SemanticScholarSearchFilters | undefined,
  startYear: number | undefined,
  endYear: number | undefined
): boolean {
  if (!filters) {
    return true;
  }

  if (typeof startYear === "number" || typeof endYear === "number") {
    const candidateYear = candidate.year ?? parseYear(candidate.publicationDate);
    if (typeof candidateYear === "number") {
      if (typeof startYear === "number" && candidateYear < startYear) {
        return false;
      }
      if (typeof endYear === "number" && candidateYear > endYear) {
        return false;
      }
    }
  }

  if (typeof filters.minCitationCount === "number" && typeof candidate.citationCount === "number") {
    if (candidate.citationCount < filters.minCitationCount) {
      return false;
    }
  }

  if (filters.venue && filters.venue.length > 0 && candidate.venue) {
    const candidateVenue = normalizeSearchText(candidate.venue);
    const matchesVenue = filters.venue.some((venue) => {
      const normalizedVenue = normalizeSearchText(venue);
      return candidateVenue.includes(normalizedVenue) || normalizedVenue.includes(candidateVenue);
    });
    if (!matchesVenue) {
      return false;
    }
  }

  if (filters.publicationTypes && filters.publicationTypes.length > 0 && candidate.publicationTypes?.length) {
    const candidateTypes = new Set(candidate.publicationTypes.map((value) => normalizeSearchText(value)));
    const matchesType = filters.publicationTypes.some((value) => candidateTypes.has(normalizeSearchText(value)));
    if (!matchesType) {
      return false;
    }
  }

  if (filters.fieldsOfStudy && filters.fieldsOfStudy.length > 0 && candidate.fieldsOfStudy?.length) {
    const candidateFields = new Set(candidate.fieldsOfStudy.map((value) => normalizeSearchText(value)));
    const matchesField = filters.fieldsOfStudy.some((value) => candidateFields.has(normalizeSearchText(value)));
    if (!matchesField) {
      return false;
    }
  }

  return true;
}

export function resolveYearRange(filters: SemanticScholarSearchFilters | undefined): {
  startYear?: number;
  endYear?: number;
} {
  const bounds = resolveDateBounds(filters);
  return {
    startYear: parseYear(bounds.startDate),
    endYear: parseYear(bounds.endDate)
  };
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractExcludedTerms(query: string, excludedTerms: string[]): string {
  let next = ` ${query} `;

  next = next.replace(/\bNOT\s+("([^"]+)"|[^\s()|+]+)/giu, (_match, token, quoted) => {
    const candidate = normalizeQueryToken(quoted || token);
    if (candidate) {
      excludedTerms.push(candidate);
    }
    return " ";
  });

  next = next.replace(/(^|\s)-("([^"]+)"|[^\s()|+]+)/gu, (match, prefix, token, quoted) => {
    const candidate = normalizeQueryToken(quoted || token);
    if (candidate) {
      excludedTerms.push(candidate);
      return `${prefix} `;
    }
    return match;
  });

  return next.replace(/\s+/g, " ").trim();
}

function parseSearchQueryClause(rawClause: string): SearchQueryClause | undefined {
  const normalizedRaw = rawClause.trim();
  if (!normalizedRaw) {
    return undefined;
  }

  const phrases = Array.from(normalizedRaw.matchAll(/"([^"]+)"/g))
    .map((match) => normalizeQueryToken(match[1]))
    .filter((value): value is string => Boolean(value));

  const unquoted = normalizedRaw
    .replace(/"([^"]+)"/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\bAND\b/giu, " ")
    .replace(/\+/g, " ");

  const terms = unquoted
    .split(/\s+/)
    .map((token) => normalizeQueryToken(token))
    .filter((value): value is string => Boolean(value));

  const text = [...phrases, ...terms].join(" ").replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }

  return {
    raw: normalizedRaw,
    phrases,
    terms,
    text
  };
}

function normalizeQueryToken(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || undefined;
}

function normalizeDateBound(value: string | undefined, bound: "start" | "end"): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  if (/^\d{4}-\d{2}$/.test(normalized)) {
    const [yearText, monthText] = normalized.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return undefined;
    }
    if (bound === "start") {
      return `${yearText}-${monthText}-01`;
    }
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${yearText}-${monthText}-${String(lastDay).padStart(2, "0")}`;
  }
  const year = parseYear(normalized);
  if (!year) {
    return undefined;
  }
  return bound === "start" ? `${year}-01-01` : `${year}-12-31`;
}

function buildCandidateDedupKey(candidate: PaperSearchCandidate): string {
  if (candidate.providerId) {
    return `provider:${candidate.provider}:${candidate.providerId}`;
  }
  if (candidate.paperId) {
    return `paper:${candidate.paperId}`;
  }
  if (candidate.doi) {
    return `doi:${candidate.doi}`;
  }
  if (candidate.arxivId) {
    return `arxiv:${candidate.arxivId}`;
  }
  return [
    "title",
    normalizeSearchText(candidate.title),
    candidate.year ?? "",
    candidate.authors
      .slice(0, 3)
      .map((author) => normalizeSearchText(author))
      .join("|")
  ].join(":");
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
}

function parsePositiveQueryVariants(query: string): string[] {
  const tokens = tokenizePositiveQuery(query);
  if (tokens.length === 0) {
    return [];
  }
  const parser = new QueryParser(tokens);
  const variants = parser.parseExpression();
  const normalized = variants
    .map((terms) => terms.join(" ").trim())
    .filter(Boolean);

  if (normalized.length > 0) {
    return dedupeStrings(normalized);
  }

  const fallback = toPlainTextSearchQuery(query);
  return fallback ? [fallback] : [];
}

function tokenizePositiveQuery(query: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  let index = 0;

  while (index < query.length) {
    const char = query[index];
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "lparen" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen" });
      index += 1;
      continue;
    }
    if (char === "+") {
      tokens.push({ type: "and" });
      index += 1;
      continue;
    }
    if (char === "|") {
      tokens.push({ type: "or" });
      index += 1;
      continue;
    }
    if (char === '"') {
      let end = index + 1;
      while (end < query.length && query[end] !== '"') {
        end += 1;
      }
      const value = query.slice(index, Math.min(end + 1, query.length));
      tokens.push({ type: "term", value });
      index = Math.min(end + 1, query.length);
      continue;
    }

    let end = index;
    while (end < query.length && !/[\s()|+"]/u.test(query[end])) {
      end += 1;
    }
    const raw = query.slice(index, end);
    const upper = raw.toUpperCase();
    if (upper === "AND") {
      tokens.push({ type: "and" });
    } else if (upper === "OR") {
      tokens.push({ type: "or" });
    } else if (upper !== "NOT") {
      tokens.push({ type: "term", value: raw });
    }
    index = end;
  }

  return insertImplicitAndTokens(tokens);
}

function insertImplicitAndTokens(tokens: QueryToken[]): QueryToken[] {
  const expanded: QueryToken[] = [];
  for (const token of tokens) {
    const previous = expanded[expanded.length - 1];
    if (
      previous
      && (previous.type === "term" || previous.type === "rparen")
      && (token.type === "term" || token.type === "lparen")
    ) {
      expanded.push({ type: "and" });
    }
    expanded.push(token);
  }
  return expanded;
}

class QueryParser {
  private index = 0;

  constructor(private readonly tokens: QueryToken[]) {}

  parseExpression(): string[][] {
    return dedupeVariantTerms(this.parseOr());
  }

  private parseOr(): string[][] {
    let left = this.parseAnd();
    while (this.peek()?.type === "or") {
      this.index += 1;
      left = dedupeVariantTerms([...left, ...this.parseAnd()]);
    }
    return left;
  }

  private parseAnd(): string[][] {
    let left = this.parsePrimary();
    while (this.peek()?.type === "and") {
      this.index += 1;
      left = combineVariantTerms(left, this.parsePrimary());
    }
    return left;
  }

  private parsePrimary(): string[][] {
    const token = this.peek();
    if (!token) {
      return [[]];
    }
    if (token.type === "lparen") {
      this.index += 1;
      const expression = this.parseOr();
      if (this.peek()?.type === "rparen") {
        this.index += 1;
      }
      return expression;
    }
    if (token.type === "term" && token.value) {
      this.index += 1;
      return [[token.value]];
    }
    if (token.type === "rparen") {
      return [[]];
    }
    this.index += 1;
    return this.parsePrimary();
  }

  private peek(): QueryToken | undefined {
    return this.tokens[this.index];
  }
}

function combineVariantTerms(left: string[][], right: string[][]): string[][] {
  const combined: string[][] = [];
  const safeLeft = left.length > 0 ? left : [[]];
  const safeRight = right.length > 0 ? right : [[]];

  for (const lhs of safeLeft) {
    for (const rhs of safeRight) {
      combined.push([...lhs, ...rhs]);
    }
  }

  return dedupeVariantTerms(combined);
}

function dedupeVariantTerms(variants: string[][]): string[][] {
  const seen = new Set<string>();
  const deduped: string[][] = [];

  for (const variant of variants) {
    const normalizedTerms = variant
      .map((term) => term.trim())
      .filter(Boolean);
    const key = normalizedTerms.join(" ").toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalizedTerms);
  }

  return deduped;
}
