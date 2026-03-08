export type StoredBibtexSource =
  | "acl_anthology"
  | "doi_content_negotiation"
  | "crossref_generated"
  | "arxiv_generated"
  | "openreview_generated"
  | "pmlr_generated"
  | "semantic_scholar"
  | "local_generated";

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
