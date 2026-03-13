import path from "node:path";

import { promises as fs } from "node:fs";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { safeRead, writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { LongTermStore } from "../memory/longTermStore.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { publishPublicRunOutputs } from "../publicOutputPublisher.js";
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
      const publicDir =
        resolveMaybeRelative(
          await runContextMemory.get<string>("implement_experiments.public_dir"),
          process.cwd()
        ) || undefined;
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
      metrics = await hydrateDetailedExperimentMetrics(metrics, publicDir, inputWarnings);

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
      const supplementalMetrics = await loadSupplementalMetrics(publicDir, inputWarnings);
      const supplementalExpectation = await loadSupplementalExpectation(run.id, inputWarnings);
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
        supplementalExpectation,
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
      const resultAnalysisPath = await writeRunArtifact(run, "result_analysis.json", JSON.stringify(summary, null, 2));
      let synthesisPath: string | undefined;
      if (summary.synthesis) {
        synthesisPath = await writeRunArtifact(
          run,
          "result_analysis_synthesis.json",
          JSON.stringify(summary.synthesis, null, 2)
        );
      }
      const transitionPath = await writeRunArtifact(
        run,
        "transition_recommendation.json",
        JSON.stringify(transitionRecommendation, null, 2)
      );
      const figureSvg = renderPerformanceFigureSvg(summary);
      let performanceFigurePath: string | undefined;
      if (figureSvg) {
        performanceFigurePath = await writeRunArtifact(run, "figures/performance.svg", figureSvg);
      }
      const publicOutputs = await publishPublicRunOutputs({
        workspaceRoot: process.cwd(),
        run,
        runContext: runContextMemory,
        section: "analysis",
        files: [
          {
            sourcePath: resultAnalysisPath,
            targetRelativePath: "result_analysis.json"
          },
          {
            sourcePath: synthesisPath || path.join(process.cwd(), ".autolabos", "runs", run.id, "result_analysis_synthesis.json"),
            targetRelativePath: "result_analysis_synthesis.json",
            optional: true
          },
          {
            sourcePath: transitionPath,
            targetRelativePath: "transition_recommendation.json"
          },
          {
            sourcePath: performanceFigurePath || path.join(process.cwd(), ".autolabos", "runs", run.id, "figures", "performance.svg"),
            targetRelativePath: "figures/performance.svg",
            optional: true
          }
        ]
      });
      deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "analyze_results",
        payload: {
          text: `Public analysis outputs are available at ${publicOutputs.sectionDirRelative}.`
        }
      });
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
        summary: `${buildAnalyzeResultsCompletionSummary(summary)} Panel-calibrated transition confidence: ${transitionRecommendation.confidence}. Public outputs: ${publicOutputs.outputRootRelative}.`,
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

async function loadSupplementalExpectation(
  runId: string,
  warnings: string[]
): Promise<
  | {
      applicable: boolean;
      profiles: string[];
      reason?: string;
    }
  | undefined
> {
  const explicitExpectation = await readJsonObject<{
    applicable?: boolean;
    profiles?: string[];
    reason?: string;
  }>(
    path.join(".autolabos", "runs", runId, "run_experiments_supplemental_expectation.json"),
    warnings,
    "run_experiments_supplemental_expectation.json"
  );
  if (explicitExpectation) {
    return {
      applicable: explicitExpectation.applicable !== false,
      profiles: asArray(explicitExpectation.profiles)
        .map((item) => asString(item))
        .filter((item): item is string => Boolean(item)),
      reason: asString(explicitExpectation.reason)
    };
  }

  const executionPlan = await readJsonObject<Record<string, unknown>>(
    path.join(".autolabos", "runs", runId, "run_experiments_panel", "execution_plan.json"),
    warnings,
    "execution_plan.json"
  );
  if (!executionPlan) {
    return undefined;
  }

  const managedProfiles = asArray(executionPlan.managed_supplemental_profiles)
    .map((item) => asRecord(item))
    .map((item) => asString(item.profile))
    .filter((item): item is string => Boolean(item));

  if (managedProfiles.length > 0) {
    return {
      applicable: true,
      profiles: managedProfiles,
      reason: `Managed supplemental profiles were configured for this runner: ${managedProfiles.join(", ")}.`
    };
  }

  return {
    applicable: false,
    profiles: [],
    reason:
      "Managed quick_check and confirmatory profiles were not configured for this experiment runner, so the repeated standard trials are the complete executed design."
  };
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

async function hydrateDetailedExperimentMetrics(
  metrics: Record<string, unknown>,
  publicDir: string | undefined,
  warnings: string[]
): Promise<Record<string, unknown>> {
  if (Object.keys(metrics).length === 0) {
    return metrics;
  }

  const resultsPath = resolveDetailedResultsPath(metrics, publicDir);
  if (!resultsPath) {
    return aliasCompactMetrics(metrics);
  }

  const detailedResults = await readJsonObject<Record<string, unknown>>(
    resultsPath,
    warnings,
    path.basename(resultsPath) || "latest_results.json"
  );
  if (!detailedResults) {
    return aliasCompactMetrics(metrics);
  }

  return enrichMetricsWithDetailedResults(aliasCompactMetrics(metrics), detailedResults);
}

function resolveDetailedResultsPath(
  metrics: Record<string, unknown>,
  publicDir: string | undefined
): string | undefined {
  const explicit = resolveMaybeRelative(asString(metrics.results_path), publicDir || process.cwd());
  if (explicit) {
    return explicit;
  }
  if (!publicDir) {
    return undefined;
  }
  return path.join(publicDir, "latest_results.json");
}

function aliasCompactMetrics(metrics: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...metrics };
  const metricAlias = asString(metrics.metric);
  const metricValue = asNumber(metrics.value);
  if (metricAlias && typeof metricValue === "number" && next[metricAlias] === undefined) {
    next[metricAlias] = metricValue;
  }
  if (typeof metricValue === "number" && next.macro_f1_delta_vs_logreg === undefined) {
    if (metricAlias === "macro_f1_improvement_over_logreg" || metricAlias === "macro_f1_delta_vs_logreg") {
      next.macro_f1_delta_vs_logreg = metricValue;
    }
  }
  const logregBaseline = asNumber(metrics.mean_logreg_nested_test_macro_f1);
  if (typeof logregBaseline === "number" && next.logreg_test_macro_f1 === undefined) {
    next.logreg_test_macro_f1 = logregBaseline;
  }
  const rankStability = asNumber(metrics.mean_nested_rank_stability);
  if (typeof rankStability === "number" && next.rank_stability === undefined) {
    next.rank_stability = rankStability;
  }
  return next;
}

function enrichMetricsWithDetailedResults(
  metrics: Record<string, unknown>,
  detailedResults: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...metrics };
  const globalMetrics = asRecord(detailedResults.global_metrics);
  const protocol = asRecord(detailedResults.protocol);
  for (const [key, value] of Object.entries(globalMetrics)) {
    if (isScalarJsonValue(value) && next[key] === undefined) {
      next[key] = value;
    }
  }
  if (typeof protocol.cpu_only === "boolean" && next.cpu_only === undefined) {
    next.cpu_only = protocol.cpu_only;
  }

  const meanImprovement = asNumber(globalMetrics.mean_macro_f1_improvement_over_logreg);
  if (typeof meanImprovement === "number") {
    if (next.mean_macro_f1_improvement_over_logreg === undefined) {
      next.mean_macro_f1_improvement_over_logreg = meanImprovement;
    }
    if (next.macro_f1_delta_vs_logreg === undefined) {
      next.macro_f1_delta_vs_logreg = meanImprovement;
    }
  }

  const logregBaseline = asNumber(globalMetrics.mean_logreg_nested_test_macro_f1);
  if (typeof logregBaseline === "number" && next.logreg_test_macro_f1 === undefined) {
    next.logreg_test_macro_f1 = logregBaseline;
  }

  const rankStability = asNumber(globalMetrics.mean_nested_rank_stability);
  if (typeof rankStability === "number" && next.rank_stability === undefined) {
    next.rank_stability = rankStability;
  }

  const derived = deriveWorkflowAnalysisMetrics(detailedResults);
  if (Object.keys(derived.conditionMetrics).length > 0) {
    next.condition_metrics = {
      ...asRecord(next.condition_metrics),
      ...derived.conditionMetrics
    };
  }
  if (Object.keys(derived.samplingProfile).length > 0) {
    next.sampling_profile = {
      ...asRecord(next.sampling_profile),
      ...derived.samplingProfile
    };
  }
  if (derived.primaryCondition && !asString(next.primary_condition)) {
    next.primary_condition = derived.primaryCondition;
  }
  if (derived.baselineCondition && !asString(next.baseline_condition)) {
    next.baseline_condition = derived.baselineCondition;
  }
  if (next.reproducible === undefined && typeof asNumber(asRecord(next.sampling_profile).executed_trials) === "number") {
    next.reproducible = asNumber(asRecord(next.sampling_profile).executed_trials)! > 1;
  }

  return next;
}

function deriveWorkflowAnalysisMetrics(detailedResults: Record<string, unknown>): {
  samplingProfile: Record<string, unknown>;
  conditionMetrics: Record<string, Record<string, unknown>>;
  primaryCondition?: string;
  baselineCondition?: string;
} {
  const protocol = asRecord(detailedResults.protocol);
  const datasetSummaries = asArray(detailedResults.dataset_summaries).map((item) => asRecord(item));
  const repeatRecords = asArray(detailedResults.repeat_records).map((item) => asRecord(item));
  const workflowsFromProtocol = asStringArray(protocol.workflows);
  const workflowNames = workflowsFromProtocol.length > 0
    ? workflowsFromProtocol
    : uniqueStrings(
        datasetSummaries.flatMap((entry) => Object.keys(asRecord(entry.workflows)))
      );

  if (workflowNames.length === 0) {
    return deriveModelConditionAnalysisMetrics(detailedResults, datasetSummaries, protocol);
  }

  const conditionMetrics: Record<string, Record<string, unknown>> = {};
  const perRepeatByWorkflow = new Map<string, Array<Record<string, number>>>();
  for (const workflow of workflowNames) {
    const aggregate = aggregateWorkflowDatasetSummaries(datasetSummaries, workflow);
    if (Object.keys(aggregate).length > 0) {
      conditionMetrics[workflow] = aggregate;
    }
    const perRepeat = aggregateWorkflowRepeatRecords(repeatRecords, workflow);
    if (perRepeat.length > 0) {
      perRepeatByWorkflow.set(workflow, perRepeat);
      const target = conditionMetrics[workflow] || {};
      applyRepeatConfidenceIntervals(target, perRepeat, [
        "best_mean_test_macro_f1",
        "macro_f1_delta_vs_logreg",
        "mean_selection_optimism"
      ]);
      conditionMetrics[workflow] = target;
    }
  }

  const totalTrials = asNumber(protocol.repeats) ?? (repeatRecords.length > 0 ? repeatRecords.length : undefined);
  const executedTrials = repeatRecords.length > 0 ? repeatRecords.length : undefined;
  const samplingProfile: Record<string, unknown> = {};
  if (typeof totalTrials === "number") {
    samplingProfile.total_trials = totalTrials;
    samplingProfile.name = "standard";
  }
  if (typeof executedTrials === "number") {
    samplingProfile.executed_trials = executedTrials;
  }
  if (typeof totalTrials === "number" && typeof executedTrials === "number") {
    samplingProfile.cached_trials = Math.max(0, totalTrials - executedTrials);
  }

  const primaryCondition =
    asString(asRecord(detailedResults.global_metrics).best_workflow) ||
    pickBestWorkflow(conditionMetrics);
  const baselineCondition =
    workflowNames.find((workflow) => workflow !== primaryCondition) ||
    undefined;

  return {
    samplingProfile,
    conditionMetrics,
    primaryCondition,
    baselineCondition
  };
}

function deriveModelConditionAnalysisMetrics(
  detailedResults: Record<string, unknown>,
  datasetSummaries: Array<Record<string, unknown>>,
  protocol: Record<string, unknown>
): {
  samplingProfile: Record<string, unknown>;
  conditionMetrics: Record<string, Record<string, unknown>>;
  primaryCondition?: string;
  baselineCondition?: string;
} {
  const modelNames = uniqueStrings(
    datasetSummaries.flatMap((entry) => Object.keys(asRecord(entry.models)))
  );
  const conditionMetrics: Record<string, Record<string, unknown>> = {};

  for (const model of modelNames) {
    const aggregate = aggregateModelDatasetSummaries(datasetSummaries, model);
    if (Object.keys(aggregate).length > 0) {
      conditionMetrics[model] = aggregate;
    }
    const perSeed = aggregateModelSeedRecords(datasetSummaries, model);
    if (perSeed.length > 0) {
      const target = conditionMetrics[model] || {};
      applyRepeatConfidenceIntervals(target, perSeed, [
        "best_mean_test_macro_f1",
        "macro_f1_delta_vs_logreg",
        "runtime_seconds_mean"
      ]);
      conditionMetrics[model] = target;
    }
  }

  const maxSeedCount = datasetSummaries.reduce((max, entry) => {
    const count = asArray(entry.seed_records).length;
    return count > max ? count : max;
  }, 0);
  const totalTrials = asNumber(protocol.repeats) ?? (maxSeedCount > 0 ? maxSeedCount : undefined);
  const executedTrials = maxSeedCount > 0 ? maxSeedCount : undefined;
  const samplingProfile: Record<string, unknown> = {};
  if (typeof totalTrials === "number") {
    samplingProfile.total_trials = totalTrials;
    samplingProfile.name = "standard";
  }
  if (typeof executedTrials === "number") {
    samplingProfile.executed_trials = executedTrials;
  }
  if (typeof totalTrials === "number" && typeof executedTrials === "number") {
    samplingProfile.cached_trials = Math.max(0, totalTrials - executedTrials);
  }

  const globalMetrics = asRecord(detailedResults.global_metrics);
  const primaryCondition = asString(globalMetrics.best_model) || pickBestWorkflow(conditionMetrics);
  const baselineCondition =
    modelNames.find((name) => /logreg|logistic/iu.test(name) && name !== primaryCondition) ||
    modelNames.find((name) => name !== primaryCondition) ||
    undefined;

  return {
    samplingProfile,
    conditionMetrics,
    primaryCondition,
    baselineCondition
  };
}

function aggregateWorkflowDatasetSummaries(
  datasetSummaries: Array<Record<string, unknown>>,
  workflow: string
): Record<string, unknown> {
  const bestScores: number[] = [];
  const deltas: number[] = [];
  const optimisms: number[] = [];
  const agreements: number[] = [];
  const winnerConsistency: number[] = [];
  const signConsistency: number[] = [];
  const runtimes: number[] = [];
  const memories: number[] = [];

  for (const datasetEntry of datasetSummaries) {
    const workflowEntry = asRecord(asRecord(datasetEntry.workflows)[workflow]);
    if (Object.keys(workflowEntry).length === 0) {
      continue;
    }
    const modelSummary = summarizeWorkflowModelAggregate(asRecord(workflowEntry.models), "mean_test_macro_f1");
    if (typeof modelSummary.bestScore === "number") {
      bestScores.push(modelSummary.bestScore);
    }
    if (typeof modelSummary.deltaVsLogreg === "number") {
      deltas.push(modelSummary.deltaVsLogreg);
    }
    if (typeof modelSummary.selectionOptimism === "number") {
      optimisms.push(modelSummary.selectionOptimism);
    }
    if (typeof modelSummary.signConsistencyVsLogreg === "number") {
      signConsistency.push(modelSummary.signConsistencyVsLogreg);
    }
    pushNumber(agreements, workflowEntry.pairwise_ranking_agreement);
    pushNumber(winnerConsistency, workflowEntry.winner_consistency);
    pushNumber(runtimes, workflowEntry.runtime_seconds_mean);
    pushNumber(memories, workflowEntry.peak_memory_mb_mean);
  }

  return compactRecord({
    best_mean_test_macro_f1: mean(bestScores),
    mean_test_macro_f1: mean(bestScores),
    macro_f1_delta_vs_logreg: mean(deltas),
    mean_macro_f1_improvement_over_logreg: mean(deltas),
    mean_selection_optimism: mean(optimisms),
    pairwise_ranking_agreement: mean(agreements),
    winner_consistency: mean(winnerConsistency),
    sign_consistency_vs_logreg: mean(signConsistency),
    runtime_seconds_mean: mean(runtimes),
    peak_memory_mb_mean: mean(memories)
  });
}

function aggregateWorkflowRepeatRecords(
  repeatRecords: Array<Record<string, unknown>>,
  workflow: string
): Array<Record<string, number>> {
  return repeatRecords
    .map((entry) => {
      const datasets = asArray(entry.datasets).map((item) => asRecord(item));
      const bestScores: number[] = [];
      const deltas: number[] = [];
      const optimisms: number[] = [];

      for (const dataset of datasets) {
        const workflowEntry = asRecord(asRecord(dataset.workflows)[workflow]);
        if (Object.keys(workflowEntry).length === 0) {
          continue;
        }
        const modelSummary = summarizeWorkflowModelAggregate(asRecord(workflowEntry.models), "test_macro_f1");
        if (typeof modelSummary.bestScore === "number") {
          bestScores.push(modelSummary.bestScore);
        }
        if (typeof modelSummary.deltaVsLogreg === "number") {
          deltas.push(modelSummary.deltaVsLogreg);
        }
        if (typeof modelSummary.selectionOptimism === "number") {
          optimisms.push(modelSummary.selectionOptimism);
        }
      }

      return compactNumericRecord({
        best_mean_test_macro_f1: mean(bestScores),
        macro_f1_delta_vs_logreg: mean(deltas),
        mean_selection_optimism: mean(optimisms)
      });
    })
    .filter((entry) => Object.keys(entry).length > 0);
}

function aggregateModelDatasetSummaries(
  datasetSummaries: Array<Record<string, unknown>>,
  model: string
): Record<string, unknown> {
  const scores: number[] = [];
  const deltas: number[] = [];
  const runtimes: number[] = [];
  const memories: number[] = [];
  const variances: number[] = [];
  const stabilities: number[] = [];
  const sensitivities: number[] = [];

  for (const datasetEntry of datasetSummaries) {
    const modelEntry = asRecord(asRecord(datasetEntry.models)[model]);
    if (Object.keys(modelEntry).length === 0) {
      continue;
    }
    pushNumber(scores, modelEntry.macro_f1);
    pushNumber(deltas, modelEntry.macro_f1_delta_vs_logreg);
    pushNumber(runtimes, modelEntry.runtime_seconds);
    pushNumber(memories, modelEntry.peak_memory_mb);
    pushNumber(variances, modelEntry.run_to_run_variance);
    pushNumber(stabilities, modelEntry.fold_to_fold_stability);
    pushNumber(sensitivities, modelEntry.seed_sensitivity);
  }

  return compactRecord({
    best_mean_test_macro_f1: mean(scores),
    mean_test_macro_f1: mean(scores),
    macro_f1_delta_vs_logreg: mean(deltas),
    mean_macro_f1_improvement_over_logreg: mean(deltas),
    runtime_seconds_mean: mean(runtimes),
    peak_memory_mb_mean: mean(memories),
    run_to_run_variance: mean(variances),
    fold_to_fold_stability: mean(stabilities),
    seed_sensitivity: mean(sensitivities)
  });
}

function aggregateModelSeedRecords(
  datasetSummaries: Array<Record<string, unknown>>,
  model: string
): Array<Record<string, number>> {
  const bySeedIndex = new Map<number, {
    scores: number[];
    deltas: number[];
    runtimes: number[];
  }>();

  for (const datasetEntry of datasetSummaries) {
    const seedRecords = asArray(datasetEntry.seed_records).map((item) => asRecord(item));
    for (const [index, seedRecord] of seedRecords.entries()) {
      const modelEntry = resolveSeedModelSummary(seedRecord, model);
      if (Object.keys(modelEntry).length === 0) {
        continue;
      }
      const bucket = bySeedIndex.get(index) || { scores: [], deltas: [], runtimes: [] };
      pushNumber(bucket.scores, modelEntry.macro_f1);
      pushNumber(bucket.scores, modelEntry.mean_test_macro_f1);
      pushNumber(bucket.deltas, modelEntry.macro_f1_delta_vs_logreg);
      pushNumber(bucket.deltas, modelEntry.mean_delta_vs_logreg);
      pushNumber(bucket.runtimes, modelEntry.runtime_seconds);
      pushNumber(bucket.runtimes, modelEntry.mean_runtime_seconds);
      bySeedIndex.set(index, bucket);
    }
  }

  return [...bySeedIndex.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, bucket]) =>
      compactNumericRecord({
        best_mean_test_macro_f1: mean(bucket.scores),
        mean_test_macro_f1: mean(bucket.scores),
        macro_f1_delta_vs_logreg: mean(bucket.deltas),
        runtime_seconds_mean: mean(bucket.runtimes)
      })
    )
    .filter((entry) => Object.keys(entry).length > 0);
}

function resolveSeedModelSummary(
  seedRecord: Record<string, unknown>,
  model: string
): Record<string, unknown> {
  const direct = asRecord(asRecord(seedRecord.models)[model]);
  if (Object.keys(direct).length > 0) {
    return direct;
  }
  return asRecord(asRecord(seedRecord.model_summaries)[model]);
}

function summarizeWorkflowModelAggregate(
  models: Record<string, unknown>,
  scoreKey: "mean_test_macro_f1" | "test_macro_f1"
): {
  bestScore?: number;
  deltaVsLogreg?: number;
  selectionOptimism?: number;
  signConsistencyVsLogreg?: number;
} {
  const modelEntries = Object.entries(models)
    .map(([name, value]) => ({ name, value: asRecord(value) }))
    .filter((entry) => Object.keys(entry.value).length > 0);
  if (modelEntries.length === 0) {
    return {};
  }

  const best = modelEntries
    .map((entry) => ({
      ...entry,
      score: asNumber(entry.value[scoreKey])
    }))
    .filter((entry): entry is typeof entry & { score: number } => typeof entry.score === "number")
    .sort((left, right) => right.score - left.score)[0];
  const logreg = modelEntries.find((entry) => entry.name === "logreg")?.value;

  const bestScore = best?.score;
  const bestDelta =
    best && typeof asNumber(best.value.mean_delta_vs_logreg) === "number"
      ? asNumber(best.value.mean_delta_vs_logreg)
      : best && logreg
        ? difference(asNumber(best.value[scoreKey]), asNumber(logreg[scoreKey]))
        : undefined;

  return compactNumericRecord({
    bestScore,
    deltaVsLogreg: bestDelta,
    selectionOptimism: best ? asNumber(best.value.mean_selection_optimism) ?? asNumber(best.value.selection_optimism) : undefined,
    signConsistencyVsLogreg: best ? asNumber(best.value.sign_consistency_vs_logreg) : undefined
  });
}

function applyRepeatConfidenceIntervals(
  target: Record<string, unknown>,
  perRepeat: Array<Record<string, number>>,
  metricKeys: string[]
): void {
  for (const metricKey of metricKeys) {
    const values = perRepeat
      .map((entry) => entry[metricKey])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const ci = computeNormalApproxCi95(values);
    if (ci) {
      target[`ci95_${metricKey}`] = ci;
    }
  }
}

function pickBestWorkflow(conditionMetrics: Record<string, Record<string, unknown>>): string | undefined {
  return Object.entries(conditionMetrics)
    .map(([workflow, metrics]) => ({
      workflow,
      score: asNumber(metrics.macro_f1_delta_vs_logreg) ?? asNumber(metrics.best_mean_test_macro_f1)
    }))
    .filter((entry): entry is { workflow: string; score: number } => typeof entry.score === "number")
    .sort((left, right) => right.score - left.score)[0]?.workflow;
}

function computeNormalApproxCi95(values: number[]): [number, number] | undefined {
  if (values.length < 2) {
    return undefined;
  }
  const meanValue = mean(values);
  const sd = sampleStandardDeviation(values);
  if (typeof meanValue !== "number" || typeof sd !== "number") {
    return undefined;
  }
  const halfWidth = 1.96 * (sd / Math.sqrt(values.length));
  return [
    roundMetric(meanValue - halfWidth),
    roundMetric(meanValue + halfWidth)
  ];
}

function sampleStandardDeviation(values: number[]): number | undefined {
  if (values.length < 2) {
    return undefined;
  }
  const meanValue = mean(values);
  if (typeof meanValue !== "number") {
    return undefined;
  }
  const variance =
    values.reduce((total, value) => total + (value - meanValue) ** 2, 0) / (values.length - 1);
  return Number.isFinite(variance) ? Math.sqrt(variance) : undefined;
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return roundMetric(total / values.length);
}

function difference(left: number | undefined, right: number | undefined): number | undefined {
  if (typeof left !== "number" || typeof right !== "number") {
    return undefined;
  }
  return roundMetric(left - right);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function pushNumber(values: number[], raw: unknown): void {
  const parsed = asNumber(raw);
  if (typeof parsed === "number") {
    values.push(parsed);
  }
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function compactNumericRecord(value: Record<string, number | undefined>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => typeof entry === "number" && Number.isFinite(entry))
  ) as Record<string, number>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value)
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item));
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isScalarJsonValue(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
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

  const executedTrials = summary.statistical_summary.executed_trials;
  const cachedTrials = summary.statistical_summary.cached_trials ?? 0;
  if (
    (summary.overview.objective_status === "met" || summary.overview.objective_status === "observed") &&
    executedTrials === 0 &&
    cachedTrials > 0
  ) {
    return createRecommendation({
      action: "backtrack_to_implement",
      targetNode: "implement_experiments",
      reason:
        "The metric snapshot was rebuilt entirely from cached trials, so the run should rerun implementation/execution and persist fresh trial records before review.",
      confidence: 0.94,
      autoExecutable: true,
      evidence: collectEvidence(
        summary,
        summary.overview.objective_summary,
        `Sampling profile recorded executed_trials=0 and cached_trials=${cachedTrials}.`,
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
