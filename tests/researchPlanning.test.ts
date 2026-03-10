import { describe, expect, it } from "vitest";

import {
  designExperimentsFromHypotheses,
  generateHypothesesFromEvidence
} from "../src/core/analysis/researchPlanning.js";
import { MockLLMClient } from "../src/core/llm/client.js";

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

describe("researchPlanning helpers", () => {
  it("generates structured hypothesis candidates from LLM JSON", async () => {
    const llm = new QueueJsonLLMClient([
      JSON.stringify({
        summary: "Mapped evidence into reproducibility axes.",
        axes: [
          {
            id: "ax_1",
            label: "Structured communication",
            mechanism: "Structured interfaces reduce ambiguous handoffs.",
            intervention: "Replace free-form agent chat with schema-constrained messages.",
            boundary_condition: "Benefits may shrink on tasks that already use deterministic APIs.",
            evaluation_hint: "Measure run-to-run variance and message validity.",
            evidence_links: ["ev_1"]
          },
          {
            id: "ax_2",
            label: "Executable feedback",
            mechanism: "Execution-grounded correction prevents error cascades.",
            intervention: "Add bounded test-execute-repair loops.",
            boundary_condition: "May add cost on tasks without cheap validators.",
            evaluation_hint: "Measure pass-rate variance and failure mode stability.",
            evidence_links: ["ev_2"]
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated mechanism drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Schema-constrained inter-agent messages will reduce run-to-run variance relative to free-form chat on software-generation benchmarks.",
            novelty: 4,
            feasibility: 4,
            testability: 5,
            cost: 2,
            expected_gain: 5,
            evidence_links: ["ev_1"],
            axis_ids: ["ax_1"],
            rationale: "This isolates communication structure as the intervention."
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated contradiction drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Role-specialized multi-agent setups improve reproducibility only on tasks with stable decomposition; on tightly coupled reasoning tasks they will match or trail solo baselines.",
            novelty: 5,
            feasibility: 3,
            testability: 4,
            cost: 2,
            expected_gain: 4,
            evidence_links: ["ev_2"],
            axis_ids: ["ax_2"],
            rationale: "Task dependence should be exposed directly as a boundary condition."
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated intervention drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Bounded execution-feedback loops will improve reproducibility more than extra peer discussion because validator-backed corrections reduce error amplification.",
            novelty: 4,
            feasibility: 5,
            testability: 5,
            cost: 2,
            expected_gain: 5,
            evidence_links: ["ev_1", "ev_2"],
            axis_ids: ["ax_2"],
            rationale: "The intervention is explicit and directly testable."
          }
        ]
      }),
      JSON.stringify({
        summary: "Selected the most falsifiable drafts.",
        reviews: [
          {
            candidate_id: "mechanism_1",
            keep: true,
            groundedness: 4,
            causal_clarity: 5,
            falsifiability: 5,
            experimentability: 5,
            strengths: ["Clear intervention and baseline."],
            weaknesses: ["Mostly software-generation focused."],
            critique_summary: "Strong, targeted hypothesis."
          },
          {
            candidate_id: "contradiction_1",
            keep: false,
            groundedness: 3,
            causal_clarity: 3,
            falsifiability: 3,
            experimentability: 2,
            strengths: ["Interesting task boundary."],
            weaknesses: ["Needs a sharper operational definition."],
            critique_summary: "Promising but underspecified."
          },
          {
            candidate_id: "intervention_1",
            keep: true,
            groundedness: 5,
            causal_clarity: 5,
            falsifiability: 5,
            experimentability: 5,
            strengths: ["Directly implementable."],
            weaknesses: ["May increase runtime cost."],
            critique_summary: "Best overall balance."
          }
        ]
      })
    ]);

    const result = await generateHypothesesFromEvidence({
      llm,
      runTitle: "Multi-Agent Collaboration",
      runTopic: "Multi-Agent Collaboration",
      objectiveMetric: "accuracy >= 0.9",
      evidenceSeeds: [
        { evidence_id: "ev_1", claim: "Planning matters." },
        { evidence_id: "ev_2", claim: "Memory matters." }
      ],
      branchCount: 6,
      topK: 2
    });

    expect(result.source).toBe("llm");
    expect(result.toolCallsUsed).toBe(5);
    expect(result.artifacts.pipeline).toBe("staged");
    expect(result.artifacts.evidence_axes).toHaveLength(2);
    expect(result.candidates).toHaveLength(3);
    expect(result.selected.map((item) => item.id)).toEqual(["intervention_1", "mechanism_1"]);
    expect(new Set(result.selected.map((item) => item.id)).size).toBe(result.selected.length);
  });

  it("falls back deterministically when hypothesis JSON is invalid", async () => {
    const llm = new QueueJsonLLMClient(["not json"]);

    const result = await generateHypothesesFromEvidence({
      llm,
      runTitle: "Multi-Agent Collaboration",
      runTopic: "Multi-Agent Collaboration",
      objectiveMetric: "accuracy >= 0.9",
      evidenceSeeds: [{ evidence_id: "ev_1", claim: "Planning matters." }],
      branchCount: 4,
      topK: 2
    });

    expect(result.source).toBe("fallback");
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    expect(result.selected).toHaveLength(2);
    expect(result.artifacts.pipeline).toBe("fallback");
  });

  it("builds structured experiment designs from LLM JSON and augments reproducibility guidance", async () => {
    const llm = new QueueJsonLLMClient([
      JSON.stringify({
        summary: "Generated three experiment plans.",
        candidates: [
          {
            id: "plan_1",
            title: "Recovery benchmark",
            hypothesis_ids: ["h_1"],
            plan_summary: "Evaluate recovery behavior against a baseline.",
            datasets: ["Benchmark-A"],
            metrics: [],
            baselines: [],
            implementation_notes: [],
            evaluation_steps: [],
            risks: ["Benchmark may be too narrow."],
            budget_notes: ["Keep runs under local budget."]
          }
        ],
        selected_id: "plan_1"
      })
    ]);

    const result = await designExperimentsFromHypotheses({
      llm,
      runTitle: "Multi-Agent Collaboration",
      runTopic: "Multi-Agent Collaboration",
      objectiveMetric: "state-of-the-art reproducibility",
      hypotheses: [
        {
          hypothesis_id: "h_1",
          text: "Typed message schemas will reduce run-to-run variance relative to free-form chat.",
          reproducibility_specificity: 5,
          reproducibility_signals: ["run_to_run_variance", "artifact_consistency"],
          measurement_hint: "Measure pass@1 variance and artifact consistency across repeated runs."
        }
      ],
      constraintProfile: {
        source: "heuristic_fallback",
        collect: {},
        writing: {},
        experiment: {
          designNotes: [],
          implementationNotes: [],
          evaluationNotes: []
        },
        assumptions: []
      },
      objectiveProfile: {
        source: "heuristic_fallback",
        raw: "state-of-the-art reproducibility",
        primaryMetric: "reproducibility",
        preferredMetricKeys: ["reproducibility", "reproducibility_score"],
        analysisFocus: [],
        paperEmphasis: [],
        assumptions: []
      },
      candidateCount: 3
    });

    expect(result.source).toBe("llm");
    expect(result.selected.id).toBe("plan_1");
    expect(result.selected.metrics).toContain("reproducibility");
    expect(result.selected.metrics).toContain("run_to_run_variance");
    expect(result.selected.metrics).toContain("artifact_consistency_rate");
    expect(result.selected.baselines).toContain("free_form_chat_baseline");
    expect(result.selected.evaluation_steps.some((step) => step.includes("repeated runs"))).toBe(true);
    expect(result.selected.implementation_notes.some((step) => step.includes("Measurement"))).toBe(false);
    expect(result.selected.implementation_notes.some((step) => step.includes("Instrumentation should support"))).toBe(true);
  });
});
