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

export function createRunExperimentsNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "run_experiments",
    async execute({ run, abortSignal }) {
      const runDir = path.join(process.cwd(), ".autoresearch", "runs", run.id);
      const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
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
      const objectiveEvaluation = evaluateObjectiveMetric(
        parsedMetrics,
        objectiveProfile,
        run.objectiveMetric
      );
      objectiveEvaluationSummary = objectiveEvaluation.summary;
      await writeRunArtifact(run, "objective_evaluation.json", JSON.stringify(objectiveEvaluation, null, 2));

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
          text: `Execution completed. Metrics written to ${resolved.metricsPath}`
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
        summary: `Experiment run completed via ${resolved.command}. ${objectiveEvaluationSummary}`,
        needsApproval: true,
        toolCallsUsed: resolved.testCommand ? 2 : 1
      };
    }
  };
}
