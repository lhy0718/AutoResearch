import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { createFigureAuditNode } from "../src/core/nodes/figureAudit.js";
import { createReviewNode } from "../src/core/nodes/review.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { DefaultNodeRegistry } from "../src/core/stateGraph/nodeRegistry.js";
import * as explorationConfigModule from "../src/core/exploration/explorationConfig.js";
import * as llmPaperQualityEvaluatorModule from "../src/core/analysis/llmPaperQualityEvaluator.js";
import { evaluateMinimumGate } from "../src/core/analysis/paperMinimumGate.js";
import type { FigureAuditSummary } from "../src/core/exploration/types.js";
import { GRAPH_NODE_ORDER, RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  vi.restoreAllMocks();
});

class AlwaysAdvanceReviewLlm extends MockLLMClient {
  override async complete(): Promise<{ text: string }> {
    return {
      text: JSON.stringify({
        summary: "The evidence bar is met.",
        score_1_to_5: 5,
        confidence: 0.91,
        recommendation: "advance",
        findings: []
      })
    };
  }
}

function makeRun(runId: string, currentNode: RunRecord["currentNode"]): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "Figure audit run",
    topic: "AI agent automation",
    constraints: [],
    objectiveMetric: "accuracy >= 0.9",
    status: "running",
    currentNode,
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

async function seedReviewArtifacts(root: string, run: RunRecord): Promise<void> {
  const runDir = path.join(root, ".autolabos", "runs", run.id);
  await mkdir(path.join(runDir, "memory"), { recursive: true });
  await mkdir(path.join(runDir, "figures"), { recursive: true });
  await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
  await writeFile(path.join(runDir, "metrics.json"), JSON.stringify({ accuracy: 0.91 }, null, 2), "utf8");
  await writeFile(path.join(runDir, "figures", "performance.svg"), "<svg><text>acc</text></svg>\n", "utf8");
  await writeFile(
    path.join(runDir, "corpus.jsonl"),
    `${JSON.stringify({ paper_id: "paper_1", title: "Bench", abstract: "Abstract." })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "paper_summaries.jsonl"),
    `${JSON.stringify({ paper_id: "paper_1", title: "Bench", source_type: "full_text", summary: "Summary." })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "evidence_store.jsonl"),
    `${JSON.stringify({ evidence_id: "ev_1", paper_id: "paper_1", claim: "Improves accuracy." })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "hypotheses.jsonl"),
    `${JSON.stringify({ hypothesis_id: "h_1", text: "Improves accuracy.", evidence_links: ["ev_1"] })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "experiment_plan.yaml"),
    ['selected_design:', '  title: "Review plan"', '  summary: "Validate review path."'].join("\n"),
    "utf8"
  );
  await writeFile(path.join(runDir, "baseline_summary.json"), JSON.stringify({ baseline: "base", accuracy: 0.87 }), "utf8");
  await writeFile(
    path.join(runDir, "result_table.json"),
    JSON.stringify({ rows: [{ method: "baseline", accuracy: 0.87 }, { method: "candidate", accuracy: 0.91 }] }),
    "utf8"
  );
  await writeFile(path.join(runDir, "analyze_papers_richness_summary.json"), JSON.stringify({ readiness: "adequate" }), "utf8");
  await writeFile(
    path.join(runDir, "result_analysis.json"),
    `${JSON.stringify(
      {
        analysis_version: 1,
        generated_at: new Date().toISOString(),
        mean_score: 0.91,
        metrics: { accuracy: 0.91 },
        objective_metric: {
          raw: "accuracy >= 0.9",
          evaluation: { status: "met", summary: "Objective met." },
          profile: { source: "default", preferred_metric_keys: ["accuracy"], analysis_focus: [], paper_emphasis: [], assumptions: [] }
        },
        overview: {
          objective_status: "met",
          objective_summary: "Objective met.",
          execution_runs: 2
        },
        plan_context: {
          selected_design: {
            id: "d1",
            title: "Review plan",
            summary: "Validate review path.",
            selected_hypothesis_ids: ["h_1"],
            metrics: ["accuracy"],
            baselines: ["base"],
            evaluation_steps: ["run trials"],
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
        results_table: [
          {
            metric: "accuracy",
            baseline: 0.87,
            comparator: 0.91,
            delta: 0.04,
            direction: "higher_better"
          }
        ],
        condition_comparisons: [
          {
            id: "cmp_1",
            label: "candidate vs baseline",
            source: "metrics.comparison",
            metrics: [],
            hypothesis_supported: true,
            summary: "Candidate improves accuracy."
          }
        ],
        primary_findings: [
          {
            id: "finding_1",
            title: "Main gain",
            finding: "Candidate improves accuracy.",
            confidence: 0.9,
            source: "analysis"
          }
        ],
        paper_claims: [
          {
            claim: "Candidate improves accuracy.",
            evidence: [{ type: "metric", reference: "accuracy", detail: "+0.04" }]
          }
        ],
        figure_specs: [
          {
            title: "Accuracy comparison",
            path: "figures/performance.svg",
            metric_keys: ["accuracy"]
          }
        ],
        statistical_summary: {
          total_trials: 2,
          executed_trials: 2,
          cached_trials: 0,
          confidence_intervals: [],
          stability_metrics: [],
          effect_estimates: [],
          notes: []
        },
        execution_summary: {
          observation_count: 2,
          repeated_trial_count: 2,
          synthetic_result_count: 0,
          dominant_sources: ["executed_run"]
        },
        failure_taxonomy: [],
        limitations: [],
        warnings: [],
        recommendations: [],
        shortlisted_designs: [],
        transition_recommendation: {
          action: "advance",
          sourceNode: "analyze_results",
          targetNode: "figure_audit",
          reason: "Continue to figure audit.",
          confidence: 0.8,
          autoExecutable: true,
          evidence: ["objective met"],
          suggestedCommands: ["/agent run figure_audit"],
          generatedAt: new Date().toISOString()
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

describe("figure_audit node integration", () => {
  it("writes figure_audit_summary.json and per-figure artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-figure-audit-node-"));
    process.chdir(root);

    const run = makeRun("run-figure-audit-node", "figure_audit");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "paper", "figures"), { recursive: true });
    await writeFile(
      path.join(runDir, "paper", "main.tex"),
      `
\\begin{figure}
\\includegraphics{figures/plot.svg}
\\caption{TODO}
\\end{figure}
`,
      "utf8"
    );
    await writeFile(path.join(runDir, "paper", "figures", "plot.svg"), "<svg><text>plot</text></svg>\n", "utf8");
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8").catch(async () => {
      await mkdir(path.join(runDir, "memory"), { recursive: true });
      await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    });

    const node = createFigureAuditNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: {} as any,
      pdfTextLlm: {} as any,
      codex: {} as any,
      aci: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });
    const summary = JSON.parse(
      await readFile(path.join(runDir, "figure_audit", "figure_audit_summary.json"), "utf8")
    ) as FigureAuditSummary;

    expect(result.status).toBe("success");
    expect(summary.review_block_required).toBe(true);
    expect(summary.severe_mismatch_count).toBeGreaterThan(0);
    await expect(readFile(path.join(runDir, "figure_audit", "per_figure", "plot.json"), "utf8")).resolves.toContain("figure_caption_incomplete");
  });

  it("passes through with an empty summary when figure_auditor.enabled is false", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-figure-audit-pass-through-"));
    process.chdir(root);

    const baseConfig = explorationConfigModule.loadExplorationConfig();
    vi.spyOn(explorationConfigModule, "loadExplorationConfig").mockReturnValue({
      ...baseConfig,
      figure_auditor: {
        enabled: false,
        block_on_severe_mismatch: true,
        require_caption_alignment: true,
        require_reference_alignment: true
      }
    });

    const run = makeRun("run-figure-audit-pass-through", "figure_audit");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");

    const node = createFigureAuditNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: {} as any,
      pdfTextLlm: {} as any,
      codex: {} as any,
      aci: {} as any
    });

    await node.execute({ run, graph: run.graph });
    const summary = JSON.parse(
      await readFile(path.join(runDir, "figure_audit", "figure_audit_summary.json"), "utf8")
    ) as FigureAuditSummary;

    expect(summary.review_block_required).toBe(false);
    expect(summary.issues).toEqual([]);
  });

  it("escalates review accept to revise when figure audit requires a block", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-review-figure-audit-"));
    process.chdir(root);

    const baseConfig = explorationConfigModule.loadExplorationConfig();
    vi.spyOn(explorationConfigModule, "loadExplorationConfig").mockReturnValue({
      ...baseConfig,
      figure_auditor: {
        enabled: true,
        block_on_severe_mismatch: true,
        require_caption_alignment: true,
        require_reference_alignment: true
      }
    });
    vi.spyOn(llmPaperQualityEvaluatorModule, "runLLMPaperQualityEvaluation").mockResolvedValue({
      llmUsed: false,
      evaluation: {
        paper_worthiness: "paper_ready",
        overall_score_1_to_10: 8,
        rationale: "Strong enough.",
        strengths: ["Strong evidence"],
        weaknesses: [],
        blockers: [],
        recommended_action: "advance_to_draft",
        target_node: "review",
        dimensions: {
          experimental_rigor: 8,
          baseline_strength: 8,
          evidence_quality: 8,
          reproducibility: 8,
          writing_readiness: 8,
          significance: 8,
          citation_coverage: 8
        }
      },
      costUsd: 0,
      usage: undefined
    });

    const run = makeRun("run-review-figure-audit", "review");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await seedReviewArtifacts(root, run);
    await mkdir(path.join(runDir, "figure_audit"), { recursive: true });
    await writeFile(
      path.join(runDir, "figure_audit", "figure_audit_summary.json"),
      `${JSON.stringify(
        {
          audited_at: new Date().toISOString(),
          figure_count: 1,
          issues: [
            {
              figure_id: "performance",
              issue_type: "vision_claim_support_gap",
              severity: "severe",
              description: "Figure does not substantiate the claim strongly enough.",
              recommended_action: "Repair the figure before accepting.",
              evidence_alignment_status: "misaligned",
              empirical_validity_impact: "major",
              publication_readiness: "not_ready",
              manuscript_placement_recommendation: "remove"
            }
          ],
          severe_mismatch_count: 1,
          review_block_required: true
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
      llm: new AlwaysAdvanceReviewLlm(),
      experimentLlm: {} as any,
      pdfTextLlm: {} as any,
      codex: {} as any,
      aci: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });
    const decision = JSON.parse(await readFile(path.join(runDir, "review", "decision.json"), "utf8")) as {
      outcome: string;
      figure_audit_block_required: boolean;
      figure_audit_severe_count: number;
    };

    expect(result.status).toBe("success");
    expect(decision.figure_audit_block_required).toBe(true);
    expect(decision.figure_audit_severe_count).toBe(1);
    expect(decision.outcome).toBe("revise_in_place");
  });

  it("registers analyze_results -> figure_audit -> review in graph order", () => {
    expect(GRAPH_NODE_ORDER).toContain("figure_audit");
    expect(GRAPH_NODE_ORDER[GRAPH_NODE_ORDER.indexOf("analyze_results") + 1]).toBe("figure_audit");
    expect(GRAPH_NODE_ORDER[GRAPH_NODE_ORDER.indexOf("figure_audit") + 1]).toBe("review");

    const registry = new DefaultNodeRegistry({} as any);
    expect(registry.list().map((handler) => handler.id)).toContain("figure_audit");
  });

  it("adds a warning-only minimum-gate flag when figure_audit has severe mismatches", () => {
    const result = evaluateMinimumGate({
      presence: {
        corpusPresent: true,
        paperSummariesPresent: true,
        evidenceStorePresent: true,
        hypothesesPresent: true,
        experimentPlanPresent: true,
        metricsPresent: true,
        figurePresent: true,
        synthesisPresent: true,
        baselineSummaryPresent: true,
        resultTablePresent: true,
        richnessSummaryPresent: true,
        richnessReadiness: "adequate"
      },
      report: {
        overview: { objective_status: "met", objective_summary: "Objective met.", execution_runs: 1 },
        condition_comparisons: [{ id: "cmp", label: "cmp", source: "metrics.comparison", metrics: [], hypothesis_supported: true, summary: "ok" }],
        primary_findings: [{ id: "f1", title: "Finding", finding: "Finding", confidence: 0.9, source: "analysis" }],
        paper_claims: [{ claim: "Claim", evidence: [{ type: "metric", reference: "accuracy", detail: "+0.04" }] }],
        results_table: [{ metric: "accuracy", baseline: 0.87, comparator: 0.91, delta: 0.04, direction: "higher_better" }],
        limitations: [],
        warnings: [],
        statistical_summary: { total_trials: 2, executed_trials: 2, cached_trials: 0, confidence_intervals: [], stability_metrics: [], effect_estimates: [], notes: [] },
        shortlisted_designs: [],
        recommendations: []
      } as any,
      topic: "topic",
      objectiveMetric: "accuracy",
      figureAuditSummaryArtifact: {
        audited_at: new Date().toISOString(),
        figure_count: 1,
        issues: [],
        severe_mismatch_count: 1,
        review_block_required: true
      }
    });

    expect(result.passed).toBe(true);
    expect(result.figure_audit_severe_mismatch).toBe(true);
  });
});
