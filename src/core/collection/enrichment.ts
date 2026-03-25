import { load } from "cheerio";

import { SemanticScholarPaper } from "../../tools/semanticScholar.js";
import { buildGeneratedBibtexEntry, BibtexCandidate, BibtexMode, scoreBibtexRichness, selectPreferredBibtex } from "./bibtex.js";
import { CollectEnrichmentAttempt, CollectEnrichmentLogEntry, StoredBibtexSource, StoredCorpusRow } from "./types.js";

const REQUEST_HEADERS = {
  Accept: "text/html,application/pdf,application/json;q=0.9,*/*;q=0.8",
  "User-Agent": "AutoLabOS/1.0.0"
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

interface OpenAlexLocation {
  landing_page_url?: string | null;
  pdf_url?: string | null;
}

interface OpenAlexWork {
  open_access?: {
    is_oa?: boolean;
    oa_url?: string | null;
  };
  primary_location?: OpenAlexLocation | null;
  best_oa_location?: OpenAlexLocation | null;
  locations?: OpenAlexLocation[] | null;
}

interface OpenReviewSearchResponse {
  notes?: Array<Record<string, unknown>>;
}

interface DblpHitInfo {
  title?: string;
  venue?: string;
  year?: string | number;
  ee?: string | string[];
  doi?: string;
}

interface DblpSearchResponse {
  result?: {
    hits?: {
      hit?: Array<{ info?: DblpHitInfo }> | { info?: DblpHitInfo };
    };
  };
}

interface CandidatePdf {
  source: string;
  url: string;
}

interface ResolvedMetadata {
  title?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  landingUrl?: string;
  url?: string;
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
    applyResolvedMetadata(row, {
      landingUrl: arxiv.landingUrl,
      url: arxiv.landingUrl
    });
    if (!row.pdf_url && arxiv.pdfUrl) {
      row.pdf_url = arxiv.pdfUrl;
      row.pdf_url_source = "arxiv";
      pdfRecovered = true;
    }
    if (arxiv.bibtex && args.bibtexMode === "hybrid") {
      bibtexCandidates.push(arxiv.bibtex);
      bibtexEnriched = true;
    }
  }

  const landingCandidates = await collectLandingCandidates(args, row, attempts, errors);
  for (const landing of landingCandidates) {
    const processed = await processLandingCandidate(args, row, landing, attempts, errors, bibtexCandidates);
    for (const source of processed.fallbackSources) {
      fallbackSources.add(source);
    }
    if (processed.pdfRecovered) {
      pdfRecovered = true;
    }
    if (processed.bibtexEnriched) {
      bibtexEnriched = true;
    }
    if (row.pdf_url && row.bibtex) {
      break;
    }
  }

  if (shouldTryVenueTitleDiscovery(row)) {
    const discovery = await collectVenueTitleCandidates(args, row, attempts, errors);
    applyResolvedMetadata(row, discovery.metadata);
    for (const landing of discovery.urls) {
      const processed = await processLandingCandidate(args, row, landing, attempts, errors, bibtexCandidates);
      fallbackSources.add("title_discovery");
      for (const source of processed.fallbackSources) {
        fallbackSources.add(source);
      }
      if (processed.pdfRecovered) {
        pdfRecovered = true;
      }
      if (processed.bibtexEnriched) {
        bibtexEnriched = true;
      }
      if (row.pdf_url && row.bibtex) {
        break;
      }
    }
  }

  if (row.doi) {
    const crossref = await resolveCrossref(args, row, attempts, errors);
    fallbackSources.add("crossref");
    applyResolvedMetadata(row, crossref.metadata);
    if (!row.pdf_url && crossref.pdfUrl) {
      row.pdf_url = crossref.pdfUrl;
      row.pdf_url_source = "crossref";
      pdfRecovered = true;
    }
    if (crossref.bibtex && args.bibtexMode === "hybrid") {
      bibtexCandidates.push(crossref.bibtex);
      bibtexEnriched = true;
    }
  }

  if (row.doi && !row.pdf_url) {
    const openAlex = await resolveOpenAlex(args, row, attempts, errors);
    fallbackSources.add("openalex");
    applyResolvedMetadata(row, {
      landingUrl: openAlex.landingUrl,
      url: openAlex.landingUrl
    });
    if (!row.pdf_url && openAlex.pdfUrl) {
      row.pdf_url = openAlex.pdfUrl;
      row.pdf_url_source = "openalex";
      pdfRecovered = true;
    }
  }

  if (!row.pdf_url || (args.bibtexMode === "hybrid" && shouldTryGenericBibtex(row))) {
    const landing = row.landing_url || firstNonSemanticScholarUrl(row.url);
    if (landing) {
      const generic = await resolveGenericLanding(args, row, landing, attempts, errors);
      fallbackSources.add("landing_page");
      applyResolvedMetadata(row, generic.metadata);
      if (!row.pdf_url && generic.pdfUrl) {
        row.pdf_url = generic.pdfUrl;
        row.pdf_url_source = generic.pdfSource;
        pdfRecovered = true;
      }
      if (generic.bibtex && args.bibtexMode === "hybrid") {
        bibtexCandidates.push(generic.bibtex);
        bibtexEnriched = true;
      }
    }
  }

  row.url = mergePreferredSourceUrl(row.url, row.landing_url);

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

async function processLandingCandidate(
  args: EnrichCollectedPaperArgs,
  row: StoredCorpusRow,
  landingUrl: string,
  attempts: CollectEnrichmentAttempt[],
  errors: string[],
  bibtexCandidates: BibtexCandidate[]
): Promise<{ pdfRecovered: boolean; bibtexEnriched: boolean; fallbackSources: string[] }> {
  const host = safeHost(landingUrl);
  const fallbackSources = new Set<string>();
  let pdfRecovered = false;
  let bibtexEnriched = false;

  if (/\.pdf($|[?#])/i.test(landingUrl)) {
    const isIfaamas = Boolean(host && host.endsWith("ifaamas.org"));
    const stage = isIfaamas ? "ifaamas_pdf" : "landing_pdf_direct";
    const verified = await verifyPdfCandidate(landingUrl, stage, attempts, errors, args.abortSignal);
    if (!row.pdf_url && verified) {
      row.pdf_url = verified;
      row.pdf_url_source = isIfaamas ? "ifaamas" : "landing_page";
      pdfRecovered = true;
      if (isIfaamas) {
        fallbackSources.add("ifaamas");
      }
    }
  }

  if (host === "aclanthology.org") {
    const acl = await resolveAclAnthology(args, landingUrl, attempts, errors);
    fallbackSources.add("acl_anthology");
    applyResolvedMetadata(row, {
      landingUrl: acl.landingUrl,
      url: acl.landingUrl
    });
    if (!row.pdf_url && acl.pdfUrl) {
      row.pdf_url = acl.pdfUrl;
      row.pdf_url_source = "acl_anthology";
      pdfRecovered = true;
    }
    if (acl.bibtex && args.bibtexMode === "hybrid") {
      bibtexCandidates.push(acl.bibtex);
      bibtexEnriched = true;
    }
  }

  if (host === "openreview.net") {
    const openReview = await resolveOpenReview(args, landingUrl, attempts, errors);
    fallbackSources.add("openreview");
    applyResolvedMetadata(row, {
      landingUrl: openReview.landingUrl,
      url: openReview.landingUrl
    });
    if (!row.pdf_url && openReview.pdfUrl) {
      row.pdf_url = openReview.pdfUrl;
      row.pdf_url_source = "openreview";
      pdfRecovered = true;
    }
    if (openReview.bibtex && args.bibtexMode === "hybrid") {
      bibtexCandidates.push(openReview.bibtex);
      bibtexEnriched = true;
    }
  }

  if (host === "proceedings.mlr.press") {
    const pmlr = await resolvePmlr(args, landingUrl, attempts, errors);
    fallbackSources.add("pmlr");
    applyResolvedMetadata(row, {
      landingUrl: pmlr.landingUrl,
      url: pmlr.landingUrl
    });
    if (!row.pdf_url && pmlr.pdfUrl) {
      row.pdf_url = pmlr.pdfUrl;
      row.pdf_url_source = "pmlr";
      pdfRecovered = true;
    }
    if (pmlr.bibtex && args.bibtexMode === "hybrid") {
      bibtexCandidates.push(pmlr.bibtex);
      bibtexEnriched = true;
    }
  }

  if (host && host.endsWith("ifaamas.org")) {
    fallbackSources.add("ifaamas");
  }

  return {
    pdfRecovered,
    bibtexEnriched,
    fallbackSources: Array.from(fallbackSources)
  };
}

export function mergeStoredCorpusRows(existing: StoredCorpusRow | undefined, incoming: StoredCorpusRow): StoredCorpusRow {
  if (!existing) {
    return incoming;
  }

  const preserveExistingMetadata = hasPreferredPublicationSignal(existing) && isArxivOnlyRecord(incoming);
  const preferIncomingMetadata = hasPreferredPublicationSignal(incoming) && isArxivOnlyRecord(existing);

  const merged: StoredCorpusRow = {
    ...existing,
    title: mergePreferredMetadataString(existing.title, incoming.title, preserveExistingMetadata, preferIncomingMetadata) ?? existing.title,
    abstract:
      mergePreferredMetadataString(existing.abstract, incoming.abstract, preserveExistingMetadata, preferIncomingMetadata)
      ?? existing.abstract,
    year: mergePreferredMetadataNumber(existing.year, incoming.year, preserveExistingMetadata, preferIncomingMetadata),
    venue: mergePreferredMetadataString(existing.venue, incoming.venue, preserveExistingMetadata, preferIncomingMetadata),
    url: mergePreferredSourceUrl(existing.url, incoming.url),
    landing_url: mergePreferredSourceUrl(existing.landing_url, incoming.landing_url),
    authors: mergePreferredAuthors(existing.authors, incoming.authors, preserveExistingMetadata, preferIncomingMetadata)
  };
  merged.citation_count = incoming.citation_count ?? existing.citation_count;
  merged.influential_citation_count =
    incoming.influential_citation_count ?? existing.influential_citation_count;
  merged.publication_date = mergePreferredMetadataString(
    existing.publication_date,
    incoming.publication_date,
    preserveExistingMetadata,
    preferIncomingMetadata
  );
  merged.publication_types =
    incoming.publication_types && incoming.publication_types.length > 0
      ? preserveExistingMetadata
        ? existing.publication_types
        : incoming.publication_types
      : existing.publication_types;
  merged.fields_of_study =
    incoming.fields_of_study && incoming.fields_of_study.length > 0
      ? incoming.fields_of_study
      : existing.fields_of_study;

  if (!existing.pdf_url && incoming.pdf_url) {
    merged.pdf_url = incoming.pdf_url;
    merged.pdf_url_source = incoming.pdf_url_source;
  } else if (existing.pdf_url && existing.pdf_url === incoming.pdf_url && !existing.pdf_url_source && incoming.pdf_url_source) {
    merged.pdf_url_source = incoming.pdf_url_source;
  }

  const existingBibtexRichness = existing.bibtex_richness ?? scoreBibtexRichness(existing.bibtex ?? "");
  const incomingBibtexRichness = incoming.bibtex_richness ?? scoreBibtexRichness(incoming.bibtex ?? "");
  const existingBibtexCandidate =
    existing.bibtex && existing.bibtex.trim()
      ? {
          source: existing.bibtex_source ?? "local_generated",
          entry: existing.bibtex,
          richness: existingBibtexRichness
        }
      : undefined;
  const incomingBibtexCandidate =
    incoming.bibtex && incoming.bibtex.trim()
      ? {
          source: incoming.bibtex_source ?? "local_generated",
          entry: incoming.bibtex,
          richness: incomingBibtexRichness
        }
      : undefined;
  const preferredBibtex = selectPreferredBibtex(
    "hybrid",
    [existingBibtexCandidate, incomingBibtexCandidate].filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)),
    undefined
  );
  if (preferredBibtex) {
    merged.bibtex = preferredBibtex.entry;
    merged.bibtex_source = preferredBibtex.source;
    merged.bibtex_richness = preferredBibtex.richness || undefined;
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
  merged.url = mergePreferredSourceUrl(merged.url, merged.landing_url);

  return merged;
}

function preferNonEmptyString(existing: string | undefined, incoming: string | undefined): string | undefined {
  if (typeof incoming === "string" && incoming.trim()) {
    return incoming;
  }
  return existing;
}

function mergePreferredSourceUrl(existing: string | undefined, incoming: string | undefined): string | undefined {
  if (!incoming) {
    return existing;
  }
  if (!existing) {
    return incoming;
  }
  const existingPriority = sourceUrlPriority(existing);
  const incomingPriority = sourceUrlPriority(incoming);
  if (incomingPriority > existingPriority) {
    return incoming;
  }
  if (incomingPriority < existingPriority) {
    return existing;
  }
  const existingIsPdf = /\.pdf($|[?#])/i.test(existing);
  const incomingIsPdf = /\.pdf($|[?#])/i.test(incoming);
  if (!existingIsPdf && incomingIsPdf) {
    return existing;
  }
  if (existingIsPdf && !incomingIsPdf) {
    return incoming;
  }
  return incoming;
}

function mergePreferredMetadataString(
  existing: string | undefined,
  incoming: string | undefined,
  preserveExisting: boolean,
  preferIncoming: boolean
): string | undefined {
  const normalizedIncoming = typeof incoming === "string" && incoming.trim() ? incoming.trim() : undefined;
  if (!normalizedIncoming) {
    return existing;
  }
  if (!existing || !existing.trim()) {
    return normalizedIncoming;
  }
  if (preserveExisting) {
    return existing;
  }
  if (preferIncoming) {
    return normalizedIncoming;
  }
  return normalizedIncoming;
}

function mergePreferredMetadataNumber(
  existing: number | undefined,
  incoming: number | undefined,
  preserveExisting: boolean,
  preferIncoming: boolean
): number | undefined {
  if (typeof incoming !== "number" || !Number.isFinite(incoming)) {
    return existing;
  }
  if (existing === undefined) {
    return incoming;
  }
  if (preserveExisting) {
    return existing;
  }
  if (preferIncoming) {
    return incoming;
  }
  return incoming;
}

function mergePreferredAuthors(
  existing: string[],
  incoming: string[],
  preserveExisting: boolean,
  preferIncoming: boolean
): string[] {
  if (!incoming.length) {
    return existing;
  }
  if (!existing.length) {
    return incoming;
  }
  if (preserveExisting) {
    return existing;
  }
  if (preferIncoming) {
    return incoming;
  }
  return incoming;
}

function applyResolvedMetadata(row: StoredCorpusRow, metadata: ResolvedMetadata | undefined): void {
  if (!metadata) {
    return;
  }

  const rowWasArxivOnly = isArxivOnlyRecord(row);
  const incomingPreferred = hasPreferredMetadataSignal(metadata);

  if (metadata.doi && !row.doi) {
    row.doi = metadata.doi;
  }

  if (metadata.landingUrl) {
    row.landing_url = mergePreferredSourceUrl(row.landing_url, metadata.landingUrl);
  }
  if (metadata.url || metadata.landingUrl) {
    row.url = mergePreferredSourceUrl(row.url, metadata.url || metadata.landingUrl);
  }

  if (metadata.title && (!row.title || (rowWasArxivOnly && incomingPreferred))) {
    row.title = metadata.title;
  }
  if (metadata.venue && (!row.venue || isArxivVenue(row.venue) || (rowWasArxivOnly && incomingPreferred))) {
    row.venue = metadata.venue;
  }
  if (typeof metadata.year === "number" && Number.isFinite(metadata.year) && (!row.year || (rowWasArxivOnly && incomingPreferred))) {
    row.year = metadata.year;
  }
  if (metadata.authors && metadata.authors.length > 0 && (row.authors.length === 0 || (rowWasArxivOnly && incomingPreferred))) {
    row.authors = metadata.authors;
  }
}

function hasPreferredPublicationSignal(row: Partial<StoredCorpusRow>): boolean {
  return (
    hasPreferredMetadataSignal({
      venue: row.venue,
      landingUrl: row.landing_url,
      url: row.url
    })
    || isPublishedBibtexSource(row.bibtex_source)
    || isPublishedPdfSource(row.pdf_url_source)
  );
}

function hasPreferredMetadataSignal(metadata: ResolvedMetadata | Pick<StoredCorpusRow, "doi" | "venue" | "landing_url" | "url">): boolean {
  const landingUrl = "landingUrl" in metadata ? metadata.landingUrl : undefined;
  const storedLandingUrl = "landing_url" in metadata ? metadata.landing_url : undefined;
  return Boolean(
    hasPublishedVenue(metadata.venue)
    || hasCanonicalPublicationUrl(landingUrl || storedLandingUrl)
    || hasCanonicalPublicationUrl(metadata.url)
  );
}

function isArxivOnlyRecord(row: Partial<StoredCorpusRow>): boolean {
  return hasArxivSignal(row) && !hasPreferredPublicationSignal(row);
}

function hasArxivSignal(row: Partial<StoredCorpusRow>): boolean {
  return Boolean(
    row.arxiv_id
    || isArxivVenue(row.venue)
    || isArxivUrl(row.url)
    || isArxivUrl(row.landing_url)
    || row.pdf_url_source === "arxiv"
    || row.bibtex_source === "arxiv_generated"
  );
}

function hasPublishedVenue(venue: string | undefined): boolean {
  return Boolean(venue && venue.trim() && !isArxivVenue(venue));
}

function isArxivVenue(venue: string | undefined): boolean {
  const normalized = normalizeSearchText(venue || "");
  return normalized.includes("arxiv") || normalized === "corr" || normalized.includes("computing research repository");
}

function hasCanonicalPublicationUrl(url: string | undefined): boolean {
  return sourceUrlPriority(url) >= 2;
}

function isArxivUrl(url: string | undefined): boolean {
  const host = url ? safeHost(url) : undefined;
  return Boolean(host && host === "arxiv.org");
}

function isPublishedBibtexSource(source: StoredBibtexSource | undefined): boolean {
  return source === "acl_anthology"
    || source === "doi_content_negotiation"
    || source === "crossref_generated"
    || source === "openreview_generated"
    || source === "pmlr_generated";
}

function isPublishedPdfSource(source: string | undefined): boolean {
  return source === "crossref"
    || source === "openalex"
    || source === "acl_anthology"
    || source === "openreview"
    || source === "pmlr"
    || source === "ifaamas"
    || source === "landing_page";
}

function sourceUrlPriority(url: string | undefined): number {
  if (!url) {
    return -1;
  }
  const host = safeHost(url);
  if (!host) {
    return 0;
  }
  if (host.endsWith("semanticscholar.org")) {
    return 0;
  }
  if (host === "arxiv.org") {
    return 1;
  }
  if (host === "doi.org") {
    return 2;
  }
  return 3;
}

function isSemanticScholarHost(url: string): boolean {
  const host = safeHost(url);
  return Boolean(host && host.endsWith("semanticscholar.org"));
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
  const pageUrl = derivePmlrPageUrl(landingUrl);
  if (!pageUrl) {
    return { landingUrl };
  }
  const stemUrl = derivePmlrStemUrl(pageUrl);
  let pdfUrl = stemUrl
    ? await verifyPdfCandidate(`${stemUrl}.pdf`, "pmlr_pdf", attempts, errors, args.abortSignal)
    : undefined;
  let resolvedLandingUrl = pageUrl;
  if (!pdfUrl) {
    const html = await fetchTextCandidate(pageUrl, "pmlr_html", attempts, errors, args.abortSignal);
    if (html) {
      const $ = load(html);
      const pagePdfCandidates = extractPdfCandidatesFromHtml($, pageUrl);
      for (const candidate of pagePdfCandidates) {
        pdfUrl = await verifyPdfCandidate(candidate, "pmlr_page_pdf", attempts, errors, args.abortSignal);
        if (pdfUrl) {
          break;
        }
      }
      const metaLanding =
        firstMetaContent($, "meta[name='citation_abstract_html_url']") ||
        firstMetaContent($, "meta[property='og:url']");
      if (metaLanding) {
        resolvedLandingUrl = new URL(metaLanding, pageUrl).toString();
      }
    }
  }
  const bibtexEntry = buildGeneratedBibtexEntry({
    paperId: args.paper.paperId,
    title: args.paper.title,
    authors: args.paper.authors,
    year: args.paper.year,
    venue: args.paper.venue || "PMLR",
    doi: args.paper.doi,
    url: resolvedLandingUrl
  });
  return {
    pdfUrl,
    landingUrl: resolvedLandingUrl,
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
): Promise<{ pdfUrl?: string; landingUrl?: string; bibtex?: BibtexCandidate; metadata?: ResolvedMetadata }> {
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

  const metadata = message
    ? {
        title: (message.title && message.title[0]) || args.paper.title,
        authors: normalizeCrossrefAuthors(message.author, args.paper.authors),
        year: extractCrossrefYear(message) ?? args.paper.year,
        venue: (message["container-title"] && message["container-title"][0]) || args.paper.venue,
        doi: row.doi,
        landingUrl,
        url: landingUrl || message.URL || row.url
      }
    : landingUrl || row.doi
      ? {
          doi: row.doi,
          landingUrl,
          url: landingUrl || row.url
        }
      : undefined;

  return { pdfUrl, landingUrl, bibtex, metadata };
}

async function resolveOpenAlex(
  args: EnrichCollectedPaperArgs,
  row: StoredCorpusRow,
  attempts: CollectEnrichmentAttempt[],
  errors: string[]
): Promise<{ pdfUrl?: string; landingUrl?: string }> {
  if (!row.doi) {
    return {};
  }

  const raw = await fetchJsonCandidate(
    `https://api.openalex.org/works/https://doi.org/${row.doi}`,
    "openalex_work",
    attempts,
    errors,
    args.abortSignal
  );
  const work = extractOpenAlexWork(raw);
  if (!work) {
    return {};
  }

  const landingCandidates = [
    work.best_oa_location?.landing_page_url,
    work.primary_location?.landing_page_url,
    ...(work.locations || []).map((location) => location?.landing_page_url)
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim());

  const pdfCandidates = [
    work.best_oa_location?.pdf_url,
    work.primary_location?.pdf_url,
    work.open_access?.oa_url,
    ...(work.locations || []).map((location) => location?.pdf_url)
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim())
    .filter((value, index, array) => array.indexOf(value) === index)
    .filter((value) => !looksLikeNonDirectDoiUrl(value));

  for (const candidate of pdfCandidates) {
    const verified = await verifyPdfCandidate(candidate, "openalex_pdf", attempts, errors, args.abortSignal);
    if (verified) {
      return {
        pdfUrl: verified,
        landingUrl: firstNonSemanticScholarUrl(landingCandidates[0]) || row.landing_url
      };
    }
  }

  return {
    landingUrl: firstNonSemanticScholarUrl(landingCandidates[0]) || row.landing_url
  };
}

async function resolveGenericLanding(
  args: EnrichCollectedPaperArgs,
  row: StoredCorpusRow,
  landingUrl: string,
  attempts: CollectEnrichmentAttempt[],
  errors: string[]
): Promise<{ pdfUrl?: string; pdfSource?: string; bibtex?: BibtexCandidate; metadata?: ResolvedMetadata }> {
  const html = await fetchTextCandidate(landingUrl, "landing_html", attempts, errors, args.abortSignal);
  if (!html) {
    return {};
  }

  const $ = load(html);
  const pdfCandidates = extractPdfCandidatesFromHtml($, landingUrl);

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
    metadata: {
      title,
      authors: authors.length > 0 ? authors : undefined,
      year,
      venue,
      doi,
      landingUrl,
      url: landingUrl
    },
    bibtex: shouldTryGenericBibtex(row)
      ? {
          source: "local_generated",
          entry: generated,
          richness: scoreBibtexRichness(generated)
        }
      : undefined
  };
}

function extractPdfCandidatesFromHtml($: ReturnType<typeof load>, baseUrl: string): string[] {
  const pdfCandidates = new Set<string>();
  const metaPdf =
    firstMetaContent($, "meta[name='citation_pdf_url']") ||
    firstMetaContent($, "meta[property='citation_pdf_url']") ||
    firstMetaContent($, "meta[name='dc.identifier.pdf']");
  if (metaPdf) {
    pdfCandidates.add(new URL(metaPdf, baseUrl).toString());
  }
  $("link[rel='alternate']").each((_, element) => {
    const type = ($(element).attr("type") || "").toLowerCase();
    const href = $(element).attr("href");
    if (href && type.includes("pdf")) {
      pdfCandidates.add(new URL(href, baseUrl).toString());
    }
  });
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (href && /\.pdf($|[?#])/i.test(href)) {
      pdfCandidates.add(new URL(href, baseUrl).toString());
    }
  });
  return Array.from(pdfCandidates);
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

async function collectVenueTitleCandidates(
  args: EnrichCollectedPaperArgs,
  row: StoredCorpusRow,
  attempts: CollectEnrichmentAttempt[],
  errors: string[]
): Promise<{ urls: string[]; metadata?: ResolvedMetadata }> {
  const urls = new Set<string>();

  if (looksLikeOpenReviewVenue(row.venue)) {
    const openReviewUrl = await searchOpenReviewByTitle(row.title, attempts, errors, args.abortSignal);
    if (openReviewUrl) {
      urls.add(openReviewUrl);
    }
  }

  if (looksLikePmlrVenue(row.venue)) {
    const pmlrUrl = await searchPmlrByTitleAndVenue(row, attempts, errors, args.abortSignal);
    if (pmlrUrl) {
      urls.add(pmlrUrl);
    }
  }

  if (looksLikeAamasVenue(row.venue)) {
    const ifaamasPdfUrl = synthesizeIfaamasPdfUrl(row);
    if (ifaamasPdfUrl) {
      urls.add(ifaamasPdfUrl);
    }
  }

  if (urls.size > 0) {
    return { urls: Array.from(urls) };
  }

  const dblp = await searchDblpByTitle(row.title, row.venue, attempts, errors, args.abortSignal);
  for (const url of dblp.urls) {
    urls.add(url);
  }

  return { urls: Array.from(urls), metadata: dblp.metadata };
}

async function searchPmlrByTitleAndVenue(
  row: StoredCorpusRow,
  attempts: CollectEnrichmentAttempt[],
  errors: string[],
  abortSignal?: AbortSignal
): Promise<string | undefined> {
  const indexHtml = await fetchTextCandidate(
    "https://proceedings.mlr.press/",
    "pmlr_volume_index",
    attempts,
    errors,
    abortSignal
  );
  if (!indexHtml) {
    return undefined;
  }

  const $index = load(indexHtml);
  const venueTerms = buildVenueSearchTerms(row.venue);
  const yearToken = typeof row.year === "number" ? String(row.year) : undefined;
  const volumeCandidates = $index("li")
    .map((_, element) => {
      const text = $index(element).text().replace(/\s+/g, " ").trim();
      const href = $index(element).find("a[href]").first().attr("href");
      if (!href || !/^v\d+\/?$/.test(href)) {
        return null;
      }
      const lowerText = text.toLowerCase();
      const venueScore = venueTerms.reduce((best, term) => Math.max(best, lexicalSimilarity(term, lowerText)), 0);
      const yearScore = yearToken && lowerText.includes(yearToken) ? 0.2 : 0;
      return {
        url: new URL(href, "https://proceedings.mlr.press/").toString(),
        score: venueScore + yearScore
      };
    })
    .get()
    .filter((candidate): candidate is { url: string; score: number } => Boolean(candidate && candidate.score >= 0.45))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  for (const volume of volumeCandidates) {
    const volumeHtml = await fetchTextCandidate(volume.url, "pmlr_volume_page", attempts, errors, abortSignal);
    if (!volumeHtml) {
      continue;
    }
    const $volume = load(volumeHtml);
    const paperMatches = $volume(".paper")
      .map((_, element) => {
        const paper = $volume(element);
        const title = paper.find(".title").first().text().replace(/\s+/g, " ").trim();
        const absHref = paper.find("a[href]").filter((__, anchor) => {
          const text = $volume(anchor).text().trim().toLowerCase();
          return text === "abs";
        }).first().attr("href");
        if (!title || !absHref) {
          return null;
        }
        return {
          title,
          absUrl: new URL(absHref, volume.url).toString(),
          score: lexicalSimilarity(row.title, title)
        };
      })
      .get()
      .filter((candidate): candidate is { title: string; absUrl: string; score: number } => Boolean(candidate && candidate.score >= 0.72))
      .sort((a, b) => b.score - a.score);
    if (paperMatches[0]?.absUrl) {
      return paperMatches[0].absUrl;
    }
  }

  return undefined;
}

async function searchOpenReviewByTitle(
  title: string,
  attempts: CollectEnrichmentAttempt[],
  errors: string[],
  abortSignal?: AbortSignal
): Promise<string | undefined> {
  const queries = buildTitleSearchQueries(title);
  for (const query of queries) {
    const raw = await fetchJsonCandidate(
      `https://api2.openreview.net/notes/search?query=${encodeURIComponent(query)}`,
      "openreview_title_search",
      attempts,
      errors,
      abortSignal
    );
    const notes = extractOpenReviewNotes(raw);
    if (notes.length === 0) {
      continue;
    }
    const ranked = notes
      .map((note) => {
        const content = note.content && typeof note.content === "object" ? note.content : {};
        const candidateTitle = extractOpenReviewString((content as Record<string, unknown>).title);
        const forum = typeof note.forum === "string" && note.forum ? note.forum : typeof note.id === "string" ? note.id : undefined;
        return {
          forum,
          title: candidateTitle,
          score: lexicalSimilarity(title, candidateTitle)
        };
      })
      .filter((note) => note.forum && note.score >= 0.72)
      .sort((a, b) => b.score - a.score);
    if (ranked[0]?.forum) {
      return `https://openreview.net/forum?id=${encodeURIComponent(ranked[0].forum)}`;
    }
  }
  return undefined;
}

async function searchDblpByTitle(
  title: string,
  venue: string | undefined,
  attempts: CollectEnrichmentAttempt[],
  errors: string[],
  abortSignal?: AbortSignal
): Promise<{ urls: string[]; metadata?: ResolvedMetadata }> {
  const queries = buildTitleSearchQueries(title);
  for (const query of queries) {
    const raw = await fetchJsonCandidateWithRetry(
      `https://dblp.org/search/publ/api?q=${encodeURIComponent(query)}&format=json`,
      "dblp_title_search",
      attempts,
      errors,
      abortSignal,
      4
    );
    const hits = extractDblpHits(raw);
    if (hits.length === 0) {
      continue;
    }
    const ranked = hits
      .map((info) => {
        const score = lexicalSimilarity(title, info.title || "");
        const venueScore = lexicalSimilarity(venue || "", info.venue || "");
        return {
          info,
          score,
          venueScore
        };
      })
      .filter((candidate) => candidate.score >= 0.68 || (candidate.score >= 0.55 && candidate.venueScore >= 0.45))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return b.venueScore - a.venueScore;
      });
    if (ranked.length === 0) {
      continue;
    }
    const urls = new Set<string>();
    let doi: string | undefined;
    const best = ranked[0]?.info;
    for (const candidate of ranked.slice(0, 5)) {
      const eeValues = Array.isArray(candidate.info.ee) ? candidate.info.ee : candidate.info.ee ? [candidate.info.ee] : [];
      for (const value of eeValues) {
        if (!value) {
          continue;
        }
        const host = safeHost(value);
        if (
          host === "aclanthology.org" ||
          host === "openreview.net" ||
          host === "proceedings.mlr.press" ||
          host === "ifaamas.org"
        ) {
          urls.add(value);
        }
      }
      if (!doi && candidate.info.doi) {
        doi = candidate.info.doi;
      }
    }
    if (urls.size > 0 || doi) {
      return {
        urls: Array.from(urls),
        metadata: {
          title: typeof best?.title === "string" ? best.title : undefined,
          venue: typeof best?.venue === "string" ? best.venue : undefined,
          year: normalizeYear(best?.year),
          doi
        }
      };
    }
  }
  return { urls: [] };
}

async function fetchJsonCandidateWithRetry(
  url: string,
  stage: string,
  attempts: CollectEnrichmentAttempt[],
  errors: string[],
  abortSignal: AbortSignal | undefined,
  maxAttempts: number
): Promise<unknown> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const beforeAttempts = attempts.length;
    const raw = await fetchJsonCandidate(url, stage, attempts, errors, abortSignal);
    if (raw !== undefined) {
      return raw;
    }
    const latest = attempts[attempts.length - 1];
    const serverError =
      latest &&
      attempts.length > beforeAttempts &&
      latest.stage === stage &&
      latest.ok === false &&
      typeof latest.detail === "string" &&
      /^5\d\d$/.test(latest.detail);
    if (!serverError || attempt === maxAttempts) {
      break;
    }
    await sleep(150 * attempt);
  }
  return undefined;
}

function shouldTryGenericBibtex(row: StoredCorpusRow): boolean {
  const existing = row.bibtex || row.semantic_scholar_bibtex;
  return scoreBibtexRichness(existing ?? "") < 8;
}

function shouldTryVenueTitleDiscovery(row: StoredCorpusRow): boolean {
  if (!row.title) {
    return false;
  }
  const arxivPdfOnly = row.pdf_url && row.pdf_url_source === "arxiv" && isArxivOnlyRecord(row);
  if (row.pdf_url && !arxivPdfOnly) {
    return false;
  }
  const landingHost = row.landing_url ? safeHost(row.landing_url) : undefined;
  const sourceHost = row.url ? safeHost(row.url) : undefined;
  return (
    (!landingHost || landingHost.endsWith("semanticscholar.org") || landingHost === "arxiv.org") &&
    (
      (sourceHost ? sourceHost.endsWith("semanticscholar.org") : false) ||
      sourceHost === "arxiv.org" ||
      (landingHost ? landingHost.endsWith("semanticscholar.org") : false) ||
      landingHost === "arxiv.org" ||
      looksLikeOpenReviewVenue(row.venue) ||
      looksLikeAclVenue(row.venue) ||
      looksLikePmlrVenue(row.venue) ||
      looksLikeAamasVenue(row.venue)
    )
  );
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

function normalizeYear(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
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

function derivePmlrPageUrl(landingUrl: string): string | undefined {
  const normalized = firstNonSemanticScholarUrl(landingUrl);
  if (!normalized || safeHost(normalized) !== "proceedings.mlr.press") {
    return undefined;
  }
  const withoutTrailingSlash = normalized.replace(/\/+$/, "");
  if (/\.html$/i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash;
  }
  if (/\.pdf$/i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash.replace(/\.pdf$/i, ".html");
  }
  return `${withoutTrailingSlash}.html`;
}

function derivePmlrStemUrl(pageUrl: string): string | undefined {
  const normalized = firstNonSemanticScholarUrl(pageUrl);
  if (!normalized || safeHost(normalized) !== "proceedings.mlr.press") {
    return undefined;
  }
  return normalized.replace(/\/+$/, "").replace(/\.html$/i, "").replace(/\.pdf$/i, "");
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

function extractOpenReviewNotes(raw: unknown): Array<Record<string, unknown>> {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const notes = (raw as OpenReviewSearchResponse).notes;
  return Array.isArray(notes) ? notes.filter((note) => note && typeof note === "object") : [];
}

function extractOpenReviewString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && typeof (value as { value?: unknown }).value === "string") {
    return (value as { value: string }).value;
  }
  return "";
}

function extractDblpHits(raw: unknown): DblpHitInfo[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const hit = (raw as DblpSearchResponse).result?.hits?.hit;
  if (Array.isArray(hit)) {
    return hit
      .map((entry) => entry?.info)
      .filter((info): info is DblpHitInfo => Boolean(info && typeof info === "object"));
  }
  if (hit && typeof hit === "object" && "info" in hit && hit.info && typeof hit.info === "object") {
    return [hit.info as DblpHitInfo];
  }
  return [];
}

function extractOpenAlexWork(raw: unknown): OpenAlexWork | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  return raw as OpenAlexWork;
}

function buildTitleSearchQueries(title: string): string[] {
  const normalized = normalizeSearchText(title);
  const tokens = normalized.split(" ").filter(Boolean);
  const queries: string[] = [];
  if (normalized) {
    queries.push(normalized);
  }
  if (tokens.length > 6) {
    queries.push(tokens.slice(0, 6).join(" "));
  }
  if (tokens.length > 8) {
    queries.push(tokens.slice(0, 8).join(" "));
  }
  return Array.from(new Set(queries));
}

function buildVenueSearchTerms(venue: string | undefined): string[] {
  const normalized = normalizeSearchText(venue || "");
  const terms = new Set<string>();
  if (normalized) {
    terms.add(normalized);
  }
  if (normalized.includes("international conference on machine learning")) {
    terms.add("icml");
    terms.add("proceedings of icml");
  }
  if (normalized.includes("learning theory")) {
    terms.add("colt");
    terms.add("conference on learning theory");
  }
  if (normalized.includes("adaptive agents and multi agent systems") || normalized.includes("autonomous agents and multi agent systems")) {
    terms.add("aamas");
    terms.add("international joint conference on autonomous agents and multiagent systems");
  }
  return Array.from(terms);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function lexicalSimilarity(left: string, right: string): number {
  const a = normalizeSearchText(left);
  const b = normalizeSearchText(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size || 1;
  const tokenScore = overlap / union;
  const aBigrams = buildBigrams(a);
  const bBigrams = buildBigrams(b);
  const bigramOverlap = [...aBigrams].filter((token) => bBigrams.has(token)).length;
  const bigramDenominator = aBigrams.size + bBigrams.size || 1;
  const bigramScore = (2 * bigramOverlap) / bigramDenominator;
  return (tokenScore + bigramScore) / 2;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildBigrams(value: string): Set<string> {
  const compact = value.replace(/\s+/g, " ").trim();
  const output = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    output.add(compact.slice(index, index + 2));
  }
  return output;
}

function looksLikeOpenReviewVenue(venue: string | undefined): boolean {
  const normalized = normalizeSearchText(venue || "");
  return (
    normalized.includes("openreview") ||
    normalized.includes("learning representations") ||
    normalized.includes("conference on learning representations") ||
    normalized.includes("colm")
  );
}

function looksLikeAclVenue(venue: string | undefined): boolean {
  const normalized = normalizeSearchText(venue || "");
  return (
    normalized.includes("acl") ||
    normalized.includes("emnlp") ||
    normalized.includes("naacl") ||
    normalized.includes("coling") ||
    normalized.includes("computational linguistics")
  );
}

function looksLikePmlrVenue(venue: string | undefined): boolean {
  const normalized = normalizeSearchText(venue || "");
  return (
    normalized.includes("proceedings of machine learning research") ||
    normalized.includes("international conference on machine learning") ||
    normalized.includes("learning theory")
  );
}

function looksLikeAamasVenue(venue: string | undefined): boolean {
  const normalized = normalizeSearchText(venue || "");
  return (
    normalized.includes("aamas") ||
    normalized.includes("adaptive agents and multi agent systems") ||
    normalized.includes("autonomous agents and multi agent systems")
  );
}

function synthesizeIfaamasPdfUrl(row: StoredCorpusRow): string | undefined {
  if (!looksLikeAamasVenue(row.venue) || typeof row.year !== "number") {
    return undefined;
  }
  const firstPage = extractFirstPageFromStoredRow(row);
  if (!firstPage) {
    return undefined;
  }
  return `https://www.ifaamas.org/Proceedings/aamas${row.year}/pdfs/p${firstPage}.pdf`;
}

function extractFirstPageFromStoredRow(row: StoredCorpusRow): string | undefined {
  const candidates = [row.bibtex, row.semantic_scholar_bibtex];
  for (const value of candidates) {
    if (!value) {
      continue;
    }
    const match =
      value.match(/\bpages\s*=\s*[{\"]?(\d+)(?:\s*[-–]+\s*\d+)?/i) ||
      value.match(/\bpages\s*=\s*[{\"]?(\d+)/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
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

function looksLikeNonDirectDoiUrl(url: string): boolean {
  const host = safeHost(url);
  return Boolean(host && host === "doi.org");
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
