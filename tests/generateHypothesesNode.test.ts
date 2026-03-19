import path from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { createGenerateHypothesesNode, normalizeGenerateHypothesesRequest } from "../src/core/nodes/generateHypotheses.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

class QueueJsonLLMClient extends MockLLMClient {
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

class BlockingQueueJsonLLMClient extends MockLLMClient {
  private index = 0;

  constructor(
    private readonly outputs: string[],
    private readonly blockedCallIndex: number,
    private readonly gate: Promise<void>
  ) {
    super();
  }

  override async complete(_prompt: string): Promise<{ text: string }> {
    const currentIndex = this.index;
    const output = this.outputs[Math.min(currentIndex, this.outputs.length - 1)] ?? "";
    this.index += 1;
    if (currentIndex === this.blockedCallIndex) {
      await this.gate;
    }
    return { text: output };
  }
}

afterEach(() => {
  delete process.env.AUTOLABOS_HYPOTHESIS_TIMEOUT_MS;
  process.chdir(ORIGINAL_CWD);
});

function makeRun(runId: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "Recent Multi-Agent Collaboration Papers",
    topic: "Multi-agent collaboration",
    constraints: ["recent papers", "last 5 years"],
    objectiveMetric: "state-of-the-art reproducibility",
    status: "running",
    currentNode: "generate_hypotheses",
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

function stagedHypothesisOutputs(): string[] {
  return [
    JSON.stringify({
      summary: "Mapped evidence into two axes.",
      axes: [
        {
          id: "ax_1",
          label: "Structured communication",
          mechanism: "Schemas reduce ambiguous message interpretation.",
          intervention: "Constrain inter-agent messages to typed fields.",
          boundary_condition: "Smaller gains when interfaces are already deterministic.",
          evaluation_hint: "Measure variance across repeated runs.",
          evidence_links: ["ev_1"]
        },
        {
          id: "ax_2",
          label: "Execution feedback",
          mechanism: "Validator-backed correction reduces error cascades.",
          intervention: "Add bounded execute-test-repair loops.",
          boundary_condition: "Less useful when validation is expensive.",
          evaluation_hint: "Measure failure mode stability.",
          evidence_links: ["ev_2"]
        }
      ]
    }),
    JSON.stringify({
      summary: "Generated mechanism drafts.",
      candidates: [
        {
          id: "cand_1",
          text: "Typed message schemas will reduce run-to-run variance relative to free-form chat on code-generation benchmarks.",
          novelty: 4,
          feasibility: 4,
          testability: 5,
          cost: 2,
          expected_gain: 5,
          evidence_links: ["ev_1"],
          axis_ids: ["ax_1"],
          rationale: "Direct intervention against ambiguous coordination."
        }
      ]
    }),
    JSON.stringify({
      summary: "Generated contradiction drafts.",
      candidates: [
        {
          id: "cand_2",
          text: "Role decomposition only improves reproducibility on tasks with stable task boundaries.",
          novelty: 4,
          feasibility: 3,
          testability: 3,
          cost: 2,
          expected_gain: 3,
          evidence_links: ["ev_1"],
          axis_ids: ["ax_1"],
          rationale: "Task structure likely moderates benefit."
        }
      ]
    }),
    JSON.stringify({
      summary: "Generated intervention drafts.",
      candidates: [
        {
          id: "cand_3",
          text: "Bounded execute-test-repair loops will improve reproducibility more than extra peer discussion.",
          novelty: 4,
          feasibility: 5,
          testability: 5,
          cost: 2,
          expected_gain: 5,
          evidence_links: ["ev_2"],
          axis_ids: ["ax_2"],
          rationale: "Execution-backed correction is directly testable."
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
          reproducibility_specificity: 5,
          reproducibility_signals: ["run_to_run_variance"],
          measurement_hint: "Measure run-to-run variance across repeated seeded runs.",
          limitation_reflection: 4,
          measurement_readiness: 5,
          strengths: ["Clear baseline and intervention."],
          weaknesses: ["Benchmark-specific."],
          critique_summary: "Strong."
        },
        {
          candidate_id: "contradiction_1",
          keep: false,
          groundedness: 3,
          causal_clarity: 3,
          falsifiability: 2,
          experimentability: 2,
          reproducibility_specificity: 2,
          reproducibility_signals: [],
          limitation_reflection: 2,
          measurement_readiness: 1,
          strengths: ["Interesting boundary condition."],
          weaknesses: ["Still underspecified."],
          critique_summary: "Needs more operational detail."
        },
        {
          candidate_id: "intervention_1",
          keep: true,
          groundedness: 5,
          causal_clarity: 5,
          falsifiability: 5,
          experimentability: 5,
          reproducibility_specificity: 5,
          reproducibility_signals: ["failure_mode_stability", "run_to_run_variance"],
          measurement_hint: "Track failure-mode stability and repeated-run variance.",
          limitation_reflection: 4,
          measurement_readiness: 5,
          strengths: ["Directly implementable."],
          weaknesses: ["Adds execution cost."],
          critique_summary: "Excellent."
        }
      ]
    })
  ];
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function waitForText(filePath: string, predicate: (text: string) => boolean): Promise<string> {
  let lastText = "";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      lastText = await readFile(filePath, "utf8");
      if (predicate(lastText)) {
        return lastText;
      }
    } catch {
      // wait for the artifact to appear
    }
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${filePath}. Last text: ${lastText}`);
}


describe("normalizeGenerateHypothesesRequest", () => {
  it("uses defaults when values are missing", () => {
    expect(normalizeGenerateHypothesesRequest(undefined)).toEqual({
      topK: 2,
      branchCount: 6
    });
  });

  it("ensures branch-count is at least top-k", () => {
    expect(normalizeGenerateHypothesesRequest({ topK: 5, branchCount: 3 })).toEqual({
      topK: 5,
      branchCount: 5
    });
  });

  it("writes staged hypothesis artifacts for later inspection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-hypothesis-node-"));
    process.chdir(root);

    const runId = "run-hypothesis-artifacts";
    const run = makeRun(runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(
      path.join(runDir, "evidence_store.jsonl"),
      [
        JSON.stringify({
          evidence_id: "ev_1",
          paper_id: "paper_1",
          claim: "Structured communication reduces ambiguity.",
          evidence_span: "Structured communication reduces ambiguity by forcing typed handoffs.",
          limitation_slot: "Not isolated against routing alone.",
          dataset_slot: "HumanEval",
          metric_slot: "pass@1 variance",
          confidence: 0.95
        }),
        JSON.stringify({
          evidence_id: "ev_2",
          paper_id: "paper_2",
          claim: "Execution feedback improves iterative correction.",
          evidence_span: "Execution feedback improves iterative correction through repeated test-repair loops.",
          limitation_slot: "Adds validator cost.",
          dataset_slot: "MBPP",
          metric_slot: "executability",
          confidence: 0.94
        })
      ].join("\n") + "\n",
      "utf8"
    );
    await writeFile(
      path.join(runDir, "corpus.jsonl"),
      [
        JSON.stringify({ paper_id: "paper_1", title: "Paper One" }),
        JSON.stringify({ paper_id: "paper_2", title: "Paper Two" })
      ].join("\n") + "\n",
      "utf8"
    );

    const llm = new QueueJsonLLMClient(stagedHypothesisOutputs());

    const node = createGenerateHypothesesNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm,
      pdfTextLlm: llm,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(result.toolCallsUsed).toBe(5);

    const hypotheses = await readFile(path.join(runDir, "hypotheses.jsonl"), "utf8");
    const axes = await readFile(path.join(runDir, "hypothesis_generation", "evidence_axes.json"), "utf8");
    const drafts = await readFile(path.join(runDir, "hypothesis_generation", "drafts.jsonl"), "utf8");
    const reviews = await readFile(path.join(runDir, "hypothesis_generation", "reviews.jsonl"), "utf8");
    const llmTrace = await readFile(path.join(runDir, "hypothesis_generation", "llm_trace.json"), "utf8");
    const progress = await readFile(path.join(runDir, "hypothesis_generation", "progress.jsonl"), "utf8");
    const status = await readFile(path.join(runDir, "hypothesis_generation", "status.json"), "utf8");
    const selection = await readFile(path.join(runDir, "hypothesis_generation", "selection.json"), "utf8");
    const selectionJson = JSON.parse(selection) as {
      scores?: Array<{ implementation_bonus?: number; bundling_penalty?: number }>;
    };
    const statusJson = JSON.parse(status) as { status?: string; stage?: string; selectedCount?: number };

    expect(hypotheses).toContain('"candidate_id":"intervention_1"');
    expect(hypotheses).toContain('"candidate_id":"mechanism_1"');
    expect(hypotheses).toContain('"selection_rank":1');
    expect(hypotheses).toContain('"evidence_snippets"');
    expect(hypotheses).toContain('"paper_titles":["Paper Two"]');
    expect(axes).toContain('"label": "Structured communication"');
    expect(drafts).toContain('"generator_kind":"mechanism"');
    expect(reviews).toContain('"candidate_id":"intervention_1"');
    expect(llmTrace).toContain('"axes"');
    expect(llmTrace).toContain('"review"');
    expect(llmTrace).toContain('"prompt"');
    expect(llmTrace).toContain('"completion"');
    expect(progress).toContain('"stage":"axes"');
    expect(progress).toContain('"stage":"review"');
    expect(statusJson.status).toBe("completed");
    expect(statusJson.stage).toBe("completed");
    expect(statusJson.selectedCount).toBe(2);
    expect(selection).toContain('"selected_ids"');
    expect(selectionJson.scores?.[0]?.implementation_bonus).toBeTypeOf("number");
    expect(selectionJson.scores?.[0]?.bundling_penalty).toBeTypeOf("number");
  });

  it("persists generate_hypotheses progress artifacts before final completion", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-hypothesis-progress-"));
    process.chdir(root);

    const runId = "run-hypothesis-progress";
    const run = makeRun(runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(
      path.join(runDir, "evidence_store.jsonl"),
      [
        JSON.stringify({
          evidence_id: "ev_1",
          paper_id: "paper_1",
          claim: "Structured communication reduces ambiguity.",
          evidence_span: "Structured communication reduces ambiguity by forcing typed handoffs.",
          limitation_slot: "Not isolated against routing alone.",
          dataset_slot: "HumanEval",
          metric_slot: "pass@1 variance",
          confidence: 0.95
        }),
        JSON.stringify({
          evidence_id: "ev_2",
          paper_id: "paper_2",
          claim: "Execution feedback improves iterative correction.",
          evidence_span: "Execution feedback improves iterative correction through repeated test-repair loops.",
          limitation_slot: "Adds validator cost.",
          dataset_slot: "MBPP",
          metric_slot: "executability",
          confidence: 0.94
        })
      ].join("\n") + "\n",
      "utf8"
    );
    await writeFile(
      path.join(runDir, "corpus.jsonl"),
      [
        JSON.stringify({ paper_id: "paper_1", title: "Paper One" }),
        JSON.stringify({ paper_id: "paper_2", title: "Paper Two" })
      ].join("\n") + "\n",
      "utf8"
    );

    const gate = createDeferred();
    const llm = new BlockingQueueJsonLLMClient(stagedHypothesisOutputs(), 0, gate.promise);
    const node = createGenerateHypothesesNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm,
      pdfTextLlm: llm,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const execution = node.execute({ run, graph: run.graph });
    const statusPath = path.join(runDir, "hypothesis_generation", "status.json");
    const progressPath = path.join(runDir, "hypothesis_generation", "progress.jsonl");
    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));

    const liveStatusText = await waitForText(
      statusPath,
      (text) => text.includes('"status": "running"') && text.includes('"stage": "axes"')
    );
    const liveProgressText = await waitForText(progressPath, (text) => text.includes('"stage":"axes"'));

    expect(liveStatusText).toContain("Synthesizing evidence axes");
    expect(liveProgressText).toContain("Synthesizing evidence axes");
    await expect(runContext.get("generate_hypotheses.progress_stage")).resolves.toBe("axes");
    await expect(runContext.get("generate_hypotheses.status")).resolves.toBe("running");

    gate.resolve();
    const result = await execution;

    expect(result.status).toBe("success");
  });

  it("falls back to single-pass hypothesis generation when a staged LLM call exceeds the timeout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-hypothesis-timeout-"));
    process.chdir(root);
    process.env.AUTOLABOS_HYPOTHESIS_TIMEOUT_MS = "10";

    const runId = "run-hypothesis-timeout";
    const run = makeRun(runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(
      path.join(runDir, "evidence_store.jsonl"),
      [
        JSON.stringify({
          evidence_id: "ev_1",
          paper_id: "paper_1",
          claim: "Structured communication reduces ambiguity.",
          evidence_span: "Structured communication reduces ambiguity by forcing typed handoffs.",
          limitation_slot: "Not isolated against routing alone.",
          dataset_slot: "HumanEval",
          metric_slot: "pass@1 variance",
          confidence: 0.95
        }),
        JSON.stringify({
          evidence_id: "ev_2",
          paper_id: "paper_2",
          claim: "Execution feedback improves iterative correction.",
          evidence_span: "Execution feedback improves iterative correction through repeated test-repair loops.",
          limitation_slot: "Adds validator cost.",
          dataset_slot: "MBPP",
          metric_slot: "executability",
          confidence: 0.94
        })
      ].join("\n") + "\n",
      "utf8"
    );
    await writeFile(
      path.join(runDir, "corpus.jsonl"),
      [
        JSON.stringify({ paper_id: "paper_1", title: "Paper One" }),
        JSON.stringify({ paper_id: "paper_2", title: "Paper Two" })
      ].join("\n") + "\n",
      "utf8"
    );

    const gate = createDeferred();
    const llm = new BlockingQueueJsonLLMClient(
      [
        JSON.stringify({ summary: "Unreachable staged axes output.", axes: [{ id: "ax_1", label: "unused", mechanism: "unused", intervention: "unused" }] }),
        JSON.stringify({
          summary: "Single-pass fallback selected two bounded hypotheses.",
          candidates: [
            {
              id: "cand_1",
              text: "A disagreement-triggered second pass will improve exact match at equal average token budget.",
              novelty: 4,
              feasibility: 5,
              testability: 5,
              cost: 2,
              expected_gain: 4,
              evidence_links: ["ev_1", "ev_2"],
              rationale: "This is directly testable with a matched-budget baseline.",
              reproducibility_signals: ["run_to_run_variance"],
              measurement_hint: "Compare exact match, average tokens, and run-to-run variance under a matched-budget trigger.",
              boundary_condition: "The effect may vanish when disagreement is a noisy trigger."
            },
            {
              id: "cand_2",
              text: "A correction stage only helps if wrong-to-right edits exceed right-to-wrong damage.",
              novelty: 3,
              feasibility: 5,
              testability: 5,
              cost: 2,
              expected_gain: 3,
              evidence_links: ["ev_2", "ev_1"],
              rationale: "This turns the negative result into a measurable gating hypothesis.",
              reproducibility_signals: ["answer_change_rate", "run_to_run_variance"],
              measurement_hint: "Track correction rate, damage rate, and repeated-run variance.",
              boundary_condition: "The effect reverses when the model is weak at self-critique."
            }
          ],
          selected_ids: ["cand_1", "cand_2"]
        })
      ],
      0,
      gate.promise
    );

    const eventStream = new InMemoryEventStream();
    const node = createGenerateHypothesesNode({
      config: {} as any,
      runStore: {} as any,
      eventStream,
      llm,
      pdfTextLlm: llm,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });
    gate.resolve();

    expect(result.status).toBe("success");
    expect(result.summary).toContain("Single-pass fallback selected two bounded hypotheses.");

    const status = JSON.parse(await readFile(path.join(runDir, "hypothesis_generation", "status.json"), "utf8")) as {
      status?: string;
      pipeline?: string;
      fallbackReason?: string;
      source?: string;
    };
    const trace = await readFile(path.join(runDir, "hypothesis_generation", "llm_trace.json"), "utf8");
    const progress = await readFile(path.join(runDir, "hypothesis_generation", "progress.jsonl"), "utf8");
    const hypotheses = await readFile(path.join(runDir, "hypotheses.jsonl"), "utf8");

    expect(status.status).toBe("completed");
    expect(status.pipeline).toBe("single_pass");
    expect(status.source).toBe("llm");
    expect(status.fallbackReason).toContain("hypothesis_axes_timeout:10ms");
    expect(trace).toContain('"single_pass"');
    expect(progress).toContain("Staged hypothesis pipeline failed, retrying single-pass generation");
    expect(hypotheses).toContain('"candidate_id":"single_pass_1"');
  });

  it("down-weights abstract-only or caveated evidence during hypothesis selection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-hypothesis-evidence-quality-"));
    process.chdir(root);

    const runId = "run-hypothesis-evidence-quality";
    const run = makeRun(runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(
      path.join(runDir, "evidence_store.jsonl"),
      [
        JSON.stringify({
          evidence_id: "ev_1",
          paper_id: "paper_1",
          claim: "Message schemas may reduce ambiguity.",
          evidence_span: "The abstract suggests structured handoffs can help.",
          limitation_slot: "No full-text validation was available.",
          dataset_slot: "HumanEval",
          metric_slot: "pass@1 variance",
          source_type: "abstract",
          confidence: 0.58,
          confidence_reason: "Only the abstract supports this claim."
        }),
        JSON.stringify({
          evidence_id: "ev_2",
          paper_id: "paper_2",
          claim: "Execution feedback improves reproducibility.",
          evidence_span: "Repeated test-repair loops reduced run-to-run variance in the full paper.",
          limitation_slot: "Adds validator cost.",
          dataset_slot: "MBPP",
          metric_slot: "executability",
          source_type: "full_text",
          confidence: 0.93
        })
      ].join("\n") + "\n",
      "utf8"
    );
    await writeFile(
      path.join(runDir, "corpus.jsonl"),
      [
        JSON.stringify({ paper_id: "paper_1", title: "Paper One" }),
        JSON.stringify({ paper_id: "paper_2", title: "Paper Two" })
      ].join("\n") + "\n",
      "utf8"
    );

    const llm = new QueueJsonLLMClient([
      JSON.stringify({
        summary: "Mapped evidence into two axes.",
        axes: [
          {
            id: "ax_1",
            label: "Structured messaging",
            mechanism: "Typed handoffs may reduce ambiguity.",
            intervention: "Constrain agent messages to fixed schemas.",
            evaluation_hint: "Measure run-to-run variance.",
            evidence_links: ["ev_1"]
          },
          {
            id: "ax_2",
            label: "Execution feedback",
            mechanism: "Validator-backed correction reduces failure cascades.",
            intervention: "Add bounded execute-test-repair loops.",
            evaluation_hint: "Measure failure-mode stability.",
            evidence_links: ["ev_2"]
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated mechanism drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Schema-constrained handoffs will reduce run-to-run variance relative to free-form chat.",
            novelty: 5,
            feasibility: 4,
            testability: 5,
            cost: 2,
            expected_gain: 5,
            evidence_links: ["ev_1"],
            axis_ids: ["ax_1"],
            rationale: "The intervention is easy to implement."
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated contradiction drafts.",
        candidates: [
          {
            id: "cand_2",
            text: "Schema-constrained handoffs help less when tasks already expose deterministic interfaces.",
            novelty: 3,
            feasibility: 4,
            testability: 4,
            cost: 2,
            expected_gain: 3,
            evidence_links: ["ev_1"],
            axis_ids: ["ax_1"],
            rationale: "The effect likely weakens when ambiguity is already low."
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated intervention drafts.",
        candidates: [
          {
            id: "cand_3",
            text: "Bounded execute-test-repair loops will improve reproducibility more than extra peer discussion.",
            novelty: 4,
            feasibility: 4,
            testability: 5,
            cost: 2,
            expected_gain: 5,
            evidence_links: ["ev_2"],
            axis_ids: ["ax_2"],
            rationale: "Execution-grounded correction is directly testable."
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
            reproducibility_specificity: 5,
            reproducibility_signals: ["run_to_run_variance"],
            measurement_hint: "Measure repeated-run variance across fixed seeds.",
            limitation_reflection: 4,
            measurement_readiness: 5,
            strengths: ["Clear intervention and baseline."],
            weaknesses: ["Evidence is abstract-only."],
            critique_summary: "Good idea but the support is indirect."
          },
          {
            candidate_id: "contradiction_1",
            keep: false,
            groundedness: 3,
            causal_clarity: 3,
            falsifiability: 2,
            experimentability: 2,
            reproducibility_specificity: 2,
            reproducibility_signals: [],
            limitation_reflection: 3,
            measurement_readiness: 1,
            strengths: ["Interesting boundary condition."],
            weaknesses: ["Still underspecified."],
            critique_summary: "Too weak."
          },
          {
            candidate_id: "intervention_1",
            keep: true,
            groundedness: 5,
            causal_clarity: 5,
            falsifiability: 5,
            experimentability: 5,
            reproducibility_specificity: 5,
            reproducibility_signals: ["failure_mode_stability", "run_to_run_variance"],
            measurement_hint: "Track failure-mode stability and repeated-run variance.",
            limitation_reflection: 4,
            measurement_readiness: 5,
            strengths: ["Directly implementable."],
            weaknesses: ["Adds validator cost."],
            critique_summary: "Best overall evidence support."
          }
        ]
      })
    ]);

    const eventStream = new InMemoryEventStream();
    const node = createGenerateHypothesesNode({
      config: {} as any,
      runStore: {} as any,
      eventStream,
      llm,
      pdfTextLlm: llm,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const hypotheses = await readFile(path.join(runDir, "hypotheses.jsonl"), "utf8");
    const selection = await readFile(path.join(runDir, "hypothesis_generation", "selection.json"), "utf8");
    const selectionJson = JSON.parse(selection) as {
      scores?: Array<{
        candidate_id: string;
        evidence_quality_adjustment?: number;
        evidence_quality_notes?: string[];
        final_score?: number;
      }>;
    };

    expect(hypotheses).toContain('"candidate_id":"intervention_1"');
    expect(hypotheses).toContain('"selection_rank":1');
    expect(hypotheses).toContain('"evidence_quality_adjustment"');
    const mechanismScore = selectionJson.scores?.find((item) => item.candidate_id === "mechanism_1");
    const interventionScore = selectionJson.scores?.find((item) => item.candidate_id === "intervention_1");
    expect(mechanismScore?.evidence_quality_adjustment).toBeLessThan(0);
    expect(mechanismScore?.evidence_quality_notes).toContain("abstract_support");
    expect(interventionScore?.evidence_quality_adjustment).toBeGreaterThan(0);
    expect((interventionScore?.final_score ?? 0)).toBeGreaterThan(mechanismScore?.final_score ?? 0);
    const logs = eventStream.history().map((event) => String(event.payload?.text ?? ""));
    expect(logs.some((line) => line.includes("Evidence-quality guardrail"))).toBe(true);
  });

  it("fails fast when no evidence items are available", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-hypothesis-node-empty-"));
    process.chdir(root);

    const runId = "run-hypothesis-empty";
    const run = makeRun(runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(path.join(runDir, "evidence_store.jsonl"), "", "utf8");

    const llm = new QueueJsonLLMClient([]);
    const node = createGenerateHypothesesNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm,
      pdfTextLlm: llm,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });
    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));

    expect(result.status).toBe("failure");
    expect(result.summary).toContain("No evidence is available");
    await expect(access(path.join(runDir, "hypotheses.jsonl"))).rejects.toThrow();
    await expect(runContext.get("generate_hypotheses.top_k")).resolves.toBe(0);
    await expect(runContext.get("generate_hypotheses.candidate_count")).resolves.toBe(0);
    await expect(runContext.get("generate_hypotheses.source")).resolves.toBe("missing_evidence");
  });
});
