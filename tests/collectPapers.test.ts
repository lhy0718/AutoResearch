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

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

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
    expect(entry).toContain("note = {arXiv:2501.01234},");
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
        searchPapers: vi.fn(async () => {
          throw new Error("Semantic Scholar request failed: 429");
        })
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

    const resultMetaRaw = await readFile(
      path.join(root, ".autoresearch", "runs", runId, "collect_result.json"),
      "utf8"
    );
    expect(resultMetaRaw).toContain('"query": "Multi-Agent Collaboration"');
    expect(resultMetaRaw).toContain('"fetchError": "Semantic Scholar request failed: 429"');

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
        searchPapers: vi.fn(async () => [
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
      } as any
    });

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("success");
    expect(result.summary).toBe('Semantic Scholar fetched 1 papers for "Multi-Agent Collaboration".');
    expect(result.summary).not.toContain("Collection objective");
    expect(eventStream.history().some((event) => event.type === "TOOL_CALLED")).toBe(false);
  });
});
