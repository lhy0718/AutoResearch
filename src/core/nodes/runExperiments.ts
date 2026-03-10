import path from "node:path";
import { promises as fs } from "node:fs";

import { RunContextMemory } from "../memory/runContextMemory.js";
import { GraphNodeHandler } from "../stateGraph/types.js";
import { appendJsonl, writeRunArtifact } from "./helpers.js";
import { resolveRunCommand } from "./runCommandResolver.js";
import { NodeExecutionDeps } from "./types.js";
import { fileExists } from "../../utils/fs.js";
import {
  evaluateObjectiveMetric,
  resolveObjectiveMetricProfile
} from "../objectiveMetric.js";
import { RunVerifierReport, RunVerifierTrigger } from "../experiments/runVerifierFeedback.js";

export function createRunExperimentsNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "run_experiments",
    async execute({ run, abortSignal }) {
      const runDir = path.join(process.cwd(), ".autolabos", "runs", run.id);
      const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
      const pendingHandoff =
        (await runContext.get<boolean>("implement_experiments.pending_handoff_to_run_experiments")) === true;
      const handoffReason = await runContext.get<string>("implement_experiments.handoff_reason");
      const trigger: RunVerifierTrigger = pendingHandoff ? "auto_handoff" : "manual";
      await runContext.put("run_experiments.trigger", trigger);
      await runContext.put("run_experiments.handoff_reason", handoffReason || null);
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
      const resolved = await resolveRunCommand(run, process.cwd());

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
          await runContext.put("run_experiments.last_error", testObs.stderr || "preflight tests failed");
          return {
            status: "failure",
            error: testObs.stderr || "Preflight tests failed",
            toolCallsUsed: 1
          };
        }
      }

      deps.eventStream.emit({
        type: "TOOL_CALLED",
        runId: run.id,
        node: "run_experiments",
        agentRole: "runner",
        payload: {
          command: resolved.command,
          cwd: resolved.cwd,
          source: resolved.source
        }
      });

      const obs = await deps.aci.runCommand(resolved.command, resolved.cwd, abortSignal);

      const logFile = await writeRunArtifact(
        run,
        "exec_logs/run_experiments.txt",
        [
          `command: ${resolved.command}`,
          `cwd: ${resolved.cwd}`,
          `source: ${resolved.source}`,
          "",
          obs.stdout || "",
          obs.stderr || ""
        ].join("\n")
      );

      if (obs.status !== "ok") {
        const policyBlock = extractPolicyBlock(obs);
        const report = buildRunVerifierReport({
          status: "fail",
          trigger,
          stage: policyBlock.blocked ? "policy" : "command",
          summary: obs.stderr || "Experiment command failed",
          policyRuleId: policyBlock.ruleId,
          policyReason: policyBlock.reason,
          command: resolved.command,
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
            command: resolved.command,
            stderr: obs.stderr || "unknown"
          }
        });
        await persistRunVerifierReport(run, runContext, report);
        await runContext.put("run_experiments.command", resolved.command);
        await runContext.put("run_experiments.cwd", resolved.cwd);
        await runContext.put("run_experiments.last_log_file", logFile);
        await runContext.put("run_experiments.exit_code", obs.exit_code ?? 1);
        await runContext.put("run_experiments.last_error", obs.stderr || "Experiment command failed");
        return {
          status: "failure",
          error: obs.stderr || "Experiment command failed",
          toolCallsUsed: 1
        };
      }

      const metricsExists = await fileExists(resolved.metricsPath);
      if (!metricsExists) {
        const missingMessage = `Experiment finished without metrics output at ${resolved.metricsPath}`;
        const report = buildRunVerifierReport({
          status: "fail",
          trigger,
          stage: "metrics",
          summary: missingMessage,
          command: resolved.command,
          cwd: resolved.cwd,
          metricsPath: resolved.metricsPath,
          exitCode: obs.exit_code ?? 0,
          stdout: obs.stdout,
          stderr: obs.stderr,
          logFile,
          suggestedNextAction: "Ensure the experiment writes JSON metrics to the required metrics path before finishing."
        });
        deps.eventStream.emit({
          type: "TEST_FAILED",
          runId: run.id,
          node: "run_experiments",
          agentRole: "runner",
          payload: {
            command: resolved.command,
            metrics_path: resolved.metricsPath,
            stderr: missingMessage
          }
        });
        await persistRunVerifierReport(run, runContext, report);
        await runContext.put("run_experiments.command", resolved.command);
        await runContext.put("run_experiments.cwd", resolved.cwd);
        await runContext.put("run_experiments.last_log_file", logFile);
        await runContext.put("run_experiments.exit_code", obs.exit_code ?? 0);
        await runContext.put("run_experiments.last_error", missingMessage);
        return {
          status: "failure",
          error: missingMessage,
          toolCallsUsed: 1
        };
      }

      let objectiveEvaluationSummary = "";
      await appendJsonl(run, "exec_logs/observations.jsonl", [
        {
          command: resolved.command,
          cwd: resolved.cwd,
          source: resolved.source,
          status: obs.status,
          stdout: (obs.stdout || "").trim(),
          stderr: (obs.stderr || "").trim(),
          metrics_path: resolved.metricsPath,
          log_file: logFile
        }
      ]);

      let parsedMetrics: Record<string, unknown> = {};
      try {
        const rawMetrics = await fs.readFile(resolved.metricsPath, "utf8");
        parsedMetrics = JSON.parse(rawMetrics) as Record<string, unknown>;
      } catch {
        parsedMetrics = {};
      }

      const objectiveProfile = await resolveObjectiveMetricProfile({
        run,
        runContextMemory: runContext,
        llm: deps.llm,
        eventStream: deps.eventStream,
        node: "run_experiments"
      });
      const experimentMode =
        (await runContext.get<string>("implement_experiments.mode")) || "real_execution";
      const objectiveEvaluation = evaluateObjectiveMetric(
        parsedMetrics,
        objectiveProfile,
        run.objectiveMetric
      );
      objectiveEvaluationSummary = objectiveEvaluation.summary;
      await writeRunArtifact(run, "objective_evaluation.json", JSON.stringify(objectiveEvaluation, null, 2));
      await persistRunVerifierReport(
        run,
        runContext,
        buildRunVerifierReport({
          status: "pass",
          trigger,
          stage: "success",
          summary: objectiveEvaluation.summary,
          command: resolved.command,
          cwd: resolved.cwd,
          metricsPath: resolved.metricsPath,
          exitCode: obs.exit_code ?? 0,
          stdout: obs.stdout,
          stderr: obs.stderr,
          logFile
        })
      );

      await runContext.put("run_experiments.command", resolved.command);
      await runContext.put("run_experiments.cwd", resolved.cwd);
      await runContext.put("run_experiments.last_log_file", logFile);
      await runContext.put("run_experiments.exit_code", obs.exit_code ?? 0);
      await runContext.put("run_experiments.last_error", undefined);
      await runContext.put("objective_metric.last_evaluation", objectiveEvaluation);

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

      return {
        status: "success",
        summary: `${formatRunLabel(experimentMode, trigger)} completed via ${resolved.command}. ${objectiveEvaluationSummary}`,
        needsApproval: true,
        toolCallsUsed: resolved.testCommand ? 2 : 1
      };
    }
  };
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
): Promise<void> {
  await writeRunArtifact(run, "run_experiments_verify_report.json", JSON.stringify(report, null, 2));
  await runContext.put("run_experiments.last_report", report);
  if (report.status === "fail") {
    await runContext.put("run_experiments.feedback_for_implementer", report);
    await runContext.put("implement_experiments.runner_feedback", report);
    return;
  }
  await runContext.put("run_experiments.feedback_for_implementer", null);
  await runContext.put("implement_experiments.runner_feedback", null);
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
