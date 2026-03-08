import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { createAnalyzePapersNode } from "../src/core/nodes/analyzePapers.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { ResponsesPdfAnalysisClient } from "../src/integrations/openai/responsesPdfAnalysisClient.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;

afterEach(async () => {
  process.chdir(originalCwd);
  globalThis.fetch = originalFetch;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

class SequenceJsonLLM extends MockLLMClient {
  private index = 0;

  constructor(private readonly outputs: string[]) {
    super();
  }

  override async complete(): Promise<{ text: string }> {
    const output = this.outputs[Math.min(this.index, this.outputs.length - 1)] ?? "";
    this.index += 1;
    return { text: output };
  }
}

function makeRun(runId: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "Multi-Agent Collaboration",
    topic: "Multi-Agent Collaboration",
    constraints: [],
    objectiveMetric: "accuracy >= 0.9",
    status: "running",
    currentNode: "analyze_papers",
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
}

async function writeCorpus(runId: string, rows: unknown[]): Promise<void> {
  const dir = path.join(".autoresearch", "runs", runId);
  await mkdir(path.join(dir, "memory"), { recursive: true });
  await writeFile(
    path.join(dir, "corpus.jsonl"),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8"
  );
}

function jsonOutput(summary: string, claim: string): string {
  return JSON.stringify({
    summary,
    key_findings: [`finding ${claim}`],
    limitations: [`limitation ${claim}`],
    datasets: [`dataset ${claim}`],
    metrics: [`metric ${claim}`],
    novelty: `novelty ${claim}`,
    reproducibility_notes: [`repro ${claim}`],
    evidence_items: [
      {
        claim,
        method_slot: `method ${claim}`,
        result_slot: `result ${claim}`,
        limitation_slot: `limitation ${claim}`,
        dataset_slot: `dataset ${claim}`,
        metric_slot: `metric ${claim}`,
        evidence_span: `span ${claim}`,
        confidence: 0.7
      }
    ]
  });
}

describe("analyzePapers node", () => {
  it("writes structured summaries, evidence, and manifest for analyzed papers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-analyze-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-success";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      { paper_id: "p1", title: "Paper 1", abstract: "Abstract 1 references Table 1 and Figure 2.", authors: ["Alice"] },
      { paper_id: "p2", title: "Paper 2", abstract: "Abstract 2", authors: ["Bob"] }
    ]);

    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "codex_text_extract",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new SequenceJsonLLM([jsonOutput("summary 1", "claim 1"), jsonOutput("summary 2", "claim 2")]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);

    const summariesRaw = await readFile(path.join(".autoresearch", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const evidenceRaw = await readFile(path.join(".autoresearch", "runs", runId, "evidence_store.jsonl"), "utf8");
    const manifestRaw = await readFile(path.join(".autoresearch", "runs", runId, "analysis_manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw);

    expect(summariesRaw).toContain('"source_type":"abstract"');
    expect(summariesRaw).toContain('"summary":"summary 1"');
    expect(evidenceRaw).toContain('"claim":"claim 1"');
    expect(manifestRaw).toContain('"status": "completed"');
    expect(manifest.papers.p1.table_reference_count).toBe(1);
    expect(manifest.papers.p1.figure_reference_count).toBe(1);
    expect(manifest.papers.p1.has_table_references).toBe(true);
    expect(manifest.papers.p1.has_figure_references).toBe(true);
    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes('Resolving analysis source 1/2 for "Paper 1".'))).toBe(true);
    expect(loggedTexts.some((text) => text.includes('[p1] Starting LLM analysis attempt 1/2.'))).toBe(true);
    expect(loggedTexts.some((text) => text.includes('Persisted analysis outputs for "Paper 1"'))).toBe(true);
    expect(loggedTexts.some((text) => text.includes('Analyzed "Paper 1" (1 evidence item(s), source=abstract).'))).toBe(true);
  });

  it("persists partial progress and resumes only unfinished papers on rerun", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-analyze-resume-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-resume";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      { paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] },
      { paper_id: "p2", title: "Paper 2", abstract: "Abstract 2", authors: ["Bob"] }
    ]);

    const firstNode = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "codex_text_extract",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequenceJsonLLM([jsonOutput("summary 1", "claim 1"), "invalid-json"]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const first = await firstNode.execute({ run, graph: run.graph });
    expect(first.status).toBe("failure");

    const summariesAfterFirst = await readFile(path.join(".autoresearch", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesAfterFirst.trim().split("\n")).toHaveLength(1);

    const secondNode = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "codex_text_extract",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequenceJsonLLM([jsonOutput("summary 2", "claim 2")]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const second = await secondNode.execute({ run, graph: run.graph });
    expect(second.status).toBe("success");

    const summariesAfterSecond = await readFile(path.join(".autoresearch", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const evidenceAfterSecond = await readFile(path.join(".autoresearch", "runs", runId, "evidence_store.jsonl"), "utf8");

    expect(summariesAfterSecond.trim().split("\n")).toHaveLength(2);
    expect(evidenceAfterSecond.trim().split("\n")).toHaveLength(2);
    expect(summariesAfterSecond.match(/"paper_id":"p1"/g)?.length).toBe(1);
    expect(summariesAfterSecond.match(/"paper_id":"p2"/g)?.length).toBe(1);
  });

  it("uses Responses API PDF analysis when configured and a PDF URL is present", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-analyze-pdf-api-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-pdf-api";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      {
        paper_id: "p1",
        title: "Paper 1",
        abstract: "Abstract 1",
        authors: ["Alice"],
        pdf_url: "https://example.com/p1.pdf"
      }
    ]);

    const responseClient = {
      hasApiKey: async () => true,
      analyzePdf: async () => ({ text: jsonOutput("pdf summary", "pdf claim") })
    } as unknown as ResponsesPdfAnalysisClient;

    const node = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "responses_api_pdf",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequenceJsonLLM(["should-not-be-used"]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: responseClient
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const summariesRaw = await readFile(path.join(".autoresearch", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesRaw).toContain('"source_type":"full_text"');
    expect(summariesRaw).toContain('"summary":"pdf summary"');
  });

  it("falls back to local text/abstract analysis when Responses API times out downloading a remote PDF", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-analyze-pdf-fallback-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-pdf-fallback";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      {
        paper_id: "p1",
        title: "Paper 1",
        abstract: "Abstract 1",
        authors: ["Alice"],
        pdf_url: "https://example.com/p1.pdf"
      }
    ]);

    globalThis.fetch = (async () => new Response("missing", { status: 404 })) as typeof fetch;

    const eventStream = new InMemoryEventStream();
    const responseClient = {
      hasApiKey: async () => true,
      analyzePdf: async () => {
        throw new Error(
          'Responses API request failed: 400 { "error": { "message": "Timeout while downloading https://example.com/p1.pdf" } }'
        );
      }
    } as unknown as ResponsesPdfAnalysisClient;

    const node = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "responses_api_pdf",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new SequenceJsonLLM([jsonOutput("fallback summary", "fallback claim")]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: responseClient
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const summariesRaw = await readFile(path.join(".autoresearch", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesRaw).toContain('"summary":"fallback summary"');
    expect(summariesRaw).toContain('"source_type":"abstract"');

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("Responses API could not download the remote PDF"))).toBe(true);
    expect(loggedTexts.some((text) => text.includes("Falling back to abstract for \"Paper 1\" after Responses API fallback"))).toBe(true);
  });

  it("analyzes only the selected top-N papers when a request is provided", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-analyze-topn-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-topn";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      {
        paper_id: "p1",
        title: "Multi-agent collaboration benchmark",
        abstract: "A",
        authors: ["Alice"],
        citation_count: 80,
        year: 2025
      },
      {
        paper_id: "p2",
        title: "Multi-agent planning systems",
        abstract: "B",
        authors: ["Bob"],
        citation_count: 60,
        year: 2024
      },
      {
        paper_id: "p3",
        title: "Irrelevant legacy retrieval",
        abstract: "C",
        authors: ["Carol"],
        citation_count: 5,
        year: 2018
      }
    ]);
    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    await runContext.put("analyze_papers.request", {
      topN: 2,
      selectionMode: "top_n",
      selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
    });

    const node = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "codex_text_extract",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequenceJsonLLM([
        JSON.stringify({ ordered_paper_ids: ["p2", "p1"] }),
        jsonOutput("summary 2", "claim 2"),
        jsonOutput("summary 1", "claim 1")
      ]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");

    const summariesRaw = await readFile(path.join(".autoresearch", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const manifestRaw = await readFile(path.join(".autoresearch", "runs", runId, "analysis_manifest.json"), "utf8");
    expect(summariesRaw.trim().split("\n")).toHaveLength(2);
    expect(summariesRaw).toContain('"paper_id":"p1"');
    expect(summariesRaw).toContain('"paper_id":"p2"');
    expect(summariesRaw).not.toContain('"paper_id":"p3"');
    expect(manifestRaw).toContain('"selectedPaperIds": [');
    expect(manifestRaw).toContain('"p2"');
    expect(manifestRaw).toContain('"selectionFingerprint"');
  });

  it("replaces prior selection outputs when top-N changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-analyze-topn-replace-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-topn-replace";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      { paper_id: "p1", title: "Multi-agent collaboration benchmark", abstract: "A", authors: ["Alice"], citation_count: 80, year: 2025 },
      { paper_id: "p2", title: "Multi-agent planning systems", abstract: "B", authors: ["Bob"], citation_count: 60, year: 2024 },
      { paper_id: "p3", title: "Legacy retrieval", abstract: "C", authors: ["Carol"], citation_count: 5, year: 2018 }
    ]);

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    await runContext.put("analyze_papers.request", {
      topN: 2,
      selectionMode: "top_n",
      selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
    });

    const firstNode = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "codex_text_extract",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequenceJsonLLM([
        JSON.stringify({ ordered_paper_ids: ["p1", "p2"] }),
        jsonOutput("summary 1", "claim 1"),
        jsonOutput("summary 2", "claim 2")
      ]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });
    const first = await firstNode.execute({ run, graph: run.graph });
    expect(first.status).toBe("success");

    await runContext.put("analyze_papers.request", {
      topN: 1,
      selectionMode: "top_n",
      selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
    });
    const secondNode = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "codex_text_extract",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequenceJsonLLM([
        JSON.stringify({ ordered_paper_ids: ["p2", "p1", "p3"] }),
        jsonOutput("summary new", "claim new")
      ]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });
    const second = await secondNode.execute({ run, graph: run.graph });
    expect(second.status).toBe("success");

    const summariesRaw = await readFile(path.join(".autoresearch", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const evidenceRaw = await readFile(path.join(".autoresearch", "runs", runId, "evidence_store.jsonl"), "utf8");
    expect(summariesRaw.trim().split("\n")).toHaveLength(1);
    expect(evidenceRaw.trim().split("\n")).toHaveLength(1);
    expect(summariesRaw).toContain('"paper_id":"p2"');
    expect(summariesRaw).not.toContain('"paper_id":"p1"');
  });
});
