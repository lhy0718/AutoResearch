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

  override async complete(_prompt: string): Promise<{ text: string }> {
    const output = this.outputs[Math.min(this.index, this.outputs.length - 1)] ?? "";
    this.index += 1;
    return { text: output };
  }
}

class CapturingQueueJsonLLMClient extends QueueJsonLLMClient {
  readonly prompts: string[] = [];

  override async complete(prompt: string): Promise<{ text: string }> {
    this.prompts.push(prompt);
    return await super.complete(prompt);
  }
}

class HangingLLMClient extends MockLLMClient {
  override async complete(): Promise<{ text: string }> {
    return await new Promise<{ text: string }>(() => {});
  }
}

class QueueProgressThenHangLLMClient extends MockLLMClient {
  private index = 0;

  constructor(private readonly partialOutputs: string[]) {
    super();
  }

  override async complete(
    _prompt: string,
    opts?: { onProgress?: (event: { type: "status" | "delta"; text: string }) => void; abortSignal?: AbortSignal }
  ): Promise<{ text: string }> {
    const partial = this.partialOutputs[Math.min(this.index, this.partialOutputs.length - 1)] ?? "";
    this.index += 1;
    if (partial) {
      opts?.onProgress?.({ type: "delta", text: partial });
    }
    return await new Promise<{ text: string }>((_, reject) => {
      opts?.abortSignal?.addEventListener(
        "abort",
        () => reject(new Error("Operation aborted by user")),
        { once: true }
      );
    });
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
            reproducibility_specificity: 5,
            reproducibility_signals: ["run_to_run_variance"],
            measurement_hint: "Measure run-to-run variance across repeated seeded runs.",
            limitation_reflection: 4,
            measurement_readiness: 5,
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
            reproducibility_specificity: 2,
            reproducibility_signals: [],
            limitation_reflection: 2,
            measurement_readiness: 1,
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
            reproducibility_specificity: 5,
            reproducibility_signals: ["failure_mode_stability", "run_to_run_variance"],
            measurement_hint: "Measure failure-mode stability and repeated-run variance.",
            limitation_reflection: 4,
            measurement_readiness: 5,
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
    expect(result.artifacts.llm_trace.axes?.prompt).toContain("Evidence panel:");
    expect(result.artifacts.llm_trace.drafts).toHaveLength(3);
    expect(result.artifacts.llm_trace.review?.completion).toContain("Selected the most falsifiable drafts.");
    expect(result.candidates).toHaveLength(2);
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

  it("captures partial staged and single-pass hypothesis output before timeout fallback", async () => {
    const llm = new QueueProgressThenHangLLMClient([
      '{"summary":"partial axes"',
      '{"summary":"partial single-pass"'
    ]);

    const result = await generateHypothesesFromEvidence({
      llm,
      runTitle: "Multi-Agent Collaboration",
      runTopic: "Multi-Agent Collaboration",
      objectiveMetric: "accuracy >= 0.9",
      evidenceSeeds: [{ evidence_id: "ev_1", claim: "Planning matters." }],
      branchCount: 4,
      topK: 2,
      timeoutMs: 10
    });

    expect(result.source).toBe("fallback");
    expect(result.fallbackReason).toContain("hypothesis_axes_timeout:10ms");
    expect(result.fallbackReason).toContain("hypothesis_single_pass_timeout:10ms");
    expect(result.artifacts.llm_trace.axes_partial?.completion).toContain("partial axes");
    expect(result.artifacts.llm_trace.single_pass_partial?.completion).toContain("partial single-pass");
  });

  it("repairs truncated hypothesis-planning JSON and continues the staged pipeline", async () => {
    const llm = new QueueJsonLLMClient([
      '{"summary":"Mapped evidence into one axis.","axes":[{"id":"ax_1","label":"Structured communication","mechanism":"Structured interfaces reduce ambiguity.","intervention":"Compare typed messages against free-form chat.","evaluation_hint":"Measure run-to-run variance.","evidence_links":["ev_1"]}]',
      JSON.stringify({
        summary: "Generated mechanism drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Typed message schemas will reduce run-to-run variance relative to free-form chat.",
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
        candidates: []
      }),
      JSON.stringify({
        summary: "Generated intervention drafts.",
        candidates: []
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
            reproducibility_specificity: 5,
            reproducibility_signals: ["run_to_run_variance"],
            measurement_hint: "Measure run-to-run variance across repeated seeded runs.",
            limitation_reflection: 4,
            measurement_readiness: 5,
            strengths: ["Clear intervention and baseline."],
            weaknesses: ["Mostly software-generation focused."],
            critique_summary: "Strong, targeted hypothesis."
          }
        ]
      })
    ]);

    const result = await generateHypothesesFromEvidence({
      llm,
      runTitle: "Multi-Agent Collaboration",
      runTopic: "Multi-Agent Collaboration",
      objectiveMetric: "accuracy >= 0.9",
      evidenceSeeds: [{ evidence_id: "ev_1", claim: "Planning matters." }],
      branchCount: 4,
      topK: 1
    });

    expect(result.source).toBe("llm");
    expect(result.artifacts.pipeline).toBe("staged");
    expect(result.artifacts.evidence_axes).toHaveLength(1);
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]?.id).toBe("mechanism_1");
  });

  it("does not reselect review-rejected hypotheses when fewer than top-k survive review", async () => {
    const llm = new QueueJsonLLMClient([
      JSON.stringify({
        summary: "Mapped evidence into one axis.",
        axes: [
          {
            id: "ax_1",
            label: "Structured communication",
            mechanism: "Structured interfaces reduce ambiguity.",
            intervention: "Compare typed messages against free-form chat.",
            evidence_links: ["ev_1"]
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated mechanism drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Typed message schemas will reduce run-to-run variance relative to free-form chat.",
            novelty: 4,
            feasibility: 4,
            testability: 5,
            cost: 2,
            expected_gain: 5,
            evidence_links: ["ev_1"],
            axis_ids: ["ax_1"],
            rationale: "Directly tests structured handoff."
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated contradiction drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "A broader coordination package will outperform the schema-only intervention.",
            novelty: 5,
            feasibility: 4,
            testability: 4,
            cost: 3,
            expected_gain: 5,
            evidence_links: ["ev_1"],
            axis_ids: ["ax_1"],
            rationale: "Combines several changes."
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated intervention drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Adding discussion plus repair plus routing changes will improve reproducibility.",
            novelty: 5,
            feasibility: 4,
            testability: 4,
            cost: 3,
            expected_gain: 5,
            evidence_links: ["ev_1"],
            axis_ids: ["ax_1"],
            rationale: "Covers multiple interventions at once."
          }
        ]
      }),
      JSON.stringify({
        summary: "Rejected the bundled variants.",
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
            measurement_hint: "Measure variance over repeated seeded runs.",
            limitation_reflection: 4,
            measurement_readiness: 5,
            strengths: ["Clear intervention and baseline."],
            weaknesses: ["Narrow benchmark coverage."],
            critique_summary: "Keep."
          },
          {
            candidate_id: "contradiction_1",
            keep: false,
            groundedness: 4,
            causal_clarity: 3,
            falsifiability: 3,
            experimentability: 2,
            reproducibility_specificity: 2,
            reproducibility_signals: [],
            limitation_reflection: 2,
            measurement_readiness: 1,
            strengths: ["Ambitious."],
            weaknesses: ["Bundled and hard to isolate."],
            critique_summary: "Reject."
          },
          {
            candidate_id: "intervention_1",
            keep: false,
            groundedness: 4,
            causal_clarity: 3,
            falsifiability: 3,
            experimentability: 2,
            reproducibility_specificity: 2,
            reproducibility_signals: [],
            limitation_reflection: 2,
            measurement_readiness: 1,
            strengths: ["Potentially strong effect."],
            weaknesses: ["Conflates several interventions."],
            critique_summary: "Reject."
          }
        ]
      })
    ]);

    const result = await generateHypothesesFromEvidence({
      llm,
      runTitle: "Multi-Agent Collaboration",
      runTopic: "Multi-Agent Collaboration",
      objectiveMetric: "state-of-the-art reproducibility",
      evidenceSeeds: [{ evidence_id: "ev_1", claim: "Structured handoff reduces ambiguity." }],
      branchCount: 6,
      topK: 2
    });

    expect(result.artifacts.pipeline).toBe("staged");
    expect(result.selected.map((item) => item.id)).toEqual(["mechanism_1"]);
    expect(result.artifacts.selection.ranked_ids).toEqual(["mechanism_1"]);
  });

  it("falls back to single-pass generation when staged review coverage is incomplete", async () => {
    const llm = new CapturingQueueJsonLLMClient([
      JSON.stringify({
        summary: "Mapped evidence into one axis.",
        axes: [
          {
            id: "ax_1",
            label: "Execution feedback",
            mechanism: "Validator-backed correction reduces drift.",
            intervention: "Add bounded execute-test-repair loops.",
            evidence_links: ["ev_1"]
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated mechanism drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Bounded repair loops will reduce run-to-run variance.",
            novelty: 4,
            feasibility: 4,
            testability: 5,
            cost: 2,
            expected_gain: 5,
            evidence_links: ["ev_1"],
            axis_ids: ["ax_1"],
            rationale: "Directly testable."
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated contradiction drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Repair loops help only when validators are cheap.",
            novelty: 4,
            feasibility: 4,
            testability: 4,
            cost: 2,
            expected_gain: 4,
            evidence_links: ["ev_1"],
            axis_ids: ["ax_1"],
            rationale: "A boundary-condition hypothesis."
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated intervention drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Repair loops beat extra peer discussion for reproducibility.",
            novelty: 4,
            feasibility: 5,
            testability: 5,
            cost: 2,
            expected_gain: 5,
            evidence_links: ["ev_1"],
            axis_ids: ["ax_1"],
            rationale: "Intervention-first hypothesis."
          }
        ]
      }),
      JSON.stringify({
        summary: "Only partially reviewed the drafts.",
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
            measurement_hint: "Compare repeated seeded runs.",
            limitation_reflection: 4,
            measurement_readiness: 5,
            strengths: ["Clear intervention."],
            weaknesses: ["Needs more task diversity."],
            critique_summary: "Keep."
          }
        ]
      }),
      JSON.stringify({
        summary: "Recovered via single-pass generation.",
        candidates: [
          {
            id: "cand_1",
            text: "Schema-constrained execution feedback will reduce failure-mode variance.",
            novelty: 4,
            feasibility: 5,
            testability: 5,
            cost: 2,
            expected_gain: 5,
            evidence_links: ["ev_1"],
            rationale: "Recovered after incomplete staged review.",
            reproducibility_signals: ["failure_mode_stability", "run_to_run_variance"],
            measurement_hint: "Measure failure-mode variance across repeated seeded runs.",
            boundary_condition: "Benefits may shrink when validators are unreliable."
          }
        ],
        selected_ids: ["cand_1"]
      })
    ]);

    const result = await generateHypothesesFromEvidence({
      llm,
      runTitle: "Multi-Agent Collaboration",
      runTopic: "Multi-Agent Collaboration",
      objectiveMetric: "state-of-the-art reproducibility",
      evidenceSeeds: [{ evidence_id: "ev_1", claim: "Execution feedback improves correction." }],
      branchCount: 6,
      topK: 2
    });

    expect(result.source).toBe("llm");
    expect(result.artifacts.pipeline).toBe("single_pass");
    expect(result.fallbackReason).toContain("incomplete_hypothesis_reviews:2");
    expect(result.selected.map((item) => item.id)).toEqual(["single_pass_1"]);
    const singlePassPrompt = llm.prompts.at(-1) ?? "";
    expect((singlePassPrompt.match(/evidence_id=/g) ?? []).length).toBeLessThanOrEqual(6);
    expect(singlePassPrompt).not.toContain("paper_id=");
    expect(singlePassPrompt).not.toContain("confidence_reason=");
  });

  it("compresses staged hypothesis evidence prompts to a smaller compact panel", async () => {
    const llm = new CapturingQueueJsonLLMClient([
      JSON.stringify({
        summary: "Mapped evidence into one axis.",
        axes: [
          {
            id: "ax_1",
            label: "Structured communication",
            mechanism: "Typed handoffs reduce ambiguity.",
            intervention: "Use schema-constrained messages.",
            evidence_links: ["ev_1", "ev_2"]
          }
        ]
      }),
      JSON.stringify({ summary: "Generated mechanism drafts.", candidates: [] }),
      JSON.stringify({ summary: "Generated contradiction drafts.", candidates: [] }),
      JSON.stringify({ summary: "Generated intervention drafts.", candidates: [] }),
      JSON.stringify({
        summary: "No drafts survived review.",
        reviews: []
      })
    ]);

    await generateHypothesesFromEvidence({
      llm,
      runTitle: "Multi-Agent Collaboration",
      runTopic: "Multi-Agent Collaboration",
      objectiveMetric: "state-of-the-art reproducibility",
      evidenceSeeds: Array.from({ length: 20 }, (_, index) => ({
        evidence_id: `ev_${index + 1}`,
        paper_id: `paper_${index + 1}`,
        claim: `This is a deliberately verbose evidence claim number ${index + 1} that should be truncated before hypothesis planning prompts are built because long claims increase latency and token pressure.`,
        limitation_slot: `limitation_${index + 1}`,
        dataset_slot: `dataset_${index + 1}`,
        metric_slot: `metric_${index + 1}`,
        confidence: 0.4,
        source_type: index % 2 === 0 ? "full_text" : "abstract",
        confidence_reason:
          "This long confidence rationale should never be forwarded into the compact hypothesis planning prompts."
      })),
      branchCount: 6,
      topK: 2
    });

    const axesPrompt = llm.prompts[0] ?? "";
    expect((axesPrompt.match(/evidence_id=/g) ?? []).length).toBeLessThanOrEqual(8);
    expect(axesPrompt).not.toContain("paper_id=");
    expect(axesPrompt).not.toContain("confidence_reason=");
  });

  it("hard-gates weakly grounded hypotheses on evidence count, limitation handling, and measurement readiness", async () => {
    const llm = new QueueJsonLLMClient([
      JSON.stringify({
        summary: "Mapped evidence into two axes.",
        axes: [
          {
            id: "ax_1",
            label: "Structured communication",
            mechanism: "Typed handoffs reduce ambiguity.",
            intervention: "Use schema-constrained messages.",
            boundary_condition: "Benefits may shrink on already deterministic tasks.",
            evidence_links: ["ev_1", "ev_2"]
          },
          {
            id: "ax_2",
            label: "Execution feedback",
            mechanism: "Validator-backed repair reduces error cascades.",
            intervention: "Add bounded execute-test-repair loops.",
            boundary_condition: "Less useful when validators are unreliable.",
            evidence_links: ["ev_2", "ev_3"]
          }
        ]
      }),
      JSON.stringify({
        summary: "Refined axes with the remaining evidence.",
        axes: []
      }),
      JSON.stringify({
        summary: "Generated mechanism drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Typed message schemas will reduce run-to-run variance.",
            novelty: 4,
            feasibility: 4,
            testability: 5,
            cost: 2,
            expected_gain: 5,
            evidence_links: ["ev_1"],
            axis_ids: ["ax_1"],
            rationale: "Grounded in a single schema paper."
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated contradiction drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Repair loops help less when validators are unreliable.",
            novelty: 4,
            feasibility: 4,
            testability: 4,
            cost: 2,
            expected_gain: 4,
            evidence_links: ["ev_2", "ev_3"],
            axis_ids: ["ax_2"],
            rationale: "Boundary condition implied by the evidence."
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated intervention drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Combining schema-constrained messages with bounded repair loops will reduce failure variance.",
            novelty: 4,
            feasibility: 5,
            testability: 5,
            cost: 2,
            expected_gain: 5,
            evidence_links: ["ev_1", "ev_2"],
            axis_ids: ["ax_1", "ax_2"],
            rationale: "Both intervention and measurement are explicit."
          }
        ]
      }),
      JSON.stringify({
        summary: "Applied hard-gate aware review.",
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
            measurement_hint: "Measure repeated-run variance across seeded runs.",
            limitation_reflection: 4,
            measurement_readiness: 5,
            strengths: ["Clear intervention."],
            weaknesses: ["Only one evidence item is linked."],
            critique_summary: "Fails evidence-count gate."
          },
          {
            candidate_id: "contradiction_1",
            keep: true,
            groundedness: 4,
            causal_clarity: 4,
            falsifiability: 4,
            experimentability: 4,
            reproducibility_specificity: 4,
            reproducibility_signals: ["failure_mode_stability"],
            limitation_reflection: 1,
            measurement_readiness: 1,
            strengths: ["Interesting boundary condition."],
            weaknesses: ["Does not explain how to measure the predicted failure mode."],
            critique_summary: "Fails limitation and measurement gates."
          },
          {
            candidate_id: "intervention_1",
            keep: true,
            groundedness: 5,
            causal_clarity: 5,
            falsifiability: 5,
            experimentability: 5,
            reproducibility_specificity: 5,
            reproducibility_signals: ["run_to_run_variance", "failure_mode_stability"],
            measurement_hint: "Track run-to-run variance and failure-mode stability across repeated seeded runs.",
            limitation_reflection: 4,
            measurement_readiness: 5,
            strengths: ["Operationalized and evidence-backed."],
            weaknesses: ["Adds execution cost."],
            critique_summary: "Passes the hard gates."
          }
        ]
      })
    ]);

    const result = await generateHypothesesFromEvidence({
      llm,
      runTitle: "Multi-Agent Collaboration",
      runTopic: "Multi-Agent Collaboration",
      objectiveMetric: "state-of-the-art reproducibility",
      evidenceSeeds: [
        { evidence_id: "ev_1", claim: "Structured handoff reduces ambiguity.", limitation_slot: "Effects shrink on deterministic APIs." },
        { evidence_id: "ev_2", claim: "Execution feedback improves correction.", limitation_slot: "Validator quality matters." },
        { evidence_id: "ev_3", claim: "Repair loops depend on validator reliability.", limitation_slot: "Noisy validators can reverse gains." }
      ],
      branchCount: 6,
      topK: 2
    });

    expect(result.artifacts.pipeline).toBe("staged");
    expect(result.candidates.map((item) => item.id)).toEqual(["intervention_1"]);
    expect(result.selected.map((item) => item.id)).toEqual(["intervention_1"]);
    expect(result.artifacts.selection.ranked_ids).toEqual(["intervention_1"]);
  });

  it("prefers cleaner, more implementable hypotheses over broader bundled ones", async () => {
    const llm = new QueueJsonLLMClient([
      JSON.stringify({
        summary: "Mapped evidence into one axis.",
        axes: [
          {
            id: "ax_1",
            label: "Shared state",
            mechanism: "Explicit state handoff reduces hidden coordination drift.",
            intervention: "Compare structured state handoff against free-form dialogue.",
            boundary_condition: "Benefits may reverse when summaries are stale or lossy.",
            evaluation_hint: "Measure run-to-run variance and state agreement.",
            evidence_links: ["ev_1"]
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated mechanism drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "An explicit state-handoff package will reduce run-to-run variance relative to free-form dialogue on long-horizon tasks.",
            novelty: 4,
            feasibility: 5,
            testability: 5,
            cost: 3,
            expected_gain: 5,
            evidence_links: ["ev_1"],
            axis_ids: ["ax_1"],
            rationale: "This is an inference-time intervention with a direct control."
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated contradiction drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Compared with naive SFT, multi-agent trace distillation plus feedback-driven policy optimization will reduce across-seed and across-checkpoint variance across downstream tasks.",
            novelty: 5,
            feasibility: 5,
            testability: 5,
            cost: 2,
            expected_gain: 5,
            evidence_links: ["ev_1"],
            axis_ids: ["ax_1"],
            rationale: "This is a broader but more ambitious training hypothesis."
          }
        ]
      }),
      JSON.stringify({
        summary: "Generated intervention drafts.",
        candidates: [
          {
            id: "cand_1",
            text: "Validator-backed repair loops will reduce failure-mode variance relative to discussion-only baselines.",
            novelty: 4,
            feasibility: 4,
            testability: 4,
            cost: 3,
            expected_gain: 4,
            evidence_links: ["ev_1"],
            axis_ids: ["ax_1"],
            rationale: "Concrete but less central than the state-handoff hypothesis."
          }
        ]
      }),
      JSON.stringify({
        summary: "Selected the cleanest reproducibility hypotheses.",
        reviews: [
          {
            candidate_id: "mechanism_1",
            keep: true,
            groundedness: 5,
            causal_clarity: 5,
            falsifiability: 5,
            experimentability: 4,
            reproducibility_specificity: 5,
            reproducibility_signals: ["run_to_run_variance", "state_agreement"],
            measurement_hint: "Run 20 seeds and compare trajectory variance and state disagreement.",
            limitation_reflection: 4,
            measurement_readiness: 5,
            strengths: ["Clear control and concrete intervention."],
            weaknesses: ["Still treated as one package rather than isolated subcomponents."],
            critique_summary: "Clean and implementable."
          },
          {
            candidate_id: "contradiction_1",
            keep: true,
            groundedness: 4,
            causal_clarity: 4,
            falsifiability: 5,
            experimentability: 3,
            reproducibility_specificity: 5,
            reproducibility_signals: ["run_to_run_variance", "checkpoint_stability"],
            measurement_hint:
              "Train each regime with multiple seeds, evaluate several checkpoints, and sweep interaction-data size across downstream tasks.",
            limitation_reflection: 4,
            measurement_readiness: 5,
            strengths: ["Interesting training direction."],
            weaknesses: [
              "Merges two distinct interaction-aware methods into one combined treatment.",
              "The experimental scope is too broad and expensive.",
              "Separate arms are needed to keep the causal claim clean."
            ],
            critique_summary: "Interesting but over-bundled."
          },
          {
            candidate_id: "intervention_1",
            keep: true,
            groundedness: 4,
            causal_clarity: 4,
            falsifiability: 4,
            experimentability: 4,
            reproducibility_specificity: 4,
            reproducibility_signals: ["failure_mode_stability"],
            measurement_hint: "Repeat identical tasks across seeds and compare failure-mode frequencies.",
            limitation_reflection: 4,
            measurement_readiness: 5,
            strengths: ["Directly implementable."],
            weaknesses: ["Less grounded than the state-handoff hypothesis."],
            critique_summary: "Solid but secondary."
          }
        ]
      })
    ]);

    const result = await generateHypothesesFromEvidence({
      llm,
      runTitle: "Multi-Agent Collaboration",
      runTopic: "Multi-Agent Collaboration",
      objectiveMetric: "state-of-the-art reproducibility",
      evidenceSeeds: [{ evidence_id: "ev_1", claim: "Structured handoff reduces ambiguity." }],
      branchCount: 6,
      topK: 1
    });

    expect(result.selected.map((item) => item.id)).toEqual(["mechanism_1"]);
    const broadCandidateScore = result.artifacts.selection.scores.find((item) => item.candidate_id === "contradiction_1");
    expect(broadCandidateScore?.implementation_bonus).toBeGreaterThan(0);
    expect(broadCandidateScore?.bundling_penalty).toBeGreaterThan(0);
    expect(broadCandidateScore?.scope_penalty).toBeGreaterThan(0);
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
            resource_notes: ["Keep runs within local execution limits."]
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

  it("falls back to known hypotheses when llm returns dangling hypothesis ids", async () => {
    const llm = new QueueJsonLLMClient([
      JSON.stringify({
        summary: "Generated one experiment plan with a mismatched id.",
        candidates: [
          {
            id: "plan_1",
            title: "Recovery benchmark",
            hypothesis_ids: ["missing_id"],
            plan_summary: "Evaluate recovery behavior against a baseline.",
            datasets: ["Benchmark-A"],
            metrics: [],
            baselines: [],
            implementation_notes: [],
            evaluation_steps: [],
            risks: [],
            resource_notes: []
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
          reproducibility_signals: ["run_to_run_variance"],
          measurement_hint: "Measure run-to-run variance across repeated runs."
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

    expect(result.selected.hypothesis_ids).toEqual(["h_1"]);
    expect(result.selected.metrics).toContain("run_to_run_variance");
    expect(result.selected.baselines).toContain("free_form_chat_baseline");
    expect(result.selected.evaluation_steps.some((step) => step.includes("repeated runs"))).toBe(true);
  });

  it("falls back deterministically when experiment design llm exceeds the timeout", async () => {
    const result = await designExperimentsFromHypotheses({
      llm: new HangingLLMClient(),
      runTitle: "Budget-aware reasoning",
      runTopic: "Budget-aware reasoning",
      objectiveMetric: "accuracy_delta_vs_baseline",
      hypotheses: [
        {
          hypothesis_id: "h_1",
          text: "Adaptive stopping improves budget-aware reasoning quality.",
          reproducibility_signals: ["run_to_run_variance"],
          measurement_hint: "Compare accuracy_delta_vs_baseline across repeated bounded runs."
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
        raw: "accuracy_delta_vs_baseline",
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline"],
        analysisFocus: [],
        paperEmphasis: [],
        assumptions: []
      },
      retryContext: {
        previous_pilot_size: 8,
        previous_repeats: 1,
        registered_pilot_size: 200,
        registered_repeats: 5,
        previous_primary_metric_name: "accuracy_delta_vs_baseline",
        previous_primary_metric_value: -0.125,
        previous_baseline_name: "fixed_cot_256",
        previous_objective_status: "not_met",
        transition_action: "backtrack_to_design",
        retry_directives: [
          "Move the next bounded local branch materially closer to the registered pilot scope while keeping the run locally executable.",
          "Revise the treatment or stopping policy because the previous accuracy_delta_vs_baseline did not improve over fixed_cot_256."
        ]
      },
      timeoutMs: 5
    });

    expect(result.source).toBe("fallback");
    expect(result.fallbackReason).toContain("experiment_design_timeout:5ms");
    expect(result.selected.plan_summary).toContain("did not improve accuracy_delta_vs_baseline");
    expect(result.selected.evaluation_steps).toContain(
      "Move the next bounded local branch materially closer to the registered pilot scope while keeping the run locally executable."
    );
  });
});
