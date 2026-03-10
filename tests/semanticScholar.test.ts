import { afterEach, describe, expect, it, vi } from "vitest";

import { SemanticScholarClient } from "../src/tools/semanticScholar.js";

describe("SemanticScholarClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.AUTOLABOS_FAKE_SEMANTIC_SCHOLAR_RESPONSE;
  });

  it("uses /paper/search for relevance mode", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{ paperId: "p1", title: "Paper 1", authors: [] }]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SemanticScholarClient({ perSecondLimit: 1000 });
    await client.searchPapers({
      query: "agent",
      limit: 1,
      sort: { field: "relevance" },
      filters: {
        year: "2024",
        fieldsOfStudy: ["Computer Science"]
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/graph/v1/paper/search");
    expect(url.searchParams.get("query")).toBe("agent");
    expect(url.searchParams.get("year")).toBe("2024");
    expect(url.searchParams.get("fieldsOfStudy")).toBe("Computer Science");
  });

  it("uses /paper/search/bulk for sortable modes", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{ paperId: "p1", title: "Paper 1", authors: [] }]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SemanticScholarClient({ perSecondLimit: 1000 });
    await client.searchPapers({
      query: "agent",
      limit: 1,
      sort: { field: "citationCount", order: "desc" },
      filters: {
        openAccessPdf: true,
        minCitationCount: 100,
        publicationTypes: ["Review"]
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/graph/v1/paper/search/bulk");
    expect(url.searchParams.get("sort")).toBe("citationCount:desc");
    expect(url.searchParams.get("minCitationCount")).toBe("100");
    expect(url.searchParams.get("publicationTypes")).toBe("Review");
    expect(url.searchParams.has("openAccessPdf")).toBe(true);
  });

  it("normalizes rich fields including citationStyles bibtex", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            paperId: "p1",
            title: "Paper 1",
            authors: [{ name: "Alice" }],
            citationCount: 12,
            influentialCitationCount: 3,
            publicationDate: "2025-01-10",
            publicationTypes: ["Review"],
            fieldsOfStudy: ["Computer Science"],
            openAccessPdf: { url: "https://example.org/paper.pdf" },
            citationStyles: { bibtex: "@article{p1, title={Paper 1}}" },
            externalIds: { DOI: "10.1000/xyz" }
          }
        ]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SemanticScholarClient({ perSecondLimit: 1000 });
    const papers = await client.searchPapers({
      query: "agent",
      limit: 1,
      sort: { field: "relevance" }
    });

    expect(papers).toHaveLength(1);
    expect(papers[0]?.citationCount).toBe(12);
    expect(papers[0]?.influentialCitationCount).toBe(3);
    expect(papers[0]?.publicationDate).toBe("2025-01-10");
    expect(papers[0]?.publicationTypes).toEqual(["Review"]);
    expect(papers[0]?.fieldsOfStudy).toEqual(["Computer Science"]);
    expect(papers[0]?.openAccessPdfUrl).toBe("https://example.org/paper.pdf");
    expect(papers[0]?.citationStylesBibtex).toContain("@article{p1");
    expect(papers[0]?.doi).toBe("10.1000/xyz");
  });

  it("respects Retry-After when retrying 429 responses", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "2" })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ paperId: "p1", title: "Paper 1", authors: [] }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const client = new SemanticScholarClient({ perSecondLimit: 1000, maxRetries: 2 });
    const promise = client.searchPapers({
      query: "agent",
      limit: 1,
      sort: { field: "relevance" }
    });

    await vi.advanceTimersByTimeAsync(1900);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    const papers = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(papers).toHaveLength(1);
    expect(client.getLastSearchDiagnostics()).toMatchObject({
      attemptCount: 2,
      lastStatus: 200
    });
    expect(client.getLastSearchDiagnostics().attempts.map((attempt) => attempt.status)).toEqual([429, 200]);
  });

  it("uses conservative chunk sizes for large filtered relevance requests", async () => {
    vi.useFakeTimers();

    const makeRows = (count: number, start: number) =>
      Array.from({ length: count }, (_, index) => ({
        paperId: `p${start + index}`,
        title: `Paper ${start + index}`,
        authors: []
      }));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: makeRows(50, 0) })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: makeRows(50, 50) })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: makeRows(20, 100) })
      });
    vi.stubGlobal("fetch", fetchMock);

    const client = new SemanticScholarClient({ perSecondLimit: 1000, maxRetries: 2 });
    const promise = client.searchPapers({
      query: "agent",
      limit: 120,
      sort: { field: "relevance" },
      filters: { openAccessPdf: true }
    });

    await vi.advanceTimersByTimeAsync(7000);
    const papers = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map((call) => new URL(String(call[0])));
    expect(urls.map((url) => url.searchParams.get("limit"))).toEqual(["50", "50", "20"]);
    expect(urls.map((url) => url.searchParams.get("offset"))).toEqual(["0", "50", "100"]);
    expect(papers).toHaveLength(120);
  }, 10_000);

  it("enforces a minimum interval between sequential requests at 1 RPS", async () => {
    vi.useFakeTimers();

    const makeRows = (count: number, start: number) =>
      Array.from({ length: count }, (_, index) => ({
        paperId: `p${start + index}`,
        title: `Paper ${start + index}`,
        authors: []
      }));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: makeRows(100, 0) })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: makeRows(1, 100) })
      });
    vi.stubGlobal("fetch", fetchMock);

    const client = new SemanticScholarClient({
      apiKey: "test-key",
      perSecondLimit: 1,
      maxRetries: 2
    });
    const promise = client.searchPapers({
      query: "agent",
      limit: 101,
      sort: { field: "relevance" }
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    const papers = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(papers).toHaveLength(101);
  });

  it("uses fake Semantic Scholar data for streamSearchPapers without hitting fetch", async () => {
    process.env.AUTOLABOS_FAKE_SEMANTIC_SCHOLAR_RESPONSE = JSON.stringify([
      { paperId: "p1", title: "Paper 1", authors: [] },
      { paperId: "p2", title: "Paper 2", authors: [] }
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = new SemanticScholarClient({ perSecondLimit: 1 });
    const batches: Array<{ paperId: string }[]> = [];
    for await (const batch of client.streamSearchPapers({
      query: "agent",
      limit: 10,
      sort: { field: "relevance" }
    })) {
      batches.push(batch as Array<{ paperId: string }>);
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((paper) => paper.paperId)).toEqual(["p1", "p2"]);
  });
});
