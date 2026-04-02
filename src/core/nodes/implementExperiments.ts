import path from "node:path";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { ImplementSessionManager, ImplementSessionStopError } from "../agents/implementSessionManager.js";
import { NodeExecutionDeps } from "./types.js";
import { collectEnvironmentSnapshot, EnvironmentSnapshot } from "../environmentSnapshot.js";

export interface ImplementExperimentsNodeOptions {
  collectEnvironmentSnapshot?: () => Promise<EnvironmentSnapshot>;
}

export function createImplementExperimentsNode(
  deps: NodeExecutionDeps,
  options: ImplementExperimentsNodeOptions = {}
): GraphNodeHandler {
  const sessions = new ImplementSessionManager({
    config: deps.config,
    codex: deps.codex,
    llm: deps.experimentLlm,
    aci: deps.aci,
    eventStream: deps.eventStream,
    runStore: deps.runStore,
    workspaceRoot: process.cwd()
  });

  return {
    id: "implement_experiments",
    async execute({ run, abortSignal }) {
      let result;
      try {
        const environmentSnapshot = await (options.collectEnvironmentSnapshot || collectEnvironmentSnapshot)();
        result = await sessions.run(run, abortSignal, environmentSnapshot);
      } catch (error) {
        if (error instanceof ImplementSessionStopError) {
          return {
            status: "failure",
            summary: error.message,
            error: error.message,
            toolCallsUsed: 1
          };
        }
        throw error;
      }
      const publicOutputRoot = path.relative(process.cwd(), result.publicDir).replace(/\\/g, "/");
      return {
        status: "success",
        summary: result.handoffReason
          ? `${result.summary} ${result.handoffReason} Public outputs: ${publicOutputRoot}.`
          : `${result.summary} Public outputs: ${publicOutputRoot}.`,
        needsApproval: !result.autoHandoffToRunExperiments,
        toolCallsUsed: Math.max(1, result.changedFiles.length)
      };
    }
  };
}
