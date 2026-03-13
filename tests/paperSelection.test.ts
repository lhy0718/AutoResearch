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

class SequenceResponseLlm extends MockLLMClient {
  private index = 0;

  constructor(private readonly outputs: Array<string | Error>) {
    super();
  }

  override async complete(_prompt: string): Promise<{ text: string }> {
    const output = this.outputs[Math.min(this.index, this.outputs.length - 1)];
    this.index += 1;
    if (output instanceof Error) {
      throw output;
    }
    return { text: output };
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
      llm: new FixedResponseLlm('{"ordered_paper_ids":["p1","p2"]}'),
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

  it("pauses top-n selection when rerank JSON is invalid", async () => {
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
    expect(selection.selectedPaperIds).toEqual([]);
  });

  it("repairs truncated rerank JSON when only the closing delimiter is missing", async () => {
    const logs: string[] = [];
    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm('{"ordered_paper_ids":["p2","p1"]'),
      runTitle: "Multi-agent collaboration",
      runTopic: "Multi-agent collaboration",
      request: normalizeAnalysisSelectionRequest(1),
      corpusRows: [
        { paper_id: "p1", title: "Multi-agent collaboration", abstract: "A", authors: [], citation_count: 10, year: 2025 },
        { paper_id: "p2", title: "Other collaboration paper", abstract: "B", authors: [], citation_count: 9, year: 2025 }
      ],
      onProgress: (message) => logs.push(message)
    });

    expect(selection.rerankApplied).toBe(true);
    expect(selection.selectedPaperIds).toEqual(["p2"]);
    expect(logs.some((message) => message.includes("Rerank JSON looked truncated; repaired"))).toBe(true);
  });

  it("retries rerank once when Codex only emits benign shell-snapshot cleanup warnings", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new SequenceResponseLlm([
        new Error(
          '2026-03-12T08:56:03.104783Z  WARN codex_core::shell_snapshot: Failed to delete shell snapshot at "/Users/hanyonglee/.codex/shell_snapshots/tmp": Os { code: 2, kind: NotFound, message: "No such file or directory" }'
        ),
        '{"ordered_paper_ids":["p2","p1"]}'
      ]),
      runTitle: "Multi-agent collaboration",
      runTopic: "Multi-agent collaboration",
      request: normalizeAnalysisSelectionRequest(1),
      corpusRows: [
        { paper_id: "p1", title: "Multi-agent collaboration", abstract: "A", authors: [], citation_count: 10, year: 2025 },
        { paper_id: "p2", title: "Other collaboration paper", abstract: "B", authors: [], citation_count: 9, year: 2025 }
      ]
    });

    expect(selection.rerankApplied).toBe(true);
    expect(selection.rerankFallbackReason).toBeUndefined();
    expect(selection.selectedPaperIds).toEqual(["p2"]);
  });

  it("keeps only the substantive rerank failure when benign cleanup warnings are mixed in", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new SequenceResponseLlm([
        new Error(
          '2026-03-12T08:56:03.104783Z  WARN codex_core::shell_snapshot: Failed to delete shell snapshot at "/Users/hanyonglee/.codex/shell_snapshots/tmp": Os { code: 2, kind: NotFound, message: "No such file or directory" }\n' +
            "2026-03-12T08:56:03.586264Z  WARN codex_core::codex: startup websocket prewarm setup failed: You've hit your usage limit for GPT-5.3-Codex-Spark. Switch to another model now, or try again at 8:24 PM."
        )
      ]),
      runTitle: "Multi-agent collaboration",
      runTopic: "Multi-agent collaboration",
      request: normalizeAnalysisSelectionRequest(1),
      corpusRows: [
        { paper_id: "p1", title: "Multi-agent collaboration", abstract: "A", authors: [], citation_count: 10, year: 2025 },
        { paper_id: "p2", title: "Other collaboration paper", abstract: "B", authors: [], citation_count: 9, year: 2025 }
      ]
    });

    expect(selection.rerankApplied).toBe(false);
    expect(selection.rerankFallbackReason).toContain("usage limit");
    expect(selection.rerankFallbackReason).not.toContain("shell_snapshot");
    expect(selection.selectedPaperIds).toEqual([]);
  });

  it("keeps topic-specific tabular baseline papers ahead of generic ML classification titles", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm('{"ordered_paper_ids":["relevant","off_topic"]}'),
      runTitle: "Classical machine learning baselines for tabular classification",
      runTopic: "Classical machine learning baselines for tabular classification",
      request: normalizeAnalysisSelectionRequest(1),
      corpusRows: [
        {
          paper_id: "off_topic",
          title: "A Study on Music Genre Classification using Machine Learning",
          abstract: "Music genre classification with neural and classical pipelines.",
          authors: [],
          citation_count: 500,
          year: 2025,
          pdf_url: "https://example.com/music.pdf"
        },
        {
          paper_id: "relevant",
          title: "Benchmarking classical baselines on structured datasets",
          abstract:
            "We compare logistic regression, random forests, and gradient boosting for tabular classification across small public benchmarks.",
          authors: [],
          citation_count: 20,
          year: 2024
        }
      ]
    });

    expect(selection.selectedPaperIds).toEqual(["relevant"]);
    expect(selection.deterministicRankingPreview[0]?.paper_id).toBe("relevant");
  });

  it("keeps multi-paper tabular baseline selections ahead of high-citation off-topic classification papers", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm('{"ordered_paper_ids":["relevant_title","relevant_abstract","off_topic_quantum","off_topic_music"]}'),
      runTitle: "Classical machine learning baselines for tabular classification",
      runTopic: "Classical machine learning baselines for tabular classification",
      request: normalizeAnalysisSelectionRequest(2),
      corpusRows: [
        {
          paper_id: "off_topic_quantum",
          title: "Quantum kernel benchmarking for financial classification",
          abstract: "Quantum kernels for stock-market classification with machine learning preprocessing on finance tabular features.",
          authors: [],
          citation_count: 450,
          year: 2025,
          pdf_url: "https://example.com/quantum.pdf"
        },
        {
          paper_id: "off_topic_music",
          title: "Music genre classification using machine learning pipelines",
          abstract: "Genre classification with classical and neural models.",
          authors: [],
          citation_count: 420,
          year: 2025,
          pdf_url: "https://example.com/music.pdf"
        },
        {
          paper_id: "relevant_title",
          title: "Classical baselines for tabular classification on public datasets",
          abstract: "We compare logistic regression, random forests, and gradient boosting for tabular classification.",
          authors: [],
          citation_count: 35,
          year: 2024
        },
        {
          paper_id: "relevant_abstract",
          title: "Benchmarking gradient boosting and logistic regression on UCI datasets",
          abstract: "Structured tabular classification benchmarks covering small public datasets and classical baselines.",
          authors: [],
          citation_count: 28,
          year: 2023
        }
      ]
    });

    expect(selection.selectedPaperIds).toEqual(["relevant_title", "relevant_abstract"]);
    expect(selection.deterministicRankingPreview.slice(0, 2).map((row) => row.paper_id)).toEqual([
      "relevant_title",
      "relevant_abstract"
    ]);
  });

  it("pushes secret, music, and sentiment papers below stronger tabular-baseline candidates in a tiny pool", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm(
        '{"ordered_paper_ids":["relevant_svm","relevant_pmlb","relevant_benchmark","off_topic_secret","off_topic_music","off_topic_sentiment"]}'
      ),
      runTitle: "Classical machine learning baselines for tabular classification on small public datasets",
      runTopic: "Classical machine learning baselines for tabular classification on small public datasets",
      request: normalizeAnalysisSelectionRequest(3),
      corpusRows: [
        {
          paper_id: "relevant_svm",
          title: "Cross-Dataset Evaluation of Support Vector Machines: A Reproducible, Calibration-Aware Baseline for Tabular Classification",
          abstract:
            "A calibration-aware benchmark compares SVM, logistic regression, decision tree, and random forest on small tabular datasets.",
          authors: [],
          citation_count: 5,
          year: 2025
        },
        {
          paper_id: "relevant_pmlb",
          title: "PMLBmini: A Tabular Classification Benchmark Suite for Data-Scarce Applications",
          abstract:
            "A benchmark suite for small tabular classification tasks compares classical linear baselines, AutoML, and tabular deep learning.",
          authors: [],
          citation_count: 120,
          year: 2024
        },
        {
          paper_id: "relevant_benchmark",
          title: "Benchmarking classical baselines on structured datasets",
          abstract:
            "We compare logistic regression, random forests, and gradient boosting for tabular classification across small public benchmarks.",
          authors: [],
          citation_count: 30,
          year: 2024
        },
        {
          paper_id: "off_topic_secret",
          title: "Secret Breach Prevention in Software Issue Reports",
          abstract:
            "We evaluate entropy heuristics, classical machine learning, deep learning, and LLM-based methods for secret detection.",
          authors: [],
          citation_count: 200,
          year: 2025
        },
        {
          paper_id: "off_topic_music",
          title: "Emotional response to music: the Emotify + dataset",
          abstract: "Abstract unavailable.",
          authors: [],
          citation_count: 100,
          year: 2025
        },
        {
          paper_id: "off_topic_sentiment",
          title: "Application of Sentiment Analysis to Labeling Characters as Good or Evil",
          abstract: "Abstract unavailable.",
          authors: [],
          citation_count: 0,
          year: 2025
        }
      ]
    });

    expect(new Set(selection.selectedPaperIds)).toEqual(new Set(["relevant_svm", "relevant_pmlb", "relevant_benchmark"]));
    expect(new Set(selection.deterministicRankingPreview.slice(0, 3).map((row) => row.paper_id))).toEqual(
      new Set(["relevant_svm", "relevant_pmlb", "relevant_benchmark"])
    );
    expect(selection.deterministicRankingPreview.slice(3).map((row) => row.paper_id)).toEqual([
      "off_topic_secret",
      "off_topic_music",
      "off_topic_sentiment"
    ]);
  });

  it("drops obviously off-topic tail papers even when lightweight analysis runs in all-mode", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm("not-json"),
      runTitle: "Classical machine learning baselines for tabular classification on small public datasets",
      runTopic: "Classical machine learning baselines for tabular classification on small public datasets",
      request: normalizeAnalysisSelectionRequest(null),
      corpusRows: [
        {
          paper_id: "relevant_pmlb",
          title: "PMLBmini: A Tabular Classification Benchmark Suite for Data-Scarce Applications",
          abstract:
            "A benchmark suite for small tabular classification tasks compares classical linear baselines, AutoML, and tabular deep learning.",
          authors: [],
          citation_count: 120,
          year: 2024
        },
        {
          paper_id: "relevant_svm",
          title: "Cross-Dataset Evaluation of Support Vector Machines: A Reproducible, Calibration-Aware Baseline for Tabular Classification",
          abstract:
            "A calibration-aware benchmark compares SVM, logistic regression, decision tree, and random forest on small tabular datasets.",
          authors: [],
          citation_count: 5,
          year: 2025
        },
        {
          paper_id: "relevant_benchmark",
          title: "Benchmarking classical baselines on structured datasets",
          abstract:
            "We compare logistic regression, random forests, and gradient boosting for tabular classification across small public benchmarks.",
          authors: [],
          citation_count: 30,
          year: 2024
        },
        {
          paper_id: "relevant_clinical",
          title: "Residual GRU+MHSA: A Lightweight Hybrid Recurrent Attention Model for Cardiovascular Disease Detection",
          abstract:
            "The abstract presents a compact model for tabular clinical records using the UCI Heart-Disease dataset.",
          authors: [],
          citation_count: 0,
          year: 2025
        },
        {
          paper_id: "off_topic_secret",
          title: "Secret Breach Prevention in Software Issue Reports",
          abstract:
            "We evaluate entropy heuristics, classical machine learning, deep learning, and LLM-based methods for secret detection.",
          authors: [],
          citation_count: 200,
          year: 2025
        },
        {
          paper_id: "off_topic_raman",
          title:
            "DeepRaman: Implementing surface-enhanced Raman scattering together with cutting-edge machine learning for the differentiation and classification of bacterial endotoxins",
          abstract:
            "A classification pipeline for bacterial endotoxin differentiation using Raman scattering and machine learning.",
          authors: [],
          citation_count: 230,
          year: 2025
        },
        {
          paper_id: "off_topic_music",
          title: "Emotional response to music: the Emotify + dataset",
          abstract: "Abstract unavailable.",
          authors: [],
          citation_count: 100,
          year: 2025
        },
        {
          paper_id: "off_topic_sentiment",
          title: "Application of Sentiment Analysis to Labeling Characters as Good or Evil",
          abstract: "Abstract unavailable.",
          authors: [],
          citation_count: 0,
          year: 2025
        }
      ]
    });

    expect(selection.request.selectionMode).toBe("all");
    expect(new Set(selection.selectedPaperIds)).toEqual(
      new Set(["relevant_pmlb", "relevant_svm", "relevant_benchmark"])
    );
    expect(selection.selectedPaperIds).not.toContain("off_topic_secret");
    expect(selection.selectedPaperIds).not.toContain("off_topic_music");
    expect(selection.selectedPaperIds).not.toContain("off_topic_sentiment");
    expect(selection.selectedPaperIds).not.toContain("off_topic_raman");
  });

  it("keeps a live DeepRaman-style abstract below tabular small-model papers in all-mode", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm("not-json"),
      runTitle: "CPU-Only Classical Tabular Classification Baselines on Small Public Datasets",
      runTopic: "Classical machine learning baselines for tabular classification on small public datasets.",
      request: normalizeAnalysisSelectionRequest(null),
      corpusRows: [
        {
          paper_id: "relevant_svm",
          title: "Cross-Dataset Evaluation of Support Vector Machines: A Reproducible, Calibration-Aware Baseline for Tabular Classification",
          abstract:
            "Support Vector Machines remain competitive for small and medium-sized tabular classification problems under leakage-safe pipelines.",
          authors: [],
          citation_count: 0,
          year: 2025
        },
        {
          paper_id: "relevant_pmlb",
          title: "PMLBmini: A Tabular Classification Benchmark Suite for Data-Scarce Applications",
          abstract:
            "We introduce a tabular benchmark suite of binary classification datasets with small sample sizes and compare classical linear models.",
          authors: [],
          citation_count: 3,
          year: 2024
        },
        {
          paper_id: "relevant_rax_chf",
          title: "RaX-CHF: A Resource-Efficient and Explainable Small-Model Pipeline for Congestive Heart Failure Prediction from ICU-Scale Tabular Data",
          abstract:
            "We compare classical machine learning baselines against a small language model on structured tabular ICU features for disease classification.",
          authors: [],
          citation_count: 0,
          year: 2026
        },
        {
          paper_id: "off_topic_raman",
          title:
            "DeepRaman: Implementing surface-enhanced Raman scattering together with cutting-edge machine learning for the differentiation and classification of bacterial endotoxins",
          abstract:
            "Unlike standard machine learning approaches such as PCA, LDA, SVM, RF, GBM etc, DeepRaman functions independently, requiring no human interaction, and can be used with much smaller datasets than traditional CNNs. Performance on a public dataset achieved extraordinary accuracy. This study utilized various classical machine learning techniques, such as support vector machines, k-nearest neighbors, and random forests, to distinguish bacterial endotoxins.",
          authors: [],
          citation_count: 4,
          year: 2025
        }
      ]
    });

    expect(selection.request.selectionMode).toBe("all");
    expect(new Set(selection.selectedPaperIds)).toEqual(
      new Set(["relevant_svm", "relevant_pmlb", "relevant_rax_chf"])
    );
    expect(selection.selectedPaperIds).not.toContain("off_topic_raman");
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
