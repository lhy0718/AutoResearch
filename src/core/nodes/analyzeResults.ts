import path from "node:path";

import { promises as fs } from "node:fs";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { safeRead, writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { LongTermStore } from "../memory/longTermStore.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import {
  evaluateObjectiveMetric,
  normalizeObjectiveMetricProfile,
  ObjectiveMetricEvaluation,
  resolveObjectiveMetricProfile
} from "../objectiveMetric.js";
import {
  AnalysisConditionComparison,
  AnalysisFailureCategory,
  AnalysisReport,
  buildAnalysisReport,
  renderPerformanceFigureSvg
} from "../resultAnalysis.js";
import { buildAnalyzeResultsCompletionSummary } from "../resultAnalysisPresentation.js";
import { synthesizeAnalysisReport } from "../resultAnalysisSynthesis.js";
import { RunVerifierReport } from "../experiments/runVerifierFeedback.js";
import { GraphNodeId, TransitionRecommendation } from "../../types.js";
import { runAnalyzeResultsPanel } from "../analyzeResultsPanel.js";
import {
  clearPendingHumanInterventionRequest,
  createHumanInterventionRequest,
  HumanInterventionRequest,
  readPendingHumanInterventionRequest,
  writeHumanInterventionRequest
} from "../humanIntervention.js";

export function createAnalyzeResultsNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "analyze_results",
    async execute({ run }) {
      const longTermStore = new LongTermStore(run.memoryRefs.longTermPath);
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      const metricsPath =
        resolveMaybeRelative(
          await runContextMemory.get<string>("implement_experiments.metrics_path"),
          process.cwd()
        ) || path.join(".autolabos", "runs", run.id, "metrics.json");
      let metrics: Record<string, unknown> = {};
      const inputWarnings: string[] = [];
      let metricsLoadError: string | undefined;
      try {
        const raw = await fs.readFile(metricsPath, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("metrics.json must decode to an object");
        }
        metrics = parsed as Record<string, unknown>;
      } catch (error) {
        metrics = {};
        metricsLoadError = `Structured result analysis requires a valid metrics file at ${metricsPath}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        inputWarnings.push(metricsLoadError);
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "analyze_results",
          payload: { text: metricsLoadError }
        });
      }

      const manualObjectiveClarification =
        (await runContextMemory.get<string>("analyze_results.objective_clarification"))?.trim() || undefined;
      const effectiveObjectiveMetric = manualObjectiveClarification || run.objectiveMetric;
      const objectiveProfileBase = await resolveObjectiveMetricProfile({
        run: {
          ...run,
          objectiveMetric: effectiveObjectiveMetric
        },
        runContextMemory,
        llm: deps.llm,
        eventStream: deps.eventStream,
        node: "analyze_results"
      });
      const objectiveProfile = manualObjectiveClarification
        ? normalizeObjectiveMetricProfile(
            {
              ...objectiveProfileBase,
              assumptions: [
                `Human clarification: ${manualObjectiveClarification}`,
                ...objectiveProfileBase.assumptions
              ]
            },
            effectiveObjectiveMetric
          )
        : objectiveProfileBase;
      const cachedEvaluation =
        await runContextMemory.get<ObjectiveMetricEvaluation>("objective_metric.last_evaluation");
      const shouldRefreshObjectiveEvaluation =
        !cachedEvaluation || cachedEvaluation.status === "unknown" || cachedEvaluation.status === "missing";
      const objectiveEvaluation = shouldRefreshObjectiveEvaluation
        ? evaluateObjectiveMetric(metrics, objectiveProfile, effectiveObjectiveMetric)
        : cachedEvaluation;
      if (
        shouldRefreshObjectiveEvaluation &&
        (!cachedEvaluation ||
          cachedEvaluation.status !== objectiveEvaluation.status ||
          cachedEvaluation.matchedMetricKey !== objectiveEvaluation.matchedMetricKey)
      ) {
        await runContextMemory.put("objective_metric.last_evaluation", objectiveEvaluation);
        if (cachedEvaluation?.status === "unknown" || cachedEvaluation?.status === "missing") {
          deps.eventStream.emit({
            type: "OBS_RECEIVED",
            runId: run.id,
            node: "analyze_results",
            payload: {
              text: `Objective metric re-evaluated automatically: ${objectiveEvaluation.summary}`
            }
          });
        }
      }

      const experimentPlanRaw = await safeRead(path.join(".autolabos", "runs", run.id, "experiment_plan.yaml"));
      const observationsRaw = await safeRead(
        path.join(".autolabos", "runs", run.id, "exec_logs", "observations.jsonl")
      );
      const runVerifierReport = await readJsonObject<RunVerifierReport>(
        path.join(".autolabos", "runs", run.id, "run_experiments_verify_report.json"),
        inputWarnings,
        "run_experiments_verify_report.json"
      );
      const publicDir =
        resolveMaybeRelative(
          await runContextMemory.get<string>("implement_experiments.public_dir"),
          process.cwd()
        ) || undefined;
      const supplementalMetrics = await loadSupplementalMetrics(publicDir, inputWarnings);
      const recentPaperComparisonPath =
        resolveMaybeRelative(asString(metrics.recent_paper_reproducibility_path), publicDir || process.cwd()) ||
        (publicDir ? path.join(publicDir, "recent_paper_reproducibility.json") : undefined);
      const recentPaperComparison =
        (recentPaperComparisonPath &&
          (await readJsonObject<Record<string, unknown>>(
            recentPaperComparisonPath,
            inputWarnings,
            "recent_paper_reproducibility.json"
          ))) ||
        undefined;
      const summary = buildAnalysisReport({
        run,
        metrics,
        objectiveProfile,
        objectiveEvaluation,
        experimentPlanRaw,
        observationsRaw,
        inputWarnings,
        runVerifierReport,
        supplementalMetrics,
        recentPaperComparison,
        recentPaperComparisonPath
      });
      const noNumericMetrics = summary.metric_table.length === 0;
      if (!metricsLoadError && !noNumericMetrics) {
        summary.synthesis = await synthesizeAnalysisReport({
          run,
          report: summary,
          llm: deps.llm,
          eventStream: deps.eventStream,
          node: "analyze_results"
        });
      }
      const baselineTransitionRecommendation = buildTransitionRecommendation(summary);
      const panelResult = runAnalyzeResultsPanel({
        report: summary,
        baselineRecommendation: baselineTransitionRecommendation
      });
      const transitionRecommendation = panelResult.recommendation;
      const humanInterventionRequest = buildAnalyzeResultsHumanInterventionRequest({
        run,
        report: summary,
        transitionRecommendation
      });
      summary.transition_recommendation = transitionRecommendation;

      await writeRunArtifact(
        run,
        "analyze_results_panel/inputs.json",
        JSON.stringify(panelResult.inputs, null, 2)
      );
      await writeRunArtifact(
        run,
        "analyze_results_panel/reviews.json",
        JSON.stringify(panelResult.reviews, null, 2)
      );
      await writeRunArtifact(
        run,
        "analyze_results_panel/scorecard.json",
        JSON.stringify(panelResult.scorecard, null, 2)
      );
      await writeRunArtifact(
        run,
        "analyze_results_panel/decision.json",
        JSON.stringify(panelResult.decision, null, 2)
      );
      await writeRunArtifact(run, "result_analysis.json", JSON.stringify(summary, null, 2));
      if (summary.synthesis) {
        await writeRunArtifact(run, "result_analysis_synthesis.json", JSON.stringify(summary.synthesis, null, 2));
      }
      await writeRunArtifact(
        run,
        "transition_recommendation.json",
        JSON.stringify(transitionRecommendation, null, 2)
      );
      const figureSvg = renderPerformanceFigureSvg(summary);
      if (figureSvg) {
        await writeRunArtifact(run, "figures/performance.svg", figureSvg);
      }
      await runContextMemory.put("analyze_results.last_summary", summary);
      await runContextMemory.put("analyze_results.last_error", metricsLoadError || null);
      await runContextMemory.put("analyze_results.last_synthesis", summary.synthesis || null);
      await runContextMemory.put("analyze_results.last_transition", transitionRecommendation);
      await runContextMemory.put("analyze_results.panel_decision", panelResult.decision);
      if (humanInterventionRequest) {
        await writeHumanInterventionRequest({
          workspaceRoot: process.cwd(),
          run,
          runContext: runContextMemory,
          request: humanInterventionRequest
        });
      } else {
        const pendingRequest = await readPendingHumanInterventionRequest(runContextMemory);
        if (pendingRequest?.sourceNode === "analyze_results") {
          await clearPendingHumanInterventionRequest(runContextMemory);
        }
      }
      await longTermStore.append({
        runId: run.id,
        category: "results",
        text: `Result summary: ${JSON.stringify(summary)}`,
        tags: ["analyze_results"]
      });

      if (metricsLoadError || noNumericMetrics) {
        const error =
          metricsLoadError ||
          `Structured result analysis requires at least one numeric metric in ${metricsPath}.`;
        if (!metricsLoadError) {
          deps.eventStream.emit({
            type: "OBS_RECEIVED",
            runId: run.id,
            node: "analyze_results",
            payload: { text: error }
          });
          await runContextMemory.put("analyze_results.last_error", error);
        }
        return {
          status: "failure",
          error,
          summary: error,
          toolCallsUsed: 1
        };
      }

      return {
        status: "success",
        summary: `${buildAnalyzeResultsCompletionSummary(summary)} Panel-calibrated transition confidence: ${transitionRecommendation.confidence}.`,
        needsApproval: true,
        toolCallsUsed: 1,
        transitionRecommendation
      };
    }
  };
}

function buildAnalyzeResultsHumanInterventionRequest(input: {
  run: { id: string; currentNode: GraphNodeId };
  report: AnalysisReport;
  transitionRecommendation: TransitionRecommendation;
}): HumanInterventionRequest | undefined {
  if (input.report.overview.objective_status === "unknown") {
    const metricKeys = input.report.metric_table.map((item) => item.key);
    return createHumanInterventionRequest({
      sourceNode: "analyze_results",
      kind: "objective_metric_clarification",
      title: "Clarify the objective metric",
      question:
        'Reply with the metric key or success criterion to use for this run (for example: "accuracy >= 0.9").',
      context: [
        input.report.overview.objective_summary,
        metricKeys.length > 0
          ? `Available numeric metrics: ${metricKeys.join(", ")}.`
          : "No numeric metrics were available for automatic grounding."
      ],
      inputMode: "free_text",
      resumeAction: "retry_current"
    });
  }

  if (
    input.transitionRecommendation.action === "backtrack_to_hypotheses" &&
    !input.transitionRecommendation.autoExecutable
  ) {
    return createHumanInterventionRequest({
      sourceNode: "analyze_results",
      kind: "transition_choice",
      title: "Choose the next recovery step",
      question: "Choose how the run should continue.",
      context: [
        input.transitionRecommendation.reason,
        ...input.transitionRecommendation.evidence.slice(0, 3)
      ],
      inputMode: "single_choice",
      resumeAction: "apply_transition",
      choices: [
        {
          id: "revisit_hypotheses",
          label: "Backtrack to generate_hypotheses",
          description: "Follow the current recommendation and revisit the hypothesis set.",
          answerAliases: ["hypotheses", "generate_hypotheses"]
        },
        {
          id: "revise_design",
          label: "Jump to design_experiments",
          description: "Keep the current hypothesis set and revise only the experiment design.",
          answerAliases: ["design", "design_experiments"],
          resumeAction: "jump",
          targetNode: "design_experiments"
        },
        {
          id: "inspect_implementation",
          label: "Jump to implement_experiments",
          description: "Inspect implementation and execution details before changing the hypothesis.",
          answerAliases: ["implement", "implement_experiments"],
          resumeAction: "jump",
          targetNode: "implement_experiments"
        }
      ]
    });
  }

  return undefined;
}

async function loadSupplementalMetrics(publicDir: string | undefined, warnings: string[]): Promise<
  Array<{
    profile: string;
    path?: string;
    metrics: Record<string, unknown>;
  }>
> {
  if (!publicDir) {
    return [];
  }

  const results: Array<{
    profile: string;
    path?: string;
    metrics: Record<string, unknown>;
  }> = [];

  for (const [profile, fileName] of [
    ["confirmatory", "confirmatory_metrics.json"],
    ["quick_check", "quick_check_metrics.json"]
  ] as const) {
    const filePath = path.join(publicDir, fileName);
    const parsed = await readJsonObject<Record<string, unknown>>(filePath, warnings, fileName);
    if (parsed) {
      results.push({
        profile,
        path: filePath,
        metrics: parsed
      });
    }
  }

  return results;
}

async function readJsonObject<T extends object>(
  filePath: string,
  warnings: string[],
  label: string
): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} must decode to an object`);
    }
    return parsed as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ENOENT/u.test(message)) {
      warnings.push(`Failed to parse ${label} at ${filePath}: ${message}`);
    }
    return undefined;
  }
}

function resolveMaybeRelative(value: string | undefined, workspaceRoot: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.join(workspaceRoot, value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildTransitionRecommendation(summary: AnalysisReport): TransitionRecommendation {
  const runtimeFailure = findFailure(summary.failure_taxonomy, "runtime_failure");
  if (runtimeFailure || summary.verifier_feedback?.status === "fail") {
    return createRecommendation({
      action: "backtrack_to_implement",
      targetNode: "implement_experiments",
      reason:
        runtimeFailure?.summary ||
        `Verifier requested another implementation pass: ${summary.verifier_feedback?.summary || "runtime failure"}.`,
      confidence: 0.93,
      autoExecutable: true,
      evidence: collectEvidence(
        summary,
        runtimeFailure?.summary,
        summary.verifier_feedback?.suggested_next_action,
        summary.synthesis?.follow_up_actions?.[0]
      )
    });
  }

  if (summary.overview.objective_status === "missing") {
    return createRecommendation({
      action: "backtrack_to_implement",
      targetNode: "implement_experiments",
      reason:
        "The run did not record the objective metric needed for evaluation, so implementation should export the expected metric before another analysis pass.",
      confidence: 0.9,
      autoExecutable: true,
      evidence: collectEvidence(
        summary,
        summary.overview.objective_summary,
        summary.failure_taxonomy.find((item) => item.id === "missing_numeric_metrics")?.summary,
        summary.synthesis?.follow_up_actions?.[0]
      )
    });
  }

  if (summary.overview.objective_status === "unknown") {
    return createRecommendation({
      action: "pause_for_human",
      reason:
        "The objective metric could not be matched to a concrete numeric metric key, so the run needs manual clarification before proceeding.",
      confidence: 0.86,
      autoExecutable: false,
      evidence: collectEvidence(
        summary,
        summary.overview.objective_summary,
        summary.synthesis?.confidence_statement,
        summary.synthesis?.follow_up_actions?.[0]
      )
    });
  }

  if (summary.overview.objective_status === "not_met") {
    const supportedComparison = summary.condition_comparisons.some((item) => item.hypothesis_supported === true);
    const unsupportedComparison = summary.condition_comparisons.some((item) => item.hypothesis_supported === false);
    const evidenceGap = findFailure(summary.failure_taxonomy, "evidence_gap", ["observed", "risk"]);
    const scopeLimit = findFailure(summary.failure_taxonomy, "scope_limit", ["observed", "risk"]);
    const unsupportedSummary = firstUnsupportedComparison(summary.condition_comparisons)?.summary;
    const strongHypothesisReset = Boolean(unsupportedSummary) && !evidenceGap;

    if (!supportedComparison && unsupportedComparison) {
      return createRecommendation({
        action: "backtrack_to_hypotheses",
        targetNode: "generate_hypotheses",
        reason:
          "Current experiment outcomes do not support the shortlisted hypothesis, so the loop should revisit the idea set.",
        confidence: strongHypothesisReset ? 0.9 : 0.72,
        autoExecutable: strongHypothesisReset,
        evidence: collectEvidence(
          summary,
          summary.overview.objective_summary,
          unsupportedSummary,
          summary.synthesis?.follow_up_actions?.[0]
        )
      });
    }

    return createRecommendation({
      action: "backtrack_to_design",
      targetNode: "design_experiments",
      reason:
        "The objective was not met under the current setup, so the next step is to revise the experiment design before another run.",
      confidence: evidenceGap || scopeLimit ? 0.8 : 0.76,
      autoExecutable: true,
      evidence: collectEvidence(
        summary,
        summary.overview.objective_summary,
        evidenceGap?.summary,
        scopeLimit?.summary,
        summary.synthesis?.follow_up_actions?.[0]
      )
    });
  }

  return createRecommendation({
    action: "advance",
    targetNode: "review",
    reason:
      summary.overview.objective_status === "observed"
        ? "The primary metric was observed and no blocking runtime issue remains, so the run can proceed to review before paper writing with explicit caveats."
        : "The objective is met and no blocking runtime issue remains, so the run can proceed to review before paper writing.",
    confidence: summary.synthesis?.confidence_statement
      ? summary.overview.objective_status === "observed"
        ? 0.84
        : 0.88
      : summary.overview.objective_status === "observed"
        ? 0.78
        : 0.82,
    autoExecutable: true,
    evidence: collectEvidence(
      summary,
      summary.overview.objective_summary,
      summary.synthesis?.confidence_statement,
      summary.synthesis?.discussion_points?.[0]
    )
  });
}

function createRecommendation(input: {
  action: TransitionRecommendation["action"];
  reason: string;
  confidence: number;
  autoExecutable: boolean;
  evidence: string[];
  targetNode?: TransitionRecommendation["targetNode"];
}): TransitionRecommendation {
  const suggestedCommands =
    input.action === "advance"
      ? ["/approve"]
      : input.targetNode
        ? [`/agent jump ${input.targetNode}`, `/agent run ${input.targetNode}`]
        : ["/agent status"];
  return {
    action: input.action,
    sourceNode: "analyze_results",
    targetNode: input.targetNode,
    reason: input.reason,
    confidence: Number(input.confidence.toFixed(2)),
    autoExecutable: input.autoExecutable,
    evidence: input.evidence,
    suggestedCommands,
    generatedAt: new Date().toISOString()
  };
}

function collectEvidence(summary: AnalysisReport, ...items: Array<string | undefined>): string[] {
  const evidence = new Set<string>();
  for (const item of items) {
    const value = item?.trim();
    if (value) {
      evidence.add(value);
    }
  }
  if (evidence.size === 0) {
    evidence.add(summary.overview.objective_summary);
  }
  return Array.from(evidence).slice(0, 4);
}

function findFailure(
  failures: AnalysisFailureCategory[],
  category: AnalysisFailureCategory["category"],
  statuses: AnalysisFailureCategory["status"][] = ["observed"]
): AnalysisFailureCategory | undefined {
  return failures.find((item) => item.category === category && statuses.includes(item.status));
}

function firstUnsupportedComparison(
  comparisons: AnalysisConditionComparison[]
): AnalysisConditionComparison | undefined {
  return comparisons.find((item) => item.hypothesis_supported === false);
}
