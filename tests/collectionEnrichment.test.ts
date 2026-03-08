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

  it("recovers pmlr pdf from page metadata when canonical stem pdf returns 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://proceedings.mlr.press/v235/yao24d.pdf") {
          return makeResponse(url, "not found", {
            status: 404,
            headers: {
              "content-type": "text/html; charset=utf-8"
            }
          });
        }
        if (url === "https://proceedings.mlr.press/v235/yao24d.html") {
          return makeResponse(
            url,
            '<html><head><meta name="citation_pdf_url" content="https://raw.githubusercontent.com/mlresearch/v235/main/assets/yao24d/yao24d.pdf"><meta name="citation_abstract_html_url" content="https://proceedings.mlr.press/v235/yao24d.html"></head></html>',
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
          );
        }
        if (url === "https://raw.githubusercontent.com/mlresearch/v235/main/assets/yao24d/yao24d.pdf") {
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
      paper: makePaper({
        title: "Socialized Learning: Making Each Other Better Through Multi-Agent Collaboration",
        venue: "International Conference on Machine Learning"
      }),
      row: makeRow({
        title: "Socialized Learning: Making Each Other Better Through Multi-Agent Collaboration",
        venue: "International Conference on Machine Learning",
        landing_url: "https://proceedings.mlr.press/v235/yao24d.html"
      }),
      bibtexMode: "hybrid",
      requireOpenAccessPdf: false
    });

    expect(result.row.pdf_url).toBe(
      "https://raw.githubusercontent.com/mlresearch/v235/main/assets/yao24d/yao24d.pdf"
    );
    expect(result.row.pdf_url_source).toBe("pmlr");
    expect(result.row.landing_url).toBe("https://proceedings.mlr.press/v235/yao24d.html");
    expect(result.row.bibtex_source).toBe("pmlr_generated");
  });

  it("discovers acl anthology landing via dblp title search when only a Semantic Scholar URL is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("dblp.org/search/publ/api")) {
          return makeResponse(
            url,
            JSON.stringify({
              result: {
                hits: {
                  hit: [
                    {
                      info: {
                        title: "Explain-Analyze-Generate: A Sequential Multi-Agent Collaboration Method for Complex Reasoning",
                        venue: "COLING",
                        doi: "10.18653/v1/2025.coling-main.475",
                        ee: "https://aclanthology.org/2025.coling-main.475/"
                      }
                    }
                  ]
                }
              }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url === "https://doi.org/10.18653%2Fv1%2F2025.coling-main.475") {
          return makeResponse(url, "", { status: 404, headers: { "content-type": "text/html" } });
        }
        if (url === "https://aclanthology.org/2025.coling-main.475.pdf") {
          return makeResponse(url, "", {
            status: 200,
            headers: { "content-type": "application/pdf" }
          });
        }
        if (url === "https://aclanthology.org/2025.coling-main.475.bib") {
          return makeResponse(
            url,
            "@inproceedings{coling475,\n  title = {Explain-Analyze-Generate},\n  author = {Alice Kim},\n  booktitle = {COLING}\n}",
            { status: 200, headers: { "content-type": "application/x-bibtex" } }
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await enrichCollectedPaper({
      paper: makePaper({
        paperId: "acl-title-only",
        title: "Explain-Analyze-Generate: A Sequential Multi-Agent Collaboration Method for Complex Reasoning",
        venue: "International Conference on Computational Linguistics"
      }),
      row: makeRow({
        paper_id: "acl-title-only",
        title: "Explain-Analyze-Generate: A Sequential Multi-Agent Collaboration Method for Complex Reasoning",
        venue: "International Conference on Computational Linguistics",
        url: "https://www.semanticscholar.org/paper/acl-title-only"
      }),
      bibtexMode: "hybrid",
      requireOpenAccessPdf: false
    });

    expect(result.row.pdf_url).toBe("https://aclanthology.org/2025.coling-main.475.pdf");
    expect(result.row.pdf_url_source).toBe("acl_anthology");
    expect(result.row.doi).toBe("10.18653/v1/2025.coling-main.475");
    expect(result.fallbackSources).toContain("title_discovery");
  });

  it("retries transient dblp 500 errors before recovering acl anthology metadata", async () => {
    let dblpCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("dblp.org/search/publ/api")) {
          dblpCalls += 1;
          if (dblpCalls < 3) {
            return makeResponse(url, "<html>server error</html>", {
              status: 500,
              headers: { "content-type": "text/html; charset=utf-8" }
            });
          }
          return makeResponse(
            url,
            JSON.stringify({
              result: {
                hits: {
                  hit: [
                    {
                      info: {
                        title: "Explain-Analyze-Generate: A Sequential Multi-Agent Collaboration Method for Complex Reasoning",
                        venue: "COLING",
                        doi: "10.18653/v1/2025.coling-main.475",
                        ee: "https://aclanthology.org/2025.coling-main.475/"
                      }
                    }
                  ]
                }
              }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url === "https://doi.org/10.18653%2Fv1%2F2025.coling-main.475") {
          return makeResponse(url, "", { status: 404, headers: { "content-type": "text/html" } });
        }
        if (url === "https://aclanthology.org/2025.coling-main.475.pdf") {
          return makeResponse(url, "", {
            status: 200,
            headers: { "content-type": "application/pdf" }
          });
        }
        if (url === "https://aclanthology.org/2025.coling-main.475.bib") {
          return makeResponse(
            url,
            "@inproceedings{coling475,\n  title = {Explain-Analyze-Generate},\n  author = {Alice Kim},\n  booktitle = {COLING}\n}",
            { status: 200, headers: { "content-type": "application/x-bibtex" } }
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await enrichCollectedPaper({
      paper: makePaper({
        paperId: "acl-title-retry",
        title: "Explain-Analyze-Generate: A Sequential Multi-Agent Collaboration Method for Complex Reasoning",
        venue: "International Conference on Computational Linguistics"
      }),
      row: makeRow({
        paper_id: "acl-title-retry",
        title: "Explain-Analyze-Generate: A Sequential Multi-Agent Collaboration Method for Complex Reasoning",
        venue: "International Conference on Computational Linguistics",
        url: "https://www.semanticscholar.org/paper/acl-title-retry"
      }),
      bibtexMode: "hybrid",
      requireOpenAccessPdf: false
    });

    expect(dblpCalls).toBe(3);
    expect(result.row.pdf_url).toBe("https://aclanthology.org/2025.coling-main.475.pdf");
    expect(result.row.pdf_url_source).toBe("acl_anthology");
    expect(result.row.bibtex_source).toBe("acl_anthology");
  });

  it("discovers openreview forum via title search when only a Semantic Scholar URL is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("api2.openreview.net/notes/search")) {
          return makeResponse(
            url,
            JSON.stringify({
              notes: [
                {
                  id: "note-1",
                  forum: "rFpZnn11gj",
                  content: {
                    title: {
                      value: "PathGen-1.6M: 1.6 Million Pathology Image-text Pairs Generation through Multi-agent Collaboration"
                    }
                  }
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url === "https://openreview.net/pdf?id=rFpZnn11gj") {
          return makeResponse(url, "", {
            status: 200,
            headers: { "content-type": "application/pdf" }
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await enrichCollectedPaper({
      paper: makePaper({
        paperId: "openreview-title-only",
        title: "PathGen-1.6M: 1.6 Million Pathology Image-text Pairs Generation through Multi-agent Collaboration",
        venue: "International Conference on Learning Representations"
      }),
      row: makeRow({
        paper_id: "openreview-title-only",
        title: "PathGen-1.6M: 1.6 Million Pathology Image-text Pairs Generation through Multi-agent Collaboration",
        venue: "International Conference on Learning Representations",
        url: "https://www.semanticscholar.org/paper/openreview-title-only"
      }),
      bibtexMode: "hybrid",
      requireOpenAccessPdf: false
    });

    expect(result.row.pdf_url).toBe("https://openreview.net/pdf?id=rFpZnn11gj");
    expect(result.row.pdf_url_source).toBe("openreview");
    expect(result.row.landing_url).toBe("https://openreview.net/forum?id=rFpZnn11gj");
    expect(result.fallbackSources).toContain("title_discovery");
  });

  it("discovers an ifaamas direct pdf via dblp title search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("dblp.org/search/publ/api")) {
          return makeResponse(
            url,
            JSON.stringify({
              result: {
                hits: {
                  hit: [
                    {
                      info: {
                        title: "Learning Heterogeneous Agent Collaboration in Decentralized Multi-Agent Systems via Intrinsic Motivation",
                        venue: "Adaptive Agents and Multi-Agent Systems",
                        ee: "https://ifaamas.org/Proceedings/aamas2025/pdfs/p2681.pdf"
                      }
                    }
                  ]
                }
              }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url === "https://ifaamas.org/Proceedings/aamas2025/pdfs/p2681.pdf") {
          return makeResponse(url, "", {
            status: 200,
            headers: { "content-type": "application/pdf" }
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await enrichCollectedPaper({
      paper: makePaper({
        paperId: "aamas-title-only",
        title: "Learning Heterogeneous Agent Collaboration in Decentralized Multi-Agent Systems via Intrinsic Motivation",
        venue: "Adaptive Agents and Multi-Agent Systems"
      }),
      row: makeRow({
        paper_id: "aamas-title-only",
        title: "Learning Heterogeneous Agent Collaboration in Decentralized Multi-Agent Systems via Intrinsic Motivation",
        venue: "Adaptive Agents and Multi-Agent Systems",
        url: "https://www.semanticscholar.org/paper/aamas-title-only"
      }),
      bibtexMode: "generated",
      requireOpenAccessPdf: false
    });

    expect(result.row.pdf_url).toBe("https://ifaamas.org/Proceedings/aamas2025/pdfs/p2681.pdf");
    expect(result.row.pdf_url_source).toBe("ifaamas");
    expect(result.fallbackSources).toContain("title_discovery");
  });

  it("discovers a pmlr paper via volume index and title match when only a Semantic Scholar URL is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://proceedings.mlr.press/") {
          return makeResponse(
            url,
            '<html><body><ul><li><a href="v235"><b>Volume 235</b></a> Proceedings of ICML 2024</li></ul></body></html>',
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
          );
        }
        if (url === "https://proceedings.mlr.press/v235") {
          return makeResponse(
            "https://proceedings.mlr.press/v235/",
            '<html><body><div class="paper"><p class="title">Socialized Learning: Making Each Other Better Through Multi-Agent Collaboration</p><p class="links">[<a href="https://proceedings.mlr.press/v235/yao24d.html">abs</a>]</p></div></body></html>',
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
          );
        }
        if (url === "https://proceedings.mlr.press/v235/yao24d.pdf") {
          return makeResponse(url, "not found", {
            status: 404,
            headers: {
              "content-type": "text/html; charset=utf-8"
            }
          });
        }
        if (url === "https://proceedings.mlr.press/v235/yao24d.html") {
          return makeResponse(
            url,
            '<html><head><meta name="citation_pdf_url" content="https://raw.githubusercontent.com/mlresearch/v235/main/assets/yao24d/yao24d.pdf"></head></html>',
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
          );
        }
        if (url === "https://raw.githubusercontent.com/mlresearch/v235/main/assets/yao24d/yao24d.pdf") {
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
      paper: makePaper({
        paperId: "pmlr-title-only",
        title: "Socialized Learning: Making Each Other Better Through Multi-Agent Collaboration",
        venue: "International Conference on Machine Learning",
        year: 2024
      }),
      row: makeRow({
        paper_id: "pmlr-title-only",
        title: "Socialized Learning: Making Each Other Better Through Multi-Agent Collaboration",
        venue: "International Conference on Machine Learning",
        year: 2024,
        url: "https://www.semanticscholar.org/paper/pmlr-title-only"
      }),
      bibtexMode: "hybrid",
      requireOpenAccessPdf: false
    });

    expect(result.row.pdf_url).toBe("https://raw.githubusercontent.com/mlresearch/v235/main/assets/yao24d/yao24d.pdf");
    expect(result.row.pdf_url_source).toBe("pmlr");
    expect(result.row.landing_url).toBe("https://proceedings.mlr.press/v235/yao24d.html");
    expect(result.fallbackSources).toContain("title_discovery");
  });

  it("synthesizes an ifaamas pdf url from year and first page when only a Semantic Scholar URL is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://www.ifaamas.org/Proceedings/aamas2025/pdfs/p2681.pdf") {
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
      paper: makePaper({
        paperId: "aamas-derived",
        title: "Learning Heterogeneous Agent Collaboration in Decentralized Multi-Agent Systems via Intrinsic Motivation",
        venue: "Adaptive Agents and Multi-Agent Systems",
        year: 2025
      }),
      row: makeRow({
        paper_id: "aamas-derived",
        title: "Learning Heterogeneous Agent Collaboration in Decentralized Multi-Agent Systems via Intrinsic Motivation",
        venue: "Adaptive Agents and Multi-Agent Systems",
        year: 2025,
        url: "https://www.semanticscholar.org/paper/aamas-derived",
        semantic_scholar_bibtex:
          "@Article{Monon2025LearningHA,\n  booktitle = {Adaptive Agents and Multi-Agent Systems},\n  pages = {2681-2683},\n  title = {Learning Heterogeneous Agent Collaboration in Decentralized Multi-Agent Systems via Intrinsic Motivation},\n  year = {2025}\n}"
      }),
      bibtexMode: "generated",
      requireOpenAccessPdf: false
    });

    expect(result.row.pdf_url).toBe("https://www.ifaamas.org/Proceedings/aamas2025/pdfs/p2681.pdf");
    expect(result.row.pdf_url_source).toBe("ifaamas");
    expect(result.fallbackSources).toContain("title_discovery");
  });

  it("still runs title discovery when the only landing url is a Semantic Scholar page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("dblp.org/search/publ/api")) {
          return makeResponse(
            url,
            JSON.stringify({
              result: {
                hits: {
                  hit: [
                    {
                      info: {
                        title: "Explain-Analyze-Generate: A Sequential Multi-Agent Collaboration Method for Complex Reasoning",
                        venue: "COLING",
                        ee: "https://aclanthology.org/2025.coling-main.475/"
                      }
                    }
                  ]
                }
              }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url === "https://aclanthology.org/2025.coling-main.475.pdf") {
          return makeResponse(url, "", {
            status: 200,
            headers: { "content-type": "application/pdf" }
          });
        }
        if (url === "https://aclanthology.org/2025.coling-main.475.bib") {
          return makeResponse(
            url,
            "@inproceedings{coling475,\n  title = {Explain-Analyze-Generate},\n  author = {Alice Kim},\n  booktitle = {COLING}\n}",
            { status: 200, headers: { "content-type": "application/x-bibtex" } }
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await enrichCollectedPaper({
      paper: makePaper({
        paperId: "acl-s2-landing-only",
        title: "Explain-Analyze-Generate: A Sequential Multi-Agent Collaboration Method for Complex Reasoning",
        venue: "International Conference on Computational Linguistics"
      }),
      row: makeRow({
        paper_id: "acl-s2-landing-only",
        title: "Explain-Analyze-Generate: A Sequential Multi-Agent Collaboration Method for Complex Reasoning",
        venue: "International Conference on Computational Linguistics",
        url: "https://www.semanticscholar.org/paper/acl-s2-landing-only",
        landing_url: "https://www.semanticscholar.org/paper/acl-s2-landing-only"
      }),
      bibtexMode: "hybrid",
      requireOpenAccessPdf: false
    });

    expect(result.row.pdf_url).toBe("https://aclanthology.org/2025.coling-main.475.pdf");
    expect(result.row.pdf_url_source).toBe("acl_anthology");
    expect(result.fallbackSources).toContain("title_discovery");
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

  it("recovers a direct pdf from openalex metadata when crossref and landing fallbacks do not provide one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://api.crossref.org/works/10.3390/app15063146") {
          return makeResponse(
            url,
            JSON.stringify({
              message: {
                URL: "https://doi.org/10.3390/app15063146",
                title: ["A Multi-Agent Deep Reinforcement Learning System for Governmental Interoperability"],
                "container-title": ["Applied Sciences"],
                author: [{ given: "Alice", family: "Kim" }],
                issued: { "date-parts": [[2025]] },
                link: []
              }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url === "https://doi.org/10.3390/app15063146" && init?.headers && String((init.headers as Record<string, string>).Accept).includes("application/x-bibtex")) {
          return makeResponse(url, "", { status: 404, headers: { "content-type": "text/html" } });
        }
        if (url === "https://doi.org/10.3390/app15063146") {
          return makeResponse(url, "", { status: 403, headers: { "content-type": "text/html" } });
        }
        if (url === "https://api.openalex.org/works/https://doi.org/10.3390/app15063146") {
          return makeResponse(
            url,
            JSON.stringify({
              open_access: {
                is_oa: true,
                oa_url: "https://www.mdpi.com/2076-3417/15/6/3146/pdf?version=1741881642"
              },
              primary_location: {
                landing_page_url: "https://doi.org/10.3390/app15063146",
                pdf_url: "https://www.mdpi.com/2076-3417/15/6/3146/pdf?version=1741881642"
              }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url === "https://www.mdpi.com/2076-3417/15/6/3146/pdf?version=1741881642") {
          return makeResponse(url, "", {
            status: 200,
            headers: { "content-type": "application/pdf" }
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await enrichCollectedPaper({
      paper: makePaper({ doi: "10.3390/app15063146" }),
      row: makeRow({
        doi: "10.3390/app15063146",
        landing_url: "https://www.mdpi.com/2076-3417/15/6/3146",
        venue: "Applied Sciences"
      }),
      bibtexMode: "hybrid",
      requireOpenAccessPdf: false
    });

    expect(result.row.pdf_url).toBe("https://www.mdpi.com/2076-3417/15/6/3146/pdf?version=1741881642");
    expect(result.row.pdf_url_source).toBe("openalex");
  });

  it("does not accept doi.org as a direct openalex pdf candidate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === "https://api.crossref.org/works/10.1145/3674399.3674445") {
          return makeResponse(
            url,
            JSON.stringify({
              message: {
                URL: "https://doi.org/10.1145/3674399.3674445",
                title: ["BlockAgents"],
                "container-title": ["ACM Turing Celebration Conference"],
                author: [{ given: "Alice", family: "Kim" }],
                issued: { "date-parts": [[2024]] },
                link: []
              }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url === "https://doi.org/10.1145/3674399.3674445") {
          return makeResponse(url, "", { status: 403, headers: { "content-type": "text/html" } });
        }
        if (url === "https://api.openalex.org/works/https://doi.org/10.1145/3674399.3674445") {
          return makeResponse(
            url,
            JSON.stringify({
              open_access: {
                is_oa: true,
                oa_url: "https://doi.org/10.1145/3674399.3674445"
              },
              primary_location: {
                landing_page_url: "https://doi.org/10.1145/3674399.3674445",
                pdf_url: null
              }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await enrichCollectedPaper({
      paper: makePaper({ doi: "10.1145/3674399.3674445" }),
      row: makeRow({
        doi: "10.1145/3674399.3674445",
        landing_url: "https://doi.org/10.1145/3674399.3674445",
        venue: "ACM Turing Celebration Conference"
      }),
      bibtexMode: "generated",
      requireOpenAccessPdf: false
    });

    expect(result.row.pdf_url).toBeUndefined();
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
