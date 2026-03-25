import { describe, expect, it, vi } from "vitest";

import {
  runAggregatedPaperSearch,
  SearchProviderClient
} from "../src/core/collection/searchAggregation.js";

describe("searchAggregation", () => {
  it("merges cross-provider duplicates while preserving the semantic scholar paper id", async () => {
    const semanticScholar: SearchProviderClient = {
      provider: "semantic_scholar",
      searchPapers: vi.fn(async () => [
        {
          provider: "semantic_scholar",
          providerId: "paper-s2",
          paperId: "paper-s2",
          title: "Preprint Version",
          authors: ["Alice Kim"],
          year: 2023,
          venue: "arXiv",
          url: "https://www.semanticscholar.org/paper/paper-s2",
          doi: "10.1000/xyz",
          arxivId: "2501.01234"
        }
      ]),
      getLastSearchDiagnostics: vi.fn(() => ({
        provider: "semantic_scholar",
        query: "agent collaboration",
        fetched: 1,
        attemptCount: 1,
        attempts: [{ provider: "semantic_scholar", attempt: 1, ok: true, endpoint: "s2" }]
      }))
    };
    const crossref: SearchProviderClient = {
      provider: "crossref",
      searchPapers: vi.fn(async () => [
        {
          provider: "crossref",
          providerId: "10.1000/xyz",
          title: "Journal Version",
          authors: ["Alice Kim", "Bob Lee"],
          year: 2024,
          venue: "Test Journal",
          url: "https://publisher.example/paper",
          landingUrl: "https://publisher.example/paper",
          doi: "10.1000/xyz"
        }
      ]),
      getLastSearchDiagnostics: vi.fn(() => ({
        provider: "crossref",
        query: "agent collaboration",
        fetched: 1,
        attemptCount: 1,
        attempts: [{ provider: "crossref", attempt: 1, ok: true, endpoint: "crossref" }]
      }))
    };
    const arxiv: SearchProviderClient = {
      provider: "arxiv",
      searchPapers: vi.fn(async () => [
        {
          provider: "arxiv",
          providerId: "2501.01234",
          title: "Preprint Version",
          authors: ["Alice Kim"],
          year: 2023,
          venue: "arXiv",
          url: "https://arxiv.org/abs/2501.01234",
          landingUrl: "https://arxiv.org/abs/2501.01234",
          openAccessPdfUrl: "https://arxiv.org/pdf/2501.01234.pdf",
          arxivId: "2501.01234"
        }
      ]),
      getLastSearchDiagnostics: vi.fn(() => ({
        provider: "arxiv",
        query: "agent collaboration",
        fetched: 1,
        attemptCount: 1,
        attempts: [{ provider: "arxiv", attempt: 1, ok: true, endpoint: "arxiv" }]
      }))
    };

    const result = await runAggregatedPaperSearch({
      request: {
        query: "agent collaboration",
        limit: 10,
        sort: { field: "relevance", order: "desc" }
      },
      providers: [semanticScholar, crossref, arxiv]
    });

    expect(result.records).toHaveLength(1);
    expect(result.report.source).toBe("aggregated");
    expect(result.report.providers).toEqual(["semantic_scholar", "crossref", "arxiv"]);
    expect(result.report.rawCandidateCount).toBe(3);

    const record = result.records[0];
    expect(record.paper.paperId).toBe("paper-s2");
    expect(record.paper.canonicalSource).toBe("crossref");
    expect(record.paper.searchProviders).toEqual(["crossref", "semantic_scholar", "arxiv"]);
    expect(record.paper.title).toBe("Journal Version");
    expect(record.paper.venue).toBe("Test Journal");
    expect(record.row.url).toBe("https://publisher.example/paper");
    expect(record.row.landing_url).toBe("https://publisher.example/paper");
    expect(record.row.arxiv_id).toBe("2501.01234");
  });

  it("keeps semantic_scholar source when only one provider is configured", async () => {
    const semanticScholar: SearchProviderClient = {
      provider: "semantic_scholar",
      searchPapers: vi.fn(async () => [
        {
          provider: "semantic_scholar",
          providerId: "paper-1",
          paperId: "paper-1",
          title: "Single Provider Paper",
          authors: ["Alice Kim"]
        }
      ]),
      getLastSearchDiagnostics: vi.fn(() => ({
        provider: "semantic_scholar",
        query: "single provider",
        fetched: 1,
        attemptCount: 1,
        attempts: [{ provider: "semantic_scholar", attempt: 1, ok: true, endpoint: "s2" }]
      }))
    };

    const result = await runAggregatedPaperSearch({
      request: {
        query: "single provider",
        limit: 10,
        sort: { field: "relevance", order: "desc" }
      },
      providers: [semanticScholar]
    });

    expect(result.report.source).toBe("semantic_scholar");
    expect(result.records).toHaveLength(1);
    expect(result.records[0].paper.paperId).toBe("paper-1");
  });
});
