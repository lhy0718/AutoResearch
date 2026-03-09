import { describe, expect, it } from "vitest";

import {
  analyzePaperWithLlm,
  analyzePaperWithResponsesPdf,
  normalizePaperAnalysis,
  parsePaperAnalysisJson
} from "../src/core/analysis/paperAnalyzer.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { AnalysisCorpusRow, ResolvedPaperSource } from "../src/core/analysis/paperText.js";
import { ResponsesPdfAnalysisClient } from "../src/integrations/openai/responsesPdfAnalysisClient.js";

class SequenceLLM extends MockLLMClient {
  private index = 0;

  constructor(private readonly outputs: string[]) {
    super();
  }

  override async complete(): Promise<{ text: string }> {
    const next = this.outputs[Math.min(this.index, this.outputs.length - 1)] ?? "";
    this.index += 1;
    return { text: next };
  }
}

const paper: AnalysisCorpusRow = {
  paper_id: "paper-1",
  title: "Agentic Workflows for Science",
  abstract: "This paper studies agentic workflows and reports strong results.",
  authors: ["Alice Kim"],
  year: 2025,
  venue: "NeurIPS",
  citation_count: 42
};

const source: ResolvedPaperSource = {
  sourceType: "abstract",
  text: "Abstract: This paper studies agentic workflows and reports strong results.",
  fullTextAvailable: false,
  fallbackReason: "no_pdf_url"
};

describe("paperAnalyzer", () => {
  it("parses fenced JSON responses", () => {
    const parsed = parsePaperAnalysisJson('```json\n{"summary":"ok","evidence_items":[]}\n```');
    expect(parsed.summary).toBe("ok");
  });

  it("normalizes structured output into summary and evidence rows", () => {
    const normalized = normalizePaperAnalysis(paper, source, {
      summary: "A concise summary",
      key_findings: ["Finding A"],
      limitations: ["Limitation A"],
      datasets: ["Dataset A"],
      metrics: ["Accuracy"],
      novelty: "Novel contribution",
      reproducibility_notes: ["Code unavailable"],
      evidence_items: [
        {
          claim: "Agents improve performance.",
          method_slot: "Prompted agent workflow",
          result_slot: "Accuracy improved by 10%.",
          limitation_slot: "Only tested on one benchmark.",
          dataset_slot: "ScienceBench",
          metric_slot: "Accuracy",
          evidence_span: "Accuracy improved by 10%.",
          confidence: 0.8
        }
      ]
    });

    expect(normalized.summaryRow.summary).toBe("A concise summary");
    expect(normalized.summaryRow.key_findings).toEqual(["Finding A"]);
    expect(normalized.evidenceRows[0].claim).toBe("Agents improve performance.");
    expect(normalized.evidenceRows[0].source_type).toBe("abstract");
    expect(normalized.evidenceRows[0].confidence).toBe(0.8);
  });

  it("retries once when the first LLM output is invalid JSON", async () => {
    const llm = new SequenceLLM([
      "not-json",
      JSON.stringify({
        summary: "Recovered summary",
        key_findings: ["Recovered finding"],
        limitations: ["Recovered limitation"],
        datasets: ["Recovered dataset"],
        metrics: ["Recovered metric"],
        novelty: "Recovered novelty",
        reproducibility_notes: ["Recovered reproducibility note"],
        evidence_items: [{ claim: "Recovered claim", confidence: 0.7 }]
      })
    ]);

    const result = await analyzePaperWithLlm({
      llm,
      paper,
      source,
      maxAttempts: 2
    });

    expect(result.attempts).toBe(2);
    expect(result.summaryRow.summary).toBe("Recovered summary");
    expect(result.evidenceRows[0].claim).toBe("Recovered claim");
  });

  it("normalizes Responses API PDF analysis results", async () => {
    const client = {
      analyzePdf: async () => ({
        text: JSON.stringify({
          summary: "PDF summary",
          key_findings: ["PDF finding"],
          limitations: ["PDF limitation"],
          datasets: ["PDF dataset"],
          metrics: ["PDF metric"],
          novelty: "PDF novelty",
          reproducibility_notes: ["PDF repro"],
          evidence_items: [{ claim: "PDF claim", confidence: 0.9 }]
        })
      })
    } as unknown as ResponsesPdfAnalysisClient;

    const result = await analyzePaperWithResponsesPdf({
      client,
      paper,
      pdfUrl: "https://example.com/paper.pdf",
      model: "gpt-5.4"
    });

    expect(result.summaryRow.summary).toBe("PDF summary");
    expect(result.summaryRow.source_type).toBe("full_text");
    expect(result.evidenceRows[0].claim).toBe("PDF claim");
  });

  it("propagates abort during text LLM analysis", async () => {
    const controller = new AbortController();
    const llm = {
      complete: (_prompt: string, opts?: { abortSignal?: AbortSignal }) =>
        new Promise<{ text: string }>((_resolve, reject) => {
          opts?.abortSignal?.addEventListener(
            "abort",
            () => reject(new Error("Operation aborted by user")),
            { once: true }
          );
        })
    };

    const promise = analyzePaperWithLlm({
      llm: llm as any,
      paper,
      source,
      abortSignal: controller.signal
    });

    controller.abort();

    await expect(promise).rejects.toThrow("Operation aborted by user");
  });
});
