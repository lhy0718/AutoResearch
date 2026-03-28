import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { createReviewNode } from "../src/core/nodes/review.js";
import { buildPublicReviewDir, buildPublicRunManifestPath } from "../src/core/publicArtifacts.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { LocalAciAdapter } from "../src/tools/aciLocalAdapter.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  delete process.env.AUTOLABOS_REVIEW_REFINEMENT_TIMEOUT_MS;
  process.chdir(ORIGINAL_CWD);
});

class HangingReviewLlm extends MockLLMClient {
  override async complete(
    _prompt: string,
    opts?: { abortSignal?: AbortSignal }
  ): Promise<{ text: string }> {
    return new Promise((resolve, reject) => {
      const signal = opts?.abortSignal;
      const abort = () => reject(new Error("aborted"));
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      void resolve;
    });
  }
}

class TruncatedReviewJsonLlm extends MockLLMClient {
  override async complete(): Promise<{ text: string }> {
    return {
      text: `{
  "summary": "LLM repaired review summary",
  "score_1_to_5": 4,
  "confidence": 0.81,
  "recommendation": "advance",
  "findings": []
`
    };
  }
}

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
      path.join(runDir, "baseline_summary.json"),
      JSON.stringify({ baseline: "baseline_model", accuracy: 0.87 }),
      "utf8"
    );
    await writeFile(
      path.join(runDir, "result_table.json"),
      JSON.stringify({ rows: [{ method: "treatment", accuracy: 0.91 }, { method: "baseline", accuracy: 0.87 }] }),
      "utf8"
    );
    await writeFile(
      path.join(runDir, "analyze_papers_richness_summary.json"),
      JSON.stringify({ readiness: "adequate", paper_count: 5 }),
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
              resource_notes: ["single-machine execution"]
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
      config: {
        workflow: { execution_approval_mode: "risk_ack" },
        experiments: {
          allow_network: true,
          network_policy: "declared",
          network_purpose: "logging"
        },
        paper_profile: { target_venue_style: "generic_cs_paper" }
      } as any,
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
    expect(packet.suggested_actions).toContain("/agent run write_paper");
    const readinessRiskArtifact = JSON.parse(
      await readFile(path.join(runDir, "review", "readiness_risks.json"), "utf8")
    ) as {
      readiness_state: string;
      risks: Array<{ category: string; status: string; risk_code: string }>;
    };
    expect(readinessRiskArtifact.readiness_state).toBe("paper_ready");
    expect(readinessRiskArtifact.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "network_dependency",
          status: "unverified",
          risk_code: "review_network_dependency_declared_logging"
        })
      ])
    );

    const checklist = await readFile(path.join(runDir, "review", "checklist.md"), "utf8");
    expect(checklist).toContain("# Review checklist");
    expect(checklist).toContain("Decision: advance -> advance");
    expect(checklist).toContain("Consensus: high");

    const decisionRaw = await readFile(path.join(runDir, "review", "decision.json"), "utf8");
    const decision = JSON.parse(decisionRaw) as { outcome: string; recommended_transition?: string };
    expect(decision.outcome).toBe("advance");
    expect(decision.recommended_transition).toBe("advance");
    const publicReviewDir = buildPublicReviewDir(root, run);
    expect(await readFile(path.join(publicReviewDir, "review_packet.json"), "utf8")).toContain(
      '"objective_status": "met"'
    );
    expect(await readFile(path.join(publicReviewDir, "checklist.md"), "utf8")).toContain("Consensus: high");
    expect(await readFile(path.join(publicReviewDir, "decision.json"), "utf8")).toContain('"outcome": "advance"');
    expect(await readFile(path.join(publicReviewDir, "readiness_risks.json"), "utf8")).toContain(
      '"review_network_dependency_declared_logging"'
    );
    expect(typeof (await readFile(path.join(publicReviewDir, "findings.jsonl"), "utf8"))).toBe("string");
    expect(await readFile(path.join(root, "outputs", "results", "operator_summary.md"), "utf8")).toContain(
      "Canonical JSON artifacts remain the source of truth"
    );
    expect(await readFile(path.join(root, "outputs", "results", "operator_summary.md"), "utf8")).toContain(
      "Panel scorecard:"
    );

    const manifest = JSON.parse(await readFile(buildPublicRunManifestPath(root, run), "utf8")) as {
      generated_files: string[];
      sections?: {
        review?: {
          generated_files: string[];
        };
        results?: {
          generated_files: string[];
        };
      };
    };
    expect(manifest.generated_files).toEqual(
      expect.arrayContaining([
        "review/review_packet.json",
        "review/scorecard.json",
        "review/checklist.md",
        "review/decision.json",
        "review/findings.jsonl",
        "review/readiness_risks.json",
        "results/operator_summary.md"
      ])
    );
    expect(manifest.sections?.review?.generated_files).toEqual(
      expect.arrayContaining([
        "review/review_packet.json",
        "review/scorecard.json",
        "review/checklist.md",
        "review/decision.json",
        "review/findings.jsonl",
        "review/readiness_risks.json"
      ])
    );
    expect(manifest.sections?.results?.generated_files).toEqual(
      expect.arrayContaining(["results/operator_summary.md"])
    );

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("review.last_summary")).toContain("accuracy=0.91");
    expect(await memory.get("review.last_decision")).toMatchObject({ outcome: "advance" });
    expect(await memory.get("review.readiness_risks")).toMatchObject({ readiness_state: "paper_ready" });
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
    expect(packet.suggested_actions).toContain("/agent jump design_experiments --force");
    const readinessRiskArtifact = JSON.parse(
      await readFile(path.join(runDir, "review", "readiness_risks.json"), "utf8")
    ) as {
      risk_count: number;
      blocked_count: number;
      risks: Array<{ category: string; status: string }>;
    };
    expect(readinessRiskArtifact.risk_count).toBeGreaterThan(0);
    expect(readinessRiskArtifact.blocked_count).toBeGreaterThan(0);
    expect(readinessRiskArtifact.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "paper_scale",
          status: "blocked"
        })
      ])
    );
  });

  it("keeps explicit baseline names in pre_review_summary when they come from analysis metrics instead of comparison labels", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-review-node-pre-summary-"));
    process.chdir(root);

    const run = makeRun("run-review-pre-summary");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await mkdir(path.join(runDir, "figures"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(path.join(runDir, "metrics.json"), JSON.stringify({ accuracy: 0.08 }, null, 2), "utf8");
    await writeFile(path.join(runDir, "figures", "performance.svg"), "<svg></svg>\n", "utf8");
    await writeFile(path.join(runDir, "corpus.jsonl"), `${JSON.stringify({ paper_id: "paper_1" })}\n`, "utf8");
    await writeFile(path.join(runDir, "paper_summaries.jsonl"), `${JSON.stringify({ paper_id: "paper_1" })}\n`, "utf8");
    await writeFile(path.join(runDir, "evidence_store.jsonl"), `${JSON.stringify({ evidence_id: "ev_1" })}\n`, "utf8");
    await writeFile(path.join(runDir, "hypotheses.jsonl"), `${JSON.stringify({ hypothesis_id: "h_1" })}\n`, "utf8");
    await writeFile(
      path.join(runDir, "experiment_plan.yaml"),
      ['selected_design:', '  title: "Baseline-aware retry"', '  summary: "Retry with the locked baseline comparison."', '  baselines:', '    - "current_best_baseline"'].join("\n"),
      "utf8"
    );
    await writeFile(path.join(runDir, "baseline_summary.json"), JSON.stringify({ baseline: "current_best_baseline" }, null, 2), "utf8");
    await writeFile(path.join(runDir, "result_table.json"), JSON.stringify({ summary: "baseline vs treatment" }, null, 2), "utf8");
    await mkdir(path.join(runDir, "paper"), { recursive: true });
    await writeFile(
      path.join(runDir, "paper", "compiled_page_validation.json"),
      JSON.stringify({
        status: "warn",
        outcome: "under_limit",
        compiled_pdf_page_count: 3,
        minimum_main_pages: 8,
        target_main_pages: 8,
        main_page_limit: 8,
        message: "Compiled PDF is only 3 pages, below the configured minimum_main_pages of 8."
      }, null, 2),
      "utf8"
    );
    await writeFile(
      path.join(runDir, "result_analysis.json"),
      `${JSON.stringify(
        {
          analysis_version: 1,
          generated_at: new Date().toISOString(),
          mean_score: 3.1,
          metrics: {
            accuracy_delta_vs_baseline: -0.25,
            comparison_contract: {
              baseline_binding: {
                source_arm_name: "fixed_cot_256"
              }
            },
            current_best_baseline: {
              arm_name: "current_best_baseline",
              accuracy: 0.333333
            }
          },
          objective_metric: {
            raw: "accuracy_delta_vs_baseline",
            evaluation: {
              status: "not_met",
              summary: "Objective metric not met: accuracy_delta_vs_baseline=-0.25 does not satisfy > 0."
            },
            profile: {
              source: "llm",
              primary_metric: "accuracy_delta_vs_baseline",
              preferred_metric_keys: ["accuracy_delta_vs_baseline"],
              analysis_focus: [],
              paper_emphasis: [],
              assumptions: []
            }
          },
          overview: {
            objective_status: "not_met",
            objective_summary: "Objective metric not met: accuracy_delta_vs_baseline=-0.25 does not satisfy > 0.",
            execution_runs: 1
          },
          plan_context: {
            selected_design: {
              id: "design_1",
              title: "Baseline-aware retry",
              summary: "Retry with the locked baseline comparison.",
              selected_hypothesis_ids: ["h_1"],
              metrics: ["accuracy_delta_vs_baseline"],
              baselines: ["current_best_baseline"],
              evaluation_steps: ["rerun against the locked baseline"],
              risks: ["still only one repeat"],
              resource_notes: ["bounded local run"]
            },
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
            commands: ["python run.py"],
            sources: ["local_python"],
            stderr_excerpts: []
          },
          primary_findings: ["The treatment underperformed the baseline."],
          limitations: [],
          warnings: [],
          paper_claims: [],
          figure_specs: [
            {
              id: "perf",
              title: "Performance overview",
              path: "figures/performance.svg",
              metric_keys: ["accuracy_delta_vs_baseline"],
              summary: "The treatment underperformed the baseline."
            }
          ],
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
          synthesis: {
            source: "fallback",
            discussion_points: ["The treatment underperformed the baseline."],
            failure_analysis: ["Revise the design before another run."],
            follow_up_actions: ["Backtrack to design."],
            confidence_statement: "Confidence is limited because only one bounded run exists."
          },
          transition_recommendation: {
            action: "backtrack_to_design",
            sourceNode: "analyze_results",
            targetNode: "review",
            reason: "Review the bounded negative result before the next retry.",
            confidence: 0.8,
            autoExecutable: true,
            evidence: ["accuracy_delta_vs_baseline=-0.25"],
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

    const preReviewRaw = await readFile(path.join(runDir, "review", "pre_review_summary.json"), "utf8");
    const preReview = JSON.parse(preReviewRaw) as {
      baseline: string;
      prior_compiled_page_validation?: {
        status: string;
        compiled_pdf_page_count: number;
        minimum_main_pages: number;
        target_main_pages: number;
        main_page_limit: number;
      };
    };
    expect(preReview.baseline).toContain("current_best_baseline");
    expect(preReview.baseline).toContain("fixed_cot_256");
    expect(preReview.prior_compiled_page_validation).toMatchObject({
      status: "warn",
      compiled_pdf_page_count: 3,
      minimum_main_pages: 8,
      target_main_pages: 8,
      main_page_limit: 8
    });
    expect(await readFile(path.join(buildPublicReviewDir(root, run), "pre_review_summary.json"), "utf8")).toContain(
      "\"prior_compiled_page_validation\""
    );
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
              resource_notes: []
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
    expect(packet.suggested_actions).not.toContain("/approve");
    expect(packet.suggested_actions).toContain("/agent jump generate_hypotheses --force");
  });

  it("falls back heuristically when a reviewer refinement hangs past the timeout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-review-node-timeout-"));
    process.chdir(root);
    process.env.AUTOLABOS_REVIEW_REFINEMENT_TIMEOUT_MS = "10";

    const run = makeRun("run-review-timeout");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(path.join(runDir, "metrics.json"), JSON.stringify({ accuracy: 0.91 }, null, 2), "utf8");
    await writeFile(path.join(runDir, "result_analysis.json"), JSON.stringify({
      analysis_version: 1,
      generated_at: new Date().toISOString(),
      mean_score: 0.91,
      metrics: { accuracy: 0.91 },
      objective_metric: {
        raw: "accuracy at least 0.9",
        evaluation: { status: "met", summary: "Objective metric met." },
        profile: { source: "default", preferred_metric_keys: ["accuracy"], analysis_focus: [], paper_emphasis: [], assumptions: [] }
      },
      overview: { objective_status: "met", objective_summary: "Objective metric met.", execution_runs: 1 },
      plan_context: { shortlisted_designs: [], design_notes: [], implementation_notes: [], evaluation_notes: [], assumptions: [] },
      metric_table: [],
      condition_comparisons: [],
      execution_summary: { observation_count: 1, commands: [], sources: [], stderr_excerpts: [] },
      primary_findings: [],
      limitations: [],
      warnings: [],
      paper_claims: [],
      figure_specs: [],
      supplemental_runs: [],
      external_comparisons: [],
      statistical_summary: { total_trials: 1, executed_trials: 1, cached_trials: 0, confidence_intervals: [], stability_metrics: [], effect_estimates: [], notes: [] },
      failure_taxonomy: [],
      transition_recommendation: {
        action: "advance",
        sourceNode: "analyze_results",
        targetNode: "review",
        reason: "Ready for review.",
        confidence: 0.8,
        autoExecutable: true,
        evidence: ["accuracy reached the configured target."],
        suggestedCommands: ["/approve"],
        generatedAt: new Date().toISOString()
      }
    }, null, 2), "utf8");

    const eventStream = new InMemoryEventStream();
    const node = createReviewNode({
      config: {} as any,
      runStore: {} as any,
      eventStream,
      llm: new HangingReviewLlm(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: new LocalAciAdapter({ allowNetwork: false }),
      semanticScholar: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    expect(result.transitionRecommendation).toBeDefined();
    expect(eventStream.history()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            text: expect.stringContaining("reviewer exceeded the 10ms timeout")
          })
        })
      ])
    );
    expect(await readFile(path.join(runDir, "review", "decision.json"), "utf8")).toContain("\"outcome\"");
  });

  it("repairs truncated reviewer JSON before merging the review result", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-review-node-repair-"));
    process.chdir(root);

    const run = makeRun("run-review-repair");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await mkdir(path.join(runDir, "figures"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(path.join(runDir, "metrics.json"), JSON.stringify({ accuracy: 0.91 }, null, 2), "utf8");
    await writeFile(path.join(runDir, "figures", "performance.svg"), "<svg></svg>\n", "utf8");
    await writeFile(path.join(runDir, "corpus.jsonl"), `${JSON.stringify({ paper_id: "paper_1" })}\n`, "utf8");
    await writeFile(path.join(runDir, "paper_summaries.jsonl"), `${JSON.stringify({ paper_id: "paper_1" })}\n`, "utf8");
    await writeFile(path.join(runDir, "evidence_store.jsonl"), `${JSON.stringify({ evidence_id: "ev_1" })}\n`, "utf8");
    await writeFile(path.join(runDir, "hypotheses.jsonl"), `${JSON.stringify({ hypothesis_id: "h_1" })}\n`, "utf8");
    await writeFile(
      path.join(runDir, "experiment_plan.yaml"),
      ['selected_design:', '  title: "Review repair plan"', '  summary: "Validate truncated review JSON repair."'].join("\n"),
      "utf8"
    );
    await writeFile(path.join(runDir, "result_analysis.json"), JSON.stringify({
      analysis_version: 1,
      generated_at: new Date().toISOString(),
      mean_score: 0.91,
      metrics: { accuracy: 0.91 },
      objective_metric: {
        raw: "accuracy at least 0.9",
        evaluation: { status: "met", summary: "Objective metric met." },
        profile: { source: "default", preferred_metric_keys: ["accuracy"], analysis_focus: [], paper_emphasis: [], assumptions: [] }
      },
      overview: { objective_status: "met", objective_summary: "Objective metric met.", execution_runs: 3 },
      plan_context: {
        selected_design: {
          id: "design_1",
          title: "Review repair plan",
          summary: "Validate truncated review JSON repair.",
          selected_hypothesis_ids: ["h_1"],
          metrics: ["accuracy"],
          baselines: ["baseline_model"],
          evaluation_steps: ["run and verify"],
          risks: [],
          resource_notes: []
        },
        shortlisted_designs: [],
        design_notes: [],
        implementation_notes: [],
        evaluation_notes: [],
        assumptions: []
      },
      metric_table: [],
      condition_comparisons: [],
      execution_summary: { observation_count: 3, commands: [], sources: [], stderr_excerpts: [] },
      primary_findings: ["Accuracy cleared the target threshold."],
      limitations: [],
      warnings: [],
      paper_claims: [{ claim: "The treatment improved the primary metric.", evidence: ["accuracy=0.91"] }],
      figure_specs: [{ id: "perf", title: "Performance overview", path: "figures/performance.svg", metric_keys: ["accuracy"], summary: "Accuracy stayed above target." }],
      supplemental_runs: [],
      external_comparisons: [],
      statistical_summary: {
        total_trials: 3,
        executed_trials: 3,
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
        reason: "Ready for review.",
        confidence: 0.8,
        autoExecutable: true,
        evidence: ["accuracy reached the configured target."],
        suggestedCommands: ["/approve"],
        generatedAt: new Date().toISOString()
      }
    }, null, 2), "utf8");

    const eventStream = new InMemoryEventStream();
    const node = createReviewNode({
      config: {} as any,
      runStore: {} as any,
      eventStream,
      llm: new TruncatedReviewJsonLlm(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: new LocalAciAdapter({ allowNetwork: false }),
      semanticScholar: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");
    const scorecard = await readFile(path.join(runDir, "review", "scorecard.json"), "utf8");
    expect(scorecard).toContain("LLM repaired review summary");
    expect(eventStream.history()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            text: expect.stringContaining("repaired truncated JSON")
          })
        })
      ])
    );
  });
});
