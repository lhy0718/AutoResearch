import path from "node:path";

import { promises as fs } from "node:fs";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { safeRead, writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { LongTermStore } from "../memory/longTermStore.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { publishPublicRunOutputs } from "../publicOutputPublisher.js";
import {
  buildOperatorHistoryRelativePath,
  renderOperatorHistoryMarkdown,
  renderOperatorSummaryMarkdown
} from "../operatorSummary.js";
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
import { ExperimentPortfolio, ExperimentRunManifest } from "../experiments/experimentPortfolio.js";
import type { ExperimentContract } from "../experiments/experimentContract.js";
import { GraphNodeId, TransitionRecommendation } from "../../types.js";
import { runAnalyzeResultsPanel } from "../analyzeResultsPanel.js";
import {
  clearPendingHumanInterventionRequest,
  createHumanInterventionRequest,
  HumanInterventionRequest,
  readPendingHumanInterventionRequest,
  writeHumanInterventionRequest
} from "../humanIntervention.js";
import { loadExperimentContract } from "../experiments/experimentContract.js";
import {
  deriveGovernedAnalysisDecision,
  ExperimentComparisonContract,
  getGovernedObjectiveProfile,
  loadExperimentComparisonContract,
  loadExperimentImplementationContext,
  loadExperimentManagedBundleLock,
  storeExperimentGovernanceDecision,
  validateManagedBundleLock
} from "../experimentGovernance.js";
import {
  buildAttemptDecision,
  writeAttemptDecision,
  type AttemptDecisionVerdict
} from "../experiments/attemptDecision.js";
import { evaluateBriefEvidenceAgainstResults } from "../analysis/briefEvidenceValidator.js";
import { parseMarkdownRunBriefSections } from "../runs/runBriefParser.js";
import { buildRunOperatorStatus } from "../runs/runStatus.js";
import { buildRunCompletenessChecklist } from "../runs/runCompletenessChecklist.js";
import {
  hasAnyIncompleteResultsTableRow,
  type ResultsTableDirection,
  type ResultsTableSchema,
  validateResultsTableSchema
} from "../analysis/resultsTableSchema.js";
import {
  detectNaNInf,
  detectStatisticalAnomaly,
  detectUnverifiedCitations,
  type RiskSignal
} from "../analysis/riskSignals.js";

export function createAnalyzeResultsNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "analyze_results",
    async execute({ run }) {
      const longTermStore = new LongTermStore(run.memoryRefs.longTermPath);
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      const comparisonContract = await loadExperimentComparisonContract(run, runContextMemory);
      const experimentContract = await loadExperimentContract(run.id);
      const implementationContext = await loadExperimentImplementationContext(run, runContextMemory);
      const managedBundleLock = await loadExperimentManagedBundleLock(run, runContextMemory);
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
      const latestResultsPath = await buildLatestResultsFromCsvArtifact(metrics, run.id, inputWarnings);
      const managedBundleValidation = await validateManagedBundleLock({
        contract: comparisonContract,
        managedBundleLock,
        implementationContext,
        metrics,
        publicDir,
        workspaceRoot: process.cwd()
      });
      if (managedBundleValidation) {
        await storeExperimentGovernanceDecision(run, runContextMemory, {
          driftReport: managedBundleValidation.report,
          entries: []
        });
      }
      if (managedBundleValidation && !managedBundleValidation.ok) {
        inputWarnings.push(managedBundleValidation.rationale);
      } else if (
        managedBundleValidation?.report.findings.some((finding) => finding.severity === "warn")
      ) {
        inputWarnings.push(managedBundleValidation.report.summary);
      }

      const manualObjectiveClarification =
        (await runContextMemory.get<string>("analyze_results.objective_clarification"))?.trim() || undefined;
      const lockedObjectiveProfile = getGovernedObjectiveProfile(comparisonContract, run.objectiveMetric);
      if (lockedObjectiveProfile && manualObjectiveClarification) {
        inputWarnings.push(
          "Ignored analyze_results.objective_clarification because a locked experiment evaluator contract is active."
        );
      }
      const effectiveObjectiveMetric =
        lockedObjectiveProfile ? run.objectiveMetric : manualObjectiveClarification || run.objectiveMetric;
      const objectiveProfileBase =
        lockedObjectiveProfile ||
        (await resolveObjectiveMetricProfile({
          run: {
            ...run,
            objectiveMetric: effectiveObjectiveMetric
          },
          runContextMemory,
          llm: deps.llm,
          eventStream: deps.eventStream,
          node: "analyze_results"
        }));
      const objectiveProfile =
        !lockedObjectiveProfile && manualObjectiveClarification
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
      // Always re-evaluate in analyze_results: the metrics here are enriched
      // with AOCS-derived condition_metrics and top-level aggregates that
      // run_experiments did not have, so the cached metric match may be stale.
      const objectiveEvaluation = evaluateObjectiveMetric(metrics, objectiveProfile, effectiveObjectiveMetric);
      if (
        !cachedEvaluation ||
        cachedEvaluation.status !== objectiveEvaluation.status ||
        cachedEvaluation.matchedMetricKey !== objectiveEvaluation.matchedMetricKey
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
      const experimentPortfolio =
        (await readJsonObject<ExperimentPortfolio>(
          path.join(".autolabos", "runs", run.id, "experiment_portfolio.json"),
          inputWarnings,
          "experiment_portfolio.json"
        )) || undefined;
      const runManifest =
        (await readJsonObject<ExperimentRunManifest>(
          path.join(".autolabos", "runs", run.id, "run_manifest.json"),
          inputWarnings,
          "run_manifest.json"
        )) || undefined;
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
        experimentPortfolio,
        runManifest,
        supplementalMetrics,
        supplementalExpectation,
        recentPaperComparison,
        recentPaperComparisonPath
      });
      const resultsTableValidation = buildResultsTableValidation({
        report: summary,
        experimentContract
      });
      summary.results_table = resultsTableValidation.rows;
      if (!resultsTableValidation.valid) {
        inputWarnings.push(...resultsTableValidation.issues);
        summary.warnings = [...summary.warnings, ...resultsTableValidation.issues];
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "analyze_results",
          payload: {
            text: `Results table validation: ${resultsTableValidation.issues.join(" ")}`
          }
        });
      }
      const evidenceStore = await readJsonlRecords(path.join(".autolabos", "runs", run.id, "evidence_store.jsonl"));
      const riskSignals = [
        detectNaNInf(metrics),
        detectStatisticalAnomaly(metrics),
        detectUnverifiedCitations(evidenceStore)
      ].filter((signal): signal is RiskSignal => Boolean(signal));
      if (riskSignals.length > 0) {
        const riskWarnings = riskSignals.map((signal) => signal.detail);
        inputWarnings.push(...riskWarnings);
        summary.warnings = [...summary.warnings, ...riskWarnings];
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "analyze_results",
          payload: {
            text: `Risk signals detected: ${riskWarnings.join(" ")}`
          }
        });
      }
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
      const rawBrief = await runContextMemory.get<string>("run_brief.raw");
      const briefSections = rawBrief ? parseMarkdownRunBriefSections(rawBrief) : undefined;
      const briefEvidenceAssessment = evaluateBriefEvidenceAgainstResults({
        briefSections: briefSections ?? undefined,
        report: summary
      });
      if (briefEvidenceAssessment.enabled && briefEvidenceAssessment.status === "fail") {
        inputWarnings.push(briefEvidenceAssessment.summary);
        summary.warnings = [...summary.warnings, briefEvidenceAssessment.summary];
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "analyze_results",
          payload: {
            text: `Brief evidence gate: ${briefEvidenceAssessment.summary}`
          }
        });
      }
      const evidenceAssessmentPath = await writeRunArtifact(
        run,
        "analysis/evidence_scale_assessment.json",
        `${JSON.stringify(briefEvidenceAssessment, null, 2)}\n`
      );
      await runContextMemory.put("analyze_results.brief_evidence_assessment", briefEvidenceAssessment);
      const governanceDecision =
        comparisonContract &&
        deriveGovernedAnalysisDecision({
          report: summary,
          contract: comparisonContract,
          implementationContext,
          managedBundleValidation
        });
      if (governanceDecision) {
        await storeExperimentGovernanceDecision(run, runContextMemory, {
          baselineSnapshot: governanceDecision.baselineSnapshot,
          entries: governanceDecision.baselineEntry
            ? [governanceDecision.baselineEntry, governanceDecision.candidateEntry]
            : [governanceDecision.candidateEntry]
        });
      }
      const baselineTransitionRecommendation = buildTransitionRecommendation(summary);
      const governedTransitionRecommendation = applyGovernanceTransitionOverride(
        baselineTransitionRecommendation,
        governanceDecision,
        summary,
        comparisonContract
      );
      const gatedTransitionRecommendation = applyBriefEvidenceTransitionOverride(
        governedTransitionRecommendation,
        briefEvidenceAssessment,
        summary
      );
      const panelResult = runAnalyzeResultsPanel({
        report: summary,
        baselineRecommendation: gatedTransitionRecommendation
      });
      const transitionRecommendation = applyRiskSignalTransitionOverride(
        applyResultsTableTransitionOverride(
          panelResult.recommendation,
          resultsTableValidation,
          summary
        ),
        riskSignals,
        summary
      );
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
      const riskSignalsPath = await writeRunArtifact(
        run,
        "analysis/risk_signals.json",
        `${JSON.stringify(riskSignals, null, 2)}\n`
      );
      const resultAnalysisPath = await writeRunArtifact(run, "result_analysis.json", JSON.stringify(summary, null, 2));

      // --- Standalone result table artifact (for review gate) ---
      const resultTable = buildResultTable(summary);
      await writeRunArtifact(
        run,
        "result_table.json",
        `${JSON.stringify(resultTable, null, 2)}\n`
      );

      // --- Attempt decision artifact (Target 4) ---
      const attemptNumber = (run.graph.retryCounters.analyze_results ?? 0) + 1;
      const objectiveStatus = summary.overview?.objective_status;
      const metricImproved = objectiveStatus === "met";
      const verdict: AttemptDecisionVerdict =
        objectiveStatus === "met"
          ? "keep"
          : objectiveStatus === "not_met"
            ? (summary.failure_taxonomy ?? []).some((f) => f.category === "evidence_gap" || f.category === "scope_limit")
              ? "needs_design_revision"
              : "discard"
            : "needs_replication";
      const attemptDecision = buildAttemptDecision({
        runId: run.id,
        attempt: attemptNumber,
        verdict,
        rationale: summary.overview?.objective_summary || "No objective summary available.",
        evidenceRefs: [resultAnalysisPath],
        metricName: run.objectiveMetric,
        metricImproved,
        discardReason: verdict === "discard"
          ? `Objective metric ${run.objectiveMetric} not met: ${summary.overview?.objective_summary || "unknown"}.`
          : undefined,
        designRevisionNote: verdict === "needs_design_revision"
          ? `Evidence or scope gaps detected: ${(summary.failure_taxonomy ?? []).map((f) => f.category).join(", ")}.`
          : undefined,
        replicationNote: verdict === "needs_replication"
          ? "Objective status unknown; replication needed to confirm."
          : undefined
      });
      await writeAttemptDecision(run, attemptDecision);

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
      const operatorSummaryInput = {
        runId: run.id,
        title: run.title,
        stage: "analysis" as const,
        summary: [
          buildAnalyzeResultsCompletionSummary(summary),
          `Next governed gate: ${transitionRecommendation.targetNode || "review"} via ${transitionRecommendation.action}.`
        ],
        decision: `Transition recommendation: ${transitionRecommendation.action}${transitionRecommendation.targetNode ? ` -> ${transitionRecommendation.targetNode}` : ""}. ${transitionRecommendation.reason}`,
        blockers: (summary.failure_taxonomy || []).slice(0, 3).map((item) => item.summary),
        openQuestions: (summary.synthesis?.discussion_points || []).slice(0, 3),
        nextActions:
          (summary.synthesis?.follow_up_actions || []).slice(0, 3).length > 0
            ? (summary.synthesis?.follow_up_actions || []).slice(0, 3)
            : [transitionRecommendation.reason, "Enter review and inspect the review packet before treating the run as paper-ready."],
        references: [
          { label: "Analysis report", path: "result_analysis.json" },
          { label: "Transition recommendation", path: "transition_recommendation.json" },
          { label: "Latest results", path: "latest_results.json" },
          { label: "Risk signals", path: "analysis/risk_signals.json" }
        ]
      };
      const operatorSummaryPath = await writeRunArtifact(
        run,
        "operator_summary.md",
        renderOperatorSummaryMarkdown(operatorSummaryInput)
      );
      const operatorHistoryPath = await writeRunArtifact(
        run,
        buildOperatorHistoryRelativePath("analysis"),
        renderOperatorHistoryMarkdown(operatorSummaryInput)
      );
      const runStatus = await buildRunOperatorStatus({
        workspaceRoot: process.cwd(),
        run,
        currentNode: "analyze_results",
        approvalMode: deps.config?.workflow?.approval_mode || "minimal",
        networkPolicy:
          deps.config?.experiments?.network_policy
          || (deps.config?.experiments?.allow_network ? "declared" : "blocked"),
        networkPurpose: deps.config?.experiments?.network_purpose
      });
      const runStatusPath = await writeRunArtifact(
        run,
        "run_status.json",
        `${JSON.stringify(runStatus, null, 2)}\n`
      );
      const figureSvg = renderPerformanceFigureSvg(summary);
      let performanceFigurePath: string | undefined;
      if (figureSvg) {
        performanceFigurePath = await writeRunArtifact(run, "figures/performance.svg", figureSvg);
      }
      const publicOutputs = await publishPublicRunOutputs({
        workspaceRoot: process.cwd(),
        run,
        node: "analyze_results",
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
          },
          ...(latestResultsPath
            ? [
                {
                  sourcePath: latestResultsPath,
                  targetRelativePath: "latest_results.json"
                }
              ]
            : []),
          {
            sourcePath: path.join(process.cwd(), ".autolabos", "runs", run.id, "result_table.json"),
            targetRelativePath: "result_table.json",
            optional: true
          },
          {
            sourcePath: path.join(process.cwd(), ".autolabos", "runs", run.id, "baseline_summary.json"),
            targetRelativePath: "baseline_summary.json",
            optional: true
          },
          {
            sourcePath: evidenceAssessmentPath,
            targetRelativePath: "evidence_scale_assessment.json",
            optional: true
          },
          {
            sourcePath: riskSignalsPath,
            targetRelativePath: "risk_signals.json",
            optional: true
          }
        ]
      });
      await publishPublicRunOutputs({
        workspaceRoot: process.cwd(),
        run,
        node: "analyze_results",
        section: "results",
        files: [
          {
            sourcePath: operatorSummaryPath,
            targetRelativePath: "operator_summary.md"
          },
          {
            sourcePath: operatorHistoryPath,
            targetRelativePath: buildOperatorHistoryRelativePath("analysis")
          },
          {
            sourcePath: runStatusPath,
            targetRelativePath: "run_status.json"
          }
        ]
      });
      const completenessChecklist = await buildRunCompletenessChecklist({
        workspaceRoot: process.cwd(),
        run,
        currentNode: "analyze_results"
      });
      const completenessChecklistPath = await writeRunArtifact(
        run,
        "run_completeness_checklist.json",
        `${JSON.stringify(completenessChecklist, null, 2)}\n`
      );
      await publishPublicRunOutputs({
        workspaceRoot: process.cwd(),
        run,
        node: "analyze_results",
        section: "results",
        files: [
          {
            sourcePath: completenessChecklistPath,
            targetRelativePath: "run_completeness_checklist.json"
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
      await runContextMemory.put("analyze_results.risk_signals", riskSignals);
      await runContextMemory.put("analyze_results.experiment_portfolio", summary.experiment_portfolio || null);
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
      warnings.push(`Failed to parse ${label}: ${message}`);
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
    const aliased = aliasCompactMetrics(metrics);
    return deriveConditionMetricsFromAOCSIfNeeded(aliased);
  }

  const detailedResults = await readJsonObject<Record<string, unknown>>(
    resultsPath,
    warnings,
    path.basename(resultsPath) || "latest_results.json"
  );
  if (!detailedResults) {
    const aliased = aliasCompactMetrics(metrics);
    return deriveConditionMetricsFromAOCSIfNeeded(aliased);
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
  // Fallback: derive condition_metrics from aggregate_overall_condition_summary
  // when the standard derivation produced nothing but the experiment left an AOCS array.
  if (Object.keys(asRecord(next.condition_metrics)).length === 0) {
    const aocs = asArray(next.aggregate_overall_condition_summary);
    const fallback = deriveConditionMetricsFromAOCS(aocs);
    if (Object.keys(fallback.conditionMetrics).length >= 2) {
      next.condition_metrics = fallback.conditionMetrics;
      if (fallback.primaryCondition && !asString(next.primary_condition)) {
        derived.primaryCondition = fallback.primaryCondition;
      }
      if (fallback.baselineCondition && !asString(next.baseline_condition)) {
        derived.baselineCondition = fallback.baselineCondition;
      }
    }
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

/**
 * Derives condition_metrics from aggregate_overall_condition_summary (AOCS).
 * AOCS is an array of objects where each entry has a model_family + calibration combo
 * and associated metric values. We convert to the condition_metrics dict format
 * expected by the governance baseline comparison contract.
 */

/**
 * Applies AOCS→condition_metrics fallback to a metrics object when condition_metrics
 * is absent but aggregate_overall_condition_summary is present.
 */
function deriveConditionMetricsFromAOCSIfNeeded(
  metrics: Record<string, unknown>
): Record<string, unknown> {
  if (Object.keys(asRecord(metrics.condition_metrics)).length > 0) {
    return metrics;
  }
  const aocs = asArray(metrics.aggregate_overall_condition_summary);
  if (aocs.length === 0) {
    return metrics;
  }
  const fallback = deriveConditionMetricsFromAOCS(aocs);
  if (Object.keys(fallback.conditionMetrics).length < 2) {
    return metrics;
  }
  const next = { ...metrics };
  next.condition_metrics = fallback.conditionMetrics;
  if (fallback.primaryCondition) {
    next.primary_condition = fallback.primaryCondition;
  }
  if (fallback.baselineCondition) {
    next.baseline_condition = fallback.baselineCondition;
  }
  // Surface primary condition's key metrics as top-level scalars so the
  // objective metric resolver can find e.g. macro_f1 before rank_reversal_count.
  if (fallback.primaryCondition) {
    const primary = fallback.conditionMetrics[fallback.primaryCondition];
    if (primary) {
      const surfaceKeys = [
        "macro_f1", "brier_score", "ece", "ece_adaptive",
        "ece_equal_width_10", "ece_equal_frequency_10", "auroc",
        "runtime_seconds", "peak_memory_mb"
      ];
      for (const k of surfaceKeys) {
        if (typeof primary[k] === "number" && next[k] === undefined) {
          next[k] = primary[k];
        }
      }
    }
  }
  return next;
}
/** @internal exported for testing */
export function deriveConditionMetricsFromAOCS(aocs: unknown[]): {
  conditionMetrics: Record<string, Record<string, unknown>>;
  primaryCondition?: string;
  baselineCondition?: string;
} {
  const conditionMetrics: Record<string, Record<string, unknown>> = {};
  const skipKeys = new Set(["model_family", "calibration", "outer_fold_count"]);

  for (const raw of aocs) {
    const entry = raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : undefined;
    if (!entry) continue;

    const model = typeof entry.model_family === "string" ? entry.model_family : undefined;
    const cal = typeof entry.calibration === "string" ? entry.calibration : undefined;
    if (!model) continue;

    const conditionName = cal ? `${model}_${cal}` : model;
    const metrics: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (skipKeys.has(key)) continue;
      // Strip _mean suffix for metric key compatibility
      const cleanKey = key.endsWith("_mean") ? key.slice(0, -5) : key;
      metrics[cleanKey] = value;
    }
    if (Object.keys(metrics).length > 0) {
      conditionMetrics[conditionName] = metrics;
    }
  }

  // Pick primary (best macro_f1) and baseline (worst macro_f1)
  let primaryCondition: string | undefined;
  let baselineCondition: string | undefined;
  let bestF1 = -Infinity;
  let worstF1 = Infinity;
  for (const [name, m] of Object.entries(conditionMetrics)) {
    const f1 = typeof m.macro_f1 === "number" ? m.macro_f1 : undefined;
    if (f1 !== undefined) {
      if (f1 > bestF1) { bestF1 = f1; primaryCondition = name; }
      if (f1 < worstF1) { worstF1 = f1; baselineCondition = name; }
    }
  }

  return { conditionMetrics, primaryCondition, baselineCondition };
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

async function readJsonlRecords(filePath: string): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return [];
          }
          return [parsed as Record<string, unknown>];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
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
    if (isDeferredFullCycleObjective(summary)) {
      const objectiveMetrics = asRecord(summary.metrics.metrics);
      const objectiveNotes = asRecord(objectiveMetrics.notes);
      return createRecommendation({
        action: "advance",
        targetNode: "review",
        reason:
          "The objective metric is lifecycle-terminal and still provisional at analyze_results, so the run should continue into review/write_paper before deciding another implementation loop.",
        confidence: 0.74,
        autoExecutable: true,
        evidence: collectEvidence(
          summary,
          summary.overview.objective_summary,
          asString(objectiveNotes.full_cycle_completed),
          summary.synthesis?.follow_up_actions?.[0]
        )
      });
    }
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

function applyBriefEvidenceTransitionOverride(
  recommendation: TransitionRecommendation,
  assessment: ReturnType<typeof evaluateBriefEvidenceAgainstResults>,
  summary: AnalysisReport
): TransitionRecommendation {
  if (!assessment.enabled || assessment.status !== "fail") {
    return recommendation;
  }
  return createRecommendation({
    action: "backtrack_to_design",
    targetNode: "design_experiments",
    reason: `Brief minimum evidence gate failed: ${assessment.summary}`,
    confidence: 0.92,
    autoExecutable: true,
    evidence: collectEvidence(
      summary,
      assessment.summary,
      `executed_trials=${assessment.actual.executed_trials ?? "unknown"}`,
      `confidence_intervals=${assessment.actual.confidence_interval_count}`
    )
  });
}

function applyResultsTableTransitionOverride(
  recommendation: TransitionRecommendation,
  validation: ResultsTableValidationResult,
  summary: AnalysisReport
): TransitionRecommendation {
  if (validation.valid) {
    return recommendation;
  }
  return createRecommendation({
    action: "pause_for_human",
    reason: "incomplete_results_table",
    confidence: 0.94,
    autoExecutable: false,
    evidence: collectEvidence(
      summary,
      ...validation.issues,
      ...validation.incompleteRows.slice(0, 3).map((row) => `${row.metric}: baseline=${row.baseline ?? "null"}, comparator=${row.comparator ?? "null"}`)
    )
  });
}

function applyRiskSignalTransitionOverride(
  recommendation: TransitionRecommendation,
  riskSignals: RiskSignal[],
  summary: AnalysisReport
): TransitionRecommendation {
  const criticalSignal = riskSignals.find((signal) => signal.severity === "critical");
  if (!criticalSignal) {
    return recommendation;
  }
  return createRecommendation({
    action: "pause_for_human",
    reason: criticalSignal.detail,
    confidence: 0.97,
    autoExecutable: false,
    evidence: collectEvidence(
      summary,
      criticalSignal.detail,
      ...riskSignals.slice(0, 3).map((signal) => signal.detail)
    )
  });
}

function applyGovernanceTransitionOverride(
  recommendation: TransitionRecommendation,
  decision: ReturnType<typeof deriveGovernedAnalysisDecision> | undefined,
  summary: AnalysisReport,
  comparisonContract: ExperimentComparisonContract | undefined
): TransitionRecommendation {
  if (!decision?.transitionOverride) {
    return recommendation;
  }

  if (
    isDeferredFullCycleObjective(summary) &&
    decision.transitionOverride.targetNode === "implement_experiments" &&
    comparisonContract?.comparison_mode === "baseline_first_locked"
  ) {
    return recommendation;
  }

  const targetNode = decision.transitionOverride.targetNode;
  // When governance overrides an "advance" recommendation to a backtrack,
  // require human approval instead of auto-executing to prevent loops.
  const overridingAdvance = recommendation.action === "advance";
  return createRecommendation({
    action: targetNode === "design_experiments" ? "backtrack_to_design" : "backtrack_to_implement",
    targetNode,
    reason: decision.transitionOverride.rationale,
    confidence: targetNode === "design_experiments" ? 0.86 : 0.9,
    autoExecutable: overridingAdvance ? false : true,
    evidence: collectEvidence(
      summary,
      decision.transitionOverride.rationale,
      decision.candidateEntry.rationale,
      comparisonContract?.comparison_mode
        ? `Comparison mode: ${comparisonContract.comparison_mode}.`
        : undefined
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

function isDeferredFullCycleObjective(summary: AnalysisReport): boolean {
  if (summary.overview.objective_status !== "not_met") {
    return false;
  }
  const matchedMetricKey = (summary.overview.matched_metric_key || "").toLowerCase();
  const profilePrimaryMetric = (summary.objective_metric.profile.primary_metric || "").toLowerCase();
  const rawObjectiveMetric = summary.objective_metric.raw.toLowerCase();
  const fullCycleMetricMatched =
    matchedMetricKey.endsWith("tui_full_cycle_consistent_success_count") ||
    profilePrimaryMetric === "tui_full_cycle_consistent_success_count" ||
    (rawObjectiveMetric.includes("full tui cycle") && rawObjectiveMetric.includes("artifact/state consistency"));
  if (!fullCycleMetricMatched) {
    return false;
  }
  const objectiveMetrics = asRecord(summary.metrics.metrics);
  if (objectiveMetrics.full_cycle_completed !== false) {
    return false;
  }
  const pendingNodes = asStringArray(objectiveMetrics.pending_nodes);
  const objectiveNotes = asRecord(objectiveMetrics.notes);
  const fullCycleNote = asString(objectiveNotes.full_cycle_completed) || "";
  const pendingLifecycleNodes = pendingNodes.some((node) =>
    node === "run_experiments" || node === "analyze_results" || node === "review" || node === "write_paper"
  );
  const selfReferentialNote =
    /run remains at implement_experiments/i.test(fullCycleNote) ||
    /never entered run_experiments\/analyze_results\/review\/write_paper/i.test(fullCycleNote);
  return pendingLifecycleNodes || selfReferentialNote;
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

/**
 * Parse a dataset_summary CSV string into the dataset_summaries JSON structure
 * expected by write_paper / scientificWriting.
 *
 * Pure function (no I/O) for testability.
 */
export function parseDatasetSummaryCsv(csv: string): Array<Record<string, unknown>> | undefined {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) {
    return undefined;
  }

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",");
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = values[i]?.trim() ?? "";
    });
    return obj;
  });

  const byDataset = new Map<string, Array<Record<string, string>>>();
  for (const row of rows) {
    const ds = row.dataset || "unknown";
    if (!byDataset.has(ds)) {
      byDataset.set(ds, []);
    }
    byDataset.get(ds)!.push(row);
  }

  const datasetSummaries: Array<Record<string, unknown>> = [];
  for (const [dataset, datasetRows] of byDataset) {
    const models: Record<string, Record<string, number>> = {};
    for (const row of datasetRows) {
      const modelFamily = row.model_family || row.model || "unknown_model";
      const calibration = row.calibration || "raw";
      const threshold = row.threshold_protocol;
      const conditionKey = threshold
        ? `${modelFamily}_${calibration}_${threshold}`
        : `${modelFamily}_${calibration}`;
      const model: Record<string, number> = {};
      const skipKeys = new Set([
        "dataset", "model_family", "model", "calibration",
        "threshold_protocol", "n_outer_evaluations"
      ]);
      for (const [key, val] of Object.entries(row)) {
        if (skipKeys.has(key)) {
          continue;
        }
        const num = parseFloat(val);
        if (!isNaN(num)) {
          model[key] = num;
        }
      }
      // Provide aliases expected by collectDatasetResultSummaries
      if (model.macro_f1_mean !== undefined && model.macro_f1 === undefined) {
        model.macro_f1 = model.macro_f1_mean;
      }
      if (model.runtime_seconds_mean !== undefined && model.runtime_seconds === undefined) {
        model.runtime_seconds = model.runtime_seconds_mean;
      }
      if (model.peak_memory_mb_mean !== undefined && model.peak_memory_mb === undefined) {
        model.peak_memory_mb = model.peak_memory_mb_mean;
      }
      if (model.brier_score_mean !== undefined && model.brier_score === undefined) {
        model.brier_score = model.brier_score_mean;
      }
      if (model.auroc_mean !== undefined && model.auroc === undefined) {
        model.auroc = model.auroc_mean;
      }
      models[conditionKey] = model;
    }

    // Compute delta vs logistic_regression_raw baseline for each model
    const baselineKey = Object.keys(models).find(
      (k) => k.includes("logistic_regression") && k.includes("raw")
    );
    const baselineF1 = baselineKey ? models[baselineKey]?.macro_f1 : undefined;
    if (typeof baselineF1 === "number") {
      for (const [key, model] of Object.entries(models)) {
        if (typeof model.macro_f1 === "number" && model.macro_f1_delta_vs_logreg === undefined) {
          model.macro_f1_delta_vs_logreg = model.macro_f1 - baselineF1;
        }
      }
    }

    datasetSummaries.push({ dataset, models });
  }

  return datasetSummaries.length > 0 ? datasetSummaries : undefined;
}

/**
 * Build latest_results.json from artifact_paths.dataset_summary_csv when
 * run_experiments produced a per-dataset CSV but did not create the JSON file
 * that write_paper expects.
 *
 * Returns the path to the written file, or undefined if not applicable.
 */
async function buildLatestResultsFromCsvArtifact(
  metrics: Record<string, unknown>,
  runId: string,
  warnings: string[]
): Promise<string | undefined> {
  // Resolve CSV path: try multiple locations since experiment runners
  // may store artifact paths under different keys.
  // Priority: aggregate_results_csv (per-condition results) over
  // dataset_summary_csv (which may be just dataset descriptors).
  const artifactPaths = asRecord(metrics.artifact_paths);
  const artifacts = asRecord(metrics.artifacts);
  const csvPath =
    asString(artifactPaths.aggregate_results_csv) ||
    asString(artifacts.aggregate_results_csv) ||
    asString(artifactPaths.dataset_summary_csv) ||
    asString(artifacts.dataset_summary_csv);
  if (!csvPath) {
    return undefined;
  }

  let csv: string;
  try {
    csv = await fs.readFile(csvPath, "utf8");
  } catch {
    return undefined;
  }

  const datasetSummaries = parseDatasetSummaryCsv(csv);
  if (!datasetSummaries) {
    return undefined;
  }

  // Derive protocol metadata from the outer-fold CSV when available.
  // This gives the scientific writing layer accurate repeat/fold/seed
  // counts instead of relying on heuristic extraction from plan text.
  const outerCsvPath =
    asString(artifacts.outer_fold_results_csv) ||
    asString(artifactPaths.outer_fold_results_csv);
  const protocol = await deriveProtocolFromOuterFoldCsv(outerCsvPath);

  const latestResults: Record<string, unknown> = { dataset_summaries: datasetSummaries };
  if (protocol) {
    latestResults.protocol = protocol;
  }
  const outPath = path.join(".autolabos", "runs", runId, "latest_results.json");
  try {
    await fs.writeFile(outPath, JSON.stringify(latestResults, null, 2));
  } catch (error) {
    warnings.push(`Failed to write latest_results.json: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  return outPath;
}

/** Derive protocol metadata (repeats, outer folds, seeds, datasets, models)
 *  from the outer-fold-level CSV so the scientific writing layer has accurate
 *  counts for consistency checks. */
async function deriveProtocolFromOuterFoldCsv(
  csvPath: string | undefined
): Promise<Record<string, unknown> | undefined> {
  if (!csvPath) {
    return undefined;
  }
  let raw: string;
  try {
    raw = await fs.readFile(csvPath, "utf8");
  } catch {
    return undefined;
  }
  return parseOuterFoldProtocol(raw);
}

/** Pure-function protocol parser, exported for unit testing. */
export function parseOuterFoldProtocol(csv: string): Record<string, unknown> | undefined {
  const lines = csv.split("\n").filter(Boolean);
  if (lines.length < 2) {
    return undefined;
  }
  const header = lines[0].split(",").map((h) => h.trim());
  const repeatIdx = header.indexOf("repeat_index");
  const foldIdx = header.indexOf("outer_fold");
  const seedIdx = header.indexOf("outer_seed");
  const datasetIdx = header.indexOf("dataset");
  const modelIdx = header.indexOf("model");
  if (repeatIdx < 0 && foldIdx < 0) {
    return undefined;
  }
  const repeats = new Set<string>();
  const folds = new Set<string>();
  const seeds = new Set<number>();
  const datasets = new Set<string>();
  const models = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (repeatIdx >= 0 && cols[repeatIdx]) repeats.add(cols[repeatIdx].trim());
    if (foldIdx >= 0 && cols[foldIdx]) folds.add(cols[foldIdx].trim());
    if (seedIdx >= 0 && cols[seedIdx]) {
      const n = Number(cols[seedIdx].trim());
      if (Number.isFinite(n)) seeds.add(n);
    }
    if (datasetIdx >= 0 && cols[datasetIdx]) datasets.add(cols[datasetIdx].trim());
    if (modelIdx >= 0 && cols[modelIdx]) models.add(cols[modelIdx].trim());
  }
  const protocol: Record<string, unknown> = {};
  if (repeats.size > 0) protocol.repeats = repeats.size;
  if (folds.size > 0) protocol.outer_folds = folds.size;
  if (seeds.size > 0) protocol.seed_schedule = [...seeds].sort((a, b) => a - b);
  if (datasets.size > 0) protocol.datasets = [...datasets].sort();
  if (models.size > 0) protocol.models = [...models].sort();
  return Object.keys(protocol).length > 0 ? protocol : undefined;
}

// ---------------------------------------------------------------------------
// Result table types & builder (standalone artifact for the review gate)
// ---------------------------------------------------------------------------

export interface ResultTableEntry {
  name: string;
  metrics: Record<string, number | string | null>;
}

export interface ResultTableComparison {
  primary: string;
  baseline: string;
  metric: string;
  delta: number | null;
  hypothesis_supported: boolean | null;
}

export interface ResultTable {
  conditions: ResultTableEntry[];
  comparisons: ResultTableComparison[];
  primary_metric: string;
  summary: string;
}

interface ResultsTableValidationResult {
  valid: boolean;
  rows: ResultsTableSchema;
  issues: string[];
  incompleteRows: ResultsTableSchema;
}

export function buildResultTable(report: AnalysisReport): ResultTable {
  const conditionNames = new Set<string>();
  const conditionMetrics = new Map<string, Record<string, number | string | null>>();

  for (const comparison of report.condition_comparisons) {
    if (comparison.id && !conditionNames.has(comparison.id)) {
      conditionNames.add(comparison.id);
      const metrics: Record<string, number | string | null> = {};
      for (const m of comparison.metrics ?? []) {
        if (m.primary_value !== undefined && m.primary_value !== null) {
          metrics[m.key] = m.primary_value;
        }
      }
      conditionMetrics.set(comparison.id, metrics);
    }
  }

  // Fallback: derive a single condition from metric_table
  if (conditionNames.size === 0 && report.metric_table.length > 0) {
    const defaultName = "primary";
    conditionNames.add(defaultName);
    const metrics: Record<string, number | string | null> = {};
    for (const entry of report.metric_table) {
      metrics[entry.key] = entry.value;
    }
    conditionMetrics.set(defaultName, metrics);
  }

  const conditions: ResultTableEntry[] = Array.from(conditionNames).map((name) => ({
    name,
    metrics: conditionMetrics.get(name) ?? {}
  }));

  const comparisons: ResultTableComparison[] = report.condition_comparisons.map((c) => {
    const firstMetric = c.metrics?.[0];
    const delta =
      firstMetric?.primary_value != null && firstMetric?.baseline_value != null
        ? firstMetric.primary_value - firstMetric.baseline_value
        : null;
    return {
      primary: c.id || c.label || "primary",
      baseline: c.source || "baseline",
      metric: firstMetric?.key ?? report.overview?.matched_metric_key ?? "",
      delta,
      hypothesis_supported: c.hypothesis_supported ?? null
    };
  });

  const primaryMetric =
    report.overview?.matched_metric_key ?? report.metric_table[0]?.key ?? "";

  const summaryText = report.overview?.objective_summary ?? "";

  return {
    conditions,
    comparisons,
    primary_metric: primaryMetric,
    summary: summaryText
  };
}

export function buildResultsTableValidation(input: {
  report: AnalysisReport;
  experimentContract?: ExperimentContract;
}): ResultsTableValidationResult {
  const rows = buildStructuredResultsTable(
    input.report,
    input.experimentContract?.results_table_schema
  );
  const schemaValidation = validateResultsTableSchema(rows);
  const incompleteRows = schemaValidation.rows.filter(
    (row) => row.baseline === null || row.comparator === null
  );
  const issues = [...schemaValidation.issues];
  if (hasAnyIncompleteResultsTableRow(schemaValidation.rows)) {
    issues.push("Results table is incomplete: baseline and comparator must both be populated for every reported row.");
  }
  return {
    valid: schemaValidation.valid && incompleteRows.length === 0,
    rows: schemaValidation.rows,
    issues,
    incompleteRows
  };
}

function buildStructuredResultsTable(
  report: AnalysisReport,
  contractSchema: ResultsTableSchema | undefined
): ResultsTableSchema {
  const direction = resolveResultsTableDirection(report);
  const metricRows = new Map<string, ResultsTableSchema[number]>();

  for (const comparison of report.condition_comparisons ?? []) {
    for (const metric of comparison.metrics ?? []) {
      if (!metric.key) {
        continue;
      }
      if (metric.primary_value == null || metric.baseline_value == null) {
        continue;
      }
      if (!metricRows.has(metric.key)) {
        metricRows.set(metric.key, {
          metric: metric.key,
          baseline: metric.baseline_value,
          comparator: metric.primary_value,
          delta: Number((metric.primary_value - metric.baseline_value).toFixed(4)),
          direction
        });
      }
    }
  }

  if (metricRows.size === 0) {
    return (contractSchema ?? [])
      .map((row) => ({
        metric: row.metric,
        baseline: row.baseline,
        comparator: row.comparator,
        delta: row.delta,
        direction: row.direction
      }))
      .filter((row) => row.metric.trim().length > 0);
  }

  const contractMetrics = new Set((contractSchema ?? []).map((row) => row.metric));
  const orderedMetrics = contractSchema && contractSchema.length > 0
    ? [
        ...contractSchema.map((row) => row.metric).filter((metricName) => metricRows.has(metricName)),
        ...Array.from(metricRows.keys()).filter((metricName) => !contractMetrics.has(metricName))
      ]
    : Array.from(metricRows.keys());

  const rows = orderedMetrics.map((metricName) => {
    const existing = metricRows.get(metricName);
    const contractRow = contractSchema?.find((row) => row.metric === metricName);
    return existing ?? {
      metric: metricName,
      baseline: contractRow?.baseline ?? null,
      comparator: contractRow?.comparator ?? null,
      delta: contractRow?.delta ?? null,
      direction: contractRow?.direction ?? direction
    };
  });

  return rows.filter((row) => row.metric.trim().length > 0);
}

function resolveResultsTableDirection(report: AnalysisReport): ResultsTableDirection {
  return report.objective_metric.profile.primary_metric
    && /loss|latency|error|time|memory|ram/i.test(report.objective_metric.profile.primary_metric)
    ? "lower_better"
    : "higher_better";
}
