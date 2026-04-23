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
      primaryCommand = wrapCommandForExecutionProfile({
        profile: deps.executionProfile || "local",
        command: primaryCommand,
        cwd: resolved.cwd
      });
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
          const triage = classifyRunExperimentsFailure({
            attempt: attemptNumber,
            stage: "command",
            summary: obs.stderr || "Experiment command failed",
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
            stage: policyBlock.blocked ? "policy" : "command",
            summary: obs.stderr || "Experiment command failed",
            policyRuleId: policyBlock.ruleId,
            policyReason: policyBlock.reason,
            command: primaryCommand,
            cwd: resolved.cwd,
            metricsPath: resolved.metricsPath,
            exitCode: obs.exit_code ?? 1,
            stdout: obs.stdout,
            stderr: obs.stderr,
            logFile,
            suggestedNextAction: policyBlock.blocked
              ? "Replace the blocked run command with a policy-compliant command before retrying."
              : "Repair the experiment command or runtime dependencies before handing back to the runner."
          });
          deps.eventStream.emit({
            type: "TEST_FAILED",
            runId: run.id,
            node: "run_experiments",
            agentRole: "runner",
            payload: {
              command: primaryCommand,
              stderr: obs.stderr || "unknown"
            }
          });
          await persistRunVerifierReport(run, runContext, report);
          await persistRunFailureState(runContext, {
            command: primaryCommand,
            cwd: resolved.cwd,
            logFile,
            exitCode: obs.exit_code ?? 1,
            error: obs.stderr || "Experiment command failed"
          });
          await persistGovernanceCrash({
            run,
            runContext,
            comparisonContract,
            implementationContext,
            objectiveMetricName: run.objectiveMetric,
            rationale: report.summary,
            resourceUsage: {
              stage: "command",
              command: primaryCommand,
              cwd: resolved.cwd,
              exit_code: obs.exit_code ?? 1,
              log_file: logFile
            }
          });
          await recordRunFailure(obs.stderr || "Experiment command failed", "structural");
          return {
            status: "failure",
            error: obs.stderr || "Experiment command failed",
            toolCallsUsed: preflightToolCallsUsed + primaryAttemptsUsed
          };
        }

        const metricsExists = await fileExists(resolved.metricsPath);
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
          watchdog = setMetricsState(watchdog, "valid", logFile);
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
        comparisonContract
      });
      if (metricsContractIssues.length > 0) {
        const contractMessage = `Experiment metrics contract failed: ${metricsContractIssues.join(" ")}`;
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
      await writeRunArtifact(run, "run_manifest.json", JSON.stringify(runManifest, null, 2));
      const publicOutputs = await publishRunExperimentOutputs({
        workspaceRoot: process.cwd(),
        run,
        runContext,
        metricsPath: resolved.metricsPath,
        supplementalPlan: managedSupplementalPlan,
        matrixTrialGroups
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
  const experimentMode = await runContext.get<string>("implement_experiments.mode");
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
  if (await fileExists(manifestPath) && (await fileExists(scriptPath))) {
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
    scriptPath
  });
  const confirmatoryCommand = deriveLegacySupplementalCommand({
    primaryCommand: explicitCommand,
    metricsPath: confirmatoryMetricsPath,
    profile: "confirmatory",
    primaryWorkingDir,
    scriptPath
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
}): string | undefined {
  const normalized = input.primaryCommand.trim();
  if (!/run_experiment\.py/u.test(normalized)) {
    return undefined;
  }
  if (/--profile\s+\w+/u.test(normalized) || /--quick-check/u.test(normalized)) {
    return undefined;
  }

  let command = rewriteFlagValue(normalized, "--metrics-path", input.metricsPath);
  let metricsFlag = "--metrics-path";
  if (command === normalized) {
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
  command = rewriteFlagValue(command, "--repeats", repeats, true);
  command = rewriteFlagValue(command, "--seed-base", seedBase, true);
  return absolutizeLegacySupplementalCommand(command, input.primaryWorkingDir, input.scriptPath);
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
      }
    ]
  });
  await runContext.put("run_experiments.last_report", report);
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

async function publishRunExperimentOutputs(input: {
  workspaceRoot: string;
  run: Parameters<typeof writeRunArtifact>[0];
  runContext: RunContextMemory;
  metricsPath: string;
  supplementalPlan?: ManagedSupplementalPlan;
  matrixTrialGroups?: BuildExperimentRunManifestTrialGroupExecution[];
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

function validateRunMetricsContract(input: {
  metrics: Record<string, unknown>;
  objectiveEvaluation: ObjectiveMetricEvaluation;
  comparisonContract?: Awaited<ReturnType<typeof loadExperimentComparisonContract>>;
}): string[] {
  const issues: string[] = [];
  if (input.objectiveEvaluation.status === "missing") {
    issues.push(input.objectiveEvaluation.summary);
  }

  const study = asRecord(input.metrics.study);
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
