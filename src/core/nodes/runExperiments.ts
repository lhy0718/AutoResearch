import path from "node:path";
import { promises as fs } from "node:fs";

import { RunContextMemory } from "../memory/runContextMemory.js";
import { GraphNodeHandler } from "../stateGraph/types.js";
import { appendJsonl, writeRunArtifact } from "./helpers.js";
import { publishPublicRunOutputs, PublishPublicRunOutputsResult } from "../publicOutputPublisher.js";
import { resolveRunCommand } from "./runCommandResolver.js";
import { NodeExecutionDeps } from "./types.js";
import { fileExists } from "../../utils/fs.js";
import {
  evaluateObjectiveMetric,
  ObjectiveMetricEvaluation,
  resolveObjectiveMetricProfile
} from "../objectiveMetric.js";
import {
  buildCrashLedgerEntry,
  EXPERIMENT_GOVERNANCE_CONTRACT_KEY,
  freezeManagedBundleLock,
  getGovernedObjectiveProfile,
  loadExperimentComparisonContract,
  loadExperimentImplementationContext,
  storeExperimentGovernanceDecision
} from "../experimentGovernance.js";
import { RunVerifierReport, RunVerifierTrigger } from "../experiments/runVerifierFeedback.js";
import { detectPreflightOnlyMetrics } from "../experiments/executedMetrics.js";
import { FailureMemory, buildErrorFingerprint } from "../experiments/failureMemory.js";
import {
  buildExperimentRunManifest,
  BuildExperimentRunManifestTrialGroupExecution,
  buildFallbackExperimentPortfolio,
  ExperimentPortfolio,
  ExperimentPortfolioTrialGroup,
  ExperimentPortfolioSamplingProfile
} from "../experiments/experimentPortfolio.js";
import {
  buildRunExperimentsExecutionPlan,
  classifyRunExperimentsFailure,
  createRunExperimentsWatchdogState,
  decideRunExperimentsRerun,
  finalizeRunExperimentsTriage,
  recordSupplementalOutputs,
  RunExperimentsExecutionPlan,
  RunExperimentsRerunDecision,
  RunExperimentsTriageAttempt,
  setSentinelFindings,
  setMetricsState
} from "../runExperimentsPanel.js";
import { wrapCommandForExecutionProfile } from "../../runtime/executionProfile.js";
import { parseMarkdownRunBriefSections, type MarkdownRunBriefSections } from "../runs/runBriefParser.js";
import {
  countExecutedPlannedConditions,
  deriveRequiredPlannedConditionCount
} from "../analysis/plannedConditionCoverage.js";
import { buildIntermediateArtifactCaptureManifest } from "../artifacts/intermediateArtifactCapture.js";
import {
  repairPythonConditionMarkerDefaultKwargSurface,
  repairPythonConditionTrainEvalHelperBridgeSurface,
  repairPythonConditionSuccessStatusAliasSurface,
  repairPythonChunk3bStudyRunnerInvocationContextSurface,
  repairPythonChunk3bConditionMarkerSelectionSurface,
  repairPythonMultipleChoicePromptSignatureSurface,
  repairPythonSafeMetricFloatHelperSurface,
  repairPythonConfigInstanceDataclassFieldAliasSurface,
  repairPythonDataCollatorPrecomputedLabelReturnSurface,
  repairPythonDataCollatorTokenizerArgumentSurface,
  repairPythonDataclassEvaluationRecordCoercionSurface,
  repairPythonBenchmarkAccuracyComprehensionSurface,
  repairPythonEvaluationAnswerLabelAliasSurface,
  repairPythonLockedSweepRuntimeKwargBridgeSurface,
  repairPythonMainMetricsRawResultsAliasSurface,
  repairPythonMainMetricsPayloadBuilderCallSurface,
  repairPythonMainCallableResolverSpecificitySurface,
  repairPythonMainStudyRunnerDeviceBridgeSurface,
  repairPythonPublicStudyTopLevelRunnerAliasSurface,
  repairPythonHighLevelWorkloadContextAliasSurface,
  repairPythonConditionScheduleMarkerParameterSurface,
  repairPythonLockedConditionSingleRunnerBridgeSurface,
  repairPythonMultipleChoiceDataclassChoiceAliasSurface,
  repairPythonOutputDirArgparseAlias,
  repairPythonParameterSummaryRecordSurface,
  repairPythonMetricsPayloadProjectionSurface,
  repairPythonAllowModelDownloadsRuntimeArgDefaultSurface,
  repairPythonRunContextHelperFallbackSurface,
  repairPythonRunResultArtifactAggregationSurface,
  repairPythonLockedConditionSeedMatrixEntrypointSurface,
  repairPythonSingleConditionExecutorBridgeSurface,
  repairPythonStudyRuntimeHelperAliasSurface,
  repairPythonTerminalMetricsExistingConditionCountSurface,
  repairPythonTrainLossHelperAritySurface
} from "../agents/implementSessionManager.js";

type SupplementalProfileName = "quick_check" | "confirmatory";

interface ManagedSupplementalProfile {
  profile: SupplementalProfileName;
  command: string;
  metricsPath: string;
  workingDir: string;
}

interface ManagedSupplementalPlan {
  kind: "managed_bundle" | "legacy_python_runner";
  publicDir: string;
  profiles: [ManagedSupplementalProfile, ManagedSupplementalProfile];
}

interface SupplementalRunRecord {
  profile: SupplementalProfileName;
  status: "pass" | "fail" | "skipped";
  command?: string;
  cwd?: string;
  metrics_path: string;
  summary: string;
  exit_code?: number;
  log_file?: string;
  objective_evaluation?: ObjectiveMetricEvaluation;
  sampling_profile?: ExperimentPortfolioSamplingProfile;
}

interface SupplementalExpectationArtifact {
  applicable: boolean;
  profiles: string[];
  reason?: string;
}

interface ManagedMatrixSliceArtifact {
  version: 1;
  run_id: string;
  trial_group_id: string;
  source_trial_group_id: string;
  generated_at: string;
  execution_model: "managed_bundle";
  runner_profile?: string;
  dataset: string;
  source_metrics_path?: string;
  command?: string;
  cwd?: string;
  sampling_profile?: ExperimentPortfolioSamplingProfile;
  condition_metrics: Record<string, unknown>;
  comparison: Record<string, unknown>;
  summary: string;
}

export function createRunExperimentsNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "run_experiments",
    async execute({ run, abortSignal }) {
      const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
      const comparisonContract = await loadExperimentComparisonContract(run, runContext);
      const implementationContext = await loadExperimentImplementationContext(run, runContext);
      const rawBrief = await runContext.get<string>("run_brief.raw");
      const briefSections = rawBrief ? parseMarkdownRunBriefSections(rawBrief) : undefined;
      const pendingHandoff =
        (await runContext.get<boolean>("implement_experiments.pending_handoff_to_run_experiments")) === true;
      const handoffReason = await runContext.get<string>("implement_experiments.handoff_reason");
      const trigger: RunVerifierTrigger = pendingHandoff ? "auto_handoff" : "manual";
      const experimentMode =
        (await runContext.get<string>("implement_experiments.mode")) || "real_execution";
      const managedSupplementalPlan = await resolveManagedSupplementalPlan(runContext, process.cwd());
      const loadedExperimentPortfolio = await loadExperimentPortfolio(run.id);
      const experimentPortfolio =
        loadedExperimentPortfolio ||
        buildFallbackExperimentPortfolio({
          runId: run.id,
          executionModel: managedSupplementalPlan?.kind || "single_run",
          supplementalProfiles: managedSupplementalPlan?.profiles.map((profile) => ({
            profile: profile.profile
          }))
        });
      if (!loadedExperimentPortfolio) {
        await writeRunArtifact(run, "experiment_portfolio.json", JSON.stringify(experimentPortfolio, null, 2));
      }
      await runContext.put("run_experiments.trigger", trigger);
      await runContext.put("run_experiments.handoff_reason", handoffReason || null);
      await runContext.put("run_experiments.supplemental_runs", []);
      await runContext.put("run_experiments.supplemental_summary", null);
      await runContext.put("run_experiments.triage", null);
      await runContext.put("run_experiments.portfolio", null);
      await runContext.put("run_experiments.run_manifest", null);

      if (deps.executionProfile === "plan_only") {
        const summary = "Skipped code execution because the detected execution profile is plan_only.";
        const report = buildRunVerifierReport({
          status: "skipped",
          trigger,
          stage: "policy",
          summary,
          suggestedNextAction: "Switch to a local, docker, or remote execution environment before retrying run_experiments."
        });
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "run_experiments",
          agentRole: "runner",
          payload: {
            text: summary
          }
        });
        await persistRunVerifierReport(run, runContext, report);
        return {
          status: "skipped",
          reason: "plan_only_mode",
          summary,
          toolCallsUsed: 0
        };
      }

      const defaultMetricsPath = path.join(process.cwd(), ".autolabos", "runs", run.id, "metrics.json");
      const failureMemory = FailureMemory.forRun(run.id);
      const triageAttempts: RunExperimentsTriageAttempt[] = [];
      let executionPlan: RunExperimentsExecutionPlan | undefined;
      let rerunDecision: RunExperimentsRerunDecision = {
        decision: "not_needed",
        reason: "No automatic rerun was required."
      };
      let watchdog = createRunExperimentsWatchdogState({
        metricsPath: defaultMetricsPath
      });
      const persistPanelState = async () => {
        await persistRunPanelArtifacts({
          run,
          runContext,
          executionPlan,
          triageAttempts,
          watchdog,
          rerunDecision
        });
      };

      // --- Failure memory: check for do-not-retry before starting ---
      const priorDoNotRetry = await failureMemory.hasDoNotRetry("run_experiments");
      if (priorDoNotRetry) {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "run_experiments",
          payload: {
            text: "Failure memory contains a do-not-retry marker for run_experiments. This attempt will proceed but previous structural failures should be reviewed."
          }
        });
      }

      /** Record a failure to the run-scoped failure memory JSONL. */
      const recordRunFailure = async (
        errorMsg: string,
        failureClass: "transient" | "structural" | "equivalent" | "resource" | "unknown"
      ) => {
        const fingerprint = buildErrorFingerprint(errorMsg);
        const equivalentCount = await failureMemory.countEquivalentFailures("run_experiments", fingerprint);
        const doNotRetry = failureClass === "structural" || equivalentCount >= 2;
        await failureMemory.append({
          run_id: run.id,
          node_id: "run_experiments",
          attempt: (run.graph.retryCounters.run_experiments ?? 0) + 1,
          failure_class: equivalentCount >= 2 ? "equivalent" : failureClass,
          error_fingerprint: fingerprint,
          error_message: errorMsg.slice(0, 1200),
          do_not_retry: doNotRetry,
          do_not_retry_reason: doNotRetry
            ? equivalentCount >= 2
              ? `Same failure pattern repeated ${equivalentCount + 1} times without improvement.`
              : "Structural failure unlikely to resolve without design change."
            : undefined
        });
      };

      if (pendingHandoff) {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "run_experiments",
          agentRole: "runner",
          payload: {
            text: handoffReason
              ? `Starting second-stage verification from implement_experiments. ${handoffReason}`
              : "Starting second-stage verification from implement_experiments."
          }
        });
        await runContext.put("implement_experiments.pending_handoff_to_run_experiments", false);
      }
      const implementPublicDir = resolveMaybeRelative(
        await runContext.get<string>("implement_experiments.public_dir"),
        process.cwd()
      );
      const bootstrapContract = implementPublicDir
        ? await loadImplementBootstrapContract(implementPublicDir)
        : undefined;
      if (bootstrapContract?.requires_network) {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "run_experiments",
          agentRole: "runner",
          payload: {
            text:
              bootstrapContract.summary ||
              "Bootstrap contract declares remote assets or services. This run will proceed as network-assisted if those assets are fetched on demand."
          }
        });
      }
      let clearedSupplementalOutputs: string[] = [];
      if (managedSupplementalPlan) {
        clearedSupplementalOutputs = await clearManagedSupplementalOutputs(run, managedSupplementalPlan.profiles);
        if (clearedSupplementalOutputs.length > 0) {
          deps.eventStream.emit({
            type: "OBS_RECEIVED",
            runId: run.id,
            node: "run_experiments",
            agentRole: "runner",
            payload: {
              text: `Cleared stale supplemental metrics before the standard run (${clearedSupplementalOutputs.join(", ")}).`
            }
          });
        }
      }
      watchdog = createRunExperimentsWatchdogState({
        metricsPath: defaultMetricsPath,
        clearedSupplementalOutputs
      });

      let resolved: Awaited<ReturnType<typeof resolveRunCommand>>;
      try {
        resolved = await resolveRunCommand(run, process.cwd());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        triageAttempts.push(
          classifyRunExperimentsFailure({
            attempt: 1,
            stage: "resolve",
            summary: message,
            metricsPath: defaultMetricsPath
          })
        );
        rerunDecision = decideRunExperimentsRerun({
          triage: triageAttempts[triageAttempts.length - 1],
          automaticRerunsUsed: 0
        });
        await persistPanelState();
        const report = buildRunVerifierReport({
          status: "fail",
          trigger,
          stage: "command",
          summary: message,
          suggestedNextAction:
            "Publish a runnable experiment command, script, or package.json experiment target before retrying."
        });
        deps.eventStream.emit({
          type: "TEST_FAILED",
          runId: run.id,
          node: "run_experiments",
          agentRole: "runner",
          payload: {
            stderr: message
          }
        });
        await persistRunVerifierReport(run, runContext, report);
        await persistRunFailureState(runContext, {
          error: message
        });
        await persistGovernanceCrash({
          run,
          runContext,
          comparisonContract,
          implementationContext,
          objectiveMetricName: run.objectiveMetric,
          rationale: report.summary,
          resourceUsage: {
            stage: "resolve"
          }
        });
        await recordRunFailure(message, "structural");
        return {
          status: "failure",
          error: message,
          toolCallsUsed: 0
        };
      }

      const runtimeCompatibilityRepair = await repairPythonRuntimeCompatibilityBeforeRun({
        runContext,
        command: resolved.command,
        cwd: resolved.cwd,
        workspaceRoot: process.cwd()
      });
      if (runtimeCompatibilityRepair.repaired) {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "run_experiments",
          agentRole: "runner",
          payload: {
            text: runtimeCompatibilityRepair.message
          }
        });
      }

      executionPlan = buildRunExperimentsExecutionPlan({
        trigger,
        command: wrapCommandForExecutionProfile({
          profile: deps.executionProfile || "local",
          command: resolved.command,
          cwd: resolved.cwd
        }),
        cwd: resolved.cwd,
        metricsPath: resolved.metricsPath,
        source: resolved.source,
        comparisonMode: comparisonContract?.comparison_mode,
        budgetProfile: comparisonContract?.budget_profile,
        evaluatorContractId: comparisonContract?.evaluator_contract_id,
        baselineCandidateIds: comparisonContract?.baseline_candidate_ids,
        testCommand: resolved.testCommand
          ? wrapCommandForExecutionProfile({
              profile: deps.executionProfile || "local",
              command: resolved.testCommand,
              cwd: resolved.testCwd || resolved.cwd
            })
          : undefined,
        testCwd: resolved.testCwd,
        portfolio: experimentPortfolio,
        supplementalProfiles: managedSupplementalPlan?.profiles.map((profile) => ({
          profile: profile.profile,
          command: wrapCommandForExecutionProfile({
            profile: deps.executionProfile || "local",
            command: profile.command,
            cwd: profile.workingDir
          }),
          metricsPath: profile.metricsPath
        }))
      });
      watchdog = createRunExperimentsWatchdogState({
        metricsPath: resolved.metricsPath,
        clearedSupplementalOutputs
      });
      await persistPanelState();

      const profiledTestCommand = resolved.testCommand
        ? wrapCommandForExecutionProfile({
            profile: deps.executionProfile || "local",
            command: resolved.testCommand,
            cwd: resolved.testCwd || resolved.cwd
          })
        : undefined;
      const preflightToolCallsUsed = profiledTestCommand ? 1 : 0;

      if (profiledTestCommand) {
        deps.eventStream.emit({
          type: "TOOL_CALLED",
          runId: run.id,
          node: "run_experiments",
          agentRole: "runner",
          payload: {
            command: profiledTestCommand,
            cwd: resolved.testCwd || resolved.cwd,
            source: "preflight_test"
          }
        });

        const testObs = await deps.aci.runTests(
          profiledTestCommand,
          resolved.testCwd || resolved.cwd,
          abortSignal
        );
        if (testObs.status !== "ok") {
          const policyBlock = extractPolicyBlock(testObs);
          triageAttempts.push(
            classifyRunExperimentsFailure({
              attempt: 1,
              stage: "preflight",
              summary: testObs.stderr || "Preflight tests failed",
              command: profiledTestCommand,
              cwd: resolved.testCwd || resolved.cwd,
              exitCode: testObs.exit_code ?? 1,
              policyBlocked: policyBlock.blocked
            })
          );
          rerunDecision = decideRunExperimentsRerun({
            triage: triageAttempts[triageAttempts.length - 1],
            automaticRerunsUsed: 0
          });
          await persistPanelState();
          const report = buildRunVerifierReport({
            status: "fail",
            trigger,
            stage: policyBlock.blocked ? "policy" : "preflight_test",
            summary: testObs.stderr || "Preflight tests failed",
            policyRuleId: policyBlock.ruleId,
            policyReason: policyBlock.reason,
            command: profiledTestCommand,
            cwd: resolved.testCwd || resolved.cwd,
            exitCode: testObs.exit_code ?? 1,
            stdout: testObs.stdout,
            stderr: testObs.stderr,
            suggestedNextAction: policyBlock.blocked
              ? "Replace the blocked preflight test with a policy-compliant local check before retrying."
              : "Repair the lightweight preflight test path or patch the experiment so the syntax/test command passes."
          });
          deps.eventStream.emit({
            type: "TEST_FAILED",
            runId: run.id,
            node: "run_experiments",
            agentRole: "runner",
            payload: {
              command: resolved.testCommand,
              stderr: testObs.stderr || "preflight tests failed"
            }
          });
          await persistRunVerifierReport(run, runContext, report);
          await persistRunFailureState(runContext, {
            command: resolved.testCommand,
            cwd: resolved.testCwd || resolved.cwd,
            exitCode: testObs.exit_code ?? 1,
            error: testObs.stderr || "preflight tests failed"
          });
          await persistGovernanceCrash({
            run,
            runContext,
            comparisonContract,
            implementationContext,
            objectiveMetricName: run.objectiveMetric,
            rationale: report.summary,
            resourceUsage: {
              stage: "preflight",
              command: resolved.testCommand,
              cwd: resolved.testCwd || resolved.cwd,
              exit_code: testObs.exit_code ?? 1
            }
          });
          await recordRunFailure(testObs.stderr || "Preflight tests failed", "transient");
          return {
            status: "failure",
            error: testObs.stderr || "Preflight tests failed",
            toolCallsUsed: 1
          };
        }
      }

      const previousMetricsBackup = await clearPreexistingMetricsOutput(run, resolved.metricsPath);
      if (previousMetricsBackup) {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "run_experiments",
          agentRole: "runner",
          payload: {
            text: `Archived previous metrics output before execution to ${previousMetricsBackup}.`
          }
        });
        await runContext.put("run_experiments.previous_metrics_backup", previousMetricsBackup);
      } else {
        await runContext.put("run_experiments.previous_metrics_backup", null);
      }
      const restoreMetricsAfterRejectedAttempt = async (reason: string) => {
        const restoredPath = await restorePreexistingMetricsOutput({
          run,
          metricsPath: resolved.metricsPath,
          backupPath: previousMetricsBackup,
          reason
        });
        if (restoredPath) {
          deps.eventStream.emit({
            type: "OBS_RECEIVED",
            runId: run.id,
            node: "run_experiments",
            agentRole: "runner",
            payload: {
              text: `Restored previous metrics output after rejected attempt from ${restoredPath}.`
            }
          });
          await runContext.put("run_experiments.restored_previous_metrics_after_failure", restoredPath);
        }
      };
      const previousFailureArtifactBackups = await clearPreexistingExperimentFailureArtifacts(run, resolved.cwd);
      if (previousFailureArtifactBackups.length > 0) {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "run_experiments",
          agentRole: "runner",
          payload: {
            text: `Archived stale experiment failure artifact(s) before execution to ${previousFailureArtifactBackups.join(", ")}.`
          }
        });
        await runContext.put("run_experiments.previous_failure_artifact_backups", previousFailureArtifactBackups);
      } else {
        await runContext.put("run_experiments.previous_failure_artifact_backups", null);
      }
      watchdog = createRunExperimentsWatchdogState({
        metricsPath: resolved.metricsPath,
        previousMetricsBackup,
        clearedSupplementalOutputs
      });
      let primaryCommand = shouldForceFreshManagedStandardRun({
        command: resolved.command,
        experimentMode,
        previousMetricsBackup
      })
        ? appendFreshFlag(resolved.command)
        : resolved.command;
      primaryCommand = await appendPythonTimeoutArgIfAccepted(
        primaryCommand,
        resolved.cwd,
        resolveRunExperimentsBudgetTimeoutSec(deps.config)
      );
      primaryCommand = wrapCommandForExecutionProfile({
        profile: deps.executionProfile || "local",
        command: primaryCommand,
        cwd: resolved.cwd
      });
      primaryCommand = withModelDownloadEnvIfDeclared(primaryCommand, deps.config);
      if (executionPlan && executionPlan.command !== primaryCommand) {
        executionPlan = {
          ...executionPlan,
          command: primaryCommand
        };
        await persistPanelState();
      }

      let parsedMetrics: Record<string, unknown> = {};
      let objectiveEvaluationSummary = "";
      let obs: Awaited<ReturnType<NodeExecutionDeps["aci"]["runCommand"]>> | undefined;
      let logFile = "";
      let primaryAttemptsUsed = 0;
      let automaticRerunsUsed = 0;

      while (true) {
        const attemptNumber = primaryAttemptsUsed + 1;
        primaryAttemptsUsed += 1;
        deps.eventStream.emit({
          type: "TOOL_CALLED",
          runId: run.id,
          node: "run_experiments",
          agentRole: "runner",
          payload: {
            command: primaryCommand,
            cwd: resolved.cwd,
            source: primaryAttemptsUsed > 1 ? `${resolved.source}:retry_${attemptNumber}` : resolved.source
          }
        });

        obs = await deps.aci.runCommand(primaryCommand, resolved.cwd, abortSignal);
        logFile = await writeRunArtifact(
          run,
          primaryAttemptsUsed === 1
            ? "exec_logs/run_experiments.txt"
            : `exec_logs/run_experiments_retry_${attemptNumber}.txt`,
          [
            `command: ${primaryCommand}`,
            `cwd: ${resolved.cwd}`,
            `source: ${resolved.source}`,
            `attempt: ${attemptNumber}`,
            "",
            obs.stdout || "",
            obs.stderr || ""
          ].join("\n")
        );

        if (obs.status !== "ok") {
          const policyBlock = extractPolicyBlock(obs);
          const metricsFailureSummary = policyBlock.blocked
            ? undefined
            : await loadFailedMetricsSummary(resolved.metricsPath, resolved.cwd);
          const failureStage = metricsFailureSummary ? "metrics" : policyBlock.blocked ? "policy" : "command";
          const triageStage = failureStage === "metrics" ? "metrics" : "command";
          const failureSummary = metricsFailureSummary || obs.stderr || "Experiment command failed";
          const suggestedNextAction = metricsFailureSummary
            ? "Repair the experiment implementation so metrics.json records completed baseline/comparator execution instead of a top-level failed status."
            : policyBlock.blocked
              ? "Replace the blocked run command with a policy-compliant command before retrying."
              : "Repair the experiment command or runtime dependencies before handing back to the runner.";
          const triage = classifyRunExperimentsFailure({
            attempt: attemptNumber,
            stage: triageStage,
            summary: failureSummary,
            command: primaryCommand,
            cwd: resolved.cwd,
            exitCode: obs.exit_code ?? 1,
            logFile,
            metricsPath: resolved.metricsPath,
            policyBlocked: policyBlock.blocked
          });
          triageAttempts.push(triage);
          watchdog = setMetricsState(watchdog, "not_checked", logFile);
          rerunDecision = decideRunExperimentsRerun({
            triage,
            automaticRerunsUsed
          });
          await persistPanelState();
          if (rerunDecision.decision === "retry_once") {
            automaticRerunsUsed += 1;
            deps.eventStream.emit({
              type: "OBS_RECEIVED",
              runId: run.id,
              node: "run_experiments",
              agentRole: "runner",
              payload: {
                text: `Retrying the primary command once because the failure looked transient (${rerunDecision.reason})`
              }
            });
            continue;
          }

          const report = buildRunVerifierReport({
            status: "fail",
            trigger,
            stage: failureStage,
            summary: failureSummary,
            policyRuleId: policyBlock.ruleId,
            policyReason: policyBlock.reason,
            command: primaryCommand,
            cwd: resolved.cwd,
            metricsPath: resolved.metricsPath,
            exitCode: obs.exit_code ?? 1,
            stdout: obs.stdout,
            stderr: failureSummary,
            logFile,
            suggestedNextAction
          });
          deps.eventStream.emit({
            type: "TEST_FAILED",
            runId: run.id,
            node: "run_experiments",
            agentRole: "runner",
            payload: {
              command: primaryCommand,
              stderr: failureSummary
            }
          });
          await persistRunVerifierReport(run, runContext, report);
          await persistRunFailureState(runContext, {
            command: primaryCommand,
            cwd: resolved.cwd,
            logFile,
            exitCode: obs.exit_code ?? 1,
            error: failureSummary
          });
          await persistGovernanceCrash({
            run,
            runContext,
            comparisonContract,
            implementationContext,
            objectiveMetricName: run.objectiveMetric,
            rationale: report.summary,
            resourceUsage: {
              stage: failureStage,
              command: primaryCommand,
              cwd: resolved.cwd,
              exit_code: obs.exit_code ?? 1,
              log_file: logFile
            }
          });
          await recordRunFailure(failureSummary, "structural");
          await restoreMetricsAfterRejectedAttempt(failureSummary);
          return {
            status: "failure",
            error: failureSummary,
            toolCallsUsed: preflightToolCallsUsed + primaryAttemptsUsed
          };
        }

        let metricsExists = await fileExists(resolved.metricsPath);
        if (!metricsExists) {
          const recoveredPublicMetricsPath = await recoverPublicBundleMetricsOutput({
            runContext,
            workspaceRoot: process.cwd(),
            metricsPath: resolved.metricsPath
          });
          if (recoveredPublicMetricsPath) {
            metricsExists = true;
            deps.eventStream.emit({
              type: "OBS_RECEIVED",
              runId: run.id,
              node: "run_experiments",
              agentRole: "runner",
              payload: {
                text: `Recovered required metrics output from public bundle metrics at ${recoveredPublicMetricsPath}.`
              }
            });
            await runContext.put("run_experiments.recovered_public_metrics_path", recoveredPublicMetricsPath);
          }
        }
        if (!metricsExists) {
          const missingMessage = `Experiment finished without metrics output at ${resolved.metricsPath}`;
          const triage = classifyRunExperimentsFailure({
            attempt: attemptNumber,
            stage: "metrics",
            summary: missingMessage,
            command: primaryCommand,
            cwd: resolved.cwd,
            exitCode: obs.exit_code ?? 0,
            logFile,
            metricsPath: resolved.metricsPath
          });
          triageAttempts.push(triage);
          watchdog = setMetricsState(watchdog, "missing", logFile);
          rerunDecision = decideRunExperimentsRerun({
            triage,
            automaticRerunsUsed
          });
          await persistPanelState();
          const report = buildRunVerifierReport({
            status: "fail",
            trigger,
            stage: "metrics",
            summary: missingMessage,
            command: primaryCommand,
            cwd: resolved.cwd,
            metricsPath: resolved.metricsPath,
            exitCode: obs.exit_code ?? 0,
            stdout: obs.stdout,
            stderr: obs.stderr,
            logFile,
            suggestedNextAction:
              "Ensure the experiment writes JSON metrics to the required metrics path before finishing."
          });
          deps.eventStream.emit({
            type: "TEST_FAILED",
            runId: run.id,
            node: "run_experiments",
            agentRole: "runner",
            payload: {
              command: primaryCommand,
              metrics_path: resolved.metricsPath,
              stderr: missingMessage
            }
          });
          await persistRunVerifierReport(run, runContext, report);
          await persistRunFailureState(runContext, {
            command: primaryCommand,
            cwd: resolved.cwd,
            logFile,
            exitCode: obs.exit_code ?? 0,
            error: missingMessage
          });
          await persistGovernanceCrash({
            run,
            runContext,
            comparisonContract,
            implementationContext,
            objectiveMetricName: run.objectiveMetric,
            rationale: report.summary,
            resourceUsage: {
              stage: "metrics",
              command: primaryCommand,
              cwd: resolved.cwd,
              exit_code: obs.exit_code ?? 0,
              log_file: logFile,
              metrics_path: resolved.metricsPath
            }
          });
          await recordRunFailure(missingMessage, "structural");
          await restoreMetricsAfterRejectedAttempt(missingMessage);
          return {
            status: "failure",
            error: missingMessage,
            toolCallsUsed: preflightToolCallsUsed + primaryAttemptsUsed
          };
        }

        await appendJsonl(run, "exec_logs/observations.jsonl", [
          {
            command: primaryCommand,
            cwd: resolved.cwd,
            source: primaryAttemptsUsed > 1 ? `${resolved.source}:retry_${attemptNumber}` : resolved.source,
            status: obs.status,
            stdout: (obs.stdout || "").trim(),
            stderr: (obs.stderr || "").trim(),
            metrics_path: resolved.metricsPath,
            log_file: logFile
          }
        ]);

        try {
          const rawMetrics = await fs.readFile(resolved.metricsPath, "utf8");
          const parsed = JSON.parse(rawMetrics) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("metrics.json must decode to an object");
          }
          parsedMetrics = parsed as Record<string, unknown>;
          const promotedObjectiveMetric = promoteSummaryPrimaryMetric(parsedMetrics);
          if (promotedObjectiveMetric) {
            deps.eventStream.emit({
              type: "OBS_RECEIVED",
              runId: run.id,
              node: "run_experiments",
              agentRole: "runner",
              payload: {
                text: promotedObjectiveMetric
              }
            });
          }
          watchdog = setMetricsState(watchdog, "valid", logFile);
          const failedMetricsMessage = appendExperimentFailureArtifactEvidence(
            detectFailedMetricsPayload(parsedMetrics),
            await loadExperimentFailureArtifactSummary(resolved.cwd)
          );
          if (failedMetricsMessage) {
            const failedMetricsSuggestedNextAction = failedMetricsMessage.includes("Experiment dependency blocker:")
              ? "Prewarm or make the required experiment dependency available, or revise the governed experiment design to use an available model before rerunning."
              : "Repair the experiment implementation so metrics.json records completed baseline/comparator execution instead of a top-level failed status.";
            const triage = classifyRunExperimentsFailure({
              attempt: attemptNumber,
              stage: "metrics",
              summary: failedMetricsMessage,
              command: primaryCommand,
              cwd: resolved.cwd,
              exitCode: obs.exit_code ?? 0,
              logFile,
              metricsPath: resolved.metricsPath
            });
            triageAttempts.push(triage);
            rerunDecision = decideRunExperimentsRerun({
              triage,
              automaticRerunsUsed
            });
            await persistPanelState();
            const report = buildRunVerifierReport({
              status: "fail",
              trigger,
              stage: "metrics",
              summary: failedMetricsMessage,
              command: primaryCommand,
              cwd: resolved.cwd,
              metricsPath: resolved.metricsPath,
              exitCode: obs.exit_code ?? 0,
              stdout: obs.stdout,
              stderr: failedMetricsMessage,
              logFile,
              suggestedNextAction: failedMetricsSuggestedNextAction
            });
            deps.eventStream.emit({
              type: "TEST_FAILED",
              runId: run.id,
              node: "run_experiments",
              agentRole: "runner",
              payload: {
                command: primaryCommand,
                metrics_path: resolved.metricsPath,
                stderr: failedMetricsMessage
              }
            });
            await persistRunVerifierReport(run, runContext, report);
            await persistRunFailureState(runContext, {
              command: primaryCommand,
              cwd: resolved.cwd,
              logFile,
              exitCode: obs.exit_code ?? 0,
              error: failedMetricsMessage
            });
            await persistGovernanceCrash({
              run,
              runContext,
              comparisonContract,
              implementationContext,
              objectiveMetricName: run.objectiveMetric,
              rationale: report.summary,
              resourceUsage: {
                stage: "metrics",
                command: primaryCommand,
                cwd: resolved.cwd,
                exit_code: obs.exit_code ?? 0,
                log_file: logFile,
                metrics_path: resolved.metricsPath
              }
            });
            await recordRunFailure(failedMetricsMessage, "structural");
            await restoreMetricsAfterRejectedAttempt(failedMetricsMessage);
            return {
              status: "failure",
              error: failedMetricsMessage,
              toolCallsUsed: preflightToolCallsUsed + primaryAttemptsUsed
            };
          }
          const sentinelFindings = detectSentinelWatchdogFindings(parsedMetrics);
          watchdog = setSentinelFindings(watchdog, sentinelFindings);
          if (sentinelFindings.some((finding) => finding.severity === "fail")) {
            const sentinelMessage = sentinelFindings.map((finding) => finding.message).join(" ");
            await persistPanelState();
            await persistRunVerifierReport(
              run,
              runContext,
              buildRunVerifierReport({
                status: "fail",
                trigger,
                stage: "metrics",
                summary: sentinelMessage,
                command: primaryCommand,
                cwd: resolved.cwd,
                metricsPath: resolved.metricsPath,
                exitCode: obs.exit_code ?? 0,
                stdout: obs.stdout,
                stderr: sentinelMessage,
                logFile,
                suggestedNextAction:
                  "Repair the metrics writer so NaN/Inf-like outputs are removed before the run is accepted."
              })
            );
            await persistRunFailureState(runContext, {
              command: primaryCommand,
              cwd: resolved.cwd,
              logFile,
              exitCode: obs.exit_code ?? 0,
              error: sentinelMessage
            });
            await recordRunFailure(sentinelMessage, "structural");
            await restoreMetricsAfterRejectedAttempt(sentinelMessage);
            return {
              status: "failure",
              error: sentinelMessage,
              toolCallsUsed: preflightToolCallsUsed + primaryAttemptsUsed
            };
          }
          const preflightOnlyMessage = detectPreflightOnlyMetrics(parsedMetrics);
          if (preflightOnlyMessage) {
            await persistPanelState();
            await persistRunVerifierReport(
              run,
              runContext,
              buildRunVerifierReport({
                status: "fail",
                trigger,
                stage: "metrics",
                summary: preflightOnlyMessage,
                command: primaryCommand,
                cwd: resolved.cwd,
                metricsPath: resolved.metricsPath,
                exitCode: obs.exit_code ?? 0,
                stdout: obs.stdout,
                stderr: preflightOnlyMessage,
                logFile,
                suggestedNextAction:
                  "Run the actual bounded experiment command so metrics.json contains executed task metrics, not only environment readiness data."
              })
            );
            await persistRunFailureState(runContext, {
              command: primaryCommand,
              cwd: resolved.cwd,
              logFile,
              exitCode: obs.exit_code ?? 0,
              error: preflightOnlyMessage
            });
            await recordRunFailure(preflightOnlyMessage, "structural");
            await restoreMetricsAfterRejectedAttempt(preflightOnlyMessage);
            return {
              status: "failure",
              error: preflightOnlyMessage,
              toolCallsUsed: preflightToolCallsUsed + primaryAttemptsUsed
            };
          }
          rerunDecision = {
            decision: "not_needed",
            reason:
              primaryAttemptsUsed > 1
                ? `The primary command succeeded on retry attempt ${attemptNumber}.`
                : "The primary command succeeded without requiring an automatic rerun."
          };
          await persistPanelState();
          break;
        } catch (error) {
          const metricsError = `Experiment produced invalid metrics JSON at ${resolved.metricsPath}: ${
            error instanceof Error ? error.message : String(error)
          }`;
          const triage = classifyRunExperimentsFailure({
            attempt: attemptNumber,
            stage: "metrics",
            summary: metricsError,
            command: primaryCommand,
            cwd: resolved.cwd,
            exitCode: obs.exit_code ?? 0,
            logFile,
            metricsPath: resolved.metricsPath
          });
          triageAttempts.push(triage);
          watchdog = setMetricsState(watchdog, "invalid", logFile);
          rerunDecision = decideRunExperimentsRerun({
            triage,
            automaticRerunsUsed
          });
          await persistPanelState();
          const report = buildRunVerifierReport({
            status: "fail",
            trigger,
            stage: "metrics",
            summary: metricsError,
            command: primaryCommand,
            cwd: resolved.cwd,
            metricsPath: resolved.metricsPath,
            exitCode: obs.exit_code ?? 0,
            stdout: obs.stdout,
            stderr: metricsError,
            logFile,
            suggestedNextAction:
              "Ensure the experiment writes valid JSON metrics objects to the required metrics path before finishing."
          });
          deps.eventStream.emit({
            type: "TEST_FAILED",
            runId: run.id,
            node: "run_experiments",
            agentRole: "runner",
            payload: {
              command: primaryCommand,
              metrics_path: resolved.metricsPath,
              stderr: metricsError
            }
          });
          await persistRunVerifierReport(run, runContext, report);
          await persistRunFailureState(runContext, {
            command: primaryCommand,
            cwd: resolved.cwd,
            logFile,
            exitCode: obs.exit_code ?? 0,
            error: metricsError
          });
          await persistGovernanceCrash({
            run,
            runContext,
            comparisonContract,
            implementationContext,
            objectiveMetricName: run.objectiveMetric,
            rationale: report.summary,
            resourceUsage: {
              stage: "metrics",
              command: primaryCommand,
              cwd: resolved.cwd,
              exit_code: obs.exit_code ?? 0,
              log_file: logFile,
              metrics_path: resolved.metricsPath
            }
          });
          await recordRunFailure(metricsError, "structural");
          await restoreMetricsAfterRejectedAttempt(metricsError);
          return {
            status: "failure",
            error: metricsError,
            toolCallsUsed: preflightToolCallsUsed + primaryAttemptsUsed
          };
        }
      }

      const objectiveProfile =
        getGovernedObjectiveProfile(comparisonContract, run.objectiveMetric) ||
        (await resolveObjectiveMetricProfile({
          run,
          runContextMemory: runContext,
          llm: deps.llm,
          eventStream: deps.eventStream,
          node: "run_experiments"
        }));
      const objectiveEvaluation = evaluateObjectiveMetric(
        parsedMetrics,
        objectiveProfile,
        run.objectiveMetric
      );
      objectiveEvaluationSummary = objectiveEvaluation.summary;
      await writeRunArtifact(run, "metrics.json", JSON.stringify(parsedMetrics, null, 2));
      await writeRunArtifact(run, "objective_evaluation.json", JSON.stringify(objectiveEvaluation, null, 2));
      const metricsContractIssues = validateRunMetricsContract({
        metrics: parsedMetrics,
        objectiveEvaluation,
        comparisonContract,
        briefSections,
        experimentPortfolio
      });
      if (metricsContractIssues.length > 0) {
        const contractMessage = appendExperimentFailureArtifactEvidence(
          appendMetricsFailureEvidence(
            `Experiment metrics contract failed: ${metricsContractIssues.join(" ")}`,
            parsedMetrics
          ),
          await loadExperimentFailureArtifactSummary(resolved.cwd)
        ) || `Experiment metrics contract failed: ${metricsContractIssues.join(" ")}`;
        await persistPanelState();
        const report = buildRunVerifierReport({
          status: "fail",
          trigger,
          stage: "metrics",
          summary: contractMessage,
          command: primaryCommand,
          cwd: resolved.cwd,
          metricsPath: resolved.metricsPath,
          exitCode: obs?.exit_code ?? 0,
          stdout: obs?.stdout,
          stderr: contractMessage,
          logFile,
          suggestedNextAction:
            "Repair the experiment implementation so completed metrics include the configured objective metric and successful baseline/comparator results before analysis proceeds."
        });
        deps.eventStream.emit({
          type: "TEST_FAILED",
          runId: run.id,
          node: "run_experiments",
          agentRole: "runner",
          payload: {
            command: primaryCommand,
            metrics_path: resolved.metricsPath,
            stderr: contractMessage
          }
        });
        await persistRunVerifierReport(run, runContext, report);
        await persistRunFailureState(runContext, {
          command: primaryCommand,
          cwd: resolved.cwd,
          logFile,
          exitCode: obs?.exit_code ?? 0,
          error: contractMessage
        });
        await persistGovernanceCrash({
          run,
          runContext,
          comparisonContract,
          implementationContext,
          objectiveMetricName: run.objectiveMetric,
          rationale: report.summary,
          resourceUsage: {
            stage: "metrics",
            command: primaryCommand,
            cwd: resolved.cwd,
            exit_code: obs?.exit_code ?? 0,
            log_file: logFile,
            metrics_path: resolved.metricsPath,
            objective_evaluation_status: objectiveEvaluation.status
          }
        });
        await recordRunFailure(contractMessage, "structural");
        await restoreMetricsAfterRejectedAttempt(contractMessage);
        return {
          status: "failure",
          error: contractMessage,
          toolCallsUsed: preflightToolCallsUsed + primaryAttemptsUsed
        };
      }
      if (comparisonContract) {
        const managedBundleLock = await freezeManagedBundleLock({
          contract: comparisonContract,
          workspaceRoot: process.cwd(),
          publicDir:
            managedSupplementalPlan?.publicDir ||
            resolveMaybeRelative(await runContext.get<string>("implement_experiments.public_dir"), process.cwd()) ||
            undefined
        });
        if (managedBundleLock) {
          await storeExperimentGovernanceDecision(run, runContext, {
            managedBundleLock,
            entries: []
          });
        } else if (comparisonContract.budget_profile.mode === "managed_standard") {
          deps.eventStream.emit({
            type: "OBS_RECEIVED",
            runId: run.id,
            node: "run_experiments",
            agentRole: "runner",
            payload: {
              text: "Managed standard run completed without a frozen evaluator/environment lock; analyze_results will treat the candidate as non-comparable until the bundle artifacts are restored."
            }
          });
        }
      }
      await persistRunVerifierReport(
        run,
        runContext,
        buildRunVerifierReport({
          status: "pass",
          trigger,
          stage: "success",
          summary: objectiveEvaluation.summary,
          command: primaryCommand,
          cwd: resolved.cwd,
          metricsPath: resolved.metricsPath,
          exitCode: obs?.exit_code ?? 0,
          stdout: obs?.stdout,
          stderr: obs?.stderr,
          logFile
        })
      );
      const supplementalRuns = await maybeRunManagedSupplementalProfiles({
        deps,
        run,
        runContext,
        objectiveProfile,
        objectiveEvaluation,
        primaryCommand,
        plan: managedSupplementalPlan,
        abortSignal
      });
      for (const record of supplementalRuns.records.filter((item) => item.status === "fail")) {
        triageAttempts.push(
          classifyRunExperimentsFailure({
            attempt: primaryAttemptsUsed + triageAttempts.length + 1,
            stage: "supplemental",
            summary: record.summary,
            command: record.command,
            cwd: record.cwd,
            exitCode: record.exit_code,
            logFile: record.log_file,
            metricsPath: record.metrics_path
          })
        );
      }
      watchdog = recordSupplementalOutputs(
        watchdog,
        supplementalRuns.records.map((record) => ({
          profile: record.profile,
          status: record.status,
          metrics_path: record.metrics_path
        }))
      );
      await persistPanelState();

      await runContext.put("run_experiments.command", primaryCommand);
      await runContext.put("run_experiments.cwd", resolved.cwd);
      await runContext.put("run_experiments.last_log_file", logFile);
      await runContext.put("run_experiments.exit_code", obs?.exit_code ?? 0);
      await runContext.put("run_experiments.last_error", undefined);
      await runContext.put(EXPERIMENT_GOVERNANCE_CONTRACT_KEY, comparisonContract || null);
      await runContext.put("objective_metric.last_evaluation", objectiveEvaluation);
      await runContext.put("run_experiments.supplemental_runs", supplementalRuns.records);
      await runContext.put("run_experiments.supplemental_summary", supplementalRuns.summary || null);
      await runContext.put("run_experiments.supplemental_expectation", supplementalRuns.expectation || null);
      const matrixTrialGroups = await materializeManagedMatrixTrialGroupArtifacts({
        run,
        portfolio: experimentPortfolio,
        primaryCommand,
        primaryCwd: resolved.cwd,
        primaryMetricsPath: resolved.metricsPath,
        primaryMetrics: parsedMetrics,
        primarySummary: objectiveEvaluation.summary,
        supplementalRuns: supplementalRuns.records
      });
      const runManifest = buildExperimentRunManifest({
        runId: run.id,
        portfolio: experimentPortfolio,
        executionModel: managedSupplementalPlan?.kind || experimentPortfolio.execution_model,
        primaryCommand,
        primaryCwd: resolved.cwd,
        primaryMetricsPath: resolved.metricsPath,
        primaryMetrics: parsedMetrics,
        objectiveEvaluation,
        comparisonMode: comparisonContract?.comparison_mode,
        supplementalRuns: supplementalRuns.records,
        executedTrialGroups: matrixTrialGroups
      });
      await runContext.put("run_experiments.portfolio", runManifest.portfolio);
      await runContext.put("run_experiments.matrix_trial_groups", matrixTrialGroups);
      await runContext.put("run_experiments.run_manifest", runManifest);
      await writeRunArtifact(
        run,
        "run_experiments_supplemental_runs.json",
        JSON.stringify(supplementalRuns.records, null, 2)
      );
      await writeRunArtifact(
        run,
        "run_experiments_supplemental_expectation.json",
        JSON.stringify(supplementalRuns.expectation || null, null, 2)
      );
      await writeRunArtifact(
        run,
        "run_experiments_matrix_trial_groups.json",
        JSON.stringify(matrixTrialGroups, null, 2)
      );
      await writeRunArtifact(run, "experiment_portfolio.json", JSON.stringify(runManifest.portfolio, null, 2));
      await writeRunArtifact(run, "run_manifest.json", JSON.stringify(runManifest, null, 2));
      const publicSummaryProjection = await materializeRunExperimentPublicSummaryProjection({
        run,
        metrics: parsedMetrics,
        objectiveEvaluation,
        metricsPath: resolved.metricsPath,
        command: primaryCommand,
        cwd: resolved.cwd
      });
      const publicOutputs = await publishRunExperimentOutputs({
        workspaceRoot: process.cwd(),
        run,
        runContext,
        metricsPath: resolved.metricsPath,
        supplementalPlan: managedSupplementalPlan,
        matrixTrialGroups,
        publicSummaryProjection
      });

      deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "run_experiments",
        agentRole: "runner",
        payload: {
          text: `${formatRunLabel(experimentMode, trigger)} completed. Metrics written to ${resolved.metricsPath}`
        }
      });
      deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "run_experiments",
        agentRole: "runner",
        payload: {
          text: objectiveEvaluation.summary
        }
      });
      deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "run_experiments",
        agentRole: "runner",
        payload: {
          text: `Public experiment outputs are available at ${publicOutputs.sectionDirRelative}.`
        }
      });

      return {
        status: "success",
        summary: `${formatRunLabel(experimentMode, trigger)} completed via ${primaryCommand}. ${objectiveEvaluationSummary}${
          supplementalRuns.summary ? ` ${supplementalRuns.summary}` : ""
        } Public outputs: ${publicOutputs.outputRootRelative}.`,
        needsApproval: true,
        toolCallsUsed: preflightToolCallsUsed + primaryAttemptsUsed + supplementalRuns.toolCallsUsed
      };
  }
};
}

function detectSentinelWatchdogFindings(
  metrics: Record<string, unknown>
): Array<{
  code: "nan_or_inf_metric" | "statistical_anomaly" | "citation_reliability_anomaly";
  severity: "warning" | "fail";
  message: string;
  requires_human_review: boolean;
  downgrade_to_unverified?: boolean;
}> {
  const findings: Array<{
    code: "nan_or_inf_metric" | "statistical_anomaly" | "citation_reliability_anomaly";
    severity: "warning" | "fail";
    message: string;
    requires_human_review: boolean;
    downgrade_to_unverified?: boolean;
  }> = [];
  const flat = flattenMetricValues(metrics);

  for (const entry of flat) {
    if (typeof entry.value === "string" && /^(nan|inf|-inf|infinity|-infinity)$/iu.test(entry.value.trim())) {
      findings.push({
        code: "nan_or_inf_metric",
        severity: "fail",
        message: `Sentinel watchdog blocked the run because ${entry.path} resolved to ${entry.value}.`,
        requires_human_review: true
      });
      return findings;
    }
  }

  for (const entry of flat) {
    if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) {
      continue;
    }
    if (/(accuracy|f1|precision|recall|auc|success_rate|pass_rate|win_rate|p_value)$/iu.test(entry.path)) {
      if (entry.value < 0 || entry.value > 1) {
        findings.push({
          code: "statistical_anomaly",
          severity: "warning",
          message: `Sentinel watchdog flagged ${entry.path}=${entry.value}, which falls outside the expected [0, 1] range.`,
          requires_human_review: true
        });
      }
    }
    if (/(citation_reliability|citation_confidence)$/iu.test(entry.path) && entry.value < 0.5) {
      findings.push({
        code: "citation_reliability_anomaly",
        severity: "warning",
        message: `Sentinel watchdog flagged low citation reliability at ${entry.path}=${entry.value}.`,
        requires_human_review: true,
        downgrade_to_unverified: true
      });
    }
  }

  return findings;
}

function detectFailedMetricsPayload(metrics: Record<string, unknown>): string | null {
  const status = typeof metrics.status === "string" ? metrics.status.trim().toLowerCase() : "";
  const success = metrics.success;
  const failure = metrics.failure && typeof metrics.failure === "object" && !Array.isArray(metrics.failure)
    ? metrics.failure as Record<string, unknown>
    : undefined;
  const directErrorMessage = typeof metrics.error === "string" && metrics.error.trim()
    ? metrics.error.trim()
    : undefined;
  const errorRecord = asRecord(metrics.error);
  const nestedErrorMessage = asString(errorRecord.message) || asString(errorRecord.error);
  const nestedErrorType = asString(errorRecord.type);
  const failureMessage =
    typeof failure?.message === "string" && failure.message.trim()
      ? failure.message.trim()
      : typeof metrics.error_message === "string" && metrics.error_message.trim()
        ? metrics.error_message.trim()
        : directErrorMessage ||
          (nestedErrorMessage
            ? `${nestedErrorType ? `${nestedErrorType}: ` : ""}${nestedErrorMessage}`
            : undefined);

  if (["failed", "failure", "error", "errored"].includes(status)) {
    return appendMetricsFailureEvidence(
      `Experiment metrics payload reports failed status${failureMessage ? `: ${failureMessage}` : "."}`,
      metrics
    );
  }
  if (success === false) {
    return appendMetricsFailureEvidence(
      `Experiment metrics payload reports success=false${failureMessage ? `: ${failureMessage}` : "."}`,
      metrics
    );
  }
  const conditionDependencyBlocker = detectConditionDependencyBlocker(metrics);
  if (conditionDependencyBlocker) {
    return conditionDependencyBlocker;
  }
  const recipes = asRecord(metrics.recipes);
  const failedRecipeSummaries = Object.entries(recipes)
    .filter(([, recipe]) => {
      const recipeRecord = asRecord(recipe);
      const recipeStatus = typeof recipeRecord.status === "string" ? recipeRecord.status.trim().toLowerCase() : "";
      return ["failed", "failure", "error", "errored"].includes(recipeStatus);
    })
    .map(([name, recipe]) => {
      const recipeRecord = asRecord(recipe);
      const recipeError = typeof recipeRecord.error === "string" && recipeRecord.error.trim()
        ? recipeRecord.error.trim()
        : undefined;
      return recipeError ? `${name}: ${recipeError}` : name;
    });
  if (failedRecipeSummaries.length > 0) {
    return `Experiment metrics payload reports failed recipe(s): ${failedRecipeSummaries.join("; ")}.`;
  }
  return null;
}

async function loadFailedMetricsSummary(
  metricsPath: string | undefined,
  artifactDir?: string
): Promise<string | undefined> {
  if (!metricsPath || !(await fileExists(metricsPath))) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await fs.readFile(metricsPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return appendExperimentFailureArtifactEvidence(
      detectFailedMetricsPayload(parsed as Record<string, unknown>) || undefined,
      await loadExperimentFailureArtifactSummary(artifactDir)
    );
  } catch {
    return undefined;
  }
}

function appendExperimentFailureArtifactEvidence(
  message: string | null | undefined,
  artifactSummary: string | undefined
): string | undefined {
  if (!message) {
    return undefined;
  }
  return artifactSummary ? `${message} ${artifactSummary}` : message;
}

async function loadExperimentFailureArtifactSummary(artifactDir: string | undefined): Promise<string | undefined> {
  if (!artifactDir) {
    return undefined;
  }
  const summaries: string[] = [];
  const studyFailurePath = path.join(artifactDir, "study_failure.json");
  const studyFailuresPath = path.join(artifactDir, "study_failures.json");
  const studyFailure = await readJsonRecordIfExists(studyFailurePath);
  if (studyFailure) {
    const summary = summarizeFailureRecord("study_failure.json", studyFailure);
    if (summary) {
      summaries.push(summary);
    }
  }
  const studyFailures = await readJsonArrayIfExists(studyFailuresPath);
  for (const failure of studyFailures.slice(0, 2)) {
    const summary = summarizeFailureRecord("study_failures.json", failure);
    if (summary) {
      summaries.push(summary);
    }
  }
  return summaries.length > 0 ? `Failure artifact evidence: ${summaries.join(" | ")}.` : undefined;
}

async function readJsonRecordIfExists(filePath: string): Promise<Record<string, unknown> | undefined> {
  if (!(await fileExists(filePath))) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

async function readJsonArrayIfExists(filePath: string): Promise<Record<string, unknown>[]> {
  if (!(await fileExists(filePath))) {
    return [];
  }
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : [];
  } catch {
    return [];
  }
}

function summarizeFailureRecord(label: string, failure: Record<string, unknown>): string | undefined {
  const error = asString(failure.error) || asString(failure.message);
  const type = asString(failure.type);
  const tracebackTail = tracebackLastLine(asString(failure.traceback));
  const parts = [
    `${label}`,
    type ? `type=${trimShort(type, 80)}` : undefined,
    error ? `error=${trimShort(error, 220)}` : undefined,
    tracebackTail && tracebackTail !== error ? `traceback_tail=${trimShort(tracebackTail, 220)}` : undefined
  ].filter((part): part is string => Boolean(part));
  return parts.length > 1 ? parts.join("; ") : undefined;
}

function trimShort(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 1))}...` : compact;
}

function tracebackLastLine(traceback: string | undefined): string | undefined {
  if (!traceback) {
    return undefined;
  }
  const lines = traceback
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1);
}

function appendMetricsFailureEvidence(message: string, metrics: Record<string, unknown>): string {
  const evidence = summarizeMetricsFailureEvidence(metrics);
  return evidence ? `${message} ${evidence}` : message;
}

function summarizeMetricsFailureEvidence(metrics: Record<string, unknown>): string {
  const parts: string[] = [];
  const requiredRunCount = asNumber(metrics.required_run_count);
  const completedRunCount = asNumber(metrics.completed_run_count);
  if (requiredRunCount !== undefined && completedRunCount !== undefined) {
    parts.push(`completed_run_count=${completedRunCount}/${requiredRunCount}`);
  }

  const requiredConditionCount = asNumber(metrics.required_condition_count);
  const completedConditionCount = asNumber(metrics.completed_condition_count);
  if (requiredConditionCount !== undefined && completedConditionCount !== undefined) {
    parts.push(`completed_condition_count=${completedConditionCount}/${requiredConditionCount}`);
  }

  const failureCount = asNumber(metrics.failure_count) ?? asNumber(metrics.failed_run_count);
  if (failureCount !== undefined) {
    parts.push(`failure_count=${failureCount}`);
  }

  if (Object.prototype.hasOwnProperty.call(metrics, "selected_model") && metrics.selected_model == null) {
    parts.push("selected_model=null");
  }
  const selectedModelId = asString(metrics.selected_model_id);
  if (selectedModelId) {
    parts.push(`selected_model_id=${trimShort(selectedModelId, 120)}`);
  }

  const directErrorMessage = typeof metrics.error === "string" && metrics.error.trim()
    ? metrics.error.trim()
    : undefined;
  const errorRecord = asRecord(metrics.error);
  const nestedErrorMessage = asString(errorRecord.message) || asString(errorRecord.error);
  if (directErrorMessage || nestedErrorMessage) {
    const nestedErrorType = asString(errorRecord.type);
    const errorText = directErrorMessage || `${nestedErrorType ? `${nestedErrorType}: ` : ""}${nestedErrorMessage}`;
    parts.push(`metrics_error=${trimShort(errorText, 220)}`);
  }

  const evidenceMessages = summarizeMetricsEvidenceRecords(metrics);
  if (evidenceMessages.length > 0) {
    parts.push(`metrics_evidence=${evidenceMessages.join(" | ")}`);
  }

  const seedFailureMessages = summarizeSeedFailureMessages(metrics);
  if (seedFailureMessages.length > 0) {
    parts.push(`seed_failure_messages=${seedFailureMessages.join(" | ")}`);
  }

  parts.push(...summarizePrimaryMetricValueEvidence(metrics));
  parts.push(...summarizeConditionResultFailureEvidence(metrics));

  const observedConditionCount = asNumber(metrics.observed_condition_count);
  if (observedConditionCount !== undefined) {
    parts.push(`observed_condition_count=${observedConditionCount}`);
  }

  const missingMarkers = Array.isArray(metrics.missing_required_condition_markers)
    ? metrics.missing_required_condition_markers.filter((marker): marker is string => typeof marker === "string")
    : [];
  if (missingMarkers.length > 0) {
    parts.push(`missing_required_condition_markers=${missingMarkers.slice(0, 8).join(",")}`);
  }

  const conditionResultsPath = asString(metrics.condition_results_path);
  if (conditionResultsPath) {
    parts.push(`condition_results_path=${conditionResultsPath}`);
  }

  return parts.length > 0 ? `Metrics evidence: ${parts.join("; ")}.` : "";
}

function summarizeMetricsEvidenceRecords(metrics: Record<string, unknown>): string[] {
  const evidence = Array.isArray(metrics.evidence) ? metrics.evidence : [];
  const summaries: string[] = [];
  for (const item of evidence) {
    if (summaries.length >= 2) {
      break;
    }
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const kind = asString(record.kind) || asString(record.type);
    const message =
      asString(record.message) ||
      asString(record.error) ||
      asString(asRecord(record.error)?.message);
    const tracebackTail = tracebackLastLine(asString(record.traceback));
    const summary = [
      kind ? trimShort(kind, 80) : undefined,
      message ? trimShort(message, 220) : undefined,
      tracebackTail && tracebackTail !== message ? trimShort(tracebackTail, 220) : undefined
    ].filter((part): part is string => Boolean(part)).join(": ");
    if (summary) {
      summaries.push(summary);
    }
  }
  return summaries;
}

function summarizePrimaryMetricValueEvidence(metrics: Record<string, unknown>): string[] {
  const objective = asRecord(metrics.objective);
  const primaryMetric = asRecord(metrics.primary_metric);
  const keys = [
    asString(metrics.primary_metric_key),
    asString(objective.primary_metric_key),
    asString(primaryMetric.name)
  ].filter((key): key is string => Boolean(key));
  const uniqueKeys = [...new Set(keys)];
  const parts: string[] = [];
  for (const key of uniqueKeys.slice(0, 2)) {
    if (Object.prototype.hasOwnProperty.call(metrics, key)) {
      if (asNumber(metrics[key]) === undefined) {
        parts.push(`primary_metric_value=${trimShort(key, 100)}:${describeMetricValue(metrics[key])}`);
      }
      continue;
    }
    parts.push(`primary_metric_value=${trimShort(key, 100)}:missing`);
  }
  return parts;
}

function describeMetricValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "missing";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "object") {
    return "object";
  }
  if (typeof value === "string") {
    return value.trim() ? "non_numeric_string" : "empty_string";
  }
  return typeof value;
}

function summarizeConditionResultFailureEvidence(metrics: Record<string, unknown>): string[] {
  const study = asRecord(metrics.study);
  const studySummary = asRecord(metrics.study_summary);
  const conditionRows = [
    ...collectConditionRows(metrics.condition_results),
    ...collectConditionRows(metrics.conditions),
    ...collectConditionRows(study.condition_results),
    ...collectConditionRows(study.conditions),
    ...collectConditionRows(studySummary.condition_results),
    ...collectConditionRows(studySummary.conditions)
  ];
  if (conditionRows.length === 0) {
    return [];
  }

  const statusCounts = new Map<string, number>();
  const reasonCounts = new Map<string, number>();
  const sampleFailures: string[] = [];
  for (const row of conditionRows) {
    const status = normalizeConditionResultStatus(row);
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    if (isCompletedConditionStatus(status)) {
      continue;
    }
    const reason = conditionResultReason(row);
    if (reason) {
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }
    if (sampleFailures.length < 2) {
      const id =
        asString(row.condition_marker) ||
        asString(row.marker) ||
        asString(row.condition_id) ||
        asString(row.condition) ||
        asString(row.name);
      const sample = [
        id ? trimShort(id, 80) : "unlabeled_condition",
        `status=${status}`,
        reason ? `reason=${trimShort(reason, 120)}` : undefined
      ].filter((part): part is string => Boolean(part)).join(",");
      sampleFailures.push(sample);
    }
  }

  const parts = [`condition_result_statuses=${formatCountMap(statusCounts, 6)}`];
  const formattedReasons = formatCountMap(reasonCounts, 4);
  if (formattedReasons) {
    parts.push(`condition_result_reasons=${formattedReasons}`);
  }
  if (sampleFailures.length > 0) {
    parts.push(`condition_result_samples=${sampleFailures.join(" | ")}`);
  }
  return parts;
}

function normalizeConditionResultStatus(row: Record<string, unknown>): string {
  const explicitStatus = asString(row.status)?.toLowerCase();
  if (explicitStatus) {
    return explicitStatus.replace(/\s+/gu, "_");
  }
  if (row.success === true || row.completed === true) {
    return "completed";
  }
  if (row.success === false || row.completed === false) {
    return "failed";
  }
  return "unknown";
}

function isCompletedConditionStatus(status: string): boolean {
  return ["completed", "complete", "success", "succeeded", "ok", "passed"].includes(status);
}

function conditionResultReason(row: Record<string, unknown>): string | undefined {
  const errorRecord = asRecord(row.error);
  const reason =
    asString(row.reason) ||
    asString(row.failure_reason) ||
    asString(row.error_message) ||
    asString(row.message) ||
    asString(errorRecord.message) ||
    asString(errorRecord.error) ||
    (typeof row.error === "string" ? row.error : undefined);
  return reason ? trimShort(reason, 160) : undefined;
}

function formatCountMap(counts: Map<string, number>, limit: number): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => `${trimShort(key, 80)}:${count}`)
    .join(",");
}

function summarizeSeedFailureMessages(metrics: Record<string, unknown>): string[] {
  const study = asRecord(metrics.study);
  const studySummary = asRecord(metrics.study_summary);
  const seedRows = [
    ...collectConditionRows(metrics.seed_results),
    ...collectConditionRows(metrics.per_seed_rows),
    ...collectConditionRows(metrics.per_seed_results),
    ...collectConditionRows(metrics.condition_seed_rows),
    ...collectConditionRows(metrics.per_run_results),
    ...collectConditionRows(metrics.run_results),
    ...collectConditionRows(study.seed_results),
    ...collectConditionRows(study.per_seed_rows),
    ...collectConditionRows(studySummary.seed_results)
  ];
  const counts = new Map<string, number>();
  for (const row of seedRows) {
    const status = asString(row.status)?.toLowerCase();
    if (status && !["failed", "failure", "error", "errored"].includes(status)) {
      continue;
    }
    const message =
      asString(row.error_message) ||
      asString(row.error) ||
      asString(row.message) ||
      asString(row.failure_reason);
    if (!message) {
      continue;
    }
    const type = asString(row.error_type);
    const stage = asString(row.error_stage);
    const signature = [
      type ? `${type}` : undefined,
      stage ? `stage=${stage}` : undefined,
      trimShort(message, 180)
    ].filter((part): part is string => Boolean(part)).join(": ");
    counts.set(signature, (counts.get(signature) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([message, count]) => `${message}${count > 1 ? ` (${count}x)` : ""}`);
}

function detectConditionDependencyBlocker(metrics: Record<string, unknown>): string | null {
  const conditionRows = [
    ...collectConditionRows(metrics.condition_results),
    ...collectConditionRows(metrics.conditions),
    ...collectConditionRows(asRecord(metrics.study).condition_results),
    ...collectConditionRows(asRecord(metrics.study).conditions)
  ];
  if (conditionRows.length === 0) {
    return null;
  }
  const failedRows = conditionRows.filter((row) => {
    const status = asString(row.status)?.toLowerCase();
    return ["failed", "failure", "error", "errored"].includes(status || "");
  });
  if (failedRows.length !== conditionRows.length) {
    return null;
  }

  const messages = failedRows.flatMap((row) => collectDiagnosticStrings(row));
  const combined = messages.join("\n");
  if (!isModelDependencyFailure(combined)) {
    return null;
  }

  const modelId = extractModelAssetId(combined);
  return [
    "Experiment dependency blocker:",
    `model asset ${modelId || "required model/tokenizer asset"} could not be loaded.`,
    "Prewarm/cache the model, allow required Hugging Face access, or select an available local model before retrying.",
    `No condition metrics were accepted as evidence (${failedRows.length}/${conditionRows.length} condition rows failed).`
  ].join(" ");
}

function collectConditionRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.map(asRecord).filter((row) => Object.keys(row).length > 0);
  }
  const record = asRecord(value);
  return Object.values(record).map(asRecord).filter((row) => Object.keys(row).length > 0);
}

function collectDiagnosticStrings(value: unknown, depth = 0): string[] {
  if (depth > 4) {
    return [];
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectDiagnosticStrings(item, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    if (!/(error|exception|trace|message|reason|evidence|diagnostic|stderr|failure|model|tokenizer|config)/iu.test(key)) {
      return [];
    }
    return collectDiagnosticStrings(nested, depth + 1);
  });
}

function isModelDependencyFailure(message: string): boolean {
  return (
    /can't\s+load\s+the\s+(?:configuration|config|tokenizer|model)\b/iu.test(message) ||
    /\bfrom_pretrained\b/iu.test(message) ||
    /\b(?:hugging\s*face|transformers)\b[\s\S]{0,160}\b(?:cache|config|tokenizer|model|download|access)\b/iu.test(message) ||
    /\bconfig\.json\b/iu.test(message) ||
    /\blocal\s+cache\b[\s\S]{0,120}\b(?:missing|unavailable|not\s+found|disabled)\b/iu.test(message)
  );
}

function extractModelAssetId(message: string): string | undefined {
  const quoted = message.match(/['"]([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)['"]/u)?.[1];
  if (quoted) {
    return quoted;
  }
  return message.match(/\bmodel(?:_id|[-_\s]name)?\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)/iu)?.[1];
}

function flattenMetricValues(
  value: unknown,
  prefix = ""
): Array<{ path: string; value: unknown }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenMetricValues(item, prefix ? `${prefix}[${index}]` : `[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) =>
      flattenMetricValues(nested, prefix ? `${prefix}.${key}` : key)
    );
  }
  return [{ path: prefix || "value", value }];
}

async function resolveManagedSupplementalPlan(
  runContext: RunContextMemory,
  workspaceRoot: string
): Promise<ManagedSupplementalPlan | undefined> {
  const experimentMode = (await runContext.get<string>("implement_experiments.mode")) || "real_execution";
  if (experimentMode !== "real_execution") {
    return undefined;
  }

  const publicDir = resolveMaybeRelative(await runContext.get<string>("implement_experiments.public_dir"), workspaceRoot);
  const scriptPath = resolveMaybeRelative(await runContext.get<string>("implement_experiments.script"), workspaceRoot);
  const primaryWorkingDir =
    resolveMaybeRelative(await runContext.get<string>("implement_experiments.cwd"), workspaceRoot) || workspaceRoot;
  const explicitCommand = await runContext.get<string>("implement_experiments.run_command");
  if (!publicDir || !scriptPath) {
    return undefined;
  }

  const manifestPath = path.join(publicDir, "artifact_manifest.json");
  const scriptText = await readOptionalText(scriptPath);
  const commandSurface = explicitCommand || "";
  const supportsManagedProfiles =
    scriptText.includes("--quick-check") &&
    scriptText.includes("--profile") &&
    scriptText.includes("--metrics-out");
  const explicitManagedProfileCommand =
    commandSurface.includes("--profile") &&
    commandSurface.includes("--metrics-out") &&
    path.basename(scriptPath).length > 0;
  if (await fileExists(manifestPath) && (await fileExists(scriptPath)) && (supportsManagedProfiles || explicitManagedProfileCommand)) {
    return {
      kind: "managed_bundle",
      publicDir,
      profiles: [
        {
          profile: "quick_check",
          command: `python3 -B ${JSON.stringify(scriptPath)} --quick-check --metrics-out ${JSON.stringify(
            path.join(publicDir, "quick_check_metrics.json")
          )}`,
          metricsPath: path.join(publicDir, "quick_check_metrics.json"),
          workingDir: publicDir
        },
        {
          profile: "confirmatory",
          command: `python3 -B ${JSON.stringify(scriptPath)} --profile confirmatory --metrics-out ${JSON.stringify(
            path.join(publicDir, "confirmatory_metrics.json")
          )}`,
          metricsPath: path.join(publicDir, "confirmatory_metrics.json"),
          workingDir: publicDir
        }
      ]
    };
  }

  if (!(await fileExists(scriptPath)) || !explicitCommand) {
    return undefined;
  }

  const quickCheckMetricsPath = path.join(publicDir, "quick_check_metrics.json");
  const confirmatoryMetricsPath = path.join(publicDir, "confirmatory_metrics.json");
  const quickCheckCommand = deriveLegacySupplementalCommand({
    primaryCommand: explicitCommand,
    metricsPath: quickCheckMetricsPath,
    profile: "quick_check",
    primaryWorkingDir,
    scriptPath,
    seedOnly: supportsSeedOnlyLegacySupplemental(scriptText)
  });
  const confirmatoryCommand = deriveLegacySupplementalCommand({
    primaryCommand: explicitCommand,
    metricsPath: confirmatoryMetricsPath,
    profile: "confirmatory",
    primaryWorkingDir,
    scriptPath,
    seedOnly: supportsSeedOnlyLegacySupplemental(scriptText)
  });
  if (!quickCheckCommand || !confirmatoryCommand) {
    return undefined;
  }

  return {
    kind: "legacy_python_runner",
    publicDir,
    profiles: [
      {
        profile: "quick_check",
        command: quickCheckCommand,
        metricsPath: quickCheckMetricsPath,
        workingDir: primaryWorkingDir
      },
      {
        profile: "confirmatory",
        command: confirmatoryCommand,
        metricsPath: confirmatoryMetricsPath,
        workingDir: primaryWorkingDir
      }
    ]
  };
}

function deriveLegacySupplementalCommand(input: {
  primaryCommand: string;
  metricsPath: string;
  profile: SupplementalProfileName;
  primaryWorkingDir: string;
  scriptPath: string;
  seedOnly?: boolean;
}): string | undefined {
  const normalized = input.primaryCommand.trim();
  if (!/run_experiment\.py/u.test(normalized) && !input.seedOnly) {
    return undefined;
  }
  if (/--profile\s+\w+/u.test(normalized) || /--quick-check/u.test(normalized)) {
    return undefined;
  }

  let command = rewriteFlagValue(normalized, "--metrics-path", input.metricsPath);
  let metricsFlag = "--metrics-path";
  if (command === normalized && !input.seedOnly) {
    command = rewriteFlagValue(normalized, "--metrics-out", input.metricsPath);
    metricsFlag = "--metrics-out";
  }
  if (command === normalized && !new RegExp(`${escapeRegExp(metricsFlag)}(?:\\s|=)`, "u").test(normalized)) {
    if (/--metrics-path/u.test(normalized) || /--metrics-out/u.test(normalized)) {
      return undefined;
    }
    command = `${normalized} ${metricsFlag} ${JSON.stringify(input.metricsPath)}`;
  }

  const repeats = input.profile === "quick_check" ? "2" : "8";
  const seedBase = input.profile === "quick_check" ? "700" : "900";
  if (input.seedOnly) {
    command = rewriteFlagValue(command, "--seed", seedBase, true);
  } else {
    command = rewriteFlagValue(command, "--repeats", repeats, true);
    command = rewriteFlagValue(command, "--seed-base", seedBase, true);
  }
  return absolutizeLegacySupplementalCommand(command, input.primaryWorkingDir, input.scriptPath);
}

function supportsSeedOnlyLegacySupplemental(scriptText: string): boolean {
  return scriptText.includes("--seed") && scriptText.includes("--metrics-path");
}

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function rewriteFlagValue(command: string, flag: string, value: string, appendIfMissing = false): string {
  const quotedValue = JSON.stringify(value);
  const inlinePattern = new RegExp(`(${escapeRegExp(flag)}=)(\"[^\"]*\"|'[^']*'|\\S+)`, "u");
  if (inlinePattern.test(command)) {
    return command.replace(inlinePattern, `$1${quotedValue}`);
  }

  const spacedPattern = new RegExp(`(${escapeRegExp(flag)}\\s+)(\"[^\"]*\"|'[^']*'|\\S+)`, "u");
  if (spacedPattern.test(command)) {
    return command.replace(spacedPattern, `$1${quotedValue}`);
  }

  if (appendIfMissing) {
    return `${command} ${flag} ${quotedValue}`;
  }
  return command;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function absolutizeLegacySupplementalCommand(
  command: string,
  primaryWorkingDir: string,
  scriptPath: string
): string {
  let tokenIndex = 0;
  return command.replace(/"[^"]+"|'[^']+'|\S+/g, (rawToken) => {
    const token = unquoteShellToken(rawToken);
    let replacement: string | undefined;

    if (tokenIndex === 0 && token.includes("/") && !path.isAbsolute(token)) {
      replacement = path.resolve(primaryWorkingDir, token);
    } else if (/run_experiment\.py$/u.test(token) && !path.isAbsolute(token)) {
      replacement = scriptPath;
    }

    tokenIndex += 1;
    return replacement ? JSON.stringify(replacement) : rawToken;
  });
}

function unquoteShellToken(token: string): string {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return token.slice(1, -1);
    }
  }
  return token;
}

async function clearManagedSupplementalOutputs(
  run: Parameters<typeof writeRunArtifact>[0],
  profiles: ManagedSupplementalProfile[]
): Promise<string[]> {
  const backups: string[] = [];
  for (const profile of profiles) {
    const backupPath = await clearPreexistingMetricsOutput(run, profile.metricsPath);
    if (backupPath) {
      backups.push(path.basename(profile.metricsPath));
    }
  }
  return backups;
}

async function maybeRunManagedSupplementalProfiles(input: {
  deps: NodeExecutionDeps;
  run: Parameters<GraphNodeHandler["execute"]>[0]["run"];
  runContext: RunContextMemory;
  objectiveProfile: Awaited<ReturnType<typeof resolveObjectiveMetricProfile>>;
  objectiveEvaluation: ObjectiveMetricEvaluation;
  primaryCommand: string;
  plan?: ManagedSupplementalPlan;
  abortSignal?: AbortSignal;
}): Promise<{
  records: SupplementalRunRecord[];
  summary?: string;
  toolCallsUsed: number;
  expectation?: SupplementalExpectationArtifact;
}> {
  if (!input.plan) {
    return {
      records: [],
      toolCallsUsed: 0
    };
  }

  if (input.plan.kind === "managed_bundle" && !isManagedStandardRunCommand(input.primaryCommand)) {
    const records = input.plan.profiles.map((profile) => ({
      profile: profile.profile,
      status: "skipped" as const,
      metrics_path: profile.metricsPath,
      summary: "Skipped because the primary run command was not the managed standard profile."
    }));
    const summary = "Supplemental runs skipped because the primary run command was not the managed standard profile.";
    emitSupplementalObservation(input, summary);
    return {
      records,
      summary,
      toolCallsUsed: 0,
      expectation: {
        applicable: true,
        profiles: input.plan.profiles.map((profile) => profile.profile),
        reason: summary
      }
    };
  }

  if (!["met", "observed"].includes(input.objectiveEvaluation.status)) {
    const records = input.plan.profiles.map((profile) => ({
      profile: profile.profile,
      status: "skipped" as const,
      metrics_path: profile.metricsPath,
      summary: `Skipped because the primary objective status was ${input.objectiveEvaluation.status}.`
    }));
    const summary = `Supplemental runs skipped because the primary objective status was ${input.objectiveEvaluation.status}.`;
    emitSupplementalObservation(input, summary);
    return {
      records,
      summary,
      toolCallsUsed: 0,
      expectation: {
        applicable: true,
        profiles: input.plan.profiles.map((profile) => profile.profile),
        reason: summary
      }
    };
  }

  let toolCallsUsed = 0;
  const records: SupplementalRunRecord[] = [];
  const quickCheck = await runManagedSupplementalProfile({
    ...input,
    profile: input.plan.profiles[0]
  });
  toolCallsUsed += 1;
  if (input.plan.kind === "legacy_python_runner" && isLegacySupplementalUnsupported(quickCheck.summary)) {
    const summary =
      "Supplemental quick_check and confirmatory profiles are not supported by this legacy experiment runner; the repeated standard run is the complete executed design.";
    const records: SupplementalRunRecord[] = input.plan.profiles.map((profile) => ({
      profile: profile.profile,
      status: "skipped",
      command: profile.command,
      cwd: profile.workingDir,
      metrics_path: profile.metricsPath,
      summary
    }));
    emitSupplementalObservation(input, summary);
    return {
      records,
      summary,
      toolCallsUsed,
      expectation: {
        applicable: false,
        profiles: [],
        reason: summary
      }
    };
  }
  records.push(quickCheck);

  if (quickCheck.status !== "pass") {
    const confirmatoryProfile = input.plan.profiles[1];
    const skipped: SupplementalRunRecord = {
      profile: confirmatoryProfile.profile,
      status: "skipped",
      metrics_path: confirmatoryProfile.metricsPath,
      summary: `Skipped because ${quickCheck.profile} did not complete successfully.`
    };
    records.push(skipped);
    emitSupplementalObservation(input, skipped.summary);
  } else {
    const confirmatory = await runManagedSupplementalProfile({
      ...input,
      profile: input.plan.profiles[1]
    });
    toolCallsUsed += 1;
    records.push(confirmatory);
  }

  return {
    records,
    summary: summarizeSupplementalRuns(records),
    toolCallsUsed,
    expectation: {
      applicable: true,
      profiles: input.plan.profiles.map((profile) => profile.profile),
      reason: summarizeSupplementalRuns(records)
    }
  };
}

async function runManagedSupplementalProfile(input: {
  deps: NodeExecutionDeps;
  run: Parameters<GraphNodeHandler["execute"]>[0]["run"];
  objectiveProfile: Awaited<ReturnType<typeof resolveObjectiveMetricProfile>>;
  profile: ManagedSupplementalProfile;
  abortSignal?: AbortSignal;
}): Promise<SupplementalRunRecord> {
  input.deps.eventStream.emit({
    type: "TOOL_CALLED",
    runId: input.run.id,
    node: "run_experiments",
    agentRole: "runner",
    payload: {
      command: input.profile.command,
      cwd: input.profile.workingDir,
      source: `supplemental_${input.profile.profile}`
    }
  });

  const cwd = input.profile.workingDir;
  const obs = await input.deps.aci.runCommand(input.profile.command, cwd, input.abortSignal);
  const logFile = await writeRunArtifact(
    input.run,
    `exec_logs/run_experiments_${input.profile.profile}.txt`,
    [
      `command: ${input.profile.command}`,
      `cwd: ${cwd}`,
      `source: supplemental_${input.profile.profile}`,
      "",
      obs.stdout || "",
      obs.stderr || ""
    ].join("\n")
  );

  if (obs.status !== "ok") {
    const summary = `Supplemental ${input.profile.profile} run failed: ${obs.stderr || "command failed"}`;
    emitSupplementalObservation(input, summary);
    return {
      profile: input.profile.profile,
      status: "fail",
      command: input.profile.command,
      cwd,
      metrics_path: input.profile.metricsPath,
      summary,
      exit_code: obs.exit_code ?? 1,
      log_file: logFile
    };
  }

  if (!(await fileExists(input.profile.metricsPath))) {
    const summary = `Supplemental ${input.profile.profile} run did not produce metrics at ${input.profile.metricsPath}.`;
    emitSupplementalObservation(input, summary);
    return {
      profile: input.profile.profile,
      status: "fail",
      command: input.profile.command,
      cwd,
      metrics_path: input.profile.metricsPath,
      summary,
      exit_code: obs.exit_code ?? 0,
      log_file: logFile
    };
  }

  try {
    const raw = await fs.readFile(input.profile.metricsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("metrics.json must decode to an object");
    }
    const objectiveEvaluation = evaluateObjectiveMetric(
      parsed as Record<string, unknown>,
      input.objectiveProfile,
      input.run.objectiveMetric
    );
    const summary = `Supplemental ${input.profile.profile} completed. ${objectiveEvaluation.summary}`;
    emitSupplementalObservation(input, summary);
    return {
      profile: input.profile.profile,
      status: "pass",
      command: input.profile.command,
      cwd,
      metrics_path: input.profile.metricsPath,
      summary,
      exit_code: obs.exit_code ?? 0,
      log_file: logFile,
      objective_evaluation: objectiveEvaluation,
      sampling_profile: extractSamplingProfile(parsed as Record<string, unknown>)
    };
  } catch (error) {
    const summary = `Supplemental ${input.profile.profile} produced invalid metrics: ${
      error instanceof Error ? error.message : String(error)
    }`;
    emitSupplementalObservation(input, summary);
    return {
      profile: input.profile.profile,
      status: "fail",
      command: input.profile.command,
      cwd,
      metrics_path: input.profile.metricsPath,
      summary,
      exit_code: obs.exit_code ?? 0,
      log_file: logFile
    };
  }
}

function summarizeSupplementalRuns(records: SupplementalRunRecord[]): string | undefined {
  if (records.length === 0) {
    return undefined;
  }
  return `Supplemental runs: ${records
    .map((record) => `${record.profile} ${record.status}`)
    .join(", ")}.`;
}

function isLegacySupplementalUnsupported(summary: string | undefined): boolean {
  const normalized = (summary || "").toLowerCase();
  return (
    normalized.includes("unrecognized arguments:") &&
    (normalized.includes("--repeats") ||
      normalized.includes("--seed-base") ||
      normalized.includes("--quick-check") ||
      normalized.includes("--profile"))
  );
}

function emitSupplementalObservation(
  input:
    | {
        deps: NodeExecutionDeps;
        run: Parameters<GraphNodeHandler["execute"]>[0]["run"];
      }
    | {
        deps: NodeExecutionDeps;
        run: Parameters<GraphNodeHandler["execute"]>[0]["run"];
      },
  text: string
): void {
  input.deps.eventStream.emit({
    type: "OBS_RECEIVED",
    runId: input.run.id,
    node: "run_experiments",
    agentRole: "runner",
    payload: {
      text
    }
  });
}

async function recoverPublicBundleMetricsOutput(input: {
  runContext: RunContextMemory;
  workspaceRoot: string;
  metricsPath: string;
}): Promise<string | undefined> {
  if (await fileExists(input.metricsPath)) {
    return undefined;
  }
  const publicDir = resolveMaybeRelative(
    await input.runContext.get<string>("implement_experiments.public_dir"),
    input.workspaceRoot
  );
  if (!publicDir) {
    return undefined;
  }
  const candidates = [
    path.join(publicDir, "metrics.json"),
    path.join(publicDir, "study_results.json"),
    path.join(publicDir, "latest_metrics.json")
  ];
  for (const candidate of candidates) {
    if (candidate === input.metricsPath || !(await fileExists(candidate))) {
      continue;
    }
    const metrics = await readMetricsObject(candidate, input.workspaceRoot);
    if (!metrics || Object.keys(metrics).length === 0) {
      continue;
    }
    await fs.mkdir(path.dirname(input.metricsPath), { recursive: true });
    await fs.copyFile(candidate, input.metricsPath);
    return candidate;
  }
  return undefined;
}

async function clearPreexistingMetricsOutput(
  run: Parameters<typeof writeRunArtifact>[0],
  metricsPath: string
): Promise<string | undefined> {
  if (!(await fileExists(metricsPath))) {
    return undefined;
  }

  const existingMetrics = await fs.readFile(metricsPath, "utf8");
  const backupPath = await writeRunArtifact(
    run,
    `exec_logs/preexisting_metrics_${Date.now()}.json`,
    existingMetrics
  );
  await fs.unlink(metricsPath);
  return backupPath;
}

async function restorePreexistingMetricsOutput(input: {
  run: Parameters<typeof writeRunArtifact>[0];
  metricsPath: string;
  backupPath: string | undefined;
  reason: string;
}): Promise<string | undefined> {
  if (!input.backupPath || !(await fileExists(input.backupPath))) {
    return undefined;
  }

  if (await fileExists(input.metricsPath)) {
    const rejectedMetrics = await fs.readFile(input.metricsPath, "utf8");
    await writeRunArtifact(
      input.run,
      `exec_logs/rejected_metrics_${Date.now()}.json`,
      rejectedMetrics
    );
  }

  const previousMetrics = await fs.readFile(input.backupPath, "utf8");
  await fs.mkdir(path.dirname(input.metricsPath), { recursive: true });
  await fs.writeFile(input.metricsPath, previousMetrics, "utf8");
  await writeRunArtifact(
    input.run,
    `exec_logs/metrics_restore_${Date.now()}.json`,
    JSON.stringify({
      restored_from: input.backupPath,
      restored_to: input.metricsPath,
      reason: input.reason
    }, null, 2)
  );
  return input.backupPath;
}

async function clearPreexistingExperimentFailureArtifacts(
  run: Parameters<typeof writeRunArtifact>[0],
  artifactDir: string | undefined
): Promise<string[]> {
  if (!artifactDir) {
    return [];
  }

  const backups: string[] = [];
  for (const fileName of ["study_failure.json", "study_failures.json"]) {
    const filePath = path.join(artifactDir, fileName);
    if (!(await fileExists(filePath))) {
      continue;
    }
    const existingArtifact = await fs.readFile(filePath, "utf8");
    const backupPath = await writeRunArtifact(
      run,
      `exec_logs/preexisting_${fileName.replace(/\.json$/u, "")}_${Date.now()}.json`,
      existingArtifact
    );
    await fs.unlink(filePath);
    backups.push(backupPath);
  }
  return backups;
}

function isManagedStandardRunCommand(command: string): boolean {
  if (/--quick-check/u.test(command) || /--profile\s+confirmatory/u.test(command)) {
    return false;
  }
  return /--profile\s+standard/u.test(command);
}

function shouldForceFreshManagedStandardRun(input: {
  command: string;
  experimentMode: string;
  previousMetricsBackup?: string;
}): boolean {
  if (!input.previousMetricsBackup || input.experimentMode !== "real_execution") {
    return false;
  }
  if (!/run_experiment\.py/u.test(input.command)) {
    return false;
  }
  return isManagedStandardRunCommand(input.command) && !/\s--fresh(?:\s|$)/u.test(input.command);
}

function appendFreshFlag(command: string): string {
  return /\s--fresh(?:\s|$)/u.test(command) ? command : `${command} --fresh`;
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

function withModelDownloadEnvIfDeclared(
  command: string,
  config: NodeExecutionDeps["config"]
): string {
  if (
    config.experiments?.network_purpose !== "model_download" ||
    config.experiments?.network_policy === "blocked" ||
    /(^|\s)AUTOLABOS_ALLOW_MODEL_DOWNLOAD=/u.test(command)
  ) {
    return command;
  }
  return `AUTOLABOS_ALLOW_MODEL_DOWNLOAD=1 ${command}`;
}

function resolveRunExperimentsBudgetTimeoutSec(config: NodeExecutionDeps["config"]): number | undefined {
  const envTimeout = Number(process.env.AUTOLABOS_P6_NEXT_TIMEOUT_SEC || "");
  if (Number.isFinite(envTimeout) && envTimeout > 0) {
    return Math.floor(envTimeout);
  }
  const configTimeout = Number(config.experiments?.timeout_sec || 0);
  if (Number.isFinite(configTimeout) && configTimeout > 0) {
    return Math.floor(configTimeout);
  }
  return undefined;
}

async function appendPythonTimeoutArgIfAccepted(
  command: string,
  cwd: string,
  timeoutSec: number | undefined
): Promise<string> {
  if (!timeoutSec || /--(?:budget-)?timeout-sec\b/u.test(command)) {
    return command;
  }
  const scriptPath = extractPythonScriptPathFromCommand(command, cwd);
  if (!scriptPath || path.extname(scriptPath) !== ".py" || !(await fileExists(scriptPath))) {
    return command;
  }
  const source = await fs.readFile(scriptPath, "utf8");
  const acceptedFlags = extractPythonArgparseLongFlagsForRunCommand(source);
  if (acceptedFlags.has("--timeout-sec")) {
    return `${command} --timeout-sec ${timeoutSec}`;
  }
  if (acceptedFlags.has("--budget-timeout-sec")) {
    return `${command} --budget-timeout-sec ${timeoutSec}`;
  }
  return command;
}

function extractPythonArgparseLongFlagsForRunCommand(source: string): Set<string> {
  const flags = new Set<string>();
  const addArgumentPattern = /\badd_argument\s*\(([\s\S]*?)\)/gu;
  for (const match of source.matchAll(addArgumentPattern)) {
    const callText = match[1] || "";
    for (const flagMatch of callText.matchAll(/["'](--[a-z0-9][a-z0-9_-]*)["']/giu)) {
      flags.add(flagMatch[1].toLowerCase());
    }
  }
  return flags;
}

async function repairPythonRuntimeCompatibilityBeforeRun(input: {
  runContext: RunContextMemory;
  command: string;
  cwd: string;
  workspaceRoot: string;
}): Promise<{ repaired: boolean; message: string }> {
  const scriptPath =
    resolveMaybeRelative(await input.runContext.get<string>("implement_experiments.script"), input.workspaceRoot) ||
    extractPythonScriptPathFromCommand(input.command, input.cwd);
  if (!scriptPath || path.extname(scriptPath) !== ".py" || !(await fileExists(scriptPath))) {
    return { repaired: false, message: "" };
  }

  const messages: string[] = [];
  let repaired = false;

  const source = await fs.readFile(scriptPath, "utf8");
  const repairedSource = removeUnsupportedTrainingArgumentsKwargLines(source);
  if (repairedSource !== source) {
    await fs.writeFile(scriptPath, repairedSource, "utf8");
    repaired = true;
    messages.push(`Removed unsupported TrainingArguments kwarg(s) from ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const outputDirArgparseRepair = await repairPythonOutputDirArgparseAlias(scriptPath, input.command);
  if (outputDirArgparseRepair.repaired) {
    repaired = true;
    messages.push(outputDirArgparseRepair.message || `Added --output-dir argparse alias to ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const adjacentBackendDiscoveryRepair = await repairPythonAdjacentBackendDiscoverySurface(scriptPath);
  if (adjacentBackendDiscoveryRepair.repaired) {
    repaired = true;
    messages.push(adjacentBackendDiscoveryRepair.message || `Added adjacent backend implementation discovery in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const adjacentBackendAggregationSeedRowsRepair =
    await repairPythonAdjacentBackendAggregationSeedRowsSurface(scriptPath);
  if (adjacentBackendAggregationSeedRowsRepair.repaired) {
    repaired = true;
    messages.push(adjacentBackendAggregationSeedRowsRepair.message || `Added adjacent backend aggregation seed_rows alias in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const adjacentBackendConditionSummariesRepair =
    await repairPythonAdjacentBackendConditionSummariesMappingSurface(scriptPath);
  if (adjacentBackendConditionSummariesRepair.repaired) {
    repaired = true;
    messages.push(adjacentBackendConditionSummariesRepair.message || `Normalized adjacent backend condition summaries in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const adjacentBackendSupportedKwargsRepair =
    await repairPythonAdjacentBackendSupportedKwargsSurface(scriptPath);
  if (adjacentBackendSupportedKwargsRepair.repaired) {
    repaired = true;
    messages.push(adjacentBackendSupportedKwargsRepair.message || `Normalized adjacent backend supported-kwargs helper in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const adjacentBackendExecutionSeedRowsRepair =
    await repairPythonAdjacentBackendExecutionSeedRowsSurface(scriptPath);
  if (adjacentBackendExecutionSeedRowsRepair.repaired) {
    repaired = true;
    messages.push(adjacentBackendExecutionSeedRowsRepair.message || `Accepted adjacent backend execution seed_rows alias in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const adjacentBackendTrainingInputsBridgeRepair =
    await repairPythonAdjacentBackendTrainingInputsBridgeSurface(scriptPath);
  if (adjacentBackendTrainingInputsBridgeRepair.repaired) {
    repaired = true;
    messages.push(adjacentBackendTrainingInputsBridgeRepair.message || `Bridged adjacent backend training inputs in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const mainCallableResolverSpecificityRepair =
    await repairPythonMainCallableResolverSpecificitySurface(scriptPath);
  if (mainCallableResolverSpecificityRepair.repaired) {
    repaired = true;
    messages.push(mainCallableResolverSpecificityRepair.message || `Constrained callable resolver fallback in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const runContextHelperFallbackRepair = await repairPythonRunContextHelperFallbackSurface(scriptPath);
  if (runContextHelperFallbackRepair.repaired) {
    repaired = true;
    messages.push(runContextHelperFallbackRepair.message || `Allowed run-context helper fallback in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const allowModelDownloadsRuntimeArgDefaultRepair =
    await repairPythonAllowModelDownloadsRuntimeArgDefaultSurface(scriptPath);
  if (allowModelDownloadsRuntimeArgDefaultRepair.repaired) {
    repaired = true;
    messages.push(
      allowModelDownloadsRuntimeArgDefaultRepair.message?.replace(
        "before handoff.",
        "before run_experiments execution."
      ) || `Honored AUTOLABOS_ALLOW_MODEL_DOWNLOAD for allow_model_downloads runtime defaults in ${path.basename(scriptPath)} before run_experiments execution.`
    );
  }

  const mainStudyRunnerDeviceBridgeRepair = await repairPythonMainStudyRunnerDeviceBridgeSurface(scriptPath);
  if (mainStudyRunnerDeviceBridgeRepair.repaired) {
    repaired = true;
    messages.push(mainStudyRunnerDeviceBridgeRepair.message || `Bridged main study runner device invocation in ${path.basename(scriptPath)} before run_experiments execution.`);
  }
  const publicStudyTopLevelRunnerAliasRepair =
    await repairPythonPublicStudyTopLevelRunnerAliasSurface(scriptPath);
  if (publicStudyTopLevelRunnerAliasRepair.repaired) {
    repaired = true;
    messages.push(
      publicStudyTopLevelRunnerAliasRepair.message?.replace(
        "before handoff.",
        "before run_experiments execution."
      ) || `Added public study top-level runner alias in ${path.basename(scriptPath)} before run_experiments execution.`
    );
  }
  const highLevelWorkloadContextAliasRepair =
    await repairPythonHighLevelWorkloadContextAliasSurface(scriptPath);
  if (highLevelWorkloadContextAliasRepair.repaired) {
    repaired = true;
    messages.push(
      highLevelWorkloadContextAliasRepair.message?.replace(
        "before handoff.",
        "before run_experiments execution."
      ) || `Added context alias to high-level workload invocation in ${path.basename(scriptPath)} before run_experiments execution.`
    );
  }
  const conditionScheduleMarkerParameterRepair =
    await repairPythonConditionScheduleMarkerParameterSurface(scriptPath);
  if (conditionScheduleMarkerParameterRepair.repaired) {
    repaired = true;
    messages.push(
      conditionScheduleMarkerParameterRepair.message?.replace(
        "before handoff.",
        "before run_experiments execution."
      ) || `Recovered missing condition schedule parameters from markers in ${path.basename(scriptPath)} before run_experiments execution.`
    );
  }
  const lockedConditionSingleRunnerBridgeRepair =
    await repairPythonLockedConditionSingleRunnerBridgeSurface(scriptPath);
  if (lockedConditionSingleRunnerBridgeRepair.repaired) {
    repaired = true;
    messages.push(lockedConditionSingleRunnerBridgeRepair.message || `Bridged locked-condition single runner execution in ${path.basename(scriptPath)} before run_experiments execution.`);
  }
  const singleConditionExecutorBridgeRepair =
    await repairPythonSingleConditionExecutorBridgeSurface(scriptPath);
  if (singleConditionExecutorBridgeRepair.repaired) {
    repaired = true;
    messages.push(singleConditionExecutorBridgeRepair.message || `Bridged generated single-condition executor resolution in ${path.basename(scriptPath)} before run_experiments execution.`);
  }
  const parameterSummaryRecordRepair =
    await repairPythonParameterSummaryRecordSurface(scriptPath);
  if (parameterSummaryRecordRepair.repaired) {
    repaired = true;
    messages.push(parameterSummaryRecordRepair.message || `Normalized generated parameter summary records in ${path.basename(scriptPath)} before run_experiments execution.`);
  }
  const benchmarkAccuracyComprehensionRepair =
    await repairPythonBenchmarkAccuracyComprehensionSurface(scriptPath);
  if (benchmarkAccuracyComprehensionRepair.repaired) {
    repaired = true;
    messages.push(benchmarkAccuracyComprehensionRepair.message || `Aligned generated benchmark accuracy comprehension in ${path.basename(scriptPath)} before run_experiments execution.`);
  }
  const metricsPayloadProjectionRepair =
    await repairPythonMetricsPayloadProjectionSurface(scriptPath);
  if (metricsPayloadProjectionRepair.repaired) {
    repaired = true;
    messages.push(metricsPayloadProjectionRepair.message || `Projected completed condition metrics onto top-level payload fields in ${path.basename(scriptPath)} before run_experiments execution.`);
  }
  const runResultArtifactAggregationRepair =
    await repairPythonRunResultArtifactAggregationSurface(scriptPath);
  if (runResultArtifactAggregationRepair.repaired) {
    repaired = true;
    messages.push(
      runResultArtifactAggregationRepair.message?.replace(
        "before handoff.",
        "before run_experiments execution."
      ) || `Recovered per-run result artifacts for final metrics aggregation in ${path.basename(scriptPath)} before run_experiments execution.`
    );
  }
  const lockedConditionSeedMatrixEntrypointRepair =
    await repairPythonLockedConditionSeedMatrixEntrypointSurface(scriptPath);
  if (lockedConditionSeedMatrixEntrypointRepair.repaired) {
    repaired = true;
    messages.push(
      lockedConditionSeedMatrixEntrypointRepair.message?.replace(
        "before handoff.",
        "before run_experiments execution."
      ) || `Added locked condition/seed matrix study entrypoint aliases in ${path.basename(scriptPath)} before run_experiments execution.`
    );
  }
  const multipleChoiceDataclassChoiceAliasRepair =
    await repairPythonMultipleChoiceDataclassChoiceAliasSurface(scriptPath);
  if (multipleChoiceDataclassChoiceAliasRepair.repaired) {
    repaired = true;
    messages.push(multipleChoiceDataclassChoiceAliasRepair.message || `Accepted multiple-choice dataclass choice aliases in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const mainMetricsRawResultsAliasRepair =
    await repairPythonMainMetricsRawResultsAliasSurface(scriptPath);
  if (mainMetricsRawResultsAliasRepair.repaired) {
    repaired = true;
    messages.push(mainMetricsRawResultsAliasRepair.message || `Accepted raw_results aliases in final metrics extraction for ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const mainMetricsPayloadBuilderCallRepair =
    await repairPythonMainMetricsPayloadBuilderCallSurface(scriptPath);
  if (mainMetricsPayloadBuilderCallRepair.repaired) {
    repaired = true;
    messages.push(mainMetricsPayloadBuilderCallRepair.message || `Wrapped final metrics payload builder call surface in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const dataCollatorTokenizerRepair = await repairPythonDataCollatorTokenizerArgumentSurface(scriptPath);
  if (dataCollatorTokenizerRepair.repaired) {
    repaired = true;
    messages.push(dataCollatorTokenizerRepair.message || `Passed tokenizer into DataCollatorForLanguageModeling in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const dataCollatorPrecomputedLabelRepair =
    await repairPythonDataCollatorPrecomputedLabelReturnSurface(scriptPath);
  if (dataCollatorPrecomputedLabelRepair.repaired) {
    repaired = true;
    messages.push(dataCollatorPrecomputedLabelRepair.message || `Removed precomputed dataset labels before DataCollatorForLanguageModeling in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const dataclassEvaluationRecordRepair =
    await repairPythonDataclassEvaluationRecordCoercionSurface(scriptPath);
  if (dataclassEvaluationRecordRepair.repaired) {
    repaired = true;
    messages.push(dataclassEvaluationRecordRepair.message || `Coerced dataclass evaluation records in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const conditionMarkerDefaultKwargRepair =
    await repairPythonConditionMarkerDefaultKwargSurface(scriptPath);
  if (conditionMarkerDefaultKwargRepair.repaired) {
    repaired = true;
    messages.push(conditionMarkerDefaultKwargRepair.message || `Allowed default= for condition marker helper in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const conditionTrainEvalHelperBridgeRepair =
    await repairPythonConditionTrainEvalHelperBridgeSurface(scriptPath);
  if (conditionTrainEvalHelperBridgeRepair.repaired) {
    repaired = true;
    messages.push(conditionTrainEvalHelperBridgeRepair.message || `Bridged condition train/eval helpers in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const configInstanceDataclassFieldAliasRepair =
    await repairPythonConfigInstanceDataclassFieldAliasSurface(scriptPath);
  if (configInstanceDataclassFieldAliasRepair.repaired) {
    repaired = true;
    messages.push(configInstanceDataclassFieldAliasRepair.message || `Added dataclass field aliases for _make_config_instance in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const studyRuntimeHelperAliasRepair = await repairPythonStudyRuntimeHelperAliasSurface(scriptPath);
  if (studyRuntimeHelperAliasRepair.repaired) {
    repaired = true;
    messages.push(studyRuntimeHelperAliasRepair.message || `Added study runtime helper aliases in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const trainLossHelperArityRepair = await repairPythonTrainLossHelperAritySurface(scriptPath);
  if (trainLossHelperArityRepair.repaired) {
    repaired = true;
    messages.push(trainLossHelperArityRepair.message || `Preserved two-argument train-loss helper in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const conditionSuccessStatusAliasRepair = await repairPythonConditionSuccessStatusAliasSurface(scriptPath);
  if (conditionSuccessStatusAliasRepair.repaired) {
    repaired = true;
    messages.push(conditionSuccessStatusAliasRepair.message || `Normalized successful condition status in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const terminalMetricsExistingConditionCountRepair =
    await repairPythonTerminalMetricsExistingConditionCountSurface(scriptPath);
  if (terminalMetricsExistingConditionCountRepair.repaired) {
    repaired = true;
    messages.push(terminalMetricsExistingConditionCountRepair.message || `Preserved terminal metrics condition counts in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const chunk3bStudyRunnerInvocationContextRepair =
    await repairPythonChunk3bStudyRunnerInvocationContextSurface(scriptPath);
  if (chunk3bStudyRunnerInvocationContextRepair.repaired) {
    repaired = true;
    messages.push(chunk3bStudyRunnerInvocationContextRepair.message || `Materialized chunk3b study runner context in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const chunk3bConditionMarkerSelectionRepair =
    await repairPythonChunk3bConditionMarkerSelectionSurface(scriptPath);
  if (chunk3bConditionMarkerSelectionRepair.repaired) {
    repaired = true;
    messages.push(chunk3bConditionMarkerSelectionRepair.message || `Filtered unsupported chunk3b condition markers in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const multipleChoicePromptSignatureRepair =
    await repairPythonMultipleChoicePromptSignatureSurface(scriptPath);
  if (multipleChoicePromptSignatureRepair.repaired) {
    repaired = true;
    messages.push(multipleChoicePromptSignatureRepair.message || `Widened multiple-choice prompt helper signature in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const safeMetricFloatRepair = await repairPythonSafeMetricFloatHelperSurface(scriptPath);
  if (safeMetricFloatRepair.repaired) {
    repaired = true;
    messages.push(safeMetricFloatRepair.message || `Added _safe_metric_float helper in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const evaluationAnswerLabelAliasRepair =
    await repairPythonEvaluationAnswerLabelAliasSurface(scriptPath);
  if (evaluationAnswerLabelAliasRepair.repaired) {
    repaired = true;
    messages.push(evaluationAnswerLabelAliasRepair.message || `Accepted answer_label evaluation records in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  const lockedSweepRuntimeRepair = await repairPythonLockedSweepRuntimeKwargBridgeSurface(scriptPath);
  if (lockedSweepRuntimeRepair.repaired) {
    repaired = true;
    messages.push(lockedSweepRuntimeRepair.message || `Bridged locked-sweep runtime kwargs in ${path.basename(scriptPath)} before run_experiments execution.`);
  }

  if (!repaired) {
    return { repaired: false, message: "" };
  }
  return {
    repaired: true,
    message: messages.join(" ")
  };
}

async function repairPythonAdjacentBackendDiscoverySurface(scriptPath: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  const backendPath = path.join(path.dirname(scriptPath), "backend_experiment_impl.py");
  if (!(await fileExists(backendPath))) {
    return { repaired: false };
  }
  const source = await fs.readFile(scriptPath, "utf8");
  if (source.includes("backend_experiment_impl.py") || !source.includes("def discover_backend")) {
    return { repaired: false };
  }
  const candidatesPattern = /(\n\s*candidates\.extend\(\s*\n\s*\[\s*\n)/u;
  if (!candidatesPattern.test(source)) {
    return { repaired: false };
  }
  const nextSource = source.replace(candidatesPattern, `$1            search_dir / "backend_experiment_impl.py",\n`);
  if (nextSource === source) {
    return { repaired: false };
  }
  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Added adjacent backend_experiment_impl.py discovery to ${path.basename(scriptPath)} before run_experiments execution.`
  };
}

async function repairPythonAdjacentBackendAggregationSeedRowsSurface(scriptPath: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  const backendPath = path.join(path.dirname(scriptPath), "backend_experiment_impl.py");
  if (!(await fileExists(backendPath))) {
    return { repaired: false };
  }
  const source = await fs.readFile(backendPath, "utf8");
  if (!source.includes("def aggregate_study_results(") || source.includes("seed_rows=seed_results")) {
    return { repaired: false };
  }
  const seedResultsLinePattern = /^(\s*)seed_results=seed_results,/mu;
  if (!seedResultsLinePattern.test(source)) {
    return { repaired: false };
  }
  const nextSource = source.replace(seedResultsLinePattern, "$1seed_rows=seed_results,\n$&");
  if (nextSource === source) {
    return { repaired: false };
  }
  await fs.writeFile(backendPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Added seed_rows alias for adjacent backend aggregation in ${path.basename(backendPath)} before run_experiments execution.`
  };
}
async function repairPythonAdjacentBackendConditionSummariesMappingSurface(scriptPath: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  const backendPath = path.join(path.dirname(scriptPath), "backend_experiment_impl.py");
  if (!(await fileExists(backendPath))) {
    return { repaired: false };
  }
  const source = await fs.readFile(backendPath, "utf8");
  if (source.includes("raw_condition_summaries = aggregate_payload.get")) {
    return { repaired: false };
  }
  const conditionSummariesLinePattern = /^(\s*)condition_summaries = list\(aggregate_payload\.get\(["']condition_summaries["'], \[\]\)\)/mu;
  const match = source.match(conditionSummariesLinePattern);
  if (!match) {
    return { repaired: false };
  }
  const indent = match[1] || "";
  const replacement = [
    `${indent}raw_condition_summaries = aggregate_payload.get("condition_summaries", [])`,
    `${indent}if isinstance(raw_condition_summaries, Mapping):`,
    `${indent}    condition_summaries = list(raw_condition_summaries.values())`,
    `${indent}else:`,
    `${indent}    condition_summaries = list(raw_condition_summaries)`
  ].join("\n");
  const nextSource = source.replace(conditionSummariesLinePattern, replacement);
  if (nextSource === source) {
    return { repaired: false };
  }
  await fs.writeFile(backendPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Normalized adjacent backend condition_summaries mapping in ${path.basename(backendPath)} before run_experiments execution.`
  };
}
async function repairPythonAdjacentBackendSupportedKwargsSurface(scriptPath: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  const backendPath = path.join(path.dirname(scriptPath), "backend_experiment_impl.py");
  if (!(await fileExists(backendPath))) {
    return { repaired: false };
  }
  const source = await fs.readFile(backendPath, "utf8");
  if (
    !source.includes("def _invoke_with_supported_kwargs") ||
    source.includes("def _invoke_with_supported_kwargs(func: Any, kwargs: Any = None, **extra_kwargs: Any)")
  ) {
    return { repaired: false };
  }
  const helperPattern = /^def _invoke_with_supported_kwargs\(func: Any, kwargs: Mapping\[str, Any\]\) -> Any:\n(?:    .+\n)+?    return func\(\*\*supported_kwargs\)\n/mu;
  if (!helperPattern.test(source)) {
    return { repaired: false };
  }
  const replacement = [
    "def _invoke_with_supported_kwargs(func: Any, kwargs: Any = None, **extra_kwargs: Any) -> Any:",
    "    merged_kwargs: Dict[str, Any] = {}",
    "    if kwargs is not None:",
    "        merged_kwargs.update(dict(kwargs))",
    "    merged_kwargs.update(extra_kwargs)",
    "    try:",
    "        signature = inspect.signature(func)",
    "    except Exception:",
    "        return func(**merged_kwargs)",
    "    parameters = signature.parameters",
    "    if any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()):",
    "        return func(**merged_kwargs)",
    "    supported_kwargs: Dict[str, Any] = {}",
    "    for name, parameter in parameters.items():",
    "        if parameter.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.VAR_POSITIONAL):",
    "            continue",
    "        if name in merged_kwargs:",
    "            supported_kwargs[name] = merged_kwargs[name]",
    "    return func(**supported_kwargs)"
  ].join("\n");
  const nextSource = source.replace(helperPattern, replacement);
  if (nextSource === source) {
    return { repaired: false };
  }
  await fs.writeFile(backendPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Normalized adjacent backend _invoke_with_supported_kwargs in ${path.basename(backendPath)} before run_experiments execution.`
  };
}
async function repairPythonAdjacentBackendExecutionSeedRowsSurface(scriptPath: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  const backendPath = path.join(path.dirname(scriptPath), "backend_experiment_impl.py");
  if (!(await fileExists(backendPath))) {
    return { repaired: false };
  }
  const source = await fs.readFile(backendPath, "utf8");
  if (source.includes('execution_payload.get("seed_rows")')) {
    return { repaired: false };
  }
  const rawSeedResultsPattern = /^(\s*)raw_seed_results = execution_payload\.get\(["']seed_results["']\)\n/mu;
  if (!rawSeedResultsPattern.test(source)) {
    return { repaired: false };
  }
  const nextSource = source.replace(
    rawSeedResultsPattern,
    `$1raw_seed_results = execution_payload.get("seed_results")\n$1if raw_seed_results is None:\n$1    raw_seed_results = execution_payload.get("seed_rows")\n`
  );
  if (nextSource === source) {
    return { repaired: false };
  }
  await fs.writeFile(backendPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Accepted seed_rows from adjacent backend execution payload in ${path.basename(backendPath)} before run_experiments execution.`
  };
}
async function repairPythonAdjacentBackendTrainingInputsBridgeSurface(scriptPath: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  const backendPath = path.join(path.dirname(scriptPath), "backend_experiment_impl.py");
  if (!(await fileExists(backendPath))) {
    return { repaired: false };
  }
  const source = await fs.readFile(backendPath, "utf8");
  const marker = "_autolabos_training_inputs_bridge_marker";
  if (
    source.includes(marker) ||
    !source.includes("def run_single_condition_seed(") ||
    !source.includes("def run_single_seed_training") ||
    !source.includes("def load_condition_model_bundle(") ||
    !source.includes("def prepare_single_seed_data_bundle(")
  ) {
    return { repaired: false };
  }
  const rawTrainingNeedle = "        raw_training_output = None\n        if training_runner is not None:";
  if (!source.includes(rawTrainingNeedle)) {
    return { repaired: false };
  }
  const bridgeBlock = [
    "        # _autolabos_training_inputs_bridge_marker",
    "        bridge_training_model = runtime_context.get(\"model\")",
    "        bridge_tokenizer = runtime_context.get(\"tokenizer\")",
    "        bridge_train_examples = runtime_context.get(\"train_examples\") or runtime_context.get(\"training_examples\")",
    "        bridge_training_device = runtime_context.get(\"device\")",
    "        if training_runner is not None and (bridge_training_model is None or bridge_tokenizer is None or bridge_train_examples is None):",
    "            bridge_cache_dir = runtime_context.get(\"cache_dir\")",
    "            if bridge_cache_dir is not None:",
    "                bridge_cache_dir = Path(bridge_cache_dir)",
    "            data_bundle = prepare_single_seed_data_bundle(",
    "                seed=seed,",
    "                train_example_count=int(runtime_context.get(\"max_train_examples\") or globals().get(\"DEFAULT_MAX_TRAIN_EXAMPLES\", 96)),",
    "                eval_examples_per_task=int(runtime_context.get(\"max_eval_examples_per_task\") or globals().get(\"DEFAULT_MAX_EVAL_EXAMPLES_PER_TASK\", 64)),",
    "                cache_dir=bridge_cache_dir,",
    "            )",
    "            if bridge_train_examples is None:",
    "                bridge_train_examples = data_bundle.get(\"train_examples\")",
    "            runtime_context.setdefault(\"evaluation_examples_by_task\", data_bundle.get(\"eval_examples\", {}))",
    "            model_resolution = runtime_context.get(\"model_resolution\")",
    "            if not isinstance(model_resolution, Mapping):",
    "                model_resolution = {}",
    "            bridge_model_name = (",
    "                runtime_context.get(\"resolved_model_name\")",
    "                or runtime_context.get(\"resolved_base_model\")",
    "                or model_resolution.get(\"selected_model_id\")",
    "                or globals().get(\"PREFERRED_BASE_MODEL\")",
    "                or globals().get(\"PREFERRED_BASE_MODEL_ID\")",
    "            )",
    "            if bridge_training_model is None or bridge_tokenizer is None:",
    "                model_bundle = load_condition_model_bundle(",
    "                    base_model_name=str(bridge_model_name),",
    "                    lora_rank=rank,",
    "                    lora_dropout=dropout,",
    "                    cache_dir=bridge_cache_dir,",
    "                    max_sequence_length=int(runtime_context.get(\"max_sequence_length\") or runtime_context.get(\"max_seq_length\") or globals().get(\"DEFAULT_MAX_SEQ_LENGTH\", 256)),",
    "                )",
    "                bridge_training_model = getattr(model_bundle, \"model\", None)",
    "                bridge_tokenizer = getattr(model_bundle, \"tokenizer\", None)",
    "                bridge_training_device = getattr(model_bundle, \"device\", bridge_training_device)",
    "                runtime_context.setdefault(\"resolved_model_name\", getattr(model_bundle, \"base_model_name\", bridge_model_name))",
    "        if bridge_training_device is None:",
    "            bridge_training_device = runtime_context.get(\"device\")",
  ].join("\n");
  let nextSource = source.replace(
    rawTrainingNeedle,
    `        raw_training_output = None\n${bridgeBlock}\n        if training_runner is not None:`
  );
  const deviceNeedle = "                device=runtime_context.get(\"device\"),";
  const deviceReplacement = [
    "                device=bridge_training_device,",
    "                model=bridge_training_model,",
    "                tokenizer=bridge_tokenizer,",
    "                train_examples=bridge_train_examples,",
    "                runtime_config=runtime_context,"
  ].join("\n");
  if (!nextSource.includes(deviceNeedle)) {
    return { repaired: false };
  }
  nextSource = nextSource.replace(deviceNeedle, deviceReplacement);
  if (nextSource === source) {
    return { repaired: false };
  }
  await fs.writeFile(backendPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Bridged model/tokenizer/train_examples inputs for adjacent backend training in ${path.basename(backendPath)} before run_experiments execution.`
  };
}
function extractPythonScriptPathFromCommand(command: string, cwd: string): string | undefined {
  const match = command.match(/(?:^|\s)python(?:3)?(?:\s+-B)?\s+(?:"([^"]+\.py)"|'([^']+\.py)'|(\S+\.py))/u);
  const candidate = match?.[1] || match?.[2] || match?.[3];
  if (!candidate) {
    return undefined;
  }
  return path.isAbsolute(candidate) ? candidate : path.join(cwd, candidate);
}

function removeUnsupportedTrainingArgumentsKwargLines(source: string): string {
  const unsupportedNames = ["overwrite_output_dir", "evaluation_strategy"];
  const unsupportedPattern = new RegExp(
    `^\\s*(?:${unsupportedNames.map(escapeRegex).join("|")})\\s*=.*?,?\\s*(?:#.*)?$`,
    "u"
  );
  const lines = source.split(/\r?\n/u);
  const nextLines: string[] = [];
  let inTrainingArgumentsCall = false;
  let parenDepth = 0;
  let changed = false;

  for (const line of lines) {
    const startsTrainingArgumentsCall =
      /\bTrainingArguments\s*\(/u.test(line) || /\[\s*["']TrainingArguments["']\s*\]\s*\(/u.test(line);
    if (startsTrainingArgumentsCall) {
      inTrainingArgumentsCall = true;
    }

    if (inTrainingArgumentsCall && unsupportedPattern.test(line)) {
      changed = true;
      parenDepth += countTextOccurrences(line, "(") - countTextOccurrences(line, ")");
      if (parenDepth <= 0) {
        inTrainingArgumentsCall = false;
        parenDepth = 0;
      }
      continue;
    }

    nextLines.push(line);
    if (inTrainingArgumentsCall) {
      parenDepth += countTextOccurrences(line, "(") - countTextOccurrences(line, ")");
      if (parenDepth <= 0) {
        inTrainingArgumentsCall = false;
        parenDepth = 0;
      }
    }
  }

  return changed ? nextLines.join("\n").replace(/\n{3,}/gu, "\n\n") : source;
}

function promoteSummaryPrimaryMetric(metrics: Record<string, unknown>): string | undefined {
  const aggregatePromotion = promoteAggregatePrimaryMetric(metrics);
  if (aggregatePromotion) {
    return aggregatePromotion;
  }

  const topLevelPrimaryMetricKey = metrics.primary_metric_key;
  if (
    typeof topLevelPrimaryMetricKey === "string" &&
    /^[A-Za-z_][A-Za-z0-9_]*$/u.test(topLevelPrimaryMetricKey) &&
    metrics[topLevelPrimaryMetricKey] == null
  ) {
    const topLevelPrimaryMetric = metrics.primary_metric;
    if (typeof topLevelPrimaryMetric === "number" && Number.isFinite(topLevelPrimaryMetric)) {
      metrics[topLevelPrimaryMetricKey] = topLevelPrimaryMetric;
      return `Promoted primary metric ${topLevelPrimaryMetricKey}=${topLevelPrimaryMetric} to top-level metrics before contract evaluation.`;
    }
    const conditionSummaryMetric = derivePrimaryMetricFromConditionSummaries(metrics, topLevelPrimaryMetricKey);
    if (conditionSummaryMetric !== undefined) {
      metrics[topLevelPrimaryMetricKey] = conditionSummaryMetric;
      if (typeof metrics.primary_metric_value !== "number" || !Number.isFinite(metrics.primary_metric_value)) {
        metrics.primary_metric_value = conditionSummaryMetric;
      }
      return `Promoted condition-summary primary metric ${topLevelPrimaryMetricKey}=${conditionSummaryMetric} to top-level metrics before contract evaluation.`;
    }
  }

  const summary = metrics.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return undefined;
  }
  const summaryRecord = summary as Record<string, unknown>;
  const primaryMetricKey = summaryRecord.primary_metric_key;
  if (typeof primaryMetricKey !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(primaryMetricKey)) {
    return undefined;
  }
  if (metrics[primaryMetricKey] !== undefined) {
    return undefined;
  }
  const primaryMetric = summaryRecord.primary_metric;
  if (typeof primaryMetric !== "number" || !Number.isFinite(primaryMetric)) {
    return undefined;
  }
  metrics[primaryMetricKey] = primaryMetric;
  return `Promoted summary primary metric ${primaryMetricKey}=${primaryMetric} to top-level metrics before contract evaluation.`;
}

function promoteAggregatePrimaryMetric(metrics: Record<string, unknown>): string | undefined {
  const aggregate = asRecord(metrics.aggregate);
  if (Object.keys(aggregate).length === 0) {
    return undefined;
  }
  const config = asRecord(metrics.config);
  const primaryMetricKey =
    asString(metrics.primary_metric_key) ||
    asString(config.primary_metric_key) ||
    asString(asRecord(metrics.objective).primary_metric_key);
  if (!primaryMetricKey || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(primaryMetricKey)) {
    return undefined;
  }

  const bestCondition = asRecord(aggregate.best_condition);
  const primaryMetricValue =
    asNumber(metrics[primaryMetricKey]) ??
    asNumber(metrics.primary_metric_value) ??
    asNumber(bestCondition[primaryMetricKey]) ??
    asNumber(aggregate[primaryMetricKey]);
  const promoted: string[] = [];
  if (primaryMetricValue !== undefined) {
    if (metrics[primaryMetricKey] == null) {
      metrics[primaryMetricKey] = primaryMetricValue;
      promoted.push(`${primaryMetricKey}=${primaryMetricValue}`);
    }
    if (typeof metrics.primary_metric_value !== "number" || !Number.isFinite(metrics.primary_metric_value)) {
      metrics.primary_metric_value = primaryMetricValue;
    }
    if (typeof metrics.primary_metric !== "number" || !Number.isFinite(metrics.primary_metric)) {
      metrics.primary_metric = primaryMetricValue;
    }
  }
  if (typeof metrics.primary_metric_key !== "string") {
    metrics.primary_metric_key = primaryMetricKey;
  }

  promoteNumericField(metrics, aggregate, "completed_run_count", promoted);
  promoteNumericField(metrics, aggregate, "completed_condition_count", promoted);
  promoteNumericField(metrics, aggregate, "failed_run_count", promoted);
  promoteNumericField(metrics, aggregate, "timed_out_run_count", promoted);
  promoteStringField(metrics, aggregate, "baseline_marker", "baseline_condition_marker", promoted);
  const conditionAggregates = aggregate.condition_aggregates;
  if (!Array.isArray(metrics.condition_summaries) && Array.isArray(conditionAggregates)) {
    metrics.condition_summaries = conditionAggregates;
    promoted.push(`condition_summaries=${conditionAggregates.length}`);
  }
  if (Object.keys(asRecord(metrics.best_condition)).length === 0 && Object.keys(bestCondition).length > 0) {
    metrics.best_condition = bestCondition;
    promoted.push("best_condition");
  }

  const requiredMarkers = Array.isArray(config.required_condition_markers)
    ? config.required_condition_markers
    : undefined;
  if (asNumber(metrics.required_condition_count) === undefined && requiredMarkers) {
    metrics.required_condition_count = requiredMarkers.length;
    promoted.push(`required_condition_count=${requiredMarkers.length}`);
  }
  const seedSchedule = Array.isArray(config.seed_schedule) ? config.seed_schedule : undefined;
  if (asNumber(metrics.required_run_count) === undefined && requiredMarkers && seedSchedule) {
    metrics.required_run_count = requiredMarkers.length * seedSchedule.length;
    promoted.push(`required_run_count=${requiredMarkers.length * seedSchedule.length}`);
  }

  if (promoted.length === 0) {
    return undefined;
  }
  return `Promoted aggregate metrics projection before contract evaluation: ${promoted.join(", ")}.`;
}

function promoteNumericField(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
  promoted: string[]
): void {
  if (asNumber(target[key]) !== undefined) {
    return;
  }
  const value = asNumber(source[key]);
  if (value === undefined) {
    return;
  }
  target[key] = value;
  promoted.push(`${key}=${value}`);
}

function promoteStringField(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  sourceKey: string,
  targetKey: string,
  promoted: string[]
): void {
  if (asString(target[targetKey])) {
    return;
  }
  const value = asString(source[sourceKey]);
  if (!value) {
    return;
  }
  target[targetKey] = value;
  promoted.push(`${targetKey}=${value}`);
}

function derivePrimaryMetricFromConditionSummaries(
  metrics: Record<string, unknown>,
  primaryMetricKey: string
): number | undefined {
  const rows = [
    ...collectConditionRows(metrics.condition_summaries),
    ...collectConditionRows(metrics.condition_results),
    ...collectConditionRows(metrics.conditions),
    ...collectConditionRows(asRecord(metrics.study).condition_summaries),
    ...collectConditionRows(asRecord(metrics.study).condition_results)
  ];
  if (rows.length === 0) {
    return undefined;
  }
  const baselineMarker = asString(metrics.baseline_condition_marker) || inferBaselineConditionMarker(rows);
  const candidateRows =
    primaryMetricKey === "accuracy_delta_vs_baseline"
      ? rows.filter((row) => {
          const marker = asString(row.condition_marker) || asString(row.marker);
          return marker !== baselineMarker;
        })
      : rows;
  const values = (candidateRows.length > 0 ? candidateRows : rows)
    .map((row) => asNumber(row[primaryMetricKey]))
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) {
    return undefined;
  }
  return Math.max(...values);
}

function inferBaselineConditionMarker(rows: Record<string, unknown>[]): string | undefined {
  for (const row of rows) {
    if (row.is_baseline === true) {
      return asString(row.condition_marker) || asString(row.marker) || asString(row.condition_id) || asString(row.id);
    }
  }
  return undefined;
}

function countTextOccurrences(text: string, token: string): number {
  if (!token) {
    return 0;
  }
  let count = 0;
  let index = text.indexOf(token);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(token, index + token.length);
  }
  return count;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function loadImplementBootstrapContract(publicDir: string): Promise<{
  requires_network?: boolean;
  blocking_reason?: string;
  summary?: string;
  remediation?: string[];
} | undefined> {
  const contractPath = path.join(publicDir, "bootstrap_contract.json");
  if (!(await fileExists(contractPath))) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await fs.readFile(contractPath, "utf8")) as Record<string, unknown>;
    return {
      requires_network: parsed.requires_network === true,
      blocking_reason: typeof parsed.blocking_reason === "string" ? parsed.blocking_reason : undefined,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      remediation: Array.isArray(parsed.remediation)
        ? parsed.remediation.filter((item): item is string => typeof item === "string")
        : undefined
    };
  } catch {
    return undefined;
  }
}

function formatRunLabel(experimentMode: string, trigger = "manual"): string {
  const prefix = trigger === "auto_handoff" ? "Second-stage verifier" : undefined;
  if (experimentMode === "synthetic_validation") {
    return prefix ? `${prefix} synthetic validation run` : "Synthetic validation run";
  }
  if (experimentMode === "hybrid_validation") {
    return prefix ? `${prefix} hybrid experiment run` : "Hybrid experiment run";
  }
  return prefix ? `${prefix} experiment run` : "Experiment run";
}

function buildRunVerifierReport(input: {
  status: "pass" | "fail" | "skipped";
  trigger: RunVerifierTrigger;
  stage: "preflight_test" | "command" | "metrics" | "policy" | "success";
  summary: string;
  policyRuleId?: string;
  policyReason?: string;
  command?: string;
  cwd?: string;
  metricsPath?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  logFile?: string;
  suggestedNextAction?: string;
}): RunVerifierReport {
  return {
    source: "run_experiments",
    status: input.status,
    trigger: input.trigger,
    stage: input.stage,
    summary: oneLine(input.summary),
    policy_rule_id: input.policyRuleId,
    policy_reason: input.policyReason,
    command: input.command,
    cwd: input.cwd,
    metrics_path: input.metricsPath,
    exit_code: input.exitCode,
    stdout_excerpt: trimExcerpt(input.stdout),
    stderr_excerpt: trimExcerpt(input.stderr),
    log_file: input.logFile,
    suggested_next_action: input.suggestedNextAction,
    recorded_at: new Date().toISOString()
  };
}

async function persistRunVerifierReport(
  run: Parameters<typeof writeRunArtifact>[0],
  runContext: RunContextMemory,
  report: RunVerifierReport
): Promise<PublishPublicRunOutputsResult> {
  const reportPath = await writeRunArtifact(run, "run_experiments_verify_report.json", JSON.stringify(report, null, 2));
  const runDir = path.join(process.cwd(), ".autolabos", "runs", run.id);
  const intermediateArtifactCapture = await buildIntermediateArtifactCaptureManifest({
    runId: run.id,
    runDir,
    node: "run_experiments",
    phase: report.stage,
    status: report.status,
    artifacts: [
      {
        artifactId: "run_experiments_verify_report",
        filePath: reportPath,
        role: "verification",
        required: true,
        parseAs: "json"
      },
      {
        artifactId: "metrics",
        filePath: report.metrics_path,
        role: "metric",
        required: report.status === "pass",
        parseAs: "json",
        notes: report.metrics_path
          ? ["Metrics are required for paper-scale claims only when verification passes."]
          : ["No metrics path was recorded by the runner."]
      },
      {
        artifactId: "run_log",
        filePath: report.log_file,
        role: "log",
        required: false,
        parseAs: "text"
      }
    ]
  });
  const intermediateArtifactCapturePath = await writeRunArtifact(
    run,
    "run_experiments/intermediate_artifacts.json",
    JSON.stringify(intermediateArtifactCapture, null, 2)
  );
  const publicOutputs = await publishPublicRunOutputs({
    workspaceRoot: process.cwd(),
    run,
    node: "run_experiments",
    runContext,
    section: "experiment",
    files: [
      {
        sourcePath: reportPath,
        targetRelativePath: "run_experiments_verify_report.json"
      },
      {
        sourcePath: intermediateArtifactCapturePath,
        targetRelativePath: "run_experiments_intermediate_artifacts.json"
      }
    ]
  });
  await runContext.put("run_experiments.last_report", report);
  await runContext.put("run_experiments.intermediate_artifact_capture", intermediateArtifactCapture);
  if (report.status === "fail") {
    await runContext.put("run_experiments.feedback_for_implementer", report);
    await runContext.put("implement_experiments.runner_feedback", report);
    return publicOutputs;
  }
  await runContext.put("run_experiments.feedback_for_implementer", null);
  await runContext.put("implement_experiments.runner_feedback", null);
  return publicOutputs;
}

async function persistRunPanelArtifacts(input: {
  run: Parameters<typeof writeRunArtifact>[0];
  runContext: RunContextMemory;
  executionPlan?: RunExperimentsExecutionPlan;
  triageAttempts: RunExperimentsTriageAttempt[];
  watchdog: ReturnType<typeof createRunExperimentsWatchdogState>;
  rerunDecision: RunExperimentsRerunDecision;
}): Promise<void> {
  if (input.executionPlan) {
    await writeRunArtifact(
      input.run,
      "run_experiments_panel/execution_plan.json",
      JSON.stringify(input.executionPlan, null, 2)
    );
  }
  const triage = finalizeRunExperimentsTriage({
    attempts: input.triageAttempts,
    watchdog: input.watchdog
  });
  await writeRunArtifact(input.run, "run_experiments_panel/triage.json", JSON.stringify(triage, null, 2));
  await writeRunArtifact(
    input.run,
    "run_experiments_panel/rerun_decision.json",
    JSON.stringify(input.rerunDecision, null, 2)
  );
  await input.runContext.put("run_experiments.triage", triage);
}

async function persistRunFailureState(
  runContext: RunContextMemory,
  input: {
    command?: string;
    cwd?: string;
    logFile?: string;
    exitCode?: number;
    error: string;
  }
): Promise<void> {
  await runContext.put("run_experiments.command", input.command);
  await runContext.put("run_experiments.cwd", input.cwd);
  await runContext.put("run_experiments.last_log_file", input.logFile);
  await runContext.put("run_experiments.exit_code", input.exitCode);
  await runContext.put("run_experiments.last_error", input.error);
}

async function persistGovernanceCrash(input: {
  run: Parameters<typeof writeRunArtifact>[0];
  runContext: RunContextMemory;
  comparisonContract?: Awaited<ReturnType<typeof loadExperimentComparisonContract>>;
  implementationContext?: Awaited<ReturnType<typeof loadExperimentImplementationContext>>;
  objectiveMetricName: string;
  rationale: string;
  resourceUsage: Record<string, unknown>;
}): Promise<void> {
  const entry = buildCrashLedgerEntry({
    contract: input.comparisonContract,
    implementationContext: input.implementationContext,
    objectiveMetricName: input.objectiveMetricName,
    rationale: input.rationale,
    resourceUsage: input.resourceUsage
  });
  await storeExperimentGovernanceDecision(input.run, input.runContext, {
    entries: [entry]
  });
}

async function materializeRunExperimentPublicSummaryProjection(input: {
  run: Parameters<typeof writeRunArtifact>[0];
  metrics: Record<string, unknown>;
  objectiveEvaluation: ObjectiveMetricEvaluation;
  metricsPath: string;
  command: string;
  cwd?: string;
}): Promise<{
  summaryPath: string;
  studySummaryPath: string;
}> {
  const bestCondition = asRecord(input.metrics.best_condition);
  const summary = {
    version: 1,
    source: "run_experiments",
    projection_source: "metrics.json",
    status: asString(input.metrics.status) || "completed",
    objective: {
      raw_objective_metric: input.objectiveEvaluation.rawObjectiveMetric,
      primary_metric_key:
        input.objectiveEvaluation.matchedMetricKey ||
        input.objectiveEvaluation.primaryMetric ||
        asString(input.metrics.primary_metric_key) ||
        null,
      observed_value:
        input.objectiveEvaluation.observedValue ??
        asNumber(input.metrics.primary_metric_value) ??
        null,
      status: input.objectiveEvaluation.status,
      summary: input.objectiveEvaluation.summary
    },
    metrics_path: input.metricsPath,
    command: input.command,
    cwd: input.cwd || null,
    completed_run_count: asNumber(input.metrics.completed_run_count) ?? null,
    required_run_count: asNumber(input.metrics.required_run_count) ?? null,
    attempted_run_count: asNumber(input.metrics.attempted_run_count) ?? null,
    failed_run_count: asNumber(input.metrics.failed_run_count) ?? null,
    completed_condition_count: asNumber(input.metrics.completed_condition_count) ?? null,
    required_condition_count: asNumber(input.metrics.required_condition_count) ?? null,
    primary_metric_key:
      asString(input.metrics.primary_metric_key) ||
      input.objectiveEvaluation.matchedMetricKey ||
      input.objectiveEvaluation.primaryMetric ||
      null,
    primary_metric_value:
      asNumber(input.metrics.primary_metric_value) ??
      input.objectiveEvaluation.observedValue ??
      null,
    accuracy_delta_vs_baseline: asNumber(input.metrics.accuracy_delta_vs_baseline) ?? null,
    average_accuracy: asNumber(input.metrics.average_accuracy) ?? null,
    baseline_average_accuracy: asNumber(input.metrics.baseline_average_accuracy) ?? null,
    best_condition_marker:
      asString(bestCondition.condition_marker) ||
      asString(bestCondition.marker) ||
      null,
    best_condition_accuracy_delta_vs_baseline:
      asNumber(bestCondition.accuracy_delta_vs_baseline) ?? null,
    condition_summaries: Array.isArray(input.metrics.condition_summaries)
      ? input.metrics.condition_summaries
      : []
  };
  const studySummary = {
    ...summary,
    study_status: summary.status,
    baseline_condition_marker: asString(input.metrics.baseline_condition_marker) || null,
    seed_count: asNumber(input.metrics.seed_count) ?? null,
    successful_seed_count: asNumber(input.metrics.successful_seed_count) ?? null,
    failed_seed_count: asNumber(input.metrics.failed_seed_count) ?? null
  };

  const summaryPath = await writeRunArtifact(
    input.run,
    "run_experiments_public_summary.json",
    JSON.stringify(summary, null, 2)
  );
  const studySummaryPath = await writeRunArtifact(
    input.run,
    "run_experiments_public_study_summary.json",
    JSON.stringify(studySummary, null, 2)
  );
  return { summaryPath, studySummaryPath };
}

async function publishRunExperimentOutputs(input: {
  workspaceRoot: string;
  run: Parameters<typeof writeRunArtifact>[0];
  runContext: RunContextMemory;
  metricsPath: string;
  supplementalPlan?: ManagedSupplementalPlan;
  matrixTrialGroups?: BuildExperimentRunManifestTrialGroupExecution[];
  publicSummaryProjection?: {
    summaryPath: string;
    studySummaryPath: string;
  };
}): Promise<PublishPublicRunOutputsResult> {
  const runDir = path.join(input.workspaceRoot, ".autolabos", "runs", input.run.id);
  const files: Array<{
    sourcePath: string;
    targetRelativePath?: string;
    optional?: boolean;
  }> = [
    {
      sourcePath: input.metricsPath,
      targetRelativePath: "metrics.json",
      optional: true
    },
    {
      sourcePath: path.join(runDir, "objective_evaluation.json"),
      targetRelativePath: "objective_evaluation.json",
      optional: true
    },
    {
      sourcePath: path.join(runDir, "run_experiments_verify_report.json"),
      targetRelativePath: "run_experiments_verify_report.json",
      optional: true
    },
    {
      sourcePath: path.join(runDir, "run_manifest.json"),
      targetRelativePath: "run_manifest.json",
      optional: true
    },
    {
      sourcePath: path.join(runDir, "experiment_portfolio.json"),
      targetRelativePath: "experiment_portfolio.json",
      optional: true
    },
    {
      sourcePath: path.join(runDir, "trial_group_matrix.json"),
      targetRelativePath: "trial_group_matrix.json",
      optional: true
    }
  ];
  if (input.supplementalPlan) {
    for (const profile of input.supplementalPlan.profiles) {
      files.push({
        sourcePath: profile.metricsPath,
        targetRelativePath: path.basename(profile.metricsPath),
        optional: true
      });
    }
    files.push({
      sourcePath: path.join(input.supplementalPlan.publicDir, "recent_paper_reproducibility.json"),
      targetRelativePath: "recent_paper_reproducibility.json",
      optional: true
    });
  }
  if (input.matrixTrialGroups?.length) {
    for (const group of input.matrixTrialGroups) {
      if (!group.metrics_path || !group.metrics_path.startsWith(path.join(".autolabos", "runs", input.run.id, "trial_group_metrics"))) {
        continue;
      }
      files.push({
        sourcePath: group.metrics_path,
        targetRelativePath: path.join("trial_group_metrics", path.basename(group.metrics_path)),
        optional: true
      });
    }
  }
  if (input.publicSummaryProjection) {
    files.push(
      {
        sourcePath: input.publicSummaryProjection.summaryPath,
        targetRelativePath: "summary.json",
        optional: true
      },
      {
        sourcePath: input.publicSummaryProjection.studySummaryPath,
        targetRelativePath: "study_summary.json",
        optional: true
      }
    );
  }

  return publishPublicRunOutputs({
    workspaceRoot: input.workspaceRoot,
    run: input.run,
    node: "run_experiments",
    runContext: input.runContext,
    section: "experiment",
    files
  });
}

async function materializeManagedMatrixTrialGroupArtifacts(input: {
  run: Parameters<typeof writeRunArtifact>[0];
  portfolio: ExperimentPortfolio;
  primaryCommand: string;
  primaryCwd?: string;
  primaryMetricsPath: string;
  primaryMetrics: Record<string, unknown>;
  primarySummary: string;
  supplementalRuns: SupplementalRunRecord[];
}): Promise<BuildExperimentRunManifestTrialGroupExecution[]> {
  if (input.portfolio.execution_model !== "managed_bundle") {
    return [];
  }

  const matrixGroups = input.portfolio.trial_groups.filter((group) => group.group_kind === "matrix_slice");
  if (matrixGroups.length === 0) {
    return [];
  }

  const aggregateGroups = input.portfolio.trial_groups.filter((group) => group.group_kind !== "matrix_slice");
  const sourceExecutions = new Map<string, {
    group: ExperimentPortfolioTrialGroup;
    status: "pass" | "fail" | "skipped";
    command?: string;
    cwd?: string;
    metricsPath?: string;
    metrics?: Record<string, unknown>;
    summary: string;
  }>();
  const primaryGroup =
    aggregateGroups.find((group) => group.id === input.portfolio.primary_trial_group_id) ||
    aggregateGroups.find((group) => group.role === "primary");
  if (primaryGroup) {
    sourceExecutions.set(primaryGroup.id, {
      group: primaryGroup,
      status: "pass",
      command: input.primaryCommand,
      cwd: input.primaryCwd,
      metricsPath: input.primaryMetricsPath,
      metrics: input.primaryMetrics,
      summary: input.primarySummary
    });
  }

  for (const record of input.supplementalRuns) {
    const sourceGroup = aggregateGroups.find(
      (group) => group.group_kind !== "matrix_slice" && group.profile === record.profile
    );
    if (!sourceGroup) {
      continue;
    }
    sourceExecutions.set(sourceGroup.id, {
      group: sourceGroup,
      status: record.status,
      command: record.command,
      cwd: record.cwd,
      metricsPath: record.metrics_path,
      metrics: record.status === "pass"
        ? await readMetricsObject(record.metrics_path, process.cwd())
        : undefined,
      summary: record.summary
    });
  }

  const records: BuildExperimentRunManifestTrialGroupExecution[] = [];
  const matrixSummary: Array<Record<string, unknown>> = [];
  for (const group of matrixGroups) {
    const sourceId = group.source_trial_group_id;
    const dataset = group.matrix_axes?.dataset || group.dataset_scope[0];
    const sourceExecution = sourceId ? sourceExecutions.get(sourceId) : undefined;
    if (!sourceId || !dataset || !sourceExecution) {
      const record = {
        id: group.id,
        status: "skipped" as const,
        summary: "Matrix slice could not be materialized because the source aggregate group was unavailable."
      };
      records.push(record);
      matrixSummary.push({
        ...record,
        group_kind: group.group_kind,
        source_trial_group_id: sourceId,
        matrix_axes: group.matrix_axes,
        dataset_scope: group.dataset_scope
      });
      continue;
    }

    if (sourceExecution.status !== "pass" || !sourceExecution.metrics || !sourceExecution.metricsPath) {
      const record = {
        id: group.id,
        status: sourceExecution.status,
        command: sourceExecution.command,
        cwd: sourceExecution.cwd,
        summary: `${group.label} inherited ${sourceExecution.status} from ${sourceExecution.group.label}: ${sourceExecution.summary}`
      };
      records.push(record);
      matrixSummary.push({
        ...record,
        group_kind: group.group_kind,
        source_trial_group_id: sourceId,
        matrix_axes: group.matrix_axes,
        dataset_scope: group.dataset_scope
      });
      continue;
    }

    const artifact = buildManagedMatrixSliceArtifact({
      runId: input.run.id,
      group,
      sourceGroup: sourceExecution.group,
      dataset,
      command: sourceExecution.command,
      cwd: sourceExecution.cwd,
      sourceMetrics: sourceExecution.metrics,
      sourceMetricsPath: sourceExecution.metricsPath
    });
    const metricsPath = await writeRunArtifact(
      input.run,
      path.join("trial_group_metrics", `${group.id}.json`),
      `${JSON.stringify(artifact, null, 2)}\n`
    );
    const record = {
      id: group.id,
      status: "pass" as const,
      command: sourceExecution.command,
      cwd: sourceExecution.cwd,
      metrics_path: metricsPath,
      summary: artifact.summary,
      sampling_profile: artifact.sampling_profile
    };
    records.push(record);
    matrixSummary.push({
      ...record,
      group_kind: group.group_kind,
      source_trial_group_id: sourceId,
      matrix_axes: group.matrix_axes,
      dataset_scope: group.dataset_scope
    });
  }

  await writeRunArtifact(
    input.run,
    "trial_group_matrix.json",
    `${JSON.stringify({
      version: 1,
      run_id: input.run.id,
      generated_at: new Date().toISOString(),
      execution_model: input.portfolio.execution_model,
      trial_groups: matrixSummary
    }, null, 2)}\n`
  );

  return records;
}

function buildManagedMatrixSliceArtifact(input: {
  runId: string;
  group: ExperimentPortfolioTrialGroup;
  sourceGroup: ExperimentPortfolioTrialGroup;
  dataset: string;
  command?: string;
  cwd?: string;
  sourceMetrics: Record<string, unknown>;
  sourceMetricsPath: string;
}): ManagedMatrixSliceArtifact {
  const metrics = asRecord(input.sourceMetrics);
  const conditionMetrics = asRecord(metrics.condition_metrics);
  const primaryCondition = asString(metrics.primary_condition) || "shared_state_schema";
  const baselineCondition = asString(metrics.baseline_condition) || "free_form_chat";
  const primaryConditionMetrics = asRecord(conditionMetrics[primaryCondition]);
  const baselineConditionMetrics = asRecord(conditionMetrics[baselineCondition]);
  const primaryDatasetBreakdown = asRecord(asRecord(primaryConditionMetrics.dataset_breakdown)[input.dataset]);
  const baselineDatasetBreakdown = asRecord(asRecord(baselineConditionMetrics.dataset_breakdown)[input.dataset]);
  const primaryDatasetScore = asNumber(asRecord(primaryConditionMetrics.dataset_scores)[input.dataset]);
  const baselineDatasetScore = asNumber(asRecord(baselineConditionMetrics.dataset_scores)[input.dataset]);
  const datasetCount = inferManagedDatasetCount(input.sourceGroup, primaryConditionMetrics, baselineConditionMetrics);
  const samplingProfile = divideSamplingProfileAcrossDatasets(
    extractSamplingProfile(input.sourceMetrics),
    datasetCount
  );
  const comparison = compactRecord({
    dataset_score_delta: subtractNumbers(primaryDatasetScore, baselineDatasetScore),
    mean_task_score_delta: subtractNumbers(
      asNumber(primaryDatasetBreakdown.mean_task_score),
      asNumber(baselineDatasetBreakdown.mean_task_score)
    ),
    failure_rate_delta: subtractNumbers(
      asNumber(primaryDatasetBreakdown.failure_rate),
      asNumber(baselineDatasetBreakdown.failure_rate)
    ),
    token_count_mean_delta: subtractNumbers(
      asNumber(primaryDatasetBreakdown.token_count_mean),
      asNumber(baselineDatasetBreakdown.token_count_mean)
    )
  });

  return {
    version: 1,
    run_id: input.runId,
    trial_group_id: input.group.id,
    source_trial_group_id: input.sourceGroup.id,
    generated_at: new Date().toISOString(),
    execution_model: "managed_bundle",
    runner_profile: input.group.profile || input.sourceGroup.profile,
    dataset: input.dataset,
    source_metrics_path: input.sourceMetricsPath,
    command: input.command,
    cwd: input.cwd,
    sampling_profile: samplingProfile,
    condition_metrics: compactRecord({
      [primaryCondition]: compactRecord({
        dataset_score: primaryDatasetScore,
        ...primaryDatasetBreakdown
      }),
      [baselineCondition]: compactRecord({
        dataset_score: baselineDatasetScore,
        ...baselineDatasetBreakdown
      })
    }),
    comparison,
    summary: buildManagedMatrixSliceSummary({
      dataset: input.dataset,
      sourceLabel: input.sourceGroup.label,
      profile: input.group.profile || input.sourceGroup.profile,
      datasetScoreDelta: asNumber(comparison.dataset_score_delta),
      meanTaskScoreDelta: asNumber(comparison.mean_task_score_delta)
    })
  };
}

function buildManagedMatrixSliceSummary(input: {
  dataset: string;
  sourceLabel: string;
  profile?: string;
  datasetScoreDelta?: number;
  meanTaskScoreDelta?: number;
}): string {
  const parts = [
    `Matrix slice ${input.dataset}`,
    input.profile ? `(profile=${input.profile})` : undefined,
    `from ${input.sourceLabel}.`
  ].filter((part): part is string => Boolean(part));
  if (typeof input.datasetScoreDelta === "number") {
    parts.push(`dataset_score_delta=${formatMetricValue(input.datasetScoreDelta)}.`);
  } else if (typeof input.meanTaskScoreDelta === "number") {
    parts.push(`mean_task_score_delta=${formatMetricValue(input.meanTaskScoreDelta)}.`);
  } else {
    parts.push("Dataset-level delta could not be recovered from the source metrics.");
  }
  return parts.join(" ");
}

function inferManagedDatasetCount(
  sourceGroup: ExperimentPortfolioTrialGroup,
  primaryConditionMetrics: Record<string, unknown>,
  baselineConditionMetrics: Record<string, unknown>
): number {
  return Math.max(
    sourceGroup.dataset_scope.length,
    Object.keys(asRecord(primaryConditionMetrics.dataset_scores)).length,
    Object.keys(asRecord(baselineConditionMetrics.dataset_scores)).length,
    1
  );
}

function divideSamplingProfileAcrossDatasets(
  samplingProfile: ExperimentPortfolioSamplingProfile | undefined,
  datasetCount: number
): ExperimentPortfolioSamplingProfile | undefined {
  if (!samplingProfile) {
    return undefined;
  }
  const next: ExperimentPortfolioSamplingProfile = {};
  if (samplingProfile.name) {
    next.name = samplingProfile.name;
  }
  const totalTrials = divideEvenlyNumber(samplingProfile.total_trials, datasetCount);
  const executedTrials = divideEvenlyNumber(samplingProfile.executed_trials, datasetCount);
  const cachedTrials = divideEvenlyNumber(samplingProfile.cached_trials, datasetCount);
  if (typeof totalTrials === "number") {
    next.total_trials = totalTrials;
  }
  if (typeof executedTrials === "number") {
    next.executed_trials = executedTrials;
  }
  if (typeof cachedTrials === "number") {
    next.cached_trials = cachedTrials;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function divideEvenlyNumber(value: number | undefined, divisor: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || divisor <= 0) {
    return undefined;
  }
  const quotient = value / divisor;
  return Number.isInteger(quotient) ? quotient : undefined;
}

async function readMetricsObject(
  metricsPath: string | undefined,
  workspaceRoot: string
): Promise<Record<string, unknown> | undefined> {
  const resolvedPath = resolveMaybeRelative(metricsPath, workspaceRoot);
  if (!resolvedPath) {
    return undefined;
  }
  try {
    const raw = await fs.readFile(resolvedPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function trimExcerpt(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, 1200);
}

function extractPolicyBlock(
  obs: {
    policy?: { allowed: boolean; rule_id?: string; reason?: string };
    stderr?: string;
  }
): { blocked: boolean; ruleId?: string; reason?: string } {
  if (obs.policy?.allowed === false) {
    return {
      blocked: true,
      ruleId: obs.policy.rule_id,
      reason: obs.policy.reason
    };
  }

  const stderr = obs.stderr || "";
  const match = stderr.match(/rule=([a-z0-9_]+)/i);
  if (/policy blocked (?:test command|command)/i.test(stderr)) {
    return {
      blocked: true,
      ruleId: match?.[1],
      reason: undefined
    };
  }

  return { blocked: false };
}

function oneLine(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() || "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function validatePlannedConditionCoverage(input: {
  metrics: Record<string, unknown>;
  briefSections?: MarkdownRunBriefSections;
  experimentPortfolio?: ExperimentPortfolio;
}): string | undefined {
  const primaryGroup =
    input.experimentPortfolio?.trial_groups.find(
      (group) => group.id === input.experimentPortfolio?.primary_trial_group_id
    ) || input.experimentPortfolio?.trial_groups[0];
  const requirement = deriveRequiredPlannedConditionCount(input.briefSections, {
    summary: primaryGroup?.label,
    implementation_notes: primaryGroup?.notes,
    evaluation_steps: primaryGroup?.notes,
    resource_notes: primaryGroup?.notes,
    metrics: primaryGroup?.metrics
  });
  if (!requirement) {
    return undefined;
  }

  const executedCount = countExecutedPlannedConditions(input.metrics, {
    tunedOnly: requirement.tunedOnly
  });
  if (executedCount >= requirement.conditionCount) {
    return undefined;
  }

  return [
    "Planned condition coverage incomplete:",
    `observed ${executedCount} successful${requirement.tunedOnly ? " tuned" : ""} condition(s)`,
    `but the brief/design requires ${requirement.conditionCount}.`
  ].join(" ");
}

function validateRunMetricsContract(input: {
  metrics: Record<string, unknown>;
  objectiveEvaluation: ObjectiveMetricEvaluation;
  comparisonContract?: Awaited<ReturnType<typeof loadExperimentComparisonContract>>;
  briefSections?: MarkdownRunBriefSections;
  experimentPortfolio?: ExperimentPortfolio;
}): string[] {
  const issues: string[] = [];
  if (input.objectiveEvaluation.status === "missing") {
    issues.push(input.objectiveEvaluation.summary);
  }

  const conditionCoverageIssue = validatePlannedConditionCoverage({
    metrics: input.metrics,
    briefSections: input.briefSections,
    experimentPortfolio: input.experimentPortfolio
  });
  if (conditionCoverageIssue) {
    issues.push(conditionCoverageIssue);
  }

  const study = asRecord(input.metrics.study);
  const studySummary = asRecord(input.metrics.study_summary);
  const studySummaryStatus = asString(studySummary.status)?.toLowerCase();
  if (studySummaryStatus && ["failed", "failure", "error", "errored"].includes(studySummaryStatus)) {
    issues.push(`Study summary reports failed status: ${studySummaryStatus}.`);
  }
  const explicitRequiredRunCount = [
    asNumber(input.metrics.required_run_count),
    asNumber(studySummary.required_run_count),
    asNumber(study.required_run_count)
  ].find((value): value is number => typeof value === "number");
  const derivedRequiredRunCount = deriveRequiredPlannedRunCount(input);
  const requiredRunCount = explicitRequiredRunCount ?? derivedRequiredRunCount;
  const completedRunCount = [
    asNumber(input.metrics.completed_run_count),
    asNumber(studySummary.completed_run_count),
    asNumber(study.completed_run_count)
  ].find((value): value is number => typeof value === "number");
  if (requiredRunCount !== undefined && requiredRunCount > 0) {
    if (completedRunCount === undefined && explicitRequiredRunCount !== undefined) {
      issues.push(`Experiment metrics omitted completed_run_count for required ${requiredRunCount} run(s).`);
    } else if (completedRunCount !== undefined) {
      if (completedRunCount === 0) {
        issues.push(`No required experiment runs completed successfully (${completedRunCount}/${requiredRunCount}).`);
      } else if (completedRunCount < requiredRunCount) {
        issues.push(`Experiment run coverage incomplete: completed_run_count=${completedRunCount}/${requiredRunCount}.`);
      }
    }
  }
  const requiredConditionCount = [
    asNumber(input.metrics.required_condition_count),
    asNumber(studySummary.required_condition_count),
    asNumber(study.required_condition_count)
  ].find((value): value is number => typeof value === "number");
  const completedConditionCount = [
    asNumber(input.metrics.completed_condition_count),
    asNumber(studySummary.completed_condition_count),
    asNumber(study.completed_condition_count)
  ].find((value): value is number => typeof value === "number");
  if (requiredConditionCount !== undefined && requiredConditionCount > 0 && completedConditionCount === 0) {
    issues.push(
      `No required experiment conditions completed successfully (${completedConditionCount}/${requiredConditionCount}).`
    );
  }

  const aggregate = asRecord(study.aggregate);
  if (Object.keys(aggregate).length > 0) {
    const failedCount = asNumber(aggregate.failed_condition_count);
    const completedCount = asNumber(aggregate.completed_condition_count);
    if (aggregate.all_conditions_succeeded === false) {
      const counts = [
        completedCount !== undefined ? `${completedCount} completed` : undefined,
        failedCount !== undefined ? `${failedCount} failed` : undefined
      ].filter(Boolean);
      issues.push(
        `Study aggregate reports incomplete execution${counts.length > 0 ? ` (${counts.join(", ")})` : ""}.`
      );
    }

    const requiresComparator =
      input.comparisonContract?.baseline_first_required === true ||
      input.comparisonContract?.comparison_mode === "baseline_first_locked";
    if (requiresComparator) {
      const successfulTunedCount = asNumber(aggregate.successful_tuned_condition_count);
      if (successfulTunedCount === 0) {
        issues.push("No tuned comparator condition completed successfully.");
      }
      for (const key of ["baseline_mean_accuracy", "best_tuned_mean_accuracy", "best_tuned_delta_vs_baseline"]) {
        if (Object.prototype.hasOwnProperty.call(aggregate, key) && asNumber(aggregate[key]) === undefined) {
          issues.push(`Study aggregate did not include a numeric ${key}.`);
        }
      }
    }
  }

  return [...new Set(issues.map((issue) => issue.trim()).filter(Boolean))];
}

function deriveRequiredPlannedRunCount(input: {
  metrics: Record<string, unknown>;
  comparisonContract?: Awaited<ReturnType<typeof loadExperimentComparisonContract>>;
  experimentPortfolio?: ExperimentPortfolio;
}): number | undefined {
  const directCandidates = [
    asNumber(input.comparisonContract?.budget_profile.total_trials),
    asNumber(input.experimentPortfolio?.total_expected_trials),
    ...((input.experimentPortfolio?.trial_groups ?? []).map((group) => asNumber(group.expected_trials)))
  ].filter((value): value is number => typeof value === "number" && value > 0);
  if (directCandidates.length > 0) {
    return Math.max(...directCandidates);
  }

  const text = [
    ...(input.experimentPortfolio?.trial_groups ?? []).flatMap((group) => [
      group.label,
      ...(group.metrics ?? []),
      ...(group.notes ?? [])
    ])
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
  return parseRequiredRunCountFromText(text);
}

function parseRequiredRunCountFromText(text: string): number | undefined {
  if (!text.trim()) {
    return undefined;
  }

  const explicitTotalMatches = [
    ...text.matchAll(/\b(\d+)\s+(?:fine[-\s]?tune\s+|experiment\s+)?(?:runs?|trials?)\s+total\b/giu),
    ...text.matchAll(/\btotal\s+(?:of\s+)?(\d+)\s+(?:fine[-\s]?tune\s+|experiment\s+)?(?:runs?|trials?)\b/giu)
  ]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (explicitTotalMatches.length > 0) {
    return Math.max(...explicitTotalMatches);
  }

  const factoredMatches = [...text.matchAll(/\b(\d+)\s*(?:x|×)\s*(\d+)\s+seeds?\s*=\s*(\d+)[^.\n;]*(?:plus|\+)\s*(\d+)\b/giu)]
    .map((match) => Number.parseInt(match[3], 10) + Number.parseInt(match[4], 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  return factoredMatches.length > 0 ? Math.max(...factoredMatches) : undefined;
}

function subtractNumbers(left: number | undefined, right: number | undefined): number | undefined {
  return typeof left === "number" && typeof right === "number"
    ? Number((left - right).toFixed(6))
    : undefined;
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function formatMetricValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(Math.abs(value) >= 1 ? 3 : 4);
}

async function loadExperimentPortfolio(runId: string): Promise<ExperimentPortfolio | undefined> {
  try {
    const raw = await fs.readFile(path.join(".autolabos", "runs", runId, "experiment_portfolio.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as ExperimentPortfolio;
  } catch {
    return undefined;
  }
}

function extractSamplingProfile(metrics: Record<string, unknown>): ExperimentPortfolioSamplingProfile | undefined {
  const sampling =
    metrics.sampling_profile &&
    typeof metrics.sampling_profile === "object" &&
    !Array.isArray(metrics.sampling_profile)
      ? metrics.sampling_profile as Record<string, unknown>
      : {};
  const profile: ExperimentPortfolioSamplingProfile = {};
  if (typeof sampling.name === "string" && sampling.name.trim().length > 0) {
    profile.name = sampling.name.trim();
  }
  if (typeof sampling.total_trials === "number" && Number.isFinite(sampling.total_trials)) {
    profile.total_trials = sampling.total_trials;
  }
  if (typeof sampling.executed_trials === "number" && Number.isFinite(sampling.executed_trials)) {
    profile.executed_trials = sampling.executed_trials;
  }
  if (typeof sampling.cached_trials === "number" && Number.isFinite(sampling.cached_trials)) {
    profile.cached_trials = sampling.cached_trials;
  }
  return Object.keys(profile).length > 0 ? profile : undefined;
}
