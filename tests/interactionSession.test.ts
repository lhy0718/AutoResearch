import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAppPaths, ensureScaffold } from "../src/config.js";
import { InteractionSession } from "../src/interaction/InteractionSession.js";
import { RunStore } from "../src/core/runs/runStore.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

function makeRun(id: string): RunRecord {
  const now = new Date().toISOString();
  const graph = createDefaultGraphState();
  return {
    version: 3,
    workflowVersion: 3,
    id,
    title: `Run ${id}`,
    topic: "topic",
    constraints: ["recent papers"],
    objectiveMetric: "metric",
    status: "pending",
    currentNode: graph.currentNode,
    latestSummary: undefined,
    nodeThreads: {},
    createdAt: now,
    updatedAt: now,
    graph,
    memoryRefs: {
      runContextPath: `.autolabos/runs/${id}/memory/run_context.json`,
      longTermPath: `.autolabos/runs/${id}/memory/long_term.jsonl`,
      episodePath: `.autolabos/runs/${id}/memory/episodes.jsonl`
    }
  };
}

describe("InteractionSession", () => {
  let cwd: string;
  let runStore: RunStore;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-session-"));
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);
    runStore = new RunStore(paths);
  });

  it("creates runs through the shared session and selects the new run", async () => {
    const session = new InteractionSession({
      workspaceRoot: cwd,
      config: {
        research: {
          defaultTopic: "topic",
          defaultConstraints: ["recent papers"],
          default_objective_metric: "metric"
        }
      } as any,
      runStore,
      titleGenerator: {
        generateTitle: vi.fn().mockResolvedValue("Generated title")
      } as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: true
    });
    await session.start();

    const run = await session.createRun({
      topic: "Agent planning",
      constraints: ["recent papers"],
      objectiveMetric: "sample efficiency"
    });

    expect(run.title).toBe("Generated title");
    expect(session.snapshot().activeRunId).toBe(run.id);
    expect(session.snapshot().logs.some((line) => line.includes(`Created run ${run.id}`))).toBe(true);
  });

  it("cancels a pending plan without executing any step", async () => {
    const session = new InteractionSession({
      workspaceRoot: cwd,
      config: {
        research: {
          defaultTopic: "topic",
          defaultConstraints: ["recent papers"],
          default_objective_metric: "metric"
        },
        providers: {
          llm_mode: "codex_chatgpt_only",
          codex: { model: "gpt-5.3-codex", reasoning_effort: "xhigh", fast_mode: false },
          openai: { model: "gpt-5.4", reasoning_effort: "medium" }
        },
        analysis: {
          pdf_mode: "codex_text_image_hybrid",
          responses_model: "gpt-5.4"
        },
        papers: { max_results: 100 }
      } as any,
      runStore,
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: true
    }) as any;
    await session.start();
    session.pendingNaturalCommand = {
      command: "/help",
      commands: ["/help"],
      sourceInput: "test",
      createdAt: new Date().toISOString(),
      stepIndex: 0,
      totalSteps: 1
    };

    const result = await session.respondToPending("cancel");

    expect(result.pendingPlan).toBeUndefined();
    expect(result.logs.some((line) => line.includes("Canceled pending command"))).toBe(true);
  });

  it("answers direct paper-count questions from stored artifacts", async () => {
    const run = await runStore.createRun({
      title: "Count run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    const runDir = path.join(cwd, ".autolabos", "runs", run.id);
    await fs.writeFile(
      path.join(runDir, "corpus.jsonl"),
      ['{"title":"Paper A"}', '{"title":"Paper B"}', '{"title":"Paper C"}'].join("\n"),
      "utf8"
    );
    const session = new InteractionSession({
      workspaceRoot: cwd,
      config: {
        research: {
          defaultTopic: "topic",
          defaultConstraints: ["recent papers"],
          default_objective_metric: "metric"
        },
        providers: {
          llm_mode: "codex_chatgpt_only",
          codex: { model: "gpt-5.3-codex", reasoning_effort: "xhigh", fast_mode: false },
          openai: { model: "gpt-5.4", reasoning_effort: "medium" }
        },
        analysis: {
          pdf_mode: "codex_text_image_hybrid",
          responses_model: "gpt-5.4"
        },
        papers: { max_results: 100 }
      } as any,
      runStore,
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: true
    });
    await session.start();
    await session.selectRun(run.id);

    const result = await session.submitInput("수집된 논문은 몇건이지?");

    expect(result.logs.some((line) => line.includes("현재 수집된 논문은 3편입니다."))).toBe(true);
  });

  it("shows structured analyze_results details in /agent count logs", async () => {
    const run = await runStore.createRun({
      title: "Analyze count run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    const runDir = path.join(cwd, ".autolabos", "runs", run.id);
    await fs.mkdir(path.join(runDir, "figures"), { recursive: true });
    await fs.writeFile(path.join(runDir, "figures", "performance.svg"), "<svg></svg>", "utf8");
    await fs.writeFile(path.join(runDir, "metrics.json"), JSON.stringify({ accuracy: 0.81 }, null, 2), "utf8");
    await fs.writeFile(
      path.join(runDir, "result_analysis.json"),
      JSON.stringify(
        {
          analysis_version: 1,
          generated_at: new Date().toISOString(),
          mean_score: 0.81,
          metrics: { accuracy: 0.81 },
          objective_metric: {
            raw: "metric",
            evaluation: {
              status: "met",
              summary: "accuracy reached the configured target.",
              matchedMetricKey: "accuracy",
              observedValue: 0.81,
              targetDescription: "accuracy >= 0.8"
            },
            profile: {
              source: "heuristic",
              primary_metric: "accuracy",
              preferred_metric_keys: ["accuracy"],
              target_description: "accuracy >= 0.8",
              analysis_focus: ["accuracy"],
              paper_emphasis: ["accuracy"],
              assumptions: []
            }
          },
          overview: {
            objective_status: "met",
            objective_summary: "accuracy reached the configured target.",
            matched_metric_key: "accuracy",
            observed_value: 0.81,
            target_description: "accuracy >= 0.8",
            execution_runs: 3,
            top_metric: { key: "accuracy", value: 0.81 }
          },
          plan_context: {
            shortlisted_designs: [],
            design_notes: [],
            implementation_notes: [],
            evaluation_notes: [],
            assumptions: []
          },
          metric_table: [{ key: "accuracy", value: 0.81 }],
          condition_comparisons: [
            {
              id: "treatment_vs_baseline",
              label: "Treatment vs baseline",
              source: "metrics.comparison",
              metrics: [
                {
                  key: "accuracy",
                  value: 0.05,
                  primary_value: 0.81,
                  baseline_value: 0.76
                }
              ],
              hypothesis_supported: true,
              summary: "Treatment improved accuracy over the baseline by 0.05."
            }
          ],
          execution_summary: {
            observation_count: 3,
            commands: ["python experiment.py"],
            sources: ["local_python"],
            stderr_excerpts: []
          },
          primary_findings: ["Treatment accuracy improved over the baseline by 0.05."],
          limitations: ["Only one confirmatory configuration was executed."],
          warnings: [],
          paper_claims: [
            {
              claim: "The treatment improved the primary metric.",
              evidence: ["accuracy=0.81"]
            }
          ],
          figure_specs: [
            {
              id: "performance",
              title: "Performance overview",
              path: "figures/performance.svg",
              metric_keys: ["accuracy"],
              summary: "Accuracy increased in the treatment condition."
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
                lower: 0.78,
                upper: 0.84,
                level: 0.95,
                sample_size: 3,
                source: "metrics",
                summary: "Accuracy remained within a narrow 95% confidence interval across the observed trials."
              }
            ],
            stability_metrics: [{ key: "accuracy_std", value: 0.02 }],
            effect_estimates: [
              {
                comparison_id: "treatment_vs_baseline",
                metric_key: "accuracy",
                delta: 0.05,
                direction: "positive",
                summary: "The treatment delivered a positive effect estimate of +0.05 accuracy versus baseline."
              }
            ],
            notes: ["Variance remained low across the observed trials."]
          },
          failure_taxonomy: [
            {
              id: "scope_limit",
              category: "scope_limit",
              severity: "medium",
              status: "risk",
              summary: "Only one confirmatory configuration was executed.",
              evidence: ["total_trials=3"],
              recommended_action: "Run an additional confirmatory configuration."
            }
          ],
          synthesis: {
            source: "fallback",
            discussion_points: ["The treatment cleared the objective threshold with limited run-to-run variance."],
            failure_analysis: ["No concrete execution failure was observed; scope remains the main uncertainty."],
            follow_up_actions: ["Run an additional confirmatory configuration."],
            confidence_statement: "Overall confidence is moderate because the metric cleared the target but only one confirmatory configuration was executed."
          },
          transition_recommendation: {
            action: "advance",
            sourceNode: "analyze_results",
            targetNode: "write_paper",
            reason: "The objective is met and no blocking runtime issue remains, so the run can proceed to paper writing.",
            confidence: 0.88,
            autoExecutable: true,
            evidence: ["accuracy reached the configured target."],
            suggestedCommands: ["/approve"],
            generatedAt: new Date().toISOString()
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const session = new InteractionSession({
      workspaceRoot: cwd,
      config: {
        research: {
          defaultTopic: "topic",
          defaultConstraints: ["recent papers"],
          default_objective_metric: "metric"
        },
        providers: {
          llm_mode: "codex_chatgpt_only",
          codex: { model: "gpt-5.3-codex", reasoning_effort: "xhigh", fast_mode: false },
          openai: { model: "gpt-5.4", reasoning_effort: "medium" }
        },
        analysis: {
          pdf_mode: "codex_text_image_hybrid",
          responses_model: "gpt-5.4"
        },
        papers: { max_results: 100 }
      } as any,
      runStore,
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: true
    });
    await session.start();
    await session.selectRun(run.id);

    const result = await session.submitInput("/agent count analyze_results");
    const snapshot = session.snapshot();

    expect(result.logs.some((line) => line.includes("Count(analyze_results): 1 figure files"))).toBe(true);
    expect(result.logs.some((line) => line.includes("objective met"))).toBe(true);
    expect(result.logs.some((line) => line.includes("Top issue [medium/risk]"))).toBe(true);
    expect(result.logs.some((line) => line.includes("Discussion: The treatment cleared the objective threshold"))).toBe(
      true
    );
    expect(result.logs.some((line) => line.includes("Confidence: Overall confidence is moderate"))).toBe(true);
    expect(snapshot.activeRunInsight?.title).toBe("Result analysis");
    expect(snapshot.activeRunInsight?.lines.some((line) => line.includes("Objective: met"))).toBe(true);
    expect(snapshot.activeRunInsight?.lines.some((line) => line.includes("Recommendation: advance -> write_paper"))).toBe(
      true
    );
    expect(snapshot.activeRunInsight?.lines.some((line) => line.includes("Next: Run an additional confirmatory configuration."))).toBe(
      true
    );
    expect(snapshot.activeRunInsight?.actions?.[0]?.command).toBe("/agent apply");
    expect(snapshot.activeRunInsight?.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "comparison",
          label: "Comparison: Treatment vs baseline",
          path: "result_analysis.json",
          summary: "Treatment improved accuracy over the baseline by 0.05.",
          facts: expect.arrayContaining([
            expect.objectContaining({ label: "Metric", value: "accuracy" }),
            expect.objectContaining({ label: "Delta", value: "+0.05" }),
            expect.objectContaining({ label: "Support", value: "yes" })
          ])
        }),
        expect.objectContaining({
          kind: "statistics",
          label: "Statistics: accuracy",
          path: "result_analysis.json",
          summary: "The treatment delivered a positive effect estimate of +0.05 accuracy versus baseline.",
          facts: expect.arrayContaining([
            expect.objectContaining({ label: "Metric", value: "accuracy" }),
            expect.objectContaining({ label: "Delta", value: "+0.05" }),
            expect.objectContaining({ label: "Confidence", value: "95%" })
          ])
        }),
        expect.objectContaining({
          kind: "figure",
          label: "Figure: Performance overview",
          path: "figures/performance.svg",
          summary: "Accuracy increased in the treatment condition.",
          facts: expect.arrayContaining([
            expect.objectContaining({ label: "Matched metric", value: "accuracy" }),
            expect.objectContaining({ label: "Runs", value: "3" })
          ])
        }),
        expect.objectContaining({
          kind: "transition",
          label: "Transition rationale",
          path: "transition_recommendation.json",
          summary: "accuracy reached the configured target.",
          facts: expect.arrayContaining([
            expect.objectContaining({ label: "Confidence", value: "88%" }),
            expect.objectContaining({ label: "Target", value: "write_paper" })
          ])
        }),
        expect.objectContaining({
          kind: "report",
          label: "Analysis report",
          path: "result_analysis.json",
          summary: expect.stringContaining("Overall confidence is moderate"),
          facts: expect.arrayContaining([
            expect.objectContaining({ label: "Mean", value: "0.81" }),
            expect.objectContaining({ label: "Matched metric", value: "accuracy" }),
            expect.objectContaining({ label: "Objective", value: "met" })
          ])
        })
      ])
    );
  });
});
