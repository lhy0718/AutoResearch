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
  setMetricsState
} from "../runExperimentsPanel.js";

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
}

interface SupplementalExpectationArtifact {
  applicable: boolean;
  profiles: string[];
  reason?: string;
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
      await runContext.put("run_experiments.trigger", trigger);
      await runContext.put("run_experiments.handoff_reason", handoffReason || null);
      await runContext.put("run_experiments.supplemental_runs", []);
      await runContext.put("run_experiments.supplemental_summary", null);
      await runContext.put("run_experiments.triage", null);

      const defaultMetricsPath = path.join(process.cwd(), ".autolabos", "runs", run.id, "metrics.json");
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
        return {
          status: "failure",
          error: message,
          toolCallsUsed: 0
        };
      }

      executionPlan = buildRunExperimentsExecutionPlan({
        trigger,
        command: resolved.command,
        cwd: resolved.cwd,
        metricsPath: resolved.metricsPath,
        source: resolved.source,
        comparisonMode: comparisonContract?.comparison_mode,
        budgetProfile: comparisonContract?.budget_profile,
        evaluatorContractId: comparisonContract?.evaluator_contract_id,
        baselineCandidateIds: comparisonContract?.baseline_candidate_ids,
        testCommand: resolved.testCommand,
        testCwd: resolved.testCwd,
        supplementalProfiles: managedSupplementalPlan?.profiles.map((profile) => ({
          profile: profile.profile,
          command: profile.command,
          metricsPath: profile.metricsPath
        }))
      });
      watchdog = createRunExperimentsWatchdogState({
        metricsPath: resolved.metricsPath,
        clearedSupplementalOutputs
      });
      await persistPanelState();

      const preflightToolCallsUsed = resolved.testCommand ? 1 : 0;

      if (resolved.testCommand) {
        deps.eventStream.emit({
          type: "TOOL_CALLED",
          runId: run.id,
          node: "run_experiments",
          agentRole: "runner",
          payload: {
            command: resolved.testCommand,
            cwd: resolved.testCwd || resolved.cwd,
            source: "preflight_test"
          }
        });

        const testObs = await deps.aci.runTests(
          resolved.testCommand,
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
              command: resolved.testCommand,
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
            command: resolved.testCommand,
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
      const primaryCommand = shouldForceFreshManagedStandardRun({
        command: resolved.command,
        experimentMode,
        previousMetricsBackup
      })
        ? appendFreshFlag(resolved.command)
        : resolved.command;
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
      await writeRunArtifact(run, "objective_evaluation.json", JSON.stringify(objectiveEvaluation, null, 2));
      if (comparisonContract) {
        const managedBundleLock = await freezeManagedBundleLock({
          contract: comparisonContract,
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
      const publicOutputs = await publishRunExperimentOutputs({
        workspaceRoot: process.cwd(),
        run,
        runContext,
        metricsPath: resolved.metricsPath,
        supplementalPlan: managedSupplementalPlan
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
      objective_evaluation: objectiveEvaluation
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
  status: "pass" | "fail";
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

  return publishPublicRunOutputs({
    workspaceRoot: input.workspaceRoot,
    run: input.run,
    runContext: input.runContext,
    section: "experiment",
    files
  });
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
