import path from "node:path";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { ImplementSessionManager, ImplementSessionStopError } from "../agents/implementSessionManager.js";
import { NodeExecutionDeps } from "./types.js";

export function createImplementExperimentsNode(deps: NodeExecutionDeps): GraphNodeHandler {
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
        result = await sessions.run(run, abortSignal);
      } catch (error) {
        if (error instanceof ImplementSessionStopError) {
          return {
            status: "success",
            summary: error.message,
            needsApproval: true,
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
