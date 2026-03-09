import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, access, readFile, mkdir, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildBibtexEntry, buildBibtexFile, createCollectPapersNode } from "../src/core/nodes/collectPapers.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

class JsonLLMClient extends MockLLMClient {
  constructor(private readonly response: string) {
    super();
  }

  override async complete(): Promise<{ text: string }> {
    return { text: this.response };
  }
}

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

async function* batchStream<T>(...batches: T[][]): AsyncGenerator<T[], void, void> {
  for (const batch of batches) {
    yield batch;
  }
}

async function* failingBatchStream<T>(
  batches: T[][],
  error: Error
): AsyncGenerator<T[], void, void> {
  for (const batch of batches) {
    yield batch;
  }
  throw error;
}

describe("collectPapers bibtex", () => {
  it("builds bibtex entry with rich metadata", () => {
    const entry = buildBibtexEntry({
      paperId: "12345",
      title: "Agentic Workflows for Science",
      abstract: "x",
      year: 2025,
      venue: "NeurIPS",
      url: "https://example.org/paper",
      authors: ["Alice Kim", "Bob Lee"],
      doi: "10.1000/xyz-123",
      arxivId: "2501.01234"
    });

    expect(entry).toContain("@article{10_1000_xyz_123,");
    expect(entry).toContain("author = {Alice Kim and Bob Lee},");
    expect(entry).toContain("title = {Agentic Workflows for Science},");
    expect(entry).toContain("year = {2025},");
    expect(entry).toContain("journal = {NeurIPS},");
    expect(entry).toContain("doi = {10.1000/xyz-123},");
    expect(entry).toContain("url = {https://example.org/paper},");
    expect(entry).toContain("eprint = {2501.01234},");
    expect(entry).toContain("archivePrefix = {arXiv},");
  });

  it("builds bibtex file for multiple papers", () => {
    const bib = buildBibtexFile([
      {
        paperId: "p1",
        title: "Paper One",
        authors: []
      },
      {
        paperId: "p2",
        title: "Paper Two",
        authors: ["A B"]
      }
    ]);

    expect(bib).toContain("@article{p1,");
    expect(bib).toContain("@article{p2,");
    expect(bib.split("@article{").length - 1).toBe(2);
  });

  it("uses S2 bibtex in hybrid mode when available", () => {
    const bib = buildBibtexFile(
      [
        {
          paperId: "p1",
          title: "Paper One",
          authors: [],
          citationStylesBibtex: "@article{s2key,\n  title = {From S2},\n}"
        }
      ],
      "hybrid"
    );

    expect(bib).toContain("@article{s2key,");
    expect(bib).toContain("From S2");
  });

  it("skips entries without S2 bibtex in s2 mode", () => {
    const bib = buildBibtexFile(
      [
        {
          paperId: "p1",
          title: "Paper One",
          authors: []
        }
      ],
      "s2"
    );

    expect(bib.trim()).toBe("");
  });

  it("returns failure on fetch error and preserves the requested query in diagnostics", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-collect-"));
    process.chdir(root);

    const runId = "run-collect-failure";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Multi-Agent Collaboration",
      topic: "AI agent automation",
      constraints: [],
      objectiveMetric: "metric",
      status: "running",
      currentNode: "collect_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      graph: createDefaultGraphState(),
      memoryRefs: {
        runContextPath: `.autoresearch/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autoresearch/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autoresearch/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autoresearch", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "collect_papers.request",
            value: {
              query: "Multi-Agent Collaboration",
              limit: 300,
              sort: { field: "relevance", order: "desc" },
              filters: { lastYears: 5, openAccessPdf: true }
            },
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
    );

    const eventStream = new InMemoryEventStream();
    const node = createCollectPapersNode({
      config: {
        papers: {
          max_results: 200
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new MockLLMClient(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {
        streamSearchPapers: vi.fn(() =>
          failingBatchStream([], new Error("Semantic Scholar request failed: 429"))
        ),
        getLastSearchDiagnostics: vi.fn(() => ({
          attemptCount: 3,
          lastStatus: 429,
          retryAfterMs: 2000,
          attempts: [
            { attempt: 1, ok: false, status: 429, retryAfterMs: 2000, endpoint: "search" },
            { attempt: 2, ok: false, status: 429, retryAfterMs: 2000, endpoint: "search" },
            { attempt: 3, ok: false, status: 429, retryAfterMs: 2000, endpoint: "search" }
          ]
        }))
      } as any
    });

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("failure");
    expect(result.error).toContain('Semantic Scholar rate limited "Multi-Agent Collaboration"');
    expect(result.error).toContain("429");
    expect(result.error).toContain("lower --limit to 50-100");
    expect(
      eventStream
        .history()
        .filter((event) => event.type === "OBS_RECEIVED")
        .some((event) =>
          String(event.payload?.text ?? "").includes(
            "Semantic Scholar attempts: req1 attempt1=429 failed retry-after=2000ms, req2 attempt2=429 failed retry-after=2000ms, req3 attempt3=429 failed retry-after=2000ms"
          )
        )
    ).toBe(true);

    const resultMetaRaw = await readFile(
      path.join(root, ".autoresearch", "runs", runId, "collect_result.json"),
      "utf8"
    );
    expect(resultMetaRaw).toContain('"query": "Multi-Agent Collaboration"');
    expect(resultMetaRaw).toContain('"fetchError": "Semantic Scholar request failed: 429"');
    expect(resultMetaRaw).toContain('"attemptCount": 3');
    expect(resultMetaRaw).toContain('"lastStatus": 429');
    expect(resultMetaRaw).toContain('"retryAfterMs": 2000');

    await expect(access(path.join(root, ".autoresearch", "runs", runId, "corpus.jsonl"))).rejects.toThrow();
  });

  it("collects papers without emitting internal TOOL_CALLED placeholder events", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-collect-success-"));
    process.chdir(root);

    const runId = "run-collect-success";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Multi-Agent Collaboration",
      topic: "AI agent automation",
      constraints: [],
      objectiveMetric: "metric",
      status: "running",
      currentNode: "collect_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      graph: createDefaultGraphState(),
      memoryRefs: {
        runContextPath: `.autoresearch/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autoresearch/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autoresearch/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autoresearch", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "collect_papers.request",
            value: {
              query: "Multi-Agent Collaboration",
              limit: 1,
              sort: { field: "relevance", order: "desc" },
              filters: { lastYears: 5, openAccessPdf: true }
            },
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
    );

    const eventStream = new InMemoryEventStream();
    const node = createCollectPapersNode({
      config: {
        papers: {
          max_results: 200
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new MockLLMClient(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {
        streamSearchPapers: vi.fn(() =>
          batchStream([
            {
              paperId: "paper-1",
              title: "Multi-Agent Collaboration for Research",
              abstract: "Test abstract",
              year: 2025,
              venue: "NeurIPS",
              url: "https://example.org/paper-1",
              openAccessPdfUrl: "https://example.org/paper-1.pdf",
              authors: ["Alice Kim"],
              citationCount: 42,
              influentialCitationCount: 7,
              publicationDate: "2025-01-01",
              publicationTypes: ["Review"],
              fieldsOfStudy: ["Computer Science"]
            }
          ])
        ),
        getLastSearchDiagnostics: vi.fn(() => ({
          attemptCount: 1,
          lastStatus: 200,
          attempts: [{ attempt: 1, ok: true, status: 200, endpoint: "search" }]
        }))
      } as any
    });

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("success");
    expect(
      eventStream
        .history()
        .filter((event) => event.type === "OBS_RECEIVED")
        .some((event) => String(event.payload?.text ?? "").includes("Requesting Semantic Scholar batch 1/1."))
    ).toBe(true);
    expect(result.summary).toBe(
      'Semantic Scholar stored 1 papers for "Multi-Agent Collaboration". PDF recovered 0; BibTeX enriched 0.'
    );
    expect(result.summary).not.toContain("Collection objective");
    expect(eventStream.history().some((event) => event.type === "TOOL_CALLED")).toBe(false);
    expect(
      eventStream
        .history()
        .filter((event) => event.type === "OBS_RECEIVED")
        .some((event) =>
          String(event.payload?.text ?? "").includes("Semantic Scholar attempts: 1 request(s) succeeded on the first attempt.")
        )
    ).toBe(true);
  });

  it("merges additional collection results with existing corpus and dedupes by paper_id", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-collect-merge-"));
    process.chdir(root);

    const runId = "run-collect-merge";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Multi-Agent Collaboration",
      topic: "AI agent automation",
      constraints: [],
      objectiveMetric: "metric",
      status: "running",
      currentNode: "collect_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      graph: createDefaultGraphState(),
      memoryRefs: {
        runContextPath: `.autoresearch/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autoresearch/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autoresearch/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const runDir = path.join(root, ".autoresearch", "runs", runId);
    const memoryDir = path.join(runDir, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(runDir, "corpus.jsonl"),
      `${JSON.stringify({
        paper_id: "paper-1",
        title: "Existing Paper",
        abstract: "",
        authors: ["Alice Kim"]
      })}\n`,
      "utf8"
    );
    await writeFile(path.join(runDir, "bibtex.bib"), "@article{paper_1,\n  title = {Existing Paper},\n}\n", "utf8");
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "collect_papers.request",
            value: {
              query: "Multi-Agent Collaboration",
              additional: 2,
              limit: 3,
              sort: { field: "relevance", order: "desc" }
            },
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
    );

    const eventStream = new InMemoryEventStream();
    const node = createCollectPapersNode({
      config: {
        papers: {
          max_results: 200
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new MockLLMClient(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {
        streamSearchPapers: vi.fn(() =>
          batchStream([
            {
              paperId: "paper-1",
              title: "Existing Paper",
              authors: ["Alice Kim"]
            },
            {
              paperId: "paper-2",
              title: "New Paper 2",
              authors: ["Bob Lee"]
            },
            {
              paperId: "paper-3",
              title: "New Paper 3",
              authors: ["Chris Park"]
            }
          ])
        )
      } as any
    });

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("success");
    expect(result.summary).toBe(
      'Semantic Scholar stored 3 total papers for "Multi-Agent Collaboration" (2 newly added). PDF recovered 0; BibTeX enriched 0.'
    );
    const corpus = await readFile(path.join(runDir, "corpus.jsonl"), "utf8");
    expect(corpus).toContain('"paper_id":"paper-1"');
    expect(corpus).toContain('"paper_id":"paper-2"');
    expect(corpus).toContain('"paper_id":"paper-3"');
    const resultMetaRaw = await readFile(path.join(runDir, "collect_result.json"), "utf8");
    expect(resultMetaRaw).toContain('"mode": "additional"');
    expect(resultMetaRaw).toContain('"added": 2');
    expect(resultMetaRaw).toContain('"stored": 3');
  });

  it("persists partial collected papers before a later 429 failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-collect-partial-"));
    process.chdir(root);

    const runId = "run-collect-partial";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Multi-Agent Collaboration",
      topic: "AI agent automation",
      constraints: [],
      objectiveMetric: "metric",
      status: "running",
      currentNode: "collect_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      graph: createDefaultGraphState(),
      memoryRefs: {
        runContextPath: `.autoresearch/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autoresearch/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autoresearch/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autoresearch", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "collect_papers.request",
            value: {
              query: "Multi-Agent Collaboration",
              limit: 3,
              sort: { field: "relevance", order: "desc" }
            },
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
    );

    const eventStream = new InMemoryEventStream();
    const node = createCollectPapersNode({
      config: {
        papers: {
          max_results: 200
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new MockLLMClient(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {
        streamSearchPapers: vi.fn(() =>
          failingBatchStream(
            [
              [
                {
                  paperId: "paper-1",
                  title: "New Paper 1",
                  authors: ["Alice Kim"]
                },
                {
                  paperId: "paper-2",
                  title: "New Paper 2",
                  authors: ["Bob Lee"]
                }
              ]
            ],
            new Error("Semantic Scholar request failed: 429")
          )
        )
      } as any
    });

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("failure");
    const corpus = await readFile(path.join(root, ".autoresearch", "runs", runId, "corpus.jsonl"), "utf8");
    expect(corpus).toContain('"paper_id":"paper-1"');
    expect(corpus).toContain('"paper_id":"paper-2"');
    const resultMetaRaw = await readFile(
      path.join(root, ".autoresearch", "runs", runId, "collect_result.json"),
      "utf8"
    );
    expect(resultMetaRaw).toContain('"completed": false');
    expect(resultMetaRaw).toContain('"stored": 2');
    expect(resultMetaRaw).toContain('"fetchError": "Semantic Scholar request failed: 429"');
  });

  it("applies run constraints as default collect filters when command filters are absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-collect-constraints-"));
    process.chdir(root);

    const runId = "run-collect-constraints";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Constrained collect",
      topic: "AI agent automation",
      constraints: ["last 5 years", "open access", "review papers", "minimum citations 25"],
      objectiveMetric: "metric",
      status: "running",
      currentNode: "collect_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      graph: createDefaultGraphState(),
      memoryRefs: {
        runContextPath: `.autoresearch/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autoresearch/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autoresearch/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autoresearch", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "collect_papers.request",
            value: {
              limit: 1,
              sort: { field: "relevance", order: "desc" }
            },
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
    );

    const streamSearchPapers = vi.fn(() =>
      batchStream([
        {
          paperId: "paper-1",
          title: "New Paper 1",
          authors: ["Alice Kim"],
          citationCount: 25
        }
      ])
    );

    const node = createCollectPapersNode({
      config: {
        papers: {
          max_results: 200
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {
        streamSearchPapers,
        getLastSearchDiagnostics: vi.fn(() => ({ attemptCount: 0, attempts: [] }))
      } as any
    });

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("success");
    expect(streamSearchPapers).toHaveBeenCalledTimes(1);
    expect(streamSearchPapers.mock.calls[0]?.[0]).toMatchObject({
      query: "AI agent automation",
      filters: {
        openAccessPdf: true,
        publicationDateOrYear: `${new Date().getFullYear() - 4}:`,
        publicationTypes: ["Review"],
        minCitationCount: 25
      }
    });

    const requestRaw = await readFile(
      path.join(root, ".autoresearch", "runs", runId, "collect_request.json"),
      "utf8"
    );
    expect(requestRaw).toContain('"openAccessPdf": true');
    expect(requestRaw).toContain('"publicationTypes": [');
    expect(requestRaw).toContain('"Review"');
    expect(requestRaw).toContain('"minCitationCount": 25');
  });

  it("uses llm-derived constraint defaults when heuristics would miss them", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-collect-constraint-profile-"));
    process.chdir(root);

    const runId = "run-collect-constraint-profile";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Seven Year Retrieval",
      topic: "AI agent automation",
      constraints: ["Prefer open pdfs from the past seven years with at least 42 citations."],
      objectiveMetric: "metric",
      status: "running",
      currentNode: "collect_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      graph: createDefaultGraphState(),
      memoryRefs: {
        runContextPath: `.autoresearch/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autoresearch/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autoresearch/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autoresearch", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "collect_papers.request",
            value: {
              query: "Multi-Agent Collaboration",
              limit: 10,
              sort: { field: "relevance", order: "desc" }
            },
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
    );

    const streamSearchPapers = vi.fn(() =>
      batchStream([
        {
          paperId: "paper-1",
          title: "Constraint Profile Paper",
          authors: ["Alice Kim"]
        }
      ])
    );

    const node = createCollectPapersNode({
      config: {
        papers: {
          max_results: 200
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new JsonLLMClient(
        JSON.stringify({
          collect: {
            lastYears: 7,
            minCitationCount: 42,
            openAccessPdf: true
          },
          writing: {},
          experiment: {
            designNotes: ["Prefer recent evidence over old benchmarks."],
            implementationNotes: [],
            evaluationNotes: []
          },
          assumptions: []
        })
      ),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {
        streamSearchPapers,
        getLastSearchDiagnostics: vi.fn(() => ({ attemptCount: 0, attempts: [] }))
      } as any
    });

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("success");
    expect(streamSearchPapers).toHaveBeenCalledTimes(1);
    expect(streamSearchPapers.mock.calls[0]?.[0]).toMatchObject({
      filters: {
        openAccessPdf: true,
        minCitationCount: 42,
        publicationDateOrYear: "2020:"
      }
    });
  });

  it("drops generic publicationTypes like paper before calling Semantic Scholar", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-collect-generic-paper-"));
    process.chdir(root);

    const runId = "run-collect-generic-paper";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Recent Multi-Agent Collaboration Papers",
      topic: "Multi-agent collaboration",
      constraints: ["recent papers", "last 5 years"],
      objectiveMetric: "metric",
      status: "running",
      currentNode: "collect_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      graph: createDefaultGraphState(),
      memoryRefs: {
        runContextPath: `.autoresearch/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autoresearch/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autoresearch/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autoresearch", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(path.join(memoryDir, "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");

    const streamSearchPapers = vi.fn(async function* (request: any) {
      expect(request.filters?.publicationTypes).toBeUndefined();
      yield [];
    });

    const node = createCollectPapersNode({
      config: {
        papers: {
          max_results: 200
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new JsonLLMClient(
        JSON.stringify({
          collect: {
            lastYears: 5,
            publicationTypes: ["paper"]
          },
          writing: {},
          experiment: {
            designNotes: [],
            implementationNotes: [],
            evaluationNotes: []
          },
          assumptions: []
        })
      ),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {
        streamSearchPapers,
        getLastSearchDiagnostics: vi.fn(() => ({
          attemptCount: 1,
          lastStatus: 200,
          attempts: [{ attempt: 1, ok: true, status: 200, endpoint: "search" }]
        }))
      } as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(streamSearchPapers).toHaveBeenCalledOnce();
  });

  it("defers enrichment until after fast Semantic Scholar fetch completes and emits enrichment progress", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-collect-deferred-enrichment-"));
    process.chdir(root);

    const runId = "run-collect-deferred-enrichment";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Multi-Agent Collaboration",
      topic: "Multi-agent collaboration",
      constraints: [],
      objectiveMetric: "metric",
      status: "running",
      currentNode: "collect_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      graph: createDefaultGraphState(),
      memoryRefs: {
        runContextPath: `.autoresearch/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autoresearch/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autoresearch/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autoresearch", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "collect_papers.request",
            value: {
              query: "Multi-Agent Collaboration",
              limit: 2,
              sort: { field: "relevance", order: "desc" }
            },
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
    );

    const eventStream = new InMemoryEventStream();
    const node = createCollectPapersNode({
      config: {
        papers: {
          max_results: 200
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new MockLLMClient(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {
        streamSearchPapers: vi.fn(() =>
          batchStream([
            {
              paperId: "paper-1",
              title: "Paper 1",
              authors: ["Alice Kim"]
            },
            {
              paperId: "paper-2",
              title: "Paper 2",
              authors: ["Bob Lee"]
            }
          ])
        ),
        getLastSearchDiagnostics: vi.fn(() => ({
          attemptCount: 1,
          lastStatus: 200,
          attempts: [{ attempt: 1, ok: true, status: 200, endpoint: "search" }]
        }))
      } as any
    });

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("success");
    const observedTexts = eventStream
      .history()
      .filter((event) => event.type === "OBS_RECEIVED")
      .map((event) => String(event.payload?.text ?? ""));

    const requestIndex = observedTexts.findIndex((text) =>
      text.includes("Requesting Semantic Scholar batch 1/1.")
    );
    const collectedIndex = observedTexts.findIndex((text) =>
      text.includes('Collected 2 paper(s) so far (2 new) for "Multi-Agent Collaboration".')
    );
    const deferredIndex = observedTexts.findIndex((text) =>
      text.includes("Starting deferred enrichment for 2 paper(s) with concurrency 2.")
    );
    const progressIndex = observedTexts.findIndex((text) =>
      text.includes("Collect enrichment progress: processed 1/2, stored 2/2.")
    );

    expect(requestIndex).toBeGreaterThanOrEqual(0);
    expect(collectedIndex).toBeGreaterThan(requestIndex);
    expect(collectedIndex).toBeGreaterThanOrEqual(0);
    expect(deferredIndex).toBeGreaterThan(collectedIndex);
    expect(progressIndex).toBeGreaterThan(deferredIndex);
  });
});
