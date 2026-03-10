import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { createGenerateHypothesesNode, normalizeGenerateHypothesesRequest } from "../src/core/nodes/generateHypotheses.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

class QueueJsonLLMClient extends MockLLMClient {
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

afterEach(() => {
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
      runContextPath: `.autoresearch/runs/${runId}/memory/run_context.json`,
      longTermPath: `.autoresearch/runs/${runId}/memory/long_term.jsonl`,
      episodePath: `.autoresearch/runs/${runId}/memory/episodes.jsonl`
    }
  };
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
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-hypothesis-node-"));
    process.chdir(root);

    const runId = "run-hypothesis-artifacts";
    const run = makeRun(runId);
    const runDir = path.join(root, ".autoresearch", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(
      path.join(runDir, "evidence_store.jsonl"),
      [
        JSON.stringify({
          evidence_id: "ev_1",
          paper_id: "paper_1",
          claim: "Structured communication reduces ambiguity.",
          limitation_slot: "Not isolated against routing alone.",
          dataset_slot: "HumanEval",
          metric_slot: "pass@1 variance",
          confidence: 0.95
        }),
        JSON.stringify({
          evidence_id: "ev_2",
          paper_id: "paper_2",
          claim: "Execution feedback improves iterative correction.",
          limitation_slot: "Adds validator cost.",
          dataset_slot: "MBPP",
          metric_slot: "executability",
          confidence: 0.94
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const llm = new QueueJsonLLMClient([
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
            strengths: ["Directly implementable."],
            weaknesses: ["Adds execution cost."],
            critique_summary: "Excellent."
          }
        ]
      })
    ]);

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
    const selection = await readFile(path.join(runDir, "hypothesis_generation", "selection.json"), "utf8");

    expect(hypotheses).toContain('"candidate_id":"intervention_1"');
    expect(hypotheses).toContain('"candidate_id":"mechanism_1"');
    expect(axes).toContain('"label": "Structured communication"');
    expect(drafts).toContain('"generator_kind":"mechanism"');
    expect(reviews).toContain('"candidate_id":"intervention_1"');
    expect(selection).toContain('"selected_ids"');
  });
});
