import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, access, readFile, mkdir, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildBibtexEntry,
  buildBibtexFile,
  createCollectPapersNode,
  waitForAllCollectEnrichmentJobs,
  waitForCollectEnrichmentJob
} from "../src/core/nodes/collectPapers.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

class JsonLLMClient extends MockLLMClient {
  constructor(private readonly response: string) {
    super();
  }

  override async complete(_prompt: string): Promise<{ text: string }> {
    return { text: this.response };
  }
}

afterEach(async () => {
  await waitForAllCollectEnrichmentJobs();
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

async function readRunContextValue(root: string, runId: string, key: string): Promise<unknown> {
  const raw = await readFile(path.join(root, ".autolabos", "runs", runId, "memory", "run_context.json"), "utf8");
  const parsed = JSON.parse(raw) as { items?: Array<{ key?: string; value?: unknown }> };
  return parsed.items?.find((item) => item.key === key)?.value;
}

function cloneRun<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-"));
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
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
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
      path.join(root, ".autolabos", "runs", runId, "collect_result.json"),
      "utf8"
    );
    expect(resultMetaRaw).toContain('"query": "Multi-Agent Collaboration"');
    expect(resultMetaRaw).toContain('"fetchError": "Semantic Scholar request failed: 429"');
    expect(resultMetaRaw).toContain('"attemptCount": 3');
    expect(resultMetaRaw).toContain('"lastStatus": 429');
    expect(resultMetaRaw).toContain('"retryAfterMs": 2000');

    await expect(access(path.join(root, ".autolabos", "runs", runId, "corpus.jsonl"))).rejects.toThrow();
  });

  it("collects papers without emitting internal TOOL_CALLED placeholder events", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-success-"));
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
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
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
      'Semantic Scholar stored 1 papers for "Multi-Agent Collaboration". Deferred enrichment scheduled in background for 1 paper(s).'
    );
    await waitForCollectEnrichmentJob(runId);
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
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-merge-"));
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
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const runDir = path.join(root, ".autolabos", "runs", runId);
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
      'Semantic Scholar stored 3 total papers for "Multi-Agent Collaboration" (2 newly added). Deferred enrichment scheduled in background for 3 paper(s).'
    );
    await waitForCollectEnrichmentJob(runId);
    const corpus = await readFile(path.join(runDir, "corpus.jsonl"), "utf8");
    expect(corpus).toContain('"paper_id":"paper-1"');
    expect(corpus).toContain('"paper_id":"paper-2"');
    expect(corpus).toContain('"paper_id":"paper-3"');
    const resultMetaRaw = await readFile(path.join(runDir, "collect_result.json"), "utf8");
    expect(resultMetaRaw).toContain('"mode": "additional"');
    expect(resultMetaRaw).toContain('"added": 2');
    expect(resultMetaRaw).toContain('"stored": 3');
  });

  it("caps additional collection at the requested number of newly added papers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-additional-cap-"));
    process.chdir(root);

    const runId = "run-collect-additional-cap";
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
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const runDir = path.join(root, ".autolabos", "runs", runId);
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
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "collect_papers.request",
            value: {
              query: "Multi-Agent Collaboration",
              additional: 1,
              limit: 2,
              sort: { field: "relevance", order: "desc" }
            },
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
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
        streamSearchPapers: vi.fn(() =>
          batchStream([
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
    expect(result.summary).toBe(
      'Semantic Scholar stored 2 total papers for "Multi-Agent Collaboration" (1 newly added). Deferred enrichment scheduled in background for 1 paper(s).'
    );
    await waitForCollectEnrichmentJob(runId);
    const corpus = await readFile(path.join(runDir, "corpus.jsonl"), "utf8");
    expect(corpus).toContain('"paper_id":"paper-1"');
    expect(corpus).toContain('"paper_id":"paper-2"');
    expect(corpus).not.toContain('"paper_id":"paper-3"');
    const resultMetaRaw = await readFile(path.join(runDir, "collect_result.json"), "utf8");
    expect(resultMetaRaw).toContain('"mode": "additional"');
    expect(resultMetaRaw).toContain('"added": 1');
    expect(resultMetaRaw).toContain('"stored": 2');
    expect(resultMetaRaw).toContain('"fetched": 2');
  });

  it("preserves prior enrichment logs during additional collection when no new enrichment runs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-enrichment-preserve-"));
    process.chdir(root);

    const runId = "run-collect-enrichment-preserve";
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
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const runDir = path.join(root, ".autolabos", "runs", runId);
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
    await writeFile(
      path.join(runDir, "collect_enrichment.jsonl"),
      `${JSON.stringify({
        paper_id: "paper-1",
        attempts: [{ stage: "existing", ok: true }],
        errors: []
      })}\n`,
      "utf8"
    );
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "collect_papers.request",
            value: {
              query: "Multi-Agent Collaboration",
              additional: 1,
              limit: 2,
              sort: { field: "relevance", order: "desc" },
              bibtexMode: "generated"
            },
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
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
        streamSearchPapers: vi.fn(() =>
          batchStream([
            {
              paperId: "paper-2",
              title: "New Paper 2",
              openAccessPdfUrl: "https://example.org/paper-2.pdf",
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
    const enrichmentRaw = await readFile(path.join(runDir, "collect_enrichment.jsonl"), "utf8");
    expect(enrichmentRaw).toContain('"paper_id":"paper-1"');
    expect(enrichmentRaw).toContain('"stage":"existing"');
    expect(enrichmentRaw).not.toBe("");
  });

  it("persists partial collected papers before a later 429 failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-partial-"));
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
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
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
    const corpus = await readFile(path.join(root, ".autolabos", "runs", runId, "corpus.jsonl"), "utf8");
    expect(corpus).toContain('"paper_id":"paper-1"');
    expect(corpus).toContain('"paper_id":"paper-2"');
    const resultMetaRaw = await readFile(
      path.join(root, ".autolabos", "runs", runId, "collect_result.json"),
      "utf8"
    );
    expect(resultMetaRaw).toContain('"completed": false');
    expect(resultMetaRaw).toContain('"stored": 2');
    expect(resultMetaRaw).toContain('"fetchError": "Semantic Scholar request failed: 429"');
  });

  it("applies run constraints as default collect filters when command filters are absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-constraints-"));
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
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
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
      path.join(root, ".autolabos", "runs", runId, "collect_request.json"),
      "utf8"
    );
    expect(requestRaw).toContain('"openAccessPdf": true');
    expect(requestRaw).toContain('"publicationTypes": [');
    expect(requestRaw).toContain('"Review"');
    expect(requestRaw).toContain('"minCitationCount": 25');
  });

  it("uses llm-derived constraint defaults when heuristics would miss them", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-constraint-profile-"));
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
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
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

  it("drops invalid llm-derived collect date prose before calling Semantic Scholar", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-invalid-date-filter-"));
    process.chdir(root);

    const runId = "run-collect-invalid-date-filter";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Benchmark Corpus",
      topic: "tabular classification baselines",
      constraints: ["Include both recent papers and core older benchmark or evaluation papers where relevant."],
      objectiveMetric: "metric",
      status: "running",
      currentNode: "collect_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      graph: createDefaultGraphState(),
      memoryRefs: {
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "collect_papers.request",
            value: {
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
          title: "Benchmark Corpus Paper",
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
            dateRange: "recent papers plus core older benchmark/evaluation papers where relevant"
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
      query: "tabular classification baselines"
    });
    expect(streamSearchPapers.mock.calls[0]?.[0]?.filters).not.toHaveProperty("publicationDateOrYear");
  });

  it("drops generic publicationTypes like paper before calling Semantic Scholar", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-generic-paper-"));
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
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
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

    expect(result.status).toBe("failure");
    expect(result.error).toContain("Semantic Scholar returned 0 papers after automatic fallback broadening.");
    expect(streamSearchPapers.mock.calls.length).toBeGreaterThan(0);
  });

  it("defers enrichment until after fast Semantic Scholar fetch completes and emits enrichment progress", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-deferred-enrichment-"));
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
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
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
    expect(result.summary).toBe(
      'Semantic Scholar stored 2 papers for "Multi-Agent Collaboration". Deferred enrichment scheduled in background for 2 paper(s).'
    );
    await waitForCollectEnrichmentJob(runId);
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
    const completionIndex = observedTexts.findIndex((text) =>
      text.includes("Deferred enrichment finished for 2 paper(s). PDF recovered 0; BibTeX enriched 0.")
    );

    expect(requestIndex).toBeGreaterThanOrEqual(0);
    expect(collectedIndex).toBeGreaterThan(requestIndex);
    expect(collectedIndex).toBeGreaterThanOrEqual(0);
    expect(deferredIndex).toBeGreaterThan(collectedIndex);
    expect(progressIndex).toBeGreaterThan(deferredIndex);
    expect(completionIndex).toBeGreaterThan(progressIndex);

    const lastResult = (await readRunContextValue(root, runId, "collect_papers.last_result")) as {
      enrichment?: {
        status?: string;
        processedCount?: number;
        attemptedCount?: number;
        updatedCount?: number;
        blocking?: boolean;
      };
    } | undefined;
    expect(lastResult?.enrichment).toMatchObject({
      blocking: false,
      status: "completed",
      processedCount: 2,
      attemptedCount: 2,
      updatedCount: 0
    });
    expect(await readRunContextValue(root, runId, "collect_papers.last_error")).toBeNull();
    expect(await readRunContextValue(root, runId, "collect_papers.enrichment_last_error")).toBeNull();
  });

  it("prefers the explicit brief topic over a narrowed run topic for the first literature query", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-brief-topic-"));
    process.chdir(root);

    const runId = "run-collect-brief-topic";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Tabular Baselines",
      topic: "Laptop-safe benchmarking of lightweight tabular classifiers versus logistic regression on small public datasets",
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
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "run_brief.raw",
            value: [
              "# Research Brief",
              "",
              "## Topic",
              "",
              "Classical machine learning baselines for tabular classification."
            ].join("\n"),
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
          title: "Tabular Baselines",
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
      llm: new MockLLMClient(),
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

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("success");
    expect(streamSearchPapers).toHaveBeenCalledTimes(1);
    expect(streamSearchPapers.mock.calls[0]?.[0]).toMatchObject({
      query: "Classical machine learning baselines for tabular classification"
    });
    await waitForCollectEnrichmentJob(runId);
  });

  it("prefers the extracted broad brief topic over a narrowed run topic for unlabeled auto-start briefs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-extracted-brief-topic-"));
    process.chdir(root);

    const runId = "run-collect-extracted-brief-topic";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Tabular Baselines",
      topic: "Resource-aware baselines for tabular classification on small public datasets",
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
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "run_brief.raw",
            value: [
              "Start a new research run on classical machine learning baselines for tabular classification.",
              "Objective: improve macro-F1 over a logistic regression baseline while preserving reproducible local runtime and memory efficiency.",
              "Constraints: CPU-only execution, lightweight Python dependencies."
            ].join("\n"),
            updatedAt: new Date().toISOString()
          },
          {
            key: "run_brief.extracted",
            value: {
              topic: "classical machine learning baselines for tabular classification.",
              objectiveMetric: "macro-F1 over logistic regression",
              constraints: ["CPU-only execution"]
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
          title: "Classical tabular baseline survey",
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
      llm: new MockLLMClient(),
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

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("success");
    expect(streamSearchPapers).toHaveBeenCalledTimes(1);
    expect(streamSearchPapers.mock.calls[0]?.[0]).toMatchObject({
      query: "classical machine learning baselines for tabular classification"
    });
    await waitForCollectEnrichmentJob(runId);
  });

  it("falls back from a narrow requested query to the broader brief topic after zero results", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-query-fallback-"));
    process.chdir(root);

    const runId = "run-collect-query-fallback";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Tabular Baselines",
      topic: "Resource-aware baselines for tabular classification on small public datasets",
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
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "collect_papers.request",
            value: {
              query: "Resource-aware baselines for tabular classification on small public datasets",
              limit: 1,
              sort: { field: "relevance", order: "desc" }
            },
            updatedAt: new Date().toISOString()
          },
          {
            key: "run_brief.raw",
            value: [
              "# Research Brief",
              "",
              "## Topic",
              "",
              "Classical machine learning baselines for tabular classification."
            ].join("\n"),
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
    );

    const streamSearchPapers = vi.fn(async function* (request: { query: string }) {
      if (request.query === "Resource-aware baselines for tabular classification on small public datasets") {
        yield [];
        return;
      }
      if (request.query === "Classical machine learning baselines for tabular classification") {
        yield [
          {
            paperId: "paper-1",
            title: "Classical tabular baseline survey",
            authors: ["Alice Kim"]
          }
        ];
        return;
      }
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
      llm: new MockLLMClient(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {
        streamSearchPapers,
        getLastSearchDiagnostics: vi
          .fn()
          .mockReturnValueOnce({
            attemptCount: 1,
            lastStatus: 200,
            attempts: [{ attempt: 1, ok: true, status: 200, endpoint: "search" }]
          })
          .mockReturnValueOnce({
            attemptCount: 1,
            lastStatus: 200,
            attempts: [{ attempt: 1, ok: true, status: 200, endpoint: "search" }]
          })
      } as any
    });

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("success");
    expect(streamSearchPapers.mock.calls.map((call) => call[0]?.query)).toEqual([
      "Resource-aware baselines for tabular classification on small public datasets",
      "Classical machine learning baselines for tabular classification"
    ]);

    const lastResult = (await readRunContextValue(root, runId, "collect_papers.last_result")) as {
      query?: string;
      queryAttempts?: Array<{ query?: string; fetched?: number }>;
      enrichment?: { blocking?: boolean; status?: string };
    } | undefined;
    expect(lastResult?.query).toBe("Classical machine learning baselines for tabular classification");
    expect(lastResult?.queryAttempts).toEqual([
      expect.objectContaining({
        query: "Resource-aware baselines for tabular classification on small public datasets",
        fetched: 0
      }),
      expect.objectContaining({
        query: "Classical machine learning baselines for tabular classification",
        fetched: 1
      })
    ]);
    expect(lastResult?.enrichment).toMatchObject({
      blocking: false,
      status: "pending"
    });

    await waitForCollectEnrichmentJob(runId);
  });

  it("filters obvious off-topic tail papers from a lightweight tabular raw corpus before selection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-lightweight-tail-"));
    process.chdir(root);

    const runId = "run-collect-lightweight-tail";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Tabular Baselines",
      topic: "Classical machine learning baselines for tabular classification on small public datasets",
      constraints: [],
      objectiveMetric: "macro_f1",
      status: "running",
      currentNode: "collect_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      graph: createDefaultGraphState(),
      memoryRefs: {
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "collect_papers.request",
            value: {
              query: "Classical machine learning baselines for tabular classification on small public datasets",
              limit: 8,
              sort: { field: "relevance", order: "desc" },
              bibtexMode: "generated"
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
              paperId: "relevant_svm",
              title:
                "Cross-Dataset Evaluation of Support Vector Machines: A Reproducible, Calibration-Aware Baseline for Tabular Classification",
              abstract:
                "A calibration-aware benchmark compares SVM, logistic regression, decision tree, and random forest on small tabular datasets.",
              authors: ["Alice Kim"],
              openAccessPdfUrl: "https://example.org/relevant_svm.pdf"
            },
            {
              paperId: "relevant_benchmark",
              title: "Benchmarking classical baselines on structured datasets",
              abstract:
                "We compare logistic regression, random forests, and gradient boosting for tabular classification across small public benchmarks.",
              authors: ["Bob Lee"],
              openAccessPdfUrl: "https://example.org/relevant_benchmark.pdf"
            },
            {
              paperId: "relevant_pmlb",
              title: "PMLBmini: A Tabular Classification Benchmark Suite for Data-Scarce Applications",
              abstract:
                "A benchmark suite for small tabular classification tasks compares classical linear baselines, AutoML, and tabular deep learning.",
              authors: ["Cara Park"],
              openAccessPdfUrl: "https://example.org/relevant_pmlb.pdf"
            },
            {
              paperId: "relevant_clinical",
              title: "Resource-Efficient Small-Model Pipeline for Congestive Heart Failure Prediction",
              abstract:
                "We evaluate structured tabular clinical features on a public dataset and compare lightweight classification baselines.",
              authors: ["Daniel Choi"],
              openAccessPdfUrl: "https://example.org/relevant_clinical.pdf"
            },
            {
              paperId: "off_topic_secret",
              title: "Secret Breach Prevention in Software Issue Reports",
              abstract:
                "We evaluate entropy heuristics, classical machine learning, deep learning, and LLM-based methods for secret detection.",
              authors: ["Eve Han"],
              openAccessPdfUrl: "https://example.org/off_topic_secret.pdf"
            },
            {
              paperId: "off_topic_music",
              title: "Emotional response to music: the Emotify + dataset",
              abstract: "Abstract unavailable.",
              authors: ["Finn Seo"],
              openAccessPdfUrl: "https://example.org/off_topic_music.pdf"
            },
            {
              paperId: "off_topic_sentiment",
              title: "Application of Sentiment Analysis to Labeling Characters as Good or Evil",
              abstract: "Abstract unavailable.",
              authors: ["Grace Lim"],
              openAccessPdfUrl: "https://example.org/off_topic_sentiment.pdf"
            },
            {
              paperId: "off_topic_raman",
              title:
                "DeepRaman: Implementing surface-enhanced Raman scattering together with machine learning for bacterial endotoxin classification",
              abstract:
                "A classification pipeline for bacterial endotoxin differentiation using Raman scattering and machine learning.",
              authors: ["Henry Jung"],
              openAccessPdfUrl: "https://example.org/off_topic_raman.pdf"
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

    const corpusRaw = await readFile(path.join(root, ".autolabos", "runs", runId, "corpus.jsonl"), "utf8");
    const corpusPaperIds = corpusRaw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { paper_id: string })
      .map((row) => row.paper_id);
    expect(new Set(corpusPaperIds)).toEqual(
      new Set(["relevant_svm", "relevant_benchmark", "relevant_pmlb", "relevant_clinical"])
    );

    const lastResult = (await readRunContextValue(root, runId, "collect_papers.last_result")) as {
      stored?: number;
      fetched?: number;
    } | null;
    expect(lastResult?.fetched).toBe(8);
    expect(lastResult?.stored).toBe(4);

    expect(
      eventStream
        .history()
        .filter((event) => event.type === "OBS_RECEIVED")
        .some((event) =>
          String(event.payload?.text ?? "").includes(
            "Lightweight corpus quality guard removed 4 off-topic tail paper(s) before selection."
          )
        )
    ).toBe(true);
  });

  it("does not trim broader tabular collections when the raw corpus is larger than the lightweight tail window", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-broad-tabular-"));
    process.chdir(root);

    const runId = "run-collect-broad-tabular";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Tabular Baselines",
      topic: "Classical machine learning baselines for tabular classification on small public datasets",
      constraints: [],
      objectiveMetric: "macro_f1",
      status: "running",
      currentNode: "collect_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      graph: createDefaultGraphState(),
      memoryRefs: {
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "collect_papers.request",
            value: {
              query: "Classical machine learning baselines for tabular classification on small public datasets",
              limit: 13,
              sort: { field: "relevance", order: "desc" },
              bibtexMode: "generated"
            },
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
    );

    const eventStream = new InMemoryEventStream();
    const papers = Array.from({ length: 13 }, (_, index) => ({
      paperId: `paper-${index + 1}`,
      title: index < 9 ? `Tabular baseline paper ${index + 1}` : `Off-topic paper ${index + 1}`,
      abstract:
        index < 9
          ? "Tabular classification benchmark comparing lightweight baselines on small public datasets."
          : "This abstract is unrelated to tabular classification and only exists to fill the broader corpus tail.",
      authors: [`Author ${index + 1}`],
      openAccessPdfUrl: `https://example.org/paper-${index + 1}.pdf`
    }));
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
        streamSearchPapers: vi.fn(() => batchStream(papers)),
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

    const lastResult = (await readRunContextValue(root, runId, "collect_papers.last_result")) as {
      stored?: number;
      fetched?: number;
    } | null;
    expect(lastResult?.fetched).toBe(13);
    expect(lastResult?.stored).toBe(13);
    expect(
      eventStream
        .history()
        .filter((event) => event.type === "OBS_RECEIVED")
        .some((event) => String(event.payload?.text ?? "").includes("Lightweight corpus quality guard removed"))
    ).toBe(false);
  });

  it("updates the stored collect summary after deferred enrichment completes when the latest summary is still stale", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-summary-sync-"));
    process.chdir(root);

    const runId = "run-collect-summary-sync";
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
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
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

    const pendingSummary =
      'Semantic Scholar stored 2 papers for "Multi-Agent Collaboration". Deferred enrichment scheduled in background for 2 paper(s).';
    let storedRun = cloneRun({
      ...run,
      currentNode: "analyze_papers" as const,
      graph: {
        ...run.graph,
        currentNode: "analyze_papers" as const,
        nodeStates: {
          ...run.graph.nodeStates,
          collect_papers: {
            ...run.graph.nodeStates.collect_papers,
            status: "completed",
            updatedAt: new Date().toISOString(),
            note: pendingSummary
          },
          analyze_papers: {
            ...run.graph.nodeStates.analyze_papers,
            status: "running",
            updatedAt: new Date().toISOString(),
            note: "Analyzing papers."
          }
        }
      },
      latestSummary: pendingSummary
    });
    const runStore = {
      getRun: vi.fn(async () => cloneRun(storedRun)),
      updateRun: vi.fn(async (updated: RunRecord) => {
        storedRun = cloneRun(updated);
      })
    };

    const node = createCollectPapersNode({
      config: {
        papers: {
          max_results: 200
        }
      } as any,
      runStore: runStore as any,
      eventStream: new InMemoryEventStream(),
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
    expect(result.summary).toBe(pendingSummary);

    await waitForCollectEnrichmentJob(runId);

    expect(storedRun.graph.nodeStates.collect_papers.note).toBe(
      'Semantic Scholar stored 2 papers for "Multi-Agent Collaboration". Deferred enrichment finished for 2 paper(s). PDF recovered 0; BibTeX enriched 0.'
    );
    expect(storedRun.latestSummary).toBe(
      'Semantic Scholar stored 2 papers for "Multi-Agent Collaboration". Deferred enrichment finished for 2 paper(s). PDF recovered 0; BibTeX enriched 0.'
    );
  });

  it("uses llm-generated Semantic Scholar syntax queries from the brief topic before raw topic fallbacks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-llm-query-"));
    process.chdir(root);

    const runId = "run-collect-llm-query";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Reasoning Query Generation",
      topic: "Budget-aware test-time reasoning for small language models",
      constraints: [],
      objectiveMetric: "GSM8K accuracy",
      status: "running",
      currentNode: "collect_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      graph: createDefaultGraphState(),
      memoryRefs: {
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "run_brief.raw",
            value: [
              "# Research Brief",
              "",
              "## Topic",
              "Budget-aware test-time reasoning for small language models",
              "",
              "## Research Question",
              "Can adaptive test-time reasoning improve GSM8K accuracy for small language models?"
            ].join("\n"),
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
    );

    const streamSearchPapers = vi.fn(async function* (_request: { query: string }) {
      yield [
        {
          paperId: "paper-1",
          title: "Adaptive Test-Time Reasoning for Small Language Models",
          authors: ["Alice Kim"]
        }
      ];
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
          queries: ['("adaptive test-time reasoning" | "structured test-time reasoning") +"small language models"'],
          assumptions: ["Used Semantic Scholar syntax to require the model family while allowing test-time strategy variants."]
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

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("success");
    expect(streamSearchPapers).toHaveBeenCalledTimes(1);
    expect(streamSearchPapers.mock.calls[0]?.[0]?.query).toBe(
      '("adaptive test-time reasoning" | "structured test-time reasoning") +"small language models"'
    );

    const lastResult = (await readRunContextValue(root, runId, "collect_papers.last_result")) as {
      query?: string;
      queryAttempts?: Array<{ query?: string; reason?: string }>;
    } | undefined;
    expect(lastResult?.query).toBe('("adaptive test-time reasoning" | "structured test-time reasoning") +"small language models"');
    expect(lastResult?.queryAttempts?.[0]).toMatchObject({
      query: '("adaptive test-time reasoning" | "structured test-time reasoning") +"small language models"',
      reason: "llm_generated"
    });

    await waitForCollectEnrichmentJob(runId);
  });

  it("attempts llm-generated keyword bundles even when only the run topic is available", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-run-topic-llm-query-"));
    process.chdir(root);

    const runId = "run-collect-run-topic-llm-query";
    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id: runId,
      title: "Run Topic Query Generation",
      topic: "Classical machine learning baselines for tabular classification on public datasets",
      constraints: [],
      objectiveMetric: "macro-F1",
      status: "running",
      currentNode: "collect_papers",
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      graph: createDefaultGraphState(),
      memoryRefs: {
        runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
      }
    };

    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({ version: 1, items: [] }),
      "utf8"
    );

    const streamSearchPapers = vi.fn(async function* (request: { query: string }) {
      expect(request.query).toBe("classical machine learning baselines");
      yield [
        {
          paperId: "paper-1",
          title: "Classical Machine Learning Baselines for Tabular Data",
          authors: ["Alice Kim"]
        }
      ];
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
          queries: ["classical machine learning baselines", "tabular classification public datasets"],
          assumptions: ["Split the topic into smaller paper-title-style bundles."]
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

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("success");
    expect(streamSearchPapers).toHaveBeenCalledTimes(1);
    expect(streamSearchPapers.mock.calls[0]?.[0]?.query).toBe("classical machine learning baselines");

    const lastResult = (await readRunContextValue(root, runId, "collect_papers.last_result")) as {
      query?: string;
      queryAttempts?: Array<{ query?: string; reason?: string }>;
    } | undefined;
    expect(lastResult?.query).toBe("classical machine learning baselines");
    expect(lastResult?.queryAttempts?.[0]).toMatchObject({
      query: "classical machine learning baselines",
      reason: "llm_generated"
    });

    await waitForCollectEnrichmentJob(runId);
  });
});
