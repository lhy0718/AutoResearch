import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { createReviewNode } from "../src/core/nodes/review.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { LocalAciAdapter } from "../src/tools/aciLocalAdapter.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

function makeRun(runId: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "Reviewable run",
    topic: "AI agent automation",
    constraints: [],
    objectiveMetric: "accuracy at least 0.9",
    status: "running",
    currentNode: "review",
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

describe("review node", () => {
  it("builds a manual review packet from analyze_results artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-review-node-"));
    process.chdir(root);

    const run = makeRun("run-review-node");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await mkdir(path.join(runDir, "figures"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(path.join(runDir, "metrics.json"), JSON.stringify({ accuracy: 0.91 }, null, 2), "utf8");
    await writeFile(path.join(runDir, "figures", "performance.svg"), "<svg></svg>\n", "utf8");
    await writeFile(
      path.join(runDir, "corpus.jsonl"),
      `${JSON.stringify({
        paper_id: "paper_1",
        title: "Reviewable Benchmark",
        abstract: "A benchmark for manual review packet testing."
      })}\n`,
      "utf8"
    );
    await writeFile(
      path.join(runDir, "paper_summaries.jsonl"),
      `${JSON.stringify({
        paper_id: "paper_1",
        title: "Reviewable Benchmark",
        source_type: "full_text",
        summary: "Structured review packets benefit from explicit artifacts."
      })}\n`,
      "utf8"
    );
    await writeFile(
      path.join(runDir, "evidence_store.jsonl"),
      `${JSON.stringify({
        evidence_id: "ev_1",
        paper_id: "paper_1",
        claim: "Structured review packets benefit from explicit artifacts."
      })}\n`,
      "utf8"
    );
    await writeFile(
      path.join(runDir, "hypotheses.jsonl"),
      `${JSON.stringify({
        hypothesis_id: "h_1",
        text: "Manual review packets improve approval quality.",
        evidence_links: ["ev_1"]
      })}\n`,
      "utf8"
    );
    await writeFile(
      path.join(runDir, "experiment_plan.yaml"),
      ['selected_design:', '  title: "Reviewable plan"', '  summary: "Validate the manual review packet flow."'].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(runDir, "result_analysis.json"),
      `${JSON.stringify(
        {
          analysis_version: 1,
          generated_at: new Date().toISOString(),
          mean_score: 0.91,
          metrics: { accuracy: 0.91 },
          objective_metric: {
            raw: "accuracy at least 0.9",
            evaluation: {
              status: "met",
              summary: "Objective metric met: accuracy=0.91 >= 0.9."
            },
            profile: {
              source: "default",
              preferred_metric_keys: ["accuracy"],
              analysis_focus: [],
              paper_emphasis: [],
              assumptions: []
            }
          },
          overview: {
            objective_status: "met",
            objective_summary: "Objective metric met: accuracy=0.91 >= 0.9.",
            execution_runs: 1
          },
          plan_context: {
            selected_design: {
              id: "design_1",
              title: "Reviewable plan",
              summary: "Validate the manual review packet flow.",
              selected_hypothesis_ids: ["h_1"],
              metrics: ["accuracy"],
              baselines: ["baseline_model"],
              evaluation_steps: ["run three confirmatory trials", "compare against the baseline"],
              risks: ["limited scope"],
              budget_notes: ["single-machine execution"]
            },
            shortlisted_designs: [],
            design_notes: [],
            implementation_notes: [],
            evaluation_notes: [],
            assumptions: []
          },
          metric_table: [],
          condition_comparisons: [
            {
              id: "treatment_vs_baseline",
              label: "Treatment vs baseline",
              metric_key: "accuracy",
              baseline_value: 0.87,
              candidate_value: 0.91,
              delta: 0.04,
              direction: "higher_is_better",
              summary: "The treatment outperformed the baseline."
            }
          ],
          execution_summary: {
            observation_count: 3,
            commands: [],
            sources: [],
            stderr_excerpts: []
          },
          primary_findings: ["Accuracy cleared the target threshold."],
          limitations: [],
          warnings: [],
          paper_claims: [
            {
              claim: "The treatment improved the primary metric.",
              evidence: ["accuracy=0.91"]
            }
          ],
          figure_specs: [
            {
              id: "perf",
              title: "Performance overview",
              path: "figures/performance.svg",
              metric_keys: ["accuracy"],
              summary: "Accuracy stayed above target."
            }
          ],
          supplemental_runs: [],
          external_comparisons: [],
          statistical_summary: {
            total_trials: 3,
            executed_trials: 3,
            cached_trials: 0,
            confidence_intervals: [
              {
                metric_key: "accuracy",
                label: "Accuracy 95% CI",
                lower: 0.89,
                upper: 0.93,
                level: 0.95,
                sample_size: 3,
                source: "metrics",
                summary: "Accuracy stayed above target across the observed trials."
              }
            ],
            stability_metrics: [],
            effect_estimates: [
              {
                comparison_id: "treatment_vs_baseline",
                metric_key: "accuracy",
                delta: 0.04,
                direction: "positive",
                summary: "The treatment outperformed the baseline by +0.04 accuracy."
              }
            ],
            notes: []
          },
          failure_taxonomy: [],
          synthesis: {
            source: "fallback",
            discussion_points: ["The treatment cleared the target threshold."],
            failure_analysis: ["No blocking runtime issue remained."],
            follow_up_actions: ["Proceed to paper drafting after review."],
            confidence_statement: "Confidence is high because the objective was met with a grounded result bundle."
          },
          transition_recommendation: {
            action: "advance",
            sourceNode: "analyze_results",
            targetNode: "review",
            reason: "Ready for review before paper writing.",
            confidence: 0.88,
            autoExecutable: true,
            evidence: ["accuracy reached the configured target."],
            suggestedCommands: ["/approve"],
            generatedAt: new Date().toISOString()
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const node = createReviewNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: new LocalAciAdapter({ allowNetwork: false }),
      semanticScholar: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(result.needsApproval).toBe(true);
    expect(result.transitionRecommendation).toMatchObject({
      action: "advance",
      targetNode: "write_paper"
    });

    const packetRaw = await readFile(path.join(runDir, "review", "review_packet.json"), "utf8");
    const packet = JSON.parse(packetRaw) as {
      objective_status: string;
      readiness: { status: string; blocking_checks: number };
      suggested_actions: string[];
    };
    expect(packet.objective_status).toBe("met");
    expect(packet.readiness.status).toBe("ready");
    expect(packet.readiness.blocking_checks).toBe(0);
    expect(packet.suggested_actions).toContain("/approve");

    const checklist = await readFile(path.join(runDir, "review", "checklist.md"), "utf8");
    expect(checklist).toContain("# Review checklist");
    expect(checklist).toContain("Decision: advance -> advance");
    expect(checklist).toContain("Consensus: high");

    const decisionRaw = await readFile(path.join(runDir, "review", "decision.json"), "utf8");
    const decision = JSON.parse(decisionRaw) as { outcome: string; recommended_transition?: string };
    expect(decision.outcome).toBe("advance");
    expect(decision.recommended_transition).toBe("advance");

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("review.last_summary")).toContain("accuracy=0.91");
    expect(await memory.get("review.last_decision")).toMatchObject({ outcome: "advance" });
  });

  it("marks missing evidence inputs as blocking", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-review-node-blocking-"));
    process.chdir(root);

    const run = makeRun("run-review-blocking");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(path.join(runDir, "metrics.json"), JSON.stringify({ accuracy: 0.91 }, null, 2), "utf8");
    await writeFile(
      path.join(runDir, "result_analysis.json"),
      `${JSON.stringify(
        {
          analysis_version: 1,
          generated_at: new Date().toISOString(),
          mean_score: 0.91,
          metrics: { accuracy: 0.91 },
          objective_metric: {
            raw: "accuracy at least 0.9",
            evaluation: {
              status: "met",
              summary: "Objective metric met: accuracy=0.91 >= 0.9."
            },
            profile: {
              source: "default",
              preferred_metric_keys: ["accuracy"],
              analysis_focus: [],
              paper_emphasis: [],
              assumptions: []
            }
          },
          overview: {
            objective_status: "met",
            objective_summary: "Objective metric met: accuracy=0.91 >= 0.9.",
            execution_runs: 1
          },
          plan_context: {
            shortlisted_designs: [],
            design_notes: [],
            implementation_notes: [],
            evaluation_notes: [],
            assumptions: []
          },
          metric_table: [],
          condition_comparisons: [],
          execution_summary: {
            observation_count: 1,
            commands: ["python experiment.py"],
            sources: ["local_python"],
            stderr_excerpts: []
          },
          primary_findings: ["Accuracy cleared the target threshold."],
          limitations: [],
          warnings: [],
          paper_claims: [],
          figure_specs: [],
          supplemental_runs: [],
          external_comparisons: [],
          statistical_summary: {
            total_trials: 1,
            executed_trials: 1,
            cached_trials: 0,
            confidence_intervals: [],
            stability_metrics: [],
            effect_estimates: [],
            notes: []
          },
          failure_taxonomy: [],
          transition_recommendation: {
            action: "advance",
            sourceNode: "analyze_results",
            targetNode: "review",
            reason: "Ready for review before paper writing.",
            confidence: 0.88,
            autoExecutable: true,
            evidence: ["accuracy reached the configured target."],
            suggestedCommands: ["/approve"],
            generatedAt: new Date().toISOString()
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const node = createReviewNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: new LocalAciAdapter({ allowNetwork: false }),
      semanticScholar: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    const packetRaw = await readFile(path.join(runDir, "review", "review_packet.json"), "utf8");
    const packet = JSON.parse(packetRaw) as {
      readiness: { status: string; blocking_checks: number };
      checks: Array<{ label: string; status: string; detail: string }>;
      suggested_actions: string[];
    };

    expect(packet.readiness.status).toBe("blocking");
    expect(packet.readiness.blocking_checks).toBeGreaterThan(0);
    expect(packet.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Evidence bundle",
          status: "blocking",
          detail: expect.stringContaining("evidence_store.jsonl")
        })
      ])
    );
    expect(result.transitionRecommendation).toMatchObject({
      action: "backtrack_to_design",
      targetNode: "design_experiments"
    });
    expect(packet.suggested_actions).toContain("/agent review");
    expect(packet.suggested_actions).toContain("/approve");
  });

  it("recommends a hypothesis reset when review finds unsupported claims", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-review-node-hypothesis-"));
    process.chdir(root);

    const run = makeRun("run-review-hypothesis");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await mkdir(path.join(runDir, "figures"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(path.join(runDir, "metrics.json"), JSON.stringify({ accuracy: 0.62 }, null, 2), "utf8");
    await writeFile(path.join(runDir, "figures", "performance.svg"), "<svg></svg>\n", "utf8");
    await writeFile(path.join(runDir, "corpus.jsonl"), `${JSON.stringify({ paper_id: "paper_1" })}\n`, "utf8");
    await writeFile(path.join(runDir, "paper_summaries.jsonl"), `${JSON.stringify({ paper_id: "paper_1" })}\n`, "utf8");
    await writeFile(path.join(runDir, "evidence_store.jsonl"), `${JSON.stringify({ evidence_id: "ev_1" })}\n`, "utf8");
    await writeFile(path.join(runDir, "hypotheses.jsonl"), `${JSON.stringify({ hypothesis_id: "h_1" })}\n`, "utf8");
    await writeFile(
      path.join(runDir, "experiment_plan.yaml"),
      ['selected_design:', '  title: "Unsupported hypothesis plan"', '  summary: "Validate a brittle claim."'].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(runDir, "result_analysis.json"),
      `${JSON.stringify(
        {
          analysis_version: 1,
          generated_at: new Date().toISOString(),
          mean_score: 0.62,
          metrics: { accuracy: 0.62 },
          objective_metric: {
            raw: "accuracy at least 0.9",
            evaluation: {
              status: "not_met",
              summary: "Objective metric not met: accuracy=0.62 < 0.9."
            },
            profile: {
              source: "default",
              preferred_metric_keys: ["accuracy"],
              analysis_focus: [],
              paper_emphasis: [],
              assumptions: []
            }
          },
          overview: {
            objective_status: "not_met",
            objective_summary: "Objective metric not met: accuracy=0.62 < 0.9.",
            execution_runs: 1
          },
          plan_context: {
            selected_design: {
              id: "design_unsupported",
              title: "Unsupported hypothesis plan",
              summary: "Validate a brittle claim.",
              selected_hypothesis_ids: ["h_1"],
              metrics: ["accuracy"],
              baselines: ["baseline_model"],
              evaluation_steps: ["run three confirmatory trials", "compare against the baseline"],
              risks: [],
              budget_notes: []
            },
            shortlisted_designs: [],
            design_notes: [],
            implementation_notes: [],
            evaluation_notes: [],
            assumptions: []
          },
          metric_table: [],
          condition_comparisons: [
            {
              id: "treatment_vs_baseline",
              label: "Treatment vs baseline",
              source: "metrics.comparison",
              metrics: [
                {
                  key: "accuracy",
                  primary_value: 0.62,
                  baseline_value: 0.71,
                  value: -0.09
                }
              ],
              hypothesis_supported: false,
              summary: "The treatment underperformed the baseline and did not support the hypothesis."
            }
          ],
          execution_summary: {
            observation_count: 3,
            commands: ["python experiment.py"],
            sources: ["local_python"],
            stderr_excerpts: []
          },
          primary_findings: ["The hypothesis is not supported by the observed comparison."],
          limitations: [],
          warnings: [],
          paper_claims: [
            {
              claim: "The treatment improved the primary metric.",
              evidence: ["accuracy=0.62"]
            }
          ],
          figure_specs: [
            {
              id: "perf",
              title: "Performance overview",
              path: "figures/performance.svg",
              metric_keys: ["accuracy"],
              summary: "Accuracy fell below the target."
            }
          ],
          supplemental_runs: [],
          external_comparisons: [],
          statistical_summary: {
            total_trials: 3,
            executed_trials: 3,
            cached_trials: 0,
            confidence_intervals: [
              {
                metric_key: "accuracy",
                label: "Accuracy 95% CI",
                lower: 0.58,
                upper: 0.66,
                level: 0.95,
                sample_size: 3,
                source: "metrics",
                summary: "Accuracy remained below the objective range across confirmatory trials."
              }
            ],
            stability_metrics: [],
            effect_estimates: [
              {
                comparison_id: "treatment_vs_baseline",
                metric_key: "accuracy",
                delta: -0.09,
                direction: "negative",
                summary: "The treatment underperformed the baseline by -0.09 accuracy."
              }
            ],
            notes: []
          },
          failure_taxonomy: [],
          synthesis: {
            source: "fallback",
            discussion_points: ["The current hypothesis is not supported."],
            failure_analysis: ["The treatment underperformed the baseline."],
            follow_up_actions: ["Revisit the hypothesis set before drafting any paper claims."],
            confidence_statement: "Confidence is moderate because the unsupported comparison is consistent across confirmatory trials."
          },
          transition_recommendation: {
            action: "backtrack_to_hypotheses",
            sourceNode: "analyze_results",
            targetNode: "generate_hypotheses",
            reason: "Current experiment outcomes do not support the shortlisted hypothesis, so the idea set should be revisited.",
            confidence: 0.93,
            autoExecutable: true,
            evidence: ["The treatment did not support the shortlisted hypothesis."],
            suggestedCommands: ["/agent jump generate_hypotheses", "/agent run generate_hypotheses"],
            generatedAt: new Date().toISOString()
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const node = createReviewNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: new LocalAciAdapter({ allowNetwork: false }),
      semanticScholar: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.transitionRecommendation).toMatchObject({
      action: "backtrack_to_hypotheses",
      targetNode: "generate_hypotheses"
    });

    const packetRaw = await readFile(path.join(runDir, "review", "review_packet.json"), "utf8");
    const packet = JSON.parse(packetRaw) as { suggested_actions: string[] };
    expect(packet.suggested_actions).toContain("/approve");
    expect(packet.suggested_actions).toContain("/agent jump generate_hypotheses --force");
  });
});
