import { load } from "cheerio";

import { SemanticScholarPaper } from "../../tools/semanticScholar.js";
import { buildGeneratedBibtexEntry, BibtexCandidate, BibtexMode, scoreBibtexRichness, selectPreferredBibtex } from "./bibtex.js";
import { CollectEnrichmentAttempt, CollectEnrichmentLogEntry, StoredBibtexSource, StoredCorpusRow } from "./types.js";

const REQUEST_HEADERS = {
  Accept: "text/html,application/pdf,application/x-bibtex,application/json;q=0.9,*/*;q=0.8",
  "User-Agent": "AutoResearch/1.0.0"
};

interface CrossrefMessage {
  URL?: string;
  title?: string[];
  "container-title"?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  issued?: { "date-parts"?: number[][] };
  published?: { "date-parts"?: number[][] };
  publisher?: string;
  page?: string;
  volume?: string;
  issue?: string;
  link?: Array<Record<string, unknown>>;
}

interface CandidatePdf {
  source: string;
  url: string;
}

export interface EnrichCollectedPaperArgs {
  paper: SemanticScholarPaper;
  row: StoredCorpusRow;
  bibtexMode: BibtexMode;
  requireOpenAccessPdf: boolean;
  abortSignal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface EnrichCollectedPaperResult {
  row: StoredCorpusRow;
  log: CollectEnrichmentLogEntry;
  pdfRecovered: boolean;
  bibtexEnriched: boolean;
  fallbackSources: string[];
}

export async function enrichCollectedPaper(args: EnrichCollectedPaperArgs): Promise<EnrichCollectedPaperResult> {
  const row: StoredCorpusRow = { ...args.row };
  const attempts: CollectEnrichmentAttempt[] = [];
  const errors: string[] = [];
  const fallbackSources = new Set<string>();

  row.doi ||= args.paper.doi;
  row.arxiv_id ||= args.paper.arxivId;
  row.semantic_scholar_bibtex ||= args.paper.citationStylesBibtex;

  const bibtexCandidates: BibtexCandidate[] = [];
  let pdfRecovered = false;
  let bibtexEnriched = false;

  if (row.arxiv_id) {
    const arxiv = await resolveArxiv(args, row.arxiv_id, attempts, errors);
    fallbackSources.add("arxiv");
    if (!row.pdf_url && arxiv.pdfUrl) {
      row.pdf_url = arxiv.pdfUrl;
      row.pdf_url_source = "arxiv";
      row.landing_url ||= arxiv.landingUrl;
      pdfRecovered = true;
    }
    if (arxiv.bibtex && args.bibtexMode === "hybrid") {
      bibtexCandidates.push(arxiv.bibtex);
      bibtexEnriched = true;
    }
  }

  const landingCandidates = await collectLandingCandidates(args, row, attempts, errors);
  for (const landing of landingCandidates) {
    const host = safeHost(landing);
    if (host === "aclanthology.org") {
      const acl = await resolveAclAnthology(args, landing, attempts, errors);
      fallbackSources.add("acl_anthology");
      if (!row.pdf_url && acl.pdfUrl) {
        row.pdf_url = acl.pdfUrl;
        row.pdf_url_source = "acl_anthology";
        row.landing_url = acl.landingUrl;
        pdfRecovered = true;
      }
      if (acl.bibtex && args.bibtexMode === "hybrid") {
        bibtexCandidates.push(acl.bibtex);
        bibtexEnriched = true;
      }
      if (row.pdf_url && row.bibtex) {
        break;
      }
    }
    if (host === "openreview.net") {
      const openReview = await resolveOpenReview(args, landing, attempts, errors);
      fallbackSources.add("openreview");
      if (!row.pdf_url && openReview.pdfUrl) {
        row.pdf_url = openReview.pdfUrl;
        row.pdf_url_source = "openreview";
        row.landing_url = openReview.landingUrl;
        pdfRecovered = true;
      }
      if (openReview.bibtex && args.bibtexMode === "hybrid") {
        bibtexCandidates.push(openReview.bibtex);
        bibtexEnriched = true;
      }
    }
    if (host === "proceedings.mlr.press") {
      const pmlr = await resolvePmlr(args, landing, attempts, errors);
      fallbackSources.add("pmlr");
      if (!row.pdf_url && pmlr.pdfUrl) {
        row.pdf_url = pmlr.pdfUrl;
        row.pdf_url_source = "pmlr";
        row.landing_url = pmlr.landingUrl;
        pdfRecovered = true;
      }
      if (pmlr.bibtex && args.bibtexMode === "hybrid") {
        bibtexCandidates.push(pmlr.bibtex);
        bibtexEnriched = true;
      }
    }
  }

  if (row.doi) {
    const crossref = await resolveCrossref(args, row, attempts, errors);
    fallbackSources.add("crossref");
    if (!row.pdf_url && crossref.pdfUrl) {
      row.pdf_url = crossref.pdfUrl;
      row.pdf_url_source = "crossref";
      row.landing_url ||= crossref.landingUrl;
      pdfRecovered = true;
    }
    if (crossref.bibtex && args.bibtexMode === "hybrid") {
      bibtexCandidates.push(crossref.bibtex);
      bibtexEnriched = true;
    }
    if (crossref.landingUrl) {
      row.landing_url ||= crossref.landingUrl;
    }
  }

  if (!row.pdf_url || (args.bibtexMode === "hybrid" && shouldTryGenericBibtex(row))) {
    const landing = row.landing_url || firstNonSemanticScholarUrl(row.url);
    if (landing) {
      const generic = await resolveGenericLanding(args, row, landing, attempts, errors);
      fallbackSources.add("landing_page");
      if (!row.pdf_url && generic.pdfUrl) {
        row.pdf_url = generic.pdfUrl;
        row.pdf_url_source = generic.pdfSource;
        row.landing_url ||= landing;
        pdfRecovered = true;
      }
      if (generic.bibtex && args.bibtexMode === "hybrid") {
        bibtexCandidates.push(generic.bibtex);
        bibtexEnriched = true;
      }
    }
  }

  if (args.bibtexMode === "hybrid") {
    const selected = selectPreferredBibtex(args.bibtexMode, bibtexCandidates, row.semantic_scholar_bibtex);
    if (selected) {
      row.bibtex = selected.entry;
      row.bibtex_source = selected.source;
      row.bibtex_richness = selected.richness;
    }
  } else if (args.bibtexMode === "generated") {
    row.bibtex = undefined;
    row.bibtex_source = undefined;
    row.bibtex_richness = undefined;
  }

  const log: CollectEnrichmentLogEntry = {
    paper_id: row.paper_id,
    pdf_resolution: row.pdf_url
      ? {
          source: row.pdf_url_source,
          url: row.pdf_url
        }
      : undefined,
    bibtex_resolution: row.bibtex
      ? {
          source: row.bibtex_source,
          richness: row.bibtex_richness
        }
      : undefined,
    attempts,
    errors
  };

  return {
    row,
    log,
    pdfRecovered,
    bibtexEnriched,
    fallbackSources: Array.from(fallbackSources)
  };
}

export function mergeStoredCorpusRows(existing: StoredCorpusRow | undefined, incoming: StoredCorpusRow): StoredCorpusRow {
  if (!existing) {
    return incoming;
  }

  const merged: StoredCorpusRow = {
    ...existing,
    ...incoming,
    authors: incoming.authors.length > 0 ? incoming.authors : existing.authors
  };

  if (!existing.pdf_url && incoming.pdf_url) {
    merged.pdf_url = incoming.pdf_url;
    merged.pdf_url_source = incoming.pdf_url_source;
  }

  const existingBibtexRichness = existing.bibtex_richness ?? scoreBibtexRichness(existing.bibtex ?? "");
  const incomingBibtexRichness = incoming.bibtex_richness ?? scoreBibtexRichness(incoming.bibtex ?? "");
  if (incomingBibtexRichness > existingBibtexRichness) {
    merged.bibtex = incoming.bibtex;
    merged.bibtex_source = incoming.bibtex_source;
    merged.bibtex_richness = incomingBibtexRichness || undefined;
  }

  if (!existing.semantic_scholar_bibtex && incoming.semantic_scholar_bibtex) {
    merged.semantic_scholar_bibtex = incoming.semantic_scholar_bibtex;
  }
  if (!existing.doi && incoming.doi) {
    merged.doi = incoming.doi;
  }
  if (!existing.arxiv_id && incoming.arxiv_id) {
    merged.arxiv_id = incoming.arxiv_id;
  }
  if (!existing.landing_url && incoming.landing_url) {
    merged.landing_url = incoming.landing_url;
  }

  return merged;
}

async function resolveArxiv(
  args: EnrichCollectedPaperArgs,
  arxivId: string,
  attempts: CollectEnrichmentAttempt[],
  errors: string[]
): Promise<{ pdfUrl?: string; landingUrl: string; bibtex?: BibtexCandidate }> {
  const normalizedId = normalizeArxivId(arxivId);
  const landingUrl = `https://arxiv.org/abs/${normalizedId}`;
  const pdfUrl = `https://arxiv.org/pdf/${normalizedId}.pdf`;
  const verified = await verifyPdfCandidate(pdfUrl, "arxiv_pdf", attempts, errors, args.abortSignal);
  const bibtex: BibtexCandidate = {
    source: "arxiv_generated",
    entry: buildGeneratedBibtexEntry({
      paperId: args.paper.paperId,
      title: args.paper.title,
      authors: args.paper.authors,
      year: args.paper.year,
      venue: args.paper.venue || "arXiv",
      doi: args.paper.doi,
      url: landingUrl,
      arxivId: normalizedId
    }),
    richness: 0
  };
  bibtex.richness = scoreBibtexRichness(bibtex.entry);
  return { pdfUrl: verified, landingUrl, bibtex };
}

async function resolveAclAnthology(
  args: EnrichCollectedPaperArgs,
  landingUrl: string,
  attempts: CollectEnrichmentAttempt[],
  errors: string[]
): Promise<{ pdfUrl?: string; landingUrl: string; bibtex?: BibtexCandidate }> {
  const canonical = deriveAclCanonicalUrl(landingUrl, args.paper.doi);
  if (!canonical) {
    return { landingUrl };
  }
  const pdfUrl = await verifyPdfCandidate(`${canonical}.pdf`, "acl_pdf", attempts, errors, args.abortSignal);
  const bibtexText = await fetchTextCandidate(`${canonical}.bib`, "acl_bib", attempts, errors, args.abortSignal);
  const bibtex =
    bibtexText && bibtexText.trim().startsWith("@")
      ? {
          source: "acl_anthology" as const,
          entry: bibtexText.trim(),
          richness: scoreBibtexRichness(bibtexText)
        }
      : undefined;
  return { pdfUrl, landingUrl: canonical, bibtex };
}

async function resolveOpenReview(
  args: EnrichCollectedPaperArgs,
  landingUrl: string,
  attempts: CollectEnrichmentAttempt[],
  errors: string[]
): Promise<{ pdfUrl?: string; landingUrl: string; bibtex?: BibtexCandidate }> {
  const noteId = extractOpenReviewId(landingUrl);
  if (!noteId) {
    return { landingUrl };
  }
  const canonical = `https://openreview.net/forum?id=${encodeURIComponent(noteId)}`;
  const pdfUrl = await verifyPdfCandidate(
    `https://openreview.net/pdf?id=${encodeURIComponent(noteId)}`,
    "openreview_pdf",
    attempts,
    errors,
    args.abortSignal
  );
  const bibtexEntry = buildGeneratedBibtexEntry({
    paperId: args.paper.paperId,
    title: args.paper.title,
    authors: args.paper.authors,
    year: args.paper.year,
    venue: args.paper.venue || "OpenReview",
    doi: args.paper.doi,
    url: canonical
  });
  return {
    pdfUrl,
    landingUrl: canonical,
    bibtex: {
      source: "openreview_generated",
      entry: bibtexEntry,
      richness: scoreBibtexRichness(bibtexEntry)
    }
  };
}

async function resolvePmlr(
  args: EnrichCollectedPaperArgs,
  landingUrl: string,
  attempts: CollectEnrichmentAttempt[],
  errors: string[]
): Promise<{ pdfUrl?: string; landingUrl: string; bibtex?: BibtexCandidate }> {
  const canonical = derivePmlrCanonicalUrl(landingUrl);
  if (!canonical) {
    return { landingUrl };
  }
  const pdfUrl = await verifyPdfCandidate(`${canonical}.pdf`, "pmlr_pdf", attempts, errors, args.abortSignal);
  const bibtexEntry = buildGeneratedBibtexEntry({
    paperId: args.paper.paperId,
    title: args.paper.title,
    authors: args.paper.authors,
    year: args.paper.year,
    venue: args.paper.venue || "PMLR",
    doi: args.paper.doi,
    url: canonical
  });
  return {
    pdfUrl,
    landingUrl: canonical,
    bibtex: {
      source: "pmlr_generated",
      entry: bibtexEntry,
      richness: scoreBibtexRichness(bibtexEntry)
    }
  };
}

async function resolveCrossref(
  args: EnrichCollectedPaperArgs,
  row: StoredCorpusRow,
  attempts: CollectEnrichmentAttempt[],
  errors: string[]
): Promise<{ pdfUrl?: string; landingUrl?: string; bibtex?: BibtexCandidate }> {
  if (!row.doi) {
    return {};
  }

  const encodedDoi = encodeURIComponent(row.doi);
  const crossrefData = await fetchJsonCandidate(
    `https://api.crossref.org/works/${encodedDoi}`,
    "crossref_work",
    attempts,
    errors,
    args.abortSignal
  );
  const message = extractCrossrefMessage(crossrefData);
  let pdfUrl: string | undefined;
  let landingUrl: string | undefined;

  if (message?.link) {
    for (const link of message.link) {
      const candidateUrl = typeof link.URL === "string" ? link.URL : undefined;
      const contentType = typeof link["content-type"] === "string" ? link["content-type"] : "";
      if (!candidateUrl) {
        continue;
      }
      if (!contentType.includes("pdf") && !contentType.includes("application/pdf")) {
        continue;
      }
      pdfUrl = await verifyPdfCandidate(candidateUrl, "crossref_pdf", attempts, errors, args.abortSignal);
      if (pdfUrl) {
        break;
      }
    }
  }

  const bibtexText = await fetchTextCandidate(
    `https://doi.org/${encodedDoi}`,
    "doi_bibtex",
    attempts,
    errors,
    args.abortSignal,
    {
      headers: {
        ...REQUEST_HEADERS,
        Accept: "application/x-bibtex"
      }
    }
  );
  let bibtex: BibtexCandidate | undefined;
  if (bibtexText && bibtexText.trim().startsWith("@")) {
    bibtex = {
      source: "doi_content_negotiation",
      entry: bibtexText.trim(),
      richness: scoreBibtexRichness(bibtexText)
    };
  } else if (message) {
    const generated = buildGeneratedBibtexEntry({
      paperId: args.paper.paperId,
      title: (message.title && message.title[0]) || args.paper.title,
      authors: normalizeCrossrefAuthors(message.author, args.paper.authors),
      year: extractCrossrefYear(message) ?? args.paper.year,
      venue:
        (message["container-title"] && message["container-title"][0]) || args.paper.venue,
      doi: row.doi,
      url: message.URL || row.landing_url || row.url
    });
    bibtex = {
      source: "crossref_generated",
      entry: generated,
      richness: scoreBibtexRichness(generated)
    };
  }

  const doiLanding = await resolveRedirectLanding(`https://doi.org/${encodedDoi}`, "doi_landing", attempts, errors, args.abortSignal);
  landingUrl = firstNonSemanticScholarUrl(doiLanding) || message?.URL || row.landing_url;

  return { pdfUrl, landingUrl, bibtex };
}

async function resolveGenericLanding(
  args: EnrichCollectedPaperArgs,
  row: StoredCorpusRow,
  landingUrl: string,
  attempts: CollectEnrichmentAttempt[],
  errors: string[]
): Promise<{ pdfUrl?: string; pdfSource?: string; bibtex?: BibtexCandidate }> {
  const html = await fetchTextCandidate(landingUrl, "landing_html", attempts, errors, args.abortSignal);
  if (!html) {
    return {};
  }

  const $ = load(html);
  const metaPdf =
    firstMetaContent($, "meta[name='citation_pdf_url']") ||
    firstMetaContent($, "meta[property='citation_pdf_url']") ||
    firstMetaContent($, "meta[name='dc.identifier.pdf']");
  const pdfCandidates = new Set<string>();
  if (metaPdf) {
    pdfCandidates.add(new URL(metaPdf, landingUrl).toString());
  }
  $("link[rel='alternate']").each((_, element) => {
    const type = ($(element).attr("type") || "").toLowerCase();
    const href = $(element).attr("href");
    if (href && type.includes("pdf")) {
      pdfCandidates.add(new URL(href, landingUrl).toString());
    }
  });
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (href && /\.pdf($|[?#])/i.test(href)) {
      pdfCandidates.add(new URL(href, landingUrl).toString());
    }
  });

  let pdfUrl: string | undefined;
  for (const candidate of pdfCandidates) {
    pdfUrl = await verifyPdfCandidate(candidate, "landing_pdf", attempts, errors, args.abortSignal);
    if (pdfUrl) {
      break;
    }
  }

  const title = firstMetaContent($, "meta[name='citation_title']") || row.title;
  const authors = extractMetaAuthors($);
  const venue =
    firstMetaContent($, "meta[name='citation_journal_title']") ||
    firstMetaContent($, "meta[name='citation_conference_title']") ||
    row.venue;
  const year = extractMetaYear($) ?? row.year;
  const doi = firstMetaContent($, "meta[name='citation_doi']") || row.doi;
  const generated = buildGeneratedBibtexEntry({
    paperId: row.paper_id,
    title,
    authors: authors.length > 0 ? authors : row.authors,
    year,
    venue,
    doi,
    url: landingUrl,
    arxivId: row.arxiv_id
  });

  return {
    pdfUrl,
    pdfSource: pdfUrl ? "landing_page" : undefined,
    bibtex: shouldTryGenericBibtex(row)
      ? {
          source: "local_generated",
          entry: generated,
          richness: scoreBibtexRichness(generated)
        }
      : undefined
  };
}

async function collectLandingCandidates(
  args: EnrichCollectedPaperArgs,
  row: StoredCorpusRow,
  attempts: CollectEnrichmentAttempt[],
  errors: string[]
): Promise<string[]> {
  const candidates = new Set<string>();
  const initial = row.landing_url || firstNonSemanticScholarUrl(row.url);
  if (initial) {
    candidates.add(initial);
  }
  if (row.doi) {
    const doiLanding = await resolveRedirectLanding(
      `https://doi.org/${encodeURIComponent(row.doi)}`,
      "doi_landing",
      attempts,
      errors,
      args.abortSignal
    );
    const normalized = firstNonSemanticScholarUrl(doiLanding);
    if (normalized) {
      candidates.add(normalized);
    }
  }
  return Array.from(candidates);
}

function shouldTryGenericBibtex(row: StoredCorpusRow): boolean {
  const existing = row.bibtex || row.semantic_scholar_bibtex;
  return scoreBibtexRichness(existing ?? "") < 8;
}

async function verifyPdfCandidate(
  url: string,
  stage: string,
  attempts: CollectEnrichmentAttempt[],
  errors: string[],
  abortSignal?: AbortSignal
): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      headers: {
        ...REQUEST_HEADERS,
        Accept: "application/pdf,*/*;q=0.8"
      },
      redirect: "follow",
      signal: abortSignal
    });
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const finalUrl = response.url || url;
    const ok = response.ok && (contentType.includes("application/pdf") || /\.pdf($|[?#])/i.test(finalUrl));
    attempts.push({
      stage,
      candidate: url,
      ok,
      detail: `${response.status} ${contentType || "unknown"}`
    });
    response.body?.cancel().catch(() => undefined);
    if (ok) {
      return finalUrl;
    }
    errors.push(`${stage}:${response.status}`);
    return undefined;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    attempts.push({ stage, candidate: url, ok: false, detail });
    errors.push(`${stage}:${detail}`);
    return undefined;
  }
}

async function fetchTextCandidate(
  url: string,
  stage: string,
  attempts: CollectEnrichmentAttempt[],
  errors: string[],
  abortSignal?: AbortSignal,
  overrides?: RequestInit
): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      headers: REQUEST_HEADERS,
      redirect: "follow",
      signal: abortSignal,
      ...overrides
    });
    attempts.push({
      stage,
      candidate: url,
      ok: response.ok,
      detail: String(response.status)
    });
    if (!response.ok) {
      errors.push(`${stage}:${response.status}`);
      return undefined;
    }
    return await response.text();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    attempts.push({ stage, candidate: url, ok: false, detail });
    errors.push(`${stage}:${detail}`);
    return undefined;
  }
}

async function fetchJsonCandidate(
  url: string,
  stage: string,
  attempts: CollectEnrichmentAttempt[],
  errors: string[],
  abortSignal?: AbortSignal
): Promise<unknown> {
  const raw = await fetchTextCandidate(url, stage, attempts, errors, abortSignal, {
    headers: {
      ...REQUEST_HEADERS,
      Accept: "application/json"
    }
  });
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`${stage}:json:${detail}`);
    return undefined;
  }
}

async function resolveRedirectLanding(
  url: string,
  stage: string,
  attempts: CollectEnrichmentAttempt[],
  errors: string[],
  abortSignal?: AbortSignal
): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      headers: REQUEST_HEADERS,
      redirect: "follow",
      signal: abortSignal
    });
    attempts.push({
      stage,
      candidate: url,
      ok: response.ok,
      detail: String(response.status)
    });
    response.body?.cancel().catch(() => undefined);
    if (!response.ok) {
      errors.push(`${stage}:${response.status}`);
      return undefined;
    }
    return response.url || url;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    attempts.push({ stage, candidate: url, ok: false, detail });
    errors.push(`${stage}:${detail}`);
    return undefined;
  }
}

function extractCrossrefMessage(raw: unknown): CrossrefMessage | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const message = (raw as { message?: unknown }).message;
  return message && typeof message === "object" ? (message as CrossrefMessage) : undefined;
}

function normalizeCrossrefAuthors(
  authors: CrossrefMessage["author"],
  fallback: string[]
): string[] {
  if (!Array.isArray(authors) || authors.length === 0) {
    return fallback;
  }
  return authors
    .map((author) => {
      if (author.name) {
        return author.name;
      }
      return [author.given, author.family].filter(Boolean).join(" ").trim();
    })
    .filter(Boolean);
}

function extractCrossrefYear(message: CrossrefMessage): number | undefined {
  const candidate = message.issued?.["date-parts"]?.[0]?.[0] ?? message.published?.["date-parts"]?.[0]?.[0];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function deriveAclCanonicalUrl(landingUrl: string, doi?: string): string | undefined {
  const fromLanding = firstNonSemanticScholarUrl(landingUrl);
  if (fromLanding && safeHost(fromLanding) === "aclanthology.org") {
    return fromLanding.replace(/\/+$/, "").replace(/(\.pdf|\.bib)$/i, "");
  }
  if (doi) {
    const match = doi.match(/^10\.18653\/v1\/(.+)$/i);
    if (match) {
      return `https://aclanthology.org/${match[1]}`;
    }
  }
  return undefined;
}

function derivePmlrCanonicalUrl(landingUrl: string): string | undefined {
  const normalized = firstNonSemanticScholarUrl(landingUrl);
  if (!normalized || safeHost(normalized) !== "proceedings.mlr.press") {
    return undefined;
  }
  return normalized.replace(/\/+$/, "").replace(/\.pdf$/i, "").replace(/\.html$/i, "");
}

function extractOpenReviewId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const id = parsed.searchParams.get("id");
    if (id) {
      return id;
    }
    if (/^\/pdf$/i.test(parsed.pathname) || /^\/forum$/i.test(parsed.pathname) || /^\/note$/i.test(parsed.pathname)) {
      return undefined;
    }
    return parsed.pathname.startsWith("/forum") ? undefined : id ?? undefined;
  } catch {
    return undefined;
  }
}

function firstMetaContent($: ReturnType<typeof load>, selector: string): string | undefined {
  const value = $(selector).first().attr("content");
  return value && value.trim() ? value.trim() : undefined;
}

function extractMetaAuthors($: ReturnType<typeof load>): string[] {
  return $("meta[name='citation_author']")
    .map((_, element) => ($(element).attr("content") || "").trim())
    .get()
    .filter(Boolean);
}

function extractMetaYear($: ReturnType<typeof load>): number | undefined {
  const raw =
    firstMetaContent($, "meta[name='citation_publication_date']") ||
    firstMetaContent($, "meta[name='citation_date']");
  if (!raw) {
    return undefined;
  }
  const match = raw.match(/\b(19|20)\d{2}\b/);
  if (!match) {
    return undefined;
  }
  return Number(match[0]);
}

function normalizeArxivId(value: string): string {
  return value.replace(/^arxiv:/i, "").trim();
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function firstNonSemanticScholarUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  const host = safeHost(url);
  if (!host || host.endsWith("semanticscholar.org")) {
    return undefined;
  }
  return url;
}
