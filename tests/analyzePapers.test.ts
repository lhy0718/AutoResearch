import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import { createAnalyzePapersNode, retryResolvedSourceAfterLatePdfRecovery } from "../src/core/nodes/analyzePapers.js";
import { createGenerateHypothesesNode } from "../src/core/nodes/generateHypotheses.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { RunStore } from "../src/core/runs/runStore.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";
import { LLMCompleteOptions, MockLLMClient } from "../src/core/llm/client.js";
import { ResponsesPdfAnalysisClient } from "../src/integrations/openai/responsesPdfAnalysisClient.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalAnalysisExtractTimeout = process.env.AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS;

function makeCodexProviderConfig() {
  return {
    llm_mode: "codex_chatgpt_only" as const,
    codex: {
      model: "gpt-5.3-codex",
      chat_model: "gpt-5.3-codex",
      reasoning_effort: "medium" as const,
      chat_reasoning_effort: "low" as const,
      command_reasoning_effort: "low" as const,
      fast_mode: false,
      chat_fast_mode: false,
      auth_required: true
    }
  };
}

afterEach(async () => {
  process.chdir(originalCwd);
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalAnalysisExtractTimeout === undefined) {
    delete process.env.AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS;
  } else {
    process.env.AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS = originalAnalysisExtractTimeout;
  }
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

class FixedErrorLLM extends MockLLMClient {
  constructor(private readonly error: Error) {
    super();
  }

  override async complete(_prompt: string): Promise<{ text: string }> {
    throw this.error;
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
    return { text: output ?? "" };
  }
}

class PlannerAwarePaperLlm extends MockLLMClient {
  constructor(
    private readonly options: {
      abortTitle?: string;
      summary?: string;
      claim?: string;
      delayMs?: number;
    } = {}
  ) {
    super();
  }

  override async complete(prompt: string, opts?: LLMCompleteOptions): Promise<{ text: string }> {
    if (this.options.delayMs && this.options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    }
    if (this.options.abortTitle && prompt.includes(this.options.abortTitle)) {
      throw new Error("Operation aborted by user");
    }
    if (opts?.systemPrompt?.includes("planning agent")) {
      return {
        text: JSON.stringify({
          focus_sections: ["methods"],
          target_claims: ["claim"],
          extraction_priorities: ["metrics"],
          verification_checks: ["source-grounded"],
          risk_flags: []
        })
      };
    }
    return {
      text: jsonOutput(this.options.summary ?? "summary", this.options.claim ?? "claim")
    };
  }
}

class TitleSelectiveHangingExtractorLLM extends MockLLMClient {
  constructor(
    private readonly options: {
      hangingTitle: string;
      summary?: string;
      claim?: string;
    }
  ) {
    super();
  }

  override async complete(prompt: string, opts?: LLMCompleteOptions): Promise<{ text: string }> {
    if (opts?.systemPrompt?.includes("planning agent")) {
      return {
        text: JSON.stringify({
          focus_sections: ["methods"],
          target_claims: ["claim"],
          extraction_priorities: ["metrics"],
          verification_checks: ["source-grounded"],
          risk_flags: []
        })
      };
    }
    if (
      opts?.systemPrompt?.includes("scientific literature analyst")
      && prompt.includes(this.options.hangingTitle)
    ) {
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
      text: jsonOutput(this.options.summary ?? "summary", this.options.claim ?? "claim")
    };
  }
}

class RerankHangingLLM extends MockLLMClient {
  override async complete(_prompt: string, opts?: LLMCompleteOptions): Promise<{ text: string }> {
    if (opts?.systemPrompt?.includes("You rerank scientific papers")) {
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
      text: jsonOutput("summary", "claim")
    };
  }
}

class ImagePayloadTimeoutLLM extends MockLLMClient {
  extractorCallsWithImages = 0;
  extractorCallsWithoutImages = 0;

  override async complete(_prompt: string, opts?: LLMCompleteOptions): Promise<{ text: string }> {
    if (opts?.systemPrompt?.includes("planning agent")) {
      return {
        text: JSON.stringify({
          focus_sections: ["methods"],
          target_claims: ["claim"],
          extraction_priorities: ["metrics"],
          verification_checks: ["source-grounded"],
          risk_flags: []
        })
      };
    }
    if (opts?.systemPrompt?.includes("verification agent")) {
      return {
        text: jsonOutput("reviewed summary", "reviewed claim")
      };
    }
    if (opts?.systemPrompt?.includes("scientific literature analyst")) {
      if ((opts.inputImagePaths?.length ?? 0) > 0) {
        this.extractorCallsWithImages += 1;
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
      this.extractorCallsWithoutImages += 1;
      return {
        text: jsonOutput("summary without images", "claim without images")
      };
    }
    return {
      text: jsonOutput("summary", "claim")
    };
  }
}

class TimeoutOnlyExtractorLLM extends MockLLMClient {
  callCount = 0;

  override async complete(_prompt: string, opts?: LLMCompleteOptions): Promise<{ text: string }> {
    this.callCount += 1;
    if (opts?.systemPrompt?.includes("planning agent")) {
      return {
        text: JSON.stringify({
          focus_sections: ["methods"],
          target_claims: ["claim"],
          extraction_priorities: ["metrics"],
          verification_checks: ["source-grounded"],
          risk_flags: []
        })
      };
    }
    if (opts?.systemPrompt?.includes("verification agent")) {
      return {
        text: jsonOutput("reviewed summary", "reviewed claim")
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
    return {
      text: jsonOutput("summary", "claim")
    };
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

async function writeCollectEnrichment(runId: string, entries: unknown[]): Promise<void> {
  const dir = path.join(".autolabos", "runs", runId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "collect_enrichment.jsonl"),
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8"
  );
}

async function writeCollectResult(runId: string, value: unknown): Promise<void> {
  const dir = path.join(".autolabos", "runs", runId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "collect_result.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function overwriteCorpusSync(runId: string, rows: unknown[]): void {
  const dir = path.join(".autolabos", "runs", runId);
  writeFileSync(path.join(dir, "corpus.jsonl"), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function overwriteCollectEnrichmentSync(runId: string, entries: unknown[]): void {
  const dir = path.join(".autolabos", "runs", runId);
  writeFileSync(
    path.join(dir, "collect_enrichment.jsonl"),
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8"
  );
}

function overwriteCollectResultSync(runId: string, value: unknown): void {
  const dir = path.join(".autolabos", "runs", runId);
  writeFileSync(path.join(dir, "collect_result.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeCachedPaperTextSync(runId: string, paperId: string, text: string): void {
  const cacheDir = path.join(".autolabos", "runs", runId, "analysis_cache", "texts");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path.join(cacheDir, `${paperId}.txt`), text, "utf8");
}

function writeCachedPageImagesSync(runId: string, paperId: string, count: number): void {
  const cacheDir = path.join(".autolabos", "runs", runId, "analysis_cache", "page_images", paperId);
  mkdirSync(cacheDir, { recursive: true });
  for (let index = 1; index <= count; index += 1) {
    writeFileSync(path.join(cacheDir, `page-${String(index).padStart(3, "0")}.png`), "png");
  }
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
  it("pauses for manual review when no collected corpus rows are available", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-empty-corpus-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-empty-corpus";
    const run = makeRun(runId);
    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        analysis: {
          responses_model: "gpt-5.4"
        },
        papers: {
          max_results: 200
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new SequenceJsonLLM([jsonOutput("summary", "claim")]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);
    expect(result.summary).toContain("no collected corpus rows are currently available");
    expect(result.transitionRecommendation?.action).toBe("pause_for_human");
    expect(result.transitionRecommendation?.reason).toContain("corpus.jsonl is currently missing or empty");
    expect(result.transitionRecommendation?.suggestedCommands).toContain(
      `/agent collect --limit 200 --run ${run.id}`
    );
    expect(result.transitionRecommendation?.suggestedCommands).toContain(`/agent run collect_papers ${run.id}`);

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(
      loggedTexts.some((text) => text.includes("No corpus rows are available for analyze_papers"))
    ).toBe(true);
  });

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
        providers: makeCodexProviderConfig(),
        analysis: {
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

  it("refreshes runs.json while analysis progress is persisted", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-runstore-"));
    tempDirs.push(root);
    process.chdir(root);

    const paths = resolveAppPaths(root);
    await ensureScaffold(paths);
    const runStore = new RunStore(paths);
    const run = await runStore.createRun({
      title: "Multi-Agent Collaboration",
      topic: "Multi-Agent Collaboration",
      constraints: [],
      objectiveMetric: "accuracy >= 0.9"
    });
    run.status = "running";
    run.currentNode = "analyze_papers";
    run.graph.currentNode = "analyze_papers";
    run.graph.nodeStates.analyze_papers = {
      status: "running",
      updatedAt: new Date().toISOString()
    };
    await runStore.updateRun(run);

    await writeCorpus(run.id, [
      { paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] }
    ]);

    const initialRunsRaw = await readFile(paths.runsFile, "utf8");
    const node = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore,
      eventStream: new InMemoryEventStream(),
      llm: new SequenceJsonLLM([jsonOutput("summary 1", "claim 1")]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    await node.execute({ run, graph: run.graph });

    const nextRunsRaw = await readFile(paths.runsFile, "utf8");
    expect(nextRunsRaw).not.toBe(initialRunsRaw);

    const runsFile = JSON.parse(nextRunsRaw) as { runs: RunRecord[] };
    const updated = runsFile.runs.find((candidate) => candidate.id === run.id);
    expect(updated?.latestSummary).toContain("1 evidence item(s)");
    expect(updated?.graph.nodeStates.analyze_papers.note).toContain("1 evidence item(s)");
  });

  it("updates runs.json to an analyze-start summary before a long rerank finishes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-start-summary-"));
    tempDirs.push(root);
    process.chdir(root);

    const paths = resolveAppPaths(root);
    await ensureScaffold(paths);
    const runStore = new RunStore(paths);
    const run = await runStore.createRun({
      title: "Tabular Baseline Benchmarking",
      topic: "Tabular Baseline Benchmarking",
      constraints: [],
      objectiveMetric: "accuracy >= 0.9"
    });
    run.status = "running";
    run.currentNode = "analyze_papers";
    run.graph.currentNode = "analyze_papers";
    run.graph.nodeStates.analyze_papers = {
      status: "running",
      updatedAt: new Date().toISOString()
    };
    await runStore.updateRun(run);

    await writeCorpus(
      run.id,
      Array.from({ length: 35 }, (_, index) => ({
        paper_id: `p${index + 1}`,
        title: `Paper ${index + 1}`,
        abstract: `Abstract ${index + 1}`,
        authors: [`Author ${index + 1}`]
      }))
    );

    const node = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore,
      eventStream: new InMemoryEventStream(),
      llm: new RerankHangingLLM(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const abortController = new AbortController();
    const execution = node.execute({ run, graph: run.graph, abortSignal: abortController.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const runsFile = JSON.parse(await readFile(paths.runsFile, "utf8")) as { runs: RunRecord[] };
    const updated = runsFile.runs.find((candidate) => candidate.id === run.id);
    expect(updated?.latestSummary).toContain("analyze_papers has started");
    expect(updated?.latestSummary).toContain("select top 30");
    expect(updated?.graph.nodeStates.analyze_papers.note).toContain("analyze_papers has started");

    abortController.abort();
    await expect(execution).rejects.toThrow(/aborted/i);
  });

  it("marks a selected paper as running in analysis_manifest before llm analysis completes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-manifest-running-"));
    tempDirs.push(root);
    process.chdir(root);

    const paths = resolveAppPaths(root);
    await ensureScaffold(paths);
    const runStore = new RunStore(paths);
    const run = await runStore.createRun({
      title: "Budgeted Reasoning",
      topic: "Budgeted Reasoning",
      constraints: [],
      objectiveMetric: "accuracy >= 0.9"
    });
    run.status = "running";
    run.currentNode = "analyze_papers";
    run.graph.currentNode = "analyze_papers";
    run.graph.nodeStates.analyze_papers = {
      status: "running",
      updatedAt: new Date().toISOString()
    };
    await runStore.updateRun(run);

    await writeCorpus(run.id, [
      { paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] }
    ]);

    class ManifestCheckingLlm extends MockLLMClient {
      override async complete(_prompt: string): Promise<{ text: string }> {
        const manifestRaw = await readFile(path.join(".autolabos", "runs", run.id, "analysis_manifest.json"), "utf8");
        const manifest = JSON.parse(manifestRaw) as {
          papers?: Record<string, { status?: string }>;
        };
        expect(manifest.papers?.p1?.status).toBe("running");
        return { text: jsonOutput("summary 1", "claim 1") };
      }
    }

    const node = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore,
      eventStream: new InMemoryEventStream(),
      llm: new ManifestCheckingLlm(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
  });

  it("keeps completed artifacts when post-persist run summary refresh fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-post-persist-refresh-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-post-persist-refresh";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      { paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] }
    ]);

    let getRunCalls = 0;
    const runStore = {
      async getRun(id: string) {
        getRunCalls += 1;
        if (getRunCalls <= 2) {
          return { ...run, id };
        }
        throw new Error("Unexpected end of JSON input");
      },
      async updateRun() {
        return;
      }
    };

    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: makeCodexProviderConfig(),
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: runStore as any,
      eventStream,
      llm: new SequenceJsonLLM([jsonOutput("summary 1", "claim 1")]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const evidenceRaw = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8");
    const manifestRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw);

    expect(summariesRaw.trim().split("\n")).toHaveLength(1);
    expect(evidenceRaw.trim().split("\n")).toHaveLength(1);
    expect(manifest.papers.p1.status).toBe("completed");

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(
      loggedTexts.some((text) =>
        text.includes('Post-persist run summary refresh failed after writing artifacts for "Paper 1": Unexpected end of JSON input')
      )
    ).toBe(true);
    expect(loggedTexts.some((text) => text.includes('Persisted analysis outputs for "Paper 1"'))).toBe(true);
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
        providers: makeCodexProviderConfig(),
        analysis: {
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
    expect(first.status).toBe("success");
    expect(first.needsApproval).toBe(true);
    expect(first.transitionRecommendation?.action).toBe("pause_for_human");
    expect(first.summary).toContain("Preserved partial analysis");

    const summariesAfterFirst = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesAfterFirst.trim().split("\n")).toHaveLength(1);
    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await runContext.get("analyze_papers.summary_count")).toBe(1);
    expect(await runContext.get("analyze_papers.evidence_count")).toBe(1);

    const secondNode = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
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

  it("pauses with preserved partial evidence when an extractor attempt times out", async () => {
    process.env.AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS = "10";

    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-extract-timeout-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-extract-timeout";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      { paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] },
      { paper_id: "p2", title: "Paper 2", abstract: "Abstract 2", authors: ["Bob"] }
    ]);

    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: makeCodexProviderConfig(),
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new TitleSelectiveHangingExtractorLLM({
        hangingTitle: "Paper 2",
        summary: "summary 1",
        claim: "claim 1"
      }),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);
    expect(result.transitionRecommendation?.action).toBe("pause_for_human");
    expect(result.summary).toContain("Preserved partial analysis");

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const evidenceRaw = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8");
    expect(summariesRaw.trim().split("\n")).toHaveLength(1);
    expect(evidenceRaw.trim().split("\n")).toHaveLength(1);

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("extractor exceeded the 10ms timeout"))).toBe(true);
    expect(loggedTexts.some((text) => text.includes('Persisted analysis outputs for "Paper 1"'))).toBe(true);
  });

  it("preserves partial artifacts when the corpus regresses but the selection request is unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-selection-regression-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-selection-regression";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      { paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] }
    ]);

    const firstNode = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
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

    await writeFile(path.join(".autolabos", "runs", runId, "corpus.jsonl"), "", "utf8");

    const eventStream = new InMemoryEventStream();
    const secondNode = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new SequenceJsonLLM(["should-not-be-used"]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const second = await secondNode.execute({ run, graph: run.graph });
    expect(second.status).toBe("success");
    expect(second.needsApproval).toBe(true);
    expect(second.summary).toContain("Preserving 1 summary row(s) and 1 evidence row(s)");
    expect(second.transitionRecommendation?.action).toBe("pause_for_human");

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const evidenceRaw = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8");
    expect(summariesRaw.trim().split("\n")).toHaveLength(1);
    expect(evidenceRaw.trim().split("\n")).toHaveLength(1);

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await runContext.get("analyze_papers.summary_count")).toBe(1);
    expect(await runContext.get("analyze_papers.evidence_count")).toBe(1);
    expect(await runContext.get("analyze_papers.selected_count")).toBe(1);

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("Preserving 1 summary row(s) and 1 evidence row(s)"))).toBe(true);
    expect(loggedTexts.some((text) => text.includes("Resetting summaries/evidence"))).toBe(false);
  });

  it("preserves pre-retarget artifacts when selection regresses under the same request after a corpus change", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-retarget-regression-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-retarget-regression";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      { paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] },
      { paper_id: "p2", title: "Paper 2", abstract: "Abstract 2", authors: ["Bob"] }
    ]);

    const firstNode = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequenceJsonLLM([jsonOutput("summary 1", "claim 1"), jsonOutput("summary 2", "claim 2")]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const first = await firstNode.execute({ run, graph: run.graph });
    expect(first.status).toBe("success");

    await writeCorpus(runId, [{ paper_id: "p3", title: "Paper 3", abstract: "Abstract 3", authors: ["Carol"] }]);

    const eventStream = new InMemoryEventStream();
    const secondNode = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new SequenceJsonLLM(["should-not-be-used"]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const second = await secondNode.execute({ run, graph: run.graph });
    expect(second.status).toBe("success");
    expect(second.needsApproval).toBe(true);
    expect(second.summary).toContain("Preserving 2 summary row(s) and 2 evidence row(s)");
    expect(second.transitionRecommendation?.action).toBe("pause_for_human");

    const manifestRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw) as { selectedPaperIds: string[] };
    expect(manifest.selectedPaperIds).toEqual(["p1", "p2"]);

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const evidenceRaw = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8");
    expect(summariesRaw.trim().split("\n")).toHaveLength(2);
    expect(evidenceRaw.trim().split("\n")).toHaveLength(2);

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("Preserving 2 summary row(s) and 2 evidence row(s)"))).toBe(true);
  });

  it("pauses with preserved partial evidence when retries stop shrinking the failed subset", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-stalled-retry-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-stalled-retry";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      { paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] },
      { paper_id: "p2", title: "Paper 2", abstract: "Abstract 2", authors: ["Bob"] }
    ]);

    const firstNode = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
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
    expect(first.status).toBe("success");
    expect(first.needsApproval).toBe(true);
    expect(first.transitionRecommendation?.action).toBe("pause_for_human");
    expect(first.summary).toContain("Preserved partial analysis");

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const evidenceRaw = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8");
    expect(summariesRaw.trim().split("\n")).toHaveLength(1);
    expect(evidenceRaw.trim().split("\n")).toHaveLength(1);

    expect(first.transitionRecommendation?.reason).toContain("preserved partial evidence");
    expect(first.transitionRecommendation?.evidence[0]).toContain("summary row(s)");
  });

  it("pauses after repeated zero-output retries when the failed subset does not shrink", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-zero-output-retry-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-zero-output-retry";
    const run = makeRun(runId);
    await writeCorpus(runId, [{ paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] }]);

    const firstNode = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequenceJsonLLM(["invalid-json"]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const first = await firstNode.execute({ run, graph: run.graph });
    expect(first.status).toBe("failure");

    run.graph.retryCounters.analyze_papers = 1;

    const eventStream = new InMemoryEventStream();
    const secondNode = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new SequenceJsonLLM(["invalid-json"]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const second = await secondNode.execute({ run, graph: run.graph });
    expect(second.status).toBe("success");
    expect(second.needsApproval).toBe(true);
    expect(second.transitionRecommendation?.action).toBe("pause_for_human");
    expect(second.summary).toContain("summaries or evidence");

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8").catch(() => "");
    const evidenceRaw = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8").catch(() => "");
    expect(summariesRaw).toBe("");
    expect(evidenceRaw).toBe("");

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("No summaries or evidence were persisted"))).toBe(true);
  });

  it("pauses early on large zero-output passes instead of spending the entire analysis limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-early-zero-output-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-early-zero-output";
    const run = makeRun(runId);
    await writeCorpus(
      runId,
      Array.from({ length: 15 }, (_, index) => ({
        paper_id: `p${index + 1}`,
        title: `Paper ${index + 1}`,
        abstract: `Abstract ${index + 1}`,
        authors: [`Author ${index + 1}`]
      }))
    );

    const llm = new CountingJsonLLM(Array.from({ length: 20 }, () => "invalid-json"));
    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: makeCodexProviderConfig(),
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);
    expect(result.transitionRecommendation?.action).toBe("pause_for_human");
    expect(result.summary).toContain("all failed before any summaries or evidence were persisted");
    expect(llm.callCount).toBeLessThan(15);
    expect(result.toolCallsUsed).toBeLessThan(15);

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await runContext.get("analyze_papers.summary_count")).toBe(0);
    expect(await runContext.get("analyze_papers.evidence_count")).toBe(0);

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("Pausing instead of spending the rest of the selection"))).toBe(true);
  });

  it("uses a larger early zero-output sample when all failures are timeout-only", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-timeout-zero-output-"));
    tempDirs.push(root);
    process.chdir(root);

    process.env.AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS = "5";

    const runId = "run-analyze-timeout-zero-output";
    const run = makeRun(runId);
    await writeCorpus(
      runId,
      Array.from({ length: 15 }, (_, index) => ({
        paper_id: `p${index + 1}`,
        title: `Paper ${index + 1}`,
        abstract: `Abstract ${index + 1}`,
        authors: [`Author ${index + 1}`]
      }))
    );

    const llm = new TimeoutOnlyExtractorLLM();
    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: makeCodexProviderConfig(),
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);
    expect(result.transitionRecommendation?.action).toBe("pause_for_human");
    expect(result.summary).toContain("first 3 attempted paper(s) all failed");
    expect(result.toolCallsUsed).toBe(3);
    expect(llm.callCount).toBeLessThan(30);

    const evidence = result.transitionRecommendation?.evidence ?? [];
    expect(evidence.some((line) => line.includes("after 3 attempted paper analyses"))).toBe(true);
  });


  it("retries once without supplemental page images when the full-text extractor times out", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-image-timeout-fallback-"));
    tempDirs.push(root);
    process.chdir(root);

    process.env.AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS = "5";

    const runId = "run-analyze-image-timeout-fallback";
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
    writeCachedPaperTextSync(runId, "p1", "Recovered cached full text");
    writeCachedPageImagesSync(runId, "p1", 3);

    const llm = new ImagePayloadTimeoutLLM();
    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: {
          llm_mode: "codex_chatgpt_only",
          codex: {
            model: "gpt-5.4",
            pdf_model: "gpt-5.4"
          }
        },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm,
      pdfTextLlm: llm,
      codex: {
        checkCliAvailable: async () => ({ ok: true, detail: "codex available" }),
        checkLoginStatus: async () => ({ ok: true, detail: "logged in" }),
        checkEnvironmentReadiness: async () => []
      } as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);
    expect(llm.extractorCallsWithImages).toBe(1);
    expect(llm.extractorCallsWithoutImages).toBe(1);

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesRaw).toContain("reviewed summary");
    expect(summariesRaw).toContain('"source_type":"full_text"');

    const manifestRaw = await readFile(
      path.join(".autolabos", "runs", runId, "analysis_manifest.json"),
      "utf8"
    );
    expect(manifestRaw).toContain('"status": "completed"');
    expect(manifestRaw).toContain('"source_type": "full_text"');

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("Retrying once with full text only"))).toBe(true);
  });

  it("pauses for human when the requested model hits a usage limit before any outputs are produced", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-usage-limit-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-usage-limit";
    const run = makeRun(runId);
    await writeCorpus(runId, [{ paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] }]);

    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: makeCodexProviderConfig(),
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new FixedErrorLLM(
        new Error(
          "You've hit your usage limit for GPT-5.3-Codex-Spark. Switch to another model now, or try again at 8:24 PM."
        )
      ),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);
    expect(result.transitionRecommendation?.action).toBe("pause_for_human");
    expect(result.summary).toContain("usage limit");

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8").catch(() => "");
    const evidenceRaw = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8").catch(() => "");
    expect(summariesRaw).toBe("");
    expect(evidenceRaw).toBe("");

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await runContext.get("analyze_papers.summary_count")).toBe(0);
    expect(await runContext.get("analyze_papers.evidence_count")).toBe(0);

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("model usage-limit failure"))).toBe(true);
  });

  it("pauses before starting when the Codex environment preflight reports an unwritable home", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-env-preflight-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-env-preflight";
    const run = makeRun(runId);
    await writeCorpus(runId, [{ paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] }]);

    const llm = new CountingJsonLLM([jsonOutput("summary 1", "claim 1")]);
    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: {
          llm_mode: "codex_chatgpt_only",
          codex: {
            model: "gpt-5.4",
            pdf_model: "gpt-5.4"
          }
        },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm,
      codex: {
        checkCliAvailable: async () => ({ ok: true, detail: "codex available" }),
        checkLoginStatus: async () => ({ ok: true, detail: "logged in" }),
        checkEnvironmentReadiness: async () => [
          {
            name: "codex-home",
            ok: false,
            blocking: true,
            detail: `${root}/.codex is not writable`
          }
        ]
      } as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);
    expect(result.summary).toContain("Codex CLI environment is not writable or ready");
    expect(result.transitionRecommendation?.action).toBe("pause_for_human");
    expect(llm.callCount).toBe(0);

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("Codex preflight failed [codex-home]"))).toBe(true);
  });

  it("pauses before starting when the configured Codex research model is Spark", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-spark-preflight-"));
    tempDirs.push(root);
    process.chdir(root);
    process.env.HOME = root;

    const runId = "run-analyze-spark-preflight";
    const run = makeRun(runId);
    await writeCorpus(runId, [{ paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] }]);

    const llm = new CountingJsonLLM([jsonOutput("summary 1", "claim 1")]);
    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: {
          llm_mode: "codex_chatgpt_only",
          codex: {
            model: "gpt-5.3-codex-spark",
            pdf_model: "gpt-5.4"
          }
        },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm,
      codex: {
        checkCliAvailable: async () => ({ ok: true, detail: "codex available" }),
        checkLoginStatus: async () => ({ ok: true, detail: "logged in" })
      } as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);
    expect(result.summary).toContain("configured Codex research model");
    expect(result.transitionRecommendation?.action).toBe("pause_for_human");
    expect(llm.callCount).toBe(0);

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("Codex preflight failed [codex-research-model]"))).toBe(true);
  });

  it("preserves partial analysis and pauses when later papers hit environment permission errors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-env-partial-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-env-partial";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      { paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] },
      { paper_id: "p2", title: "Paper 2", abstract: "Abstract 2", authors: ["Bob"] }
    ]);

    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new SequenceResponseLlm([
        jsonOutput("summary 1", "claim 1"),
        new Error("failed to write models cache: Operation not permitted")
      ]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);
    expect(result.summary).toContain("Preserved partial analysis");
    expect(result.summary).toContain("environment or permission errors");
    expect(result.transitionRecommendation?.action).toBe("pause_for_human");

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const evidenceRaw = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8");
    expect(summariesRaw.trim().split("\n")).toHaveLength(1);
    expect(evidenceRaw.trim().split("\n")).toHaveLength(1);

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("environment or permission failure"))).toBe(true);
  });

  it("pauses after persisting an exhausted small corpus when every analyzed paper is abstract fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-abstract-only-exhausted-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-abstract-only-exhausted";
    const run = makeRun(runId);
    await writeCorpus(
      runId,
      Array.from({ length: 4 }, (_, index) => ({
        paper_id: `p${index + 1}`,
        title: `Paper ${index + 1}`,
        abstract: `Abstract ${index + 1}`,
        authors: [`Author ${index + 1}`]
      }))
    );

    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new SequenceJsonLLM([
        jsonOutput("summary 1", "claim 1"),
        jsonOutput("summary 2", "claim 2"),
        jsonOutput("summary 3", "claim 3"),
        jsonOutput("summary 4", "claim 4")
      ]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);
    expect(result.summary).toContain("abstract-fallback");
    expect(result.transitionRecommendation?.action).toBe("pause_for_human");
    expect(result.transitionRecommendation?.reason).toContain("abstract-level evidence");

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    const evidenceRaw = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8");
    expect(summariesRaw.trim().split("\n")).toHaveLength(4);
    expect(evidenceRaw.trim().split("\n")).toHaveLength(4);
    expect(summariesRaw).toContain('"source_type":"abstract"');
    expect(summariesRaw).not.toContain('"source_type":"full_text"');

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await runContext.get("analyze_papers.summary_count")).toBe(4);
    expect(await runContext.get("analyze_papers.evidence_count")).toBe(4);
    expect(await runContext.get("analyze_papers.full_text_count")).toBe(0);
    expect(await runContext.get("analyze_papers.abstract_fallback_count")).toBe(4);

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(
      loggedTexts.some((text) =>
        text.includes("Pausing for manual review instead of auto-unblocking downstream hypothesis/experiment generation")
      )
    ).toBe(true);
  });

  it("uses serial warm-start for a small all-mode codex analysis until the first outputs land", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-serial-warm-start-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-serial-warm-start";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      { paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"] },
      { paper_id: "p2", title: "Paper 2", abstract: "Abstract 2", authors: ["Bob"] },
      { paper_id: "p3", title: "Paper 3", abstract: "Abstract 3", authors: ["Cara"] },
      { paper_id: "p4", title: "Paper 4", abstract: "Abstract 4", authors: ["Dan"] }
    ]);

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    await runContext.put("analyze_papers.request", {
      selectionMode: "all",
      selectionPolicy: "hybrid_title_citation_recency_pdf_v2",
      topN: null
    });

    const repeatedJson = Array.from({ length: 16 }, (_, index) => jsonOutput(`summary ${index}`, `claim ${index}`));
    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: makeCodexProviderConfig(),
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new SequenceJsonLLM(repeatedJson),
      pdfTextLlm: new SequenceJsonLLM(repeatedJson),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("Analyzing 4 paper(s) with concurrency 1."))).toBe(true);
    expect(loggedTexts.some((text) => text.includes("Serial warm-start is enabled until the first persisted outputs arrive."))).toBe(true);
  });

  it("rejects mismatched full-text sources before persisting analysis artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-source-mismatch-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-source-mismatch";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      {
        paper_id: "p1",
        title: "Predicting multi-factor authentication uptake using machine learning and the UTAUT framework",
        abstract: "Abstract 1",
        authors: ["Alice Smith"],
        pdf_url: "https://example.com/p1.pdf"
      }
    ]);

    await mkdir(path.join(".autolabos", "runs", runId, "analysis_cache", "texts"), { recursive: true });
    await writeFile(
      path.join(".autolabos", "runs", runId, "analysis_cache", "texts", "p1.txt"),
      "This study presents a structured literature review of machine learning applications in African economies and digital transformation.",
      "utf8"
    );

    const llm = new CountingJsonLLM([jsonOutput("mismatch summary", "mismatch claim")]);
    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: makeCodexProviderConfig(),
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);
    expect(result.transitionRecommendation?.action).toBe("pause_for_human");
    expect(llm.callCount).toBe(0);

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8").catch(() => "");
    const evidenceRaw = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8").catch(() => "");
    expect(summariesRaw).toBe("");
    expect(evidenceRaw).toBe("");
    const manifestRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8");
    expect(manifestRaw).toContain("source_content_mismatch");
    const quarantineRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_quarantine.jsonl"), "utf8");
    expect(quarantineRaw).toContain('"paper_id":"p1"');
    expect(quarantineRaw).toContain("source_content_mismatch");

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await runContext.get("analyze_papers.summary_count")).toBe(0);
    expect(await runContext.get("analyze_papers.evidence_count")).toBe(0);
  });

  it("revalidates local full-text identity after Responses API fallback before running LLM extraction", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-pdf-fallback-mismatch-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-pdf-fallback-mismatch";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      {
        paper_id: "p1",
        title: "Predicting multi-factor authentication uptake using machine learning and the UTAUT framework",
        abstract: "Abstract 1",
        authors: ["Alice Smith"],
        pdf_url: "https://example.com/p1.pdf"
      }
    ]);

    await mkdir(path.join(".autolabos", "runs", runId, "analysis_cache", "texts"), { recursive: true });
    await writeFile(
      path.join(".autolabos", "runs", runId, "analysis_cache", "texts", "p1.txt"),
      "This source text is actually an unrelated paper about economic transformation in Africa and digital inclusion.",
      "utf8"
    );

    const llm = new CountingJsonLLM([jsonOutput("should not run", "should not run")]);
    const pdfTextLlm = new CountingJsonLLM([jsonOutput("should not run", "should not run")]);
    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm,
      pdfTextLlm,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: async () => {
          throw new Error(
            'Responses API request failed: 400 { "error": { "message": "Timeout while downloading https://example.com/p1.pdf" } }'
          );
        }
      } as unknown as ResponsesPdfAnalysisClient
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);
    expect(result.transitionRecommendation?.action).toBe("pause_for_human");
    expect(llm.callCount).toBe(0);
    expect(pdfTextLlm.callCount).toBe(0);

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8").catch(() => "");
    const evidenceRaw = await readFile(path.join(".autolabos", "runs", runId, "evidence_store.jsonl"), "utf8").catch(() => "");
    expect(summariesRaw).toBe("");
    expect(evidenceRaw).toBe("");

    const quarantineRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_quarantine.jsonl"), "utf8");
    expect(quarantineRaw).toContain('"paper_id":"p1"');
    expect(quarantineRaw).toContain("source_content_mismatch");

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("Responses API could not download the remote PDF"))).toBe(true);
    expect(loggedTexts.some((text) => text.includes("source-identity mismatch"))).toBe(true);
  });

  it("filters off-topic rerank selections and promotes anchored replacements", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-fallback-guard-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-fallback-guard";
    const run = {
      ...makeRun(runId),
      title: "Classical machine learning baselines for tabular classification",
      topic: "Classical machine learning baselines for tabular classification"
    };
    await writeCorpus(runId, [
      {
        paper_id: "p1",
        title: "Classical machine learning baselines for tabular classification",
        abstract: "Baseline comparison on tabular datasets with logistic regression and random forests.",
        authors: ["Alice"],
        citation_count: 5,
        year: 2022,
        pdf_url: "https://example.com/p1.pdf"
      },
      {
        paper_id: "p2",
        title: "A Study on Music Genre Classification using Machine Learning",
        abstract: "Classification model for audio genre recognition.",
        authors: ["Bob"],
        citation_count: 500,
        year: 2025,
        pdf_url: "https://example.com/p2.pdf"
      },
      {
        paper_id: "p3",
        title: "Baseline tree ensembles for structured tabular data",
        abstract: "Tabular classification baseline study on structured datasets.",
        authors: ["Cara"],
        citation_count: 10,
        year: 2023,
        pdf_url: "https://example.com/p3.pdf"
      }
    ]);

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    await runContext.put("analyze_papers.request", {
      topN: 2,
      selectionMode: "top_n",
      selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
    });

    let analyzePdfCalls = 0;
    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new SequenceJsonLLM([JSON.stringify({ ordered_paper_ids: ["p2", "p1", "p3"] })]),
      pdfTextLlm: new SequenceJsonLLM([]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: async () => {
          analyzePdfCalls += 1;
          return { text: jsonOutput(`summary ${analyzePdfCalls}`, `claim ${analyzePdfCalls}`) };
        }
      } as unknown as ResponsesPdfAnalysisClient
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(analyzePdfCalls).toBe(2);

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesRaw).toContain('"paper_id":"p1"');
    expect(summariesRaw).toContain('"paper_id":"p3"');
    expect(summariesRaw).not.toContain('"paper_id":"p2"');

    const manifestRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.selectedPaperIds).toEqual(["p1", "p3"]);

  });

  it("pauses instead of accepting a deterministic shortlist when top-n rerank fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-rerank-required-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-rerank-required";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      { paper_id: "p1", title: "Paper 1", abstract: "Abstract 1", authors: ["Alice"], pdf_url: "https://example.com/p1.pdf" },
      { paper_id: "p2", title: "Paper 2", abstract: "Abstract 2", authors: ["Bob"], pdf_url: "https://example.com/p2.pdf" },
      { paper_id: "p3", title: "Paper 3", abstract: "Abstract 3", authors: ["Cara"], pdf_url: "https://example.com/p3.pdf" }
    ]);

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    await runContext.put("analyze_papers.request", {
      topN: 2,
      selectionMode: "top_n",
      selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
    });

    let analyzePdfCalls = 0;
    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new FixedErrorLLM(new Error("rerank unavailable")),
      pdfTextLlm: new SequenceJsonLLM([]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: async () => {
          analyzePdfCalls += 1;
          return { text: jsonOutput("should not run", "should not run") };
        }
      } as unknown as ResponsesPdfAnalysisClient
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);
    expect(result.summary).toContain("LLM rerank for top 2 failed");
    expect(result.transitionRecommendation?.action).toBe("pause_for_human");
    expect(analyzePdfCalls).toBe(0);

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8").catch(() => "");
    const manifestRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8").catch(() => "");
    expect(summariesRaw).toBe("");
    expect(manifestRaw).toBe("");

    const loggedTexts = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(loggedTexts.some((text) => text.includes("LLM rerank failed. Top 2 selection requires a successful model rerank"))).toBe(true);
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
        providers: { llm_mode: "openai_api" },
        analysis: {
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

  it("refreshes selected corpus rows when PDF enrichment lands after analyze_papers starts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-late-pdf-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-late-pdf";
    const run = makeRun(runId);
    const initialRow = {
      paper_id: "p1",
      title: "Paper 1",
      abstract: "Abstract 1",
      authors: ["Alice"],
      url: "https://example.com/p1"
    };
    const secondRow = {
      paper_id: "p2",
      title: "Paper 2",
      abstract: "Abstract 2",
      authors: ["Bob"],
      url: "https://example.com/p2"
    };
    const enrichedRow = {
      ...initialRow,
      pdf_url: "https://example.com/p1.pdf"
    };
    await writeCorpus(runId, [initialRow, secondRow]);

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    await runContext.put("analyze_papers.request", {
      topN: 1,
      selectionMode: "top_n",
      selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
    });

    const eventStream = new InMemoryEventStream();
    let rerankCalls = 0;

    let analyzePdfCalls = 0;
    const node = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: {
        complete: async () => {
          rerankCalls += 1;
          overwriteCorpusSync(runId, [enrichedRow, secondRow]);
          return { text: JSON.stringify({ ordered_paper_ids: ["p1", "p2"] }) };
        }
      } as any,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: async ({ pdfUrl }: { pdfUrl: string }) => {
          analyzePdfCalls += 1;
          expect(pdfUrl).toBe(enrichedRow.pdf_url);
          return { text: jsonOutput("pdf summary", "pdf claim") };
        }
      } as unknown as ResponsesPdfAnalysisClient
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(rerankCalls).toBe(1);
    expect(analyzePdfCalls).toBe(1);

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesRaw).toContain('"source_type":"full_text"');
    expect(summariesRaw).toContain('"summary":"pdf summary"');
    expect(summariesRaw).not.toContain('"source_type":"abstract"');

    const manifestRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.papers.p1.pdf_url).toBe(enrichedRow.pdf_url);
    expect(manifest.papers.p1.score_breakdown.pdf_availability_score).toBe(1);

  });

  it("uses recovered PDF metadata from collect_enrichment logs before corpus rewrite completes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-enrichment-log-pdf-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-enrichment-log-pdf";
    const run = makeRun(runId);
    const initialRow = {
      paper_id: "p1",
      title: "Paper 1",
      abstract: "Abstract 1",
      authors: ["Alice"],
      url: "https://example.com/p1"
    };
    await writeCorpus(runId, [initialRow]);
    await writeCollectEnrichment(runId, [
      {
        paper_id: "p1",
        pdf_resolution: {
          source: "landing_page",
          url: "https://example.com/p1.pdf"
        },
        attempts: [{ stage: "landing_page", ok: true }],
        errors: []
      }
    ]);

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    await runContext.put("analyze_papers.request", {
      topN: 1,
      selectionMode: "top_n",
      selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
    });

    let analyzePdfCalls = 0;
    const node = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: {
        complete: async () => ({ text: JSON.stringify({ ordered_paper_ids: ["p1"] }) })
      } as any,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: async ({ pdfUrl }: { pdfUrl: string }) => {
          analyzePdfCalls += 1;
          expect(pdfUrl).toBe("https://example.com/p1.pdf");
          return { text: jsonOutput("pdf summary", "pdf claim") };
        }
      } as unknown as ResponsesPdfAnalysisClient
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(analyzePdfCalls).toBe(1);

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesRaw).toContain('"source_type":"full_text"');
    expect(summariesRaw).toContain('"summary":"pdf summary"');
    expect(summariesRaw).not.toContain('"fallback_reason":"no_pdf_url"');

    const manifestRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.papers.p1.pdf_url).toBe("https://example.com/p1.pdf");
    expect(manifest.papers.p1.source_type).toBe("full_text");
  });

  it("waits for deferred collect enrichment to finish for a small all-mode selection before source resolution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-small-all-wait-"));
    tempDirs.push(root);
    process.chdir(root);
    vi.useFakeTimers();

    const runId = "run-analyze-small-all-wait";
    const run = makeRun(runId);
    const initialRow = {
      paper_id: "p1",
      title: "Paper 1",
      abstract: "Abstract 1",
      authors: ["Alice"],
      url: "https://example.com/p1"
    };
    const enrichedRow = {
      ...initialRow,
      pdf_url: "https://example.com/p1.pdf"
    };
    await writeCorpus(runId, [initialRow]);
    await writeCollectResult(runId, {
      stored: 1,
      pdfRecovered: 0,
      enrichment: {
        status: "pending",
        targetCount: 1,
        processedCount: 0,
        attemptedCount: 0,
        updatedCount: 0
      }
    });

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    await runContext.put("analyze_papers.request", {
      selectionMode: "all",
      selectionPolicy: "hybrid_title_citation_recency_pdf_v2",
      topN: null
    });

    const enrichmentEntry = {
      paper_id: "p1",
      pdf_resolution: {
        source: "landing_page",
        url: enrichedRow.pdf_url
      },
      attempts: [{ stage: "landing_page", ok: true }],
      errors: []
    };
    setTimeout(() => {
      overwriteCorpusSync(runId, [enrichedRow]);
      overwriteCollectEnrichmentSync(runId, [enrichmentEntry]);
      overwriteCollectResultSync(runId, {
        stored: 1,
        pdfRecovered: 1,
        enrichment: {
          status: "completed",
          targetCount: 1,
          processedCount: 1,
          attemptedCount: 1,
          updatedCount: 1
        }
      });
    }, 6_000);

    let analyzePdfCalls = 0;
    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new SequenceJsonLLM(["unused"]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: async ({ pdfUrl }: { pdfUrl: string }) => {
          analyzePdfCalls += 1;
          expect(pdfUrl).toBe(enrichedRow.pdf_url);
          return { text: jsonOutput("pdf summary", "pdf claim") };
        }
      } as unknown as ResponsesPdfAnalysisClient
    });

    const resultPromise = node.execute({ run, graph: run.graph });
    await vi.advanceTimersByTimeAsync(6_500);
    const result = await resultPromise;

    expect(result.status).toBe("success");
    expect(analyzePdfCalls).toBe(1);

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesRaw).toContain('"source_type":"full_text"');
    expect(summariesRaw).not.toContain('"fallback_reason":"no_pdf_url"');

    const manifestRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.papers.p1.pdf_url).toBe(enrichedRow.pdf_url);
    expect(manifest.papers.p1.source_type).toBe("full_text");

  });

  it("retries source resolution after an initial no_pdf_url fallback when collect enrichment finishes slightly later", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-late-fallback-retry-"));
    tempDirs.push(root);
    process.chdir(root);
    vi.useFakeTimers();

    const runId = "run-analyze-late-fallback-retry";
    const paper = {
      paper_id: "p1",
      title: "Paper 1",
      abstract: "Abstract 1",
      authors: ["Alice"],
      url: "https://example.com/p1"
    };
    await writeCorpus(runId, [paper]);
    await writeCollectResult(runId, {
      stored: 1,
      pdfRecovered: 0,
      enrichment: {
        status: "pending",
        targetCount: 1,
        processedCount: 0,
        attemptedCount: 0,
        updatedCount: 0
      }
    });
    writeCachedPaperTextSync(runId, "p1", "Recovered cached full text");

    setTimeout(() => {
      overwriteCorpusSync(runId, [
        {
          ...paper,
          pdf_url: "https://example.com/p1.pdf"
        }
      ]);
      overwriteCollectResultSync(runId, {
        stored: 1,
        pdfRecovered: 1,
        enrichment: {
          status: "completed",
          targetCount: 1,
          processedCount: 1,
          attemptedCount: 1,
          updatedCount: 1
        }
      });
    }, 100);

    const resultPromise = retryResolvedSourceAfterLatePdfRecovery({
      runId,
      paper,
      source: {
        sourceType: "abstract",
        text: "Abstract 1",
        fullTextAvailable: false,
        fallbackReason: "no_pdf_url"
      },
      includePageImages: false,
      selectionMode: "all",
      selectedCount: 1,
      totalCandidates: 1
    });

    await vi.advanceTimersByTimeAsync(250);
    const retried = await resultPromise;

    expect(retried.paper.pdf_url).toBe("https://example.com/p1.pdf");
    expect(retried.source.sourceType).toBe("full_text");
    expect(retried.source.pdfUrl).toBe("https://example.com/p1.pdf");
    expect(retried.source.text).toBe("Recovered cached full text");
  });

  it("retries source resolution when collect enrichment replaces a stale PDF URL after an initial abstract fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-late-pdf-replacement-"));
    tempDirs.push(root);
    process.chdir(root);
    vi.useFakeTimers();

    const runId = "run-analyze-late-pdf-replacement";
    const paper = {
      paper_id: "p1",
      title: "Paper 1",
      abstract: "Abstract 1",
      authors: ["Alice"],
      pdf_url: "https://broken.example/p1.pdf"
    };
    await writeCorpus(runId, [paper]);
    await writeCollectResult(runId, {
      stored: 1,
      pdfRecovered: 0,
      enrichment: {
        status: "pending",
        targetCount: 1,
        processedCount: 0,
        attemptedCount: 0,
        updatedCount: 0
      }
    });
    writeCachedPaperTextSync(runId, "p1", "Recovered cached full text");

    const recoveredPdfUrl = "https://example.com/p1.pdf";
    setTimeout(() => {
      overwriteCollectEnrichmentSync(runId, [
        {
          paper_id: "p1",
          pdf_resolution: {
            source: "landing_page",
            url: recoveredPdfUrl
          },
          attempts: [{ stage: "landing_page", ok: true }],
          errors: []
        }
      ]);
      overwriteCollectResultSync(runId, {
        stored: 1,
        pdfRecovered: 1,
        enrichment: {
          status: "completed",
          targetCount: 1,
          processedCount: 1,
          attemptedCount: 1,
          updatedCount: 1
        }
      });
    }, 100);

    const resultPromise = retryResolvedSourceAfterLatePdfRecovery({
      runId,
      paper,
      source: {
        sourceType: "abstract",
        text: "Abstract 1",
        fullTextAvailable: false,
        pdfUrl: paper.pdf_url,
        fallbackReason: "pdf_download_failed:403"
      },
      includePageImages: false,
      selectionMode: "all",
      selectedCount: 1,
      totalCandidates: 1
    });

    await vi.advanceTimersByTimeAsync(250);
    const retried = await resultPromise;

    expect(retried.paper.pdf_url).toBe(recoveredPdfUrl);
    expect(retried.source.sourceType).toBe("full_text");
    expect(retried.source.pdfUrl).toBe(recoveredPdfUrl);
    expect(retried.source.text).toBe("Recovered cached full text");
  });

  it("waits for in-flight paper persistence before surfacing an abort from a concurrent paper", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-abort-drain-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-abort-drain";
    const run = makeRun(runId);
    await writeCorpus(runId, [
      {
        paper_id: "p1",
        title: "Multi-Agent Collaboration Benchmark",
        abstract: "A benchmark for multi-agent collaboration with measurable gains.",
        authors: ["Alice"]
      },
      {
        paper_id: "p2",
        title: "Abort-only unrelated baseline",
        abstract: "An unrelated baseline that should fail after the first paper persists.",
        authors: ["Bob"]
      }
    ]);

    const node = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new PlannerAwarePaperLlm({
        abortTitle: "Abort-only unrelated baseline",
        summary: "good summary",
        claim: "good claim",
        delayMs: 10
      }),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: new ResponsesPdfAnalysisClient(async () => undefined)
    });

    // Without a user abortSignal, abort errors from individual papers are
    // treated as per-paper failures (not node-level abort). The node should
    // succeed with partial results.
    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");

    const summariesRaw = await readFile(path.join(".autolabos", "runs", runId, "paper_summaries.jsonl"), "utf8");
    expect(summariesRaw).toContain('"paper_id":"p1"');
    expect(summariesRaw).not.toContain('"paper_id":"p2"');

    const manifestRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.papers.p1.status).toBe("completed");
    expect(manifest.papers.p2.status).toBe("failed");
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
        providers: { llm_mode: "openai_api" },
        analysis: {
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
        providers: { llm_mode: "openai_api" },
        analysis: {
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
        providers: { llm_mode: "openai_api" },
        analysis: {
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

  it("auto-gates a large corpus to top 30 when no explicit selection request is stored", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-auto-top30-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-auto-top30";
    const run = makeRun(runId);
    await writeCorpus(
      runId,
      Array.from({ length: 31 }, (_, index) => ({
        paper_id: `p${index + 1}`,
        title: `Paper ${index + 1}`,
        abstract: `Abstract ${index + 1}`,
        authors: [`Author ${index + 1}`],
        pdf_url: `https://example.com/p${index + 1}.pdf`
      }))
    );

    let analyzePdfCalls = 0;
    const eventStream = new InMemoryEventStream();
    const node = createAnalyzePapersNode({
      config: {
        providers: { llm_mode: "openai_api" },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm: new SequenceJsonLLM([
        JSON.stringify({
          ordered_paper_ids: Array.from({ length: 31 }, (_, index) => `p${index + 1}`)
        })
      ]),
      pdfTextLlm: new SequenceJsonLLM([]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: async () => {
          analyzePdfCalls += 1;
          return { text: jsonOutput(`summary ${analyzePdfCalls}`, `claim ${analyzePdfCalls}`) };
        }
      } as unknown as ResponsesPdfAnalysisClient
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(analyzePdfCalls).toBe(30);

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await runContext.get("analyze_papers.request")).toMatchObject({
      topN: 30,
      selectionMode: "top_n"
    });
    expect(await runContext.get("analyze_papers.selected_count")).toBe(30);

    const manifestRaw = await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8");
    expect(manifestRaw).toContain('"topN": 30');
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
        providers: { llm_mode: "openai_api" },
        analysis: {
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
        providers: { llm_mode: "openai_api" },
        analysis: {
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

  it("reuses deterministic fallback selection on re-entry (rerankApplied=false)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-analyze-determ-reuse-"));
    tempDirs.push(root);
    process.chdir(root);

    const runId = "run-analyze-determ-reuse";
    const run = makeRun(runId);
    // Use titles that match the run topic (Multi-Agent Collaboration) so quality safeguards pass
    await writeCorpus(runId, [
      { paper_id: "p1", title: "Multi-agent collaboration benchmark", abstract: "A1", authors: ["Alice"], pdf_url: "https://example.com/p1.pdf" },
      { paper_id: "p2", title: "Agent collaboration in planning tasks", abstract: "A2", authors: ["Bob"], pdf_url: "https://example.com/p2.pdf" },
      { paper_id: "p3", title: "Multi-agent coordination systems", abstract: "A3", authors: ["Cara"], pdf_url: "https://example.com/p3.pdf" }
    ]);

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    await runContext.put("analyze_papers.request", {
      topN: 1,
      selectionMode: "top_n",
      selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
    });

    // First execution: LLM rerank fails → deterministic fallback
    const failingRerankLlm = new FixedErrorLLM(new Error("rerank unavailable"));
    let firstAnalyzePdfCalls = 0;
    const firstNode = createAnalyzePapersNode({
      config: { providers: { llm_mode: "openai_api" }, analysis: { responses_model: "gpt-5.4" } } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: failingRerankLlm,
      pdfTextLlm: new SequenceJsonLLM([]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: async () => {
          firstAnalyzePdfCalls += 1;
          return { text: jsonOutput("summary", "claim") };
        }
      } as unknown as ResponsesPdfAnalysisClient
    });

    const first = await firstNode.execute({ run, graph: run.graph });
    expect(first.status).toBe("success");
    expect(firstAnalyzePdfCalls).toBe(1);

    // Verify manifest has rerankApplied=false (deterministic fallback)
    const manifestAfterFirst = JSON.parse(
      await readFile(path.join(".autolabos", "runs", runId, "analysis_manifest.json"), "utf8")
    );
    expect(manifestAfterFirst.rerankApplied).toBe(false);
    expect(manifestAfterFirst.selectedPaperIds.length).toBeGreaterThan(0);

    // Second execution: should reuse the deterministic fallback selection, NOT re-rerank
    const secondRerankLlm = new CountingJsonLLM(["should-not-be-used"]);
    const secondNode = createAnalyzePapersNode({
      config: { providers: { llm_mode: "openai_api" }, analysis: { responses_model: "gpt-5.4" } } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: secondRerankLlm,
      pdfTextLlm: new SequenceJsonLLM([]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: async () => { throw new Error("analysis should not rerun"); }
      } as unknown as ResponsesPdfAnalysisClient
    });

    const second = await secondNode.execute({ run, graph: run.graph });
    expect(second.status).toBe("success");
    // Key assertion: the LLM rerank should NOT have been called on re-entry
    expect(secondRerankLlm.callCount).toBe(0);
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
        providers: { llm_mode: "openai_api" },
        analysis: {
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
        providers: makeCodexProviderConfig(),
        analysis: {
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
        providers: { llm_mode: "openai_api" },
        analysis: {
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
        providers: makeCodexProviderConfig(),
        analysis: {
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
        providers: { llm_mode: "openai_api" },
        analysis: {
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
        providers: { llm_mode: "openai_api" },
        analysis: {
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
        providers: { llm_mode: "openai_api" },
        analysis: {
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
