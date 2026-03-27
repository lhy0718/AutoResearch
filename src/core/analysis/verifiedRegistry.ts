import { createHash } from "node:crypto";

import {
  buildBibtexEntry,
  buildGeneratedBibtexEntry,
  normalizeS2Bibtex,
  scoreBibtexRichness
} from "../collection/bibtex.js";
import {
  PaperSearchCandidate,
  PaperSearchProvider,
  StoredBibtexSource,
  StoredCorpusRow
} from "../collection/types.js";
import { SemanticScholarPaper, SemanticScholarSearchRequest } from "../../tools/semanticScholar.js";

export type VerifiedRegistryStatus = "verified" | "unverified" | "blocked" | "inferred";

export interface VerifiedRegistryAttempt {
  attempt_index: number;
  action:
    | "lookup_by_paper_id"
    | "lookup_by_title"
    | "repair_with_stored_bibtex"
    | "repair_with_generated_bibtex"
    | "lookup_external_by_doi"
    | "lookup_external_by_arxiv"
    | "lookup_external_by_title";
  outcome: "accepted" | "repaired" | "rejected";
  detail: string;
  matched_paper_id?: string;
  matched_provider?: PaperSearchProvider;
  bibtex_richness?: number;
}

export interface VerifiedRegistryEntry {
  citation_paper_id: string;
  resolved_paper_id?: string;
  title?: string;
  status: VerifiedRegistryStatus;
  repaired: boolean;
  bibtex_mode?: "stored" | "generated";
  doi?: string;
  arxiv_id?: string;
  url?: string;
  resolved_via?: "stored_corpus" | "external_provider";
  provider?: PaperSearchProvider;
  notes: string[];
  attempts: VerifiedRegistryAttempt[];
}

export interface VerifiedRegistryArtifact {
  generated_at: string;
  counts: Record<VerifiedRegistryStatus, number>;
  entries: VerifiedRegistryEntry[];
  blocked_citation_paper_ids: string[];
  summary_lines: string[];
}

export interface VerifiedRegistryBuildResult {
  artifact: VerifiedRegistryArtifact;
  supplemental_corpus_rows: StoredCorpusRow[];
}

interface VerifiedRegistryExternalProviderDeps {
  semanticScholar?: {
    searchPapers(
      request: SemanticScholarSearchRequest,
      abortSignal?: AbortSignal
    ): Promise<SemanticScholarPaper[]>;
  };
  openAlex?: {
    searchPapers(
      request: SemanticScholarSearchRequest,
      abortSignal?: AbortSignal
    ): Promise<PaperSearchCandidate[]>;
  };
  crossref?: {
    searchPapers(
      request: SemanticScholarSearchRequest,
      abortSignal?: AbortSignal
    ): Promise<PaperSearchCandidate[]>;
  };
  arxiv?: {
    searchPapers(
      request: SemanticScholarSearchRequest,
      abortSignal?: AbortSignal
    ): Promise<PaperSearchCandidate[]>;
  };
}

interface ExternalLookupPlan {
  action: "lookup_external_by_doi" | "lookup_external_by_arxiv" | "lookup_external_by_title";
  provider: PaperSearchProvider;
  query: string;
  limit: number;
  matcher: (candidate: NormalizedExternalCandidate) => boolean;
  exact_identifier_match: boolean;
}

interface NormalizedExternalCandidate {
  provider: PaperSearchProvider;
  paperId?: string;
  providerId?: string;
  title: string;
  abstract?: string;
  year?: number;
  venue?: string;
  url?: string;
  landingUrl?: string;
  openAccessPdfUrl?: string;
  authors: string[];
  doi?: string;
  arxivId?: string;
  citationStylesBibtex?: string;
}

export function buildVerifiedRegistry(input: {
  citedPaperIds: string[];
  corpus: StoredCorpusRow[];
}): VerifiedRegistryArtifact {
  const corpusById = new Map(input.corpus.map((paper) => [paper.paper_id, paper] as const));
  const corpusByNormalizedTitle = new Map(
    input.corpus
      .map((paper) => [normalizeTitleForLookup(paper.title), paper] as const)
      .filter(([normalizedTitle]) => normalizedTitle.length > 0)
  );

  const entries = uniqueStrings(input.citedPaperIds).filter(Boolean).map((citationPaperId) => {
    const attempts: VerifiedRegistryAttempt[] = [];
    const notes: string[] = [];
    let row = corpusById.get(citationPaperId);
    let repaired = false;

    if (row) {
      attempts.push({
        attempt_index: attempts.length + 1,
        action: "lookup_by_paper_id",
        outcome: "accepted",
        detail: `Resolved citation paper id ${citationPaperId} directly from the stored corpus.`,
        matched_paper_id: row.paper_id
      });
    } else {
      attempts.push({
        attempt_index: attempts.length + 1,
        action: "lookup_by_paper_id",
        outcome: "rejected",
        detail: `No stored corpus row exists for citation paper id ${citationPaperId}.`
      });
      const titleMatched = corpusByNormalizedTitle.get(normalizeTitleForLookup(citationPaperId));
      if (titleMatched) {
        row = titleMatched;
        repaired = true;
        attempts.push({
          attempt_index: attempts.length + 1,
          action: "lookup_by_title",
          outcome: "repaired",
          detail: `Recovered citation paper id ${citationPaperId} by exact normalized title match to corpus row ${titleMatched.paper_id}.`,
          matched_paper_id: titleMatched.paper_id
        });
        notes.push("The cited paper id did not resolve directly and was repaired via a title match.");
      } else {
        attempts.push({
          attempt_index: attempts.length + 1,
          action: "lookup_by_title",
          outcome: "rejected",
          detail: `No normalized title match could be found for citation reference ${citationPaperId}.`
        });
        notes.push("No stored source row could be resolved for this citation reference.");
      }
    }

    if (!row) {
      return {
        citation_paper_id: citationPaperId,
        status: "blocked",
        repaired,
        notes,
        attempts
      } satisfies VerifiedRegistryEntry;
    }

    return buildEntryFromStoredRow({
      citationPaperId,
      row,
      repaired,
      notes,
      attempts
    });
  });

  return finalizeVerifiedRegistry(entries);
}

export async function buildVerifiedRegistryWithExternalLookup(input: {
  citedPaperIds: string[];
  corpus: StoredCorpusRow[];
  externalProviders?: VerifiedRegistryExternalProviderDeps;
  abortSignal?: AbortSignal;
}): Promise<VerifiedRegistryBuildResult> {
  const localArtifact = buildVerifiedRegistry({
    citedPaperIds: input.citedPaperIds,
    corpus: input.corpus
  });

  const providers = input.externalProviders;
  if (!providers || !hasAnyExternalProvider(providers)) {
    return {
      artifact: localArtifact,
      supplemental_corpus_rows: []
    };
  }

  const entries = localArtifact.entries.map((entry) => ({
    ...entry,
    notes: [...entry.notes],
    attempts: entry.attempts.map((attempt) => ({ ...attempt }))
  }));
  const supplementalRows: StoredCorpusRow[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index];
    if (current.status !== "blocked") {
      continue;
    }
    const resolved = await resolveCitationExternally({
      entry: current,
      providers,
      abortSignal: input.abortSignal
    });
    if (!resolved) {
      continue;
    }
    entries[index] = resolved.entry;
    if (resolved.row) {
      supplementalRows.push(resolved.row);
    }
  }

  return {
    artifact: finalizeVerifiedRegistry(entries),
    supplemental_corpus_rows: dedupeCorpusRowsById(supplementalRows)
  };
}

function buildEntryFromStoredRow(input: {
  citationPaperId: string;
  row: StoredCorpusRow;
  repaired: boolean;
  notes: string[];
  attempts: VerifiedRegistryAttempt[];
}): VerifiedRegistryEntry {
  const title = input.row.title.trim();
  const doi = normalizeDoiForLookup(input.row.doi);
  const arxivId = normalizeArxivIdForLookup(input.row.arxiv_id);
  const url = input.row.url?.trim() || input.row.landing_url?.trim() || input.row.pdf_url?.trim() || undefined;
  const hasLocator = Boolean(doi || arxivId || url);

  const storedBibtex = normalizeS2Bibtex(input.row.bibtex) || normalizeS2Bibtex(input.row.semantic_scholar_bibtex);
  if (storedBibtex) {
    input.attempts.push({
      attempt_index: input.attempts.length + 1,
      action: "repair_with_stored_bibtex",
      outcome: input.repaired ? "repaired" : "accepted",
      detail: `Accepted stored bibliographic metadata for ${input.row.paper_id}.`,
      matched_paper_id: input.row.paper_id,
      bibtex_richness: scoreBibtexRichness(storedBibtex)
    });
    if (!hasLocator) {
      input.notes.push("The source row lacks DOI/arXiv/URL metadata, so the citation remains inferential.");
    }
    return {
      citation_paper_id: input.citationPaperId,
      resolved_paper_id: input.row.paper_id,
      title,
      status: classifyStoredRegistryStatus({
        repaired: input.repaired,
        titlePresent: title.length > 0,
        hasLocator
      }),
      repaired: input.repaired,
      bibtex_mode: "stored",
      doi,
      arxiv_id: arxivId,
      url,
      resolved_via: "stored_corpus",
      notes: input.notes,
      attempts: input.attempts
    };
  }

  const generatedBibtex = buildBibtexEntry(input.row, "generated").trim();
  if (generatedBibtex.startsWith("@") && title.length > 0) {
    input.attempts.push({
      attempt_index: input.attempts.length + 1,
      action: "repair_with_generated_bibtex",
      outcome: "repaired",
      detail: `Synthesized a bibliography entry for ${input.row.paper_id} from stored title/author/year metadata.`,
      matched_paper_id: input.row.paper_id,
      bibtex_richness: scoreBibtexRichness(generatedBibtex)
    });
    if (!hasLocator) {
      input.notes.push("The source row can be cited via generated metadata, but it still lacks DOI/arXiv/URL metadata.");
    }
    return {
      citation_paper_id: input.citationPaperId,
      resolved_paper_id: input.row.paper_id,
      title,
      status: classifyStoredRegistryStatus({
        repaired: true,
        titlePresent: true,
        hasLocator
      }),
      repaired: true,
      bibtex_mode: "generated",
      doi,
      arxiv_id: arxivId,
      url,
      resolved_via: "stored_corpus",
      notes: input.notes,
      attempts: input.attempts
    };
  }

  input.attempts.push({
    attempt_index: input.attempts.length + 1,
    action: "repair_with_generated_bibtex",
    outcome: "rejected",
    detail: `Could not synthesize a bibliography entry for ${input.row.paper_id} from the stored metadata.`,
    matched_paper_id: input.row.paper_id
  });
  input.notes.push("The source row lacks enough metadata to synthesize a stable citation record.");
  return {
    citation_paper_id: input.citationPaperId,
    resolved_paper_id: input.row.paper_id,
    title: title || undefined,
    status: "blocked",
    repaired: input.repaired,
    doi,
    arxiv_id: arxivId,
    url,
    resolved_via: "stored_corpus",
    notes: input.notes,
    attempts: input.attempts
  };
}

async function resolveCitationExternally(input: {
  entry: VerifiedRegistryEntry;
  providers: VerifiedRegistryExternalProviderDeps;
  abortSignal?: AbortSignal;
}): Promise<{ entry: VerifiedRegistryEntry; row?: StoredCorpusRow } | undefined> {
  const lookupPlans = buildExternalLookupPlans(input.entry.citation_paper_id, input.providers);
  if (lookupPlans.length === 0) {
    return undefined;
  }

  const notes = [...input.entry.notes];
  const attempts = input.entry.attempts.map((attempt) => ({ ...attempt }));

  for (const plan of lookupPlans) {
    const candidates = await queryExternalProvider(plan, input.providers, input.abortSignal);
    const matched = candidates.find(plan.matcher);
    if (!matched) {
      attempts.push({
        attempt_index: attempts.length + 1,
        action: plan.action,
        outcome: "rejected",
        detail: `No ${plan.provider} candidate matched citation reference ${input.entry.citation_paper_id} for query "${plan.query}".`,
        matched_provider: plan.provider
      });
      continue;
    }

    const row = convertExternalCandidateToStoredRow(matched);
    const storedBibtex = normalizeS2Bibtex(row.bibtex) || normalizeS2Bibtex(row.semantic_scholar_bibtex);
    const bibtexMode = storedBibtex ? "stored" : "generated";
    const bibtexRichness = storedBibtex
      ? scoreBibtexRichness(storedBibtex)
      : scoreBibtexRichness(row.bibtex || "");
    const status = classifyExternalRegistryStatus({
      titlePresent: row.title.trim().length > 0,
      hasLocator: Boolean(row.doi || row.arxiv_id || row.url || row.landing_url || row.pdf_url),
      exactIdentifierMatch: plan.exact_identifier_match
    });
    notes.push(`Resolved ${input.entry.citation_paper_id} through bounded external ${plan.provider} lookup.`);
    if (status === "unverified") {
      notes.push("The citation was recovered externally by metadata/title matching, so it remains below fully verified status.");
    }
    if (status === "inferred") {
      notes.push("The external citation match lacks a stable DOI/arXiv/URL locator, so it remains inferential.");
    }
    attempts.push({
      attempt_index: attempts.length + 1,
      action: plan.action,
      outcome: plan.exact_identifier_match ? "accepted" : "repaired",
      detail: `Accepted ${plan.provider} candidate ${row.paper_id} for citation reference ${input.entry.citation_paper_id}.`,
      matched_paper_id: row.paper_id,
      matched_provider: plan.provider,
      bibtex_richness: bibtexRichness
    });
    return {
      entry: {
        citation_paper_id: input.entry.citation_paper_id,
        resolved_paper_id: row.paper_id,
        title: row.title,
        status,
        repaired: true,
        bibtex_mode: bibtexMode,
        doi: normalizeDoiForLookup(row.doi),
        arxiv_id: normalizeArxivIdForLookup(row.arxiv_id),
        url: row.url?.trim() || row.landing_url?.trim() || row.pdf_url?.trim() || undefined,
        resolved_via: "external_provider",
        provider: plan.provider,
        notes,
        attempts
      },
      row
    };
  }

  notes.push("Bounded external source diagnosis exhausted two repair attempts without a stable match.");
  return {
    entry: {
      ...input.entry,
      notes,
      attempts
    }
  };
}

function buildExternalLookupPlans(
  citationPaperId: string,
  providers: VerifiedRegistryExternalProviderDeps
): ExternalLookupPlan[] {
  const doi = normalizeDoiForLookup(citationPaperId);
  if (doi) {
    return limitToAvailableProviders(
      [
        {
          action: "lookup_external_by_doi",
          provider: "crossref",
          query: doi,
          limit: 5,
          matcher: (candidate) => normalizeDoiForLookup(candidate.doi) === doi,
          exact_identifier_match: true
        },
        {
          action: "lookup_external_by_doi",
          provider: "semantic_scholar",
          query: doi,
          limit: 5,
          matcher: (candidate) => normalizeDoiForLookup(candidate.doi) === doi,
          exact_identifier_match: true
        }
      ],
      providers
    );
  }

  const arxivId = normalizeArxivIdForLookup(citationPaperId);
  if (arxivId) {
    return limitToAvailableProviders(
      [
        {
          action: "lookup_external_by_arxiv",
          provider: "arxiv",
          query: arxivId,
          limit: 5,
          matcher: (candidate) => normalizeArxivIdForLookup(candidate.arxivId) === arxivId,
          exact_identifier_match: true
        },
        {
          action: "lookup_external_by_arxiv",
          provider: "semantic_scholar",
          query: arxivId,
          limit: 5,
          matcher: (candidate) => normalizeArxivIdForLookup(candidate.arxivId) === arxivId,
          exact_identifier_match: true
        }
      ],
      providers
    );
  }

  const normalizedTitle = normalizeTitleForLookup(citationPaperId);
  if (!normalizedTitle || looksLikeOpaqueCitationId(citationPaperId)) {
    return [];
  }
  return limitToAvailableProviders(
    [
      {
        action: "lookup_external_by_title",
        provider: "semantic_scholar",
        query: citationPaperId,
        limit: 5,
        matcher: (candidate) => normalizeTitleForLookup(candidate.title) === normalizedTitle,
        exact_identifier_match: false
      },
      {
        action: "lookup_external_by_title",
        provider: "openalex",
        query: citationPaperId,
        limit: 5,
        matcher: (candidate) => normalizeTitleForLookup(candidate.title) === normalizedTitle,
        exact_identifier_match: false
      },
      {
        action: "lookup_external_by_title",
        provider: "crossref",
        query: citationPaperId,
        limit: 5,
        matcher: (candidate) => normalizeTitleForLookup(candidate.title) === normalizedTitle,
        exact_identifier_match: false
      },
      {
        action: "lookup_external_by_title",
        provider: "arxiv",
        query: citationPaperId,
        limit: 5,
        matcher: (candidate) => normalizeTitleForLookup(candidate.title) === normalizedTitle,
        exact_identifier_match: false
      }
    ],
    providers
  );
}

async function queryExternalProvider(
  plan: ExternalLookupPlan,
  providers: VerifiedRegistryExternalProviderDeps,
  abortSignal?: AbortSignal
): Promise<NormalizedExternalCandidate[]> {
  const request: SemanticScholarSearchRequest = {
    query: plan.query,
    limit: plan.limit,
    sort: { field: "relevance" }
  };
  switch (plan.provider) {
    case "semantic_scholar": {
      const rows = await providers.semanticScholar?.searchPapers(request, abortSignal);
      return (rows || []).map(normalizeSemanticScholarCandidate);
    }
    case "openalex": {
      const rows = await providers.openAlex?.searchPapers(request, abortSignal);
      return (rows || []).map(normalizePaperSearchCandidate);
    }
    case "crossref": {
      const rows = await providers.crossref?.searchPapers(request, abortSignal);
      return (rows || []).map(normalizePaperSearchCandidate);
    }
    case "arxiv": {
      const rows = await providers.arxiv?.searchPapers(request, abortSignal);
      return (rows || []).map(normalizePaperSearchCandidate);
    }
  }
}

function normalizeSemanticScholarCandidate(candidate: SemanticScholarPaper): NormalizedExternalCandidate {
  return {
    provider: "semantic_scholar",
    paperId: candidate.paperId,
    providerId: candidate.paperId,
    title: candidate.title,
    abstract: candidate.abstract,
    year: candidate.year,
    venue: candidate.venue,
    url: candidate.url,
    landingUrl: candidate.url,
    openAccessPdfUrl: candidate.openAccessPdfUrl,
    authors: candidate.authors,
    doi: normalizeDoiForLookup(candidate.doi),
    arxivId: normalizeArxivIdForLookup(candidate.arxivId),
    citationStylesBibtex: normalizeS2Bibtex(candidate.citationStylesBibtex)
  };
}

function normalizePaperSearchCandidate(candidate: PaperSearchCandidate): NormalizedExternalCandidate {
  return {
    provider: candidate.provider,
    paperId: candidate.paperId,
    providerId: candidate.providerId,
    title: candidate.title,
    abstract: candidate.abstract,
    year: candidate.year,
    venue: candidate.venue,
    url: candidate.url,
    landingUrl: candidate.landingUrl,
    openAccessPdfUrl: candidate.openAccessPdfUrl,
    authors: candidate.authors,
    doi: normalizeDoiForLookup(candidate.doi),
    arxivId: normalizeArxivIdForLookup(candidate.arxivId)
  };
}

function convertExternalCandidateToStoredRow(candidate: NormalizedExternalCandidate): StoredCorpusRow {
  const paperId = buildExternalPaperId(candidate);
  const storedBibtex = candidate.citationStylesBibtex;
  const generatedBibtex = storedBibtex
    ? undefined
    : buildGeneratedBibtexEntry({
        paperId,
        title: candidate.title,
        authors: candidate.authors,
        year: candidate.year,
        venue: candidate.venue,
        doi: candidate.doi,
        url: candidate.landingUrl || candidate.url,
        arxivId: candidate.arxivId
      });
  return {
    paper_id: paperId,
    title: candidate.title.trim(),
    abstract: candidate.abstract?.trim() || "",
    year: candidate.year,
    venue: candidate.venue?.trim(),
    url: candidate.url?.trim(),
    landing_url: candidate.landingUrl?.trim(),
    pdf_url: candidate.openAccessPdfUrl?.trim(),
    authors: candidate.authors.map((author) => author.trim()).filter(Boolean),
    doi: candidate.doi,
    arxiv_id: candidate.arxivId,
    semantic_scholar_bibtex: candidate.provider === "semantic_scholar" ? storedBibtex : undefined,
    bibtex: candidate.provider === "semantic_scholar" ? undefined : generatedBibtex,
    bibtex_source: resolveExternalBibtexSource(candidate.provider, Boolean(storedBibtex)),
    bibtex_richness: scoreBibtexRichness(storedBibtex || generatedBibtex || "")
  };
}

function buildExternalPaperId(candidate: NormalizedExternalCandidate): string {
  const rawId =
    candidate.paperId
    || candidate.providerId
    || candidate.doi
    || candidate.arxivId
    || candidate.title;
  const normalized = rawId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized) {
    return `external_${candidate.provider}_${normalized}`;
  }
  return `external_${candidate.provider}_${createHash("sha1").update(candidate.title).digest("hex").slice(0, 12)}`;
}

function resolveExternalBibtexSource(
  provider: PaperSearchProvider,
  hasStoredBibtex: boolean
): StoredBibtexSource {
  if (hasStoredBibtex && provider === "semantic_scholar") {
    return "semantic_scholar";
  }
  switch (provider) {
    case "crossref":
      return "crossref_generated";
    case "arxiv":
      return "arxiv_generated";
    default:
      return "local_generated";
  }
}

function classifyStoredRegistryStatus(input: {
  repaired: boolean;
  titlePresent: boolean;
  hasLocator: boolean;
}): VerifiedRegistryStatus {
  if (!input.titlePresent) {
    return "blocked";
  }
  if (input.repaired) {
    return input.hasLocator ? "unverified" : "inferred";
  }
  return input.hasLocator ? "verified" : "inferred";
}

function classifyExternalRegistryStatus(input: {
  titlePresent: boolean;
  hasLocator: boolean;
  exactIdentifierMatch: boolean;
}): VerifiedRegistryStatus {
  if (!input.titlePresent) {
    return "blocked";
  }
  if (input.exactIdentifierMatch && input.hasLocator) {
    return "verified";
  }
  return input.hasLocator ? "unverified" : "inferred";
}

function finalizeVerifiedRegistry(entries: VerifiedRegistryEntry[]): VerifiedRegistryArtifact {
  const counts = {
    verified: entries.filter((entry) => entry.status === "verified").length,
    unverified: entries.filter((entry) => entry.status === "unverified").length,
    blocked: entries.filter((entry) => entry.status === "blocked").length,
    inferred: entries.filter((entry) => entry.status === "inferred").length
  } satisfies Record<VerifiedRegistryStatus, number>;

  return {
    generated_at: new Date().toISOString(),
    counts,
    entries,
    blocked_citation_paper_ids: entries
      .filter((entry) => entry.status === "blocked")
      .map((entry) => entry.citation_paper_id),
    summary_lines:
      entries.length === 0
        ? ["VerifiedRegistry found no cited paper ids to diagnose."]
        : [
            `VerifiedRegistry citation statuses: verified=${counts.verified}, inferred=${counts.inferred}, unverified=${counts.unverified}, blocked=${counts.blocked}.`,
            ...entries
              .filter((entry) => entry.status === "blocked" || entry.status === "unverified")
              .slice(0, 3)
              .map((entry) => {
                const detail = entry.attempts[entry.attempts.length - 1]?.detail || "citation diagnosis incomplete";
                return `${entry.citation_paper_id}: ${detail}`;
              })
          ]
  };
}

function limitToAvailableProviders(
  plans: ExternalLookupPlan[],
  providers: VerifiedRegistryExternalProviderDeps
): ExternalLookupPlan[] {
  const available = plans.filter((plan) => hasProviderForPlan(plan.provider, providers));
  return available.slice(0, 2);
}

function hasProviderForPlan(
  provider: PaperSearchProvider,
  providers: VerifiedRegistryExternalProviderDeps
): boolean {
  switch (provider) {
    case "semantic_scholar":
      return typeof providers.semanticScholar?.searchPapers === "function";
    case "openalex":
      return typeof providers.openAlex?.searchPapers === "function";
    case "crossref":
      return typeof providers.crossref?.searchPapers === "function";
    case "arxiv":
      return typeof providers.arxiv?.searchPapers === "function";
  }
}

function hasAnyExternalProvider(providers: VerifiedRegistryExternalProviderDeps): boolean {
  return (
    typeof providers.semanticScholar?.searchPapers === "function"
    || typeof providers.openAlex?.searchPapers === "function"
    || typeof providers.crossref?.searchPapers === "function"
    || typeof providers.arxiv?.searchPapers === "function"
  );
}

function normalizeTitleForLookup(value: string | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/giu, " ")
    .trim();
}

function normalizeDoiForLookup(value: string | undefined): string | undefined {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLowerCase();
  if (!/^10\.\d{4,9}\/\S+$/i.test(normalized)) {
    return undefined;
  }
  return normalized || undefined;
}

function normalizeArxivIdForLookup(value: string | undefined): string | undefined {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return undefined;
  }
  const withoutPrefix = trimmed
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/^arxiv:\s*/i, "")
    .replace(/\.pdf$/i, "");
  const normalized = withoutPrefix.replace(/v\d+$/i, "").trim().toLowerCase();
  const modernPattern = /^\d{4}\.\d{4,5}$/;
  const legacyPattern = /^[a-z-]+(?:\.[a-z-]+)?\/\d{7}$/;
  if (!modernPattern.test(normalized) && !legacyPattern.test(normalized)) {
    return undefined;
  }
  return normalized || undefined;
}

function looksLikeOpaqueCitationId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  if (/\s/.test(trimmed)) {
    return false;
  }
  return /^[a-z0-9_.:-]{1,80}$/i.test(trimmed);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function dedupeCorpusRowsById(rows: StoredCorpusRow[]): StoredCorpusRow[] {
  const byId = new Map<string, StoredCorpusRow>();
  for (const row of rows) {
    if (!byId.has(row.paper_id)) {
      byId.set(row.paper_id, row);
    }
  }
  return [...byId.values()];
}
