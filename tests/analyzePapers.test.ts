import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { createAnalyzePapersNode } from "../src/core/nodes/analyzePapers.js";
import { createGenerateHypothesesNode } from "../src/core/nodes/generateHypotheses.js";
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

  override async complete(_prompt: string): Promise<{ text: string }> {
    const output = this.outputs[Math.min(this.index, this.outputs.length - 1)] ?? "";
    this.index += 1;
    return { text: output };
  }
}

class CountingJsonLLM extends MockLLMClient {
  private index = 0;
  callCount = 0;

  constructor(private readonly outputs: string[]) {
    super();
  }

  override async complete(_prompt: string): Promise<{ text: string }> {
    const output = this.outputs[Math.min(this.index, this.outputs.length - 1)] ?? "";
    this.index += 1;
    this.callCount += 1;
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
      runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
      longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
      episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
    }
  };
}

async function writeCorpus(runId: string, rows: unknown[]): Promise<void> {
  const dir = path.join(".autolabos", "runs", runId);
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

function hypothesisPipelineOutputs(evidenceId = "ev_p1_1"): string[] {
  return [
    JSON.stringify({
      summary: "Mapped evidence into one intervention axis.",
      axes: [
        {
          id: "ax_1",
          label: "Execution feedback",
          mechanism: "Validator-backed correction reduces downstream errors.",
          intervention: "Add bounded execute-test-repair loops.",
          evidence_links: [evidenceId]
        }
      ]
    }),
    JSON.stringify({
      summary: "Generated mechanism drafts.",
      candidates: [
        {
          text: "Validator-backed repair loops will reduce failure variance across repeated runs.",
          novelty: 4,
          feasibility: 4,
          testability: 5,
          cost: 2,
          expected_gain: 5,
          evidence_links: [evidenceId],
          axis_ids: ["ax_1"],
          rationale: "Directly operationalizes the recovered evidence."
        }
      ]
    }),
    JSON.stringify({
      summary: "Generated contradiction drafts.",
      candidates: [
        {
          text: "Repair loops help less when tasks already have deterministic validators.",
          novelty: 3,
          feasibility: 4,
          testability: 3,
          cost: 2,
          expected_gain: 2,
          evidence_links: [evidenceId],
          axis_ids: ["ax_1"],
          rationale: "Captures a plausible boundary condition."
        }
      ]
    }),
    JSON.stringify({
      summary: "Generated intervention drafts.",
      candidates: [
        {
          text: "Batched execute-test-repair loops will improve reproducibility more than discussion-only retries.",
          novelty: 4,
          feasibility: 5,
          testability: 5,
          cost: 2,
          expected_gain: 5,
          evidence_links: [evidenceId],
          axis_ids: ["ax_1"],
          rationale: "Turns evidence into a concrete, testable intervention."
        }
      ]
    }),
    JSON.stringify({
      summary: "Selected the strongest drafts.",
      reviews: [
        {
          candidate_id: "mechanism_1",
          keep: true,
          groundedness: 5,
          causal_clarity: 5,
          falsifiability: 5,
          experimentability: 5,
          reproducibility_specificity: 4,
          reproducibility_signals: ["repeatability"],
          measurement_hint: "Measure repeated-run failure variance on the repaired benchmark.",
          limitation_reflection: 4,
          measurement_readiness: 5,
          strengths: ["Directly tied to the evidence."],
          weaknesses: ["Needs benchmark scoping."],
          critique_summary: "Strong."
        },
        {
          candidate_id: "contradiction_1",
          keep: false,
          groundedness: 3,
          causal_clarity: 3,
          falsifiability: 3,
          experimentability: 2,
          reproducibility_specificity: 2,
          reproducibility_signals: [],
          limitation_reflection: 2,
          measurement_readiness: 1,
          strengths: ["Reasonable boundary condition."],
          weaknesses: ["Less actionable."],
          critique_summary: "Too weak for top selection."
        },
        {
          candidate_id: "intervention_1",
          keep: true,
          groundedness: 5,
          causal_clarity: 5,
          falsifiability: 5,
          experimentability: 5,
          reproducibility_specificity: 5,
          reproducibility_signals: ["repeated runs", "variance reduction"],
          measurement_hint: "Compare repeated-run variance against discussion-only retries.",
          limitation_reflection: 4,
          measurement_readiness: 5,
          strengths: ["Highly testable."],
          weaknesses: ["Adds execution cost."],
          critique_summary: "Excellent."
        }
      ]
    })
  ];
}

describe("analyzePapers node", () => {
  it("writes structured summaries, evidence, and manifest for analyzed papers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-"));
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
          pdf_mode: "codex_text_image_hybrid",
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

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const evidenceRaw = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8");
    const manifestRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8");
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
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-resume-"));
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
          pdf_mode: "codex_text_image_hybrid",
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

    const summariesAfterFirst = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesAfterFirst.trim().split("\n")).toHaveLength(1);

    const secondNode = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "codex_text_image_hybrid",
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

    const summariesAfterSecond = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const evidenceAfterSecond = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8");

    expect(summariesAfterSecond.trim().split("\n")).toHaveLength(2);
    expect(evidenceAfterSecond.trim().split("\n")).toHaveLength(2);
    expect(summariesAfterSecond.match(/"paper_id":"p1"/g)?.length).toBe(1);
    expect(summariesAfterSecond.match(/"paper_id":"p2"/g)?.length).toBe(1);
  });

  it("uses Responses API PDF analysis when configured and a PDF URL is present", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-pdf-api-"));
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
    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesRaw).toContain('"source_type":"full_text"');
    expect(summariesRaw).toContain('"summary":"pdf summary"');
  });

  it("falls back to local text/abstract analysis when Responses API times out downloading a remote PDF", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-pdf-fallback-"));
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
    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesRaw).toContain('"summary":"fallback summary"');
    expect(summariesRaw).toContain('"source_type":"abstract"');

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("Responses API could not download the remote PDF"))).toBe(true);
    expect(loggedTexts.some((text) => text.includes("Falling back to abstract for \"Paper 1\" after Responses API fallback"))).toBe(true);
  });

  it("falls back to local text/abstract analysis when Responses API returns upstream 403 while downloading a remote PDF", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-pdf-403-fallback-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-pdf-403-fallback";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      {
        paper_id: "p1",
        title: "Paper 1",
        abstract: "Abstract 1",
        authors: ["Alice"],
        pdf_url: "https://www.proceedings.com/content/079/079017-4397open.pdf"
      }
    ]);

    globalThis.fetch = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;

    const eventStream = new InMemoryEventStream();
    const responseClient = {
      hasApiKey: async () => true,
      analyzePdf: async () => {
        throw new Error(
          'Responses API request failed: 400 { "error": { "message": "Error while downloading https://www.proceedings.com/content/079/079017-4397open.pdf. Upstream status code: 403.", "type": "invalid_request_error", "param": "url" } }'
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
    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesRaw).toContain('"summary":"fallback summary"');
    expect(summariesRaw).toContain('"source_type":"abstract"');

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("Responses API could not download the remote PDF"))).toBe(true);
    expect(loggedTexts.some((text) => text.includes("Upstream status code: 403"))).toBe(true);
    expect(loggedTexts.some((text) => text.includes("Falling back to abstract for \"Paper 1\" after Responses API fallback"))).toBe(true);
    expect(loggedTexts.some((text) => text.includes('Analysis failed for "Paper 1"'))).toBe(false);
  });

  it("analyzes only the selected top-N papers when a request is provided", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-topn-"));
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
          pdf_mode: "codex_text_image_hybrid",
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

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const manifestRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8");
    expect(summariesRaw.trim().split("\n")).toHaveLength(2);
    expect(summariesRaw).toContain('"paper_id":"p1"');
    expect(summariesRaw).toContain('"paper_id":"p2"');
    expect(summariesRaw).not.toContain('"paper_id":"p3"');
    expect(manifestRaw).toContain('"selectedPaperIds": [');
    expect(manifestRaw).toContain('"p2"');
    expect(manifestRaw).toContain('"selectionFingerprint"');
  });

  it("reuses cached rerank selection when request and corpus are unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-rerank-cache-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-rerank-cache";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      {
        paper_id: "p1",
        title: "Paper 1",
        abstract: "Abstract 1",
        authors: ["Alice"],
        pdf_url: "https://example.com/p1.pdf"
      },
      {
        paper_id: "p2",
        title: "Paper 2",
        abstract: "Abstract 2",
        authors: ["Bob"],
        pdf_url: "https://example.com/p2.pdf"
      },
      {
        paper_id: "p3",
        title: "Paper 3",
        abstract: "Abstract 3",
        authors: ["Cara"],
        pdf_url: "https://example.com/p3.pdf"
      }
    ]);

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    await runContext.put("analyze_papers.request", {
      topN: 1,
      selectionMode: "top_n",
      selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
    });

    const firstRerankLlm = new CountingJsonLLM([
      JSON.stringify({
        ordered_paper_ids: ["p2", "p1", "p3"]
      })
    ]);
    let analyzePdfCalls = 0;
    const firstNode = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "responses_api_pdf",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: firstRerankLlm,
      pdfTextLlm: new SequenceJsonLLM([]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: async () => {
          analyzePdfCalls += 1;
          return { text: jsonOutput("pdf summary", "pdf claim") };
        }
      } as unknown as ResponsesPdfAnalysisClient
    });

    const first = await firstNode.execute({ run, graph: run.graph });
    expect(first.status).toBe("success");
    expect(firstRerankLlm.callCount).toBe(1);
    expect(analyzePdfCalls).toBe(1);

    const secondRerankLlm = new CountingJsonLLM(["should-not-be-used"]);
    const secondEventStream = new InMemoryEventStream();
    const secondNode = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "responses_api_pdf",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: secondEventStream,
      llm: secondRerankLlm,
      pdfTextLlm: new SequenceJsonLLM([]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: async () => {
          throw new Error("analysis should not rerun");
        }
      } as unknown as ResponsesPdfAnalysisClient
    });

    const second = await secondNode.execute({ run, graph: run.graph });
    expect(second.status).toBe("success");
    expect(secondRerankLlm.callCount).toBe(0);

    const secondLogs = secondEventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(secondLogs.some((text) => text.includes("Reusing cached paper rerank from analysis_manifest.json"))).toBe(true);
    expect(secondLogs.some((text) => text.includes("Preparing LLM rerank for"))).toBe(false);

    const manifestRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8");
    expect(manifestRaw).toContain('"selectionRequestFingerprint"');
    expect(manifestRaw).toContain('"corpusFingerprint"');
  });

  it("auto-expands a sparse top-N selection and preserves completed analyses", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-topn-expand-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-topn-expand";
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
        title: "Legacy retrieval",
        abstract: "C",
        authors: ["Carol"],
        citation_count: 5,
        year: 2018
      }
    ]);
    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    await runContext.put("analyze_papers.request", {
      topN: 1,
      selectionMode: "top_n",
      selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
    });

    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "codex_text_image_hybrid",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new SequenceJsonLLM([
        JSON.stringify({ ordered_paper_ids: ["p1", "p2", "p3"] }),
        jsonOutput("summary 1", "claim 1"),
        JSON.stringify({ ordered_paper_ids: ["p1", "p2", "p3"] }),
        jsonOutput("summary 2", "claim 2")
      ]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(result.summary).toContain("Auto-expanded the analysis window 1 time(s)");

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesRaw.trim().split("\n")).toHaveLength(2);
    expect(summariesRaw.match(/"paper_id":"p1"/g)?.length).toBe(1);
    expect(summariesRaw.match(/"paper_id":"p2"/g)?.length).toBe(1);

    const manifestRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8");
    expect(manifestRaw).toContain('"selectedPaperIds": [');
    expect(manifestRaw).toContain('"p1"');
    expect(manifestRaw).toContain('"p2"');

    expect(await runContext.get("analyze_papers.request")).toMatchObject({
      topN: 2,
      selectionMode: "top_n"
    });
    expect(await runContext.get("analyze_papers.auto_expand_count")).toBe(1);

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("Auto-expanding to top 2"))).toBe(true);
    expect(
      loggedTexts.some((text) =>
        text.includes("Expanding analysis selection from top 1 to top 2; preserving completed analyses")
      )
    ).toBe(true);
  });

  it("replaces prior selection outputs when top-N changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-topn-replace-"));
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
          pdf_mode: "codex_text_image_hybrid",
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
          pdf_mode: "codex_text_image_hybrid",
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

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const evidenceRaw = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8");
    expect(summariesRaw.trim().split("\n")).toHaveLength(1);
    expect(evidenceRaw.trim().split("\n")).toHaveLength(1);
    expect(summariesRaw).toContain('"paper_id":"p2"');
    expect(summariesRaw).not.toContain('"paper_id":"p1"');
  });

  it("re-analyzes papers when the analysis mode fingerprint changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-mode-change-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-mode-change";
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

    const firstNode = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "codex_text_image_hybrid",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequenceJsonLLM([jsonOutput("local summary", "local claim")]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const first = await firstNode.execute({ run, graph: run.graph });
    expect(first.status).toBe("success");

    let analyzePdfCalls = 0;
    const secondEventStream = new InMemoryEventStream();
    const secondNode = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "responses_api_pdf",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: secondEventStream,
      llm: new SequenceJsonLLM(["should-not-be-used"]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: async () => {
          analyzePdfCalls += 1;
          return { text: jsonOutput("pdf summary", "pdf claim") };
        }
      } as unknown as ResponsesPdfAnalysisClient
    });

    const second = await secondNode.execute({ run, graph: run.graph });
    expect(second.status).toBe("success");
    expect(analyzePdfCalls).toBe(1);

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesRaw.trim().split("\n")).toHaveLength(1);
    expect(summariesRaw).toContain('"summary":"pdf summary"');
    expect(summariesRaw).toContain('"source_type":"full_text"');
    expect(summariesRaw).not.toContain('"summary":"local summary"');
    const loggedTexts = secondEventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("Analysis settings changed since the previous run."))).toBe(true);
  });

  it("repairs missing output artifacts and restores downstream hypothesis generation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-repair-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-repair";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      { paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] }
    ]);

    const firstNode = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "codex_text_image_hybrid",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequenceJsonLLM([jsonOutput("summary 1", "claim 1")]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const first = await firstNode.execute({ run, graph: run.graph });
    expect(first.status).toBe("success");

    await rm(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), { force: true });

    const secondEventStream = new InMemoryEventStream();
    const secondNode = createAnalyzePapersNode({
      config: {
        analysis: {
          pdf_mode: "codex_text_image_hybrid",
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: secondEventStream,
      llm: new SequenceJsonLLM([jsonOutput("summary repaired", "claim repaired")]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const second = await secondNode.execute({ run, graph: run.graph });
    expect(second.status).toBe("success");

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const evidenceRaw = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8");
    expect(summariesRaw.trim().split("\n")).toHaveLength(1);
    expect(evidenceRaw.trim().split("\n")).toHaveLength(1);
    expect(summariesRaw).toContain('"summary":"summary repaired"');
    expect(summariesRaw).not.toContain('"summary":"summary 1"');

    const analyzeLogs = secondEventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(analyzeLogs.some((text) => text.includes("Detected inconsistent analysis artifacts."))).toBe(true);
    expect(analyzeLogs.some((text) => text.includes("Re-queueing 1 completed paper(s)"))).toBe(true);

    const generateNode = createGenerateHypothesesNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequenceJsonLLM(hypothesisPipelineOutputs("ev_p1_1")),
      pdfTextLlm: new SequenceJsonLLM([]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const generated = await generateNode.execute({ run, graph: run.graph });
    expect(generated.status).toBe("success");

    const hypothesesRaw = await readFile(path.join(".autolabos", "runs", runId, "hypotheses.jsonl"), "utf8");
    expect(hypothesesRaw.trim().split("\n").length).toBeGreaterThan(0);
    expect(hypothesesRaw).toContain('"evidence_links":["ev_p1_1"]');
    expect(hypothesesRaw).toContain('"paper_titles":["Paper 1"]');
  });
});
