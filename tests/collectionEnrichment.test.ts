import { afterEach, describe, expect, it, vi } from "vitest";

import { enrichCollectedPaper } from "../src/core/collection/enrichment.js";
import { StoredCorpusRow } from "../src/core/collection/types.js";
import { SemanticScholarPaper } from "../src/tools/semanticScholar.js";

function makePaper(overrides: Partial<SemanticScholarPaper> = {}): SemanticScholarPaper {
  return {
    paperId: "paper-1",
    title: "Sample Paper",
    abstract: "Abstract",
    authors: ["Alice Kim", "Bob Lee"],
    ...overrides
  };
}

function makeRow(overrides: Partial<StoredCorpusRow> = {}): StoredCorpusRow {
  return {
    paper_id: "paper-1",
    title: "Sample Paper",
    abstract: "Abstract",
    authors: ["Alice Kim", "Bob Lee"],
    ...overrides
  };
}

function makeResponse(url: string, body: string, init?: ResponseInit): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", {
    value: url,
    configurable: true
  });
  return response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collection enrichment", () => {
  it("recovers arxiv pdf and generated bibtex", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://arxiv.org/pdf/2501.01234.pdf") {
          return makeResponse(url, "", {
            status: 200,
            headers: {
              "content-type": "application/pdf"
            }
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await enrichCollectedPaper({
      paper: makePaper({ arxivId: "2501.01234", year: 2025, venue: "arXiv" }),
      row: makeRow({ arxiv_id: "2501.01234" }),
      bibtexMode: "hybrid",
      requireOpenAccessPdf: false
    });

    expect(result.row.pdf_url).toBe("https://arxiv.org/pdf/2501.01234.pdf");
    expect(result.row.pdf_url_source).toBe("arxiv");
    expect(result.row.bibtex_source).toBe("arxiv_generated");
    expect(result.row.bibtex).toContain("archivePrefix = {arXiv}");
  });

  it("recovers acl anthology pdf and bibtex from canonical landing url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://aclanthology.org/2024.acl-long.1.pdf") {
          return makeResponse(url, "", {
            status: 200,
            headers: {
              "content-type": "application/pdf"
            }
          });
        }
        if (url === "https://aclanthology.org/2024.acl-long.1.bib") {
          return makeResponse(
            url,
            "@inproceedings{acltest,\n  title = {ACL Paper},\n  author = {Alice Kim},\n  booktitle = {ACL}\n}",
            { status: 200, headers: { "content-type": "application/x-bibtex" } }
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await enrichCollectedPaper({
      paper: makePaper({ doi: "10.18653/v1/2024.acl-long.1" }),
      row: makeRow({ doi: "10.18653/v1/2024.acl-long.1", landing_url: "https://aclanthology.org/2024.acl-long.1/" }),
      bibtexMode: "hybrid",
      requireOpenAccessPdf: false
    });

    expect(result.row.pdf_url).toBe("https://aclanthology.org/2024.acl-long.1.pdf");
    expect(result.row.bibtex_source).toBe("acl_anthology");
    expect(result.row.bibtex).toContain("@inproceedings{acltest");
  });

  it("recovers openreview pdf from forum id and generates bibtex", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://openreview.net/pdf?id=abc123") {
          return makeResponse(url, "", {
            status: 200,
            headers: {
              "content-type": "application/pdf"
            }
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await enrichCollectedPaper({
      paper: makePaper({ venue: "ICLR" }),
      row: makeRow({ landing_url: "https://openreview.net/forum?id=abc123" }),
      bibtexMode: "hybrid",
      requireOpenAccessPdf: false
    });

    expect(result.row.pdf_url).toBe("https://openreview.net/pdf?id=abc123");
    expect(result.row.bibtex_source).toBe("openreview_generated");
  });

  it("recovers pmlr pdf from canonical html page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://proceedings.mlr.press/v235/foo24.pdf") {
          return makeResponse(url, "", {
            status: 200,
            headers: {
              "content-type": "application/pdf"
            }
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await enrichCollectedPaper({
      paper: makePaper({ venue: "PMLR" }),
      row: makeRow({ landing_url: "https://proceedings.mlr.press/v235/foo24.html" }),
      bibtexMode: "hybrid",
      requireOpenAccessPdf: false
    });

    expect(result.row.pdf_url).toBe("https://proceedings.mlr.press/v235/foo24.pdf");
    expect(result.row.bibtex_source).toBe("pmlr_generated");
  });

  it("uses crossref links and doi content negotiation when doi metadata is available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://api.crossref.org/works/10.1000%2Fxyz") {
          return makeResponse(
            url,
            JSON.stringify({
              message: {
                URL: "https://publisher.example/paper",
                title: ["Crossref Paper"],
                "container-title": ["Test Journal"],
                author: [{ given: "Alice", family: "Kim" }],
                issued: { "date-parts": [[2024]] },
                link: [{ URL: "https://publisher.example/paper.pdf", "content-type": "application/pdf" }]
              }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url === "https://doi.org/10.1000%2Fxyz" && init?.headers && String((init.headers as Record<string, string>).Accept).includes("application/x-bibtex")) {
          return makeResponse(
            "https://doi.org/10.1000/xyz",
            "@article{crossrefdoi,\n  title = {Crossref DOI Paper},\n  doi = {10.1000/xyz}\n}",
            { status: 200, headers: { "content-type": "application/x-bibtex" } }
          );
        }
        if (url === "https://doi.org/10.1000%2Fxyz") {
          return makeResponse("https://publisher.example/paper", "", { status: 200, headers: { "content-type": "text/html" } });
        }
        if (url === "https://publisher.example/paper.pdf") {
          return makeResponse(url, "", { status: 200, headers: { "content-type": "application/pdf" } });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await enrichCollectedPaper({
      paper: makePaper({ doi: "10.1000/xyz" }),
      row: makeRow({ doi: "10.1000/xyz" }),
      bibtexMode: "hybrid",
      requireOpenAccessPdf: false
    });

    expect(result.row.pdf_url).toBe("https://publisher.example/paper.pdf");
    expect(result.row.bibtex_source).toBe("doi_content_negotiation");
    expect(result.row.bibtex).toContain("@article{crossrefdoi");
  });

  it("rejects landing pages that do not resolve to a direct pdf for open access collection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://example.org/paper") {
          return makeResponse(
            url,
            '<html><head><meta name="citation_pdf_url" content="https://example.org/download"></head></html>',
            { status: 200, headers: { "content-type": "text/html" } }
          );
        }
        if (url === "https://example.org/download") {
          return makeResponse(url, "<html>not a pdf</html>", {
            status: 200,
            headers: { "content-type": "text/html" }
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await enrichCollectedPaper({
      paper: makePaper(),
      row: makeRow({ landing_url: "https://example.org/paper" }),
      bibtexMode: "generated",
      requireOpenAccessPdf: true
    });

    expect(result.row.pdf_url).toBeUndefined();
  });
});
