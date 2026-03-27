import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAppPaths, ensureScaffold } from "../src/config.js";
import { InteractionSession } from "../src/interaction/InteractionSession.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { RunStore } from "../src/core/runs/runStore.js";
import { InMemoryEventStream, PersistedEventStream } from "../src/core/events.js";
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

  it("reads repository knowledge for the active run via /knowledge", async () => {
    const run = await runStore.createRun({
      title: "Knowledge run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    const runDir = path.join(cwd, ".autolabos", "runs", run.id);
    await fs.mkdir(runDir, { recursive: true });
    await fs.mkdir(path.join(cwd, ".autolabos", "knowledge"), { recursive: true });
    await fs.writeFile(
      path.join(runDir, "corpus.jsonl"),
      [
        JSON.stringify({ paper_id: "p1", title: "Paper one", citation_count: 12, pdf_url: "https://example.com/p1.pdf", bibtex: "@article{p1}", venue: "NeurIPS", year: 2024 }),
        JSON.stringify({ paper_id: "p2", title: "Paper two", citation_count: 4, venue: "ICLR", year: 2025 })
      ].join("\n") + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "collect_result.json"),
      JSON.stringify({ bibtexMode: "hybrid", pdfRecovered: 1, bibtexEnriched: 1, enrichment: { status: "completed" } }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "paper_summaries.jsonl"),
      JSON.stringify({ paper_id: "p1", title: "Paper one", source_type: "full_text", summary: "summary", key_findings: [], limitations: [], datasets: [], metrics: [], novelty: "", reproducibility_notes: [] }) + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "evidence_store.jsonl"),
      JSON.stringify({ evidence_id: "e1", paper_id: "p1", claim: "claim", method_slot: "", result_slot: "", limitation_slot: "", dataset_slot: "", metric_slot: "", evidence_span: "span", source_type: "full_text", confidence: 0.9 }) + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(cwd, ".autolabos", "knowledge", "index.json"),
      JSON.stringify(
        {
          version: 1,
          updated_at: "2026-03-23T00:00:00.000Z",
          entries: [
            {
              run_id: run.id,
              title: run.title,
              topic: run.topic,
              objective_metric: run.objectiveMetric,
              latest_summary: "Review ready.",
              latest_published_section: "review",
              updated_at: "2026-03-23T00:00:00.000Z",
              public_output_root: `outputs/${run.id}`,
              public_manifest: `outputs/${run.id}/manifest.json`,
              knowledge_note: `.autolabos/knowledge/runs/${run.id}.md`,
              research_question: "Does the treatment outperform the baseline?",
              analysis_summary: "Treatment improved accuracy over baseline.",
              manuscript_type: "paper_scale_candidate",
              sections: [
                {
                  name: "review",
                  generated_files: ["review/review_packet.json"],
                  updated_at: "2026-03-23T00:00:00.000Z"
                }
              ]
            }
          ]
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
        }
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

    const result = await session.submitInput("/knowledge");

    expect(result.logs.some((line) => line.includes(`Knowledge entry: ${run.id}`))).toBe(true);
    expect(result.logs.some((line) => line.includes("Research question: Does the treatment outperform the baseline?"))).toBe(true);
    expect(result.logs.some((line) => line.includes("Analysis summary: Treatment improved accuracy over baseline."))).toBe(true);
    expect(result.logs.some((line) => line.includes("Literature corpus: 2 paper(s), 1 with PDF, 1 with BibTeX"))).toBe(true);
    expect(result.logs.some((line) => line.includes("Analysis coverage: 1 summaries, 1 evidence rows"))).toBe(true);
  });

  it("previews manuscript-quality artifacts via /artifact", async () => {
    const run = await runStore.createRun({
      title: "Artifact run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.currentNode = "write_paper";
    run.graph.currentNode = "write_paper";
    run.status = "paused";
    await runStore.updateRun(run);

    const runDir = path.join(cwd, ".autolabos", "runs", run.id);
    await fs.mkdir(path.join(runDir, "paper"), { recursive: true });
    await fs.writeFile(
      path.join(runDir, "paper", "manuscript_quality_gate.json"),
      JSON.stringify(
        {
          action: "pass",
          pass_index: 0,
          triggered_by: [],
          allowed_max_passes: 2,
          remaining_allowed_repairs: 2,
          improvement_detected: true,
          stop_or_continue_reason: "Clean manuscript quality pass.",
          issues_before: [],
          issues_after: [],
          summary_lines: ["Manuscript quality passed on the initial gate."],
          decision_digest: {
            stage: "initial_gate",
            action: "pass",
            review_reliability: "grounded",
            issue_counts_before: 0,
            issue_counts_after: 0,
            improvement_detected: true,
            allowed_max_passes: 2,
            remaining_allowed_repairs: 2,
            triggered_by: [],
            stop_reason_category: "clean_pass"
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
        }
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

    const result = await session.submitInput("/artifact paper/manuscript_quality_gate.json");

    expect(result.logs.some((line) => line.includes(`Artifact preview (${run.id}): paper/manuscript_quality_gate.json`))).toBe(true);
    expect(result.logs.some((line) => line.includes('"action": "pass"'))).toBe(true);
  });

  it("clears downstream artifacts and context when rewinding from an upstream node", async () => {
    const run = await runStore.createRun({
      title: "Reset run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.status = "paused";
    run.currentNode = "write_paper";
    run.graph.currentNode = "write_paper";
    run.graph.nodeStates.implement_experiments.status = "completed";
    run.graph.nodeStates.run_experiments.status = "completed";
    run.graph.nodeStates.analyze_results.status = "completed";
    run.graph.nodeStates.review.status = "completed";
    run.graph.nodeStates.write_paper.status = "completed";
    run.nodeThreads.implement_experiments = "thread-impl";
    run.nodeThreads.run_experiments = "thread-run";
    await runStore.updateRun(run);

    const runDir = path.join(cwd, ".autolabos", "runs", run.id);
    await fs.mkdir(path.join(runDir, "review"), { recursive: true });
    await fs.mkdir(path.join(runDir, "paper"), { recursive: true });
    await fs.writeFile(path.join(runDir, "experiment.py"), "print('ok')\n", "utf8");
    await fs.writeFile(path.join(runDir, "metrics.json"), JSON.stringify({ accuracy: 0.1 }, null, 2), "utf8");
    await fs.writeFile(path.join(runDir, "result_analysis.json"), JSON.stringify({ overview: {} }, null, 2), "utf8");
    await fs.writeFile(path.join(runDir, "review", "decision.json"), JSON.stringify({ outcome: "advance" }, null, 2), "utf8");
    await fs.writeFile(path.join(runDir, "paper", "main.tex"), "stale paper\n", "utf8");

    const runContext = new RunContextMemory(path.join(cwd, run.memoryRefs.runContextPath));
    await runContext.put("implement_experiments.script", "print('stale')");
    await runContext.put("run_experiments.feedback_for_implementer", { summary: "The operation was aborted" });
    await runContext.put("write_paper.paper_critique", {
      overall_decision: "backtrack_to_implement",
      needs_additional_experiments: true,
      manuscript_claim_risk_summary: "stale critique"
    });
    await runContext.put("analyze_results.last_summary", "stale analysis");
    await runContext.put("review.last_decision", { outcome: "advance" });

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
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: true
    });
    await session.start();
    await session.selectRun(run.id);

    const result = await session.submitInput(`/agent clear implement_experiments ${run.id}`);
    const persisted = await runStore.getRun(run.id);

    expect(result.logs.some((line) => line.includes("Run reset from implement_experiments (pending)."))).toBe(true);
    expect(await fs.stat(path.join(runDir, "experiment.py")).catch(() => undefined)).toBeUndefined();
    expect(await fs.stat(path.join(runDir, "metrics.json")).catch(() => undefined)).toBeUndefined();
    expect(await fs.stat(path.join(runDir, "result_analysis.json")).catch(() => undefined)).toBeUndefined();
    expect(await fs.stat(path.join(runDir, "review", "decision.json")).catch(() => undefined)).toBeUndefined();
    expect(await fs.stat(path.join(runDir, "paper", "main.tex")).catch(() => undefined)).toBeUndefined();
    expect(await runContext.get("implement_experiments.script")).toBeNull();
    expect(await runContext.get("run_experiments.feedback_for_implementer")).toBeNull();
    expect(await runContext.get("write_paper.paper_critique")).toBeNull();
    expect(await runContext.get("analyze_results.last_summary")).toBeNull();
    expect(await runContext.get("review.last_decision")).toBeNull();
    expect(persisted?.status).toBe("paused");
    expect(persisted?.currentNode).toBe("implement_experiments");
    expect(persisted?.graph.nodeStates.implement_experiments.status).toBe("pending");
    expect(persisted?.graph.nodeStates.write_paper.status).toBe("pending");
    expect(persisted?.nodeThreads.implement_experiments).toBeUndefined();
    expect(persisted?.nodeThreads.run_experiments).toBeUndefined();
  });

  it("preserves run_experiments metrics when clearing analyze_results", async () => {
    const run = await runStore.createRun({
      title: "Analyze reset run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.status = "paused";
    run.currentNode = "write_paper";
    run.graph.currentNode = "write_paper";
    run.graph.nodeStates.run_experiments.status = "completed";
    run.graph.nodeStates.analyze_results.status = "completed";
    run.graph.nodeStates.review.status = "completed";
    run.graph.nodeStates.write_paper.status = "completed";
    await runStore.updateRun(run);

    const runDir = path.join(cwd, ".autolabos", "runs", run.id);
    await fs.mkdir(path.join(runDir, "review"), { recursive: true });
    await fs.mkdir(path.join(runDir, "paper"), { recursive: true });
    await fs.writeFile(path.join(runDir, "metrics.json"), JSON.stringify({ accuracy: 0.1 }, null, 2), "utf8");
    await fs.writeFile(path.join(runDir, "objective_evaluation.json"), JSON.stringify({ status: "met" }, null, 2), "utf8");
    await fs.writeFile(path.join(runDir, "result_analysis.json"), JSON.stringify({ overview: {} }, null, 2), "utf8");
    await fs.writeFile(path.join(runDir, "transition_recommendation.json"), JSON.stringify({ action: "advance" }, null, 2), "utf8");
    await fs.writeFile(path.join(runDir, "review", "decision.json"), JSON.stringify({ outcome: "advance" }, null, 2), "utf8");
    await fs.writeFile(path.join(runDir, "paper", "main.tex"), "stale paper\n", "utf8");
    const runContext = new RunContextMemory(path.join(cwd, run.memoryRefs.runContextPath));
    await runContext.put("objective_metric.last_evaluation", { status: "met" });
    await runContext.put("write_paper.paper_critique", {
      overall_decision: "backtrack_to_implement",
      needs_additional_experiments: true
    });

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
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: true
    });
    await session.start();
    await session.selectRun(run.id);

    await session.submitInput(`/agent clear analyze_results ${run.id}`);
    const persisted = await runStore.getRun(run.id);

    expect(await fs.readFile(path.join(runDir, "metrics.json"), "utf8")).toContain('"accuracy": 0.1');
    expect(await fs.readFile(path.join(runDir, "objective_evaluation.json"), "utf8")).toContain('"status": "met"');
    expect(await fs.stat(path.join(runDir, "result_analysis.json")).catch(() => undefined)).toBeUndefined();
    expect(await fs.stat(path.join(runDir, "transition_recommendation.json")).catch(() => undefined)).toBeUndefined();
    expect(await fs.stat(path.join(runDir, "review", "decision.json")).catch(() => undefined)).toBeUndefined();
    expect(await fs.stat(path.join(runDir, "paper", "main.tex")).catch(() => undefined)).toBeUndefined();
    expect(await runContext.get("objective_metric.last_evaluation")).toMatchObject({ status: "met" });
    expect(await runContext.get("write_paper.paper_critique")).toBeNull();
    expect(persisted?.currentNode).toBe("analyze_results");
    expect(persisted?.graph.nodeStates.run_experiments.status).toBe("completed");
    expect(persisted?.graph.nodeStates.analyze_results.status).toBe("pending");
    expect(persisted?.graph.nodeStates.write_paper.status).toBe("pending");
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

    expect(result.logs.some((line) => line.includes("The current run has 3 collected papers."))).toBe(true);
  });

  it("shows structured analyze_results details in /agent count logs", async () => {
    const run = await runStore.createRun({
      title: "Analyze count run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    const current = await runStore.getRun(run.id);
    if (!current) {
      throw new Error("expected run");
    }
    current.status = "paused";
    current.currentNode = "analyze_results";
    current.graph.currentNode = "analyze_results";
    current.graph.nodeStates.analyze_results = {
      status: "completed",
      updatedAt: new Date().toISOString(),
      note: "Analysis completed."
    };
    await runStore.updateRun(current);
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
            targetNode: "review",
            reason: "The objective is met and no blocking runtime issue remains, so the run can proceed to review before paper writing.",
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
    expect(snapshot.activeRunInsight?.lines.some((line) => line.includes("Recommendation: advance -> review"))).toBe(
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
            expect.objectContaining({ label: "Target", value: "review" })
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

  it("prepares review from analyze_results and logs the review summary", async () => {
    const run = await runStore.createRun({
      title: "Review command run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    const runDir = path.join(cwd, ".autolabos", "runs", run.id);
    const current = await runStore.getRun(run.id);
    if (!current) {
      throw new Error("expected run");
    }
    current.status = "paused";
    current.currentNode = "analyze_results";
    current.graph.currentNode = "analyze_results";
    current.graph.nodeStates.analyze_results = {
      status: "needs_approval",
      updatedAt: new Date().toISOString(),
      note: "Analysis ready for review."
    };
    current.graph.nodeStates.review = {
      status: "pending",
      updatedAt: new Date().toISOString()
    };
    current.graph.pendingTransition = {
      action: "advance",
      sourceNode: "analyze_results",
      targetNode: "review",
      reason: "Proceed to review.",
      confidence: 0.88,
      autoExecutable: true,
      evidence: ["accuracy reached the configured target."],
      suggestedCommands: ["/approve"],
      generatedAt: new Date().toISOString()
    };
    await runStore.updateRun(current);

    const reviewPacket = {
      generated_at: "2026-03-10T10:00:00.000Z",
      readiness: {
        status: "blocking",
        ready_checks: 3,
        warning_checks: 1,
        blocking_checks: 1,
        manual_checks: 1
      },
      objective_status: "met",
      objective_summary: "Objective metric met: accuracy=0.91 >= 0.9.",
      recommendation: {
        action: "advance",
        target: "review",
        confidence_pct: 88,
        reason: "The run can proceed to manual review before paper writing.",
        evidence: ["accuracy reached the configured target."]
      },
      checks: [
        {
          id: "evidence_bundle",
          label: "Evidence bundle",
          status: "blocking",
          detail: "Missing required paper inputs: evidence_store.jsonl."
        },
        {
          id: "human_signoff",
          label: "Human sign-off",
          status: "manual",
          detail: "Confirm the claims, evidence quality, and next action before approving write_paper."
        }
      ],
      suggested_actions: ["/agent apply", "/agent jump analyze_results"]
    };

    const approveCurrent = vi.fn(async (runId: string) => {
      const stored = await runStore.getRun(runId);
      if (!stored) {
        throw new Error("expected stored run");
      }
      stored.currentNode = "review";
      stored.graph.currentNode = "review";
      stored.status = "running";
      stored.graph.nodeStates.analyze_results.status = "completed";
      stored.graph.nodeStates.review.status = "pending";
      stored.graph.pendingTransition = undefined;
      await runStore.updateRun(stored);
      return stored;
    });

    const runAgentWithOptions = vi.fn(async (runId: string) => {
      await fs.mkdir(path.join(runDir, "review"), { recursive: true });
      await fs.writeFile(
        path.join(runDir, "review", "review_packet.json"),
        `${JSON.stringify(reviewPacket, null, 2)}\n`,
        "utf8"
      );
      const stored = await runStore.getRun(runId);
      if (!stored) {
        throw new Error("expected stored run");
      }
      stored.currentNode = "review";
      stored.graph.currentNode = "review";
      stored.status = "paused";
      stored.graph.nodeStates.review = {
        status: "needs_approval",
        updatedAt: new Date().toISOString(),
        note: "Review packet prepared."
      };
      await runStore.updateRun(stored);
      return {
        run: stored,
        result: { status: "success" as const, summary: "Review packet prepared." }
      };
    });

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
          responses_model: "gpt-5.4"
        },
        papers: { max_results: 100 }
      } as any,
      runStore,
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {
        approveCurrent,
        runAgentWithOptions
      } as any,
      semanticScholarApiKeyConfigured: true
    });
    await session.start();
    await session.selectRun(run.id);

    const result = await session.submitInput("/agent review");
    const snapshot = session.snapshot();

    expect(result.logs.some((line) => line.includes("Approved analyze_results and moved into review."))).toBe(true);
    expect(result.logs.some((line) => line.includes("review finished: Review packet prepared."))).toBe(true);
    expect(result.logs.some((line) => line.includes("Review readiness: blocking"))).toBe(true);
    expect(result.logs.some((line) => line.includes("Blocking: Evidence bundle"))).toBe(true);
    expect(approveCurrent).toHaveBeenCalledWith(run.id);
    expect(runAgentWithOptions).toHaveBeenCalledWith(
      run.id,
      "review",
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) })
    );
    expect(snapshot.activeRunInsight?.title).toBe("Review packet");
    expect(snapshot.activeRunInsight?.lines.some((line) => line.includes("Review readiness: blocking"))).toBe(true);
  });

  it("surfaces manuscript quality insight during write_paper before falling back to the review packet", async () => {
    const run = await runStore.createRun({
      title: "Manuscript quality run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    const current = await runStore.getRun(run.id);
    if (!current) {
      throw new Error("expected run");
    }
    current.status = "failed";
    current.currentNode = "write_paper";
    current.graph.currentNode = "write_paper";
    current.graph.nodeStates.review.status = "completed";
    current.graph.nodeStates.write_paper.status = "failed";
    await runStore.updateRun(current);

    const runDir = path.join(cwd, ".autolabos", "runs", run.id);
    await fs.mkdir(path.join(runDir, "review"), { recursive: true });
    await fs.mkdir(path.join(runDir, "paper"), { recursive: true });
    await fs.writeFile(
      path.join(runDir, "review", "review_packet.json"),
      JSON.stringify(
        {
          generated_at: "2026-03-26T10:00:00.000Z",
          readiness: {
            status: "warning",
            ready_checks: 4,
            warning_checks: 1,
            blocking_checks: 0,
            manual_checks: 1
          },
          objective_status: "met",
          objective_summary: "The objective was met.",
          checks: [],
          suggested_actions: []
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "paper", "manuscript_quality_gate.json"),
      JSON.stringify(
        {
          action: "stop",
          pass_index: 1,
          triggered_by: ["appendix_hygiene"],
          allowed_max_passes: 2,
          remaining_allowed_repairs: 0,
          issues_before: [
            {
              source: "review",
              code: "appendix_hygiene",
              severity: "fail",
              section: "Appendix",
              repairable: true,
              message: "Appendix still contains internal workflow language."
            }
          ],
          issues_after: [
            {
              source: "review",
              code: "appendix_hygiene",
              severity: "fail",
              section: "Appendix",
              repairable: true,
              message: "Appendix still contains internal workflow language."
            }
          ],
          improvement_detected: false,
          stop_or_continue_reason: "Appendix contamination remained after the first repair.",
          decision_digest: {
            stage: "post_repair_1",
            action: "stop",
            review_reliability: "grounded",
            issue_counts_before: { total: 1, fail: 1, warning: 0 },
            issue_counts_after: { total: 1, fail: 1, warning: 0 },
            improvement_detected: false,
            allowed_max_passes: 2,
            remaining_allowed_repairs: 0,
            triggered_by: ["appendix_hygiene"],
            stop_reason_category: "policy_hard_stop"
          },
          summary_lines: [
            "Action: stop.",
            "Decision reason: Appendix contamination remained after the first repair."
          ]
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "paper", "manuscript_quality_failure.json"),
      JSON.stringify(
        {
          generated_at: "2026-03-26T10:02:00.000Z",
          reason: "Appendix contamination remained after the first repair.",
          decision_digest: {
            stage: "post_repair_1",
            action: "stop",
            review_reliability: "grounded",
            issue_counts_before: { total: 1, fail: 1, warning: 0 },
            issue_counts_after: { total: 1, fail: 1, warning: 0 },
            improvement_detected: false,
            allowed_max_passes: 2,
            remaining_allowed_repairs: 0,
            triggered_by: ["appendix_hygiene"],
            stop_reason_category: "policy_hard_stop"
          },
          summary_lines: [
            "Action: stop.",
            "Decision reason: Appendix contamination remained after the first repair."
          ],
          triggered_by: ["appendix_hygiene"],
          review_reliability: "grounded",
          final_issues: [
            {
              source: "review",
              code: "appendix_hygiene",
              severity: "fail",
              section: "Appendix",
              repairable: true,
              message: "Appendix still contains internal workflow language."
            }
          ],
          lint_findings: [
            {
              code: "appendix_internal_text",
              section: "Appendix",
              severity: "fail",
              gate_role: "hard_stop"
            }
          ],
          reviewer_missed_policy_findings: [
            {
              code: "appendix_internal_text",
              section: "Appendix",
              severity: "fail",
              gate_role: "hard_stop"
            }
          ],
          reviewer_covered_backstop_findings: []
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "paper", "manuscript_style_lint.json"),
      JSON.stringify(
        {
          mode: "hard_policy_only",
          checked_rules: ["appendix_hygiene"],
          ok: false,
          issues: [
            {
              severity: "fail",
              code: "appendix_internal_text",
              section: "Appendix",
              message: "Appendix includes internal workflow text.",
              fix_recommendation: "Remove internal workflow language.",
              gate_role: "hard_stop"
            }
          ],
          summary: ["1 appendix hard-stop finding remains."]
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
        }
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

    const snapshot = session.snapshot();

    expect(snapshot.activeRunInsight?.title).toBe("Manuscript quality");
    expect(snapshot.activeRunInsight?.manuscriptQuality?.status).toBe("stopped");
    expect(snapshot.activeRunInsight?.manuscriptQuality?.reasonCategory).toBe("policy_hard_stop");
    expect(snapshot.activeRunInsight?.manuscriptQuality?.artifactRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "paper/manuscript_quality_gate.json" }),
        expect.objectContaining({ path: "paper/manuscript_quality_failure.json" })
      ])
    );
    expect(snapshot.activeRunInsight?.lines.some((line) => line.includes("Status: Stopped."))).toBe(true);
  });

  it("surfaces review-stage readiness risks inside the review insight", async () => {
    const run = await runStore.createRun({
      title: "Review readiness run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    const current = await runStore.getRun(run.id);
    if (!current) {
      throw new Error("expected run");
    }
    current.status = "paused";
    current.currentNode = "review";
    current.graph.currentNode = "review";
    current.graph.nodeStates.review.status = "needs_approval";
    await runStore.updateRun(current);

    const runDir = path.join(cwd, ".autolabos", "runs", run.id);
    await fs.mkdir(path.join(runDir, "review"), { recursive: true });
    await fs.writeFile(
      path.join(runDir, "review", "review_packet.json"),
      JSON.stringify(
        {
          generated_at: "2026-03-27T10:00:00.000Z",
          readiness: {
            status: "blocking",
            ready_checks: 3,
            warning_checks: 1,
            blocking_checks: 1,
            manual_checks: 1
          },
          objective_status: "met",
          objective_summary: "The objective was met.",
          checks: [
            {
              id: "evidence_bundle",
              label: "Evidence bundle",
              status: "blocking",
              detail: "Missing required paper inputs: evidence_store.jsonl."
            }
          ],
          suggested_actions: ["/agent jump design_experiments --force"]
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "review", "readiness_risks.json"),
      JSON.stringify(
        {
          generated_at: "2026-03-27T10:00:00.000Z",
          paper_ready: false,
          readiness_state: "blocked_for_paper_scale",
          risk_count: 1,
          blocked_count: 1,
          warning_count: 0,
          summary_lines: ["Readiness risks: blocked=1, warning=0, readiness_state=blocked_for_paper_scale."],
          risks: [
            {
              risk_code: "review_minimum_gate_blocked_for_paper_scale",
              severity: "blocked",
              category: "paper_scale",
              status: "blocked",
              message: "Minimum gate: 3 check(s) failed — ceiling: blocked_for_paper_scale.",
              triggered_by: ["minimum_gate"],
              affected_claim_ids: [],
              affected_citation_ids: [],
              recommended_action: "Backtrack to recover the missing evidence floor instead of treating the run as paper-scale.",
              recheck_condition: "The review minimum gate passes without any failed checks."
            }
          ]
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
        }
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

    const snapshot = session.snapshot();

    expect(snapshot.activeRunInsight?.title).toBe("Review packet");
    expect(snapshot.activeRunInsight?.readinessRisks?.readinessState).toBe("blocked_for_paper_scale");
    expect(snapshot.activeRunInsight?.readinessRisks?.riskCounts.blocked).toBe(1);
    expect(snapshot.activeRunInsight?.readinessRisks?.artifactRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "review/readiness_risks.json" })
      ])
    );
    expect(snapshot.activeRunInsight?.lines.some((line) => line.includes("Paper readiness risks: blocked 1"))).toBe(true);
  });

  it("stops /agent review when approving analyze_results backtracks to design", async () => {
    const run = await runStore.createRun({
      title: "Backtrack before review",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    const current = await runStore.getRun(run.id);
    if (!current) {
      throw new Error("expected run");
    }
    current.status = "paused";
    current.currentNode = "analyze_results";
    current.graph.currentNode = "analyze_results";
    current.graph.nodeStates.analyze_results = {
      status: "needs_approval",
      updatedAt: new Date().toISOString(),
      note: "Analysis recommends another design revision."
    };
    current.graph.nodeStates.review = {
      status: "pending",
      updatedAt: new Date().toISOString()
    };
    current.graph.pendingTransition = {
      action: "backtrack_to_design",
      sourceNode: "analyze_results",
      targetNode: "design_experiments",
      reason: "Brief evidence gate failed.",
      confidence: 0.76,
      autoExecutable: false,
      evidence: ["The run remains too small for paper progression."],
      suggestedCommands: ["/agent jump design_experiments", "/agent run design_experiments"],
      generatedAt: new Date().toISOString()
    };
    await runStore.updateRun(current);

    const approveCurrent = vi.fn(async (runId: string) => {
      const stored = await runStore.getRun(runId);
      if (!stored) {
        throw new Error("expected stored run");
      }
      stored.currentNode = "design_experiments";
      stored.graph.currentNode = "design_experiments";
      stored.status = "running";
      stored.graph.nodeStates.analyze_results.status = "completed";
      stored.graph.nodeStates.design_experiments = {
        status: "pending",
        updatedAt: new Date().toISOString(),
        note: "Ready for another design pass."
      };
      stored.graph.pendingTransition = undefined;
      await runStore.updateRun(stored);
      return stored;
    });
    const runAgentWithOptions = vi.fn();

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
          responses_model: "gpt-5.4"
        },
        papers: { max_results: 100 }
      } as any,
      runStore,
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {
        approveCurrent,
        runAgentWithOptions
      } as any,
      semanticScholarApiKeyConfigured: true
    });
    await session.start();
    await session.selectRun(run.id);

    const result = await session.submitInput("/agent review");

    expect(result.logs.some((line) => line.includes("Approved analyze_results. Next node is design_experiments."))).toBe(true);
    expect(approveCurrent).toHaveBeenCalledWith(run.id);
    expect(runAgentWithOptions).not.toHaveBeenCalled();
  });

  it("does not surface analyze-results insight when the active run is rewound before analyze_results", async () => {
    const run = await runStore.createRun({
      title: "Stale analysis insight",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    const current = await runStore.getRun(run.id);
    if (!current) {
      throw new Error("expected run");
    }
    current.status = "running";
    current.currentNode = "analyze_papers";
    current.graph.currentNode = "analyze_papers";
    current.graph.nodeStates.analyze_papers = {
      status: "running",
      updatedAt: new Date().toISOString(),
      note: "analysis resumed"
    };
    await runStore.updateRun(current);

    const runDir = path.join(cwd, ".autolabos", "runs", run.id);
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(
      path.join(runDir, "result_analysis.json"),
      JSON.stringify(
        {
          overview: {
            objective_status: "not_met",
            objective_summary: "Legacy analysis from an earlier cycle."
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
        }
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

    expect(session.snapshot().activeRunInsight).toBeUndefined();
  });

  it("blocks /approve on analyze_papers when no evidence has been persisted yet", async () => {
    const run = await runStore.createRun({
      title: "Approve guard run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    const current = await runStore.getRun(run.id);
    if (!current) {
      throw new Error("expected run");
    }
    current.status = "paused";
    current.currentNode = "analyze_papers";
    current.graph.currentNode = "analyze_papers";
    current.graph.nodeStates.analyze_papers = {
      status: "needs_approval",
      updatedAt: new Date().toISOString(),
      note: "Paused for manual review."
    };
    await runStore.updateRun(current);

    const approveCurrent = vi.fn();
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
          responses_model: "gpt-5.4"
        },
        papers: { max_results: 100 }
      } as any,
      runStore,
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {
        approveCurrent
      } as any,
      semanticScholarApiKeyConfigured: true
    });
    await session.start();
    await session.selectRun(run.id);

    const result = await session.submitInput("/approve");

    expect(result.logs.some((line) => line.includes("no persisted evidence"))).toBe(true);
    expect(result.logs.some((line) => line.includes("/retry"))).toBe(true);
    expect(approveCurrent).not.toHaveBeenCalled();
  });

  it("preserves an existing analyze_papers request when /agent run analyze_papers omits --top-n", async () => {
    const run = await runStore.createRun({
      title: "Analyze preserve run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.status = "paused";
    run.currentNode = "analyze_papers";
    run.graph.currentNode = "analyze_papers";
    run.graph.nodeStates.analyze_papers.status = "pending";
    await runStore.updateRun(run);

    const runContext = new RunContextMemory(path.join(cwd, run.memoryRefs.runContextPath));
    await runContext.put("analyze_papers.request", {
      topN: 30,
      selectionMode: "top_n",
      selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
    });

    const runAgentWithOptions = vi.fn(async (runId: string) => {
      const stored = await runStore.getRun(runId);
      if (!stored) {
        throw new Error("expected stored run");
      }
      stored.status = "paused";
      stored.currentNode = "analyze_papers";
      stored.graph.currentNode = "analyze_papers";
      stored.graph.nodeStates.analyze_papers = {
        status: "running",
        updatedAt: new Date().toISOString(),
        note: "Analyzing papers."
      };
      await runStore.updateRun(stored);
      return {
        run: stored,
        result: { status: "success" as const, summary: "Analyzing papers." }
      };
    });

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
          responses_model: "gpt-5.4"
        },
        papers: { max_results: 100 }
      } as any,
      runStore,
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {
        runAgentWithOptions
      } as any,
      semanticScholarApiKeyConfigured: true
    });
    await session.start();
    await session.selectRun(run.id);

    const result = await session.submitInput(`/agent run analyze_papers ${run.id}`);

    expect(result.logs.some((line) => line.includes("analyze_papers finished: Analyzing papers."))).toBe(true);
    expect(runAgentWithOptions).toHaveBeenCalledWith(
      run.id,
      "analyze_papers",
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) })
    );
    expect(await runContext.get("analyze_papers.request")).toMatchObject({
      topN: 30,
      selectionMode: "top_n"
    });
  });

  it("continues a manual /agent run when it advances to a later pending node", async () => {
    const run = await runStore.createRun({
      title: "Design continue run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    run.status = "paused";
    run.currentNode = "design_experiments";
    run.graph.currentNode = "design_experiments";
    run.graph.nodeStates.design_experiments.status = "pending";
    await runStore.updateRun(run);

    const runAgentWithOptions = vi.fn(async (runId: string) => {
      const stored = await runStore.getRun(runId);
      if (!stored) {
        throw new Error("expected stored run");
      }
      stored.status = "running";
      stored.currentNode = "implement_experiments";
      stored.graph.currentNode = "implement_experiments";
      stored.graph.nodeStates.design_experiments = {
        status: "completed",
        updatedAt: new Date().toISOString(),
        note: "design approved"
      };
      stored.graph.nodeStates.implement_experiments = {
        status: "pending",
        updatedAt: new Date().toISOString(),
        note: "ready to run"
      };
      await runStore.updateRun(stored);
      return {
        run: stored,
        result: { status: "success" as const, summary: "Design approved." }
      };
    });

    const runCurrentAgentWithOptions = vi.fn(async (runId: string) => {
      const stored = await runStore.getRun(runId);
      if (!stored) {
        throw new Error("expected stored run");
      }
      stored.graph.nodeStates.implement_experiments = {
        status: "running",
        updatedAt: new Date().toISOString(),
        note: "Implementation started."
      };
      await runStore.updateRun(stored);
      return {
        run: stored,
        result: { status: "success" as const, summary: "Implementation started." }
      };
    });

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
          responses_model: "gpt-5.4"
        },
        papers: { max_results: 100 }
      } as any,
      runStore,
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream: new InMemoryEventStream(),
      orchestrator: {
        runAgentWithOptions,
        runCurrentAgentWithOptions
      } as any,
      semanticScholarApiKeyConfigured: true
    });
    await session.start();
    await session.selectRun(run.id);

    const result = await session.submitInput(`/agent run design_experiments ${run.id}`);

    expect(result.logs.some((line) => line.includes("design_experiments finished: Design approved."))).toBe(true);
    expect(runCurrentAgentWithOptions).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) })
    );
  });

  it("prefixes replayed persisted run events when selecting a run", async () => {
    const run = await runStore.createRun({
      title: "Recovered run",
      topic: "topic",
      constraints: [],
      objectiveMetric: "metric"
    });
    const eventStream = new PersistedEventStream(path.join(cwd, ".autolabos", "runs"));
    eventStream.emit({
      type: "OBS_RECEIVED",
      runId: run.id,
      node: "collect_papers",
      payload: {
        text: "Recovered deferred enrichment background task after restart."
      }
    });

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
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: undefined,
      eventStream,
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: true
    });
    await session.start();
    await session.selectRun(run.id);

    expect(session.snapshot().logs).toContain("Replay: Recovered deferred enrichment background task after restart.");
  });
});
