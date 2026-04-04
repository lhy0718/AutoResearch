import { afterEach, describe, expect, it } from "vitest";

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

class CapturePromptLlm extends MockLLMClient {
  prompts: string[] = [];

  override async complete(prompt: string): Promise<{ text: string }> {
    this.prompts.push(prompt);
    const candidateCount = prompt.split("\n").filter((line) => /^\d+\. paper_id=/u.test(line)).length;
    return {
      text: JSON.stringify({
        ordered_paper_ids: Array.from({ length: candidateCount }, (_, index) => `p${index + 1}`)
      })
    };
  }
}

class HangingResponseLlm extends MockLLMClient {
  override async complete(): Promise<{ text: string }> {
    return await new Promise<{ text: string }>(() => {
      // Intentionally never resolves; used to verify rerank timeout fallback.
    });
  }
}

afterEach(() => {
  delete process.env.AUTOLABOS_ANALYSIS_RERANK_TIMEOUT_MS;
});

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
    // Deterministic fallback selects top N by deterministic score
    expect(selection.selectedPaperIds.length).toBe(2);
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

  it("does not retry rerank when Codex emits only shell-snapshot cleanup warnings", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new SequenceResponseLlm([
        new Error(
          '2026-03-12T08:56:03.104783Z  WARN codex_core::shell_snapshot: Failed to delete shell snapshot at "<home>/.codex/shell_snapshots/tmp": Os { code: 2, kind: NotFound, message: "No such file or directory" }'
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

    expect(selection.rerankApplied).toBe(false);
    expect(selection.rerankFallbackReason).toContain("shell snapshot cleanup produced no usable rerank output");
    // Deterministic fallback selects top N by deterministic score
    expect(selection.selectedPaperIds.length).toBe(1);
  });

  it("uses a dedicated rerank llm when provided", async () => {
    const rerankLlm = new FixedResponseLlm('{"ordered_paper_ids":["p2","p1","p3"]}');

    const selection = await selectPapersForAnalysis({
      llm: {
        complete: async () => {
          throw new Error("general llm should not be used for rerank");
        }
      } as any,
      rerankLlm,
      runTitle: "Multi-agent collaboration",
      runTopic: "Multi-agent collaboration",
      request: normalizeAnalysisSelectionRequest(2),
      corpusRows: [
        { paper_id: "p1", title: "Multi-agent collaboration", abstract: "A", authors: [], citation_count: 10, year: 2025 },
        { paper_id: "p2", title: "Other collaboration paper", abstract: "B", authors: [], citation_count: 9, year: 2025 },
        { paper_id: "p3", title: "Legacy retrieval", abstract: "C", authors: [], citation_count: 8, year: 2024 }
      ]
    });

    expect(selection.rerankApplied).toBe(true);
    expect(selection.selectedPaperIds).toEqual(["p2", "p1"]);
  });

  it("omits abstracts from large rerank prompts while keeping the pool at 90", async () => {
    const rerankLlm = new CapturePromptLlm();
    const corpusRows = Array.from({ length: 90 }, (_, index) => ({
      paper_id: `p${index + 1}`,
      title: `Tabular benchmark paper ${index + 1}`,
      abstract: `This is abstract ${index + 1} for a tabular benchmark paper.`,
      authors: [],
      citation_count: 200 - index,
      year: 2025
    }));

    const selection = await selectPapersForAnalysis({
      llm: rerankLlm,
      runTitle: "Resource-aware benchmarking of tabular baselines",
      runTopic: "Resource-aware benchmarking of tabular baselines",
      request: normalizeAnalysisSelectionRequest(30),
      corpusRows
    });

    expect(selection.candidatePoolSize).toBe(90);
    expect(selection.rerankApplied).toBe(true);
    expect(rerankLlm.prompts).toHaveLength(1);
    expect(rerankLlm.prompts[0]).not.toContain("abstract=");
    expect(rerankLlm.prompts[0]).toContain("application-specific prediction");
    expect(rerankLlm.prompts[0]).toContain("modality_fit=");
    expect(rerankLlm.prompts[0]).toContain("task_fit=");
    expect(rerankLlm.prompts[0]).toContain("study_scope=");
  });

  it("adds single-domain application demotion guidance to rerank prompts", async () => {
    const rerankLlm = new CapturePromptLlm();

    await selectPapersForAnalysis({
      llm: rerankLlm,
      runTitle: "Resource-aware benchmarking of tabular baselines",
      runTopic: "Resource-aware benchmarking of tabular baselines",
      request: normalizeAnalysisSelectionRequest(2),
      corpusRows: [
        { paper_id: "p1", title: "Tabular benchmark paper 1", abstract: "A", authors: [], citation_count: 10, year: 2025 },
        { paper_id: "p2", title: "Tabular benchmark paper 2", abstract: "B", authors: [], citation_count: 9, year: 2025 },
        { paper_id: "p3", title: "Tabular benchmark paper 3", abstract: "C", authors: [], citation_count: 8, year: 2025 }
      ]
    });

    expect(rerankLlm.prompts).toHaveLength(1);
    expect(rerankLlm.prompts[0]).toContain("Strongly demote papers whose main contribution is an application-specific prediction");
  });

  it("keeps only the substantive rerank failure when benign cleanup warnings are mixed in", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new SequenceResponseLlm([
        new Error(
          '2026-03-12T08:56:03.104783Z  WARN codex_core::shell_snapshot: Failed to delete shell snapshot at "<home>/.codex/shell_snapshots/tmp": Os { code: 2, kind: NotFound, message: "No such file or directory" }\n' +
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
    // Deterministic fallback selects top N by deterministic score
    expect(selection.selectedPaperIds.length).toBe(1);
  });

  it("falls back deterministically when rerank exceeds the bounded timeout", async () => {
    process.env.AUTOLABOS_ANALYSIS_RERANK_TIMEOUT_MS = "5";

    const logs: string[] = [];
    const selection = await selectPapersForAnalysis({
      llm: new HangingResponseLlm(),
      runTitle: "Multi-agent collaboration",
      runTopic: "Multi-agent collaboration",
      request: normalizeAnalysisSelectionRequest(1),
      corpusRows: [
        { paper_id: "p1", title: "Multi-agent collaboration", abstract: "A", authors: [], citation_count: 10, year: 2025 },
        { paper_id: "p2", title: "Other collaboration paper", abstract: "B", authors: [], citation_count: 9, year: 2025 }
      ],
      onProgress: (message) => logs.push(message)
    });

    expect(selection.rerankApplied).toBe(false);
    expect(selection.rerankFallbackReason).toContain("paper_selection_rerank_timeout_after_5ms");
    expect(selection.selectedPaperIds).toEqual(["p1"]);
    expect(logs.some((message) => message.includes("Rerank request failed: paper_selection_rerank_timeout_after_5ms"))).toBe(true);
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

  it("keeps live off-topic benchmark-like and application-domain papers below tabular shortlist candidates", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm(
        JSON.stringify({
          ordered_paper_ids: [
            "relevant_svm",
            "relevant_pmlb",
            "relevant_closer",
            "relevant_qbo",
            "relevant_tabm",
            "off_topic_kyrgyz",
            "off_topic_ddos",
            "off_topic_credit",
            "off_topic_smartgrid",
            "off_topic_icd10"
          ]
        })
      ),
      runTitle: "Resource-aware benchmarking of classical and modern tabular classification baselines",
      runTopic:
        "Evaluate classical and modern baseline families for tabular classification on small-to-medium public datasets, with emphasis on leakage-safe preprocessing, nested cross-validation, and practical resource-aware benchmarking.",
      request: normalizeAnalysisSelectionRequest(5),
      corpusRows: [
        {
          paper_id: "relevant_svm",
          title: "Cross-Dataset Evaluation of Support Vector Machines: A Reproducible, Calibration-Aware Baseline for Tabular Classification",
          abstract: "A cross-dataset tabular classification benchmark for SVM and classical baselines.",
          authors: [],
          citation_count: 5,
          year: 2025
        },
        {
          paper_id: "relevant_pmlb",
          title: "PMLBmini: A Tabular Classification Benchmark Suite for Data-Scarce Applications",
          abstract: "A benchmark suite for small-sample tabular classification.",
          authors: [],
          citation_count: 120,
          year: 2024
        },
        {
          paper_id: "relevant_closer",
          title: "A Closer Look at Deep Learning Methods on Tabular Datasets",
          abstract: "A comparison of deep tabular methods on tabular datasets.",
          authors: [],
          citation_count: 400,
          year: 2021
        },
        {
          paper_id: "relevant_qbo",
          title: "Stability-Aware QUBO Feature Selection for Tabular Classification Under Repeated Nested Cross-Validation",
          abstract: "Feature selection for tabular classification under repeated nested cross-validation.",
          authors: [],
          citation_count: 2,
          year: 2026
        },
        {
          paper_id: "relevant_tabm",
          title: "Deterministic Tabular Learning with TabM(Huber) and Out-of-Fold Blending",
          abstract: "A tabular learning method evaluated on public tabular datasets.",
          authors: [],
          citation_count: 1,
          year: 2026
        },
        {
          paper_id: "off_topic_kyrgyz",
          title: "Benchmarking Multilabel Topic Classification in the Kyrgyz Language",
          abstract: "A benchmarking study for topic classification in Kyrgyz text.",
          authors: [],
          citation_count: 40,
          year: 2024,
          pdf_url: "https://example.com/kyrgyz.pdf"
        },
        {
          paper_id: "off_topic_ddos",
          title: "A Resource-Efficient Machine Learning Pipeline for DDoS Attack Detection: A Comparative Study on CIC-IDS2018 and CIC-DDoS2019",
          abstract: "A resource-efficient DDoS detection pipeline using machine learning.",
          authors: [],
          citation_count: 20,
          year: 2025
        },
        {
          paper_id: "off_topic_credit",
          title: "Machine Learning Algorithms for Credit Risk Assessment in Financial Markets: A Comparative Study of Gradient Boosting and Neural Networks",
          abstract: "A comparative study of gradient boosting and neural networks for credit risk assessment.",
          authors: [],
          citation_count: 15,
          year: 2025
        },
        {
          paper_id: "off_topic_smartgrid",
          title: "QLID-Net: A Hybrid Quantum-Classical Neural Network for Robust and Data-Efficient Smart Grid Load Identification",
          abstract: "A hybrid quantum-classical network for smart-grid load identification.",
          authors: [],
          citation_count: 8,
          year: 2025
        },
        {
          paper_id: "off_topic_icd10",
          title: "Comparative Evaluation of Logistic Regression for ICD-10 Code Classification Using the CodiEsp Clinical Text Dataset",
          abstract: "An evaluation of logistic regression for clinical text code classification.",
          authors: [],
          citation_count: 11,
          year: 2024
        }
      ]
    });

    const topFive = selection.deterministicRankingPreview.slice(0, 5).map((row) => row.paper_id);
    expect(new Set(topFive)).toEqual(
      new Set(["relevant_svm", "relevant_qbo", "relevant_closer", "relevant_pmlb", "relevant_tabm"])
    );
    expect(topFive).not.toContain("off_topic_kyrgyz");
    expect(topFive).not.toContain("off_topic_ddos");
    expect(topFive).not.toContain("off_topic_credit");
    expect(topFive).not.toContain("off_topic_smartgrid");
    expect(topFive).not.toContain("off_topic_icd10");
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
    expect(new Set(selection.deterministicRankingPreview.slice(3).map((row) => row.paper_id))).toEqual(
      new Set(["off_topic_secret", "off_topic_music", "off_topic_sentiment"])
    );
  });

  it("demotes live-run false positives that only match broad benchmarking or resource-aware wording", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm(
        '{"ordered_paper_ids":["off_topic_kyrgyz","off_topic_privacy","relevant_svm","relevant_pmlb","off_topic_ddos","relevant_tabular","off_topic_credit","relevant_feature"]}'
      ),
      runTitle: "Resource-Aware Benchmarking of Classical and Modern Tabular Classification Baselines",
      runTopic:
        "Evaluate classical and modern baseline families for tabular classification on small-to-medium public datasets, with emphasis on leakage-safe preprocessing, nested cross-validation, and practical resource-aware benchmarking.",
      request: normalizeAnalysisSelectionRequest(4),
      corpusRows: [
        {
          paper_id: "relevant_svm",
          title:
            "Cross-Dataset Evaluation of Support Vector Machines: A Reproducible, Calibration-Aware Baseline for Tabular Classification",
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
          paper_id: "relevant_tabular",
          title: "A Closer Look at Deep Learning Methods on Tabular Datasets",
          abstract: "A direct evaluation of tabular deep learning methods on structured datasets.",
          authors: [],
          citation_count: 200,
          year: 2023
        },
        {
          paper_id: "relevant_feature",
          title: "Survey on Automatic Feature Construction in Machine Learning on Tabular Data",
          abstract: "A survey of feature construction methods for tabular data and structured datasets.",
          authors: [],
          citation_count: 80,
          year: 2024
        },
        {
          paper_id: "off_topic_kyrgyz",
          title: "Benchmarking Multilabel Topic Classification in the Kyrgyz Language",
          abstract: "A multilingual topic classification benchmark for Kyrgyz text.",
          authors: [],
          citation_count: 5,
          year: 2025
        },
        {
          paper_id: "off_topic_privacy",
          title: "Privacy-Aware Income Prediction Using Deep Neural Networks on the UCI Adult Dataset",
          abstract: "A privacy-aware income prediction system using deep neural networks.",
          authors: [],
          citation_count: 40,
          year: 2025
        },
        {
          paper_id: "off_topic_ddos",
          title: "A Resource-Efficient Machine Learning Pipeline for DDoS Attack Detection: A Comparative Study on CIC-IDS2018 and CIC-DDoS2019",
          abstract: "A machine learning benchmark for DDoS detection.",
          authors: [],
          citation_count: 30,
          year: 2025
        },
        {
          paper_id: "off_topic_credit",
          title: "Machine Learning Algorithms for Credit Risk Assessment in Financial Markets: A Comparative Study of Gradient Boosting and Neural Networks",
          abstract: "A comparative study of gradient boosting and neural networks for credit risk prediction.",
          authors: [],
          citation_count: 50,
          year: 2025
        }
      ]
    });

    expect(selection.selectedPaperIds).toEqual([
      "relevant_svm",
      "relevant_pmlb",
      "relevant_tabular",
      "relevant_feature"
    ]);
    expect(selection.rerankedPaperIds.slice(0, 4)).toEqual([
      "off_topic_kyrgyz",
      "off_topic_privacy",
      "relevant_svm",
      "relevant_pmlb"
    ]);
  });

  it("keeps top-n as a quality cap instead of backfilling task-mismatched papers", async () => {
    const selection = await selectPapersForAnalysis({
      llm: new FixedResponseLlm(
        JSON.stringify({
          ordered_paper_ids: [
            "relevant_svm",
            "off_topic_detection",
            "relevant_tabular",
            "off_topic_regression",
            "relevant_survey",
            "off_topic_auth",
            "off_topic_soil"
          ]
        })
      ),
      runTitle: "Leakage-safe benchmarking of classical and modern tabular classification baselines",
      runTopic:
        "Evaluate classical and modern baseline families for tabular classification on public datasets with leakage-safe preprocessing and cross-dataset evaluation.",
      request: normalizeAnalysisSelectionRequest(5),
      corpusRows: [
        {
          paper_id: "relevant_svm",
          title: "Cross-Dataset Evaluation of Support Vector Machines: A Reproducible, Calibration-Aware Baseline for Tabular Classification",
          abstract: "A cross-dataset tabular classification benchmark for SVM and classical baselines.",
          authors: [],
          citation_count: 12,
          year: 2025
        },
        {
          paper_id: "relevant_tabular",
          title: "Revisiting Nearest Neighbor for Tabular Data: A Deep Tabular Baseline Two Decades Later",
          abstract: "A reusable tabular baseline study on public datasets.",
          authors: [],
          citation_count: 180,
          year: 2024
        },
        {
          paper_id: "relevant_survey",
          title: "Embeddings for Tabular Data: A Survey",
          abstract: "A survey of reusable methods for tabular data and tabular benchmarks.",
          authors: [],
          citation_count: 90,
          year: 2024
        },
        {
          paper_id: "off_topic_detection",
          title: "Novel conditional tabular generative adversarial network based image augmentation for railway track fault detection",
          abstract: "Tabular generative augmentation for railway fault detection.",
          authors: [],
          citation_count: 60,
          year: 2025
        },
        {
          paper_id: "off_topic_regression",
          title: "Learning Interpretable Differentiable Logic Networks for Tabular Regression",
          abstract: "A tabular regression method.",
          authors: [],
          citation_count: 50,
          year: 2024
        },
        {
          paper_id: "off_topic_auth",
          title: "Predicting multi-factor authentication uptake using machine learning and the UTAUT Framework",
          abstract: "An application-specific prediction paper.",
          authors: [],
          citation_count: 20,
          year: 2025
        },
        {
          paper_id: "off_topic_soil",
          title: "Multi-Class Soil Fertility Classification Using Random Forest and SMOTE for Precision Agriculture",
          abstract: "A domain-specific classification paper for precision agriculture.",
          authors: [],
          citation_count: 25,
          year: 2025
        }
      ]
    });

    expect(selection.selectedPaperIds).toEqual(["relevant_svm", "relevant_tabular", "relevant_survey"]);
    expect(selection.selectedPaperIds).toHaveLength(3);
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
    expect(new Set(selection.selectedPaperIds)).toEqual(new Set(["relevant_pmlb", "relevant_svm"]));
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
