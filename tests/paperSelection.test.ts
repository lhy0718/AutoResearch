import { describe, expect, it } from "vitest";

import { MockLLMClient } from "../src/core/llm/client.js";
import {
  buildSelectionFingerprint,
  normalizeAnalysisSelectionRequest,
  selectPapersForAnalysis
} from "../src/core/analysis/paperSelection.js";

class FixedResponseLlm extends MockLLMClient {
  constructor(private readonly text: string) {
    super();
  }

  override async complete(_prompt: string): Promise<{ text: string }> {
    return { text: this.text };
  }
}

describe("paperSelection", () => {
  it("deterministically favors title similarity, citations, and recency", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm('{"ordered_paper_ids":["p1","p2","p3"]}'),
      runTitle: "Multi-agent collaboration",
      runTopic: "Multi-agent collaboration",
      request: normalizeAnalysisSelectionRequest(2),
      corpusRows: [
        {
          paper_id: "p1",
          title: "Multi-agent collaboration for research",
          abstract: "A",
          authors: [],
          citation_count: 100,
          year: new Date().getUTCFullYear()
        },
        {
          paper_id: "p2",
          title: "Single-agent browser automation",
          abstract: "B",
          authors: [],
          citation_count: 400,
          year: new Date().getUTCFullYear() - 1
        },
        {
          paper_id: "p3",
          title: "Legacy information retrieval",
          abstract: "C",
          authors: [],
          citation_count: 10,
          year: new Date().getUTCFullYear() - 8
        }
      ]
    });

    expect(selection.selectedPaperIds).toEqual(["p1", "p2"]);
    expect(selection.rankedCandidates[0]?.paper.paper_id).toBe("p1");
    expect(selection.rankedCandidates.find((candidate) => candidate.paper.paper_id === "p1")?.scoreBreakdown.title_similarity_score).toBeGreaterThan(
      selection.rankedCandidates.find((candidate) => candidate.paper.paper_id === "p2")?.scoreBreakdown.title_similarity_score ?? 0
    );
  });

  it("boosts PDF-available papers in the deterministic pre-rank", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm('{"ordered_paper_ids":["p1","p2","p3"]}'),
      runTitle: "Multi-agent collaboration reproducibility",
      runTopic: "Multi-agent collaboration reproducibility",
      request: normalizeAnalysisSelectionRequest(2),
      corpusRows: [
        {
          paper_id: "p1",
          title: "Multi-agent collaboration reproducibility benchmark",
          abstract: "A",
          authors: [],
          citation_count: 60,
          year: 2024,
          pdf_url: "https://example.com/p1.pdf"
        },
        {
          paper_id: "p2",
          title: "Multi-agent collaboration reproducibility study",
          abstract: "B",
          authors: [],
          citation_count: 95,
          year: 2025
        },
        {
          paper_id: "p3",
          title: "Legacy retrieval systems",
          abstract: "C",
          authors: [],
          citation_count: 10,
          year: 2019
        }
      ]
    });

    const p1 = selection.rankedCandidates.find((candidate) => candidate.paper.paper_id === "p1");
    const p2 = selection.rankedCandidates.find((candidate) => candidate.paper.paper_id === "p2");

    expect(p1?.scoreBreakdown.pdf_availability_score).toBe(1);
    expect(p2?.scoreBreakdown.pdf_availability_score).toBe(0);
    expect(p1?.deterministicScore).toBeGreaterThan(p2?.deterministicScore ?? 0);
    expect(selection.selectedPaperIds).toContain("p1");
  });

  it("treats PDF-like URLs in paper.url as PDF-available for ranking", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm("not-json"),
      runTitle: "Multi-agent collaboration reproducibility",
      runTopic: "Multi-agent collaboration reproducibility",
      request: normalizeAnalysisSelectionRequest(1),
      corpusRows: [
        {
          paper_id: "p1",
          title: "Multi-agent collaboration reproducibility benchmark",
          abstract: "A",
          authors: [],
          citation_count: 60,
          year: 2024,
          url: "https://example.com/p1.pdf"
        },
        {
          paper_id: "p2",
          title: "Multi-agent collaboration reproducibility study",
          abstract: "B",
          authors: [],
          citation_count: 70,
          year: 2025
        }
      ]
    });

    const p1 = selection.rankedCandidates.find((candidate) => candidate.paper.paper_id === "p1");
    expect(p1?.scoreBreakdown.pdf_availability_score).toBe(1);
    expect(selection.selectedPaperIds).toEqual(["p1"]);
  });

  it("uses min(total, min(max(3N, 30), 90)) for the rerank candidate pool", async () => {
    const corpusRows = Array.from({ length: 80 }, (_, index) => ({
      paper_id: `p${index + 1}`,
      title: `Paper ${index + 1}`,
      abstract: `Abstract ${index + 1}`,
      authors: [],
      citation_count: 80 - index,
      year: 2025
    }));

    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm(
        JSON.stringify({
          ordered_paper_ids: Array.from({ length: 50 }, (_, index) => `p${index + 1}`)
        })
      ),
      runTitle: "Paper",
      runTopic: "Paper",
      request: normalizeAnalysisSelectionRequest(8),
      corpusRows
    });

    expect(selection.candidatePoolSize).toBe(30);
    expect(selection.selectedPaperIds).toHaveLength(8);
  });

  it("emits detailed rerank progress messages", async () => {
    const logs: string[] = [];
    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm('{"ordered_paper_ids":["p1","p2","p3"]}'),
      runTitle: "Multi-agent collaboration",
      runTopic: "Multi-agent collaboration",
      request: normalizeAnalysisSelectionRequest(2),
      corpusRows: [
        { paper_id: "p1", title: "Multi-agent collaboration", abstract: "A", authors: [], citation_count: 10, year: 2025 },
        { paper_id: "p2", title: "Other collaboration paper", abstract: "B", authors: [], citation_count: 9, year: 2025 },
        { paper_id: "p3", title: "Legacy retrieval", abstract: "C", authors: [], citation_count: 8, year: 2024 }
      ],
      onProgress: (message) => logs.push(message)
    });

    expect(selection.selectedPaperIds).toEqual(["p1", "p2"]);
    expect(logs.some((message) => message.includes("Preparing LLM rerank for"))).toBe(true);
    expect(logs.some((message) => message.includes("Rerank progress: 1/4"))).toBe(true);
    expect(logs.some((message) => message.includes("Submitting rerank request"))).toBe(true);
    expect(logs.some((message) => message.includes("Rerank progress: 2/4"))).toBe(true);
    expect(logs.some((message) => message.includes("Received rerank response. Parsing JSON ordering."))).toBe(true);
    expect(logs.some((message) => message.includes("Rerank progress: 3/4"))).toBe(true);
    expect(logs.some((message) => message.includes("Parsed rerank JSON with"))).toBe(true);
    expect(logs.some((message) => message.includes("Rerank progress: 4/4"))).toBe(true);
    expect(logs.some((message) => message.includes("LLM rerank completed. Top selection preview"))).toBe(true);
  });

  it("falls back to deterministic order when rerank JSON is invalid", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm("not-json"),
      runTitle: "Multi-agent collaboration",
      runTopic: "Multi-agent collaboration",
      request: normalizeAnalysisSelectionRequest(2),
      corpusRows: [
        { paper_id: "p1", title: "Multi-agent collaboration", abstract: "A", authors: [], citation_count: 10, year: 2025 },
        { paper_id: "p2", title: "Other paper", abstract: "B", authors: [], citation_count: 9, year: 2025 },
        { paper_id: "p3", title: "Legacy retrieval", abstract: "C", authors: [], citation_count: 8, year: 2024 }
      ]
    });

    expect(selection.rerankApplied).toBe(false);
    expect(selection.rerankFallbackReason).toBeDefined();
    expect(selection.selectedPaperIds).toEqual(["p1", "p2"]);
  });

  it("propagates abort instead of falling back when rerank is canceled", async () => {
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

    const promise = selectPapersForAnalysis({
      llm: llm as any,
      runTitle: "Multi-agent collaboration",
      runTopic: "Multi-agent collaboration",
      request: normalizeAnalysisSelectionRequest(2),
      corpusRows: [
        { paper_id: "p1", title: "Multi-agent collaboration", abstract: "A", authors: [], citation_count: 10, year: 2025 },
        { paper_id: "p2", title: "Other paper", abstract: "B", authors: [], citation_count: 9, year: 2025 },
        { paper_id: "p3", title: "Legacy retrieval", abstract: "C", authors: [], citation_count: 8, year: 2024 }
      ],
      abortSignal: controller.signal
    });

    controller.abort();

    await expect(promise).rejects.toThrow("Operation aborted by user");
  });

  it("builds a stable fingerprint from request, title/topic, and selected ids", () => {
    const request = normalizeAnalysisSelectionRequest(10);
    const left = buildSelectionFingerprint(request, "Title", "Topic", ["p1", "p2"]);
    const right = buildSelectionFingerprint(request, "Title", "Topic", ["p1", "p2"]);
    const different = buildSelectionFingerprint(request, "Title", "Topic", ["p2", "p1"]);

    expect(left).toBe(right);
    expect(left).not.toBe(different);
  });
});
