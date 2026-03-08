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
        summary: "Generated six candidate hypotheses.",
        candidates: [
          {
            id: "cand_1",
            text: "Tool-use planning improves multi-agent recovery quality.",
            novelty: 4,
            feasibility: 4,
            testability: 5,
            cost: 2,
            expected_gain: 5,
            evidence_links: ["ev_1"],
            rationale: "Grounded in the strongest evidence item."
          },
          {
            id: "cand_2",
            text: "Shared episodic memory reduces repeated agent failures.",
            novelty: 5,
            feasibility: 3,
            testability: 4,
            cost: 2,
            expected_gain: 4,
            evidence_links: ["ev_2"]
          }
        ],
        selected_ids: ["cand_2", "cand_1"]
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
    expect(result.candidates).toHaveLength(2);
    expect(result.selected.map((item) => item.id)).toEqual(["cand_2", "cand_1"]);
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
  });

  it("builds structured experiment designs from LLM JSON", async () => {
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
            metrics: ["accuracy", "recovery_rate"],
            baselines: ["single_agent"],
            implementation_notes: ["Instrument recovery traces."],
            evaluation_steps: ["Compare baseline and intervention."],
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
      objectiveMetric: "accuracy >= 0.9",
      hypotheses: [{ hypothesis_id: "h_1", text: "Recovery planning improves accuracy." }],
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
        raw: "accuracy >= 0.9",
        primaryMetric: "accuracy",
        preferredMetricKeys: ["accuracy"],
        comparator: ">=",
        targetValue: 0.9,
        targetDescription: ">= 0.9",
        analysisFocus: [],
        paperEmphasis: [],
        assumptions: []
      },
      candidateCount: 3
    });

    expect(result.source).toBe("llm");
    expect(result.selected.id).toBe("plan_1");
    expect(result.selected.metrics).toContain("accuracy");
  });
});
