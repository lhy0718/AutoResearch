export type StoredBibtexSource =
  | "acl_anthology"
  | "doi_content_negotiation"
  | "crossref_generated"
  | "arxiv_generated"
  | "openreview_generated"
  | "pmlr_generated"
  | "semantic_scholar"
  | "local_generated";

export type PaperSearchProvider =
  | "semantic_scholar"
  | "openalex"
  | "crossref"
  | "arxiv";

export interface PaperSearchCandidate {
  provider: PaperSearchProvider;
  providerId?: string;
  paperId?: string;
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
  citationCount?: number;
  influentialCitationCount?: number;
  publicationDate?: string;
  publicationTypes?: string[];
  fieldsOfStudy?: string[];
  citationStylesBibtex?: string;
  relevanceScore?: number;
}

export interface PaperSearchProviderAttempt {
  provider: PaperSearchProvider;
  attempt: number;
  ok: boolean;
  status?: number;
  retryAfterMs?: number;
  endpoint: string;
  errorMessage?: string;
}

export interface PaperSearchQueryTransformation {
  original: string;
  transformed: string;
  strategy: string;
  variants?: string[];
}

export interface PaperSearchFilterApplication {
  filter: string;
  value?: string | number | boolean | string[];
  supported: boolean;
  appliedAt: "query" | "post_fetch" | "none";
  nativeParameter?: string;
}

export interface PaperSearchProviderDiagnostics {
  provider: PaperSearchProvider;
  query: string;
  fetched: number;
  attemptCount: number;
  lastStatus?: number;
  retryAfterMs?: number;
  attempts: PaperSearchProviderAttempt[];
  error?: string;
  originalQuery?: string;
  queryTransformation?: PaperSearchQueryTransformation;
  filterApplications?: PaperSearchFilterApplication[];
  providerLimit?: number;
}

export interface PaperSearchCandidateProvenance {
  provider: PaperSearchProvider;
  providerId?: string;
  paperId?: string;
  title: string;
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  landingUrl?: string;
  openAccessPdfUrl?: string;
}

export interface AggregatedSearchPaper {
  paperId: string;
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
  citationCount?: number;
  influentialCitationCount?: number;
  publicationDate?: string;
  publicationTypes?: string[];
  fieldsOfStudy?: string[];
  citationStylesBibtex?: string;
  canonicalSource: PaperSearchProvider;
  searchProviders: PaperSearchProvider[];
  provenance: PaperSearchCandidateProvenance[];
}

export interface PaperSearchClusterSummary {
  paperId: string;
  title: string;
  canonicalSource: PaperSearchProvider;
  candidateCount: number;
  providers: PaperSearchProvider[];
  doi?: string;
  arxivId?: string;
  selectionReasons: string[];
}

export interface PaperSearchAggregationReport {
  source: "semantic_scholar" | "aggregated";
  rawCandidateCount: number;
  canonicalCount: number;
  providers: PaperSearchProvider[];
  providerDiagnostics: PaperSearchProviderDiagnostics[];
  clusters: PaperSearchClusterSummary[];
}

export interface StoredCorpusRow {
  paper_id: string;
  title: string;
  abstract: string;
  year?: number;
  venue?: string;
  url?: string;
  landing_url?: string;
  pdf_url?: string;
  pdf_url_source?: string;
  authors: string[];
  citation_count?: number;
  influential_citation_count?: number;
  publication_date?: string;
  publication_types?: string[];
  fields_of_study?: string[];
  doi?: string;
  arxiv_id?: string;
  semantic_scholar_bibtex?: string;
  bibtex?: string;
  bibtex_source?: StoredBibtexSource;
  bibtex_richness?: number;
}

export interface CollectEnrichmentAttempt {
  stage: string;
  candidate?: string;
  ok: boolean;
  detail?: string;
}

export interface CollectEnrichmentLogEntry {
  paper_id: string;
  pdf_resolution?: {
    source?: string;
    url?: string;
  };
  bibtex_resolution?: {
    source?: StoredBibtexSource;
    richness?: number;
  };
  attempts: CollectEnrichmentAttempt[];
  errors: string[];
}
