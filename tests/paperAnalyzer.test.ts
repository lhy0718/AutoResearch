import { afterEach, describe, expect, it, vi } from "vitest";

import {
  analyzePaperWithLlm,
  analyzePaperWithResponsesPdf,
  normalizePaperAnalysis,
  parsePaperAnalysisJson,
  shouldFallbackResponsesPdfToLocalText
} from "../src/core/analysis/paperAnalyzer.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { AnalysisCorpusRow, ResolvedPaperSource } from "../src/core/analysis/paperText.js";
import { ResponsesPdfAnalysisClient } from "../src/integrations/openai/responsesPdfAnalysisClient.js";

class SequenceLLM extends MockLLMClient {
  private index = 0;

  constructor(private readonly outputs: string[]) {
    super();
  }

  override async complete(_prompt: string): Promise<{ text: string }> {
    const next = this.outputs[Math.min(this.index, this.outputs.length - 1)] ?? "";
    this.index += 1;
    return { text: next };
  }
}

class HangingReviewerLLM extends MockLLMClient {
  override async complete(prompt: string, opts?: { systemPrompt?: string; abortSignal?: AbortSignal }): Promise<{ text: string }> {
    if (opts?.systemPrompt?.includes("planning agent")) {
      return {
        text: JSON.stringify({
          focus_sections: ["method", "results"],
          target_claims: ["main result"],
          extraction_priorities: ["prefer explicit metrics"],
          verification_checks: ["drop unsupported claims"],
          risk_flags: []
        })
      };
    }
    if (opts?.systemPrompt?.includes("verification agent")) {
      return await new Promise<{ text: string }>((_resolve, reject) => {
        if (opts.abortSignal?.aborted) {
          reject(new Error("Operation aborted by user"));
          return;
        }
        opts.abortSignal?.addEventListener(
          "abort",
          () => reject(new Error("Operation aborted by user")),
          { once: true }
        );
      });
    }
    return {
      text: JSON.stringify({
        summary: "Extractor summary",
        key_findings: ["Extractor finding"],
        limitations: [],
        datasets: ["Extractor dataset"],
        metrics: ["Extractor metric"],
        novelty: "Extractor novelty",
        reproducibility_notes: [],
        evidence_items: [{ claim: "Extractor claim", confidence: 0.8 }]
      })
    };
  }
}

class HangingExtractorLLM extends MockLLMClient {
  override async complete(_prompt: string, opts?: { systemPrompt?: string; abortSignal?: AbortSignal }): Promise<{ text: string }> {
    if (opts?.systemPrompt?.includes("planning agent")) {
      return {
        text: JSON.stringify({
          focus_sections: ["method", "results"],
          target_claims: ["main result"],
          extraction_priorities: ["prefer explicit metrics"],
          verification_checks: ["drop unsupported claims"],
          risk_flags: []
        })
      };
    }
    if (opts?.systemPrompt?.includes("scientific literature analyst")) {
      return await new Promise<{ text: string }>((_resolve, reject) => {
        if (opts.abortSignal?.aborted) {
          reject(new Error("Operation aborted by user"));
          return;
        }
        opts.abortSignal?.addEventListener(
          "abort",
          () => reject(new Error("Operation aborted by user")),
          { once: true }
        );
      });
    }
    throw new Error("reviewer should not run");
  }
}

class HangingResponsesPdfClient {
  callCount = 0;

  async analyzePdf(args: { abortSignal?: AbortSignal; systemPrompt?: string }): Promise<{ text: string }> {
    this.callCount += 1;
    if (args.systemPrompt?.includes("planning agent")) {
      return {
        text: JSON.stringify({
          focus_sections: ["method", "results"],
          target_claims: ["main result"],
          extraction_priorities: ["prefer explicit metrics"],
          verification_checks: ["drop unsupported claims"],
          risk_flags: []
        })
      };
    }
    void args;
    return await new Promise<{ text: string }>(() => undefined);
  }
}

class ForbiddenDownloadResponsesPdfClient {
  callCount = 0;

  async analyzePdf(): Promise<{ text: string }> {
    this.callCount += 1;
    throw new Error(
      'Responses API request failed: 400 {"error":{"message":"Error while downloading http://www.thelancet.com/article/S2589750023002029/pdf. Upstream status code: 403.","type":"invalid_request_error","param":"url","code":"invalid_value"}}'
    );
  }
}

class PlannerImageSensitiveLLM extends MockLLMClient {
  plannerCallsWithImages = 0;
  extractorCallsWithImages = 0;
  reviewerCallsWithImages = 0;

  override async complete(_prompt: string, opts?: { systemPrompt?: string; abortSignal?: AbortSignal; inputImagePaths?: string[] }): Promise<{ text: string }> {
    const imageCount = opts?.inputImagePaths?.length ?? 0;
    if (opts?.systemPrompt?.includes("planning agent")) {
      this.plannerCallsWithImages += imageCount;
      return {
        text: JSON.stringify({
          focus_sections: ["methods", "results"],
          target_claims: ["main result"],
          extraction_priorities: ["metrics"],
          verification_checks: ["source-grounded"],
          risk_flags: []
        })
      };
    }
    if (opts?.systemPrompt?.includes("scientific literature analyst")) {
      this.extractorCallsWithImages += imageCount;
      return {
        text: JSON.stringify({
          summary: "Extractor summary",
          key_findings: ["Extractor finding"],
          limitations: [],
          datasets: ["Dataset A"],
          metrics: ["Accuracy"],
          novelty: "Extractor novelty",
          reproducibility_notes: [],
          evidence_items: [{ claim: "Extractor claim", evidence_span: "Full text with extracted content.", confidence: 0.8 }]
        })
      };
    }
    if (opts?.systemPrompt?.includes("verification agent")) {
      this.reviewerCallsWithImages += imageCount;
      return {
        text: JSON.stringify({
          summary: "Reviewed summary",
          key_findings: ["Reviewed finding"],
          limitations: [],
          datasets: ["Dataset A"],
          metrics: ["Accuracy"],
          novelty: "Reviewed novelty",
          reproducibility_notes: [],
          evidence_items: [{ claim: "Reviewed claim", evidence_span: "Full text with extracted content.", confidence: 0.7 }]
        })
      };
    }
    throw new Error("unexpected stage");
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

const fullTextSource: ResolvedPaperSource = {
  sourceType: "full_text",
  text: "Full text with extracted content.",
  fullTextAvailable: true
};

const originalReviewTimeout = process.env.AUTOLABOS_ANALYSIS_REVIEW_TIMEOUT_MS;
const originalPlannerTimeout = process.env.AUTOLABOS_ANALYSIS_PLANNER_TIMEOUT_MS;
const originalExtractTimeout = process.env.AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS;

afterEach(() => {
  vi.useRealTimers();
  if (originalPlannerTimeout === undefined) {
    delete process.env.AUTOLABOS_ANALYSIS_PLANNER_TIMEOUT_MS;
  } else {
    process.env.AUTOLABOS_ANALYSIS_PLANNER_TIMEOUT_MS = originalPlannerTimeout;
  }
  if (originalExtractTimeout === undefined) {
    delete process.env.AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS;
  } else {
    process.env.AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS = originalExtractTimeout;
  }
  if (originalReviewTimeout === undefined) {
    delete process.env.AUTOLABOS_ANALYSIS_REVIEW_TIMEOUT_MS;
  } else {
    process.env.AUTOLABOS_ANALYSIS_REVIEW_TIMEOUT_MS = originalReviewTimeout;
  }
});

describe("paperAnalyzer", () => {
  it("parses fenced JSON responses", () => {
    const parsed = parsePaperAnalysisJson('```json\n{"summary":"ok","evidence_items":[]}\n```');
    expect(parsed.summary).toBe("ok");
  });

  it("repairs truncated analysis JSON when only closing delimiters are missing", () => {
    const parsed = parsePaperAnalysisJson('{"summary":"ok","key_findings":["finding"],"evidence_items":[{"claim":"c"}]');
    expect(parsed.summary).toBe("ok");
    expect(parsed.key_findings).toEqual(["finding"]);
    expect(Array.isArray(parsed.evidence_items)).toBe(true);
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
          evidence_span: "This paper studies agentic workflows and reports strong results.",
          confidence: 0.8
        }
      ]
    });

    expect(normalized.summaryRow.summary).toBe("A concise summary");
    expect(normalized.summaryRow.key_findings).toEqual(["Finding A"]);
    expect(normalized.evidenceRows[0].claim).toBe("Agents improve performance.");
    expect(normalized.evidenceRows[0].source_type).toBe("abstract");
    expect(normalized.evidenceRows[0].confidence).toBe(0.8);
    expect(normalized.evidenceRows[0].confidence_reason).toBeUndefined();
  });

  it("retries once when the staged pipeline produces unusable JSON", async () => {
    const llm = new SequenceLLM([
      "not-json",
      "still-not-json",
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

  it("uses planner and reviewer stages to refine the final analysis", async () => {
    const llm = new SequenceLLM([
      JSON.stringify({
        focus_sections: ["method", "results"],
        target_claims: ["main result", "limitation"],
        extraction_priorities: ["prefer explicit metrics"],
        verification_checks: ["drop unsupported claims"],
        risk_flags: ["abstract may omit setup details"]
      }),
      JSON.stringify({
        summary: "Draft summary",
        key_findings: ["Draft finding"],
        limitations: ["Draft limitation"],
        datasets: ["Draft dataset"],
        metrics: ["Draft metric"],
        novelty: "Draft novelty",
        reproducibility_notes: ["Draft repro"],
        evidence_items: [{ claim: "Draft claim", evidence_span: "Draft span", confidence: 0.9 }]
      }),
      JSON.stringify({
        summary: "Reviewed summary",
        key_findings: ["Reviewed finding"],
        limitations: ["Reviewed limitation"],
        datasets: ["Reviewed dataset"],
        metrics: ["Reviewed metric"],
        novelty: "Reviewed novelty",
        reproducibility_notes: ["Reviewed repro"],
        evidence_items: [
          {
            claim: "Reviewed claim",
            evidence_span: "Reviewed summary",
            confidence: 0.6,
            confidence_reason: "Only the abstract supports this claim."
          }
        ]
      })
    ]);

    const result = await analyzePaperWithLlm({
      llm,
      paper,
      source,
      maxAttempts: 1
    });

    expect(result.attempts).toBe(1);
    expect(result.summaryRow.summary).toBe("Reviewed summary");
    expect(result.evidenceRows[0].claim).toBe("Reviewed claim");
    expect(result.evidenceRows[0].confidence_reason).toBe("Only the abstract supports this claim.");
  });

  it("stays on the first attempt when the extractor JSON is truncated but repairable", async () => {
    const progress: string[] = [];
    const llm = new SequenceLLM([
      JSON.stringify({
        focus_sections: ["method", "results"],
        target_claims: ["main result"],
        extraction_priorities: ["prefer explicit metrics"],
        verification_checks: ["drop unsupported claims"],
        risk_flags: []
      }),
      '{"summary":"Recovered from truncation","key_findings":["Recovered finding"],"limitations":[],"datasets":["Recovered dataset"],"metrics":["Recovered metric"],"novelty":"Recovered novelty","reproducibility_notes":[],"evidence_items":[{"claim":"Recovered claim","evidence_span":"Abstract: This paper studies agentic workflows and reports strong results.","confidence":0.7}]',
      "not-json"
    ]);

    const result = await analyzePaperWithLlm({
      llm,
      paper,
      source,
      maxAttempts: 2,
      onProgress: (message) => progress.push(message)
    });

    expect(result.attempts).toBe(1);
    expect(result.summaryRow.summary).toBe("Recovered from truncation");
    expect(result.evidenceRows[0].claim).toBe("Recovered claim");
    expect(progress.some((message) => message.includes("Extractor JSON looked truncated; repaired"))).toBe(true);
  });

  it("repairs structured JSON that is truncated in the middle of a later property name", () => {
    const truncated = [
      '{"summary":"Recovered from mid-key truncation","key_findings":["Recovered finding"],',
      '"limitations":[],"datasets":["Recovered dataset"],"metrics":["Recovered metric"],',
      '"novelty":"Recovered novelty","reproducibility_notes":[],"evi'
    ].join("");

    expect(parsePaperAnalysisJson(truncated)).toMatchObject({
      summary: "Recovered from mid-key truncation",
      key_findings: ["Recovered finding"],
      datasets: ["Recovered dataset"],
      metrics: ["Recovered metric"],
      novelty: "Recovered novelty"
    });
  });

  it("logs reviewer confidence reductions with claim-level reasons", async () => {
    const progress: string[] = [];
    const llm = new SequenceLLM([
      JSON.stringify({
        focus_sections: ["results"],
        target_claims: ["main result"],
        extraction_priorities: ["prefer direct spans"],
        verification_checks: ["lower confidence when support is indirect"],
        risk_flags: []
      }),
      JSON.stringify({
        summary: "Draft summary",
        key_findings: ["Draft finding"],
        limitations: [],
        datasets: ["Draft dataset"],
        metrics: ["Draft metric"],
        novelty: "Draft novelty",
        reproducibility_notes: [],
        evidence_items: [
          {
            claim: "Claim A",
            evidence_span: "This paper studies agentic workflows and reports strong results.",
            confidence: 0.92
          }
        ]
      }),
      JSON.stringify({
        summary: "Reviewed summary",
        key_findings: ["Reviewed finding"],
        limitations: [],
        datasets: ["Draft dataset"],
        metrics: ["Draft metric"],
        novelty: "Reviewed novelty",
        reproducibility_notes: [],
        evidence_items: [
          {
            claim: "Claim A",
            evidence_span: "This paper studies agentic workflows and reports strong results.",
            confidence: 0.58,
            confidence_reason: "The available source only provides an abstract-level description."
          }
        ]
      })
    ]);

    const result = await analyzePaperWithLlm({
      llm,
      paper,
      source,
      maxAttempts: 1,
      onProgress: (message) => progress.push(message)
    });

    expect(result.evidenceRows[0].confidence_reason).toBe(
      "The available source only provides an abstract-level description."
    );
    expect(
      progress.some((message) =>
        message.includes('Reviewer lowered confidence for "Claim A"')
        && message.includes("abstract-level description")
      )
    ).toBe(true);
  });

  it("falls back to the extractor draft when the reviewer exceeds the timeout", async () => {
    process.env.AUTOLABOS_ANALYSIS_REVIEW_TIMEOUT_MS = "10";
    const progress: string[] = [];

    const result = await analyzePaperWithLlm({
      llm: new HangingReviewerLLM(),
      paper,
      source,
      maxAttempts: 1,
      onProgress: (message) => progress.push(message)
    });

    expect(result.summaryRow.summary).toBe("Extractor summary");
    expect(result.evidenceRows[0].claim).toBe("Extractor claim");
    expect(
      progress.some((message) =>
        message.includes("Reviewer unavailable, using extractor draft as-is: reviewer exceeded the 10ms timeout")
      )
    ).toBe(true);
  });

  it("fails the attempt when the extractor exceeds the timeout", async () => {
    process.env.AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS = "10";
    const progress: string[] = [];

    await expect(
      analyzePaperWithLlm({
        llm: new HangingExtractorLLM(),
        paper,
        source: fullTextSource,
        maxAttempts: 1,
        onProgress: (message) => progress.push(message)
      })
    ).rejects.toThrow("paper_analysis_extractor_timeout_after_10ms");

    expect(
      progress.some((message) =>
        message.includes("Analysis attempt 1/1 failed: extractor exceeded the 10ms timeout")
      )
    ).toBe(true);
  });

  it("synthesizes a minimal abstract-only analysis when abstract extraction still times out", async () => {
    process.env.AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS = "10";
    const progress: string[] = [];

    const result = await analyzePaperWithLlm({
      llm: new HangingExtractorLLM(),
      paper,
      source,
      maxAttempts: 1,
      onProgress: (message) => progress.push(message)
    });

    expect(result.summaryRow.source_type).toBe("abstract");
    expect(result.summaryRow.summary).toContain("This paper studies agentic workflows");
    expect(result.summaryRow.limitations).toContain(
      "Abstract-only fallback; no verified full-text extraction completed before timeout."
    );
    expect(result.evidenceRows).toHaveLength(1);
    expect(result.evidenceRows[0].source_type).toBe("abstract");
    expect(result.evidenceRows[0].confidence).toBe(0.3);
    expect(result.evidenceRows[0].confidence_reason).toContain("weak abstract-only evidence");
    expect(
      progress.some((message) =>
        message.includes("Abstract-only analysis still timed out. Using a deterministic abstract fallback analysis")
      )
    ).toBe(true);
  });

  it("uses the bounded default extractor timeout when no override is set", async () => {
    delete process.env.AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS;
    vi.useFakeTimers();

    const promise = analyzePaperWithLlm({
      llm: new HangingExtractorLLM(),
      paper,
      source: fullTextSource
    });
    const expectation = expect(promise).rejects.toThrow("paper_analysis_extractor_timeout_after_120000ms");

    await vi.advanceTimersByTimeAsync(120_000);

    await expectation;
  });

  it("passes rendered PDF page images into hybrid LLM analysis", async () => {
    const llm = {
      complete: vi.fn(async (_prompt: string, opts?: { systemPrompt?: string }) => {
        if (opts?.systemPrompt?.includes("planning agent")) {
          return {
            text: JSON.stringify({
              focus_sections: ["methods"],
              target_claims: ["main claim"],
              extraction_priorities: ["metrics"],
              verification_checks: ["source-grounded"],
              risk_flags: []
            })
          };
        }
        return {
          text: JSON.stringify({
            summary: "Hybrid summary",
            key_findings: ["Hybrid finding"],
            limitations: [],
            datasets: [],
            metrics: [],
            novelty: "Hybrid novelty",
            reproducibility_notes: [],
            evidence_items: [{ claim: "Hybrid claim", confidence: 0.8 }]
          })
        };
      })
    };

    const result = await analyzePaperWithLlm({
      llm: llm as any,
      paper,
      source: {
        sourceType: "full_text",
        text: "Full text with extracted content.",
        fullTextAvailable: true,
        pageImagePaths: ["/tmp/page-001.png", "/tmp/page-003.png"],
        pageImagePages: [1, 3]
      }
    });

    expect(result.summaryRow.summary).toBe("Hybrid summary");
    expect(
      llm.complete.mock.calls.some(
        ([prompt, opts]) =>
          typeof prompt === "string" &&
          prompt.includes("Attached page numbers: 1, 3") &&
          Array.isArray((opts as { inputImagePaths?: string[] } | undefined)?.inputImagePaths) &&
          (opts as { inputImagePaths?: string[] }).inputImagePaths?.join(",") ===
            "/tmp/page-001.png,/tmp/page-003.png"
      )
    ).toBe(true);
  });

  it("keeps supplemental page images off the planner and reviewer stages", async () => {
    const llm = new PlannerImageSensitiveLLM();

    const result = await analyzePaperWithLlm({
      llm,
      paper,
      source: {
        sourceType: "full_text",
        text: "Full text with extracted content.",
        fullTextAvailable: true,
        pageImagePaths: ["/tmp/page-001.png", "/tmp/page-003.png"],
        pageImagePages: [1, 3]
      }
    });

    expect(result.summaryRow.summary).toBe("Reviewed summary");
    expect(llm.plannerCallsWithImages).toBe(0);
    expect(llm.extractorCallsWithImages).toBe(2);
    expect(llm.reviewerCallsWithImages).toBe(0);
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

  it("does not retry the remote Responses PDF path after an extractor timeout", async () => {
    process.env.AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS = "10";
    const client = new HangingResponsesPdfClient();
    const progress: string[] = [];

    await expect(
      analyzePaperWithResponsesPdf({
        client: client as unknown as ResponsesPdfAnalysisClient,
        paper,
        pdfUrl: "https://example.com/paper.pdf",
        model: "gpt-5.4",
        maxAttempts: 2,
        onProgress: (message) => progress.push(message)
      })
    ).rejects.toThrow("paper_analysis_extractor_timeout_after_10ms");

    expect(client.callCount).toBe(2);
    expect(
      progress.some((message) =>
        message.includes("PDF analysis attempt 1/2 failed: extractor exceeded the 10ms timeout")
      )
    ).toBe(true);
  });

  it("does not retry the remote Responses PDF path when download failures should fall back locally", async () => {
    const client = new ForbiddenDownloadResponsesPdfClient();
    const progress: string[] = [];

    await expect(
      analyzePaperWithResponsesPdf({
        client: client as unknown as ResponsesPdfAnalysisClient,
        paper,
        pdfUrl: "http://www.thelancet.com/article/S2589750023002029/pdf",
        model: "gpt-5.4",
        maxAttempts: 2,
        onProgress: (message) => progress.push(message)
      })
    ).rejects.toThrow("Upstream status code: 403");

    expect(client.callCount).toBe(2);
    expect(
      progress.some((message) => message.includes("PDF analysis attempt 1/2 failed"))
    ).toBe(true);
    expect(
      progress.every((message) => !message.includes("PDF analysis attempt 2/2"))
    ).toBe(true);
  });

  it("caps confidence when the evidence span is not grounded in the source text", () => {
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
          evidence_span: "This span does not appear in the source text.",
          confidence: 0.95
        }
      ]
    });

    expect(normalized.evidenceRows[0].confidence).toBe(0.45);
    expect(normalized.evidenceRows[0].confidence_reason).toContain("could not be grounded");
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

describe("shouldFallbackResponsesPdfToLocalText", () => {
  it("triggers fallback for 'fetch failed' errors", () => {
    expect(shouldFallbackResponsesPdfToLocalText(new Error("fetch failed"))).toBe(true);
  });

  it("triggers fallback for download errors", () => {
    expect(shouldFallbackResponsesPdfToLocalText(new Error("error while downloading PDF"))).toBe(true);
    expect(shouldFallbackResponsesPdfToLocalText(new Error("timeout while downloading the file"))).toBe(true);
    expect(shouldFallbackResponsesPdfToLocalText(new Error("failed to download remote file"))).toBe(true);
  });

  it("triggers fallback for paper-analysis timeout fingerprints", () => {
    expect(shouldFallbackResponsesPdfToLocalText(new Error("paper_analysis_extractor_timeout_after_45000ms"))).toBe(true);
    expect(shouldFallbackResponsesPdfToLocalText(new Error("paper_analysis_extractor_timeout_after_120000ms"))).toBe(true);
    expect(shouldFallbackResponsesPdfToLocalText(new Error("extractor exceeded the 120000ms timeout"))).toBe(true);
  });

  it("triggers fallback for upstream 403/404", () => {
    expect(shouldFallbackResponsesPdfToLocalText(new Error("upstream status code: 403"))).toBe(true);
    expect(shouldFallbackResponsesPdfToLocalText(new Error("upstream status code: 404"))).toBe(true);
  });

  it("does not trigger fallback for unrelated errors", () => {
    expect(shouldFallbackResponsesPdfToLocalText(new Error("rate limited"))).toBe(false);
    expect(shouldFallbackResponsesPdfToLocalText(new Error("internal server error"))).toBe(false);
  });
});
