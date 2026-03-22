import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { maybeEnrichRelatedWorkScout } from "../src/core/writePaperRelatedWorkEnrichment.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  vi.restoreAllMocks();
});

function makeRun(runId: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "Related Work Enrichment",
    topic: "agent collaboration",
    constraints: [],
    objectiveMetric: "reproducibility_score >= 0.8",
    status: "running",
    currentNode: "write_paper",
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

describe("writePaper related-work enrichment", () => {
  it("respects codex_text_image_hybrid mode and does not call Responses PDF analysis", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-related-work-enrichment-"));
    process.chdir(root);

    const run = makeRun("run-related-work-enrichment");
    const cacheDir = path.join(
      root,
      ".autolabos",
      "runs",
      run.id,
      "analysis_cache",
      "texts"
    );
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, "paper_scout_1.txt"),
      "Full text about stateful coordination, revision stability, and reproducibility.",
      "utf8"
    );

    const responsesSpy = vi.fn();
    const result = await maybeEnrichRelatedWorkScout({
      run,
      config: {
        providers: {
          llm_mode: "codex_chatgpt_only"
        },
        analysis: {
        }
      } as any,
      scoutRows: [
        {
          paper_id: "paper_scout_1",
          title: "Scout PDF Paper",
          abstract: "Abstract fallback",
          authors: ["Sam Scout"],
          pdf_url: "https://example.com/scout.pdf",
          citation_count: 12,
          year: 2024,
          venue: "ACL"
        }
      ],
      existingPaperIds: new Set(),
      pdfTextLlm: {
        async complete() {
          return {
            text: JSON.stringify({
              summary: "Full-text enrichment summary.",
              key_findings: ["The paper studies stateful coordination."],
              limitations: ["The benchmark is bounded."],
              datasets: ["AgentBench-mini"],
              metrics: ["reproducibility_score"],
              novelty: "Stateful coordination framing",
              reproducibility_notes: ["The PDF was read from cached text."],
              evidence_items: [
                {
                  claim: "Stateful coordination improves stability.",
                  method_slot: "stateful coordination",
                  result_slot: "improved stability",
                  limitation_slot: "bounded benchmark",
                  dataset_slot: "AgentBench-mini",
                  metric_slot: "reproducibility_score",
                  evidence_span: "The paper describes improved stability under stateful coordination.",
                  confidence: 0.81
                }
              ]
            })
          };
        }
      } as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: responsesSpy
      } as any
    });

    expect(responsesSpy).not.toHaveBeenCalled();
    expect(result.status).toBe("completed");
    expect(result.fullTextCount).toBe(1);
    expect(result.summaryRows[0]?.source_type).toBe("full_text");
  });

  it("does not reuse cached enrichment after the user switches PDF analysis mode", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-related-work-enrichment-cache-"));
    process.chdir(root);

    const run = makeRun("run-related-work-enrichment-cache");
    const cacheDir = path.join(
      root,
      ".autolabos",
      "runs",
      run.id,
      "analysis_cache",
      "texts"
    );
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, "paper_scout_1.txt"),
      "Full text about stateful coordination, revision stability, and reproducibility.",
      "utf8"
    );

    const responsesSpy = vi.fn(async () => ({
      text: JSON.stringify({
        summary: "Responses PDF summary.",
        key_findings: ["Responses API PDF path was used."],
        limitations: ["Bounded enrichment."],
        datasets: ["AgentBench-mini"],
        metrics: ["reproducibility_score"],
        novelty: "Responses PDF novelty",
        reproducibility_notes: ["Responses API read the PDF."],
        evidence_items: [
          {
            claim: "Responses mode grounded the paper.",
            method_slot: "responses pdf",
            result_slot: "grounded summary",
            limitation_slot: "bounded enrichment",
            dataset_slot: "AgentBench-mini",
            metric_slot: "reproducibility_score",
            evidence_span: "Responses mode read the remote PDF.",
            confidence: 0.84
          }
        ]
      })
    }));
    const pdfTextComplete = vi.fn(async () => ({
      text: JSON.stringify({
        summary: "Codex full-text summary.",
        key_findings: ["Local full-text path was used after the mode switch."],
        limitations: ["Bounded enrichment."],
        datasets: ["AgentBench-mini"],
        metrics: ["reproducibility_score"],
        novelty: "Codex PDF novelty",
        reproducibility_notes: ["Cached local text was used."],
        evidence_items: [
          {
            claim: "Codex mode grounded the paper from local text.",
            method_slot: "local full text",
            result_slot: "grounded summary",
            limitation_slot: "bounded enrichment",
            dataset_slot: "AgentBench-mini",
            metric_slot: "reproducibility_score",
            evidence_span: "The cached local text was analyzed after the mode switch.",
            confidence: 0.79
          }
        ]
      })
    }));

    const baseInput = {
      run,
      scoutRows: [
        {
          paper_id: "paper_scout_1",
          title: "Scout PDF Paper",
          abstract: "Abstract fallback",
          authors: ["Sam Scout"],
          pdf_url: "https://example.com/scout.pdf",
          citation_count: 12,
          year: 2024,
          venue: "ACL"
        }
      ],
      existingPaperIds: new Set(),
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: responsesSpy
      } as any
    };

    const firstResult = await maybeEnrichRelatedWorkScout({
      ...baseInput,
      config: {
        providers: {
          llm_mode: "openai_api",
          codex: {
            model: "gpt-5.3-codex",
            pdf_model: "gpt-5.4",
            reasoning_effort: "medium"
          }
        },
        analysis: {
          responses_model: "gpt-5.4",
          responses_reasoning_effort: "medium"
        }
      } as any,
      pdfTextLlm: {
        complete: pdfTextComplete
      } as any
    });

    const secondResult = await maybeEnrichRelatedWorkScout({
      ...baseInput,
      config: {
        providers: {
          llm_mode: "codex_chatgpt_only",
          codex: {
            model: "gpt-5.3-codex",
            pdf_model: "gpt-5.4",
            reasoning_effort: "medium"
          }
        },
        analysis: {
        }
      } as any,
      pdfTextLlm: {
        complete: pdfTextComplete
      } as any
    });

    expect(firstResult.status).toBe("completed");
    expect(secondResult.status).toBe("completed");
    expect(responsesSpy).toHaveBeenCalledTimes(1);
    expect(pdfTextComplete).toHaveBeenCalledTimes(1);
    expect(secondResult.summaryRows[0]?.summary).toBe("Codex full-text summary.");
  });
});
